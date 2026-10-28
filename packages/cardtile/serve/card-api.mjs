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
 * first lifetime, generation `0`. Only DELETE writes it. The lifetime is part of every key a write
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
 * DELETE never touches the pointer (see deleteCard).
 *
 * The pointer is written LAST, and only if the handle's generation is still the admitted one. That
 * re-read matters only when the domain has moved to ANOTHER handle meanwhile (a's bind, admitted before
 * a was deleted, must not point the domain back at a after it was bound to b).
 *
 * 🔴 One writer per host (codex r5): the re-read and the put are one step, run by HostBindings, the
 * Durable Object named by the host, one at a time. In r5 they ran in the caller: a's put, held after a
 * re-read that still saw a's lifetime, landed after b's bind and the domain went 404 for good (and
 * card.feelreef.com/b kept 301ing into it). KV has no compare-and-swap, so a check beside the put cannot
 * close that; only nobody else writing `vanity:<host>` meanwhile can. The keys before the pointer
 * belong to one lifetime and are written by the caller, as in r5. The same-handle races above do not
 * depend on the object.
 *
 * Migration: bindings made before generations are `vanity:<host>` → handle and bare `vanityof:<handle>`
 * → host. They are generation 0's: in generation 0 the pointer alone is a binding and the bare inverse
 * is read as `vanityof:<handle>:0` (the same fallback as a legacy body). A handle in generation 0 has
 * never been deleted, so no ended lifetime can have made its pointer. After its first DELETE neither is
 * honoured again.
 *
 * bindVanity(env, …) is the one way to make a binding: it needs `env.CARDS` and `env.HOST_BINDINGS`.
 * A `redirect: false` binding writes no `vanityof:` (the canonical address keeps serving). Returns
 * `stale_generation` when the handle's lifetime ended while it ran: its keys are dead and the pointer
 * was not written.
 */
export const vanityKey = (host) => `vanity:${host}`;
const vanityBindPrefix = (handle) => `vanitybind:${handle}:`;
export const vanityBindKey = (handle, gen, host) => `${vanityBindPrefix(handle)}${gen}:${host}`;
export const vanityOfKey = (handle, gen) => `vanityof:${handle}:${gen}`;
/** LEGACY inverse binding, read for generation 0 only. */
const legacyVanityOfKey = (handle) => `vanityof:${handle}`;
export async function bindVanity(env, handle, host, { redirect = true } = {}) {
  const store = env.CARDS, writer = hostWriter(env, host);
  const gen = await generationOf(store, handle);
  await store.put(vanityBindKey(handle, gen, host), handle);
  if (redirect) await store.put(vanityOfKey(handle, gen), host);
  const pointed = await writer.fetch('https://host-bindings/point', {
    method: 'POST', body: JSON.stringify({ handle, gen, host }),
  });
  if (!pointed.ok) throw new Error(`HostBindings answered ${pointed.status} for ${host}`);
  return { handle, host, gen, ...(await pointed.json()) };
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

/**
 * HostBindings — the Durable Object that writes `vanity:<host>` (one object per host, reef#2618 r6).
 *
 * It holds no state of its own: KV stays the truth and readers stay on KV. What it adds is ORDER. A
 * Durable Object lets a second request in while the first awaits anything outside it (a KV get or put
 * is outside), so the order is this object's own queue: each request's re-read and put finish before
 * the next one's re-read starts. Then a bind admitted in an ended lifetime either re-reads after the
 * DELETE (stale, nothing written) or lands its put before the next bind's, which replaces it.
 *
 * Why not keep the pointer in the object's storage with KV as a cache: that is a second copy, and
 * the cache writes would need the same ordering anyway. Here there is one copy and one queue.
 */
export class HostBindings {
  constructor(state, env) { this.env = env; this.tail = Promise.resolve(); }
  async fetch(request) {
    const { handle, gen, host } = await request.json();
    if (!VALID_HANDLE.test(String(handle)) || typeof gen !== 'string' || typeof host !== 'string' || !host) {
      return Response.json({ error: 'bad_request' }, { status: 400 });
    }
    const turn = this.tail.then(() => pointHost(this.env.CARDS, handle, gen, host));
    this.tail = turn.catch(() => {}); // a failed write must not wedge the host
    try { return Response.json(await turn); } catch (e) { return Response.json({ error: 'store_failed' }, { status: 500 }); }
  }
}

/** the pointer step. Run ONLY inside HostBindings' queue. */
async function pointHost(store, handle, gen, host) {
  if ((await generationOf(store, handle)) !== gen) return staleWrite(handle);
  await store.put(vanityKey(host), handle);
  return {};
}

/** a key, or for generation 0 the legacy key when the new one is absent. */
async function readGen(store, key, legacy, gen) {
  const [v, old] = await Promise.all([store.get(key), gen === GEN0 ? store.get(legacy) : null]);
  return v != null ? v : (old != null ? old : null);
}

/** is `host` bound to `handle` in generation `gen`? In generation 0 the pointer alone is (see vanityKey). */
export const isBound = async (store, handle, gen, host) =>
  gen === GEN0 || (await store.get(vanityBindKey(handle, gen, host))) != null;
/** the host generation `gen` of `handle` redirects to, or null */
export const boundHostOf = (store, handle, gen) => readGen(store, vanityOfKey(handle, gen), legacyVanityOfKey(handle), gen);

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
 * chodaict ruled on reef#2618: the owner downloads first, types the handle, and NOTHING is kept — the
 * handle is free at once. So this removes the card, its serving stop, every parked preview of it, and
 * its own-domain binding; then leaves `gone:<handle>` = `{ deleted_at }` so the public address answers
 * 410 instead of an ordinary 404. The tombstone does not reserve the handle: the next save clears it.
 *
 * 🔴 The domain binding goes too: its keys are the ended lifetime's (see vanityKey), so the next owner
 * of this handle is neither 301'd to the previous owner's domain nor served on it. The shared
 * `vanity:<host>` pointer stays, inert. (The Cloudflare-for-SaaS hostname itself is outside this
 * store; unbinding it stays an operator act.)
 *
 * The marker is written FIRST: the renderer only reads it when the card body is missing, so it is
 * invisible until the body goes, and a delete that dies halfway leaves a 410, never a resurrected card.
 * Returns whether there was a card to delete; a handle that never had one gets no marker, because a
 * 410 there would claim a card that never was.
 *
 * 🔴 Then the lifetime ends: a fresh `gen:<handle>` (see genKey). From that put on, every write
 * admitted before it — a save waiting on Web Risk, a body or stop mid-put, a preview — lands on the
 * old generation's keys, which nothing reads. DELETE is the ONLY writer of `gen:`.
 *
 * 🔴 And it writes it EVERY time (r4), whatever its reads saw. Any read here can be a stale view from
 * another location: a cached negative for `gen:` (codex r2 finding 4), for the body, the listing, the
 * marker — or, for a legacy handle, a current-format miss beside a bare body nobody reads outside
 * generation 0 (codex r3 finding 1). Each time rotation hung on "did I see a lifetime", some mixed view
 * made it skip, and a save admitted in the real lifetime landed live after convergence. Nothing read
 * decides it now. `deleted` still reports what was found; the lifetime ends regardless. A DELETE on a
 * handle that never had a card costs one small `gen:` key and ends nothing anyone was served.
 */
async function deleteCard(store, handle) {
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
  if (had && !marked) await store.put(goneKey(handle), JSON.stringify({ deleted_at: new Date().toISOString() }));
  await store.put(genKey(handle), newGen());
  // every listed key, the read generation's body and stop even if the listing has not caught up, and
  // the legacy keys (read in generation 0 only, which this handle has now left for good)
  const doomed = new Set([
    ...bodies, ...stops, cardKey(handle, gen), stopKey(handle, gen), legacyCardKey(handle), legacyStopKey(handle),
    ...bindings, ...inverses, legacyVanityOfKey(handle), ...drafts,
  ]);
  // 🔴 Not `vanity:<host>`: that pointer is shared with whatever lifetime binds the host next, and is
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
 *   PUT    /_api/card/<handle>               save_card     { markdown, base_version, dry_run }
 *   DELETE /_api/card/<handle>               delete_card   → { handle, deleted } (reef#2618)
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
    if (method === 'DELETE') return json({ handle, deleted: await deleteCard(store, handle) });
    return json({ error: `${method} not allowed here.` }, 405);
  }

  return json({ error: `No such endpoint: ${url.pathname}` }, 404);
}

export const _internal = { sha256Hex, timingSafeEqualHex, VALID_HANDLE, VALID_ASSET_ID };
