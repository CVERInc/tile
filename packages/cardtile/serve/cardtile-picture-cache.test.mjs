// tile#339 step 1 — the picture route's own cache (picture-cache.mjs).
// run: node --test packages/cardtile/serve/cardtile-picture-cache.test.mjs
//
// 🔴 What this holds:
//   · a picture a lifetime has kept is answered without reading the page's body, and the answer is the
//     one the whole-file path gives, header for header and byte for byte;
//   · the cache never outlives the page: a stop, a delete and a new lifetime each take a WARM picture
//     down on the next request, with the one answer that host gives a handle that never existed;
//   · with the local switch unset — every deployment — the cache is never touched.
// Each safety test first proves the cache was warm and in use (the CONTROL), so its 404 is the guard
// firing and not an empty cache. Stop, resume and delete go through the real API and the real
// CardLifetime / HostBindings objects; only the Cache API and KV are stand-ins, and they say so below.
// The page, handle, domain and pictures are made up.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import worker from './card-worker.mjs';
import { handleApi, liveCard, cardKey, HostBindings, CardLifetime, _internal } from './card-api.mjs';
// a namespace, so a missing export fails its own test rather than the whole file
import * as AU from './asset-urls.mjs';
import * as PC from './picture-cache.mjs';

const HANDLE = 'tidepool';
const OTHER = 'saltmarsh';            // never created: what a handle with no page answers
const VHOST = 'links.tidepool-example.test';
const CANON = 'https://card.feelreef.com';
const TOKEN = 'a-made-up-bearer';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const bytesOf = (seed, n) => {
  const out = [];
  for (let i = 0, len = 0; len < n; i++) { const b = createHash('sha256').update(`${seed}:${i}`).digest(); out.push(b); len += b.length; }
  return Buffer.concat(out).subarray(0, n);
};
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const pic = (name, mime, n) => { const b = bytesOf(name, n); return { name, mime, b, hex: sha(b), ext: EXT[mime], id: `sha256-${sha(b).slice(0, 16)}` }; };
const P1 = pic('one', 'image/png', 30_000);
const P2 = pic('two', 'image/jpeg', 50_000);
const P3 = pic('three', 'image/webp', 20_000);
const Q = pic('next-owner', 'image/png', 25_000);
const cardOf = (title, pics) => [
  '---', `card-page: ${HANDLE}`, `title: ${title}`, '---', '', '## grid', '',
  ...pics.map((p) => `- [ ] %% card: feature w=6 img=asset:${p.id} %%`),
  '', '## assets', '', ...pics.map((p) => `- [ ] %% card: asset id=${p.id} mime=${p.mime} %% ${p.b.toString('base64')}`),
].join('\n') + '\n';
const CARD = cardOf('Tide Pool', [P1, P2, P3]);
const tail = (p) => `a/${p.hex}.${p.ext}`;
const shared = (p, handle = HANDLE) => `${CANON}/${handle}/${tail(p)}`;
const own = (p) => `https://${VHOST}/${tail(p)}`;

/** A Map-backed KV that records every key read. A stand-in for the shape: it cannot model the real
 *  store's eventual consistency. */
const fakeKv = () => {
  const m = new Map();
  const reads = [];
  return {
    _m: m, reads,
    async get(k) { reads.push(k); return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; },
  };
};
const doStorage = () => {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    async list({ prefix = '' } = {}) { return new Map([...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => [k, structuredClone(m.get(k))])); },
    _alarm: null, async setAlarm(t) { this._alarm = t; }, async getAlarm() { return this._alarm; },
  };
};
const objectNs = (Class, env) => {
  const objects = new Map();
  return {
    idFromName: (name) => ({ name }),
    get: ({ name }) => ({ async fetch(url, init) {
      if (!objects.has(name)) objects.set(name, new Class({ storage: doStorage() }, env));
      return objects.get(name).fetch(new Request(url, init));
    } }),
  };
};

/** A Map-backed stand-in for caches.default: it keeps what it is given under the key's URL and counts
 *  the calls. 🔴 It does NOT expire, evict, or differ between data centers — the three things the real
 *  cache does on its own — so nothing here proves the hour (PICTURE_CACHE_SECONDS); the tests read the
 *  header an entry is stored with instead. */
const fakeCache = () => {
  const kept = new Map();
  const calls = { match: [], put: [], hit: [] };
  return {
    kept, calls,
    async match(req) {
      calls.match.push(req.url);
      const e = kept.get(req.url);
      if (!e) return undefined;
      calls.hit.push(req.url);
      return new Response(e.body.slice(), { headers: e.headers });
    },
    async put(req, res) {
      calls.put.push(req.url);
      kept.set(req.url, { body: new Uint8Array(await res.arrayBuffer()), headers: [...res.headers] });
    },
  };
};
const useCache = (t, cache) => {
  const before = globalThis.caches;
  globalThis.caches = cache ? { default: cache } : undefined;
  t.after(() => { globalThis.caches = before; });
  return cache;
};

let TOKEN_HASH;
test.before(async () => { TOKEN_HASH = await _internal.sha256Hex(TOKEN); });

const api = (env, method, path, body) => {
  const url = new URL(CANON + path);
  return handleApi(new Request(url, {
    method, headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, url);
};
/** the thin page a save accepts; the pictures are then written where that save's body lives */
const thin = (md) => md.slice(0, md.indexOf('## assets'));
/** create HANDLE through the API (a real lifetime in the real object), then store the whole file — pictures
 *  included — under the key that save wrote. Returns the generation it lives in. */
async function create(env, md) {
  const res = await api(env, 'PUT', `/_api/card/${HANDLE}`, { markdown: thin(md), create: true });
  assert.equal(res.status, 200, 'CONTROL: the page was created through the API');
  const { gen } = (await res.json()).commit;
  env.CARDS._m.set(cardKey(HANDLE, gen), md);
  assert.equal((await liveCard(env.CARDS, HANDLE)).md, md, 'CONTROL: the whole file is what this lifetime serves');
  return gen;
}
async function world(opts = {}) {
  // `pictures: undefined` is the switch UNSET (no key in env at all); absent from opts, the adopted strategy
  const pictures = 'pictures' in opts ? opts.pictures : 'hybrid-preload-lazy';
  const { vanity = false } = opts;
  const env = { CARDS: fakeKv(), MCP_TOKEN_HASH: TOKEN_HASH, PREVIEW: 'false', ...(pictures !== undefined ? { CARDTILE_PICTURES: pictures } : {}) };
  env.HOST_BINDINGS = objectNs(HostBindings, env);
  env.CARD_LIFETIMES = objectNs(CardLifetime, env);
  const gen = await create(env, opts.md || CARD);
  // generation 0's own-domain binding is the pointer alone (card-api vanityKey)
  if (vanity) { env.CARDS._m.set(`vanity:${VHOST}`, HANDLE); env.CARDS._m.set(`vanityof:${HANDLE}`, VHOST); }
  return { env, gen };
}
/** one request through the cardtile worker; background work (ctx.waitUntil) is finished before it returns */
const get = async (url, env) => {
  const waiting = [];
  const from = env.CARDS.reads.length;
  const res = await worker.fetch(new Request(url, { redirect: 'manual' }), env, { waitUntil: (p) => waiting.push(p) });
  const body = Buffer.from(await res.arrayBuffer());
  await Promise.all(waiting);
  return { status: res.status, headers: Object.fromEntries(res.headers), body, reads: env.CARDS.reads.slice(from) };
};
const readBody = (reads) => reads.filter((k) => k.startsWith('card:') || k === HANDLE);
const same = (a, b, why) => {
  assert.equal(a.status, b.status, why);
  assert.deepEqual(a.headers, b.headers, why);
  assert.ok(a.body.equals(b.body), why);
};
/** CONTROL used by every safety test: this picture is answered from the cache, with no body read */
const assertWarm = async (url, env, cache, p) => {
  const hits = cache.calls.hit.length;
  const r = await get(url, env);
  assert.equal(r.status, 200, 'CONTROL: the picture answers');
  assert.ok(r.body.equals(p.b), 'CONTROL: with its own bytes');
  assert.equal(cache.calls.hit.length, hits + 1, 'CONTROL: the cache was warm for this picture');
  assert.deepEqual(readBody(r.reads), [], 'CONTROL: and the body was not read');
  return r;
};

// ── 1. the cache does its job ─────────────────────────────────────────────────────────────────────

test('🔴 #339 cache — a page view keeps its pictures, and each is then answered without reading the body', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env, gen } = await world();
  const page = await get(`${CANON}/${HANDLE}`, env);
  assert.equal(page.status, 200);
  const stored = (p) => `${CANON}/_picture-cache/${HANDLE}/${gen}/${p.hex}.${p.ext}`;
  assert.deepEqual(cache.calls.put.filter((u) => !u.includes('/set-')).sort(), [P1, P2, P3].map(stored).sort(), 'the page view kept its three pictures, under (handle, generation, hash)');
  for (const p of [P1, P2, P3]) {
    const r = await get(shared(p), env);
    assert.equal(r.status, 200);
    assert.ok(r.body.equals(p.b), `${p.name}: the bytes are the picture's`);
    assert.equal(sha(r.body), p.hex);
    assert.deepEqual(readBody(r.reads), [], `${p.name}: a kept picture must not read the page's body (read ${r.reads.join(', ')})`);
    assert.equal(r.headers['content-type'], p.mime);
    assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
});

test('🔴 #339 cache — the answer from the cache is the answer from the file: status, every header, every byte', async (t) => {
  const none = await world();
  useCache(t, null);
  const fromFile = {};
  for (const p of [P1, P2, P3]) fromFile[p.name] = await get(shared(p), none.env);
  const cache = fakeCache();
  globalThis.caches = { default: cache };
  const { env } = await world();
  for (const p of [P1, P2, P3]) {
    const cold = await get(shared(p), env);              // found in the file, then kept
    same(cold, fromFile[p.name], `${p.name}: the first (uncached) answer`);
    assert.notDeepEqual(readBody(cold.reads), [], 'CONTROL: the first answer did read the body');
    const warm = await assertWarm(shared(p), env, cache, p);
    same(warm, fromFile[p.name], `${p.name}: the cached answer`);
  }
});

test('🔴 #339 cache — a second page view writes nothing: one cache read finds the pictures kept', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env } = await world();
  await get(`${CANON}/${HANDLE}`, env);
  const puts = cache.calls.put.length, matches = cache.calls.match.length;
  assert.equal(puts, 4, 'CONTROL: the first view kept three pictures and one marker');
  await get(`${CANON}/${HANDLE}`, env);
  assert.equal(cache.calls.put.length, puts, 'the second view wrote to the cache again');
  assert.equal(cache.calls.match.length, matches + 1, 'the second view read the cache more than once');
});

test('🔴 #339 cache — an entry is kept for an hour, never the year the visitor is told', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env } = await world();
  await get(`${CANON}/${HANDLE}`, env);
  await get(shared(P1), env);
  assert.ok(cache.kept.size >= 4);
  for (const [key, e] of cache.kept) assert.equal(new Headers(e.headers).get('cache-control'), 'public, max-age=3600', key);
});

// ── 2. the cache never outlives the page ──────────────────────────────────────────────────────────

test('🔴 #339 cache — STOP: a warm picture answers the not-found answer at once, and serves again after resume', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env } = await world();
  await get(`${CANON}/${HANDLE}`, env);
  await assertWarm(shared(P1), env, cache, P1);
  const neverWas = await get(shared(P1, OTHER), env);
  assert.equal(neverWas.status, 404, 'CONTROL: a handle that never was');

  assert.equal((await api(env, 'PUT', `/_api/card/${HANDLE}/stop`, { reason: 'review' })).status, 200);
  assert.ok([...cache.kept.keys()].some((k) => k.endsWith(`${P1.hex}.${P1.ext}`)), 'CONTROL: the stop purged nothing; the picture is still in the cache');
  for (const p of [P1, P2, P3]) {
    const r = await get(shared(p), env);
    assert.equal(r.status, 404, `${p.name}: a stopped page's picture was served from a warm cache`);
    same(r, neverWas, `${p.name}: stopped must be the one answer a handle that never existed gets`);
    assert.ok(!r.body.includes(p.b.subarray(0, 64)), 'the 404 carries no picture bytes');
  }
  assert.equal((await api(env, 'DELETE', `/_api/card/${HANDLE}/stop`)).status, 200);
  await assertWarm(shared(P1), env, cache, P1);
});

test('🔴 #339 cache — DELETE: a warm picture answers the not-found answer at once, though its entry is still in the cache', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env } = await world();
  await get(`${CANON}/${HANDLE}`, env);
  for (const p of [P1, P2, P3]) await assertWarm(shared(p), env, cache, p);
  const neverWas = await get(shared(P1, OTHER), env);

  assert.equal((await api(env, 'DELETE', `/_api/card/${HANDLE}`)).status, 200);
  assert.equal((await liveCard(env.CARDS, HANDLE)).md, null, 'CONTROL: the page is gone');
  assert.equal([...cache.kept.keys()].filter((k) => !k.includes('/set-')).length, 3, 'CONTROL: the delete purged nothing; all three are still in the cache');
  for (const p of [P1, P2, P3]) {
    const r = await get(shared(p), env);
    assert.equal(r.status, 404, `${p.name}: a deleted page's picture was served from a warm cache`);
    same(r, neverWas, `${p.name}: deleted must be the one answer a handle that never existed gets`);
  }
});

test('🔴 #339 cache — NEW LIFETIME: the next page under the handle serves its own bytes and none of the last one\'s', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env, gen: first } = await world();
  await get(`${CANON}/${HANDLE}`, env);
  await assertWarm(shared(P1), env, cache, P1);
  assert.equal((await get(shared(Q), env)).status, 404, 'CONTROL: the first page has no such picture');

  assert.equal((await api(env, 'DELETE', `/_api/card/${HANDLE}`)).status, 200);
  const second = await create(env, cardOf('Next Owner', [Q]));
  assert.notEqual(second, first, 'CONTROL: the handle is in another generation');
  // the worst case: the old lifetime's entries are all still there, and so is a wrong one under the new
  // picture's name in the OLD lifetime
  cache.kept.set(`${CANON}/_picture-cache/${HANDLE}/${first}/${Q.hex}.${Q.ext}`, { body: new Uint8Array(P1.b), headers: [['cache-control', 'public, max-age=3600']] });
  assert.ok(cache.kept.has(`${CANON}/_picture-cache/${HANDLE}/${first}/${P1.hex}.${P1.ext}`), 'CONTROL: the last lifetime\'s picture is still in the cache');

  for (const p of [P1, P2, P3]) assert.equal((await get(shared(p), env)).status, 404, `${p.name}: the last owner's picture answered under the next owner's page`);
  const q = await get(shared(Q), env);
  assert.equal(q.status, 200);
  assert.ok(q.body.equals(Q.b), 'the new page\'s picture is its own bytes, not what an older lifetime kept under that name');
  await assertWarm(shared(Q), env, cache, Q);
  assert.ok(cache.kept.has(`${CANON}/_picture-cache/${HANDLE}/${second}/${Q.hex}.${Q.ext}`), 'and it is kept under the new generation');
});

test('🔴 #339 cache — VANITY HOST: one entry answers on the page\'s own domain and on the shared host; a stop takes both down', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env } = await world({ vanity: true });
  const page = await get(`https://${VHOST}/`, env);
  assert.equal(page.status, 200);
  assert.ok(page.body.toString('utf8').includes(`/${tail(P1)}`), 'CONTROL: the page on its own domain names the picture at the root');
  const puts = cache.calls.put.length;
  const onOwn = await assertWarm(own(P1), env, cache, P1);
  const onShared = await assertWarm(shared(P1), env, cache, P1);
  assert.equal(cache.calls.put.length, puts, 'both hosts read the one entry the page view wrote');
  assert.equal(onOwn.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(onOwn.headers['content-type'], P1.mime);
  assert.ok(onShared.body.equals(onOwn.body));
  const unbound = await get(`https://${VHOST}/a/${'0'.repeat(64)}.png`, env);
  assert.equal(unbound.status, 404, 'CONTROL: a picture this page does not have');

  assert.equal((await api(env, 'PUT', `/_api/card/${HANDLE}/stop`, { reason: 'review' })).status, 200);
  const stoppedOwn = await get(own(P1), env);
  assert.equal(stoppedOwn.status, 404, 'a stopped page\'s picture was served on its own domain from a warm cache');
  assert.equal(stoppedOwn.body.toString('utf8'), '<!doctype html><meta charset=utf-8><title>Not found</title><p>Nothing here.</p>', 'the small 404 a creator\'s domain gives, naming nothing');
  same(await get(shared(P1), env), await get(shared(P1, OTHER), env), 'and on the shared host: the one not-found answer');
});

test('🔴 #339 cache — a hash that is not on this page is a 404 and is never kept; another page\'s kept picture is not this page\'s', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env, gen } = await world();
  await get(`${CANON}/${HANDLE}`, env);
  const puts = cache.calls.put.length;
  assert.equal((await get(shared(Q), env)).status, 404);
  assert.equal(cache.calls.put.length, puts, 'a miss wrote to the cache');
  // the same bytes kept for ANOTHER handle answer nothing here
  cache.kept.set(`${CANON}/_picture-cache/${OTHER}/${gen}/${Q.hex}.${Q.ext}`, { body: new Uint8Array(Q.b), headers: [] });
  assert.equal((await get(shared(Q), env)).status, 404, 'another handle\'s entry was served under this one');
});

// ── 2b. a page view stays inside the invocation's subrequest budget ───────────────────────────────
//
// Review of tile PR #354, finding 2: 40 pictures cost 42 Cache API calls on one page view, after one or two
// YouTube fetches per channel, against the Workers Free plan's 50 per invocation (fetch and Cache API
// together). 🔴 The stand-ins impose no quota, so these tests COUNT: every Cache API call the page view
// makes and every fetch it makes, against the numbers picture-cache.mjs fits to.
const MANY = Array.from({ length: 40 }, (_, i) => pic(`many-${String(i).padStart(2, '0')}`, ['image/png', 'image/jpeg', 'image/webp'][i % 3], 2_000));
const channel = (i) => `UC${String(i).padStart(22, 'x')}`;
const richPage = (channels) => [
  '---', `card-page: ${HANDLE}`, 'title: Tide Pool', '---', '', '## front', '',
  ...MANY.map((p) => `- [ ] %% card: feature w=3 img=asset:${p.id} %%`),
  ...Array.from({ length: channels }, (_, i) => `- [ ] %% card: video channel=${channel(i)} %%`),
  '', '## assets', '', ...MANY.map((p) => `- [ ] %% card: asset id=${p.id} mime=${p.mime} %% ${p.b.toString('base64')}`),
].join('\n') + '\n';
/** every fetch is a YouTube feed that answers 404 (the designed no-poster state), counted */
const countFetches = (t) => {
  const before = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u && u.url ? u.url : u)); return new Response('', { status: 404 }); };
  t.after(() => { globalThis.fetch = before; });
  return urls;
};
const cacheCalls = (cache) => cache.calls.match.length + cache.calls.put.length;

test('🔴 #339 cache — 40 pictures and 9 channels: the page view spends at most 12 Cache API calls, on the first 10 pictures it draws', async (t) => {
  const cache = useCache(t, fakeCache());
  const fetched = countFetches(t);
  const { env, gen } = await world({ md: richPage(9) });
  const from = { calls: cacheCalls(cache), fetched: fetched.length };
  const page = await get(`${CANON}/${HANDLE}`, env);
  assert.equal(page.status, 200);
  const spentYt = fetched.length - from.fetched, spentCache = cacheCalls(cache) - from.calls;
  assert.equal(spentYt, 9, 'CONTROL: the page view fetched each channel once');
  assert.ok(spentCache <= 12, `the page view made ${spentCache} Cache API calls`);
  assert.ok(spentYt + spentCache <= 50 - 8, `the page view made ${spentYt + spentCache} subrequests`);
  const stored = (p) => `${CANON}/_picture-cache/${HANDLE}/${gen}/${p.hex}.${p.ext}`;
  assert.deepEqual(cache.calls.put.filter((u) => !u.includes('/set-')).sort(), MANY.slice(0, 10).map(stored).sort(), 'the pictures kept are not the first ten the page draws');
  assert.equal(cache.calls.put.filter((u) => u.includes('/set-')).length, 1, 'the ten were kept, so the marker was written');
  // the rest are left to the picture route: the eleventh is read from the file once, then kept
  const eleventh = MANY[10];
  const cold = await get(shared(eleventh), env);
  assert.equal(cold.status, 200);
  assert.ok(cold.body.equals(eleventh.b));
  assert.ok(cache.kept.has(stored(eleventh)), 'the picture route did not keep the eleventh');
  await assertWarm(shared(eleventh), env, cache, eleventh);
  // a second page view: one marker read, nothing written
  const puts = cache.calls.put.length;
  await get(`${CANON}/${HANDLE}`, env);
  assert.equal(cache.calls.put.length, puts, 'the second view wrote to the cache again');
  // the numbers the budget is fitted to (picture-cache.mjs)
  assert.equal(PC.PAGE_SUBREQUESTS, 50);
  assert.equal(PC.PAGE_SUBREQUESTS_HELD, 8);
  assert.equal(PC.PICTURE_PREFILL_CALLS, 12);
});

test('🔴 #339 cache — the prefill shrinks by what YouTube already spent, and stops when nothing is left', async (t) => {
  for (const [channels, most] of [[30, 12], [36, 6], [40, 0], [45, 0]]) {
    const cache = useCache(t, fakeCache());
    const fetched = countFetches(t);
    const { env } = await world({ md: richPage(channels) });
    const from = { calls: cacheCalls(cache), fetched: fetched.length };
    assert.equal((await get(`${CANON}/${HANDLE}`, env)).status, 200);
    const spentYt = fetched.length - from.fetched, spentCache = cacheCalls(cache) - from.calls;
    assert.equal(spentYt, channels, `CONTROL ${channels}: one fetch per channel`);
    assert.equal(spentCache, most, `${channels} channels: ${spentCache} Cache API calls, expected ${most}`);
    assert.equal(PC.prefillCalls(channels), most);
    // the YouTube resolution itself is uncapped (not this change); the prefill never adds past the line
    if (most) assert.ok(spentYt + spentCache <= PC.PAGE_SUBREQUESTS - PC.PAGE_SUBREQUESTS_HELD);
  }
});

// ── 3. the cache is never needed, and never trusted beyond its bytes ──────────────────────────────

test('🔴 #339 cache — no cache, a cache that throws, an empty entry: the picture still answers from the file', async (t) => {
  const { env } = await world();
  const broken = {
    'no caches global': null,
    'match and put throw': { match: async () => { throw new Error('cache down'); }, put: async () => { throw new Error('cache full'); } },
    'an entry with no body': { match: async () => new Response(new Uint8Array(0)), put: async () => {} },
    'an entry that is not a 200': { match: async () => new Response('nope', { status: 404 }), put: async () => {} },
  };
  const before = globalThis.caches;
  t.after(() => { globalThis.caches = before; });
  for (const [name, cache] of Object.entries(broken)) {
    globalThis.caches = cache ? { default: cache } : undefined;
    assert.equal((await get(`${CANON}/${HANDLE}`, env)).status, 200, `${name}: the page`);
    const r = await get(shared(P2), env);
    assert.equal(r.status, 200, name);
    assert.ok(r.body.equals(P2.b), name);
    assert.equal(r.headers['content-type'], P2.mime, name);
  }
});

test('🔴 #339 cache — the type comes from the URL, never from a header the cache returned', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env, gen } = await world();
  cache.kept.set(`${CANON}/_picture-cache/${HANDLE}/${gen}/${P1.hex}.${P1.ext}`, {
    body: new Uint8Array(P1.b), headers: [['content-type', 'text/html'], ['cache-control', 'no-store'], ['set-cookie', 'a=b'], ['x-made-up', '1']],
  });
  const r = await assertWarm(shared(P1), env, cache, P1);
  assert.deepEqual(Object.keys(r.headers).sort(), ['cache-control', 'content-type', 'x-content-type-options', 'x-robots-tag']);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
});

test('🔴 #339 cache — a generation the store did not write is neither kept nor looked up', async (t) => {
  const cache = useCache(t, fakeCache());
  const { env } = await world();
  const md = env.CARDS._m.get(cardKey(HANDLE, '0'));
  env.CARDS._m.set(`gen:${HANDLE}`, '../../x');           // a hand-written key: never the API's
  env.CARDS._m.set(cardKey(HANDLE, '../../x'), md);
  assert.equal((await get(`${CANON}/${HANDLE}`, env)).status, 200);
  const r = await get(shared(P1), env);
  assert.equal(r.status, 200);
  assert.ok(r.body.equals(P1.b));
  assert.deepEqual([cache.calls.match, cache.calls.put], [[], []], 'a generation outside the store\'s grammar reached the cache');
});

// ── 4. off is off ─────────────────────────────────────────────────────────────────────────────────

test('🔴 #339 cache — switch unset or unknown: the cache is never read or written, on the page or on a picture path', async (t) => {
  const cache = useCache(t, fakeCache());
  for (const pictures of [undefined, '', 'inline', 'hybrid']) {
    const { env } = await world({ pictures, vanity: true });
    assert.equal((await get(`${CANON}/${HANDLE}`, env)).status, 301);       // the page lives on its own domain
    assert.equal((await get(`https://${VHOST}/`, env)).status, 200);
    for (const url of [shared(P1), own(P1)]) {
      const r = await get(url, env);
      assert.equal(r.status, 404, `${pictures}: ${url}`);
      assert.deepEqual(readBody(r.reads), [], 'an unknown path reads no body');
    }
  }
  assert.deepEqual([cache.calls.match, cache.calls.put], [[], []], 'the cache was touched with the switch off');
  assert.equal(typeof AU.pictureStrategy, 'function');
});
