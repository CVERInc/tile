// The canonical-redirect island: legacy query-string URLs → the site's pretty canonical URL.
//   run: node packages/sitetile/canonical-redirect.test.mjs
//
// The island is a browser script with no exports, so it is run here as the browser runs it: its exact
// text, in a vm, with a stub `location`, `fetch` and `window.__canonicalRedirect`. Each case hands it
// a /redirect-map.json and a URL and reads what it passed to `location.replace` (or that it passed
// nothing). The rule under test: the canonical redirect only follows same-origin targets. Every
// argument the stub `location.replace` receives is resolved again against the site's origin and must
// stay on that origin and scheme, whatever the case asserts besides.

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
    origin: u.origin, protocol: u.protocol, pathname: u.pathname, search: u.search, hash: u.hash, href: u.href,
    replace: (to) => { replaced.push(String(to)); },
  };
  const fetch = async (path) => {
    assert.equal(path, '/redirect-map.json');
    return { ok: true, json: async () => map };
  };
  vm.runInNewContext(SCRIPT, { window: { __canonicalRedirect: watch }, location, fetch, URL, URLSearchParams });
  // The island awaits fetch() and res.json(); a macrotask turn lets every microtask it queued settle.
  await new Promise((r) => setImmediate(r));
  // Checked here, not inside the stub: the island's own try/catch would swallow a throw from there.
  for (const arg of replaced) {
    let dest = null;
    try { dest = new URL(arg, ORIGIN); } catch { /* asserted below */ }
    assert.ok(dest, `location.replace(${JSON.stringify(arg)}) is not a URL`);
    assert.equal(dest.origin, ORIGIN, `location.replace(${JSON.stringify(arg)}) leaves the origin`);
    assert.equal(dest.protocol, 'https:', `location.replace(${JSON.stringify(arg)}) changes the scheme`);
  }
  return replaced;
}

// The island navigates to the resolved absolute URL.
const to = (path) => [ORIGIN + path];
const rule = (param, template, extra = {}) => ({ rules: [{ param, template, ...extra }] });

const MAP = {
  rules: [
    { param: 'p', template: '/{v}/', lookup: { 123: 'hello-world', 7: '2013/07/nested-post' } },
    { param: 'm', template: '/{v}/', transform: 'yyyymm' },
    { param: 'cat', template: '/category/{v}/' },
    { param: 's', template: '/{v}' },
  ],
};

// ── the three rule kinds keep redirecting, to the URL they always reached ─────────────────────────

test('lookup: a known id goes to its resolved slug; an unknown id leaves the page alone', async () => {
  assert.deepEqual(await run('/?p=123', MAP), to('/hello-world/'));
  assert.deepEqual(await run('/?p=7', MAP), to('/2013/07/nested-post/'));
  assert.deepEqual(await run('/?p=999', MAP), []);
});

test('yyyymm: 201307 → /2013/07/, 2013 → /2013/, anything else is skipped', async () => {
  assert.deepEqual(await run('/?m=201307', MAP), to('/2013/07/'));
  assert.deepEqual(await run('/?m=2013', MAP), to('/2013/'));
  assert.deepEqual(await run('/?m=20130', MAP), []);
});

test('slug: the value is used as a path, each segment encoded', async () => {
  assert.deepEqual(await run('/?cat=news', MAP), to('/category/news/'));
  assert.deepEqual(await run('/?cat=news/local', MAP), to('/category/news/local/'));
  assert.deepEqual(await run('/?cat=caf%C3%A9%20au', MAP), to('/category/caf%C3%A9%20au/'));
  assert.deepEqual(await run('/?cat=ac%2Fdc', MAP), to('/category/ac/dc/'));
  assert.deepEqual(await run('/?cat=...', MAP), to('/category/.../'));
  assert.deepEqual(await run('/?s=about', MAP), to('/about'));
});

test('a template with non-ASCII text navigates to the same URL, in its encoded spelling', async () => {
  const map = rule('cat', '/分類/{v}/');
  assert.deepEqual(await run('/?cat=news', map), to('/%E5%88%86%E9%A1%9E/news/'));
  assert.equal(new URL('/分類/news/', ORIGIN).pathname, '/%E5%88%86%E9%A1%9E/news/');
  // On the target itself it stops.
  assert.deepEqual(await run('/分類/news/?cat=news', map), []);
});

test('a relative template resolves against the page, as the browser resolves it', async () => {
  assert.deepEqual(await run('/blog/?cat=news', rule('cat', 'category/{v}/')), to('/blog/category/news/'));
});

test('no redirect when the page is already the target, and no fetch without a watched param', async () => {
  assert.deepEqual(await run('/category/news/?cat=news', MAP), []);
  assert.deepEqual(await run('/?tag=news', MAP), []);
});

// ── a single leading or trailing slash, and a backslash, keep working as before ─────────────────

test('a value with one trailing slash redirects as before', async () => {
  assert.deepEqual(await run('/?s=about/', MAP), to('/about/'));
  assert.deepEqual(await run('/?cat=news/', MAP), to('/category/news//'));
});

test('a lookup entry with a leading or trailing slash redirects as before when it stays on the site', async () => {
  assert.deepEqual(await run('/?p=1', rule('p', '/{v}/', { lookup: { 1: 'hello-world/' } })), to('/hello-world//'));
  assert.deepEqual(await run('/?p=1', rule('p', '/blog/{v}/', { lookup: { 1: '/hello-world' } })), to('/blog//hello-world/'));
  assert.deepEqual(await run('/?p=1', rule('p', '/blog/{v}', { lookup: { 1: '/hello-world/' } })), to('/blog//hello-world/'));
  // Behind a template that starts with "/{v}", a leading slash makes "//host": another origin.
  assert.deepEqual(await run('/?p=1', rule('p', '/{v}/', { lookup: { 1: '/hello-world' } })), []);
});

test('a backslash in a value is encoded as %5C, a path character, never a separator', async () => {
  assert.deepEqual(await run('/?cat=a%5Cb', MAP), to('/category/a%5Cb/'));
  assert.deepEqual(await run('/?s=%5Cother.example', MAP), to('/%5Cother.example'));
  assert.deepEqual(await run('/?s=' + encodeURIComponent('\\\\other.example/a'), MAP), to('/%5C%5Cother.example/a'));
  // A leading "/" before it, behind "/{v}", is "//%5C…": not a URL on this site, so nothing happens.
  assert.deepEqual(await run('/?s=' + encodeURIComponent('/\\other.example'), MAP), []);
});

// ── values that would leave the site, or step out of the template's path, are refused ───────────

test('a value with a doubled slash, leading or between segments, is refused', async () => {
  assert.deepEqual(await run('/?s=//other.example/a', MAP), []);
  assert.deepEqual(await run('/?s=' + encodeURIComponent('//other.example/a'), MAP), []);
  assert.deepEqual(await run('/?s=///other.example/a', MAP), []);
  assert.deepEqual(await run('/?cat=//other.example/a', MAP), []);
  assert.deepEqual(await run('/?cat=news//local', MAP), []);
  assert.deepEqual(await run('/?cat=news//', MAP), []);
  assert.deepEqual(await run('/?p=1', rule('p', '/{v}/', { lookup: { 1: 'a//b' } })), []);
});

test('a value with a . or .. segment is refused', async () => {
  for (const v of ['.', '..', '../admin', '%2e%2e/admin', '%2E%2E%2Fadmin', 'news/../../admin', 'news/.']) {
    assert.deepEqual(await run('/blog/?cat=' + v, MAP), [], v);
  }
  assert.deepEqual(await run('/?p=1', rule('p', '/category/{v}/', { lookup: { 1: '../admin' } })), []);
});

test('query values with control characters, @, other slashes or double encoding stay inside the path', async () => {
  const cases = {
    'a%09b': '/category/a%09b/',
    'a%0Ab': '/category/a%0Ab/',
    'a%0Db': '/category/a%0Db/',
    '%40other.example': '/category/%40other.example/',
    'site.example%40other.example': '/category/site.example%40other.example/',
    '%EF%BC%8Fother.example': '/category/%EF%BC%8Fother.example/',
    '%252Fother.example': '/category/%252Fother.example/',
    '%255Cother.example': '/category/%255Cother.example/',
  };
  for (const [v, path] of Object.entries(cases)) assert.deepEqual(await run('/?cat=' + v, MAP), to(path), v);
  assert.deepEqual(await run('/?s=%40other.example', MAP), to('/%40other.example'));
  assert.deepEqual(await run('/?s=site.example%40other.example', MAP), to('/site.example%40other.example'));
  const long = 'a'.repeat(20000);
  assert.deepEqual(await run('/?cat=' + long, MAP), to('/category/' + long + '/'));
});

// ── templates: the map is the owner's, and it is still same-origin only ──────────────────────────

test('an absolute-URL template on another origin is not followed', async () => {
  const lookup = { 123: 'hello-world' };
  assert.deepEqual(await run('/?p=123', rule('p', 'https://other.example/{v}/', { lookup })), []);
  assert.deepEqual(await run('/?p=123', rule('p', '//other.example/{v}/', { lookup })), []);
});

test('an absolute-URL template on this origin is followed, to the resolved URL', async () => {
  assert.deepEqual(await run('/?p=123', rule('p', ORIGIN + '/{v}/', { lookup: { 123: 'hello-world' } })), to('/hello-world/'));
});

test('a template whose path resolves to begin with "//" stays on this origin', async () => {
  for (const template of [ORIGIN + '//{v}/', '//site.example//{v}/', ORIGIN + '/\\{v}/']) {
    assert.deepEqual(await run('/?s=other.example/a', rule('s', template)), to('//other.example/a/'), template);
  }
  assert.deepEqual(await run('/?s=other.example/a', rule('s', '/a/..//{v}')), to('//other.example/a'));
});

test('a template with another scheme is not followed', async () => {
  const lookup = { 1: 'x' };
  for (const template of ['javascript:void(0)//{v}', 'data:text/html,{v}', 'blob:' + ORIGIN + '/{v}', 'http://site.example/{v}']) {
    assert.deepEqual(await run('/?p=1', rule('p', template, { lookup })), [], template);
  }
});

test('a template with a query or fragment redirects once and does not loop on the redirected URL', async () => {
  const archive = rule('cat', '/archive/?cat={v}');
  assert.deepEqual(await run('/?cat=news', archive), to('/archive/?cat=news'));
  assert.deepEqual(await run('/archive/?cat=news', archive), []);
  const top = rule('cat', '/category/{v}/#top');
  assert.deepEqual(await run('/?cat=news', top), to('/category/news/#top'));
  assert.deepEqual(await run('/category/news/#top', top), []);
  const both = rule('cat', '/archive/?cat={v}#top');
  assert.deepEqual(await run('/?cat=news', both), to('/archive/?cat=news#top'));
  assert.deepEqual(await run('/archive/?cat=news#top', both), []);
});

// ── a rule that is refused or cannot be resolved falls through to the next rule ──────────────────

test('a refused rule falls through to the next rule, like an unknown id', async () => {
  const map = { rules: [
    { param: 's', template: '/{v}' },
    { param: 'p', template: '/{v}/', lookup: { 123: 'hello-world' } },
  ] };
  assert.deepEqual(await run('/?s=//other.example&p=123', map), to('/hello-world/'));
  assert.deepEqual(await run('/?s=..&p=123', map), to('/hello-world/'));
});

test('a rule whose template cannot be resolved is skipped; later rules still run', async () => {
  const map = { rules: [
    { param: 's', template: 'http://[bad/{v}' },
    { param: 'p', template: '/{v}/', lookup: { 123: 'hello-world' } },
  ] };
  assert.deepEqual(await run('/?s=x&p=123', map), to('/hello-world/'));
});
