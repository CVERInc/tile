// smoke-build — re-runnable end-to-end check for the sitetile Astro seam.
// Runs `astro build` on the fixtures (content/home.md — a realistic marketing homepage exercising
// all 5 section types; content/blocks.md — base content blocks; content/markers.md — graduated
// markers the home fixture can't reach: logo hero, block-image figure, whole-cell links;
// content/custom-theme.md — the existing Lilac hand-authored theme) and asserts the rendered output.
// Exits non-zero on any miss.
//   usage: node smoke-build.mjs   (or: npm run smoke)
//
// ISOLATED OUTPUT: builds into dist-smoke/ (gitignored), NEVER dist/ — dist/ is the shared build
// berth that real site builds (recast pipelines pointing this renderer at client content) also
// write to. A smoke that rebuilt dist/ would clobber a sibling session's in-flight site build —
// a shared ruler two workers bend. The smoke owns its own output dir.
//
// JS INVARIANT — zero UNACCOUNTED JS (this file's original wording: "ZERO excess JS"). The
// renderer's doctrine is progressive enhancement: pages are complete server-rendered HTML, and
// the only client JS allowed is the known, self-gating PE set below (each landed with its own
// commit doctrine: opt-in, no-ops when its feature is absent, reduced-motion respected, SEO/AX
// kept). At the invariant's founding (481a7b0) that set was empty, so "zero excess" measured as
// literally zero; the set has since earned members. The sharpened check: every <script> on every
// built page, and every emitted .js chunk, must match a signature in the allowlist — one
// unaccounted script or chunk, or any framework hydration (astro-island), fails the smoke. New
// client JS must be added here CONSCIOUSLY, with its doctrine, or the build goes red.

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist-smoke');
const LILAC_SOURCE = join(HERE, '../examples/lilac/theme.css');
const LILAC_STAGED = join(HERE, 'src/themes/lilac.css');

console.log('▸ astro build → dist-smoke/ (themeless + staged Lilac custom-theme fixtures)…');
if (existsSync(LILAC_STAGED)) throw new Error(`refusing to shadow an existing staged theme: ${LILAC_STAGED}`);
copyFileSync(LILAC_SOURCE, LILAC_STAGED);
try {
  execFileSync('npx', ['astro', 'build', '--outDir', DIST], {
    cwd: HERE, stdio: 'inherit',
    env: { ...process.env, SITE_ID: 'smoke-site', PLATFORM_ORIGIN: 'https://feelreef.com' },
  });
} finally {
  rmSync(LILAC_STAGED, { force: true });
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const blocks = readFileSync(join(DIST, 'blocks/index.html'), 'utf8');
const rss = readFileSync(join(DIST, 'rss.xml'), 'utf8');
// forms.md — the `form` coral, which until 2026-08-15 had no rendering test of
// any kind. Two sections: one wired to an inbox, one deliberately not.
const forms = readFileSync(join(DIST, 'forms/index.html'), 'utf8');
// a built post page by slug — walks DIST itself rather than borrowing the script audit's list,
// which is built later in the file (and is that function's local).
const findPost = (slug) => {
  const hits = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const f = join(dir, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (e === 'index.html' && dir.endsWith('/' + slug)) hits.push(f);
    }
  })(DIST);
  return hits.length ? readFileSync(hits[0], 'utf8') : '';
};
const signedPost = findPost('a-signed-post');
const unsignedPost = findPost('an-unsigned-post');
const markers = readFileSync(join(DIST, 'markers/index.html'), 'utf8');
const customThemeBuilt = readFileSync(join(DIST, 'custom-theme/index.html'), 'utf8');
const localeExcept = readFileSync(join(DIST, 'zh-tw/blocks/index.html'), 'utf8');
const siteOff = readFileSync(join(DIST, 'ko-kr/index.html'), 'utf8');
// Safe negative-control seam: mutate only the HTML held by this test process, never source/output.
const customTheme = process.env.SITETILE_SMOKE_REMOVE_CUSTOM_MARKER === '1'
  ? customThemeBuilt.replace(/\sdata-theme-custom(?:="")?/, '')
  : customThemeBuilt;

const occIn = (s, str) => (s.match(new RegExp(str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
const occ = (s) => occIn(html, s);

// ---- the accounted client-JS set (signature → the doctrine that earned it) ----
// header-overlay  13896b8: transparent header solidifies past the hero; self-gates (no hero → no-op)
// parallax        697abd1: layered hero damped parallax; opt-in marker, respects reduced-motion
// pv-gate/resume  1f53aff: preview content-notice gate + resume link (reader is a product feature)
// reader chunk    1f53aff: pagetile Kindle-grade reader (paged/scroll/spread/scrubber)
// ha-toggle       header-actions / nav-mobile a11y polish: Escape-to-close + Enter/Space on the
//                 role="button" toggle labels (open/close itself is a pure CSS checkbox). Self-gates:
//                 no [data-ha-toggle] on the page → no-op. Loads once a site has a nav (mobile
//                 hamburger) or a header-actions drawer — the nav fixture is the first to reach it.
// pkg-runtimes    SiteLayout body-end conditional imports (bleedblend et al) — Astro emits the
//                 chunk even when no fixture page opts in; it must stay UNREFERENCED by fixtures.
const ALLOWED_INLINE = [
  ['site inbox bubble module', '/corals/inbox-bubble/v0/inbox-bubble.js'],
  ['header-overlay', 'rf-header--overlay'],
  ['parallax', 'st-hero-layered[data-parallax]'],
  ['pv-gate', 'pv-notice-ok'],
  ['ha-toggle (nav hamburger / drawer a11y)', 'data-ha-toggle'],
  // 🩸 Both Lingo scripts below had NEVER been through this audit. No fixture set `packages:`, so
  // hasLingo was false in every smoke build and the whole locale path — including its client JS —
  // was a different code path from every real Lingo site. "Zero unaccounted JS" was true of a
  // configuration nobody runs. Verified progressive before admitting them, not assumed:
  //   · the banner ships `hidden` from the server and the script only ever un-hides it, so JS-off
  //     leaves no empty shell (checked against the built markup, because a populated-by-JS box
  //     that renders visible-and-empty is exactly the blank-theme-toggle defect)
  //   · /language renders real <a href="/ja-jp/"> anchors; the script decorates, it does not
  //     create the links
  // Signatures are STRING LITERALS, not identifiers — minification renames locals every build.
  ['signet locale banner (Lingo suggest-your-language)', 'signet-locale-banner-dismiss'],
  ['language chooser (/language route)', '[data-language-link]'],
  // form: action=inbox only. Progressive enhancement over a real POST/GET-less static
  // build — the coral cannot read `?inbox=` at build time, so a tiny script toggles the
  // pre-rendered (server-hidden) status line after a real submit redirects back here. A
  // no-JS visitor still gets a working <form method="post" action="/__reef/inbox">; they
  // just don't see the thank-you/error line swap in.
  ['form inbox status (action=inbox only, self-gating on ?inbox=)', '[data-inbox-sent]'],
];
const ALLOWED_CHUNKS = [
  ['pagetile reader', 'ptr-mode:'],
  ['pkg-runtimes (bleedblend canvas)', 'willReadFrequently'],
];

// 🩸 2026-08-08. This audit counted <script> TAGS, and a <script type="application/ld+json"> is
// not script — the HTML spec says a script whose type is not a JS MIME type is a data block the
// browser never executes. So the day structured data landed, eight JSON-LD blocks became
// "unaccounted JS" and the smoke went red on correct output. It stayed red, and because
// scripts/test.sh never ran the smoke, every commit still printed ALL GREEN.
//
// The invariant is "zero unaccounted client JS", not "zero <script> elements". A gate that
// measures the tag instead of the behaviour reports a defect nobody can act on — the only
// available action is to delete correct markup or to stop reading the gate, and we did the second.
//
// Excused by TYPE, never by content: an allowlist of MIME types a browser will not execute. Kept
// as an allowlist so a new type has to be admitted deliberately, and the count is printed so the
// excuse can never grow silently — a gate that quietly skips more each release is not a gate.
const DATA_SCRIPT_TYPES = new Set(['application/ld+json', 'application/json', 'importmap', 'speculationrules']);

/** Does the browser EXECUTE this <script>? Empty/absent type and JS MIME types run; everything
 *  else is data. Per HTML spec the type match is ASCII case-insensitive with surrounding
 *  whitespace stripped. */
function executesAsScript(attrs) {
  const m = /\btype\s*=\s*"([^"]*)"/i.exec(attrs) || /\btype\s*=\s*'([^']*)'/i.exec(attrs);
  if (!m) return true;
  const type = m[1].trim().toLowerCase().split(';')[0];
  if (!type || type === 'module') return true;
  return !DATA_SCRIPT_TYPES.has(type);
}

// every built page's scripts, inline or src-referenced, matched against the allowlist
function auditScripts() {
  const pages = [];
  (function walk(dir) {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.html')) pages.push(p);
    }
  })(DIST);
  const unaccounted = [];
  const dataBlocks = [];
  for (const page of pages) {
    const h = readFileSync(page, 'utf8');
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(h))) {
      if (!executesAsScript(m[1])) { dataBlocks.push(m[1].trim()); continue; }
      const src = /src="([^"]+)"/.exec(m[1]);
      const body = src ? (/^https?:\/\//.test(src[1]) ? src[1] : readFileSync(join(DIST, src[1].replace(/^\//, '')), 'utf8')) : m[2];
      const hit = [...ALLOWED_INLINE, ...ALLOWED_CHUNKS].find(([, sig]) => body.includes(sig));
      if (!hit) unaccounted.push(`${page.slice(DIST.length + 1)}: ${(src ? 'src ' + src[1] + ' → ' : '') + body.trim().slice(0, 70)}`);
    }
  }
  return { pages, unaccounted, dataBlocks };
}

/** Count the scripts on one page that the browser will actually run. */
function executableScripts(h) {
  return [...h.matchAll(/<script\b([^>]*)>/g)].filter((m) => executesAsScript(m[1])).length;
}

function auditChunks() {
  const dir = join(DIST, '_astro');
  const bad = [];
  if (existsSync(dir)) for (const e of readdirSync(dir)) {
    if (!e.endsWith('.js')) continue;
    const body = readFileSync(join(dir, e), 'utf8');
    if (!ALLOWED_CHUNKS.some(([, sig]) => body.includes(sig))) bad.push(e);
  }
  return bad;
}

// all CSS the page actually uses — inline <style> + any external stylesheets Astro extracted
// (Astro inlines small CSS but moves larger bundles to /_astro/*.css; both count).
function allCss() {
  let css = html;
  const dir = join(DIST, '_astro');
  if (existsSync(dir)) for (const e of readdirSync(dir)) if (e.endsWith('.css')) css += readFileSync(join(dir, e), 'utf8');
  return css;
}

const { pages, unaccounted, dataBlocks } = auditScripts();
const badChunks = auditChunks();

// ---- the icon set (see packages/sitetile/icon-core.mjs) ----
// The model's own unit tests decode the bytes; what only THIS gate can prove is that a real
// `astro build` emits the three routes as files and that the pages link them. The fixtures set no
// `favicon:`, so what is being built here is the born-valid path: a site that configured nothing.
const distFile = (p) => join(DIST, p.replace(/^\//, ''));
/** every icon href every built page claims — the dead-link gate below reads this. */
function claimedIcons() {
  const claimed = new Set();
  for (const page of pages) {
    const h = readFileSync(page, 'utf8');
    for (const m of h.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) claimed.add(m[1]);
  }
  return [...claimed];
}

const checks = [
  // -- born-on site inbox bubble: site/page resolution + legacy embed dedupe --
  ['inbox bubble: default on with the build site key, platform origin, page title, and site name', () =>
    /<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="smoke-site" data-api-base="https:\/\/feelreef\.com" data-title="Yamada Letterpress — one character, one piece of lead" data-site-name="Yamada Letterpress"><\/div>\s*<script type="module" src="https:\/\/feelreef\.com\/corals\/inbox-bubble\/v0\/inbox-bubble\.js"><\/script>/.test(html)],
  ['inbox bubble: site off suppresses it', () => occIn(siteOff, 'data-dynamic-coral="inbox-bubble"') === 0],
  ['inbox bubble: locale-agnostic except suppresses /zh-tw/blocks via /blocks', () => occIn(localeExcept, 'data-dynamic-coral="inbox-bubble"') === 0],
  ['inbox bubble: explicit page on wins over the site /markers exclusion', () => occIn(markers, 'data-dynamic-coral="inbox-bubble"') === 1],
  ['inbox bubble: a hand-mounted embed is not doubled', () => occIn(forms, 'data-dynamic-coral="inbox-bubble"') === 1],
  // -- sodaart /faq, 2026-09-03: the bubble's panel header is the STORE's stable name, and must
  // stay that on every page — not each page's own composed <title> (was measured live as
  // "常見問題 | SODAART【新官網轉移中】", the FAQ page's own title text, on a page whose title has
  // nothing to do with the home page's). `markers.md` is the fixture's only non-home page with the
  // auto-mounted (not hand-authored) bubble on, and its own title is deliberately unrelated to the
  // site's `brand:` — proving data-site-name tracks the SITE config, not whichever page renders it.
  ['inbox bubble: on a non-home page, data-site-name is the SITE\'s name, not that page\'s own title', () =>
    /<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="smoke-site" data-api-base="https:\/\/feelreef\.com" data-title="Marker coverage — hero variants \+ linked cells" data-site-name="Yamada Letterpress"><\/div>/.test(markers)],
  // og:site_name — per Open Graph it is the SITE's name (og:title already carries the page).
  ['og:site_name: the home page emits it as the site\'s own brand', () =>
    /<meta property="og:site_name" content="Yamada Letterpress">/.test(html)],
  ['og:site_name: a non-home page still emits the site\'s brand, not its own <title>', () =>
    /<meta property="og:site_name" content="Yamada Letterpress">/.test(markers)
    && !markers.includes('<meta property="og:site_name" content="Marker coverage')],
  // -- home.md: the 5 section types + platform defaults --
  // 🩸 2026-08-28. `class="st-hero"` was an EXACT string match, so it broke the moment the section
  // gained a second class — which every hero variant now does (`.st-full-bleed`, the opt-out from
  // the generic section-inset floor below; see site.css). Matched here as `st-hero st-full-bleed`
  // rather than loosened to a substring check, so the assertion still pins the exact class list a
  // non-layered hero renders, not just "some class starting with st-hero".
  ['hero renders', () => occ('class="st-hero st-full-bleed"') === 1],
  ['grid renders', () => occ('class="st-grid"') === 1],
  ['prose renders', () => occ('class="st-prose"') >= 1],
  ['cta renders', () => occ('class="st-cta"') === 1],
  ['embed renders', () => occ('class="st-embed"') === 1],
  ['hero background-image', () => /class="st-hero st-full-bleed"[^>]*background-image:url\(/.test(html)],
  ['hero CTA anchor', () => /st-hero-cta"\s+href="\/checkup"/.test(html)],
  ['grid has 3 cells', () => occ('class="st-cell"') === 3],
  ['grid cols=3', () => /class="st-grid"[^>]*\sdata-cols="3"/.test(html)],
  // The label is the fixture's, so it moves WITH the fixture — what the assertion is actually
  // about is the shape around it: primary class, the declared href, the label verbatim, arrow span.
  ['cta button anchor (primary + arrow)', () =>
    /class="st-cta-btn st-cta-btn-primary" href="\/start">Come by<span class="st-cta-arrow"/.test(html)],
  ['embed iframe verbatim', () => /<section class="st-embed"[^>]*><iframe src="https:\/\/www\.youtube\.com\/embed\//.test(html)],
  ['cssmd inline (bold span)', () => occ('class="st-b"') >= 1],
  // 🩸 Section anchors, 2026-08-18. The id has been computed by `parseSite` since
  // it was written and was never emitted — measured on live cver.net, whose whole
  // homepage carried one id, belonging to a locale banner. It is emitted now so a
  // KAITO citation can point at the PASSAGE it quoted rather than the page around
  // it. This assertion is the only one that proves the attribute survives a real
  // build; a miss is invisible in use, because the link still resolves and just
  // lands at the top of the page.
  ['every section carries an id', () => {
    const tags = html.match(/<section\b[^>]*>/g) || [];
    const anchored = tags.filter((t) => /\sid="s\d+/.test(t));
    return tags.length > 0 && anchored.length === tags.length;
  }],
  ['section id is s<n>-<slug> and matches its own heading', () =>
    /<section class="st-grid"[^>]*\sid="s\d+-[^"]+"/.test(html)],
  ['native View Transitions', () => html.includes('@view-transition { navigation: auto; }')],
  ['reef landmarks', () => html.includes('reef-header') && html.includes('reef-nav') && html.includes('reef-footer')],
  // 🩸 2026-08-08. This was `/hreflang="ja-JP"/` and had been red since 2026-08-06, when the
  // hreflang set was changed from `locales.map(...)` to MEASURED — advertise a locale only when
  // this page really exists in it (that fix removed ~429 alternates pointing at 404s on one site
  // alone). home.md declares three locales and the fixtures had a page in exactly one, so the old
  // assertion was asserting the BUG: anyone who "fixed the smoke" by making it pass would have put
  // the dead alternates back. A rotted ruler does not read as rotted — it reads as broken code.
  //
  // Fixed by moving the SPECIMEN, not the ruler: content/ja-jp/home.md is a real second locale, so
  // one page now tests both directions of the invariant at once. en-US stays declared-but-absent
  // on purpose — it is the negative case, and nothing tested it before.
  //
  // Values come from lingo/locale.mjs's documented BCP-47 mapping (zh-TW→zh-Hant, ja-JP→ja,
  // en-US→en), not from reading them off the build — an assertion copied from its own output
  // agrees with itself forever.
  ['Lingo hreflang: a locale WITH a page is advertised', () =>
    /hreflang="ja"/.test(html) && /hreflang="zh-Hant"/.test(html)],
  ['Lingo hreflang: all four locales of the home page are advertised', () =>
    ['en', 'ja', 'ko', 'zh-Hant'].every((l) => new RegExp(`hreflang="${l}"`).test(html))
    && /hreflang="zh-Hant" href="[^"]*\/zh-tw\/"/.test(html)],
  // 🔴 THE NEGATIVE. It used to live on the home page, where en-US was declared and absent; the
  // home page exists in all four locales now, so that specimen was gone and the assertion would
  // have passed forever on a page that could no longer fail it. Moved to blocks.md — four
  // declared, two present — which is also the only fixture reaching alternateLocales' non-home
  // branch. Both halves are asserted: what IS advertised, and what must not be.
  ['🔴 Lingo hreflang: a locale declared but ABSENT is not advertised', () =>
    /locales:\s*.*ja-JP/.test(readFileSync(new URL('./content/blocks.md', import.meta.url), 'utf8'))
    && /hreflang="zh-Hant" href="[^"]*\/zh-tw\/blocks\/"/.test(blocks)
    && !/hreflang="ja"/.test(blocks) && !/hreflang="ko"/.test(blocks)],
  ['reef tokens (inline or external css)', () => allCss().includes('--gd-accent')],
  // -- nav: arbitrary-depth submenus (indented-list syntax → recursive NavNode) --
  ['nav: top-level dropdown group', () => /class="rf-nav-group">\s*<a class="rf-nav-link rf-nav-parent" href="\/products"/.test(html)],
  ['nav: 1st-level submenu link', () => /class="rf-nav-sub">[\s\S]*?class="rf-nav-link rf-nav-sublink" href="\/apps"/.test(html)],
  ['nav: ARBITRARY depth — 3rd-level leaf renders', () => html.includes('rf-nav-subgroup') && html.includes('href="/games/puzzle"')],
  ['nav: default flyout CSS present (hover reveal)', () => allCss().replace(/\s+/g, '').includes('.rf-nav-group:hover>.rf-nav-sub')],
  // -- nav-mobile backdrop (finding #1, 2026-09-03 cold-read): an open hamburger menu used to sit
  // directly on undimmed page content with nothing marking where the menu layer ended. --
  ['nav-mobile: the hamburger menu gets its own backdrop label, wired to the same checkbox', () =>
    /<label class="rf-ha-overlay" data-ha-overlay="nav" for="rf-nav-toggle" aria-hidden="true"><\/label>/.test(html)],
  ['nav-mobile: the backdrop is revealed only while the menu checkbox is checked (state-machine CSS)', () => {
    const css = allCss().replace(/\s+/g, '');
    return css.includes('body[data-nav-mobile=hamburger]:has(#rf-nav-toggle:checked).rf-ha-overlay[data-ha-overlay=nav]{display:block}');
  }],
  ['nav-mobile: the page behind the open menu is scroll-locked', () => {
    const css = allCss().replace(/\s+/g, '');
    return css.includes('body[data-nav-mobile]:has(#rf-nav-toggle:checked){overflow:hidden}');
  }],
  // Esc-to-close needs no new wiring: `#rf-nav-toggle` already carries `data-ha-toggle`, which
  // header-actions.js's existing Escape handler (already asserted allowlisted above) sweeps.
  ['nav-mobile: the toggle that drives the backdrop still carries data-ha-toggle (Esc-to-close)', () =>
    /<input type="checkbox" id="rf-nav-toggle" class="rf-nav-check" hidden data-ha-toggle>/.test(html)],
  // -- markers.md: graduated markers the home fixture can't reach --
  ['markers: hero media=logo (uncropped, not round)', () => /<section class="st-hero st-full-bleed"[^>]*\sdata-media="logo"/.test(markers)],
  ['markers: block image → figure+img', () => /<figure class="st-figure">\s*<img class="st-img" src="\/img\/demo-logo\.gif" alt="Mark"/.test(markers)],
  ['markers: captioned whole-cell link with labeled chevron', () =>
    markers.includes('<a class="st-cell st-cell-link group" href="/products">') &&
    /st-cell-cta st-cell-cta-labeled[\s\S]*?st-cta-label">See products</.test(markers)],
  ['markers: bare external cell link hardened (target+noopener)', () =>
    /<a class="st-cell st-cell-link group" href="https:\/\/example\.com\/patreon" target="_blank" rel="noopener"/.test(markers)],
  ['markers: both cells carry the chevron', () => (markers.match(/<span class="st-cell-cta/g) || []).length === 2],
  ['markers: grouped collection renders through the shared cell system', () =>
    /<section class="st-collection"[^>]*>[\s\S]*?class="st-collection-pills"[\s\S]*?class="st-cell st-item"/.test(markers)],
  ['markers: collection cover targets the learn page across the full card', () =>
    /<a class="st-item-cover" href="\/tools\/compose" aria-label="Compose"><\/a>/.test(markers)],
  ['markers: collection secondary GitHub link remains an independent anchor', () =>
    /<a class="st-item-gh" href="https:\/\/github\.com\/example\/compose" target="_blank" rel="noopener">/.test(markers)],
  // -- custom-theme.md: the existing hand-authored Lilac theme through the production glob/build --
  ['custom theme: existing Lilac CSS is staged and inlined', () =>
    customTheme.includes('--gd-accent: #b98fe0') && customTheme.includes('html .st-cell, html a.st-cell-link')],
  ['custom theme: built body carries the custom-theme marker', () =>
    /<body\b[^>]*\bdata-theme-custom(?:=""|(?=[\s>]))/.test(customTheme)],
  ['custom theme: collection renders through production markup', () =>
    /<section class="st-collection"[^>]*>[\s\S]*?class="st-collection-pills"[\s\S]*?class="st-cell st-item"/.test(customTheme)
    && /<a class="st-item-cover" href="\/tools\/compose" aria-label="Compose"><\/a>/.test(customTheme)
    && /<a class="st-item-gh" href="https:\/\/github\.com\/example\/compose" target="_blank" rel="noopener">/.test(customTheme)],
  ['custom theme: collection born paint remains excluded by the built compatibility gate', () =>
    /<body\b[^>]*\bdata-theme-custom(?:=""|(?=[\s>]))/.test(customTheme)
    && allCss().replace(/\s+/g, '').includes(':where(body:not([data-theme-custom])).st-collection-head')],
  // -- blocks.md: base content blocks --
  ['blocks: ul + ol render', () => /<ul class="st-list"><li>/.test(blocks) && /<ol class="st-list"><li>/.test(blocks)],
  ['blocks: blockquote renders', () => blocks.includes('<blockquote class="st-quote"><p>')],
  // dialogue: `> **NAME**` + speech is a TURN; the plain quote beside it must stay a quote —
  // the fixture carries both so the smoke sees the boundary, not just the happy case.
  ['blocks: dialogue turns render (and group)', () =>
    /<div class="st-dialogue"><div class="st-turn" data-side="left"/.test(blocks)
    && blocks.includes('<div class="st-turn-who" aria-hidden="true">K</div>')
    && blocks.includes('data-side="right"')],
  ['blocks: a nameless quote beside a dialogue stays a quotation', () =>
    (blocks.match(/<blockquote class="st-quote">/g) || []).length >= 2],
  ['blocks: GFM table renders (thead+tbody)', () => /<table class="st-table"><thead>[\s\S]*?<tbody>/.test(blocks)],
  ['blocks: fenced code verbatim — inner # > | - spawn NO extra blocks', () =>
    blocks.includes('<pre class="st-code"><code class="language-js">') &&
    (blocks.match(/<table/g) || []).length === 1 &&
    // exact counts, so a fence that leaked would show up as an EXTRA block. Both numbers are
    // the fixture's authored total: one table, and two quotes — the "Why it matters" pull-quote
    // and the nameless quote sitting beside the dialogue. Dialogue turns are NOT blockquotes,
    // which is the other half of what this is holding: they must not inflate this count either.
    (blocks.match(/<blockquote/g) || []).length === 2],
  // -- code highlighting: a declared language gets tokens, an UNDECLARED one must not. The
  //    fixture's first fence has no info string, so it is the negative case standing right there. --
  ['code: a declared language is highlighted', () =>
    blocks.includes('<span class="st-kw">const</span>') && blocks.includes('<span class="st-com">// a comment</span>')],
  ['code: a diff paints whole lines and keeps --- a header', () =>
    blocks.includes('<span class="st-hunk">--- a/f</span>') && blocks.includes('<span class="st-del">-was</span>')],
  ['code: the UNDECLARED fence beside them is left alone', () =>
    /<pre class="st-code"><code>[^<]*<\/code>/.test(blocks)],
  // -- byline: post `author` → post head + feed. The UNSIGNED fixture is the half that matters:
  //    a site that never named an author must emit no byline and no dc:creator, not empty ones. --
  ['byline: a signed post carries By <author> in its head', () => signedPost.includes('<p class="bl-byline">By KITT</p>')],
  ['byline: an unsigned post has no byline element at all', () => !unsignedPost.includes('bl-byline')],
  ['feed: dc:creator carries the byline (not RSS <author>, which is specified as an email)', () =>
    rss.includes('xmlns:dc="http://purl.org/dc/elements/1.1/"') && rss.includes('<dc:creator>KITT</dc:creator>')],
  ['feed: the unsigned post contributes no dc:creator', () =>
    (rss.match(/<dc:creator>/g) || []).length === 1 && !rss.includes('<author>')],
  // -- the JS accounting invariant (zero unaccounted JS) --
  ['zero framework hydration (no astro-island)', () => pages.every((p) => !readFileSync(p, 'utf8').includes('astro-island'))],
  ['every script accounted (PE allowlist)', () => unaccounted.length === 0],
  // 🩸 CONTROL for the exclusion above. Without this, "no unaccounted scripts" could go green
  // because executesAsScript() started returning false for everything — a gate that excuses more
  // than it means to looks exactly like a gate that passes.
  ['the data-script exclusion is real and still narrow', () => {
    if (dataBlocks.length === 0) return false;                          // nothing excused ⇒ untested
    if (!dataBlocks.every((a) => /ld\+json/.test(a))) return false;     // only what we admitted
    // and it must still catch an unknown type — proven here, not assumed
    return executesAsScript('') && executesAsScript(' type="module"')
      && executesAsScript(' type="text/javascript"') && executesAsScript(' type="wat/unknown"')
      && !executesAsScript(' type="application/ld+json"')
      && !executesAsScript(' TYPE=" APPLICATION/LD+JSON "');           // spec: case/space insensitive
  }],
  ['every emitted .js chunk accounted', () => badChunks.length === 0],
  // blocks.md became a Lingo page (it carries the declared-but-absent hreflang case), so it now
  // ships Lingo's locale-suggestion island as well as the overlay header. A bare count would have
  // been "bump 1 to 2 until it goes green", which is how a budget check becomes a tally. Both are
  // named instead: the page must ship exactly these two and nothing else, so the next unexplained
  // script still goes red no matter what the total happens to be.
  ['content pages carry no feature JS (blocks = overlay + Lingo island, both named)', () =>
    blocks.includes('rf-header--overlay')
    && blocks.includes('signet-locale-banner-dismiss')
    && executableScripts(blocks) === 2],
  // -- forms.md: the `form` coral. Its FIRST rendering test. --
  ['form: action= is the wiring seam and reaches the markup', () =>
    /<form class="st-form" action="https:\/\/example\.test\/collect" method="post">/.test(forms)],
  // 🩸 The one this fixture was written for: an unwired form used to render a
  // LIVE submit posting to the page's own URL — a 405 on any static host,
  // invisible to the visitor who just lost their words.
  ['form: unwired → the submit button is DISABLED', () =>
    /<button class="st-form-submit" type="submit" disabled>/.test(forms)],
  ['form: wired → the submit button is NOT disabled (the check above is a state, not a constant)', () =>
    /<button class="st-form-submit" type="submit">/.test(forms)],
  ['form: an unwired form emits no action at all', () => {
    const second = forms.slice(forms.lastIndexOf('<form class="st-form"'));
    return !/action=/.test(second.slice(0, second.indexOf('>')));
  }],
  // 🔴 Withdrawn on 2026-08-15 and asserted ABSENT, because the version that
  // posts straight at feelreef.com looks right in every test that calls the
  // endpoint directly and 403s for every real visitor.
  ['form: no coral emits a cross-origin post to feelreef', () =>
    !/action="https:\/\/feelreef\.com/.test(forms) && !/name="kind"/.test(forms)],
  // The fixture's 1st (escape-hatch) and 3rd (unwired, still last) forms carry no JS at
  // all — sliced individually now that the 2nd form (action=inbox) legitimately does.
  // Each slice is bounded to its OWN `</form>` — an open-ended slice on the last form
  // would also swallow the page's trailing header-overlay script, unrelated to this coral.
  ['form: the non-inbox forms are still zero-JS — they have to work with scripts off', () => {
    const first = forms.slice(forms.indexOf('<form class="st-form"'), forms.indexOf('</form>') + '</form>'.length);
    const last = forms.slice(forms.lastIndexOf('<form class="st-form"'), forms.lastIndexOf('</form>') + '</form>'.length);
    return !/<script/i.test(first) && !/<script/i.test(last);
  }],
  // -- action=inbox: the same-origin forwarder route (2026-09-03) --
  ['form: action=inbox rewrites to the same-origin forwarder, method forced to post', () =>
    /<form class="st-form" action="\/__reef\/inbox" method="post">/.test(forms)],
  ['form: action=inbox emits return_to (this page\'s own path) + a honeypot, not display:none', () =>
    /<input type="hidden" name="return_to" value="\/forms\/">/.test(forms)
    && /<input type="text" name="_hp" autocomplete="off" tabindex="-1" aria-hidden="true" style="[^"]*"/.test(forms)
    && !/name="_hp"[^>]*display:\s*none/.test(forms)],
  ['form: the {email} field is wired to visitor_email on the inbox route, not the general one', () => {
    const general = forms.slice(0, forms.indexOf('Wired to the reef inbox'));
    const inbox = forms.slice(forms.indexOf('Wired to the reef inbox'));
    return /name="Email"/.test(general) && !/name="visitor_email"/.test(general)
      && /name="visitor_email"/.test(inbox);
  }],
  ['form: a label colliding with a reserved inbox name is wire-prefixed, visible label untouched', () =>
    /<label class="st-form-label" for="[^"]+">Text<\/label>/.test(forms)
    && /name="field_Text"/.test(forms)],
  // 🩸 2026-09-03: the fixture's inbox form's `{email}` field now defaults `required` (no field
  // says otherwise), which is GUARANTEED filled on any submission the browser lets through — so
  // the success line is the "we emailed you a confirmation" variant, not the generic old one.
  ['form: inbox status lines render hidden by default, localized to the page lang (en-US)', () =>
    /<p class="st-form-status st-form-status-sent" data-inbox-sent hidden>We've sent a confirmation to your email — the owner's reply will go to the same address\.<\/p>/.test(forms)
    && /<p class="st-form-status st-form-status-error" data-inbox-error hidden>Could not send — please try again\.<\/p>/.test(forms)],
  // Not a page-wide script count (the header-overlay module ships on every page,
  // unrelated to this coral) — just that the inbox status toggle itself appears
  // exactly once, matching the fixture's one `action=inbox` section.
  ['form: the inbox status toggle script appears exactly once, matching the one action=inbox section', () =>
    (forms.match(/\[data-inbox-sent\]/g) || []).length === 1],
  // -- required fields (2026-09-03, cold-read findings #9/#10) --
  ['form: action=inbox defaults its {email} field to required — native attr, marker, localized message', () =>
    /<span>Email<\/span><span class="st-form-required-mark" aria-hidden="true"> \*<\/span>/.test(forms)
    && /<input class="st-form-input" id="st-form-f2" name="visitor_email" type="email" required aria-required="true" data-required-msg="This field is required\.">/.test(forms)],
  ['form: action=inbox defaults its {textarea} message field to required the same way', () =>
    /<span>Tell us more<\/span><span class="st-form-required-mark" aria-hidden="true"> \*<\/span>/.test(forms)
    && /<textarea class="st-form-input st-form-textarea" id="st-form-f4" name="Tell us more" rows="5" required aria-required="true" data-required-msg="This field is required\."><\/textarea>/.test(forms)],
  ['form: action=inbox leaves a plain field (no email/textarea kind, no explicit required) optional', () =>
    /<label class="st-form-label" for="st-form-f3">Text<\/label> <input class="st-form-input" id="st-form-f3" name="field_Text" type="text">/.test(forms)],
  ['form: an explicit {required} on a non-inbox form field still renders native required + marker', () =>
    /<span>Your name<\/span><span class="st-form-required-mark" aria-hidden="true"> \*<\/span>/.test(forms)
    && /<input class="st-form-input" id="st-form-f1" name="Your name" type="text" required aria-required="true" data-required-msg="This field is required\.">/.test(forms)],
  // Control for the marker being OPT-IN, not the field grammar suddenly defaulting everything:
  // this form's own "Your name" (unwired, not action=inbox, no `{required}`) renders BYTE-IDENTICAL
  // to before — no marker wrapper, no attribute, same as every pre-existing site's forms today.
  ['form: an unwired form with no explicit required stays byte-identical (no marker, no attr)', () =>
    /<label class="st-form-label" for="st-form-f1">Your name<\/label> <input class="st-form-input" id="st-form-f1" name="Your name" type="text">/.test(forms)],
  ['form: the non-inbox forms emit no return_to/honeypot (fixed contract, action=inbox only)', () => {
    const general = forms.slice(0, forms.indexOf('Wired to the reef inbox'));
    const unwired = forms.slice(forms.lastIndexOf('<form class="st-form"'));
    return !/name="return_to"/.test(general) && !/name="_hp"/.test(general)
      && !/name="return_to"/.test(unwired) && !/name="_hp"/.test(unwired);
  }],
  // -- icons: the three well-known paths a browser, a crawler and iOS ask for unprompted --
  ['icons: all three well-known paths are emitted', () =>
    ['/favicon.ico', '/favicon.svg', '/apple-touch-icon.png'].every((p) => existsSync(distFile(p)))],
  ['icons: apple-touch-icon.png really is a 180×180 PNG', () => {
    const b = readFileSync(distFile('/apple-touch-icon.png'));
    return b.subarray(1, 4).toString('latin1') === 'PNG' && b.readUInt32BE(16) === 180 && b.readUInt32BE(20) === 180;
  }],
  ['icons: favicon.ico really is an ICO holding one image', () => {
    const b = readFileSync(distFile('/favicon.ico'));
    return b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1 && b.readUInt16LE(4) === 1
      && b.subarray(b.readUInt32LE(18) + 1, b.readUInt32LE(18) + 4).toString('latin1') === 'PNG';
  }],
  ['icons: every page links an icon AND an apple-touch-icon', () => pages.every((p) => {
    const h = readFileSync(p, 'utf8');
    return /<link rel="icon"[^>]*href="\/favicon\.(?:ico|svg)"/.test(h) && h.includes('rel="apple-touch-icon"');
  })],
  // 🔴 THE GATE, same shape as build-og's: a link tag aimed at a 404 looks exactly like no icon at
  // all to everyone except the person whose home screen shows a screenshot. The fixtures name no
  // off-site mark, so every claim here is ours and every one must be on disk.
  ['🔴 icons: no page claims an icon that is not on disk', () => {
    const claimed = claimedIcons();
    return claimed.length > 0 && claimed.every((h) => !h.startsWith('/') || existsSync(distFile(h)));
  }],
  ['fixtures never reference the pkg-runtimes chunk', () =>
    [html, blocks, markers, forms, customTheme].every((h) => !/src="[^"]*SiteLayout\.astro_astro_type_script/.test(h))],
];

let fail = 0;
for (const [name, fn] of checks) {
  let ok = false;
  try { ok = fn(); } catch { ok = false; }
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) fail++;
}
if (unaccounted.length) console.log('  ⚠ unaccounted scripts:\n    ' + unaccounted.join('\n    '));
// Printed even when green: what this gate declined to inspect is part of its result, not a detail.
if (dataBlocks.length) console.log(`  · ${dataBlocks.length} non-executable data blocks skipped (${[...new Set(dataBlocks.map((a) => (/type\s*=\s*"([^"]*)"/i.exec(a) || [, '?'])[1]))].join(', ')})`);
if (badChunks.length) console.log('  ⚠ unaccounted chunks: ' + badChunks.join(', '));
console.log(`\n${fail === 0 ? '✅ sitetile-astro smoke PASS' : `❌ smoke FAIL (${fail})`} (${checks.length - fail}/${checks.length})`);
process.exit(fail === 0 ? 0 : 1);
