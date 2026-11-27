// The canonical-redirect island: legacy query-string URLs → the site's pretty canonical URL.
//   run: node packages/sitetile/canonical-redirect.test.mjs
//
// The island is a browser script with no exports, so it is run here as the browser runs it: its exact
// text, in a vm, with a stub `location`, `fetch` and `window.__canonicalRedirect`. Each case hands it
// a /redirect-map.json and a URL and reads what it passed to `location.replace` (or that it passed
// nothing). The rule under test: the canonical redirect only follows same-origin targets, built from
// values whose path segments are all non-empty and contain no backslash; anything else leaves the
// page exactly as it is.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(join(HERE, 'astro/src/packages/canonical-redirect/canonical-redirect.js'), 'utf8');
const ORIGIN = 'https://site.example';

// Runs the island once against `href` and `map`; resolves to the list of `location.replace` calls.
async function run(href, map, { watch = ['p', 'cat', 'm', 's'] } = {}) {
  const u = new URL(href, ORIGIN);
  const replaced = [];
  const location = {
    origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, href: u.href,
    replace: (to) => { replaced.push(String(to)); },
  };
  const fetch = async (path) => {
    assert.equal(path, '/redirect-map.json');
    return { ok: true, json: async () => map };
  };
  vm.runInNewContext(SCRIPT, { window: { __canonicalRedirect: watch }, location, fetch, URL, URLSearchParams });
  // The island awaits fetch() and res.json(); a macrotask turn lets every microtask it queued settle.
  await new Promise((r) => setImmediate(r));
  return replaced;
}

const MAP = {
  rules: [
    { param: 'p', template: '/{v}/', lookup: { 123: 'hello-world', 7: '2013/07/nested-post' } },
    { param: 'm', template: '/{v}/', transform: 'yyyymm' },
    { param: 'cat', template: '/category/{v}/' },
    { param: 's', template: '/{v}' },
  ],
};

// ── the three rule kinds keep redirecting, to exactly the string they always produced ─────────────

test('lookup: a known id goes to its resolved slug; an unknown id leaves the page alone', async () => {
  assert.deepEqual(await run('/?p=123', MAP), ['/hello-world/']);
  assert.deepEqual(await run('/?p=7', MAP), ['/2013/07/nested-post/']);
  assert.deepEqual(await run('/?p=999', MAP), []);
});

test('yyyymm: 201307 → /2013/07/, 2013 → /2013/, anything else is skipped', async () => {
  assert.deepEqual(await run('/?m=201307', MAP), ['/2013/07/']);
  assert.deepEqual(await run('/?m=2013', MAP), ['/2013/']);
  assert.deepEqual(await run('/?m=20130', MAP), []);
});

test('slug: the value is used as a path, each segment encoded', async () => {
  assert.deepEqual(await run('/?cat=news', MAP), ['/category/news/']);
  assert.deepEqual(await run('/?cat=news/local', MAP), ['/category/news/local/']);
  assert.deepEqual(await run('/?cat=caf%C3%A9%20au', MAP), ['/category/caf%C3%A9%20au/']);
  assert.deepEqual(await run('/?s=about', MAP), ['/about']);
});

test('a template with non-ASCII text navigates to the same URL, in its encoded spelling', async () => {
  // The island navigates to the resolved path, so the template's own characters arrive as the URL
  // parser serialises them; the browser would have encoded the raw string to exactly this.
  const map = { rules: [{ param: 'cat', template: '/分類/{v}/' }] };
  assert.deepEqual(await run('/?cat=news', map), ['/%E5%88%86%E9%A1%9E/news/']);
  assert.equal(new URL('/分類/news/', ORIGIN).pathname, '/%E5%88%86%E9%A1%9E/news/');
});

test('no redirect when the page is already the target, and no fetch without a watched param', async () => {
  assert.deepEqual(await run('/category/news/?cat=news', MAP), []);
  assert.deepEqual(await run('/?tag=news', MAP), []);
});

// ── values that would leave the site, or build a path with an empty segment, are refused ─────────

test('a value that begins with two slashes is refused', async () => {
  assert.deepEqual(await run('/?s=//other.example/a', MAP), []);
  assert.deepEqual(await run('/?s=' + encodeURIComponent('//other.example/a'), MAP), []);
  assert.deepEqual(await run('/?cat=//other.example/a', MAP), []);
});

test('a value with a backslash is refused', async () => {
  assert.deepEqual(await run('/?s=' + encodeURIComponent('/\\other.example'), MAP), []);
  assert.deepEqual(await run('/?s=' + encodeURIComponent('\\\\other.example/a'), MAP), []);
  assert.deepEqual(await run('/?cat=' + encodeURIComponent('news\\local'), MAP), []);
});

test('a value with an empty segment (middle, leading, trailing, or the whole value) is refused', async () => {
  assert.deepEqual(await run('/?cat=news//local', MAP), []);
  assert.deepEqual(await run('/?cat=/news', MAP), []);
  assert.deepEqual(await run('/?cat=news/', MAP), []);
  assert.deepEqual(await run('/?cat=', MAP), []);
  // A lookup's resolved value is held to the same rule.
  assert.deepEqual(await run('/?p=1', { rules: [{ param: 'p', template: '/{v}/', lookup: { 1: 'a//b' } }] }), []);
});

// ── templates: the map is the owner's, and it is still same-origin only ──────────────────────────

test('an absolute-URL template on another origin is not followed', async () => {
  const map = { rules: [{ param: 'p', template: 'https://other.example/{v}/', lookup: { 123: 'hello-world' } }] };
  assert.deepEqual(await run('/?p=123', map), []);
  const proto = { rules: [{ param: 'p', template: '//other.example/{v}/', lookup: { 123: 'hello-world' } }] };
  assert.deepEqual(await run('/?p=123', proto), []);
});

test('an absolute-URL template on this origin is followed, to its path', async () => {
  const map = { rules: [{ param: 'p', template: ORIGIN + '/{v}/', lookup: { 123: 'hello-world' } }] };
  assert.deepEqual(await run('/?p=123', map), ['/hello-world/']);
});

test('a refused rule falls through to the next rule, like an unknown id', async () => {
  const map = { rules: [
    { param: 's', template: '/{v}' },
    { param: 'p', template: '/{v}/', lookup: { 123: 'hello-world' } },
  ] };
  assert.deepEqual(await run('/?s=//other.example&p=123', map), ['/hello-world/']);
});
