// REEF with Card — the multi-tenant edge renderer. ONE Worker renders EVERY card: it resolves a
// handle from the request, reads that handle's card.md from the CARDS store, and renders it with
// cardtile (card-core + card-render). Adding a card is a STORE WRITE, never a repo/deploy — this is
// the millions-of-free-cards shape (cardtile renders DATA), the native replacement for the Python
// card_render.py that bakes one card's HTML per request on Heroku.
//
//   card.feelreef.com/<handle>   → handle = first path segment (canonical)
//   reef.cards/<handle>          → the same; reef.cards/ is the root card (reef#2725, CARD_CANONICAL_HOST)
//   <creator's own domain>/      → handle via the store's vanity: binding (one domain = one card)
//   /_coral/<coral>-<ver>.js     → a coral client (served here so the page can <script src> it)
//
// The render path (resolveHandle → renderCardHTML) is pure and node-testable; the fetch handler is
// the only edge-specific shell. One brain, two runtimes (same pattern as events-worker).
import { parseCard, serializeCard } from '../card-core.js';
import { renderPage } from '../card-render.mjs';
import { CSS, ICONS, QR_JS, QR_VERSION, DRAWER_JS, DRAWER_VERSION, ARROW } from './card-assets.mjs';
import { resolveChannels, VIDEO_RE } from '../yt.mjs';
import { cardAvatar, iconLinks, iconKind, iconFile } from '../card-icon.mjs';
import { shareTags } from '../card-share.mjs';
import { isTemplateOnly } from '../card-blank.mjs';

// One fetch per channel, not per card or visitor (yt.mjs, condition 2). A feed is cached for 30
// minutes — that TTL is what bounds how old "latest" can be. A handle page (`youtube.com/@name`,
// resolved to the UC id) is cached for a day: it is a couple of MB, and a handle's id does not change.
const ytFetch = (u) => fetch(u, {
  cf: { cacheTtl: /youtube\.com\/@/.test(u) ? 86400 : 1800, cacheEverything: true },
});
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
/** Author-supplied avatars must be HTTPS raster images, without redirects or unbounded bodies. */
async function relayAvatar(request, ctx, upstreamUrl) {
  try { if (new URL(upstreamUrl).protocol !== 'https:') return NOT_RELAYED(); }
  catch { return NOT_RELAYED(); }
  const cache = globalThis.caches && globalThis.caches.default;
  const at = new URL(request.url);
  const key = new Request(at.origin + at.pathname, { method: 'GET' });
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
import { handleApi, previewKey, goneKey, generationOf, isCurrentGen, liveCard, vanityKey, isBound, boundHostOf, hostOwner, tryKey, TRY_TTL, TRY_MAX_BYTES } from './card-api.mjs';
import { EDIT2_BODY_HTML, EDIT2_CSS, EDIT2_JS, TABLE_FILES, TABLE_I18N, FONT_FILES } from './edit2-assets.mjs';
import { localeFromAcceptLanguage, primaryLocale, SANDBOX_LOCALES, chromeStrings } from '../w/sandbox-i18n.mjs';
import { ENGINE_LOCALE_FILE, boardLocaleJson } from '../w2/board-i18n.mjs';
import { validHostOrigin } from '../w2/host-bridge.mjs';

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
// afterthought: see lab/vanity-bindings.mjs.
//
// 🔴 And a binding belongs to one lifetime of the handle (reef#2618 r4, r5; card-api vanityKey).
// `vanity:<host>` is only a pointer to a handle; the host serves that handle only while
// `vanitybind:<handle>:<gen>:<host>` exists for its CURRENT `gen:`, and the inverse is
// `vanityof:<handle>:<gen>`. A binding of an ended lifetime would otherwise hand the former owner's
// domain to the next owner of the handle. Pre-generation bindings are generation 0's.
const VANITY_KEY = (host) => vanityKey(host); // card-api's, called late: the two modules import each other

// canonical multi-tenant host — a bare visit here (no handle) is a directory, not a card.
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
 * The switch: `CARD_CANONICAL_HOST`. Exactly `reef.cards` moves the Cards there — the old addresses
 * 301 to it and the root card becomes indexable. Unset, or ANY other value, is today's host and
 * today's behaviour: a typo must never redirect every Card to a host we do not serve.
 */
export const canonicalHost = (env) =>
  String(env?.CARD_CANONICAL_HOST ?? '').trim().toLowerCase() === CARDS_HOST ? CARDS_HOST : CANON_HOST;
const movedToCardsHost = (env) => canonicalHost(env) === CARDS_HOST;

// `feelreef.com/<handle>`: one segment in the handle grammar (card-api VALID_HANDLE, any case —
// the path is preserved as written). Anything else on the apex is the marketing site's, never a Card.
const APEX_HANDLE_PATH = /^\/[a-z0-9][a-z0-9-]{0,62}\/?$/i;
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
 */
export function movedTo(host, url, method, env) {
  if (!movedToCardsHost(env) || (method !== 'GET' && method !== 'HEAD')) return null;
  const p = url.pathname;
  if (host !== CANON_HOST || p === '/_api' || p === HOST_EDIT_PATH || p === `${HOST_EDIT_PATH}/`) return null;
  return `https://${CARDS_HOST}${p}${url.search}`;
}
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
export const routesByPath = (host) =>
  !host || host === CANON_HOST || host === CARDS_HOST || host === FALLBACK_HOST || host.endsWith('.workers.dev')
  || !host.includes('.') || host === '127.0.0.1';

// reef#2725: on reef.cards the bare root, `/<ROOT_HANDLE>` and the origin-level icon files are the
// root card's, which is addressed like a one-card host (cardUrl = the bare origin, `root: true`).
// An icon path can never be a handle (it has a dot), so nothing a customer could own is taken.
const isRootPath = (host, seg) =>
  host === CARDS_HOST && (!seg || seg.toLowerCase() === ROOT_HANDLE || !!iconKind('/' + seg));

export function resolveHandle(host, pathname, vanity = {}) {
  host = (host || '').toLowerCase().replace(/:\d+$/, '');
  const seg = (pathname || '/').replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  if (vanity[host]) return { handle: vanity[host], cardUrl: 'https://' + host };            // vanity domain = one card
  if (!routesByPath(host)) return null;                                                       // a creator's domain, unbound → nothing
  if (isRootPath(host, seg)) return { handle: ROOT_HANDLE, cardUrl: 'https://' + host, root: true };
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
 *   'alias'                 /<handle> on the card's own domain → 301 to its root
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
 * on its own address and nowhere else.
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
    return null;
  }
  const m = /^\/([^/]+)(\/.*)?$/.exec(p);
  if (!m) return null;
  const seg = m[1].toLowerCase(), rest = (m[2] || '').replace(/\/+$/, '');
  if (seg === `${h}.md`) return rest ? null : 'fat';
  if (seg !== h) return null;
  if (rest === '/avatar') return 'avatar';
  return rest ? iconKind(rest) : 'page';
}

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
 * routing reads, so the inverse moves when resolveHandle does: on reef.cards the root card is the
 * bare origin, as resolveHandle says. No env = today's host. A browser has no Worker env; whoever
 * serves the editor says which host it is (w/serve.mjs's `/_w/can-save`).
 */
export const cardUrlFor = (handle, vanity = {}, env) => {
  const host = Object.keys(vanity).find((h) => vanity[h] === handle);
  if (host) return `https://${host}`;
  const canon = canonicalHost(env);
  return canon === CARDS_HOST && handle === ROOT_HANDLE ? `https://${CARDS_HOST}` : `https://${canon}/${handle}`;
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

/** renderCardHTML: (cardMd, {handle, cardUrl}) → HTML string. Pure — the shared brain. */
export function renderCardHTML(cardMd, ctx = {}) {
  const model = parseCard(cardMd);
  const name = cardName(cardMd, ctx.handle);
  const fm = (k) => frontmatter(cardMd, k);
  return renderPage(model, {
    name,
    handle: ctx.handle || '',              // → the footer's feelreef.com/signup?ref=<handle>
    icons: ICONS,
    assets: model.assets,        // the card's own images, resolved to data: URIs at render
    css: CSS,
    arrow: ARROW,           // @cvernet/signet's own arrow, lifted at build time — never re-drawn
    // `arrows: on` puts the little arrow back on link rows and CTAs. DEFAULT OFF — see arrowOf.
    arrows: fm('arrows'),
    cardUrl: ctx.cardUrl || '',
    // favicon + apple-touch-icon — see card-icon.mjs. Addressed off cardUrl, so none without one.
    iconLinks: iconLinks(model, { cardUrl: ctx.cardUrl || '' }),
    // og:* / twitter:* / description / canonical — see card-share.mjs. Same rule: none without cardUrl.
    shareTags: shareTags(model, { name, cardUrl: ctx.cardUrl || '' }),
    since: fm('since'),
    accent: fm('accent'),
    theme: fm('theme'),                    // `theme: light|dark` pins it; absent follows the reader
    poweredBy: fm('powered-by') === 'on',   // opt-in referral credit; default off (see card-render)
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
    destinationBase: ctx.destinationBase || undefined,   // round 6: the real card address the registry resolves against
    // …and its companion: the words on the two EDIT-ONLY placeholders (a link with no address, a
    // picture cell with no picture). Only meaningful with editIndex; the Worker never sets either.
    editStrings: ctx.editStrings || null,
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
// reef#2725 — the host. Our own hosts carry Cards nobody has vouched for, so a Card there is
// `noindex, nofollow` (tile c7aa65e). Once the Cards move to reef.cards (the switch, canonicalHost),
// that domain is the user-content domain and the rule there is: the root card (ROOT_HANDLE) is
// indexable, every other Card is `noindex`. Before the move reef.cards keeps the old rule, and the
// old hosts keep it in both positions.
/** robotsTag: ({ env, host, handle, vanity, blank }) → the X-Robots-Tag value, or null. Pure. */
export function robotsTag({ env, host, handle, vanity = false, blank = false }) {
  if (isPreview(env) || isDemo(handle)) return 'noindex, nofollow';
  if (!vanity) {
    if (host !== CARDS_HOST || !movedToCardsHost(env)) return 'noindex, nofollow';
    if (handle !== ROOT_HANDLE) return 'noindex';
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

const html = (body, status = 200, env = null, handle = '', at = {}, blank = false) =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CARD_HEADERS(env, handle, at, blank) },
  });

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

const markdown = (body, { env, originalLength, alternate, handle, at, blank }) =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Markdown-Tokens': String(estTokens(body)),
      'X-Original-Tokens': String(estTokens(originalLength)),
      ...(alternate ? { Link: `<${alternate}>; rel="alternate"; type="text/markdown"` } : {}),
      ...CARD_HEADERS(env, handle, at, blank),
    },
  });

/** does this client want markdown? `Accept: text/markdown` — the convention, not a query param. */
const wantsMarkdown = (request) => /(^|,)\s*text\/markdown\b/.test(request.headers.get('accept') || '');

// ── the public sandbox: card.feelreef.com/try/edit ─────────────────────────────────────────────
//
// Originally rebuilt here (chodaict, 2026-09) after the legacy `feelreef.com/card/try` route, then
// REPLACED at this same path by owner ruling: the review of the tugtile-table rebuild staged beside
// it as `/try/edit2` (REVIEW-card-edit2-rereview-2026-09-06.md) came back "四條 P1 全部在線上修好…
// 判定：換上正式路徑" — put the rebuild on the official path. `/try/edit` now serves that experience;
// its editing table is the ENGINE's own browser tugtile, served verbatim and driven through
// `window.__load(md)`. See packages/cardtile/w2/edit2.mjs for what is inherited and what is new.
//
// The ORIGINAL palette-based editor that used to live at this path (`w/editor.mjs`, bundled by the
// since-deleted gen-editor-assets.mjs) has no route left — `/try/edit2` below is the only thing that
// used to point at it, and it now redirects here instead. `w/editor.mjs` and its shared pieces
// (`cell-form-core.mjs`, `md-guard.mjs`) are kept: cardtile-w2 imports them directly, and
// sandbox-i18n.test.mjs still gates the source file's own translation coverage. What is gone is the
// BUNDLE and the HTTP door onto it, per the ruling's "no separate route kept alive".
//
// 🔴 A STATIC PATH, not a handle. `/try` is not a KV row — nothing is ever read from or written to
// the CARDS store for this route, on purpose: RSP reserves the handle `try` (a real card can never
// register it), and this Worker's own store is a separate, unrelated namespace where the string
// "try" has never been and must never be a key. Anyone visiting bare `card.feelreef.com/try` (no
// `/edit`) gets the ordinary "No card for try" 404 every other never-registered handle gets.
const SANDBOX_PATH = '/try/edit';
// `/try/edit2` is the RETIRED path this used to be staged under while `/try/edit` still served the
// old editor. It is kept as a 301 (not removed outright) so nothing that already linked to it
// (bookmarks, the re-review's own notes, anything typed by hand) breaks.
const LEGACY_EDIT2_PATH = '/try/edit2';

const escLite = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// the engine's table and its assets, under a locale-carrying prefix. The prefix is what makes the
// locale reach the engine at all: its host resolves ITS locale from `navigator.language` and fetches
// `./i18n/<that>.json` with no query string, so a visitor who asked for `?lang=ja` in a zh-TW
// browser would otherwise get a Chinese board inside a Japanese page. Reading the locale off the
// PATH means every asset request the host makes carries it.
const SANDBOX_TABLE_RE = /^\/try\/edit\/t\/([A-Za-z-]+)\/(.*)$/;

const TABLE_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** one file of the engine's web tugtile, or null. Never reads anything but the bundled table. */
function tableAsset(localeKey, rel) {
  const path = rel === '' ? 'index.html' : rel;
  const i18n = /^i18n\/([A-Za-z-]+)\.json$/.exec(path);
  if (i18n) {
    // 🔴 EVERY one of the engine's four filenames answers, and every one answers with THIS
    // visitor's language. The host picks the filename from the browser's own `navigator.language`;
    // we have already decided the locale from the path. Serving "the file it asked for" would put
    // the two in disagreement for exactly the visitors the `?lang=` override exists for.
    const base = TABLE_I18N[ENGINE_LOCALE_FILE[localeKey] || 'en-US'] || TABLE_I18N['en-US'];
    if (!base) return null;
    return { body: JSON.stringify(boardLocaleJson(base, localeKey, chromeStrings(localeKey))), ext: '.json', immutable: false };
  }
  // the editor shell's own faces (the porch skin — w2/porch-fonts.css). Locale-free; binary.
  if (path.startsWith('fonts/')) {
    const b64 = FONT_FILES[path];
    if (b64 == null) return null;
    return { body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), ext: '.woff2', immutable: true };
  }
  const body = TABLE_FILES[path];
  if (body == null) return null;
  const ext = path.slice(path.lastIndexOf('.'));
  // the host's index.html is the only one that varies with the visitor (it does not, today — but it
  // is the document, and a document that is cached for a year is a document that cannot be fixed)
  return { body, ext, immutable: path !== 'index.html' };
}

// ── HOST MODE: card.feelreef.com/edit?host=<parent origin> ──────────────────────────────────────
//
// The same editor, embedded by feelreef's own page to edit a REAL card. Owner architecture: reef
// decides WHO may edit (seats in its registry); this Worker owns storage and assembly; the browser
// never holds a bearer. So this route serves a page with NO card in it and NO credential — the card
// arrives from the parent over postMessage and goes back the same way (w2/host-bridge.mjs), and the
// parent does the save through `save_card`. Like /try/edit it never touches the CARDS store.
//
// `?host=` must be one of the allowed parent origins (validHostOrigin); it is written into the
// page's opts, used as the ONLY postMessage target and origin the editor accepts, and as the one
// ancestor allowed to frame this page (CSP frame-ancestors).
const HOST_EDIT_PATH = '/edit';

/** the /try/edit page (or, with `host`, the /edit page), localised. Never touches the CARDS store. */
function sandboxEditorHtml(localeKey, { host = '' } = {}) {
  const persona = SANDBOX_LOCALES[localeKey] || SANDBOX_LOCALES.en;
  const tableBase = `${SANDBOX_PATH}/t/${encodeURIComponent(localeKey)}/`;
  const opts = JSON.stringify(host
    ? { host, sandbox: false, locale: localeKey, tableBase }
    : { sandbox: true, locale: localeKey, tableBase }).replace(/</g, '\\u003c');
  // The banner text is written server-side into the markup, for the same reason a visitor without
  // JavaScript still needs it: a visitor (or a crawler, or `curl`) who never runs the script must
  // still be able to read "nothing here is saved". `boot()` overwrites the same elements with the
  // same strings from the same table, so the two can never disagree.
  const body = host ? EDIT2_BODY_HTML
    .replace('<h1>cardtile-w2</h1>',
      '<h1 class="ctw-brand"><a href="https://feelreef.com/" target="_top">feelreef</a><span>Card</span></h1>')
    : EDIT2_BODY_HTML
    .replace('<div class="ctw-sandbox-banner" id="sandbox-banner" hidden>', '<div class="ctw-sandbox-banner" id="sandbox-banner">')
    .replace('<span id="sandbox-banner-text"></span>', `<span id="sandbox-banner-text">${escLite(persona.bannerText)}</span>`)
    .replace('<span id="sandbox-banner-status"></span>', `<span id="sandbox-banner-status">${escLite(persona.bannerStatus)}</span>`)
    // …and the masthead. `cardtile-w2` is an internal codename; a visitor arriving from
    // feelreef.com must read feelreef, and the link IS the way back. Swapped HERE, in the sandbox
    // composition — the internal tool keeps its own name.
    .replace('<h1>cardtile-w2</h1>',
      '<h1 class="ctw-brand"><a href="https://feelreef.com/">feelreef</a><span>Card</span></h1>');
  return `<!doctype html>
<html lang="${persona.lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escLite(host ? persona.hostPageTitle : persona.pageTitle)}</title>
<style>${EDIT2_CSS}</style>
</head>
<body>
${body}
<script>
window.__CARDTILE_W2_OPTS__ = ${opts};
<\/script>
<script>${EDIT2_JS}<\/script>
<script>window.__cardtileW2Boot(window.__CARDTILE_W2_OPTS__);<\/script>
</body></html>`;
}

const router = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const reqHost = (request.headers.get('host') || url.host || '').toLowerCase().replace(/:\d+$/, '');
    // A route can be installed before cutover. Until the switch is on, this entire host is dark.
    if (reqHost === CARDS_HOST && !movedToCardsHost(env)) return NOT_RELAYED();

    // 🔴 FIRST, and before any host resolution. The write API is host-agnostic — reef-MCP calls the
    // canonical host, and a vanity domain must never expose it under a creator's own name. Putting
    // it after resolveHandle would mean `<a-creator's-domain>/_api/card/<someone-else>` resolved the
    // vanity to the FIRST creator and then ignored it, which is not wrong so much as it is a second idea of what a
    // hostname means. One door, one host-independent path.
    const api = await handleApi(request, env, url);
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
          const { md } = await liveCard(env.CARDS, handle);
          if (md != null) return new Response(null, { status: 301, headers: {
            Location: `https://${CARDS_HOST}${url.pathname}${url.search}`, 'Cache-Control': MOVED_CACHE,
          } });
        }
        return fetch(request);
      }
    }
    const moved = movedTo(reqHost, url, request.method, env);
    if (moved) return new Response(null, { status: 301, headers: { Location: moved, 'Cache-Control': MOVED_CACHE } });

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

    // The sandbox editor's own vendored Sortable.min.js — see canvasHtml()'s SORTABLE_SRC override
    // ── the engine's table, under the locale it will be read in ──────────────────────────────────
    const tbl = SANDBOX_TABLE_RE.exec(url.pathname);
    if (tbl) {
      const asset = tableAsset(primaryLocale(tbl[1]), tbl[2]);
      if (!asset) return new Response('no such table asset', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      return new Response(asset.body, {
        headers: {
          'Content-Type': TABLE_MIME[asset.ext] || 'application/octet-stream',
          'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-store',
          // never indexed, and framed only by our own editor page — which in host mode (/edit) is
          // itself framed by feelreef. 🩸 This used to be `X-Frame-Options: SAMEORIGIN`, and that
          // header judges the TOP page, so inside a feelreef page the board silently never loaded
          // (measured 2026-09-24 from a localhost host page: 0 tiles, a cross-origin `__ready`
          // error). CSP frame-ancestors lists every ancestor, so the chain feelreef → /edit → this
          // is allowed and anything else is not. Same list as validHostOrigin (w2/host-bridge.mjs).
          'X-Robots-Tag': 'noindex, nofollow',
          'Content-Security-Policy': "frame-ancestors 'self' https://feelreef.com https://staging.feelreef.com http://localhost:*",
        },
      });
    }

    // 🔴 THE RETIRED PATH. `/try/edit2` and `/try/edit2/` — and ONLY the bare page, never its
    // `/t/<locale>/…` table assets, which nothing outside this page's own script ever links to — 301
    // to the now-official `/try/edit`, carrying the query string across so a `?lang=` link still
    // resolves the same locale on arrival. This is what makes "no separate route kept alive" true
    // without breaking whatever already points at the old path.
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
      const locale = primaryLocale(params.get('lang') || params.get('locale')
        || localeFromAcceptLanguage(request.headers.get('accept-language')));
      return new Response(sandboxEditorHtml(locale, { host }), {
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
      const locale = primaryLocale(params.get('lang') || params.get('locale')
        || localeFromAcceptLanguage(request.headers.get('accept-language')));
      return new Response(sandboxEditorHtml(locale), {
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

    // A parked draft (preview_card). Unlisted, un-guessable, gone within the hour — and NEVER
    // indexed: a preview is a byte-for-byte near-duplicate of a live card, so an indexed one would
    // compete with the creator's own page in exactly the way the PREVIEW deployment rule exists to
    // prevent. `noindex` is set unconditionally here rather than via isPreview(), because this route
    // is reachable on PRODUCTION and that is the whole point of it.
    const pv = /^\/_preview\/([0-9a-f]{32})$/.exec(url.pathname);
    if (pv) {
      // A preview stamped with a generation that is no longer its handle's (the card was deleted while
      // it was being parked, reef#2618) is expired. One stamped with no handle (parked before r1)
      // keeps its hour; a handle without a generation is generation 0, as everywhere (r3).
      const row = env && env.CARDS ? await env.CARDS.getWithMetadata(previewKey(pv[1])) : null;
      const meta = row && row.metadata;
      const stale = row && row.value != null && meta && meta.handle
        && !isCurrentGen(meta, await generationOf(env.CARDS, meta.handle));
      const draft = row && !stale ? row.value : null;
      if (!draft) {
        return new Response('<!doctype html><meta charset=utf-8><title>Expired</title><p>This preview has expired.</p>', {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
        });
      }
      const videos = await resolveChannels(draft, ytFetch);
      return new Response(renderCardHTML(draft, { handle: '', cardUrl: '', videos }), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      });
    }

    // the QR coral, served as a versioned same-origin asset (immutable — see QR_PATH)
    if (url.pathname === QR_PATH || url.pathname === DRAWER_PATH) {
      const body = url.pathname === QR_PATH ? QR_JS : DRAWER_JS;
      return new Response(body, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' } });
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
    const icm = /^\/_icon\/([^/]+)\.ico$/.exec(url.pathname);
    if (icm) {
      const domain = decodeURIComponent(icm[1]).toLowerCase();
      // 🔴 The card's markdown is creator-authored and this concatenates into a URL. Without the
      // guard, `/_icon/<anything>.ico` is an open proxy — same discipline as VIDEO_RE on /_yt/.
      if (!ICON_DOMAIN_RE.test(domain)) return new Response('bad domain', { status: 400 });
      // 🔴 r9: we do NOT ask the edge to cache the upstream answer (cf.cacheTtl* would keep an
      // UNVALIDATED 200 — a transient text/html — for a week). Only a response that passed the MIME check
      // is stored, in caches.default, under this request's URL. A miss/5xx/rejected answer is never kept.
      // Two stages, in order, both fixed addresses (reef#2026): DuckDuckGo, then Google; only when both miss is it a 404.
      return relayImage(request, ctx, iconUpstreams(domain), 604800);
    }

    const ytm = /^\/_yt\/([A-Za-z0-9_-]+)\.jpg$/.exec(url.pathname);
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
    const host = (request.headers.get('host') || url.host || '').toLowerCase().replace(/:\d+$/, '');
    const md = /^(.*)\.md$/.exec(url.pathname);

    // CARDS store: card:<handle>:<gen> → card.md (card-api genKey), plus the vanity bindings. Missing
    // binding (local/misconfig) is a clear 500, not a crash. Read before routing now, because routing needs it.
    const store = env && env.CARDS;
    if (!store) return html('<!doctype html><meta charset=utf-8><p>card store not bound</p>', 500, env);

    // Vanity routing uses the forward binding here or the inverse below:
    // the canonical host can never be a vanity, and a vanity host is already where it belongs.
    // A binding from an ended lifetime is no binding: the host is then unbound (404 below), never the
    // next owner's card. The generation read here is the one the card is read under.
    let pointer = host && host !== CANON_HOST && host !== CARDS_HOST ? await store.get(VANITY_KEY(host)) : null;
    // 🔴 r9: `vanity:<host>` is HostBindings' write-through cache, so a MISS on a creator's domain may be
    // a put that failed after the bind was accepted: ask the host's object, once (card-api hostOwner)
    if (pointer == null && host && !routesByPath(host)) pointer = await hostOwner(env, host);
    const boundGen = pointer != null ? await generationOf(store, pointer) : null;
    const vanityHandle = boundGen != null && (await isBound(store, pointer, boundGen, host)) ? pointer : null;
    const resolved = resolveHandle(host, md ? (md[1] || '/') : url.pathname,
      vanityHandle ? { [host]: vanityHandle } : {});
    if (!resolved) {
      // the directory hint only where a path can name a card; an unbound creator's domain names nothing
      return routesByPath(host)
        ? html('<!doctype html><meta charset=utf-8><title>feelreef Cards</title><p>Pick a card: /&lt;handle&gt;</p>', 404, env)
        : html('<!doctype html><meta charset=utf-8><title>Not found</title><p>Nothing here.</p>', 404, env);
    }

    // Is this path the card at all? Unknown paths cost no store read and no render. See cardPath.
    // Card exits read the body and stop marker in parallel before any exit or redirect.
    // the root card on reef.cards is addressed like a one-card host (resolveHandle `root`)
    const oneCardHost = !!vanityHandle || !!resolved.root;
    const at = { host, vanity: !!vanityHandle };
    const want = cardPath(url.pathname, resolved.handle, oneCardHost);
    if (!want) return html('<!doctype html><meta charset=utf-8><title>Not found</title><p>Nothing here.</p>', 404, env, resolved.handle, at);
    // liveCard reads `gen:` then that generation's body and stop (reef#2618 r3, card-api genKey): a body
    // or stop written in a deleted lifetime is under a key this never reads, so it falls through to the
    // 410/404 below exactly as a missing body does.
    const { md: cardMd, stopped, gen } = await liveCard(store, resolved.handle, { stop: true, gen: vanityHandle ? boundGen : null });
    if (stopped != null) {
      return new Response('<!doctype html><meta charset=utf-8><title>Unavailable</title><p>This Card is unavailable.</p>', {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          Vary: 'Accept',
        },
      });
    }
    // reef#2618 — its owner deleted it. 410, not 404: the address did have a card, and saying so
    // lets search engines drop it. Read only when the body is missing, so a live card pays nothing;
    // and the page names nothing from the old card. no-store: the handle is free, and the next
    // save must show at once.
    if (cardMd == null && (await store.get(goneKey(resolved.handle))) != null) {
      return new Response('<!doctype html><meta charset=utf-8><title>Gone</title><p>This Card has been deleted.</p>', {
        status: 410,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          Vary: 'Accept',
        },
      });
    }

    // reef#2044 ④ — read once, used by every exit below that serves this card (page, markdown, icons).
    const blank = cardMd != null && isTemplateOnly(cardMd);

    if (want === 'alias') return Response.redirect(`https://${host}/${url.search}`, 301);

    // The avatar is an image exit on both hosts, before the page's canonical→vanity redirect.
    // cardAvatar validates stored raster assets; remote pictures pass the proxy's type allowlist.
    if (want === 'avatar') {
      const avatar = cardMd ? cardAvatar(parseCard(cardMd)) : null;
      const image = !avatar ? NOT_RELAYED()
        : avatar.url ? await relayAvatar(request, ctx, avatar.url)
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
      if (!cardMd) return new Response('', { status: 404, headers: { 'Cache-Control': 'public, max-age=60', ...ROBOTS_HEADERS(env, resolved.handle, at) } });
      const file = await iconFile(want, parseCard(cardMd),
        { name: cardName(cardMd, resolved.handle), accent: frontmatter(cardMd, 'accent') });
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
    if (ownHost && host !== ownHost) {
      return Response.redirect(`https://${ownHost}${url.search}`, 301);
    }

    if (!cardMd) return html('<!doctype html><meta charset=utf-8><title>Not found</title><p>No card for “' + resolved.handle + '”.</p>', 404, env, resolved.handle, at);

    // the download link, in the form this host actually uses
    // (the root card keeps the canonical form: `/index.md` on reef.cards would name the handle `index`)
    const fatUrl = vanityHandle ? `https://${host}/index.md`
      : resolved.root ? `https://${host}/${ROOT_HANDLE}.md` : `${resolved.cardUrl}.md`;

    if (wantFat) return markdown(cardMd, { env, originalLength: cardMd, handle: resolved.handle, at, blank });

    if (wantsMarkdown(request)) {
      // 🔴 Strip the assets by round-tripping through card-core, not by cutting text. parseCard
      // hoists `## assets` out of `cells` already, and serializeCard writes them back sorted at the
      // end — so dropping and re-attaching is byte-exact (measured on all three cards). A regex over
      // the file would be a second, weaker idea of where the lane begins.
      const thin = serializeCard({ ...parseCard(cardMd), assets: {} });
      return markdown(thin, { env, originalLength: cardMd, alternate: fatUrl, handle: resolved.handle, at, blank });
    }

    // 🔴 Resolution happens HERE, not in a coral. A coral runs in the browser, so it would cost a
    // round trip for something the renderer can do server-side — and it would be the visitor's
    // browser making it, which is condition 4 again. The cache key is the feed URL, i.e. the
    // CHANNEL: a thousand cards pointing at one channel share one fetch, so cost does not scale with
    // cards (condition 2). renderCardHTML stays pure and synchronous; it receives the answer.
    //
    // Failure is not propagated. resolveChannels never throws and returns {} when YouTube is
    // unreachable, which lands the block on its designed degraded state (condition 3). A creator's
    // card must not go down because a video platform did.
    const videos = await resolveChannels(cardMd, ytFetch);

    return html(renderCardHTML(cardMd, { ...resolved, videos }), 200, env, resolved.handle, at, blank);
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

export default {
  async fetch(request, env, ctx) {
    return withNoindexAll(await router.fetch(request, env, ctx), env);
  },
};

// The Durable Objects: each host's one pointer writer (card-api HostBindings) and each handle's one
// lifetime authority (CardLifetime). The runtime finds a Durable Object class by its export from the
// main module, so they are re-exported here.
export { HostBindings, CardLifetime } from './card-api.mjs';
