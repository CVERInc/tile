// Run: node --test packages/sitetile/grid-cell-list.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyHtml, parseSite, renderSiteToHtml } from './site-core.js';

const page = (body, params = '', heading = 'Card') =>
  `## Cards\n%% sitetile: grid ${params} %%\n### ${heading}\n${body}\n`;
const render = (body, params, heading) => renderSiteToHtml(parseSite(page(body, params, heading)));
const items = (html) => [...html.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1]);
const variants = [
  ['', 'Card', ''],
  ['', 'Card →/details', ''],
  ['', 'Card →/details [More →/more]', ''],
  ['cards=image', 'Card', '![Sample](/sample.png)\n\n'],
  ['cards=image', 'Card →/details', '![Sample](/sample.png)\n\n'],
];

test('plain, linked, action and image grid cells split and strip every bullet', () => {
  assert.deepEqual(variants.map(([params, heading, image]) =>
    items(render(image + '- a<br>- b', params, heading))),
  variants.map(() => ['a', 'b']));
});

test('grid lists accept Markdown bullets and every br spelling', () => {
  assert.deepEqual(items(render('- a<BR>* b<br/>+ c<br />- d<br>* e')),
    ['a', 'b', 'c', 'd', 'e']);
});

test('br and newline grid lists produce identical HTML in every card shape', () => {
  assert.deepEqual(variants.map(([params, heading, image]) =>
    render(image + '- a<br>- b', params, heading)),
  variants.map(([params, heading, image]) =>
    render(image + '- a\n- b', params, heading)));
});

test('typographic bullets in grids retain the base paragraph output', () => {
  const bodies = ['・ a<br>・ b', '• a<br>• b'];
  assert.deepEqual(bodies.map((body) => render(body).match(/<h3>Card<\/h3>(.*?)<span class="st-cell-cta"/s)?.[1]),
    bodies.map((body) => bodyHtml(body)));
});

test('a horizontal-rule segment retains the base output', () => {
  const bodies = ['- a<br>* * *', '- a<br>- - -', '- a<br>___'];
  assert.deepEqual(bodies.map((body) => render(body).match(/<h3>Card<\/h3>(.*?)<span class="st-cell-cta"/s)?.[1]),
    bodies.map((body) => bodyHtml(body)));
});

test('each split item still uses the safe inline Markdown renderer', () => {
  assert.deepEqual(items(render('- **a**<br>- <script>x</script>')),
    ['<span class="st-b"><span class="st-mk">**</span>a<span class="st-mk">**</span></span>', '&lt;script&gt;x&lt;/script&gt;']);
});

test('table cell lists keep their existing output', () => {
  assert.deepEqual(items(bodyHtml('| Label | - a<br>- b |')), ['a', 'b']);
  assert.deepEqual(['-', '*', '+', '・', '•'].map((marker) =>
    bodyHtml(`| Label | ${marker} a<br>${marker} b |`)),
  Array(5).fill('<table class="st-table" data-headless><tbody><tr><td>Label</td><td><ul class="st-cell-list"><li>a</li><li>b</li></ul></td></tr></tbody></table>'));
});

test('other grid bodies retain the block parser output', () => {
  const bodies = [
    'a<br>b', '- a<br>continued', '- a', '- a\n  - b',
    '1. a\n2. b', 'Paragraph.\n\n- a\n- b',
    '```text\n- a<br>- b\n```',
    '- a<br>- b\n- c', '> a\n> b', '',
    '- `a<br>- b`', '- a <!-- <br>- hidden -->',
  ];
  assert.deepEqual(bodies.map((body) => render(body).match(/<h3>Card<\/h3>(.*?)<span class="st-cell-cta"/s)?.[1]),
    bodies.map((body) => bodyHtml(body)));
});

test('Astro routes every cell body through the shared grid renderer', () => {
  const source = readFileSync(new URL('./astro/src/components/sections/GridCell.astro', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  assert.deepEqual({
    imported: /import \{[^}]*\bgridCellBodyHtml\b[^}]*\} from '@sitetile'/.test(source),
    calls: [...source.matchAll(/<Fragment set:html=\{([^}]+)\} \/>/g)].map((m) => m[1]),
  }, {
    imported: true,
    calls: ['gridCellBodyHtml(fi.rest)', 'gridCellBodyHtml(fi.rest)',
      'gridCellBodyHtml(c.body)', 'gridCellBodyHtml(c.body)', 'gridCellBodyHtml(c.body)'],
  });
});
