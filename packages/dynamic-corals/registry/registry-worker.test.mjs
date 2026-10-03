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

// ── The answer is a function of the path alone ───────────────────────────────────────────────────
// A deployment may bind this worker to more than one hostname: production, and a pre-release host
// that exists so the thing can be measured before production serves it. That measures the right
// thing only if the worker answers the same on every host — no channel override, no cache key, no
// origin allowlist, no "not production" Cache-Control. A pre-release check that is handed a
// different file from the one production will be handed is measuring a fiction.
//
// So: the same request on each host must get the same status, the same headers and the same body,
// and the worker must ask the asset store for the same key. Bodies are derived from the key on
// purpose — a store that returned one fixed string for every version would let a host that
// resolved a different channel pass on the body alone.
//
// What this cannot show: the store below stands in for the platform's ASSETS binding, which the
// worker hands the request's own origin. Whether the real binding also ignores the host it is
// handed is checked by fetching the same path from each live host after a deploy.
const HOSTS = ['https://feelreef.com', 'https://staging.feelreef.com', 'http://localhost:8787'];
const PATHS = [
  '/corals/sample/latest/sample.js',     // channel: short TTL, X-Coral-Resolved
  '/corals/sample/legacy/sample.js',     // a second channel, a second version
  '/corals/sample/1.0.0/sample.js',      // exact: immutable
  '/corals/sample/1.0.0/manifest.json',  // a version's own manifest
  '/corals/manifest.json',               // the channel table
  '/corals/sample/0.9.0/manifest.json',  // the specified JSON 404
  '/corals/sample/latest/missing.js',    // no such artifact
  '/corals/sample/nochannel/sample.js',  // unknown channel
  '/corals/nobody/latest/sample.js',     // unknown coral
  '/corals/sample',                      // wrong shape
];
const STORED = new Set(['/sample/1.0.0/sample.js', '/sample/0.9.0/sample.js', '/sample/1.0.0/manifest.json']);

// What one host says to one path, and which asset keys the worker asked for to say it.
async function observe(candidate, host, path) {
  const asked = [];
  const assets = {
    async fetch(url) {
      const key = new URL(url).pathname;
      asked.push(key);
      return STORED.has(key) ? new Response(`bytes of ${key}`) : new Response('missing', { status: 404 });
    },
  };
  const response = await candidate.fetch(new Request(host + path), { ASSETS: assets });
  return { status: response.status, headers: [...response.headers], body: await response.text(), asked };
}

// Every host + path whose answer differs from what the first host answers to the same path.
async function hostDifferences(candidate) {
  const differing = [];
  for (const path of PATHS) {
    const baseline = JSON.stringify(await observe(candidate, HOSTS[0], path));
    for (const host of HOSTS.slice(1)) {
      if (JSON.stringify(await observe(candidate, host, path)) !== baseline) differing.push(host + path);
    }
  }
  return differing;
}

test('worker answers every host the same: status, headers, body and asset key', async () => {
  assert.deepEqual(await hostDifferences(worker), []);
});

test('the host sweep covers served, missing and refused answers, and notices a worker that answers by host', async () => {
  // CONTROL for the sweep: it must be comparing real answers, not a row of identical 404s.
  const seen = await Promise.all(PATHS.map((path) => observe(worker, HOSTS[0], path)));
  assert.ok(seen.some((s) => s.status === 200 && s.asked.length === 1), 'no served artifact in the sweep');
  assert.ok(seen.some((s) => s.status === 404 && s.asked.length === 1), 'no missing artifact in the sweep');
  assert.ok(seen.some((s) => s.status === 404 && s.asked.length === 0), 'no refusal before the store in the sweep');
  const [latest, legacy] = await Promise.all(['latest', 'legacy']
    .map((channel) => observe(worker, HOSTS[0], `/corals/sample/${channel}/sample.js`)));
  assert.notEqual(latest.body, legacy.body, 'two channels serve the same bytes: a host that swapped them would pass');

  // CONTROL for the verdict: a worker that treats any host but the first differently must be
  // reported on every path for every other host, or the sweep above would pass on nothing.
  const staged = {
    async fetch(request, assets) {
      const answer = await worker.fetch(request, assets);
      if (new URL(request.url).host === new URL(HOSTS[0]).host) return answer;
      const headers = new Headers(answer.headers);
      headers.set('cache-control', 'no-store');
      return new Response(answer.body, { status: answer.status, headers });
    },
  };
  assert.equal((await hostDifferences(staged)).length, PATHS.length * (HOSTS.length - 1));
});
