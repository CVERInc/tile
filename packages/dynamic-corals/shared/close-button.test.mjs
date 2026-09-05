// The shared close button must stay identical to the QR popup's, which is the original.
//
// This is the only kind of copy that is allowed here: the QR client is generated verbatim from
// chodaict's qr-anim.js and must not be edited to import anything, so the sharing runs the other
// way — the module mirrors the original and this test is what stops the mirror drifting. If the
// popup's button is ever restyled, this fails and the module follows, instead of the family
// quietly ending up with a seventh close button.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOSE_BUTTON_CSS, closeButtonStates, closeButtonHtml } from './close-button.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const qr = readFileSync(join(HERE, '../qr/qr-client.mjs'), 'utf8');

/** The cssText the QR popup assigns to its close button, minus the placement it owns. */
function qrCloseCss() {
  const m = /qrCloseBtn\.style\.cssText='([^']+)'/.exec(qr);
  assert.ok(m, 'could not find the QR popup close button — has the 表演 changed shape?');
  const OWN = /^(position|top|left|right|bottom|z-index|opacity|transition):/;
  return m[1].split(';').filter((d) => d && !OWN.test(d)).join(';');
}

test('the shared identity is byte-identical to the QR popup\'s button', () => {
  assert.equal(CLOSE_BUTTON_CSS, qrCloseCss(),
    'the module and the original have diverged — copy the original, do not edit the original');
});

test('44px is the touch-target floor, and the ring is not decoration', () => {
  assert.match(CLOSE_BUTTON_CSS, /width:44px;height:44px/);
  assert.match(CLOSE_BUTTON_CSS, /backdrop-filter:blur\(8px\)/, 'reads over artwork, not just over flat colour');
});

test('focus is visible, and hover matches the original', () => {
  const states = closeButtonStates('.x');
  assert.match(states, /\.x:focus-visible\{outline:2px solid/);
  assert.ok(qr.includes("qrCloseBtn.style.outline='2px solid var(--cp-accent)'"), 'the original focuses visibly too');
  assert.match(states, /\.x:hover\{background:color-mix\(in srgb,var\(--cp-accent\) 20%,transparent\)\}/);
});

test('the button always carries an accessible name — ✕ alone is not one', () => {
  assert.equal(closeButtonHtml('cls', '關閉'), '<button type="button" class="cls" aria-label="關閉">✕</button>');
});

// CONTROL: the identity check only means something if it can notice a difference.
test('CONTROL: the identity check fires when one declaration changes', () => {
  assert.notEqual(CLOSE_BUTTON_CSS.replace('44px', '40px'), qrCloseCss());
});
