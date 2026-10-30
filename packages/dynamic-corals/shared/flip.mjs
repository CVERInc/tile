// One split-flap card ("1 片") and the order its four faces change in. No time, no data, and no
// idea what it is showing: a caller hands it any text — a digit, a letter, one CJK character, or a
// whole pre-printed word like 「各駅停車」 on a station board — and it shows that, flipping when it
// changes. Text is set with textContent only; the card's width comes from its content (an invisible
// in-flow copy of the current face) or from --dc-flip-width, never from an assumed one-character box.
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
// A change that arrives mid-flip drops the running flaps and starts from what the card is showing
// now, so flips never stack. Reduced motion (or the first value) sets every face at once.
//
// Today a change goes straight to the target face. A board that steps through every face in between
// (a drum / sequence mode) is a different caller-supplied OPTION on the same card, not a different
// card: `setFlip(cell, next, env)` keeps `env` open for it, and nothing here is named after "jump".

export const FLIP_MS = 460;   // both folds (2 × .22s in FLIP_CSS) plus a frame of slack

function face(doc, className) {
  const half = doc.createElement('span');
  half.className = className;
  half.setAttribute('aria-hidden', 'true');
  half.appendChild(doc.createElement('span'));
  return half;
}

/** A new, empty card. Its state lives on the element, so a card can be re-used across ticks. */
export function createFlip(doc) {
  const cell = doc.createElement('span');
  cell.className = 'dc-flip';
  // In-flow, invisible: the only thing that gives the card a width, so a word gets a wide card.
  const size = doc.createElement('span');
  size.className = 'dc-flip-size';
  size.setAttribute('aria-hidden', 'true');
  cell.appendChild(size);
  cell.appendChild(face(doc, 'dc-flip-half dc-flip-top'));
  cell.appendChild(face(doc, 'dc-flip-half dc-flip-bottom'));
  return cell;
}

const glyph = (cell, sel) => cell.querySelector(sel).firstChild;

// The sizer holds one block per face it must fit: both faces while a flip runs (so the old, wider
// word is not clipped mid-fold), only the shown one once settled.
function fit(size, doc, faces) {
  size.textContent = '';
  for (const text of faces) {
    const line = doc.createElement('span');
    line.textContent = text;
    size.appendChild(line);
  }
}

function clearFlaps(cell, state, env) {
  if (state.timer) env.clearTimeout(state.timer);
  state.timer = null;
  cell.classList.remove('dc-flip-on');
  for (const flap of cell.querySelectorAll('.dc-flip-flap')) flap.remove();
}

/**
 * Show `next` on `cell`. `env` = { document, setTimeout, clearTimeout, reduced }.
 * Returns the card's state ({ value, timer }) for tests and diagnostics.
 */
export function setFlip(cell, next, env) {
  const value = String(next);
  const state = cell.__dcFlip || (cell.__dcFlip = { value: undefined, timer: null });
  const size = cell.querySelector('.dc-flip-size');
  const top = glyph(cell, '.dc-flip-top');
  const bottom = glyph(cell, '.dc-flip-bottom');
  if (state.value === value) return state;

  const old = state.value;
  clearFlaps(cell, state, env);
  state.value = value;
  if (old === undefined || env.reduced) {
    fit(size, env.document, [value]);
    top.textContent = value;
    bottom.textContent = value;
    return state;
  }

  fit(size, env.document, [old, value]);
  top.textContent = value;
  bottom.textContent = old;
  const front = face(env.document, 'dc-flip-flap dc-flip-front');
  const back = face(env.document, 'dc-flip-flap dc-flip-back');
  front.firstChild.textContent = old;
  back.firstChild.textContent = value;
  cell.appendChild(front);
  cell.appendChild(back);
  void cell.offsetWidth;            // restart the animation even when the class was just removed
  cell.classList.add('dc-flip-on');
  state.timer = env.setTimeout(() => {
    state.timer = null;
    bottom.textContent = value;
    fit(size, env.document, [value]);
    clearFlaps(cell, state, env);
  }, FLIP_MS);
  return state;
}

// Neutral by default; every colour and size is a custom property the host sets.
export const FLIP_CSS = [
  '.dc-flip{position:relative;display:inline-block;vertical-align:middle;box-sizing:border-box;width:var(--dc-flip-width,auto);min-width:var(--dc-flip-min-width,1.15em);height:var(--dc-flip-height,1.8em);perspective:var(--dc-flip-perspective,4em);border-radius:var(--dc-flip-radius,.14em);overflow:hidden;background:var(--dc-flip-bg-bottom,#262626);color:var(--dc-flip-fg,#fff);font-variant-numeric:tabular-nums}',
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
  '@keyframes dc-flip-down{to{transform:rotateX(-90deg);filter:brightness(.7)}}',
  '@keyframes dc-flip-up{to{transform:rotateX(0deg)}}',
  '@media (prefers-reduced-motion:reduce){.dc-flip-flap{animation:none!important}}',
].join('');
