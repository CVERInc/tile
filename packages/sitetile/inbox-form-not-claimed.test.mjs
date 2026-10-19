// reef#2204 — the `action=inbox` form's `not_claimed` outcome gets its own sentence, on every
// path and in every shape the forwarder can hand it back.
//
// Shapes, read off feelreef's `src/routes/api/inbox/+server.ts` (not guessed):
//   • a form-encoded POST WITHOUT `Accept: application/json` (a no-JS submit, AND this script's
//     own `fetch(action, {body: FormData})`, which sends no Accept header) → 303 to the page with
//     `?inbox=<reason>`; `fetch()` follows it, so the AJAX path reads the outcome off `res.url`;
//   • the same POST WITH `Accept: application/json`, or a JSON body → `{ ok:false, reason }`,
//     status 404 for `not_claimed` (422 for every other refusal).
// The helpers below are evaluated from the SAME source text the browser script embeds, so what is
// unit-tested here is the code a page ships, not a re-implementation of it.
//   run: node packages/sitetile/inbox-form-not-claimed.test.mjs

import assert from 'node:assert/strict';
import { INBOX_FORM_SCRIPT, inboxOutcomeHelpers } from './inbox-form-script.js';
import { inboxFormCopy } from './inbox-form-copy.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};
const atest = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const H = inboxOutcomeHelpers({ href: 'https://tniop.tw/contact/' });
const copy = inboxFormCopy('zh-TW');

test('🔴 reef#2204 mapping: not_claimed → errorNotClaimed; every other refusal keeps errorServer', () => {
  assert.equal(H.inboxErrorKey('not_claimed'), 'errorNotClaimed');
  for (const other of ['error', 'too_long', 'rate_limited', 'invalid_body', 'bad_kind', 'site_closed', '', undefined, null]) {
    assert.equal(H.inboxErrorKey(other), 'errorServer', `outcome ${JSON.stringify(other)} should still be the generic retry sentence`);
  }
});

test('mapping → copy: the sentence shown is the table\'s, and a payload WITHOUT errorNotClaimed (an older build) falls back to errorServer', () => {
  assert.equal(H.inboxErrorCopy(copy, 'not_claimed'), '這個網站目前沒有開放留言。');
  assert.equal(H.inboxErrorCopy(copy, 'too_long'), copy.errorServer);
  assert.equal(H.inboxErrorCopy(null, 'not_claimed'), null, 'no payload → null, so showError keeps the static default');
  const old = { errorServer: copy.errorServer };
  assert.equal(H.inboxErrorCopy(old, 'not_claimed'), copy.errorServer);
});

await atest('redirect shape (AJAX): fetch followed the 303, `res.url` carries ?inbox=not_claimed', async () => {
  const res = { url: 'https://tniop.tw/contact/?inbox=not_claimed', headers: { get: () => 'text/html' } };
  assert.equal(await H.inboxOutcomeOf(res), 'not_claimed');
  assert.equal(await H.inboxOutcomeOf({ url: 'https://tniop.tw/thanks/?inbox=sent', headers: { get: () => 'text/html' } }), 'sent');
});

await atest('JSON shape (AJAX with Accept: application/json): 404 {ok:false, reason:"not_claimed"} → not_claimed; {ok:true} → sent', async () => {
  const json = (status, body) => ({
    url: 'https://tniop.tw/__reef/inbox', status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
    json: () => Promise.resolve(body),
  });
  assert.equal(await H.inboxOutcomeOf(json(404, { ok: false, reason: 'not_claimed' })), 'not_claimed');
  assert.equal(await H.inboxOutcomeOf(json(422, { ok: false, reason: 'too_long' })), 'too_long');
  assert.equal(await H.inboxOutcomeOf(json(200, { ok: true, id: 'm1' })), 'sent');
  // A JSON response that cannot be parsed is still a refusal, never a success and never a throw.
  const broken = { ...json(500, {}), json: () => Promise.reject(new Error('bad json')) };
  assert.equal(await H.inboxOutcomeOf(broken), '');
});

await atest('neither shape (an HTML page with no ?inbox=, e.g. a 5xx) → "" → errorServer, as before', async () => {
  const res = { url: 'https://tniop.tw/__reef/inbox', status: 502, headers: { get: () => 'text/html' } };
  assert.equal(await H.inboxOutcomeOf(res), '');
  assert.equal(H.inboxErrorKey(await H.inboxOutcomeOf(res)), 'errorServer');
});

test('🔴 the shipped script uses the mapping on BOTH paths — the ?inbox= reload path and the AJAX path', () => {
  const s = INBOX_FORM_SCRIPT;
  assert.ok(s.includes(inboxOutcomeHelpers.source), 'the browser script does not embed the helper source the tests evaluated');
  // Reload path: the outcome read from location.search goes through the mapping.
  assert.match(s, /else if \(v\) showError\(inboxErrorCopy\(copy, v\)\);/);
  // AJAX path: the outcome is resolved from the response (URL first, JSON body second), then mapped.
  assert.match(s, /inboxOutcomeOf\(res\)/);
  assert.match(s, /\} else showError\(inboxErrorCopy\(copy, outcome\)\);/);
  // The old unconditional generic sentence is gone from both paths.
  assert.doesNotMatch(s, /showError\(copy \? copy\.errorServer : null\)/);
  // The network branch is untouched: a fetch() rejection is still "check your connection".
  assert.match(s, /showError\(copy \? copy\.errorNetwork : null\)/);
});

console.log('\ninbox-form-not-claimed: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
