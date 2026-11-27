// The registry worker never answers a redirect, and it refuses a path segment that could not have
// named a published file before it asks the asset store anything.
//
// Why a redirect matters here, of all places: a coral is loaded as `<script type="module" src=…>`
// and a module's base URL (`import.meta.url`, and so every relative import it makes) is the URL the
// browser ENDED on after redirects. A registry that redirected would let whoever chose the Location
// choose where the coral thinks it lives. The asset store is the realistic source of one: a static
// asset platform that "helps" with trailing slashes or `.html` answers 307/308 for keys it does not
// hold verbatim, and a worker that relayed the store's answer would relay that.
//
// What is measured: every route shape the worker serves, each through a real `Request` so the URL
// parser's own normalisation (dot segments, `%2e`, backslashes) is part of the measurement, crossed
// with odd spellings of it — trailing slash, dot segments, percent-encoded slash and dots,
// uppercase, empty segments. Two hostile stand-ins sit behind it:
//   · an asset store that answers 308 + Location for every key it does not hold, and that DECODES
//     percent-escapes and resolves dot segments in the key before looking it up (what a lenient
//     static server may do, and the reason the segment rule below has to run before the store);
//   · an origin that answers 308 + Location for everything. The page routes (reef#2165) are handed to
//     the origin and its answer is relayed unchanged — that is the one place a 3xx can come out, it is
//     the origin's and not this worker's, and the test pins that only the page SHAPES ever get there.
//
// "Segment": a non-empty `/`-separated piece of the pathname after `/corals`, as the worker sees it
// (after the URL parser). Empty segments (`//`) are collapsed by the worker, not refused: the
// existing passthrough test pins `/corals//sample/1.0.0/sample.js` as served, and it does name a
// published file. Every published file name (`<coral>.js`, `manifest.json`), coral id, version and
// channel name is made of `[A-Za-z0-9._-]`, so a segment outside that set — or one made only of dots —
// could not have named one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'coral-registry-no-redirect-'));
const workerPath = join(dir, 'registry-worker.mjs');
const TABLE = { sample: { latest: '1.0.0', legacy: '0.9.0' } };
const source = readFileSync(new URL('./registry-worker.mjs', import.meta.url), 'utf8')
  .replace("import manifest from 'coral-manifest';", `const manifest = ${JSON.stringify(TABLE)};`);
if (source.includes("from 'coral-manifest'")) throw new Error('the manifest import was not stubbed');
writeFileSync(workerPath, source);
const worker = (await import(pathToFileURL(workerPath).href)).default;
test.after(() => rmSync(dir, { recursive: true, force: true }));

const ORIGIN = 'https://feelreef.com';
const STORED = new Set(['/sample/1.0.0/sample.js', '/sample/0.9.0/sample.js', '/sample/1.0.0/manifest.json']);

// The lenient store: decodes, resolves dot segments, then looks up; anything else is a redirect.
function lenientStore(asked) {
  return {
    async fetch(url) {
      const raw = new URL(url).pathname;
      asked.push(raw);
      let key;
      try { key = posix.normalize(decodeURIComponent(raw)); } catch { key = raw; }
      if (STORED.has(key)) return new Response(`bytes of ${key}`);
      return new Response(null, { status: 308, headers: { location: `${ORIGIN}/elsewhere${raw}/` } });
    },
  };
}

const originCalls = [];
globalThis.fetch = async (request) => {
  originCalls.push(new URL(request.url).pathname);
  return new Response(null, { status: 308, headers: { location: `${ORIGIN}/somewhere-else` } });
};

async function ask(path) {
  const asked = [];
  originCalls.length = 0;
  const request = new Request(ORIGIN + path);
  const response = await worker.fetch(request, { ASSETS: lenientStore(asked) });
  return {
    path,
    pathname: new URL(request.url).pathname,
    status: response.status,
    location: response.headers.get('location'),
    acao: response.headers.get('access-control-allow-origin'),
    asked,
    origin: originCalls.length,
  };
}

// ── The route shapes the worker serves (see its header and registry-page-passthrough.test.mjs) ──
const SHAPES = [
  '/corals/manifest.json',                // the channel table
  '/corals/sample/1.0.0/sample.js',       // exact
  '/corals/sample/latest/sample.js',      // channel
  '/corals/sample/legacy/sample.js',      // a second channel
  '/corals/sample/1.0.0/manifest.json',   // a version's manifest
  '/corals/sample/latest/manifest.json',  // the same through a channel
  '/corals/sample/0.9.0/manifest.json',   // the specified JSON 404
  '/corals/sample/latest/missing.js',     // no such artifact
  '/corals/sample/nochannel/sample.js',   // unknown channel
  '/corals/nobody/latest/sample.js',      // unknown coral
  '/corals/sample/latest',                // wrong shape
  '/corals/a/b/c/d',                      // wrong shape, four segments
  // the page routes, handed to the origin
  '/corals', '/corals/', '/corals/sample', '/corals/sample/', '/corals/__data.json', '/corals/sample/__data.json',
];

// Odd spellings of one path. Each returns the spelled path, or null when it does not apply.
const insertAt = (path, i, piece) => {
  const parts = path.split('/');
  if (i >= parts.length) return null;
  return [...parts.slice(0, i), piece, ...parts.slice(i)].join('/');
};
const SPELLINGS = {
  'trailing slash': (p) => (p.endsWith('/') ? null : `${p}/`),
  'double trailing slash': (p) => `${p.replace(/\/$/, '')}//`,
  'empty segment after /corals': (p) => p.replace(/^\/corals/, '/corals/'),
  'empty segment in the middle': (p) => (p.split('/').length > 3 ? insertAt(p, 3, '') : null),
  'dot segment': (p) => insertAt(p, 2, '.'),
  'dot-dot segment': (p) => insertAt(p, 2, '..'),
  'dot-dot after a decoy': (p) => (p.split('/').length > 2 ? insertAt(insertAt(p, 2, '..'), 2, 'decoy') : null),
  'encoded dot segment %2e': (p) => insertAt(p, 2, '%2e'),
  'encoded dot-dot %2E%2E after a decoy': (p) => (p.split('/').length > 2 ? insertAt(insertAt(p, 2, '%2E%2E'), 2, 'decoy') : null),
  'mixed .%2e after a decoy': (p) => (p.split('/').length > 2 ? insertAt(insertAt(p, 2, '.%2e'), 2, 'decoy') : null),
  'encoded slashes %2F': (p) => p.replace(/^\/corals\//, '/corals/').replace(/(?<=^\/corals\/.+)\//g, '%2F'),
  'encoded slashes %2f, lowercase': (p) => p.replace(/(?<=^\/corals\/.+)\//g, '%2f'),
  'encoded dots %2E in names': (p) => p.replace(/(?<=^\/corals\/.*)\./g, '%2E'),
  'encoded last dot only': (p) => p.replace(/\.(?=[a-z]+$)/, '%2e'),
  'traversal in the last segment': (p) => p.replace(/[^/]+$/, (f) => (f ? `..%2F..%2F${f}` : null)),
  'three dots as a segment': (p) => insertAt(p, 4, '...'),
  'three dots as the file': (p) => (p.split('/').length === 5 ? p.replace(/[^/]+$/, '...') : null),
  'uppercase everything': (p) => p.toUpperCase(),
  'uppercase prefix': (p) => p.replace(/^\/corals/, '/CORALS'),
  'uppercase coral': (p) => p.replace(/^\/corals\/sample/, '/corals/SAMPLE'),
  'uppercase file': (p) => p.replace(/[^/]+\.(js|json)$/, (f) => f.toUpperCase()),
  'backslashes': (p) => p.replace(/(?<=^\/corals)\//g, '\\'),
  'encoded backslash %5C': (p) => p.replace(/(?<=^\/corals\/.+)\//g, '%5C'),
  'query string': (p) => `${p}?x=1`,
  'NUL in the file': (p) => (p.split('/').length === 5 ? `${p}%00` : null),
  'space in the file': (p) => (p.split('/').length === 5 ? p.replace(/[^/]+$/, (f) => `%20${f}`) : null),
  'semicolon parameter': (p) => (p.split('/').length === 5 ? `${p};x=1` : null),
  'tilde in the file': (p) => (p.split('/').length === 5 ? p.replace(/[^/]+$/, (f) => `~${f}`) : null),
  'non-ASCII in the file': (p) => (p.split('/').length === 5 ? p.replace(/[^/]+$/, (f) => `é${f}`) : null),
};

const MATRIX = [...new Set(SHAPES.flatMap((shape) => [shape, ...Object.values(SPELLINGS).map((s) => s(shape))])
  .filter((p) => p && p.startsWith('/')))];

// The worker's own segments, re-derived here independently of the worker's code.
const segmentsOf = (pathname) => pathname.replace(/^\/corals(?=\/|$)/, '').split('/').filter(Boolean);
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const couldNameAFile = (segment) => SEGMENT.test(segment) && !/^\.+$/.test(segment);
// The page shapes, written out by hand rather than imported from the worker, so a widening of the
// worker's own PAGE pattern shows up here as an origin call this list does not expect.
const PAGE_SHAPES = /^\/corals(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?(?:\/|\/__data\.json)?$/;

test('the matrix is the size it claims, and reaches every branch it is about', async () => {
  const seen = [];
  for (const path of MATRIX) seen.push(await ask(path)); // one at a time: the origin counter is shared
  assert.ok(MATRIX.length > 300, `only ${MATRIX.length} paths`);
  assert.ok(seen.some((s) => s.status === 200 && s.asked.length === 1), 'no served artifact');
  assert.ok(seen.some((s) => s.status === 404 && s.asked.length === 1), 'no store miss (a store 308) in the matrix');
  assert.ok(seen.some((s) => s.origin === 1), 'no page route in the matrix');
  assert.ok(seen.some((s) => s.status === 404 && s.asked.length === 0 && s.origin === 0), 'no refusal before the store');
  assert.ok(seen.some((s) => s.origin === 0 && segmentsOf(s.pathname).some((g) => !couldNameAFile(g)) && segmentsOf(s.pathname).length === 3),
    'no three-segment path with an impossible segment: the segment rule would be checked on nothing');
});

test('no path the worker answers itself is a 3xx, even when the store answers one', async () => {
  const redirects = [];
  for (const path of MATRIX) {
    const s = await ask(path);
    if (s.origin) continue;
    if ((s.status >= 300 && s.status < 400) || s.location) redirects.push(`${path} → ${s.status} ${s.location}`);
  }
  assert.deepEqual(redirects, []);
});

test('only the page shapes reach the origin, so the only 3xx that can come out is the origin\'s own, on a page', async () => {
  const wrong = [];
  for (const path of MATRIX) {
    const s = await ask(path);
    if (s.origin && !PAGE_SHAPES.test(s.pathname)) wrong.push(`${path} (${s.pathname}) went to the origin`);
    if (!s.origin && PAGE_SHAPES.test(s.pathname)) wrong.push(`${path} (${s.pathname}) is a page and did not`);
    if (s.origin && s.asked.length) wrong.push(`${path} asked both the origin and the store`);
  }
  assert.deepEqual(wrong, []);
});

test('a segment that could not have named a published file is a 404, refused before the store is asked', async () => {
  const leaked = [];
  for (const path of MATRIX) {
    const s = await ask(path);
    if (s.origin) continue;
    const bad = segmentsOf(s.pathname).filter((g) => !couldNameAFile(g));
    if (!bad.length) continue;
    if (s.status !== 404 || s.asked.length || s.acao !== '*') {
      leaked.push(`${path} → ${s.status}, store asked for ${JSON.stringify(s.asked)} (segment ${JSON.stringify(bad)})`);
    }
  }
  assert.deepEqual(leaked, []);
});

test('the spellings that still name a published file are served unchanged by the rule', async () => {
  // CONTROL for the refusal: a rule that refused everything would pass the test above.
  for (const path of ['/corals/sample/1.0.0/sample.js', '/corals//sample/1.0.0/sample.js', '/corals/sample/latest/sample.js//',
    '/corals/sample/./1.0.0/sample.js', '/corals/decoy/../sample/1.0.0/sample.js', '/corals/sample/1.0.0/%2e/sample.js',
    '/corals/sample/1.0.0/sample.js?x=1', '/corals/sample/latest/manifest.json', '/corals/manifest.json']) {
    const s = await ask(path);
    assert.equal(s.status, 200, path);
    assert.equal(s.origin, 0, path);
  }
});

test('a store redirect for a key the worker resolved is not relayed', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/corals/sample/latest/sample.js`), {
    ASSETS: { async fetch() { return new Response(null, { status: 307, headers: { location: 'https://elsewhere.example/x.js' } }); } },
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('location'), null);
});
