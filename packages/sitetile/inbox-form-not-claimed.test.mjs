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
import { readFileSync } from 'node:fs';
import { INBOX_FORM_SCRIPT, inboxOutcomeHelpers } from './inbox-form-script.js';
import { inboxFormCopy } from './inbox-form-copy.js';
import { parseSite, renderSiteToHtml } from './site-core.js';

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

test('🔴 reef#2204 mapping: not_claimed → errorNotClaimed; other refusals keep errorServer', () => {
  assert.equal(H.inboxErrorKey('not_claimed'), 'errorNotClaimed');
  for (const other of ['error', 'invalid_body', 'bad_kind', 'site_closed', '', undefined, null]) {
    assert.equal(H.inboxErrorKey(other), 'errorServer', `outcome ${JSON.stringify(other)} should still be the generic retry sentence`);
  }
});

test('mapping → copy: the sentence shown is the table\'s, and a payload WITHOUT errorNotClaimed (an older build) falls back to errorServer', () => {
  assert.equal(H.inboxErrorCopy(copy, 'not_claimed'), '這個網站目前沒有開放留言。');
  assert.equal(H.inboxErrorCopy(copy, 'invalid_body'), copy.errorServer);
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


// reef#2357: the database is full; neither a native submit nor AJAX should invite a retry.
const fullSentence = "This site's inbox is full and can't take new messages right now.";
const formSite = (lang = 'en-US') => parseSite(`---
sitetile-page: contact
lang: ${lang}
---

## Contact
%% sitetile: form action=inbox %%
### Message {textarea}
`);

await atest('reef#2357 JSON 507 inbox_storage_full shows the distinct non-retry sentence', async () => {
  const outcome = await H.inboxOutcomeOf({
    url: 'https://tniop.tw/__reef/inbox', status: 507,
    headers: { get: () => 'application/json' },
    json: async () => ({ ok: false, reason: 'inbox_storage_full' }),
  });
  assert.equal(H.inboxErrorKey(outcome), 'errorInboxStorageFull');
  assert.equal(H.inboxErrorCopy(inboxFormCopy('en-US'), outcome), fullSentence);
});

await atest('reef#2357 followed 303 inbox_storage_full uses the same non-retry copy', async () => {
  const outcome = await H.inboxOutcomeOf({ url: 'https://tniop.tw/contact/?inbox=inbox_storage_full' });
  assert.equal(H.inboxErrorCopy(inboxFormCopy('en-US'), outcome), fullSentence);
  assert.equal(H.inboxErrorCopy({ errorServer: 'older build' }, outcome), 'older build');
});

for (const [id, key] of [
  ['inbox-storage-full', 'errorInboxStorageFull'],
  ['inbox-not-claimed', 'errorNotClaimed'],
]) {
  for (const lang of ['en-US', 'ja-JP', 'zh-TW', 'zh-CN', 'ko-KR']) {
    test(`static no-script SSR: ${id} exists in ${lang} without a request query`, () => {
      const html = renderSiteToHtml(formSite(lang), { path: '/contact/' });
      const native = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
      assert.ok(native, 'static inbox reasons must be rendered inside noscript');
      const paragraphs = [...native[1].matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)];
      const reasons = paragraphs.filter((p) => p[1].includes(`id="${id}-0"`));
      assert.equal(reasons.length, 1, `${id} must occur exactly once`);
      assert.match(reasons[0][1], /\bhidden\b/, `${id} must be hidden until targeted`);
      assert.equal(reasons[0][2], inboxFormCopy(lang)[key]);
    });
  }
}

test('static markup is independent of the request outcome; the scripted error starts hidden', () => {
  const clean = renderSiteToHtml(formSite(), { path: '/contact/' });
  for (const reason of ['inbox_storage_full', 'not_claimed', 'sent', 'made_up']) {
    const html = renderSiteToHtml(formSite(), { path: `/contact/?inbox=${reason}#inbox-storage-full-0` });
    assert.equal(html, clean, 'static HTML must not depend on a future visitor query');
    const error = /<p\b([^>]*\bdata-inbox-error\b[^>]*)>/.exec(html);
    assert.match(error[1], /\bhidden\b/);
    assert.match(html, /name="return_to" value="\/contact\/"/);
  }
});

const multiForm = parseSite(readFileSync(new URL('./astro/content/form-thanks.md', import.meta.url), 'utf8'));
test('three inbox forms have distinct native reason ids', () => {
  const html = renderSiteToHtml(multiForm, { path: '/form-thanks/' });
  for (const prefix of ['inbox-storage-full', 'inbox-not-claimed']) {
    const ids = [...html.matchAll(new RegExp(`id="(${prefix}[^" ]*)"`, 'g'))].map((m) => m[1]);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3, `${prefix}: three inbox forms must have three distinct reason ids`);
  }
});
test('each inbox form posts its own two return fragments', () => {
  const html = renderSiteToHtml(multiForm, { path: '/form-thanks/' });
  const forms = [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)];
  assert.equal(forms.length, 3);
  for (const [index, [, form]] of forms.entries()) {
    const field = /<input type="hidden" name="return_fragment" value="([^"]+)"/.exec(form);
    assert.ok(field, `form ${index} must post return_fragment`);
    const fragments = JSON.parse(field[1].replace(/&quot;/g, '"'));
    assert.deepEqual(fragments, {
      inbox_storage_full: `inbox-storage-full-${index}`,
      not_claimed: `inbox-not-claimed-${index}`,
    });
    for (const id of Object.values(fragments)) assert.ok(form.includes(`id="${id}"`));
  }
});
test('return_fragment is reserved on the inbox wire', () => {
  const site = formSite();
  site.sections[0].fields.push({ label: 'return_fragment', kind: 'text' });
  const html = renderSiteToHtml(site);
  assert.match(html, /name="field_return_fragment"/);
  assert.equal([...html.matchAll(/name="return_fragment"/g)].length, 1);
});

console.log('\ninbox-form-not-claimed: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
