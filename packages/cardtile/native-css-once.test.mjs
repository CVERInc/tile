// The renderer's own stylesheet (NATIVE_CSS) reaches a page once, however many backs it has (tile#359).
// run: node --test native-css-once.test.mjs
//
// renderDrawers draws each back through renderGrid, and renderGrid used to open EVERY grid it drew
// with `<style>${NATIVE_CSS}</style>`. A page with B backs carried the same 10,852 bytes B + 1 times:
// 89% of a 1,000-tile page, 28% of a 25 MiB one. Every back is in the same document as the front,
// in the light DOM (the deck moves a back's body onto a deck card and slots it, it never puts it in a
// shadow tree), so the front's copy already styles every back; the later copies only re-declared it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCardHTML } from './serve/card-worker.mjs';
import { renderPage, renderDrawers, NATIVE_CSS } from './card-render.mjs';
import { parseCard } from './card-core.js';

// a Cards file with `backs` backs, each opened from a front tile and holding a few tiles of its own
const withBacks = (backs) => {
  const lines = ['---', 'card-page: someone', 'title: Someone', '---', '## cards',
    '- [ ] %% card: profile w=6 %% Someone'];
  for (let i = 0; i < backs; i++) lines.push(`- [ ] %% card: link w=${i % 2 ? 6 : 3} %% [Tile ${i}](#b${i})`);
  for (let i = 0; i < backs; i++) {
    lines.push(`## back: b${i} | Back ${i}`,
      `- [ ] %% card: text %% Body ${i}`,
      `- [ ] %% card: link w=6 %% [Out ${i}](https://example.com/${i})`);
  }
  return lines.join('\n') + '\n';
};
const count = (html, s) => html.split(s).length - 1;
const STYLE = `<style>${NATIVE_CSS}</style>`;

test('the stylesheet is the size the issue measured, so the counts below are about the right string', () => {
  assert.equal(Buffer.byteLength(NATIVE_CSS), 10852);
});

for (const backs of [0, 1, 3, 25]) {
  for (const [variant, ctx] of Object.entries({
    page: { handle: 'someone' },
    'flat page': { handle: 'someone', deck: false },
    'editor page': { handle: 'someone', editIndex: true },
    'pool page': { handle: 'someone', pool: true },
  })) {
    test(`${variant} with ${backs} backs carries the stylesheet exactly once`, () => {
      const html = renderCardHTML(withBacks(backs), ctx);
      assert.equal(count(html, 'class="dc-drawer"'), backs, 'every back is still drawn');
      assert.equal(count(html, NATIVE_CSS), 1);
      assert.equal(count(html, STYLE), 1);
    });
  }
}

test('the one copy is the front grid\'s, ahead of every back, and every back keeps its .st-card scope', () => {
  const html = renderPage(parseCard(withBacks(3)), { name: 'Someone' });
  const at = html.indexOf(STYLE);
  // where it always was: the first child of the front's .st-card
  assert.ok(/<div class="st-card[^"]*">$/.test(html.slice(0, at)), 'the copy opens the front .st-card');
  assert.ok(at < html.indexOf('class="dc-drawer"'), 'the copy comes before the first back');
  // each back's grid is still wrapped in .st-card, which is what every `.st-card …` rule in the
  // stylesheet keys on; only the <style> that used to open it is gone
  const bodies = html.match(/<div class="dc-drawer-body">(?:<h2[^>]*>[^<]*<\/h2>)?<div class="st-card[^"]*">/g) || [];
  assert.equal(bodies.length, 3);
});

test('a page whose backs are the only thing on it still carries the stylesheet', () => {
  // no front tiles at all: the front grid is empty, but it is still drawn, and it still holds the copy
  const md = ['---', 'card-page: someone', '---', '## cards', '## back: b0 | Back',
    '- [ ] %% card: link w=6 %% [Out](https://example.com/)'].join('\n') + '\n';
  const html = renderCardHTML(md, { handle: 'someone' });
  assert.equal(count(html, 'class="dc-drawer"'), 1);
  assert.equal(count(html, STYLE), 1);
});

test('200 backs: the page no longer grows by the stylesheet per back', () => {
  const html = renderCardHTML(withBacks(200), { handle: 'someone' });
  assert.equal(count(html, NATIVE_CSS), 1);
  // the copies alone used to be 201 × 10,852 bytes; the whole page is now well under that
  assert.ok(Buffer.byteLength(html) < 201 * Buffer.byteLength(NATIVE_CSS) / 2, `${Buffer.byteLength(html)} bytes`);
});

// renderDrawers is exported, and a caller may insert the backs without the front grid. That fragment
// has no other copy to lean on, so it carries exactly one of its own (tile#360 review).
for (const backs of [1, 3]) {
  test(`renderDrawers on its own with ${backs} backs carries the stylesheet exactly once, ahead of the backs`, () => {
    const html = renderDrawers(parseCard(withBacks(backs)), { handle: 'someone' });
    assert.equal(count(html, 'class="dc-drawer"'), backs, 'every back is drawn');
    assert.equal(count(html, NATIVE_CSS), 1);
    assert.equal(count(html, STYLE), 1);
    assert.ok(html.startsWith(STYLE), 'the copy opens the fragment');
  });
}

test('renderDrawers with no backs is still empty: nothing to style, nothing emitted', () => {
  assert.equal(renderDrawers(parseCard(withBacks(0)), {}), '');
});

test('renderDrawers with ctx.styled leaves the stylesheet to the caller', () => {
  const html = renderDrawers(parseCard(withBacks(3)), { styled: true });
  assert.equal(count(html, 'class="dc-drawer"'), 3);
  assert.equal(count(html, NATIVE_CSS), 0);
});

for (const backs of [0, 1, 3, 200]) {
  test(`renderPage with ${backs} backs carries the stylesheet exactly once`, () => {
    const html = renderPage(parseCard(withBacks(backs)), { name: 'Someone' });
    assert.equal(count(html, 'class="dc-drawer"'), backs);
    assert.equal(count(html, NATIVE_CSS), 1);
  });
}
