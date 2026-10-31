// The dynamic-coral mount contract of the section emitters (tile-lab#52 phase 2).
//   run: node packages/emit/mounts.test.mjs
//
// Four section behaviours used to be hoisted Astro <script>s: grid `pack=masonry`, grid `filter=`,
// hero `parallax` and the carousel runtime. They are dynamic corals now
// (packages/dynamic-corals/<name>/), and an emitter writes only the MOUNT POINT a coral finds —
// `data-dynamic-coral="<name>"` — never the script. This file pins, per coral:
//   · the mount lands on the element the coral drives (by class), and only when the section opted in;
//   · the coral's client selects that mount and no longer the class it used to (a renamed selector
//     on one side only would ship a page whose script finds nothing — the golden diff cannot see
//     that, it only sees bytes);
//   · sitetile's component still loads the coral (Astro bundles the client into the page).
// Plus: no emitter writes a <script>, except the form's inbox script, which is position-bound
// (`document.currentScript`) and listed here by name.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, inlineHtml, bodyHtml, gridCellBodyHtml } from '../sitetile/site-core.js';
import { emitGrid } from './grid.mjs';
import { emitHero } from './hero.mjs';
import { emitCarousel } from './carousel.mjs';
import { emitCollection } from './collection.mjs';
import { emitForm } from './form.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORALS = join(HERE, '..', 'dynamic-corals');
const SECTIONS = join(HERE, '..', 'sitetile', 'astro', 'src', 'components', 'sections');
const ctx = { hero: false, index: 0, inline: inlineHtml, block: bodyHtml, cellBlock: gridCellBodyHtml };

console.log('emit dynamic-coral mounts');
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

const sectionOf = (marker, body) => parseSite(`---\ntitle: t\n---\n\n## S\n%% sitetile: ${marker} %%\n${body}\n`).sections[0];
/** Every opening tag carrying the mount, as `{ tag, cls }`. */
const mountsIn = (html, name) => [...html.matchAll(/<([a-z]+)\b([^>]*)>/g)]
  .filter((m) => m[2].includes(`data-dynamic-coral="${name}"`))
  .map((m) => ({ tag: m[1], cls: (/\bclass="([^"]*)"/.exec(m[2]) || [, ''])[1] }));

const gridParams = (o) => ({ eyebrow: null, cols: '', imageCards: false, more: null, packMasonry: false, surface: undefined, filterLabel: null, ...o });
const grid = sectionOf('grid', '### A [Brand]\nx\n\n### B [Other]\ny');
const heroParams = (o) => ({ media: 'avatar', layout: null, eyebrow: null, marqueeWords: [], enter: false, layerList: [], parallax: false, logo: null, logoPos: 'bottom', cta: undefined, bgOk: null, ...o });
const hero = sectionOf('hero', 'Body.');
const car = sectionOf('carousel', '### One\n![a](/a.png)');

const CASES = [
  {
    coral: 'grid-masonry', component: 'Grid.astro', oldSelector: '.st-cells[data-pack="masonry"]',
    on: () => emitGrid(grid, gridParams({ packMasonry: true }), ctx),
    off: () => emitGrid(grid, gridParams(), ctx),
    where: { tag: 'div', cls: 'st-cells' },
  },
  {
    coral: 'grid-filter', component: 'Grid.astro', oldSelector: "'.st-grid-filter'",
    on: () => emitGrid(grid, gridParams({ filterLabel: 'All' }), ctx),
    off: () => emitGrid(sectionOf('grid', '### No badge\nx'), gridParams({ filterLabel: 'All' }), ctx),   // no facet → no bar
    where: { tag: 'div', cls: 'st-grid-filter' },
  },
  {
    coral: 'hero-parallax', component: 'Hero.astro', oldSelector: '.st-hero-layered[data-parallax]',
    on: () => emitHero(hero, heroParams({ layerList: ['/b.png', '/f.png'], parallax: true }), ctx),
    off: () => emitHero(hero, heroParams({ layerList: ['/b.png', '/f.png'] }), ctx),   // layered, no parallax
    where: { tag: 'section', cls: 'st-hero st-full-bleed st-hero-layered' },
  },
  {
    coral: 'carousel', component: 'Carousel.astro', oldSelector: "'.st-carousel'",
    on: () => emitCarousel(car, { eyebrow: null, cols: '', more: null, start: '', isBlogFull: false, cells: car.cells }, ctx),
    off: null,   // every carousel is a mount
    where: { tag: 'section', cls: 'st-carousel' },
  },
];

for (const c of CASES) {
  test(`${c.coral}: one mount, on <${c.where.tag} class="${c.where.cls}">`, () => {
    assert.deepEqual(mountsIn(c.on(), c.coral), [c.where]);
  });
  if (c.off) test(`${c.coral}: no mount when the section did not opt in`, () => assert.deepEqual(mountsIn(c.off(), c.coral), []));
  test(`${c.coral}: the client selects the mount, not the old class`, () => {
    const src = readFileSync(join(CORALS, c.coral, `${c.coral}-client.mjs`), 'utf8');
    const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(code.includes(`'[data-dynamic-coral="${c.coral}"]'`), `${c.coral}-client.mjs does not query its mount`);
    assert.ok(!code.includes(c.oldSelector), `${c.coral}-client.mjs still queries ${c.oldSelector}`);
  });
  test(`${c.coral}: ${c.component} loads the coral`, () => {
    const src = readFileSync(join(SECTIONS, c.component), 'utf8');
    assert.match(src, new RegExp(`<script>import '\\.\\./\\.\\./\\.\\./\\.\\./\\.\\./dynamic-corals/${c.coral}/${c.coral}-client\\.mjs';</script>`));
  });
}

test('CONTROL: the mount check sees a mount on the wrong element', () => {
  const moved = CASES[0].on().replace(' data-dynamic-coral="grid-masonry"', '').replace('<section class="st-grid"', '<section class="st-grid" data-dynamic-coral="grid-masonry"');
  assert.notDeepEqual(mountsIn(moved, 'grid-masonry'), [CASES[0].where]);
});

// 🩸 The filter's pills come from EVERY cell's badge (gridFacets), but until 2026-10-31 only an
// image card carried `data-cat` — on a plain-card grid every pill matched nothing and hid the whole
// section. Every cell shape here: bare <div>, whole-cell link, link with a CTA (badge in the foot),
// overlay (badge is the secondary action), image card linked and not.
test('grid-filter: every pill names a category some cell carries — in every cell shape', () => {
  const shapes = sectionOf('grid', ['### Div [Plain]\nx', '### Link →/a [Linked]\nx', '### Foot →/b "Read" [Footed]\nx',
    '### Over →/c [Docs →/docs]\nx', '### None\nx'].join('\n\n'));
  const images = sectionOf('grid', '### Img [Pic]\n![a](/a.png)\n\n### ImgLink →/d [Linked pic]\n![b](/b.png)');
  for (const [name, sec, imageCards] of [['plain cards', shapes, false], ['image cards', images, true]]) {
    const html = emitGrid(sec, gridParams({ filterLabel: 'All', imageCards }), ctx);
    const bar = html.slice(html.indexOf('<div class="st-grid-filter"'), html.indexOf('<div class="st-cells"'));
    const pills = [...bar.matchAll(/data-cat="([^"]+)"/g)].map((m) => m[1]);
    const cellCats = [...html.matchAll(/<(?:div|a) class="st-cell(?: [^"]*)?"([^>]*)>/g)].map((m) => (/\bdata-cat="([^"]*)"/.exec(m[1]) || [])[1]);
    assert.ok(pills.length >= 2, `${name}: the fixture has facets (${pills})`);
    for (const p of pills) assert.ok(cellCats.includes(p), `${name}: pill "${p}" matches no cell (cells carry ${JSON.stringify(cellCats)})`);
    assert.equal(cellCats.filter((c) => c !== undefined).length, pills.length, `${name}: one category per badged cell, none on the unbadged`);
  }
});

test('no emitter writes a <script> — except the inbox form, by name', () => {
  for (const c of CASES) assert.ok(!/<script\b/i.test(c.on()), `${c.coral}: emitter output has a <script>`);
  assert.ok(!/<script\b/i.test(emitCollection(sectionOf('collection', '### G\n#### I\nx'), { eyebrow: null, link: null, ui: { updated: (x) => x, gh: 'gh', learn: 'l' } }, ctx)));
  const form = (isInbox) => emitForm(sectionOf('form', '### Email {email}\n### Message {textarea}'), {
    eyebrow: null, submit: 'Send', isInbox, formAction: isInbox ? '/__reef/inbox' : undefined, method: 'post', thanksPath: null,
    thanksMark: undefined, returnTo: '/contact/', homeHref: '/', copy: new Proxy({}, { get: (_, k) => String(k) }),
  }, ctx);
  assert.ok(!/<script\b/i.test(form(false)), 'a plain form has no script');
  assert.equal((form(true).match(/<script\b/g) || []).length, 1, 'an inbox form carries exactly its one inline script');
  assert.ok(form(true).endsWith('</script> </section>'), 'and it sits inside the section it drives');
});

console.log(`  ${passed} passed`);
