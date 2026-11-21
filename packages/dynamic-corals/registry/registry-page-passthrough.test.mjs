// reef#2165 — which side answers a /corals/* request: this worker, or the origin (the feelreef app,
// which serves the catalogue pages /corals and /corals/<id>, and each page's SvelteKit data route
// `<page>/__data.json` — fetched by every client-side navigation that lands on the page, the
// browser's Back button included). A table of paths, each through a real `Request` so the URL
// parser's own normalisation (dot segments, %2e) is part of what is measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'coral-registry-pages-'));
const workerPath = join(dir, 'registry-worker.mjs');
const source = readFileSync(new URL('./registry-worker.mjs', import.meta.url), 'utf8')
  .replace("import manifest from 'coral-manifest';", "const manifest = { sample: { v0: '1.0.0', latest: '1.0.0' } };");
if (source.includes("from 'coral-manifest'")) throw new Error('the manifest import was not stubbed');
writeFileSync(workerPath, source);
const worker = (await import(pathToFileURL(workerPath).href)).default;
test.after(() => rmSync(dir, { recursive: true, force: true }));

const JS = new Uint8Array([0x2f, 0x2a, 0x21, 0x00, 0xff, 0x0a]);
const env = {
  ASSETS: {
    async fetch(url) {
      const path = new URL(url).pathname;
      if (path === '/sample/1.0.0/sample.js') return new Response(JS);
      if (path === '/sample/1.0.0/manifest.json') return new Response('{"name":"sample"}');
      return new Response('missing', { status: 404 });
    },
  },
};

const originCalls = [];
globalThis.fetch = async (request) => {
  originCalls.push(new URL(request.url).pathname);
  return new Response('pages', { status: 200, headers: { 'x-from': 'origin' } });
};
const ask = async (path) => {
  originCalls.length = 0;
  const response = await worker.fetch(new Request(`https://feelreef.com${path}`), env);
  return { response, origin: originCalls.length };
};

for (const path of ['/corals', '/corals/', '/corals/events', '/corals/events/', '/corals/square-shop',
  '/corals/no-such-coral', '/corals/events/..', '/corals/events/.',
  '/corals/__data.json', '/corals/events/__data.json', '/corals/square-shop/__data.json',
  '/corals/events/__data.json?x-sveltekit-invalidated=01']) {
  test(`${path} → origin`, async () => {
    const { response, origin } = await ask(path);
    assert.equal(origin, 1);
    assert.equal(response.headers.get('x-from'), 'origin');
  });
}

const ASSETS = [
  ['/corals/sample/1.0.0/sample.js', 200, 'application/javascript; charset=utf-8', JS],
  ['/corals/sample/v0/sample.js', 200, 'application/javascript; charset=utf-8', JS],
  ['/corals//sample/1.0.0/sample.js', 200, 'application/javascript; charset=utf-8', JS],
  ['/corals/sample/latest/manifest.json', 200, 'application/json; charset=utf-8', new TextEncoder().encode('{"name":"sample"}')],
];
for (const [path, status, type, bytes] of ASSETS) {
  test(`${path} → this worker, bytes unchanged`, async () => {
    const { response, origin } = await ask(path);
    assert.equal(origin, 0);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-type'), type);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  });
}

test('/corals/manifest.json → this worker, the channel table', async () => {
  const { response, origin } = await ask('/corals/manifest.json');
  assert.equal(origin, 0);
  assert.deepEqual(await response.json(), { sample: { v0: '1.0.0', latest: '1.0.0' } });
});

for (const path of ['/corals//', '/corals//events', '/corals/events//', '/corals/events/v0', '/corals/a%2Fb',
  '/corals/sample%2Fv0%2Fsample.js', '/corals/%2E%2E%2Fx', '/corals/Events', '/corals/-x', '/corals/x.js',
  '/corals/x%20', '/corals/sample/v0/missing.js', '/corals/nope/v0/nope.js',
  // look like a data route, are not one
  '/corals//__data.json', '/corals/events//__data.json', '/corals/events/__data.json/',
  '/corals/events/__DATA.json', '/corals/events/__data%2Ejson', '/corals/Events/__data.json',
  // three or more segments is an artifact path, whatever the file is called
  '/corals/sample/v0/__data.json', '/corals/sample/v0/x/__data.json']) {
  test(`${path} → this worker, 404`, async () => {
    const { response, origin } = await ask(path);
    assert.equal(origin, 0);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  });
}
