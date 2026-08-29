// Collection's interaction contract is universal; its neutral presentation is born-paint only.
//   run: node packages/sitetile/collection-base-rendering.test.mjs (wired into scripts/test.sh)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8');
const COMPONENT = readFileSync(join(HERE, 'astro/src/components/sections/Collection.astro'), 'utf8');
const FIXTURE = readFileSync(join(HERE, 'astro/content/markers.md'), 'utf8');
const CUSTOM_THEME = readFileSync(join(HERE, 'examples/lilac/theme.css'), 'utf8');
const LAYOUT = readFileSync(join(HERE, 'astro/src/layouts/SiteLayout.astro'), 'utf8');

const RULES = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), css: m[2].trim() }));
const rulesFor = (needle) => RULES.filter((r) => r.selector.includes(needle));
const properties = (css) => [...css.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

console.log('collection-base-rendering');

test('the no-theme fixture exercises grouped collection cards and both destinations', () => {
  const collection = parseSite(FIXTURE).sections.find((s) => s.type === 'collection');
  assert.ok(collection, 'markers.md must contain a collection section');
  assert.equal(collection.groups.length, 2, 'two groups exercise category pills');
  assert.equal(collection.groups[0].items[0].learn, '/tools/compose');
  assert.equal(collection.groups[0].items[0].href, 'https://github.com/example/compose');
  assert.deepEqual(collection.groups[0].items[0].tags, ['layout', 'zero-js']);
});

test('the Astro card retains the cover and independent secondary anchors', () => {
  assert.match(COMPONENT, /class="st-cell st-item"/);
  assert.match(COMPONENT, /<a class="st-item-cover"/);
  assert.match(COMPONENT, /<a class="st-item-gh"/);
  assert.match(COMPONENT, /<a class="st-item-learn"/);
});

test('the cover fills a positioned card for every theme', () => {
  const card = rulesFor('st-item').find((r) => r.selector === '.st-item');
  const cover = rulesFor('st-item-cover').find((r) => r.selector === '.st-item-cover');
  assert.ok(card && cover, 'universal card and cover rules must both exist');
  assert.match(card.css, /position\s*:\s*relative/);
  assert.match(cover.css, /position\s*:\s*absolute/);
  assert.match(cover.css, /inset\s*:\s*0/);
  assert.match(cover.css, /z-index\s*:\s*1/);
  assert.ok(!/data-theme-custom/.test(card.selector + cover.selector), 'the hit area cannot be theme-gated');
});

test('secondary links stack above the full-card cover for every theme', () => {
  const links = rulesFor('a:not(.st-item-cover)').find((r) => r.selector.includes('.st-item'));
  assert.ok(links, 'a non-cover link stacking rule must exist');
  assert.match(links.css, /position\s*:\s*relative/);
  assert.match(links.css, /z-index\s*:\s*2/);
  assert.ok(!/data-theme-custom/.test(links.selector), 'secondary-link stacking cannot be theme-gated');
});

test('universal collection rules carry structure only', () => {
  const allowed = new Set(['position', 'inset', 'z-index', 'border-radius']);
  const collectionRules = RULES.filter((r) => /st-(?:collection|item)/.test(r.selector));
  const universal = collectionRules.filter((r) => !/data-theme-custom/.test(r.selector));
  assert.equal(universal.length, 3, `expected exactly three universal rules, found: ${universal.map((r) => r.selector).join(' | ')}`);
  for (const rule of universal) {
    const unexpected = properties(rule.css).filter((p) => !allowed.has(p));
    assert.deepEqual(unexpected, [], `presentation leaked into universal rule ${rule.selector}`);
  }
});

test('born presentation covers each collection family and is entirely custom-theme gated', () => {
  const families = [
    'st-collection-head', 'st-collection-head-inner', 'st-collection-link',
    'st-collection-belt', 'st-collection-belt-inner', 'st-collection-pills',
    'st-collection-pill', 'st-collection-group', 'st-collection-group-head',
    'st-item-head', 'st-item-badges', 'st-item-badge', 'st-item-tags', 'st-item-tag',
    'st-item-meta', 'st-item-meta-left', 'st-item-updated', 'st-item-gh', 'st-item-learn',
  ];
  for (const family of families) {
    const rules = rulesFor(family).filter((r) => !r.selector.includes('st-item-cover'));
    assert.ok(rules.length > 0, `no born-paint rule covers .${family}`);
    assert.ok(rules.every((r) => /body:not\(\[data-theme-custom\]\)/.test(r.selector)),
      `.${family} presentation escaped the compatibility gate: ${rules.map((r) => r.selector).join(' | ')}`);
  }
});

test('the themeless baseline collapses through the shared cell grid and its meta row', () => {
  const cells = rulesFor('st-cells').find((r) => r.selector === '.st-cells');
  assert.ok(cells, 'collection must keep using the shared .st-cells grid');
  assert.match(cells.css, /minmax\(min\(100%,\s*16rem\),\s*1fr\)/);
  assert.match(CSS, /@media\s*\(max-width:\s*36rem\)[^{]*\{\s*:where\(body:not\(\[data-theme-custom\]\)\) \.st-item-meta\s*\{[^}]*flex-direction:\s*column/);
});

test('the existing hand-authored theme keeps its card paint and receives no born paint', () => {
  assert.match(CUSTOM_THEME, /html \.st-cell, html a\.st-cell-link\s*\{[^}]*background:\s*#fff;[^}]*border:/s,
    'the existing lilac fixture must still own card presentation');
  assert.match(LAYOUT, /const customTheme = !!themeRaw\.trim\(\) && \(!compiled \|\| hasResidue\);/,
    'the established hand-authored-theme marker must remain unchanged');
  const leaked = RULES.filter((r) => /st-(?:collection|item)/.test(r.selector)
    && !/data-theme-custom/.test(r.selector)
    && properties(r.css).some((p) => !['position', 'inset', 'z-index', 'border-radius'].includes(p)));
  assert.deepEqual(leaked, [], `custom themes would receive collection presentation: ${leaked.map((r) => r.selector).join(' | ')}`);
});

console.log(`  ${passed} passed`);
