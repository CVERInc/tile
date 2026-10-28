// Avatar-only image exits. Run: node --test packages/cardtile/serve/card-avatar.test.mjs
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import worker from './card-worker.mjs';

const HANDLE = 'pebble';
const HOST = 'links.example';
const REMOTE = 'https://images.example/portrait.png';
const ID = 'sha256-aaaaaaaaaaaaaaaa';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXZkAAAAASUVORK5CYII=', 'base64');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 7)]);
const SVG = Buffer.from('<svg><script>alert(1)</script></svg>');
const URLS = [`https://card.feelreef.com/${HANDLE}/avatar`, `https://${HOST}/avatar`, `https://${HOST}/${HANDLE}/avatar`];

const card = ({ avatar = '', mime = 'image/png', bytes = PNG, extra = [] } = {}) => [
  '---', `card-page: ${HANDLE}`, 'title: Pebble Studio', '---', '', '## grid', '',
  `- [ ] %% card: profile w=6${avatar ? ` avatar=${avatar}` : ''} %% a made-up potter`,
  ...extra,
  '', '## assets', '', `- [ ] %% card: asset id=${ID} mime=${mime} %% ${bytes.toString('base64')}`,
].join('\n') + '\n';
const STORED_CARD = card({ avatar: `asset:${ID}` });

function envWith(md, { stopped = false, handle = HANDLE } = {}) {
  const kv = new Map([[handle, md], [`vanity:${HOST}`, handle], [`vanityof:${handle}`, HOST]]);
  if (stopped) kv.set(`stop:${handle}`, 'stopped');
  return { PREVIEW: 'false', CARDS: { get: async (key) => kv.get(key) ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } } };
}
const get = (url, env) => worker.fetch(new Request(url, { redirect: 'manual' }), env);
const bytesOf = async (res) => Buffer.from(await res.arrayBuffer());

beforeEach((t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected upstream fetch'); });
  const previous = globalThis.caches;
  globalThis.caches = undefined;
  t.after(() => { globalThis.caches = previous; });
});

test('avatar path serves stored raster bytes on canonical and vanity hosts', async () => {
  for (const [mime, bytes] of [['image/png', PNG], ['image/webp', WEBP]]) {
    const env = envWith(card({ avatar: `asset:${ID}`, mime, bytes }));
    for (const url of URLS) {
      const res = await get(url, env);
      assert.equal(res.status, 200, url);
      assert.equal(res.headers.get('location'), null, 'an image must precede the vanity redirect');
      assert.equal(res.headers.get('content-type'), mime);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(await bytesOf(res), bytes);
    }
  }
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('avatar path relays a remote raster avatar and reuses its validated image cache', async () => {
  const cached = new Map();
  globalThis.caches = { default: {
    match: async (key) => cached.get(key.url)?.clone(),
    put: async (key, value) => { cached.set(key.url, value); },
  } };
  const upstream = globalThis.fetch;
  upstream.mock.mockImplementation(async (url) => {
    assert.equal(url, REMOTE);
    return new Response(PNG, { headers: { 'Content-Type': 'Image/PNG; charset=binary' } });
  });
  const env = envWith(card({ avatar: REMOTE }));
  for (const url of URLS) {
    for (const query of ['', '?cache=bust']) {
      const res = await get(url + query, env);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-robots-tag'), url === URLS[0] ? 'noindex, nofollow' : null);
      assert.deepEqual(await bytesOf(res), PNG);
    }
  }
  assert.equal(upstream.mock.calls.length, URLS.length, 'query strings must reuse the same cached image');
});

test('avatar path returns 404 without an avatar while icon routes keep their badge', async () => {
  const env = envWith(card());
  for (const url of URLS) {
    const res = await get(url, env);
    assert.equal(res.status, 404, url);
    assert.equal((await bytesOf(res)).length, 0, 'no generated badge or monogram');
  }
  for (const [path, type] of [['favicon.ico', 'image/x-icon'], ['favicon.svg', 'image/svg+xml'], ['apple-touch-icon.png', 'image/png']]) {
    const res = await get(`https://${HOST}/${path}`, env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), type);
    assert.ok((await bytesOf(res)).length > 0, `${path} must retain its badge fallback`);
  }
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('avatar path uses only the first profile avatar', async () => {
  const env = envWith(card({ extra: [`- [ ] %% card: profile w=6 avatar=asset:${ID} %% a second profile`] }));
  const res = await get(URLS[0], env);
  assert.equal(res.status, 404);
  assert.equal((await bytesOf(res)).length, 0);
});

test('avatar path returns 404 for stopped handles before fetching or reading the image cache', async (t) => {
  const match = t.mock.fn(async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));
  globalThis.caches = { default: { match } };
  const env = envWith(card({ avatar: REMOTE }), { stopped: true });
  for (const url of URLS) {
    const res = await get(url, env);
    assert.equal(res.status, 404, url);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.notEqual(res.headers.get('content-type'), 'image/png');
  }
  assert.equal(match.mock.calls.length, 0);
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('avatar path returns 404 for unknown handles on canonical and bound vanity hosts', async () => {
  for (const url of [...URLS, 'https://card.feelreef.com/missing/avatar']) {
    const res = await get(url, envWith(null));
    assert.equal(res.status, 404, url);
    assert.equal((await bytesOf(res)).length, 0);
  }
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('avatar path rejects missing or non-raster stored assets', async () => {
  const cards = [
    card({ avatar: `asset:${ID}`, mime: 'image/svg+xml', bytes: SVG }),
    card({ avatar: `asset:${ID}`, mime: 'text/html', bytes: Buffer.from('<script>1</script>') }),
    card({ avatar: 'asset:sha256-bbbbbbbbbbbbbbbb' }),
  ];
  for (const md of cards) {
    for (const url of URLS) {
      const res = await get(url, envWith(md));
      assert.equal(res.status, 404);
      assert.equal((await bytesOf(res)).length, 0);
    }
  }
});

test('avatar path rejects remote SVG and non-image responses without caching them', async (t) => {
  const put = t.mock.fn(async () => {});
  globalThis.caches = { default: { match: async () => null, put } };
  let type;
  const upstream = globalThis.fetch;
  upstream.mock.mockImplementation(async () => new Response(SVG, {
    headers: type ? { 'Content-Type': type } : {},
  }));
  for (type of ['image/svg+xml', 'Image/SVG+XML; charset=utf-8', 'text/html', 'application/octet-stream', '']) {
    const env = envWith(card({ avatar: 'https://images.example/portrait.svg' }));
    for (const url of URLS) {
      const res = await get(url, env);
      assert.equal(res.status, 404, type);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await bytesOf(res)).length, 0);
    }
  }
  assert.equal(upstream.mock.calls.length, 5 * URLS.length);
  assert.equal(put.mock.calls.length, 0);
});

test('avatar path returns 404 when the remote avatar is unavailable', async () => {
  let status;
  globalThis.fetch.mock.mockImplementation(async () => {
    if (status === 0) throw new Error('upstream unavailable');
    return new Response('', { status });
  });
  for (status of [0, 404, 503]) {
    const res = await get(URLS[0], envWith(card({ avatar: REMOTE })));
    assert.equal(res.status, 404);
    assert.equal((await bytesOf(res)).length, 0);
  }
});

test('avatar path applies the icon robots policy on platform and bound hosts', async () => {
  const env = envWith(STORED_CARD);
  for (const url of [URLS[0], `https://saas.feelreef.com/${HANDLE}/avatar`]) {
    const res = await get(url, env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  // reef#2618 r2: an unbound creator's domain routes no handle by path, the avatar included
  assert.equal((await get(`https://unbound.example/${HANDLE}/avatar`, env)).status, 404);
  assert.equal((await get(URLS[1], env)).headers.get('x-robots-tag'), null);
  assert.equal((await get(URLS[1], { ...env, PREVIEW: 'true' })).headers.get('x-robots-tag'), 'noindex, nofollow');
  for (const md of [card(), null]) {
    const res = await get(URLS[0], envWith(md));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
});

test('avatar path preserves the vanity page alias for a handle named avatar', async () => {
  const env = envWith(STORED_CARD, { handle: 'avatar' });
  const alias = await get(`https://${HOST}/avatar?from=old`, env);
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get('location'), `https://${HOST}/?from=old`);
  for (const url of ['https://card.feelreef.com/avatar/avatar', `https://${HOST}/avatar/avatar`]) {
    const res = await get(url, env);
    assert.equal(res.status, 200);
    assert.deepEqual(await bytesOf(res), PNG);
  }
});

test('avatar path rejects HTTP avatars before fetching or reading the image cache', async (t) => {
  const match = t.mock.fn(async () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));
  globalThis.caches = { default: { match } };
  const env = envWith(card({ avatar: 'http://images.example/portrait.png' }));
  for (const url of URLS) {
    const res = await get(url, env);
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await bytesOf(res)).length, 0);
  }
  assert.equal(match.mock.calls.length, 0);
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('avatar path rejects upstream redirects and fetches with manual redirect handling', async (t) => {
  const put = t.mock.fn(async () => {});
  globalThis.caches = { default: { match: async () => null, put } };
  const upstream = globalThis.fetch;
  upstream.mock.mockImplementation(async () => new Response(PNG, {
    status: 302,
    headers: { 'Content-Type': 'image/png', Location: 'https://redirect.example/portrait.png' },
  }));
  const res = await get(URLS[0], envWith(card({ avatar: REMOTE })));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await bytesOf(res)).length, 0);
  assert.equal(upstream.mock.calls.length, 1);
  assert.equal(upstream.mock.calls[0].arguments[0], REMOTE);
  assert.equal(upstream.mock.calls[0].arguments[1]?.redirect, 'manual');
  assert.equal(put.mock.calls.length, 0);
});

test('avatar path rejects oversized declared lengths without reading or caching the body', async (t) => {
  const put = t.mock.fn(async () => {});
  const pull = t.mock.fn((controller) => { controller.enqueue(PNG); controller.close(); });
  const cancel = t.mock.fn();
  globalThis.caches = { default: { match: async () => null, put } };
  globalThis.fetch.mock.mockImplementation(async () => new Response(
    new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
    { headers: { 'Content-Type': 'image/png', 'Content-Length': String(512 * 1024 + 1) } },
  ));
  const res = await get(URLS[0], envWith(card({ avatar: REMOTE })));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await bytesOf(res)).length, 0);
  assert.equal(pull.mock.calls.length, 0);
  assert.equal(cancel.mock.calls.length, 1);
  assert.equal(put.mock.calls.length, 0);
});

test('avatar path stops oversized streamed bodies before returning 200 or caching them', async (t) => {
  const put = t.mock.fn(async () => {});
  const chunks = [new Uint8Array(512 * 1024), new Uint8Array(1), new Uint8Array(1)];
  const pull = t.mock.fn((controller) => {
    if (chunks.length) controller.enqueue(chunks.shift()); else controller.close();
  });
  const cancel = t.mock.fn();
  globalThis.caches = { default: { match: async () => null, put } };
  globalThis.fetch.mock.mockImplementation(async () => new Response(
    new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
    { headers: { 'Content-Type': 'image/png' } },
  ));
  const res = await get(URLS[0], envWith(card({ avatar: REMOTE })));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await bytesOf(res)).length, 0);
  assert.equal(pull.mock.calls.length, 2);
  assert.equal(cancel.mock.calls.length, 1);
  assert.equal(put.mock.calls.length, 0);
});

test('avatar path relays a complete HTTPS raster at the byte cap', async () => {
  const bytes = Buffer.alloc(512 * 1024);
  PNG.copy(bytes);
  const upstream = globalThis.fetch;
  upstream.mock.mockImplementation(async (url, options) => {
    assert.equal(url, REMOTE);
    assert.equal(options.redirect, 'manual');
    return new Response(bytes, {
      headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) },
    });
  });
  const res = await get(URLS[0], envWith(card({ avatar: REMOTE })));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.deepEqual(await bytesOf(res), bytes);
  assert.equal(upstream.mock.calls.length, 1);
});
