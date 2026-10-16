// tile#148 — the site Worker's /_yt/<id>.jpg: a YouTube line's poster, relayed so the visitor's browser
// never reaches i.ytimg.com before pressing play.
//   run: node packages/dynamic-corals/square-shop/yt-poster-relay.test.mjs
import assert from 'node:assert/strict';
import worker, { YT_POSTER_PATH, relayYoutubePoster } from './shop-function-template.js';
import { VIDEO_RE, posterPath } from '../../cardtile/yt.mjs';

console.log('yt-poster-relay');
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// A stand-in for the Workers runtime's fetch and caches.default, recording what was asked of each.
function harness(upstream) {
  const fetched = [], stored = new Map();
  globalThis.fetch = async (u) => { fetched.push(String(u)); return upstream(String(u)); };
  globalThis.caches = { default: {
    match: async (req) => (stored.has(req.url) ? stored.get(req.url).clone() : undefined),
    put: async (req, res) => { stored.set(req.url, res); },
  } };
  return { fetched, stored };
}
const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
const ID = 'K9j8H7g6F5d';
const req = (path, method = 'GET') => new Request('https://site.example' + path, { method });

await test('the route accepts exactly the path sitetile writes (cardtile posterPath) and the id shape VIDEO_RE accepts', () => {
  for (const id of [ID, 'dQw4w9WgXcQ', 'Ab_cd-EF012']) {
    assert.ok(VIDEO_RE.test(id));
    assert.equal(YT_POSTER_PATH.exec(posterPath(id))?.[1], id, posterPath(id));
  }
  // 🔴 the route pattern IS the open-proxy guard: anything VIDEO_RE refuses never reaches a URL
  for (const p of ['/_yt/short.jpg', '/_yt/K9j8H7g6F5dX.jpg', '/_yt/..%2F..%2Fx.jpg', '/_yt/K9j8H7g6F5d.png', '/_yt/K9j8H7g6F5d.jpg/x', '/x/_yt/K9j8H7g6F5d.jpg']) {
    assert.equal(YT_POSTER_PATH.exec(p), null, p);
  }
});

await test('a miss fetches i.ytimg.com hqdefault ONCE, relays the image, and caches it — the second request is the cache', async () => {
  const h = harness(() => jpeg());
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const r1 = await relayYoutubePoster(req(posterPath(ID)), ctx, ID);
  await Promise.all(waits);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('content-type'), 'image/jpeg');
  assert.equal(r1.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(h.fetched, ['https://i.ytimg.com/vi/' + ID + '/hqdefault.jpg']);
  const r2 = await relayYoutubePoster(req(posterPath(ID)), ctx, ID);
  assert.equal(r2.status, 200);
  assert.equal(h.fetched.length, 1, 'the second request went upstream again');
});

await test('🔴 the cache key is origin + path: `?1`, `?2`, … are the same poster — one upstream fetch, one entry (tile#150 L3)', async () => {
  const h = harness(() => jpeg());
  for (const q of ['?1', '?2', '', '?x=y']) assert.equal((await relayYoutubePoster(req(posterPath(ID) + q), {}, ID)).status, 200, q);
  assert.equal(h.fetched.length, 1, 'a query string went upstream again');
  assert.deepEqual([...h.stored.keys()], ['https://site.example' + posterPath(ID)]);
});

await test('🔴 an upstream answer that is not an image (or a 404, or a network error) is a 404, no-store, and NOT cached', async () => {
  for (const up of [
    () => new Response('<html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    () => new Response('', { status: 404, headers: { 'content-type': 'image/jpeg' } }),
    () => { throw new Error('offline'); },
  ]) {
    const h = harness(up);
    const r = await relayYoutubePoster(req(posterPath(ID)), {}, ID);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(h.stored.size, 0, 'a refused answer was stored');
  }
});

await test('only GET/HEAD', async () => {
  harness(() => jpeg());
  assert.equal((await relayYoutubePoster(req(posterPath(ID), 'POST'), {}, ID)).status, 405);
});

await test('the Worker routes /_yt/<id>.jpg to the relay on every site — before ASSETS, with no contract or shop', async () => {
  const h = harness(() => jpeg());
  // the template's baked config placeholder, as an emitted worker would carry it: the smallest site
  globalThis.__SHOP_CONFIG__ = {};
  let assets = 0;
  const env = { ASSETS: { fetch: async () => { assets++; return new Response('static'); } } };
  const r = await worker.fetch(req(posterPath(ID)), env, {});
  assert.equal(r.status, 200);
  assert.equal(assets, 0, 'the poster path fell through to the static assets');
  assert.equal(h.fetched.length, 1);
  // CONTROL: any other path still reaches ASSETS
  await worker.fetch(req('/about/'), env, {});
  assert.equal(assets, 1);
});

console.log(`  ${passed} passed`);
