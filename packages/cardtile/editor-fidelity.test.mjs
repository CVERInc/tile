import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderCardHTML } from './serve/card-worker.mjs';
import { stripEditorHTML } from './verify/editor-fidelity.js';

for (const specimen of ['specimen-plain', 'specimen-assets', 'specimen-rich']) {
  const md = readFileSync(new URL(`./cards/specimens/${specimen}.card.md`, import.meta.url), 'utf8');
  const opts = { handle: 'x', cardUrl: 'https://card.example/x' };
  const served = renderCardHTML(md, opts);
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
