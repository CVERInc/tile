// The Card write API — the endpoint reef-MCP calls. docs/SPEC-card-mcp.md §7.
//
// ── Why the write lives HERE and not in reef ─────────────────────────────────────────────────────
//
// chodaict ruled 乙案 on 2026-07-30: reef-MCP calls this Worker rather than vendoring cardtile. The
// reason is the assembly, not the storage — a save arrives as a THIN card and the stored assets have
// to be put back around it, and only card-core knows where that lane begins. Vendoring the parser
// into reef would mean two copies of the format, and the format is the product.
//
// So this Worker owns: the KV row, the version, and the assembly. reef-MCP owns: who is asking.
//
// ── 🔴 THIS IS NOT AN AUTHORISATION LAYER ────────────────────────────────────────────────────────
//
// The bearer below says exactly one thing: "reef-MCP is calling". It does NOT say which account, and
// nothing here decides whether that account may touch this handle — that decision is made once, in
// reef's registry (`cardsForAccount`, 0004_cards.sql), where every other authorisation decision in
// that codebase is made. SPEC-ai-door-capability-parity §4.3 forbids 長出第三套授權棧 by name, and a
// tenant check hiding in an edge Worker would be exactly that: a second place that can disagree with
// the first, in a different repo, on a different deploy cadence.
//
// The consequence is stated plainly rather than left implicit: ANYONE holding this token can write
// ANY card. It is an infrastructure credential, not a user credential, and it is scoped by being
// held only by the hosted Worker.
import { parseCard, serializeCard } from '../card-core.js';
import { cardDestinations } from './card-destinations.mjs';
import { checkUrls, tooManyLinks } from './url-risk.mjs';
import { assembleSave, thinCard, assetManifest, cardVersion, checkBaseVersion, referencedAssets } from '../card-save.mjs';

const API_PREFIX = '/_api/';

/** the same grammar the store keys on: a handle IS the KV key and the URL path segment. */
const VALID_HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** asset ids are content-addressed (`sha256-…`) but authors may name their own; keep it URL-safe. */
const VALID_ASSET_ID = /^[A-Za-z0-9_.\-]{1,128}$/;

/** KV's per-value ceiling. Hitting it should read as a sentence, not as a store exception. */
const KV_MAX_BYTES = 25 * 1024 * 1024;

/** A preview is a look at an unsaved draft, not a publication. One hour is longer than any edit. */
export const PREVIEW_TTL = 3600;

/**
 * A deleted card's tombstone (reef#2618). Holds `{ deleted_at }` and nothing else — no content, no
 * account — so the public address can say 410 Gone rather than "never existed". The next save clears
 * it. `:` is not in VALID_HANDLE, so it can never be a handle.
 */
export const goneKey = (handle) => `gone:${handle}`;

/**
 * A handle's lifetime (reef#2618 r3). `gen:<handle>` holds the current generation; absent means the
 * first lifetime, generation `0`. Since r8 it is the cache of CardLifetime's storage, which is the
 * authority, and CardLifetime writes it at the end of each DELETE. The lifetime is part of every key a write
 * lands on:
 *
 *   card:<handle>:<gen>   the card body          stop:<handle>:<gen>   its serving stop
 *
 * and a parked preview carries `{ handle, gen }` in its metadata. Every write reads the generation
 * ONCE, at admission, and writes that generation's keys and no other.
 *
 * 🔴 Why partitioning and not checking: KV has no compare-and-swap, so a write admitted before a delete
 * can land after it, and no read before or after the put can stop that (r2 tried; codex r2 found four
 * orders that got through). Here it does not need stopping. A write from a dead lifetime lands on a
 * dead key that nothing serves: it cannot bring the deleted card back, cannot overwrite the next
 * owner's body (that lives under another key), and cannot stop the next owner's card. The next
 * DELETE sweeps it.
 *
 * Migration: a card written before generations has its body at the bare `<handle>` and its stop at
 * `stop:<handle>`. Those are read as generation 0's when `card:<handle>:0` / `stop:<handle>:0` are
 * absent, and ONLY while the generation is 0 — a handle that was ever deleted never reads them again.
 * The first save writes the new shape. The fallback stays until every bare row has been rewritten
 * (a one-off copy to `card:<handle>:0`, then `list()` showing no bare handle); see LEGACY below.
 */
export const genKey = (handle) => `gen:${handle}`;
export const cardKey = (handle, gen) => `card:${handle}:${gen}`;
export const stopKey = (handle, gen) => `stop:${handle}:${gen}`;
export const GEN0 = '0';
/** LEGACY (pre-generation) keys, read for generation 0 only. Remove with the fallback. */
const legacyCardKey = (handle) => handle;
const legacyStopKey = (handle) => `stop:${handle}`;
const newGen = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
/** the handle's current generation. Read once per request, at admission. */
export const generationOf = async (store, handle) => (await store.get(genKey(handle))) || GEN0;
/** does a preview's metadata belong to the handle's current lifetime? (absent gen ⇒ 0, as everywhere) */
export const isCurrentGen = (metadata, gen) => String((metadata && metadata.gen) || GEN0) === String(gen || GEN0);

/**
 * A domain binding belongs to a lifetime, and lives under that lifetime's keys (reef#2618 r5):
 *
 *   vanitybind:<handle>:<gen>:<host>   the binding itself: in this lifetime, <host> serves <handle>
 *   vanityof:<handle>:<gen>            → host: in this lifetime the card's one address is <host> (301)
 *   vanity:<host>                      → handle: a POINTER, the only thing a request for <host> can look up
 *
 * The renderer follows the pointer to a handle, reads that handle's `gen:`, and serves the host only
 * if `vanitybind:<handle>:<gen>:<host>` exists. The pointer names a handle and nothing else; whether
 * the binding is live is decided by a key of the current lifetime.
 *
 * 🔴 Why keys and not a stamp (codex r4 findings 1, 2): r4 kept the two shared keys and stamped them
 * with `{ gen }`. A bind admitted in an ended lifetime then landed its stale stamp on top of the next
 * lifetime's binding, and the domain went dark; DELETE's cleanup read the shared keys after its
 * rotation and deleted the binding the next lifetime had just made. KV has no compare-and-swap, so no
 * read around a put to a shared key can stop either. Here the stale bind writes its own dead
 * generation's keys, and the pointer it writes names the same handle the live binding's pointer does.
 * DELETE never writes the pointer itself: it asks the host's object to end its lifetimes (see deleteCard),
 * and the object clears the pointer only if its owner is exactly one of them.
 *
 * The pointer is written LAST, by HostBindings (one Durable Object per host, its only writer), and
 * only if the object has not been told that the admitted lifetime ended. That matters only when the
 * domain has moved to ANOTHER handle meanwhile (a's bind, admitted before a was deleted, must not
 * point the domain back at a after it was bound to b).
 *
 * 🔴 The object is TOLD when a lifetime ends; it never asks KV whether one is current (codex r5, r6).
 * r5 re-read `gen:` beside the put in the caller; r6 moved that re-read into the object's queue. Both
 * still asked KV, and KV answers from a per-location cache: an object whose view of `gen:a` was warmed
 * before a's DELETE let a's held bind through after b's, and the domain went 404 for good (while
 * card.feelreef.com/b kept 301ing into it). DELETE sends `end(a, gen)` to every host a is bound to; the
 * object's own storage holds the owner `{ handle, gen }` and the lifetimes it was told ended. A bind of
 * an ended lifetime that reaches it after the end is refused; one that reached it before is cleared.
 *
 * 🔴 And WHICH hosts a is bound to is not a KV fact either (codex r7, r8). r7 found them by listing
 * `vanitybind:a:` / `vanityof:a:`; a listing that had not caught up ended none, and a's later bind took
 * the domain from b. Now the handle's lifetime lives in CardLifetime (one object per handle): a bind
 * REGISTERS its host there — checked against the lifetime it means, in one turn — before it writes any
 * key or pointer, and DELETE rotates the generation there first and only then reads back the hosts
 * registered under the ended one. So:
 *   a bind registers its host before it checks anything, and the check is the registration itself;
 *   DELETE reads the host list after it rotates, in the same object, so it cannot miss an earlier one;
 *   any bind whose check passed is on that list and gets an end before DELETE touches KV;
 *   any bind that checks after the rotation is refused, and one that outlives its ticket is refused.
 * The admission ticket stays: a bind admitted before b's never replaces b's (`superseded`), and since
 * r8 a ticket lives TICKET_TTL_MS, which is what lets HostBindings forget an end (see there).

 * Migration: bindings made before generations are `vanity:<host>` → handle and bare `vanityof:<handle>`
 * → host. They are generation 0's: in generation 0 the pointer alone is a binding and the bare inverse
 * is read as `vanityof:<handle>:0` (the same fallback as a legacy body) — but only while that key is
 * ABSENT (r10 rule 2): CardLifetime writes it, empty for "none", the first time it touches the inverse,
 * and from then on it is the whole answer. A handle in generation 0 has never been deleted, so no ended
 * lifetime can have made its pointer. After its first DELETE neither is honoured again. Both legacy keys
 * are adopted by the objects that own their successors (r10 rule 3: HostBindings at its first accepted
 * /point, CardLifetime the first time it needs the inverse), and losing the host clears the bare
 * inverse (rule 1).
 *
 * bindVanity(env, …) is the one way to make a binding: it needs `env.CARDS`, `env.HOST_BINDINGS` and
 * `env.CARD_LIFETIMES`. `gen` is the lifetime the caller means (a save's admitted generation); absent,
 * it is read from the `gen:` cache, which can only make a bind be refused, never let one through. A
 * `redirect: false` binding writes no `vanityof:` (the canonical address keeps serving). Returns
 * `stale_generation` when that lifetime is not (or no longer) the current one, `superseded` when a bind
 * that started later already took the host, or `expired` when it outlived its ticket; in all three
 * neither the pointer nor the inverse was written. Accepted: `{ accepted: true }`, plus `cache:
 * 'pending'` when the KV pointer put failed (the object retries it; the bind stands), and for a
 * redirecting bind `redirect: 'published' | 'not_published'` (not: a newer bind holds the address, or
 * the host was taken meanwhile) and `redirect_cache: 'pending'` likewise.
 *
 * 🔴 r9 (codex r8): nothing public is written between /register and HostBindings' acceptance. The
 * binding key is not public (it is honoured only behind a pointer naming the handle); the inverse is,
 * since canonical /<handle> 301s to it, so CardLifetime publishes it only after the accept (/confirm).
 */
export const vanityKey = (host) => `vanity:${host}`;
const vanityBindPrefix = (handle) => `vanitybind:${handle}:`;
export const vanityBindKey = (handle, gen, host) => `${vanityBindPrefix(handle)}${gen}:${host}`;
export const vanityOfKey = (handle, gen) => `vanityof:${handle}:${gen}`;
/** LEGACY inverse binding, read for generation 0 only. */
const legacyVanityOfKey = (handle) => `vanityof:${handle}`;
export async function bindVanity(env, handle, host, { redirect = true, gen: meant } = {}) {
  const store = env.CARDS, writer = hostWriter(env, host), life = lifetimeOf(env, handle);
  // the ticket BEFORE anything else: every bind that starts after this one is admitted later
  const admitted = await writer.fetch('https://host-bindings/admit', { method: 'POST', body: JSON.stringify({ handle, host }) });
  if (!admitted.ok) throw new Error(`HostBindings answered ${admitted.status} for ${host}`);
  const { ticket } = await admitted.json();
  // 🔴 register BEFORE any key or pointer is written (r8): the lifetime this bind means is checked and
  // the host recorded in one turn of the handle's object, so a DELETE either sees this host or ends the
  // lifetime first and this is refused. `gen:` from KV is only which lifetime the caller means.
  const expected = meant != null ? String(meant) : await generationOf(store, handle);
  const registered = await life.fetch('https://card-lifetime/register', { method: 'POST', body: JSON.stringify({ handle, host, gen: expected }) });
  if (!registered.ok) throw new Error(`CardLifetime answered ${registered.status} for ${handle}`);
  const reg = await registered.json();
  if (reg.stale_generation) return { handle, host, gen: expected, ...reg };
  const { gen, order } = reg;
  // the binding key is not public: the renderer reaches it only through a pointer naming this handle
  await store.put(vanityBindKey(handle, gen, host), handle);
  const pointed = await writer.fetch('https://host-bindings/point', {
    method: 'POST', body: JSON.stringify({ handle, gen, host, ticket }),
  });
  if (!pointed.ok) throw new Error(`HostBindings answered ${pointed.status} for ${host}`);
  // `owning`: the ticket of the acceptance that owns the host for this handle — this bind's own, or a
  // newer one of the same handle when this bind was a no-op (r12). It is what /confirm records.
  const { ticket: owning, ...point } = await pointed.json();
  // 🔴 r9 rule A: the inverse (what canonical /<handle> 301s to) is published only AFTER the host's
  // object accepted, and by the handle's object, which keeps only the newest accepted bind's host. A
  // refused bind (expired, superseded) wrote nothing public, so the previous redirect stands.
  if (point.conflict || !redirect) return { handle, host, gen, ...point };
  const confirmed = await life.fetch('https://card-lifetime/confirm', {
    method: 'POST', body: JSON.stringify({ handle, host, gen, order, ticket: owning }),
  });
  if (!confirmed.ok) throw new Error(`CardLifetime answered ${confirmed.status} confirming ${host} for ${handle}: the binding stands, its redirect is not published; bind again`);
  const inverse = await confirmed.json();
  return { handle, host, gen, ...point, redirect: inverse.published ? 'published' : 'not_published',
    ...(inverse.cache === 'pending' ? { redirect_cache: 'pending' } : {}) };
}

/**
 * hostOwner(env, host): the handle the host's object names as owner, or null. For a reader whose KV
 * read of `vanity:<host>` MISSED (r9): KV is HostBindings' write-through cache, so a miss can be a put
 * that failed after the bind was accepted. One call to one object, and the call itself makes the object
 * reconcile KV. A KV HIT is not re-checked: the cache is behind for at most one retry interval, and a
 * pointer of an ended lifetime is inert anyway (the renderer checks the binding key of the current gen).
 * Any failure reads as unbound, which is what a miss meant before r9.
 */
export async function hostOwner(env, host) {
  const ns = env && env.HOST_BINDINGS;
  if (!ns) return null;
  try {
    const res = await ns.get(ns.idFromName(host)).fetch('https://host-bindings/owner', { method: 'POST', body: JSON.stringify({ host }) });
    if (!res.ok) return null;
    const { handle } = await res.json();
    return typeof handle === 'string' && VALID_HANDLE.test(handle) ? handle : null;
  } catch { return null; }
}

/**
 * The host's one writer. 🔴 Named by the SAME string the pointer key is built from (vanityKey(host)),
 * so one key can never have two objects. No fallback when the binding is missing: writing the pointer
 * from here instead is exactly the r5 race, so a worker deployed without the object refuses to bind.
 */
function hostWriter(env, host) {
  const ns = env.HOST_BINDINGS;
  if (!ns) throw new Error('HOST_BINDINGS is not bound: a domain pointer has one writer per host (wrangler.example.toml)');
  return ns.get(ns.idFromName(host));
}

/** the handle's one lifetime authority (CardLifetime). No fallback, for the same reason as hostWriter. */
function lifetimeOf(env, handle) {
  const ns = env.CARD_LIFETIMES;
  if (!ns) throw new Error('CARD_LIFETIMES is not bound: a handle\'s lifetime has one authority (wrangler.example.toml)');
  return ns.get(ns.idFromName(handle));
}

/** ask the host's object to end these lifetimes of `handle` there. Throws unless it answered. */
class EndNotAcknowledged extends Error {}
/** DELETE's `If-Generation` named a lifetime that is not the current one (reef#2618 r4). */
class StaleLifetime extends Error {}
async function endOnHost(env, handle, gens, host) {
  let res;
  try {
    res = await hostWriter(env, host).fetch('https://host-bindings/end', {
      method: 'POST', body: JSON.stringify({ handle, gens, host }),
    });
  } catch (e) { throw new EndNotAcknowledged(`ending "${handle}" on ${host}: ${e && e.message}`); }
  if (!res.ok) throw new EndNotAcknowledged(`HostBindings answered ${res.status} ending "${handle}" on ${host}`);
}
/** DELETE's calls to the handle's CardLifetime. Throws EndNotAcknowledged unless it answered. */
async function askLifetime(env, handle, op, body) {
  let res;
  try {
    res = await lifetimeOf(env, handle).fetch(`https://card-lifetime/${op}`, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) { throw new EndNotAcknowledged(`${op} of "${handle}": ${e && e.message}`); }
  if (!res.ok) throw new EndNotAcknowledged(`CardLifetime answered ${res.status} to ${op} of "${handle}"`);
  return res.json();
}

/**
 * HostBindings — the Durable Object that owns `vanity:<host>` (one object per host, reef#2618 r6, r7).
 *
 * Its storage is the truth for the host; the KV pointer is the cache readers use, and this object is
 * its only writer (r9: a write-through cache it reconciles, see rule B below). Storage key `host`:
 *   { seq, landed, owner: { handle, gen } | null, ended: { '<handle>:<gen>': ms },
 *     host, cache: 'written' | 'pending', losers: [{ handle, gen, ticket }], adopted: bool (r10) }
 *   POST /admit { handle, host }        → { ticket: seq = max(seq + 1, now) }, the bind's first step
 *   POST /point { handle, gen, host, ticket }
 *                                       refused (`expired`) if the ticket is TICKET_TTL_MS old;
 *                                       refused (`stale_generation`) if (handle, gen) is in `ended`;
 *                                       refused (`superseded`) if ticket < landed (a later-admitted bind
 *                                       already wrote; the same owner again is `accepted`, a no-op that
 *                                       answers ticket = landed, the owner's — r12);
 *                                       otherwise owner = { handle, gen }, landed = ticket, the previous
 *                                       owner joins `losers` — that storage write IS the acceptance —
 *                                       then KV pointer = handle → { accepted, ticket, cache?: 'pending' }
 *   POST /end   { handle, gens, host }  every (handle, gen) goes into `ended`; if the owner is one of
 *                                       them, owner = null and KV `vanity:<host>` is deleted
 *   POST /owner { host }                → { handle | null }: for a reader whose KV read missed (hostOwner)
 * Every request (and the alarm) first puts a pending pointer from `owner` and tells each loser's
 * CardLifetime (`/lost`). It never reads KV. A Durable Object lets a second request in while the first awaits anything
 * outside it (every KV call is outside), so each request runs whole in this object's own queue.
 *
 * 🔴 A ticket lives TICKET_TTL_MS (r8): a /point whose ticket is older is refused (`expired`), whatever
 * else is true. That is what lets `ended` be pruned and still be correct: a bind that can still land
 * took its ticket less than TICKET_TTL_MS ago, it registered with CardLifetime after that, and an end
 * of its lifetime was recorded after the registration (DELETE reads the hosts after it rotates), so
 * that entry is younger than the ticket and is kept. Entries go only once older than ENDED_KEEP_MS
 * (= the TTL), with no count cap: a cap could drop an entry a live ticket still needs. Tickets are the
 * object's clock (`max(seq + 1, now)`), so a ticket is its own issue time and nothing more is stored.
 */
export const TICKET_TTL_MS = 60000; // a minute: one bind is a handful of requests
export const ENDED_KEEP_MS = TICKET_TTL_MS;
/** how soon an object retries a KV write-through that failed (its alarm; any request to it retries sooner) */
export const CACHE_RETRY_MS = 5000;
/** run `step` alone in the object: a Durable Object lets a request in while another awaits anything outside it */
function inTurn(object, step) {
  const turn = object.tail.then(step);
  object.tail = turn.catch(() => {}); // a failed write must not wedge the object
  return turn.then((r) => Response.json(r), () => Response.json({ error: 'store_failed' }, { status: 500 }));
}
/** a failed write-through is retried by the object's alarm (the runtime calls `alarm()`), and sooner by
 *  any request the object gets. A storage without alarms (a test double) relies on the requests alone. */
async function retryLater(storage) {
  if (storage && typeof storage.setAlarm === 'function') await storage.setAlarm(Date.now() + CACHE_RETRY_MS);
}

/**
 * 🔴 r9 rule B, for both objects: the object's storage is the truth and its KV keys are a WRITE-THROUGH
 * cache of it (codex r8 #2). Each change is written to storage first with `cache: 'pending'` — that
 * write IS the change (for HostBindings, the acceptance of the bind) — and then put to KV; a KV failure
 * leaves `pending` in storage, schedules the alarm, and still answers success (`cache: 'pending'`).
 * Every request to the object, and its alarm, first re-puts a pending cache from storage — except
 * CardLifetime's reads (/current, and a refused /end), which write nothing at all (r15). So the object
 * knows whether KV differs from it without ever reading KV (r6: an object reading KV reads a cache).
 */
export class HostBindings {
  constructor(state, env) { this.storage = state && state.storage; this.env = env; this.tail = Promise.resolve(); }
  async fetch(request) {
    const op = new URL(request.url).pathname;
    const body = (await request.json().catch(() => null)) || {};
    const { handle, host, ticket } = body;
    const gens = op === '/end' ? body.gens : op === '/point' ? [body.gen] : ['-'];
    if (!['/admit', '/point', '/end', '/owner'].includes(op) || (op !== '/owner' && !VALID_HANDLE.test(String(handle)))
      || typeof host !== 'string' || !host
      || !Array.isArray(gens) || !gens.length || gens.some((g) => typeof g !== 'string' || !g)
      || (op === '/point' && !Number.isSafeInteger(ticket))) {
      return Response.json({ error: 'bad_request' }, { status: 400 });
    }
    if (!this.storage) return Response.json({ error: 'no_storage' }, { status: 500 });
    return inTurn(this, op === '/admit' ? () => this.admit(host) : op === '/owner' ? () => this.owner(host)
      : op === '/point' ? () => this.point(handle, gens[0], host, ticket) : () => this.end(handle, gens, host));
  }
  /** the runtime's call when the retry alarm comes due */
  async alarm() { await inTurn(this, async () => { const s = await this.storage.get('host'); if (s) await this.flush(s); return {}; }); }
  /** the host's state, its pending cache reconciled first (rule B) */
  async load(host) {
    const s = (await this.storage.get('host')) || { seq: 0, landed: 0, owner: null, ended: {} }, now = Date.now();
    s.ended = Object.fromEntries(Object.entries(s.ended).filter(([, t]) => now - t < ENDED_KEEP_MS));
    s.host = host;
    s.cache = s.cache || 'written';
    s.losers = s.losers || [];
    await this.flush(s);
    return s;
  }
  /**
   * Bring KV and the handles that lost this host in line with storage: the pointer is put (or deleted)
   * from `owner`, and every handle the host was taken from is told (CardLifetime `/lost`, so its
   * canonical address stops redirecting here). What fails stays in storage for the next try.
   */
  async flush(s) {
    let changed = false;
    if (s.cache === 'pending') {
      try {
        if (s.owner) await this.env.CARDS.put(vanityKey(s.host), s.owner.handle);
        else await this.env.CARDS.delete(vanityKey(s.host));
        s.cache = 'written';
        changed = true;
      } catch { /* stays pending */ }
    }
    if (s.losers && s.losers.length) {
      const left = [];
      for (const l of s.losers) {
        try {
          const res = await lifetimeOf(this.env, l.handle).fetch('https://card-lifetime/lost', {
            method: 'POST', body: JSON.stringify({ handle: l.handle, gen: l.gen, host: s.host, ticket: l.ticket }),
          });
          if (!res.ok) left.push(l);
        } catch { left.push(l); }
      }
      if (left.length !== s.losers.length) { s.losers = left; changed = true; }
    }
    if (changed) await this.storage.put('host', s);
    if (s.cache === 'pending' || s.losers.length) await retryLater(this.storage);
  }
  async admit(host) {
    const s = await this.load(host);
    s.seq = Math.max(s.seq + 1, Date.now());
    await this.storage.put('host', s);
    return { ticket: s.seq };
  }
  async owner(host) {
    const s = await this.load(host);
    return { handle: s.owner ? s.owner.handle : null };
  }
  async point(handle, gen, host, ticket) {
    const s = await this.load(host);
    if (Date.now() - ticket >= TICKET_TTL_MS) return expired(host);
    if (s.ended[`${handle}:${gen}`] != null) return staleWrite(handle);
    // 🔴 r12: a same-owner no-op answers with the ticket of the acceptance that owns the host NOW, never
    // its own older one: its /confirm then can neither publish with nor write back a ticket a later
    // take has already passed (codex r11)
    if (ticket < s.landed) return s.owner && s.owner.handle === handle && s.owner.gen === gen ? { accepted: true, ticket: s.landed } : superseded(host);
    // 🔴 r10 rule 3: a host bound before generations has a KV pointer and no durable owner. Its first
    // accepted /point adopts that handle as the owner at generation 0, once, so the loser notice below
    // reaches it and its canonical address stops redirecting here. The pointer is the migration's only
    // source, so this is the one KV read the object makes; `adopted` keeps it from ever re-reading the
    // cache it writes. Readers (/owner) never adopt.
    if (!s.adopted) {
      if (!s.owner) s.owner = await this.adoptLegacy(host);
      s.adopted = true;
    }
    const lost = s.owner && (s.owner.handle !== handle || s.owner.gen !== gen) ? s.owner : null;
    if (lost) s.losers.push({ handle: lost.handle, gen: lost.gen, ticket });
    s.owner = { handle, gen };
    s.landed = ticket;
    s.cache = 'pending';
    await this.storage.put('host', s); // THE acceptance: from here the bind stands, whatever KV does next
    await this.flush(s);
    return { accepted: true, ticket, ...(s.cache === 'pending' ? { cache: 'pending' } : {}) };
  }
  /** the legacy pointer's handle as a generation-0 owner, or null (see point) */
  async adoptLegacy(host) {
    const legacy = await this.env.CARDS.get(vanityKey(host));
    return typeof legacy === 'string' && VALID_HANDLE.test(legacy) ? { handle: legacy, gen: GEN0 } : null;
  }
  async end(handle, gens, host) {
    // stamped no earlier than any ticket issued so far, so an entry is never older than a ticket it must refuse
    const s = await this.load(host), at = Math.max(Date.now(), s.seq);
    for (const g of gens) s.ended[`${handle}:${g}`] = at;
    const cleared = !!s.owner && s.owner.handle === handle && gens.includes(s.owner.gen);
    if (cleared) { s.owner = null; s.cache = 'pending'; }
    await this.storage.put('host', s);
    if (cleared) await this.flush(s); // a pointer left behind names an ended lifetime: inert, and retried
    return { cleared, ...(s.cache === 'pending' ? { cache: 'pending' } : {}) };
  }
}

/**
 * CardLifetime — the Durable Object that owns a handle's lifetime (one object per handle, reef#2618 r8).
 *
 * 🔴 Its storage is the authority for the handle's generation AND for the hosts bound in it. KV `gen:`
 * is the cache readers use, and this object is its only writer (at /settle). r7 found the hosts to end
 * by listing `vanitybind:` / `vanityof:`, and a listing that had not caught up ended none of them: a
 * later bind of the dead lifetime then took a domain from the next owner (codex r7). Nothing here is
 * discovered from KV. Storage key `life`:
 *   { gen, hosts: [host…] (bound in gen), pending: { '<ended gen>': [host…] } (ends not yet delivered),
 *     seq, inverse: { host | null, order, ticket } | null, lost: { host: ticket }, cache: 'written' | 'pending',
 *     highWater: { host: ticket } (r13: the newest acceptance of each host this lifetime confirmed; its
 *     keys are a subset of `hosts`, and /end empties it with them),
 *     adopted, legacy: host | null, dropLegacy }   (r10: the bare legacy inverse, see adopt)
 *   POST /register { handle, host, gen } refused (`stale_generation`) unless gen is the current one;
 *                                        otherwise host joins `hosts` → { gen, order: ++seq }
 *   POST /confirm  { handle, host, gen, order, ticket }
 *                                        after HostBindings accepted (r9 rule A), with the ticket /point
 *                                        answered: inverse = host unless `lost[host]` > ticket, or
 *                                        `highWater[host]` > ticket (r13: per host, whatever the inverse
 *                                        names now), or the inverse already is this acceptance, or names
 *                                        another host with a newer `order`; then KV
 *                                        `vanityof:<handle>:<gen>` → { published, cache?: 'pending' }
 *   POST /lost     { handle, host, gen, ticket }
 *                                        HostBindings: the host went to another handle with the taker's
 *                                        ticket; lost[host] = ticket, and every inverse naming it that an
 *                                        OLDER acceptance wrote is cleared: its own if inverse.ticket <
 *                                        ticket (KV key deleted; in gen 0 written empty), and the bare one
 *   POST /current  { handle }            → { gen } (reads only: no flush, no write, no alarm — r15)
 *   POST /end      { handle, gen? }      refused (`stale_generation`) when `gen` is given and is not the
 *                                        current one (r4, DELETE's If-Generation; r15: before
 *                                        any write, its flush included); otherwise
 *                                        `hosts` moves to pending[gen], gen = a fresh one, `hosts` = []
 *                                        → { ended, gen, pending }: every host still owed an end
 *   POST /settle   { handle, delivered: { '<gen>': [host…] } }
 *                                        those leave `pending`; then KV `gen:<handle>` = gen
 * An empty object is generation 0: `gen:` keys exist only since this PR, which ships this class, so no
 * handle was ever rotated anywhere else. It never reads KV.
 */
export class CardLifetime {
  constructor(state, env) { this.storage = state && state.storage; this.env = env; this.tail = Promise.resolve(); }
  async fetch(request) {
    const op = new URL(request.url).pathname;
    const body = (await request.json().catch(() => null)) || {};
    const { handle, host, gen, delivered, order, ticket } = body;
    const hostList = (v) => Array.isArray(v) && v.every((h) => typeof h === 'string' && h);
    const hostGen = typeof host === 'string' && host && typeof gen === 'string' && gen;
    if (!['/register', '/confirm', '/lost', '/end', '/settle', '/current'].includes(op) || !VALID_HANDLE.test(String(handle))
      || (['/register', '/confirm', '/lost'].includes(op) && !hostGen)
      || (op === '/confirm' && !(Number.isSafeInteger(order) && Number.isSafeInteger(ticket)))
      || (op === '/lost' && !Number.isSafeInteger(ticket))
      || (op === '/end' && gen != null && !(typeof gen === 'string' && gen))
      || (op === '/settle' && !(delivered && typeof delivered === 'object' && Object.values(delivered).every(hostList)))) {
      return Response.json({ error: 'bad_request' }, { status: 400 });
    }
    if (!this.storage) return Response.json({ error: 'no_storage' }, { status: 500 });
    return inTurn(this, op === '/register' ? () => this.register(handle, host, gen)
      : op === '/confirm' ? () => this.confirm(handle, host, gen, order, ticket)
        : op === '/lost' ? () => this.lost(handle, host, gen, ticket)
          : op === '/end' ? () => this.end(handle, gen)
            : op === '/current' ? async () => ({ gen: (await this.read(handle)).gen }) : () => this.settle(handle, delivered));
  }
  /** the runtime's call when the retry alarm comes due */
  async alarm() { await inTurn(this, async () => { const s = await this.storage.get('life'); if (s && s.handle) await this.flush(s); return {}; }); }
  /** the lifetime, its pending inverse reconciled first (rule B, see HostBindings): the WRITE paths' read */
  async load(handle) {
    const s = await this.read(handle);
    await this.flush(s);
    return s;
  }
  /**
   * 🔴 r15: the lifetime as stored, and nothing else — no flush, no adoption, no storage write, no alarm.
   * /current and a refused /end use only this (codex tile#207 r1 #2: /current flushed a pending
   * inverse, so a read wrote KV and storage). A pending cache waits for the alarm or the next write.
   */
  async read(handle) {
    const s = (await this.storage.get('life')) || { gen: GEN0, hosts: [], pending: {} };
    s.handle = handle;
    s.seq = s.seq || 0;
    s.inverse = s.inverse || null;
    s.lost = s.lost || {};
    s.highWater = s.highWater || {};
    // the inverse's acceptance is one this lifetime has seen (a life stored before r13 has no highWater)
    if (s.inverse && s.inverse.host && s.inverse.ticket != null && !(s.highWater[s.inverse.host] >= s.inverse.ticket)) s.highWater[s.inverse.host] = s.inverse.ticket;
    s.cache = s.cache || 'written';
    return s;
  }
  /**
   * put `vanityof:<handle>:<gen>` from `inverse`; a failure stays pending for the next try. In generation
   * 0 "no address" is written as an EMPTY value, not a delete (r10 rule 2): a missing gen-0 key sends the
   * reader to the bare legacy key, and once this object exists its answer is the whole answer. Then the
   * bare key, if a loss named it (rule 1), is deleted — after the tombstone, so no reader sees it alone.
   */
  async flush(s) {
    if (s.cache !== 'pending') return;
    try {
      const key = vanityOfKey(s.handle, s.gen);
      if (s.inverse && s.inverse.host) await this.env.CARDS.put(key, s.inverse.host);
      else if (s.gen === GEN0) await this.env.CARDS.put(key, '');
      else await this.env.CARDS.delete(key);
      if (s.dropLegacy) { await this.env.CARDS.delete(legacyVanityOfKey(s.handle)); s.dropLegacy = false; }
      s.cache = 'written';
      await this.storage.put('life', s);
    } catch { await retryLater(this.storage); }
  }
  /**
   * 🔴 r10: in generation 0 the bare `vanityof:<handle>` (written before generations) is this object's
   * too. The first time it needs the inverse it ADOPTS the bare key's host as its own (read once; the
   * migration's only source, and nothing writes that key any more), and from then on its gen-0 key is
   * the reader's whole answer. `legacy` remembers what the bare key named, so a loss of that host knows
   * to delete it without reading it again.
   */
  async adopt(s) {
    if (s.adopted || s.gen !== GEN0) return;
    const bare = await this.env.CARDS.get(legacyVanityOfKey(s.handle));
    s.legacy = typeof bare === 'string' && bare ? bare : null;
    if (!s.inverse) s.inverse = { host: s.legacy, order: 0 };
    s.adopted = true;
    s.cache = 'pending';
  }
  async register(handle, host, gen) {
    const s = await this.load(handle);
    if (gen !== s.gen) return staleWrite(handle);
    await this.adopt(s);
    if (!s.hosts.includes(host)) s.hosts.push(host);
    s.seq += 1; // the bind's place among this lifetime's binds: the newest accepted one owns the redirect
    await this.storage.put('life', s);
    await this.flush(s);
    return { gen: s.gen, order: s.seq };
  }
  /**
   * 🔴 r9 rule A: a bind the host's object ACCEPTED asks to become the card's one address. Published
   * only if it is still this lifetime, no newer acceptance of the same host reached here (`highWater`,
   * r13: whatever the inverse names now) or later
   * registered bind of another host (`order`) was already published, and
   * the host was not taken from this handle after this bind's ticket (`lost`): so a late confirm never
   * clobbers a newer accepted host, and never points the card at a host it no longer has.
   */
  async confirm(handle, host, gen, order, ticket) {
    const s = await this.load(handle);
    if (gen !== s.gen || !s.hosts.includes(host)) return staleWrite(handle);
    await this.adopt(s); // a no-op after /register adopted
    if (s.lost[host] != null && s.lost[host] > ticket) return { published: false, why: `${host} was bound to another card after this bind.` };
    // 🔴 r13: an acceptance older than the newest one this lifetime has seen for the host is never
    // published, whatever the inverse names now. Tickets are the order the host's object and this one
    // share; the newest is a fact about the HOST, so it is kept per host (`highWater`) and survives the
    // inverse moving to another host (codex r12: X/T3 published, then Y, then X/T1 wrote over Y, and the
    // T2 loss cleared it). r12 compared against the inverse, and so forgot X once Y replaced it. Every
    // acceptance that reaches here raises it, published or not: one refused on order below is still
    // newer than any acceptance of the host before it. A ticket ≤ it writes nothing; the same ticket
    // the inverse holds is the acceptance already published (a same-owner no-op answers it).
    const high = s.highWater[host], same = !!s.inverse && s.inverse.host === host;
    if (high != null && ticket <= high) {
      return same && s.inverse.ticket === ticket ? { published: true, ...(s.cache === 'pending' ? { cache: 'pending' } : {}) }
        : { published: false, why: 'A newer bind of this address already set it.' };
    }
    s.highWater[host] = ticket;
    // Another host's tickets come from another object's clock, so between hosts the registration order decides.
    if (!same && s.inverse && s.inverse.order > order) {
      await this.storage.put('life', s); // the high water, raised by an acceptance that does not publish
      return { published: false, why: 'A bind that started later already set this card\'s address.' };
    }
    // the acceptance that wrote it: only a later loss clears it (r11); its order never goes back either
    s.inverse = { host, order: same ? Math.max(order, s.inverse.order) : order, ticket };
    s.cache = 'pending';
    await this.storage.put('life', s);
    await this.flush(s);
    return { published: true, ...(s.cache === 'pending' ? { cache: 'pending' } : {}) };
  }
  /**
   * HostBindings: `host` went to another handle with `ticket`. If it is this card's address, the card
   * has none again, and canonical /<handle> serves its page rather than 301 into someone else's domain.
   * 🔴 r11: `ticket` is the acceptance that DISPLACED this handle, and the inverse keeps the ticket of the
   * acceptance that wrote it (none = the adopted legacy one, older than any). Cleared only if that
   * ticket < this one: a retried notice about an older take arrives after a newer rebind of the same
   * host, and is acknowledged without effect (codex r10).
   */
  async lost(handle, host, gen, ticket) {
    const s = await this.load(handle);
    if (gen !== s.gen) return {}; // an ended lifetime's inverse is DELETE's to remove (it is on `pending`)
    await this.adopt(s); // a legacy owner HostBindings adopted may never have bound through here
    s.lost[host] = Math.max(s.lost[host] || 0, ticket);
    if (s.inverse && s.inverse.host === host && (s.inverse.ticket || 0) < ticket) {
      s.inverse = { host: null, order: s.inverse.order };
      s.cache = 'pending';
    }
    // 🔴 r10 rule 1: losing a host clears EVERY inverse that names it, the bare legacy one included
    if (s.legacy === host) { s.legacy = null; s.dropLegacy = true; s.cache = 'pending'; }
    await this.storage.put('life', s);
    await this.flush(s);
    return {};
  }
  async end(handle, meant) {
    const s = await this.read(handle), ended = s.gen;
    // reef#2618 r4: a DELETE names the lifetime it checked. Not the current one ⇒ refused, nothing moves
    // (r15: checked on the bare read, before the flush, which is a write)
    if (meant != null && meant !== s.gen) return { stale_generation: true };
    await this.flush(s);
    if (s.hosts.length) s.pending[ended] = [...new Set([...(s.pending[ended] || []), ...s.hosts])];
    s.gen = newGen();
    s.hosts = [];
    // the ended lifetime's inverse key is on `pending` (it needs a registered host), so DELETE removes it
    s.inverse = null;
    s.lost = {};
    s.highWater = {}; // a fresh lifetime's binds are all newer: its hosts' objects issue increasing tickets
    s.legacy = null; // the bare key is generation 0's: DELETE removes it with the legacy keys
    s.dropLegacy = false;
    s.cache = 'written';
    await this.storage.put('life', s); // the lifetime ends HERE, before any host is told
    return { ended, gen: s.gen, pending: s.pending };
  }
  async settle(handle, delivered) {
    const s = await this.load(handle);
    for (const [g, hosts] of Object.entries(delivered)) {
      const left = (s.pending[g] || []).filter((h) => !hosts.includes(h));
      if (left.length) s.pending[g] = left; else delete s.pending[g];
    }
    await this.storage.put('life', s);
    await this.env.CARDS.put(genKey(handle), s.gen); // the cache, written from the truth, in this object's turn
    return { gen: s.gen };
  }
}

/** a key, or for generation 0 the legacy key when the new one is absent. */
async function readGen(store, key, legacy, gen) {
  const [v, old] = await Promise.all([store.get(key), gen === GEN0 ? store.get(legacy) : null]);
  return v != null ? v : (old != null ? old : null);
}

/** is `host` bound to `handle` in generation `gen`? In generation 0 the pointer alone is (see vanityKey). */
export const isBound = async (store, handle, gen, host) =>
  gen === GEN0 || (await store.get(vanityBindKey(handle, gen, host))) != null;
/**
 * the host generation `gen` of `handle` redirects to, or null. 🔴 r10 rule 2: an authoritative "none" is
 * not a missing key. The gen-scoped key, once present, is the whole answer — CardLifetime writes it the
 * first time it touches the inverse, and in generation 0 writes "none" as an empty value. Only when it is
 * absent (no lifetime has ever spoken for this handle) is the bare legacy key asked.
 */
export async function boundHostOf(store, handle, gen) {
  const v = await readGen(store, vanityOfKey(handle, gen), legacyVanityOfKey(handle), gen);
  return v || null;
}

/**
 * liveCard: the current lifetime's card body (and stop) under a handle. The ONE read every exit uses
 * — renderer and API alike — so a body cannot be absent on one door and present on another. A body
 * from a dead lifetime is under a key this never computes.
 */
export async function liveCard(store, handle, { stop = false, gen: read } = {}) {
  // `gen` lets a caller that already read the generation (the vanity check) judge both by the same read
  const gen = read != null ? read : await generationOf(store, handle);
  const [md, stopped] = await Promise.all([
    readGen(store, cardKey(handle, gen), legacyCardKey(handle), gen),
    stop ? readGen(store, stopKey(handle, gen), legacyStopKey(handle), gen) : null,
  ]);
  return { md, gen, stopped };
}

/**
 * The answer to a write whose lifetime ended while it was in flight — best effort, from a re-read of
 * `gen:` after the put. Correctness does not depend on it: what the write landed on is dead either way.
 */
/** a bind admitted before the host's current one landed: the later bind keeps the domain */
const superseded = (host) => ({
  conflict: true,
  superseded: true,
  why: `${host} was bound again by a bind that started after this one. That later binding stands; bind again to take the domain.`,
});
/** a bind whose ticket outlived TICKET_TTL_MS before its pointer write: refused whatever else holds */
const expired = (host) => ({
  conflict: true,
  expired: true,
  why: `This bind of ${host} took too long to finish, so nothing was pointed. Bind again.`,
});
const staleWrite = (handle) => ({
  conflict: true,
  stale_generation: true,
  why: `"${handle}" was deleted or created again while this write was in flight. Nothing it wrote is served; read the card again.`,
});

/** where a parked draft lives. Prefixed so it can never collide with a handle (`:` is not in VALID_HANDLE). */
export const previewKey = (id) => `_preview:${id}`;

/**
 * A sandbox visitor's card, parked so it can walk through the door with them.
 *
 * 🔴 The reason this exists at all: `card.feelreef.com` and `feelreef.com` are different ORIGINS, so
 * the far side of the door cannot read this side's localStorage. Before this, the door carried a
 * title and a tagline and threw away everything else — ten minutes of work, deleted by the button
 * labelled 「把這張變成真的」.
 *
 * Same shape as a preview: an unguessable key, an hour to live, never a handle (`:` cannot appear in
 * VALID_HANDLE, so `try:<uuid>` can never shadow a real card, including the RSP-reserved `try`).
 */
export const tryKey = (id) => `try:${id}`;
/** An hour, matching PREVIEW_TTL: longer than any walk from the sandbox to a signed-in dashboard. */
export const TRY_TTL = 3600;
/** The ingest budget. A card at this size is already 99% pictures. */
export const TRY_MAX_BYTES = 1500 * 1024;
/** `try:<uuid>` — nothing else is ever read back out of this namespace. */
export const TRY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time equality over two hex strings of equal length. */
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearer(request) {
  const m = /^Bearer\s+(.+)$/i.exec((request.headers.get('authorization') || '').trim());
  return m ? m[1].trim() : null;
}

/**
 * 🔴 The token is stored HASHED, and the deploy holds only the hash.
 *
 * Modelled on the runner's `runner_token_hash` (reef 0001_site_registry.sql) rather than invented:
 * that precedent exists so a dump of the store yields no usable credential, and the same reasoning
 * survives the move to a Worker secret — this Worker never holds anything it could use to call
 * itself, and a leak of its configuration is not a leak of the bearer.
 *
 * 🔴 No secret configured ⇒ EVERY write is refused. Fail closed. An `if (!hash) return ok` would make
 * a forgotten `wrangler secret put` look exactly like a working deploy, and the failure would only
 * become visible when someone else's card changed.
 */
async function authorize(request, env) {
  const expected = env && env.MCP_TOKEN_HASH;
  if (!expected) return json({ error: 'This deployment has no MCP_TOKEN_HASH — the write API is closed.' }, 503);
  const token = bearer(request);
  if (!token) return json({ error: 'Unauthorized.' }, 401);
  if (!timingSafeEqualHex(await sha256Hex(token), String(expected).trim().toLowerCase())) {
    // Deliberately identical to the missing-token answer: never say whether it was absent or wrong.
    return json({ error: 'Unauthorized.' }, 401);
  }
  return null;
}

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

/**
 * get: handle → { md, version, gen } | null. Null is "no such card", never an error — and a body from
 * a deleted lifetime is no such card (see genKey).
 */
async function readCard(store, handle) {
  const { md, gen } = await liveCard(store, handle);
  if (md === null) return null;
  return { md, version: await cardVersion(md), gen };
}

/**
 * write + READ BACK + assert.
 *
 * 🔴 KV is eventually consistent, so "the put resolved" is not "the row says what I wrote". A version
 * handed back from the bytes we HELD rather than the bytes that LANDED certifies our intention
 * instead of the store's state — and the caller would store that token as its next base_version,
 * which means a silent write failure would then look like a version conflict somewhere else
 * entirely. Carried over from reef's card-store.js, which is retired in favour of this file.
 */
//
// 🔴 And the key is the ADMITTED generation's (reef#2618 r3, see genKey) — `admitted` is what the
// request read before Web Risk's network wait, never re-read here. A save, even the one that creates
// the card, never writes `gen:`. The two re-reads around the put are courtesy, not protection: one
// skips a write already known to be dead, the other tells the caller "not served" instead of "saved".
async function writeCard(store, handle, md, admitted) {
  if ((await generationOf(store, handle)) !== admitted) return staleWrite(handle);
  const key = cardKey(handle, admitted);
  await store.put(key, md);
  const stored = await store.get(key);
  if (stored !== md) {
    return {
      conflict: true,
      expected: await cardVersion(md),
      current: stored == null ? null : await cardVersion(stored),
      why: 'The store did not read back what was written. Nothing has been confirmed; do not treat this as saved.',
    };
  }
  if ((await generationOf(store, handle)) !== admitted) return staleWrite(handle);
  return { version: await cardVersion(md), bytes: md.length };
}

/**
 * delete_card: everything this store holds under a handle goes, and one content-free fact stays.
 *
 * The product owner ruled on reef#2618: the owner downloads first, types the handle, and NOTHING is kept — the
 * handle is free at once. So this removes the card, its serving stop, every parked preview of it, and
 * its own-domain binding; then leaves `gone:<handle>` = `{ deleted_at }` so the public address answers
 * 410 instead of an ordinary 404. The tombstone does not reserve the handle: the next save clears it.
 *
 * 🔴 The domain binding goes too: its keys are the ended lifetime's (see vanityKey), so the next owner
 * of this handle is neither 301'd to the previous owner's domain nor served on it. Each host the
 * lifetime registered is told, and its object clears `vanity:<host>` if it still names this lifetime; a
 * hand-made legacy pointer no object knows stays, inert. (The Cloudflare-for-SaaS hostname itself is
 * outside this store; unbinding it stays an operator act.)
 *
 * The marker is written first (r15: first after the lifetime's fence, below, and before `gen:` moves
 * or any body goes): the renderer only reads it when the card body is missing, so it is invisible
 * until the body goes, and a delete that dies halfway leaves a 410, never a resurrected card.
 * Returns whether there was a card to delete; a handle that never had one gets no marker, because a
 * 410 there would claim a card that never was.
 *
 * 🔴 Then the lifetime ends: a fresh generation in CardLifetime, and then in the `gen:<handle>` cache
 * (see genKey). From that put on, every write admitted before it — a save waiting on Web Risk, a body
 * or stop mid-put, a preview — lands on the old generation's keys, which nothing reads. Only DELETE
 * changes a generation, and only CardLifetime writes `gen:`.
 *
 * 🔴 And it writes it EVERY time (r4), whatever its reads saw. Any read here can be a stale view from
 * another location: a cached negative for `gen:` (codex r2 finding 4), for the body, the listing, the
 * marker — or, for a legacy handle, a current-format miss beside a bare body nobody reads outside
 * generation 0 (codex r3 finding 1). Each time rotation hung on "did I see a lifetime", some mixed view
 * made it skip, and a save admitted in the real lifetime landed live after convergence. Nothing read
 * decides it now (and since r8 the rotation is the object's, which reads nothing from KV). `deleted`
 * still reports what was found; the lifetime ends regardless. A DELETE on a handle that never had a
 * card costs one small `gen:` key and one object, and ends nothing anyone was served.
 */
async function deleteCard(env, handle, meant = null) {
  const store = env.CARDS;
  // 🔴 reef#2618 r4: `meant` is the generation the caller checked ownership in (If-Generation). r15: it
  // is checked ONCE, by /end in the object's own turn (the object is the generation's only writer), and
  // nothing here writes before that answer. Only reads come first; a refusal has written no key (codex
  // tile#207 r1 #1: r4 also read /current up front, then wrote the marker, then /end refused — a lifetime
  // that ended between those two checks got the marker anyway). A read is not a reservation.
  const { md, gen } = await liveCard(store, handle);
  // 🔴 Collect each whole listing BEFORE deleting: deleting under a live cursor shifts what the next
  // page starts from, and the keys it skips are exactly the ones this promised were gone.
  const listed = async (prefix, keep = () => true) => {
    const names = [];
    let cursor;
    do {
      const page = await store.list({ prefix, ...(cursor ? { cursor } : {}) });
      for (const k of page.keys) if (keep(k)) names.push(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return names;
  };
  // 🔴 Everything this deletes is listed BEFORE the rotation (r5, codex r4 finding 2). A key that
  // existed then was written under a generation read before this rotation, so the rotation ends it.
  // A key the next lifetime writes while this is still deleting is not in these lists, and nothing
  // after the rotation reads the store to decide what to delete. Previews are keyed by a random id, so
  // they are found by the handle in their metadata (one parked before that stamp has none and expires
  // within PREVIEW_TTL). The bare legacy body counts as found in any generation (only SERVED in 0).
  const [bodies, stops, bindings, inverses, drafts, marked, bare] = await Promise.all([
    listed(cardKey(handle, '')), listed(stopKey(handle, '')),
    listed(vanityBindPrefix(handle)), listed(vanityOfKey(handle, '')),
    listed(previewKey(''), (k) => k.metadata && k.metadata.handle === handle),
    store.get(goneKey(handle)).then((v) => v != null), store.get(legacyCardKey(handle)),
  ]);
  const had = md != null || bodies.length > 0 || bare != null;
  // 🔴 The lifetime ends in the handle's own object FIRST (r8, see CardLifetime): it rotates the
  // generation in its storage and only then answers with the hosts registered under the ended one —
  // the authoritative list, never a KV listing. Every host on it is told, and the KV side (the `gen:`
  // cache, the cleanup) waits until each has answered. An end that is not acknowledged fails the
  // DELETE with the lifetime already ended: the object keeps that host in `pending`, so a retry
  // (which rotates again, harmlessly) delivers it; until then KV still names the old generation, the
  // card still serves, and no bind of it can register.
  const ending = await askLifetime(env, handle, 'end', { handle, ...(meant != null ? { gen: meant } : {}) });
  if (ending.stale_generation) throw new StaleLifetime();
  const { ended, pending } = ending;
  // The marker is this DELETE's first write (r15: after the fence). It still precedes every key that
  // could make it visible: `gen:` moves at /settle and the body goes after that, so until both the card
  // still serves from KV, and a delete that dies after here leaves a 410, never a resurrected card.
  if (had && !marked) await store.put(goneKey(handle), JSON.stringify({ deleted_at: new Date().toISOString() }));
  const gensOf = new Map();
  for (const [g, hosts] of Object.entries(pending)) for (const h of hosts) gensOf.set(h, [...(gensOf.get(h) || []), g]);
  await Promise.all([...gensOf].map(([h, gens]) => endOnHost(env, handle, gens, h)));
  await askLifetime(env, handle, 'settle', { handle, delivered: pending });
  // every listed key, the read and the ended generation's body and stop even if the listing has not
  // caught up, every ended generation's binding keys the object named, and the legacy keys (read in
  // generation 0 only, which this handle has now left for good)
  const owed = Object.entries(pending).flatMap(([g, hosts]) => [vanityOfKey(handle, g), ...hosts.map((h) => vanityBindKey(handle, g, h))]);
  const doomed = new Set([
    ...bodies, ...stops, cardKey(handle, gen), stopKey(handle, gen), cardKey(handle, ended), stopKey(handle, ended),
    legacyCardKey(handle), legacyStopKey(handle), ...bindings, ...inverses, ...owed, legacyVanityOfKey(handle), ...drafts,
  ]);
  // 🔴 Not `vanity:<host>` from here: the object cleared it above if its owner was this lifetime; the
  // pointer is shared with whatever lifetime binds the host next, and is
  // inert without a binding of the current one (see vanityKey). Rebinding the host replaces it.
  for (const k of doomed) await store.delete(k);
  return had;
}

/**
 * handleApi: the `/_api/*` surface, or null when the request is not ours (the card renderer takes it).
 *
 * Routes:
 *   POST   /_api/cards                       list_cards    { handles: [...] } → summaries
 *   GET    /_api/card/<handle>               get_card      thin markdown + manifest + version
 *   GET    /_api/card/<handle>/full          —             full markdown for the owner
 *   GET    /_api/card/<handle>/lifetime      —             → { handle, gen }: the current generation (reef#2618 r4)
 *   PUT    /_api/card/<handle>               save_card     { markdown, base_version, dry_run }
 *   DELETE /_api/card/<handle>               delete_card   → { handle, deleted } (reef#2618)
 *          If-Generation: <gen> (optional)  412 `stale_generation` unless <gen> is the current one; nothing moves
 *   PUT    /_api/card/<handle>/stop          —             { reason? } → stop serving
 *   DELETE /_api/card/<handle>/stop          —             resume serving
 *   PUT    /_api/card/<handle>/asset/<id>    put_asset     { base64, mime }
 *   DELETE /_api/card/<handle>/asset/<id>    delete_asset  refuses while referenced
 *   POST   /_api/preview                     preview_card  { handle, markdown } → a URL
 *   GET    /_api/try/<id>                    —             a parked sandbox draft, as markdown
 */
export async function handleApi(request, env, url) {
  if (!url.pathname.startsWith(API_PREFIX)) return null;

  const denied = await authorize(request, env);
  if (denied) return denied;

  const store = env && env.CARDS;
  if (!store) return json({ error: 'card store not bound' }, 500);

  const rest = url.pathname.slice(API_PREFIX.length);
  const method = request.method.toUpperCase();

  // ── list_cards ─────────────────────────────────────────────────────────────────────────────────
  //
  // 🔴 The caller passes the handles. WHICH handles an account may see is the registry's question,
  // and answering it here would be that second authorisation path again. This endpoint's whole job is
  // "tell me about these", and it is a POST because the list is a body, not because it writes.
  if (rest === 'cards' && method === 'POST') {
    const body = (await readJson(request)) || {};
    const handles = Array.isArray(body.handles) ? body.handles.slice(0, 200) : [];
    const out = [];
    for (const h of handles) {
      const handle = String(h || '').trim().toLowerCase();
      if (!VALID_HANDLE.test(handle)) continue;
      const row = await readCard(store, handle);
      if (!row) continue;
      out.push({
        handle,
        title: /^title:\s*(.+)$/m.exec(row.md)?.[1]?.trim() || handle,
        version: row.version,
        bytes: row.md.length,
        assets: assetManifest(row.md).length,
      });
    }
    return json({ cards: out });
  }

  // ── preview_card ───────────────────────────────────────────────────────────────────────────────
  //
  // A draft parked under a random key with a TTL, rendered at /_preview/<id>. It is assembled the
  // same way a save is — stored assets re-attached — because a preview that showed the card WITHOUT
  // its pictures would be answering a different question than the one the agent asked.
  if (rest === 'preview' && method === 'POST') {
    const body = (await readJson(request)) || {};
    const handle = String(body.handle || '').trim().toLowerCase();
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(body.handle)}.` }, 400);
    if (typeof body.markdown !== 'string' || !body.markdown.length) return json({ error: 'preview needs `markdown`.' }, 400);
    const { md: currentMd, gen } = await liveCard(store, handle);
    const { md } = assembleSave(body.markdown, currentMd);
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    // The handle rides as METADATA so delete_card can find this draft from `list()` alone, without
    // reading a megabyte of someone's pictures per key to learn whose it was (reef#2618). The
    // generation rides with it (r3, see genKey): a preview whose put lands after the delete's sweep
    // carries a dead generation, so the renderer never shows it, and its TTL removes it. The stamp is
    // the protection; the re-read after the put only tells the caller.
    await store.put(previewKey(id), md, { expirationTtl: PREVIEW_TTL, metadata: { handle, gen } });
    if ((await generationOf(store, handle)) !== gen) return json(staleWrite(handle), 409);
    return json({
      url: `https://${url.host}/_preview/${id}`,
      expires_in_seconds: PREVIEW_TTL,
      note: 'Not indexed, not linked, and gone within the hour. It is not the card.',
    });
  }

  // ── the parked sandbox draft, read back ────────────────────────────────────────────────────────
  //
  // 🔴 READ ONLY, and bearer-gated like everything else under `/_api/`. The WRITE side is public
  // (`POST /try/park` in card-worker.mjs — a stranger's browser has no token and never will), so the
  // read has to be the guarded half: this is what feelreef's server calls, once, to pick the card up
  // and write it into the new handle. Not deleted on read — a retry after a failed signup must find
  // it still there, and the hour expires it either way.
  const parked = /^try\/(.+)$/.exec(rest);
  if (parked) {
    if (method !== 'GET') return json({ error: 'A parked draft is read-only.' }, 405);
    const id = decodeURIComponent(parked[1]);
    if (!TRY_ID_RE.test(id)) return json({ error: 'Bad draft id.' }, 400);
    const draft = await store.get(tryKey(id));
    if (draft == null) return json({ error: 'That draft has expired.' }, 404);
    return new Response(draft, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const asset = /^card\/([^/]+)\/asset\/([^/]+)$/.exec(rest);
  const card = /^card\/([^/]+)$/.exec(rest);
  const stop = /^card\/([^/]*)\/stop$/.exec(rest);
  const full = /^card\/([^/]*)\/full$/.exec(rest);
  const lifetime = /^card\/([^/]*)\/lifetime$/.exec(rest);

  // reef#2618 r4: the handle's current generation, from its CardLifetime (the authority, not the KV
  // cache). A caller reads it beside its ownership check and sends it back as DELETE's If-Generation.
  if (lifetime) {
    let handle;
    try { handle = decodeURIComponent(lifetime[1]).toLowerCase(); } catch { handle = ''; }
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(lifetime[1])}.` }, 400);
    if (method !== 'GET') return json({ error: `${method} not allowed here.` }, 405);
    const { gen } = await askLifetime(env, handle, 'current', { handle });
    return json({ handle, gen });
  }

  if (full) {
    let handle;
    try { handle = decodeURIComponent(full[1]).toLowerCase(); } catch { handle = ''; }
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(full[1])}.` }, 400);
    if (method !== 'GET') return json({ error: `${method} not allowed here.` }, 405);
    const { md } = await liveCard(store, handle);
    if (md == null) return json({ error: `No card at "${handle}".` }, 404);
    return new Response(md, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (stop) {
    let handle;
    try { handle = decodeURIComponent(stop[1]).toLowerCase(); } catch { handle = ''; }
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(stop[1])}.` }, 400);
    // A stop belongs to one lifetime, like the body (r3, see genKey): one admitted before a delete lands
    // on the deleted generation's key and cannot stop the next owner's card (codex r2 finding 3).
    const gen = await generationOf(store, handle);
    const key = stopKey(handle, gen);
    if (method === 'PUT') {
      const body = (await readJson(request)) || {};
      await store.put(key, JSON.stringify({
        stopped_at: new Date().toISOString(),
        reason: typeof body.reason === 'string' ? body.reason : '',
      }));
      if ((await generationOf(store, handle)) !== gen) return json(staleWrite(handle), 409);
      return json({ handle, stopped: true });
    }
    if (method === 'DELETE') {
      await store.delete(key);
      if (gen === GEN0) await store.delete(legacyStopKey(handle));
      return json({ handle, stopped: false });
    }
    return json({ error: `${method} not allowed here.` }, 405);
  }

  // ── put_asset / delete_asset ───────────────────────────────────────────────────────────────────
  if (asset) {
    const handle = decodeURIComponent(asset[1]).toLowerCase();
    const id = decodeURIComponent(asset[2]);
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(asset[1])}.` }, 400);
    if (!VALID_ASSET_ID.test(id)) return json({ error: `Bad asset id ${JSON.stringify(asset[2])}.` }, 400);
    const current = await readCard(store, handle);
    if (!current) return json({ error: `No card at "${handle}".` }, 404);
    const model = parseCard(current.md);

    if (method === 'PUT') {
      const body = (await readJson(request)) || {};
      const b64 = String(body.base64 || '').replace(/\s+/g, '');
      if (!b64) return json({ error: 'put_asset needs `base64`.' }, 400);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return json({ error: '`base64` is not base64.' }, 400);
      model.assets = { ...model.assets, [id]: { mime: String(body.mime || 'image/webp'), b64 } };
      const md = serializeCard(model);
      if (md.length > KV_MAX_BYTES) {
        return json({ error: `That would make the card ${md.length} bytes; the store's ceiling is ${KV_MAX_BYTES}.` }, 413);
      }
      const res = await writeCard(store, handle, md, current.gen);
      if (res.conflict) return json(res, 409);
      return json({ handle, id, bytes: Math.floor(b64.replace(/=+$/, '').length * 3 / 4), version: res.version });
    }

    if (method === 'DELETE') {
      // 🔴 Refuse while referenced. Deleting an asset a cell still points at does not error anywhere
      // — `resolveAsset` returns '' for an unresolvable ref, so the picture just silently becomes a
      // blank box on someone's live page. That is precisely the class of failure whose feedback
      // arrives too late to connect to the action that caused it.
      const referenced = referencedAssets(thinCard(current.md));
      if (referenced.has(id)) {
        return json({
          error: `"${id}" is still used by this card. Remove the reference first, then delete the asset.`,
          referenced: true,
        }, 409);
      }
      if (!(id in model.assets)) return json({ error: `No asset "${id}" on "${handle}".` }, 404);
      delete model.assets[id];
      const res = await writeCard(store, handle, serializeCard(model), current.gen);
      if (res.conflict) return json(res, 409);
      return json({ handle, id, deleted: true, version: res.version });
    }
    return json({ error: `${method} not allowed here.` }, 405);
  }

  if (card) {
    const handle = decodeURIComponent(card[1]).toLowerCase();
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(card[1])}.` }, 400);

    // ── get_card ─────────────────────────────────────────────────────────────────────────────────
    //
    // Thin by construction. `assets: "inline"` is NOT a parameter here: the fat bytes have explicit
    // exits (`/<handle>.md` publicly while serving, `/_api/card/<handle>/full` for the owner even while
    // stopped), and a backup over a forgotten flag is 99.7% missing on the heaviest real card.
    if (method === 'GET') {
      const row = await readCard(store, handle);
      if (!row) return json({ error: `No card at "${handle}".` }, 404);
      return json({
        handle,
        version: row.version,
        markdown: thinCard(row.md),
        assets: assetManifest(row.md),
        total_bytes: row.md.length,
      });
    }

    // ── save_card ────────────────────────────────────────────────────────────────────────────────
    if (method === 'PUT') {
      const body = (await readJson(request)) || {};
      if (typeof body.markdown !== 'string' || !body.markdown.length) {
        return json({ error: 'save_card needs `markdown` — refusing to write an empty card.' }, 400);
      }
      // the generation is captured HERE, at admission, before Web Risk's network wait (see writeCard)
      const live = await liveCard(store, handle);
      const current = live.md == null ? null : { md: live.md, version: await cardVersion(live.md) };

      // 🔴 The lock is checked BEFORE the assembly, so a conflicted save costs nothing and — more to
      // the point — cannot half-happen.
      const conflict = current
        ? await checkBaseVersion(body.base_version, current.md)
        : (body.base_version
          ? { conflict: true, expected: String(body.base_version), current: null, why: 'There is no card at this handle, so the version you read is not of this card.' }
          : null);
      if (conflict) return json(conflict, 409);

      const { md, orphans, diff, carried } = assembleSave(body.markdown, current && current.md);
      if (md.length > KV_MAX_BYTES) {
        return json({ error: `That would make the card ${md.length} bytes; the store's ceiling is ${KV_MAX_BYTES}.` }, 413);
      }
      const wouldChange = !current || md !== current.md;

      // 🔴 reef#2044 ②: refuse a save that links to a URL Google Web Risk lists. The destinations are
      // the RENDERER's output (card-destinations.mjs), never a markdown parse here — reef#2054 showed
      // a separate extractor drifts from what the visitor actually gets. Fail-open lives in url-risk.
      const dests = cardDestinations(md, { base: `${url.origin}/${handle}/` });
      const many = tooManyLinks(dests, env);
      if (many) return json(many, 422);
      const unsafe = await checkUrls(dests, env);
      if (unsafe) return json({ error: 'card_url_unsafe', url: unsafe.url, threat: unsafe.threat }, 422);

      if (body.dry_run) {
        return json({
          handle, dry_run: true, valid: true, wouldChange, diff, orphans, assets_carried: carried,
          message: wouldChange
            ? 'Validates — nothing written (dry_run). Call again without dry_run to save.'
            : 'Validates, but is identical to the current card — a real save would be a no-op.',
        });
      }

      const res = await writeCard(store, handle, md, live.gen);
      if (res.conflict) return json(res, 409);
      // the handle lives again: a deleted card's tombstone goes the moment a card is back under it
      // (after the write landed, so a failed save never un-says the old delete)
      // A read, not a blind delete: a read is the cheaper KV operation, and almost every create
      // finds no tombstone.
      if (!current && (await store.get(goneKey(handle))) != null) await store.delete(goneKey(handle));
      return json({
        handle,
        version: res.version,
        bytes: res.bytes,
        created: !current,
        wouldChange,
        diff,
        assets_carried: carried,
        // 🔴 REPORTED, never collected. An asset nobody references is not evidence that nobody wants
        // it — an author who just deleted a cell to rewrite it would find their picture gone by the
        // time they added it back. Removing bytes from a creator's file is their decision, and this
        // is how they get told there is one to make.
        orphans,
      });
    }

    // ── delete_card (reef#2618) ──────────────────────────────────────────────────────────────────
    if (method === 'DELETE') {
      let deleted;
      const meant = request.headers.get('if-generation');
      try { deleted = await deleteCard(env, handle, meant || null); } catch (e) {
        if (e instanceof StaleLifetime) {
          return json({ error: 'stale_generation', why: `"${handle}" is no longer in the lifetime this delete was checked against. Nothing was deleted.` }, 412);
        }
        if (!(e instanceof EndNotAcknowledged)) throw e;
        // the lifetime object or a host did not acknowledge: KV is untouched, the card is still live,
        // and a retry delivers what is still owed (see deleteCard)
        return json({ error: 'delete_failed', why: `"${handle}" was not deleted: its domain binding could not be ended. Try again.` }, 503);
      }
      return json({ handle, deleted });
    }
    return json({ error: `${method} not allowed here.` }, 405);
  }

  return json({ error: `No such endpoint: ${url.pathname}` }, 404);
}

export const _internal = { sha256Hex, timingSafeEqualHex, VALID_HANDLE, VALID_ASSET_ID };
