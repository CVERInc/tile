// tile#339 step 1 — the picture route's own cache.
//
// 🩸 WHY. A picture request (`…/a/<sha256>.<ext>`, asset-urls.mjs) used to cost the whole file: read the
// body from the store, parse it (twice: the blank-template check, then the assets), base64-decode the
// candidates and hash them — 27–46 ms of host CPU per picture on a ~10 MB page, 1.0–1.6 s for the 36
// pictures of one cold visit (docs/experiments/cards-pictures-2026-11/). The bytes behind that path
// cannot change, so they are kept, decoded, in the Workers Cache API (caches.default), and a request
// that finds them there reads two small keys and no body.
//
// 🔴 What the cache must never do is outlive the page. Three rules hold that:
//   1. THE KEY NAMES THE LIFETIME: (handle, generation, hash, ext). A delete moves the handle to a new
//      generation (card-api genKey), so everything kept under the old one is unreachable at once — in
//      every data center, with nothing to purge (the Cache API cannot purge across data centers; the
//      reason the avatar relay keys on the picture and not on the path, reef#2940). The next owner of
//      the handle starts with an empty cache.
//   2. THE STOP IS READ ON EVERY REQUEST, hit or miss (card-api liveStop: the generation and its stop,
//      small keys, never the body). A stop is a marker inside a lifetime, not a new lifetime, so the key
//      cannot carry it. A stopped page's pictures answer the same 404 as a handle that never existed, with the cache still warm, and
//      a resumed page's pictures are served from it again.
//   3. AN ENTRY LIVES PICTURE_CACHE_SECONDS, NOT A YEAR. Inside one lifetime an owner can take a picture
//      off the page, and nothing cheap tells the route (the answer is in the body, which is what this
//      cache exists not to read). So a kept copy expires after an hour, and the page render puts back
//      what the page still names. A removed picture's URL can go on answering for up to that hour in a
//      data center that kept it — to someone who already holds the URL, which is the hash of bytes they
//      were served.
//
// The key is not the request URL: one entry answers on the shared host and on the page's own domain, and
// the path it is stored under (`/_picture-cache/…` on a fixed origin) is not a route — the cardtile
// worker runs before the cache, and to it that path is an unknown path.
//
// No side copy in KV or R2. The single-file markdown stays the only stored form of a picture; the cache
// is a derived, per-data-center, evictable copy, and losing an entry costs one slow request (the old
// path, which then keeps the picture again). A stored copy would need a writer at save, a sweep at
// delete and a rule for when the two disagree.
//
// Nothing here runs unless the picture route does, and that exists only while the local switch is set
// (asset-urls.mjs pictureStrategy). Every function resolves; none throws: a cache that is absent, full
// or failing is the route as it was before this file.
import { RASTER_EXT } from './asset-urls.mjs';

/** how long one kept picture (and a page's "all kept" marker) lives in the cache, seconds */
export const PICTURE_CACHE_SECONDS = 3600;
/** how many of a page's pictures one page render keeps: each cache write is a call that request pays for */
export const PICTURE_PREFILL_MAX = 40;
/** the stored type each URL extension stands for (RASTER_EXT, the other way) */
export const EXT_TYPE = Object.freeze(Object.fromEntries(Object.entries(RASTER_EXT).map(([type, ext]) => [ext, type])));

// a fixed origin, whatever host the request came in on (the avatar relay's key does the same, card-worker
// avatarCacheKey): the entry is one per picture, not one per host
const CACHE_ORIGIN = 'https://card.feelreef.com';
// only what the store itself writes: a handle (card-api VALID_HANDLE) and a generation (`0`, or the 24
// hex of card-api newGen). Anything else is not kept and not looked up.
const CACHEABLE_HANDLE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CACHEABLE_GEN = /^(?:0|[0-9a-f]{24})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const theCache = () => (globalThis.caches && globalThis.caches.default) || null;
const keyFor = (handle, gen, tail) => (CACHEABLE_HANDLE.test(String(handle)) && CACHEABLE_GEN.test(String(gen))
  ? new Request(`${CACHE_ORIGIN}/_picture-cache/${handle}/${gen}/${tail}`, { method: 'GET' }) : null);
const keptResponse = (body) => new Response(body, { headers: { 'Cache-Control': `public, max-age=${PICTURE_CACHE_SECONDS}` } });
const hexOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

/** the Cache API key of one picture of one lifetime; null when any part is not the store's own shape */
export const pictureCacheKey = (handle, gen, hex, ext) => (HEX64.test(String(hex)) && Object.prototype.hasOwnProperty.call(EXT_TYPE, ext)
  ? keyFor(handle, gen, `${hex}.${ext}`) : null);

/**
 * cachedPicture(handle, gen, hex, ext) → { type, bytes } from the cache, or null (no cache, no entry, or
 * an entry that is not a 200 with a body). The type is the URL extension's, never a header the cache
 * returned. 🔴 This answers "are these bytes kept", never "may they be served": the caller reads this
 * lifetime's stop.
 */
export async function cachedPicture(handle, gen, hex, ext) {
  const cache = theCache();
  const key = cache && pictureCacheKey(handle, gen, hex, ext);
  if (!key) return null;
  try {
    const hit = await cache.match(key);
    if (!hit || hit.status !== 200) return null;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    return bytes.length ? { type: EXT_TYPE[ext], bytes } : null;
  } catch { return null; }
}

/** keepPicture(handle, gen, hex, ext, bytes) → keeps one picture; true when the cache took it */
export async function keepPicture(handle, gen, hex, ext, bytes) {
  const cache = theCache();
  const key = cache && pictureCacheKey(handle, gen, hex, ext);
  if (!key || !bytes || !bytes.length) return false;
  try { await cache.put(key, keptResponse(bytes)); return true; } catch { return false; }
}

/**
 * keepPictures(handle, gen, served) → keeps the pictures a page render already decoded and hashed
 * (asset-urls picturePlan's `served`), so the picture requests that page causes are hits. One marker per
 * (lifetime, set of pictures) says "these are all kept": a page view that finds it writes nothing, and
 * it is written only when every picture was taken, so a failed write is tried again by the next view.
 * At most PICTURE_PREFILL_MAX pictures, in page order; the rest are kept by their own first request.
 * Resolves to how many pictures it wrote.
 */
export async function keepPictures(handle, gen, served) {
  const cache = theCache();
  const some = (served || []).slice(0, PICTURE_PREFILL_MAX);
  if (!cache || !some.length) return 0;
  try {
    const names = some.map((p) => `${p.hex}.${p.ext}`).sort().join('\n');
    const marker = keyFor(handle, gen, `set-${await hexOf(new TextEncoder().encode(names))}`);
    if (!marker || (await cache.match(marker))) return 0;
    const took = await Promise.all(some.map((p) => keepPicture(handle, gen, p.hex, p.ext, p.bytes)));
    if (took.every(Boolean)) await cache.put(marker, keptResponse('kept'));
    return took.filter(Boolean).length;
  } catch { return 0; }
}
