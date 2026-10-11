// Guard: a collection's belt is a BAND — its background runs edge to edge, its cards stay inside
// an inner box — and a collection on a theme that says nothing about it keeps the page inset.
//   run: node packages/sitetile/collection-band.test.mjs   (wired into scripts/test.sh via the glob)
//
// 🩸 CVERInc/reef#1869. The generic section floor (section-inset.test.mjs) caged the whole
// `<section class="st-collection">` at --gd-maxw. The coral's own markup had always been two
// outer/inner pairs (`-head`/`-head-inner`, `-belt`/`-belt-inner`) — built so the belt could
// span the viewport — so a theme that painted `.st-collection-belt` drew a box in the middle of
// the page, and the born belt's own `max-width: 80rem` inner box sat inside a 72ch cage it could
// never fill. Owners patched it per site by un-caging the section in their own CSS.
//
// The fix is the mechanism the floor already had: the section opts out with `.st-full-bleed`
// (same as the hero), and the floor's box values move one level in, onto the inner pairs. What
// this file pins is that BOTH halves stay true together — an opt-out with no inner floor is the
// x=0 defect the floor was written to end; an inner floor with no opt-out is the cage again.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, renderSiteToHtml } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8');
const COMPONENT = readFileSync(join(HERE, 'astro/src/components/sections/Collection.astro'), 'utf8');

/** Strip comments, then walk the source by brace depth. Every LEAF block (one with no block inside
 *  it) comes back as `{ selector, css, context }`, where `context` is the list of enclosing
 *  preludes, outermost first — `['@layer reef.base']` for a rule written straight in the base
 *  layer. A regex that flattens "selector + declarations" drops exactly this, so a rule wrapped in
 *  `@media`, `@supports`, a nested `@layer`, or moved into another layer looked identical to one
 *  that was never touched. Strings are skipped (a `{` inside one is not a block). */
function walkCss(source) {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const leaves = [];
  let buf = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      buf += src.slice(i, j + 1); i = j; continue;
    }
    if (ch === '{') {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ prelude: buf.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', '), decl: '', hasChild: false });
      buf = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (!top) throw new Error('unbalanced "}" in the stylesheet');
      top.decl += buf; buf = '';
      if (!top.hasChild) {
        leaves.push({ selector: top.prelude, css: top.decl.trim().replace(/\s+/g, ' '), context: stack.map((f) => f.prelude) });
      }
    } else if (ch === ';' && (stack.length === 0 || /^\s*@/.test(buf))) {
      buf = ''; // a statement at-rule (`@layer a, b;`, `@import …;`), top level or nested
    } else {
      buf += ch;
    }
  }
  if (stack.length) throw new Error(`unbalanced "{" in the stylesheet: ${stack.length} block(s) never closed`);
  return leaves;
}
const RULES = walkCss(CSS);
const decl = (css, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(css);
  return m ? m[1].trim() : null;
};

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

console.log('collection-band');

const FIXTURE = [
  '## Workshop tools',
  '%% sitetile: collection eyebrow="Workshop" %%',
  'Intro.',
  '',
  '### Composing',
  '#### Compose →https://example.com/compose "Stable"',
  'A tool.',
  '',
].join('\n');

// ── the opt-out: both renderers, counted ────────────────────────────────────────────────────────

/** class-token lists of every `<section …>` in a markup string. */
const sectionClasses = (markup) => [...markup.matchAll(/<section\b[^>]*?\sclass="([^"]+)"/g)]
  .map((m) => m[1].split(/\s+/))
  .filter((tokens) => tokens.some((t) => t.startsWith('st-'))); // the component's comments quote other markup

test('🔴 the Astro component emits exactly one section, and it opts out of the floor', () => {
  const sets = sectionClasses(COMPONENT);
  assert.equal(sets.length, 1, `expected one <section class="…"> in Collection.astro, found ${sets.length}`);
  assert.ok(sets[0].includes('st-collection'), `the section lost st-collection: ${sets[0].join(' ')}`);
  assert.ok(sets[0].includes('st-full-bleed'), `the section is caged again (no st-full-bleed): ${sets[0].join(' ')}`);
  assert.equal(sets[0][0], 'st-collection', 'st-collection must lead the attribute — [class^="st-"] and themes read it first');
});

test('🔴 the string renderer agrees with the component (one section, same two classes)', () => {
  const out = renderSiteToHtml(parseSite(FIXTURE));
  const sets = sectionClasses(out).filter((s) => s.includes('st-collection'));
  assert.equal(sets.length, 1, `expected one rendered collection section, found ${sets.length} in: ${out.slice(0, 200)}`);
  assert.deepEqual(sets[0], ['st-collection', 'st-full-bleed']);
  // the inner pairs the floor now sits on must really be in the markup, once each
  for (const cls of ['st-collection-head', 'st-collection-head-inner', 'st-collection-belt', 'st-collection-belt-inner']) {
    for (const [name, markup] of [['string renderer', out], ['component', COMPONENT]]) {
      const n = (markup.match(new RegExp(`class="${cls}"`, 'g')) || []).length;
      assert.equal(n, 1, `${name}: expected exactly one class="${cls}", found ${n}`);
    }
  }
});

// ── the inner floor ─────────────────────────────────────────────────────────────────────────────

const FLOOR = RULES.find((r) => /^:where\(section\[class\^="st-"\]/.test(r.selector));
/** universal (un-gated) rules written for the collection's four boxes */
const innerFloor = RULES.filter((r) => /^:where\(\.st-collection\b[^)]*\)$/.test(r.selector));
const ruleFor = (cls, prop) => innerFloor.filter((r) => r.selector.slice(7, -1).split(',').map((s) => s.trim()).includes(cls) && decl(r.css, prop) !== null);

test('CONTROL: the generic floor is where this file thinks it is, with the values it reads', () => {
  assert.ok(FLOOR, 'the generic section floor rule is gone — everything below would be vacuous');
  assert.equal(decl(FLOOR.css, 'max-width'), 'var(--gd-maxw)');
  assert.match(decl(FLOOR.css, 'padding'), /^\S+ clamp\([^)]*\)$/, 'floor padding is no longer "<block> clamp(…)"');
  assert.ok(innerFloor.length > 0, 'no :where(.st-collection-…) rule found at all');
});

const [FLOOR_BLOCK, FLOOR_INLINE] = FLOOR ? [decl(FLOOR.css, 'padding').split(' ')[0], decl(FLOOR.css, 'padding').replace(/^\S+ /, '')] : [];

test('🔴 head and belt each carry the floor\'s side padding — once', () => {
  for (const cls of ['.st-collection-head', '.st-collection-belt']) {
    const rules = ruleFor(cls, 'padding-inline');
    assert.equal(rules.length, 1, `expected exactly one universal padding-inline for ${cls}, found ${rules.length}`);
    assert.equal(decl(rules[0].css, 'padding-inline'), FLOOR_INLINE, `${cls} side padding drifted from the section floor's`);
  }
});

test('🔴 the inner boxes are the floor\'s CONTENT box: --gd-maxw minus both side paddings, centred', () => {
  const want = `calc(var(--gd-maxw) - 2 * ${FLOOR_INLINE})`;
  for (const cls of ['.st-collection-head-inner', '.st-collection-belt-inner']) {
    const rules = ruleFor(cls, 'max-width');
    assert.equal(rules.length, 1, `expected exactly one universal max-width for ${cls}, found ${rules.length}`);
    assert.equal(decl(rules[0].css, 'max-width'), want,
      `${cls}: a bare --gd-maxw here is wider than every other section's text by two paddings`);
    assert.equal(decl(rules[0].css, 'margin-inline'), 'auto', `${cls} is not centred`);
  }
});

// ── where the five rules live: the at-rule context, not just the declarations ───────────────────
// 🩸 The tests above read "selector + declarations". A rule wrapped in `@media (min-width: …)`,
// `@supports`, a nested `@layer`, or moved to `@layer reef.responsive` (which sorts AFTER the theme,
// so no theme could override it) reads exactly the same there — and each of those breaks the
// promise this PR makes: that a theme's own rule on these boxes wins without a fight, at every
// viewport, in every browser. So pin the context too: directly in `@layer reef.base`, nothing else.

const FIVE = [
  ':where(.st-collection)',
  ':where(.st-collection-head, .st-collection-belt)',
  ':where(.st-collection-head)',
  ':where(.st-collection-belt)',
  ':where(.st-collection-head-inner, .st-collection-belt-inner)',
];
const BASE_LAYER = '@layer reef.base';

test('CONTROL: the walker reports the enclosing at-rules (it can see what the regex could not)', () => {
  const [a, b, c, d] = walkCss('@layer a { @media (min-width: 48rem) { .x { color: red; } } .y { top: 0; } } .z { left: 0; } @layer q, r; .w { right: 0 }');
  assert.deepEqual(a.context, ['@layer a', '@media (min-width: 48rem)']);
  assert.deepEqual([b.selector, b.context], ['.y', ['@layer a']]);
  assert.deepEqual([c.selector, c.context], ['.z', []]);
  assert.deepEqual([d.selector, d.css, d.context], ['.w', 'right: 0', []]);
  assert.throws(() => walkCss('@layer a { .x { color: red; }'), /never closed/);
  assert.throws(() => walkCss('.x { color: red; } }'), /unbalanced/);
});

test('🔴 each of the five rules sits directly in `@layer reef.base` — no @media, @supports, nested or other layer', () => {
  for (const sel of FIVE) {
    const found = RULES.filter((r) => r.selector === sel);
    assert.equal(found.length, 1, `expected the rule ${sel} to be found once, found ${found.length}`);
    assert.deepEqual(found[0].context, [BASE_LAYER],
      `${sel} is written inside [${found[0].context.join(' > ')}] — it must be exactly [${BASE_LAYER}]`);
  }
});

test('🔴 each of the five selectors is declared exactly once, and nothing else is a zero-specificity rule on these boxes', () => {
  // Count, not existence: a second `:where(.st-collection-belt-inner) { max-width: … }` later in the
  // file would out-rank the first by source order and rewrite the width, while every "is there a
  // rule" check kept passing.
  for (const sel of FIVE) {
    const n = RULES.filter((r) => r.selector === sel).length;
    assert.equal(n, 1, `${sel} is declared ${n} times`);
  }
  const zeroSpec = RULES.filter((r) => /^:where\(\.st-collection\b[^)]*\)$/.test(r.selector));
  assert.deepEqual(zeroSpec.map((r) => r.selector).sort(), [...FIVE].sort(),
    'a zero-specificity :where(.st-collection…) rule other than the five exists');
});

test('the floor\'s block padding lands on the outside edges only (head top, belt bottom)', () => {
  const top = ruleFor('.st-collection-head', 'padding-block-start');
  const bottom = ruleFor('.st-collection-belt', 'padding-block-end');
  assert.equal(top.length, 1); assert.equal(bottom.length, 1);
  assert.equal(decl(top[0].css, 'padding-block-start'), FLOOR_BLOCK);
  assert.equal(decl(bottom[0].css, 'padding-block-end'), FLOOR_BLOCK);
});

test('🔴 the inner floor is NOT theme-gated and has zero specificity', () => {
  // The sites that had headings at x=0 were the custom-theme ones; a gate here re-opens that.
  for (const r of innerFloor) {
    assert.ok(!/data-theme-custom/.test(r.selector), `gated: ${r.selector}`);
    assert.match(r.selector, /^:where\([^()]*\)$/, `not a bare :where(): ${r.selector}`);
  }
});

test('🔴 the floor is box model only — a band\'s colour stays the theme\'s to give', () => {
  const allowed = new Set(['padding-inline', 'padding-block-start', 'padding-block-end', 'max-width', 'margin-inline', 'overflow-x']);
  for (const r of innerFloor) {
    const props = [...r.css.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)].map((m) => m[1]);
    assert.deepEqual(props.filter((p) => !allowed.has(p)), [], `paint leaked into ${r.selector}`);
  }
});

test('the born head text lines up with every other section (same expression, not a bare --gd-maxw)', () => {
  const born = RULES.filter((r) => /data-theme-custom/.test(r.selector) && /\.st-collection-head-inner$/.test(r.selector));
  assert.equal(born.length, 1, `expected one born rule for .st-collection-head-inner, found ${born.length}`);
  assert.equal(decl(born[0].css, 'max-width'), `calc(var(--gd-maxw) - 2 * ${FLOOR_INLINE})`);
});

test('the born belt\'s cards line up with a grid\'s cards (grid max-width minus both side paddings)', () => {
  const grid = RULES.find((r) => r.selector === '.st-grid' && decl(r.css, 'max-width'));
  assert.ok(grid, 'the .st-grid { max-width } rule this is measured against is gone');
  const born = RULES.filter((r) => /data-theme-custom/.test(r.selector) && /\.st-collection-belt-inner$/.test(r.selector));
  assert.equal(born.length, 1, `expected one born rule for .st-collection-belt-inner, found ${born.length}`);
  assert.equal(decl(born[0].css, 'max-width'), `calc(${decl(grid.css, 'max-width')} - 2 * ${FLOOR_INLINE})`);
});

test('🔴 a belt wider than the viewport is clipped, not scrolled (owners who patched with negative margins)', () => {
  const rules = ruleFor('.st-collection', 'overflow-x');
  assert.equal(rules.length, 1, `expected exactly one universal overflow-x on .st-collection, found ${rules.length}`);
  assert.equal(decl(rules[0].css, 'overflow-x'), 'clip', 'must be clip — hidden makes the section a scroll container');
});

test('no rule in the package re-cages the outer section', () => {
  const outer = RULES.filter((r) => r.selector.split(',').some((s) => /(?:^|\s)(?:section)?\.st-collection$/.test(s.trim())));
  for (const r of outer) assert.equal(decl(r.css, 'max-width'), null, `the section is width-limited again by: ${r.selector}`);
});

console.log(`  ${passed} passed`);
