// Guard for the page side of CJK emphasis: a body line whose bold ends in full-width punctuation,
// flush against the next character, printed its asterisks on the built page
// (tile-lab#46).
//   run: node packages/sitetile/cjk-emphasis.test.mjs   (wired into scripts/test.sh by glob)
//
// The rule itself lives in packages/cssmd and its table is test/emphasis-cjk.test.cjs. What this
// file adds is the other end of the wire: the page renderer splices cssmd's passes into its own
// chain (escape, code, emphasis, escapes, then links and the rest), so "the engine is right" and
// "the page is right" are two claims. These are the report's own four rows, driven through
// `bodyHtml` the way the report measured them, byte for byte.

import assert from 'node:assert/strict';
import { bodyHtml, inlineHtml } from './site-core.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n').join('\n    ')); }
}
const B = (inner) => '<span class="st-b"><span class="st-mk">**</span>' + inner + '<span class="st-mk">**</span></span>';
const I = (inner) => '<span class="st-i"><span class="st-mk">*</span>' + inner + '<span class="st-mk">*</span></span>';

console.log('cjk-emphasis (tile-lab#46)');

// ── the two rows that were already right ────────────────────────────────────────────────────────
test('bold between CJK letters renders, as it did', () => {
  assert.equal(bodyHtml('已經**手動關閉**了'), '<p>已經' + B('手動關閉') + '了</p>');
});
test('bold set off by spaces renders, as it did', () => {
  assert.equal(bodyHtml('已經 **手動關閉（Kill）** 了'), '<p>已經 ' + B('手動關閉（Kill）') + ' 了</p>');
});

// ── the two that printed their asterisks ────────────────────────────────────────────────────────
test('bold ending in a full-width parenthesis, flush against a CJK letter', () => {
  assert.equal(bodyHtml('已經**手動關閉（Kill）**了'), '<p>已經' + B('手動關閉（Kill）') + '了</p>');
});
test('bold wrapping full-width parentheses between Latin words', () => {
  assert.equal(bodyHtml('Foo**（bar）**baz'), '<p>Foo' + B('（bar）') + 'baz</p>');
});

// ── the same rule where a page meets it most: beside the renderer's own inline constructs ───────
test('a code span inside the bold does not stop it closing after `）`', () => {
  assert.equal(inlineHtml('請**執行 `kill`（強制）**再試'),
    '請' + B('執行 <span class="st-code"><span class="st-mk">`</span>kill<span class="st-mk">`</span></span>（強制）') + '再試');
});
test('italic with full-width parentheses inside, flush on both sides', () => {
  assert.equal(inlineHtml('他說*（真的）*嗎'), '他說' + I('（真的）') + '嗎');
});

// ── and what a page must go on printing as typed ────────────────────────────────────────────────
test('arithmetic, a lone pair of asterisks and identifiers stay literal', () => {
  assert.equal(bodyHtml('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
  assert.equal(bodyHtml('a ** b'), '<p>a ** b</p>');
  assert.equal(bodyHtml('snake_case_name 與 檔案_名稱_版本'), '<p>snake_case_name 與 檔案_名稱_版本</p>');
});
test('with no CJK character beside the run, ASCII punctuation still refuses it', () => {
  assert.equal(bodyHtml('Foo**(bar)**baz'), '<p>Foo**(bar)**baz</p>');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
