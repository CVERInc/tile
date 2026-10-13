// Card save × Google Web Risk (reef#2044 ②).  run: node --test card-webrisk.test.mjs
//
// 🔴 The four destination cases are reef#2054 review v2's findings: places where a hand-written
// markdown extractor and the renderer disagree on where a link goes. Each asserts the URL the
// RENDERER emits is the one queried, so a guard that goes back to parsing markdown goes red here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { handleApi, _internal } from './card-api.mjs';
import { checkUrls } from './url-risk.mjs';

const TOKEN = 'webrisk-test-bearer';
const KEY = 'WR-KEY-must-never-leak-123';
let TOKEN_HASH;
test.before(async () => { TOKEN_HASH = await _internal.sha256Hex(TOKEN); });

const fakeKv = () => {
  const m = new Map();
  return { _m: m, puts: 0, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { this.puts++; m.set(k, v); } };
};
const mk = (...cells) => ['---', 'card-page: t', 'title: T', '---', '', '## grid', '', ...cells, ''].join('\n');

/** fetch stand-in: records every queried `uri`, answers listed ones as threats. */
function stubFetch({ listed = {}, status = 200, hang = false } = {}) {
  const queried = [];
  const urls = [];
  const fn = async (input, init) => {
    const u = new URL(String(input));
    urls.push(String(input));
    queried.push(u.searchParams.get('uri'));
    if (hang) return new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    if (status !== 200) return new Response('{}', { status });
    const t = listed[u.searchParams.get('uri')];
    return new Response(JSON.stringify(t ? { threat: { threatTypes: [t] } } : {}), { status: 200 });
  };
  return { fn, queried, urls };
}

async function save(md, { env = {}, fetch } = {}) {
  const store = fakeKv();
  const logs = [];
  const realFetch = globalThis.fetch, realLog = console.log, realWarn = console.warn;
  globalThis.fetch = fetch || (async () => { throw new Error('unexpected fetch'); });
  console.log = (...a) => logs.push(a.join(' '));
  console.warn = (...a) => logs.push(a.join(' '));
  try {
    const url = new URL('https://card.example/_api/card/t');
    const req = new Request(url, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ markdown: md }) });
    const res = await handleApi(req, { CARDS: store, MCP_TOKEN_HASH: TOKEN_HASH, ...env }, url);
    return { res, body: await res.json(), store, logs };
  } finally { globalThis.fetch = realFetch; console.log = realLog; console.warn = realWarn; }
}
const withKey = { WEB_RISK_API_KEY: KEY };

// ── the four reef#2054 v2 cases ──────────────────────────────────────────────────────────────────

test('2054#1 bare link cell `…/path!` — the queried URL keeps the `!` the renderer links to', async () => {
  const s = stubFetch({ listed: { 'https://evil.example/path!': 'MALWARE' } });
  const r = await save(mk('- [ ] %% card: link w=3 %% https://evil.example/path!'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://evil.example/path!']);
  assert.equal(r.res.status, 422);
  assert.deepEqual(r.body, { error: 'card_url_unsafe', url: 'https://evil.example/path!', threat: 'MALWARE' });
  assert.equal(r.store.puts, 0);
});

test('2054#2 `[x](https://evil.example/a(b)c)` — queries the href the renderer actually emits', async () => {
  const s = stubFetch({ listed: { 'https://evil.example/a(b': 'SOCIAL_ENGINEERING' } });
  const r = await save(mk('- [ ] %% card: link w=3 %% [x](https://evil.example/a(b)c)'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://evil.example/a(b']);
  assert.equal(r.res.status, 422);
  assert.equal(r.body.url, 'https://evil.example/a(b');
  assert.equal(r.store.puts, 0);
});

test('2054#3 feature `href=//evil.example/path` — queried as https://evil.example/path', async () => {
  const s = stubFetch({ listed: { 'https://evil.example/path': 'UNWANTED_SOFTWARE' } });
  const r = await save(mk('- [ ] %% card: feature href=//evil.example/path title=Visit %%'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://evil.example/path']);
  assert.equal(r.res.status, 422);
  assert.equal(r.store.puts, 0);
});

test('2054#4 `[x](https://e.example/a b)` — the renderer links nothing, so nothing is queried', async () => {
  const s = stubFetch({ listed: { 'https://e.example/a': 'MALWARE' } });
  const r = await save(mk('- [ ] %% card: link w=3 %% [x](https://e.example/a b)'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, []);
  assert.equal(r.res.status, 200);
  assert.equal(r.store.puts, 1);
});

// ── behaviour ────────────────────────────────────────────────────────────────────────────────────

test('clean destination → saved (control for the refusals above)', async () => {
  const s = stubFetch();
  const r = await save(mk('- [ ] %% card: link w=3 %% [Site](https://good.example/)'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://good.example/']);
  assert.equal(r.res.status, 200);
  assert.equal(r.store.puts, 1);
});

test('request asks for the three threat types', async () => {
  const s = stubFetch();
  await save(mk('- [ ] %% card: link w=3 %% [Site](https://good.example/)'), { env: withKey, fetch: s.fn });
  const q = new URL(s.urls[0]);
  assert.equal(q.origin + q.pathname, 'https://webrisk.googleapis.com/v1/uris:search');
  assert.deepEqual(q.searchParams.getAll('threatTypes'), ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE']);
});

test('no WEB_RISK_API_KEY → no call, saved, one log line', async () => {
  const s = stubFetch({ listed: { 'https://evil.example/path!': 'MALWARE' } });
  const r = await save(mk('- [ ] %% card: link w=3 %% https://evil.example/path!'), { fetch: s.fn });
  assert.equal(s.urls.length, 0);
  assert.equal(r.res.status, 200);
  assert.equal(r.logs.filter((l) => l.includes('url-risk')).length, 1);
});

test('5xx → fail open (saved), logged, key not in any log or response', async () => {
  const s = stubFetch({ status: 503 });
  const r = await save(mk('- [ ] %% card: link w=3 %% https://evil.example/path!'), { env: withKey, fetch: s.fn });
  assert.equal(r.res.status, 200);
  assert.equal(r.store.puts, 1);
  assert.ok(r.logs.some((l) => l.includes('url-risk')));
  assert.ok(!r.logs.join('\n').includes(KEY));
  assert.ok(!JSON.stringify(r.body).includes(KEY));
});

test('refusal response does not carry the key', async () => {
  const s = stubFetch({ listed: { 'https://evil.example/path!': 'MALWARE' } });
  const r = await save(mk('- [ ] %% card: link w=3 %% https://evil.example/path!'), { env: withKey, fetch: s.fn });
  assert.ok(!JSON.stringify(r.body).includes(KEY));
  assert.ok(!r.logs.join('\n').includes(KEY));
});

test('timeout → fail open, logged, key not logged', async () => {
  const s = stubFetch({ hang: true });
  const logs = [];
  const hit = await checkUrls(['https://slow.example/'], withKey, { fetch: s.fn, log: (l) => logs.push(l), timeoutMs: 30 });
  assert.equal(hit, null);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /timeout/);
  assert.ok(!logs[0].includes(KEY));
});

test('the same destination twice is queried once', async () => {
  const s = stubFetch();
  await save(mk('- [ ] %% card: link w=3 %% [a](https://dup.example/x)', '- [ ] %% card: link w=3 %% [b](https://dup.example/x)'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://dup.example/x']);
});

test('more than 50 URLs → not checked, allowed, logged', async () => {
  const s = stubFetch();
  const logs = [];
  const urls = Array.from({ length: 51 }, (_, i) => `https://u${i}.example/`);
  assert.equal(await checkUrls(urls, withKey, { fetch: s.fn, log: (l) => logs.push(l) }), null);
  assert.equal(s.urls.length, 0);
  assert.equal(logs.length, 1);
});

// ── structure: destinations come only from render output ─────────────────────────────────────────

test('url-risk.mjs / card-api.mjs / card-destinations.mjs hold no markdown-link regex', () => {
  for (const f of ['url-risk.mjs', 'card-api.mjs', 'card-destinations.mjs']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    // a markdown link pattern needs `\]\(` (or `]\(`) inside a regex literal or RegExp string
    assert.ok(!/\\\]\s*\\\(/.test(src) && !/\]\\\(/.test(src), `${f} parses markdown links`);
  }
  assert.match(readFileSync(new URL('card-destinations.mjs', import.meta.url), 'utf8'), /renderCardHTML\(/);
});
