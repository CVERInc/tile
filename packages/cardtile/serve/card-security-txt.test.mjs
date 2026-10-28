// reef#2044 ③ — card.feelreef.com/.well-known/security.txt (RFC 9116) points at the report form.
// run: node --test card-security-txt.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './card-worker.mjs';

const OWN = 'links.creator-example.test';   // made-up vanity host
const CARD = ['---', 'card-page: maple', 'title: Maple', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 %% a bookbinder', ''].join('\n');

// 🔴 A KV double that records every read. security.txt is a constant: it must answer without the store.
const envWith = (extra = {}) => {
  const kv = new Map([['maple', CARD], [`vanity:${OWN}`, 'maple']]);
  const reads = [];
  return { reads, PREVIEW: 'false', CARDS: { get: async (k) => { reads.push(k); return kv.get(k) ?? null; }, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } }, ...extra };
};
const get = (url, env = envWith(), init = {}) => worker.fetch(new Request(url, { redirect: 'manual', ...init }), env);

const fields = (body) => body.split('\n').filter((l) => l && !l.startsWith('#'))
  .map((l) => /^([A-Za-z-]+):\s*(.*)$/.exec(l)).map((m) => (m ? [m[1].toLowerCase(), m[2].trim()] : ['!malformed', '']));

test('canonical host serves /.well-known/security.txt as text/plain, without touching the card store', async () => {
  const env = envWith();
  const res = await get('https://card.feelreef.com/.well-known/security.txt', env);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/plain;\s*charset=utf-8$/i);
  assert.deepEqual(env.reads, [], 'security.txt read the CARDS store');
  const body = await res.text();
  assert.ok(body.endsWith('\n'), 'the file ends with a newline');
  assert.ok(!/\r/.test(body) || /\r\n/.test(body), 'one line ending convention');
});

test('RFC 9116 fields: Contact = the public report form (no mailbox), Canonical = this URL, exactly one Expires', async () => {
  const body = await (await get('https://card.feelreef.com/.well-known/security.txt')).text();
  const f = fields(body);
  assert.ok(!f.some(([k]) => k === '!malformed'), `a non-comment line is not "Field: value":\n${body}`);
  const all = (k) => f.filter(([n]) => n === k).map(([, v]) => v);
  // ticket: 「指向檢舉表單」「不放客服信箱（零客服原則）」
  assert.deepEqual(all('contact'), ['https://feelreef.com/report']);
  assert.ok(!/mailto:|@/.test(body), 'no mailbox anywhere in the file (zero-support rule)');
  assert.deepEqual(all('canonical'), ['https://card.feelreef.com/.well-known/security.txt']);
  assert.equal(all('expires').length, 1, 'RFC 9116 §2.5.5: Expires MUST appear exactly once');
});

// 🔴 The control the file needs: RFC 9116's Expires is mandatory, so this file is BORN TO ROT. Same
// guard as feelreef.com's own security.txt: red 90 days before it lapses, so a person re-checks that
// the form still answers and moves the date — rather than the date silently passing.
test('control: Expires is a valid ISO date in the future (≥ 90 days left) and not more than a year out', async () => {
  const body = await (await get('https://card.feelreef.com/.well-known/security.txt')).text();
  const exp = fields(body).find(([k]) => k === 'expires')[1];
  assert.match(exp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, `Expires is not an RFC 3339 UTC timestamp: ${exp}`);
  const days = (Date.parse(exp) - Date.now()) / 86400000;
  assert.ok(days > 90, `security.txt expires in ${Math.round(days)} days (${exp}) — re-check the Contact still works, then move the date`);
  assert.ok(days <= 366, `Expires is ${Math.round(days)} days out — RFC 9116 §2.5.5 recommends less than a year`);
});

test('HEAD answers too (scanners probe with it)', async () => {
  const res = await get('https://card.feelreef.com/.well-known/security.txt', envWith(), { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/plain/);
});

// 🔴 Not on a creator's own domain. The ticket names `card.feelreef.com/.well-known/security.txt`,
// and its other ruling is 「不在作者的名片上放任何檢舉元素」: our report contact on THEIR domain is a
// report element on their card, and `Canonical: card.feelreef.com…` would be a file that RFC 9116
// §2.5.2 tells the reader not to trust there anyway. A vanity host keeps answering 404 as before.
test('a vanity host does not serve it (still the ordinary 404)', async () => {
  const res = await get(`https://${OWN}/.well-known/security.txt`);
  assert.equal(res.status, 404);
  assert.doesNotMatch(await res.text(), /Contact:/);
});

test('the kill switch still reaches it like every other exit', async () => {
  const res = await get('https://card.feelreef.com/.well-known/security.txt', envWith({ CARD_NOINDEX_ALL: '1' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
});
