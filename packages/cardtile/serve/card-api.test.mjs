// The Card write API.  run: node --test card-api.test.mjs
//
// 🔴 Every gate here is asserted BOTH ways. A test that only shows the happy path proves a route
// exists; it does not prove the guard on it has ever fired — 「從沒看過它失敗的檢查」. So each refusal
// is paired with the same call made legitimately, and each acceptance with the version that must be
// refused. Where the pairing is not obvious the comment says which half is the control.
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi, previewKey, goneKey, liveCard, cardKey, stopKey, genKey, vanityKey, vanityOfKey, vanityBindKey, bindVanity, HostBindings, CardLifetime, ENDED_KEEP_MS, TICKET_TTL_MS, PREVIEW_TTL, _internal } from './card-api.mjs';
import worker from './card-worker.mjs';
import { assembleSave, thinCard, assetManifest, cardVersion, referencedAssets } from '../card-save.mjs';
import { parseCard, serializeCard } from '../card-core.js';

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

// a 1x1 transparent GIF — real base64, so the manifest's byte maths is measured on real bytes
const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const HAND_TYPED = [
  '---', 'card-page: t', 'title: Tester', '---', '',
  '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% hello',
  '- [ ] %% card: link w=3 %% [Site](https://example.com)',
  '',
  '## assets', '',
  `- [ ] %% card: asset id=pic mime=image/gif %% ${GIF}`,
  `- [ ] %% card: asset id=unused mime=image/gif %% ${GIF}`,
  '',
].join('\n');

/**
 * 🔴 The fixture is CANONICALISED, and the raw one above is kept so the difference can be asserted.
 *
 * Hand-typing a card and calling it representative is the trap 「範本的缺陷會乘以 N」 names: HAND_TYPED
 * has one blank line the serializer does not emit, so a byte-exactness control written against it
 * fails for a reason that has nothing to do with the code under test — and the obvious "fix" would
 * have been to loosen the control until it passed. Measured against the three LIVE cards instead
 * (three real cards, 1,161,154 B / 986 B / 166,368 B, 2026-07-30): all three are already
 * canonical and all three round-trip byte-exact through assembleSave. So canonical is what a real
 * card looks like, and that is what the fixture is.
 */
const CARD = serializeCard(parseCard(HAND_TYPED));

const TOKEN = 'super-secret-bearer';
let TOKEN_HASH;

/** A Map-backed KV. Says so: it is a stand-in for the shape, and the real store's eventual
 *  consistency is exactly what it CANNOT model — which is why writeCard reads back in production. */
const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return {
    _m: m,
    _ttl: new Map(),
    _meta: new Map(),
    /** the real KV pages at 1000; a test shrinks it to prove the caller walks the cursor. */
    _pageSize: 1000,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    // the real KV's shape: `{ value, metadata }`, metadata null when none was written
    async getWithMetadata(k) { return { value: await this.get(k), metadata: this._meta.has(k) ? this._meta.get(k) : null }; },
    async put(k, v, opts) {
      m.set(k, v);
      if (opts?.expirationTtl) this._ttl.set(k, opts.expirationTtl);
      if (opts?.metadata !== undefined) this._meta.set(k, opts.metadata); else this._meta.delete(k);
    },
    async delete(k) { m.delete(k); this._meta.delete(k); },
    // KV.list's shape: { keys: [{ name, metadata? }], list_complete, cursor? }, in key order.
    async list({ prefix = '', cursor } = {}) {
      const names = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const slice = names.slice(from, from + this._pageSize);
      const done = from + slice.length >= names.length;
      return {
        keys: slice.map((name) => (this._meta.has(name) ? { name, metadata: this._meta.get(name) } : { name })),
        list_complete: done,
        ...(done ? {} : { cursor: String(from + slice.length) }),
      };
    },
  };
};

const call = (env, method, path, body, token = TOKEN) => {
  const url = new URL('https://card.feelreef.com' + path);
  const req = new Request(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return handleApi(req, env, url);
};

/**
 * A Durable Object namespace holding the real HostBindings class: one object per name, its requests
 * delivered concurrently — what the runtime does once a request awaits anything outside the object
 * (every KV call does). 🔴 It adds NO ordering of its own, so any order a test sees is HostBindings'
 * own queue. `busy(name)` counts the requests inside that object now, queued ones included.
 * Each object has its own `state.storage` (a Map behind the Durable Object storage calls it uses);
 * `storageOf(name)` is that storage, made before the object if a test needs to hold one of its calls.
 * `objectEnv` is the env the OBJECT sees: another location's view of the same KV (codex r6), or env.
 */
const doStorage = () => {
  const m = new Map();
  return {
    _m: m,
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async put(k, v) { m.set(k, structuredClone(v)); },
    async delete(k) { return m.delete(k); },
    // r9: the retry an object schedules when a KV write-through fails; `alarm(name)` below fires it
    _alarm: null,
    async setAlarm(t) { this._alarm = t; },
  };
};
const objectNs = (Class) => (env, objectEnv = env) => {
  const objects = new Map(), inside = new Map(), storages = new Map();
  const storageOf = (name) => { if (!storages.has(name)) storages.set(name, doStorage()); return storages.get(name); };
  return {
    storageOf,
    idFromName: (name) => ({ name }),
    get: ({ name }) => ({
      async fetch(url, init) {
        if (!objects.has(name)) objects.set(name, new Class({ storage: storageOf(name) }, objectEnv));
        inside.set(name, (inside.get(name) || 0) + 1);
        try { return await objects.get(name).fetch(new Request(url, init)); } finally { inside.set(name, inside.get(name) - 1); }
      },
    }),
    busy: (name) => inside.get(name) || 0,
    /** what the runtime does when the alarm the object set comes due */
    alarm: (name) => { storageOf(name)._alarm = null; return objects.get(name).alarm(); },
  };
};
const hostBindingsNs = objectNs(HostBindings);
/** the same, holding the real CardLifetime class: one object per handle (r8) */
const cardLifetimesNs = objectNs(CardLifetime);
const envWith = (seed) => {
  const env = { CARDS: fakeKv(seed), MCP_TOKEN_HASH: TOKEN_HASH };
  env.HOST_BINDINGS = hostBindingsNs(env);
  env.CARD_LIFETIMES = cardLifetimesNs(env);
  return env;
};
/** the body every door serves — NOT a raw `get('<handle>')`: a save writes `card:<handle>:<gen>` (r3),
 *  and a raw read would keep finding the untouched legacy seed and pass without measuring anything. */
const bodyOf = async (env, handle = 't') => (await liveCard(env.CARDS, handle)).md;

test.before(async () => { TOKEN_HASH = await _internal.sha256Hex(TOKEN); });

// ── the door ─────────────────────────────────────────────────────────────────────────────────────

test('a request outside /_api/ is NOT ours — the renderer keeps it', async () => {
  const url = new URL('https://card.feelreef.com/somehandle');
  assert.equal(await handleApi(new Request(url), envWith({}), url), null);
});

test('🔴 no token, wrong token → 401; the right token → not 401', async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'GET', '/_api/card/t', null, null)).status, 401);
  assert.equal((await call(env, 'GET', '/_api/card/t', null, 'wrong')).status, 401);
  // CONTROL: the same call with the real token gets through, so the 401s above mean "the guard
  // fired" and not "this route does not exist".
  assert.equal((await call(env, 'GET', '/_api/card/t')).status, 200);
});

test('🔴 the two 401s are indistinguishable — never say WHICH way it failed', async () => {
  const env = envWith({ t: CARD });
  const a = await (await call(env, 'GET', '/_api/card/t', null, null)).json();
  const b = await (await call(env, 'GET', '/_api/card/t', null, 'wrong')).json();
  assert.deepEqual(a, b);
});

test('🔴 FAIL CLOSED: no MCP_TOKEN_HASH configured → every write is refused, not waved through', async () => {
  // A forgotten `wrangler secret put` must not look like a working deploy. This is the assertion
  // that makes that true — without it, the absent-secret path is the one nobody ever runs.
  const env = { CARDS: fakeKv({ t: CARD }) };
  const res = await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) });
  assert.equal(res.status, 503);
  // CONTROL: same env plus the hash, same call → it works. So 503 is about the secret, not the body.
  const ok = await call({ ...env, MCP_TOKEN_HASH: TOKEN_HASH }, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) });
  assert.equal(ok.status, 200);
});

test('timingSafeEqualHex: equal, unequal, and different lengths', () => {
  assert.equal(_internal.timingSafeEqualHex('abcd', 'abcd'), true);
  assert.equal(_internal.timingSafeEqualHex('abcd', 'abce'), false);
  assert.equal(_internal.timingSafeEqualHex('abcd', 'abc'), false);
  assert.equal(_internal.timingSafeEqualHex('abcd', null), false);
});

// ── get_card ─────────────────────────────────────────────────────────────────────────────────────

test('🔴 get_card is THIN — no base64 crosses the wire, and the manifest says what was left behind', async () => {
  const res = await call(envWith({ t: CARD }), 'GET', '/_api/card/t');
  const body = await res.json();
  assert.ok(!body.markdown.includes(GIF), 'the assets lane came through anyway');
  assert.ok(!/##\s*assets/i.test(body.markdown));
  assert.ok(body.markdown.includes('asset:pic'), 'the REFERENCE must survive — only the bytes go');
  assert.equal(body.total_bytes, CARD.length);
  assert.deepEqual(body.assets.map((a) => [a.id, a.referenced]), [['pic', true], ['unused', false]]);
  assert.equal(body.assets[0].mime, 'image/gif');
  assert.equal(body.assets[0].bytes, Math.floor(GIF.replace(/=+$/, '').length * 3 / 4));
  assert.equal(body.version, await cardVersion(CARD));
});

test('get_card on a handle with no card → 404, and a bad handle → 400', async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'GET', '/_api/card/nobody')).status, 404);
  assert.equal((await call(env, 'GET', '/_api/card/' + encodeURIComponent('bad handle!'))).status, 400);
});

// ── full owner read ───────────────────────────────────────────────────────────────────────────────

test('full owner read returns the stored bytes, identical to the public fat markdown', async () => {
  for (const md of [CARD, HAND_TYPED.replace('hello', 'hello 🐚').replace(/\n/g, '\r\n')]) {
    const env = envWith({ t: md });
    const publicRes = await worker.fetch(new Request('https://card.feelreef.com/t.md'), env);
    assert.equal(publicRes.status, 200);
    const publicBytes = Buffer.from(await publicRes.arrayBuffer());
    assert.deepEqual(publicBytes, Buffer.from(md));
    const res = await call(env, 'GET', '/_api/card/t/full');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), publicBytes);
  }
});

test('a serving stop leaves the full owner read available with the same bytes', async () => {
  const env = envWith({ t: CARD });
  const publicRes = await worker.fetch(new Request('https://card.feelreef.com/t.md'), env);
  assert.equal(publicRes.status, 200);
  const publicBytes = Buffer.from(await publicRes.arrayBuffer());
  for (const marker of ['', JSON.stringify({ reason: 'Review requested' })]) {
    env.CARDS._m.set('stop:t', marker);
    assert.equal((await worker.fetch(new Request('https://card.feelreef.com/t.md'), env)).status, 404);
    const res = await call(env, 'GET', '/_api/card/t/full');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), publicBytes);
    assert.deepEqual([...env.CARDS._m], [['t', CARD], ['stop:t', marker]]);
  }
});

test('full owner read uses the existing bearer guard, including an authorized control', async () => {
  const env = envWith({ t: CARD, 'stop:t': '' });
  const missing = await call(env, 'GET', '/_api/card/t/full', null, null);
  const wrong = await call(env, 'GET', '/_api/card/t/full', null, 'wrong');
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(await missing.json(), await wrong.json());
  assert.equal((await call({ ...env, MCP_TOKEN_HASH: null }, 'GET', '/_api/card/t/full')).status, 503);
  const res = await call(env, 'GET', '/_api/card/t/full');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), CARD);
});

test('full owner read with no card returns the neighbouring routes\' JSON error', async () => {
  const env = envWith({ 'stop:t': '' });
  const res = await call(env, 'GET', '/_api/card/t/full');
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { error: 'No card at "t".' });
  env.CARDS._m.set('t', CARD);
  assert.equal((await call(env, 'GET', '/_api/card/t/full')).status, 200);
});

test('full owner read refuses other methods without changing the stored card or stop', async () => {
  const env = envWith({ t: CARD, 'stop:t': '' });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    const res = await call(env, method, '/_api/card/t/full');
    assert.equal(res.status, 405, method);
    assert.deepEqual(await res.json(), { error: `${method} not allowed here.` });
  }
  assert.deepEqual([...env.CARDS._m], [['t', CARD], ['stop:t', '']]);
  assert.equal((await call(env, 'GET', '/_api/card/t/full')).status, 200);
});

test('full owner read refuses bad handles before touching the store', async () => {
  const env = envWith({ t: CARD }), reads = [];
  const get = env.CARDS.get.bind(env.CARDS);
  env.CARDS.get = async (k) => { reads.push(k); return get(k); };
  for (const handle of ['', '-t', 'bad%20handle', 'bad%2Fhandle', '%ZZ', 't'.repeat(64)]) {
    const res = await call(env, 'GET', `/_api/card/${handle}/full`);
    assert.equal(res.status, 400, handle);
    assert.deepEqual(await res.json(), { error: `Bad handle ${JSON.stringify(handle)}.` });
  }
  assert.deepEqual(reads, []);
  const res = await call(env, 'GET', '/_api/card/%54/full');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), CARD);
  // the generation, that generation's body, and — generation 0 only — the pre-r3 bare key (reef#2618 r3)
  assert.deepEqual(reads.sort(), ['card:t:0', 'gen:t', 't']);
});

// ── serving stop ─────────────────────────────────────────────────────────────────────────────────

test('stop and resume only set and clear the marker, with or without a card body', async () => {
  for (const hasCard of [true, false]) {
    const seed = {
      ...(hasCard ? { t: CARD } : {}),
      'vanity:card.example': 't', 'vanityof:t': 'card.example',
    };
    const env = envWith(seed);
    const writes = [], deletes = [];
    const put = env.CARDS.put.bind(env.CARDS);
    // the generation is the one read a stop makes (r3: the stop belongs to a lifetime); never the body
    const get = env.CARDS.get.bind(env.CARDS);
    env.CARDS.get = async (k) => { if (k !== 'gen:t') throw new Error(`stop must never read ${k}`); return get(k); };
    env.CARDS.put = async (k, v, opts) => { writes.push(k); await put(k, v, opts); };
    env.CARDS.delete = async (k) => { deletes.push(k); env.CARDS._m.delete(k); };
    const reason = hasCard ? 'Review requested' : '';
    const stopped = await call(env, 'PUT', '/_api/card/T/stop', hasCard ? { reason } : undefined);
    assert.equal(stopped.status, 200);
    assert.deepEqual(await stopped.json(), { handle: 't', stopped: true });
    const marker = JSON.parse(env.CARDS._m.get('stop:t:0'));
    assert.deepEqual(Object.keys(marker).sort(), ['reason', 'stopped_at']);
    assert.equal(marker.reason, reason);
    assert.equal(new Date(marker.stopped_at).toISOString(), marker.stopped_at);
    assert.deepEqual(writes, ['stop:t:0']);
    assert.deepEqual([...env.CARDS._m].filter(([k]) => k !== 'stop:t:0'), Object.entries(seed));
    for (let i = 0; i < 2; i++) {
      const resumed = await call(env, 'DELETE', '/_api/card/t/stop');
      assert.equal(resumed.status, 200);
      assert.deepEqual(await resumed.json(), { handle: 't', stopped: false });
      assert.equal(env.CARDS._m.has('stop:t:0'), false);
    }
    // generation 0 also clears the pre-r3 `stop:<handle>`, so a legacy stop can always be lifted
    assert.deepEqual(deletes, ['stop:t:0', 'stop:t', 'stop:t:0', 'stop:t']);
    assert.deepEqual([...env.CARDS._m], Object.entries(seed));
  }
});

test('stop and resume use the existing bearer guard, including an authorized control', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const env = envWith({ t: CARD, 'stop:t': '{"reason":"Review requested"}' });
    const before = [...env.CARDS._m];
    const missing = await call(env, method, '/_api/card/t/stop', null, null);
    const wrong = await call(env, method, '/_api/card/t/stop', null, 'wrong');
    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(await missing.json(), await wrong.json());
    assert.equal((await call({ ...env, MCP_TOKEN_HASH: null }, method, '/_api/card/t/stop')).status, 503);
    assert.deepEqual([...env.CARDS._m], before, 'a refused serving action changed the store');
    assert.equal((await call(env, method, '/_api/card/t/stop')).status, 200);
    assert.equal(env.CARDS._m.has('stop:t:0'), method === 'PUT');
    if (method === 'DELETE') assert.equal(env.CARDS._m.has('stop:t'), false, 'resume left the pre-r3 stop behind');
    assert.equal(env.CARDS._m.get('t'), CARD);
  }
});

test('the stop path refuses other methods and leaves unrelated endpoints unknown', async () => {
  const env = envWith({ t: CARD });
  for (const method of ['GET', 'POST', 'PATCH', 'HEAD', 'OPTIONS']) {
    assert.equal((await call(env, method, '/_api/card/t/stop')).status, 405, method);
  }
  for (const path of ['/_api/card/t/stopped', '/_api/card/t/stop/extra', '/_api/whatever']) {
    const res = await call(env, 'PUT', path);
    assert.equal(res.status, 404, path);
    assert.deepEqual(await res.json(), { error: `No such endpoint: ${path}` });
  }
  assert.deepEqual([...env.CARDS._m], [['t', CARD]]);
  assert.equal((await call(env, 'PUT', '/_api/card/t/stop')).status, 200);
});

test('stop and resume refuse bad handles before touching the store', async () => {
  const env = envWith({ t: CARD });
  for (const handle of ['', '-t', 'bad%20handle', 'bad%2Fhandle', '%ZZ', 't'.repeat(64)]) {
    for (const method of ['PUT', 'DELETE']) {
      assert.equal((await call(env, method, `/_api/card/${handle}/stop`)).status, 400, `${method} ${handle}`);
    }
  }
  assert.deepEqual([...env.CARDS._m], [['t', CARD]]);
  assert.equal((await call(env, 'PUT', '/_api/card/t/stop')).status, 200);
});

// ── save_card ────────────────────────────────────────────────────────────────────────────────────

test('🔴 a save sent WITHOUT assets keeps the pictures — this is the whole thin-card bargain', async () => {
  // The failure this prevents: an agent does the obvious thing (get_card → edit → save_card) and
  // blanks every image on someone's live page, because the card it sent honestly had no assets lane.
  const env = envWith({ t: CARD });
  const thin = thinCard(CARD).replace('hello', 'hello there');
  const res = await call(env, 'PUT', '/_api/card/t', { markdown: thin });
  assert.equal(res.status, 200);
  const stored = await bodyOf(env);
  assert.ok(stored.includes(GIF), 'the assets were dropped');
  assert.equal(Object.keys(parseCard(stored).assets).length, 2);
  assert.ok(stored.includes('hello there'), 'the edit did not land');
});

test('CONTROL: the same round trip with NO edit is byte-identical to what was stored', async () => {
  // If this drifts, every "the edit landed" assertion above is measuring serialization noise.
  const env = envWith({ t: CARD });
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) });
  assert.equal(await bodyOf(env), CARD);
});

test('🔴 a NON-canonical card is normalised ONCE and then stops moving', async () => {
  // The property that matters is convergence, not identity: a save must not be a file that grows a
  // blank line every time somebody edits it. HAND_TYPED is the specimen — asserted to actually
  // differ, so this measures normalisation rather than a no-op.
  assert.notEqual(HAND_TYPED, CARD, 'the fixture is already canonical — this test proves nothing');
  const env = envWith({ t: HAND_TYPED });
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(HAND_TYPED) });
  const first = await bodyOf(env);
  assert.notEqual(first, HAND_TYPED, 'nothing was normalised');
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(first) });
  assert.equal(await bodyOf(env), first, 'the card is still drifting on the second save');
});

test('🔴 orphans are REPORTED, and the bytes are still there afterwards', async () => {
  const env = envWith({ t: CARD });
  const body = await (await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) })).json();
  assert.deepEqual(body.orphans, ['unused']);
  assert.equal(body.assets_carried, 2);
  // the report is not a deletion
  assert.ok((await bodyOf(env)).includes('id=unused'), 'reporting an orphan collected it');
});

test('CONTROL: an orphan that becomes referenced stops being reported', async () => {
  // Without this, `orphans: ['unused']` could equally mean "the scanner found nothing at all".
  const env = envWith({ t: CARD });
  const thin = thinCard(CARD).replace('[Site](https://example.com)', '[Site](https://example.com)')
    .replace('avatar="asset:pic"', 'avatar="asset:pic" chips="asset:unused"');
  const body = await (await call(env, 'PUT', '/_api/card/t', { markdown: thin })).json();
  assert.deepEqual(body.orphans, []);
});

test('🔴 base_version guards the write, and the conflict names both sides', async () => {
  const env = envWith({ t: CARD });
  const stale = 'v1:0000000000000000';
  const res = await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD), base_version: stale });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.conflict, true);
  assert.equal(body.expected, stale);
  assert.equal(body.current, await cardVersion(CARD));
  assert.equal(await bodyOf(env), CARD, 'a refused save wrote anyway');
  // CONTROL: the CORRECT base_version passes. Otherwise the 409 might just mean "guard always fires".
  const ok = await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD), base_version: await cardVersion(CARD) });
  assert.equal(ok.status, 200);
});

test('base_version against a handle that has no card is a conflict, not a create', async () => {
  const env = envWith({});
  const res = await call(env, 'PUT', '/_api/card/fresh', { markdown: thinCard(CARD), base_version: 'v1:abc' });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).current, null);
  // CONTROL: no base_version → it creates.
  const made = await call(env, 'PUT', '/_api/card/fresh', { markdown: thinCard(CARD) });
  assert.equal(made.status, 200);
  assert.equal((await made.json()).created, true);
});

test('dry_run validates and writes nothing', async () => {
  const env = envWith({ t: CARD });
  const body = await (await call(env, 'PUT', '/_api/card/t', {
    markdown: thinCard(CARD).replace('hello', 'changed'), dry_run: true,
  })).json();
  assert.equal(body.dry_run, true);
  assert.equal(body.wouldChange, true);
  assert.equal(await bodyOf(env), CARD, 'dry_run wrote');
  // CONTROL: an unchanged dry_run reports wouldChange:false — so the flag tracks the content.
  const same = await (await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD), dry_run: true })).json();
  assert.equal(same.wouldChange, false);
});

test('an empty markdown is refused — a save is never how a card gets deleted', async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: '' })).status, 400);
  assert.equal((await call(env, 'PUT', '/_api/card/t', {})).status, 400);
  assert.equal(await bodyOf(env), CARD);
});

test('the structural diff shows what the write actually changed', async () => {
  const env = envWith({ t: CARD });
  const thin = thinCard(CARD).replace(/- \[ \] %% card: link[^\n]*\n/, '');
  const body = await (await call(env, 'PUT', '/_api/card/t', { markdown: thin, dry_run: true })).json();
  assert.equal(body.diff.cells.before, 2);
  assert.equal(body.diff.cells.after, 1);
  assert.deepEqual(body.diff.types.link, { before: 1, after: 0 });
  // CONTROL: an unchanged save reports no type deltas at all.
  const same = await (await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD), dry_run: true })).json();
  assert.deepEqual(same.diff.types, {});
});

// ── assets ───────────────────────────────────────────────────────────────────────────────────────

test('put_asset adds bytes and bumps the version', async () => {
  const env = envWith({ t: CARD });
  const before = await cardVersion(CARD);
  const body = await (await call(env, 'PUT', '/_api/card/t/asset/two', { base64: GIF, mime: 'image/gif' })).json();
  assert.equal(body.id, 'two');
  assert.notEqual(body.version, before);
  assert.equal(Object.keys(parseCard(await bodyOf(env)).assets).length, 3);
});

test('put_asset refuses input that is not base64, and a bad id', async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/two', { base64: 'not base64!!' })).status, 400);
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/' + encodeURIComponent('a/b'), { base64: GIF })).status, 400);
  assert.equal(Object.keys(parseCard(await bodyOf(env)).assets).length, 2, 'a refused put wrote anyway');
  // CONTROL: valid base64 under a valid id lands.
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/two', { base64: GIF })).status, 200);
});

test('🔴 delete_asset REFUSES while the card still points at it', async () => {
  const env = envWith({ t: CARD });
  const res = await call(env, 'DELETE', '/_api/card/t/asset/pic');
  assert.equal(res.status, 409);
  assert.equal((await res.json()).referenced, true);
  assert.ok((await bodyOf(env)).includes('id=pic'));
  // CONTROL: the UNreferenced one deletes. So the 409 is about the reference, not about DELETE.
  const gone = await call(env, 'DELETE', '/_api/card/t/asset/unused');
  assert.equal(gone.status, 200);
  assert.equal(Object.keys(parseCard(await bodyOf(env)).assets).length, 1);
});

test('delete_asset on an id that is not there → 404', async () => {
  assert.equal((await call(envWith({ t: CARD }), 'DELETE', '/_api/card/t/asset/ghost')).status, 404);
});

// ── list + preview ───────────────────────────────────────────────────────────────────────────────

test('🔴 list_cards answers about the handles it is GIVEN — it never decides which', async () => {
  // The registry decides. If this endpoint ever grew a "cards for account X" mode it would be a
  // second authorisation path, in a second repo, on a second deploy cadence.
  const env = envWith({ t: CARD, other: CARD.replace('title: Tester', 'title: Other') });
  const body = await (await call(env, 'POST', '/_api/cards', { handles: ['t', 'nope'] })).json();
  assert.deepEqual(body.cards.map((c) => c.handle), ['t']);
  assert.equal(body.cards[0].title, 'Tester');
  assert.equal(body.cards[0].assets, 2);
  // 'other' EXISTS and was not asked for, so it is absent because of the argument, not the store
  const both = await (await call(env, 'POST', '/_api/cards', { handles: ['t', 'other'] })).json();
  assert.deepEqual(both.cards.map((c) => c.handle), ['t', 'other']);
});

test('preview_card parks a draft with a TTL and hands back a URL', async () => {
  const env = envWith({ t: CARD });
  const body = await (await call(env, 'POST', '/_api/preview', { handle: 't', markdown: thinCard(CARD) })).json();
  const id = /\/_preview\/([0-9a-f]{32})$/.exec(body.url)[1];
  assert.equal(body.expires_in_seconds, PREVIEW_TTL);
  assert.equal(env.CARDS._ttl.get(previewKey(id)), PREVIEW_TTL);
  // 🔴 the draft carries the pictures — a preview without them answers a different question
  assert.ok((await env.CARDS.get(previewKey(id))).includes(GIF));
  // and the live card is untouched
  assert.equal(await bodyOf(env), CARD);
});

test('an unknown endpoint under /_api/ is a 404 WITH a token — not a silent pass to the renderer', async () => {
  assert.equal((await call(envWith({}), 'GET', '/_api/whatever')).status, 404);
  assert.equal((await call(envWith({ t: CARD }), 'POST', '/_api/card/t')).status, 405);
});

// ── the pure half ────────────────────────────────────────────────────────────────────────────────

test('referencedAssets over-counts rather than under-counts, on purpose', () => {
  // …and each one's raster copy (`<id>.png`, reef#1092) rides along — no cell names a copy
  assert.deepEqual([...referencedAssets('avatar="asset:a" and prose mentioning asset:b')], ['a', 'a.png', 'b', 'b.png']);
  // base64 has no colon, so a blob can never be mistaken for a reference
  assert.deepEqual([...referencedAssets(GIF)], []);
});

test('assembleSave on a NEW card carries nothing and reports nothing', () => {
  const { md, orphans, carried } = assembleSave(thinCard(CARD), null);
  assert.deepEqual(orphans, []);
  assert.equal(carried, 0);
  assert.ok(!md.includes(GIF));
});

test('assembleSave IGNORES an assets lane the caller sent — the store is the source', () => {
  // A caller that posts a fat card must not be able to rewrite the bytes through the save door;
  // put_asset is the one door for that.
  // a forged blob that cannot occur by accident — 'AAAA' would have matched inside the real GIF's
  // own base64 (`…AIAAAAAAAP…`), i.e. a control that passes because the needle is in the haystack.
  const FORGED = 'Zm9yZ2VkLWJ5dGVzLW5vdC1hLXBpY3R1cmU=';
  const forged = CARD.split(GIF).join(FORGED);
  const { md } = assembleSave(forged, CARD);
  assert.ok(md.includes(GIF), "the caller's bytes won");
  assert.ok(!md.includes(FORGED));
});

test('thinCard is idempotent and assetManifest counts decoded bytes', () => {
  assert.equal(thinCard(thinCard(CARD)), thinCard(CARD));
  assert.equal(assetManifest(thinCard(CARD)).length, 0);
});

// ── delete_card (reef#2618) ──────────────────────────────────────────────────────────────────────
//
// chodaict's ruling: an owner may delete their Card — nothing kept, the handle free at once. What IS
// kept is one fact with no content in it: that this handle had a card and when it went, so the
// public address answers 410 Gone instead of pretending it never existed.

const page = (env, path) => worker.fetch(new Request('https://card.feelreef.com' + path), env);
const previewIdOf = async (env, handle) => {
  const body = await (await call(env, 'POST', '/_api/preview', { handle, markdown: thinCard(CARD) })).json();
  return /\/_preview\/([0-9a-f]{32})$/.exec(body.url)[1];
};

test('🔴 delete → 410 → PUT → 200: the handle is released, and the next save brings it back', async () => {
  const env = envWith({ t: CARD });
  // CONTROL: the card serves before the delete, so the 410 below is about the delete.
  assert.equal((await page(env, '/t')).status, 200);

  const res = await call(env, 'DELETE', '/_api/card/t');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { handle: 't', deleted: true });
  assert.equal(env.CARDS._m.has('t'), false, 'the card body survived its delete');

  for (const path of ['/t', '/t.md', '/t/favicon.ico']) {
    const gone = await page(env, path);
    assert.equal(gone.status, 410, `${path} after delete`);
    const text = await gone.text();
    assert.ok(!text.includes('Tester') && !text.includes(GIF), `${path}: the 410 leaked the old card`);
  }
  assert.equal((await call(env, 'GET', '/_api/card/t')).status, 404, 'the API still sees a card');

  const created = await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD).replace('Tester', 'Next') });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).created, true);
  assert.equal(env.CARDS._m.has(goneKey('t')), false, 'the save left the gone marker behind');
  const back = await page(env, '/t');
  assert.equal(back.status, 200);
  assert.ok((await back.text()).includes('Next'));
});

test('🔴 the gone marker holds no content — only that it was deleted, and when', async () => {
  const env = envWith({ t: CARD, 'stop:t': JSON.stringify({ stopped_at: 'x', reason: 'private words' }) });
  const before = Date.now();
  await call(env, 'DELETE', '/_api/card/t');
  const raw = env.CARDS._m.get(goneKey('t'));
  assert.equal(typeof raw, 'string');
  const marker = JSON.parse(raw);
  // the WHOLE shape, not "has deleted_at": an extra field is exactly how content creeps back in
  assert.deepEqual(Object.keys(marker), ['deleted_at']);
  assert.match(marker.deleted_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(marker.deleted_at) >= before - 1000);
  assert.ok(raw.length < 64, `a ${raw.length}-byte marker is carrying something`);
  assert.equal(env.CARDS._meta.has(goneKey('t')), false, 'the marker carries metadata');
});

test('🔴 delete sweeps stop:<handle> and EVERY preview of that handle — and only that handle', async () => {
  const env = envWith({ t: CARD, other: CARD, 'stop:t': '{}', 'stop:other': '{}' });
  env.CARDS._pageSize = 2; // more previews than one page: the sweep must follow the cursor
  const mine = [await previewIdOf(env, 't'), await previewIdOf(env, 't'), await previewIdOf(env, 't')];
  const theirs = [await previewIdOf(env, 'other'), await previewIdOf(env, 'other')];
  // CONTROL: the previews exist and render before the delete.
  for (const id of mine) assert.equal((await page(env, `/_preview/${id}`)).status, 200);

  await call(env, 'DELETE', '/_api/card/t');
  for (const id of mine) {
    assert.equal(env.CARDS._m.has(previewKey(id)), false, `preview ${id} of a deleted card survived`);
    assert.equal((await page(env, `/_preview/${id}`)).status, 404);
  }
  assert.equal(env.CARDS._m.has('stop:t'), false);
  // the neighbour is untouched
  for (const id of theirs) assert.equal(env.CARDS._m.has(previewKey(id)), true, "swept another handle's preview");
  assert.equal(env.CARDS._m.get('other'), CARD);
  assert.equal(env.CARDS._m.get('stop:other'), '{}');
});

test("🔴 delete unbinds the card's own domain, so the next owner of the handle does not inherit it", async () => {
  const env = envWith({
    t: CARD, 'vanity:me.example': 't', 'vanityof:t': 'me.example',
    other: CARD, 'vanity:else.example': 'other', 'vanityof:other': 'else.example',
  });
  // CONTROL: bound, the canonical address 301s to the creator's domain.
  assert.equal((await page(env, '/t')).status, 301);
  await call(env, 'DELETE', '/_api/card/t');
  assert.equal(env.CARDS._m.has('vanityof:t'), false);
  // the pointer is shared with whatever binds the host next (r5, card-api vanityKey): DELETE leaves it,
  // and without a binding of the handle's current lifetime it serves nothing (below)
  assert.equal(env.CARDS._m.get('vanity:me.example'), 't');
  assert.equal(env.CARDS._m.get('vanity:else.example'), 'other');
  assert.equal(env.CARDS._m.get('vanityof:other'), 'else.example');
  // a reused handle is served at its own address, not 301'd to the previous owner's domain
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) });
  assert.equal((await page(env, '/t')).status, 200);
  assert.equal((await host(env, 'me.example', '/')).status, 404, "the previous owner's domain serves the next owner");
  assert.equal((await host(env, 'else.example', '/')).status, 200, "CONTROL: the neighbour's domain still serves");
});

test('delete twice: the second answers deleted:false, rewrites no marker, and only starts a new generation', async () => {
  const env = envWith({ t: CARD });
  await call(env, 'DELETE', '/_api/card/t');
  const first = env.CARDS._m.get(goneKey('t'));
  // 🔴 Count the writes, don't compare timestamps: two calls inside one millisecond serialize the same
  // `deleted_at`, so "the marker reads the same" passes even when the second call rewrote it (r1 review
  // P3: the `had || marked` mutant survived exactly that way). The claim is the exact list of puts:
  // the marker is never rewritten, and the generation always is (r3, codex r2 finding 4) — a marker
  // means a lifetime ended here, and a later one may be live where this request's reads cannot see.
  const puts = [];
  const put = env.CARDS.put.bind(env.CARDS);
  env.CARDS.put = async (k, v, opts) => { puts.push(k); return put(k, v, opts); };
  const again = await call(env, 'DELETE', '/_api/card/t');
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { handle: 't', deleted: false });
  assert.deepEqual(puts, [genKey('t')], 'the second delete wrote something other than a new generation');
  assert.equal(env.CARDS._m.get(goneKey('t')), first);
  assert.equal((await page(env, '/t')).status, 410);
});

test('delete a handle that never existed: deleted:false, no marker, still the ordinary 404', async () => {
  const env = envWith({ other: CARD });
  const res = await call(env, 'DELETE', '/_api/card/never');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { handle: 'never', deleted: false });
  // a marker here would make the public page claim a card that never was. The generation is written
  // anyway (r4): DELETE rotates whatever it saw, so the price of a no-op delete is this one small key.
  assert.deepEqual([...env.CARDS._m.keys()], ['other', genKey('never')]);
  assert.equal((await page(env, '/never')).status, 404);
});

test('delete_card uses the bearer guard and refuses bad handles before touching the store', async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'DELETE', '/_api/card/t', null, null)).status, 401);
  assert.equal((await call(env, 'DELETE', '/_api/card/t', null, 'wrong')).status, 401);
  assert.equal((await call(env, 'DELETE', '/_api/card/Bad_Handle!')).status, 400);
  assert.deepEqual([...env.CARDS._m], [['t', CARD]], 'a refused delete changed the store');
  // CONTROL: the authorised call does delete.
  assert.equal((await (await call(env, 'DELETE', '/_api/card/t')).json()).deleted, true);
});

test('a gone marker WITH a live card body is not 410 — the live card wins', async () => {
  // A body of the CURRENT lifetime (here: one from before generations, generation 0's legacy key) is
  // the card. A save that raced the delete is not this case — it lands on a dead generation's key (below).
  const env = envWith({ t: CARD, [goneKey('t')]: JSON.stringify({ deleted_at: new Date().toISOString() }) });
  assert.equal((await page(env, '/t')).status, 200);
});

// ── lifetimes (reef#2618 r2, r3) ─────────────────────────────────────────────────────────────────
//
// KV has no compare-and-swap, so a write admitted before a delete can still land after it. These
// reproduce the r1 and r2 reviews' sequences with PROMISE BARRIERS (the write is held at a named await
// and released after the delete), never with timing — and assert the stale write is not served, and
// the next owner's card is what it was. r3: what makes that true is the KEY, not a check.

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const NEXT = thinCard(CARD).replace('Tester', 'Next owner');
const host = (env, h, path) => worker.fetch(new Request(`https://${h}${path}`), env);

test("🔴 a creator's former domain serves nothing after delete + reuse — on every path, not only /", async () => {
  const env = envWith({ t: CARD, 'vanity:former.example': 't', 'vanityof:t': 'former.example' });
  // CONTROL: bound, the domain serves the card at / and 301s its old /t alias there.
  assert.equal((await host(env, 'former.example', '/')).status, 200);
  assert.equal((await host(env, 'former.example', '/t')).status, 301);

  await call(env, 'DELETE', '/_api/card/t');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);

  // the Cloudflare-for-SaaS hostname may still route here; without a binding, no path names a card
  for (const path of ['/', '/t', '/t.md', '/t/favicon.ico', '/t/avatar', '/index.md']) {
    const res = await host(env, 'former.example', path);
    assert.equal(res.status, 404, `former.example${path}`);
    assert.ok(!(await res.text()).includes('Next owner'), `former.example${path} served the next owner`);
  }
  // CONTROL: the next owner's card is served — at the canonical address.
  const canon = await page(env, '/t');
  assert.equal(canon.status, 200);
  assert.ok((await canon.text()).includes('Next owner'));
});

test('🔴 an old save held on Web Risk across delete + reuse is refused, and the next owner keeps their card', async () => {
  const env = envWith({ t: CARD });
  const started = deferred(), release = deferred();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    started.resolve();
    await release.promise;
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  try {
    // admitted: valid base_version, generation captured — then held at the Web Risk lookup
    const pending = call({ ...env, WEB_RISK_API_KEY: 'fixture-only' }, 'PUT', '/_api/card/t',
      { markdown: thinCard(CARD), base_version: await cardVersion(CARD) });
    await started.promise;
    assert.deepEqual(await (await call(env, 'DELETE', '/_api/card/t')).json(), { handle: 't', deleted: true });
    assert.equal((await page(env, '/t')).status, 410);
    assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
    const nextBody = await bodyOf(env);
    assert.ok(nextBody.includes('Next owner'));
    release.resolve();

    const stale = await pending;
    assert.equal(stale.status, 409, 'a save from the deleted lifetime was accepted');
    assert.equal((await stale.json()).stale_generation, true);
    assert.equal(await bodyOf(env), nextBody, "the stale save touched the next owner's bytes");
    const res = await page(env, '/t');
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('Next owner') && !text.includes('>Tester<'), 'the former card came back');
  } finally {
    globalThis.fetch = realFetch;
    release.resolve();
  }
});

/** hold the FIRST put whose key passes `match` until released; `started` resolves to that key. */
const holdPut = (env, match) => {
  const started = deferred(), release = deferred();
  const put = env.CARDS.put.bind(env.CARDS);
  let hold = true;
  env.CARDS.put = async (k, v, opts) => {
    if (hold && match(k)) { hold = false; started.resolve(k); await release.promise; }
    return put(k, v, opts);
  };
  return { started: started.promise, release: () => release.resolve() };
};
/** a handle in a lifetime that is not its first: created, deleted, created again. */
const reborn = async (md = thinCard(CARD)) => {
  const env = envWith({});
  await call(env, 'PUT', '/_api/card/t', { markdown: md });
  await call(env, 'DELETE', '/_api/card/t');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: md })).status, 200);
  assert.match(env.CARDS._m.get(genKey('t')), /^[0-9a-f]{24}$/);
  return env;
};

test('🔴 a save whose put lands AFTER the delete lands on the dead generation: 410, never the deleted card; the next delete sweeps it', async () => {
  // The window no check can close: held INSIDE the put, after every check passed.
  const env = envWith({ t: CARD });
  const held = holdPut(env, (k) => k === cardKey('t', '0'));
  const pending = call(env, 'PUT', '/_api/card/t',
    { markdown: thinCard(CARD).replace('hello', 'late words'), base_version: await cardVersion(CARD) });
  await held.started;
  assert.equal((await (await call(env, 'DELETE', '/_api/card/t')).json()).deleted, true);
  held.release();

  const stale = await pending;
  assert.equal(stale.status, 409, 'the writer was told "saved" for a write that is never served');
  assert.ok(env.CARDS._m.get(cardKey('t', '0')).includes('late words'), 'CONTROL: the stale body did land in the store');
  for (const path of ['/t', '/t.md', '/t/favicon.ico']) {
    const res = await page(env, path);
    assert.equal(res.status, 410, `${path} resurrected the deleted card`);
    assert.ok(!(await res.text()).includes('late words'));
  }
  assert.equal((await call(env, 'GET', '/_api/card/t')).status, 404);
  assert.equal((await call(env, 'GET', '/_api/card/t/full')).status, 404);
  // the sweep: the next delete removes every lifetime's body
  await call(env, 'DELETE', '/_api/card/t');
  assert.deepEqual([...env.CARDS._m.keys()].filter((k) => k.startsWith('card:t:') || k === 't'), []);
});

// ── codex r2's four interleavings (reef#2618 r3) ─────────────────────────────────────────────────

test('🔴 r2#1 a create whose write is held across a second create + delete does not bring either back', async () => {
  const env = envWith({});
  const held = holdPut(env, (k) => k.startsWith('card:t:') || k === genKey('t'));
  const pending = call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD).replace('hello', 'create A') });
  const key = await held.started;
  assert.equal(key, cardKey('t', '0'), 'a create wrote something before its body — it must never write gen:');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
  assert.equal((await (await call(env, 'DELETE', '/_api/card/t')).json()).deleted, true);
  assert.equal((await page(env, '/t')).status, 410);
  held.release();
  assert.equal((await pending).status, 409);
  const res = await page(env, '/t');
  assert.equal(res.status, 410, 'the held create resurrected the deleted handle');
  const text = await res.text();
  assert.ok(!text.includes('create A') && !text.includes('Next owner'));
  assert.equal((await call(env, 'GET', '/_api/card/t')).status, 404);
});

test("🔴 r2#2 an old owner's body put held across delete + reuse leaves the next owner's bytes intact", async () => {
  const env = envWith({ t: CARD });
  const held = holdPut(env, (k) => k === 't' || k.startsWith('card:t:'));
  const pending = call(env, 'PUT', '/_api/card/t',
    { markdown: thinCard(CARD).replace('hello', 'former words'), base_version: await cardVersion(CARD) });
  await held.started;
  await call(env, 'DELETE', '/_api/card/t');
  const created = await call(env, 'PUT', '/_api/card/t', { markdown: NEXT });
  assert.equal(created.status, 200);
  const nextBody = await bodyOf(env);
  held.release();
  assert.equal((await pending).status, 409);
  assert.equal(await bodyOf(env), nextBody, "the former owner's put overwrote the next owner's body");
  const full = await call(env, 'GET', '/_api/card/t/full');
  assert.equal(full.status, 200);
  assert.equal(await full.text(), nextBody);
  const res = await page(env, '/t');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('Next owner') && !text.includes('former words'));
});

test("🔴 r2#3 a stop held across delete + reuse is inert: the next owner's card keeps serving", async () => {
  const env = envWith({ t: CARD });
  const held = holdPut(env, (k) => k.startsWith('stop:t'));
  const pending = call(env, 'PUT', '/_api/card/t/stop', { reason: 'former owner' });
  await held.started;
  await call(env, 'DELETE', '/_api/card/t');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
  assert.equal((await page(env, '/t')).status, 200);
  held.release();
  assert.equal((await pending).status, 409);
  assert.ok(env.CARDS._m.has(stopKey('t', '0')), 'CONTROL: the stale stop did land in the store');
  assert.equal((await page(env, '/t')).status, 200, "a former owner's stop disabled the next owner's card");
  // CONTROL: a stop in the current lifetime does stop it
  assert.equal((await call(env, 'PUT', '/_api/card/t/stop', {})).status, 200);
  assert.equal((await page(env, '/t')).status, 404);
});

test('🔴 r2#4 a DELETE whose gen: read is a cached negative still ends the lifetime', async () => {
  const env = await reborn();
  const base = (await (await call(env, 'GET', '/_api/card/t')).json()).version;
  const held = holdPut(env, (k) => k.startsWith('card:t:'));
  const pending = call(env, 'PUT', '/_api/card/t',
    { markdown: thinCard(CARD).replace('hello', 'late words'), base_version: base });
  await held.started;
  const before = env.CARDS._m.get(genKey('t'));
  // another location: everything current, except a cached "no such key" for gen:t
  const get = env.CARDS.get.bind(env.CARDS);
  const remote = { ...env, CARDS: { ...env.CARDS, get: async (k) => (k === genKey('t') ? null : get(k)) } };
  await call(remote, 'DELETE', '/_api/card/t');
  assert.notEqual(env.CARDS._m.get(genKey('t')), before, 'the stale read let DELETE skip the new generation');
  held.release();
  await pending;
  const res = await page(env, '/t');
  assert.equal(res.status, 410, 'the save admitted in the deleted lifetime is live after convergence');
  assert.ok(!(await res.text()).includes('late words'));
});

test("🔴 a save paused at ANY of its gen: reads writes only its admitted generation — the next owner's bytes stay", async () => {
  // Not one hand-picked pause: every read of gen:t the save makes after admission, in turn. A key
  // computed from a later read (instead of the one taken at admission) would be the new lifetime's.
  for (let n = 2; ; n++) {
    const env = envWith({ t: CARD });
    const get = env.CARDS.get.bind(env.CARDS);
    const started = deferred(), release = deferred();
    let reads = 0, held = false, mine = true;
    env.CARDS.get = async (k) => {
      if (mine && k === genKey('t') && ++reads === n) { held = true; started.resolve(); await release.promise; }
      return get(k);
    };
    const pending = call(env, 'PUT', '/_api/card/t',
      { markdown: thinCard(CARD).replace('hello', 'former words'), base_version: await cardVersion(CARD) })
      .then((r) => { started.resolve(); return r; });
    await started.promise;
    if (!held) { await pending; assert.ok(n > 3, `the save read gen:t only ${n - 1} times`); break; }
    mine = false;
    await call(env, 'DELETE', '/_api/card/t');
    assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
    const nextBody = await bodyOf(env);
    release.resolve();
    await pending;
    assert.equal(await bodyOf(env), nextBody, `paused at gen:t read #${n}, the old save overwrote the next owner`);
    assert.ok((await (await page(env, '/t')).text()).includes('Next owner'));
  }
});

test('🔴 a DELETE every one of whose reads misses still ends the lifetime (r4: rotation is unconditional)', async () => {
  // Every read can be another location's stale view — gen:, the body, the marker, the listing. Rotation
  // used to hang on "did I see a lifetime"; here the DELETE sees nothing at all, and still ends it.
  const env = await reborn();
  const base = (await (await call(env, 'GET', '/_api/card/t')).json()).version;
  const held = holdPut(env, (k) => k.startsWith('card:t:'));
  const pending = call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD).replace('hello', 'late words'), base_version: base });
  await held.started;
  const before = env.CARDS._m.get(genKey('t'));
  const blind = { ...env, CARDS: { ...env.CARDS, get: async () => null, list: async () => ({ keys: [], list_complete: true }) } };
  assert.deepEqual(await (await call(blind, 'DELETE', '/_api/card/t')).json(), { handle: 't', deleted: false });
  assert.notEqual(env.CARDS._m.get(genKey('t')), before, 'a DELETE that saw nothing skipped the new generation');
  held.release();
  assert.equal((await pending).status, 409);
  const res = await page(env, '/t');
  assert.notEqual(res.status, 200, 'the save admitted in the ended lifetime is live after convergence');
  assert.ok(!(await res.text()).includes('late words'));
});

test('🔴 codex r3#1 a DELETE that sees only a legacy body beside a later generation still ends it', async () => {
  // A legacy handle, deleted and created again (generation G). Another location still caches the bare
  // pre-r3 body and misses card:t:G, gone:t and the listing. The bare body is never SERVED outside
  // generation 0, but it is evidence a card was here: the answer says so, and the lifetime ends.
  const env = envWith({ t: CARD });
  await call(env, 'DELETE', '/_api/card/t');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) })).status, 200);
  const G = env.CARDS._m.get(genKey('t'));
  const base = (await (await call(env, 'GET', '/_api/card/t')).json()).version;
  const held = holdPut(env, (k) => k === cardKey('t', G));
  const pending = call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD).replace('hello', 'late words'), base_version: base });
  await held.started;
  const get = env.CARDS.get.bind(env.CARDS);
  const mixed = { ...env, CARDS: { ...env.CARDS,
    get: async (k) => (k === 't' ? CARD : k === cardKey('t', G) || k === goneKey('t') ? null : get(k)),
    list: async () => ({ keys: [], list_complete: true }) } };
  assert.deepEqual(await (await call(mixed, 'DELETE', '/_api/card/t')).json(), { handle: 't', deleted: true });
  assert.notEqual(env.CARDS._m.get(genKey('t')), G, 'the mixed view let DELETE skip the new generation');
  held.release();
  assert.equal((await pending).status, 409);
  const res = await page(env, '/t');
  assert.equal(res.status, 410, 'the save admitted in the ended lifetime is live after convergence');
  assert.ok(!(await res.text()).includes('late words'));
});

test('🔴 codex r3#2 a binding the listings miss is still ended (r8): the former domain never serves the next owner', async () => {
  const env = envWith({ t: CARD });
  await bindVanity(env, 't', 'former.example');
  // CONTROL: bound, the domain serves the card and the canonical address 301s there.
  assert.equal((await host(env, 'former.example', '/')).status, 200);
  assert.equal((await page(env, '/t')).status, 301);
  // a location whose listings do not show the bindings yet (r5: DELETE finds them by listing)
  const list = env.CARDS.list.bind(env.CARDS);
  const stale = { ...env, CARDS: { ...env.CARDS, list: async (o) => (o.prefix.startsWith('vanity') ? { keys: [], list_complete: true } : list(o)) } };
  assert.deepEqual(await (await call(stale, 'DELETE', '/_api/card/t')).json(), { handle: 't', deleted: true });
  // r5–r7 found the hosts by those listings and left all three keys; the hosts now come from CardLifetime
  assert.equal(env.CARDS._m.get(vanityKey('former.example')), undefined, 'the end never reached the host the listings missed');
  assert.equal(env.CARDS._m.get(vanityBindKey('t', '0', 'former.example')), undefined, "the ended lifetime's binding key stayed");
  assert.equal(env.CARDS._m.get(vanityOfKey('t', '0')), undefined);
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
  for (const path of ['/', '/t', '/index.md', '/t.md']) {
    const res = await host(env, 'former.example', path);
    assert.equal(res.status, 404, `former.example${path}`);
    assert.ok(!(await res.text()).includes('Next owner'), `former.example${path} served the next owner`);
  }
  const canon = await page(env, '/t');
  assert.equal(canon.status, 200, "the next owner's canonical address 301s to the former owner's domain");
  assert.ok((await canon.text()).includes('Next owner'));
});

test('🔴 a binding is honoured only in its own lifetime — keyed by generation; pre-generation bindings are generation 0', async () => {
  const env = await reborn(NEXT);
  const G = env.CARDS._m.get(genKey('t')), DEAD = 'd'.repeat(24);
  // pre-generation (a pointer and a bare inverse): generation 0's, so inert once the handle has a later one
  env.CARDS._m.set(vanityKey('old.example'), 't');
  env.CARDS._m.set('vanityof:t', 'old.example');
  assert.equal((await host(env, 'old.example', '/')).status, 404, 'a pre-generation binding outlived generation 0');
  assert.equal((await page(env, '/t')).status, 200, 'a pre-generation inverse binding 301d a later lifetime');
  // an ended generation's binding: inert
  env.CARDS._m.set(vanityBindKey('t', DEAD, 'old.example'), 't');
  env.CARDS._m.set(vanityOfKey('t', DEAD), 'old.example');
  assert.equal((await host(env, 'old.example', '/')).status, 404);
  assert.equal((await page(env, '/t')).status, 200);
  // CONTROL: bindVanity writes the current generation's keys and then the pointer, and is honoured
  // (r9: accepted by the host's object, then its redirect published by the handle's)
  assert.deepEqual(await bindVanity(env, 't', 'new.example'), { handle: 't', host: 'new.example', gen: G, accepted: true, redirect: 'published' });
  assert.equal(env.CARDS._m.get(vanityBindKey('t', G, 'new.example')), 't');
  assert.equal(env.CARDS._m.get(vanityOfKey('t', G)), 'new.example');
  assert.equal(env.CARDS._m.get(vanityKey('new.example')), 't');
  const res = await host(env, 'new.example', '/');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('Next owner'));
  assert.equal((await page(env, '/t')).headers.get('location'), 'https://new.example/');
  // a forward-only binding (no redirect) writes no inverse; the rotation retires it like any other
  await bindVanity(env, 't', 'side.example', { redirect: false });
  assert.equal(env.CARDS._m.get(vanityOfKey('t', G)), 'new.example', 'a forward-only binding wrote an inverse');
  assert.equal((await host(env, 'side.example', '/')).status, 200);
  await call(env, 'DELETE', '/_api/card/t');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
  for (const h of ['side.example', 'new.example']) assert.equal((await host(env, h, '/')).status, 404, `${h}'s binding outlived its lifetime`);
  assert.equal((await page(env, '/t')).status, 200);
  assert.equal([...env.CARDS._m.keys()].filter((k) => k.startsWith('vanitybind:') || k.startsWith('vanityof:')).length, 0,
    "DELETE left the ended lifetime's binding keys");
});

test('🔴 a preview in a later lifetime renders, and one held mid-put across the delete is never shown', async () => {
  // API-made, not hand-seeded (codex r2 finding 6): the stamp is what is under test, so it is the
  // API's own stamp. A later lifetime, because generation 0 is also what an absent stamp means.
  const env = await reborn();
  const live = await previewIdOf(env, 't');
  assert.equal((await page(env, `/_preview/${live}`)).status, 200, 'a preview of the live lifetime did not render');
  const held = holdPut(env, (k) => k.startsWith(previewKey('')));
  const pending = call(env, 'POST', '/_api/preview', { handle: 't', markdown: thinCard(CARD) });
  const parked = await held.started;
  await call(env, 'DELETE', '/_api/card/t');
  held.release();
  assert.equal((await pending).status, 409);
  assert.ok(env.CARDS._m.has(parked), 'CONTROL: the late preview did land (its TTL removes it)');
  assert.equal((await page(env, '/' + parked.replace(':', '/'))).status, 404);
});

test("🔴 the renderer reads only the current generation's keys — seeded directly, no API involved", async () => {
  const DEAD = 'a'.repeat(24), NOW = 'b'.repeat(24), ID = 'c'.repeat(32);
  const env = envWith({ [cardKey('t', DEAD)]: CARD, 'gen:t': NOW, [previewKey(ID)]: CARD });
  env.CARDS._meta.set(previewKey(ID), { handle: 't', gen: DEAD });
  assert.equal((await page(env, '/t')).status, 404);
  assert.equal((await page(env, '/t.md')).status, 404);
  assert.equal((await page(env, `/_preview/${ID}`)).status, 404);
  env.CARDS._m.set(goneKey('t'), JSON.stringify({ deleted_at: new Date().toISOString() }));
  assert.equal((await page(env, '/t')).status, 410, 'a dead body hid the gone marker');
  // a pre-r3 bare body is generation 0's — never read once the handle has been deleted
  env.CARDS._m.set('t', CARD);
  assert.equal((await page(env, '/t')).status, 410, 'a legacy body was served in a later lifetime');
  // CONTROL: the current generation's body and preview serve
  env.CARDS._m.set(cardKey('t', NOW), CARD);
  env.CARDS._meta.set(previewKey(ID), { handle: 't', gen: NOW });
  assert.equal((await page(env, '/t')).status, 200);
  assert.equal((await page(env, `/_preview/${ID}`)).status, 200);
  // stops: a dead lifetime's is inert, a legacy one is too, the current one stops
  env.CARDS._m.set(stopKey('t', DEAD), '{}');
  env.CARDS._m.set('stop:t', '{}');
  assert.equal((await page(env, '/t')).status, 200, 'a stop from another lifetime stopped this one');
  env.CARDS._m.set(stopKey('t', NOW), '{}');
  assert.equal((await page(env, '/t')).status, 404);
});

test("migration: a pre-r3 body and stop are generation 0's, and the new key wins once written", async () => {
  const env = envWith({ t: CARD, 'stop:t': '{}' });
  assert.equal((await page(env, '/t')).status, 404, 'a legacy stop no longer stops');
  await call(env, 'DELETE', '/_api/card/t/stop');
  assert.equal((await page(env, '/t')).status, 200, 'a legacy body is not served');
  const v = (await (await call(env, 'GET', '/_api/card/t')).json()).version;
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT, base_version: v })).status, 200);
  assert.ok(env.CARDS._m.get(cardKey('t', '0')).includes('Next owner'), 'the first save did not write the new shape');
  assert.equal(env.CARDS._m.has(genKey('t')), false, 'a save wrote gen:');
  assert.ok((await (await page(env, '/t')).text()).includes('Next owner'), 'the legacy body shadowed the new one');
});

test('only DELETE writes gen: — a create, an update and an asset write never do', async () => {
  const env = envWith({});
  const puts = [];
  const put = env.CARDS.put.bind(env.CARDS);
  env.CARDS.put = async (k, v, opts) => { puts.push(k); return put(k, v, opts); };
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) });
  const v = (await (await call(env, 'GET', '/_api/card/t')).json()).version;
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT, base_version: v })).status, 200);
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/extra', { base64: GIF, mime: 'image/gif' })).status, 200);
  assert.deepEqual([...new Set(puts)], [cardKey('t', '0')]);
  await call(env, 'DELETE', '/_api/card/t');
  const g1 = env.CARDS._m.get(genKey('t'));
  assert.match(g1, /^[0-9a-f]{24}$/);
  puts.length = 0;
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) })).status, 200);
  assert.deepEqual(puts, [cardKey('t', g1)], 'the create in a later lifetime wrote elsewhere');
  assert.equal(env.CARDS._m.get(genKey('t')), g1);
  await call(env, 'DELETE', '/_api/card/t');
  assert.notEqual(env.CARDS._m.get(genKey('t')), g1);
});

// ── bindings across lifetimes (codex r4, reef#2618 r5) ───────────────────────────────────────────
//
// Ported from the r4 review's rulers (binding-races.mjs, pinning-probe.mjs). The reviewer's barriers
// held one named key; these hold BEFORE EVERY store call in turn, so they assume nothing about which
// keys the code uses, and a pause the code could move into is still covered. Judged on public responses.

const OWNER = 'owner.example';
/**
 * A view of `store` that stops before its n-th call (0-based; any method), counting from the call
 * after the first one `after(method, key)` matches when given. `started` resolves naming the held call.
 */
const holdAt = (store, n, { after, armed } = {}) => {
  const started = deferred(), release = deferred();
  let i = after || armed ? -Infinity : 0;
  const wrap = (method) => async (...a) => {
    const k = typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0]);
    if (i++ === n) { started.resolve(`${method} ${k}`); await release.promise; }
    if (after && i < 0 && after(method, k)) i = 0;
    return store[method](...a);
  };
  const view = {};
  for (const m of ['get', 'getWithMetadata', 'put', 'delete', 'list']) view[m] = wrap(m);
  // `armed`: counting starts at `arm()` instead (r8: a step another object takes, not a call on this store)
  return { store: view, started: started.promise, release: () => release.resolve(), arm: () => { i = 0; } };
};
/** the held call, or null when `pending` finished without reaching it */
const heldOrDone = (held, pending) => Promise.race([held.started, pending.then(() => null)]);

/**
 * holdAt for a bind: a bind's last store calls are made by HostBindings, on the env's own store, so
 * the hold goes ON that store rather than on a view of it. Counts every call from now; the n-th waits
 * for release and the store is put back as it was, so nothing after it is counted or held.
 */
const holdIn = (stores, n) => {
  const started = deferred(), release = deferred(), own = [];
  const methods = ['get', 'getWithMetadata', 'put', 'delete', 'list'];
  for (const [label, store] of stores) {
    const saved = {};
    for (const m of methods) if (store[m]) saved[m] = store[m];
    own.push([store, saved]);
  }
  const restore = () => { for (const [store, saved] of own) Object.assign(store, saved); };
  let i = 0;
  for (const [[label, store], [, saved]] of stores.map((s, j) => [s, own[j]])) {
    for (const m of Object.keys(saved)) store[m] = async (...a) => {
      if (i++ === n) { restore(); started.resolve(`${label}${m} ${typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0])}`); await release.promise; }
      return saved[m].apply(store, a);
    };
  }
  return { started: started.promise, release: () => release.resolve(), restore };
};
/** the stores a bind of `handle` to OWNER touches: KV, the host object's own storage (labelled
 *  `object `) and, since r8, the handle's CardLifetime storage (labelled `lifetime `) */
const bindStores = (env, handle) => [['', env.CARDS], ['object ', env.HOST_BINDINGS.storageOf(OWNER)],
  ['lifetime ', env.CARD_LIFETIMES.storageOf(handle)]];
const settledWithin = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

/**
 * The cross-lifetime rebind (codex r4#1, r5): bind `stale` held before its n-th store call (n < 0: not
 * held, the sequential control), DELETE `stale`, create `fresh`, bind `fresh` to the same host, release.
 *
 * 🔴 The one change from the reviewers' rulers: held INSIDE HostBindings, `fresh`'s bind cannot finish
 * until the release — that wait is the fix (one writer per host), so the rulers' control "`fresh`
 * serves before the release" becomes "`fresh`'s bind is still waiting". Held before the object, the
 * rulers' order runs as written. → { where, inside, staleResult, freshResult } or null past the last call.
 */
async function rebindRace(env, n, stale, fresh) {
  const held = n < 0 ? null : holdIn(bindStores(env, stale), n);
  const staleBind = bindVanity(env, stale, OWNER);
  const where = held ? await heldOrDone(held, staleBind) : (await staleBind, null);
  if (held && where === null) return null;
  const inside = env.HOST_BINDINGS.busy(OWNER) > 0 || env.CARD_LIFETIMES.busy(stale) > 0;
  // r7: a DELETE that has to end `stale` on OWNER queues behind the held request inside the object,
  // so it finishes only after the release; `fresh` exists only after the DELETE, as in the rulers.
  const deleting = call(env, 'DELETE', `/_api/card/${stale}`);
  const waited = !(await settledWithin(deleting, 50));
  if (waited) {
    assert.ok(inside, `held at ${where}: the DELETE waited on a hold outside the object`);
    held.release();
  }
  assert.equal((await deleting).status, 200);
  assert.equal((await call(env, 'PUT', `/_api/card/${fresh}`, { markdown: NEXT })).status, 200);
  const freshBind = bindVanity(env, fresh, OWNER);
  if (waited) {
    await freshBind;
  } else if (inside) {
    assert.equal(await settledWithin(freshBind, 50), false, `held at ${where}: "${fresh}"'s bind went through while "${stale}"'s was in flight inside the object — two writers for one host`);
  } else {
    await freshBind;
    assert.equal((await host(env, OWNER, '/')).status, 200, `CONTROL (held at ${where}): the replacement binding serves`);
  }
  held?.release();
  const [staleResult, freshResult] = await Promise.all([staleBind, freshBind]);
  assert.ok(!freshResult.stale_generation, `held at ${where}: the replacement's own bind was refused`);
  return { where, inside, waited, staleResult, freshResult };
}
/** after a rebind race: the domain serves `fresh`'s card, and `fresh`'s canonical address 301s there */
async function assertServesFresh(env, fresh, where) {
  for (const read of ['after', 'repeat']) {
    const res = await host(env, OWNER, '/');
    assert.equal(res.status, 200, `held at ${where} (${read}): the ended lifetime's bind undid the replacement binding`);
    const text = await res.text();
    assert.ok(text.includes('Next owner'), `held at ${where} (${read})`);
    assert.ok(!text.includes('Tester'), `held at ${where} (${read}): the former card is served`);
  }
  const canon = await page(env, `/${fresh}`);
  assert.equal(canon.status, 301, `held at ${where}`);
  assert.equal(canon.headers.get('location'), `https://${OWNER}/`, `held at ${where}: the canonical address lost its redirect`);
}

test("🔴 codex r4#1 a bind admitted in an ended lifetime, held before ANY of its store calls, never undoes the next lifetime's binding", async () => {
  const seen = [];
  for (let n = 0; ; n++) {
    const env = envWith({ t: CARD });
    const race = await rebindRace(env, n, 't', 't');
    if (race === null) break;
    seen.push(race);
    await assertServesFresh(env, 't', race.where);
  }
  assert.ok(seen.length >= 4, `CONTROL: the bind was held at only ${seen.length} positions`);
  assert.ok(seen.some((r) => r.inside) && seen.some((r) => !r.inside), 'CONTROL: held both before and inside HostBindings');
});

test('🔴 codex r5 a bind from a deleted handle, held at ANY store call, never undoes another handle\'s binding of the domain (60 rows)', async () => {
  // R/cross-handle-probe.mjs: generation 0 / a later generation, for each handle independently, × the
  // sequential control and every store call after admission. r5 failed the four final-pointer holds.
  // Every row runs and every failing row is named (one failure must not hide the other three).
  const failures = [];
  let rows = 0, pointerHolds = 0;
  for (const oldReborn of [false, true]) for (const newReborn of [false, true]) for (let n = -1; ; n++) {
    const env = envWith({ a: CARD });
    if (oldReborn) { await call(env, 'DELETE', '/_api/card/a'); await call(env, 'PUT', '/_api/card/a', { markdown: CARD }); }
    if (newReborn) await call(env, 'DELETE', '/_api/card/b');
    const race = await rebindRace(env, n, 'a', 'b');
    if (race === null) break;
    rows++;
    const where = `${race.where} [a ${oldReborn ? 'reborn' : 'gen 0'}, b ${newReborn ? 'reborn' : 'gen 0'}]`;
    const isPointer = !!race.where?.startsWith(`put ${vanityKey(OWNER)}`);
    if (isPointer) pointerHolds++;
    try {
      await assertServesFresh(env, 'b', where);
      assert.equal(env.CARDS._m.get(vanityKey(OWNER)), 'b', `${where}: the pointer`);
      if (isPointer) assert.ok(race.inside, `${where}: the pointer was written outside HostBindings`);
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  // r9: 4 generation pairs × (the control + 14 store calls: admit get/put, gen:, register get/put in
  // CardLifetime's storage, vanitybind:, point get/put, the pointer, point's cache-written put, then —
  // only once accepted (rule A) — confirm get/put, vanityof:, confirm's cache-written put). r8 had 10
  // (44 rows: vanityof: was written before /point), r7 had 8 (36 rows), r5/r6 had 5 (20 rows).
  assert.equal(rows, 60);
  assert.equal(pointerHolds, 4, 'CONTROL: the final pointer put was held in all four generation pairs');
});

test("🔴 codex r6 a bind admitted in an ended lifetime never overwrites a later binding, even where the object's KV view of gen: is cached (8 rows)", async () => {
  // R/cached-generation-probe.mjs: generation 0 / a later generation for a and b independently, × a
  // fresh object-side view (the control) and one where HostBindings' location serves gen:a from a cache
  // warmed by a's first bind (a cached miss in generation 0) — within KV's contract. r6 failed the four
  // cached rows 200 → 404 → 404 after convergence. Every row runs; every failing row is named.
  const failures = [];
  let rows = 0;
  for (const oldReborn of [false, true]) for (const newReborn of [false, true]) for (const cached of [false, true]) {
    const env = envWith({ a: CARD });
    const cache = new Map();
    const objectStore = {
      async get(k) {
        if (cached && k === genKey('a')) { if (!cache.has(k)) cache.set(k, await env.CARDS.get(k)); return cache.get(k); }
        return env.CARDS.get(k);
      },
      getWithMetadata: (...a) => env.CARDS.getWithMetadata(...a),
      put: (...a) => env.CARDS.put(...a), delete: (...a) => env.CARDS.delete(...a), list: (...a) => env.CARDS.list(...a),
    };
    env.HOST_BINDINGS = hostBindingsNs(env, { ...env, CARDS: objectStore });
    if (oldReborn) { await call(env, 'DELETE', '/_api/card/a'); await call(env, 'PUT', '/_api/card/a', { markdown: CARD }); }
    if (newReborn) await call(env, 'DELETE', '/_api/card/b');
    await bindVanity(env, 'a', OWNER); // warms the object's view of gen:a
    const admitted = (await env.CARDS.get(genKey('a'))) || '0';
    const started = deferred(), release = deferred();
    // held at the caller's last write before /point. r9: that is the binding key — the inverse is now
    // written after acceptance, by CardLifetime (rule A), so the probe's original hold never fires
    const caller = { ...env, CARDS: { ...objectStore, get: (k) => env.CARDS.get(k), async put(k, v, o) {
      if (k === vanityBindKey('a', admitted, OWNER)) { started.resolve(); await release.promise; }
      return env.CARDS.put(k, v, o);
    } } };
    const stale = bindVanity(caller, 'a', OWNER);
    await started.promise;
    assert.equal((await call(env, 'DELETE', '/_api/card/a')).status, 200);
    assert.equal((await call(env, 'PUT', '/_api/card/b', { markdown: NEXT })).status, 200);
    const freshResult = await bindVanity(env, 'b', OWNER);
    const where = `[a ${oldReborn ? 'reborn' : 'gen 0'}, b ${newReborn ? 'reborn' : 'gen 0'}, ${cached ? 'cached' : 'fresh'} gen:a at the object]`;
    rows++;
    try {
      assert.ok(!freshResult.stale_generation, `${where}: b's own bind was refused`);
      assert.equal((await host(env, OWNER, '/')).status, 200, `${where} CONTROL: b serves before the release`);
      release.resolve();
      const staleResult = await stale;
      assert.equal((await host(env, OWNER, '/')).status, 200, `${where} (before convergence): the ended lifetime's bind undid b's binding`);
      cache.clear(); // every view converges
      await assertServesFresh(env, 'b', `${where} (converged)`);
      assert.equal(env.CARDS._m.get(vanityKey(OWNER)), 'b', `${where}: the pointer`);
      assert.ok(staleResult.stale_generation, `${where}: the ended lifetime's bind reported success`);
    } catch (e) { release.resolve(); failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 8);
});

/** a view of env's KV whose `gen:<handle>` read answers `gen` (a location that cached it), all else current */
const cachedGenView = (env, handle, gen) => ({ ...env, CARDS: {
  get: (k) => (k === genKey(handle) ? Promise.resolve(gen) : env.CARDS.get(k)),
  getWithMetadata: (...a) => env.CARDS.getWithMetadata(...a),
  put: (...a) => env.CARDS.put(...a), delete: (...a) => env.CARDS.delete(...a), list: (...a) => env.CARDS.list(...a),
} });

test('🔴 r7 a bind admitted AFTER the DELETE where gen: is still cached is refused by the end the object was told — order alone would let it through', async () => {
  for (const oldReborn of [false, true]) {
    const env = envWith({ a: CARD });
    if (oldReborn) { await call(env, 'DELETE', '/_api/card/a'); await call(env, 'PUT', '/_api/card/a', { markdown: CARD }); }
    await bindVanity(env, 'a', OWNER);
    const before = await env.CARDS.get(genKey('a'));
    assert.equal((await call(env, 'DELETE', '/_api/card/a')).status, 200);
    assert.equal((await call(env, 'PUT', '/_api/card/b', { markdown: NEXT })).status, 200);
    await bindVanity(env, 'b', OWNER);
    const where = `[a ${oldReborn ? 'reborn' : 'gen 0'}] late admission`;
    assert.equal((await host(env, OWNER, '/')).status, 200, `${where} CONTROL: b serves`);
    // admitted after b's bind (a later ticket), at a location still serving a's pre-DELETE gen:
    const late = await bindVanity(cachedGenView(env, 'a', before), 'a', OWNER);
    await assertServesFresh(env, 'b', where);
    assert.ok(late.stale_generation, `${where}: the ended lifetime's bind reported success`);
  }
});

test("🔴 codex r7 a DELETE whose binding listings have not caught up still ends every bound host: a later bind of the ended lifetime never takes the domain (8 rows)", async () => {
  // R/discovery-probe.mjs: generation 0 / a later generation for a × DELETE's `vanitybind:a:` and
  // `vanityof:a:` listings fresh (the control) / not caught up × redirect off/on. r7 found its hosts by
  // those listings: the four missing-listing rows sent no end, and a's late bind (a newer ticket than
  // b's, from a location still caching a's pre-DELETE gen:) took the domain, 200 → 404 → 404 after
  // convergence while /b 301'd into it. Every row runs; every failing row is named.
  const failures = [];
  let rows = 0;
  for (const oldReborn of [false, true]) for (const missing of [false, true]) for (const redirect of [false, true]) {
    const env = envWith({ a: CARD });
    if (oldReborn) { assert.equal((await call(env, 'DELETE', '/_api/card/a')).status, 200); assert.equal((await call(env, 'PUT', '/_api/card/a', { markdown: CARD })).status, 200); }
    const before = await env.CARDS.get(genKey('a'));
    await bindVanity(env, 'a', OWNER, { redirect });
    const where = `[a ${oldReborn ? 'reborn' : 'gen 0'}, ${missing ? 'missing' : 'fresh'} listings, redirect:${redirect}]`;
    rows++;
    try {
      assert.equal((await host(env, OWNER, '/')).status, 200, `${where} CONTROL: a serves on its domain`);
      // only the two binding prefix listings lag; every other DELETE read is fresh
      const list = env.CARDS.list.bind(env.CARDS);
      const lagging = { ...env, CARDS: { ...env.CARDS, list: async (o) =>
        (missing && ['vanitybind:a:', 'vanityof:a:'].includes(o.prefix) ? { keys: [], list_complete: true } : list(o)) } };
      assert.equal((await call(lagging, 'DELETE', '/_api/card/a')).status, 200, `${where}: DELETE`);
      // r8: every bound host was told, not every LISTED one — and the late bind below is refused by
      // CardLifetime anyway, so this is the assertion that sees which hosts DELETE reached
      assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined, `${where}: DELETE did not end a host a was bound to`);
      assert.equal(env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').owner, null, `${where}: the host object still names a`);
      assert.equal((await call(env, 'PUT', '/_api/card/b', { markdown: NEXT })).status, 200);
      await bindVanity(env, 'b', OWNER);
      assert.equal((await host(env, OWNER, '/')).status, 200, `${where} CONTROL: b serves`);
      // admitted after b's bind (a later ticket), at a location still serving a's pre-DELETE gen:
      const late = await bindVanity(cachedGenView(env, 'a', before), 'a', OWNER, { redirect });
      await assertServesFresh(env, 'b', where);
      assert.equal(env.CARDS._m.get(vanityKey(OWNER)), 'b', `${where}: the pointer`);
      assert.ok(late.stale_generation, `${where}: the ended lifetime's bind reported success`);
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 8);
});

test('🔴 r8 an end its host does not acknowledge fails the DELETE with the lifetime already ended: KV and the card are untouched, no bind of it registers, and a retry delivers the owed end', async () => {
  const env = await reborn();
  await bindVanity(env, 't', OWNER);
  const gen = await env.CARDS.get(genKey('t'));
  const ns = env.HOST_BINDINGS;
  env.HOST_BINDINGS = { ...ns, get: (id) => ({ fetch: (url, init) =>
    new URL(url).pathname === '/end' ? Promise.resolve(new Response('unavailable', { status: 503 })) : ns.get(id).fetch(url, init) }) };
  const res = await call(env, 'DELETE', '/_api/card/t');
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'delete_failed');
  assert.equal(await env.CARDS.get(genKey('t')), gen, 'the gen: cache was written before every end was acknowledged');
  assert.equal(env.CARDS._m.get(vanityBindKey('t', gen, OWNER)), 't', 'the cleanup ran before every end was acknowledged');
  assert.equal((await host(env, OWNER, '/')).status, 200, 'a DELETE that failed took the card off its domain');
  assert.equal((await page(env, '/t')).headers.get('location'), `https://${OWNER}/`);
  // the lifetime did end in its object: a bind of it (KV still names it) is refused before any write
  env.HOST_BINDINGS = ns;
  const late = await bindVanity(env, 't', 'other.example');
  assert.ok(late.stale_generation, 'a bind of a lifetime CardLifetime ended registered');
  assert.equal(env.CARDS._m.get(vanityKey('other.example')), undefined);
  // CONTROL: the host answers again → the retry delivers the owed end, clears the pointer, and rotates
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  assert.notEqual(await env.CARDS.get(genKey('t')), gen);
  assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined, 'the retry did not deliver the end the first DELETE owed');
  assert.equal(env.CARDS._m.get(vanityBindKey('t', gen, OWNER)), undefined);
  assert.equal((await host(env, OWNER, '/')).status, 404);
  assert.deepEqual(env.CARD_LIFETIMES.storageOf('t')._m.get('life').pending, {}, 'an end is still owed after it was delivered');
});

test('HostBindings prunes an ended entry only once it is older than the ticket TTL, and never by count', async () => {
  const storage = doStorage(), o = new HostBindings({ storage }, { CARDS: fakeKv({}) });
  const post = async (op, body) => (await o.fetch(new Request(`https://host-bindings.example/${op}`, { method: 'POST', body: JSON.stringify({ host: OWNER, ...body }) }))).json();
  const ended = () => Object.keys(storage._m.get('host').ended);
  const realNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;
    assert.equal(ENDED_KEEP_MS, TICKET_TTL_MS);
    await post('end', { handle: 'old', gens: ['g'] });
    const { ticket } = await post('admit', { handle: 'old' });
    assert.ok((await post('point', { handle: 'old', gen: 'g', ticket })).stale_generation, 'CONTROL: an ended lifetime is refused');
    now += ENDED_KEEP_MS - 1;
    await post('end', { handle: 'x', gens: ['1'] });
    assert.deepEqual(ended().sort(), ['old:g', 'x:1'], 'an entry younger than the ticket TTL was dropped');
    now += 1;
    await post('end', { handle: 'x', gens: ['2'] });
    assert.deepEqual(ended().sort(), ['x:1', 'x:2']);
    // r7 capped the set at 512 and dropped the oldest; a cap can drop an entry a live ticket needs
    for (let i = 0; i < 600; i++) await post('end', { handle: `h${i}`, gens: ['g'] });
    assert.equal(ended().length, 602, 'an entry inside the TTL was dropped by count');
  } finally { Date.now = realNow; }
});

test('🔴 r8 a bind paused before its pointer write, across its DELETE and a long wait, never lands: a ticket expires, and an ended entry outlives every live ticket', async () => {
  // A bind of a admitted and registered (so the DELETE ends a on OWNER), then paused before its /point
  // for `pause`. Half the TTL: the ticket is live, so the ended entry must still be there. Past the TTL:
  // the entry may be gone, so the ticket must be refused on its own. Either alone leaves a hole.
  const realNow = Date.now;
  try {
    for (const pause of [TICKET_TTL_MS / 2, TICKET_TTL_MS + 1000]) {
      let now = 5_000_000;
      Date.now = () => now;
      const env = envWith({ a: CARD });
      const ns = env.HOST_BINDINGS, started = deferred(), release = deferred();
      env.HOST_BINDINGS = { ...ns, get: (id) => ({ async fetch(url, init) {
        if (new URL(url).pathname === '/point' && JSON.parse(init.body).handle === 'a') { started.resolve(); await release.promise; }
        return ns.get(id).fetch(url, init);
      } }) };
      const paused = bindVanity(env, 'a', OWNER);
      await started.promise;
      assert.equal((await call(env, 'DELETE', '/_api/card/a')).status, 200);
      now += pause;
      release.resolve();
      const result = await paused;
      const where = `paused ${pause} ms`;
      assert.ok(result.conflict, `${where}: the ended lifetime's bind reported success`);
      assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined, `${where}: the ended lifetime's bind took the domain`);
      assert.equal(ns.storageOf(OWNER)._m.get('host').owner, null, `${where}: the object's owner`);
    }
  } finally { Date.now = realNow; }
});

test('🔴 r8 a bind registers its host BEFORE it writes anything: a DELETE that runs while the registration is in flight leaves no pointer behind', async () => {
  // Held just before /register reaches the handle's object. The DELETE ends a there first, so the
  // registration is refused and nothing is written; a bind that pointed first and registered after
  // would leave the pointer of a lifetime whose DELETE never knew the host.
  for (const oldReborn of [false, true]) {
    const env = envWith({ a: CARD });
    if (oldReborn) { await call(env, 'DELETE', '/_api/card/a'); await call(env, 'PUT', '/_api/card/a', { markdown: CARD }); }
    const lives = env.CARD_LIFETIMES, started = deferred(), release = deferred();
    env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
      if (new URL(url).pathname === '/register') { started.resolve(); await release.promise; }
      return lives.get(id).fetch(url, init);
    } }) };
    const bind = bindVanity(env, 'a', OWNER);
    const where = `[a ${oldReborn ? 'reborn' : 'gen 0'}]`;
    const reached = await Promise.race([started.promise.then(() => true), bind.then(() => false)]);
    assert.ok(reached, `${where} CONTROL: the bind reached /register`);
    env.CARD_LIFETIMES = lives;
    assert.equal((await call(env, 'DELETE', '/_api/card/a')).status, 200);
    release.resolve();
    const result = await bind;
    assert.ok(result.stale_generation, `${where}: a bind registered after its lifetime ended reported success`);
    assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined, `${where}: a pointer the DELETE never knew about survived it`);
    assert.equal(env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').owner, null, `${where}: the object's owner`);
  }
});

test('🔴 no HostBindings, no binding: the pointer is never written from outside its one writer', async () => {
  const env = envWith({ t: CARD });
  delete env.HOST_BINDINGS;
  await assert.rejects(bindVanity(env, 't', OWNER), /HOST_BINDINGS is not bound/);
  assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined);
  assert.equal((await host(env, OWNER, '/')).status, 404);
  // CONTROL: the same bind with the object serves
  env.HOST_BINDINGS = hostBindingsNs(env);
  await bindVanity(env, 't', OWNER);
  assert.equal((await host(env, OWNER, '/')).status, 200);
});

test('🔴 r8 no CardLifetime, no lifetime change: DELETE answers 503 and touches nothing, and no bind is made', async () => {
  const env = envWith({ t: CARD });
  const lives = env.CARD_LIFETIMES;
  delete env.CARD_LIFETIMES;
  const before = new Map(env.CARDS._m);
  const res = await call(env, 'DELETE', '/_api/card/t');
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'delete_failed');
  assert.deepEqual([...env.CARDS._m.keys()].filter((k) => !before.has(k)), [goneKey('t')], 'only the (invisible) marker may be new');
  assert.equal((await page(env, '/t')).status, 200, 'a DELETE without its lifetime authority took the card down');
  await assert.rejects(bindVanity(env, 't', OWNER), /CARD_LIFETIMES is not bound/);
  assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined);
  // CONTROL: bound again, the same DELETE goes through
  env.CARD_LIFETIMES = lives;
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  assert.equal((await page(env, '/t')).status, 410);
});

test("🔴 codex r4#2 a DELETE held before ANY store call after its rotation leaves the next lifetime's binding and preview alone", async () => {
  let positions = 0;
  for (let n = 0; ; n++) {
    const env = envWith({ t: CARD });
    await bindVanity(env, 't', OWNER);
    // r8: the rotation and its `gen:` put are CardLifetime's; the DELETE's own calls after it start
    // once its /settle has answered
    const held = holdAt(env.CARDS, n, { armed: true });
    const lives = env.CARD_LIFETIMES;
    const deleting = { ...env, CARDS: held.store, CARD_LIFETIMES: { ...lives, get: (id) => ({ async fetch(url, init) {
      const res = await lives.get(id).fetch(url, init);
      if (new URL(url).pathname === '/settle') held.arm();
      return res;
    } }) } };
    const pending = call(deleting, 'DELETE', '/_api/card/t');
    const where = await heldOrDone(held, pending);
    if (where === null) break;
    positions++;
    assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
    await bindVanity(env, 't', OWNER);
    const preview = (await (await call(env, 'POST', '/_api/preview', { handle: 't', markdown: NEXT })).json()).url;
    assert.equal((await host(env, OWNER, '/')).status, 200, `CONTROL (held at ${where}): the new binding serves`);
    assert.equal((await worker.fetch(new Request(preview), env)).status, 200, `CONTROL (held at ${where}): the new preview renders`);
    held.release();
    assert.equal((await (await pending).json()).deleted, true);
    const res = await host(env, OWNER, '/');
    assert.equal(res.status, 200, `held at ${where}: DELETE's cleanup removed the next lifetime's binding`);
    assert.ok((await res.text()).includes('Next owner'), `held at ${where}`);
    assert.equal((await page(env, '/t')).headers.get('location'), `https://${OWNER}/`, `held at ${where}: the canonical address lost its redirect`);
    assert.equal((await worker.fetch(new Request(preview), env)).status, 200, `held at ${where}: DELETE's cleanup removed the next lifetime's preview`);
  }
  assert.ok(positions >= 3, `CONTROL: the DELETE was held at only ${positions} positions after its rotation`);
});

test("🔴 codex r4#3 a former domain's generation read held across delete + reuse never serves the next owner", async () => {
  const env = envWith({ t: CARD, 'vanity:former.example': 't', 'vanityof:t': 'former.example' });
  // the renderer's first read of gen:t answers what it read BEFORE the DELETE, after the next owner exists
  const get = env.CARDS.get.bind(env.CARDS), started = deferred(), release = deferred();
  let first = true;
  const reader = { ...env, CARDS: { ...env.CARDS, async get(k) {
    if (first && k === genKey('t')) { first = false; const snapshot = await get(k); started.resolve(); await release.promise; return snapshot; }
    return get(k);
  } } };
  const request = host(reader, 'former.example', '/');
  await started.promise;
  await call(env, 'DELETE', '/_api/card/t');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
  release.resolve();
  const res = await request;
  assert.ok(!(await res.text()).includes('Next owner'), 'the binding was judged by one generation and the body read from another');
  assert.equal(res.status, 404);
});

// ── publish after accept; the durable owner is the truth (codex r8, reef#2618 r9) ─────────────────

const B_CARD = CARD.replace('Tester', 'Next owner');

test('🔴 codex r8#1 a refused bind publishes nothing: the canonical address keeps the binding that was accepted (4 rows)', async () => {
  // R/refused-bind.mjs: a serves at a.example; a's bind of b.example passes registration and is held
  // before /point; then the ticket expires (to b's domain / to an empty one) or b binds b.example again
  // (superseded); release. r8 wrote `vanityof:a:0 = b.example` in that gap, so /a 301'd to b's content
  // or to a 404 while a.example still served a. The reviewer held the inverse put; r9 no longer makes it
  // there, so the hold is on the binding key, the write that still sits between register and /point.
  const failures = [];
  let rows = 0;
  const realNow = Date.now;
  for (const mode of ['control', 'expired', 'expired-empty', 'superseded']) {
    const env = envWith({ a: CARD, b: B_CARD });
    await bindVanity(env, 'a', 'a.example');
    if (mode !== 'expired-empty') await bindVanity(env, 'b', 'b.example');
    const started = deferred(), release = deferred(), put = env.CARDS.put.bind(env.CARDS);
    let once = true;
    env.CARDS.put = async (k, v, o) => {
      if (once && k === vanityBindKey('a', '0', 'b.example')) { once = false; started.resolve(); await release.promise; }
      return put(k, v, o);
    };
    const pending = bindVanity(env, 'a', 'b.example');
    await started.promise;
    if (mode.startsWith('expired')) Date.now = () => realNow() + TICKET_TTL_MS + 1000;
    if (mode === 'superseded') await bindVanity(env, 'b', 'b.example');
    release.resolve();
    let result;
    try { result = await pending; } finally { Date.now = realNow; }
    rows++;
    const where = `[${mode}]`;
    try {
      const canonA = await page(env, '/a'), canonB = await page(env, '/b');
      const dest = await host(env, 'b.example', '/'), destText = await dest.text();
      if (mode === 'control') {
        assert.ok(!result.conflict, `${where} CONTROL: the bind was accepted`);
        assert.equal(env.CARDS._m.get(vanityKey('b.example')), 'a', `${where} CONTROL: the pointer`);
        assert.equal(canonA.headers.get('location'), 'https://b.example/', `${where} CONTROL: an accepted bind publishes its redirect`);
        assert.ok(destText.includes('Tester'), `${where} CONTROL: b.example serves a`);
        // rule B: b lost b.example, so b's canonical address is its own page again, not a 301 into a's
        assert.equal(canonB.status, 200, `${where}: the handle that lost the host still 301s to it`);
      } else {
        assert.ok(result[mode === 'superseded' ? 'superseded' : 'expired'], `${where}: the bind was not refused`);
        assert.equal(canonA.status, 301, where);
        assert.equal(canonA.headers.get('location'), 'https://a.example/', `${where}: a refused bind replaced the canonical redirect`);
        assert.notEqual(env.CARDS._m.get(vanityOfKey('a', '0')), 'b.example', `${where}: a refused bind published its inverse`);
        const own = await host(env, 'a.example', '/');
        assert.equal(own.status, 200, `${where}: a's accepted binding`);
        assert.ok((await own.text()).includes('Tester'), where);
        if (mode === 'expired-empty') {
          assert.equal(env.CARDS._m.get(vanityKey('b.example')), undefined, `${where}: the pointer`);
          assert.equal(dest.status, 404, where);
        } else {
          assert.equal(env.CARDS._m.get(vanityKey('b.example')), 'b', `${where}: the pointer`);
          assert.ok(destText.includes('Next owner'), `${where}: b.example serves b`);
          assert.equal(canonB.headers.get('location'), 'https://b.example/', `${where}: b's own redirect`);
        }
      }
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 4);
});

test('🔴 codex r8#2 a pointer put that fails after acceptance: the bind IS accepted, the object reconciles KV to its owner, and the handle that lost the host stops redirecting to it', async () => {
  // R/failed-point.mjs: b serves on OWNER; a binds OWNER (redirect:false) and the object's KV pointer
  // put is rejected once. r8 answered 500 while the durable owner already named a, so a later DELETE of
  // a cleared the pointer b was still being served under, and /b 301'd into the 404 for good. r9 rule B:
  // the owner write IS the acceptance, the KV put is write-through, and a failure leaves the cache
  // pending for the object to reconcile (its alarm, or the next request it gets). b lost the host the
  // moment a was accepted, so b's inverse is cleared through b's CardLifetime: /b serves b's own page.
  // Rows: the control; the failure reconciled by the alarm before the DELETE; the failure reconciled by
  // the DELETE's own /end (no alarm has fired).
  const failures = [];
  let rows = 0;
  for (const mode of ['control', 'alarm', 'delete']) {
    const env = envWith({ a: CARD, b: B_CARD });
    await bindVanity(env, 'b', OWNER);
    const put = env.CARDS.put.bind(env.CARDS);
    let once = mode !== 'control';
    env.CARDS.put = async (k, v, o) => {
      if (once && k === vanityKey(OWNER)) { once = false; throw new Error('injected pointer put failure'); }
      return put(k, v, o);
    };
    let result = null, error = null;
    try { result = await bindVanity(env, 'a', OWNER, { redirect: false }); } catch (e) { error = e.message; }
    rows++;
    const where = `[${mode}]`;
    try {
      assert.equal(error, null, `${where}: an accepted bind reported failure`);
      assert.ok(result && !result.conflict, `${where}: the bind was refused`);
      assert.equal(env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').owner.handle, 'a', `${where}: the durable owner`);
      if (mode === 'control') {
        assert.equal(result.cache, undefined, `${where} CONTROL: a written cache reported pending`);
        assert.equal(env.CARDS._m.get(vanityKey(OWNER)), 'a', `${where} CONTROL: the pointer`);
      } else {
        assert.equal(result.cache, 'pending', `${where}: the failed write-through was not reported`);
        // the cache is behind (never ahead), and the object has scheduled its own retry
        assert.equal(env.CARDS._m.get(vanityKey(OWNER)), 'b', `${where}: the cache`);
        assert.ok(env.HOST_BINDINGS.storageOf(OWNER)._alarm != null, `${where}: no retry was scheduled`);
      }
      if (mode === 'alarm') await env.HOST_BINDINGS.alarm(OWNER);
      if (mode !== 'delete') {
        assert.equal(env.CARDS._m.get(vanityKey(OWNER)), 'a', `${where}: KV was not reconciled to the owner`);
        const res = await host(env, OWNER, '/');
        assert.equal(res.status, 200, where);
        assert.ok((await res.text()).includes('Tester'), `${where}: a read of the host does not serve its owner`);
      }
      // b lost the host when a was accepted: its canonical address no longer 301s there
      const canonB = await page(env, '/b');
      assert.equal(canonB.status, 200, `${where}: /b still 301s to the host b lost (${canonB.headers.get('location')})`);
      assert.equal((await call(env, 'DELETE', '/_api/card/a')).status, 200, where);
      assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined, `${where}: the ended owner's pointer survived`);
      assert.equal((await host(env, OWNER, '/')).status, 404, where);
      assert.equal((await page(env, '/b')).status, 200, `${where}: /b 301s to a domain that serves nothing`);
      assert.ok((await (await page(env, '/b')).text()).includes('Next owner'), `${where}: /b serves b's card`);
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 3);
});

test('🔴 r9 a reader that misses the pointer in KV asks the host\'s object, once: an accepted bind whose write-through failed still serves, and the read reconciles KV', async () => {
  const env = envWith({ a: CARD });
  const put = env.CARDS.put.bind(env.CARDS);
  let once = true;
  env.CARDS.put = async (k, v, o) => {
    if (once && k === vanityKey(OWNER)) { once = false; throw new Error('injected pointer put failure'); }
    return put(k, v, o);
  };
  const result = await bindVanity(env, 'a', OWNER);
  assert.equal(result.cache, 'pending');
  assert.equal(env.CARDS._m.get(vanityKey(OWNER)), undefined, 'CONTROL: the pointer put failed');
  const ns = env.HOST_BINDINGS, asked = [];
  env.HOST_BINDINGS = { ...ns, get: (id) => ({ fetch: (url, init) => { asked.push(`${id.name} ${new URL(url).pathname}`); return ns.get(id).fetch(url, init); } }) };
  const res = await host(env, OWNER, '/');
  assert.equal(res.status, 200, 'an accepted binding 404s while its KV pointer is missing');
  assert.ok((await res.text()).includes('Tester'));
  assert.deepEqual(asked, [`${OWNER} /owner`], 'the miss is answered by one call to the host\'s object');
  assert.equal(env.CARDS._m.get(vanityKey(OWNER)), 'a', 'the object did not reconcile KV on that call');
  // a hit costs no object call
  asked.length = 0;
  assert.equal((await host(env, OWNER, '/')).status, 200);
  assert.deepEqual(asked, []);
  // CONTROL: an unbound creator domain is still 404 after its one call, and writes nothing; our own
  // hosts never ask
  assert.equal((await host(env, 'nobody.example', '/')).status, 404);
  assert.deepEqual(asked, ['nobody.example /owner']);
  assert.equal(env.CARDS._m.has(vanityKey('nobody.example')), false);
  assert.equal(ns.storageOf('nobody.example')._m.size, 0, 'a read of an unbound host stored state');
  asked.length = 0;
  assert.equal((await page(env, '/a')).status, 301);
  assert.deepEqual(asked, []);
});

test('🔴 r9 an accepted bind\'s late redirect never clobbers a newer accepted host, and never points the card at a host it has lost', async () => {
  // rule A's ordering: CardLifetime publishes the inverse only for the newest-registered accepted bind
  // of the lifetime, and only if the host was not taken from the handle after that bind's ticket.
  for (const later of ['own', 'taken']) {
    const env = envWith({ a: CARD, b: B_CARD });
    const lives = env.CARD_LIFETIMES, started = deferred(), release = deferred();
    let once = true;
    env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
      if (once && id.name === 'a' && new URL(url).pathname === '/confirm') { once = false; started.resolve(); await release.promise; }
      return lives.get(id).fetch(url, init);
    } }) };
    const held = bindVanity(env, 'a', 'x.example'); // accepted, its /confirm held
    await started.promise;
    env.CARD_LIFETIMES = lives;
    const where = `[${later}]`;
    if (later === 'own') {
      // a binds y.example after it, start to finish; then x's late confirm arrives
      assert.equal((await bindVanity(env, 'a', 'y.example')).redirect, 'published');
      release.resolve();
      assert.equal((await held).redirect, 'not_published', `${where}: the older bind's redirect was published`);
      assert.equal((await page(env, '/a')).headers.get('location'), 'https://y.example/', `${where}: a late confirm clobbered the newer host`);
      assert.equal((await host(env, 'x.example', '/')).status, 200, `${where} CONTROL: x stays bound (forward)`);
    } else {
      // b takes x.example from a; then a's late confirm arrives
      await bindVanity(env, 'b', 'x.example');
      release.resolve();
      assert.equal((await held).redirect, 'not_published', `${where}: the redirect to a lost host was published`);
      const canon = await page(env, '/a');
      assert.equal(canon.status, 200, `${where}: /a 301s to a host that serves b (${canon.headers.get('location')})`);
      assert.ok((await (await host(env, 'x.example', '/')).text()).includes('Next owner'), `${where} CONTROL: x serves b`);
      // CONTROL: a takes it back with a fresh bind, and its redirect is published again
      assert.equal((await bindVanity(env, 'a', 'x.example')).redirect, 'published');
      assert.equal((await page(env, '/a')).headers.get('location'), 'https://x.example/');
      assert.equal((await page(env, '/b')).status, 200, `${where}: b kept a redirect to the host it lost`);
    }
  }
});
