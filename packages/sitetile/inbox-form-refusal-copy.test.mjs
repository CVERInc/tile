// Contact-form refusals: too_long and rate_limited say what happened instead of "try again".
//   run: node packages/sitetile/inbox-form-refusal-copy.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inboxFormCopy } from './inbox-form-copy.js';
import { inboxOutcomeHelpers } from './inbox-form-script.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};
const HERE = dirname(fileURLToPath(import.meta.url));

const LANGS = ['ja-JP', 'zh-TW', 'zh-CN', 'ko-KR', 'en-US'];
test('all five rows carry errorTooLong and errorRateLimited, distinct from errorServer', () => {
  for (const l of LANGS) {
    const c = inboxFormCopy(l);
    for (const k of ['errorTooLong', 'errorRateLimited']) {
      assert.equal(typeof c[k], 'string', `${l}.${k}`);
      assert.ok(c[k].trim(), `${l}.${k} blank`);
      assert.notEqual(c[k], c.errorServer, `${l}.${k} equals errorServer`);
    }
    assert.notEqual(c.errorTooLong, c.errorRateLimited);
  }
});
test('ruled wording for zh-TW and en', () => {
  assert.equal(inboxFormCopy('zh-TW').errorTooLong, '訊息太長了，請縮短後再送出。');
  assert.equal(inboxFormCopy('zh-TW').errorRateLimited, '送出太頻繁了，請稍候再試。');
  assert.equal(inboxFormCopy('en-US').errorTooLong, 'That message is too long — please shorten it and send again.');
});
test('outcomes map to the new keys; others unchanged', () => {
  const h = inboxOutcomeHelpers();
  assert.equal(h.inboxErrorKey('too_long'), 'errorTooLong');
  assert.equal(h.inboxErrorKey('rate_limited'), 'errorRateLimited');
  assert.equal(h.inboxErrorKey('not_claimed'), 'errorNotClaimed');
  assert.equal(h.inboxErrorKey('inbox_storage_full'), 'errorInboxStorageFull');
  assert.equal(h.inboxErrorKey('whatever'), 'errorServer');
});
test('copy resolves per outcome; an older payload without the keys falls back to errorServer', () => {
  const h = inboxOutcomeHelpers();
  const c = inboxFormCopy('zh-TW');
  assert.equal(h.inboxErrorCopy(c, 'too_long'), c.errorTooLong);
  assert.equal(h.inboxErrorCopy(c, 'rate_limited'), c.errorRateLimited);
  const old = { errorServer: 'retry' };
  assert.equal(h.inboxErrorCopy(old, 'too_long'), 'retry');
  assert.equal(h.inboxErrorCopy(old, 'rate_limited'), 'retry');
  assert.equal(h.inboxErrorCopy(null, 'too_long'), null);
});
test('both copy payloads (Form.astro, site-core.js) pass the two keys', () => {
  for (const f of ['astro/src/components/sections/Form.astro', 'site-core.js']) {
    const s = readFileSync(join(HERE, f), 'utf8');
    assert.match(s, /errorTooLong: fieldCopy\.errorTooLong/, f);
    assert.match(s, /errorRateLimited: fieldCopy\.errorRateLimited/, f);
  }
});
console.log(`${passed} passed`);
