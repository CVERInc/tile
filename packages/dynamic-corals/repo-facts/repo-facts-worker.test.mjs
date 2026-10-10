// REEF with Repo Facts — the edge worker, against a fake forge, cache and clock.
//   run: node packages/dynamic-corals/repo-facts/repo-facts-worker.test.mjs
//
// fixtures/github/org-repos.json is a REAL answer of the public REST API (six items of an
// organisation's listing, ~5 KB each, `ssh_url` removed). A hand-written `{ name, pushed_at }`
// could never show the other 5 KB leaking.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest, facts, OWNERS, FRESH_MS, RETRY_MS } from './repo-facts-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = JSON.parse(readFileSync(join(HERE, 'fixtures/github/org-repos.json'), 'utf8'));
const LISTING = 'https://api.github.com/orgs/cverinc/repos?type=public&per_page=100';
const T0 = Date.parse('2026-10-09T15:00:00Z');
const MIN = 60 * 1000, HOUR = 60 * MIN;

/** A world: a forge that answers `forge()`, a cache, a clock. `get(query)` is one request. */
function world(forge = () => ({ status: 200, body: ORG })) {
  const w = { now: T0, calls: [], store: new Map(), background: [] };
  w.forge = forge;
  w.fetch = async (url, init) => {
    w.calls.push({ url, init });
    const a = w.forge(url);
    if (a instanceof Error) throw a;
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status, headers: a.headers });
  };
  w.cache = {
    async match(key) { return w.store.has(key) ? new Response(w.store.get(key)) : undefined; },
    async put(key, res) { w.store.set(key, await res.text()); },
  };
  w.request = (query, init) => handleRequest(new Request(`https://edge.example/v0/repo-facts${query}`, init),
    { waitUntil: (p) => w.background.push(p) }, { fetch: w.fetch, cache: w.cache, now: () => w.now });
  w.get = async (query = '?owner=CVERInc', init) => {
    const res = await w.request(query, init);
    await Promise.all(w.background.splice(0));
    return { res, body: res.status === 204 ? null : await res.json() };
  };
  return w;
}

test('one call for the whole owner: four checked fields per public repo, keyed by lower-case name', async () => {
  const w = world();
  const { res, body } = await w.get();
  assert.equal(res.status, 200);
  assert.deepEqual(w.calls.map((c) => c.url), [LISTING]);
  assert.deepEqual(Object.keys(body).sort(), ['bleedblend', 'clikae', 'demodeck', 'obsidian-marktile', 'obsidian-tugtile', 'sheersweep']);
  assert.deepEqual(body.clikae, { name: 'clikae', pushed_at: '2026-10-07', archived: false, stars: 4 });
  assert.equal(res.headers.get('x-repo-facts-cache'), 'miss');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
});

test('🔴 no free text leaves: the 5 KB per repo is reduced to name, pushed_at, archived, stars', async () => {
  const text = JSON.stringify((await world().get()).body);
  for (const r of ORG) {
    for (const v of [r.description, r.html_url, r.homepage, r.owner && r.owner.login]) if (v) assert.equal(text.includes(v), false, `leaked ${v}`);
  }
  assert.equal(text.includes('"license"'), false);
});

test('🔴 not a proxy: any owner but the hard-coded one is 400 with no upstream call', async () => {
  assert.deepEqual(OWNERS, ['cverinc']);
  for (const q of ['?owner=torvalds', '?owner=', '', '?owner=CVERInc/..', '?owner=..%2Fuser', '?owner=CVERIncX', '?owner=constructor', '?repos=CVERInc/clikae']) {
    const w = world();
    assert.equal((await w.get(q)).res.status, 400, q);
    assert.equal(w.calls.length, 0, q);
  }
  // Letter case does not matter; the upstream address is built from the constant, not the request.
  const w = world();
  assert.equal((await w.get('?owner=cVeRiNc')).res.status, 200);
  assert.deepEqual(w.calls.map((c) => c.url), [LISTING]);
});

test('other paths 404, other methods 405, OPTIONS 204 — none of them asks the forge', async () => {
  const w = world();
  assert.equal((await w.request('-admin?owner=CVERInc')).status, 404);
  assert.equal((await w.request('?owner=CVERInc', { method: 'POST' })).status, 405);
  assert.equal((await w.request('?owner=CVERInc', { method: 'OPTIONS' })).status, 204);
  assert.equal(w.calls.length, 0);
});

test('🔴 nothing of the visitor goes upstream, and no redirect is followed', async () => {
  const w = world();
  await w.get('?owner=CVERInc&x=1', { headers: { Cookie: '__Host-mf_session=s', Authorization: 'Bearer v', 'X-Forwarded-For': '1.2.3.4', Referer: 'https://cver.net/' } });
  const init = w.calls[0].init;
  assert.deepEqual(Object.keys(init.headers).sort(), ['Accept', 'User-Agent']);
  assert.equal(init.redirect, 'manual');
  const r = world(() => ({ status: 301, body: '', headers: { location: 'https://evil.example/' } }));
  assert.deepEqual((await r.get()).body, {});
  assert.equal(r.calls.length, 1);
});

test('the answer carries CORS for anyone, no credentials, no cookie, and nosniff', async () => {
  const { res } = await world().get();
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('fresh for a day: no forge call until 24 h have passed', async () => {
  const w = world();
  await w.get();
  w.now = T0 + FRESH_MS - MIN;
  const { res } = await w.get();
  assert.equal(res.headers.get('x-repo-facts-cache'), 'hit');
  assert.equal(w.calls.length, 1);
  assert.equal(FRESH_MS, 24 * HOUR);
});

test('stale-while-revalidate: after a day the old answer is served at once and refreshed behind it', async () => {
  const w = world();
  await w.get();
  w.forge = () => ({ status: 200, body: ORG.map((r) => (r.name === 'clikae' ? { ...r, pushed_at: '2026-10-10T08:00:00Z', archived: true } : r)) });
  w.now = T0 + FRESH_MS + MIN;
  const res = await w.request('?owner=CVERInc');
  assert.equal(res.headers.get('x-repo-facts-cache'), 'stale');
  assert.equal((await res.json()).clikae.pushed_at, '2026-10-07', 'the old answer, not a wait');
  await Promise.all(w.background.splice(0));
  assert.equal(w.calls.length, 2);
  const after = await w.get();
  assert.deepEqual(after.body.clikae, { name: 'clikae', pushed_at: '2026-10-10', archived: true, stars: 4 });
  assert.equal(after.res.headers.get('x-repo-facts-cache'), 'hit');
});

test('🔴 a failed read keeps the old answer, and is not repeated for RETRY_MS — not once per view', async () => {
  const w = world();
  await w.get();
  for (const down of [() => ({ status: 500, body: '' }), () => ({ status: 403, body: '{}', headers: { 'x-ratelimit-remaining': '0' } }), () => new Error('network')]) {
    w.forge = down;
    w.now += FRESH_MS + MIN;
    const before = w.calls.length;
    for (let i = 0; i < 10; i++) {
      w.now += MIN;
      assert.equal((await w.get()).body.clikae.pushed_at, '2026-10-07');
    }
    assert.equal(w.calls.length - before, 1, 'one call in ten minutes of views');
    w.now += RETRY_MS;
    await w.get();
    assert.equal(w.calls.length - before, 2, 'and one more after RETRY_MS');
  }
});

test('cold and failing: an empty answer, cached for a minute only', async () => {
  const w = world(() => ({ status: 502, body: '' }));
  const { res, body } = await w.get();
  assert.deepEqual(body, {});
  assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
});

test('🔴 private, internal, foreign and malformed items are dropped; a public one beside them is kept', () => {
  const good = ORG.find((r) => r.name === 'clikae');
  const items = [
    good,
    { ...good, name: 'p1', full_name: 'CVERInc/p1', private: true },
    { ...good, name: 'p2', full_name: 'CVERInc/p2', visibility: 'internal' },
    { ...good, name: 'p3', full_name: 'CVERInc/p3', visibility: undefined },
    { ...good, name: 'p4', full_name: 'other/p4' },
    { ...good, name: '../user', full_name: 'CVERInc/../user' },
    { ...good, name: 'p6', full_name: 'CVERInc/p6', pushed_at: 'yesterday' },
    { ...good, name: 'p7', full_name: 'CVERInc/p7', archived: 'false' },
    { ...good, name: 'p8', full_name: 'CVERInc/p8', stargazers_count: -1 },
    null, 7, 'x',
  ];
  assert.deepEqual(Object.keys(facts(items, 'cverinc')), ['clikae']);
  assert.equal(facts({ message: 'Not Found' }, 'cverinc'), null);
});
