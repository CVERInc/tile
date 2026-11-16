// tile#338: the authenticated reads report the serving stop. run: node --test card-api-serving.test.mjs
//
// The public door reads the serving stop of the current lifetime (`stop:<h>:<gen>`, and the legacy
// `stop:<h>` in generation 0) and answers the no-card 404 while one exists. The authenticated reads
// answer the body anyway: the owner may read their own file while it is stopped. Before tile#338
// they said nothing about the stop, so a caller that could read a body could not tell that the
// public address, and the `.md` download beside it, both 404.
//
// Every authenticated read that answers a body now says so:
//   GET  /_api/card(s)/<h>        → `serving: { stopped }`
//   GET  /_api/card(s)/<h>/full   → `X-Cards-Serving: serving|stopped` (the body is raw markdown)
//   POST /_api/cards              → `serving: { stopped }` on each summary
// and the public door answers exactly what it answered before.
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './card-worker.mjs';
import { cardKey, stopKey, genKey, _internal } from './card-api.mjs';

/** a Map-backed KV that records every read, write and delete */
const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    _m: m, _reads: [], _writes: [],
    async get(k) { this._reads.push(k); return m.has(k) ? m.get(k) : null; },
    async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
    async put(k, v) { this._writes.push(['put', k]); m.set(k, v); },
    async delete(k) { this._writes.push(['delete', k]); m.delete(k); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true };
    },
  };
};

const TOKEN = 'tile-338-fixture-token';
const TOKEN_HASH = await _internal.sha256Hex(TOKEN);
const envWith = (seed) => ({ CARDS: fakeKv(seed), MCP_TOKEN_HASH: TOKEN_HASH, PREVIEW: 'false' });
const ORIGIN = 'https://card.feelreef.com';
const api = (env, method, path, body) => worker.fetch(new Request(ORIGIN + path, {
  method,
  headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env, {});
const pub = (env, path, accept) => worker.fetch(new Request(ORIGIN + path, accept ? { headers: { accept } } : {}), env, {});

const fileFor = (h) => [
  '---', `card-page: ${h}`, `title: Title of ${h}`, '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 avatar=asset:pic %% hello',
  '- [ ] %% card: link w=3 %% [Site](https://example.com)', '',
  '## assets', '',
  '- [ ] %% card: asset id=pic mime=image/gif %% R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', '',
].join('\n');
const STOP = JSON.stringify({ stopped_at: '2026-10-27T00:00:00.000Z', reason: '' });
const G = 'a'.repeat(24); // a non-zero generation

// Each shape: the KV seed, and whether the public door withholds the body.
const H = 'stopcase';
const SHAPES = {
  'no stop (gen 0)': { seed: { [cardKey(H, '0')]: fileFor(H) }, stopped: false },
  'stop:<h>:0 (gen 0)': { seed: { [cardKey(H, '0')]: fileFor(H), [stopKey(H, '0')]: STOP }, stopped: true },
  'legacy stop:<h> (gen 0)': { seed: { [cardKey(H, '0')]: fileFor(H), [`stop:${H}`]: STOP }, stopped: true },
  'legacy bare body + legacy stop:<h>': { seed: { [H]: fileFor(H), [`stop:${H}`]: STOP }, stopped: true },
  'stop:<h>:<gen> (gen ≠ 0)': { seed: { [genKey(H)]: G, [cardKey(H, G)]: fileFor(H), [stopKey(H, G)]: STOP }, stopped: true },
  // a stop left behind by an ended lifetime stops nothing, on either door
  'stale stop of an ended lifetime': {
    seed: { [genKey(H)]: G, [cardKey(H, G)]: fileFor(H), [stopKey(H, '0')]: STOP, [`stop:${H}`]: STOP },
    stopped: false,
  },
};
const PREFIXES = ['card', 'cards'];

const drain = async (r) => { await r.arrayBuffer(); return r.status; };
/** the three public exits that answer this body, as statuses */
const publicDoor = async (env, h) => ({
  page: await drain(await pub(env, `/${h}`)),
  fat: await drain(await pub(env, `/${h}.md`)),
  thin: await drain(await pub(env, `/${h}`, 'text/markdown')),
});

for (const [label, { seed, stopped }] of Object.entries(SHAPES)) {
  for (const prefix of PREFIXES) {
    test(`${label}: GET /_api/${prefix}/<h> reports serving.stopped = ${stopped}`, async () => {
      const env = envWith(seed);
      const res = await api(env, 'GET', `/_api/${prefix}/${H}`);
      assert.equal(res.status, 200);
      const got = await res.json();
      assert.deepEqual(got.serving, { stopped });
      // the rest of the answer is what it was
      assert.deepEqual(Object.keys(got), ['handle', 'version', 'markdown', 'assets', 'total_bytes', 'serving']);
      assert.equal(got.total_bytes, fileFor(H).length);
    });

    test(`${label}: GET /_api/${prefix}/<h>/full answers the whole body and X-Cards-Serving: ${stopped ? 'stopped' : 'serving'}`, async () => {
      const env = envWith(seed);
      const res = await api(env, 'GET', `/_api/${prefix}/${H}/full`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-cards-serving'), stopped ? 'stopped' : 'serving');
      assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
      assert.equal(await res.text(), fileFor(H), 'the owner still reads the whole file while stopped');
    });
  }

  test(`${label}: every authenticated read agrees with the public door`, async () => {
    const env = envWith(seed);
    const door = await publicDoor(env, H);
    const want = stopped ? 404 : 200;
    assert.deepEqual(door, { page: want, fat: want, thin: want }, 'setup: the public door');
    const full = await api(env, 'GET', `/_api/cards/${H}/full`);
    await full.arrayBuffer();
    const get = await (await api(env, 'GET', `/_api/cards/${H}`)).json();
    const list = await (await api(env, 'POST', '/_api/cards', { handles: [H] })).json();
    assert.equal(full.headers.get('x-cards-serving') === 'stopped', door.page === 404);
    assert.equal(get.serving.stopped, door.page === 404);
    assert.equal(list.cards[0].serving.stopped, door.page === 404);
  });
}

test('list_cards: each summary reports its own serving stop', async () => {
  const env = envWith({
    [cardKey('served', '0')]: fileFor('served'),
    [cardKey('stoppedone', '0')]: fileFor('stoppedone'), [stopKey('stoppedone', '0')]: STOP,
    [cardKey('legacystop', '0')]: fileFor('legacystop'), ['stop:legacystop']: STOP,
  });
  const res = await api(env, 'POST', '/_api/cards', { handles: ['served', 'stoppedone', 'nosuchhandle', 'legacystop'] });
  assert.equal(res.status, 200);
  const { cards } = await res.json();
  assert.deepEqual(cards.map((c) => [c.handle, c.serving]), [
    ['served', { stopped: false }],
    ['stoppedone', { stopped: true }],
    ['legacystop', { stopped: true }],
  ]);
  // the rest of each summary is what it was
  for (const c of cards) assert.deepEqual(Object.keys(c), ['handle', 'title', 'version', 'bytes', 'assets', 'serving']);
});

test('the reads report a stop and never lift or write one', async () => {
  for (const { seed } of Object.values(SHAPES)) {
    const env = envWith(seed);
    const before = new Map(env.CARDS._m);
    for (const prefix of PREFIXES) {
      await drain(await api(env, 'GET', `/_api/${prefix}/${H}`));
      await drain(await api(env, 'GET', `/_api/${prefix}/${H}/full`));
    }
    await drain(await api(env, 'POST', '/_api/cards', { handles: [H] }));
    assert.deepEqual(env.CARDS._writes, []);
    assert.deepEqual(env.CARDS._m, before);
  }
});

test('a missing handle is the same 404 it was, with no serving field and no header', async () => {
  const env = envWith({ [stopKey('ghost', '0')]: STOP });
  for (const prefix of PREFIXES) {
    const full = await api(env, 'GET', `/_api/${prefix}/ghost/full`);
    assert.equal(full.status, 404);
    assert.equal(full.headers.get('x-cards-serving'), null);
    assert.deepEqual(await full.json(), { error: 'No card at "ghost".' });
    const get = await api(env, 'GET', `/_api/${prefix}/ghost`);
    assert.equal(get.status, 404);
    assert.deepEqual(await get.json(), { error: 'No card at "ghost".' });
  }
  assert.deepEqual(await (await api(env, 'POST', '/_api/cards', { handles: ['ghost'] })).json(), { cards: [] });
});

// ── no extra KV round trip ──────────────────────────────────────────────────────────────────────
// A KV whose reads resolve in batches: every get issued before the batch is released lands in the
// same round. The stop is read in the same Promise.all as the body, so a read still costs two
// rounds (the `gen:` pointer, then body and stop together), with or without a stop.
const roundKv = (seed) => {
  const kv = fakeKv(seed);
  const get = kv.get.bind(kv);
  let pending = [];
  kv.rounds = 0;
  kv.get = (k) => new Promise((resolve) => {
    if (!pending.length) {
      setImmediate(() => {
        const batch = pending;
        pending = [];
        kv.rounds++;
        for (const [key, done] of batch) get(key).then(done);
      });
    }
    pending.push([k, resolve]);
  });
  return kv;
};

test('the stop is read in the same round as the body: two KV rounds per handle, as before', async () => {
  for (const [label, { seed, stopped }] of Object.entries(SHAPES)) {
    const reads = {};
    for (const [name, call] of [
      ['get', (env) => api(env, 'GET', `/_api/cards/${H}`)],
      ['full', (env) => api(env, 'GET', `/_api/cards/${H}/full`)],
      ['list', (env) => api(env, 'POST', '/_api/cards', { handles: [H] })],
    ]) {
      const env = { ...envWith({}), CARDS: roundKv(seed) };
      assert.equal(await drain(await call(env)), 200, `${label} ${name}`);
      assert.equal(env.CARDS.rounds, 2, `${label}: ${name} took ${env.CARDS.rounds} KV rounds`);
      reads[name] = new Set(env.CARDS._reads);
    }
    // and each read asked exactly the keys the public door asks to decide the same question
    const gen = seed[genKey(H)] || '0';
    const want = [genKey(H), cardKey(H, gen), stopKey(H, gen), ...(gen === '0' ? [H, `stop:${H}`] : [])].sort();
    for (const [name, set] of Object.entries(reads)) assert.deepEqual([...set].sort(), want, `${label}: ${name}`);
    assert.ok(typeof stopped === 'boolean');
  }
});

// ── the public door is unchanged ────────────────────────────────────────────────────────────────
// Byte-for-byte against the code before tile#338 is a lane receipt; in-suite, what the public door
// owes: a stopped body is the no-card 404, byte-identical to a handle that never existed (tile-lab#51),
// and carries no trace of the new field or header.
test('the public door: a stopped body is the never-existed 404, byte for byte, and says nothing new', async () => {
  for (const [label, { seed, stopped }] of Object.entries(SHAPES)) {
    const env = envWith(seed);
    for (const [path, accept] of [[`/${H}`], [`/${H}.md`], [`/${H}`, 'text/markdown']]) {
      const res = await pub(env, path, accept);
      const body = await res.text();
      assert.equal(res.headers.get('x-cards-serving'), null, `${label} ${path}`);
      assert.ok(!body.includes('"serving"'), `${label} ${path}`);
      if (!stopped) { assert.equal(res.status, 200, `${label} ${path}`); continue; }
      const never = await pub(env, path.replace(H, 'neverexisted'), accept);
      assert.equal(res.status, 404, `${label} ${path}`);
      assert.equal(never.status, 404);
      assert.equal(body, await never.text(), `${label} ${path}: the 404 must not tell a stop from a missing handle`);
      assert.deepEqual([...res.headers], [...never.headers], `${label} ${path}`);
    }
  }
});
