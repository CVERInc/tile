// Run: node --test packages/sitetile/grid-cell-list.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bodyHtml, gridCellBodyHtml, parseSite, renderSiteToHtml } from './site-core.js';

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
    '> a\n> b', '',
    '- `a<br>- b`', '- a <!-- <br>- hidden -->',
    '- use `a<br>- b` here', '- ``a ` <br>- b`` c', '- a `unclosed <br>- b', '- a \\` b<br>- c `d`',
    '- a <!-- open <br>- b', '- a<br>- ', '- a<br>-b', '- a<br>-', '- a<br>1.b', '- a<br>・ b',
    'a<br>- b', 'Text <br>- b\nmore', '> - a<br>- b', '| Label | - a<br>- b |',
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

// ── item-level splitting: the list is one block among several in the cell ─────────────────────────
// The card shape an author actually writes: a title, a one-line subtitle, a paragraph, then the
// list — with bold labels and a full-width space inside each item. Synthetic content throughout.
const cardBody = (sep) =>
  'One line subtitle\n\nA paragraph of description.\n\n- **Label A**\u3000first content' + sep + '- **Label B**\u3000second content';
const cardPage = (params, sep, image = '') => `## Cards\n%% sitetile: grid ${params} %%\n`
  + ['Card one', 'Card two', 'Card three'].map((t) => `### ${t}\n${image}${cardBody(sep)}\n`).join('\n');
const renderCards = (params, sep, image) => renderSiteToHtml(parseSite(cardPage(params, sep, image)));
const lists = (html) => [...html.matchAll(/<(ul|ol) class="st-list">(.*?)<\/\1>/gs)].map((m) => items(m[2]));
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/\*\*/g, '');
const cellBody = (body) => render(body).match(/<h3>Card<\/h3>(.*?)<span class="st-cell-cta"/s)?.[1];
const shapes = [['', ''], ['cards=image', '![Sample](/sample.png)\n\n']];

test('a multi-block card splits its br-separated list into one item per bullet', () => {
  for (const [params, image] of shapes) {
    const html = renderCards(params, '<br>', image);
    const perCard = lists(html);
    assert.equal(perCard.length, 3, params + ': one list per card');
    for (const lis of perCard) {
      assert.equal(lis.length, 2, params + ': exactly two items');
      assert.deepEqual(lis.map(text), ['Label A\u3000first content', 'Label B\u3000second content']);
      for (const li of lis) {
        assert.ok(!/^\s*[-*+]\s/.test(text(li)), params + ': no item begins with a literal marker');
        assert.ok(!/br/i.test(li), params + ': no break is left inside an item');
      }
    }
    assert.equal((html.match(/<p>One line subtitle<\/p>/g) || []).length, 3, 'the subtitle is still a paragraph');
    assert.equal((html.match(/<p>A paragraph of description\.<\/p>/g) || []).length, 3, 'the paragraph is still a paragraph');
    assert.ok(!/&lt;br|<br>\s*-\s/i.test(html), params + ': no leftover break-plus-marker anywhere');
  }
});

test('a multi-block card renders the same whether its list uses br or newlines', () => {
  for (const [params, image] of shapes) {
    assert.equal(renderCards(params, '<br>', image), renderCards(params, '\n', image));
    assert.equal(renderCards(params, '<BR />', image), renderCards(params, '\n', image));
  }
});

test('a single-line body still splits (control for the multi-block case)', () => {
  for (const [params, image] of shapes) {
    const html = render(image + '- **Label A**\u3000first<br>- **Label B**\u3000second', params);
    assert.deepEqual(lists(html).map((l) => l.map(text)), [['Label A\u3000first', 'Label B\u3000second']]);
    assert.equal(html, render(image + '- **Label A**\u3000first\n- **Label B**\u3000second', params));
  }
});

test('item-level splits equal the newline-written list, block for block', () => {
  const pairs = [
    ['- a<br>- b\n- c', '- a\n- b\n- c'],                                  // a split item next to a plain one
    ['- a\n- b<br>- c<br>- d', '- a\n- b\n- c\n- d'],
    ['- a<br>* b<br/>+ c', '- a\n* b\n+ c'],
    ['- a <br> - b', '- a \n- b'],                                           // spaces around the break
    ['Intro.\n\n- a<br>- b\n\nOutro with `code` in it.', 'Intro.\n\n- a\n- b\n\nOutro with `code` in it.'],
    ['- a<br>- b\n\nBetween.\n\n- c<br>- d', '- a\n- b\n\nBetween.\n\n- c\n- d'],   // two lists in one cell
    ['- a\n  - b<br>- c\n- d', '- a\n  - b\n  - c\n- d'],                // nested: siblings at the item's depth
    ['- a<br>- b\n  - c', '- a\n- b\n  - c'],                              // children attach to the last sibling
    ['1. a<br>2. b<br>3. c', '1. a\n2. b\n3. c'],                           // ordered
    ['1) a<br>2) b', '1) a\n2) b'],
    ['- a<br>continued<br>- b', '- a<br>continued\n- b'],                    // a marker-less segment stays in its item
    ['- `x<br>- y` z<br>- b', '- `x<br>- y` z\n- b'],                        // split outside the code span only
    ['- a <!-- n<br>- hidden --> tail<br>- b', '- a <!-- n<br>- hidden --> tail\n- b'],
    ['- a<br>- b<br>* * *', '- a\n- b<br>* * *'],                            // a trailing rule segment stays literal
    ['- a<br>- b<br>- ', '- a\n- b<br>- '],                                  // so does a trailing empty item
    ['```text\n- a<br>- b\n```\n\n- c<br>- d', '```text\n- a<br>- b\n```\n\n- c\n- d'],
  ];
  for (const [br, nl] of pairs) {
    assert.equal(gridCellBodyHtml(br), bodyHtml(nl), JSON.stringify(br));
    assert.equal(cellBody(br), bodyHtml(nl), JSON.stringify(br) + ' (through the grid)');
    assert.notEqual(bodyHtml(br), bodyHtml(nl), JSON.stringify(br) + ' must be a body the base parser does NOT split');
  }
});

test('split counts: every list in the cell gets its own items, nothing merges or leaks', () => {
  assert.deepEqual(lists(cellBody('- a<br>- b\n\nBetween.\n\n- c<br>- d<br>- e')), [['a', 'b'], ['c', 'd', 'e']]);
  assert.deepEqual(lists(cellBody('1. a<br>2. b'))[0], ['a', 'b']);
  assert.match(cellBody('1. a<br>2. b'), /^<ol class="st-list">/);
  assert.deepEqual(items(cellBody('- use `a<br>- b` here')).length, 1);
  assert.match(cellBody('- a\n  - b<br>- c'), /<li>a<ul class="st-list"><li>b<\/li><li>c<\/li><\/ul><\/li>/);
});

test('outside a grid cell the block parser is untouched', () => {
  assert.equal(bodyHtml('- a<br>- b'), '<ul class="st-list"><li>a<br>- b</li></ul>');
  const prose = renderSiteToHtml(parseSite('## Notes\n\nIntro.\n\n- a<br>- b\n'));
  assert.deepEqual(lists(prose).map((l) => l.length), [1]);
});
