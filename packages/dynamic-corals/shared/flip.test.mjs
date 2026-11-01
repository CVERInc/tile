// The split-flap card's face order, sampled MID-FLIP — the moment a wrong order shows.
//   run: node --test packages/dynamic-corals/shared/flip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlip, setFlip, settleFlip, parseFaces, FLIP_MS, DRUM_STEP_MS, FLIP_CSS } from './flip.mjs';
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

// ── drum mode ───────────────────────────────────────────────────────────────────────────────────
const DRUM = ['A', 'B', 'C', 'D', 'E'];
function drumSetup(reduced = false, drum = DRUM, faces = []) {
  const doc = createDocument();
  const clock = createClock(0);
  const env = { document: doc, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, reduced };
  const cell = createFlip(doc, faces, { drum });
  doc.body.appendChild(cell);
  return { doc, clock, env, cell };
}
/** Every fold the card makes until it is at rest: [shown-before, shown-after] per fold, and the faces
 *  sampled mid-fold. Advances the clock 1 ms at a time, so a fold that is skipped cannot hide. */
function runDrum(cell, clock, maxMs = 5000) {
  const folds = [];
  let last = null;
  for (let t = 0; t <= maxMs; t++) {
    const on = cell.classList.contains('dc-flip-on');
    if (on) {
      const f = faces(cell);
      if (f !== last) folds.push(f);
      last = f;
    } else last = null;
    if (!on && clock.pending() === 0) break;
    clock.advance(1);
  }
  return folds;
}
const adjacent = (drum, a, b) => drum[(drum.indexOf(a) + 1) % drum.length] === b;

test('drum: A→D folds through B and C, one ordinary fold per step, each between ADJACENT faces', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'A', env);
  setFlip(cell, 'D', env);
  const folds = runDrum(cell, clock);
  // Each fold sampled mid-way reads top=new, bottom=old, front=old, back=new (the same order as a plain flip).
  assert.deepEqual(folds, ['BAAB', 'CBBC', 'DCCD']);
  for (const f of folds) assert.ok(adjacent(DRUM, f[1], f[0]), `${f[1]}→${f[0]} is one step on the drum`);
  assert.equal(faces(cell), 'DD--');
  assert.equal(clock.pending(), 0);
});

test('drum: it only turns forward — going "back" one face is a full turn round the drum', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'C', env);
  setFlip(cell, 'B', env);
  const folds = runDrum(cell, clock);
  assert.deepEqual(folds.map((f) => f[1] + f[0]), ['CD', 'DE', 'EA', 'AB']);
});

test('drum: a new target mid-run carries on FORWARD from the face showing, never jumps back or stacks', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'A', env);
  setFlip(cell, 'E', env);            // A→B→C→D→E planned
  clock.advance(DRUM_STEP_MS + 10);   // B is up, folding to C
  setFlip(cell, 'B', env);            // now stop at B: forward from C is D, E, A, B
  assert.equal(cell.querySelectorAll('.dc-flip-flap').length, 2, 'the running fold was not doubled');
  assert.ok(clock.pending() <= 1, 'no second timer');
  const folds = runDrum(cell, clock);
  assert.deepEqual(folds.map((f) => f[1] + f[0]), ['BC', 'CD', 'DE', 'EA', 'AB']);
  assert.equal(faces(cell), 'BB--');
});

test('drum: many retargets leave at most one timer and one pair of flaps at any moment', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'A', env);
  for (let i = 0; i < 200; i++) {
    setFlip(cell, DRUM[(i * 3) % DRUM.length], env);
    assert.ok(clock.pending() <= 1, `timers after retarget ${i}`);
    assert.ok(cell.querySelectorAll('.dc-flip-flap').length <= 2);
    clock.advance(37);
  }
  runDrum(cell, clock);
  assert.equal(clock.pending(), 0);
  assert.equal(cell.querySelectorAll('.dc-flip-flap').length, 0);
});

test('drum + reduced motion: straight to the target, no flaps, no timers', () => {
  const { env, cell, clock } = drumSetup(true);
  setFlip(cell, 'A', env);
  setFlip(cell, 'D', env);
  assert.equal(faces(cell), 'DD--');
  assert.equal(clock.pending(), 0);
});

test('drum: a face that is not on the drum goes straight there in ONE plain fold', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'A', env);
  setFlip(cell, '回送', env);
  assert.equal(clock.pending(), 1);
  clock.advance(FLIP_MS);
  assert.equal(cell.querySelector('.dc-flip-top').firstChild.textContent, '回送');
  assert.equal(clock.pending(), 0, 'no further steps');
});

test('drum: the wheel faces are in the sizer from creation, with no declared set, and it does not change while turning', () => {
  // No `faces`: the only thing that can put the wheel into the sizer before a value is shown is the
  // pre-fit in createFlip. Without it the sizer starts empty and grows face by face while turning.
  const { env, cell, clock } = drumSetup(false, ['5', '4', '3', '2', '1', '0'], []);
  const before = sizer(cell);
  assert.deepEqual(before, ['5', '4', '3', '2', '1', '0'], 'the whole wheel sizes the card before the first value');
  setFlip(cell, '4', env);
  setFlip(cell, '0', env);   // 4→3→2→1→0: four steps
  for (let t = 0; t < 5 * DRUM_STEP_MS; t += 7) { assert.deepEqual(sizer(cell), before); clock.advance(7); }
  assert.equal(faces(cell), '00--');
});

test('drum: a declared width set wider than the wheel sizes it too', () => {
  const { cell } = drumSetup(false, ['5', '4', '3', '2', '1', '0'], ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(sizer(cell), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
});

test('drum: an off-wheel face arriving MID-RUN still goes straight there (the run does not stop half-way)', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'A', env);
  setFlip(cell, 'D', env);            // A→B→C→D planned
  clock.advance(70);                  // folding A→B
  setFlip(cell, '回送', env);
  assert.equal(cell.querySelectorAll('.dc-flip-flap').length, 2, 'one pair of flaps');
  assert.equal(clock.pending(), 1, 'one timer');
  runDrum(cell, clock);
  assert.equal(cell.querySelector('.dc-flip-top').firstChild.textContent, '回送');
  assert.equal(cell.querySelector('.dc-flip-bottom').firstChild.textContent, '回送');
  assert.equal(clock.pending(), 0);
});

test('drum: reduced motion switched on MID-RUN stops the stepping — the running fold ends, then straight to the target', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'A', env);
  setFlip(cell, 'E', env);            // A→B→C→D→E planned
  clock.advance(70);                  // folding A→B
  env.reduced = true;                 // the caller keeps env.reduced live (countdown: a media-query listener)
  clock.advance(DRUM_STEP_MS - 70);   // the A→B fold settles
  assert.equal(faces(cell), 'EE--', 'straight to E, no C/D steps');
  assert.equal(clock.pending(), 0);
});

test('settleFlip: cancels the timer, drops the flaps and shows the target at once (a drum mid-run included)', () => {
  const { env, cell, clock } = drumSetup();
  setFlip(cell, 'A', env);
  setFlip(cell, 'D', env);
  clock.advance(70);
  settleFlip(cell, env);
  assert.equal(faces(cell), 'DD--');
  assert.equal(clock.pending(), 0);
  assert.equal(cell.classList.contains('dc-flip-on'), false);
  settleFlip(createFlip(createDocument()), env);   // a card that has shown nothing: no throw, nothing set
});

test('drum: one step is shorter than a plain flip, and covers both of its folds', () => {
  assert.ok(DRUM_STEP_MS < FLIP_MS);
  const m = /\.dc-flip-drum\.dc-flip-on \.dc-flip-front\{animation-duration:\.(\d+)s\}\.dc-flip-drum\.dc-flip-on \.dc-flip-back\{animation-duration:\.(\d+)s;animation-delay:\.(\d+)s\}/.exec(FLIP_CSS);
  assert.ok(m, 'drum fold timings are declared');
  const end = Math.max(Number('0.' + m[1]), Number('0.' + m[2]) + Number('0.' + m[3]));
  assert.ok(DRUM_STEP_MS >= end * 1000, `step ${DRUM_STEP_MS}ms must not cut the ${end * 1000}ms folds short`);
  const { cell } = drumSetup();
  assert.ok(cell.classList.contains('dc-flip-drum'));
  const plain = createFlip(createDocument());
  assert.equal(plain.classList.contains('dc-flip-drum'), false, 'without a drum it is a plain card');
});
