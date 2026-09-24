// The tap-on-the-card → sheet mapping (w2/board-bridge.mjs `slotOfRenderedCell`), measured against
// what the RENDERER actually writes — not against a hand-built list of numbers. The renderer's
// `data-cell` means "index into model.cells" on the face and "index into that drawer's cells" inside
// a drawer panel; the board's slot list is one flat reading-order array. This file is the proof the
// two agree for every rendered cell, sections and drawers included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard } from '../card-core.js';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { boardSlots, slotOfRenderedCell, laneKeyForCardAdd } from '../w2/board-bridge.mjs';
import { buildSandboxCard } from './sandbox-i18n.mjs';

const MD = [
  '---', 'card-page: t', 'title: T', '---', '',
  '## cards', '',
  '- [ ] %% card: profile w=6 %% hello',
  '- [ ] %% card: link w=3 %% [one](https://example.com/1)',
  '- [ ] %% card: link w=3 %% [more](#more)',
  '',
  '## Second section', '',
  '- [ ] %% card: text w=6 %% prose here',
  '- [ ] %% card: link w=3 %% [two](https://example.com/2)',
  '',
  '## drawer: more', '',
  '- [ ] %% card: link w=3 %% [inside-a](https://example.com/a)',
  '- [ ] %% card: link w=3 %% [inside-b](https://example.com/b)',
  '',
].join('\n');

/** [{drawer, index}] for every data-cell the renderer emits, in document order */
function rendered(md) {
  const html = renderCardHTML(md, { handle: 't', cardUrl: '', editIndex: true });
  const out = [];
  const panelAt = [...html.matchAll(/data-drawer-panel="([^"]+)"/g)].map((m) => ({ at: m.index, id: m[1] }));
  for (const m of html.matchAll(/data-cell="(\d+)"/g)) {
    const panel = panelAt.filter((p) => p.at < m.index).pop();
    out.push({ drawer: panel ? panel.id : null, index: Number(m[1]) });
  }
  return out;
}

test('every rendered cell resolves to the slot holding THAT cell (face, second section, drawer)', () => {
  const model = parseCard(MD);
  assert.ok(model.blocks.length >= 2, 'fixture must have two face sections');
  assert.equal(model.drawers.length, 1, 'fixture must have a drawer');
  const slots = boardSlots(model);
  const marks = rendered(MD);
  assert.equal(marks.length, slots.length, 'every cell should render a data-cell in this fixture');
  const hit = new Set();
  for (const { drawer, index } of marks) {
    const s = slotOfRenderedCell(model, drawer, index);
    assert.ok(s >= 0, `unmapped: ${drawer || 'face'}#${index}`);
    const want = drawer ? model.drawers.find((d) => d.id === drawer).cells[index] : model.cells[index];
    assert.equal(slots[s].cell, want, `${drawer || 'face'}#${index} opened the wrong cell`);
    hit.add(s);
  }
  assert.equal(hit.size, slots.length, 'two rendered cells mapped onto one slot');
});

test('CONTROL: drawer-local indices are NOT face indices (the naive mapping would be wrong)', () => {
  const model = parseCard(MD);
  const inDrawer = slotOfRenderedCell(model, 'more', 0);
  const onFace = slotOfRenderedCell(model, null, 0);
  assert.notEqual(inDrawer, onFace);
  assert.equal(boardSlots(model)[onFace].cell.type, 'profile');
});

test('stale or junk indices return -1, never a guess', () => {
  const model = parseCard(MD);
  assert.equal(slotOfRenderedCell(model, null, 99), -1);
  assert.equal(slotOfRenderedCell(model, 'nope', 0), -1);
  assert.equal(slotOfRenderedCell(model, null, 'x'), -1);
  assert.equal(slotOfRenderedCell(model, null, -1), -1);
});

test('a cell that renders to nothing in production still gets data-cell in the editor (empty link)', () => {
  const md = buildSandboxCard('en').replace('(https://example.com)', '()');
  const model = parseCard(md);
  assert.equal(model.cells.length, 2);
  const marks = rendered(md);
  assert.deepEqual(marks.map((m) => m.index), [0, 1], 'the empty link must stay tappable while editing');
});

test('the seed maps both of its cells', () => {
  const md = buildSandboxCard('zh');
  const model = parseCard(md);
  assert.deepEqual(rendered(md).map(({ drawer, index }) => slotOfRenderedCell(model, drawer, index)), [0, 1]);
});

test('laneKeyForCardAdd: face → the LAST face section; drawer → that drawer', () => {
  const model = parseCard(MD);
  assert.equal(laneKeyForCardAdd(model, null), `face:${model.blocks.length - 1}`);
  assert.equal(laneKeyForCardAdd(model, 'more'), 'drawer:more');
  assert.equal(laneKeyForCardAdd({ cells: [] }, null), 'face:0');
});

// ── on-card drag → the board permutation (cardDropOrder), applied through applyBoardOrder ─────────
import { applyBoardOrder, identityOrder, cardDropOrder } from '../w2/board-bridge.mjs';
import { serializeCard } from '../card-core.js';

const labels = (m) => m.cells.map((c) => c.type + ':' + (c.body || '').slice(0, 12));

test('cardDropOrder: identity read → the card serialises byte-for-byte (CONTROL)', () => {
  const model = parseCard(MD);
  const face0 = identityOrder(model).find((e) => e.key === 'face:0').slots;
  const order = cardDropOrder(model, 'face:0', face0);
  assert.equal(serializeCard(applyBoardOrder(model, order)), serializeCard(model));
});

test('cardDropOrder: swapping two face tiles moves exactly those two, in the file', () => {
  const model = parseCard(MD);
  const before = labels(model);
  const order = cardDropOrder(model, 'face:0', [0, 2, 1]);
  const after = labels(parseCard(serializeCard(applyBoardOrder(model, order))));
  assert.deepEqual(after, [before[0], before[2], before[1], ...before.slice(3)]);
});

test('cardDropOrder: a drawer lane reorders its own cells and nothing else', () => {
  const model = parseCard(MD);
  const slots = identityOrder(model).find((e) => e.key === 'drawer:more').slots;
  const order = cardDropOrder(model, 'drawer:more', [...slots].reverse());
  const next = parseCard(serializeCard(applyBoardOrder(model, order)));
  assert.deepEqual(next.drawers[0].cells.map((c) => c.body), model.drawers[0].cells.map((c) => c.body).reverse());
  assert.deepEqual(labels(next), labels(model));
});

test('🔴 cardDropOrder: a cell with no element keeps its place; it is not deleted', () => {
  const model = parseCard(MD);
  // pretend slot 1 rendered to nothing: the DOM only reports 0 and 2, now swapped
  const order = cardDropOrder(model, 'face:0', [2, 0]);
  const next = parseCard(serializeCard(applyBoardOrder(model, order)));
  assert.equal(next.cells.length, model.cells.length, 'a cell went missing');
  const b = labels(model);
  assert.deepEqual(labels(next).slice(0, 3), [b[2], b[1], b[0]]);
});

test('cardDropOrder: a read that is not a permutation of the lane is refused (null)', () => {
  const model = parseCard(MD);
  assert.equal(cardDropOrder(model, 'face:0', [0, 0, 1]), null, 'duplicate');
  assert.equal(cardDropOrder(model, 'face:0', [0, 1, 3]), null, 'a slot from another lane');
  assert.equal(cardDropOrder(model, 'face:9', [0]), null, 'unknown lane');
});

// ── the view switch's words exist in all nine locales ─────────────────────────────────────────────
import { BOARD_STRINGS_BY_KEY } from '../w2/board-i18n.mjs';
import { LOCALE_KEYS } from './sandbox-i18n.mjs';

test('board.viewBoard and board.viewMd: present and non-blank in all nine locales', () => {
  for (const key of ['board.viewBoard', 'board.viewMd']) {
    for (const loc of LOCALE_KEYS) {
      const v = BOARD_STRINGS_BY_KEY[key] && BOARD_STRINGS_BY_KEY[key][loc];
      assert.ok(typeof v === 'string' && v.trim(), `${key}.${loc} missing`);
    }
  }
  assert.equal(BOARD_STRINGS_BY_KEY['board.viewBoard'].zh, '牌桌');
});
