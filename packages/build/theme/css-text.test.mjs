// css-text — the echo cap: pure, and it keeps the HEAD of the text, not the tail.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CSS_TEXT_ECHO_MAX_CHARS, truncateCssText } from './css-text.js';

test('truncateCssText: pure, and only touches strings past the cap', () => {
  assert.equal(truncateCssText(null), null);
  assert.equal(truncateCssText(undefined), undefined);
  assert.equal(truncateCssText('short'), 'short');
  assert.equal(truncateCssText(42), '42', 'a non-string is stringified, not dropped');
  // 🔴 Non-uniform on purpose: a string of one repeated character cannot tell "kept the head" from
  // "kept the tail", so a version that sliced from the wrong end would pass a 'x'.repeat fixture.
  const digits = (n) => Array.from({ length: n }, (_, i) => String(i % 10)).join('');
  const exact = digits(CSS_TEXT_ECHO_MAX_CHARS);
  assert.equal(truncateCssText(exact), exact, 'exactly at the cap is untouched');
  const over = digits(CSS_TEXT_ECHO_MAX_CHARS + 37);
  const cut = truncateCssText(over);
  assert.equal(cut.length, CSS_TEXT_ECHO_MAX_CHARS + 1, 'cap chars plus the ellipsis mark');
  assert.ok(cut.endsWith('…'));
  assert.equal(cut.slice(0, -1), over.slice(0, CSS_TEXT_ECHO_MAX_CHARS), 'the HEAD survives');
});
