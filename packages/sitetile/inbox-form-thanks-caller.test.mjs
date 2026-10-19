// tile#159 r2 (reef#2204) — the CALLER of inboxOutcomeOf, not just the helper: what the shipped
// `INBOX_FORM_SCRIPT` actually does after a successful submit on a form with / without `thanks=`.
//
// 🩸 r1 review: a JSON success (`{ok:true}`) has no followed 303, so `res.url` is the Inbox POST
// endpoint itself — and the `redirectsToThanks` branch did `location.assign(res.url)` with it,
// navigating the visitor to the API URL. The helper test only saw `'sent'` and stayed green.
//
// The script runs here verbatim (the same string both renderers emit), against a stub DOM that
// carries exactly what the renderers put in the markup: `data-inbox-copy` on the section and, for
// a `thanks=` form, the hidden `thanks_to` input (seen through the submit-time FormData).
//   run: node packages/sitetile/inbox-form-thanks-caller.test.mjs

import assert from 'node:assert/strict';
import { INBOX_FORM_SCRIPT } from './inbox-form-script.js';
import { inboxFormCopy } from './inbox-form-copy.js';

let passed = 0;
const atest = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const PAGE = 'https://site.example/contact/';
const INBOX = 'https://site.example/__reef/inbox';

function el(extra = {}) {
  return { hidden: true, textContent: '', focus() {}, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {}, ...extra };
}

// Run the shipped script once against a fresh stub page; return what it did.
async function run({ thanksTo = null, response }) {
  const copy = { ...inboxFormCopy('en'), emailField: null, excerptField: null };
  if (thanksTo != null) copy.redirectsToThanks = true;
  const did = { assign: [], reload: 0, fetched: [] };
  const listeners = {};
  const btn = el({ disabled: false });
  const form = el({
    hidden: false,
    reset() {},
    getAttribute: (k) => (k === 'action' ? '/__reef/inbox' : null),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    querySelector: (sel) => {
      if (sel === '.st-form-submit') return btn;
      return null;
    },
  });
  const successEl = el();
  const errorEl = el();
  const root = {
    dataset: { inboxCopy: JSON.stringify(copy) },
    querySelector: (sel) => ({
      '.st-form': form, '[data-inbox-success]': successEl, '[data-inbox-error]': errorEl,
    })[sel] || null,
    querySelectorAll: () => [],
  };
  const document = { currentScript: { closest: () => root } };
  const location = {
    href: PAGE, origin: new URL(PAGE).origin, search: '',
    assign: (u) => { did.assign.push(u); },
    reload: () => { did.reload++; },
  };
  const fetch = (url, init) => { did.fetched.push(url); return Promise.resolve(response); };
  const window = { fetch, history: { state: null, replaceState() {} } };
  // A real `new FormData(form)` carries the hidden inputs; for a `thanks=` form that includes `thanks_to`.
  class FormData { constructor() {} get(k) { return k === 'thanks_to' && thanksTo != null ? thanksTo : null; } }
  // eslint-disable-next-line no-new-func
  new Function('document', 'window', 'location', 'fetch', 'FormData', INBOX_FORM_SCRIPT)(document, window, location, fetch, FormData);
  assert.equal(typeof listeners.submit, 'function', 'the script did not wire a submit handler');
  listeners.submit({ preventDefault() {} });
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  return { did, successShown: successEl.hidden === false, errorShown: errorEl.hidden === false };
}

const jsonOk = { url: INBOX, status: 200, headers: { get: (k) => (/content-type/i.test(k) ? 'application/json' : null) }, json: () => Promise.resolve({ ok: true, id: 'm1' }) };
const followed = (url) => ({ url, status: 200, headers: { get: () => 'text/html' } });

await atest('🔴 JSON success + thanks=/thank-you/ → navigates to the configured thanks path, never to the Inbox endpoint', async () => {
  const r = await run({ thanksTo: '/thank-you/', response: jsonOk });
  assert.deepEqual(r.did.assign, ['/thank-you/'], `navigated to ${JSON.stringify(r.did.assign)}, expected ["/thank-you/"]`);
  assert.equal(r.did.reload, 0);
  assert.equal(r.successShown, false, 'the in-place card would be a lie the navigation corrects');
});

await atest('🔴 JSON success + a thanks_to that resolves off this origin → no navigation to it (same check as the 303 path: reload)', async () => {
  const r = await run({ thanksTo: '//evil.example/x', response: jsonOk });
  assert.deepEqual(r.did.assign, [], `navigated to ${JSON.stringify(r.did.assign)}`);
  assert.equal(r.did.reload, 1);
});

await atest('JSON success, no thanks= → in-page success card, no navigation', async () => {
  const r = await run({ response: jsonOk });
  assert.deepEqual(r.did.assign, []);
  assert.equal(r.did.reload, 0);
  assert.equal(r.successShown, true);
});

await atest('303 followed + thanks= → unchanged: navigates to the forwarder\'s final same-origin URL', async () => {
  const url = 'https://site.example/thank-you/?inbox=sent';
  const r = await run({ thanksTo: '/thank-you/', response: followed(url) });
  assert.deepEqual(r.did.assign, [url]);
  assert.equal(r.did.reload, 0);
  assert.equal(r.successShown, false);
});

await atest('303 followed + thanks= but the final URL is off-origin → unchanged: reload, no navigation', async () => {
  const r = await run({ thanksTo: '/thank-you/', response: followed('https://evil.example/thank-you/?inbox=sent') });
  assert.deepEqual(r.did.assign, []);
  assert.equal(r.did.reload, 1);
});

await atest('303 followed, no thanks= → unchanged: in-page success card', async () => {
  const r = await run({ response: followed('https://site.example/contact/?inbox=sent') });
  assert.deepEqual(r.did.assign, []);
  assert.equal(r.did.reload, 0);
  assert.equal(r.successShown, true);
});

await atest('JSON refusal on a thanks= form still shows the error, no navigation (not_claimed sentence)', async () => {
  const res = { ...jsonOk, status: 404, json: () => Promise.resolve({ ok: false, reason: 'not_claimed' }) };
  const r = await run({ thanksTo: '/thank-you/', response: res });
  assert.deepEqual(r.did.assign, []);
  assert.equal(r.did.reload, 0);
  assert.equal(r.errorShown, true);
});

console.log('\ninbox-form-thanks-caller: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
