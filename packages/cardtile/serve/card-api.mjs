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
/** every generation there is: GEN0 or a `newGen` (r16: DELETE refuses any other If-Generation) */
const VALID_GEN = /^(?:0|[0-9a-f]{24})$/;
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
/**
 * run a card write alone among the card writes of its lifetime (tile#209): `step` answers
 * `{ status, body }`. One queue per GENERATION the writes were admitted in, apart from `tail`:
 *   · not `tail`: a card write awaits KV, and a write held there must not hold up the lifetime's own
 *     requests (DELETE's /end) — the generation stamp (see commitCard) is what keeps a write admitted
 *     before an end off the next lifetime, as it always was;
 *   · per generation: writes admitted in different lifetimes write different keys (`card:<h>:<gen>`)
 *     and cannot overwrite each other, so a dead lifetime's slow write never holds up the next owner's.
 */
function enqueueWrite(object, gen, step) {
  const turn = (object.writes.get(gen) || Promise.resolve()).then(step);
  const tail = turn.catch(() => {});
  object.writes.set(gen, tail);
  tail.then(() => { if (object.writes.get(gen) === tail) object.writes.delete(gen); });
  return turn;
}
function inWriteTurn(object, gen, step) {
  return enqueueWrite(object, gen, step).then(({ status, body }) => Response.json(body, { status }),
    () => Response.json({ error: 'store_failed', why: 'The card store failed during this write. Read the card again before retrying.' }, { status: 500 }));
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
 *
 * 🔴 tile#209 — and it holds the handle's CARD, and is where every write of it happens. KV has no
 * compare-and-set, so a read → modify → put from the Worker leaves a window in which another write to
 * the same card lands and is then overwritten (a same-id put_asset erased by a delete that had checked
 * the old bytes, a save assembled before a put_asset landed, two put_assets each dropping the other).
 * And KV is eventually consistent even where it was written (r2, codex r1 P1): serializing the writes
 * here but READING the card from KV let a stale body pass the version check, and the fence then
 * acknowledged deleting the replacement it exists to protect. So:
 *   · the card body of the current generation lives in this object's storage — the WHOLE card, not a
 *     version or a manifest, because the writes need the bytes (a delete writes the card minus one
 *     asset, a save re-attaches the stored assets lane) and a version alone could only refuse a stale
 *     KV read, never write past it. Storage key `card:<gen>` = { gen, serial, n, version, cache }, and
 *     the body in `n` chunks `card:<gen>:<serial>:<i>` of CARD_CHUNK code units (keepCard says why
 *     that size; a 25 MiB card is 100 chunks). A write puts its chunks under a new serial, then the
 *     `card:<gen>` record — that put IS the write — then deletes the old serial's chunks;
 *   · every write reads, checks and writes THAT, one at a time per handle and lifetime (`writes`, one
 *     queue per generation, apart from the lifetime's — inWriteTurn), then writes KV through from it
 *     (rule B: a failed KV put leaves `cache: 'pending'`, retried by the alarm). Pages and get_card read
 *     KV, which converges; the version the fence and base_version compare against is never a KV read;
 *   · 🔴 first contact (migration): a generation this object holds no card for takes it from KV ONCE,
 *     and keeps it ADOPTED — unconfirmed — until its alarm settles it (heldCard, settleCard). While
 *     adopted, every write is refused with a retry. A KV miss is not kept (a create writes the record);
 *   · the lifetime ending (/end) removes the ended generation's card from storage: nothing is kept.
 *   POST /save     { handle, gen, markdown, base?, from, dests, destBase }
 *                                        base given → checked against the card held here (409, nothing
 *                                        written); the save is assembled HERE on the stored assets lane;
 *                                        if the card is not the one the Worker assembled and checked
 *                                        (`from`), its destinations must still be `dests` (Web Risk's)
 *   POST /asset    { handle, gen?, kind: put | delete | fenced, id, b64?, mime?, ifVersion? }
 *                                        the If-Version check (fenced), the reference check and the
 *                                        removal or replacement, against the card held here; `gen` absent
 *                                        → the current generation (this object is its authority)
 * An empty object is generation 0: `gen:` keys exist only since this PR, which ships this class, so no
 * handle was ever rotated anywhere else. Its lifetime state never comes from KV.
 */
export class CardLifetime {
  constructor(state, env) {
    this.storage = state && state.storage; this.env = env;
    this.tail = Promise.resolve(); this.writes = new Map(); // gen → the tail of that lifetime's card writes
  }
  async fetch(request) {
    const op = new URL(request.url).pathname;
    const body = (await request.json().catch(() => null)) || {};
    if (op === '/save' || op === '/asset') {
      if (!cardWriteOk(op, body)) return Response.json({ error: 'bad_request' }, { status: 400 });
      if (!this.storage) return Response.json({ error: 'no_storage' }, { status: 500 });
      // an asset write is the current lifetime's; the queue's generation is read here, and checked
      // again inside the turn (a delete may end it in between)
      const gen = body.gen != null ? body.gen : (await this.read(body.handle)).gen;
      const fence = op === '/asset' && body.kind === 'fenced' ? { fence: 'if-version' } : {};
      return inWriteTurn(this, gen, () => (op === '/save' ? this.saveCard({ ...body, gen }) : this.assetWrite({ ...body, gen }))
        .catch((e) => { if (e instanceof EndedDuringWrite) return { status: 409, body: { ...staleWrite(body.handle), ...fence } }; throw e; }));
    }
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
  async alarm() {
    await inTurn(this, async () => { const s = await this.storage.get('life'); if (s && s.handle) await this.flush(s); return {}; });
    // tile#209 r2: the card's own write-through, in its generation's write queue
    const gen = ((await this.storage.get('life')) || {}).gen || GEN0;
    await enqueueWrite(this, gen, async () => { await this.flushCard(gen); await this.settleCard(gen); }).catch(() => {});
  }
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
    s.cardless = s.gen; // r5: a generation this object starts has no card it did not write (cardOf)
    await this.storage.put('life', s); // the lifetime ends HERE, before any host is told
    // tile#209 r2/r3: the ended lifetime's card is not kept here either — EVERY card key of every
    // generation but the new one, by prefix: chunks no record names (a write that failed or crashed
    // between its chunks and its record) are private bytes too
    await this.sweepCards((g) => g === s.gen);
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

  // ── the card (tile#209 r2): held here, written here, written through to KV ─────────────────────

  /** how long KV may answer stale, even where it was written: the first-contact window (r3, r4) */
  static KV_WINDOW_MS = 60000;
  /**
   * r5 (codex r4 P2): the delays after a settlement read that failed or found nothing, and so the cap
   * (its length: the read after the last delay is the last chance — 16 min 15 s after adoption). Past the cap an adopted card settles from its last positive
   * read, and an unknown one keeps refusing at the last delay — each time with a structured log line.
   */
  static SETTLE_BACKOFF_MS = [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000];

  /**
   * the card of `gen` as this object holds it:
   *   { md, version, meta }  held (written here, or adopted from a positive KV read);
   *   { unknown: true, meta } r5 (codex r4 P1): KV answered a MISS at first contact. A miss is not
   *                           "no card" — negative answers are cached too — so it is kept as unknown,
   *                           refused like an adopted card, and settled only by a positive read;
   *   null                    no card, KNOWN: this generation was started by this object (/end), so
   *                           no card can be in it that the object did not write.
   */
  async cardOf(handle, gen) {
    const meta = await this.storage.get(cardMetaKey(gen));
    if (meta && meta.from === 'unknown') return { unknown: true, meta };
    if (meta) {
      const parts = [];
      for (let i = 0; i < meta.n; i++) parts.push(await this.storage.get(cardChunkKey(gen, meta.serial, i)));
      if (parts.some((p) => typeof p !== 'string')) throw new Error(`card:${gen} is missing a chunk`);
      return { md: parts.join(''), version: meta.version, meta };
    }
    // 🔴 migration: nothing held for this generation yet. A positive KV answer is kept ADOPTED
    // (`from: 'kv'`), unconfirmed until the alarm armed here settles it (settleCard).
    if ((await this.read(handle)).cardless === gen) return null;
    const { md } = await liveCard(this.env.CARDS, handle, { gen });
    if (md != null) return this.adoptCard(handle, gen, md, null);
    const unknown = { handle, gen, serial: 0, n: 0, version: null, from: 'unknown', settleAt: Date.now() + CardLifetime.KV_WINDOW_MS, attempts: 0 };
    if ((await this.read(handle)).gen !== gen) throw new EndedDuringWrite();
    await this.storage.put(cardMetaKey(gen), unknown);
    await this.armAlarm(unknown.settleAt);
    return { unknown: true, meta: unknown };
  }
  /** keep a KV body as the ADOPTED card of `gen`, and arm the alarm that will try to settle it */
  async adoptCard(handle, gen, md, prev) {
    const version = await cardVersion(md);
    const settleAt = Date.now() + CardLifetime.KV_WINDOW_MS;
    const kept = await this.keepCard(handle, gen, md, version, 'written', prev, { from: 'kv', settleAt, attempts: 0 });
    await this.armAlarm(settleAt);
    return { md, version, meta: kept };
  }
  /** set the object's alarm for `t` unless one is already due sooner (the write-through retry shares it) */
  async armAlarm(t) {
    if (!this.storage || typeof this.storage.setAlarm !== 'function') return;
    const due = typeof this.storage.getAlarm === 'function' ? await this.storage.getAlarm() : null;
    if (due == null || t < due) await this.storage.setAlarm(t);
  }
  /**
   * 🔴 r3/r4/r5 (codex r2, r3, r4): the card every WRITE starts from. A card adopted from KV at first
   * contact may itself be a stale KV answer, and a miss may be a cached negative — any write made on
   * either could put stale bytes (or an empty assets lane) over newer ones. So while it is ADOPTED or
   * UNKNOWN, every write is refused (`unsettled`: the seconds to retry after), uniformly: put_asset,
   * both deletes, save. Nothing here ends that: only the alarm does (settleCard). A write does repair
   * a missing alarm (r5: one consumed without a replacement must not leave it retrying forever).
   */
  async heldCard(handle, gen) {
    const cur = await this.cardOf(handle, gen);
    if (!cur || (cur.meta.from !== 'kv' && cur.meta.from !== 'unknown')) return cur;
    if (typeof this.storage.getAlarm === 'function' && (await this.storage.getAlarm()) == null) {
      await this.armAlarm(Math.max(cur.meta.settleAt, Date.now() + 1000));
    }
    return { ...cur, unsettled: Math.max(1, Math.ceil((cur.meta.settleAt - Date.now()) / 1000)) };
  }
  /**
   * the alarm's half of first contact (r4, codex r3 P2; r5, codex r4). The card leaves the window when
   *   (a) the alarm has fired at or after `settleAt` — an alarm that fires sooner (the write-through
   *       retry shares it) re-arms and does nothing else; and
   *   (b) KV, re-read then, answers POSITIVELY: exactly the held card → settled; a different body (or
   *       any body, for an unknown card) → adopted, and the window starts again.
   * A read that fails or finds nothing is retried after SETTLE_BACKOFF_MS; past the cap an adopted card
   * settles from its last positive read (the held one) and an unknown card keeps refusing at the last
   * delay — each with a structured log line (no alerting exists; the line is what an operator can see).
   * Not on a write's clock: a forward wall-clock jump can at most bring the alarm early, and (b) must
   * still hold. The residual: a KV that answers the same stale body for the whole window, twice.
   */
  async settleCard(gen) {
    const meta = await this.storage.get(cardMetaKey(gen));
    if (!meta || (meta.from !== 'kv' && meta.from !== 'unknown') || (await this.read(meta.handle)).gen !== gen) return;
    if (Date.now() < meta.settleAt) { await this.armAlarm(meta.settleAt); return; }
    let md = null, reason = 'miss';
    try { ({ md } = await liveCard(this.env.CARDS, meta.handle, { gen })); } catch { md = null; reason = 'read_failed'; }
    if (md != null) {
      const version = await cardVersion(md);
      if (meta.from === 'kv' && version === meta.version) {
        await this.storage.put(cardMetaKey(gen), { ...meta, from: 'kv-settled', attempts: 0 });
        return;
      }
      await this.adoptCard(meta.handle, gen, md, meta);
      return;
    }
    const backoff = CardLifetime.SETTLE_BACKOFF_MS;
    const attempts = (meta.attempts || 0) + 1;
    const line = (event) => console.error(JSON.stringify({ event, handle: meta.handle, gen, attempts, reason, held: meta.from }));
    // r6 (codex r5 P3): the cap is reached only once EVERY delay has been waited, the last one too
    if (attempts > backoff.length && meta.from === 'kv') {
      await this.storage.put(cardMetaKey(gen), { ...meta, from: 'kv-settled', attempts });
      line('card_settled_from_last_positive');
      return;
    }
    if (attempts > backoff.length) line('card_settlement_stuck');
    const settleAt = Date.now() + backoff[Math.min(attempts, backoff.length) - 1];
    await this.storage.put(cardMetaKey(gen), { ...meta, attempts, settleAt });
    await this.armAlarm(settleAt);
  }
  /**
   * put a body under a fresh serial, then the record that points at it (the write), then sweep every
   * key of this generation the record does not name. 🔴 r3: a write that fails partway sweeps its own
   * chunks before it fails, and the success sweep also takes whatever an earlier crash left in this
   * generation (any serial); ended generations are /end's to sweep (r4: never another generation's).
   */
  async keepCard(handle, gen, md, version, cache, prev, provenance = { from: 'object' }) {
    // A chunk is CARD_CHUNK UTF-16 code units: at most 3 bytes of UTF-8 each, so ≤ 768 KiB a value —
    // under the SQLite-backed storage's per-value limit (this class is `new_sqlite_classes`,
    // wrangler.example.toml) with room to spare — and KV_MAX_BYTES (25 MiB) is at most 100 chunks.
    // (A local, not a module constant: the /try/edit bundle carries this module's top-level values.)
    const CARD_CHUNK = 256 * 1024;
    const serial = (prev ? prev.serial : 0) + 1;
    const n = Math.max(1, Math.ceil(md.length / CARD_CHUNK));
    const meta = { handle, gen, serial, n, version, cache, ...provenance };
    try {
      for (let i = 0; i < n; i++) await this.storage.put(cardChunkKey(gen, serial, i), md.slice(i * CARD_CHUNK, (i + 1) * CARD_CHUNK));
      await this.storage.put(cardMetaKey(gen), meta);
    } catch (e) {
      // its own generation's chunks only, but the record and the serial it names (r4)
      await this.sweepCards((g, sl) => g !== gen || sl === null || (prev != null && sl === prev.serial)).catch(() => {});
      throw e;
    }
    // 🔴 r4 (codex r3 P1): a write sweeps ITS OWN generation only, and only once it has checked that
    // generation is still the current one. Per-generation queues let an ended lifetime's write run
    // beside the next lifetime's; a sweep from the dead one must never reach the live one's keys.
    if ((await this.read(handle)).gen !== gen) {
      await this.sweepCards((g) => g !== gen);
      throw new EndedDuringWrite();
    }
    await this.sweepCards((g, sl) => g !== gen || sl === null || sl === serial);
    return meta;
  }
  /** delete every `card:` key `keep(gen, serial | null for a record)` does not keep — by prefix, so it
   *  finds what no record names */
  async sweepCards(keep) {
    const listed = await this.storage.list({ prefix: 'card:' });
    for (const k of listed.keys()) {
      const [, g, sl] = k.split(':');
      if (!keep(g, sl === undefined ? null : Number(sl))) await this.storage.delete(k);
    }
  }
  /** the KV copy of the held card, for the pages; a failure stays `pending` for the alarm */
  async writeThrough(handle, gen, md, meta) {
    try { await this.env.CARDS.put(cardKey(handle, gen), md); } catch { await retryLater(this.storage); return 'pending'; }
    const now = await this.storage.get(cardMetaKey(gen));
    if (now && now.serial === meta.serial && now.cache !== 'written') { now.cache = 'written'; await this.storage.put(cardMetaKey(gen), now); }
    return 'written';
  }
  async flushCard(gen) {
    const meta = await this.storage.get(cardMetaKey(gen));
    if (!meta || meta.cache !== 'pending' || (await this.read(meta.handle)).gen !== gen) return;
    const held = await this.cardOf(meta.handle, gen);
    await this.writeThrough(meta.handle, gen, held.md, held.meta);
  }
  /**
   * write `md` as the card of `gen`: here first (the write), then KV. A lifetime that ended before or
   * during the write gets `stale_generation`, and nothing of it is kept here; what reached KV is under
   * the dead generation's key, which nothing serves (see genKey).
   */
  async commitCard(handle, gen, md, prev) {
    const version = await cardVersion(md);
    if ((await this.read(handle)).gen !== gen) return staleWrite(handle);
    // 🔴 r3: KV's ceiling is in BYTES; a card it cannot hold is never acknowledged (callers refuse it
    // first with 413 — this is the last line, so nothing unservable is ever kept here)
    if (utf8Bytes(md) > KV_MAX_BYTES) throw new Error('commitCard: a card over the KV byte ceiling reached the commit');
    const meta = await this.keepCard(handle, gen, md, version, 'pending', prev && prev.meta);
    if ((await this.read(handle)).gen !== gen) { await this.sweepCards((g) => g !== gen); return staleWrite(handle); }
    const cache = await this.writeThrough(handle, gen, md, meta);
    if ((await this.read(handle)).gen !== gen) return staleWrite(handle);
    return { version, bytes: md.length, ...(cache === 'pending' ? { cache: 'pending' } : {}) };
  }
  /**
   * save_card's write. base_version is checked against the card held here (the Worker's check at
   * admission ran on a KV read, before Web Risk's wait). The save is assembled HERE, on the stored
   * assets lane — that is what a save means (assembleSave), and the Worker's assembly was on KV's.
   * If the card held here is not the one the Worker assembled (`from`), the result's destinations must
   * be the ones Web Risk checked, or the save is refused.
   */
  async saveCard({ handle, gen, markdown, base, from, dests, destBase, check, create }) {
    if ((await this.read(handle)).gen !== gen) return { status: 409, body: staleWrite(handle) };
    let cur = await this.heldCard(handle, gen);
    // r5/r6: `create: true` is the caller's word that this handle has never had a card — the one thing
    // besides a positive read that lets a write past an UNKNOWN (a miss is not proof). 🔴 r6 (codex r5
    // P1): it can never erase a card. It is refused, as a conflict naming the card, when
    //   · the object holds one (written here, adopted, or settled);
    //   · the Worker's own read saw one (`from`) — a positive answer anywhere vetoes a create;
    //   · this object's OWN KV read, made here in this queue slot, finds one — which is adopted.
    // Only when all three find nothing is the card written, in this same slot (no write between).
    if (create === true) {
      const exists = (current) => ({ status: 409, body: { conflict: true, expected: null, current,
        why: 'This handle already has a card, so this is not a create. Read it and save with its version.' } });
      if (cur && !cur.unknown) return exists(cur.version);
      if (from != null) return exists(from);
      const { md: seen } = await liveCard(this.env.CARDS, handle, { gen });
      if (seen != null) return exists((await this.adoptCard(handle, gen, seen, cur ? cur.meta : null)).version);
      cur = null;
    }
    if (cur && cur.unsettled) return { status: 409, body: windowRefusal(cur.unsettled, 'Nothing was saved') };
    if (base != null && base !== '') {
      const conflict = cur == null
        ? { conflict: true, expected: String(base), current: null, why: 'There is no card at this handle, so the version you read is not of this card.' }
        : await checkBaseVersion(base, cur.md);
      if (conflict) return { status: 409, body: conflict };
    }
    const { md, orphans, diff, carried } = assembleSave(markdown, cur && cur.md);
    const bytes = utf8Bytes(md);
    if (bytes > KV_MAX_BYTES) {
      return { status: 413, body: { error: `That would make the card ${bytes} bytes; the store's ceiling is ${KV_MAX_BYTES}.` } };
    }
    const wouldChange = !cur || md !== cur.md;
    // r3 (codex r2 P2): the Worker's preliminary check — the lock, the size, the structural answer a
    // dry run gives — is THIS, against the held card, so a current base_version is never vetoed by a
    // stale KV read. Nothing is written (a first contact may adopt; that is not a change of the card).
    if (check) return { status: 200, body: { checked: true, version: cur ? cur.version : null, wouldChange, diff, orphans, carried } };
    if ((cur ? cur.version : null) !== from) {
      const now = cardDestinations(md, { base: destBase });
      if (now.length !== dests.length || now.some((u) => !dests.includes(u))) {
        return { status: 409, body: { conflict: true, expected: from, current: cur ? cur.version : null,
          why: 'The card changed while this save was being checked, and the change alters what it links to. Read the card again and save.' } };
      }
    }
    const res = await this.commitCard(handle, gen, md, cur);
    if (res.conflict) return { status: 409, body: res };
    return { status: 200, body: { ...res, created: !cur, wouldChange, diff, orphans, carried } };
  }
  /**
   * put_asset, delete_asset and the fenced delete, against the card held here: every check against
   * it, then the write, with no other write of this card between them.
   *
   * 🔴 The fenced delete (tile#209, reef#2600 door 3) refuses unless the card held here is still at
   * `ifVersion`, the version the caller read. The version covers the asset bytes (it is the full
   * markdown's), so a same-id replacement after that read moves it. Every answer it gives carries
   * `fence: "if-version"`: reef reads a 404 without it as "this Worker has no fenced route".
   */
  async assetWrite({ handle, gen, kind, id, b64, mime, ifVersion }) {
    const fence = kind === 'fenced' ? { fence: 'if-version' } : {};
    if ((await this.read(handle)).gen !== gen) return { status: 409, body: { ...staleWrite(handle), ...fence } };
    const cur = await this.heldCard(handle, gen);
    if (!cur) return { status: 404, body: { error: `No card at "${handle}".`, ...fence } };
    // 🔴 r4/r5 (codex r3, r4): uniformly, no write on an adopted or unknown card — see heldCard
    if (cur.unsettled && kind !== 'put') return { status: 409, body: { ...windowRefusal(cur.unsettled, 'Nothing was deleted'), ...fence } };
    if (cur.unsettled && kind === 'put') {
      if (!b64) return { status: 400, body: { error: 'put_asset needs `base64`.' } };
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { status: 400, body: { error: '`base64` is not base64.' } };
      return { status: 409, body: windowRefusal(cur.unsettled, 'Nothing was stored') };
    }
    if (kind === 'fenced') {
      const conflict = await checkBaseVersion(ifVersion, cur.md);
      if (conflict) return { status: 409, body: { ...conflict, why: `${conflict.why} Nothing was deleted.`, ...fence } };
    }
    const model = parseCard(cur.md);
    if (kind === 'put') {
      // the caller's input, checked after the card as it always was (a missing card is a 404 first)
      if (!b64) return { status: 400, body: { error: 'put_asset needs `base64`.' } };
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { status: 400, body: { error: '`base64` is not base64.' } };
      model.assets = { ...model.assets, [id]: { mime, b64 } };
      const md = serializeCard(model);
      const bytes = utf8Bytes(md);
      if (bytes > KV_MAX_BYTES) {
        return { status: 413, body: { error: `That would make the card ${bytes} bytes; the store's ceiling is ${KV_MAX_BYTES}.` } };
      }
      const res = await this.commitCard(handle, gen, md, cur);
      if (res.conflict) return { status: 409, body: res };
      return { status: 200, body: { handle, id, bytes: Math.floor(b64.replace(/=+$/, '').length * 3 / 4), version: res.version } };
    }
    // 🔴 Refuse while referenced. Deleting an asset a cell still points at does not error anywhere
    // — `resolveAsset` returns '' for an unresolvable ref, so the picture just silently becomes a
    // blank box on someone's live page. That is precisely the class of failure whose feedback
    // arrives too late to connect to the action that caused it.
    if (referencedAssets(thinCard(cur.md)).has(id)) {
      return { status: 409, body: {
        error: `"${id}" is still used by this card. Remove the reference first, then delete the asset.`,
        referenced: true, ...fence,
      } };
    }
    if (!(id in model.assets)) return { status: 404, body: { error: `No asset "${id}" on "${handle}".`, ...fence } };
    delete model.assets[id];
    const res = await this.commitCard(handle, gen, serializeCard(model), cur);
    if (res.conflict) return { status: 409, body: { ...res, ...fence } };
    return { status: 200, body: { handle, id, deleted: true, version: res.version, ...(kind === 'fenced' ? { checked_version: ifVersion } : {}) } };
  }
}

/** a write whose lifetime ended while it was writing: answered `stale_generation`, nothing of it kept */
class EndedDuringWrite extends Error {}
/**
 * the refusal of a write on a card the object adopted from KV and has not settled (r3/r4). Not a
 * `conflict` (reef reads that as "the card moved"): an `error` with `retry` and when.
 */
const windowRefusal = (seconds, nothing) => ({
  error: `This card was only just taken over from the store, and its contents cannot be confirmed for another ${seconds} s. ${nothing}; try again then.`,
  retry: true, retry_after_seconds: seconds,
});
const cardMetaKey = (gen) => `card:${gen}`;
const cardChunkKey = (gen, serial, i) => `card:${gen}:${serial}:${i}`;

/**
 * the UTF-8 byte length of a string, without encoding it. 🔴 r3 (codex r2 P1): KV's 25 MiB ceiling is
 * in bytes, and `md.length` counts UTF-16 code units — a card of CJK text is up to 3× larger than it
 * looks. A lone surrogate is 3 bytes (TextEncoder writes it as U+FFFD). Exact whenever the string
 * could exceed the ceiling; below a third of it, where it cannot, the code-unit count stands in.
 */
function utf8Bytes(str) {
  if (str.length * 3 <= KV_MAX_BYTES) return str.length;
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length && (str.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** a well-formed /save or /asset request to CardLifetime (the Worker validated the caller's input) */
function cardWriteOk(op, b) {
  const str = (v) => typeof v === 'string' && v.length > 0;
  if (!VALID_HANDLE.test(String(b.handle)) || !(b.gen == null || str(b.gen))) return false;
  if (op === '/save') {
    if (!(str(b.gen) && str(b.markdown) && (b.base == null || typeof b.base === 'string') && (b.create == null || typeof b.create === 'boolean'))) return false;
    if (b.check === true) return b.from == null || str(b.from);
    return (b.from === null || str(b.from)) && Array.isArray(b.dests) && b.dests.every((u) => typeof u === 'string') && str(b.destBase);
  }
  if (!['put', 'delete', 'fenced'].includes(b.kind) || !VALID_ASSET_ID.test(String(b.id))) return false;
  if (b.kind === 'put') return typeof b.b64 === 'string' && str(b.mime);
  if (b.kind === 'fenced') return str(b.ifVersion) && b.ifVersion.trim().length > 0;
  return true;
}

/**
 * a card write, sent to the handle's CardLifetime (its write queue) and answered as it answers. No
 * fallback to writing from here: the queue is what makes the check and the put one step (tile#209).
 */
async function cardWrite(env, handle, op, body, extra = {}) {
  let res;
  try {
    res = await lifetimeOf(env, handle).fetch(`https://card-lifetime/${op}`, { method: 'POST', body: JSON.stringify({ handle, ...body }) });
  } catch (e) {
    if (e && /is not bound/.test(e.message)) throw e;
    return json({ error: 'write_failed', why: `"${handle}" was not written: its write queue did not answer. Read the card again before retrying.`, ...extra }, 503);
  }
  const answer = await res.json().catch(() => ({ error: 'write_failed', why: 'The write queue answered without a body. Read the card again before retrying.' }));
  // `extra` (the fenced route's `fence`) marks every refusal, the queue's own included; a success
  // answers exactly what the queue said
  return json(res.ok ? answer : { ...answer, ...extra }, res.status);
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

// 🩸 `writeCard` (write + read back + assert, carried over from reef's card-store.js) is gone since
// tile#209 r2. Its premise was that KV is the card's truth, so the version handed back had to be read
// from what LANDED, not what was held. KV is not the truth any more: the handle's CardLifetime holds
// the card (commitCard), and the version it answers is that record's. A KV read-back proves nothing
// about a store that may answer stale even where it was written, and under a stale read it turned a
// landed write into "not confirmed" — while the bytes it had overwritten were already gone. The
// admitted-generation rule it carried (reef#2618 r3) lives on in commitCard: the key is the admitted
// generation's, a save never writes `gen:`, and an ended lifetime is answered `stale_generation`.

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
 *   PUT    /_api/card/<handle>               save_card     { markdown, base_version, dry_run, create }
 *          create: true (tile#209 r5) — the registry's word that the handle has never had a card; the
 *                  only way past a first-contact KV miss besides the object's alarm finding the card
 *   DELETE /_api/card/<handle>               delete_card   → { handle, deleted } (reef#2618)
 *          If-Generation: <gen> (optional)  412 `stale_generation` unless <gen> is the current one; nothing moves
 *   PUT    /_api/card/<handle>/stop          —             { reason? } → stop serving
 *   DELETE /_api/card/<handle>/stop          —             resume serving
 *   PUT    /_api/card/<handle>/asset/<id>    put_asset     { base64, mime }
 *   DELETE /_api/card/<handle>/asset/<id>    delete_asset  refuses while referenced
 *   DELETE /_api/card/<handle>/asset/<id>/fenced
 *          If-Version: <version> (required) delete_asset with expected_version (tile#209): 409 unless the
 *                                           card is still at <version>; every answer carries `fence`
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
  const fenced = /^card\/([^/]+)\/asset\/([^/]+)\/fenced$/.exec(rest);
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

  // ── the fenced delete_asset (tile#209, reef#2600 door 3) ───────────────────────────────────────
  //
  // DELETE with `If-Version: <the version get_card gave>`: removed only if the card is still at that
  // version, checked against the card the handle's object holds and removed in one step of its write
  // queue (CardLifetime.assetWrite) — never against a KV read (r2). Every answer
  // carries `fence: "if-version"`, so the caller can tell this route's 404 from "no such route".
  if (fenced) {
    const fence = { fence: 'if-version' };
    let handle, id;
    try { handle = decodeURIComponent(fenced[1]).toLowerCase(); id = decodeURIComponent(fenced[2]); } catch { handle = ''; id = ''; }
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(fenced[1])}.`, ...fence }, 400);
    if (!VALID_ASSET_ID.test(id)) return json({ error: `Bad asset id ${JSON.stringify(fenced[2])}.`, ...fence }, 400);
    if (method !== 'DELETE') return json({ error: `${method} not allowed here; the fenced route only deletes.`, ...fence }, 405);
    const ifVersion = request.headers.get('if-version');
    if (ifVersion == null || !ifVersion.trim()) {
      return json({ error: 'The fenced delete needs an If-Version header: the version get_card returned. Nothing was deleted.', ...fence }, 400);
    }
    return cardWrite(env, handle, 'asset', { kind: 'fenced', id, ifVersion }, fence);
  }

  // ── put_asset / delete_asset ───────────────────────────────────────────────────────────────────
  //
  // The read, the checks and the put run in the handle's object, against the card it holds (tile#209,
  // see CardLifetime.assetWrite); only the path is checked here. The answers are what they were.
  if (asset) {
    const handle = decodeURIComponent(asset[1]).toLowerCase();
    const id = decodeURIComponent(asset[2]);
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(asset[1])}.` }, 400);
    if (!VALID_ASSET_ID.test(id)) return json({ error: `Bad asset id ${JSON.stringify(asset[2])}.` }, 400);

    if (method === 'PUT') {
      const body = (await readJson(request)) || {};
      const b64 = String(body.base64 || '').replace(/\s+/g, '');
      // the card (404), then the base64 (400), in that order as before — both in the object, which
      // holds the card (tile#209 r2): a KV read here could be a stale miss for a card that exists
      return cardWrite(env, handle, 'asset', { kind: 'put', id, b64, mime: String(body.mime || 'image/webp') });
    }
    if (method === 'DELETE') return cardWrite(env, handle, 'asset', { kind: 'delete', id });
    if (!(await readCard(store, handle))) return json({ error: `No card at "${handle}".` }, 404);
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
      // the generation is captured HERE, at admission, before Web Risk's network wait (see commitCard)
      const live = await liveCard(store, handle);
      const current = live.md == null ? null : { md: live.md, version: await cardVersion(live.md) };
      const base = body.base_version == null ? null : String(body.base_version);

      // 🔴 The lock is checked BEFORE Web Risk, so a conflicted save costs nothing and — more to the
      // point — cannot half-happen. r3 (codex r2 P2): it is checked by the handle's object, against
      // the card IT holds, never against this KV read — which may be stale, and must not veto a
      // current base_version. The same call answers the size (in bytes) and the structural diff.
      const create = body.create === true;
      const pre = await cardWrite(env, handle, 'save', { gen: live.gen, markdown: body.markdown, base, create, check: true, from: current ? current.version : null });
      const checked = await pre.json();
      if (pre.status !== 200) return json(checked, pre.status);

      // 🔴 reef#2044 ②: refuse a save that links to a URL Google Web Risk lists. The destinations are
      // the RENDERER's output (card-destinations.mjs), never a markdown parse here — reef#2054 showed
      // a separate extractor drifts from what the visitor actually gets. Fail-open lives in url-risk.
      // (Assembled on this KV read; the object checks it still links the same way if its card differs.)
      const { md } = assembleSave(body.markdown, current && current.md);
      const dests = cardDestinations(md, { base: `${url.origin}/${handle}/` });
      const many = tooManyLinks(dests, env);
      if (many) return json(many, 422);
      const unsafe = await checkUrls(dests, env);
      if (unsafe) return json({ error: 'card_url_unsafe', url: unsafe.url, threat: unsafe.threat }, 422);

      if (body.dry_run) {
        return json({
          handle, dry_run: true, valid: true, wouldChange: checked.wouldChange, diff: checked.diff, orphans: checked.orphans,
          assets_carried: checked.carried,
          message: checked.wouldChange
            ? 'Validates — nothing written (dry_run). Call again without dry_run to save.'
            : 'Validates, but is identical to the current card — a real save would be a no-op.',
        });
      }

      // 🔴 tile#209: the write happens in the handle's object, against the card IT holds (r2: never a
      // KV read). It checks base_version again and assembles the save again on the stored assets lane:
      // everything above ran on a KV read, before Web Risk's wait, and a put_asset that landed since —
      // or one KV has not caught up on — would otherwise be erased by a save that "passed" its lock.
      // `from` and `dests` let it tell whether what it writes is still what Web Risk checked.
      const written = await cardWrite(env, handle, 'save', {
        gen: live.gen, markdown: body.markdown, base, create,
        from: current ? current.version : null, dests, destBase: `${url.origin}/${handle}/`,
      });
      const res = await written.json();
      if (written.status !== 200) return json(res, written.status);
      // the handle lives again: a deleted card's tombstone goes the moment a card is back under it
      // (after the write landed, so a failed save never un-says the old delete)
      // A read, not a blind delete: a read is the cheaper KV operation, and almost every create
      // finds no tombstone.
      if (res.created && (await store.get(goneKey(handle))) != null) await store.delete(goneKey(handle));
      return json({
        handle,
        version: res.version,
        bytes: res.bytes,
        created: res.created,
        wouldChange: res.wouldChange,
        diff: res.diff,
        assets_carried: res.carried,
        ...(res.cache ? { cache: res.cache } : {}),
        // 🔴 REPORTED, never collected. An asset nobody references is not evidence that nobody wants
        // it — an author who just deleted a cell to rewrite it would find their picture gone by the
        // time they added it back. Removing bytes from a creator's file is their decision, and this
        // is how they get told there is one to make.
        orphans: res.orphans,
      });
    }

    // ── delete_card (reef#2618) ──────────────────────────────────────────────────────────────────
    if (method === 'DELETE') {
      let deleted;
      // 🔴 r16 (codex r2 #1): only an ABSENT header is the unfenced legacy path. A header that is
      // present must be a generation — `0` or what `newGen` makes — or nothing is touched: HEAD's
      // `meant || null` read an empty value as "no header" and rotated whatever lifetime was current.
      const meant = request.headers.get('if-generation');
      if (meant != null && !VALID_GEN.test(meant)) {
        return json({ error: 'bad_generation', why: `If-Generation must be the "gen" GET /_api/card/${handle}/lifetime returned (or be left out). Nothing was deleted.` }, 400);
      }
      try { deleted = await deleteCard(env, handle, meant); } catch (e) {
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
