// A tile that writes `back=#id` turns over to that back in every view (tile#351). `profile` and `text`
// get a door on the wall, `link` and `feature` aim their own link at the back. A video, slides, pasted
// HTML and a social row keep the wall they had — no door, nothing new to press — and name their back on
// the cell with `data-back`, which is what the deck reads to seat that back in stack and list.
//
//   node --test packages/cardtile/back-marker.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGrid, renderPage } from './card-render.mjs';
import { parseCard } from './card-core.js';

const TILES = {
  embed: (back) => `- [ ] %% card: embed${back} %% <p>hi</p>`,
  video: (back) => `- [ ] %% card: video yt=dQw4w9WgXcQ${back} %%`,
  slides: (back) => `- [ ] %% card: slides${back} %% ![a](https://example.com/a.jpg) ![b](https://example.com/b.jpg)`,
  social: (back) => `- [ ] %% card: social${back} %% [IG](https://instagram.com/x)`,
};
const card = (lines) => ['---', 'card-page: specimen', 'title: Specimen', '---', '', '## cards', '', ...lines,
  '', '## back: about | About', '', '- [ ] %% card: text %% The back.', ''].join('\n');
/** the opening tag of the one engine cell of `type` */
const cellTag = (html, type) => {
  const all = html.match(new RegExp(`<div class="st-cell[^>]*data-coral-type="${type}"[^>]*>`, 'g')) || [];
  assert.equal(all.length, 1, `CONTROL: one ${type} cell in the markup`);
  return all[0];
};
const count = (s, re) => (s.match(re) || []).length;

for (const [type, line] of Object.entries(TILES)) {
  test(`${type}: back=#about names the back on the cell, and adds no door and nothing to press`, () => {
    const plain = renderGrid(parseCard(card([line('')])));
    const html = renderGrid(parseCard(card([line(' back=#about')])));
    assert.match(cellTag(html, type), / data-back="about"/, 'the cell does not name its back');
    assert.equal(count(html, /data-back="/g), 1, 'the marker is on the cell and nowhere else');
    assert.equal(count(html, /<a class="st-back-door"/g), 0, 'a door was added');
    assert.equal(count(html, /data-drawer=/g), 0, 'something in the tile opens the back on the wall');
    // the marker is the only difference: same elements, same attributes, same frame
    assert.equal(html.replace(' data-back="about"', ''), plain, 'the tile differs from one without back= by more than the marker');
  });
  test(`${type}: a back= that names no lane, or is not a #id, leaves no marker`, () => {
    const plain = renderGrid(parseCard(card([line('')])));
    for (const back of [' back=#nowhere', ' back=about', ' back=#']) {
      assert.equal(renderGrid(parseCard(card([line(back)]))), plain, `${back.trim()} changed the markup`);
    }
  });
}

test('inside a back, back= leaves no marker (a back does not turn over to a back)', () => {
  const md = ['---', 'card-page: specimen', 'title: Specimen', '---', '', '## cards', '', '- [ ] %% card: text %% Front.',
    '', '## back: about | About', '', TILES.embed(' back=#about'), ''].join('\n');
  assert.equal(count(renderPage(parseCard(md), { handle: 'specimen' }), /data-back="/g), 0);
});

test('a Cards page that writes no back= on these tiles carries no marker', () => {
  const page = renderPage(parseCard(card(Object.values(TILES).map((line) => line('')))), { handle: 'specimen' });
  assert.equal(count(page, /data-back="/g), 0);
  assert.ok(Object.keys(TILES).every((type) => cellTag(page, type)), 'CONTROL: all four tiles are on the page');
});

test('the pasted-HTML frame is the one it was: sandbox="allow-scripts" and the same attributes, with or without back=', () => {
  const frame = (md) => { const all = renderGrid(parseCard(md)).match(/<iframe[^>]*>/g) || []; assert.equal(all.length, 1, 'CONTROL: one frame'); return all[0]; };
  const plain = frame(card([TILES.embed('')])), named = frame(card([TILES.embed(' back=#about')]));
  assert.equal(named, plain);
  assert.match(named, /^<iframe sandbox="allow-scripts" srcdoc="/);
  assert.equal(count(named, /sandbox=/g), 1);
});

test('the tiles that open a back on the wall are as they were: a text tile keeps its door and gets no marker', () => {
  const html = renderGrid(parseCard(card(['- [ ] %% card: text back=#about %% Turn me over.'])));
  assert.equal(count(html, /<a class="st-back-door"/g), 1);
  assert.equal(count(html, /data-back="/g), 0);
});
