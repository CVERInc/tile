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
 * A handle's lifetime (reef#2618 r2). `gen:<handle>` holds a random nonce; DELETE and the save that
 * creates a card again each write a new one. Everything written for a handle — the card body, a
 * parked preview — carries the generation it was admitted under, in its KV metadata, and anything
 * whose generation is not the current one is ABSENT to every reader.
 *
 * 🔴 Why not a lock: KV has no compare-and-swap, so a write that passed its checks before a delete can
 * still land after it. That cannot be prevented here, only made harmless: it lands tagged with a dead
 * generation and is never served, and the next delete removes it. A card written before generations
 * existed has no tag and no `gen:` key, and null === null keeps it live.
 */
export const genKey = (handle) => `gen:${handle}`;
const newGen = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
/** does a stored row's metadata belong to the handle's current lifetime? */
export const isCurrentGen = (metadata, gen) => ((metadata && metadata.gen) || null) === (gen || null);

/**
 * liveCard: the card body under a handle, or null when there is none OR it was written in a lifetime
 * that has since been deleted. The ONE read every exit uses — renderer and API alike — so a stale
 * body cannot be absent on one door and present on another.
 */
export async function liveCard(store, handle) {
  const [row, gen] = await Promise.all([store.getWithMetadata(handle), store.get(genKey(handle))]);
  const md = row && row.value;
  if (md === null || md === undefined) return { md: null, gen };
  return isCurrentGen(row.metadata, gen) ? { md, gen } : { md: null, gen, stale: true };
}

/** the answer to a write whose lifetime ended while it was in flight. Nothing it wrote is served. */
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

/** the generation as it stands NOW, for a write's before/after check. */
const currentGen = async (store, handle) => (await store.get(genKey(handle))) || null;

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
// 🔴 And every write carries the generation it was ADMITTED under (reef#2618 r2, see genKey). The
// generation is checked again just before the put — a write whose lifetime ended while it waited on
// Web Risk writes nothing, so the next owner's card stays as it is — and once more after it, because
// between those two reads a delete can still land: then the body is tagged dead, is never served, and
// the caller is told so instead of "saved". `create` starts a new lifetime: the card was absent.
async function writeCard(store, handle, md, admitted, { create = false } = {}) {
  if ((await currentGen(store, handle)) !== (admitted || null)) return staleWrite(handle);
  let gen = admitted || null;
  if (create) {
    gen = newGen();
    await store.put(genKey(handle), gen);
  }
  await store.put(handle, md, { metadata: { gen } });
  const stored = await store.get(handle);
  if (stored !== md) {
    return {
      conflict: true,
      expected: await cardVersion(md),
      current: stored == null ? null : await cardVersion(stored),
      why: 'The store did not read back what was written. Nothing has been confirmed; do not treat this as saved.',
    };
  }
  if ((await currentGen(store, handle)) !== gen) return staleWrite(handle);
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
 * 🔴 The domain binding goes too. Left behind, `vanityof:<handle>` would 301 whoever creates this
 * handle next to the previous owner's domain, and that domain would serve the new stranger's card.
 * (The Cloudflare-for-SaaS hostname itself is outside this store; unbinding it stays an operator act.)
 *
 * The marker is written FIRST: the renderer only reads it when the card body is missing, so it is
 * invisible until the body goes, and a delete that dies halfway leaves a 410, never a resurrected card.
 * Returns whether there was a card to delete; a handle that never had one gets no marker, because a
 * 410 there would claim a card that never was.
 *
 * 🔴 Then the lifetime ends: a new `gen:<handle>` (see genKey), written only when a live card was here.
 * From that put on, every write admitted before it — a save waiting on Web Risk, a preview mid-put —
 * either refuses or lands tagged dead and unserved. A body from a dead lifetime is removed here like
 * any other, but it does not count as "had": it was never the card.
 */
async function deleteCard(store, handle) {
  const had = (await liveCard(store, handle)).md != null;
  const marked = (await store.get(goneKey(handle))) != null;
  if (had && !marked) await store.put(goneKey(handle), JSON.stringify({ deleted_at: new Date().toISOString() }));
  if (had) await store.put(genKey(handle), newGen());
  await store.delete(handle);
  await store.delete(`stop:${handle}`);

  const host = await store.get(`vanityof:${handle}`);
  if (host != null) {
    // only the forward binding that still points HERE — a domain since re-bound elsewhere is not ours
    if ((await store.get(`vanity:${host}`)) === handle) await store.delete(`vanity:${host}`);
    await store.delete(`vanityof:${handle}`);
  }

  // Previews are keyed by a random id, so they are found by the handle stamped in their metadata.
  // A preview parked before that stamp existed has none and expires within PREVIEW_TTL on its own.
  // 🔴 Collect the whole listing BEFORE deleting: deleting under a live cursor shifts what the next
  // page starts from, and the drafts it skips are exactly the ones this promised were gone.
  const drafts = [];
  let cursor;
  do {
    const page = await store.list({ prefix: previewKey(''), ...(cursor ? { cursor } : {}) });
    for (const k of page.keys) if (k.metadata && k.metadata.handle === handle) drafts.push(k.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  for (const name of drafts) await store.delete(name);
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
    // generation rides with it: a preview whose put lands after the delete's sweep is never shown,
    // and this request removes it itself once it sees the lifetime ended (r2, see genKey).
    if ((await currentGen(store, handle)) !== (gen || null)) return json(staleWrite(handle), 409);
    await store.put(previewKey(id), md, { expirationTtl: PREVIEW_TTL, metadata: { handle, gen: gen || null } });
    if ((await currentGen(store, handle)) !== (gen || null)) {
      await store.delete(previewKey(id));
      return json(staleWrite(handle), 409);
    }
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
    const key = `stop:${handle}`;
    if (method === 'PUT') {
      const body = (await readJson(request)) || {};
      await store.put(key, JSON.stringify({
        stopped_at: new Date().toISOString(),
        reason: typeof body.reason === 'string' ? body.reason : '',
      }));
      return json({ handle, stopped: true });
    }
    if (method === 'DELETE') {
      await store.delete(key);
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

      const res = await writeCard(store, handle, md, live.gen, { create: !current });
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
