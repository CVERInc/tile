import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { parseSite, renderSiteToHtml } from '../../sitetile/site-core.js';

const dir = mkdtempSync(join(tmpdir(), 'inbox-return-fragment-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const out = join(dir, 'worker.mjs');
const env = { ...process.env };
delete env.INBOX_FORWARD_SITE_KEY;
const emitted = spawnSync(process.execPath, [
  new URL('./emit-shop-function.mjs', import.meta.url).pathname,
  '--site-id', 'fragment-site', '--platform-origin', 'https://platform.example', '--out', out,
], { encoding: 'utf8', env });
assert.equal(emitted.status, 0, 'worker emission succeeds');
const worker = (await import(pathToFileURL(out))).default;

// Use the real renderer's hidden field, not a separately maintained wire fixture.
const html = renderSiteToHtml(parseSite(`---
sitetile-page: contact
lang: en-US
---

## Contact
%% sitetile: form action=inbox %%
### Message {textarea}
`), { path: '/contact/' });
const hidden = /name="return_fragment" value="([^"]+)"/.exec(html);
assert.ok(hidden, 'renderer posts a return_fragment table');
const table = hidden[1].replace(/&quot;/g, '"');
assert.deepEqual(JSON.parse(table), {
  inbox_storage_full: 'inbox-storage-full-0', not_claimed: 'inbox-not-claimed-0',
});

async function submit(t, { fragment = table, status = 507, reason = 'inbox_storage_full', fields = {}, failure = false } = {}) {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    sent = { url, opts, payload: JSON.parse(opts.body) };
    if (failure) throw new Error('offline');
    return new Response(JSON.stringify({ ok: status < 400, reason }), { status });
  });
  const body = new URLSearchParams({ return_to: '/contact/', ...fields });
  if (fragment !== null) body.set('return_fragment', fragment);
  const response = await worker.fetch(new Request('https://site.example/__reef/inbox', {
    method: 'POST', body, headers: { referer: 'https://site.example/contact/?ref=mail' },
  }), {});
  assert.equal(response.status, 303);
  return { location: response.headers.get('location'), sent };
}

for (const [status, reason, id] of [
  [507, 'inbox_storage_full', 'inbox-storage-full-0'],
  [404, 'not_claimed', 'inbox-not-claimed-0'],
]) {
  test(`generated worker: ${reason} targets the renderer's index-0 paragraph`, async (t) => {
    const { location } = await submit(t, { status, reason, fields: { thanks_to: '/thanks/' } });
    assert.equal(location, `/contact/?inbox=${reason}#${id}`);
  });
}

test('generated worker selects each capture independently through index 9999', async (t) => {
  const fragment = table.replace('storage-full-0', 'storage-full-9999').replace('not-claimed-0', 'not-claimed-1');
  for (const [reason, id] of [['inbox_storage_full', 'inbox-storage-full-9999'], ['not_claimed', 'inbox-not-claimed-1']]) {
    const { location } = await submit(t, { fragment, reason });
    assert.equal(location, `/contact/?inbox=${reason}#${id}`);
  }
});

for (const [name, fragment] of [
  ['absent', null], ['empty', ''], ['invalid JSON', '{'],
  ['extra whitespace', table.replace(',', ', ')],
  ['reordered keys', JSON.stringify({ not_claimed: 'inbox-not-claimed-0', inbox_storage_full: 'inbox-storage-full-0' })],
  ['missing key', '{"inbox_storage_full":"inbox-storage-full-0"}'],
  ['extra key', table.replace('}', ',"other":"value"}')],
  ['duplicate key', table.replace('}', ',"not_claimed":"inbox-not-claimed-1"}')],
  ['leading zero', table.replace('storage-full-0', 'storage-full-00')],
  ['negative index', table.replace('storage-full-0', 'storage-full--1')],
  ['five-digit index', table.replace('storage-full-0', 'storage-full-10000')],
  ['wrong prefix', table.replace('not-claimed-0', 'storage-full-0')],
  ['encoded fragment', table.replace('storage-full-0', 'storage-full-%30')],
  ['raw fragment injection', table.replace('storage-full-0', 'storage-full-0#other')],
  ['over 128 bytes', table + ' '.repeat(129)],
  ['multibyte input over cap', table.replace('storage-full-0', 'storage-full-' + '界'.repeat(20))],
]) {
  test(`generated worker rejects ${name} without adding a fragment`, async (t) => {
    for (const reason of ['inbox_storage_full', 'not_claimed']) {
      const { location } = await submit(t, { fragment, reason });
      assert.equal(location, `/contact/?inbox=${reason}`);
    }
  });
}

for (const [name, options, expected] of [
  ['success', { status: 200, fields: { thanks_to: '/thanks/' } }, '/thanks/?inbox=sent'],
  ['other refusal', { status: 429, reason: 'rate_limited' }, '/contact/?inbox=rate_limited'],
  ['missing reason', { status: 500, reason: '' }, '/contact/?inbox=error'],
  ['network error', { failure: true }, '/contact/?inbox=unavailable'],
  ['honeypot', { fields: { _hp: 'bot', thanks_to: '/thanks/' } }, '/thanks/?inbox=sent'],
]) {
  test(`generated worker adds no refusal fragment for ${name}`, async (t) => {
    const { location, sent } = await submit(t, options);
    assert.equal(location, expected);
    if (name === 'honeypot') assert.equal(sent, undefined, 'honeypot does not call the platform');
  });
}

test('generated worker preserves the platform payload and transport apart from the redirect-only table', async (t) => {
  const { sent, location } = await submit(t, { fields: {
    Name: 'Example', Message: 'Hello & goodbye', visitor_email: 'visitor@example.com',
    email_field: 'unused@example.com', kind: 'attacker', id: 'attacker', text: 'ignored',
    conversation_id: 'ignored', page_url: 'https://evil.example/', thanks_to: '/thanks/',
    return_to: '/contact/?ref=mail&inbox=stale', _hp: '',
  } });
  assert.equal(location, '/contact/?ref=mail&inbox=inbox_storage_full#inbox-storage-full-0');
  assert.equal(sent.url, 'https://platform.example/api/inbox');
  assert.deepEqual(sent.payload, {
    kind: 'site', id: 'fragment-site', fields: { Name: 'Example', Message: 'Hello & goodbye' },
    visitor_email: 'visitor@example.com', page_url: 'https://site.example/contact/?ref=mail', _hp: '',
  });
  assert.equal(sent.opts.method, 'POST');
  assert.deepEqual(sent.opts.headers, { 'content-type': 'application/json' });
  assert.equal(sent.opts.credentials, 'omit');
  assert.ok(sent.opts.signal instanceof AbortSignal);
});
