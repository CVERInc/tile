import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'coral-registry-worker-'));
const workerPath = join(dir, 'registry-worker.mjs');
const source = readFileSync(new URL('./registry-worker.mjs', import.meta.url), 'utf8')
  // The channel table is the deployment's data and is aliased in at bundle time (see the worker's
  // header). Here it is a fixture: these tests are about resolution and headers, not about which
  // version anything is pinned to — and a test that needed the real table would be a test that
  // went red every time somebody shipped a coral.
  .replace("import manifest from 'coral-manifest';", "const manifest = { sample: { latest: '1.0.0', legacy: '0.9.0' } };");
if (source.includes("from 'coral-manifest'")) {
  throw new Error('registry-worker.test.mjs: the manifest import was not stubbed — its spelling moved, '
    + 'and this test would import a specifier that only a deployment can resolve.');
}
writeFileSync(workerPath, source);
const worker = (await import(pathToFileURL(workerPath).href)).default;

const manifestBody = JSON.stringify({ name: 'sample', version: '1.0.0' });
const env = {
  ASSETS: {
    async fetch(url) {
      const path = new URL(url).pathname;
      if (path === '/sample/1.0.0/manifest.json') return new Response(manifestBody);
      if (path === '/sample/1.0.0/sample.js' || path === '/sample/0.9.0/sample.js') {
        return new Response('console.log("sample")');
      }
      return new Response('missing', { status: 404 });
    },
  },
};

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('worker serves a version manifest as cacheable JSON', async () => {
  const response = await worker.fetch(new Request('https://feelreef.com/corals/sample/1.0.0/manifest.json'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(await response.json(), JSON.parse(manifestBody));
});

test('worker returns the specified JSON 404 for a legacy version without a manifest', async () => {
  const response = await worker.fetch(new Request('https://feelreef.com/corals/sample/0.9.0/manifest.json'), env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { error: 'no manifest for this version' });
});

test('worker leaves exact and channel JavaScript routes unchanged', async () => {
  const exact = await worker.fetch(new Request('https://feelreef.com/corals/sample/1.0.0/sample.js'), env);
  assert.equal(exact.headers.get('content-type'), 'application/javascript; charset=utf-8');
  assert.equal(exact.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const channel = await worker.fetch(new Request('https://feelreef.com/corals/sample/latest/sample.js'), env);
  assert.equal(channel.headers.get('content-type'), 'application/javascript; charset=utf-8');
  assert.equal(channel.headers.get('x-coral-resolved'), '1.0.0');
  assert.equal(await channel.text(), 'console.log("sample")');
});
