// reef#2758 — reef.cards/report. run: node --test card-report.test.mjs
//
// Three promises, each with its control: the page answers on reef.cards and nowhere else; a report
// becomes ONE message in the inbox feelreef reads, carrying the handle and the time; and input that is
// too big or not a report is refused by name before anything is sent.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import worker from './card-worker.mjs';
import * as R from './card-report.mjs';
import { LOCALE_KEYS } from '../w/sandbox-i18n.mjs';
import { scanBanned } from '../w2/banned-words.mjs';

const ON = { CARD_CANONICAL_HOST: 'reef.cards' };
const CARD = ['---', 'title: Test Card', '---', '', '## grid', '', '- [ ] %% card: text %% hello', ''].join('\n');
const store = (seed = {}) => {
  const kv = new Map(Object.entries({ t: CARD, feelreef: CARD, ...seed }));
  return { kv, get: async (k) => (kv.has(k) ? kv.get(k) : null), async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; }, put: async (k, v) => { kv.set(k, v); } };
};
const envOn = (extra = {}) => ({ PREVIEW: 'false', CARDS: store(), ...ON, ...extra });

/** Replace the global fetch for one test; every outbound request is recorded, `answer` decides the reply. */
async function withFetch(answer, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
const ok = () => new Response(JSON.stringify({ ok: true, conversation_id: 'c1' }), { status: 200, headers: { 'content-type': 'application/json' } });

const post = (body, headers = {}, host = 'reef.cards') => new Request(`https://${host}/report`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.7', ...headers },
  body: typeof body === 'string' ? body : new URLSearchParams(body).toString(),
});

// ── ① the page answers on reef.cards only ────────────────────────────────────────────────────────

test('reef#2758 ①: GET reef.cards/report is the form — no script, no third party, never indexed', async () => {
  const res = await worker.fetch(new Request('https://reef.cards/report'), envOn());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const body = await res.text();
  assert.match(body, /<form method="post" action="\/report"/);
  for (const r of R.REPORT_REASONS) assert.ok(body.includes(`name="reason" value="${r}"`), r);
  assert.match(body, /name="card"/);
  assert.match(body, /name="email" type="email"/);
  assert.doesNotMatch(body, /<script/i, 'the page loads no script at all');
  assert.doesNotMatch(body, /https?:\/\/(?!reef\.cards)[a-z0-9.-]+\.[a-z]/i, 'the page names no other origin');
  assert.match(res.headers.get('content-security-policy'), /script-src 'none'/);
  assert.match(res.headers.get('content-security-policy'), /form-action 'self'/);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  // the trailing-slash spelling is the same page
  assert.equal((await worker.fetch(new Request('https://reef.cards/report/'), envOn())).status, 200);
});

test('reef#2758 ①: every other host answers /report as it did before — never the form', async () => {
  const FORM = /<form method="post" action="\/report"/;
  // the switch off: reef.cards is dark, the report page included
  for (const off of [{}, { CARD_CANONICAL_HOST: 'evil.example' }]) {
    const res = await worker.fetch(new Request('https://reef.cards/report'), { PREVIEW: 'false', CARDS: store(), ...off });
    assert.equal(res.status, 404);
    assert.doesNotMatch(await res.text(), FORM);
  }
  // the old card host, switch off: `report` is just a handle nobody has (reserved in RSP) → the no-card page
  const old = await worker.fetch(new Request('https://card.feelreef.com/report'), { PREVIEW: 'false', CARDS: store() });
  assert.equal(old.status, 404);
  assert.doesNotMatch(await old.text(), FORM);
  // the old card host, switch on: a GET moves to reef.cards like any path
  const moved = await worker.fetch(new Request('https://card.feelreef.com/report?handle=t'), envOn());
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('location'), 'https://reef.cards/report?handle=t');
  // a creator's own domain: never our door (the ruling: no report element on an author's Card)
  const own = await worker.fetch(new Request('https://card.example/report'), { ...envOn(), CARDS: store({ 'vanity:card.example': 't' }) });
  assert.equal(own.status, 404);
  assert.doesNotMatch(await own.text(), FORM);
  // a test/dev host routes by path too, and still gets no form
  const dev = await worker.fetch(new Request('http://localhost:8787/report'), envOn());
  assert.doesNotMatch(await dev.text(), FORM);
});

test('reef#2758 ①: a POST anywhere but reef.cards sends nothing', async () => {
  await withFetch(ok, async (calls) => {
    for (const [host, env] of [['card.feelreef.com', envOn()], ['card.feelreef.com', { PREVIEW: 'false', CARDS: store() }], ['reef.cards', { PREVIEW: 'false', CARDS: store() }]]) {
      const res = await worker.fetch(post({ card: 'https://reef.cards/t', reason: 'scam_or_phishing' }, {}, host), env);
      assert.notEqual(res.status, 303, host);
    }
    assert.equal(calls.length, 0, 'a report was forwarded from a host that has no report door');
  });
});

test('reef#2758 ①: the doors\' URL contract prefills the address, escaped', async () => {
  assert.equal(R.reportHref(), 'https://reef.cards/report');
  assert.equal(R.reportHref({ handle: 'T' }), 'https://reef.cards/report?handle=t');
  assert.equal(R.reportHref({ card: 'https://card.example/' }), 'https://reef.cards/report?card=https%3A%2F%2Fcard.example%2F');
  const byHandle = await (await worker.fetch(new Request('https://reef.cards/report?handle=Inkbrush'), envOn())).text();
  assert.match(byHandle, /value="https:\/\/reef\.cards\/inkbrush"/);
  const byCard = await (await worker.fetch(new Request('https://reef.cards/report?card=https%3A%2F%2Fcard.example%2F'), envOn())).text();
  assert.match(byCard, /value="https:\/\/card\.example\/"/);
  const hostile = await (await worker.fetch(new Request(`https://reef.cards/report?card=${encodeURIComponent('"><script>alert(1)</script>')}`), envOn())).text();
  assert.doesNotMatch(hostile, /<script/i);
  assert.match(hostile, /value="&quot;&gt;&lt;script&gt;/);
  // CONTROL: a handle outside the grammar prefills nothing rather than a broken address
  const bad = await (await worker.fetch(new Request('https://reef.cards/report?handle=..%2Fx'), envOn())).text();
  assert.match(bad, /name="card"[^>]*value=""/);
});

// ── ② a report lands as ONE message, with the handle and the time ────────────────────────────────

const MASTER = 'test-master-secret';
const SITE_KEY = createHmac('sha256', MASTER).update('ext:feelreef').digest('hex'); // reef forwardSiteKey

test('reef#2758 ②: POST forwards ONE message to the inbox feelreef reads, with handle, time, reason and the reply address', async () => {
  await withFetch(ok, async (calls) => {
    const before = Date.now();
    const res = await worker.fetch(post({ card: 'reef.cards/T', reason: 'impersonation', email: 'me@example.org', lang: 'zh-TW' }), envOn({ INBOX_FORWARD_KEY: SITE_KEY }));
    const after = Date.now();
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/report?sent=1&lang=zh-TW');
    assert.equal(calls.length, 1, 'exactly one message');
    const [{ url, init }] = calls;
    assert.equal(url, 'https://feelreef.com/api/inbox');
    assert.equal(init.method, 'POST');
    const sent = JSON.parse(init.body);
    assert.equal(sent.kind, 'ext');
    assert.equal(sent.id, 'feelreef');
    assert.equal(sent.visitor_email, 'me@example.org', 'the address rides the field the 「已受理」 mail reads');
    assert.equal(sent.fields.handle, 't');
    assert.equal(sent.fields['卡片網址'], 'https://reef.cards/T');
    assert.equal(sent.fields['原因'], '冒充（impersonation）');
    const at = Date.parse(sent.fields['時間']);
    assert.ok(at >= before - 1000 && at <= after + 1000, `the time is the time of the report: ${sent.fields['時間']}`);
    assert.match(sent.fields['時間'], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(init.headers['accept-language'], 'zh-TW', 'the acknowledgement is written in the page language');
    // the signed-forward contract (reef ratelimit.ts verifyForward): per-visitor buckets
    const ts = init.headers['x-reef-forward-ts'];
    assert.equal(init.headers['x-reef-visitor-ip'], '203.0.113.7');
    assert.equal(init.headers['x-reef-forward-sig'], createHmac('sha256', SITE_KEY).update(`ext:feelreef\n203.0.113.7\n${ts}`).digest('hex'));
    // nothing the visitor sent is passed on
    assert.equal(init.headers.cookie, undefined);
    assert.equal(init.credentials, 'omit');
  });
  const done = await worker.fetch(new Request('https://reef.cards/report?sent=1&lang=zh-TW'), envOn());
  const body = await done.text();
  assert.match(body, /謝謝你，我們已收到你的檢舉。/);
  assert.doesNotMatch(body, /<form/);
});

test('reef#2758 ②: the inbox is a constant — fields naming another tenant change nothing', async () => {
  await withFetch(ok, async (calls) => {
    await worker.fetch(post('card=https%3A%2F%2Freef.cards%2Ft&reason=other&kind=site&id=victim&tenant=site%3Avictim'), envOn());
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual([sent.kind, sent.id], ['ext', 'feelreef']);
    assert.deepEqual(Object.keys(sent.fields).sort(), ['handle', '來源', '卡片網址', '原因', '時間'].sort());
    // no key configured: an ordinary unsigned forward (the platform's shared buckets), never a broken signature
    assert.equal(calls[0].init.headers['x-reef-forward-sig'], undefined);
  });
});

test('reef#2758 ②: the handle is worked out from the address — old addresses and a Card on its own domain too', async () => {
  const seed = { 'vanity:card.example': 'inkb', inkb: CARD };
  const cases = [
    ['https://reef.cards/', 'feelreef'],
    ['https://card.feelreef.com/Inkb?utm_source=qr', 'inkb'],
    ['https://feelreef.com/inkb', 'inkb'],
    ['https://card.example/', 'inkb'],
    // controls: a site page on the apex, an unbound domain → no handle, the report still files
    ['https://feelreef.com/pricing', '（無法判定）'],
    ['https://unbound.example/', '（無法判定）'],
  ];
  await withFetch(ok, async (calls) => {
    for (const [card] of cases) {
      const res = await worker.fetch(post({ card, reason: 'other' }), { ...envOn(), CARDS: store(seed) });
      assert.equal(res.status, 303, card);
    }
    assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).fields.handle), cases.map(([, h]) => h));
  });
});

test('reef#2758 ②: the honeypot is told "sent" and nothing is forwarded', async () => {
  await withFetch(ok, async (calls) => {
    const res = await worker.fetch(post({ card: 'https://reef.cards/t', reason: 'other', _hp: 'x' }), envOn());
    assert.equal(res.status, 303);
    assert.equal(calls.length, 0);
  });
});

test('reef#2758 ②: a refusal or outage upstream is never dressed up as 「已收到」', async () => {
  for (const [status, reason, code] of [[429, 'rate_limited', 429], [404, 'unavailable', 503], [503, 'unavailable', 503]]) {
    await withFetch(() => new Response('{}', { status }), async () => {
      const res = await worker.fetch(post({ card: 'https://reef.cards/t', reason: 'other', email: 'me@example.org' }), envOn());
      assert.equal(res.status, code, String(status));
      const body = await res.text();
      assert.match(body, new RegExp(`data-reason="${reason}"`));
      assert.match(body, /value="me@example\.org"/, 'what was typed is kept for the retry');
    });
  }
  await withFetch(() => { throw new Error('network'); }, async () => {
    const res = await worker.fetch(post({ card: 'https://reef.cards/t', reason: 'other' }), envOn());
    assert.equal(res.status, 503);
    assert.match(await res.text(), /data-reason="unavailable"/);
  });
});

// ── ③ too big or not a report: refused by name, nothing sent ─────────────────────────────────────

test('reef#2758 ③: oversized and malformed input is refused by name before anything is sent', async () => {
  const big = 'x'.repeat(R.REPORT_MAX_BODY_BYTES);
  const cases = [
    // [request, status, reason]
    [post(`card=https%3A%2F%2Freef.cards%2Ft&reason=other&pad=${big}`), 413, 'too_large'],
    [post({ card: `https://reef.cards/${'a'.repeat(R.REPORT_MAX_CARD_CHARS)}`, reason: 'other' }), 413, 'card_too_long'],
    [post({ card: 'https://reef.cards/t', reason: 'other', email: `${'a'.repeat(R.REPORT_MAX_EMAIL_CHARS)}@x.io` }), 413, 'email_too_long'],
    [post({ card: '', reason: 'other' }), 400, 'card_missing'],
    [post({ card: 'javascript:alert(1)', reason: 'other' }), 400, 'card_invalid'],
    [post({ card: 'https://u:p@reef.cards/t', reason: 'other' }), 400, 'card_invalid'],
    [post({ card: 'https://reef.cards/t\nBcc: x', reason: 'other' }), 400, 'card_invalid'],
    [post({ card: 'https://reef.cards/t', reason: 'spam' }), 400, 'reason_invalid'],
    [post({ card: 'https://reef.cards/t' }), 400, 'reason_invalid'],
    [post({ card: 'https://reef.cards/t', reason: 'other', email: 'not-an-address' }), 400, 'email_invalid'],
    [post({ card: 'https://reef.cards/t', reason: 'other' }, { origin: 'https://evil.example' }), 403, 'cross_origin'],
    [post(JSON.stringify({ card: 'https://reef.cards/t', reason: 'other' }), { 'content-type': 'application/json' }), 415, 'unsupported_type'],
  ];
  await withFetch(ok, async (calls) => {
    for (const [req, status, reason] of cases) {
      const res = await worker.fetch(req, envOn());
      assert.equal(res.status, status, reason);
      assert.match(await res.text(), new RegExp(`data-reason="${reason}"`), reason);
    }
    assert.equal(calls.length, 0, 'a refused report was forwarded');
    // CONTROL: the same well-formed report goes through, so the refusals above are about the input
    const res = await worker.fetch(post({ card: 'https://reef.cards/t', reason: 'other' }), envOn());
    assert.equal(res.status, 303);
    assert.equal(calls.length, 1);
  });
});

test('reef#2758 ③: a body with no declared length is still cut off at the ceiling, unread past it', async () => {
  let pulled = 0;
  const chunk = new TextEncoder().encode('a'.repeat(1024));
  const stream = new ReadableStream({ pull(c) { pulled++; if (pulled > 64) c.close(); else c.enqueue(chunk); } });
  const req = new Request('https://reef.cards/report', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: stream, duplex: 'half',
  });
  await withFetch(ok, async (calls) => {
    const res = await worker.fetch(req, envOn());
    assert.equal(res.status, 413);
    assert.match(await res.text(), /data-reason="too_large"/);
    assert.equal(calls.length, 0);
  });
  assert.ok(pulled < 10, `read ${pulled} KB of a body that was over its 2 KB ceiling`);
});

test('reef#2758 ③: other methods are refused', async () => {
  const res = await worker.fetch(new Request('https://reef.cards/report', { method: 'PUT', body: 'x' }), envOn());
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD, POST');
});

// ── words: the nine console locales ──────────────────────────────────────────────────────────────

test('reef#2758: the words exist in all nine console locales, and the page speaks the one asked for', async () => {
  assert.deepEqual(Object.keys(R.REPORT_WORDS).sort(), [...LOCALE_KEYS].sort());
  const keys = Object.keys(R.REPORT_WORDS.en).sort();
  for (const k of LOCALE_KEYS) {
    assert.deepEqual(Object.keys(R.REPORT_WORDS[k]).sort(), keys, k);
    for (const [key, v] of Object.entries(R.REPORT_WORDS[k])) assert.ok(typeof v === 'string' && v.trim(), `${k}.${key}`);
  }
  // the four reasons are reef#2758's own words in zh-TW
  assert.deepEqual(R.REPORT_REASONS.map((r) => R.REPORT_WORDS.zh[r]), ['冒充', '色情或暴力', '詐騙或釣魚', '其他']);
  assert.deepEqual(scanBanned({ report: R.REPORT_WORDS }), []);
  const ja = await worker.fetch(new Request('https://reef.cards/report?lang=ja'), envOn());
  const jaBody = await ja.text();
  assert.match(jaBody, /<html lang="ja-JP">/);
  assert.match(jaBody, /このカードを報告する/);
  const ko = await (await worker.fetch(new Request('https://reef.cards/report', { headers: { 'accept-language': 'ko-KR,en;q=0.5' } }), envOn())).text();
  assert.match(ko, /<html lang="ko-KR">/);
  // CONTROL: nothing asked for → English
  assert.match(await (await worker.fetch(new Request('https://reef.cards/report'), envOn())).text(), /<html lang="en-US">/);
});
