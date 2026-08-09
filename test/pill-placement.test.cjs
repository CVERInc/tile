// Unit test for pillPlacement — the pure math behind the selection pill's position. No DOM: this exists
// precisely because the pill cannot be eyeball-debugged on a device you are not holding.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
eval(grab('pillPlacement'));

let pass = 0, fail = 0;
function t(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; console.log(`FAIL ${label}\n  got: ${g}\n  want: ${w}`); }
}

const VIEW = { top: 0, bottom: 800, left: 0, right: 400 };   // a plausible phone viewport
const W = 36, H = 36, GAP = 10;
const rect = (top, bottom, left, right) => ({ top, bottom, left, right });

// ── the ordinary case: room above ───────────────────────────────────────────────────────────────────
{
  const r = rect(300, 320, 100, 200);
  const p = pillPlacement(r, VIEW.top, VIEW.bottom, VIEW.left, VIEW.right, W, H, GAP);
  t('prefers above', p.side, 'above');
  t('sits GAP above the selection top, pill BOTTOM touching', p.top, r.top - GAP - H);
  t('centred on the selection', p.left, (r.left + r.right) / 2 - W / 2);
}

// ── no room above: falls back below ─────────────────────────────────────────────────────────────────
{
  const r = rect(5, 40, 100, 200);   // top of a phone screen — 5px above is not enough for a 36px pill + gap
  const p = pillPlacement(r, VIEW.top, VIEW.bottom, VIEW.left, VIEW.right, W, H, GAP);
  t('falls back below when there is no room above', p.side, 'below');
  t('sits GAP below the selection bottom', p.top, r.bottom + GAP);
}

// ── clamped into the visible rect, not pushed off it ────────────────────────────────────────────────
{
  // A selection near the very top, in a viewport already shrunk by the keyboard (vTop > 0) — the "above"
  // math would put the pill ABOVE vTop; it must clamp to vTop instead of leaving the visible area.
  const r = rect(3, 20, 100, 200);
  const p = pillPlacement(r, 40, 500, VIEW.left, VIEW.right, W, H, GAP);
  t('clamps to the visible top rather than going above it', p.top >= 40, true);
}
{
  // A tall selection filling most of a keyboard-shrunk viewport: no room above (forces the 'below' fallback)
  // AND no room below either (rect.bottom + gap + H overshoots vBottom) — the only case that reaches the
  // final clamp line. A shorter selection reaches "below" and already fits there, which cannot tell "clamped"
  // from "never needed to be".
  const r = rect(10, 440, 100, 200);
  const p = pillPlacement(r, 0, 460, VIEW.left, VIEW.right, W, H, GAP);
  t('below alone would overshoot here — proving the clamp is reachable', r.bottom + GAP + H > 460, true);
  t('clamps to the visible bottom rather than going under it', p.top + H <= 460, true);
}
{
  // A selection hugging the left edge — centring would put the pill partly off-screen to the left.
  const r = rect(300, 320, 0, 10);
  const p = pillPlacement(r, VIEW.top, VIEW.bottom, VIEW.left, VIEW.right, W, H, GAP);
  t('clamps left instead of running off the left edge', p.left, VIEW.left);
}
{
  // A selection hugging the right edge — same, other direction.
  const r = rect(300, 320, 390, 400);
  const p = pillPlacement(r, VIEW.top, VIEW.bottom, VIEW.left, VIEW.right, W, H, GAP);
  t('clamps right instead of running off the right edge', p.left, VIEW.right - W);
}

console.log(`pill-placement: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
