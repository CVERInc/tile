// REEF with Card — the multi-tenant edge renderer. ONE Worker renders EVERY card: it resolves a
// handle from the request, reads that handle's card.md from the CARDS store, and renders it with
// cardtile (card-core + card-render). Adding a card is a STORE WRITE, never a repo/deploy — this is
// the millions-of-free-cards shape (cardtile renders DATA), the native replacement for the Python
// card_render.py that bakes one card's HTML per request on Heroku.
//
//   card.feelreef.com/<handle>   → handle = first path segment (canonical)
//   <creator's own domain>/      → handle via the store's vanity: binding (one domain = one card)
//   /_coral/<coral>-<ver>.js     → a coral client (served here so the page can <script src> it)
//
// The render path (resolveHandle → renderCardHTML) is pure and node-testable; the fetch handler is
// the only edge-specific shell. One brain, two runtimes (same pattern as events-worker).
import { parseCard, serializeCard } from '../card-core.js';
import { renderPage } from '../card-render.mjs';
import { CSS, ICONS, QR_JS, QR_VERSION, DRAWER_JS, DRAWER_VERSION, ARROW } from './card-assets.mjs';
import { resolveChannels, VIDEO_RE } from '../yt.mjs';
import { ICON_DOMAIN_RE, iconUpstream } from '../marks.mjs';
import { handleApi, previewKey, tryKey, TRY_TTL, TRY_MAX_BYTES } from './card-api.mjs';
import { EDIT2_BODY_HTML, EDIT2_CSS, EDIT2_JS, TABLE_FILES, TABLE_I18N } from './edit2-assets.mjs';
import { localeFromAcceptLanguage, primaryLocale, SANDBOX_LOCALES, chromeStrings } from '../w/sandbox-i18n.mjs';
import { ENGINE_LOCALE_FILE, boardLocaleJson } from '../w2/board-i18n.mjs';

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
const VANITY_KEY = (host) => `vanity:${host}`;
const VANITY_OF_KEY = (handle) => `vanityof:${handle}`;

// canonical multi-tenant host — a bare visit here (no handle) is a directory, not a card.
const CANON_HOST = 'card.feelreef.com';

/**
 * resolveHandle: (host, pathname, vanity) → { handle, cardUrl } | null. Pure.
 *
 * `vanity` is the host→handle map for THIS request — normally zero or one entry, read from the
 * store by the caller. Injected rather than fetched here on purpose: this function is the one
 * piece of the routing that is worth unit-testing, and it stays synchronous and pure so it can be.
 * The default is empty, so a caller that forgets it gets canonical-path routing and never a
 * silently wrong card.
 */
export function resolveHandle(host, pathname, vanity = {}) {
  host = (host || '').toLowerCase().replace(/:\d+$/, '');
  const seg = (pathname || '/').replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  if (vanity[host]) return { handle: vanity[host], cardUrl: 'https://' + host };            // vanity domain = one card
  if (seg) return { handle: seg.toLowerCase(), cardUrl: 'https://' + (host || CANON_HOST) + '/' + seg.toLowerCase() };
  return null;                                                                                // canonical host, no handle → directory
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
 */
export const cardUrlFor = (handle, vanity = {}) => {
  const host = Object.keys(vanity).find((h) => vanity[h] === handle);
  return host ? `https://${host}` : `https://${CANON_HOST}/${handle}`;
};

/** renderCardHTML: (cardMd, {handle, cardUrl}) → HTML string. Pure — the shared brain. */
export function renderCardHTML(cardMd, ctx = {}) {
  const model = parseCard(cardMd);
  const name = /^title:\s*(.+)$/m.exec(cardMd)?.[1]?.trim() || ctx.handle || '';
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
  const unquote = (v) => (/^(['"]).*\1$/.test(v) ? v.slice(1, -1).trim() : v);
  const fm = (k) => unquote(new RegExp('^' + k + ':\\s*(.+)$', 'm').exec(cardMd)?.[1]?.trim() || '');
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

// 🔴 `Vary: Accept` on EVERY response the card path can produce, including the HTML one.
//
// One URL now answers with two different bodies depending on Accept, and the edge caches for 60s.
// Without Vary the first response wins for everyone: a browser gets markdown, or an agent gets HTML,
// for up to a minute, at random. Putting it only on the markdown response is the version that looks
// right and still breaks — the HTML response is the one that gets cached first, because that is what
// people request.
const CARD_HEADERS = (env, handle) => ({
  'Cache-Control': 'public, max-age=60',
  Vary: 'Accept',
  ...(isPreview(env) || isDemo(handle) ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
});

const html = (body, status = 200, env = null, handle = '') =>
  new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...CARD_HEADERS(env, handle) },
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

const markdown = (body, { env, originalLength, alternate, handle }) =>
  new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Markdown-Tokens': String(estTokens(body)),
      'X-Original-Tokens': String(estTokens(originalLength)),
      ...(alternate ? { Link: `<${alternate}>; rel="alternate"; type="text/markdown"` } : {}),
      ...CARD_HEADERS(env, handle),
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
  const body = TABLE_FILES[path];
  if (body == null) return null;
  const ext = path.slice(path.lastIndexOf('.'));
  // the host's index.html is the only one that varies with the visitor (it does not, today — but it
  // is the document, and a document that is cached for a year is a document that cannot be fixed)
  return { body, ext, immutable: path !== 'index.html' };
}

/** the /try/edit page, localised. Never touches the CARDS store — everything it needs is bundled. */
function sandboxEditorHtml(localeKey) {
  const persona = SANDBOX_LOCALES[localeKey] || SANDBOX_LOCALES.en;
  const opts = JSON.stringify({ sandbox: true, locale: localeKey, tableBase: `${SANDBOX_PATH}/t/${encodeURIComponent(localeKey)}/` });
  // The banner text is written server-side into the markup, for the same reason a visitor without
  // JavaScript still needs it: a visitor (or a crawler, or `curl`) who never runs the script must
  // still be able to read "nothing here is saved". `boot()` overwrites the same elements with the
  // same strings from the same table, so the two can never disagree.
  const body = EDIT2_BODY_HTML
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
<title>${escLite(persona.pageTitle)}</title>
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 🔴 FIRST, and before any host resolution. The write API is host-agnostic — reef-MCP calls the
    // canonical host, and a vanity domain must never expose it under a creator's own name. Putting
    // it after resolveHandle would mean `<a-creator's-domain>/_api/card/<someone-else>` resolved the
    // vanity to the FIRST creator and then ignored it, which is not wrong so much as it is a second idea of what a
    // hostname means. One door, one host-independent path.
    const api = await handleApi(request, env, url);
    if (api) return api;

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
          // never indexed, and never framed by anybody else: this document is an editing surface
          // that a parent page reaches into, and the only parent allowed to is our own.
          'X-Robots-Tag': 'noindex, nofollow',
          'X-Frame-Options': 'SAMEORIGIN',
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
      const draft = env && env.CARDS ? await env.CARDS.get(previewKey(pv[1])) : null;
      if (!draft) {
        return new Response('<!doctype html><meta charset=utf-8><title>Expired</title><p>This preview has expired.</p>', {
          status: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
        });
      }
      const videos = await resolveChannels(draft, (u) => fetch(u, { cf: { cacheTtl: 1800, cacheEverything: true } }));
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
    const icm = /^\/_icon\/([^/]+)\.ico$/.exec(url.pathname);
    if (icm) {
      const domain = decodeURIComponent(icm[1]).toLowerCase();
      // 🔴 The card's markdown is creator-authored and this concatenates into a URL. Without the
      // guard, `/_icon/<anything>.ico` is an open proxy — same discipline as VIDEO_RE on /_yt/.
      if (!ICON_DOMAIN_RE.test(domain)) return new Response('bad domain', { status: 400 });
      const up = await fetch(iconUpstream(domain), { cf: { cacheTtl: 604800, cacheEverything: true } })
        .catch(() => null);
      // A missing mark is not an error — the card's own fallback chain takes over, and after that it
      // hides the slot. A broken image on someone's card is worse than no icon.
      if (!up || !up.ok) return new Response('', { status: 404 });
      return new Response(up.body, {
        headers: {
          'Content-Type': up.headers.get('content-type') || 'image/x-icon',
          'Cache-Control': 'public, max-age=604800',
        },
      });
    }

    const ytm = /^\/_yt\/([A-Za-z0-9_-]+)\.jpg$/.exec(url.pathname);
    if (ytm) {
      if (!VIDEO_RE.test(ytm[1])) return new Response('bad id', { status: 400 });
      const upstream = await fetch(`https://i.ytimg.com/vi/${ytm[1]}/hqdefault.jpg`, {
        cf: { cacheTtl: 86400, cacheEverything: true },
      }).catch(() => null);
      // No poster is not an error — the card falls back to the designed degraded state.
      if (!upstream || !upstream.ok) return new Response('', { status: 404 });
      return new Response(upstream.body, {
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
      });
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
    const wantFat = !!md;

    // CARDS store: handle → card.md, plus the vanity bindings. Missing binding (local/misconfig) is
    // a clear 500, not a crash. Read before routing now, because routing needs it.
    const store = env && env.CARDS;
    if (!store) return html('<!doctype html><meta charset=utf-8><p>card store not bound</p>', 500, env);

    // AT MOST ONE extra read per request, and the two branches are mutually exclusive:
    // the canonical host can never be a vanity, and a vanity host is already where it belongs.
    const vanityHandle = host && host !== CANON_HOST ? await store.get(VANITY_KEY(host)) : null;
    const resolved = resolveHandle(host, wantFat ? (md[1] || '/') : url.pathname,
      vanityHandle ? { [host]: vanityHandle } : {});
    if (!resolved) return html('<!doctype html><meta charset=utf-8><title>feelreef Cards</title><p>Pick a card: /&lt;handle&gt;</p>', 404, env);

    // 🔴 A card with its own domain has ONE address. `card.feelreef.com/<handle>` served the same
    // page as the creator's own apex, which is duplicate content competing with them in search —
    // and the canonical URL is the one WE own, so we would be the ones outranking them.
    //
    // 301 (permanent) because it is: the vanity host is where that card lives from the moment it is
    // bound. Only the HTML view redirects — `/_api/` never reaches here, and the `.md` exits keep
    // working on both hosts because a download link somebody already has must not break.
    const wouldRedirect = !vanityHandle && !wantFat && !wantsMarkdown(request);
    const ownHost = wouldRedirect ? await store.get(VANITY_OF_KEY(resolved.handle)) : null;
    if (ownHost && host !== ownHost) {
      return Response.redirect(`https://${ownHost}${url.search}`, 301);
    }

    const cardMd = await store.get(resolved.handle);
    if (!cardMd) return html('<!doctype html><meta charset=utf-8><title>Not found</title><p>No card for “' + resolved.handle + '”.</p>', 404, env);

    // the download link, in the form this host actually uses
    const fatUrl = vanityHandle ? `https://${host}/index.md` : `${resolved.cardUrl}.md`;

    if (wantFat) return markdown(cardMd, { env, originalLength: cardMd, handle: resolved.handle });

    if (wantsMarkdown(request)) {
      // 🔴 Strip the assets by round-tripping through card-core, not by cutting text. parseCard
      // hoists `## assets` out of `cells` already, and serializeCard writes them back sorted at the
      // end — so dropping and re-attaching is byte-exact (measured on all three cards). A regex over
      // the file would be a second, weaker idea of where the lane begins.
      const thin = serializeCard({ ...parseCard(cardMd), assets: {} });
      return markdown(thin, { env, originalLength: cardMd, alternate: fatUrl, handle: resolved.handle });
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
    const videos = await resolveChannels(cardMd, (u) => fetch(u, {
      cf: { cacheTtl: 1800, cacheEverything: true },
    }));

    return html(renderCardHTML(cardMd, { ...resolved, videos }), 200, env, resolved.handle);
  },
};
