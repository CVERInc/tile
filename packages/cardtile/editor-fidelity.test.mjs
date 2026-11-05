import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderCardHTML } from './serve/card-worker.mjs';
import { EDIT_ONLY_CSS } from './card-render.mjs';
import { stripEditorHTML } from './verify/editor-fidelity.js';
import { withDeck } from './w3/deck-page.mjs';

for (const specimen of ['specimen-plain', 'specimen-assets', 'specimen-rich']) {
  const md = readFileSync(new URL(`./cards/specimens/${specimen}.card.md`, import.meta.url), 'utf8');
  const opts = { handle: 'x', cardUrl: 'https://card.example/x' };
  // the served page is the flat page plus the deck layer (w3/deck-page.mjs); the editor's canvas is
  // the flat page plus its own additions. So the canvas strips to the FLAT page, and the flat page
  // plus the deck is, byte for byte, what is served — nothing else differs.
  const served = renderCardHTML(md, { ...opts, deck: false });
  const live = renderCardHTML(md, opts);
  const lang = /^lang:\s*(.+)$/m.exec(md)?.[1]?.trim() || '';
  test(`${specimen}: the served page is the flat page plus the deck, and nothing else`, () => {
    assert.ok(live === withDeck(served, md, { handle: opts.handle, lang }), `${specimen}: the live page differs from flat + deck`);
  });
  const canvas = renderCardHTML(md, { ...opts, editIndex: true })
    .replace('</body>', '<script src="/Sortable.min.js"></script></body>');
  test(`${specimen}: editor additions strip to the served document`, () => {
    assert.ok(stripEditorHTML(canvas) === served,
      `${specimen}: the editor is showing a document the Worker would not serve`);
  });
  test(`${specimen}: content and served CSS changes remain visible`, () => {
    const normalized = stripEditorHTML(canvas);
    assert.notEqual(stripEditorHTML(canvas.replace('</main>', 'CONTROL</main>')), normalized);
    assert.notEqual(stripEditorHTML(canvas.replace('<style>', '<style>/* CONTROL */')), normalized);
  });
}

test('only the exact edit-only stylesheet is excluded', () => {
  const injected = `<style>${EDIT_ONLY_CSS}</style>`;
  const served = '<style>.st-cell-unset { color: red; }</style>';
  const changed = `<style>${EDIT_ONLY_CSS}\n.st-cell-unset { color: red; }</style>`;
  assert.equal(stripEditorHTML(`${served}${injected}${changed}${injected}`),
    `${served}${changed}`, 'styles sharing the placeholder selector must remain comparable');
});
