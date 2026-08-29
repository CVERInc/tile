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
  execFileSync('npx', ['astro', 'build', '--outDir', DIST], { cwd: HERE, stdio: 'inherit' });
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
      const body = src ? readFileSync(join(DIST, src[1].replace(/^\//, '')), 'utf8') : m[2];
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
  ['form: still zero JavaScript — it has to work with scripts off', () =>
    !/<script/i.test(forms.slice(forms.indexOf('<form'), forms.lastIndexOf('</form>')))],
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
