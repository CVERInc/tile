// The editor's preview frame is handed a document only when the document changed; another view of
// the same document is a switch in place (tile#297). The decision is w3/preview-switch.mjs; the
// second half of this file drives it against the REAL page and the REAL deck in the stand-in DOM,
// as the editor does: render once, then ask the frame's own window.__deckView.
//
//   node --test packages/cardtile/w3/preview-switch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewStep } from './preview-switch.mjs';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { makeWindow } from './mini-dom.mjs';

const never = () => { throw new Error('the frame was asked'); };

test('nothing shown yet, or another document: the frame is handed the document and is not asked', () => {
  assert.equal(previewStep(null, { doc: 'a', view: 'stack' }, never), 'render');
  assert.equal(previewStep({ doc: 'a', view: 'stack' }, { doc: 'b', view: 'stack' }, never), 'render');
  assert.equal(previewStep({ doc: 'a', view: 'stack' }, { doc: 'b', view: 'list' }, never), 'render');
});

test('the same document in the same view: the frame is left alone', () => {
  assert.equal(previewStep({ doc: 'a', view: 'list' }, { doc: 'a', view: 'list' }, never), 'keep');
});

test('the same document in another view: the frame is asked, by the view\'s name, and switches in place', () => {
  const asked = [];
  assert.equal(previewStep({ doc: 'a', view: 'stack' }, { doc: 'a', view: 'list' }, (v) => { asked.push(v); return true; }), 'switch');
  assert.deepEqual(asked, ['list']);
});

test('a frame that cannot answer is handed the document', () => {
  const from = { doc: 'a', view: 'stack' }, to = { doc: 'a', view: 'list' };
  assert.equal(previewStep(from, to, () => { throw new TypeError('__deckView is not a function'); }), 'render', 'a frame still loading');
  assert.equal(previewStep(from, to, () => false), 'render', 'a deck that does not offer the view');
  assert.equal(previewStep(from, to, () => undefined), 'render', 'a page with no deck');
  assert.equal(previewStep(from, to, () => 1), 'render', 'only true is yes');
});

// ── against the real page ────────────────────────────────────────────────────────────────────────
const DECK_JS = readFileSync(new URL('./deck.js', import.meta.url), 'utf8');
const md = ['---', 'card-page: specimen', 'title: Specimen', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% A bio.', '- [ ] %% card: link w=3 %% [One](https://example.com/1)',
  '- [ ] %% card: text w=6 %% Some words.', ''].join('\n');

test('the editor\'s preview: stack → list → stack on one document is one page, never rendered twice', () => {
  let renders = 0, win = null, shown = null;
  // what w3/edit3.mjs show() does with its frame
  const show = (view) => {
    const next = { doc: md, view };
    if (previewStep(shown, next, (v) => win.__deckView(v)) === 'render') {
      renders++;
      win = makeWindow(renderCardHTML(md, { handle: 'specimen', deck: { view, pool: true } }), { scripts: true, storage: { 'reef-card-layout': 'spread' } });
      win.document.scrollHeightOf = () => 844 * 6;
      win.run(DECK_JS, 'deck.js'); win.tick(3000);
    }
    shown = next;
  };
  show('stack');
  const first = win, cells = win.document.querySelectorAll('.deck-front > .st-cell');
  assert.equal(cells.length, 3, 'CONTROL: the preview dealt the card\'s tiles');
  for (const v of ['list', 'stack', 'list', 'list', 'stack']) {
    show(v);
    assert.equal(win.document.documentElement.dataset.view, v, `the preview does not show ${v}`);
  }
  assert.equal(renders, 1, 'a view change handed the frame the document again');
  assert.ok(win === first, 'the frame\'s page was replaced');
  const now = win.document.querySelectorAll('.deck-front > .st-cell');
  assert.ok(now.length === cells.length && now.every((c, i) => c === cells[i]), 'the tiles are other nodes than before the switches');
  assert.equal(win.nav.reloads, 0);
  assert.equal(win.localStorage.getItem('reef-card-layout'), 'spread', 'the editor\'s view was written over the visitor\'s pick');
  assert.equal(win.document.querySelector('#deck-view')?.textContent.includes('.deck-seg{display:none'), true, 'the page\'s own switcher shows inside the editor');
});
