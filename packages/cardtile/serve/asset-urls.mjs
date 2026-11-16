// tile#339 — a Cards page's pictures at their own content-addressed URLs.
//
// 🩸 WHY. `resolveAsset` (card-render.mjs) wrote every `asset:<id>` as a `data:` URI, so the served HTML
// was mostly image bytes: on a live page measured 2026-11-16, 1,155,772 of 1,226,852 bytes (94%) were
// eight base64 pictures. The page is cached for 60 s, so a returning visitor fetched the same ~1.2 MB
// again a minute later, `loading="lazy"` did nothing (the bytes came with the document), and first paint
// on a phone waited for all of it. Now the page names each picture by a URL whose path IS its bytes'
// SHA-256, and that URL answers with `immutable` and a year of cache.
//
// 🔴 The URL is the hash of the BYTES, never the asset id. An id is only usually a hash (assets/embed.mjs
// mints `sha256-<16 hex>`); an author may name their own, and `put_asset` under an existing id replaces
// its bytes. An immutable cache keyed by the id would go on serving the old picture.
//
// 🔴 What stays a data: URI (the renderer's default, untouched):
//   · any type outside RASTER — above all image/svg+xml. An SVG served from the Cards origin is a
//     document that can run script; inside <img>/url() as data: it cannot (reef#2214,
//     card-svg-asset-2214.test.mjs). This route never serves one.
//   · a picture of INLINE_MAX_BYTES or less: a request costs about as much as the bytes, and a mark
//     that small should paint with the text it sits beside.
//   · base64 that does not decode: broken either way, and a URL for it could only 404.
// Every render that is not the served page (the editor, /_preview/<id>, the save-time destination render)
// passes no `assetUrls`, so it is byte-identical to what it was.
//
// Pure apart from crypto.subtle (no store, no clock): the Worker hashes before the synchronous render.

/** the stored types this route serves, and the one extension each is spelled with in a URL */
export const RASTER_EXT = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
});
/** decoded bytes at or under which a picture stays inline */
export const INLINE_MAX_BYTES = 1024;
/** a year, and never revalidated: the path is the content */
export const ASSET_CACHE = 'public, max-age=31536000, immutable';
/** `/a/<64 lower-case hex>.<ext>` — the tail of an asset URL after the card's own base */
export const ASSET_TAIL_RE = /^\/a\/([0-9a-f]{64})\.(png|jpg|webp|gif|avif)$/;
// the reference form the renderer honours (card-render ASSET_RE, card-save ASSET_REF_RE); base64 has no
// colon, so an asset lane row (`asset id=…`) is never read as one. An id outside this alphabet stays inline.
const ASSET_REF_RE = /asset:([A-Za-z0-9_.\-]+)/g;

const typeOf = (a) => String((a && a.mime) || '').trim().toLowerCase();

/** an asset's bytes when it is one this route may serve (raster, decodable), else null */
function rasterBytes(a) {
  if (!a || !RASTER_EXT[typeOf(a)] || !a.b64) return null;
  // atob IS the validator: it skips ASCII whitespace and throws on anything that is not base64
  // (a strip + regex pass first cost more than the decode, measured)
  let bin;
  try { bin = atob(String(a.b64)); } catch { return null; }
  // a plain loop: `Uint8Array.from(bin, mapper)` cost ~12 ms per 140 KB picture (measured, Node 22) —
  // a page render's whole budget for eight of them
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** an upper bound on the decoded length, from the base64 text's length alone (whitespace counted) */
const decodedLengthAtMost = (a) => Math.floor(String((a && a.b64) || '').length * 3 / 4);
const hexOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * assetUrls(cardMd, assets, base) → { [id]: `${base}a/<sha256>.<ext>` } for every picture the card text
 * references that is served by URL. `base` ends in `/`: `/<handle>/` on a shared host, `/` on the card's
 * own domain. An asset left out of the map is inlined by the renderer as before.
 */
export async function assetUrls(cardMd, assets, base) {
  const refs = new Set([...String(cardMd || '').matchAll(ASSET_REF_RE)].map((m) => m[1]));
  const out = {};
  await Promise.all([...refs].map(async (id) => {
    const a = assets && Object.prototype.hasOwnProperty.call(assets, id) ? assets[id] : null;
    // the cheap bound first, so a glyph is never decoded; then the exact length
    if (!a || decodedLengthAtMost(a) <= INLINE_MAX_BYTES) return;
    const bytes = rasterBytes(a);
    if (bytes && bytes.length > INLINE_MAX_BYTES) out[id] = `${base}a/${await hexOf(bytes)}.${RASTER_EXT[typeOf(a)]}`;
  }));
  return out;
}

/**
 * findAsset(assets, hex, ext) → { type, bytes } for the card's raster picture whose SHA-256 is `hex` and
 * whose stored type is spelled `ext`, else null. One whose id names the hash's prefix (the ingest's
 * `sha256-<16 hex>`) is tried first, so the usual cost is one digest. Size does not matter here: every
 * asset in the lane is already public through the full markdown exit.
 */
export async function findAsset(assets, hex, ext) {
  const ids = Object.keys(assets || {}).filter((id) => RASTER_EXT[typeOf(assets[id])] === ext);
  const named = (id) => /^sha256-[0-9a-f]{8,64}$/.test(id) && hex.startsWith(id.slice(7));
  ids.sort((x, y) => Number(named(y)) - Number(named(x)));
  for (const id of ids) {
    const bytes = rasterBytes(assets[id]);
    if (bytes && (await hexOf(bytes)) === hex) return { type: typeOf(assets[id]), bytes };
  }
  return null;
}
