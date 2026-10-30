// The split-flap card's face order, sampled MID-FLIP — the moment a wrong order shows.
//   run: node --test packages/dynamic-corals/shared/flip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlip, setFlip, parseFaces, FLIP_MS, FLIP_CSS } from './flip.mjs';
import { createDocument, createClock } from './fake-dom.mjs';

function setup(reduced = false) {
  const doc = createDocument();
  const clock = createClock(0);
  const env = { document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, reduced };
  const cell = createFlip(doc);
  doc.body.appendChild(cell);
  return { doc, clock, env, cell };
}

/** top base / bottom base / front flap / back flap, '-' for an absent flap — one character per face. */
function faces(cell) {
  const t = (sel) => { const el = cell.querySelector(sel); return el ? el.firstChild.textContent : '-'; };
  return t('.dc-flip-top') + t('.dc-flip-bottom') + t('.dc-flip-front') + t('.dc-flip-back');
}

test('first value sets both halves at once, no flaps', () => {
  const { env, cell } = setup();
  setFlip(cell, '3', env);
  assert.equal(faces(cell), '33--');
  assert.equal(cell.classList.contains('dc-flip-on'), false);
});

test('mid-flip: top base = new, bottom base = old, front = old, back = new; then all new', () => {
  const { env, cell, clock } = setup();
  setFlip(cell, '3', env);
  setFlip(cell, '2', env);
  assert.equal(faces(cell), '2332', 'sampled right after the change');
  assert.equal(cell.classList.contains('dc-flip-on'), true);
  clock.advance(FLIP_MS - 1);
  assert.equal(faces(cell), '2332', 'still mid-flip one ms before settle');
  clock.advance(1);
  assert.equal(faces(cell), '22--', 'settled: both halves new, flaps gone');
  assert.equal(cell.classList.contains('dc-flip-on'), false);
});

test('CONTROL: the spoiled order (new on the bottom at 0 ms) is what this test rejects', () => {
  // The order the reference version shipped: top kept old, bottom took the new value at once.
  const spoiled = '3223';
  const { env, cell } = setup();
  setFlip(cell, '3', env);
  setFlip(cell, '2', env);
  assert.notEqual(faces(cell), spoiled);
});

test('a change mid-flip drops the running flaps and timer, and starts from what is shown', () => {
  const { env, cell, clock } = setup();
  setFlip(cell, '3', env);
  setFlip(cell, '2', env);
  clock.advance(100);
  setFlip(cell, '1', env);
  assert.equal(cell.querySelectorAll('.dc-flip-flap').length, 2, 'exactly one pair of flaps, not two');
  assert.equal(faces(cell), '1321', 'top new (1), bottom keeps the VISIBLE 3, front folds the visible top 2, back brings 1');
  assert.equal(clock.pending(), 1, 'the first flip\'s settle timer was cleared');
  clock.advance(FLIP_MS);
  assert.equal(faces(cell), '11--');
});

test('same value again is a no-op (no flaps, no timer)', () => {
  const { env, cell, clock } = setup();
  setFlip(cell, '5', env);
  setFlip(cell, '5', env);
  assert.equal(faces(cell), '55--');
  assert.equal(clock.pending(), 0);
});

test('reduced motion: every change sets both halves at once, no flaps, no timer', () => {
  const { env, cell, clock } = setup(true);
  setFlip(cell, '3', env);
  setFlip(cell, '2', env);
  assert.equal(faces(cell), '22--');
  assert.equal(clock.pending(), 0);
  assert.match(FLIP_CSS, /prefers-reduced-motion:reduce\)\{\.dc-flip-flap\{animation:none!important\}/);
});

test('each half carries a full-height glyph pinned to its own edge (the seam cuts one glyph in two)', () => {
  assert.match(FLIP_CSS, /\.dc-flip-half>span,\.dc-flip-flap>span\{[^}]*height:200%/);
  assert.match(FLIP_CSS, /\.dc-flip-top>span,\.dc-flip-front>span\{top:0\}/);
  assert.match(FLIP_CSS, /\.dc-flip-bottom>span,\.dc-flip-back>span\{bottom:0\}/);
  // The settle timer covers both folds as the CSS declares them.
  const folds = [...FLIP_CSS.matchAll(/animation:dc-flip-(?:down|up) \.(\d+)s(?: \.(\d+)s)?/g)];
  const end = Math.max(...folds.map(([, d, delay]) => Number('0.' + d) + (delay ? Number('0.' + delay) : 0)));
  assert.ok(FLIP_MS >= end * 1000, `settle ${FLIP_MS}ms must not cut the ${end * 1000}ms animation short`);
});

test('the decorative faces are hidden from assistive tech', () => {
  const { env, cell } = setup();
  setFlip(cell, '3', env);
  setFlip(cell, '2', env);
  for (const face of cell.children) assert.equal(face.getAttribute('aria-hidden'), 'true');
});

test('content-agnostic: a whole word is one face, with the same order as a digit', () => {
  const { env, cell, clock } = setup();
  const sep = (cell_) => ['.dc-flip-top', '.dc-flip-bottom', '.dc-flip-front', '.dc-flip-back']
    .map((sel) => { const el = cell_.querySelector(sel); return el ? el.firstChild.textContent : '-'; }).join('|');
  setFlip(cell, '各駅停車', env);
  assert.equal(sep(cell), '各駅停車|各駅停車|-|-');
  setFlip(cell, '東京', env);
  assert.equal(sep(cell), '東京|各駅停車|各駅停車|東京', 'top new, bottom old, front old, back new');
  clock.advance(FLIP_MS);
  assert.equal(sep(cell), '東京|東京|-|-');
  setFlip(cell, 'A', env);
  assert.equal(cell.querySelector('.dc-flip-top').firstChild.textContent, 'A', 'a letter works the same way');
});

const sizer = (cell) => cell.querySelector('.dc-flip-size').children.map((c) => c.textContent);

test('with a declared face set the sizer holds the whole set from creation and never changes', () => {
  const doc = createDocument();
  const clock = createClock(0);
  const env = { document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, reduced: false };
  const set = parseFaces('東京, 各駅停車 ,新大阪,東京,');
  assert.deepEqual(set, ['東京', '各駅停車', '新大阪'], 'trimmed, empties and repeats dropped, order kept');
  const cell = createFlip(doc, set);
  assert.deepEqual(sizer(cell), set, 'width = widest of the set before anything is shown');
  for (const f of ['東京', '各駅停車', '新大阪', '東京']) { setFlip(cell, f, env); assert.deepEqual(sizer(cell), set, `unchanged showing ${f}`); clock.advance(FLIP_MS); assert.deepEqual(sizer(cell), set); }
});

test('without a set the card only grows: every face shown stays in the sizer', () => {
  const { env, cell, clock } = setup();
  setFlip(cell, '各駅停車', env); clock.advance(FLIP_MS);
  setFlip(cell, '東京', env); clock.advance(FLIP_MS);
  assert.deepEqual(sizer(cell), ['各駅停車', '東京'], 'the wider earlier face still sizes the card');
  setFlip(cell, '各駅停車', env);
  assert.deepEqual(sizer(cell), ['各駅停車', '東京'], 'a repeat adds nothing');
});

test('a face outside the declared set still fits (grows rather than clips)', () => {
  const doc = createDocument();
  const env = { document: doc, setTimeout: () => 0, clearTimeout() {}, reduced: true };
  const cell = createFlip(doc, ['0', '1']);
  setFlip(cell, '回送', env);
  assert.deepEqual(sizer(cell), ['0', '1', '回送']);
});

test('the card width comes from its content or --dc-flip-width, never a fixed one-character box', () => {
  assert.match(FLIP_CSS, /\.dc-flip\{[^}]*width:var\(--dc-flip-width,auto\);min-width:var\(--dc-flip-min-width,0\)/, 'an explicit width is not overridden by a default min-width');
  assert.doesNotMatch(FLIP_CSS, /\b1ch\b/);
  assert.match(FLIP_CSS, /\.dc-flip-size\{[^}]*visibility:hidden[^}]*white-space:nowrap/);
  const { env, cell } = setup();
  setFlip(cell, '各駅停車', env);
  assert.equal(cell.querySelector('.dc-flip-size').getAttribute('aria-hidden'), 'true');
});
