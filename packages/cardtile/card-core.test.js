// cardtile model tests — plain Node. Flat cell list ↔ markdown (board-core + sitetile markers),
// 2D first-fit pack honouring w×h (incl. true row-span), idempotent round-trip, pure reorder.
//   run: node card-core.test.js

import assert from 'node:assert/strict';
import { parseCard, serializeCard, packGrid, reorder, setSpan, clampSpan } from './card-core.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const F = '```';
const MD = [
  '---', 'card-page: aster', 'title: Aster', '---', '',
  '## grid', '',
  "- [ ] %% card: text w=3 %% Hi, I'm **Aster** — webcomic artist.",
  '- [ ] %% card: image w=1 h=2 %% ![cover](/assets/cover.jpg)',
  '- [ ] %% card: button w=1 %% [Patreon](https://patreon.com/asterdraws)',
  '- [ ] %% card: link w=1 %% [Instagram](https://instagram.com/aster.draws)',
  '- [ ] %% card: events w=2 %%',
  '\t' + F,
  '\t{',
  '\t  "source": "discord:guild123",',
  '\t  "show_count": 3',
  '\t}',
  '\t' + F,
].join('\n') + '\n';

// ── parse / model ──────────────────────────────────────────────────────────────────────────────
test('flattens to an ordered cell list (types in document order)', () => {
  const m = parseCard(MD);
  assert.equal(m.cols, 6);
  assert.deepEqual(m.cells.map((c) => c.type), ['text', 'image', 'button', 'link', 'events']);
});

test('span params parsed (w / h)', () => {
  const m = parseCard(MD);
  assert.equal(m.cells[0].params.w, '3');
  assert.equal(m.cells[1].params.w, '1');
  assert.equal(m.cells[1].params.h, '2');
  assert.equal(m.cells[4].params.w, '2');
});

// A Card is six columns — the number, not a knob. `cols:` was a frontmatter field with a default of
// 3 that every real card overrode to 6, so it was a decision wearing a preference's clothes. It is
// now ignored wherever it appears, which is what makes a stray `cols: 2` unable to break a card.
test('a Card is six columns, and a leftover cols: in frontmatter cannot change that', () => {
  assert.equal(parseCard('---\ncard-page: x\n---\n\n## grid\n\n- [ ] %% card: text %% hi\n').cols, 6);
  assert.equal(parseCard('---\ncard-page: x\ncols: 2\n---\n\n## grid\n\n- [ ] %% card: text %% hi\n').cols, 6);
});

// ── fenced-JSON / body indentation rule ──────────────────────────────────────────────────────────
test('heavy widget fenced-JSON body preserved INCL. 2-space internal indent', () => {
  const ev = parseCard(MD).cells[4];
  assert.equal(ev.type, 'events');
  assert.ok(ev.body.startsWith('```') && ev.body.trimEnd().endsWith('```'), 'fenced');
  assert.ok(ev.body.includes('  "source": "discord:guild123"'), '2-space JSON indent survives');
});

test('a body line that LOOKS like a heading/card/fence stays inside the cell (never a new lane/card)', () => {
  const md = ['---', 'card-page: x', '---', '', '## grid', '',
    '- [ ] %% card: text %%', '\t## not a heading', '\t- [ ] not a new card', '\tplain', '',
    '- [ ] %% card: button w=1 %% [Go](/go)'].join('\n') + '\n';
  const m = parseCard(md);
  assert.equal(m.cells.length, 2, 'still 2 cells (the look-alike lines did NOT split anything)');
  assert.ok(m.cells[0].body.includes('## not a heading'), 'heading-like line kept verbatim');
  assert.ok(m.cells[0].body.includes('- [ ] not a new card'), 'card-like line kept verbatim');
});

// ── 2D pack (w col-span + h row-span真排) ────────────────────────────────────────────────────────
test('packGrid: w col-span + h row-span occupy real cells; later cells flow around (no overlap)', () => {
  // pack into 3 columns explicitly — packGrid takes the width as an argument, which is the level
  // where a width belongs now that a Card's own width is fixed.
  const { placements, rows, cols } = packGrid({ ...parseCard(MD), cols: 3 });
  assert.equal(cols, 3);
  const pos = Object.fromEntries(placements.map((p) => [p.type, p]));
  assert.deepEqual({ row: pos.text.row, col: pos.text.col, w: pos.text.w, h: pos.text.h }, { row: 0, col: 0, w: 3, h: 1 });
  assert.deepEqual({ row: pos.image.row, col: pos.image.col, w: pos.image.w, h: pos.image.h }, { row: 1, col: 0, w: 1, h: 2 });  // spans rows 1-2
  assert.deepEqual({ row: pos.button.row, col: pos.button.col }, { row: 1, col: 1 });
  assert.deepEqual({ row: pos.link.row, col: pos.link.col }, { row: 1, col: 2 });
  assert.deepEqual({ row: pos.events.row, col: pos.events.col, w: pos.events.w }, { row: 2, col: 1, w: 2 });  // flows around the row-spanning image
  assert.equal(rows, 3);
});

test('packGrid: no two cells overlap (防醜 — no collisions, no manual gaps)', () => {
  const { placements } = packGrid({ ...parseCard(MD), cols: 3 });
  const seen = new Set();
  for (const p of placements) {
    for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) {
      const key = (p.row + dr) + ',' + (p.col + dc);
      assert.ok(!seen.has(key), 'overlap at ' + key);
      seen.add(key);
    }
  }
});

test('packGrid: w wider than cols is clamped to cols', () => {
  const m = parseCard('---\ncard-page: x\n---\n\n## grid\n\n- [ ] %% card: text w=3 %% hi\n');
  assert.equal(packGrid({ ...m, cols: 2 }).placements[0].w, 2, 'w=3 clamped to cols=2');
});

// ── round-trip (idempotent) + reorder ────────────────────────────────────────────────────────────
test('serialize(parse) is a stable fixpoint (idempotent)', () => {
  const once = serializeCard(parseCard(MD));
  assert.equal(serializeCard(parseCard(once)), once);
});

test('round-trip preserves model (cells + 2D pack)', () => {
  const a = parseCard(MD);
  const b = parseCard(serializeCard(a));
  assert.deepEqual(b.cells, a.cells);
  assert.deepEqual(packGrid(b).placements.map((p) => [p.type, p.row, p.col, p.w, p.h]),
                   packGrid(a).placements.map((p) => [p.type, p.row, p.col, p.w, p.h]));
});

test('reorder (drag→drop) is a pure flat-list move; result re-serializes idempotently', () => {
  const m = parseCard(MD);
  const moved = reorder(m, 4, 0);                       // drag events to the front
  assert.deepEqual(moved.cells.map((c) => c.type), ['events', 'text', 'image', 'button', 'link']);
  assert.deepEqual(m.cells.map((c) => c.type), ['text', 'image', 'button', 'link', 'events'], 'original untouched (pure)');
  const out = serializeCard(moved);
  assert.equal(serializeCard(parseCard(out)), out, 'still idempotent after the move');
});

// ── setSpan (③ span-resize commit path) ─────────────────────────────────────────────────────────
test('setSpan: writes w/h into rawParams (and params); survives round-trip', () => {
  const m = parseCard(MD);
  m.cells[2] = setSpan(m.cells[2], 2, 1, m.cols);      // button 1×1 → 2×1
  assert.equal(m.cells[2].rawParams, 'w=2');
  assert.equal(m.cells[2].params.w, '2');
  const re = parseCard(serializeCard(m));
  assert.equal(re.cells[2].params.w, '2', 'w=2 round-trips through markdown');
});

// 🔴 REWRITTEN 2026-07-29. These two used to assert `setSpan(…, h) keeps h` — an assertion of the
// behaviour that was retired in 74f83d8, when `h` left the renderer and all three cards for one
// layout model where height comes from content. The old test would have defended the resurrection of
// a dead token by an editor's resize gesture. The stronger claim now lives in round-trip.test.mjs.
test('setSpan: sets w and never writes h, which the renderer no longer honours', () => {
  const cell = { type: 'events', rawParams: 'w=2 h=2', params: { w: '2', h: '2' }, body: '' };
  assert.equal(setSpan(cell, 3, 3, 6).rawParams, 'w=3 h=2',
    'a resize sets w and leaves an author’s existing h exactly where it was');
  const fresh = { type: 'events', rawParams: 'w=2', params: { w: '2' }, body: '' };
  assert.equal(setSpan(fresh, 3, 3, 6).rawParams, 'w=3', 'no h token is ever introduced');
  const withCta = { type: 'button', rawParams: 'cta="Go"→/x', params: {}, body: '' };
  assert.equal(setSpan(withCta, 2, 1, 3).rawParams, 'cta="Go"→/x w=2', 'other params preserved, w appended');
});

test('setSpan: clamps w to cols and to the 1..6 ceiling', () => {
  const cell = { type: 'text', rawParams: '', params: {}, body: '' };
  assert.equal(setSpan(cell, 9, 1, 2).rawParams, 'w=2', 'w clamped to cols=2');
  assert.equal(setSpan(cell, 9, 9, 5).rawParams, 'w=5', 'w clamped to maxW=5, and no h is written');
  assert.equal(setSpan(cell, 0, 0, 3).rawParams, 'w=1', 'floor at 1×1');
});

// ── clampSpan unit ───────────────────────────────────────────────────────────────────────────────
test('clampSpan: 1..3 ceiling, missing → 1', () => {
  assert.equal(clampSpan('2', 3), 2);
  assert.equal(clampSpan('9', 3), 3);
  assert.equal(clampSpan(undefined, 3), 1);
  assert.equal(clampSpan('0', 3), 1);
});


// ── drawer lanes (depth without pages) ───────────────────────────────────────────────────────────
const DRAWER_MD = [
  '---', 'card-page: x', 'cols: 6', '---', '',
  '## grid', '',
  '- [ ] %% card: link w=2 h=2 %% [About](#about)',
  '',
  '## drawer: about', '',
  '- [ ] %% card: section %% 關於',
  '- [ ] %% card: text w=6 h=2 %% hello',
].join('\n') + '\n';

test('drawer lanes are kept SEPARATE from the card face (not flattened into the grid)', () => {
  const m = parseCard(DRAWER_MD);
  assert.equal(m.cells.length, 1, 'the face holds only its own cells');
  assert.equal(m.drawers.length, 1);
  assert.equal(m.drawers[0].id, 'about');
  assert.equal(m.drawers[0].cells.length, 2);
});

test('drawer id is slugified from the lane title (`## drawer: My Page` → my-page)', () => {
  const m = parseCard('---\ncard-page: x\n---\n\n## grid\n\n- [ ] %% card: text %% hi\n\n## drawer: My Page\n\n- [ ] %% card: text %% x\n');
  assert.equal(m.drawers[0].id, 'my-page');
});

test('a card with drawers round-trips idempotently (face lane + one lane per drawer)', () => {
  const once = serializeCard(parseCard(DRAWER_MD));
  assert.equal(serializeCard(parseCard(once)), once);
  assert.match(once, /^## drawer: about$/m);
  const back = parseCard(once);
  assert.equal(back.drawers.length, 1);
  assert.deepEqual(back.cells.map((c) => c.type), ['link']);
});

test('a card with no drawer lane still parses (drawers is an empty list, not undefined)', () => {
  assert.deepEqual(parseCard(MD).drawers, []);
});

// ── bento blocks come from LANES, not from a `section` cell ─────────────────────────────────────
// `- [ ] %% card: section %% English` was a heading dressed as a cell: it occupied w=6 h=1 of a grid
// it was not part of, and the renderer had to watch the cell stream for it. The lane machine was
// already doing exactly this job for drawers, so a titled lane is the section now.
const BLOCK_MD = [
  '---', 'card-page: x', '---', '',
  '## grid', '', '- [ ] %% card: text %% face', '',
  '## English', '', '- [ ] %% card: link %% [A](https://a.example)', '- [ ] %% card: link %% [B](https://b.example)', '',
  '## 日本語', '', '- [ ] %% card: link %% [C](https://c.example)',
].join('\n') + '\n';

test('a titled lane is a bento block; the first lane is the face and carries no label', () => {
  const m = parseCard(BLOCK_MD);
  assert.deepEqual(m.blocks.map((b) => b.label), ['', 'English', '日本語']);
  assert.deepEqual(m.blocks.map((b) => [b.start, b.count]), [[0, 1], [1, 2], [3, 1]]);
  assert.equal(m.cells.length, 4, 'cells stays one flat ordered stream');
});

test('blocks are RANGES into cells, so mutating a cell through model.cells survives serialize', () => {
  const m = parseCard(BLOCK_MD);
  m.cells[2] = setSpan(m.cells[2], 3, 1, m.cols);          // the second link inside `## English`
  const back = parseCard(serializeCard(m));
  assert.equal(back.cells[2].params.w, '3',
    'an earlier version gave each block its own cell array; the two aliased, and this write was lost');
});

test('blocks round-trip: a labelled lane comes back out as the same heading', () => {
  const once = serializeCard(parseCard(BLOCK_MD));
  assert.equal(serializeCard(parseCard(once)), once, 'idempotent');
  assert.match(once, /^## English$/m);
  assert.match(once, /^## 日本語$/m);
});

test('a drawer can carry a display title after `|`, and it is not part of the id', () => {
  const m = parseCard('---\ncard-page: x\n---\n\n## grid\n\n- [ ] %% card: text %% hi\n\n## drawer: stockists | 寄售店家資訊\n\n- [ ] %% card: text %% x\n');
  assert.equal(m.drawers[0].id, 'stockists', 'the id is what [x](#stockists) targets — unchanged by the title');
  assert.equal(m.drawers[0].title, '寄售店家資訊');
  const once = serializeCard(m);
  assert.match(once, /^## drawer: stockists \| 寄售店家資訊$/m);
  assert.equal(serializeCard(parseCard(once)), once, 'idempotent');
});

// CONTROL: the range/alias test above only means something if writing through model.cells CAN be
// lost. Prove the failure mode is real by rebuilding the shape it used to have.
test('CONTROL: two views over one cell list really do lose a write', () => {
  const shared = [{ type: 'text', rawParams: '', params: {}, body: 'a' }];
  const view = { cells: [...shared], blocks: [{ label: '', cells: shared }] };
  view.cells[0] = { ...view.cells[0], body: 'b' };
  assert.equal(view.blocks[0].cells[0].body, 'a', 'the block view still holds the stale cell');
});



// ── the assets lane: a Card carries its own pictures ────────────────────────────────────────────
const ASSET_MD = [
  '---', 'card-page: x', '---', '',
  '## grid', '',
  '- [ ] %% card: profile avatar=asset:sha256-abc %% hi', '',
  '## assets', '',
  '- [ ] %% card: asset id=sha256-abc mime=image/webp %% UklGRg==',
].join('\n') + '\n';

test('🔴 assets are hoisted OUT of cells and blocks — a reader never holds the blobs', () => {
  const m = parseCard(ASSET_MD);
  assert.deepEqual(m.cells.map((c) => c.type), ['profile'], 'the asset is not a cell');
  assert.deepEqual(m.blocks.map((b) => b.count), [1], 'and not part of any block');
  assert.deepEqual(m.assets, { 'sha256-abc': { mime: 'image/webp', b64: 'UklGRg==' } });
});

test('a card with pictures round-trips, and the assets lane comes last', () => {
  const once = serializeCard(parseCard(ASSET_MD));
  assert.equal(serializeCard(parseCard(once)), once, 'idempotent');
  assert.match(once, /^## assets$/m);
  assert.ok(once.indexOf('## assets') > once.indexOf('## grid'),
    'the bytes go after the card, so a human opening the file reads the card first');
  assert.deepEqual(parseCard(once).assets, parseCard(ASSET_MD).assets);
});

test('a card with no pictures has an empty assets map and emits no lane', () => {
  const m = parseCard(MD);
  assert.deepEqual(m.assets, {});
  assert.ok(!serializeCard(m).includes('## assets'), 'zero cost when unused');
});


console.log('\ncardtile: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
