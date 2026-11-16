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
// ── what a page view may spend on keeping its pictures ────────────────────────────────────────────────
//
// 🩸 WHY. Every Cache API call (match, put) is a subrequest of the invocation that makes it, and the
// Workers Free plan allows 50 per invocation, `fetch()` and the Cache API together (developers.cloudflare.com
// /workers/platform/limits/, as cited in the review of tile PR #354). A page that kept all of a rich
// page's pictures at once — 40 puts, a marker read and a marker write — spent 42 on that alone, after the
// page path had already fetched one or two YouTube URLs per channel it names (yt-channels.mjs, uncapped).
// Past the limit the put fails, the marker is never written, and every later view tries the same
// oversized batch again. The Paid plan's limit is larger (its number was not re-checked for this); a
// page that fits Free fits Paid, so Free is the one to fit.
//
// So a page view keeps at most PICTURE_PREFILL_CALLS calls' worth — one marker read, PICTURE_PREFILL_CALLS
// − 2 pictures, one marker write — and less when the page path has already spent its budget on YouTube:
// prefillCalls(spent). The pictures kept are the first ones the page draws (the worker passes them in
// render order), which are the ones its first screens ask for: two on the first screen, about five on the
// wall's (asset-urls FIRST_SCREEN_PICTURES). Every other picture is kept by its own first request, on the
// picture route, which is a separate invocation with its own budget (a stop read, one match, one put).
/** the per-invocation subrequest limit the page path is fitted to: Workers Free, fetch() and Cache API together */
export const PAGE_SUBREQUESTS = 50;
/** held back for whatever else the page path may call that is not counted here (store reads, if the
 *  platform counts them, are about six on a page view: generation, body, stop, pool, domain bindings) */
export const PAGE_SUBREQUESTS_HELD = 8;
/** the most Cache API calls one page view spends keeping pictures: 1 marker match + 10 puts + 1 marker put */
export const PICTURE_PREFILL_CALLS = 12;
/**
 * prefillCalls(spent) → how many Cache API calls this page view may spend keeping pictures, after `spent`
 * subrequests (the YouTube fetches it already made): PICTURE_PREFILL_CALLS, or what is left under
 * PAGE_SUBREQUESTS − PAGE_SUBREQUESTS_HELD, or 0 when that cannot keep one picture (match + put + marker).
 */
export const prefillCalls = (spent) => {
  const left = PAGE_SUBREQUESTS - PAGE_SUBREQUESTS_HELD - Math.max(0, Number(spent) || 0);
  const calls = Math.min(PICTURE_PREFILL_CALLS, left);
  return calls >= 3 ? calls : 0;
};
/** the stored type each URL extension stands for (RASTER_EXT, the other way) */
export const EXT_TYPE = Object.freeze(Object.fromEntries(Object.entries(RASTER_EXT).map(([type, ext]) => [ext, type])));

// a fixed origin, whatever host the request came in on (the avatar relay's key does the same, card-worker
// avatarCacheKey): the entry is one per picture, not one per host.
// Not shared with the avatar relay's cache code: the two differ exactly where their rules live — the key
// (an upstream URL's hash there; handle, generation and content hash here) and the answer (the relay
// returns the stored response, headers and all; this re-derives the type from the URL extension and
// trusts only the bytes) — and what is left in common is `caches.default` and a catch around match/put.
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
 * It spends at most `calls` Cache API calls (prefillCalls): the first `calls` − 2 pictures of `served`,
 * which the caller passes in the order the page draws them; the rest are kept by their own first
 * request. Resolves to how many pictures it wrote.
 */
export async function keepPictures(handle, gen, served, calls = PICTURE_PREFILL_CALLS) {
  const cache = theCache();
  const room = Math.min(PICTURE_PREFILL_CALLS, Math.floor(Number(calls) || 0)) - 2;
  const some = room > 0 ? (served || []).slice(0, room) : [];
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
