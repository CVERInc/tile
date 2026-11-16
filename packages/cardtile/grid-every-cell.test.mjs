// The rendered grid carries every cell of a large file (tile#362).
//
// packGrid used to stop searching past row 10,000 and leave the remaining cells out of its
// `placements`. renderGrid emits a cell for each placement, so on a file with more than 30,003
// width-2 cells the page simply ended early: no error, no log line, and the editor showed the same
// short grid. This drives the renderer, not packGrid, so it fails wherever a cell goes missing on
// the way to the page.
//   run: node packages/cardtile/grid-every-cell.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard } from './card-core.js';
import { renderGrid } from './card-render.mjs';

// `link`, not `text`: renderGrid lays text (and `bleed`) out as full-width rows outside the pack,
// so a page of text cells never reaches packGrid and could not show the bug.
const cardWith = (n, w) => '---\ncard-page: x\n---\n\n## grid\n\n' +
  Array.from({ length: n }, (_, i) => `- [ ] %% card: link w=${w} %% [t${i}](https://example.com/${i})`).join('\n') + '\n';

test('renderGrid emits all 40,000 width-2 cells, in file order (it stopped at 30,003)', () => {
  const n = 40000;
  const model = parseCard(cardWith(n, 2));
  assert.equal(model.cells.length, n, 'the file parses to 40,000 cells');
  const html = renderGrid(model, { editIndex: true });
  const indices = [...html.matchAll(/ data-cell="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(indices.length, n, `${indices.length} of ${n} cells rendered`);
  assert.ok(indices.every((v, i) => v === i), 'each cell once, in file order');
  assert.ok(html.includes('t39999'), 'the last cell’s text is on the page');
});
