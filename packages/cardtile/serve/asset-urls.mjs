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
  return Object.fromEntries([...(await servedPictures(cardMd, assets, base))].map(([id, p]) => [id, p.url]));
}

/**
 * servedPictures(cardMd, assets, base) → Map id → { url, bytes, hex, ext }, in the order the card text first names
 * each picture (the frontmatter's backdrop first, then the cells as written), for every picture assetUrls
 * would serve by URL.
 */
async function servedPictures(cardMd, assets, base) {
  const refs = [...new Set([...String(cardMd || '').matchAll(ASSET_REF_RE)].map((m) => m[1]))];
  const found = await Promise.all(refs.map(async (id) => {
    const a = assets && Object.prototype.hasOwnProperty.call(assets, id) ? assets[id] : null;
    // the cheap bound first, so a glyph is never decoded; then the exact length
    if (!a || decodedLengthAtMost(a) <= INLINE_MAX_BYTES) return null;
    const bytes = rasterBytes(a);
    if (!bytes || bytes.length <= INLINE_MAX_BYTES) return null;
    const hex = await hexOf(bytes);
    const ext = RASTER_EXT[typeOf(a)];
    return [id, { url: `${base}a/${hex}.${ext}`, bytes, hex, ext }];
  }));
  return new Map(found.filter(Boolean));
}

// ── tile#339 MEASUREMENT PROTOTYPE: the local switch ──────────────────────────────────────────────────
//
// 🔴 Nothing here is a decision. The owner chose inline pictures on purpose (fewer requests, for the
// fastest page), so by-URL is measured against that goal before anything ships. `CARDTILE_PICTURES` is
// read from the cardtile worker's env, never from a request, and is set nowhere in this repository: unset
// or unknown means 'inline', the page as it was byte for byte, and `…/a/<sha256>.<ext>` answers as any
// unknown path did. The measurement and its numbers: docs/experiments/cards-pictures-2026-11/.
//
//   inline                       every picture a data: URI (today)
//   url                          every picture (assetUrls decides which) by its own URL; markup unchanged
//   hybrid-<first>-<rest>        the first FIRST_SCREEN_PICTURES pictures the text names are
//                                  inline   — left as data: URIs, or
//                                  preload  — by URL, with <link rel=preload fetchpriority=high> in <head>;
//                                the rest by URL with their box reserved from the stored bytes' own width
//                                and height (no layout shift), loading
//                                  lazy        — as the markup says (loading="lazy"), or
//                                  after-paint — switched to eager one frame after DOMContentLoaded
export const PICTURE_STRATEGIES = Object.freeze([
  'inline', 'url',
  'hybrid-inline-lazy', 'hybrid-inline-after-paint', 'hybrid-preload-lazy', 'hybrid-preload-after-paint',
]);
/** the switch's value for this env: one of PICTURE_STRATEGIES, 'inline' when unset or unknown */
export const pictureStrategy = (env) => {
  const v = String((env && env.CARDTILE_PICTURES) || '').trim();
  return PICTURE_STRATEGIES.includes(v) ? v : 'inline';
};
/**
 * How many pictures, in the order the text names them, count as the first screen. Measured on the
 * specimens at 390×844 (the README): the default view (stack) and list show one picture, the avatar card;
 * the wall shows the avatar, the first full-width picture and two more whole, two more in part. Two —
 * the avatar and the card a first swipe reveals — is what every view shows or shows next.
 */
export const FIRST_SCREEN_PICTURES = 2;

/**
 * pictureSize(bytes) → [width, height] read off the file's own header (PNG, GIF, WebP, JPEG), or null.
 * No decoding; a header that does not parse is null, and that picture gets no reserved box.
 * 🔴 Known gaps: AVIF (its size is in an `ispe` box deep in the container) and a JPEG whose EXIF
 * orientation turns it — the reserved box is then the stored ratio, not the shown one.
 */
export function pictureSize(b) {
  if (!b || b.length < 30) return null;
  const be16 = (i) => (b[i] << 8) | b[i + 1];
  const le16 = (i) => b[i] | (b[i + 1] << 8);
  const ok = (w, h) => (w > 0 && h > 0 ? [w, h] : null);
  if (b[0] === 0x89 && b[1] === 0x50 && b[12] === 0x49 && b[13] === 0x48 && b[14] === 0x44 && b[15] === 0x52) {
    return ok(((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0);
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(le16(6), le16(8));
  const tag = (i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const kind = tag(12);
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return ok(le16(26) & 0x3fff, le16(28) & 0x3fff);
    if (kind === 'VP8L' && b[20] === 0x2f) {
      return ok(1 + (le16(21) & 0x3fff), 1 + (((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10))));
    }
    if (kind === 'VP8X') return ok(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)));
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i += 1; continue; }                                   // fill byte
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }       // no length
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(be16(i + 7), be16(i + 5));
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

// a URL this module wrote: safe inside a quoted CSS attribute selector and a JS string as it stands
const PLAIN_PATH = /^\/[A-Za-z0-9._\-/]*$/;

/**
 * picturePlan(cardMd, assets, base, strategy) → what the renderer is handed for one page:
 *   { assetUrls: { [id]: url }, pictures: { preload: [url], reserve: [[url, w, h]], afterPaint: prefix } | undefined,
 *     served: [{ hex, ext, bytes }] }
 * 'inline' → { assetUrls: undefined, pictures: undefined }: the renderer's own default, untouched.
 * `served` is every picture this page names by URL, decoded and hashed already (the plan needed both):
 * what the cardtile worker hands its picture cache, so the visitor's picture requests find them there.
 */
export async function picturePlan(cardMd, assets, base, strategy) {
  if (!PICTURE_STRATEGIES.includes(strategy) || strategy === 'inline') return { assetUrls: undefined, pictures: undefined };
  const served = await servedPictures(cardMd, assets, base);
  const kept = (urls) => [...served].filter(([id]) => urls[id]).map(([, p]) => ({ hex: p.hex, ext: p.ext, bytes: p.bytes }));
  if (strategy === 'url') {
    const all = Object.fromEntries([...served].map(([id, p]) => [id, p.url]));
    return { assetUrls: all, pictures: undefined, served: kept(all) };
  }
  const [, first, rest] = /^hybrid-(inline|preload)-(lazy|after-paint)$/.exec(strategy);
  const firstIds = new Set([...served.keys()].slice(0, FIRST_SCREEN_PICTURES));
  const urls = {};
  const preload = [];
  const reserve = [];
  for (const [id, p] of served) {
    if (!PLAIN_PATH.test(p.url)) continue;                   // never: base is a handle path, the tail is hex
    if (firstIds.has(id)) {
      if (first === 'inline') continue;                      // left out of the map = a data: URI
      preload.push(p.url);
    }
    urls[id] = p.url;
    const size = pictureSize(p.bytes);
    if (size) reserve.push([p.url, size[0], size[1]]);
  }
  return { assetUrls: urls, pictures: { preload, reserve, afterPaint: rest === 'after-paint' && PLAIN_PATH.test(base) ? `${base}a/` : '' }, served: kept(urls) };
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
