// Card save × Google Web Risk (reef#2044 ②).  run: node --test card-webrisk.test.mjs
//
// 🔴 The four destination cases are reef#2054 review v2's findings: places where a hand-written
// markdown extractor and the renderer disagree on where a link goes. Each asserts the URL the
// RENDERER emits is the one queried, so a guard that goes back to parsing markdown goes red here.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { handleApi, _internal } from './card-api.mjs';
import { checkUrls, ENDPOINT } from './url-risk.mjs';

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

test('r4#2d normalised duplicates collapse to one query', () => {
  const d = cardDestinations(mk('- [ ] %% card: feature w=3 img=https://e.example/x href=https://e.example/x %%'));
  assert.equal(d.filter((u) => u === 'https://e.example/x').length, 1);
});
