// One split-flap card ("1 片") and the order its four faces change in. No time, no data, and no
// idea what it is showing: a caller hands it any text — a digit, a letter, one CJK character, or a
// whole pre-printed word like 「各駅停車」 on a station board — and it shows that, flipping when it
// changes. Text is set with textContent only.
//
// A real flap has ONE size: the card never resizes per face. Its width is the widest of its FACES —
// the full set it can show, declared by the caller (`createFlip(doc, faces)`; a coral exposes it as
// `data-flip-faces`). Every face sits stacked and invisible in an in-flow sizer, so the browser
// measures them in the card's own font and CSS and re-lays them out by itself when a web font
// arrives or the size changes — no measuring code, no observer. Without a declared set the sizer
// keeps every face the card has shown, so the width only ever grows. `--dc-flip-width` beats both.
// The same ordered set is what a drum mode would step through (see below).
//
// The card is two static halves (the base) and, during a flip, two moving flaps:
//
//   base top     ← NEW at once      — it is what the falling front flap uncovers
//   base bottom  ← stays OLD        — until the rising back flap has covered it
//   front flap   = OLD top half, folds down from the hinge
//   back flap    = NEW bottom half, folds up after it
//   settle       → base bottom = NEW, flaps removed
//
// 🩸 The order is the whole point. A version that wrote the new character into the bottom base at
// 0 ms and the top base at the end showed the new number's lower half under a still-old upper half
// for the length of the fold — every flip "spoiled" itself. Each half also carries a FULL-height
// glyph pinned to its own edge (top half: top, bottom half: bottom), so the seam cuts one glyph in
// two; a half-height glyph per half shows the top of the character twice.
//
// A change that arrives mid-flip drops the running flaps and starts from what each half is showing
// now (top and bottom separately), so flips never stack and no half changes without a fold. Reduced motion (or the first value) sets every face at once.
//
// By default a change goes straight to the target face. DRUM mode (`createFlip(doc, faces, { drum })`)
// is the station board: the card's faces are printed on a drum that only turns FORWARD, so going
// from A to B folds through every face after A, in drum order and wrapping round, until B is up.
// One ordinary fold per step — the same four-face order as above, just shorter (DRUM_STEP_MS). The
// distance between two faces is the number of folds, so a row of cards started together stops one
// by one: that ragged 「嘩啦啦」 finish is the physics, not an added stagger. A new target that arrives
// while the drum is turning is just a new place to stop: the running fold finishes and the drum keeps
// going forward from the face now showing — it never jumps back and never stacks a second run. A
// face that is not on the drum (or the first value, or reduced motion) goes straight there. The drum
// order may differ from the width set: a countdown's tens card turns 5…0 but is as wide as 0–9.

export const FLIP_MS = 460;   // both folds (2 × .22s in FLIP_CSS) plus a frame of slack
export const DRUM_STEP_MS = 140;   // one drum step: both folds (2 × .06s, .dc-flip-drum in FLIP_CSS) plus slack

function face(doc, className) {
  const half = doc.createElement('span');
  half.className = className;
  half.setAttribute('aria-hidden', 'true');
  half.appendChild(doc.createElement('span'));
  return half;
}

/** `data-flip-faces` text → the ordered face list. Comma-separated (as sibling list attributes are),
 *  trimmed, empties and repeats dropped; null/empty → []. */
export function parseFaces(text) {
  if (text == null) return [];
  return [...new Set(String(text).split(',').map((f) => f.trim()).filter(Boolean))];
}

/**
 * A new, empty card. `faces` is every face it can show, in order (optional). Its state lives on the
 * element, so a card can be re-used across ticks.
 */
export function createFlip(doc, faces = [], { drum = null } = {}) {
  const cell = doc.createElement('span');
  cell.className = drum && drum.length > 1 ? 'dc-flip dc-flip-drum' : 'dc-flip';
  // In-flow, invisible: the only thing that gives the card a width.
  const size = doc.createElement('span');
  size.className = 'dc-flip-size';
  size.setAttribute('aria-hidden', 'true');
  cell.appendChild(size);
  cell.__dcFlip = { value: undefined, timer: null, faces: [...faces], fitted: new Set(),
    drum: drum && drum.length > 1 ? [...drum] : null, target: undefined, turning: false };
  for (const f of faces) fit(cell, doc, f);
  if (cell.__dcFlip.drum) for (const f of cell.__dcFlip.drum) fit(cell, doc, f);
  cell.appendChild(face(doc, 'dc-flip-half dc-flip-top'));
  cell.appendChild(face(doc, 'dc-flip-half dc-flip-bottom'));
  return cell;
}

const glyph = (cell, sel) => cell.querySelector(sel).firstChild;

// Add a face to the sizer once. Lines are never removed, so the card never gets narrower; a face
// outside the declared set still fits (it grows the card rather than being clipped).
function fit(cell, doc, text) {
  const state = cell.__dcFlip;
  if (state.fitted.has(text)) return;
  state.fitted.add(text);
  const line = doc.createElement('span');
  line.textContent = text;
  cell.querySelector('.dc-flip-size').appendChild(line);
}

function clearFlaps(cell, state, env) {
  if (state.timer) env.clearTimeout(state.timer);
  state.timer = null;
  state.turning = false;
  cell.classList.remove('dc-flip-on');
  for (const flap of cell.querySelectorAll('.dc-flip-flap')) flap.remove();
}

/**
 * Show `next` on `cell`. `env` = { document, setTimeout, clearTimeout, reduced }.
 * Returns the card's state ({ value, timer }) for tests and diagnostics.
 */
export function setFlip(cell, next, env) {
  const value = String(next);
  const state = cell.__dcFlip;
  const { drum } = state;
  if (drum && state.turning) {
    // The drum is already turning: the new target is just where it stops. If it is on the drum the
    // running fold finishes and the drum carries on forward; if not, fall through and go straight.
    if (drum.includes(value)) { state.target = value; return state; }
  } else if (state.value === value) {
    return state;
  }
  const from = state.value;
  if (drum && from !== undefined && !env.reduced && drum.includes(from) && drum.includes(value)) {
    state.target = value;
    turn(cell, state, env);
    return state;
  }
  state.target = value;
  fold(cell, state, env, value, FLIP_MS, null);
  return state;
}

// One drum step: fold to the face after the one showing, then — if that is not the target yet —
// the next one. `state.value` is always the face fully up (or being folded to), so a retarget
// mid-run carries on from there.
function turn(cell, state, env) {
  const { drum } = state;
  const at = drum.indexOf(state.value);
  const step = drum[(at + 1) % drum.length];
  fold(cell, state, env, step, DRUM_STEP_MS, () => {
    if (state.value !== state.target && drum.includes(state.target)) turn(cell, state, env);
  });
  state.turning = true;
}

// The fold itself: the four-face order in the header. `after` runs once it has settled.
function fold(cell, state, env, value, ms, after) {
  const top = glyph(cell, '.dc-flip-top');
  const bottom = glyph(cell, '.dc-flip-bottom');
  const first = state.value === undefined;
  // What is on the card RIGHT NOW, half by half. Mid-flip they differ — the top already shows the
  // face being flipped to, the bottom still the one before it — and the next flip starts from what
  // is visible, so neither half jumps without a fold.
  const shownTop = top.textContent;
  const shownBottom = bottom.textContent;
  clearFlaps(cell, state, env);
  state.value = value;
  fit(cell, env.document, value);
  if (first || env.reduced) {
    top.textContent = value;
    bottom.textContent = value;
    return;
  }

  top.textContent = value;
  bottom.textContent = shownBottom;
  const front = face(env.document, 'dc-flip-flap dc-flip-front');
  const back = face(env.document, 'dc-flip-flap dc-flip-back');
  front.firstChild.textContent = shownTop;
  back.firstChild.textContent = value;
  cell.appendChild(front);
  cell.appendChild(back);
  void cell.offsetWidth;            // restart the animation even when the class was just removed
  cell.classList.add('dc-flip-on');
  state.timer = env.setTimeout(() => {
    state.timer = null;
    bottom.textContent = value;
    clearFlaps(cell, state, env);
    if (after) after();
  }, ms);
}

// Neutral by default; every colour and size is a custom property the host sets.
export const FLIP_CSS = [
  '.dc-flip{position:relative;display:inline-block;vertical-align:middle;box-sizing:border-box;width:var(--dc-flip-width,auto);min-width:var(--dc-flip-min-width,0);height:var(--dc-flip-height,1.8em);perspective:var(--dc-flip-perspective,4em);border-radius:var(--dc-flip-radius,.14em);overflow:hidden;background:var(--dc-flip-bg-bottom,#262626);color:var(--dc-flip-fg,#fff);font-variant-numeric:tabular-nums}',
  '.dc-flip-size{display:block;visibility:hidden;height:0;overflow:hidden;padding:0 var(--dc-flip-pad,.14em);white-space:nowrap}',
  '.dc-flip-size>span{display:block}',
  '.dc-flip+.dc-flip{margin-left:var(--dc-flip-gap,.08em)}',
  '.dc-flip::after{content:"";position:absolute;left:0;right:0;top:50%;height:1px;margin-top:-.5px;background:var(--dc-flip-seam,rgba(0,0,0,.5));z-index:4}',
  '.dc-flip-half,.dc-flip-flap{position:absolute;left:0;width:100%;height:50%;overflow:hidden;background:var(--dc-flip-bg-top,#333)}',
  '.dc-flip-half>span,.dc-flip-flap>span{position:absolute;left:0;width:100%;height:200%;display:flex;align-items:center;justify-content:center;line-height:1;white-space:nowrap}',
  '.dc-flip-top,.dc-flip-front{top:0}',
  '.dc-flip-top>span,.dc-flip-front>span{top:0}',
  '.dc-flip-bottom,.dc-flip-back{bottom:0;background:var(--dc-flip-bg-bottom,#262626)}',
  '.dc-flip-bottom>span,.dc-flip-back>span{bottom:0}',
  '.dc-flip-flap{z-index:3;-webkit-backface-visibility:hidden;backface-visibility:hidden}',
  '.dc-flip-front{transform-origin:bottom}',
  '.dc-flip-back{transform-origin:top;transform:rotateX(90deg)}',
  '.dc-flip-on .dc-flip-front{animation:dc-flip-down .22s ease-in forwards}',
  '.dc-flip-on .dc-flip-back{animation:dc-flip-up .22s .22s ease-out forwards}',
  '.dc-flip-drum.dc-flip-on .dc-flip-front{animation-duration:.06s}',
  '.dc-flip-drum.dc-flip-on .dc-flip-back{animation-duration:.06s;animation-delay:.06s}',
  '@keyframes dc-flip-down{to{transform:rotateX(-90deg);filter:brightness(.7)}}',
  '@keyframes dc-flip-up{to{transform:rotateX(0deg)}}',
  '@media (prefers-reduced-motion:reduce){.dc-flip-flap{animation:none!important}}',
].join('');
