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
import { assembleSave, thinCard, assetManifest, cardVersion, checkBaseVersion, referencedAssets } from '../card-save.mjs';
import { handleVanity } from './card-vanity.mjs';

const API_PREFIX = '/_api/';

/** the same grammar the store keys on: a handle IS the KV key and the URL path segment. */
export const VALID_HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** asset ids are content-addressed (`sha256-…`) but authors may name their own; keep it URL-safe. */
const VALID_ASSET_ID = /^[A-Za-z0-9_.\-]{1,128}$/;

/** KV's per-value ceiling. Hitting it should read as a sentence, not as a store exception. */
const KV_MAX_BYTES = 25 * 1024 * 1024;

/** A preview is a look at an unsaved draft, not a publication. One hour is longer than any edit. */
export const PREVIEW_TTL = 3600;

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

/**
 * A path segment, percent-decoded — or null when its escapes are broken (`%`, `%zz`, a cut UTF-8
 * sequence), where decodeURIComponent would throw URIError out of the Worker. Callers answer
 * 400 {error: "bad_path_encoding"}. (The vanity routes fold the same failure into handle_invalid.)
 */
const decodeSegment = (seg) => {
  try { return decodeURIComponent(seg); } catch { return null; }
};
const badPathEncoding = () => json({ error: 'bad_path_encoding' }, 400);

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

/** get: handle → { md, version } | null. Null is "no such card", never an error. */
async function readCard(store, handle) {
  const md = await store.get(handle);
  if (md === null || md === undefined) return null;
  return { md, version: await cardVersion(md) };
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
async function writeCard(store, handle, md) {
  await store.put(handle, md);
  const stored = await store.get(handle);
  if (stored !== md) {
    return {
      conflict: true,
      expected: await cardVersion(md),
      current: stored == null ? null : await cardVersion(stored),
      why: 'The store did not read back what was written. Nothing has been confirmed; do not treat this as saved.',
    };
  }
  return { version: await cardVersion(md), bytes: md.length };
}

/**
 * handleApi: the `/_api/*` surface, or null when the request is not ours (the card renderer takes it).
 *
 * Routes — one per OPS entry in ai-ops.mjs, and no more:
 *   POST   /_api/cards                       list_cards    { handles: [...] } → summaries
 *   GET    /_api/card/<handle>               get_card      thin markdown + manifest + version
 *   PUT    /_api/card/<handle>               save_card     { markdown, base_version, dry_run }
 *   PUT    /_api/card/<handle>/asset/<id>    put_asset     { base64, mime }
 *   DELETE /_api/card/<handle>/asset/<id>    delete_asset  refuses while referenced
 *   POST   /_api/preview                     preview_card  { handle, markdown } → a URL
 *   GET    /_api/try/<id>                    —             a parked sandbox draft, as markdown
 *   GET    /_api/vanity/<handle>             —             { host|null, redirect } — the card's own domain
 *   PUT    /_api/vanity/<handle>             —             { host, redirect?, expect? } → bind it (card-vanity.mjs)
 *   DELETE /_api/vanity/<handle>             —             { expect? } → unbind it
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
      // 🔴 typeof first: String(x) calls x.toString, and JSON can deliver `{"toString":null}`, which
      // makes String() throw. A non-string entry is skipped, like any other entry that is not a
      // handle — this endpoint has always answered for the valid part of a list rather than failing it.
      if (typeof h !== 'string') continue;
      const handle = h.trim().toLowerCase();
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
    const handle = typeof body.handle === 'string' ? body.handle.trim().toLowerCase() : '';
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(body.handle)}.` }, 400);
    if (typeof body.markdown !== 'string' || !body.markdown.length) return json({ error: 'preview needs `markdown`.' }, 400);
    const current = await readCard(store, handle);
    const { md } = assembleSave(body.markdown, current && current.md);
    const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await store.put(previewKey(id), md, { expirationTtl: PREVIEW_TTL });
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
    const id = decodeSegment(parked[1]);
    if (id === null) return badPathEncoding();
    if (!TRY_ID_RE.test(id)) return json({ error: 'Bad draft id.' }, 400);
    const draft = await store.get(tryKey(id));
    if (draft == null) return json({ error: 'That draft has expired.' }, 404);
    return new Response(draft, {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  // ── vanity bindings: a creator's own domain ────────────────────────────────────────────────────
  //
  // Same bearer, same handle grammar; the keys and their write order live in card-vanity.mjs. Error
  // bodies here are CODES (`{error: "vanity_taken"}`), not sentences, because the caller is a tool that
  // turns them into the owner's language — that is the contract the MCP side was written against.
  const vanity = /^vanity\/([^/]+)$/.exec(rest);
  if (vanity) {
    let handle = null;
    try { handle = decodeURIComponent(vanity[1]).toLowerCase(); } catch { handle = null; }
    if (!handle || !VALID_HANDLE.test(handle)) return json({ error: 'handle_invalid' }, 400);
    const r = await handleVanity({ method, handle, store, readJson: () => readJson(request) });
    return json(r.body, r.status);
  }

  const asset = /^card\/([^/]+)\/asset\/([^/]+)$/.exec(rest);
  const card = /^card\/([^/]+)$/.exec(rest);

  // ── put_asset / delete_asset ───────────────────────────────────────────────────────────────────
  if (asset) {
    const rawHandle = decodeSegment(asset[1]);
    const id = decodeSegment(asset[2]);
    if (rawHandle === null || id === null) return badPathEncoding();
    const handle = rawHandle.toLowerCase();
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(asset[1])}.` }, 400);
    if (!VALID_ASSET_ID.test(id)) return json({ error: `Bad asset id ${JSON.stringify(asset[2])}.` }, 400);
    const current = await readCard(store, handle);
    if (!current) return json({ error: `No card at "${handle}".` }, 404);
    const model = parseCard(current.md);

    if (method === 'PUT') {
      const body = (await readJson(request)) || {};
      // typeof, never String(): see list_cards. A present but non-string value is refused, not coerced.
      if (body.base64 != null && typeof body.base64 !== 'string') return json({ error: '`base64` is not base64.' }, 400);
      if (body.mime != null && typeof body.mime !== 'string') return json({ error: '`mime` must be a string.' }, 400);
      const b64 = (body.base64 || '').replace(/\s+/g, '');
      if (!b64) return json({ error: 'put_asset needs `base64`.' }, 400);
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return json({ error: '`base64` is not base64.' }, 400);
      model.assets = { ...model.assets, [id]: { mime: body.mime || 'image/webp', b64 } };
      const md = serializeCard(model);
      if (md.length > KV_MAX_BYTES) {
        return json({ error: `That would make the card ${md.length} bytes; the store's ceiling is ${KV_MAX_BYTES}.` }, 413);
      }
      const res = await writeCard(store, handle, md);
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
      const res = await writeCard(store, handle, serializeCard(model));
      if (res.conflict) return json(res, 409);
      return json({ handle, id, deleted: true, version: res.version });
    }
    return json({ error: `${method} not allowed here.` }, 405);
  }

  if (card) {
    const rawHandle = decodeSegment(card[1]);
    if (rawHandle === null) return badPathEncoding();
    const handle = rawHandle.toLowerCase();
    if (!VALID_HANDLE.test(handle)) return json({ error: `Bad handle ${JSON.stringify(card[1])}.` }, 400);

    // ── get_card ─────────────────────────────────────────────────────────────────────────────────
    //
    // Thin by construction. `assets: "inline"` is NOT a parameter here: the fat bytes already have
    // their own exit (`/<handle>.md`, unauthenticated, because a card is public), and a backup taken
    // over a flag somebody forgot to pass is 99.7% missing on the heaviest real card.
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
      // typeof, never String(): see list_cards. checkBaseVersion stringifies what it is given.
      if (body.base_version != null && body.base_version !== '' && typeof body.base_version !== 'string') {
        return json({ error: '`base_version` must be a string — the version you read.' }, 400);
      }
      const current = await readCard(store, handle);

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

      if (body.dry_run) {
        return json({
          handle, dry_run: true, valid: true, wouldChange, diff, orphans, assets_carried: carried,
          message: wouldChange
            ? 'Validates — nothing written (dry_run). Call again without dry_run to save.'
            : 'Validates, but is identical to the current card — a real save would be a no-op.',
        });
      }

      const res = await writeCard(store, handle, md);
      if (res.conflict) return json(res, 409);
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
    return json({ error: `${method} not allowed here.` }, 405);
  }

  return json({ error: `No such endpoint: ${url.pathname}` }, 404);
}

export const _internal = { sha256Hex, timingSafeEqualHex, VALID_HANDLE, VALID_ASSET_ID };
