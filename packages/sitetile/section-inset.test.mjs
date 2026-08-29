// Guard: every top-level `<section class="st-<name>">` a coral component emits gets a box-model
// FLOOR (max-width + padding) from the package, and the three corals tile-lab#11 found completely
// unpainted (`.st-gallery`, `.st-tagcloud`/`.st-tag-flow`, `.st-collection-pills`) get real paint.
//   run: node packages/sitetile/section-inset.test.mjs   (wired into scripts/test.sh via the glob)
//
// 🩸 2026-08-28. probe_render on a built site (desktop AND phone) found `.st-gallery`,
// `.st-carousel`, `.st-collection`, `.st-timeline` headings sitting at x=0 — the same defect class
// `.st-faq` had (base-paint.test.mjs, tile PR #6), just not caught per coral because a coral's
// DESCENDANTS may well be styled while its CONTAINER — the box that carries the page's left/right
// margin — is not. A file full of `.st-gal-*` / `.st-tl-*` rules reads as "this coral got CSS";
// whether the outer `<section>` itself did is invisible next to them.
//
// Root-cause fix (site.css) is a GENERIC floor: `:where(section[class^="st-"]:not(.st-full-bleed))`.
// This file checks that rule exists and is not a cage, checks every coral's own emitted section
// class is actually reachable by it (so a coral added later inherits the floor without anyone
// remembering to write a new rule), and checks the specific paint tile-lab#11 asked for.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro', 'src', 'styles', 'site.css'), 'utf8');
const SECTIONS_DIR = join(HERE, 'astro', 'src', 'components', 'sections');
const PAGE_404 = readFileSync(join(HERE, 'astro', 'src', 'pages', '404.astro'), 'utf8');

console.log('section-inset');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/** Rule bodies whose selector contains `needle` (comments stripped first). Mirrors base-paint.test.mjs's
 *  reader — anchored on the selector run so it can't skip alternating rules (see that file's own test
 *  for why that anchor matters). */
function rulesFor(needle) {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(needle)) out.push({ selector: m[1].trim(), css: m[2] });
  }
  return out;
}

// ── every coral's OWN emitted section class(es), scanned from markup (not hand-kept) ───────────
//
// A hand-kept list of "the containers" is exactly the kind of list this repo's scripts/test.sh
// distrusts (see its own comments on SUITE_GLOBS/covered — "a hand-kept list is wrong the day the
// renderer moves"). Scanning `<section class="…">` out of every *.astro in sections/ means a new
// coral file is covered automatically, and a renamed class fails this test instead of drifting
// silently.
const CORAL_FILES = readdirSync(SECTIONS_DIR)
  .filter((f) => f.endsWith('.astro') && f !== 'GridCell.astro'); // a child partial, not a coral

/** All literal class tokens on every `<section class="…">` in one file's source (static prefix
 *  only — `class="st-hero st-full-bleed st-hero-layered"` → ['st-hero','st-full-bleed','st-hero-layered'];
 *  a `class={cls}` expression (Embed.astro) is skipped — its container is exercised on its own below. */
function sectionClassSets(src) {
  return [...src.matchAll(/<section\s+class="([^"]+)"/g)].map((m) => m[1].split(/\s+/));
}

const emitted = new Map(); // file -> class-token arrays (one per <section> in that file)
for (const f of CORAL_FILES) {
  const src = readFileSync(join(SECTIONS_DIR, f), 'utf8');
  emitted.set(f, sectionClassSets(src));
}

test('🔴 CONTROL: the scan actually finds section classes (wrong directory would pass vacuously)', () => {
  assert.ok(CORAL_FILES.length > 5, `only ${CORAL_FILES.length} section components found`);
  const total = [...emitted.values()].flat().length;
  assert.ok(total > 10, `only ${total} <section class="…"> tags scanned across ${CORAL_FILES.length} files`);
  assert.ok(emitted.get('Gallery.astro').flat().includes('st-gallery'), 'sanity: Gallery.astro must emit st-gallery');
});

// ── the generic floor rule itself ───────────────────────────────────────────────────────────────

const FLOOR_SELECTOR_RE = /:where\(section\[class\^="st-"\][^)]*\)/;

test('🔴 a generic section-container floor rule exists, targeting the SECTION the renderer wraps a coral in', () => {
  assert.match(CSS, FLOOR_SELECTOR_RE, 'no :where(section[class^="st-"]…) rule in site.css');
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/:where\(section\[class\^="st-"\][^{]*\{[^}]*\}/);
  assert.ok(rules, 'the floor selector exists but is not attached to a rule body');
  assert.match(rules[0], /max-width/, 'floor rule has no max-width');
  assert.match(rules[0], /padding[^;]*clamp|padding-inline/, 'floor rule has no padding');
  assert.match(rules[0], /margin-inline:\s*auto/, 'floor rule has no centering margin');
});

test('🔴 the floor rule is NOT gated on a custom theme (the sites missing this ARE the custom-theme ones)', () => {
  const m = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/:where\(section\[class\^="st-"\][^{]*\{[^}]*\}/);
  assert.ok(m, 'nothing to check means this proves nothing — assert existence first');
  assert.ok(!/data-theme-custom/.test(m[0]), 'the floor selector excludes exactly the sites that have this bug');
});

test('it is a FLOOR not a ceiling — :where() so a theme (or a coral\'s own rule) outranks it for free', () => {
  assert.match(CSS, /:where\(section\[class\^="st-"\]/, 'the rule must sit in :where() for zero specificity');
});

test('the floor carries the SAME box values as the shared wrapper — one opinion about page width, not two', () => {
  const shared = rulesFor('.st-cta').find((r) => /max-width/.test(r.css) && /st-prose/.test(r.selector));
  assert.ok(shared, 'the shared section wrapper rule (.st-prose, .st-grid, .st-cta, .st-people) is gone');
  const floorBody = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/:where\(section\[class\^="st-"\][^{]*\{([^}]*)\}/)[1];
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(norm(floorBody), norm(shared.css), 'the floor should carry the same declarations as the shared wrapper');
});

// ── every coral's own emitted section class is actually reachable by the floor selector ─────────
//
// `[class^="st-"]` matches the *string value* of the class attribute, so a class list has to be
// checked the way the browser checks it: does the whole attribute value start with "st-", and
// does the token list contain "st-full-bleed"? This mirrors that logic instead of re-declaring a
// by-hand exemption list, so a coral that quietly starts (or stops) opting out is caught here.
function matchesFloor(classTokens) {
  const attr = classTokens.join(' ');
  return attr.startsWith('st-') && !classTokens.includes('st-full-bleed');
}

test('🔴 REGRESSION PIN: gallery / carousel / collection / timeline are reached by the floor selector', () => {
  // The exact four corals probe_render found at x=0. Pinned individually so a future refactor of
  // the generic rule that happens to stop covering one of them fails on the coral, not in the
  // abstract.
  for (const [file, cls] of [['Gallery.astro', 'st-gallery'], ['Carousel.astro', 'st-carousel'],
                              ['Collection.astro', 'st-collection'], ['Timeline.astro', 'st-timeline']]) {
    const sets = emitted.get(file);
    const set = sets.find((s) => s.includes(cls));
    assert.ok(set, `${file} no longer emits <section class="${cls}">`);
    assert.ok(matchesFloor(set), `${cls} (${JSON.stringify(set)}) is not reached by [class^="st-"]:not(.st-full-bleed)`);
  }
});

test('🔴 no coral in sections/ emits a section the floor cannot reach, unless it opts out on purpose', () => {
  // The forward-looking half of the fix: a coral added after this file was written does not need
  // a new CSS rule OR a new line in this test to get the inset — it only needs to keep emitting
  // `<section class="st-…">`. This test is what makes that a checked property instead of a hope.
  const unreached = [];
  for (const [file, sets] of emitted) {
    for (const classTokens of sets) {
      if (!classTokens.some((c) => c.startsWith('st-'))) continue; // e.g. a blog/search section, out of scope
      if (!matchesFloor(classTokens)) unreached.push(`${file}: ${classTokens.join(' ')}`);
    }
  }
  // Hero is the one intentional exemption, and it is asserted explicitly below — everything else
  // unreached here is either a bug or missing its own container rule (also checked below).
  const unexplained = unreached.filter((u) => !/st-full-bleed/.test(u));
  assert.deepEqual(unexplained, [], `section(s) the floor cannot reach and that did not opt out on purpose:\n    ${unexplained.join('\n    ')}`);
});

test('the 404 page section (`st-section st-notfound`) is also reached — two classes, not one', () => {
  const m = /<section\s+class="([^"]+)"/.exec(PAGE_404);
  assert.ok(m, '404.astro must still render a <section class="…">');
  const tokens = m[1].split(/\s+/);
  assert.ok(matchesFloor(tokens), `404 section (${m[1]}) is not reached by the floor selector`);
});

// ── hero: the one deliberate full-bleed opt-out ──────────────────────────────────────────────────

test('🔴 every hero variant opts out via .st-full-bleed — the outer box stays edge-to-edge on purpose', () => {
  const heroSrc = readFileSync(join(SECTIONS_DIR, 'Hero.astro'), 'utf8');
  const sets = sectionClassSets(heroSrc);
  assert.ok(sets.length >= 3, `expected 3 hero <section> variants, found ${sets.length}`);
  for (const s of sets) {
    assert.ok(s.includes('st-hero'), `a hero <section> lost its st-hero class: ${s.join(' ')}`);
    assert.ok(s.includes('st-full-bleed'), `a hero <section> is missing the opt-out: ${s.join(' ')}`);
  }
});

test('opting the OUTER hero box out of the floor does not mean the hero is unstyled — its inner content is still inset', () => {
  // The exemption is for the section itself; the overlay/text that sits on top of the background
  // carries its own max-width and padding regardless, same as before this change.
  const overlay = rulesFor('st-hero-overlay').find((r) => /^\.st-hero-overlay\s*\{/.test(r.selector + ' {'));
  assert.ok(overlay, '.st-hero-overlay rule is gone');
  assert.match(overlay.css, /padding/, '.st-hero-overlay lost its padding');
  const h1 = rulesFor('.st-hero h1').find((r) => /max-width/.test(r.css));
  assert.ok(h1, '.st-hero h1 no longer bounds its own line length');
});

// ── tile-lab#11: the three corals with literally zero paint ─────────────────────────────────────

test('the gallery/carousel coral still emits .st-gal-cells / .st-gal-cell / .st-gal-fig', () => {
  const galSrc = readFileSync(join(SECTIONS_DIR, 'Gallery.astro'), 'utf8');
  assert.match(galSrc, /class="st-gal-cells"/);
  assert.match(galSrc, /st-gal-cell/);
  assert.match(galSrc, /st-gal-fig/);
});

test('🔴 .st-gal-cells is a responsive GRID with a token gap', () => {
  const rules = rulesFor('st-gal-cells').filter((r) => /^\.st-gal-cells\b/.test(r.selector));
  assert.ok(rules.length > 0, '.st-gal-cells must be styled in site.css');
  assert.ok(rules.some((r) => /display:\s*grid/.test(r.css)), 'no display:grid on .st-gal-cells');
  assert.ok(rules.some((r) => /grid-template-columns/.test(r.css)), 'no responsive track');
  assert.ok(rules.some((r) => /gap:\s*var\(--gd-gap\)/.test(r.css)), 'gap is not token-driven (var(--gd-gap))');
});

test('🔴 gallery/carousel images are object-fit: cover inside their figure', () => {
  const rules = rulesFor('st-gal-fig');
  assert.ok(rules.some((r) => /object-fit:\s*cover/.test(r.css)),
    `no object-fit: cover reachable from .st-gal-fig; selectors were: ${rules.map((r) => r.selector).join(' | ')}`);
});

test('the tagcloud coral still emits .st-tag-flow / .st-tag', () => {
  const tcSrc = readFileSync(join(SECTIONS_DIR, 'Tagcloud.astro'), 'utf8');
  assert.match(tcSrc, /class="st-tag-flow"/);
  assert.match(tcSrc, /class="st-tag"/);
});

test('the collection coral still emits .st-collection-pills / .st-collection-pill', () => {
  const colSrc = readFileSync(join(SECTIONS_DIR, 'Collection.astro'), 'utf8');
  assert.match(colSrc, /class="st-collection-pills"/);
  assert.match(colSrc, /class="st-collection-pill/);
});

test('🔴 tag-flow / collection-pills are an inline-wrapping FLEX row (a container floor, not just chip color)', () => {
  const rules = rulesFor('st-tag-flow').filter((r) => /st-tag-flow/.test(r.selector));
  assert.ok(rules.length > 0, '.st-tag-flow must be styled');
  assert.ok(rules.some((r) => /display:\s*flex/.test(r.css) && /flex-wrap:\s*wrap/.test(r.css)),
    'no display:flex;flex-wrap:wrap on .st-tag-flow');
  const pillRules = rulesFor('st-collection-pills').filter((r) => /^\.st-tag-flow,\s*\.st-collection-pills\b|st-collection-pills\s*\{/.test(r.selector) || /st-collection-pills/.test(r.selector));
  assert.ok(pillRules.some((r) => /display:\s*flex/.test(r.css)), '.st-collection-pills is not a flex row');
});

test('🔴 .st-tag and .st-collection-pill render as PILLS — inline-flex + fully-rounded corners, matching the grid facet filter idiom', () => {
  for (const cls of ['st-tag', 'st-collection-pill']) {
    const rules = rulesFor(cls).filter((r) => new RegExp(`\\.${cls}\\b`).test(r.selector));
    assert.ok(rules.length > 0, `.${cls} must be styled in site.css`);
    assert.ok(rules.some((r) => /display:\s*inline-flex/.test(r.css)), `.${cls} is not inline-flex`);
    assert.ok(rules.some((r) => /border-radius:\s*999px/.test(r.css)), `.${cls} is not a fully-rounded pill`);
  }
});

// ── .st-code: pre stays bounded, inline spans can break ────────────────────────────────────────

test('the coral/prose renderer still emits pre.st-code (block) and span.st-code (inline)', () => {
  const core = readFileSync(join(HERE, 'site-core.js'), 'utf8');
  const cssmd = readFileSync(join(HERE, '..', 'cssmd', 'cssmd.js'), 'utf8');
  assert.match(core, /<pre class="st-code">/, 'site-core.js must still emit pre.st-code for fenced code');
  assert.match(cssmd, /'-code">'/, 'cssmd must still emit the inline `<prefix>-code` span');
});

test('🔴 pre.st-code never pushes the page wider — max-width:100% ALONGSIDE its existing overflow-x:auto scroll', () => {
  const rules = rulesFor('pre.st-code').filter((r) => /^pre\.st-code\b/.test(r.selector));
  assert.ok(rules.length > 0, 'pre.st-code must be styled');
  assert.ok(rules.some((r) => /max-width:\s*100%/.test(r.css)), 'pre.st-code has no max-width: 100%');
  assert.ok(rules.some((r) => /overflow-x:\s*auto/.test(r.css)), 'pre.st-code lost its existing overflow-x: auto');
});

test('🔴 an inline code span can break — overflow-wrap: anywhere, so a long quoted token cannot widen the page', () => {
  const rules = rulesFor('span.st-code');
  assert.ok(rules.some((r) => /overflow-wrap:\s*anywhere/.test(r.css)),
    `no overflow-wrap: anywhere reachable from span.st-code; selectors were: ${rules.map((r) => r.selector).join(' | ')}`);
});

test('🩸 CONTROL: the inline-span rule stays scoped to span, so it can never re-apply block padding/border to inline text', () => {
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/span\.st-code\s*\{[^}]*\}/);
  assert.ok(rules, 'span.st-code rule is gone');
  assert.ok(!/padding|border|background/.test(rules[0]), 'span.st-code must not carry the block chrome — that is pre.st-code\'s job');
});

console.log(`  ${passed} passed`);

// A sticky header must not let the page scroll through it: the base .rf-header carries the page
// background, and `header: solid` names that floor explicitly (2026-08-28).
{
  const base = CSS.match(/\.rf-header \{[^}]*\}/);
  assert.ok(base && /background:\s*var\(--gd-bg\)/.test(base[0]), '.rf-header base rule paints the page background');
  assert.ok(/body\[data-header="solid"\] \.rf-header \{[^}]*background:\s*var\(--gd-bg\)/.test(CSS), 'header: solid is a real treatment value');
}
