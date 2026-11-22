// REEF with Card — the multi-tenant edge renderer. ONE Worker renders EVERY card: it resolves a
// handle from the request, reads that handle's card.md from the CARDS store, and renders it with
// cardtile (card-core + card-render). Adding a card is a STORE WRITE, never a repo/deploy — this is
// the millions-of-free-cards shape (cardtile renders DATA), the native replacement for the Python
// card_render.py that bakes one card's HTML per request on Heroku.
//
//   card.feelreef.com/<handle>   → handle = first path segment (canonical)
//   reef.cards/<handle>          → the same; reef.cards/ is the root card (reef#2725, CARD_CANONICAL_HOST;
//                                  before it, dark or a noindex mirror of the old host — cardsHostStage)
//   <creator's own domain>/      → handle via the store's vanity: binding (one domain = one card)
//   reef.cards/report            → the report door, reef.cards only (reef#2758, card-report.mjs)
//   cards.feelreef.com/…         → the service's own host, once CARDS_SERVICE_HOST says so: the editor,
//                                  the park, host mode and the API live there, and reef.cards holds only
//                                  what people wrote (serviceHostStage)
//   /_coral/<coral>-<ver>.js     → a coral client (served here so the page can <script src> it)
//
// The render path (resolveHandle → renderCardHTML) is pure and node-testable; the fetch handler is
// the only edge-specific shell. One brain, two runtimes (same pattern as events-worker).
import { parseCard, serializeCard } from '../card-core.js';
import { renderPage, poolOf, picturesInRenderOrder } from '../card-render.mjs';
import { CSS, ICONS, QR_JS, QR_VERSION, DRAWER_JS, DRAWER_VERSION, ARROW } from './card-assets.mjs';
import { VIDEO_RE, ytCacheTtl } from '../yt.mjs';
import { keptChannels, resolveChannels, resolveChannelsOf } from '../yt-channels.mjs';
import { cardAvatar, iconLinks, iconKind, iconFile } from '../card-icon.mjs';
import { shareTags } from '../card-share.mjs';
import { isTemplateOnly } from '../card-blank.mjs';
import { ON_DEMAND_TILES, scanCard, headModel, blankAbove, allAssets, deckFront, windowsOf, windowOf, windowPicturesText, revisionOf } from './size-tier.mjs';
import { picturePlan, pictureStrategy, findAsset, ASSET_TAIL_RE, ASSET_CACHE } from './asset-urls.mjs';
import { CHANNEL_SUBREQUESTS, cachedPicture, keepPicture, keepPictures, prefillCalls } from './picture-cache.mjs';

// One fetch per channel, not per card or visitor (yt.mjs, condition 2). How long the edge keeps each
// YouTube answer is yt.mjs ytCacheTtl (re-exported here): the uploads-playlist oEmbed 30 minutes — that
// TTL is what bounds how old "latest" can be — a handle page and a video's own oEmbed a day.
export { ytCacheTtl };
const ytFetch = (u) => fetch(u, { cf: { cacheTtl: ytCacheTtl(u), cacheEverything: true } });
// tile#355 — the channels this isolate has resolved, in memory (no subrequest to read). Read only by a page
// that names more channels than CHANNEL_SUBREQUESTS can fetch, for the ones past its share.
const CHANNELS_KEPT = keptChannels();
const channelShare = { subrequests: CHANNEL_SUBREQUESTS, kept: CHANNELS_KEPT };
import { ICON_DOMAIN_RE, iconUpstreams } from '../marks.mjs';
// Image types the /_icon/ and /_yt/ proxies will relay. SVG is deliberately absent (it can carry script).
const PROXY_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']);
/** the normalised allowed type of an upstream content-type header, or null */
function allowedImageType(header) {
  const t = String(header || '').split(';')[0].trim().toLowerCase();
  return PROXY_IMAGE_TYPES.has(t) ? t : null;
}
const NOT_RELAYED = () => new Response('', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
/** /_icon/ and /_yt/: cache-first, upstream only on a miss, store only what passed allowedImageType.
 *  `upstreams` is one fixed address or an ordered list (reef#2026: DuckDuckGo, then Google) — a miss or a
 *  network error on one is the same as a 404: ask the next. An ANSWER whose type we do not relay ends it
 *  (r9: one upstream call per rejected request — the rejection is a 404, never a second fetch). */
async function relayImage(request, ctx, upstreams, maxAge) {
  const cache = globalThis.caches && globalThis.caches.default;
  // Keyed on origin + path, never the query: both routes read the path only, so `?1`, `?2`, … were
  // each a miss, an upstream fetch and a cache entry for one and the same image (tile#150 L3).
  const at = new URL(request.url);
  const key = new Request(at.origin + at.pathname, { method: 'GET' });
  if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit; }
  let up = null;
  for (const upstreamUrl of [].concat(upstreams)) {
    const r = await fetch(upstreamUrl).catch(() => null);
    if (r && r.ok) { up = r; break; }
  }
  // A missing mark/poster is not an error — the card's own fallback chain takes over.
  if (!up) return NOT_RELAYED();
  const type = allowedImageType(up.headers.get('content-type'));
  if (!type) return NOT_RELAYED();
  const resp = new Response(up.body, {
    headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': `public, max-age=${maxAge}` },
  });
  if (cache) {
    const put = cache.put(key, resp.clone()).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put); else await put;
  }
  return resp;
}
const AVATAR_MAX_BYTES = 512 * 1024;
/** The relay's Cache API key for one upstream picture: a fixed origin and the SHA-256 of its URL.
 *  🔴 reef#2940: never the request path. /<handle>/avatar (or a vanity host's /avatar) names the
 *  HOLDER, not the picture, and Cache API entries cannot be purged across colos — a path key kept
 *  serving the old picture for up to max-age after the holder changed their avatar, or after a
 *  retired handle was claimed by someone else. A new URL is a new key, so either case is a miss at
 *  once. The same picture behind several hosts or paths shares one entry. No query: GET only. */
async function avatarCacheKey(upstreamUrl) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(upstreamUrl));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://${CANON_HOST}/_avatar-relay/${hex}`, { method: 'GET' });
}
/** Author-supplied avatars must be HTTPS raster images, without redirects or unbounded bodies. */
async function relayAvatar(ctx, upstreamUrl) {
  try { if (new URL(upstreamUrl).protocol !== 'https:') return NOT_RELAYED(); }
  catch { return NOT_RELAYED(); }
  const cache = globalThis.caches && globalThis.caches.default;
  const key = await avatarCacheKey(upstreamUrl);
  if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit; }
  const up = await fetch(upstreamUrl, { redirect: 'manual' }).catch(() => null);
  if (!up) return NOT_RELAYED();
  const type = allowedImageType(up.headers.get('content-type'));
  if (!up.ok || !type || Number(up.headers.get('content-length')) > AVATAR_MAX_BYTES) {
    if (up.body) await up.body.cancel().catch(() => {});
    return NOT_RELAYED();
  }
  const chunks = [];
  let size = 0;
  if (up.body) {
    const reader = up.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > AVATAR_MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return NOT_RELAYED();
        }
        chunks.push(value);
      }
    } catch {
      await reader.cancel().catch(() => {});
      return NOT_RELAYED();
    } finally { reader.releaseLock(); }
  }
  // Finish the bounded read before answering: an oversized stream must never start a 200.
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const resp = new Response(body, {
    headers: { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600' },
  });
  if (cache) {
    const put = cache.put(key, resp.clone()).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put); else await put;
  }
  return resp;
}
import { handleApi, previewKey, generationOf, isCurrentGen, liveCard, liveStop, POOL_IN, POOL_OUT, vanityKey, isBound, boundHostOf, hostOwner, tryKey, TRY_TTL, TRY_MAX_BYTES, VALID_HANDLE } from './card-api.mjs';
import { vanityHost, pathHosts } from './card-vanity.mjs';
import { EDIT3_BODY_HTML, EDIT3_BASE_CSS, EDIT3_CSS, EDIT3_JS, BORROWED, FONT_FILES } from './edit3-assets.mjs';
import { DECK_CSS, DECK_JS } from './deck-assets.mjs';
import { localeFromAcceptLanguage, primaryLocale, SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';
import { validHostOrigin } from '../w3/host-bridge.mjs';
import { withDeck, DECK_CSS_PATH, DECK_JS_PATH, DECK_TRY_URL } from '../w3/deck-page.mjs';
import { handleReport, REPORT_PATH } from './card-report.mjs';
import { standIn, hostName } from './host-standins.mjs';
import { pageCspHeaders, pageCspStage } from './cardtile-page-csp.mjs';
import { embedDocuments, embedDocumentOf, embedDocumentBody, embedDocumentHeaders, framesAsDocuments, hasSrcdocFrame, EMBED_TAIL_RE } from './cardtile-embed-document.mjs';

// The coral's URL carries its version, and the response is immutable for a year. Both halves are
// required: without `immutable` every visit re-validates 100KB; without the version in the path a
// coral fix could never reach anyone who had already loaded a card. Bump the coral → new path →
// browsers fetch. (Same reasoning as the registry's per-version dirs; this is its serving twin.)
const QR_PATH = `/_coral/qr-${QR_VERSION}.js`;
const DRAWER_PATH = `/_coral/drawer-${DRAWER_VERSION}.js`;

// Vanity bindings live in the STORE, not in this file — two keys, both single lookups:
//
//   vanity:<host>       → handle    a creator's own domain resolves to their card
//   vanityof:<handle>   → host      the inverse: a card with its own domain has ONE address
//
// 🩸 WHY THEY MOVED (2026-08-12). They were a literal map of two real customer domains inside
// shipping product code — which meant binding a third creator's domain required a code change and
// a redeploy, and it meant the product carried a list of who our customers are. The comment that
// used to sit here already prescribed this ("at scale this moves into the store"); "at scale" was
// doing a lot of work for a thing that was wrong at N=2.
//
// 🔴 The scar that must not be re-earned: a creator's apex arriving via Cloudflare for SaaS reaches
// this worker with no path segment. Without a binding, resolveHandle finds no vanity and no
// segment, returns null, and the visitor gets the DIRECTORY page on the creator's own domain. That
// was live for several minutes once — the plumbing was right and nothing pointed the apex at the
// card. A missing key is now the same failure, so seeding is part of binding a domain, not an
// afterthought. The keys are written by the objects behind `/_api/vanity/<handle>` (card-vanity.mjs,
// CUSTOM-DOMAIN.md); before that route they were hand-written to the store.
//
// 🔴 And a binding belongs to one lifetime of the handle (reef#2618 r4, r5; card-api vanityKey).
// `vanity:<host>` is only a pointer to a handle; the host serves that handle only while
// `vanitybind:<handle>:<gen>:<host>` exists for its CURRENT `gen:`, and the inverse is
// `vanityof:<handle>:<gen>`. A binding of an ended lifetime would otherwise hand the former owner's
// domain to the next owner of the handle. Pre-generation bindings are generation 0's.
const VANITY_KEY = (host) => vanityKey(host); // card-api's, called late: the two modules import each other

// canonical multi-tenant host. Its bare root is the platform's own card (ROOT_HANDLE, below) — it
// was a directory line until tile-lab#51.
const CANON_HOST = 'card.feelreef.com';
// the Cloudflare-for-SaaS fallback origin (wrangler.example.toml routes): ours, never a creator's.
const FALLBACK_HOST = 'saas.feelreef.com';

// reef#2725 — the Card's own registrable domain. A Card is user content, and a domain of its own
// keeps its reputation (browsers, search) apart from feelreef.com's. With the switch on, it routes
// by path like the old host, and its bare root is the platform's own card, ROOT_HANDLE.
export const CARDS_HOST = 'reef.cards';
export const ROOT_HANDLE = 'feelreef';
// the apex whose single-segment paths used to name Cards (`feelreef.com/<handle>`)
const APEX_HOST = 'feelreef.com';

/**
 * cardsHostStage: env → 'dark' | 'open' | 'canonical'. Pure, and the ONLY reader of the two settings:
 * everything else that depends on them (canonicalHost, movedTo, the robots rule, the open stage's
 * mirror) asks this function.
 *
 *   'dark'       today's default. reef.cards answers nothing; card.feelreef.com is the Cards' address.
 *   'open'       tile#299. `CARDS_HOST_OPEN = "reef.cards"` and the cutover switch off: reef.cards
 *                answers a visitor's reads exactly as card.feelreef.com does (openStageMirrors), with
 *                `X-Robots-Tag: noindex, nofollow`, so the two hosts can be compared handle by handle.
 *                Nothing else changes: no 301, every address the Worker emits is still the old one,
 *                and the old host answers byte for byte as in 'dark'.
 *   'canonical'  reef#2725, the cutover. `CARD_CANONICAL_HOST = "reef.cards"`: the old addresses 301
 *                to reef.cards. The cutover switch alone means this, whatever CARDS_HOST_OPEN says.
 *
 * Each setting is read by one rule: exactly `reef.cards` (case and surrounding space aside) is on;
 * unset or ANY other value is off. A typo must never redirect every Card to a host we do not serve,
 * nor open a host nobody asked to open — so a typo in either setting falls back toward 'dark'.
 */
export const CARDS_HOST_STAGES = Object.freeze(['dark', 'open', 'canonical']);
const namesCardsHost = (v) => String(v ?? '').trim().toLowerCase() === CARDS_HOST;
export function cardsHostStage(env) {
  if (namesCardsHost(env?.CARD_CANONICAL_HOST)) return 'canonical';
  if (namesCardsHost(env?.CARDS_HOST_OPEN)) return 'open';
  return 'dark';
}

/**
 * The cutover switch's host: reef.cards in the 'canonical' stage only, card.feelreef.com otherwise —
 * including 'open', where the new host serves but is not yet anyone's address.
 */
export const canonicalHost = (env) => (cardsHostStage(env) === 'canonical' ? CARDS_HOST : CANON_HOST);
const movedToCardsHost = (env) => cardsHostStage(env) === 'canonical';

// ── three roles, three hosts ─────────────────────────────────────────────────────────────────────
//
// The service (the editor, the park, host mode, the API) and what people write live on different
// registrable domains, so the two share no cookies and no browser storage:
//
//   the service's host        cards.feelreef.com   CARDS_SERVICE_HOST = "cards.feelreef.com"
//   people's canonical host   reef.cards           CARD_CANONICAL_HOST = "reef.cards"  (cardsHostStage)
//   the legacy host           card.feelreef.com    no setting: the host both moved from
//
/**
 * serviceHostStage: env → 'off' | 'open' | 'split'. Pure, and the ONLY reader of CARDS_SERVICE_HOST.
 *
 *   'off'    unset, or anything that is not exactly the string `cards.feelreef.com` — another case,
 *            a space before or after it, a trailing dot or newline are all off (compared with `===`,
 *            nothing is trimmed or lowercased). Every answer is the one cardsHostStage alone decides:
 *            nothing in this block runs, and neither do the stand-ins (standInsOn).
 *   'open'   the setting alone. cards.feelreef.com answers as the service's home (its root goes to the
 *            editor, a handle's address goes to the people's host, anything else is the nothing-here
 *            page). Nothing redirects TO it and no address the Worker writes changes.
 *   'split'  with the cutover (cardsHostStage 'canonical'):
 *              cards.feelreef.com   the service pages
 *              reef.cards/<handle>  what a person wrote, and nothing of the service: its root is a
 *                                   temporary redirect to the editor, the editor's paths redirect to
 *                                   the service host, the API and the park do not answer
 *              card.feelreef.com    a service page → the same path on cards.feelreef.com; everything
 *                                   else → reef.cards, as the cutover alone already sends it
 *
 * The same rule as cardsHostStage: a typo must never redirect the editor to a host nobody serves.
 */
export const SERVICE_HOST = 'cards.feelreef.com';
export function serviceHostStage(env) {
  if (env?.CARDS_SERVICE_HOST !== SERVICE_HOST) return 'off';
  return movedToCardsHost(env) ? 'split' : 'open';
}
const splitHosts = (env) => serviceHostStage(env) === 'split';
/** where the write API is called: the service's host once it is on, the host Cards answer on before */
export const apiOrigin = (env) => `https://${serviceHostStage(env) === 'off' ? canonicalHost(env) : SERVICE_HOST}`;

// `feelreef.com/<handle>`: one segment in the handle grammar (card-api VALID_HANDLE, any case —
// the path is preserved as written). Anything else on the apex is the marketing site's, never a Card.
const APEX_HANDLE_PATH = /^\/[a-z0-9][a-z0-9-]{0,62}\/?$/i;
// Error class names safe to log verbatim. Anything else is reported as 'unknown' (tile#220 review).
const LOGGED_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AbortError', 'TimeoutError']);
// These site endpoints win even if someone creates a Card with the same handle.
const APEX_SITE_PATHS = new Set(['report', 'pricing', 'login', 'edit', 'try']);
const isApexSitePath = (path) => APEX_SITE_PATHS.has(path.replace(/^\/|\/$/g, '').toLowerCase());

/**
 * movedTo: (host, url, method, env) → the reef.cards URL this request now lives at, or null. Pure.
 *
 * Only with the switch on, only GET/HEAD (a 301 turns a POST into a GET), and with the path and
 * query carried over byte for byte: a printed QR code carries the old URL forever, so the old
 * address must land on the same card. Two exceptions on the old card host:
 *   /_api/…  never reaches here (handleApi answers first, on any host)
 *   /edit    host mode: the feelreef page that frames it pins this origin for postMessage, so it
 *            moves when that page does, not before
 *   /try/edit/a/…  the editor's hashed files: host mode on this host imports them as modules, and a
 *            module that redirects to another origin needs CORS it does not have
 *
 * With the service on its own host (serviceHostStage 'split') a service page moves to
 * cards.feelreef.com instead — the sandbox, its retired path and the park's address — and one address
 * is answered in place: `/try/edit?stay=1` (staysOnLegacy).
 */
export function movedTo(host, url, method, env) {
  if (!movedToCardsHost(env) || (method !== 'GET' && method !== 'HEAD')) return null;
  const p = url.pathname;
  if (splitHosts(env)) host = hostName(host);   // tile#378: one name, whatever the dot (hostName)
  if (host !== CANON_HOST || p === '/_api' || p === HOST_EDIT_PATH || p === `${HOST_EDIT_PATH}/` || p.startsWith(EDITOR_ASSET_BASE)) return null;
  if (splitHosts(env) && isServicePath(p)) return staysOnLegacy(url) ? null : `https://${SERVICE_HOST}${p}${url.search}`;
  return `https://${CARDS_HOST}${p}${url.search}`;
}
/**
 * `/try/edit?stay=1` on the legacy host: the sandbox, served in place after the split.
 *
 * 🔴 WHY. The sandbox keeps a visitor's draft in the browser's storage, and storage belongs to an
 * origin: a draft made on card.feelreef.com does not follow its author to cards.feelreef.com, and the
 * 301 means the page that could read it is never served again. The draft is not deleted — it is out of
 * reach. This address is the way back to it (exactly `stay=1`, nothing else): the old editor opens on
 * the old origin with the draft in it, and its Save still parks the whole file and opens the door.
 * Nothing links here; it is what support hands to someone who asks where their draft went.
 */
const staysOnLegacy = (url) => (url.pathname === SANDBOX_PATH || url.pathname === `${SANDBOX_PATH}/`) && url.searchParams.get('stay') === '1';
// cacheable at the edge and in the browser; a day, so a correction does not wait a year to arrive
const MOVED_CACHE = 'public, max-age=86400';

/**
 * resolveHandle: (host, pathname, vanity) → { handle, cardUrl } | null. Pure.
 *
 * `vanity` is the host→handle map for THIS request — normally zero or one entry, read from the
 * store by the caller. Injected rather than fetched here on purpose: this function is the one
 * piece of the routing that is worth unit-testing, and it stays synchronous and pure so it can be.
 * The default is empty, so a caller that forgets it gets canonical-path routing and never a
 * silently wrong card.
 *
 * 🔴 Path routing (`/<handle>`) answers on OUR hosts only (reef#2618 r2): the canonical card host, the
 * Cloudflare-for-SaaS fallback origin (a creator's hostname CNAMEs to it, but their requests carry
 * their own Host), Cloudflare's `*.workers.dev`, and local dev (a host with no dot — `localhost`, a
 * harness's `x` — can never be a public custom hostname; plus `127.0.0.1`). Any other host is a
 * creator's domain, and there the handle comes from its binding and nothing else — no binding, no
 * card, on every path. Before this, a domain whose binding was removed fell through to path routing,
 * so `<former-domain>/<handle>` served whoever owned that handle next.
 */
export const routesByPath = (host, extra = new Set()) =>
  !host || extra.has(host) || host === CANON_HOST || host === CARDS_HOST || host === FALLBACK_HOST || host.endsWith('.workers.dev')
  || !host.includes('.') || host === '127.0.0.1';

// reef#2725: on reef.cards the bare root, `/<ROOT_HANDLE>` and the origin-level icon files are the
// root card's, which is addressed like a one-card host (cardUrl = the bare origin, `root: true`).
// An icon path can never be a handle (it has a dot), so nothing a customer could own is taken.
// tile-lab#51 (product owner 2026-10-29): the old card host too. A visitor who cuts the handle off a
// shared link is asking "what is this?", and the Card answers by being one — feelreef's own.
const hasRootCard = (host) => host === CARDS_HOST || host === CANON_HOST;
// `rootPage: false` (the caller's, for reef.cards once the service has its own host — serviceHostStage
// 'split'): the bare root is no page there (it redirects to the editor), so `/<ROOT_HANDLE>` is an
// ordinary handle with an ordinary address, and only the origin's icon files are still the root's.
const isRootPath = (host, seg, rootPage = true) =>
  hasRootCard(host) && ((rootPage && (!seg || seg.toLowerCase() === ROOT_HANDLE)) || !!iconKind('/' + seg));

export function resolveHandle(host, pathname, vanity = {}, extra = new Set(), { rootPage = true } = {}) {
  host = (host || '').toLowerCase().replace(/:\d+$/, '');
  const seg = (pathname || '/').replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  if (vanity[host]) return { handle: vanity[host], cardUrl: 'https://' + host };            // vanity domain = one card
  if (!routesByPath(host, extra)) return null;                                                // a creator's domain, unbound → nothing
  if (isRootPath(host, seg, rootPage)) return { handle: ROOT_HANDLE, cardUrl: 'https://' + host, root: true };
  if (seg) return { handle: seg.toLowerCase(), cardUrl: 'https://' + (host || CANON_HOST) + '/' + seg.toLowerCase() };
  return null;                                                                                // canonical host, no handle → directory
}

/**
 * cardPath: (pathname, handle, isVanity) → what this path asks of the card it resolved to. Pure.
 *
 *   'page'                  the card itself (HTML, or thin markdown by Accept)
 *   'fat'                   the whole file, assets included (/index.md, /<handle>.md)
 *   'avatar'                the card's own avatar only, never an icon badge
 *   'ico' | 'svg' | 'apple' one of the card's icon files (card-icon.mjs)
 *   'asset'                 one picture by its bytes' hash: `…/a/<sha256>.<ext>` (tile#339, asset-urls.mjs)
 *   'embed'                 one embed's document by its hash: `…/_embed/<sha256>` (tile#372, cardtile-embed-document.mjs)
 *   'alias'               /<handle> on the card's own domain → 301 to its root
 *   null                    nothing lives here → 404
 *
 * 🩸 WHY IT EXISTS (reef#1090). resolveHandle answers "WHICH card", and on a vanity host it answers
 * without looking at the path at all — correctly, "one domain = one card". But nothing then asked
 * "is this path the card?", so EVERY path on a creator's domain rendered the whole card:
 * `/favicon.ico`, `/apple-touch-icon.png`, `/robots.txt`, all 200 and 1.2 MB of HTML. On the
 * canonical host the same gap was `/<handle>/<anything>`. Nothing in this Worker ever links to a
 * sub-path of a card: the QR and the canonical→vanity 301 carry the ROOT (plus the query string,
 * which is not the path), the download link is /index.md or /<handle>.md, and every asset the page
 * loads (/_coral/, /_icon/, /_yt/) is routed above before a handle is resolved. So the card answers
 * on its own address and nowhere else — except its own pictures (tile#339), which the page names under
 * `a/` beside it, by exactly one spelling: 64 lower-case hex digits and the extension of a raster type.
 *
 * 🔴 The one sub-path with a history is /<handle> on the card's own domain: before a domain's
 * vanity key existed, `<their-domain>/<handle>` was how the card was reached there (CUSTOM-DOMAIN.md,
 * "the apex 404'd on a working path"). It 301s to the root rather than 404ing, so a link from that
 * era still lands, and the card still has one address.
 */
export function cardPath(pathname, handle, isVanity) {
  const p = pathname || '/';
  const h = String(handle || '').toLowerCase();
  const lower = p.toLowerCase();
  if (isVanity) {
    if (p === '/') return 'page';
    if (p === '/index.md' || lower === `/${h}.md`) return 'fat';
    const icon = iconKind(p);
    if (icon) return icon;
    if (lower === `/${h}` || lower === `/${h}/`) return 'alias';
    // Keep /<handle> as the page alias even when the handle itself is "avatar".
    if (p === '/avatar' || p === `/${h}/avatar`) return 'avatar';
    // tile#339: a picture by its bytes' hash (asset-urls.mjs). `/<h>/a/…` too: the root card, whose
    // page is `/`, names its pictures there, because `/a/…` on a shared host is the handle `a`.
    if (ASSET_TAIL_RE.test(p) || (lower.startsWith(`/${h}/`) && ASSET_TAIL_RE.test(p.slice(h.length + 1)))) return 'asset';
    // tile#372: an embed's own document (cardtile-embed-document.mjs), by the same two spellings as a picture
    if (EMBED_TAIL_RE.test(p) || (lower.startsWith(`/${h}/`) && EMBED_TAIL_RE.test(p.slice(h.length + 1)))) return 'embed';
    return null;
  }
  const m = /^\/([^/]+)(\/.*)?$/.exec(p);
  if (!m) return null;
  const seg = m[1].toLowerCase(), rest = (m[2] || '').replace(/\/+$/, '');
  if (seg === `${h}.md`) return rest ? null : 'fat';
  if (seg !== h) return null;
  if (rest === '/avatar') return 'avatar';
  if (ASSET_TAIL_RE.test(m[2] || '')) return 'asset';   // the unstripped tail: a file has no trailing `/`
  if (EMBED_TAIL_RE.test(m[2] || '')) return 'embed';   // tile#372, the same rule
  return rest ? iconKind(rest) : 'page';
}
/**
 * One picture's answer (tile#339), the same from the cache and from the file. A page with a picture on
 * it is never the blank template (card-blank isTemplateOnly: any asset means an author wrote it), so the
 * robots rule needs no body.
 */
const pictureResponse = (picture, env, handle, at) => new Response(picture.bytes, {
  headers: {
    'Content-Type': picture.type,
    'Cache-Control': ASSET_CACHE,
    // the type is the store's own `mime=`, from a raster allowlist; never let a client second-guess it
    'X-Content-Type-Options': 'nosniff',
    ...ROBOTS_HEADERS(env, handle, at, false),
  },
});
/** the `<hex>` and `<ext>` of an asset path cardPath routed to 'asset' */
const assetRef = (pathname) => {
  const m = /\/a\/([0-9a-f]{64})\.([a-z]+)$/.exec(pathname);
  return m ? { hex: m[1], ext: m[2] } : null;
};
/** where a card's pictures live on the host serving it: `/` on its own domain, `/<handle>/` otherwise */
const assetBase = (handle, oneCardDomain) => (oneCardDomain ? '/' : `/${handle}/`);

/**
 * cardUrlFor: (handle, vanity) → the card's public URL. The INVERSE of resolveHandle, and it lives
 * beside it deliberately: the editor has to know which domain a card answers on, because `social`
 * gives a link to the author's OWN site a drawn house instead of a favicon and "own" means "same
 * host as cardUrl". Two places computing that from two tables is how a preview starts quietly
 * disagreeing with production.
 *
 * 🩸 The editor used to do this reverse lookup over a VANITY object literal exported from here. When
 * the bindings moved into the store (they were a list of whose cards we have, sitting in the product)
 * that export went away and the editor stopped booting — `does not provide an export named 'VANITY'`,
 * on a page no unit test loads. So `vanity` is a PARAMETER now, and the default is none: a browser
 * cannot read the store, and the honest answer for a card nobody has said anything about is the
 * canonical path, never a guess at somebody's domain.
 *
 * reef#2725 r2 — `env` is the switch (`{ CARD_CANONICAL_HOST }`), read by the same canonicalHost the
 * routing reads, so the inverse moves when resolveHandle does: the root card is the bare origin of
 * either host, as resolveHandle says (tile-lab#51). No env = today's host. A browser has no Worker env; whoever
 * serves the editor says which host it is (w/serve.mjs's `/_w/can-save`).
 *
 * Once the service has its own host (serviceHostStage 'split') the bare root of reef.cards is a
 * redirect, not a page, so the root handle's address is `/<ROOT_HANDLE>` like any other.
 */
export const cardUrlFor = (handle, vanity = {}, env) => {
  const host = Object.keys(vanity).find((h) => vanity[h] === handle);
  if (host) return `https://${host}`;
  const canon = canonicalHost(env);
  return handle === ROOT_HANDLE && !splitHosts(env) ? `https://${canon}` : `https://${canon}/${handle}`;
};
/** the configured card host as an origin — where a handle's public exits (`/<h>.md`) are read. */
export const cardOrigin = (env) => `https://${canonicalHost(env)}`;

// OPTIONAL author fields. `since` = the founding year in the footer's "© 2013–2026" (omit → just
// the current year); `accent` = one hex that themes the whole card.
// 🩸 STRIP MATCHED QUOTES. Frontmatter looks like YAML, so authors quote things — and
// `accent: '#b890e8'` used to arrive here WITH the quotes, get spliced straight into
// `--cp-accent:'#b890e8'`, and be discarded by the browser as an invalid value. The card then
// wore the platform default and nothing anywhere said why: valid markdown, valid CSS syntax,
// silently the wrong colour. Found on 2026-08-13 on a live creator's card.
//
// 🔴 Only MATCHED outer quotes, and only when they wrap the whole value. A tagline that opens
// with a quotation mark is a tagline, not a quoted scalar.
// Module-level because the icon routes read the same two fields (name, accent) the page does — the
// badge in the tab must be the card's colour by the same reading the card itself uses.
const unquote = (v) => (/^(['"]).*\1$/.test(v) ? v.slice(1, -1).trim() : v);
const frontmatter = (cardMd, k) => unquote(new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(cardMd)?.[1]?.trim() || '');
const cardName = (cardMd, handle) => /^title:\s*(.+)$/m.exec(cardMd)?.[1]?.trim() || handle || '';

/**
 * renderCardHTML: (cardMd, {handle, cardUrl, deck?}) → HTML string. Pure — the shared brain.
 *
 * Every Card page is a DECK (w3/deck-page.mjs): one rule for every Card, so the editor's preview and
 * the page a visitor gets are the same page. `ctx.deck` is the caller's: absent = the live page as
 * served; `false` = the flat page (the editor's per-tile thumbnails); `{ view, pool }` = the editor's
 * preview of one view. An `editIndex` render (the editor's wall, where tiles are moved by hand) is
 * always flat — the deck would rearrange the very boxes it maps back to cells.
 *
 * The card pool (reef#2913) has two writers, and exactly one of them draws per page:
 *   - `ctx.pool` true/false (the PLATFORM's switch, from this Worker's own call site, which reads it
 *     from `pool:<handle>:<gen>` = `in` / `out` beside the body — tile#336, card-api poolKey; poolOf): the
 *     renderer draws it — the closing reef.cards tile after the author's grid and the footer link
 *     (true), or neither (false). The deck is then told `pool: false`, which to deck.js means "draw
 *     no reef.cards card and no footer link of your own", so nothing is drawn twice. In stack and
 *     list the renderer's closing tile is the last `.st-cell` on the page, so deck.js deals it as
 *     the last card like any link tile; in wall it is the last block on the page.
 *   - `ctx.pool` absent: today's page, byte for byte — the deck's own switch (`deck.pool`, the
 *     editor's sandbox stand-in) passes through untouched, as it did before the renderer knew the pool.
 *     With no `deck.pool` either, the page says nothing about the pool and deck.js draws nothing:
 *     only `true` is in, so an unknown switch never opts a Card in.
 * An editIndex render never carries the closing tile: that wall is the author's own boxes only.
 *
 * `ctx.chromeLang` (tile#298, CALLER-supplied — only the Worker's card exit sets it, from visitorLocale)
 * is the language of the deck's own words (its view switcher, its calls to action) for a card that
 * declares NO `lang:`. A card that declares one keeps its own and never reads chromeLang, so its page is
 * byte-identical with or without it. Never `<html lang>` (renderFlat reads the card's own `lang:`
 * only) and never the owner's content: the deck's words are all it reaches.
 */
export function renderCardHTML(cardMd, ctx = {}) {
  return renderSource({ model: parseCard(cardMd), fm: (k) => frontmatter(cardMd, k), name: cardName(cardMd, ctx.handle), deckMd: cardMd }, ctx);
}

/**
 * renderSource: renderCardHTML's own path, for a page whose model is already made — the whole file's
 * (renderCardHTML), or one window of Cards past the size tier (serve/size-tier.mjs windowOf, from the
 * page exit below). src: { model, fm: key → the frontmatter value the whole file gives, name, deckMd: what
 * w3/deck-page.mjs reads the deck's keys from, head?: the model the head's description, share image and
 * icons are made of (absent: `model`) }.
 */
function renderSource(src, ctx) {
  const pool = ctx.editIndex ? undefined : poolOf(ctx);
  const flat = renderFlat(src, ctx.editIndex && ctx.pool !== undefined ? { ...ctx, pool: undefined } : ctx);
  if (ctx.deck === false || ctx.editIndex) return flat;
  const deck = ctx.deck && typeof ctx.deck === 'object' ? ctx.deck : {};
  return withDeck(flat, src.deckMd, { view: deck.view, pool: pool === undefined ? deck.pool : false, handle: ctx.handle || '', lang: src.fm('lang') || ctx.chromeLang || '' });
}

// a window's share tags: the Cards' own, with the canonical moved to the window's address (none where the page has no canonical at all)
const windowCanonical = (share, windowUrl) => (windowUrl && share.canonical ? { ...share, canonical: windowUrl } : share);
/** window n's own address under the Cards' canonical one: `…?w=<n>`, no revision ('' when that address is no URL) */
const windowAddress = (cardUrl, n) => {
  try { const u = new URL(cardUrl); u.search = `?w=${n}`; u.hash = ''; return u.href; } catch { return ''; }
};

function renderFlat(src, ctx) {
  const { model, fm, name } = src;
  const head = src.head || model;
  return renderPage(model, {
    name,
    handle: ctx.handle || '',              // → the footer's feelreef.com/signup?ref=<handle>
    icons: ICONS,
    assets: model.assets,        // the card's own images, resolved to data: URIs at render…
    // …or, for an id in this CALLER-supplied map (tile#339, only the page exit below sets it), to that
    // picture's own content-addressed path. Absent: every picture inline, byte for byte as before.
    assetUrls: ctx.assetUrls || undefined,
    // tile#339 measurement prototype (asset-urls.mjs picturePlan): preloads, reserved boxes and the
    // after-paint switch for by-URL pictures. CALLER-supplied, like assetUrls; absent: nothing is written.
    pictures: ctx.pictures || undefined,
    css: CSS,
    arrow: ARROW,           // @cvernet/signet's own arrow, lifted at build time — never re-drawn
    // `arrows: on` puts the little arrow back on link rows and CTAs. DEFAULT OFF — see arrowOf.
    arrows: fm('arrows'),
    cardUrl: ctx.cardUrl || '',
    // favicon + apple-touch-icon — see card-icon.mjs. Addressed off cardUrl, so none without one.
    iconLinks: iconLinks(head, { cardUrl: ctx.cardUrl || '' }),
    // og:* / twitter:* / description / canonical — see card-share.mjs. Same rule: none without cardUrl.
    // reef#2725 r3 — the address a preview claims is the CANONICAL one (ctx.canonicalUrl, which the
    // Worker sets from cardUrlFor and the switch), not whichever host answered. Absent = cardUrl.
    // …and for one window of Cards served in windows (the page exit's `ctx.windowUrl`, CALLER-supplied,
    // windows after the first only), the canonical is that window's own address; everything else is the Cards'.
    shareTags: windowCanonical(shareTags(head, { name, cardUrl: ctx.canonicalUrl || ctx.cardUrl || '' }), ctx.windowUrl),
    since: fm('since'),
    accent: fm('accent'),
    theme: fm('theme'),                    // `theme: light|dark` pins it; absent follows the reader
    poweredBy: fm('powered-by') === 'on',   // opt-in referral credit; default off (see card-render)
    // 🔴 CALLER-supplied, never authored: is this Card in the card pool (reef#2913)? Only the
    // Worker's own call site may set it — no frontmatter key, query or header maps here. true/false
    // overrides `powered-by` (card-render poolOf); anything else is absent = today's page.
    pool: poolOf(ctx),
    radius: fm('radius'),                  // `radius: square` keeps a creator's square-corner look
    // `header: left` puts the avatar beside the text instead of above it. Centred is the DEFAULT
    // because 10/10 surveyed platforms centre it — but that evidence justifies a default, not the
    // removal of the alternative, and one live card wants the arrangement it already had.
    header: fm('header'),
    // `icons: mono` greys every FETCHED brand mark on the card — the social row and the link rows.
    // Colour is the default, and iOS is the precedent rather than a counter-example: its icon
    // appearance is Default / Dark / Clear / Tinted, so it ships colour and offers monochrome. Same
    // shape as every other switch here — a surveyed default the author can overrule.
    // 🔴 Only fetched marks. Our own drawn glyphs already follow the theme; greying them would be
    // desaturating a colour we chose on purpose.
    iconStyle: fm('icons'),
    // `lang: zh-TW` — the document's language. Defaults to `en` in the renderer.
    lang: fm('lang'),
    // `generator: off` opts out; any other value replaces it. Default ON — see card-render.
    generator: fm('generator'),
    backdrop: fm('backdrop'),              // a fixed page-背景 image behind the card
    // 🔴 raw, NOT Number(). resolveBackdropDim() is the single place that decides what a bad value
    // means, and it must be able to tell "the author wrote 48%" from "the author wrote nothing" —
    // coercing here would hand it a NaN with the evidence already thrown away.
    backdropDim: fm('backdrop-dim'),
    // channel id → { id, title } for "my latest video", resolved by the fetch handler BEFORE this
    // ran. Absent is the normal case for a card with no video, and the honest case when YouTube
    // could not be reached — the block falls to its degraded state either way.
    videos: ctx.videos || {},
    // 🔴 CALLER-supplied, not authored — the only ctx field here that does not come from the card.
    // cardtile-w asks for `data-cell` indices so it can map a box on screen back to a cell in the
    // file; the Worker never sets it, so a served card is byte-identical with the flag absent.
    editIndex: !!ctx.editIndex,
    // 🔴 CALLER-supplied: the destination registry (see card-render.mjs `attrUrl`). Absent in serving.
    onDestination: typeof ctx.onDestination === 'function' ? ctx.onDestination : undefined,
    // a value whose scheme the Card refuses to write (card-render cardHref / cardImg) — a save refuses it
    onRefusedDestination: typeof ctx.onRefusedDestination === 'function' ? ctx.onRefusedDestination : undefined,
    destinationBase: ctx.destinationBase || undefined,   // round 6: the real card address the registry resolves against
    // …and its companion: the words on the two EDIT-ONLY placeholders (a link with no address, a
    // picture cell with no picture). Only meaningful with editIndex; the Worker never sets either.
    editStrings: ctx.editStrings || null,
    // 🔴 CALLER-supplied, the page exit's only (reef#3361, serve/size-tier.mjs): which window of Cards served
    // in windows this is, and whether the platform's closing reef.cards tile is drawn here (the last one
    // only). Absent — every page at or below the tier, and every other caller — the page as it was.
    ...(ctx.pager ? { pager: ctx.pager } : {}),
    ...(ctx.poolTile === false ? { poolTile: false } : {}),
    qrScriptSrc: QR_PATH,                // external script → the page consumes the coral, unmodified
    drawerScriptSrc: DRAWER_PATH,          // ditto: the overlay's behaviour, shared with any Site
  });
}

// 🔴 PREVIEW deployments must not be indexed. A preview card is a byte-for-byte duplicate of the
// card it previews, so letting search engines index both splits the ranking between them — and for
// an ingest DEMO (a creator's page rebuilt to show them what it'd look like here) an indexed copy
// would compete with that creator's own live page. Production sets PREVIEW=false in its vars.
// reef#2044 ⑤ — site-wide kill switch. CARD_NOINDEX_ALL=1 (or "true") puts `X-Robots-Tag: noindex` on
// EVERY card response of the deployment, vanity hosts included; unset/anything else = off. It is a
// deployment-wide valve (Search Console warns → flip it the same day); it is NOT a per-card state.
export const noindexAll = (env) => !!env && /^(1|true)$/i.test(String(env.CARD_NOINDEX_ALL ?? '').trim());

// reef#2044 ③ — `card.feelreef.com/.well-known/security.txt` (RFC 9116), so a problem on a Card is
// reported by whoever finds it rather than discovered by us late.
//
// 🔴 Contact is the PUBLIC REPORT FORM, and there is no mailbox in this file. The ticket's two lines
// are 「指向檢舉表單」 and 「不放客服信箱（零客服原則）」: feelreef.com/report is public, needs no
// login, and writes into the same inbox feelreef's own pages report into. (feelreef.com's own
// security.txt lists mailboxes; that is a different host with a different ruling.)
//
// 🔴 Canonical host ONLY — never a creator's vanity domain. The ticket names this exact URL, and the
// same ruling says no report element goes on an author's card; our contact on THEIR domain would be
// one. A vanity host keeps the ordinary 404.
//
// 🔴 Expires is mandatory, so this constant is BORN TO ROT. card-security-txt.test.mjs goes red 90
// days before the date: re-check that the form still answers, then move the date (≤ 1 year out).
// No Preferred-Languages: the ticket does not ask for it, and the form itself speaks nine.
const SECURITY_TXT_PATH = '/.well-known/security.txt';
const SECURITY_TXT = [
  '# REEF with Card — report a problem with a Card on this host (RFC 9116).',
  '# The form is public and needs no account.',
  'Contact: https://feelreef.com/report',
  `Canonical: https://${CANON_HOST}${SECURITY_TXT_PATH}`,
  'Expires: 2027-10-01T00:00:00.000Z',
  '',
].join('\n');

const isPreview = (env) => !env || String(env.PREVIEW ?? 'true') !== 'false';

// 🔴 A DEMO of somebody else's page is never indexed, on ANY deployment.
//
// The rule above only covers preview DEPLOYMENTS. A pitch demo — a creator's existing page rebuilt
// so they can see what it would look like here — is the case that comment already names: an indexed
// copy would compete with that creator's own live page, in search, for their own name. And unlike a
// preview deployment, a demo is deliberately reachable on production, because the whole point is to
// send someone a link that works.
//
// So the noindex follows the HANDLE, not the deployment. `demo-` is a reserved prefix.
const isDemo = (handle) => /^demo-/.test(String(handle || ''));

// reef#2044 ④ — `blank` = the card is still only the blank template (card-blank.mjs says what that
// means, from the code that writes blank cards). Not indexed until its author puts something on it;
// the moment they do, the next request answers without the header. Judged on CONTENT, never on
// account age. It only ever ADDS a header: the stricter rule above it is never weakened.
//
// reef#2725 — the host. The OLD shared host (card.feelreef.com) carries Cards nobody has vouched for
// on the product's own domain, so a Card there is `noindex, nofollow` (tile c7aa65e) in both switch
// positions — after the move it only 301s anyway. reef.cards (the switch, canonicalHost) is the
// user-content domain with its own reputation, and there the project's ruling on Cards applies as
// written: a Card is searchable (2026-10-13 「Card 維持可以被搜尋到」); the ONLY content-based
// exception is the blank template (2026-10-14 gatekeeper list: 「空白樣板卡 noindex」). Before the
// move reef.cards keeps the old rule — and is never asked about here: dark, it answers nothing, and
// in the open stage (tile#299) its answer is the old host's, asked as the old host, with
// `noindex, nofollow` set over whatever this returned (openStageAnswer).
//
// tile-lab#51 (product owner 2026-10-30): 「根頁那張 feelreef 自己的卡開索引；客戶的卡維持整主機
// noindex」— the host-wide noindex was explicitly 「直到…搬去獨立 usercontent 網域那天」, and
// reef.cards is that domain (reef#2725, 2026-10-31: 「reef.cards 上的免費 Card 預設可索引」). The
// root card is OURS: indexable on both card hosts in both switch positions.
// A no-card 404 on reef.cards carries no header: the 404 status already keeps it out of an index
// (the same reasoning the old host's missing root card already follows).
/** robotsTag: ({ env, host, handle, vanity, blank }) → the X-Robots-Tag value, or null. Pure. */
export function robotsTag({ env, host, handle, vanity = false, blank = false }) {
  if (isPreview(env) || isDemo(handle)) return 'noindex, nofollow';
  if (!vanity && !(handle === ROOT_HANDLE && hasRootCard(host))) {
    if (host !== CARDS_HOST || !movedToCardsHost(env)) return 'noindex, nofollow';
  }
  return blank ? 'noindex' : null;
}
// `at` = { host, vanity } of the request: where the card is being served, which robotsTag needs
const ROBOTS_HEADERS = (env, handle, at = {}, blank = false) => {
  const tag = robotsTag({ env, host: at.host, handle, vanity: !!at.vanity, blank });
  return tag ? { 'X-Robots-Tag': tag } : {};
};

// 🔴 `Vary: Accept` on EVERY response the card path can produce, including the HTML one.
//
// One URL now answers with two different bodies depending on Accept, and the edge caches for 60s.
// Without Vary the first response wins for everyone: a browser gets markdown, or an agent gets HTML,
// for up to a minute, at random. Putting it only on the markdown response is the version that looks
// right and still breaks — the HTML response is the one that gets cached first, because that is what
// people request.
const CARD_HEADERS = (env, handle, at, blank = false) => ({
  'Cache-Control': 'public, max-age=60',
  Vary: 'Accept',
  // (the CARD_NOINDEX_ALL header is NOT added here: withNoindexAll wraps every exit, see the bottom)
  ...ROBOTS_HEADERS(env, handle, at, blank),
});

// tile#298 — the visitor's language, for the page CHROME of a card that declares no `lang:`: `?lang=`,
// then the older `?locale=`, then Accept-Language, then English. One rule with the editor's two routes
// below (and the same matcher, sandbox-i18n's): a visitor who arrives speaking Japanese gets Japanese
// buttons on the card page and in the editor alike.
const visitorLocale = (params, request) => primaryLocale(params.get('lang') || params.get('locale')
  || localeFromAcceptLanguage(request.headers.get('accept-language')));

// 🔴 …and the cache rule that comes with it. A card page whose words follow the visitor differs by
// Accept-Language, so it says so — beside Accept, never instead of it (see CARD_HEADERS). Nothing else
// keys this page: the Worker keeps no copy of rendered HTML (caches.default holds the /_icon/, /_yt/
// and avatar relays under their own image URLs and, while the local picture switch is set, a page's own
// pictures under their lifetime and hash — picture-cache.mjs — never a page), and `?lang=` is in the URL, which is every
// cache's key already. A card that declares `lang:` does not vary, and its headers stay exactly as they were.
const VARY_VISITOR_LANG = { Vary: 'Accept, Accept-Language' };

const html = (body, status = 200, env = null, handle = '', at = {}, blank = false, extra = {}) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CARD_HEADERS(env, handle, at, blank), ...extra },
  });

// 🔴 `X-Card-Handle: <handle>` — on a creator's OWN domain, on the card it serves (the page and both
// markdown exits), and nowhere else: never the canonical hosts, a 404, an icon or an unbound host.
// reef's domain tool reads it as the proof that the domain answers as THIS card (a proxied CNAME hides
// that from public DNS), including in the `redirect: false` state the probe runs in. The value is the
// handle the binding resolved to, and only ever one inside the handle grammar (vanityHandle is checked
// before it means anything), so a stored value can never make the header itself throw.
const cardHandleHeader = (vanityHandle) => (vanityHandle && VALID_HANDLE.test(vanityHandle) ? { 'X-Card-Handle': vanityHandle } : {});

// ── "no card here" (tile-lab#51) ─────────────────────────────────────────────────────────────────
//
// 🩸 It was `<p>No card for “zlingart”.</p>`, `<p>Nothing here.</p>`, `<p>Pick a card: …</p>` and, for
// a stopped card, `<p>This Card is unavailable.</p>` — bare HTML on the two doors a stranger most
// often walks through (a mistyped share link; a cut-off one). So it is a Card now, drawn by the same
// renderer and CSS as every Card, from a constant: no handle, nothing the request said, in it.
//
// 🔴 ONE PAGE FOR EVERY "NO CARD" (product owner 2026-10-30): a stopped (retired) Card and a handle that
// never existed answer byte for byte the same, headers included — 「退役的人要的是消失，不留
// unavailable 墓碑」. Two wordings would let anyone probe who was taken down. That is why the page
// echoes nothing: if it named the handle, "identical" would hold only per handle.
//
// 🔴 NO 「make a card with this name」 BUTTON, on purpose and for now. The ruling allows it only where
// the name can really be registered, and this Worker cannot know that: the reserved words and the
// ledger (a retired name stays its owner's) live in RSP (`shared/reserved-slugs.ts`,
// `platform-registry-cards.ts`), whose own rule is that nobody keeps a second copy of the list.
// A button decided from half the facts would invite people to names that then refuse them.
//
// tile#340 — three things that page did not do, each written so the rule above still holds. The page
// is a function of exactly two things, and neither is the handle or the reason nothing is there:
//
//   · the visitor's LANGUAGE (visitorLocale — the rule a page's chrome already follows, tile#298).
//     The sentence, `<html lang>` and the deck's own words are one language: a locale with no
//     sentence of its own (NOT_FOUND_WORDS) gets the English page whole, never a page in two
//     languages. Every answer says `Vary: Accept, Accept-Language`, the English one included: a
//     shared cache holding the English page must not hand it to the next visitor, and a header set
//     on some answers only would be one more thing to tell two answers apart by.
//   · the host the visitor ASKED (`face`). On reef.cards the page names and links reef.cards and
//     nothing else; on the older hosts it keeps the name it had. `face` is the visitor's host in the
//     open stage too (tile#299), where the request itself is re-addressed to the old host.
//
// `views: stack` — one view, so the deck draws no switcher (deck.js: "one view = nothing to switch")
// and a visitor's stored pick of another view is not offered: there is nothing here to see three ways.
// The sentence names no product: "Cards" is a name, never a count, so it says only that nothing is here.
export const NOT_FOUND_WORDS = {
  en: 'Nothing here.',
  zh: '這裡什麼都沒有。',
  ja: 'ここには何もありません。',
  ko: '여기에는 아무것도 없습니다.',
  'zh-Hans': '这里什么都没有。',
  de: 'Hier ist nichts.',
  fr: "Il n'y a rien ici.",
  es: 'Aquí no hay nada.',
  pt: 'Não há nada aqui.',
};
const notFoundHome = (face) => (face === CARDS_HOST
  ? { name: CARDS_HOST, url: `https://${CARDS_HOST}/` }
  : { name: 'feelreef', url: `https://${APEX_HOST}/` });
const notFoundSource = (locale, face) => {
  const key = Object.hasOwn(NOT_FOUND_WORDS, locale) ? locale : 'en';
  const home = notFoundHome(face);
  return [
    '---', `title: ${home.name}`, `lang: ${SANDBOX_LOCALES[key].lang}`, 'views: stack', 'generator: off', '---', '', '## grid', '',
    `- [ ] %% card: text %% ${NOT_FOUND_WORDS[key]}`,
    `- [ ] %% card: link w=6 %% [${home.name}](${home.url})`,
    '',
  ].join('\n');
};
// 🔴 …except on a creator's OWN domain, where an unknown path (`/wp-login.php`, `/robots.txt`) stays
// the small 404 it was (card-icon.test.mjs catch-all, reef#1090): bots probe those all day, and a
// feelreef page is not ours to put on somebody's domain. It names nothing, so it leaks nothing.
const SMALL_404 = '<!doctype html><meta charset=utf-8><title>Not found</title><p>Nothing here.</p>';
// `who` = { locale, face }: the visitor's language and the host they asked. `handle` and `at` reach
// the robots header only (robotsTag), never the body.
const notFound = (env, handle = '', at = {}, who = {}) =>
  html(withServiceTry(renderCardHTML(notFoundSource(who.locale, who.face), { handle: '', cardUrl: '' }), env), 404, env, handle, at, false, VARY_VISITOR_LANG);

/**
 * withServiceTry: (a rendered page, env) → the same page whose "make your own" address is the editor
 * on the service host. Only in serviceHostStage 'split'; otherwise the page is returned as it is.
 *
 * 🔴 WHY HERE AND NOT IN THE RENDERER. The address is written by w3/deck-page.mjs withDeck
 * (`window.__deckTry`, from DECK_TRY_URL), and the renderer is part of the editor's own inline module
 * (gen-edit3-assets.mjs bundles it for the preview). A setting threaded through the renderer changes
 * that module, and with it `/try/edit` on every host whatever the setting says. So the Worker rewrites
 * the one line, after the render: the LAST boot line of the page. withDeck writes it before the page's
 * own closing `</body>`, after everything a person wrote — and what a person wrote can never hold the
 * line anyway (in the page it is escaped; in the boot script it is inside a JSON string).
 * When the split is permanent, DECK_TRY_URL becomes the service address and this function goes.
 */
const SERVICE_TRY_URL = 'https://cards.feelreef.com/try/edit';   // SERVICE_HOST + SANDBOX_PATH, as one literal
function withServiceTry(page, env) {
  if (!splitHosts(env)) return page;
  const was = `window.__deckTry=${JSON.stringify(DECK_TRY_URL)};`;
  const i = page.lastIndexOf(was);
  return i < 0 ? page : `${page.slice(0, i)}window.__deckTry=${JSON.stringify(SERVICE_TRY_URL)};${page.slice(i + was.length)}`;
}

// tile#340 — the reef.cards origin's own icon files, for when the platform's page is not there to
// lend its picture (not saved yet, or stopped). `/favicon.ico` and `/apple-touch-icon.png` are asked
// of an origin by every tab, bookmark and home-screen shortcut whether or not a page links them, and
// every page on the origin shares them — so they answer an image, drawn by the one badge every other
// icon here comes from (card-icon.mjs iconFile → icon-core), from the origin's name and nothing a
// guest wrote. Only the reef.cards face, and only the three origin-level paths: a handle's own
// `/<handle>/favicon.ico` with nothing behind it stays the bare 404.
const ORIGIN_MARK = { name: CARDS_HOST, accent: '' };
const NO_TILES = { cells: [], assets: {} };

// A card's own markdown, served as itself. See docs/SPEC-card-mcp.md §4.
//
// Cloudflare's Markdown for Agents exists because the web's content is HTML and agents want
// markdown, so the platform interposes a converter: "fetch the original HTML version from the
// origin, and convert it to Markdown". For a Card that is backwards — the markdown IS the original
// and the HTML is the derivative. Nothing is converted here; the file is handed over.
//
// Their header names are borrowed on purpose rather than invented: an agent should learn what a
// document costs BEFORE it spends the context on it. Both counts are estimates (chars/4, the usual
// heuristic) and are labelled as such rather than implying a tokeniser we do not run.
const estTokens = (s) => Math.ceil(s.length / 4);

const markdown = (body, { env, originalLength, alternate, handle, at, blank, extra = {} }) =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // tile#372 — a file is what a person wrote: a browser must never take it for anything but markdown
      'X-Content-Type-Options': 'nosniff',
      'X-Markdown-Tokens': String(estTokens(body)),
      'X-Original-Tokens': String(estTokens(originalLength)),
      ...(alternate ? { Link: `<${alternate}>; rel="alternate"; type="text/markdown"` } : {}),
      ...CARD_HEADERS(env, handle, at, blank),
      ...extra,
    },
  });

/** does this client want markdown? `Accept: text/markdown` — the convention, not a query param. */
const wantsMarkdown = (request) => /(^|,)\s*text\/markdown\b/.test(request.headers.get('accept') || '');

// ── the Card editor: card.feelreef.com/try/edit (sandbox) and /edit?host= (host mode) ────────────────
//
// One editor, two modes (packages/cardtile/w3/edit3.mjs, bundled into edit3-assets.mjs by
// gen-edit3-assets.mjs). Nothing goes live until Save, and the draft lives in the visitor's browser.
//
// 🔴 A STATIC PATH, not a handle. `/try` is not a KV row — nothing is ever read from or written to
// the CARDS store for this route, on purpose: RSP reserves the handle `try` (a real card can never
// register it), and this Worker's own store is a separate, unrelated namespace where the string
// "try" has never been and must never be a key. Anyone visiting bare `card.feelreef.com/try` (no
// `/edit`) gets the same no-card 404 every other never-registered handle gets (notFound).
const SANDBOX_PATH = '/try/edit';
// `/try/edit2` is a RETIRED path an earlier editor was staged under. It is kept as a 301 (not removed
// outright) so nothing that already linked to it (bookmarks, notes, anything typed by hand) breaks.
const LEGACY_EDIT2_PATH = '/try/edit2';
// The files the editor borrows as they ship (the family text editor, its web shim and host, the two
// stylesheets it is mounted with, Sortable for the wall) and the porch faces, each under its own
// content hash: `/try/edit/a/<hash>/<name>`, immutable. A hash that is not the current file's is a 404,
// never the current file under an old name — an immutable answer has to be the bytes it names.
const EDITOR_ASSET_RE = /^\/try\/edit\/a\/([0-9a-f]{12})\/([\w./-]+)$/;
const EDITOR_ASSET_BASE = '/try/edit/a/';
const ASSET_MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};
const editorAssetUrl = (name) => `${EDITOR_ASSET_BASE}${BORROWED[name].hash}/${name}`;
// where the sandbox's Save parks the file on its way out (the route is further down)
const PARK_PATH = '/try/park';
/**
 * isServicePath: is this path a page or a door of the SERVICE, as opposed to something a person wrote?
 * The sandbox, its retired path, host mode, the park and the editor's hashed files. (`/_api/…` is the
 * service's too and is decided on its own; `/_preview/<id>` is what a person wrote.)
 */
const isServicePath = (p) => p === SANDBOX_PATH || p === `${SANDBOX_PATH}/` || p === LEGACY_EDIT2_PATH || p === `${LEGACY_EDIT2_PATH}/`
  || p === HOST_EDIT_PATH || p === `${HOST_EDIT_PATH}/` || p === PARK_PATH || p.startsWith(EDITOR_ASSET_BASE);
/** the temporary redirect a bare root gets while there is no home page: the editor, with the query carried */
const toServiceEditor = (url) => new Response(null, { status: 302, headers: { Location: `${SERVICE_TRY_URL}${url.search}`, 'Cache-Control': 'no-store' } });
const PREVIEW_RE = /^\/_preview\/([0-9a-f]{32})$/;
const API_PATH = '/_api';
// GET and HEAD may be answered with a page or a redirect; nothing else may
const isRead = (method) => method === 'GET' || method === 'HEAD';

/**
 * hostBoundary: (env, host, pathname, method) → null | verdict. Pure — it reads no store and no body.
 * The ONE decision about what the service's host, the people's host and (after the split) the legacy
 * host may answer, taken before any handler runs, for every method. null = this request is not the
 * boundary's to refuse: the handlers below answer it as they answer it on any host.
 *
 * 🔴 TWO RULES, each for EVERY method (a browser can be sent anywhere with a cross-origin form POST,
 * and a route that only checks GET is open to it):
 *
 *   the service's host never renders, reflects or reads anything a person wrote;
 *   the people's host never answers a service endpoint.
 *
 * The service's host (serviceHostStage 'open' and 'split') is an ALLOWLIST — a path that is not named
 * here never reaches a handler:
 *
 *   /_api/…, /try/park           the two endpoints: passed whatever the method (each refuses the
 *                                methods and callers it does not take, and neither answers with a page)
 *   any other method than GET/HEAD   405, empty
 *   /                            302 → the editor
 *   the editor's pages and hashed files, the deck's and the corals' files, the two image relays
 *                                passed (none of them reads the store)
 *   /_preview/<id>               302 → the same path on the people's host. A preview is what a person
 *                                wrote: it is rendered there, never here
 *   a handle-shaped path, or one of the origin's icon files
 *                                301 → the same address on the people's host, which knows
 *   anything else                the nothing-here page
 *
 * The people's host (reef.cards, 'split' only — before the cutover it is dark or a read-only mirror,
 * see cardsHostStage):
 *
 *   /_api, /_api/…               404, empty, before auth: it does not say whether a caller was authorised
 *   the editor's pages and files, the park
 *                                GET/HEAD: 301 → the same path on the service's host; else 404, empty
 *   /  (GET/HEAD)                302 → the editor
 *   anything else                null: what people wrote, and this host's own doors
 *
 * The legacy host (card.feelreef.com, 'split' only). It still serves the editor in place — host mode,
 * and the sandbox at `?stay=1` — so the first rule is its rule too:
 *
 *   GET/HEAD                     null: movedTo redirects it, or it is one of the answers in place
 *   /_api/…, the editor's pages and hashed files, the park
 *                                null: answered in place, as before the split, whatever the method
 *   any other method, any other path   405, empty — a page, a preview and every other address that
 *                                moved are not rendered or read here for a POST
 *
 * Before the split (serviceHostStage 'off' and 'open') the legacy host is none of this function's.
 *
 * verdict: { answer: 'refused' }            404, empty
 *          { answer: 'method' }             405, empty
 *          { answer: 'editor' }             302 → the editor on the service's host, query carried
 *          { answer: 'moved', status, to, query }   → https://<to><same path>(+ query)
 *          { answer: 'nothing' }            the nothing-here page
 */
export function hostBoundary(env, host, pathname, method) {
  const stage = serviceHostStage(env);
  if (stage === 'off') return null;
  host = hostName(host);   // tile#378: one name, whatever the case, port or trailing dot (hostName)
  const p = String(pathname || '/');
  const reading = isRead(method);
  if (host === SERVICE_HOST) {
    if (p.startsWith(`${API_PATH}/`) || p === PARK_PATH) return null;
    if (!reading) return { answer: 'method' };
    if (p === '/') return { answer: 'editor' };
    if (isServiceRead(p)) return null;
    if (PREVIEW_RE.test(p)) return { answer: 'moved', status: 302, to: canonicalHost(env), query: false };
    const seg = p.split('/')[1] || '';
    const named = (CARD_SEGMENT_RE.test(seg) && !notCardSegment(seg.replace(/\.md$/i, ''))) || (!!iconKind('/' + seg) && p === '/' + seg);
    return named ? { answer: 'moved', status: 301, to: canonicalHost(env), query: true } : { answer: 'nothing' };
  }
  if (stage === 'split' && host === CARDS_HOST) {
    if (p === API_PATH || p.startsWith(`${API_PATH}/`)) return { answer: 'refused' };
    // a page goes to the same path on the service host; a write (the park) is not carried there
    if (isServicePath(p)) return reading ? { answer: 'moved', status: 301, to: SERVICE_HOST, query: true } : { answer: 'refused' };
    // no handle: temporary, because a home page will stand here later
    if (p === '/' && reading) return { answer: 'editor' };
  }
  if (stage === 'split' && host === CANON_HOST) {
    if (reading || p.startsWith(`${API_PATH}/`) || isServicePath(p)) return null;
    return { answer: 'method' };
  }
  return null;
}
/**
 * isServiceRead: the paths the service's host answers a GET/HEAD on with a handler of its own — each
 * matched EXACTLY as its handler matches it, so nothing passes the boundary and then finds no handler.
 * (The relays carry a brand's mark and a video's poster, raster only: the editor's preview draws them.)
 */
const isServiceRead = (p) => p === SANDBOX_PATH || p === `${SANDBOX_PATH}/` || p === LEGACY_EDIT2_PATH || p === `${LEGACY_EDIT2_PATH}/`
  || p === HOST_EDIT_PATH || p === `${HOST_EDIT_PATH}/` || EDITOR_ASSET_RE.test(p)
  || p === QR_PATH || p === DRAWER_PATH || p === DECK_JS_PATH || p === DECK_CSS_PATH
  || ICON_RELAY_RE.test(p) || YT_RELAY_RE.test(p);
const METHOD_REFUSED = () => new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });

const escLite = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** one borrowed file or face, or null. Never reads anything but the bundled module. */
function editorAsset(hash, name) {
  const font = FONT_FILES[name];
  if (font && font.hash === hash) return { body: Uint8Array.from(atob(font.b64), (c) => c.charCodeAt(0)), ext: '.woff2' };
  const f = BORROWED[name];
  if (f && f.hash === hash) return { body: f.body, ext: name.slice(name.lastIndexOf('.')) };
  return null;
}

// ── HOST MODE: card.feelreef.com/edit?host=<parent origin> ──────────────────────────────────────
//
// The same editor, embedded by feelreef's own page to edit a REAL card. Owner architecture: reef
// decides WHO may edit (seats in its registry); this Worker owns storage and assembly; the browser
// never holds a bearer. So this route serves a page with NO card in it and NO credential — the card
// arrives from the parent over postMessage and goes back the same way (w3/host-bridge.mjs), and the
// parent does the save through `save_cards`. Like /try/edit it never touches the CARDS store.
//
// `?host=` must be one of the allowed parent origins (validHostOrigin); it is written into the
// page's opts, used as the ONLY postMessage target and origin the editor accepts, and as the one
// ancestor allowed to frame this page (CSP frame-ancestors).
const HOST_EDIT_PATH = '/edit';

/** the /try/edit page (or, with `host`, the /edit page), localised. Never touches the CARDS store. */
function editorHtml(localeKey, { host = '' } = {}) {
  const persona = SANDBOX_LOCALES[localeKey] || SANDBOX_LOCALES.en;
  const assets = Object.fromEntries(['editor-core.js', 'obsidian-shim.js', 'web-host.js', 'Sortable.min.js'].map((n) => [n, editorAssetUrl(n)]));
  const opts = JSON.stringify(host
    ? { host, sandbox: false, locale: localeKey, assets }
    : { sandbox: true, locale: localeKey, assets }).replace(/</g, '\\u003c');
  // 🔴 Nothing is fixed on screen for the sandbox (no banner): Save, with no account behind it, is the door to
  // the real thing, and the "kept in this browser" line lives at the top of Cards options.
  const body = EDIT3_BODY_HTML;
  return `<!doctype html>
<html lang="${persona.lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escLite(host ? persona.hostPageTitle : persona.pageTitle)}</title>
<style>${EDIT3_BASE_CSS}</style>
<link rel="stylesheet" href="${editorAssetUrl('family.css')}">
<link rel="stylesheet" href="${editorAssetUrl('modaltile.css')}">
<style>${EDIT3_CSS}</style>
</head>
<body>
${body}
<script>
window.__CARDTILE_W3_OPTS__ = ${opts};
<\/script>
<script type="module">${EDIT3_JS}<\/script>
</body></html>`;
}

/**
 * reportedHandle: (a Card address, env) → the handle it names, or null. For the report's inbox line
 * (reef#2758: 「自動附 handle」), worked out here and never taken from the form.
 *
 *   reef.cards/<h>, card.feelreef.com/<h>   by path, exactly as resolveHandle routes them (bare = root)
 *   feelreef.com/<h>                        the old apex address, when it is handle-shaped and not a site page
 *   anything else                           a Card on its own domain: its live binding, read the way the
 *                                           router reads it (a binding from an ended lifetime is none)
 *
 * Best effort: an unknown address still files the report, with the handle left for a person to find.
 */
async function reportedHandle(u, env) {
  const host = u.hostname.toLowerCase();
  if (host === APEX_HOST) {
    return APEX_HANDLE_PATH.test(u.pathname) && !isApexSitePath(u.pathname)
      ? u.pathname.replace(/^\/|\/$/g, '').toLowerCase() : null;
  }
  if (host === CARDS_HOST || host === CANON_HOST) {
    // once reef.cards' bare root is a redirect (serviceHostStage 'split') it names no handle
    return resolveHandle(host, u.pathname, {}, new Set(), { rootPage: !(host === CARDS_HOST && splitHosts(env)) })?.handle ?? null;
  }
  const store = env && env.CARDS;
  if (!store || !vanityHost(host)) return null;
  const pointer = await store.get(VANITY_KEY(host));
  if (pointer == null || !VALID_HANDLE.test(pointer)) return null;
  const gen = await generationOf(store, pointer);
  return (await isBound(store, pointer, gen, host)) ? pointer : null;
}

// ── tile#299: the open stage on reef.cards ──────────────────────────────────────────────────────
//
// What reef.cards answers when CARDS_HOST_OPEN is on and the cutover is not (cardsHostStage 'open'):
// a visitor's read of a Card, and the files that Card's page loads, answered BY THE OLD HOST — the
// request is re-addressed to card.feelreef.com and run through this same router, so it is the same
// store read and the same render by construction, not by a second code path kept in step with the
// first. Every address that answer carries (canonical, og:url, the QR's data-url, the icon links, the
// download link, a redirect's Location) is therefore the old one: a QR printed from a page seen on
// reef.cards in this stage carries card.feelreef.com. The one thing added is the robots header.
// tile#340 — and two things are the visitor's host's, not the old one's, because they are about the
// origin and not about any handle: the name on the nothing-here page, and the origin's own icon files when
// the platform's page is not there (`askedOn` below; see notFound and ORIGIN_MARK). No handle's address
// is among them, so the sentence above about a printed QR still holds.
//
// 🔴 An ALLOWLIST, so a route added to this router later is dark here until somebody decides
// otherwise: a page that fails to load during the comparison is visible, a write door that quietly
// opened on a host nobody was watching is not.
//
//   GET/HEAD only                      the stage is read-only for visitors
//   /_deck/…, /_coral/… (versioned)    the deck and corals every Card page loads by a relative path
//   /_icon/<domain>.ico, /_yt/<id>.jpg the relays a Card page loads by a relative path
//   / and /<handle-shaped>[…]          the Card exits: page, thin and fat markdown, avatar, icons, the
//                                      root card and its icon files — whatever card.feelreef.com
//                                      answers for that path, its 404 included
//
// Dark here, each for a reason (the full table is card-open-stage.test.mjs):
//   /_api…           the write API stays where it is; its answers echo the host they were asked on
//   /report          a write door, and it is reef.cards' own page (it names reef.cards as home)
//   security.txt     on reef.cards it would claim reef.cards as its Canonical (RFC 9116)
//   /edit, /try/…    the editor, its files, the retired path and the park: not a Card, and the
//                    cutover reaches /try/edit on reef.cards only through the old host's 301
//   /_preview/…      handed out by the write API on the host it was asked on, which is the old one
//   anything else    /robots.txt, /.well-known/…, any path whose first segment is not handle-shaped
const OPEN_STAGE_ROBOTS = 'noindex, nofollow';
const ICON_RELAY_RE = /^\/_icon\/([^/]+)\.ico$/;
const YT_RELAY_RE = /^\/_yt\/([A-Za-z0-9_-]+)\.jpg$/;
const CARD_SEGMENT_RE = /^[a-z0-9][a-z0-9-]{0,62}(\.md)?$/i;
/** the first path segments that are this Worker's own routes on the old host, never a Card */
const notCardSegment = (seg) => [HOST_EDIT_PATH, SANDBOX_PATH, REPORT_PATH].some((p) => p.split('/')[1] === seg.toLowerCase());

/** openStageMirrors: (pathname, method) → does reef.cards answer this in the 'open' stage? Pure. */
export function openStageMirrors(pathname, method) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const p = String(pathname || '/');
  if (p === QR_PATH || p === DRAWER_PATH || p === DECK_JS_PATH || p === DECK_CSS_PATH) return true;
  if (ICON_RELAY_RE.test(p) || YT_RELAY_RE.test(p)) return true;
  if (p === '/') return true;
  const seg = p.split('/')[1] || '';
  if (iconKind('/' + seg) && p === '/' + seg) return true;          // the root card's icon files
  return CARD_SEGMENT_RE.test(seg) && !notCardSegment(seg.replace(/\.md$/i, ''));
}

/** the old host's answer to the same request, plus the open stage's robots header */
async function openStageAnswer(request, url, env, ctx) {
  const at = new URL(url.href);
  at.hostname = CANON_HOST;
  // GET/HEAD only (openStageMirrors), so there is no body to carry
  const res = await router.fetch(new Request(at.href, { method: request.method, headers: request.headers }), env, ctx, url.hostname);
  const headers = new Headers(res.headers);
  headers.set('X-Robots-Tag', OPEN_STAGE_ROBOTS);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const router = {
  // `askedOn` is set by openStageAnswer alone: the host the visitor asked, when this request is its
  // re-addressed twin. The Worker's own entry (the default export) never passes it.
  async fetch(request, env, ctx, askedOn) {
    const url = new URL(request.url);
    // 🔴 The domain asked for is the request URL's, never a `Host` header that disagrees with it. On
    // Cloudflare the two are the same; but X-Card-Handle is a promise about WHICH domain serves which
    // card, so its identity comes from one authority. (`hostname` is lowercase and port-free.)
    // tile#378: with the service host on, the three roles are decided by name, so the trailing dot of
    // a fully qualified name is dropped once, here, before every comparison (hostName). Off, the host
    // is read exactly as before.
    const hosts = serviceHostStage(env);
    const reqHost = hosts === 'off' ? url.hostname : hostName(url.hostname);
    // tile#340 — the host whose name the nothing-here page and the origin's icon files wear. It decides
    // those words and nothing else: routing, the store and every address a page carries read reqHost.
    const face = askedOn || reqHost;
    // A route can be installed before cutover. Before it, reef.cards is dark (cardsHostStage 'dark'),
    // or (tile#299, 'open') a read-only mirror of the old host for the routes a Card page needs, and
    // dark for every other route. Nothing below this line ever sees reef.cards outside the cutover.
    if (reqHost === CARDS_HOST) {
      const stage = cardsHostStage(env);
      if (stage === 'dark') return NOT_RELAYED();
      if (stage === 'open') return openStageMirrors(url.pathname, request.method) ? openStageAnswer(request, url, env, ctx) : NOT_RELAYED();
    }

    // ── the service has a host of its own (serviceHostStage; 'off' in every deployment that has not
    // set it, and then nothing between here and the Cards exits is different) ────────────────────
    // 🔴 ONE decision, before the API and before every handler, for every method: hostBoundary.
    const verdict = hostBoundary(env, reqHost, url.pathname, request.method);
    if (verdict) {
      if (verdict.answer === 'refused') return NOT_RELAYED();
      if (verdict.answer === 'method') return METHOD_REFUSED();
      if (verdict.answer === 'editor') return toServiceEditor(url);
      if (verdict.answer === 'moved') {
        return new Response(null, { status: verdict.status, headers: {
          Location: `https://${verdict.to}${url.pathname}${verdict.query ? url.search : ''}`,
          'Cache-Control': verdict.status === 301 ? MOVED_CACHE : 'no-store',
        } });
      }
      return notFound(env, '', {}, { locale: visitorLocale(url.searchParams, request), face });
    }
    const onService = hosts !== 'off' && reqHost === SERVICE_HOST;

    // 🔴 FIRST, and before any host resolution. The write API is host-agnostic — reef-MCP calls the
    // canonical host, and a vanity domain must never expose it under a creator's own name. Putting
    // it after resolveHandle would mean `<a-creator's-domain>/_api/card/<someone-else>` resolved the
    // vanity to the FIRST creator and then ignored it, which is not wrong so much as it is a second idea of what a
    // hostname means. One door, one host-independent path.
    // Nothing thrown inside it leaves the Worker as an exception or as its own message (which can
    // carry store or configuration detail): an API caller gets a plain 500 with a code.
    let api;
    try {
      api = await handleApi(request, env, url);
    } catch {
      return new Response(JSON.stringify({ error: 'internal_error' }), {
        status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (api) return api;

    // reef#2725 — the old Card host redirects before any store read. Apex paths need a Card lookup
    // before redirecting, since the site's route table can grow without a cardtile change.
    if (movedToCardsHost(env)) {
      // Only a live, handle-shaped Card address leaves the apex. Every other apex request belongs
      // to the site, whose routes can grow independently of this package.
      if (reqHost === APEX_HOST) {
        if (APEX_HANDLE_PATH.test(url.pathname) && !isApexSitePath(url.pathname) &&
            (request.method === 'GET' || request.method === 'HEAD') && env?.CARDS) {
          const handle = url.pathname.replace(/^\/|\/$/g, '').toLowerCase();
          // The apex belongs to the site when the optional Card lookup is unavailable.
          let md;
          try { ({ md } = await liveCard(env.CARDS, handle)); }
          catch (err) {
            // tile#219 follow-up: the forward hides the failure from the visitor, so leave one line
            // for the operator. Same JSON-event shape as card-api's settlement lines. No error text:
            // the store's message names the key it failed on (the handle) and may carry anything
            // else, and `name` is settable text too — so only an allowlisted class name is logged.
            // A thrown value can be anything: `name` is read exactly once (a getter may answer
            // differently twice, or throw), and nothing here may stand between the visitor and
            // the site, so the whole line is best-effort.
            try {
              let name;
              try { name = err?.name; } catch { name = undefined; }
              const error = typeof name === 'string' && LOGGED_ERROR_NAMES.has(name) ? name : 'unknown';
              console.warn(JSON.stringify({ event: 'apex_card_lookup_failed', host: reqHost, op: 'liveCard', error }));
            } catch { /* logging is optional; the fallthrough is not */ }
            return fetch(request);
          }
          if (md != null) return new Response(null, { status: 301, headers: {
            Location: `https://${CARDS_HOST}${url.pathname}${url.search}`, 'Cache-Control': MOVED_CACHE,
          } });
        }
        return fetch(request);
      }
    }
    const moved = movedTo(reqHost, url, request.method, env);
    if (moved) return new Response(null, { status: 301, headers: { Location: moved, 'Cache-Control': MOVED_CACHE } });

    // reef#2758 — the report door, on reef.cards only (and only with the switch on: the host is dark
    // otherwise, above, and so is this route in the open stage). On the old card host `/report` 301s here like every other path (GET), and a
    // POST there falls through to handle routing — `report` is a reserved handle, so it is no card
    // (after the split hostBoundary has refused that POST already).
    if (reqHost === CARDS_HOST && (url.pathname === REPORT_PATH || url.pathname === `${REPORT_PATH}/`)) {
      return handleReport(request, env, { handleOf: (u) => reportedHandle(u, env) });
    }

    // reef#2044 ③ — security.txt, on the canonical host only. A constant: no store read, no handle.
    // `.well-known` can never be a handle (the grammar starts a handle with a letter or digit), so
    // without this it fell through to handle routing and 404'd. See SECURITY_TXT for what it says.
    // reef#2725: "the canonical host" is the switch's, and so is the file's own Canonical line.
    if (url.pathname === SECURITY_TXT_PATH && reqHost === canonicalHost(env)) {
      const txt = SECURITY_TXT.replace(`https://${CANON_HOST}${SECURITY_TXT_PATH}`, `https://${reqHost}${SECURITY_TXT_PATH}`);
      return new Response(request.method === 'HEAD' ? null : txt, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    // ── the editor's borrowed files and faces, each under its content hash ────────────────────────
    const ea = EDITOR_ASSET_RE.exec(url.pathname);
    if (ea) {
      const asset = editorAsset(ea[1], ea[2]);
      if (!asset) return new Response('no such editor asset', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
      return new Response(asset.body, {
        headers: {
          'Content-Type': ASSET_MIME[asset.ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    }

    // 🔴 THE RETIRED PATH. `/try/edit2` and `/try/edit2/` — the bare page only — 301 to `/try/edit`,
    // carrying the query string across so a `?lang=` link still resolves the same locale on arrival.
    if (url.pathname === LEGACY_EDIT2_PATH || url.pathname === `${LEGACY_EDIT2_PATH}/`) {
      return Response.redirect(`${url.origin}${SANDBOX_PATH}${url.search}`, 301);
    }

    // HOST MODE — see HOST_EDIT_PATH. Refused outright without an allowed `?host=`.
    if (url.pathname === HOST_EDIT_PATH || url.pathname === `${HOST_EDIT_PATH}/`) {
      const params = url.searchParams;
      const host = validHostOrigin(params.get('host'));
      if (!host) {
        return new Response('`/edit` needs ?host=<the parent page\'s origin> (feelreef).', {
          status: 400,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
        });
      }
      const locale = visitorLocale(params, request);
      return new Response(editorHtml(locale, { host }), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          // framed by the named parent and nobody else
          'Content-Security-Policy': `frame-ancestors ${host}`,
        },
      });
    }

    // The public sandbox. `/try/edit` and `/try/edit/` only — a bare `/try` (no `/edit`) falls
    // through to ordinary handle routing below and 404s like any other unregistered handle.
    if (url.pathname === SANDBOX_PATH || url.pathname === `${SANDBOX_PATH}/`) {
      // resolution order per the brief: `?lang=` first (the name every other locale-aware surface
      // this project has uses), then the older `?locale=` (kept working — nothing that already
      // links to it should break), then Accept-Language, then English.
      const params = url.searchParams;
      // 🔴 `primaryLocale()`, not a raw pass-through: a query param may hold a FULL BCP-47 tag
      // (`?lang=zh-TW`), and `SANDBOX_LOCALES`'s own keys are shorter locale KEYS (`zh`) that don't
      // always match the tag verbatim (Traditional/Simplified Chinese in particular — see
      // sandbox-i18n.mjs's `resolveLocaleKey`). Passing the tag straight to the lookup below would
      // silently fall back to English for exactly the links this override exists to make work.
      const locale = visitorLocale(params, request);
      return new Response(editorHtml(locale), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          // Never indexed: this shell is identical for every visitor bar the `lang` attribute and a
          // few inline strings, so it has no unique content of its own to rank on — same call as
          // isDemo()/isPreview() above, extended to a page that is not a card at all.
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    }

    // ── the door's luggage: POST /try/park ──────────────────────────────────────────────────────
    //
    // The sandbox card, parked for one hour under an unguessable key, so 「把這張變成真的」 can
    // carry the WHOLE card across an origin boundary instead of a title and a tagline. Read back
    // once, by feelreef's server, over the bearer-gated `GET /_api/try/<id>`.
    //
    // 🔴 PUBLIC, AND SAID SO RATHER THAN DRESSED UP. A stranger's browser holds no credential and
    // never will, so this cannot be gated the way the write API is. What bounds it instead is
    // stated plainly: the body must PARSE AS A CARD, it must fit the ingest budget, the key is a
    // random UUID nobody can enumerate, and it evaporates in an hour. The `Origin` check below
    // stops a page on another site from posting here with a browser; it does not stop `curl`, and
    // calling it a gate would be the phantom kind.
    //
    // 🔴 And it is a SEPARATE KEY NAMESPACE. `/try/edit` still never touches the store — see the
    // comment on SANDBOX_PATH above, and card-worker.test.mjs still proves it with a KV double that
    // throws. This route is the one place the string "try" reaches KV, and it reaches it as
    // `try:<uuid>`, which the handle grammar cannot produce.
    if (url.pathname === '/try/park') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'POST a card here.' }), {
          status: 405, headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST' },
        });
      }
      const parkJson = (body, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return parkJson({ error: 'Not yours to park.' }, 403);
      const store = env && env.CARDS;
      if (!store) return parkJson({ error: 'card store not bound' }, 500);
      const md = await request.text();
      if (md.length > TRY_MAX_BYTES) return parkJson({ error: 'That card is too big to carry.' }, 413);
      // 🔴 A body that is not a card is not parked. Without this the route is a free key/value store
      // with our name on it; with it, the only thing it will hold is a thing this Worker can render.
      let cells = 0;
      try { cells = parseCard(md).cells.length; } catch { cells = 0; }
      if (!cells) return parkJson({ error: 'That is not a card.' }, 400);
      const id = crypto.randomUUID();
      await store.put(tryKey(id), md, { expirationTtl: TRY_TTL });
      return parkJson({ id, expires_in_seconds: TRY_TTL });
    }

    // A parked draft (preview_cards). Unlisted, un-guessable, gone within the hour — and NEVER
    // indexed: a preview is a byte-for-byte near-duplicate of a live card, so an indexed one would
    // compete with the creator's own page in exactly the way the PREVIEW deployment rule exists to
    // prevent. `noindex` is set unconditionally here rather than via isPreview(), because this route
    // is reachable on PRODUCTION and that is the whole point of it.
    // A preview stamped with a generation that is no longer its handle's (the card was deleted while
    // it was being parked, reef#2618) is expired. One stamped with no handle (parked before r1)
    // keeps its hour; a handle without a generation is generation 0, as everywhere (r3).
    const previewDraft = async (id) => {
      const row = env && env.CARDS ? await env.CARDS.getWithMetadata(previewKey(id)) : null;
      const meta = row && row.metadata;
      const stale = row && row.value != null && meta && meta.handle
        && !isCurrentGen(meta, await generationOf(env.CARDS, meta.handle));
      return row && !stale ? row.value : null;
    };
    // tile#372 — one embed of a preview, as its own document (cardtile-embed-document.mjs). Only while the
    // page's policy is on; off, this path is not looked at here and is answered below as it always was.
    const pve = pageCspStage(env) !== 'off' ? /^\/_preview\/([0-9a-f]{32})\/_embed\/([0-9a-f]{64})$/.exec(url.pathname) : null;
    if (pve) {
      const draft = await previewDraft(pve[1]);
      const doc = draft ? embedDocumentOf(await embedDocuments(parseCard(draft), (k) => frontmatter(draft, k)), pve[2]) : null;
      if (doc == null) return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
      // its relative addresses resolve against the preview's own address, as in the srcdoc (r2); an author's
      // own base is honoured as it was there (r3)
      return new Response(embedDocumentBody(doc, `/_preview/${pve[1]}`, url.href), { headers: embedDocumentHeaders({ preview: true }) });
    }
    const pv = /^\/_preview\/([0-9a-f]{32})$/.exec(url.pathname);
    if (pv) {
      const draft = await previewDraft(pv[1]);
      if (!draft) {
        return new Response('<!doctype html><meta charset=utf-8><title>Expired</title><p>This preview has expired.</p>', {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
        });
      }
      const videos = await resolveChannels(draft, ytFetch, channelShare);
      const rendered = withServiceTry(renderCardHTML(draft, { handle: '', cardUrl: '', videos }), env);
      // tile#372: with the page's policy on, each embed is its own document (cardtile-embed-document.mjs)
      const preview = pageCspStage(env) !== 'off' && hasSrcdocFrame(rendered)
        ? framesAsDocuments(rendered, await embedDocuments(parseCard(draft), (k) => frontmatter(draft, k)), `/_preview/${pv[1]}/`)
        : rendered;
      return new Response(preview, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          // what a person wrote, rendered on the people's origin: the page's policy (cardtile-page-csp.mjs; nothing unless CARDS_PAGE_CSP is set)
          ...(await pageCspHeaders(env, preview)),
        },
      });
    }

    // the QR coral, served as a versioned same-origin asset (immutable — see QR_PATH)
    if (url.pathname === QR_PATH || url.pathname === DRAWER_PATH) {
      const body = url.pathname === QR_PATH ? QR_JS : DRAWER_JS;
      return new Response(body, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    // the deck every Card page carries (w3/deck-page.mjs) — same rule: versioned path, immutable, any host
    if (url.pathname === DECK_JS_PATH || url.pathname === DECK_CSS_PATH) {
      const js = url.pathname === DECK_JS_PATH;
      return new Response(js ? DECK_JS : DECK_CSS, { headers: { 'Content-Type': js ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }

    // 🔴 The video poster, proxied. This route is what makes condition 4 of the live-block rule TRUE
    // rather than nearly true: the poster lives on `i.ytimg.com`, so putting that URL in the markup
    // would have every visitor's browser announce itself to Google before touching anything. Here
    // the card points at us, and the visitor reaches YouTube only when they press play.
    //
    // 🔴 The id is validated before it is ever concatenated into a URL. Without VIDEO_RE this route
    // is an open proxy that will fetch whatever a path segment says — the card's markdown is
    // creator-authored input, and this is the one place it would reach the network.
    // 🔴 Brand marks, proxied. This was the LAST third party a Card contacted: every visitor's
    // browser fetched icons.duckduckgo.com for marks belonging to the creator's own links. Nothing
    // about a favicon needs to come from anywhere in particular, so nothing justified the leak.
    //
    // The cache key is the DOMAIN, so every card pointing at instagram.com shares one upstream
    // fetch — cost scales with distinct brands, not with cards. And the mark still comes from the
    // brand, so it still cannot go stale: that is the property a bundled icon set would have cost us.
    // (reef#2026: external marks are never stored on our side, and never swapped for a built-in one.)
    const icm = ICON_RELAY_RE.exec(url.pathname);
    if (icm) {
      // a malformed escape (`%`, `%zz`, a cut UTF-8 sequence) throws URIError: the same 400 as a bad domain
      let domain;
      try { domain = decodeURIComponent(icm[1]).toLowerCase(); } catch { return new Response('bad domain', { status: 400 }); }
      // 🔴 The card's markdown is creator-authored and this concatenates into a URL. Without the
      // guard, `/_icon/<anything>.ico` is an open proxy — same discipline as VIDEO_RE on /_yt/.
      if (!ICON_DOMAIN_RE.test(domain)) return new Response('bad domain', { status: 400 });
      // 🔴 r9: we do NOT ask the edge to cache the upstream answer (cf.cacheTtl* would keep an
      // UNVALIDATED 200 — a transient text/html — for a week). Only a response that passed the MIME check
      // is stored, in caches.default, under this request's URL. A miss/5xx/rejected answer is never kept.
      // Two stages, in order, both fixed addresses (reef#2026): DuckDuckGo, then Google; only when both miss is it a 404.
      return relayImage(request, ctx, iconUpstreams(domain), 604800);
    }

    const ytm = YT_RELAY_RE.exec(url.pathname);
    if (ytm) {
      if (!VIDEO_RE.test(ytm[1])) return new Response('bad id', { status: 400 });
      return relayImage(request, ctx, `https://i.ytimg.com/vi/${ytm[1]}/hqdefault.jpg`, 86400);
    }

    // ── which of the three exits? ────────────────────────────────────────────────────────────────
    //
    //   /<handle>.md  (canonical) · /index.md (vanity)  → the WHOLE file, assets included
    //   Accept: text/markdown                           → the THIN card, assets stripped
    //   anything else                                   → HTML
    //
    // 🔴 Explicit beats negotiation: a `.md` URL is a person clicking a download link, and it must
    // give them the complete file no matter what their browser puts in Accept.
    //
    // 🔴 The two markdown exits are NOT one call with a default. A backup taken over the thin exit
    // is 99.7% missing on a real card, and what is missing is the pictures — the part nobody can
    // retype. A parameter with a default is a thing somebody forgets; two paths are not.
    const host = reqHost; // the URL's (see the top of fetch)
    // who is asking, for the nothing-here page: their language and the host they asked (see notFound)
    const who = { locale: visitorLocale(url.searchParams, request), face };

    // 🔴 The service host serves nothing a person wrote, and reads nothing to find out whether there
    // is anything. hostBoundary answered everything that has no handler above, so nothing arrives
    // here; this line is what keeps a route added above from falling into people's pages unnoticed.
    if (onService) return notFound(env, '', {}, who);
    const md = /^(.*)\.md$/.exec(url.pathname);

    // CARDS store: card:<handle>:<gen> → card.md (card-api genKey), plus the vanity bindings. Missing
    // binding (local/misconfig) is a clear 500, not a crash. Read before routing now, because routing needs it.
    const store = env && env.CARDS;
    if (!store) return html('<!doctype html><meta charset=utf-8><p>card store not bound</p>', 500, env);

    // Vanity routing uses the forward binding here or the inverse below:
    // the canonical host can never be a vanity, and a vanity host is already where it belongs.
    // A binding from an ended lifetime is no binding: the host is then unbound (404 below), never the
    // next owner's card. The generation read here is the one the card is read under.
    // 🔴 Only a host the vanity route could have bound is looked up (vanityHost): a hand-written key for
    // saas.feelreef.com (the SaaS fallback origin every creator domain arrives through) or for an IP
    // would otherwise turn platform plumbing into one creator's page. Our own hosts never look.
    const extraHosts = pathHosts(env);
    const bindable = !!host && !routesByPath(host, extraHosts) && !!vanityHost(host);
    let pointer = bindable ? await store.get(VANITY_KEY(host)) : null;
    // 🔴 r9: `vanity:<host>` is HostBindings' write-through cache, so a MISS on a creator's domain may be
    // a put that failed after the bind was accepted: ask the host's object, once (card-api hostOwner)
    if (pointer == null && bindable) pointer = await hostOwner(env, host);
    // 🔴 a stored value outside the handle grammar is no binding (a hand-written key never went through
    // the API): it would reach X-Card-Handle and the store keys built from it
    if (pointer != null && !VALID_HANDLE.test(pointer)) pointer = null;
    const boundGen = pointer != null ? await generationOf(store, pointer) : null;
    const vanityHandle = boundGen != null && (await isBound(store, pointer, boundGen, host)) ? pointer : null;
    const resolved = resolveHandle(host, md ? (md[1] || '/') : url.pathname,
      vanityHandle ? { [host]: vanityHandle } : {}, extraHosts, { rootPage: !(hosts === 'split' && host === CARDS_HOST) });
    // a host of ours with no root card and no handle in the path: the nothing-here page. An unbound
    // creator's domain keeps the small 404 (see SMALL_404) — it is not our door to put our page on.
    if (!resolved) return routesByPath(host, extraHosts) ? notFound(env, '', {}, who) : html(SMALL_404, 404, env);

    // Is this path the card at all? Unknown paths cost no store read and no render. See cardPath.
    // Card exits read the body and stop marker in parallel before any exit or redirect.
    // the root card on reef.cards is addressed like a one-card host (resolveHandle `root`)
    const oneCardHost = !!vanityHandle || !!resolved.root;
    const at = { host, vanity: !!vanityHandle };
    const want = cardPath(url.pathname, resolved.handle, oneCardHost);
    // tile#339: the picture route exists only while the local switch is set (asset-urls.mjs
    // pictureStrategy). Unset — every deployment today — its paths are unknown paths, as they always were.
    const pictures = pictureStrategy(env);
    // tile#372: and an embed's own document only while the page's policy is on (cardtile-embed-document.mjs)
    if (!want || (want === 'asset' && pictures === 'inline') || (want === 'embed' && pageCspStage(env) === 'off')) return vanityHandle ? html(SMALL_404, 404, env) : notFound(env, resolved.handle, at, who);
    // liveCard reads `gen:` then that generation's body and stop (reef#2618 r3, card-api genKey): a body
    // or stop written in a deleted lifetime is under a key this never reads, so it falls through to the
    // no-card 404 exactly as a missing body does.
    // tile#336: the exchange state rides in the same parallel round (one more read beside body and stop,
    // no serial trip). Not on the platform's own root page (ROOT_HANDLE, under any name or host it answers
    // to): that page IS reef.cards, and a closing tile and footer segment linking to itself would be
    // noise, so it is never read there.
    //
    // tile#339 step 1 — a picture this lifetime has kept (picture-cache.mjs) is answered here, from the
    // generation and its stop alone: no body read, no parse. 🔴 The stop is read on EVERY picture
    // request and wins over a warm cache; the cache is asked in the same round, so a stopped page and a
    // page that never was make the same calls. Anything but a hit on a page that is not stopped falls
    // through to the whole-file path below, unchanged — which is also where every 404 is decided.
    let pictureGen = null;
    if (want === 'asset') {
      const ref = assetRef(url.pathname);
      pictureGen = vanityHandle ? boundGen : await generationOf(store, resolved.handle);
      const [live, kept] = await Promise.all([
        liveStop(store, resolved.handle, { gen: pictureGen }),
        ref ? cachedPicture(resolved.handle, pictureGen, ref.hex, ref.ext) : null,
      ]);
      if (kept && live.stopped == null) return pictureResponse(kept, env, resolved.handle, at);
    }
    const { md: liveMd, stopped, gen, pooled } = await liveCard(store, resolved.handle,
      { stop: true, pool: resolved.handle !== ROOT_HANDLE, gen: vanityHandle ? boundGen : pictureGen });
    // 🔴 A stopped Card IS a missing one from here on, on every exit — page, markdown, avatar, icons,
    // and no redirect to its own domain (that would name the binding). tile-lab#51: retired and
    // never-existed must be indistinguishable; see notFound. The stop still wins over everything.
    const cardMd = stopped != null ? null : liveMd;
    // An absent card on a creator's host has no public binding, even when a pointer remains.
    // Use the unbound response, including its robots headers, on every card exit.
    if (cardMd == null && !routesByPath(host, extraHosts)) return html(SMALL_404, 404, env);
    // Missing and stopped shared-host identities perform the same ordered reads, including
    // the legacy deletion marker. Its value never changes the public absence response.
    if (cardMd == null) await store.get(`gone:${resolved.handle}`);

    // reef#3361 — the size tier (size-tier.mjs): a file with more than ON_DEMAND_TILES tiles is never parsed
    // whole. Counted by the board parser's own rules, and the count stops past the threshold. Above it the
    // exits read the file through one index of where its tiles are (scanCard): the page view is served in
    // windows, the icons and the avatar read the first profile tile, a picture is found in the assets lane.
    const onDemand = cardMd != null && scanCard(cardMd, { limit: ON_DEMAND_TILES }).above;
    let scanned = null, headM = null;
    const index = () => (scanned ??= scanCard(cardMd));
    const head = () => (headM ??= headModel(cardMd, index()));
    // reef#2044 ④ — read once, used by every exit below that serves this card (page, markdown, icons).
    // Above the tier the same rule, answered from the index (size-tier.mjs blankAbove): at any size a
    // file that is still only the blank template is noindex.
    const blank = cardMd != null && (onDemand ? blankAbove(cardMd, index()) : isTemplateOnly(cardMd));

    if (want === 'alias' && cardMd != null) return Response.redirect(`https://${host}/${url.search}`, 301);

    // tile#339 — one picture, by its bytes' SHA-256 (asset-urls.mjs). An image exit like the avatar, so it
    // answers on both hosts, before the page's canonical→vanity 301. This is the whole-file path: the
    // picture was not in this lifetime's cache (above), so it is found in the body this lifetime just
    // returned and then kept for the next request. A stop, a delete or a new lifetime takes it down on
    // the next request either way. Every miss — no card, stopped, a hash not on this card, a type
    // the route does not serve — is the answer this host gives a card that is not there: the no-card
    // page on ours (one page for every "no card", tile-lab#51), the small 404 on a creator's domain.
    // tile#381: in the visitor's language and for the host they asked (`who`), as on every other
    // missing page — never the Cards file's own `lang:`, which would tell a live handle from none.
    if (want === 'asset') {
      const ref = assetRef(url.pathname);
      const found = cardMd && ref ? await findAsset(onDemand ? allAssets(cardMd, index()) : parseCard(cardMd).assets, ref.hex, ref.ext) : null;
      if (!found) return vanityHandle ? html(SMALL_404, 404, env) : notFound(env, resolved.handle, at, who);
      const keeping = keepPicture(resolved.handle, gen, ref.hex, ref.ext, found.bytes);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(keeping); else await keeping;
      return pictureResponse(found, env, resolved.handle, at);
    }

    // tile#372 — one embed's document, by its hash (cardtile-embed-document.mjs). On both hosts, before the
    // page's 301, like a picture. The document is made from the stored file's own `embed` tiles — the
    // window `?w=<n>` names, for a file served in windows — and answered only when one has this hash. Every
    // miss is the answer this host gives a card that is not there, as for a picture.
    if (want === 'embed') {
      const h = EMBED_TAIL_RE.exec(url.pathname.slice(url.pathname.lastIndexOf('/_embed/')))[1];
      let model = null;
      if (cardMd != null && onDemand) {
        const wq = url.searchParams.get('w');
        const n = wq == null ? 1 : /^[1-9]\d{0,8}$/.test(wq) ? Number(wq) : 0;
        const front = deckFront(cardMd);
        const plan = windowsOf(cardMd, index(), { front });
        if (n >= 1 && n <= plan.count) model = windowOf(cardMd, index(), plan, n - 1, { front });
      } else if (cardMd != null) model = parseCard(cardMd);
      const doc = model ? embedDocumentOf(await embedDocuments(model, (k) => frontmatter(cardMd, k)), h) : null;
      // r2: the visitor's language and the host they asked, as on every other missing page
      if (doc == null) return vanityHandle ? html(SMALL_404, 404, env) : notFound(env, resolved.handle, at, who);
      // its relative addresses resolve against the Cards' own address on this host, as in the srcdoc (r2):
      // `/` on a one-card host (a person's domain, the root card), `/<handle>` on a shared one; an author's own
      // base is honoured as it was there (r3)
      return new Response(embedDocumentBody(doc, oneCardHost ? '/' : `/${resolved.handle}`, url.href), { headers: embedDocumentHeaders() });
    }

    // The avatar is an image exit on both hosts, before the page's canonical→vanity redirect.
    // cardAvatar validates stored raster assets; remote pictures pass the proxy's type allowlist.
    if (want === 'avatar') {
      const avatar = cardMd ? cardAvatar(onDemand ? head() : parseCard(cardMd)) : null;
      const image = !avatar ? NOT_RELAYED()
        : avatar.url ? await relayAvatar(ctx, avatar.url)
          : new Response(Uint8Array.from(atob(avatar.b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0)), {
            headers: {
              'Content-Type': avatar.mime,
              'Cache-Control': 'public, max-age=3600',
              'X-Content-Type-Options': 'nosniff',
            },
          });
      // Apply host-specific robots rules after a relay cache hit as well as a fresh response.
      const headers = new Headers(image.headers);
      for (const [key, value] of Object.entries(ROBOTS_HEADERS(env, resolved.handle, at, blank))) headers.set(key, value);
      return new Response(image.body, { status: image.status, headers });
    }

    // The card's icon files. Before the canonical→vanity 301 below: that redirect is for the PAGE,
    // and a browser asking `/<handle>/favicon.ico` for an image must get an image, not a home page.
    if (want === 'ico' || want === 'svg' || want === 'apple') {
      // tile#340: the reef.cards origin answers its own mark when the platform's page is not there (ORIGIN_MARK)
      const originMark = !cardMd && !!resolved.root && face === CARDS_HOST;
      if (!cardMd && !originMark) return new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=60', ...ROBOTS_HEADERS(env, resolved.handle, at) } });
      const file = originMark ? await iconFile(want, NO_TILES, ORIGIN_MARK)
        : await iconFile(want, onDemand ? head() : parseCard(cardMd), { name: cardName(cardMd, resolved.handle), accent: frontmatter(cardMd, 'accent') });
      return new Response(file.body, {
        headers: {
          'Content-Type': file.type,
          // an hour: an icon changes when the avatar does, which is rare, and a stale tab icon for an
          // hour is not a stale page. The page itself stays at 60s.
          'Cache-Control': 'public, max-age=3600',
          // the avatar's type comes from the card's own `mime=`; never let a client second-guess it
          'X-Content-Type-Options': 'nosniff',
          ...ROBOTS_HEADERS(env, resolved.handle, at, blank),
        },
      });
    }

    // 🔴 A card with its own domain has ONE address. `card.feelreef.com/<handle>` served the same
    // page as the creator's own apex, which is duplicate content competing with them in search —
    // and the canonical URL is the one WE own, so we would be the ones outranking them.
    //
    // 301 (permanent) because it is: the vanity host is where that card lives from the moment it is
    // bound. Only the HTML view redirects — `/_api/` never reaches here, and the `.md` exits keep
    // working on both hosts because a download link somebody already has must not break.
    const wantFat = want === 'fat';
    const wouldRedirect = !vanityHandle && !wantFat && !wantsMarkdown(request);
    // the inverse binding, likewise only from this lifetime (card-api vanityKey)
    const ownHost = wouldRedirect ? await boundHostOf(store, resolved.handle, gen) : null;
    // the name is checked too: a hand-written inverse never went through the route's validator, and an
    // invalid A-label throws inside Response.redirect while a hex-spelled IPv4 redirects to loopback
    if (cardMd != null && ownHost && host !== ownHost && vanityHost(ownHost)) {
      return Response.redirect(`https://${ownHost}${url.search}`, 301);
    }

    if (!cardMd) return notFound(env, resolved.handle, at, who);

    // the download link, in the form this host actually uses
    // (the root card keeps the canonical form: `/index.md` on reef.cards would name the handle `index`)
    const fatUrl = vanityHandle ? `https://${host}/index.md`
      : resolved.root ? `https://${host}/${ROOT_HANDLE}.md` : `${resolved.cardUrl}.md`;

    const probe = cardHandleHeader(vanityHandle);
    if (wantFat) return markdown(cardMd, { env, originalLength: cardMd, handle: resolved.handle, at, blank, extra: probe });

    if (wantsMarkdown(request)) {
      // 🔴 Strip the assets by round-tripping through card-core, not by cutting text. parseCard
      // hoists `## assets` out of `cells` already, and serializeCard writes them back sorted at the
      // end — so dropping and re-attaching is byte-exact (measured on all three cards). A regex over
      // the file would be a second, weaker idea of where the lane begins.
      const thin = serializeCard({ ...parseCard(cardMd), assets: {} });
      return markdown(thin, { env, originalLength: cardMd, alternate: fatUrl, handle: resolved.handle, at, blank, extra: probe });
    }

    // 🔴 Resolution happens HERE, not in a coral. A coral runs in the browser, so it would cost a
    // round trip for something the renderer can do server-side — and it would be the visitor's
    // browser making it, which is condition 4 again. The cache key is the uploads-playlist oEmbed URL, i.e.
    // the CHANNEL: a thousand cards pointing at one channel share one fetch, so cost does not scale with
    // cards (condition 2). renderCardHTML stays pure and synchronous; it receives the answer.
    //
    // Failure is not propagated. resolveChannels never throws and returns {} when YouTube is
    // unreachable, which lands the block on its designed degraded state (condition 3). A creator's
    // card must not go down because a video platform did.
    // tile#339: each fetch counted, because the picture cache's prefill below shares this invocation's
    // subrequest budget with it (picture-cache.mjs prefillCalls). tile#355: and capped at its own share of
    // that budget (CHANNEL_SUBREQUESTS), so a page naming many channels never spends the rest by itself.
    // reef#3361 — above the size tier the page is served in windows (size-tier.mjs): the page is the first,
    // `?w=<n>&r=<revision>` the n-th, each a whole page by this same renderer with plain links to the
    // windows on either side. A window asked for under another revision is sent to that window of the
    // current one (302), so no page ever holds two revisions; w3/deck.js sees the revision change and
    // stops fetching. At or below the tier none of this runs, and the page is today's, byte for byte.
    let win = null;
    if (onDemand) {
      const idx = index();
      const rev = await revisionOf(cardMd);
      const wq = url.searchParams.get('w');
      const n = wq != null && /^[1-9]\d{0,8}$/.test(wq) ? Number(wq) : 1;
      const rq = url.searchParams.get('r');
      const at = (k) => (k === 1 ? url.pathname : `${url.pathname}?w=${k}&r=${rev}`);
      if (rq != null && rq !== rev) return Response.redirect(`https://${host}${at(n)}`, 302);
      const front = deckFront(cardMd);
      const plan = windowsOf(cardMd, idx, { front });
      if (n > plan.count) return Response.redirect(`https://${host}${url.pathname}`, 302);
      win = {
        src: { model: windowOf(cardMd, idx, plan, n - 1, { front }), fm: (k) => frontmatter(cardMd, k), name: cardName(cardMd, resolved.handle), deckMd: front, head: head() },
        pager: { rev, prev: n > 1 ? at(n - 1) : null, next: n < plan.count ? at(n + 1) : null },
        last: n === plan.count,
        n,
      };
    }
    let ytCalls = 0;
    const ytCount = (u) => { ytCalls += 1; return ytFetch(u); };
    // A window resolves only the channels its own video tiles name, within the same share and from the same
    // memory as every other page view (yt-channels.mjs resolveChannelsOf): one budget, one memory.
    const videos = win ? await resolveChannelsOf(win.src.model, ytCount, channelShare) : await resolveChannels(cardMd, ytCount, channelShare);

    // reef#2725 r3 — og:url / canonical: a vanity card's own domain; any other card's canonical
    // address under the switch (reef.cards' root card = the bare origin), whatever host answered.
    const canonicalUrl = vanityHandle ? resolved.cardUrl : cardUrlFor(resolved.handle, {}, env);
    // Cards served in windows: every window after the first holds tiles no other page holds, so its
    // canonical is its own address — the Cards' canonical address with `?w=<n>` and no revision. That
    // address always answers with window n of the current revision (above), so it is the one a search
    // engine keeps; the revisioned address (`&r=…`, what the pager links to so one visit reads one
    // revision) names it as canonical. The first window is the Cards' own address, bare. og:url stays
    // the Cards' address in every window: a shared window previews as the Cards it belongs to.
    const windowUrl = win && win.n > 1 ? windowAddress(canonicalUrl, win.n) : '';
    // tile#298 — a card that names its language speaks it, chrome and all, to everyone (unchanged). One
    // that names none gets its CHROME in the visitor's language, and the response varies by it.
    const chromeLang = frontmatter(cardMd, 'lang') ? '' : visitorLocale(url.searchParams, request);
    // tile#336 — the platform's exchange state, exactly as it wrote it: `in` → in, `out` → out, anything
    // else (absent, a hand-written value) → undefined, which is the page as it was before the state existed.
    // The Worker does not interpret it further: the platform's one draw rule already did.
    const pool = pooled === POOL_IN ? true : pooled === POOL_OUT ? false : undefined;
    // tile#339 — how the pictures travel, by the local switch (asset-urls.mjs; 'inline' unless set): hashed
    // here, from the body already read (no store read), because the render is synchronous. 'inline' hashes
    // nothing and hands the renderer nothing, which is the page as it was.
    // A window's plan is made from the text of that window alone (size-tier.mjs windowPicturesText: its tiles,
    // its backs, the frontmatter's backdrop) and the pictures on demand, so only the pictures this window
    // names are looked up, decoded and hashed: the cost is the window's, whatever the rest of the file holds.
    const plan = pictures === 'inline' ? {}
      : win ? await picturePlan(windowPicturesText(win.src.model, frontmatter(cardMd, 'backdrop')), win.src.model.assets, assetBase(resolved.handle, !!vanityHandle), pictures)
        : await picturePlan(cardMd, parseCard(cardMd).assets, assetBase(resolved.handle, !!vanityHandle), pictures);
    const pageCtx = { ...resolved, canonicalUrl, ...(windowUrl ? { windowUrl } : {}), videos, ...(plan.assetUrls ? { assetUrls: plan.assetUrls } : {}), ...(plan.pictures ? { pictures: plan.pictures } : {}), ...(chromeLang ? { chromeLang } : {}), ...(pool !== undefined ? { pool } : {}) };
    const rendered = withServiceTry(win ? renderSource(win.src, { ...pageCtx, pager: win.pager, ...(win.last ? {} : { poolTile: false }) }) : renderCardHTML(cardMd, pageCtx), env);
    // tile#372 — with the page's policy on, each embed is its own document (cardtile-embed-document.mjs): its frame
    // names `<base>_embed/<hash>` (in a file served in windows, `?w=<n>` too) instead of holding it as srcdoc
    const page = pageCspStage(env) !== 'off' && hasSrcdocFrame(rendered)
      ? framesAsDocuments(rendered, await embedDocuments(win ? win.src.model : parseCard(cardMd), (k) => frontmatter(cardMd, k)),
        assetBase(resolved.handle, !!vanityHandle), win ? `?w=${win.n}` : '')
      : rendered;
    // tile#339 step 1: what this render decoded and hashed for the plan is kept for the picture requests
    // the page is about to cause (picture-cache.mjs keepPictures; one cache read when all are kept already):
    // only the pictures the rendered page names, in the order it draws them (a reference the page never
    // draws causes no request), and only as many as the budget left after YouTube allows (prefillCalls)
    if (plan.served && plan.served.length) {
      const bodyAt = page.indexOf('<body');
      const drawn = picturesInRenderOrder(bodyAt < 0 ? page : page.slice(bodyAt), plan.served.map((p) => p.url));
      const byUrl = new Map(plan.served.map((p) => [p.url, p]));
      const keeping = keepPictures(resolved.handle, gen, drawn.map((u) => byUrl.get(u)), prefillCalls(ytCalls));
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(keeping); else await keeping;
    }
    // tile#372 — the page's Content-Security-Policy (cardtile-page-csp.mjs): on every person's page while
    // CARDS_PAGE_CSP is exactly "report-only" or "enforce", whatever the page holds; nothing otherwise.
    const csp = await pageCspHeaders(env, page, { afterPaint: plan.pictures ? plan.pictures.afterPaint : '' });
    return html(page, 200, env, resolved.handle, at, blank, { ...probe, ...(chromeLang ? VARY_VISITOR_LANG : {}), ...csp });
  },
};

// reef#2044 ⑤ — ONE wrapper around EVERY exit. The kill switch used to be threaded into individual
// response builders, which is how the 301s (canonical↔vanity, /try/edit2) and the icon/asset 404s
// were missed. Whatever `router` returns — new Response, Response.redirect, a future exit nobody has
// written yet — gets the header here when the switch is on. A stricter header already set by the
// route (`noindex, nofollow`) is never weakened. Response.redirect() headers are immutable, so the
// response is rebuilt rather than mutated.
export const withNoindexAll = (res, env) => {
  if (!noindexAll(env) || res.headers.has('X-Robots-Tag')) return res;
  const headers = new Headers(res.headers);
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

/**
 * standInsOn: env → may CARDS_HOST_STANDINS re-address a request? Both, or the list is not read:
 *
 *   · the service host is on (serviceHostStage is not 'off'). Unset or mistyped, every answer is the
 *     one the Worker gave before the setting existed — on the stand-ins' own hostnames too.
 *   · this deployment is not production: `PREVIEW` is not exactly "false" (isPreview — the marker this
 *     Worker already has; production is the one deployment that sets it "false"). A stand-in list that
 *     reaches production's settings does nothing there.
 */
export const standInsOn = (env) => serviceHostStage(env) !== 'off' && isPreview(env);

export default {
  async fetch(request, env, ctx) {
    // A staging deployment's stand-in for one of the three hosts (host-standins.mjs, CARDS_HOST_STANDINS):
    // answered as that host, with redirects kept inside staging. null in every other deployment —
    // the list alone turns nothing on (standInsOn).
    const stood = standInsOn(env) ? standIn(request, env, { service: SERVICE_HOST, people: CARDS_HOST, legacy: CANON_HOST }) : null;
    const res = stood ? stood.answer(await router.fetch(stood.request, env, ctx)) : await router.fetch(request, env, ctx);
    return withNoindexAll(res, env);
  },
};

// The Durable Objects: each host's one pointer writer (card-api HostBindings) and each handle's one
// lifetime authority (CardLifetime). The runtime finds a Durable Object class by its export from the
// main module, so they are re-exported here.
export { HostBindings, CardLifetime } from './card-api.mjs';
