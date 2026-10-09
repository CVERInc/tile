// REEF with Repo Facts — the edge worker, against a fake forge.
//   run: node packages/dynamic-corals/repo-facts/repo-facts-worker.test.mjs
//
// The upstream bodies in fixtures/github/ are REAL answers, saved from the public REST API for
// public repositories: six items of an organisation's repository listing (each ~5 KB, of which
// this worker may pass on four fields) and two latest-release answers. A test against a
// hand-written `{ full_name, pushed_at }` could never notice the other 5 KB leaking. One key is
// gone from each listing item — `ssh_url`, whose value is shaped like an e-mail address and reads
// as one to a scanner looking for those. The headers (the rate-limit family) are the shapes that
// came back with them.
//
// What is faked is everything around those bodies: the network, the cache, and the clock — so
// "an hour later" is an assignment, and every upstream call is counted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleRequest, parseRepos, allowedOwners, repoFields, releaseFields, CACHE_CONTROL, MAX_REPOS, MAX_UPSTREAM, DEADLINE_MS,
} from './repo-facts-worker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => JSON.parse(readFileSync(join(HERE, 'fixtures/github', name), 'utf8'));
const ORG = fixture('org-repos.json');
const RELEASE_CLIKAE = fixture('release-clikae.json');
const RELEASE_TUGTILE = fixture('release-obsidian-tugtile.json');
const NOT_FOUND = fixture('release-not-found.json');
const item = (name) => ORG.find((r) => r.name === name);

const GH = 'https://api.github.com';
const T0 = Date.parse('2026-10-09T15:00:00Z');
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const LIMIT = { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '41', 'x-ratelimit-reset': '1791563698' };
const LISTING = '/orgs/CVERInc/repos?type=public&per_page=100&page=1';

const ok = (json, headers) => ({ status: 200, json, headers });
const notFound = () => ({ status: 404, json: NOT_FOUND });
// The forge as it stood when the fixtures were saved: one organisation with six public repos, two
// of which have a release. Anything else does not exist.
const ROUTES = {
  [LISTING]: ok(ORG),
  '/repos/CVERInc/clikae/releases/latest': ok(RELEASE_CLIKAE),
  '/repos/CVERInc/obsidian-tugtile/releases/latest': ok(RELEASE_TUGTILE),
};

/** A world: a forge, a cache, a clock. `get(repos)` is one request through the real handler. */
function world(routes = ROUTES, env = {}) {
  // `inflight` is what one isolate remembers between requests; a world is one isolate unless a test says otherwise.
  const w = { now: T0, calls: [], routes: { ...routes }, store: new Map(), background: [], env, budgetMs: undefined, deadlineMs: undefined, inflight: new Map() };
  const lower = () => Object.fromEntries(Object.entries(w.routes).map(([k, v]) => [k.toLowerCase(), v]));
  w.fetch = (url, init = {}) => {
    w.calls.push({ url, init });
    // The forge matches names without regard to case, so the fake does too.
    const route = url.startsWith(GH + '/') ? lower()[url.slice(GH.length).toLowerCase()] : undefined;
    const answer = typeof route === 'function' ? route(url, init) : route || notFound();
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('aborted', 'AbortError'));
      if (init.signal) {
        if (init.signal.aborted) return abort();
        init.signal.addEventListener('abort', abort);
      }
      if (answer === 'hang') return;
      if (answer instanceof Error) return reject(answer);
      const body = answer.text !== undefined ? answer.text : JSON.stringify(answer.json);
      const respond = () => resolve(new Response(body, { status: answer.status, headers: { ...LIMIT, ...answer.headers } }));
      if (answer.delayMs) setTimeout(respond, answer.delayMs); else respond();
    });
  };
  w.cache = {
    async match(key) { const hit = w.store.get(key); return hit ? new Response(hit) : undefined; },
    async put(key, response) { w.store.set(key, await response.text()); },
  };
  w.ctx = { waitUntil: (p) => w.background.push(p) };
  w.deps = () => ({ fetch: w.fetch, cache: w.cache, now: () => w.now, budgetMs: w.budgetMs, deadlineMs: w.deadlineMs, inflight: w.inflight });
  w.request = (query, init) => handleRequest(new Request(`https://edge.example/v0/repo-facts${query}`, init), w.env, w.ctx, w.deps());
  w.get = async (repos, init) => {
    const before = w.calls.length;
    const response = await w.request(`?repos=${repos}`, init);
    const text = await response.text();
    // Everything started behind the response is allowed to finish before the next step, the way
    // the runtime lets it — a test that wants to look BEFORE it finishes says so with `early`.
    const early = { calls: w.calls.length - before };
    await w.settle();
    return { response, text, body: JSON.parse(text), status: response.status, state: response.headers.get('x-repo-facts-cache'), calls: w.calls.length - before, early };
  };
  w.settle = async () => { await Promise.all(w.background.splice(0)); };
  w.paths = () => w.calls.map((c) => c.url.slice(GH.length));
  return w;
}

const CLIKAE = { pushedAt: '2026-10-07', license: 'MIT', archived: false, fullName: 'CVERInc/clikae', tag: 'v0.40.0', releasedAt: '2026-10-07' };
const DEMODECK = { pushedAt: '2026-07-05', license: 'MIT', archived: false, fullName: 'CVERInc/demodeck', tag: null, releasedAt: null };
const TUGTILE = { pushedAt: '2026-08-12', license: 'MIT', archived: false, fullName: 'CVERInc/obsidian-tugtile', tag: '0.3.3', releasedAt: '2026-08-09' };
const SIX = ['archived', 'fullName', 'license', 'pushedAt', 'releasedAt', 'tag'];
const THREE = 'CVERInc/clikae,CVERInc/demodeck,CVERInc/obsidian-tugtile';

/** A forge with `n` public repos under `acme`, none with a release unless listed in `released`. */
function acme(n, released = []) {
  const names = Array.from({ length: n }, (_, i) => `acme/tool-${String(i).padStart(2, '0')}`);
  const routes = { '/orgs/acme/repos?type=public&per_page=100&page=1': ok(names.map((full_name, i) => ({ ...item('demodeck'), id: 1000 + i, name: full_name.slice(5), full_name }))) };
  for (const name of released) routes[`/repos/${name}/releases/latest`] = ok(RELEASE_CLIKAE);
  return { names, routes, env: { ALLOWED_OWNERS: 'acme' } };
}

// ── the answer ─────────────────────────────────────────────────────────────────────────────────

test('six fields per repo, from real upstream answers — with a release, and without one', async () => {
  const w = world();
  const r = await w.get(THREE);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { 'CVERInc/clikae': CLIKAE, 'CVERInc/demodeck': DEMODECK, 'CVERInc/obsidian-tugtile': TUGTILE });
  assert.equal(r.response.headers.get('cache-control'), 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400, stale-if-error=604800');
  assert.equal(r.response.headers.get('cache-control'), CACHE_CONTROL);
  assert.match(r.response.headers.get('content-type'), /^application\/json/);
  // One listing for the owner, then one release call per repo asked about — and nothing else.
  assert.deepEqual(w.paths().sort(), [LISTING.replace('CVERInc', 'cverinc'),
    '/repos/CVERInc/clikae/releases/latest', '/repos/CVERInc/demodeck/releases/latest', '/repos/CVERInc/obsidian-tugtile/releases/latest'].sort());
});

test('🔴 the answer is open to any origin, and to nothing that needs a credential', async () => {
  const w = world();
  for (const response of [await w.request(`?repos=${THREE}`), await w.request('?repos=nope'), await w.request('', { method: 'OPTIONS' }), await w.request('', { method: 'POST' })]) {
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(response.headers.get('access-control-allow-credentials'), null, 'a wildcard origin with credentials is a contradiction a browser resolves by trusting nobody');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal([...response.headers.keys()].some((k) => /cookie|credential|authorization/i.test(k)), false);
  }
});

test('🔴 no free text leaves: nothing a stranger could type upstream is in the answer', async () => {
  const w = world();
  const r = await w.get(THREE);
  // The rulers, taken from the fixtures themselves — and checked to be non-trivial first, so this
  // cannot pass because a fixture stopped carrying the text.
  const leaks = [item('clikae').description, item('demodeck').description, item('obsidian-tugtile').description, RELEASE_CLIKAE.name,
    RELEASE_CLIKAE.body.slice(0, 60), RELEASE_TUGTILE.body.slice(0, 60), item('demodeck').topics[0], RELEASE_CLIKAE.author.login,
    item('clikae').homepage, item('clikae').html_url, item('clikae').node_id,
    // …and the listing never leaks out: a repo nobody asked about is not in the answer.
    'bleedblend', 'sheersweep', 'obsidian-marktile'];
  for (const leak of leaks) {
    assert.ok(typeof leak === 'string' && leak.length >= 4, `a ruler is empty: ${JSON.stringify(leak)}`);
    assert.equal(r.text.includes(leak), false, `the answer carries upstream text: ${leak}`);
  }
  for (const facts of Object.values(r.body)) assert.deepEqual(Object.keys(facts).sort(), SIX);
  assert.deepEqual(Object.keys(r.body), THREE.split(','), 'only the repos that were asked for');
  assert.equal(item('sheersweep').stargazers_count, 19, 'the fixture does carry a star count');
  assert.equal(/star|19\b/i.test(r.text.replace(/2026-\d\d-\d\d/g, '')), false, 'no star counts');
});

test('the upstream call says who is asking, and carries no credential unless one is configured', async () => {
  const w = world();
  await w.get('CVERInc/clikae');
  assert.equal(w.calls.length, 2);
  for (const call of w.calls) {
    assert.deepEqual(Object.keys(call.init.headers).sort(), ['Accept', 'User-Agent', 'X-GitHub-Api-Version']);
    assert.match(call.init.headers['User-Agent'], /^repo-facts-coral\//);
    assert.equal(call.init.headers.Accept, 'application/vnd.github+json');
  }
});

test('an optional token is sent upstream, and appears nowhere in what comes back', async () => {
  const token = 'fixture-token-not-a-credential-0123456789';
  const w = world(ROUTES, { GITHUB_TOKEN: token });
  const r = await w.get('CVERInc/clikae,CVERInc/nope');
  assert.deepEqual(r.body, { 'CVERInc/clikae': CLIKAE });
  for (const call of w.calls) assert.equal(call.init.headers.Authorization, `Bearer ${token}`);
  const headers = [...r.response.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
  assert.equal((r.text + headers + [...w.store.keys(), ...w.store.values()].join('')).includes(token), false);
});

test('🔴 nothing of the visitor goes upstream, into the cache, or back out', async () => {
  const visitor = {
    Cookie: '__Host-session=VISITOR-COOKIE-7f3a',
    Authorization: 'Bearer VISITOR-BEARER-91bc',
    'CF-Connecting-IP': '203.0.113.77',
    'X-Forwarded-For': '203.0.113.78',
    Referer: 'https://visitor-referer.example/private/page',
    'User-Agent': 'VisitorBrowser/9.9 (unique-ua-marker)',
    'Accept-Language': 'tlh-visitor-language',
  };
  const marks = ['VISITOR-COOKIE-7f3a', 'VISITOR-BEARER-91bc', '203.0.113.77', '203.0.113.78', 'visitor-referer.example', 'unique-ua-marker', 'tlh-visitor-language', 'visitor-query-mark'];
  // Twice: with a deployment token and without — "forward the visitor's only when there is one to
  // forward" and "only when we have none of our own" are both the same mistake.
  for (const env of [{}, { GITHUB_TOKEN: 'fixture-token-not-a-credential-0123456789' }]) {
    const w = world(ROUTES, env);
    const r = await w.get(`${THREE}&utm=visitor-query-mark`, { headers: visitor });
    assert.equal(r.status, 200);
    assert.equal(w.calls.length, 4, 'the request did reach the forge, so there is something to inspect');
    for (const call of w.calls) {
      assert.deepEqual(Object.keys(call.init.headers).sort(),
        env.GITHUB_TOKEN ? ['Accept', 'Authorization', 'User-Agent', 'X-GitHub-Api-Version'] : ['Accept', 'User-Agent', 'X-GitHub-Api-Version']);
      assert.deepEqual(Object.keys(call.init).sort(), ['headers', 'redirect', 'signal']);
    }
    const upstream = w.calls.map((c) => c.url + JSON.stringify(c.init.headers)).join('\n');
    const cached = [...w.store.keys(), ...w.store.values()].join('\n');
    const answered = r.text + [...r.response.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
    for (const mark of marks) {
      assert.equal(upstream.includes(mark), false, `sent upstream: ${mark}`);
      assert.equal(cached.includes(mark), false, `kept in the cache: ${mark}`);
      assert.equal(answered.includes(mark), false, `sent back: ${mark}`);
    }
  }
});

// ── who may be asked about ─────────────────────────────────────────────────────────────────────

test('🔴 an owner that is not on the allow-list is refused, and the forge never hears of it', async () => {
  for (const repos of ['torvalds/linux', 'CVERInc/clikae,torvalds/linux', 'junk/z1', 'CVERIncX/clikae', 'XCVERInc/clikae', 'CVER/Inc']) {
    const w = world();
    const response = await w.request(`?repos=${repos}`);
    assert.equal(response.status, 400, repos);
    assert.equal(w.calls.length, 0, `${repos} reached the forge`);
    assert.equal(w.store.size, 0, `${repos} left something in the cache`);
  }
});

test('the default owner is CVERInc; ALLOWED_OWNERS replaces it; letter case does not matter', async () => {
  assert.deepEqual([...allowedOwners({})], ['cverinc']);
  assert.deepEqual([...allowedOwners(undefined)], ['cverinc']);
  assert.deepEqual([...allowedOwners({ ALLOWED_OWNERS: ' Acme , other-org,,' })], ['acme', 'other-org']);
  assert.equal((await world().get('cverinc/CLIKAE')).status, 200);
  const a = acme(3);
  assert.equal((await world(a.routes, { ALLOWED_OWNERS: 'ACME' }).get('Acme/tool-00')).status, 200);
  const closed = world({ ...ROUTES, ...a.routes }, a.env);
  assert.equal((await closed.request('?repos=CVERInc/clikae')).status, 400, 'the default is replaced, not added to');
  assert.equal(closed.calls.length, 0);
});

// ── validation of the request ──────────────────────────────────────────────────────────────────

test('every malformed `repos` is refused before the forge hears about it', async () => {
  const name = 'x'.repeat(100);
  const bad = ['', 'clikae', 'CVERInc/', '/clikae', 'CVERInc/clikae/issues', 'CVERInc/cli kae', 'CVERInc/clikae,',
    ',CVERInc/clikae', 'CVERInc/clikae,,CVERInc/demodeck', 'CVERInc/clikae;CVERInc/demodeck', `CVERInc/${name}x`,
    'CVERInc/<script>', 'CVERInc/clikae%00', 'CVERInc/clié', 'https://github.com/CVERInc/clikae', 'CVERInc/clikae?x=1'];
  for (const repos of bad) {
    const w = world();
    const response = await w.request(`?repos=${encodeURIComponent(repos)}`);
    assert.equal(response.status, 400, JSON.stringify(repos));
    assert.equal(w.calls.length, 0, `${JSON.stringify(repos)} reached the forge`);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=600');
    assert.deepEqual(Object.keys(await response.json()), ['error']);
  }
  const none = world();
  assert.equal((await none.request('')).status, 400, 'no repos parameter at all');
  assert.equal(none.calls.length, 0);
});

test('CONTROL: names at the very edge of the rule are accepted', async () => {
  const name = 'x'.repeat(100);
  for (const repos of [`CVERInc/${name}`, 'CVERInc/b', 'CVERInc/E_f.g-h', 'CVERInc/.github', 'CVERInc/..b', 'CVERInc/b.']) {
    const w = world();
    assert.equal((await w.get(repos)).status, 200, repos);
    assert.ok(w.calls.length > 0, repos);
  }
});

test('🔴 dot segments are not names: a request cannot walk out of /repos/ into the rest of the API', async () => {
  for (const repos of ['CVERInc/..', 'CVERInc/.', '../rate_limit', './clikae', '../..']) {
    for (const env of [{}, { ALLOWED_OWNERS: 'CVERInc,..,.' }]) {
      const w = world({ ...ROUTES, '/rate_limit': ok([]), '/user': ok([]) }, env);
      const response = await w.request(`?repos=${repos}`);
      assert.equal(response.status, 400, repos);
      assert.equal(w.calls.length, 0, `${repos} reached the forge`);
    }
  }
});

test('at most 30 names — 30 is answered, 31 is refused, and duplicates count toward the cap', async () => {
  const names = (n) => Array.from({ length: n }, (_, i) => `CVERInc/tool-${i}`).join(',');
  assert.equal(MAX_REPOS, 30);
  assert.equal((await world().get(names(30))).status, 200);
  const over = world();
  assert.equal((await over.request(`?repos=${names(31)}`)).status, 400);
  assert.equal(over.calls.length, 0);
  const padded = world();
  assert.equal((await padded.request(`?repos=${Array(31).fill('CVERInc/clikae').join(',')}`)).status, 400);
});

test('only GET on /v0/repo-facts: other methods, other majors and other paths are refused', async () => {
  const w = world();
  assert.equal((await w.request('?repos=CVERInc/clikae', { method: 'POST' })).status, 405);
  assert.equal((await w.request('?repos=CVERInc/clikae', { method: 'DELETE' })).status, 405);
  const preflight = await w.request('?repos=CVERInc/clikae', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  for (const path of ['/', '/v1/repo-facts', '/v0', '/v0/repo-facts/extra', '/repo-facts', '/v0/repo-facts-admin']) {
    const response = await handleRequest(new Request(`https://edge.example${path}?repos=CVERInc/clikae`), {}, w.ctx, w.deps());
    assert.equal(response.status, 404, path);
  }
  const slash = await handleRequest(new Request('https://edge.example/v0/repo-facts/?repos=CVERInc/clikae'), {}, w.ctx, w.deps());
  assert.equal(slash.status, 200);
  await w.settle();
  assert.equal(w.calls.length, 2, 'only the one valid request reached the forge');
});

// ── validation of what the forge says ──────────────────────────────────────────────────────────

const HOSTILE = '<img src=x onerror=alert(1)>';

test('🔴 a field with markup in it is dropped, and the rest of the answer still arrives', async () => {
  const cases = [
    ['tag', { release: { tag_name: HOSTILE } }],
    ['tag', { release: { tag_name: 'v1.0.0<script>alert(1)</script>' } }],
    ['tag', { release: { tag_name: 'nightly' } }],
    ['tag', { release: { tag_name: `v1.0.0-${'a'.repeat(40)}` } }],
    ['tag', { release: { tag_name: 1.2 } }],
    ['releasedAt', { release: { published_at: HOSTILE } }],
    ['releasedAt', { release: { published_at: '2026-10-07' } }],            // a date, not the timestamp the API sends
    ['releasedAt', { release: { published_at: '2026-13-45T00:00:00Z' } }],
    ['releasedAt', { release: { published_at: '2026-02-30T00:00:00Z' } }],  // well-formed, and not a day
    ['pushedAt', { repo: { pushed_at: 'yesterday' } }],
    ['pushedAt', { repo: { pushed_at: 1791563698 } }],
    ['pushedAt', { repo: { pushed_at: '2026-02-30T12:00:00Z' } }],
    ['license', { repo: { license: { spdx_id: HOSTILE } } }],
    ['license', { repo: { license: { spdx_id: 'NOASSERTION' } } }],
    ['license', { repo: { license: 'MIT' } }],
    ['archived', { repo: { archived: 'true' } }],
    ['archived', { repo: { archived: 1 } }],
  ];
  for (const [field, change] of cases) {
    const w = world({
      ...ROUTES,
      [LISTING]: ok(ORG.map((r) => (r.name === 'clikae' ? { ...r, ...change.repo } : r))),
      '/repos/CVERInc/clikae/releases/latest': ok({ ...RELEASE_CLIKAE, ...change.release }),
    });
    const r = await w.get('CVERInc/clikae');
    const label = `${field} ← ${JSON.stringify(change)}`;
    const { [field]: dropped, ...rest } = CLIKAE;
    assert.deepEqual(r.body['CVERInc/clikae'], rest, label);
    assert.equal(r.text.includes('<'), false, label);
  }
});

test('a listing item whose own name is not a plain name is not in the listing at all', async () => {
  for (const full_name of [HOSTILE, 'CVERInc/clikae/../../user', '../user', 'other-org/clikae', 'CVERInc', 42, null]) {
    const w = world({ ...ROUTES, [LISTING]: ok(ORG.map((r) => (r.name === 'clikae' ? { ...r, full_name } : r))) });
    const r = await w.get('CVERInc/clikae,CVERInc/demodeck');
    assert.deepEqual(r.body, { 'CVERInc/demodeck': DEMODECK }, JSON.stringify(full_name));
    assert.equal(r.calls, 2, 'and its release is never asked for');
  }
});

test('a repo with no licence says null; a listing that is not a JSON array reads as "could not read"', async () => {
  const unlicensed = world({ ...ROUTES, [LISTING]: ok(ORG.map((r) => ({ ...r, license: null }))) });
  assert.equal((await unlicensed.get('CVERInc/clikae')).body['CVERInc/clikae'].license, null);
  for (const answer of [{ status: 200, text: '<html>captive portal</html>' }, ok({ message: 'ok' }), ok('[]'), { status: 500, text: '' }]) {
    const w = world({ ...ROUTES, [LISTING]: answer });
    const r = await w.get('CVERInc/clikae,CVERInc/no-such-repo');
    assert.deepEqual(r.body, { 'CVERInc/clikae': {}, 'CVERInc/no-such-repo': {} });
    assert.equal(r.response.headers.get('cache-control'), 'public, max-age=30, s-maxage=60');
  }
  const halfHtml = world({ ...ROUTES, '/repos/CVERInc/clikae/releases/latest': { status: 200, text: '<html>' } });
  const { tag, releasedAt, ...repoHalf } = CLIKAE;
  assert.deepEqual((await halfHtml.get('CVERInc/clikae')).body, { 'CVERInc/clikae': repoHalf });
});

test('the field readers, on their own', () => {
  assert.deepEqual(repoFields(item('clikae')), { pushedAt: '2026-10-07', license: 'MIT', archived: false, fullName: 'CVERInc/clikae' });
  assert.deepEqual(releaseFields(RELEASE_TUGTILE), { tag: '0.3.3', releasedAt: '2026-08-09' });
  assert.deepEqual(repoFields({}), {});
  // A dot segment fits the name pattern and is not a name; it must not become a path upstream.
  for (const full_name of ['CVERInc/..', 'CVERInc/.', '../clikae']) assert.deepEqual(repoFields({ full_name }), {}, full_name);
  assert.deepEqual(repoFields({ full_name: 'CVERInc/..b' }), { fullName: 'CVERInc/..b' });
  assert.deepEqual(releaseFields({ tag_name: null, published_at: null }), {});
});

// ── existence: answered from the listing, never by asking about the name ───────────────────────

test('🔴 a name that is not in the listing is absent, and costs nothing — a typo, junk, or a renamed-away repo', async () => {
  const w = world();
  assert.equal((await w.get('CVERInc/clikae')).calls, 2);
  for (const repos of ['CVERInc/marktile', 'CVERInc/tugtile', 'CVERInc/clikae.git', 'CVERInc/zzz-1,CVERInc/zzz-2,CVERInc/zzz-3', 'CVERInc/clikae,CVERInc/junk']) {
    const r = await w.get(repos);
    assert.equal(r.calls, 0, `${repos} reached the forge`);
    assert.deepEqual(r.body, repos.includes('CVERInc/clikae,') ? { 'CVERInc/clikae': CLIKAE } : {}, repos);
    assert.equal(r.response.headers.get('cache-control'), CACHE_CONTROL, 'a complete answer: these names are known not to be there');
  }
  // …and from cold, thirty junk names cost one listing and not one call more.
  const cold = world();
  const junk = await cold.get(Array.from({ length: 30 }, (_, i) => `CVERInc/junk-${i}`).join(','));
  assert.equal(junk.calls, 1);
  assert.deepEqual(junk.body, {});
});

test('🔴 missing and private are both simply absent, indistinguishable, and neither is ever asked about', async () => {
  const hidden = (extra) => ({ ...item('clikae'), id: 99, ...extra });
  const routes = {
    ...ROUTES,
    // What a token that can see too much gets back: private repos, in the listing, fully described.
    [LISTING]: ok([...ORG,
      hidden({ name: 'secret-plans', full_name: 'CVERInc/secret-plans', private: true, visibility: 'private' }),
      hidden({ name: 'internal', full_name: 'CVERInc/internal', private: false, visibility: 'internal' }),
      hidden({ name: 'unmarked', full_name: 'CVERInc/unmarked', private: undefined, visibility: undefined }),
      hidden({ name: 'stringly', full_name: 'CVERInc/stringly', private: 'false', visibility: 'public' }),
    ]),
    '/repos/CVERInc/secret-plans/releases/latest': ok(RELEASE_CLIKAE),
    '/repos/CVERInc/internal/releases/latest': ok(RELEASE_CLIKAE),
  };
  const answers = {};
  for (const name of ['no-such-repo', 'secret-plans', 'internal', 'unmarked', 'stringly']) {
    const w = world(routes, { GITHUB_TOKEN: 't' });
    const r = await w.get(`CVERInc/clikae,CVERInc/${name}`);
    assert.deepEqual(r.body, { 'CVERInc/clikae': CLIKAE }, name);
    assert.equal(r.text.includes(name), false, `${name} is named in the answer`);
    assert.deepEqual(w.paths().sort(), [LISTING.replace('CVERInc', 'cverinc'), '/repos/CVERInc/clikae/releases/latest'].sort(), name);
    assert.equal([...w.store.values()].join('').includes(name), false, `${name} is kept in the cache`);
    answers[name] = { text: r.text, status: r.status, cache: r.response.headers.get('cache-control'), state: r.state, calls: r.calls };
  }
  for (const name of Object.keys(answers)) assert.deepEqual(answers[name], answers['no-such-repo'], name);
});

test('CONTROL: the same item marked public IS in the listing and IS answered', async () => {
  const w = world({ ...ROUTES, [LISTING]: ok([...ORG, { ...item('clikae'), name: 'secret-plans', full_name: 'CVERInc/secret-plans', private: false, visibility: 'public' }]) });
  assert.equal((await w.get('CVERInc/secret-plans')).body['CVERInc/secret-plans'].fullName, 'CVERInc/secret-plans');
});

test('a listing is read a page at a time, to at most three pages', async () => {
  const page = (n, count) => ok(Array.from({ length: count }, (_, i) => ({ ...item('demodeck'), name: `p${n}-${i}`, full_name: `acme/p${n}-${i}` })));
  const base = '/orgs/acme/repos?type=public&per_page=100&page=';
  const two = world({ [base + 1]: page(1, 100), [base + 2]: page(2, 40), [base + 3]: page(3, 100) }, { ALLOWED_OWNERS: 'acme' });
  assert.deepEqual(Object.keys((await two.get('acme/p1-0,acme/p2-39,acme/p3-0')).body), ['acme/p1-0', 'acme/p2-39']);
  assert.deepEqual(two.paths().filter((p) => p.includes('/orgs/')), [base + 1, base + 2], 'a short page is the last page');
  const many = world({ [base + 1]: page(1, 100), [base + 2]: page(2, 100), [base + 3]: page(3, 100), [base + 4]: page(4, 100) }, { ALLOWED_OWNERS: 'acme' });
  assert.deepEqual(Object.keys((await many.get('acme/p3-99,acme/p4-0')).body), ['acme/p3-99']);
  assert.deepEqual(many.paths().filter((p) => p.includes('/orgs/')), [base + 1, base + 2, base + 3], 'a fourth page is never asked for');
  const broken = world({ [base + 1]: page(1, 100), [base + 2]: { status: 502, text: '' } }, { ALLOWED_OWNERS: 'acme' });
  assert.deepEqual((await broken.get('acme/p1-0')).body, { 'acme/p1-0': {} }, 'half a listing is not a listing');
});

test('an owner that is a user, not an organisation, is listed the other way; an owner that is neither is remembered as gone', async () => {
  const items = [{ ...item('demodeck'), name: 'dotfiles', full_name: 'someone/dotfiles' }];
  const w = world({ '/users/someone/repos?per_page=100&page=1': ok(items) }, { ALLOWED_OWNERS: 'someone,nobody' });
  const r = await w.get('someone/dotfiles');
  assert.equal(r.body['someone/dotfiles'].fullName, 'someone/dotfiles');
  assert.deepEqual(w.paths(), ['/orgs/someone/repos?type=public&per_page=100&page=1', '/users/someone/repos?per_page=100&page=1', '/repos/someone/dotfiles/releases/latest']);
  const gone = await w.get('nobody/anything');
  assert.deepEqual(gone.body, {});
  assert.equal(gone.calls, 2);
  w.now = T0 + 9 * MIN;
  assert.equal((await w.get('nobody/anything,nobody/else')).calls, 0, 'asked again inside ten minutes');
  w.now = T0 + 11 * MIN;
  assert.equal((await w.get('nobody/anything')).calls, 2, 'CONTROL: and after ten minutes it is asked again');
});

// ── the cache: per owner for existence, per repo for releases ──────────────────────────────────

test('🔴 a list already answered costs nothing again — reordered, re-cased, repeated, a subset, or with junk added', async () => {
  // The three requests that used to cost 38, 39 and 40 upstream calls after a 20-repo list had
  // been answered: a 19-repo subset, that subset plus one junk name, and the list with `.git` on
  // its last name. Each is now 0.
  const a = acme(20, ['acme/tool-03', 'acme/tool-11']);
  const w = world(a.routes, a.env);
  const L = a.names;
  assert.equal((await w.get(L.join(','))).calls, 21, 'cold: one listing and twenty releases');
  const measured = {
    reversed: (await w.get([...L].reverse().join(','))).calls,
    uppercased: (await w.get(L.join(',').toUpperCase())).calls,
    subset19: (await w.get(L.slice(0, 19).join(','))).calls,
    subset19PlusJunk: (await w.get(`${L.slice(0, 19).join(',')},acme/z1`)).calls,
    lastWithDotGit: (await w.get(`${L.join(',')}.git`)).calls,
    single: (await w.get(L[7])).calls,
    doubled: (await w.get(`${L[7]},${L[7]},${L[8]}`)).calls,
  };
  assert.deepEqual(measured, { reversed: 0, uppercased: 0, subset19: 0, subset19PlusJunk: 0, lastWithDotGit: 0, single: 0, doubled: 0 });
  // The reviewer's junk name was under ANOTHER owner; that one is refused outright.
  const foreign = await w.request(`?repos=${L.slice(0, 19).join(',')},junk/z1`);
  assert.equal(foreign.status, 400);
  assert.equal(w.calls.length, 21);
  // …and each caller is answered in the spelling it used.
  const cased = await w.get('ACME/TOOL-03,acme/tool-04');
  assert.deepEqual(Object.keys(cased.body), ['ACME/TOOL-03', 'acme/tool-04']);
  assert.equal(cased.body['ACME/TOOL-03'].tag, 'v0.40.0');
  assert.equal(cased.body['acme/tool-04'].tag, null);
});

test('a release is remembered per repo: a new list pays only for the repos it has not seen', async () => {
  const w = world();
  assert.equal((await w.get('CVERInc/clikae,CVERInc/demodeck')).calls, 3);
  const r = await w.get('CVERInc/demodeck,CVERInc/obsidian-tugtile');
  assert.deepEqual(w.paths().slice(3), ['/repos/CVERInc/obsidian-tugtile/releases/latest']);
  assert.deepEqual(r.body, { 'CVERInc/demodeck': DEMODECK, 'CVERInc/obsidian-tugtile': TUGTILE });
});

test('everything is fresh for an hour — including "this repo has no release"', async () => {
  const w = world();
  await w.get(THREE);
  w.now = T0 + 59 * MIN;
  const r = await w.get(THREE);
  assert.equal(r.calls, 0);
  assert.equal(r.state, 'hit');
  assert.deepEqual(r.body['CVERInc/demodeck'], DEMODECK);
});

test('stale-while-revalidate: after the hour the old answer is served at once and refreshed behind it', async () => {
  const w = world();
  await w.get('CVERInc/clikae');
  w.routes['/repos/CVERInc/clikae/releases/latest'] = ok({ ...RELEASE_CLIKAE, tag_name: 'v0.41.0', published_at: '2026-10-09T14:00:00Z' });
  w.routes['/repos/CVERInc/new-thing/releases/latest'] = ok(RELEASE_TUGTILE);
  w.routes[LISTING] = ok([...ORG, { ...item('demodeck'), name: 'new-thing', full_name: 'CVERInc/new-thing' }]);
  w.now = T0 + 61 * MIN;
  const stale = await w.get('CVERInc/clikae,CVERInc/new-thing');
  assert.equal(stale.state, 'stale');
  assert.equal(stale.early.calls, 0, 'the visitor is not made to wait for the forge');
  assert.deepEqual(stale.body, { 'CVERInc/clikae': CLIKAE }, 'the old answer, and a repo the old listing never had is not there yet');
  assert.equal(stale.calls, 3, 'behind it: the listing, the release that was due, and the release of the repo the new listing turned up');
  const fresh = await w.get('CVERInc/clikae,CVERInc/new-thing');
  assert.equal(fresh.calls, 0);
  assert.equal(fresh.body['CVERInc/clikae'].tag, 'v0.41.0');
  assert.equal(fresh.body['CVERInc/clikae'].releasedAt, '2026-10-09');
  assert.equal(fresh.body['CVERInc/new-thing'].tag, '0.3.3');
});

test('a refused request is answered with a short cached negative and costs the forge nothing', async () => {
  const w = world();
  const response = await w.request('?repos=not-a-repo');
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=600');
  assert.equal(w.calls.length, 0);
});

// ── when the forge is slow, down, or says stop ─────────────────────────────────────────────────

test('stale-if-error: the forge failing does not take a known answer off the page', async () => {
  const w = world();
  await w.get('CVERInc/clikae,CVERInc/demodeck');
  w.routes[LISTING] = { status: 502, text: 'Bad Gateway' };
  w.routes['/repos/CVERInc/clikae/releases/latest'] = { status: 502, text: 'Bad Gateway' };
  w.routes['/repos/CVERInc/demodeck/releases/latest'] = { status: 502, text: 'Bad Gateway' };
  w.now = T0 + 2 * DAY;                                   // past stale-while-revalidate: this one waits
  const r = await w.get('CVERInc/clikae,CVERInc/demodeck');
  assert.equal(r.state, 'miss');
  assert.deepEqual(r.body, { 'CVERInc/clikae': CLIKAE, 'CVERInc/demodeck': DEMODECK });
  // …and it is not asked again on the very next request.
  w.now += 5 * 1000;
  assert.equal((await w.get('CVERInc/clikae,CVERInc/demodeck')).calls, 0);
});

test('CONTROL: but not for ever — past seven days a failing forge leaves the repo unread', async () => {
  const w = world();
  await w.get('CVERInc/clikae');
  w.routes[LISTING] = { status: 502, text: 'Bad Gateway' };
  w.now = T0 + 7 * DAY + 2 * HOUR;
  assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': {} });
});

test('🔴 upstream time is bounded: a forge that never answers yields a partial result, not a hung request', async () => {
  const w = world({ ...ROUTES, '/repos/CVERInc/demodeck/releases/latest': 'hang' });
  w.budgetMs = 40;
  const started = Date.now();
  const r = await w.get(THREE);
  assert.ok(Date.now() - started < 1500, 'the request outlived its budget');
  const { tag, releasedAt, ...repoHalf } = DEMODECK;
  assert.deepEqual(r.body, {
    'CVERInc/clikae': CLIKAE,                  // answered in time
    'CVERInc/demodeck': repoHalf,              // known from the listing; its release never came back
    'CVERInc/obsidian-tugtile': TUGTILE,
  });
  assert.equal(r.response.headers.get('cache-control'), 'public, max-age=30, s-maxage=60', 'an answer with a hole is not cached for an hour');
  const dead = world({ [LISTING]: 'hang' });
  dead.budgetMs = 40;
  assert.deepEqual((await dead.get('CVERInc/clikae')).body, { 'CVERInc/clikae': {} });
});

test('🔴 nobody waits for the forge: a cold request is answered by its deadline, and the refresh finishes behind it', async () => {
  assert.equal(DEADLINE_MS, 2000, 'under the three seconds the browser is willing to wait');
  const slow = (answer) => ({ ...answer, delayMs: 250 });
  const w = world({ [LISTING]: slow(ok(ORG)), '/repos/CVERInc/clikae/releases/latest': slow(ok(RELEASE_CLIKAE)) });
  w.deadlineMs = 40;
  const started = Date.now();
  const response = await w.request('?repos=CVERInc/clikae');
  const waited = Date.now() - started;
  assert.ok(waited < 200, `answered after ${waited} ms — it waited for a forge that takes 250 ms per call`);
  assert.deepEqual(await response.json(), { 'CVERInc/clikae': {} }, 'nothing is known yet, and it says so');
  assert.equal(response.headers.get('x-repo-facts-cache'), 'miss');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30, s-maxage=60');
  assert.equal(w.background.length, 1, 'the refresh was handed to the runtime, not dropped with the response');
  await w.settle();
  const later = await w.get('CVERInc/clikae');
  assert.equal(later.state, 'hit');
  assert.equal(later.calls, 0);
  assert.deepEqual(later.body, { 'CVERInc/clikae': CLIKAE });
});

test('CONTROL: the same slow forge, given a deadline it can meet, is answered in full the first time', async () => {
  const slow = (answer) => ({ ...answer, delayMs: 30 });
  const w = world({ [LISTING]: slow(ok(ORG)), '/repos/CVERInc/clikae/releases/latest': slow(ok(RELEASE_CLIKAE)) });
  w.deadlineMs = 1500;
  const response = await w.request('?repos=CVERInc/clikae');
  assert.deepEqual(await response.json(), { 'CVERInc/clikae': CLIKAE });
  await w.settle();
});

test('a read that failed is not repeated for five minutes, and then it is', async () => {
  const w = world({ ...ROUTES, '/repos/CVERInc/clikae/releases/latest': { status: 500, text: '' } });
  const { tag, releasedAt, ...repoHalf } = CLIKAE;
  assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': repoHalf });
  w.routes['/repos/CVERInc/clikae/releases/latest'] = ok(RELEASE_CLIKAE);
  for (const seconds of [20, 61, 299]) {
    w.now = T0 + seconds * 1000;
    assert.equal((await w.get('CVERInc/clikae')).calls, 0, `asked again after ${seconds} s`);
  }
  w.now = T0 + 301 * 1000;
  assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': CLIKAE });
});

test('🔴 a forge that answers 500 for an hour is not asked a thousand times: sixteen cards, one visit a minute', async () => {
  const a = acme(16);
  for (const n of a.names) a.routes[`/repos/${n}/releases/latest`] = { status: 500, text: 'Internal Server Error' };
  const w = world(a.routes, a.env);
  for (let minute = 0; minute < 60; minute++) {
    w.now = T0 + minute * MIN;
    await w.get(a.names.join(','));
  }
  // One listing, and each of the sixteen releases once per five minutes: 1 + 16 × 12.
  assert.equal(w.calls.length, 193, 'retried every minute this is 961');
  // The same hour with the LISTING failing too: one call per five minutes and nothing else.
  const down = world({ '/orgs/acme/repos?type=public&per_page=100&page=1': { status: 500, text: '' } }, a.env);
  for (let minute = 0; minute < 60; minute++) {
    down.now = T0 + minute * MIN;
    await down.get(a.names.join(','));
  }
  assert.equal(down.calls.length, 12);
});

const spent = (extra) => ({
  status: 403,
  json: { message: "API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit.)", documentation_url: 'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting' },
  headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((T0 + 20 * MIN) / 1000), ...extra },
});

test('🔴 rate limited: no retry storm — the calls already in flight, then silence until the reset', async () => {
  const a = acme(24);
  for (const n of a.names) a.routes[`/repos/${n}/releases/latest`] = spent();
  const w = world(a.routes, a.env);
  const first = await w.get(a.names.join(','));
  assert.ok(first.calls <= 7, `${first.calls} calls into a spent quota; the listing and at most one per connection were expected`);
  assert.equal(Object.values(first.body).some((f) => 'tag' in f), false, 'a refusal for quota is not remembered as "no release"');
  assert.equal(first.text.includes('203.0.113.7'), false, 'the forge\'s own error text is not passed on');
  for (const minutes of [1, 2, 10, 19]) {
    w.now = T0 + minutes * MIN;
    const r = await w.get(a.names.join(','));
    assert.equal(r.calls, 0, `called the forge ${minutes} min into a 20 min backoff`);
    assert.equal(r.state, 'backoff');
  }
  // …and that goes for every other owner too, not only the one that found out.
  const other = world({ ...ROUTES, ...a.routes }, { ALLOWED_OWNERS: 'acme,CVERInc' });
  await other.get(a.names.join(','));
  assert.equal((await other.get('CVERInc/clikae')).calls, 0);
});

test('CONTROL: after the reset it asks again, and nothing was remembered wrongly meanwhile', async () => {
  const w = world({ ...ROUTES, [LISTING]: spent() });
  assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': {} });
  w.routes[LISTING] = ok(ORG);
  w.now = T0 + 19 * MIN;
  assert.equal((await w.get('CVERInc/clikae')).calls, 0);
  w.now = T0 + 21 * MIN;
  assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': CLIKAE });
});

test('a 429 with Retry-After is honoured the same way, and stale answers are served through it', async () => {
  const w = world();
  await w.get('CVERInc/clikae');
  w.routes[LISTING] = { status: 429, json: { message: 'You have exceeded a secondary rate limit.' }, headers: { 'retry-after': '120' } };
  w.now = T0 + 2 * DAY;
  const limited = await w.get('CVERInc/clikae');
  assert.equal(limited.calls, 1);
  assert.deepEqual(limited.body, { 'CVERInc/clikae': CLIKAE }, 'stale is served');
  w.now += 90 * 1000;
  const during = await w.get('CVERInc/clikae');
  assert.equal(during.calls, 0);
  assert.deepEqual(during.body, { 'CVERInc/clikae': CLIKAE });
  w.routes[LISTING] = ok(ORG);
  w.now += 60 * 1000;
  const before = w.calls.length;
  await w.get('CVERInc/clikae');
  // The LISTING is what was refused, and it is the listing that must be asked again now: a refusal
  // for quota is not a failure of the thing asked about, and must not be remembered as one past
  // the time the forge itself named.
  assert.ok(w.paths().slice(before).some((p) => p.startsWith('/orgs/')), `after Retry-After had passed it asked only: ${w.paths().slice(before).join(', ') || 'nothing'}`);
});

test('the last unit of quota is noticed on the way out: the next request does not go and find the wall', async () => {
  const w = world({ ...ROUTES, '/repos/CVERInc/clikae/releases/latest': ok(RELEASE_CLIKAE, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((T0 + 20 * MIN) / 1000) }) });
  assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': CLIKAE });
  const next = await w.get('CVERInc/demodeck');
  assert.equal(next.calls, 0);
  assert.equal(next.state, 'backoff');
});

test('🔴 a per-request ceiling: 30 cold repos cost exactly MAX_UPSTREAM calls, and the rest are read next time', async () => {
  const a = acme(30);
  const w = world(a.routes, a.env);
  assert.equal(MAX_UPSTREAM, 24);
  const first = await w.get(a.names.join(','));
  assert.equal(first.calls, 24, 'one listing and twenty-three releases');
  assert.equal(Object.values(first.body).filter((f) => f.tag === null).length, 23);
  assert.equal(Object.keys(first.body).length, 30, 'the rest are known from the listing, release unread');
  w.now = T0 + 2 * 1000;
  const second = await w.get(a.names.join(','));
  assert.equal(second.calls, 7);
  assert.equal(Object.values(second.body).filter((f) => f.tag === null).length, 30);
});

test('🔴 the ceiling counts CALLS, not repos: twenty releases that each redirect once still stop at MAX_UPSTREAM', async () => {
  const a = acme(20);
  a.names.forEach((n, i) => {
    a.routes[`/repos/${n}/releases/latest`] = { status: 301, json: {}, headers: { location: `${GH}/repositories/${1000 + i}/releases/latest` } };
    a.routes[`/repositories/${1000 + i}/releases/latest`] = ok(RELEASE_CLIKAE);
  });
  const w = world(a.routes, a.env);
  const first = await w.get(a.names.join(','));
  assert.equal(first.calls, 24, 'forty-one calls were wanted');
  assert.ok(Object.values(first.body).filter((f) => f.tag === 'v0.40.0').length <= 12);
});

test('🔴 the lease: a visitor in ANOTHER isolate during a refresh is served what is there and calls nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = world();
  const realFetch = w.fetch;
  w.fetch = async (url, init) => { await gate; return realFetch(url, init); };
  const first = w.get('CVERInc/clikae,CVERInc/demodeck');
  await new Promise((r) => setTimeout(r, 10));            // the first request has taken the lease
  // Counted, not thrown: the worker treats a failed upstream call as "no answer", so a fetch that
  // threw here would be swallowed and this test would pass while the second visitor called away.
  let secondCalls = 0;
  const second = await handleRequest(new Request('https://edge.example/v0/repo-facts?repos=CVERInc/demodeck,CVERInc/clikae'), {}, w.ctx,
    { fetch: (url, init) => { secondCalls++; return realFetch(url, init); }, cache: w.cache, now: () => w.now, deadlineMs: 20, inflight: new Map() });
  assert.equal(secondCalls, 0, 'the second visitor called the forge while the first was already asking');
  assert.deepEqual(await second.json(), { 'CVERInc/demodeck': {}, 'CVERInc/clikae': {} });
  release();
  assert.deepEqual((await first).body, { 'CVERInc/clikae': CLIKAE, 'CVERInc/demodeck': DEMODECK });
});

test('a damaged cache entry is treated as no entry', async () => {
  const w = world();
  await w.get('CVERInc/clikae');
  const key = [...w.store.keys()].find((k) => k.endsWith('/owner/cverinc'));
  assert.ok(key, [...w.store.keys()].join(' | '));
  const sound = JSON.parse(w.store.get(key));
  const live = `"at":${T0},"until":${T0 + HOUR}`;
  for (const junk of ['not json', 'null', '[]', '{"list":"x"}', '{"releases":7}', '{}', '{"list":{"state":"ok","at":0,"until":0}}',
    `{"list":{"state":"ok",${live}}}`, `{"list":{"state":"ok",${live},"repos":7}}`,
    // a sound listing with release records that are not records
    JSON.stringify({ ...sound, releases: { 'cverinc/clikae': 7, 'cverinc/demodeck': { state: 'ok' } } })]) {
    w.store.set(key, junk);
    assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': CLIKAE }, junk);
  }
});

// ── requests that arrive together ──────────────────────────────────────────────────────────────

test('🔴 in one isolate, requests that arrive together share ONE refresh: N cold requests cost one round', async () => {
  const a = acme(16, ['acme/tool-05']);
  for (const n of [2, 3, 12]) {
    const w = world(a.routes, a.env);
    const responses = await Promise.all(Array.from({ length: n }, () => w.request(`?repos=${a.names.join(',')}`)));
    await w.settle();
    assert.equal(w.calls.length, 17, `${n} at once: one listing and sixteen releases is one round`);
    for (const response of responses) {
      const body = await response.json();
      assert.equal(Object.values(body).filter((f) => 'tag' in f).length, 16, 'and every one of them got the whole answer');
    }
    assert.equal(w.inflight.size, 0, 'nothing is left registered once the refresh is over');
    assert.equal((await w.get(a.names.join(','))).state, 'hit');
  }
});

test('in one isolate, different lists that arrive together each pay only for their own repos, and the listing once', async () => {
  const a = acme(24);
  const w = world(a.routes, a.env);
  await Promise.all([w.request(`?repos=${a.names.slice(0, 11).join(',')}`), w.request(`?repos=${a.names.slice(11, 23).join(',')}`), w.request(`?repos=${a.names.slice(5, 15).join(',')}`)]);
  await w.settle();
  assert.equal(w.calls.length, 24, 'one listing and twenty-three releases, none of them twice');
  assert.equal(new Set(w.paths()).size, 24);
  assert.equal((await w.get(a.names.slice(0, 23).join(','))).calls, 0);
});

test('🔴 two isolates refreshing at once do not write each other\'s work away: 11 + 12 asked, 23 kept', async () => {
  const a = acme(24);
  const w = world(a.routes, a.env);
  const other = { ...w.deps(), inflight: new Map() };                 // a second isolate: same cache, same forge, its own memory
  const ask = (deps, names) => handleRequest(new Request(`https://edge.example/v0/repo-facts?repos=${names.join(',')}`), w.env, w.ctx, deps);
  await Promise.all([ask(w.deps(), a.names.slice(0, 11)), ask(other, a.names.slice(11, 23))]);
  await w.settle();
  assert.equal(w.calls.length, 25, 'each isolate read the listing (the lease is best effort), and 23 releases between them');
  const entry = JSON.parse(w.store.get([...w.store.keys()].find((k) => k.endsWith('/owner/acme'))));
  assert.equal(Object.keys(entry.releases).length, 23, 'records kept, of 23 learned');
  const all = await w.get(a.names.slice(0, 23).join(','));
  assert.equal(all.calls, 0, 'a second paid round for what was already learned');
  assert.equal(Object.values(all.body).filter((f) => f.tag === null).length, 23);
});

// ── what is kept ───────────────────────────────────────────────────────────────────────────────

test('a listing item that names ANOTHER owner is not kept, even when that owner is allowed too', async () => {
  const stray = { ...item('demodeck'), name: 'thing', full_name: 'other-org/thing' };
  const lookalike = { ...item('demodeck'), name: 'thing', full_name: 'CVERInc-evil/thing' };
  const w = world({ ...ROUTES, [LISTING]: ok([...ORG, stray, lookalike]), '/orgs/other-org/repos?type=public&per_page=100&page=1': ok([]) }, { ALLOWED_OWNERS: 'CVERInc,other-org' });
  const r = await w.get('CVERInc/clikae,other-org/thing');
  assert.deepEqual(r.body, { 'CVERInc/clikae': CLIKAE });
  const kept = [...w.store.values()].join('\n');
  assert.ok(kept.includes('cverinc/clikae'), 'the cache does hold the listing, so the next line means something');
  assert.equal(/other-org\/thing|cverinc-evil/i.test(kept), false, 'an item of another owner was kept in this owner\'s listing');
  assert.equal(w.paths().some((p) => /thing/.test(p)), false);
});

test('a repo that leaves the listing takes its remembered release with it', async () => {
  const w = world();
  await w.get('CVERInc/clikae,CVERInc/demodeck');
  const entryOf = () => JSON.parse(w.store.get([...w.store.keys()].find((k) => k.endsWith('/owner/cverinc'))));
  assert.deepEqual(Object.keys(entryOf().releases).sort(), ['cverinc/clikae', 'cverinc/demodeck']);
  w.routes[LISTING] = ok(ORG.filter((r) => r.name !== 'clikae'));          // made private, renamed, or deleted
  w.now = T0 + 61 * MIN;
  await w.get('CVERInc/clikae,CVERInc/demodeck');
  assert.deepEqual((await w.get('CVERInc/clikae,CVERInc/demodeck')).body, { 'CVERInc/demodeck': DEMODECK });
  assert.deepEqual(Object.keys(entryOf().releases), ['cverinc/demodeck'], 'an answer about a repo that is no longer public was kept');
  assert.equal(JSON.stringify(entryOf()).includes('v0.40.0'), false);
});

test('an owner may be called anything a name can be — `constructor`, `__proto__`, `backoff`', async () => {
  const owners = ['constructor', '__proto__', 'backoff', 'toString', 'hasOwnProperty'];
  const routes = {};
  for (const o of owners) routes[`/orgs/${o}/repos?type=public&per_page=100&page=1`] = ok([{ ...item('demodeck'), name: 'x', full_name: `${o}/x` }]);
  const w = world(routes, { ALLOWED_OWNERS: owners.join(',') });
  const r = await w.get(owners.map((o) => `${o}/x`).join(','));
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), owners.map((o) => `${o}/x`));
  for (const o of owners) assert.equal(r.body[`${o}/x`].fullName, `${o}/x`);
  // …and an owner called `backoff` is not the backoff: nothing here is rate limited.
  assert.equal((await w.get('backoff/x')).state, 'hit');
});

// ── redirects ──────────────────────────────────────────────────────────────────────────────────

test('a release that redirects to the repo\'s numeric address is followed once, by hand', async () => {
  const w = world({
    ...ROUTES,
    '/repos/CVERInc/clikae/releases/latest': { status: 301, json: { message: 'Moved Permanently' }, headers: { location: `${GH}/repositories/1252447134/releases/latest` } },
    '/repositories/1252447134/releases/latest': ok(RELEASE_CLIKAE),
  });
  assert.deepEqual((await w.get('CVERInc/clikae')).body, { 'CVERInc/clikae': CLIKAE });
  assert.deepEqual(w.paths().slice(1), ['/repos/CVERInc/clikae/releases/latest', '/repositories/1252447134/releases/latest']);
  for (const call of w.calls) assert.equal(call.init.redirect, 'manual', 'redirects are followed by hand, never by the runtime');
});

test('🔴 a redirect anywhere else is not followed — judged on the PARSED target, so the token cannot be walked away', async () => {
  const targets = [
    'https://evil.example/repositories/1/releases/latest',
    'https://api.github.com.evil.example/repositories/1/releases/latest',
    'https://api.github.com@example.net/repositories/1/releases/latest',   // the forge's name as a USERNAME on another host
    'http://api.github.com/repositories/1/releases/latest',
    'https://api.github.com:8443/repositories/1/releases/latest',
    `${GH}/repositories/../user`,
    `${GH}/repositories/1/../../user/repos`,
    `${GH}/repositories/1/releases/latest/../../../../user`,
    `${GH}/repositories/..%2fuser`,
    `${GH}/repositories/1/releases/latest?access=https://evil.example`,
    `${GH}/repositories/1/releases`,
    `${GH}/repositories/abc/releases/latest`,
    `${GH}/repos/other/repo/releases/latest`,
    `${GH}/user`,
    '/repositories/1/releases/latest',
    '//evil.example/repositories/1/releases/latest',
  ];
  for (const location of targets) {
    const w = world({ ...ROUTES, '/repos/CVERInc/clikae/releases/latest': { status: 301, json: {}, headers: { location } }, '/user': ok(RELEASE_CLIKAE), '/user/repos': ok(RELEASE_CLIKAE) }, { GITHUB_TOKEN: 't' });
    const r = await w.get('CVERInc/clikae');
    const { tag, releasedAt, ...repoHalf } = CLIKAE;
    assert.deepEqual(r.body, { 'CVERInc/clikae': repoHalf }, location);
    assert.equal(w.calls.length, 2, `${location} was followed: ${w.calls.map((c) => c.url).join(' → ')}`);
  }
});

test('parseRepos: every spelling asked, and the names grouped under their owner', () => {
  const allowed = new Set(['a', 'c']);
  const parsed = parseRepos('c/d,A/B,a/b,a/e', allowed);
  assert.deepEqual({ asked: parsed.asked, owners: { ...parsed.owners } }, { asked: ['c/d', 'A/B', 'a/b', 'a/e'], owners: { c: new Set(['c/d']), a: new Set(['a/b', 'a/e']) } });
  assert.equal(parseRepos('', allowed), null);
  assert.equal(parseRepos(undefined, allowed), null);
  assert.equal(parseRepos('a/b,z/y', allowed), null);
});
