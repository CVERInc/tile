// Guard: classes the RENDERER emits are painted by the RENDERER, not left for the tenant.
//   run: node packages/sitetile/base-paint.test.mjs   (wired into scripts/test.sh)
//
// The defect class, found twice on 2026-08-08: we emit a class, nothing in this package styles it,
// and the page only looks right on sites whose theme happened to write a rule for a class its
// author never chose. Neither instance failed anything — the build is green, the HTML is valid,
// and the only detector is a person looking at the page.
//
//   .st-notfound   the 404's only container ⇒ text flush against the left edge
//   .st-cta-arrow  the wrapper holding a CTA arrow's gap ⇒ 「預約門診諮詢→」, no space
//
// Both were found by a tenant's own agent, and the second only because a noise fix made their
// unowned list short enough to read — it had been sitting in it for four builds.
//
// 🩸 2026-08-08. 404.astro renders `<section class="st-section st-notfound">` and NOTHING in the
// package styled either class — I grepped the whole repo and both appeared exactly once, in that
// file. Content pages never showed it because their sections are .st-prose/.st-grid/… which are
// styled; the 404 is the one page whose only classes are these two. So on any site whose theme
// lays out sections by coral name — the natural way to write one — the "page not found" message
// sat flush against the left edge.
//
// Found by an agent who was screenshotting the page to check its LANGUAGE. Their
// note on that is worth keeping: a measurement answers only the question you asked, and a
// screenshot answers the ones you did not. probe_render asserting `lang` would never have seen it.
//
// 🔴 The guard that must NOT come back: .st-social nearby is wrapped in
// `body:not([data-theme-custom])`, which would exempt exactly the custom-theme sites this affects.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro', 'src', 'styles', 'site.css'), 'utf8');
const PAGE = readFileSync(join(HERE, 'astro', 'src', 'pages', '404.astro'), 'utf8');

console.log('base-paint');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/**
 * Rule bodies whose selector matches, with comments stripped so prose cannot satisfy an assertion.
 *
 * 🩸 The first version anchored on `(^|[}])` — and CONSUMED that `}`, which is the closing brace
 * the NEXT rule needs as its own anchor. So it saw every OTHER rule, and which half depended on a
 * rule's parity in the file. It reported .st-notfound correctly until I inserted one rule above it,
 * at which point the guard went red against CSS that was perfectly fine. A parser that reads half
 * the stylesheet and says nothing is worse than no parser: the earlier green was luck.
 * Anchoring on the selector run instead needs no lookbehind — `[^{}]+` cannot cross a brace, so it
 * naturally starts wherever the previous rule ended.
 */
function rulesFor(needle) {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(needle)) out.push({ selector: m[1].trim(), css: m[2] });
  }
  return out;
}

test('🔴 the rule reader sees CONSECUTIVE rules, not every other one', () => {
  // The bug above, pinned. Without this the guard's coverage silently depends on how many rules
  // happen to sit above the one it is checking.
  const saved = CSS;
  const probe = (css) => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => m[1].trim());
  };
  assert.deepEqual(probe('.a { color: red }\n.b { color: blue }\n.c { color: green }'),
    ['.a', '.b', '.c'], 'three adjacent rules must yield three selectors');
  assert.equal(saved, CSS, 'and this probe does not disturb the file under test');
});

test('the 404 page still uses the class this guard is about', () => {
  // If the markup is renamed, the CSS below becomes dead and every other assertion here would
  // keep passing while the page broke again.
  assert.match(PAGE, /class="[^"]*\bst-notfound\b/, '404.astro must still emit .st-notfound');
});

test('🔴 .st-notfound gets horizontal padding from the package, not from the tenant', () => {
  const rules = rulesFor('st-notfound');
  assert.ok(rules.length > 0, '.st-notfound must be styled somewhere in site.css');
  const padded = rules.some((r) => /padding[^;]*clamp|padding-inline/.test(r.css));
  assert.ok(padded, `no padding rule found; selectors were: ${rules.map((r) => r.selector).join(' | ')}`);
});

test('🔴 the rule must NOT be gated on a custom theme', () => {
  // The exact mistake this would be: .st-social's guard reads sensibly and would silently exempt
  // every site that actually has the problem.
  const rules = rulesFor('st-notfound');
  // 🩸 Caught while proving this guard fires: with the rule deleted, this test PASSED — it was
  // iterating an empty list. An assertion over nothing is not an assertion, and it would have gone
  // green for the entire lifetime of the bug it exists to prevent.
  assert.ok(rules.length > 0, 'nothing to check means this test proves nothing — assert existence first');
  for (const r of rules) {
    assert.ok(!/data-theme-custom/.test(r.selector),
      `custom-theme sites are the ones affected, but this rule excludes them: ${r.selector}`);
  }
});

test('it is a FLOOR, not a ceiling — a theme can take it over', () => {
  // :where() is zero-specificity, so `.st-notfound { padding: 0 }` in a tenant theme wins without
  // !important. A renderer default that a tenant cannot override is a cage, not a default.
  const rules = rulesFor('st-notfound');
  assert.ok(rules.some((r) => /:where\(/.test(r.selector)),
    'the default should sit in :where() so any tenant rule outranks it');
});

test('🩸 CONTROL: the sibling that DOES gate on theme is still there, so this test can tell them apart', () => {
  // Without this, "no data-theme-custom anywhere near st-notfound" could pass because the whole
  // guard idiom vanished from the file — proving nothing about our rule.
  assert.match(CSS, /data-theme-custom/, 'the guarded idiom still exists elsewhere in this sheet');
});

// ── .st-faq: the same defect, third instance ────────────────────────────────────────────────────
//
// 🩸 2026-08-28. `.st-faq` had NO rule — while thirty lines of the stylesheet styled .st-faq-head,
// .st-faq-list, .st-faq-item, .st-faq-q and .st-faq-a. Every one of those is a DESCENDANT, so the
// file looked like a package that had thought about the faq, and the container it all hangs from
// had no width and no padding. On a built site probe_render showed `.st-faq` matching a single
// rule: `* { box-sizing }`. The FAQ ran edge to edge under a prose section inset 48px.
//
// Why nobody caught it by reading: the missing rule is invisible against a block of present ones.
// The detector was a screenshot, again.

const FAQ_PAGE = readFileSync(join(HERE, 'astro', 'src', 'components', 'sections', 'Faq.astro'), 'utf8');

test('the faq coral still emits the class this guard is about', () => {
  assert.match(FAQ_PAGE, /class="st-faq"/, 'Faq.astro must still emit .st-faq');
});

test('🔴 .st-faq is a CONTAINER — it gets width and padding from the package', () => {
  // `rulesFor` matches substrings, so .st-faq-item etc. all come back; the container rule is the
  // one whose selector names .st-faq and nothing after it. That distinction IS the bug: a file
  // full of .st-faq-* rules is not a styled .st-faq.
  const rules = rulesFor('st-faq').filter((r) => /\.st-faq(?![\w-])/.test(r.selector));
  assert.ok(rules.length > 0, '.st-faq itself must be styled, not only its descendants');
  assert.ok(rules.some((r) => /padding[^;]*clamp|padding-inline/.test(r.css)),
    `no padding rule; selectors were: ${rules.map((r) => r.selector).join(' | ')}`);
  assert.ok(rules.some((r) => /max-width/.test(r.css)), 'and a max-width, or it is inset but unbounded');
});

test('🔴 the container rule must NOT be gated on a custom theme', () => {
  // The faq PAINT below it is gated, correctly — a hand-rolled theme already chose the disclosure
  // look. Copying that guard onto the container would exempt precisely the sites with the bug.
  const rules = rulesFor('st-faq').filter((r) => /\.st-faq(?![\w-])/.test(r.selector));
  assert.ok(rules.length > 0, 'nothing to check means this proves nothing — assert existence first');
  for (const r of rules) {
    assert.ok(!/data-theme-custom/.test(r.selector),
      `custom-theme sites are the ones affected, but this rule excludes them: ${r.selector}`);
  }
});

test('🩸 CONTROL: the faq PAINT is still gated, so the test above can tell paint from box model', () => {
  // Without this, "no data-theme-custom on any .st-faq rule" could go green because the gate was
  // stripped off the disclosure paint too — which is a different, live regression.
  const paint = rulesFor('st-faq-item');
  assert.ok(paint.length > 0, 'the disclosure paint still exists');
  assert.ok(paint.some((r) => /data-theme-custom/.test(r.selector)),
    'the born paint for .st-faq-item must stay behind its gate');
});

test('the faq borrows the SHARED wrapper width, it does not invent one', () => {
  // 🔴 The cheapest way to get this wrong is a number. Sections are inset by one token and one
  // padding expression; a second opinion about page width is a layout that drifts by coral.
  const shared = rulesFor('.st-cta').find((r) => /max-width/.test(r.css) && /st-prose/.test(r.selector));
  assert.ok(shared, 'the shared section wrapper rule (.st-prose, .st-grid, .st-cta, .st-people) is gone');
  const faq = rulesFor('st-faq').filter((r) => /\.st-faq(?![\w-])/.test(r.selector));
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const want = norm(shared.css);
  assert.ok(faq.some((r) => norm(r.css) === want),
    `the faq container should carry the same declarations as the shared wrapper.\n  shared: ${want}\n  faq:    ${faq.map((r) => norm(r.css)).join(' // ')}`);
});

// ── .st-cta-arrow: the same defect, found the same day ──────────────────────────────────────────

const CORE = readFileSync(join(HERE, 'site-core.js'), 'utf8');

test('site-core still emits the CTA arrow wrapper this guard is about', () => {
  assert.match(CORE, /class="st-cta-arrow"/, 'if the wrapper is renamed, the rule below goes dead');
});

test('🔴 .st-cta-arrow carries its own gap — the wrapper exists ONLY to hold that gap', () => {
  // The glyph inside is styled by the signet package. The wrapper had no rule at all, so the arrow
  // touched the last character of the label on every site that had not guessed it needed one.
  const rules = rulesFor('st-cta-arrow');
  assert.ok(rules.length > 0, '.st-cta-arrow must be styled in site.css');
  assert.ok(rules.some((r) => /margin-inline-start|margin-left|gap|padding-inline-start/.test(r.css)),
    `no spacing rule; selectors were: ${rules.map((r) => r.selector).join(' | ')}`);
  assert.ok(rules.some((r) => /:where\(/.test(r.selector)), 'a floor, not a cage');
});

// ── the blog package: 24 emitted classes, 7 rules, all of them bl-search-* ──────────────────────
//
// Measured 2026-08-08 by running reef's own class-delta against tile-lab's dist-smoke — OUR
// renderer, OUR default theme, zero tenant CSS: 29 unowned, 24 of them bl-*. The same set a
// customer's agent had been reporting as gaps in THEIR theme. It was our absent floor.
//
// 🔴 The line these tests defend, because it is the one that will drift:
//     FLOOR  the browser's default box model CONTRADICTS the structure we chose  → ours
//     LOOK   colour, type scale, borders, MAGNITUDE of spacing                   → theme's
// We do not ship templates. A "sensible default look" creeping in here IS a template, and the
// last test below is what makes that mechanical instead of a promise in a comment.

const BLOG = {
  index: readFileSync(join(HERE, 'astro', 'src', 'components', 'BlogIndexView.astro'), 'utf8'),
  archive: readFileSync(join(HERE, 'astro', 'src', 'components', 'ArchiveView.astro'), 'utf8'),
  post: readFileSync(join(HERE, 'astro', 'src', 'components', 'PostArticle.astro'), 'utf8'),
};

// [class, which component emits it, what the UA does to it if we say nothing]
const FLOOR = [
  ['bl-list', 'index', 'bullets at the UA 40px indent, under cards that were never list items'],
  ['bl-entry-link', 'index', 'an inline <a> holding <img>/<time>/<h2>/<p>'],
  ['bl-tags', 'index', 'adjacent <span>s concatenate: 工程設計筆記'],
  ['bl-share', 'post', 'adjacent <a>s concatenate: TwitterFacebook'],
  ['bl-date-badge', 'index', 'month/day/year are three adjacent spans: 08082026'],
  ['bl-post-nav', 'post', 'newer and older run together on one line'],
  ['bl-tag-filter', 'index', 'adjacent <button>s touch'],
];

for (const [cls, where, symptom] of FLOOR) {
  test(`🔴 .${cls} has a floor rule — without it: ${symptom}`, () => {
    // Markup first: if the class is renamed the CSS goes dead and a look-only assertion would
    // keep passing while the page broke again.
    assert.match(BLOG[where], new RegExp(`class="[^"]*\\b${cls}\\b`),
      `${where} must still emit .${cls}`);
    const rules = rulesFor(cls);
    assert.ok(rules.length > 0, `.${cls} must be styled in site.css`);
    assert.ok(rules.some((r) => /:where\(/.test(r.selector)),
      `a floor, not a cage — .${cls} must sit in :where(): ${rules.map((r) => r.selector).join(' | ')}`);
  });
}

test('🩸 .bl-list is reset by ITS OWN name, not by the search page\'s extra class', () => {
  // The whole defect. `<ul class="bl-list">` appears at five call sites; only /search also
  // carries .bl-search-results, and that is the only selector the reset was attached to. So the
  // decision existed and four of five pages never received it. A rule that happens to cover one
  // caller is not a floor.
  const emitters = ['index', 'archive'].filter((k) => /class="bl-list"/.test(BLOG[k]));
  assert.ok(emitters.length >= 2, 'more than one component emits a bare class="bl-list"');
  const named = rulesFor('bl-list').filter((r) => !/bl-search-results/.test(r.selector));
  assert.ok(named.length > 0, 'a rule must name .bl-list itself, independent of .bl-search-results');
  assert.ok(named.some((r) => /list-style/.test(r.css)), 'and it must carry the list reset');
});

test('🔴 the .bl-tag-filter rule must not defeat the `hidden` PE gate', () => {
  // :where() is zero-specificity, but it is still an AUTHOR rule, and the author sheet beats the
  // UA sheet's [hidden]{display:none} at ANY specificity. So `:where(.bl-tag-filter){display:flex}`
  // would reveal the filter bar on every site — including ones whose JS never confirmed it works.
  // Zero specificity is not the same as zero effect.
  const gated = rulesFor('bl-tag-filter');
  assert.ok(gated.length > 0, 'nothing to check means this proves nothing');
  for (const r of gated) {
    if (!/display/.test(r.css)) continue;
    assert.match(r.selector, /bl-tag-filter:not\(\[hidden\]\)/,
      `this sets display on a PE-gated element without excusing [hidden]: ${r.selector}`);
  }
});

test('🩸 CONTROL: the markup still gates the tag filter with `hidden`', () => {
  // Without this, the :not([hidden]) assertion above could pass forever after someone drops the
  // attribute from the markup, at which point the guard is describing a gate that is gone.
  assert.match(BLOG.index, /class="bl-tag-filter[^"]*"[^>]*\bhidden\b/,
    'BlogIndexView must still render the tag filter hidden until JS reveals it');
});

test('🔴 the floor stays a floor — no look properties in any bl-* :where() rule', () => {
  // The drift this exists to stop: we decided NOT to ship a default blog look, and the cheapest
  // way to break that decision is to add `color:` to a rule that is already here for box-model
  // reasons. Colour/type/border/decoration belong to the theme; if one of these is genuinely
  // needed, that is a product decision, not a test to loosen.
  const LOOK = /(^|[;\s])(color|background|background-[a-z]+|font|font-[a-z]+|border|border-[a-z-]+|box-shadow|text-decoration|text-transform|letter-spacing|line-height)\s*:/;
  const floor = rulesFor('bl-').filter((r) => /:where\(/.test(r.selector));
  // 🩸 First version asserted `floor.length >= FLOOR.length` — a rule COUNT against a class
  // count, and three of the classes share one selector, so it went red against correct CSS.
  // Non-vacuity is about coverage, not arithmetic: every class must be named somewhere.
  const covered = floor.map((r) => r.selector).join(' ');
  for (const [cls] of FLOOR) {
    assert.ok(covered.includes(cls), `no :where() floor rule names .${cls} — nothing to scan`);
  }
  for (const r of floor) {
    const hit = r.css.match(LOOK);
    assert.ok(!hit, `look property "${hit?.[2]}" in a floor rule — that is a template: ${r.selector}`);
  }
});

console.log(`  ${passed} passed`);
