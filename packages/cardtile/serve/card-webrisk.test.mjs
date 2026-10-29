// Card save × Google Web Risk (reef#2044 ②).  run: node --test card-webrisk.test.mjs
//
// 🔴 The four destination cases are reef#2054 review v2's findings: places where a hand-written
// markdown extractor and the renderer disagree on where a link goes. Each asserts the URL the
// RENDERER emits is the one queried, so a guard that goes back to parsing markdown goes red here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { handleApi, CardLifetime, _internal } from './card-api.mjs';
import { checkUrls, ENDPOINT } from './url-risk.mjs';

const TOKEN = 'webrisk-test-bearer';
const KEY = 'WR-KEY-must-never-leak-123';
let TOKEN_HASH;
test.before(async () => { TOKEN_HASH = await _internal.sha256Hex(TOKEN); });

const fakeKv = () => {
  const m = new Map();
  const meta = new Map();
  return {
    _m: m, puts: 0,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: meta.get(k) ?? null }; },
    // `puts` counts EVERY write: since r3 a save writes its body and nothing else (card-api genKey)
    async put(k, v, opts) { this.puts++; m.set(k, v); if (opts?.metadata !== undefined) meta.set(k, opts.metadata); else meta.delete(k); },
  };
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

/** the handle's CardLifetime, where a card write runs since tile#209 (one object per handle, Map storage) */
const lifetimes = (env) => {
  const objects = new Map();
  const storage = () => { const m = new Map(); return { async get(k) { return m.get(k); }, async put(k, v) { m.set(k, v); }, async delete(k) { return m.delete(k); }, async list({ prefix = '' } = {}) { return new Map([...m].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))); } }; };
  return {
    idFromName: (name) => ({ name }),
    get: ({ name }) => ({ fetch(url, init) {
      if (!objects.has(name)) objects.set(name, new CardLifetime({ storage: storage() }, env));
      return objects.get(name).fetch(new Request(url, init));
    } }),
  };
};

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
    const workerEnv = { CARDS: store, MCP_TOKEN_HASH: TOKEN_HASH, ...env };
    workerEnv.CARD_LIFETIMES = lifetimes(workerEnv);
    const res = await handleApi(req, workerEnv, url);
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
  assert.equal(q.origin + q.pathname, ENDPOINT);
  assert.match(ENDPOINT, /\/v1\/uris:search$/);
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

// ── reef#2044 round 2: CSS url() destinations and an enforceable limit ───────────────────────────

const links = (n, extra = []) => [...Array.from({ length: n }, (_, i) => `- [ ] %% card: link w=3 %% [s${i}](https://u${i}.example/)`), ...extra];

test('r2#1 frontmatter `backdrop:` (plain text cell) — the CSS url() the renderer emits is queried', async () => {
  const s = stubFetch({ listed: { 'https://bad.example/bg.png': 'MALWARE' } });
  const md = ['---', 'card-page: t', 'title: T', 'backdrop: https://bad.example/bg.png', '---', '', '## grid', '', '- [ ] hello', ''].join('\n');
  const r = await save(md, { env: withKey, fetch: s.fn });
  assert.ok(s.queried.includes('https://bad.example/bg.png'));
  assert.equal(r.res.status, 422);
  assert.equal(r.body.url, 'https://bad.example/bg.png');
  assert.equal(r.store.puts, 0);
});

test('r2#2 embed bubbles `bg=` — the inline style url() is queried', async () => {
  const s = stubFetch({ listed: { 'https://bad.example/bubble.jpg': 'SOCIAL_ENGINEERING' } });
  const r = await save(mk('- [ ] %% card: embed bleed kind=bubbles images="https://i.example/1.png,https://i.example/2.png" bg=https://bad.example/bubble.jpg %%'), { env: withKey, fetch: s.fn });
  assert.ok(s.queried.includes('https://bad.example/bubble.jpg'));
  assert.equal(r.res.status, 422);
  assert.equal(r.store.puts, 0);
});

test('r2#3 50 benign + a 51st malicious — the 51st is queried and refused', async () => {
  const s = stubFetch({ listed: { 'https://bad.example/final': 'MALWARE' } });
  const r = await save(mk(...links(50, ['- [ ] %% card: link w=3 %% [last](https://bad.example/final)'])), { env: withKey, fetch: s.fn });
  assert.ok(s.queried.includes('https://bad.example/final'));
  assert.equal(r.res.status, 422);
  assert.equal(r.store.puts, 0);
});

test('r2#4 201 destinations → 422 card_too_many_links, zero queries, zero writes', async () => {
  const s = stubFetch();
  const r = await save(mk(...links(201)), { env: withKey, fetch: s.fn });
  assert.equal(r.res.status, 422);
  assert.equal(r.body.error, 'card_too_many_links');
  assert.match(r.body.message, /200/);
  assert.match(r.body.message, /201/);
  assert.equal(s.queried.length, 0);
  assert.equal(r.store.puts, 0);
});

test('r2#5 exactly 200 benign → saved, all 200 queried, at most 10 in flight', async () => {
  let inflight = 0, peak = 0;
  const s = stubFetch();
  const fn = async (...a) => { inflight++; peak = Math.max(peak, inflight); try { await new Promise((r) => setTimeout(r, 2)); return await s.fn(...a); } finally { inflight--; } };
  const r = await save(mk(...links(200)), { env: withKey, fetch: fn });
  assert.equal(r.res.status, 200);
  assert.equal(r.store.puts, 1);
  assert.equal(s.queried.length, 200);
  assert.ok(peak <= 10, `peak in flight ${peak}`);
});

test('r2#6 no key with 201 destinations → still saved unchecked (fail-open unchanged)', async () => {
  const r = await save(mk(...links(201)), { fetch: stubFetch().fn });
  assert.equal(r.res.status, 200);
});

// ── tile#127 round 3: the RENDERER registers destinations (no second parser) ────────────────────

test('r3#1 bubbles `bg=https://b\\000061d.example/x.png` — queries the author string AND what CSS decodes it to', async () => {
  // In a CSS quoted url() `\000061` is the letter `a`: the browser requests https://bad.example/x.png.
  const s = stubFetch({ listed: { 'https://bad.example/x.png': 'MALWARE' } });
  const r = await save(mk('- [ ] %% card: embed bleed kind=bubbles images="https://i.example/1.png,https://i.example/2.png" bg=https://b\\000061d.example/x.png %%'), { env: withKey, fetch: s.fn });
  assert.ok(s.queried.includes('https://b/000061d.example/x.png'), 'the author-written string is queried, as a URL parser reads it (r4: a backslash is a slash)');
  assert.ok(s.queried.includes('https://bad.example/x.png'), 'the CSS-decoded host the browser fetches is queried');
  assert.equal(r.res.status, 422);
  assert.equal(r.body.url, 'https://bad.example/x.png');
  assert.equal(r.store.puts, 0);
});

test('r3#2 `backdrop: …/a&#x2F;b.png` — <style> is raw text, so the author string is queried, not `a/b.png`', async () => {
  const s = stubFetch();
  const md = ['---', 'card-page: t', 'title: T', 'backdrop: https://bad.example/a&#x2F;b.png', '---', '', '## grid', '', '- [ ] hello', ''].join('\n');
  await save(md, { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://bad.example/a&#x2F;b.png']);
});

test('r3#3 plain text `Please type url(https://bad.example/x)` — no destination, saved untouched', async () => {
  const s = stubFetch({ listed: { 'https://bad.example/x': 'MALWARE' } });
  const r = await save(mk('- [ ] Please type url(https://bad.example/x) in the browser'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, []);
  assert.equal(r.res.status, 200);
  assert.equal(r.store.puts, 1);
});

test('r3#4 `backdrop: …/a&#x110000;` — no exception, the save takes the normal path', async () => {
  const s = stubFetch();
  const md = ['---', 'card-page: t', 'title: T', 'backdrop: https://e.example/a&#x110000;', '---', '', '## grid', '', '- [ ] hello', ''].join('\n');
  const r = await save(md, { env: withKey, fetch: s.fn });
  assert.equal(r.res.status, 200);
  assert.equal(r.store.puts, 1);
  assert.deepEqual(s.queried, ['https://e.example/a&#x110000;']);
});

// ── the ruler that lives only in tests: whatever URL the renderer prints, the registry heard ─────
//
// A DELIBERATELY LOOSE scan — every `https?://…` in the output, whatever the context. It is not a
// parser and must never reach execution code: its only job is to fail when someone adds an output
// point that does not go through the renderer's registry (`attrUrl` / `cssAttrUrl`).
import { renderCardHTML } from './card-worker.mjs';
import { cardDestinations } from './card-destinations.mjs';

test('every external URL in a feature-complete card\'s render was registered by the renderer', () => {
  const md = [
    '---', 'card-page: t', 'title: T', 'backdrop: https://cdn.example/backdrop.png', '---', '',
    '## grid', '',
    '- [ ] %% card: profile w=6 avatar=https://cdn.example/avatar.png %% hello [tagline](https://t.example/tag)',
    '- [ ] %% card: feature w=3 img=https://cdn.example/feat.png href=https://f.example/go title=Go %% eyebrow',
    '- [ ] %% card: feature w=3 img=https://cdn.example/bare.png href=//proto.example/p %%',
    '- [ ] %% card: embed kind=slider images="https://cdn.example/s1.png,https://cdn.example/s2.png" %%',
    '- [ ] %% card: embed kind=bubbles images="https://cdn.example/b1.png,https://cdn.example/b2.png" bg=https://cdn.example/bg.png %%',
    '- [ ] %% card: link w=3 iconimg=https://cdn.example/icon.png %% [Row](https://l.example/row)',
    '- [ ] %% card: link w=3 %% [Plain](https://p.example/plain)',
    '- [ ] %% card: social w=6 %% [IG](https://instagram.com/x)\n\t[X](https://twitter.com/x)',
    '- [ ] %% card: video w=6 yt=abcdefghijk poster=https://cdn.example/poster.jpg %% clip',
    '- [ ] %% card: text w=6 %% see [docs](https://d.example/docs?a=1&b=2) and [more](https://d.example/m)',
    '- [ ] %% card: feature w=3 href=#about title=More %% drawer',
    '',
    '## drawer: about | About', '',
    '- [ ] %% card: link w=3 %% [Inner](https://inner.example/in)',
    '- [ ] %% card: feature w=3 img=https://cdn.example/drawer.png %%',
    '',
  ].join('\n');
  const html = renderCardHTML(md, {});
  const registered = new Set(cardDestinations(md));
  const NOT_FETCHED = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);   // XML namespaces
  // Inline <script> text is renderer code (the click-to-load player's constants), never author input.
  // case-insensitive, and a protocol-relative `//host` counts too (registered as https)
  const seen = new Set((html.replace(/<script[\s\S]*?<\/script>/gi, '').match(/(?:https?:)?\/\/[a-z0-9][^"' )]*/gi) || []).map((u) => (u.startsWith('//') ? 'https:' + u : u)).map((u) => u.replace(/&amp;/g, '&').replace(/&quot;.*$/, '')).filter((u) => !NOT_FETCHED.has(u)));
  assert.ok(seen.size >= 15, `the scan must have something to scan (saw ${seen.size})`);
  const missing = [...seen].filter((u) => !registered.has(u));
  assert.deepEqual(missing, [], 'rendered but never registered by the renderer');
  assert.ok(registered.has('https://proto.example/p'), '//host is registered as https');
  assert.ok(![...registered].some((u) => u.startsWith('data:') || u.startsWith('/') || u.startsWith('#')));
});

test('r3b#1 `bg=` cannot break out of url() — exactly one url(), the evil host is never its own url()', () => {
  const md = ['---', 'card-page: t', 'title: T', '---', '', '## grid', '',
    "- [ ] %% card: embed kind=bubbles images=https://i.example/1.png bg=https://a.example/x'),url('https://evil.example/y %%", ''].join('\n');
  const html = renderCardHTML(md, {});
  const style = html.match(/style="background-image[^"]*"/g) || [];
  assert.equal(style.length, 1);
  assert.equal((style[0].match(/url\(/g) || []).length, 1, style[0]);
  assert.ok(!/url\(\s*['"&#;a-z0-9]*https:\/\/evil\.example/i.test(style[0]), 'evil.example is not a url() of its own');
  // every registered URL is what a browser fetches: the registry holds the author string and the
  // string actually written into url() — and the loose scan finds nothing outside the registry
  const reg = new Set(cardDestinations(md));
  const written = style[0].match(/url\('([^']*)'\)/)[1].replace(/&amp;/g, '&');
  assert.ok(reg.has(written), `the url() value ${written} is registered`);
  for (const u of (html.replace(/<script[\s\S]*?<\/script>/g, '').match(/https?:\/\/[^"' )]+/g) || [])) {
    if (u === 'http://www.w3.org/2000/svg' || u === 'http://www.w3.org/1999/xlink') continue;
    assert.ok([...reg].some((r) => r.startsWith(u) || u.startsWith(r)), `${u} unregistered`);
  }
});

// ── structure: destinations come only from render output ─────────────────────────────────────────

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
test('url-risk.mjs / card-api.mjs / card-destinations.mjs hold no markdown-link, href=, src= or url() extractor', () => {
  for (const f of ['url-risk.mjs', 'card-api.mjs', 'card-destinations.mjs']) {
    const src = stripComments(readFileSync(new URL(f, import.meta.url), 'utf8'));
    // a markdown link pattern needs `\]\(` (or `]\(`) inside a regex literal or RegExp string
    assert.ok(!/\\\]\s*\\\(/.test(src) && !/\]\\\(/.test(src), `${f} parses markdown links`);
    assert.ok(!/\bhref\b/i.test(src) && !/\bsrc\b/i.test(src), `${f} reads href/src out of markup`);
    assert.ok(!/url\\\(/i.test(src), `${f} extracts CSS url()`);
  }
  assert.match(readFileSync(new URL('card-destinations.mjs', import.meta.url), 'utf8'), /renderCardHTML\(/);
  assert.match(readFileSync(new URL('card-destinations.mjs', import.meta.url), 'utf8'), /onDestination/);
});

// ── tile#127 round 4 (補件4) ─────────────────────────────────────────────────────────────────────
const withFm = (extra, ...cells) => ['---', 'card-page: t', 'title: T', ...extra, '---', '', '## grid', '', ...cells, ''].join('\n');

test('r4#1 `accent:` is a colour or nothing — `red;background-image:url(https://evil.example/a)` adds no declaration, no destination', () => {
  const md = withFm(['accent: red;background-image:url(https://evil.example/a)'], '- [ ] hello');
  const html = renderCardHTML(md, {});
  assert.ok(!html.includes('evil.example'), 'the evil host is not in the page at all');
  assert.match(html, /--cp-accent:#0a8c8e[;}]/, 'falls back to the default accent');
  assert.deepEqual(cardDestinations(md), []);
});

test('r4#1b `accent:` keeps every legal colour spelling', () => {
  for (const c of ['#abc', '#abcd', '#aabbcc', '#aabbccdd', 'rgb(1, 2, 3)', 'rgba(1 2 3 / 50%)', 'hsl(120, 50%, 50%)', 'hsla(120,50%,50%,.5)', 'rebeccapurple', 'Red']) {
    const html = renderCardHTML(withFm([`accent: ${c}`], '- [ ] hello'), {});
    assert.ok(html.includes(`--cp-accent:${c};`), `${c} survives`);
  }
});

test('r4#1c other author CSS fields: bubbles `origin=` / `origin-narrow=` cannot add declarations either', () => {
  const md = withFm([], '- [ ] %% card: embed kind=bubbles images=https://i.example/1.png origin="1% 1%;background-image:url(https://evil.example/o)" origin-narrow="0 0}body{background:url(https://evil.example/n)" %%');
  const html = renderCardHTML(md, {});
  assert.ok(!html.includes('evil.example'), 'origin fields are positions or nothing');
  assert.match(html, /transform-origin:53% 76%/);
});

test('r4#2a `img="https://e.example/a b"` — Web Risk is asked about …/a%20b, what the browser requests', async () => {
  const s = stubFetch();
  await save(mk('- [ ] %% card: feature w=3 img="https://e.example/a b" %%'), { env: withKey, fetch: s.fn });
  assert.ok(s.queried.includes('https://e.example/a%20b'), JSON.stringify(s.queried));
  assert.ok(!s.queried.includes('https://e.example/a b'));
});

test('r4#2b `https://e.example/a\\b` — a backslash is a slash to an http URL parser', () => {
  const d = cardDestinations(mk('- [ ] %% card: feature w=3 img="https://e.example/a\\b" %%'));
  assert.ok(d.includes('https://e.example/a/b'), JSON.stringify(d));
  assert.ok(!d.some((u) => u.includes('\\')));
});

test('r4#2c U+0000 in `bg=` — the queried value carries U+FFFD (what CSS parses), never NUL', () => {
  const d = cardDestinations(mk('- [ ] %% card: embed kind=bubbles images=https://i.example/1.png bg="https://e.example/a\u0000b" %%'));
  assert.ok(d.some((u) => u.includes('%EF%BF%BD')), JSON.stringify(d));
  assert.ok(!d.some((u) => u.includes('\u0000') || u.includes('%00')));
});

test('r5#1 `img=` / `href=` written `https:/\\evil.example/x` — resolved like the browser, queried and refused (422)', async () => {
  const s = stubFetch({ listed: { 'https://evil.example/x': 'MALWARE' } });
  const r = await save(mk('- [ ] %% card: feature w=3 img="https:/\\evil.example/x" href="https:/\\evil.example/x" %%'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://evil.example/x']);
  assert.equal(r.res.status, 422);
  assert.equal(r.store.puts, 0);
});

test('r5#1b `HTTPS:/\\evil.example/x` — same', async () => {
  const s = stubFetch({ listed: { 'https://evil.example/x': 'MALWARE' } });
  const r = await save(mk('- [ ] %% card: feature w=3 img="HTTPS:/\\evil.example/x" href="HTTPS:/\\evil.example/x" %%'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://evil.example/x']);
  assert.equal(r.res.status, 422);
});

test('r5#1c `href="javascript:alert(1)"` and `data:` are not destinations (round 6: a same-host `/local/page` IS one — see r6#1)', () => {
  assert.deepEqual(cardDestinations(mk('- [ ] %% card: feature w=3 href="javascript:alert(1)" %%')), []);
  assert.deepEqual(cardDestinations(mk('- [ ] %% card: feature w=3 img="data:image/png;base64,AAAA" %%')), []);
});

test('r5#2d two spellings of one URL collapse to one query', async () => {
  const s = stubFetch();
  await save(mk('- [ ] %% card: feature w=3 img="https://e.example/a b" href="https://e.example/a%20b" %%'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://e.example/a%20b']);
});

// ── round 6 (review v5 #1): resolve against the REAL card URL; exempt only the card itself and local resource routes ──
import { LOCAL_RESOURCE_PREFIXES } from '../card-render.mjs';
const BASE6 = 'https://card.example/alice/';
const feat = (attrs) => mk(`- [ ] %% card: feature w=3 ${attrs} %%`);

test('r6#1 `href="/attacker"` on a shared host is another card — registered as the FULL url', () => {
  assert.deepEqual(cardDestinations(feat('href="/attacker"'), { base: BASE6 }), ['https://card.example/attacker']);
  assert.deepEqual(cardDestinations(feat('img="/attacker"'), { base: BASE6 }), ['https://card.example/attacker']);
});

test('r6#1b self URL (any spelling) and #fragment are not destinations', () => {
  for (const h of ['/alice', '/alice/', '/alice#x', '/alice/#x', 'https://card.example/alice', '#drawer']) {
    assert.deepEqual(cardDestinations(feat(`href="${h}"`), { base: BASE6 }), [], h);
  }
});

test('r6#1c local resource routes on the same origin are not destinations', () => {
  for (const p of ['/_icon/x.ico', '/_yt/abcdefghijk.jpg', '/_coral/qr-1.js']) {
    assert.deepEqual(cardDestinations(feat(`img="${p}"`), { base: BASE6 }), [], p);
  }
  // …but a lookalike that is not a route prefix is another page
  assert.deepEqual(cardDestinations(feat('href="/_iconx/a"'), { base: BASE6 }), ['https://card.example/_iconx/a']);
});

test('r6#1d no request (no base) → placeholder base, same rules', () => {
  assert.deepEqual(cardDestinations(feat('href="/attacker"')), ['https://card.invalid/attacker']);
  assert.deepEqual(cardDestinations(feat('href="/card"')), []);
  assert.deepEqual(cardDestinations(feat('img="/_icon/x.ico"')), []);
});

test('r6#1e PUT uses the request origin as base — `/attacker` is queried and refused (422)', async () => {
  const s = stubFetch({ listed: { 'https://card.example/attacker': 'SOCIAL_ENGINEERING' } });
  const r = await save(feat('href="/attacker"'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, ['https://card.example/attacker']);
  assert.equal(r.res.status, 422);
  assert.equal(r.store.puts, 0);
});

test('r6#1f PUT with dry_run takes the same path', async () => {
  const s = stubFetch({ listed: { 'https://card.example/attacker': 'SOCIAL_ENGINEERING' } });
  const store = fakeKv();
  const url = new URL('https://card.example/_api/card/t');
  const realFetch = globalThis.fetch; globalThis.fetch = s.fn;
  try {
    const req = new Request(url, { method: 'PUT', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ markdown: feat('href="/attacker"'), dry_run: true }) });
    // (CARD_LIFETIMES bound: since tile#209 r3 a dry run's lock/size check is the handle's object's)
    const env = { CARDS: store, MCP_TOKEN_HASH: TOKEN_HASH, ...withKey };
    env.CARD_LIFETIMES = lifetimes(env);
    const res = await handleApi(req, env, url);
    assert.equal(res.status, 422);
  } finally { globalThis.fetch = realFetch; }
});

test('r6#1g PUT: the card\'s own URL and a local route are not queried', async () => {
  const s = stubFetch();
  const r = await save(mk('- [ ] %% card: feature w=3 href="/t" img="/_icon/x.ico" %%'), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, []);
  assert.equal(r.res.status, 200);
});

test('r6#1h renderCardHTML forwards destinationBase to the renderer', () => {
  const seen = [];
  renderCardHTML(feat('href="/attacker"'), { destinationBase: BASE6, onDestination: (u) => seen.push(u) });
  assert.deepEqual(seen, ['https://card.example/attacker']);
});

// ── round 7 (review v6 #1/#3): only inert ASSET routes are exempt; a page a browser can navigate to is a destination ──
import worker from './card-worker.mjs';
import { QR_VERSION } from './card-assets.mjs';
const PREVIEW_ID = '0123456789abcdef0123456789abcdef';
const YT_ID = 'dQw4w9WgXcQ';

test('r7#1 LOCAL_RESOURCE_PREFIXES is exactly the three inert asset routes', () => {
  assert.deepEqual([...LOCAL_RESOURCE_PREFIXES].sort(), ['/_coral/', '/_icon/', '/_yt/']);
});

test('r7#1b navigable routes are destinations, registered as the FULL url', () => {
  const b = { base: BASE6 };
  assert.deepEqual(cardDestinations(feat(`href="/_preview/${PREVIEW_ID}"`), b), [`https://card.example/_preview/${PREVIEW_ID}`]);
  assert.deepEqual(cardDestinations(feat('href="/try/"'), b), ['https://card.example/try/']);
  assert.deepEqual(cardDestinations(feat('href="/edit"'), b), ['https://card.example/edit']);
  assert.deepEqual(cardDestinations(feat('href="/_api/card/x"'), b), ['https://card.example/_api/card/x']);
});

test('r7#1c asset routes are still not destinations', () => {
  const b = { base: BASE6 };
  assert.deepEqual(cardDestinations(feat('src="/_icon/x.ico"'), b), []);
  assert.deepEqual(cardDestinations(feat(`src="/_yt/${YT_ID}.jpg"`), b), []);
});

test('r7#1d PUT refuses a listed preview URL (422, queried as the full url)', async () => {
  const u = `https://card.example/_preview/${PREVIEW_ID}`;
  const s = stubFetch({ listed: { [u]: 'SOCIAL_ENGINEERING' } });
  const r = await save(feat(`href="/_preview/${PREVIEW_ID}"`), { env: withKey, fetch: s.fn });
  assert.deepEqual(s.queried, [u]);
  assert.equal(r.res.status, 422);
  assert.equal(r.store.puts, 0);
});

// Semantic route policy: drive the real Worker. Every exempt prefix must answer with something that is NOT html;
// the navigable routes must answer html AND stay out of the exemption list. A new HTML-serving prefix added to the
// exemption list turns the first loop red; a new exemption for an existing HTML route turns the second red.
test('r7#3 exempt prefixes serve non-HTML; navigable routes serve HTML and are not exempt', async () => {
  const kv = fakeKv();
  const env = { CARDS: kv, MCP_TOKEN_HASH: TOKEN_HASH };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png' } });
  const ct = async (req) => (await worker.fetch(req, env)).headers.get('content-type') || '';
  try {
    const rep = {
      '/_icon/': 'https://card.example/_icon/example.com.ico',
      '/_yt/': `https://card.example/_yt/${YT_ID}.jpg`,
      '/_coral/': `https://card.example/_coral/qr-${QR_VERSION}.js`,
    };
    for (const p of LOCAL_RESOURCE_PREFIXES) {
      assert.ok(rep[p], `exempt prefix with no representative URL (add one, and prove it is not HTML): ${p}`);
      const c = await ct(new Request(rep[p]));
      assert.ok(c && !/text\/html/i.test(c), `${p} → content-type ${JSON.stringify(c)}`);
      console.log(`# r7#3 content-type ${new URL(rep[p]).pathname} -> ${c}`);
    }
    // a preview parked through the API, then fetched
    const pr = await worker.fetch(new Request('https://card.example/_api/preview', { method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice', markdown: mk('- [ ] %% card: feature w=3 %% hi') }) }), env);
    const pid = new URL((await pr.json()).url).pathname.split('/').pop();
    const nav = {
      '/_preview/': `https://card.example/_preview/${pid}`,
      '/try/': 'https://card.example/try/edit',
      '/edit': 'https://card.example/edit?host=https%3A%2F%2Ffeelreef.com',
    };
    for (const [prefix, u] of Object.entries(nav)) {
      const c = await ct(new Request(u));
      assert.match(c, /text\/html/i, `${u} → ${c}`);
      console.log(`# r7#3 content-type ${new URL(u).pathname} -> ${c}`);
      const path = new URL(u).pathname;
      assert.ok(!LOCAL_RESOURCE_PREFIXES.some((x) => path.startsWith(x) || path + '/' === x), `HTML route is exempt: ${path}`);
    }
  } finally { globalThis.fetch = realFetch; }
});

// r8: a successful upstream answer is only forwarded when its content-type is an allowed raster image. The
// body of anything else (html, svg — which can carry script) is never relayed; the response is pinned with nosniff
// and carries the NORMALISED allowed type, not the upstream string.
const proxied = async (path, upstream) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(upstream.body, { status: 200, headers: { 'content-type': upstream.type } });
  try {
    const res = await worker.fetch(new Request(`https://card.example${path}`), { CARDS: fakeKv(), MCP_TOKEN_HASH: TOKEN_HASH });
    return { res, body: await res.text() };
  } finally { globalThis.fetch = realFetch; }
};
const PROXY_PATHS = { icon: '/_icon/example.com.ico', yt: `/_yt/${YT_ID}.jpg` };
for (const [name, path] of Object.entries(PROXY_PATHS)) {
  test(`r8 ${name}: upstream text/html is not relayed`, async () => {
    const { res, body } = await proxied(path, { type: 'text/html; charset=utf-8', body: '<script>alert(1)</script>' });
    assert.equal(res.status, 404);
    assert.ok(!/text\/html/i.test(res.headers.get('content-type') || ''));
    assert.ok(!body.includes('<script>'));
  });
  test(`r8 ${name}: upstream image/svg+xml is not relayed`, async () => {
    const { res, body } = await proxied(path, { type: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
    assert.equal(res.status, 404);
    assert.ok(!/svg|html/i.test(res.headers.get('content-type') || ''));
    assert.ok(!body.includes('<script>'));
  });
  test(`r8 ${name}: upstream image/png is served with nosniff and the normalised type`, async () => {
    const { res, body } = await proxied(path, { type: 'IMAGE/PNG; charset=evil', body: 'x' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(body, 'x');
  });
}

// r9: only a response that passed the MIME check is cached; a rejected one is not (and is no-store + nosniff)
for (const [name, path] of [['icon', '/_icon/x.example.ico'], ['yt', `/_yt/${YT_ID}.jpg`]]) {
  test(`r9 ${name}: rejection is not cached; a validated image is`, async () => {
    const stored = new Map();
    const realFetch = globalThis.fetch, realCaches = globalThis.caches;
    globalThis.caches = { default: { match: async (r) => stored.get(r.url)?.clone(), put: async (r, v) => { stored.set(r.url, v); } } };
    const answers = [['text/html', '<script>'], ['image/png', 'x'], ['text/html', '<script>']];
    let n = 0;
    globalThis.fetch = async () => { const [t, b] = answers[n++]; return new Response(b, { status: 200, headers: { 'content-type': t } }); };
    const get = () => worker.fetch(new Request(`https://card.example${path}`), { CARDS: fakeKv(), MCP_TOKEN_HASH: TOKEN_HASH });
    try {
      const r1 = await get();
      assert.equal(r1.status, 404);
      assert.equal(r1.headers.get('cache-control'), 'no-store');
      assert.equal(r1.headers.get('x-content-type-options'), 'nosniff');
      const r2 = await get();
      assert.equal(r2.status, 200);
      assert.equal(r2.headers.get('content-type'), 'image/png');
      const r3 = await get(); // upstream would now say text/html — the cached image must answer
      assert.equal(r3.status, 200);
      assert.equal(r3.headers.get('content-type'), 'image/png');
      assert.equal(n, 2, 'the third request must not reach the upstream');
    } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; }
  });
}
