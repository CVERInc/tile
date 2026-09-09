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
import {
  copyFileSync, readFileSync, readdirSync, rmSync, statSync, existsSync,
  cpSync, mkdirSync, symlinkSync, writeFileSync,
} from 'node:fs';
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
// Lingo × Blog category/tag archive fixture (blog/{a-signed,an-unsigned}-post.md carry
// `categories: ["press"]`; their zh-TW translations, blog/zh-tw/*.md, carry none and inherit it
// by slug). Proves the gap confirmed live on a customer's site 2026-09-02: the base-locale-only
// /category & /tag archives, and the site-wide links that pointed at them regardless of which
// locale was rendering.
const devlogIndex = readFileSync(join(DIST, 'devlog/index.html'), 'utf8');
const zhDevlogIndex = readFileSync(join(DIST, 'zh-tw/devlog/index.html'), 'utf8');
const categoryPress = readFileSync(join(DIST, 'category/press/index.html'), 'utf8');
const zhCategoryPress = readFileSync(join(DIST, 'zh-tw/category/press/index.html'), 'utf8');
const tagFixture = readFileSync(join(DIST, 'tag/fixture/index.html'), 'utf8');
const zhTagFixture = readFileSync(join(DIST, 'zh-tw/tag/fixture/index.html'), 'utf8');
const sitemapXml = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
const siteOff = readFileSync(join(DIST, 'ko-kr/index.html'), 'utf8');
// round 4 (R3-P2-2): scheme-check.md — the hostile fixture the Astro half of the escape-link-
// destinations fix never had. See its own file header for what each slot exercises; the checks
// below live near the icon/JS-accounting checks further down, grouped under their own heading.
const schemeCheck = readFileSync(join(DIST, 'scheme-check/index.html'), 'utf8');
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
  // just don't see the submitting-state / success-card / inline-retry-error swap in — see
  // Form.astro's file-header note on this script, 2026-09-03 owner ruling.
  ['form inbox status (action=inbox only, self-gating on ?inbox= + AJAX submit)', '[data-inbox-success]'],
  // header-actions cart wiring (round 4's scheme-check.md is the first fixture to opt in via
  // header-actions-cart-guild): strictly opt-in and self-gating (no `.rf-header-actions
  // [data-cart-guild]` on the page → no-op) — see header-actions-cart.js's own file header.
  ['header-actions cart wiring (opt-in on header-actions-cart-guild)', 'dc-square-shop-cart:'],
  // rf-preload guard (round 4's scheme-check.md is the first fixture with ANY toggle-type
  // header-action, e.g. the cart drawer above): gated on `toggleActions.length > 0`
  // (SiteLayout.astro), so a page with only `link`-type header-actions never loads it. Removes
  // the `rf-preload` class after the first paint — a double-rAF, not a `DOMContentLoaded`, so it
  // fires after the drawer/overlay CSS this class suppresses has had a frame to settle.
  ['header-actions preload-flash guard (double-rAF rf-preload removal, gated on any toggle header-action)', 'rf-preload'],
  // carousel scroll-snap wiring (round 4's scheme-check.md is the first fixture to use the
  // `carousel` coral at all — round 2 already named it as untested). Self-gates per instance
  // (`dataset.carInit`) and no-ops with zero `.st-carousel` sections on the page.
  ['carousel prev/next + overflow wiring (per-instance self-gating, zero-op with no .st-carousel)', 'carInit'],
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

// ---- round 4 (R3-P2-2): the disallowed-scheme sweep over a real built page ----
// The astro smoke builds real pages and audits the emitted HTML/JS — the only gate in this repo
// that does — but until now it had no assertion about link/image/form destinations at all
// (grepped: `javascript:|safeHref|safeSrc|scheme` over this file returned nothing). This is
// that missing assertion, run against content/scheme-check.md (see its own file header for what
// every slot exercises) — and it scans the WHOLE page, so a regression anywhere else on this
// page would be caught here too, not just in the fixture's own named slots.
//
// Anchored to actual TAGS (`<[a-zA-Z][^>]*>`), never the raw page text — a prose sentence that
// QUOTES a disallowed destination (this fixture's own explanatory copy does, deliberately, inside
// a `<span class="st-code">`) sits between `>` and `<`, never inside a tag's attribute list, so
// it cannot forge a false hit the way a plain `.includes('javascript:')` over the whole string
// would (verified below: the fixture's own prose is the ONE surviving `javascript:` substring on
// the page, and it must NOT trip this check for the check to be honest — see the "prose does not
// count" test in the checks list).
const DISALLOWED_SCHEME_RE = /^\s*(javascript:|vbscript:|data:text\/html|data:image\/svg\+xml)/i;
// round 5 (R4-P3-4): the scan used to test the RAW attribute text — a scheme obfuscated by HTML
// entities (`javascript&#58;alert(1)`, the fixture's OWN deliberately-carried payload) or by a
// literal tab/CR/LF inside the scheme name (both defeat a naive substring test and both still
// parse to `javascript:` per the URL spec — the exact reasoning isSafeHref's own header gives for
// entity-decoding before its scheme check) survived the scan silently: "under a gate regression
// the scan would report clean on the very payload the fixture was built to carry." Decoding the
// SAME handful of entities isSafeHref decodes (numeric + the 5 named ones), and stripping the 3
// ASCII whitespace bytes a URL parser strips from a scheme, before the prefix test, closes that —
// this is the SCAN reaching parity with the thing it is scanning FOR, not a new policy.
function schemeLooksDisallowed(v) {
  const s = String(v == null ? '' : v)
    .replace(/&#x([0-9a-fA-F]+);?/g, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
    .replace(/&#(\d+);?/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return m; } })
    .replace(/&(amp|lt|gt|quot|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]))
    .replace(/[\t\r\n]/g, '');
  return DISALLOWED_SCHEME_RE.test(s);
}
function disallowedSchemeHits(h) {
  const hits = [];
  // href=/src=/action=/data-cart-href — the literal sinks the R3 sweep grepped for.
  //
  // round 5 (R4-P3-4): the ORIGINAL scan used `exec` once per tag — only the FIRST matching
  // attribute was ever tested, so `<a src="/ok" href="javascript:void(0)">` would have been MISSED
  // (latent: no tag in this renderer's output carries two of these attributes today, but the shape
  // — "an existence check that stops at the first match" — is exactly this file's own review
  // vocabulary). Looped with `/g` so every occurrence in a tag is tested, not just the first.
  const attrRe = /\b(?:href|src|action|data-cart-href)="([^"]*)"/g;
  for (const tag of h.match(/<[a-zA-Z][^>]*>/g) || []) {
    attrRe.lastIndex = 0;
    let am;
    while ((am = attrRe.exec(tag))) if (schemeLooksDisallowed(am[1])) hits.push(tag.slice(0, 160));
    // srcset="…, …" — round 5 (R4-P3-4): a comma-separated list of "<url> <descriptor>"
    // candidates. The old `^`-anchored whole-value test could only ever see a hostile FIRST
    // candidate; a later one needs each candidate split out and tested on its own. (No `srcset`
    // is emitted by this renderer today — latent, same as the /g fix above, closed while here.)
    const sm = /\bsrcset="([^"]*)"/.exec(tag);
    if (sm) for (const cand of sm[1].split(',')) if (schemeLooksDisallowed(cand.trim())) hits.push(tag.slice(0, 160));
    // <meta property=og:image|twitter:image|http-equiv=refresh content="…"> — round 5 (R4-P3-1):
    // a DIFFERENT attribute name than the href/src/action/data-cart-href set above, so it needed
    // its own check, not a widened alternation (a `content=` on a non-meta tag is not a sink).
    if (/^<meta\b/i.test(tag)) {
      const cm = /\bcontent="([^"]*)"/.exec(tag);
      if (cm && schemeLooksDisallowed(cm[1])) hits.push(tag.slice(0, 160));
    }
    // style="…url(…)…" — round 5 (R4-P3-4/R4-P3-6): the hero `bg=`/`enter` sink. Matches whether
    // the URL is quoted (this round's own cssUrlString fix) or bare, so the scan survives its own
    // fix rather than being written to only recognise the pre-fix shape.
    const stm = /\bstyle="([^"]*)"/.exec(tag);
    if (stm) {
      const urlRe = /url\(\s*(['"]?)([^'")]*)/gi;
      let um;
      while ((um = urlRe.exec(stm[1]))) if (schemeLooksDisallowed(um[2])) hits.push(tag.slice(0, 160));
    }
  }
  // Inline <script> assignments to `location`/`location.href`/a bare `.href` — the same DOM-sink
  // class as data-cart-href, checked directly in case a future script reads a different
  // attribute the same unsafe way.
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
  let sm2;
  while ((sm2 = scriptRe.exec(h))) {
    const assignRe = /(?:location(?:\.href)?|\.href)\s*=\s*([`'"])((?:(?!\1)[\s\S])*)\1/g;
    let am;
    while ((am = assignRe.exec(sm2[1]))) if (schemeLooksDisallowed(am[2])) hits.push('<script> ' + am[0].slice(0, 160));
  }
  return hits;
}

// round 5 (R4-P2-1): disallowedSchemeHits used to be called on exactly ONE fixture page
// (scheme-check.md) — the gate that exists to prevent recurrence of R4-P1-1's class was
// structurally unable to observe it, because R4-P1-1 lived on the BLOG page family the scan never
// looked at. Runs the same scan over EVERY built HTML page (the same `pages` list auditScripts()
// already walks — one source of "every page this build produced", not a second one that can drift
// from it) plus the non-HTML outputs that carry URLs at all: rss.xml/sitemap.xml (text nodes, not
// HTML attributes — a URL-shaped substring test, not the tag-anchored scan above) and the archive
// island's own client corpus (search-index.json, reef-posts.json — both plain JSON, parsed and
// read as data, not scanned as text, since a JSON string value can legitimately CONTAIN the
// substring "javascript:" — e.g. an excerpt that quotes it — without that being a live sink).
function siteWideSchemeHits(distDir, allPages, rssBody, sitemapBody) {
  const hits = [];
  for (const page of allPages) {
    for (const hit of disallowedSchemeHits(readFileSync(page, 'utf8'))) hits.push(`${page.slice(distDir.length + 1)}: ${hit}`);
  }
  for (const [label, body, tag] of [['rss.xml', rssBody, 'link'], ['sitemap.xml', sitemapBody, 'loc']]) {
    const re = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
    let m;
    while ((m = re.exec(body || ''))) if (/^\s*(javascript:|vbscript:)/i.test(m[1])) hits.push(`${label}: <${tag}>${m[1].slice(0, 160)}`);
  }
  for (const file of ['search-index.json', 'reef-posts.json']) {
    const p = join(distDir, file);
    if (!existsSync(p)) continue;
    let rows;
    try { rows = JSON.parse(readFileSync(p, 'utf8')); } catch { hits.push(`${file}: not valid JSON`); continue; }
    for (const row of Array.isArray(rows) ? rows : []) {
      for (const v of [row.u, row.i, row.url]) if (v != null && /^\s*(javascript:|vbscript:)/i.test(String(v))) hits.push(`${file}: ${JSON.stringify(row).slice(0, 160)}`);
    }
  }
  return hits;
}

// round 5 (R4-P2-1): run the widened, site-wide scan ONCE against the primary build, before the
// `checks` array below (each check just reads this precomputed result — re-running a full-site
// regex sweep per assertion would be wasteful, and the failure list should be printed once, not
// once per assertion that reads it).
const siteWideHits = siteWideSchemeHits(DIST, pages, rss, sitemapXml);

// round 5 (R4-P1-1/R4-P2-1): a SEPARATE, isolated Astro build proving the fix on the fields
// R4-P1-1 actually named — `permalink:`, `blog-url-pattern:`, `blog-path:`, plus the term-archive
// `blog-category-base:`/`blog-tag-base:` this round found were the SAME shape (see blog.mjs's
// categoryBase()/tagBase()). These are SITE-level (`_site.md`) fields, so they cannot be exercised
// as a per-page override the way scheme-check.md's other fields are (page frontmatter overrides
// site frontmatter for THAT page only — these fields apply to the whole blog at once, which is
// the R4-P1-1 finding's own point: "one hostile post poisons other posts' pages, the feed, the
// sitemap and the client corpus"). A second astro build, into its own isolated content/blog/
// fixture and its own outDir, is the only way to exercise that without the hostile config leaking
// onto the primary build's ~130 other assertions.
//
// The fixture directory is rsync'd from THIS `astro/` tree (excluding node_modules/.astro/
// dist-*/the fixture dir itself) rather than hand-duplicated, so it can never silently drift from
// the real component tree; node_modules is a SYMLINK (never copied — same install, no second
// `npm install`, and this build never writes into it) back to the real one.
function buildHostileBlogFixture() {
  // A SIBLING of `astro/` (not nested inside it — cpSync refuses to copy a directory into its own
  // subtree, and the astro.config.mjs aliases are relative to the config file's OWN location, so
  // this has to sit at the SAME depth under packages/sitetile/ that astro/ itself does for
  // `../site-core.js` etc. to resolve to the same real files).
  const HDIR = join(HERE, '..', '.smoke-hostile-blog');
  const SKIP_RE = /[\\/](node_modules|\.astro|dist-smoke|dist-hostile-blog|\.smoke-hostile-blog)(?:[\\/]|$)/;
  rmSync(HDIR, { recursive: true, force: true });
  cpSync(HERE, HDIR, { recursive: true, filter: (src) => !SKIP_RE.test(src) });
  symlinkSync(join(HERE, 'node_modules'), join(HDIR, 'node_modules'), 'dir');

  // A minimal, self-contained site — safe `blog-path` (so a reader can tell "reset to nothing
  // configured" apart from "kept the site's own real base"), hostile `blog-url-pattern` (poisons
  // EVERY post, not just the one with its own override — the R4-P1-1 finding's own "one hostile
  // post poisons other posts' pages" shape, here from the site config instead), hostile
  // `blog-category-base`/`blog-tag-base` with the term routes turned on, and `blog-search: true`
  // so search-index.json actually carries content (the primary build's own search stays off,
  // so this is the one build that exercises that file with real rows).
  rmSync(join(HDIR, 'content'), { recursive: true, force: true });
  mkdirSync(join(HDIR, 'content'), { recursive: true });
  writeFileSync(join(HDIR, 'content', '_site.md'), `---
sitetile-page: _site
title: Hostile blog site
lang: en-US
blog-path: /diary
blog-url-pattern: javascript:void(0)#%postname%
blog-category-routes: true
blog-tag-routes: true
blog-category-base: javascript:void(0)
blog-tag-base: javascript:void(0)
blog-search: true
---
`, 'utf8');
  writeFileSync(join(HDIR, 'content', 'home.md'), `---
sitetile-page: home
title: Hostile blog site — home
lang: en-US
---

## Home
%% sitetile: prose %%
Home page body.
`, 'utf8');

  rmSync(join(HDIR, 'blog'), { recursive: true, force: true });
  mkdirSync(join(HDIR, 'blog'), { recursive: true });
  // The permalink override — R4-P1-1's "concrete failing input #1".
  writeFileSync(join(HDIR, 'blog', 'hostile-permalink-post.md'), `---
title: Hostile permalink post
pubDate: 2026-01-01
permalink: javascript:void(0)
categories: [team]
tags: [news]
---

Body text for the hostile-permalink post.
`, 'utf8');
  // No permalink of its own — this post's URL comes ENTIRELY from the site's own (hostile)
  // blog-url-pattern, proving the site-level poisoning reaches a post that did nothing wrong.
  writeFileSync(join(HDIR, 'blog', 'safe-post.md'), `---
title: Safe control post
pubDate: 2026-01-02
categories: [team]
tags: [news]
---

Body text for the safe control post — no permalink override of its own.
`, 'utf8');
  // round 5 (R4-P3-2): a post's featured image is its FIRST body image, extracted straight off a
  // markdown regex with no gate — reached a live blog-card <img src> even though the SAME image,
  // in the SAME post's body, is refused by imgTag/isSafeImageSrc. Isolated here (rather than the
  // primary build) because it needs its own post, and this fixture's small, purpose-built corpus
  // makes "the entry still renders, only the image drops" unambiguous to assert.
  writeFileSync(join(HDIR, 'blog', 'svg-image-post.md'), `---
title: SVG featured image post
pubDate: 2026-01-03
categories: [team]
tags: [news]
---

![SVG featured](data:image/svg+xml;base64,PHN2Zz4=)

Body text for the SVG-featured-image post.
`, 'utf8');

  const HDIST = join(HDIR, 'dist-hostile-blog');
  execFileSync('npx', ['astro', 'build', '--outDir', HDIST], {
    cwd: HDIR, stdio: 'inherit',
    env: { ...process.env, SITE_ID: 'hostile-blog-smoke', PLATFORM_ORIGIN: 'https://feelreef.com', SITE_URL: 'https://example.com' },
  });
  return HDIST;
}

console.log('▸ astro build → .smoke-hostile-blog/dist-hostile-blog/ (R4-P1-1: site-level blog-path/blog-url-pattern/category-tag-base poisoning)…');
const HDIST = buildHostileBlogFixture();
// round 5: a two-arm counterfactual (identity-swap safeHref/safeSrc) doesn't just make an
// assertion go red here — it makes postUrl() return the raw hostile permalink VERBATIM, which
// getStaticPaths() then builds as a literal directory name (`javascript:void(0)/index.html`, the
// review's own "a directory literally named javascript:void(0)/ is emitted" finding) INSTEAD OF
// `diary/hostile-permalink-post/`. A plain readFileSync on the expected path then throws ENOENT
// and crashes the whole process before a single assertion below gets to run — losing the primary
// build's ~150 assertions' worth of evidence along with it. `readOrEmpty` turns that crash into an
// empty string, so every check that reads it simply goes red (the intended, legible failure mode
// for a counterfactual arm), and the checks that don't depend on the hostile build still run.
const readOrEmpty = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const hostileIndex = readOrEmpty(join(HDIST, 'diary', 'index.html'));
const hostilePermalinkPost = readOrEmpty(join(HDIST, 'diary', 'hostile-permalink-post', 'index.html'));
const hostileSafePost = readOrEmpty(join(HDIST, 'diary', 'safe-post', 'index.html'));
const hostileCategoryArchive = readOrEmpty(join(HDIST, 'category', 'team', 'index.html'));
const hostileTagArchive = readOrEmpty(join(HDIST, 'tag', 'news', 'index.html'));
const hostileRss = readOrEmpty(join(HDIST, 'rss.xml'));
const hostileSitemap = readOrEmpty(join(HDIST, 'sitemap.xml'));
function findHostilePages(dir) {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p); else if (e === 'index.html') out.push(p);
    }
  })(dir);
  return out;
}
const hostileSiteWideHits = siteWideSchemeHits(HDIST, findHostilePages(HDIST), hostileRss, hostileSitemap);

const checks = [
  // -- born-on site inbox bubble: site/page resolution + legacy embed dedupe --
  ['inbox bubble: default on with the build site key, platform origin, page title, and site name', () =>
    /<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="smoke-site" data-api-base="https:\/\/feelreef\.com" data-title="Yamada Letterpress — one character, one piece of lead" data-site-name="Yamada Letterpress"><\/div>\s*<script type="module" src="https:\/\/feelreef\.com\/corals\/inbox-bubble\/v0\/inbox-bubble\.js"><\/script>/.test(html)],
  ['inbox bubble: site off suppresses it', () => occIn(siteOff, 'data-dynamic-coral="inbox-bubble"') === 0],
  ['inbox bubble: locale-agnostic except suppresses /zh-tw/blocks via /blocks', () => occIn(localeExcept, 'data-dynamic-coral="inbox-bubble"') === 0],
  ['inbox bubble: explicit page on wins over the site /markers exclusion', () => occIn(markers, 'data-dynamic-coral="inbox-bubble"') === 1],
  ['inbox bubble: a hand-mounted embed is not doubled', () => occIn(forms, 'data-dynamic-coral="inbox-bubble"') === 1],
  // -- a customer's /faq page, 2026-09-03: the bubble's panel header is the STORE's stable name, and must
  // stay that on every page — not each page's own composed <title> (was measured live as
  // "常見問題 | HOSHIYA【新官網轉移中】", the FAQ page's own title text, on a page whose title has
  // nothing to do with the home page's). `markers.md` is the fixture's only non-home page with the
  // auto-mounted (not hand-authored) bubble on, and its own title is deliberately unrelated to the
  // site's `brand:` — proving data-site-name tracks the SITE config, not whichever page renders it.
  ['inbox bubble: on a non-home page, data-site-name is the SITE\'s name, not that page\'s own title', () =>
    /<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="smoke-site" data-api-base="https:\/\/feelreef\.com" data-title="Marker coverage — hero variants \+ linked cells" data-site-name="Yamada Letterpress" data-assistant-name="小美"><\/div>/.test(markers)],
  // assistant-name: owner-chosen visitor-facing name for the Q&A assistant (default KAITO,
  // applied by the coral itself). markers.md sets `assistant-name: 小美`; home.md does not, so the
  // attribute must be present on one build and wholly absent on the other.
  ['inbox bubble: assistant-name configured on the page emits data-assistant-name', () =>
    /data-assistant-name="小美"/.test(markers)],
  ['inbox bubble: no assistant-name configured omits the attribute entirely', () =>
    !/data-assistant-name/.test(html)],
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
  ['nav-mobile: the page behind the open menu is scroll-locked (!important — a theme own body-level overflow rule must not silently re-enable background scroll while the menu is open)', () => {
    const css = allCss().replace(/\s+/g, '');
    return css.includes('body[data-nav-mobile]:has(#rf-nav-toggle:checked){overflow:hidden!important}');
  }],
  // Esc-to-close needs no new wiring: `#rf-nav-toggle` already carries `data-ha-toggle`, which
  // header-actions.js's existing Escape handler (already asserted allowlisted above) sweeps.
  ['nav-mobile: the toggle that drives the backdrop still carries data-ha-toggle (Esc-to-close)', () =>
    /<input type="checkbox" id="rf-nav-toggle" class="rf-nav-check" hidden data-ha-toggle>/.test(html)],
  // -- nav-mobile open menu vs. an unlayered theme z-index (a customer's site, live): the dropdown
  // rendered UNDER its own dimmed backdrop because a site's own unlayered CSS (`z-index: 20` on
  // `.rf-header`) beats any layered declaration — including this file's `@layer reef.base` — at
  // equal importance, no matter how specific the selector. Only `!important` (decided BEFORE
  // layer order) survives that. Both live inside the `(width<=64rem)` media block above. --
  ['nav-mobile: the open header is lifted above an unlayered theme z-index with !important, not just a specific selector (live-site regression)', () => {
    const css = allCss().replace(/\s+/g, '');
    return css.includes('@media(width<=64rem)')
      && css.includes('body[data-nav-mobile]:has(#rf-nav-toggle:checked).rf-header{z-index:2147483002!important}');
  }],
  ['nav-mobile (hamburger): the open panel scrolls itself when taller than the viewport (952px panel vs 720px viewport, measured live — body is scroll-locked above, so without this the tail of the menu is unreachable), and the position/z-index FACTS that keep it a floating panel stay !important', () => {
    const css = allCss().replace(/\s+/g, '');
    const m = css.match(/body\[data-nav-mobile=hamburger\]\.rf-nav\{([^}]*)\}/);
    if (!m) return false;
    const rule = m[1];
    return rule.includes('max-height:calc(100dvh-4.5rem)')
      && rule.includes('overflow-y:auto')
      && rule.includes('overscroll-behavior:contain')
      && rule.includes('-webkit-overflow-scrolling:touch')
      && rule.includes('position:absolute!important')
      && rule.includes('z-index:1000!important');
  }],
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
  // -- post-submit feedback: submitting / success card / inline retry error (owner ruling, 2026-09-03) --
  // 🩸 2026-09-03: the fixture's inbox form's `{email}` field now defaults `required` (no field
  // says otherwise), which is GUARANTEED filled on any submission the browser lets through — so
  // the success line's BUILD-TIME default is the "we emailed you a confirmation" variant (the
  // generic phrasing, since build time can never know the address one visitor will type — see
  // `sentWithEmailGeneric` in locale.mjs), not the "no email" fallback.
  ['form: success card renders hidden by default — check icon, heading, next-step copy, hidden excerpt, send-another + home links', () => {
    const card = /<div class="st-form-success" data-inbox-success role="status" tabindex="-1" hidden>([\s\S]*?)<\/div>/.exec(forms);
    if (!card) return false;
    const c = card[1];
    return /<svg class="st-form-success-check"/.test(c)
      && /<p class="st-form-success-heading" role="heading" aria-level="3">Sent<\/p>/.test(c)
      && /<p class="st-form-success-next" data-inbox-next>We've sent a confirmation to your email — the owner's reply will go to the same address\.<\/p>/.test(c)
      && /<p class="st-form-success-excerpt" data-inbox-excerpt hidden><\/p>/.test(c)
      && /<p class="st-form-success-again"><a href="\/forms\/" data-inbox-again>Send another<\/a><\/p>/.test(c)
      && /<p class="st-form-success-back"><a href="\/">Back to homepage<\/a><\/p>/.test(c);
  }],
  // 🩸 bug (2026-09-04, cold-read round two): `hidden` was present in the markup above, but
  // `.st-form-success { display: flex }` in site.css is an AUTHOR rule, which beats the UA
  // sheet's `[hidden]{display:none}` regardless of specificity — so the card showed to every
  // first-time visitor of every `action=inbox` form, above an empty form. Measured live on
  // a customer's /zh-tw/contact/ page. The markup-level check above can't catch this — `hidden` was
  // always in the HTML, the CSS silently overrode it — so this asserts the actual rendered CSS
  // carries a `[hidden]` override for every element the script's `.hidden = true/false` toggles
  // (Form.astro: `form.hidden`, `successEl.hidden`, `excerptEl.hidden`). `.st-form-error` is
  // deliberately not asserted here — it sets no `display` of its own, so the UA rule already wins.
  ['form: CSS makes `hidden` win over every `display:` rule the inbox script toggles (.st-form, .st-form-success, .st-form-success-excerpt)', () => {
    const css = allCss().replace(/\s+/g, '');
    return css.includes('.st-form[hidden]{display:none}')
      && css.includes('.st-form-success[hidden]{display:none}')
      && css.includes('.st-form-success-excerpt[hidden]{display:none}');
  }],
  // bug #2 (2026-09-04): "send another" sits BEFORE "back home" — the primary action (send another
  // message) ahead of the secondary one (leave the page) — and its href is the form's own clean
  // path, so a no-JS visitor clicking it lands back on a `?inbox=`-free reload of this same page.
  ['form: "send another" comes before "back home" in the card, and its href has no query string', () => {
    const card = /<div class="st-form-success" data-inbox-success role="status" tabindex="-1" hidden>([\s\S]*?)<\/div>/.exec(forms);
    if (!card) return false;
    const c = card[1];
    const againIdx = c.indexOf('data-inbox-again');
    const backIdx = c.indexOf('st-form-success-back');
    return againIdx > -1 && backIdx > -1 && againIdx < backIdx
      && /href="\/forms\/" data-inbox-again/.test(c); // no "?inbox=…" tacked on
  }],
  // The card is a SIBLING of the form, positioned BEFORE it — both exist in the DOM at once
  // (hidden, not removed) so focus management / a screen reader's "back into the form" both work.
  ['form: the success card sits before the form it stands in for, not inside it', () =>
    forms.indexOf('data-inbox-success') < forms.indexOf('<form class="st-form" action="/__reef/inbox"')],
  // Inline, ABOVE the button — owner ruling's exact placement, so failure never requires
  // scrolling past the button to find out why. Default text is the localized server-refusal
  // sentence (the safe assumption for a no-JS reload, which can't distinguish network from server).
  ['form: inline retry error sits inside the form, immediately before the submit button, hidden by default', () => {
    const section = forms.slice(forms.indexOf('id="s2-wired-to-the-reef-inbox"'));
    const btnIdx = section.indexOf('<button class="st-form-submit"');
    const errIdx = section.indexOf('<p class="st-form-error" data-inbox-error hidden>');
    return errIdx > -1 && errIdx < btnIdx
      && /<p class="st-form-error" data-inbox-error hidden>Couldn't send that — please try again\.<\/p>/.test(section.slice(0, btnIdx));
  }],
  // The AJAX-enhancement payload the script reads at runtime — one JSON attribute rather than a
  // pile of `data-*`s, and it is the ONLY place the per-submission strings (the `{email}`
  // template, the two error variants, the submitting label) reach the browser, since build time
  // cannot know which one a given visitor's submit will need.
  ['form: the inbox-copy payload carries the submitting/error/template strings + the email+excerpt field names', () => {
    const m = /<section class="st-form-section" id="s2-wired-to-the-reef-inbox" data-inbox-copy="([^"]+)">/.exec(forms);
    if (!m) return false;
    const payload = JSON.parse(m[1].replace(/&quot;/g, '"'));
    return payload.submitting === 'Sending…'
      && payload.successHeading === 'Sent'
      && payload.errorNetwork === 'Your connection seems to be having trouble — check it and try again.'
      && payload.errorServer === "Couldn't send that — please try again."
      && payload.sentWithEmail.includes('{email}')
      && payload.sentNoEmail.length > 0
      && payload.emailField === 'visitor_email'
      && payload.excerptField === 'Tell us more'; // the fixture's one {textarea} field
  }],
  // Not a page-wide script count (the header-overlay module ships on every page, unrelated to
  // this coral) — just that the inbox enhancement script itself appears exactly once, matching
  // the fixture's one `action=inbox` section.
  ['form: the inbox enhancement script appears exactly once, matching the one action=inbox section', () =>
    (forms.match(/\[data-inbox-success\]/g) || []).length === 1],
  // -- the script's own logic, asserted by source signature (no DOM/Playwright harness for
  //    sitetile astro pages exists yet — see scripts/test.sh's browser-smoke gate, which is for
  //    hosts/web/*, not this renderer) --
  ['form: submit is intercepted, shows the submitting state, and guards against a double submit', () => {
    const s = forms.slice(forms.indexOf('<script>', forms.indexOf('id="s2-wired-to-the-reef-inbox"')));
    return /form\.addEventListener\('submit', \(ev\) => \{/.test(s)
      && /if \(submitting\) \{ ev\.preventDefault\(\); return; \}/.test(s)
      && /btn\.disabled = true;/.test(s)
      && /btn\.setAttribute\('aria-busy', 'true'\);/.test(s)
      && /btn\.textContent = copy\.submitting;/.test(s);
  }],
  ['form: failure never touches the form\'s fields — only the error line and the button re-enable', () => {
    const s = forms.slice(forms.indexOf('<script>', forms.indexOf('id="s2-wired-to-the-reef-inbox"')));
    const showError = /function showError\(message\) \{([\s\S]*?)\n {8}\}/.exec(s);
    return !!showError && !/\.value\s*=/.test(showError[1]) && !/\.reset\(/.test(showError[1])
      && /btn\.disabled = false;/.test(showError[1])
      && /btn\.textContent = btnDefaultText;/.test(showError[1]);
  }],
  ['form: success reads the fetch\'s own final URL for the outcome and fills the real email + a two-line excerpt', () => {
    const s = forms.slice(forms.indexOf('<script>', forms.indexOf('id="s2-wired-to-the-reef-inbox"')));
    return /new URL\(res\.url, location\.href\)\.searchParams\.get\('inbox'\)/.test(s)
      && /copy\.sentWithEmail\.replace\('\{email\}', addr\)/.test(s)
      && /\.slice\(0, 2\)\.join\('\\n'\)/.test(s);
  }],
  // -- bug #2 (2026-09-04): reload / back button / a shared URL kept showing 「送信しました」
  //    forever, and the JS path left the card up with no way to send another --
  ['form: a successful submit resets the form\'s own fields (the excerpt keeps its own captured copy)', () => {
    const s = forms.slice(forms.indexOf('<script>', forms.indexOf('id="s2-wired-to-the-reef-inbox"')));
    const showSuccess = /function showSuccess\(fd\) \{([\s\S]*?)\n {8}\}/.exec(s);
    return !!showSuccess && /form\.reset\(\);/.test(showSuccess[1]);
  }],
  ['form: a shown `?inbox=` outcome is stripped from the URL via replaceState, not pushState (no new history entry)', () => {
    const s = forms.slice(forms.indexOf('<script>', forms.indexOf('id="s2-wired-to-the-reef-inbox"')));
    return /window\.history\.replaceState\(window\.history\.state, '', clean\.pathname \+ clean\.search \+ clean\.hash\);/.test(s)
      && /clean\.searchParams\.delete\('inbox'\);/.test(s)
      && !/\.pushState\(/.test(s);
  }],
  ['form: the "send another" link resets and re-shows the form in place, focuses a field, and re-enables the button', () => {
    const s = forms.slice(forms.indexOf('<script>', forms.indexOf('id="s2-wired-to-the-reef-inbox"')));
    const handler = /root\.querySelector\('\[data-inbox-again\]'\);[\s\S]*?againLink\.addEventListener\('click', \(ev\) => \{([\s\S]*?)\n {10}\}\);/.exec(s);
    return !!handler
      && /ev\.preventDefault\(\);/.test(handler[1])
      && /form\.reset\(\);/.test(handler[1])
      && /form\.hidden = false;/.test(handler[1])
      && /successEl\.hidden = true;/.test(handler[1])
      && /btn\.disabled = false;/.test(handler[1])
      && /firstField\.focus\(\);/.test(handler[1]);
  }],
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

  // -- Lingo × Blog locale category/tag archives (the gap measured live, 2026-09-02) --
  ['locale category archive exists at /<loc>/category/<slug>/', () => existsSync(distFile('/zh-tw/category/press/index.html'))],
  ['locale tag archive exists at /<loc>/tag/<slug>/', () => existsSync(distFile('/zh-tw/tag/fixture/index.html'))],
  ['locale category archive lists ONLY that locale\'s own (translated) posts', () =>
    zhCategoryPress.includes('bl-entry-link" href="/zh-tw/devlog/a-signed-post"')
    && zhCategoryPress.includes('bl-entry-link" href="/zh-tw/devlog/an-unsigned-post"')
    && !zhCategoryPress.includes('href="/devlog/a-signed-post"')],
  ['locale tag archive lists ONLY that locale\'s own posts too', () =>
    zhTagFixture.includes('bl-entry-link" href="/zh-tw/devlog/a-signed-post"')
    && !zhTagFixture.includes('href="/devlog/a-signed-post"')],
  // Taxonomy inheritance: blog/zh-tw/*.md carry NO `categories:` of their own — the base
  // locale's `press` category reaches the archive above only via localeBlogCorpora's
  // inherit-by-slug rule (a translated post carries no categories of its own — see live measured
  // on one customer's feelreef site, 585/585 both zh-tw and en-us).
  ['locale category heading is resolved for THAT locale (content/zh-tw/_site.md overrides the base name)', () =>
    /<h1>新聞稿<\/h1>/.test(zhCategoryPress) && /<h1>Press<\/h1>/.test(categoryPress)],
  ['locale archive <html lang> is the locale\'s own BCP-47 tag', () => /<html lang="zh-Hant"/.test(zhCategoryPress)],
  ['base archive is unaffected — still lists the base posts, in the base language, at the base URL', () =>
    categoryPress.includes('bl-entry-link" href="/devlog/a-signed-post"')
    && categoryPress.includes('bl-entry-link" href="/devlog/an-unsigned-post"')
    && /<html lang="en"/.test(categoryPress)],
  // -- hreflang between locale editions of the SAME slug (item 1: "when both exist") --
  ['🔴 category archive hreflang: base ⇄ locale, reciprocally, for the SAME slug', () =>
    /hreflang="en" href="[^"]*\/category\/press\/"/.test(categoryPress)
    && /hreflang="zh-Hant" href="[^"]*\/zh-tw\/category\/press\/"/.test(categoryPress)
    && /hreflang="en" href="[^"]*\/category\/press\/"/.test(zhCategoryPress)
    && /hreflang="zh-Hant" href="[^"]*\/zh-tw\/category\/press\/"/.test(zhCategoryPress)],
  ['tag archive hreflang is reciprocal too', () =>
    /hreflang="zh-Hant" href="[^"]*\/zh-tw\/tag\/fixture\/"/.test(tagFixture)
    && /hreflang="en" href="[^"]*\/tag\/fixture\/"/.test(zhTagFixture)],
  // -- item 2: post cards / the category-sidebar rail / tag chips link to the LOCALE archive when
  //    it exists, and fall back to the base archive on a locale that doesn't route it --
  ['blog index (locale edition): the authored category rail links to the LOCALE archive', () =>
    zhDevlogIndex.includes('href="/zh-tw/category/press">Press（2）<')],
  ['blog index (base/default edition): the SAME rail is unprefixed — no regression on the locale this feature did not touch', () =>
    devlogIndex.includes('href="/category/press">Press（2）<')],
  ['blog index (locale edition): tag chips resolving to /tag/ also carry the locale prefix', () =>
    (zhDevlogIndex.match(/bl-tag" href="\/zh-tw\/tag\/fixture\/"/g) || []).length === 2],
  ['blog index (base edition): tag chips stay unprefixed', () =>
    (devlogIndex.match(/bl-tag" href="\/tag\/fixture\/"/g) || []).length === 2
    && !devlogIndex.includes('/zh-tw/tag/')],
  // -- item 3: sitemap includes the new routes (base categoryUrls — missing entirely before this
  //    feature — and both term archives for the locale edition) --
  ['sitemap: base category archive is listed (categoryUrls existed for tags only, before this feature)', () =>
    sitemapXml.includes('<loc>https://example.com/category/press/</loc>')],
  ['sitemap: locale term archives are listed, locale-prefixed', () =>
    sitemapXml.includes('<loc>https://example.com/zh-tw/category/press/</loc>')
    && sitemapXml.includes('<loc>https://example.com/zh-tw/tag/fixture/</loc>')],
  ['sitemap: the locale blog index + its own posts are listed too', () =>
    sitemapXml.includes('<loc>https://example.com/zh-tw/devlog/</loc>')
    && sitemapXml.includes('<loc>https://example.com/zh-tw/devlog/a-signed-post/</loc>')],
  // -- non-Lingo / non-archive pages stay byte-identical — the other 90 checks above (home,
  //    blocks, markers, forms, custom-theme, byline, feed, icons, nav …) never changed and all
  //    still pass unmodified against this same build, which is the byte-identical proof: nothing
  //    in this feature altered a single non-Lingo, non-archive code path. --

  // -- round 4 (R3-P2-1 / R3-P2-2 / R3-P3-1): scheme-check.md, the fixture this repo never had --
  ['🔴 scheme-check: no disallowed scheme reaches any href=/src=/action=/srcset=/data-cart-href attribute, or any inline <script> location assignment, anywhere on the page', () =>
    disallowedSchemeHits(schemeCheck).length === 0],
  // CONTROL for the check above: the fixture's own explanatory prose deliberately quotes a
  // disallowed destination inside plain text (`<span class="st-code">…action="javascript:…"…`)
  // — if the check above were a naive `.includes('javascript:')` instead of a tag-anchored scan,
  // it would report a false hit on this page's OWN copy and could never go green here. Proves
  // the negative check just above is not vacuously true because it can't see the page's text.
  ['🔴 the disallowed-scheme scan is tag-anchored, not a raw-text search (control: the fixture prose itself quotes "javascript:" in plain text)', () =>
    schemeCheck.includes('action="javascript:') && disallowedSchemeHits(schemeCheck).length === 0],
  ['scheme-check: form action= with a disallowed scheme emits no action= at all and disables the submit button', () => {
    const first = schemeCheck.slice(schemeCheck.indexOf('<form class="st-form"'), schemeCheck.indexOf('</form>') + '</form>'.length);
    return !/action=/.test(first.slice(0, first.indexOf('>')))
      && /<button class="st-form-submit" type="submit" disabled>Send<\/button>/.test(first);
  }],
  ['scheme-check: the safe sibling form still posts to its own action (control — the check above did not just turn every form off)', () =>
    /<form class="st-form" action="\/safe-contact" method="post">/.test(schemeCheck)],
  ['scheme-check: header-cta with a disallowed scheme degrades to a plain span, label intact', () =>
    /<span class="rf-header-cta">Buy now<\/span>/.test(schemeCheck)],
  ['scheme-check: header-actions-cart-href is gated at its declaration point — never reaches data-cart-href, even though the cart IS wired (data-cart-guild present proves the slot was actually exercised, not skipped)', () =>
    schemeCheck.includes('data-cart-guild="scheme-check-cart"') && !schemeCheck.includes('data-cart-href=')],
  ['scheme-check: favicon/apple-touch-icon fall back to the generated paths when the mark is a disallowed scheme', () =>
    /<link rel="icon"[^>]*href="\/favicon\.ico"/.test(schemeCheck)
    && /<link rel="icon"[^>]*href="\/favicon\.svg"/.test(schemeCheck)
    && schemeCheck.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">')],
  ['scheme-check: the fonts stylesheet (and its preconnects) are omitted entirely when fonts: is a disallowed scheme', () =>
    !schemeCheck.includes('fonts.googleapis') && !schemeCheck.includes('fonts.gstatic')],
  ['scheme-check: collection — the hostile item\'s card-wide GH link and learn link both drop (span, not <a>), the safe sibling\'s cover/GH/learn anchors all stay live (control)', () =>
    !/<a class="st-item-gh"[^>]*href="javascript/.test(schemeCheck)
    && /<h3>Hostile item<\/h3>/.test(schemeCheck)
    && /<a class="st-item-cover" href="\/safe-learn" aria-label="Safe item"><\/a>/.test(schemeCheck)
    && /<a class="st-item-gh" href="https:\/\/github\.com\/example\/safe-scheme-check" target="_blank" rel="noopener">/.test(schemeCheck)
    && /<a class="st-item-learn" href="\/safe-learn">/.test(schemeCheck)],
  ['scheme-check: grid — the hostile whole-cell link renders no <a> (just the label + chevron), the safe sibling\'s <a> is live (control)', () =>
    /<div class="st-cell">\s*<h3>Hostile cell<\/h3>/.test(schemeCheck)
    && /<a class="st-cell st-cell-link group" href="\/safe-grid">/.test(schemeCheck)],
  ['scheme-check: gallery — same shape, safe sibling live (control)', () =>
    /<div class="st-gal-cell">\s*<h3>Hostile gallery cell<\/h3>/.test(schemeCheck)
    && /<a class="st-gal-cell st-cell-link group" href="\/safe-gallery">/.test(schemeCheck)],
  ['scheme-check: carousel — same shape, safe sibling live (control)', () =>
    /<div class="st-car-cell st-gal-cell">\s*<h3>Hostile carousel cell<\/h3>/.test(schemeCheck)
    && /<a class="st-car-cell st-gal-cell st-cell-link group" href="\/safe-carousel">/.test(schemeCheck)],
  ['scheme-check: people — a disallowed-scheme name link degrades to plain text (no <a> around it), the safe sibling\'s name link is live (control)', () =>
    /<h3 class="st-person-name">\s*Hostile person\s*<\/h3>/.test(schemeCheck)
    && /<h3 class="st-person-name">\s*<a href="\/safe-person">Safe person<\/a>\s*<\/h3>/.test(schemeCheck)],
  ['scheme-check: people — an SVG data: portrait is dropped (no <img> at all), the raster PNG data: sibling still renders (the check must tell the two data: forms apart, not reject every data: URI)', () =>
    !schemeCheck.includes('data:image/svg+xml')
    && /<img class="st-img" src="data:image\/png;base64,iVBORw0KGgo=" alt="Safe portrait"/.test(schemeCheck)],
  ['scheme-check: people links: row — the disallowed entry drops to a plain span, the safe entry stays a live <a> (control)', () =>
    /<span class="st-person-link">Bad<\/span>/.test(schemeCheck)
    && /<a class="st-person-link" href="\/safe-person-link">Good<\/a>/.test(schemeCheck)],
  ['scheme-check: tagcloud — the disallowed tag drops to a span, the safe tag stays a live <a>, and a protocol-relative destination is admitted unchanged (R2-P3-3: an author who can write `//x` can already write `https://x`)', () =>
    /<span class="st-tag">Bad tag<\/span>/.test(schemeCheck)
    && /<a class="st-tag" href="\/safe-tag">Good tag<\/a>/.test(schemeCheck)
    && /<a class="st-tag" href="\/\/example\.test\/x">Protocol-relative tag<\/a>/.test(schemeCheck)],
  // 🩸 the section's OWN id (slugified from its "Background image" heading) contains the literal
  // substring "background-image" — a bare `.includes('background-image')` on the tag would pass
  // by matching the id, not by proving the absence of a live style. Checked for `style="` (what
  // `bgOk ? ' style="…"' : ''` actually toggles) instead, which the id cannot forge.
  ['scheme-check: hero bg= with a disallowed scheme renders no background-image at all (no style= attribute on the section)', () => {
    const m = /<section class="st-hero st-full-bleed" id="s9-background-image"[^>]*>/.exec(schemeCheck);
    return !!m && !m[0].includes('style=');
  }],
  // round 5 (R4-P3-6): a SAFE bg= must still emit a QUOTED, CSS-escaped url() — proves the fix
  // did not just make disallowed schemes disappear, it changed what a SAFE one looks like too.
  ['scheme-check: hero bg= with a SAFE destination emits a quoted url() (control for R4-P3-6 — a bare url() is the CSS-declaration-injection shape)', () =>
    /id="s\d+-safe-background-image-control"[^>]*style="background-image:url\(&quot;\/safe-bg\.jpg&quot;\)"/.test(schemeCheck)],
  // round 5 (R4-P3-6): the review's own `)`/`;` CSS-declaration-injection payload, reproduced —
  // the ENTIRE value, `)`/`;` included, must stay inside the one quoted CSS string: the style
  // attribute's value must be EXACTLY `background-image:url("…")`, nothing after the closing
  // quote/paren, so no second declaration can have opened.
  ['🔴 scheme-check: hero bg= cannot inject a CSS declaration via `)`/`;` in an otherwise-safe URL', () => {
    const m = /<section class="st-hero st-full-bleed" id="s\d+-css-injection-guard"[^>]*\sstyle="([^"]*)"/.exec(schemeCheck);
    return !!m && m[1] === 'background-image:url(&quot;/safe-bg.jpg);position:fixed;inset:0;background:red&quot;)';
  }],
  // round 5 (R4-P3-1): share-image:/og-image: reaching og:image/twitter:image with no gate.
  ['🔴 scheme-check: share-image with a disallowed scheme emits no og:image/twitter:image meta at all', () =>
    !/<meta property="og:image"/.test(schemeCheck) && !/<meta name="twitter:image"/.test(schemeCheck)
    && /<meta name="twitter:card" content="summary">/.test(schemeCheck)],
  // round 5 (R4-P3-2): a blog card's featured image is gated at parsePost's own declaration —
  // covered below by the dedicated blog/svg-image-post.md fixture, not here (this page carries no
  // blog corpus of its own).
  // round 5 (R4-P1-1 "6 of 14" / R4-P3-5): the coral types scheme-check.md did not yet cover —
  // cta/social/timeline/faq/prose/embed, closing 8/14 → 14/14.
  ['scheme-check: cta — the hostile primary button (button=) drops to plain text, the safe secondary (a body link paragraph) stays a live <a> (control)', () =>
    /<span class="st-cta-btn st-cta-btn-primary">Hostile CTA<\/span>/.test(schemeCheck)
    && /<a class="st-cta-btn st-cta-btn-secondary" href="\/safe-cta"[^>]*>Safe CTA/.test(schemeCheck)],
  ['scheme-check: social — the hostile link (first, primary) drops, the safe sibling (second, secondary) stays live (control)', () =>
    /<span class="st-social-btn st-social-btn-primary">Bad social<\/span>/.test(schemeCheck)
    && /<a class="st-social-btn st-social-btn-secondary" href="\/safe-social"[^>]*>Safe social/.test(schemeCheck)],
  ['scheme-check: timeline renders with no gated destination of its own (structural coral — no href/src in its own template)', () =>
    /<p class="st-tl-year"[^>]*>2026<\/p>/.test(schemeCheck)],
  ['scheme-check: faq renders (structural coral — no href/src in its own template)', () =>
    /<summary class="st-faq-q"/.test(schemeCheck)],
  ['scheme-check: prose — a trailing hostile link-only paragraph drops to plain text, the safe sibling in the SAME paragraph stays a live CTA button (control)', () =>
    /<span class="st-prose-btn st-prose-btn-primary">Bad prose link<\/span>/.test(schemeCheck)
    && /<a class="st-prose-btn st-prose-btn-secondary" href="\/safe-prose"[^>]*>Safe prose/.test(schemeCheck)],
  ['scheme-check: embed — the accepted, documented residual (raw HTML passthrough is embed\'s own doctrine, not a gap this fix closes)', () =>
    /class="st-embed"/.test(schemeCheck) && /Embed passthrough control\./.test(schemeCheck)],
  // round 5 (R4-P2-1): the widened scan run over EVERY page the primary build produced, plus
  // rss.xml/sitemap.xml/search-index.json/reef-posts.json — not just scheme-check.md. This is the
  // assertion that would have caught R4-P1-1 (the blog family was never on scheme-check.md and
  // never will be — it needs real posts, which is what the hostile-blog-site build below is for;
  // this one instead proves the WIDENED SCAN ITSELF doesn't introduce a false positive against the
  // primary build's own ~30 pages of otherwise-legitimate content).
  ['🔴 site-wide (primary build): disallowedSchemeHits() finds zero hits across every built page + rss.xml + sitemap.xml + search-index.json + reef-posts.json', () => siteWideHits.length === 0],
  // -- round 5 (R4-P1-1): the isolated hostile-blog-site build — permalink/blog-url-pattern/
  // blog-path/blog-category-base/blog-tag-base, the SITE-LEVEL fields a single-page fixture
  // cannot exercise (see buildHostileBlogFixture's own header for why this needed a second build).
  ['🔴 hostile-blog-site: zero disallowedSchemeHits across every page + rss.xml + sitemap.xml + search-index.json + reef-posts.json', () => hostileSiteWideHits.length === 0],
  ['hostile-blog-site: the blog index is reachable at the SAFE configured blog-path (/diary), not reset by the hostile blog-url-pattern', () =>
    existsSync(join(HDIST, 'diary', 'index.html'))],
  ['🔴 hostile-blog-site: a post whose OWN permalink is javascript:void(0) gets a real internal URL, not the raw scheme (R4-P1-1 concrete input #1)', () =>
    /<a class="bl-entry-link" href="\/diary\/hostile-permalink-post">/.test(hostileIndex)
    && !hostileIndex.includes('javascript:')],
  ['🔴 hostile-blog-site: a SIBLING post with NO permalink override of its own is ALSO poisoned by the site-wide blog-url-pattern, and ALSO degrades safely (R4-P1-1\'s "poisons every post" claim, reproduced and closed)', () =>
    /<a class="bl-entry-link" href="\/diary\/safe-post">/.test(hostileIndex)],
  ['🔴 hostile-blog-site: the poisoned post\'s own page — prev/next nav, breadcrumb/back-link — carries no javascript: scheme anywhere', () =>
    !hostilePermalinkPost.includes('javascript:') && /href="\/diary\/safe-post"/.test(hostilePermalinkPost)],
  ['🔴 hostile-blog-site: the sibling post\'s own page is equally clean', () =>
    !hostileSafePost.includes('javascript:') && /href="\/diary\/hostile-permalink-post"/.test(hostileSafePost)],
  ['🔴 hostile-blog-site: rss.xml carries no javascript: scheme in any <link> (R4-P1-1\'s exact `https://example.comjavascript:void(0)` failure, reproduced and closed)', () =>
    !hostileRss.includes('javascript:')],
  ['🔴 hostile-blog-site: sitemap.xml carries no javascript: scheme in any <loc>', () =>
    !hostileSitemap.includes('javascript:')],
  ['🔴 hostile-blog-site: the tag archive/chip built from a disallowed blog-tag-base resolves to the historic /tag default, not the raw scheme ("term-archive URLs")', () =>
    /href="\/tag\/news\/"/.test(hostileIndex) && !/href="javascript/.test(hostileIndex)],
  ['hostile-blog-site: the category archive route itself still exists at its own fixed /category/<slug>/ location (the physical route, unaffected by blog-category-base — only LINKS to it read that field)', () =>
    existsSync(join(HDIST, 'category', 'team', 'index.html')) && /Team|team/.test(hostileCategoryArchive)],
  ['hostile-blog-site: search-index.json (blog-search: true here) carries a safe `u` for every row', () => {
    const rows = JSON.parse(readFileSync(join(HDIST, 'search-index.json'), 'utf8'));
    return rows.length === 3 && rows.every((r) => typeof r.u === 'string' && !r.u.includes('javascript:'));
  }],
  // round 5 (R4-P3-2): the SVG-featured-image post's card must render with NO <img> at all (the
  // gate at parsePost's own declaration means the ENTRY still shows — only the image drops).
  ['🔴 hostile-blog-site: a post whose first body image is an SVG data: URI drops the card image entirely, everywhere the card renders (the entry itself still shows)', () =>
    /<a class="bl-entry-link" href="\/diary\/svg-image-post">/.test(hostileIndex)
    && !/data:image\/svg\+xml/.test(hostileIndex)
    && !/<img class="bl-entry-img"/.test(hostileIndex)],
  // 🔴 THE CONTROL ARM (R3-P2-2's identity-swap experiment, per the review): this suite cannot
  // prove it is a check rather than a tautology from its own green run alone — round 3 measured
  // the opposite failure (13 files' worth of gates reverted to the identity function and the
  // smoke still said PASS). Run once by hand, not wired into this file (a permanently-committed
  // "make the app unsafe" switch has no place in a security fix): replace `site-core.js`'s
  // `safeHref`/`safeSrc` bodies with `(x) => x` in a scratch copy, rebuild, run this smoke against
  // it, and confirm every scheme-check assertion above goes red. Recorded in REPORT-linkdest.md
  // (第四輪) with the exact commands and the red output, exactly as round 3 recorded its own.
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
