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
 *  consistency is exactly what it CANNOT model — which is why the card's truth is the handle's object,
 *  not KV (tile#209 r2); tests that need a lagging read wrap `get` (lagKv). */
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
  // (CARD_LIFETIMES is bound, as in every deploy: since tile#209 a card write runs in the handle's
  // object, and an env without it fails closed on its own — that is not what this test asks about.)
  const env = { CARDS: fakeKv({ t: CARD }) };
  env.CARD_LIFETIMES = cardLifetimesNs(env);
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

test('🔴 If-Generation: a delete checked in an ended lifetime is refused 412 and leaves the next card alone (reef#2618 r4)', async () => {
  const env = envWith({ t: CARD });
  const lifetimeOfT = async () => (await (await call(env, 'GET', '/_api/card/t/lifetime')).json()).gen;
  const withGen = (gen) => {
    const url = new URL('https://card.feelreef.com/_api/card/t');
    return handleApi(new Request(url, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}`, 'if-generation': gen } }), env, url);
  };
  // request A checks ownership and reads its lifetime, then stalls; request B deletes the same lifetime
  const checkedByA = await lifetimeOfT();
  const b = await withGen(checkedByA);
  assert.equal(b.status, 200, 'CONTROL: the current lifetime deletes');
  assert.deepEqual(await b.json(), { handle: 't', deleted: true });
  // the handle is released; the next owner saves a new card into the next lifetime
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD).replace('Tester', 'Next') })).status, 200);
  assert.notEqual(await lifetimeOfT(), checkedByA);
  const before = new Map(env.CARDS._m);
  // A arrives with the lifetime it checked
  const a = await withGen(checkedByA);
  assert.equal(a.status, 412);
  assert.equal((await a.json()).error, 'stale_generation');
  assert.deepEqual(new Map(env.CARDS._m), before, 'a stale delete wrote to the store');
  assert.ok((await bodyOf(env)).includes('Next'), 'a stale delete erased the next lifetime\'s card');
  assert.equal((await page(env, '/t')).status, 200);
});

/** DELETE with If-Generation, through `env` (a test may hand it a view of the real env) */
const deleteIn = (env, gen, handle = 't') => {
  const url = new URL(`https://card.feelreef.com/_api/card/${handle}`);
  return handleApi(new Request(url, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}`, 'if-generation': gen } }), env, url);
};
/** everything a refused DELETE must leave byte-identical: KV (values and metadata) and the object's storage and alarm */
const everyKey = (env, handle = 't') => {
  const life = env.CARD_LIFETIMES.storageOf(handle);
  return { kv: new Map(env.CARDS._m), meta: new Map(env.CARDS._meta), life: new Map(life._m), alarm: life._alarm };
};

test('🔴 r15 the fence is the first write: a DELETE whose lifetime ends while it runs is refused with every key untouched, at each step up to /end (reef#2618, tile#207 codex r1 #1)', async () => {
  // A reads the generation and starts its DELETE; at its k-th call (a KV call or an object call) it
  // stalls while B deletes that same lifetime and the next owner saves a card; then A goes on. Every k
  // up to and including A's /end is a stale DELETE, and must answer 412 having written nothing. HEAD
  // (r4) checked /current first and /end second, and wrote `gone:` between them: rotated between
  // the two, A put the marker back over the next owner's card and only then was refused.
  let rows = 0, fence = false;
  for (let k = 1; ; k++) {
    const env = envWith({ t: CARD });
    const checked = (await (await call(env, 'GET', '/_api/card/t/lifetime')).json()).gen;
    let n = 0, armed = true, at = null, after = null;
    const step = async (what) => {
      if (!armed || ++n !== k) return;
      armed = false; at = what;
      const b = await deleteIn(env, checked);
      assert.equal(b.status, 200, `[step ${k}: ${what}] CONTROL: B deletes the lifetime A checked`);
      assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
      after = everyKey(env);
    };
    const store = env.CARDS;
    const viewOf = (ns) => ({ ...ns, get: (id) => {
      const o = ns.get(id);
      return { async fetch(url, init) {
        const op = new URL(url).pathname;
        await step(`${op} ${id.name}`);
        const res = await o.fetch(url, init);
        if (op === '/end') armed = false; // past A's fence A is no longer stale: B would be
        return res;
      } };
    } });
    const viewA = { ...env, CARD_LIFETIMES: viewOf(env.CARD_LIFETIMES), HOST_BINDINGS: viewOf(env.HOST_BINDINGS),
      CARDS: Object.fromEntries(['get', 'getWithMetadata', 'put', 'delete', 'list'].map((m) =>
        [m, async (...args) => { await step(`${m} ${typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0])}`); return store[m](...args); }])) };
    const a = await deleteIn(viewA, checked);
    if (at == null) break; // A reached its /end before step k
    rows += 1;
    if (at.startsWith('/end ')) fence = true;
    const where = `[step ${k}: ${at}]`;
    assert.equal(a.status, 412, `${where} a DELETE checked in an ended lifetime was not refused`);
    assert.equal((await a.json()).error, 'stale_generation', where);
    assert.deepEqual(everyKey(env), after, `${where} a refused DELETE wrote a key`);
    assert.ok((await bodyOf(env)).includes('Next owner'), `${where} a refused DELETE erased the next lifetime's card`);
    assert.equal((await page(env, '/t')).status, 200, where);
  }
  assert.ok(fence, `CONTROL: no row stalled A at its /end (${rows} rows)`);
});

test('🔴 r15 /current reads only, and a stale DELETE refuses without reconciling: a pending inverse stays pending, KV untouched (reef#2618, tile#207 codex r1 #2)', async () => {
  // a real failed write-through: the bind is accepted, its inverse put to KV fails, CardLifetime keeps
  // `cache: 'pending'` and schedules its alarm. r4's /current (and /end before its fence) ran load(),
  // which flushed: a read wrote `vanityof:t:0` and the object's storage.
  const env = envWith({ t: CARD });
  const put = env.CARDS.put.bind(env.CARDS);
  let fail = true;
  env.CARDS.put = async (k, ...rest) => {
    if (fail && k === vanityOfKey('t', '0')) throw new Error('injected inverse put failure');
    return put(k, ...rest);
  };
  await bindVanity(env, 't', 'card.example');
  fail = false;
  assert.equal(env.CARD_LIFETIMES.storageOf('t')._m.get('life').cache, 'pending', 'CONTROL: the injected failure left the inverse pending');
  assert.equal(env.CARDS._m.has(vanityOfKey('t', '0')), false, 'CONTROL: the inverse is not in KV');
  env.CARD_LIFETIMES.storageOf('t')._alarm = null; // the retry is due; nothing but the alarm may run it now
  const before = everyKey(env);
  const current = await call(env, 'GET', '/_api/card/t/lifetime');
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), { handle: 't', gen: '0' });
  assert.deepEqual(everyKey(env), before, 'GET /lifetime (/current) wrote a key');
  const stale = await deleteIn(env, '0123456789abcdef01234567'); // well-formed (r16), not the current one
  assert.equal(stale.status, 412);
  assert.deepEqual(everyKey(env), before, 'a stale DELETE wrote a key before refusing');
  // CONTROL: the write path still reconciles — the alarm delivers the pending inverse
  await env.CARD_LIFETIMES.alarm('t');
  assert.equal(env.CARDS._m.get(vanityOfKey('t', '0')), 'card.example', 'CONTROL: the alarm did not deliver the pending inverse');
});

test('🔴 r16 an If-Generation that is present but not a generation is 400 bad_generation, with every key untouched — only an ABSENT header skips the fence (reef#2618, tile#207 codex r2 #1)', async () => {
  // HEAD passed `meant || null`: an empty value (or whitespace, which Headers trims to empty) became
  // "no header", /end rotated the current lifetime, and the next owner's card went 410.
  const env = envWith({ t: CARD });
  for (const bad of ['', '   ', 'abc', '-1', '00', '0123456789ABCDEF01234567', '0123456789abcdef0123456']) {
    const before = everyKey(env);
    const res = await deleteIn(env, bad);
    assert.equal(res.status, 400, `If-Generation ${JSON.stringify(bad)} was not refused as a bad request`);
    assert.equal((await res.json()).error, 'bad_generation', JSON.stringify(bad));
    assert.deepEqual(everyKey(env), before, `If-Generation ${JSON.stringify(bad)} wrote a key`);
    assert.equal((await page(env, '/t')).status, 200, JSON.stringify(bad));
  }
  // CONTROL: a well-formed current generation still deletes (and a stale one still fences: r4, r15)
  const ok = await deleteIn(env, '0');
  assert.equal(ok.status, 200, 'CONTROL: the current generation did not delete');
  assert.deepEqual(await ok.json(), { handle: 't', deleted: true });
  // CONTROL: the generation a delete rotates to is itself well-formed — the next DELETE can name it
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: NEXT })).status, 200);
  const next = (await (await call(env, 'GET', '/_api/card/t/lifetime')).json()).gen;
  assert.notEqual(next, '0');
  assert.equal((await deleteIn(env, next)).status, 200, 'CONTROL: a rotated generation was refused as malformed');
  // CONTROL: an absent header is the documented legacy path — no fence, the delete goes through
  const legacy = envWith({ t: CARD });
  const absent = await call(legacy, 'DELETE', '/_api/card/t');
  assert.equal(absent.status, 200, 'CONTROL: a DELETE without If-Generation was refused');
  assert.deepEqual(await absent.json(), { handle: 't', deleted: true });
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
  // 🔴 tile#209: the second create of the same lifetime can no longer land while the first is
  // mid-put — card writes of one lifetime run one at a time in the handle's object. It waits; the
  // DELETE (the lifetime's own queue) does not, and ends the lifetime under both of them.
  let secondAnswered = false;
  const second = call(env, 'PUT', '/_api/card/t', { markdown: NEXT }).then((r) => { secondAnswered = true; return r; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(secondAnswered, false, 'a second write of the same card ran while the first was mid-put');
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  held.release();
  assert.equal((await pending).status, 409);
  const late = await second;
  assert.equal(late.status, 409);
  assert.equal((await late.json()).stale_generation, true, 'the queued create was not told its lifetime ended');
  const res = await page(env, '/t');
  assert.notEqual(res.status, 200, 'a held create resurrected the deleted handle');
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
    // tile#209 r2: the save reads gen:t ONCE now, at admission; every later generation check is the
    // handle's object's own (commitCard), not a KV read, so there may be nothing after admission to
    // pause here. The held-put tests above and below hold the window those checks guard.
    if (!held) { await pending; assert.ok(n - 1 >= 1, `the save never read gen:t at admission (${n - 1} reads)`); break; }
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
  // r10 adds the adoptions: every pair's first /point reads the legacy pointer once (+1), and a's
  // generation-0 lifetime adopts its bare inverse at /register (bare get, the gen-0 key put, its
  // cache-written put: +3). So 2 × 19 + 2 × 16 = 70.
  assert.equal(rows, 70);
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
  // r15: the marker follows /end (the fence comes before every write), so not even it is new
  assert.deepEqual(new Map(env.CARDS._m), before, 'a DELETE whose /end never answered wrote a key');
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

test('🔴 codex r9 a legacy inverse is part of the lifetime: the handle that loses the host stops redirecting, whether it rebound it or never touched it (3 rows)', async () => {
  // R/legacy-loss.mjs: b owns OWNER from before generations (`vanity:<host>` = b, bare `vanityof:b`).
  // a binds OWNER (redirect:false), then a is DELETEd. r9 cleared only `vanityof:b:0` on the loss and
  // the reader fell back to the bare key, so /b 301'd to a's content and then to a 404 for good.
  // Rows: the new-format control; b rebound OWNER through bindVanity first; b never touched it (the
  // host's object has no durable owner, so it adopts b from its pointer before replacing it).
  const failures = [];
  let rows = 0;
  for (const mode of ['new-control', 'legacy-rebound', 'legacy-untouched']) {
    const legacy = mode.startsWith('legacy') ? { [vanityKey(OWNER)]: 'b', 'vanityof:b': OWNER } : {};
    const env = envWith({ a: CARD, b: B_CARD, ...legacy });
    rows++;
    const where = `[${mode}]`;
    try {
      if (mode !== 'legacy-untouched') await bindVanity(env, 'b', OWNER);
      const before = await page(env, '/b');
      assert.equal(before.headers.get('location'), `https://${OWNER}/`, `${where} CONTROL: /b redirects to its domain`);
      assert.ok((await (await host(env, OWNER, '/')).text()).includes('Next owner'), `${where} CONTROL: the domain serves b`);
      const taken = await bindVanity(env, 'a', OWNER, { redirect: false });
      assert.equal(taken.accepted, true, `${where}: a's bind was not accepted`);
      // each check below records its own failure, so a red row shows the whole path, not its first step
      const check = (fn) => { try { fn(); } catch (e) { failures.push(e.message); } };
      const afterTake = await page(env, '/b');
      check(() => assert.equal(afterTake.status, 200, `${where}: after the take /b ${afterTake.status} → ${afterTake.headers.get('location')}`));
      // rule 1: losing the host cleared every inverse that named it, the bare one included
      check(() => assert.equal(env.CARDS._m.get('vanityof:b'), undefined, `${where}: the bare legacy inverse survived the loss`));
      assert.equal((await call(env, 'DELETE', '/_api/card/a')).status, 200, where);
      const canon = await page(env, '/b'), canonText = await canon.text(), domain = await host(env, OWNER, '/');
      check(() => assert.equal(canon.status, 200, `${where}: after a's DELETE /b ${canon.status} → ${canon.headers.get('location')} (domain ${domain.status})`));
      check(() => assert.ok(canonText.includes('Next owner'), `${where}: /b serves b's card`));
      check(() => assert.equal(domain.status, 404, `${where}: the domain`));
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 3);
});

test('🔴 r10 an authoritative "none" is not a missing key: once the lifetime has written its inverse, the bare legacy key is never asked', async () => {
  // a legacy owner loses its host while the bare key's delete fails: the generation-scoped tombstone
  // (empty value) already says "no address", so /b serves its page; the object retries the delete.
  const env = envWith({ a: CARD, b: B_CARD, [vanityKey(OWNER)]: 'b', 'vanityof:b': OWNER });
  const del = env.CARDS.delete.bind(env.CARDS);
  let once = true;
  env.CARDS.delete = async (k) => {
    if (once && k === 'vanityof:b') { once = false; throw new Error('injected bare-inverse delete failure'); }
    return del(k);
  };
  assert.equal((await bindVanity(env, 'a', OWNER, { redirect: false })).accepted, true);
  assert.equal(env.CARDS._m.get('vanityof:b'), OWNER, 'CONTROL: the injected delete failure took effect');
  assert.equal(env.CARDS._m.get(vanityOfKey('b', '0')), '', 'the loss wrote no tombstone');
  const canon = await page(env, '/b');
  assert.equal(canon.status, 200, `a cleared inverse fell back to the bare key: /b ${canon.status} → ${canon.headers.get('location')}`);
  await env.CARD_LIFETIMES.alarm('b');
  assert.equal(env.CARDS._m.get('vanityof:b'), undefined, 'the object did not retry the bare delete');

  // the reader rule, seeded directly: a present gen-0 key is the whole answer, empty means none; the
  // bare key is read only when no lifetime has written one
  const seeded = (rows) => envWith({ b: B_CARD, [vanityKey(OWNER)]: 'b', 'vanityof:b': OWNER, ...rows });
  assert.equal((await page(seeded({ [vanityOfKey('b', '0')]: '' }), '/b')).status, 200, 'a tombstone was read as missing');
  assert.equal((await page(seeded({ [vanityOfKey('b', '0')]: 'other.example' }), '/b')).headers.get('location'), 'https://other.example/');
  assert.equal((await page(seeded({}), '/b')).headers.get('location'), `https://${OWNER}/`, 'CONTROL: no lifetime record, the legacy redirect stands');
});

test('r10 a legacy owner that binds another host without a redirect keeps its legacy redirect (its lifetime adopts the bare inverse)', async () => {
  const env = envWith({ b: B_CARD, [vanityKey(OWNER)]: 'b', 'vanityof:b': OWNER });
  assert.equal((await bindVanity(env, 'b', 'second.example', { redirect: false })).accepted, true);
  assert.equal(env.CARDS._m.get(vanityOfKey('b', '0')), OWNER, 'the lifetime did not adopt the bare inverse');
  assert.equal((await page(env, '/b')).headers.get('location'), `https://${OWNER}/`, 'a redirect:false bind dropped the legacy redirect');
  assert.equal((await host(env, 'second.example', '/')).status, 200, 'CONTROL: the new binding serves');
});

test('🔴 codex r10 a delayed /lost never clears a newer accepted rebind of the same host: a loss names the acceptance it ends (4 rows)', async () => {
  // R/late-loss.mjs: b binds OWNER; a takes it while b's /lost answers 503; b binds it back (published,
  // 301) while the notice still fails; then delivery returns and the host's alarm retries. r10's lost()
  // matched only the host, so the notice about a's OLDER take cleared b's newer inverse: /b 301 → 200
  // while the domain still served b. Rows: generation 0 and a recreated lifetime, each with the notice
  // failing (the regression) and delivered at once (the control).
  const failures = [];
  let rows = 0;
  for (const reborn of [false, true]) for (const fail of [false, true]) {
    const env = envWith({ a: CARD, b: B_CARD });
    const where = `[${reborn ? 'reborn' : 'gen0'}${fail ? ', /lost failing' : ', control'}]`;
    rows++;
    try {
      if (reborn) {
        assert.equal((await call(env, 'DELETE', '/_api/card/b')).status, 200, where);
        assert.equal((await call(env, 'PUT', '/_api/card/b', { markdown: B_CARD })).status, 200, where);
      }
      const lives = env.CARD_LIFETIMES;
      let blocked = fail, refused = 0;
      env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
        if (blocked && id.name === 'b' && new URL(url).pathname === '/lost') { refused++; return new Response('unavailable', { status: 503 }); }
        return lives.get(id).fetch(url, init);
      } }) };
      await bindVanity(env, 'b', OWNER);
      await bindVanity(env, 'a', OWNER);
      const rebound = await bindVanity(env, 'b', OWNER);
      assert.equal(rebound.redirect, 'published', `${where}: the rebind was not published`);
      assert.equal((await page(env, '/b')).status, 301, `${where} CONTROL: /b redirects after the rebind`);
      assert.equal(refused > 0, fail, `${where} CONTROL: the injected /lost failure took effect`);
      blocked = false;
      await env.HOST_BINDINGS.alarm(OWNER);
      assert.deepEqual(env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').losers, [], `${where} CONTROL: the retried notices were delivered`);
      const after = await page(env, '/b');
      assert.equal(after.status, 301, `${where}: a delayed loss cleared the newer rebind: /b ${after.status} → ${after.headers.get('location')}`);
      assert.equal(after.headers.get('location'), `https://${OWNER}/`, where);
      assert.ok((await (await host(env, OWNER, '/')).text()).includes('Next owner'), `${where} CONTROL: the domain serves b`);
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 4);
});

test('🔴 r11 the loss rule at its boundary: a loss carrying the ticket of the acceptance that wrote the inverse is stale, the next ticket clears it', async () => {
  // A /lost carries the ticket of the acceptance that DISPLACED the loser; the inverse keeps the ticket
  // of the acceptance that wrote it, and is cleared only if that ticket < the loss's. Sent to b's object
  // directly, with the accepted ticket read from the host's object (its `landed`), not from b's state.
  for (const delta of [0, 1]) {
    const env = envWith({ b: B_CARD });
    assert.equal((await bindVanity(env, 'b', OWNER)).redirect, 'published');
    const accepted = env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').landed;
    const res = await env.CARD_LIFETIMES.get({ name: 'b' }).fetch('https://card-lifetime.example/lost', {
      method: 'POST', body: JSON.stringify({ handle: 'b', gen: '0', host: OWNER, ticket: accepted + delta }),
    });
    assert.equal(res.status, 200, `[+${delta}] the loss was not acknowledged`);
    const canon = await page(env, '/b');
    if (delta === 0) assert.equal(canon.status, 301, '[+0] a loss about the acceptance that wrote the inverse cleared it');
    else assert.equal(canon.status, 200, `[+1] a later loss left the inverse: /b → ${canon.headers.get('location')}`);
  }
});

test('🔴 codex r11 a late same-owner registration never lowers the inverse\'s ticket: the older loss it would expose keeps the newer rebind (4 rows)', async () => {
  // R/late-register.mjs: b binds OWNER; a second bind of b takes ticket T2 and is held before its
  // /register; a takes OWNER with T3 while b's /lost answers 503; b binds it back with T4 (published,
  // 301). The held bind then registers (a NEWER order than T4's), /point accepts it as a same-owner
  // no-op, and r11's /confirm, which compared only orders, overwrote the inverse's T4 with T2 — so the
  // retried T3 loss cleared it: /b 301 → 200 while the domain still served b. Rows: generation 0 and a
  // recreated lifetime, each with the notice failing (the regression) and delivered at once (control).
  const failures = [];
  let rows = 0;
  for (const reborn of [false, true]) for (const fail of [false, true]) {
    const env = envWith({ a: CARD, b: B_CARD });
    const where = `[${reborn ? 'reborn' : 'gen0'}${fail ? ', /lost failing' : ', control'}]`;
    rows++;
    try {
      if (reborn) {
        assert.equal((await call(env, 'DELETE', '/_api/card/b')).status, 200, where);
        assert.equal((await call(env, 'PUT', '/_api/card/b', { markdown: B_CARD })).status, 200, where);
      }
      const lives = env.CARD_LIFETIMES, started = deferred(), release = deferred();
      let blocked = fail, hold = false, refused = 0;
      env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
        const op = new URL(url).pathname;
        if (hold && id.name === 'b' && op === '/register') { hold = false; started.resolve(); await release.promise; }
        if (blocked && id.name === 'b' && op === '/lost') { refused++; return new Response('unavailable', { status: 503 }); }
        return lives.get(id).fetch(url, init);
      } }) };
      const hostState = () => env.HOST_BINDINGS.storageOf(OWNER)._m.get('host');
      await bindVanity(env, 'b', OWNER);
      hold = true;
      const older = bindVanity(env, 'b', OWNER); // T2, held before its /register
      await started.promise;
      const t2 = hostState().seq;
      await bindVanity(env, 'a', OWNER); // T3
      const t3 = hostState().landed;
      const rebound = await bindVanity(env, 'b', OWNER); // T4
      const t4 = hostState().landed;
      assert.ok(t2 < t3 && t3 < t4, `${where} CONTROL: tickets T2 < T3 < T4 (${t2}, ${t3}, ${t4})`);
      assert.equal(rebound.redirect, 'published', `${where}: the rebind was not published`);
      assert.equal((await page(env, '/b')).status, 301, `${where} CONTROL: /b redirects after the rebind`);
      release.resolve();
      const late = await older;
      assert.equal(late.accepted, true, `${where} CONTROL: the late bind is a same-owner no-op`);
      // its host is b's and is the card's address, by the acceptance that owns it: that IS published
      assert.equal(late.redirect, 'published', `${where}: the late no-op of the host b owns reported ${late.redirect}`);
      const inverse = lives.storageOf('b')._m.get('life').inverse;
      // recorded, not thrown, so a red row also shows what the lowered ticket does to /b below
      if (inverse.ticket !== t4) failures.push(`${where}: the late registration lowered the inverse's ticket ${t4} → ${inverse.ticket}`);
      assert.equal(refused > 0, fail, `${where} CONTROL: the injected /lost failure took effect`);
      blocked = false;
      await env.HOST_BINDINGS.alarm(OWNER);
      assert.deepEqual(hostState().losers, [], `${where} CONTROL: the retried notices were delivered`);
      const after = await page(env, '/b');
      assert.equal(after.status, 301, `${where}: the older loss cleared the newer rebind: /b ${after.status} → ${after.headers.get('location')}`);
      assert.equal(after.headers.get('location'), `https://${OWNER}/`, where);
      assert.ok((await (await host(env, OWNER, '/')).text()).includes('Next owner'), `${where} CONTROL: the domain serves b`);
      // CONTROL: a genuinely later take still clears it
      await bindVanity(env, 'a', OWNER);
      assert.equal((await page(env, '/b')).status, 200, `${where} CONTROL: a later take left /b redirecting to a's domain`);
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 4);
});

test('🔴 r12 a same-owner no-op answers with the ticket that owns the host, never its own: an older bind confirming after a newer one whose confirm never ran writes the newer ticket', async () => {
  // As codex r11, but T4's /confirm fails (503: its binding stands, its redirect is not published), so
  // the inverse still holds T1 when the held T2 confirms. Had /point echoed T2, the inverse would be
  // written with T2 < T3, and the retried T3 loss would clear a redirect to a host b owns.
  const env = envWith({ a: CARD, b: B_CARD });
  const lives = env.CARD_LIFETIMES, started = deferred(), release = deferred();
  let blocked = true, hold = false, failConfirm = false;
  env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
    const op = new URL(url).pathname;
    if (hold && id.name === 'b' && op === '/register') { hold = false; started.resolve(); await release.promise; }
    if (blocked && id.name === 'b' && op === '/lost') return new Response('unavailable', { status: 503 });
    if (failConfirm && id.name === 'b' && op === '/confirm') { failConfirm = false; return new Response('unavailable', { status: 503 }); }
    return lives.get(id).fetch(url, init);
  } }) };
  const hostState = () => env.HOST_BINDINGS.storageOf(OWNER)._m.get('host');
  await bindVanity(env, 'b', OWNER); // T1
  hold = true;
  const older = bindVanity(env, 'b', OWNER); // T2, held before its /register
  await started.promise;
  await bindVanity(env, 'a', OWNER); // T3, b's notice failing
  failConfirm = true;
  await assert.rejects(bindVanity(env, 'b', OWNER), /confirming/, 'CONTROL: the injected /confirm failure took effect'); // T4
  const t4 = hostState().landed;
  assert.equal(hostState().owner.handle, 'b', 'CONTROL: T4 was accepted');
  release.resolve();
  const late = await older, failures = [];
  assert.equal(late.redirect, 'published', 'the late bind of the host b owns was not published');
  const written = lives.storageOf('b')._m.get('life').inverse.ticket;
  if (written !== t4) failures.push(`the no-op confirmed with a ticket that does not own the host: ${written}, owner's ${t4}`);
  blocked = false;
  await env.HOST_BINDINGS.alarm(OWNER);
  assert.deepEqual(hostState().losers, [], 'CONTROL: the retried notice was delivered');
  const after = await page(env, '/b');
  if (after.status !== 301) failures.push(`the older loss cleared the redirect to a host b owns: /b ${after.status} → ${after.headers.get('location')}`);
  assert.deepEqual(failures, []);
});

test('🔴 r12 between two hosts the registration order still decides: a later bind of another host is published even when its ticket ties the first host\'s (two objects, one clock reading)', async () => {
  // Tickets are max(seq + 1, now) of EACH host's own object, so two hosts bound within one millisecond
  // can issue the same ticket, and another host's clock can be behind. Ticket order is the inverse's
  // rule for one host only; with ticket order across hosts, the newer bind below would be refused.
  const realNow = Date.now, frozen = realNow();
  Date.now = () => frozen;
  try {
    const env = envWith({ b: B_CARD });
    assert.equal((await bindVanity(env, 'b', 'x.example')).redirect, 'published');
    const moved = await bindVanity(env, 'b', 'y.example');
    const tx = env.HOST_BINDINGS.storageOf('x.example')._m.get('host').landed, ty = env.HOST_BINDINGS.storageOf('y.example')._m.get('host').landed;
    assert.equal(tx, ty, 'CONTROL: the two hosts issued the same ticket');
    assert.equal(moved.redirect, 'published', 'the later bind of another host was refused on a ticket tie');
    assert.equal((await page(env, '/b')).headers.get('location'), 'https://y.example/', 'the card kept the older host');
  } finally { Date.now = realNow; }
});

test('🔴 r12 an accepted bind\'s late /confirm never lowers the inverse\'s ticket for the same host, whatever its registration order: the loss between them keeps the newer rebind', async () => {
  // Not a no-op this time: the older bind (T1) was ACCEPTED at /point, so the ticket it confirms with is
  // its own and right; only /confirm's ticket rule stands between it and the inverse. Order of events:
  // b-old admits T1 and is held before /register; a admits T2 and is held before /point; b-new admits
  // T3, registers FIRST (order 1) and is held before /point; b-old registers (order 2), points (accepted,
  // landed T1) and is held before /confirm; a points (accepted, landed T2; b's /lost answers 503); b-new
  // points (accepted, landed T3) and confirms; then b-old's /confirm arrives with the NEWER order and the
  // OLDER ticket. Order alone (r11) writes T1 over T3, and the retried T2 loss clears /b.
  const env = envWith({ a: CARD, b: B_CARD });
  const lives = env.CARD_LIFETIMES, ns = env.HOST_BINDINGS;
  const gate = () => ({ reached: deferred(), go: deferred() });
  const reg = gate(), aPoint = gate(), newPoint = gate(), oldConfirm = gate();
  let blocked = true, holdReg = true, holdA = true, holdNew = false, holdConfirm = true;
  env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
    const op = new URL(url).pathname;
    if (holdReg && id.name === 'b' && op === '/register') { holdReg = false; reg.reached.resolve(); await reg.go.promise; }
    if (holdConfirm && id.name === 'b' && op === '/confirm' && JSON.parse(init.body).order === 2) { holdConfirm = false; oldConfirm.reached.resolve(); await oldConfirm.go.promise; }
    if (blocked && id.name === 'b' && op === '/lost') return new Response('unavailable', { status: 503 });
    return lives.get(id).fetch(url, init);
  } }) };
  env.HOST_BINDINGS = { ...ns, get: (id) => ({ async fetch(url, init) {
    if (new URL(url).pathname === '/point') {
      const { handle } = JSON.parse(init.body);
      if (holdA && handle === 'a') { holdA = false; aPoint.reached.resolve(); await aPoint.go.promise; }
      if (holdNew && handle === 'b') { holdNew = false; newPoint.reached.resolve(); await newPoint.go.promise; }
    }
    return ns.get(id).fetch(url, init);
  } }) };
  const hostState = () => ns.storageOf(OWNER)._m.get('host');
  const older = bindVanity(env, 'b', OWNER); // T1
  await reg.reached.promise;
  const t1 = hostState().seq;
  const taker = bindVanity(env, 'a', OWNER); // T2
  await aPoint.reached.promise;
  holdNew = true;
  const newer = bindVanity(env, 'b', OWNER); // T3, order 1
  await newPoint.reached.promise;
  const t3 = hostState().seq;
  reg.go.resolve(); // b-old: order 2, accepted at T1
  await oldConfirm.reached.promise;
  assert.equal(hostState().landed, t1, 'CONTROL: the older bind was accepted with its own ticket');
  aPoint.go.resolve();
  assert.equal((await taker).accepted, true, 'CONTROL: a took the host');
  newPoint.go.resolve();
  assert.equal((await newer).redirect, 'published', 'the newest bind was not published');
  assert.equal(hostState().landed, t3, 'CONTROL: b owns the host with T3');
  const failures = [];
  oldConfirm.go.resolve();
  const late = await older;
  if (late.redirect !== 'not_published') failures.push(`the older acceptance's late redirect was published: ${late.redirect}`);
  const written = lives.storageOf('b')._m.get('life').inverse.ticket;
  if (written !== t3) failures.push(`the late /confirm lowered the inverse's ticket ${t3} → ${written}`);
  blocked = false;
  await ns.alarm(OWNER);
  assert.deepEqual(hostState().losers, [], 'CONTROL: the retried notices were delivered');
  const after = await page(env, '/b');
  if (after.status !== 301) failures.push(`the T2 loss cleared the newer rebind: /b ${after.status} → ${after.headers.get('location')}`);
  assert.ok((await (await host(env, OWNER, '/')).text()).includes('Next owner'), 'CONTROL: the domain serves b');
  assert.deepEqual(failures, []);
});

test('🔴 codex r12 a host published in between never discards the first host\'s ticket: an older acceptance of it stays unpublished, and the loss between them keeps a redirect (8 rows)', async () => {
  // R/cross-host-reset.mjs, four binds of b. b-old admits T1 at X and is held before /register; a admits
  // T2 at X and is held before /point; b-new admits T3 at X, registers (order 1) and is held before
  // /point; [Y] b → Y registers (order 2), is accepted and held before /confirm. b-old then registers
  // (order 3, or 2 without Y), is accepted at X with T1 and held before /confirm; a takes X with T2 (b's
  // /lost answers 503 in the failing rows); b-new takes X back with T3 and is published (301 → X); Y's
  // confirm wins on order (301 → Y). b-old's /confirm arrives last: r12 compared tickets only while the
  // inverse named X, so with Y in between it wrote X/T1, and the retried T2 loss cleared it: /b 301 →
  // 200 while both domains served b. Rows: generation 0 / recreated × loss failing / delivered × with /
  // without the Y bind; the six rows that are not (failing, Y) are controls.
  const Y = 'second.example', failures = [];
  let rows = 0;
  for (const reborn of [false, true]) for (const fail of [false, true]) for (const cross of [false, true]) {
    const env = envWith({ a: CARD, b: B_CARD });
    const where = `[${reborn ? 'reborn' : 'gen0'}, ${fail ? '/lost failing' : 'delivered'}, ${cross ? 'Y in between' : 'X only'}]`;
    rows++;
    try {
      if (reborn) {
        assert.equal((await call(env, 'DELETE', '/_api/card/b')).status, 200, where);
        assert.equal((await call(env, 'PUT', '/_api/card/b', { markdown: B_CARD })).status, 200, where);
      }
      const lives = env.CARD_LIFETIMES, ns = env.HOST_BINDINGS;
      const gate = () => ({ reached: deferred(), go: deferred() });
      const reg = gate(), aPoint = gate(), newPoint = gate(), oldConfirm = gate(), yConfirm = gate();
      const oldOrder = cross ? 3 : 2;
      let blocked = fail, holdReg = true, holdA = true, holdNew = false, holdConfirm = true, refused = 0;
      env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
        const op = new URL(url).pathname, data = JSON.parse(init.body);
        if (holdReg && id.name === 'b' && op === '/register') { holdReg = false; reg.reached.resolve(); await reg.go.promise; }
        if (id.name === 'b' && op === '/confirm' && data.host === Y) { yConfirm.reached.resolve(); await yConfirm.go.promise; }
        if (holdConfirm && id.name === 'b' && op === '/confirm' && data.host === OWNER && data.order === oldOrder) { holdConfirm = false; oldConfirm.reached.resolve(); await oldConfirm.go.promise; }
        if (blocked && id.name === 'b' && op === '/lost') { refused++; return new Response('unavailable', { status: 503 }); }
        return lives.get(id).fetch(url, init);
      } }) };
      env.HOST_BINDINGS = { ...ns, get: (id) => ({ async fetch(url, init) {
        if (new URL(url).pathname === '/point' && id.name === OWNER) {
          const { handle } = JSON.parse(init.body);
          if (holdA && handle === 'a') { holdA = false; aPoint.reached.resolve(); await aPoint.go.promise; }
          if (holdNew && handle === 'b') { holdNew = false; newPoint.reached.resolve(); await newPoint.go.promise; }
        }
        return ns.get(id).fetch(url, init);
      } }) };
      const hostState = () => ns.storageOf(OWNER)._m.get('host');
      const inverse = () => structuredClone(lives.storageOf('b')._m.get('life').inverse);
      const older = bindVanity(env, 'b', OWNER); // T1
      await reg.reached.promise;
      const t1 = hostState().seq;
      const taker = bindVanity(env, 'a', OWNER); // T2
      await aPoint.reached.promise;
      const t2 = hostState().seq;
      holdNew = true;
      const newer = bindVanity(env, 'b', OWNER); // T3, order 1
      await newPoint.reached.promise;
      const t3 = hostState().seq;
      let other;
      if (cross) { other = bindVanity(env, 'b', Y); await yConfirm.reached.promise; } // order 2
      reg.go.resolve(); // b-old: order 3 (2 without Y), accepted at X with T1
      await oldConfirm.reached.promise;
      assert.equal(hostState().landed, t1, `${where} CONTROL: the older bind was accepted with its own ticket`);
      assert.ok(t1 < t2 && t2 < t3, `${where} CONTROL: tickets T1 < T2 < T3 (${t1}, ${t2}, ${t3})`);
      aPoint.go.resolve();
      assert.equal((await taker).accepted, true, `${where} CONTROL: a took X`);
      newPoint.go.resolve();
      assert.equal((await newer).redirect, 'published', `${where} CONTROL: b-new was published`);
      assert.equal(inverse().ticket, t3, `${where} CONTROL: the inverse holds X/T3`);
      assert.equal((await page(env, '/b')).headers.get('location'), `https://${OWNER}/`, `${where} CONTROL: /b → X`);
      if (cross) {
        yConfirm.go.resolve();
        assert.equal((await other).redirect, 'published', `${where} CONTROL: Y was published on order`);
        assert.equal((await page(env, '/b')).headers.get('location'), `https://${Y}/`, `${where} CONTROL: /b → Y`);
      }
      const before = inverse();
      oldConfirm.go.resolve();
      const late = await older;
      if (late.redirect !== 'not_published') failures.push(`${where}: the older acceptance's late redirect was published: ${late.redirect}`);
      const afterLate = inverse();
      if (afterLate.host !== before.host || afterLate.ticket !== before.ticket) failures.push(`${where}: the late /confirm rewrote the inverse ${before.host}/${before.ticket} → ${afterLate.host}/${afterLate.ticket}`);
      assert.equal(refused > 0, fail, `${where} CONTROL: the injected /lost failure took effect`);
      blocked = false;
      await ns.alarm(OWNER);
      assert.deepEqual(hostState().losers, [], `${where} CONTROL: the retried notices were delivered`);
      const after = await page(env, '/b'), want = `https://${cross ? Y : OWNER}/`;
      if (after.status !== 301 || after.headers.get('location') !== want) failures.push(`${where}: the T2 loss cleared the card's address: /b ${after.status} → ${after.headers.get('location')}`);
      assert.ok((await (await host(env, OWNER, '/')).text()).includes('Next owner'), `${where} CONTROL: X serves b`);
      if (cross) assert.ok((await (await host(env, Y, '/')).text()).includes('Next owner'), `${where} CONTROL: Y serves b`);
      assert.equal(lives.storageOf('b')._m.get('life').cache, 'written', `${where} CONTROL: the cache was written`);
      await lives.alarm('b');
      assert.equal((await page(env, '/b')).status, after.status, `${where} CONTROL: reconciliation keeps the result`);
    } catch (e) { failures.push(e.message); }
  }
  assert.deepEqual(failures, []);
  assert.equal(rows, 8);
});

test('r13 binding a host again after another host moves the card back: X\'s high water from the first bind never strands the card on Y', async () => {
  // X/T, then Y, then X again. The rebind is a fresh acceptance at X (a newer ticket than T, which is
  // highWater[X]), so it publishes on its ticket and its order. CONTROL for the per-host refusal.
  const env = envWith({ b: B_CARD }), Y = 'second.example';
  assert.equal((await bindVanity(env, 'b', OWNER)).redirect, 'published');
  const tx = env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').landed;
  assert.equal((await bindVanity(env, 'b', Y)).redirect, 'published');
  assert.equal((await page(env, '/b')).headers.get('location'), `https://${Y}/`, 'CONTROL: /b → Y');
  const back = await bindVanity(env, 'b', OWNER);
  assert.ok(env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').landed > tx, 'CONTROL: the rebind of X is a fresh acceptance');
  assert.equal(back.redirect, 'published', 'binding X again after Y was refused');
  assert.equal((await page(env, '/b')).headers.get('location'), `https://${OWNER}/`, 'the card stayed on Y');
});

test('🔴 r13 an acceptance refused on order still raises its host\'s high water: an older acceptance of that host with a newer order stays unpublished', async () => {
  // b-old admits T1 at X, held before /register; a admits T2 at X, held before /point; b-new admits T3,
  // registers (order 1), held before /point; b → Y registers (order 2) and is published. b-old registers
  // (order 3), is accepted with T1 and held before /confirm; a takes X with T2 (b's /lost 503); b-new
  // takes X back with T3, but its /confirm is refused: Y's order 2 is newer. b-old's /confirm then
  // carries the newest order and T1. Had only PUBLISHED tickets counted, X/T1 would be written and the
  // retried T2 loss would clear /b while Y serves b.
  const env = envWith({ a: CARD, b: B_CARD }), Y = 'second.example';
  const lives = env.CARD_LIFETIMES, ns = env.HOST_BINDINGS;
  const gate = () => ({ reached: deferred(), go: deferred() });
  const reg = gate(), aPoint = gate(), newPoint = gate(), oldConfirm = gate();
  let blocked = true, holdReg = true, holdA = true, holdNew = false, holdConfirm = true;
  env.CARD_LIFETIMES = { ...lives, get: (id) => ({ async fetch(url, init) {
    const op = new URL(url).pathname, data = JSON.parse(init.body);
    if (holdReg && id.name === 'b' && op === '/register') { holdReg = false; reg.reached.resolve(); await reg.go.promise; }
    if (holdConfirm && id.name === 'b' && op === '/confirm' && data.host === OWNER && data.order === 3) { holdConfirm = false; oldConfirm.reached.resolve(); await oldConfirm.go.promise; }
    if (blocked && id.name === 'b' && op === '/lost') return new Response('unavailable', { status: 503 });
    return lives.get(id).fetch(url, init);
  } }) };
  env.HOST_BINDINGS = { ...ns, get: (id) => ({ async fetch(url, init) {
    if (new URL(url).pathname === '/point' && id.name === OWNER) {
      const { handle } = JSON.parse(init.body);
      if (holdA && handle === 'a') { holdA = false; aPoint.reached.resolve(); await aPoint.go.promise; }
      if (holdNew && handle === 'b') { holdNew = false; newPoint.reached.resolve(); await newPoint.go.promise; }
    }
    return ns.get(id).fetch(url, init);
  } }) };
  const hostState = () => ns.storageOf(OWNER)._m.get('host');
  const life = () => lives.storageOf('b')._m.get('life');
  const older = bindVanity(env, 'b', OWNER); // T1
  await reg.reached.promise;
  const taker = bindVanity(env, 'a', OWNER); // T2
  await aPoint.reached.promise;
  holdNew = true;
  const newer = bindVanity(env, 'b', OWNER); // T3, order 1
  await newPoint.reached.promise;
  const t3 = hostState().seq;
  assert.equal((await bindVanity(env, 'b', Y)).redirect, 'published', 'CONTROL: Y published (order 2)');
  reg.go.resolve(); // b-old: order 3
  await oldConfirm.reached.promise;
  aPoint.go.resolve();
  assert.equal((await taker).accepted, true, 'CONTROL: a took X');
  newPoint.go.resolve();
  assert.equal((await newer).redirect, 'not_published', 'CONTROL: b-new was refused on order (Y is newer)');
  const failures = [];
  if (life().highWater?.[OWNER] !== t3) failures.push(`the acceptance refused on order did not raise X's high water: ${life().highWater?.[OWNER]}, T3 ${t3}`);
  oldConfirm.go.resolve();
  const late = await older;
  if (late.redirect !== 'not_published') failures.push(`the older acceptance's late redirect was published: ${late.redirect}`);
  blocked = false;
  await ns.alarm(OWNER);
  assert.deepEqual(hostState().losers, [], 'CONTROL: the retried notices were delivered');
  const after = await page(env, '/b');
  if (after.headers.get('location') !== `https://${Y}/`) failures.push(`the T2 loss cleared the card's address: /b ${after.status} → ${after.headers.get('location')}`);
  assert.deepEqual(failures, []);
});

test('🔴 r14 a loss of a host the inverse does not name never clears it, even when the loss ticket is newer: /b keeps its redirect to Y and the loss is still recorded', async () => {
  // codex r13: b → Y (ticket TY) published; b → X with redirect:false (TX1); a takes X (TX2). The /lost
  // for X carries TX2 > TY, so only the host comparison keeps it off Y's inverse. The clock steps one
  // millisecond per reading, so TY < TX1 < TX2 by construction, not by how fast this machine runs.
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => ++now;
  try {
    const env = envWith({ a: CARD, b: B_CARD }), Y = 'second.example';
    const life = () => env.CARD_LIFETIMES.storageOf('b')._m.get('life');
    assert.equal((await bindVanity(env, 'b', Y)).redirect, 'published', 'CONTROL: /b → Y');
    const ty = life().inverse.ticket;
    assert.equal((await bindVanity(env, 'b', OWNER, { redirect: false })).accepted, true, 'CONTROL: b holds X without a redirect');
    assert.equal(life().inverse.host, Y, 'CONTROL: the redirect:false bind left the inverse on Y');
    assert.equal((await bindVanity(env, 'a', OWNER)).accepted, true, 'CONTROL: a took X');
    const loss = env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').landed;
    assert.ok(loss > ty, `CONTROL: the X loss ticket ${loss} is newer than Y's ${ty}`);
    const after = await page(env, '/b');
    assert.equal(after.status, 301, `the loss of X cleared the inverse on Y: /b ${after.status}`);
    assert.equal(after.headers.get('location'), `https://${Y}/`);
    assert.equal(life().lost[OWNER], loss, 'the X loss was not recorded: a delayed X /confirm would be accepted');
  } finally { Date.now = realNow; }
});

test('r13 the per-host high water is bounded by the lifetime: one entry per host bound in it, and a DELETE empties it with the hosts', async () => {
  const env = envWith({ b: B_CARD }), hosts = ['h1.example', 'h2.example', 'h3.example'];
  for (let round = 0; round < 3; round++) for (const h of hosts) assert.equal((await bindVanity(env, 'b', h)).redirect, 'published');
  const life = () => env.CARD_LIFETIMES.storageOf('b')._m.get('life');
  assert.deepEqual(Object.keys(life().highWater).sort(), hosts, 'one entry per bound host, however many binds');
  assert.ok(Object.keys(life().highWater).every((h) => life().hosts.includes(h)), 'an entry for a host the lifetime does not hold');
  assert.equal((await call(env, 'DELETE', '/_api/card/b')).status, 200);
  assert.deepEqual(life().highWater, {}, 'the ended lifetime\'s high water outlived it');
  assert.equal((await call(env, 'PUT', '/_api/card/b', { markdown: B_CARD })).status, 200);
  assert.equal((await bindVanity(env, 'b', 'h1.example')).redirect, 'published', 'CONTROL: the next lifetime binds');
  assert.deepEqual(Object.keys(life().highWater), ['h1.example'], 'CONTROL: the next lifetime keeps its own');
});

test('🔴 r13 the equal ticket is refused once the inverse names another host: the acceptance X already had published does not take the card back from Y', async () => {
  // b → X (T, order 1) published, b → Y (order 2) published. A same-owner no-op of X registered later
  // (order 3) answers X's T, which is highWater[X]: an acceptance this lifetime already confirmed, and
  // one the newer Y replaced. It writes nothing. Sent straight to the object, as bindVanity would.
  const env = envWith({ b: B_CARD }), Y = 'second.example';
  assert.equal((await bindVanity(env, 'b', OWNER)).redirect, 'published');
  const tx = env.HOST_BINDINGS.storageOf(OWNER)._m.get('host').landed;
  assert.equal((await bindVanity(env, 'b', Y)).redirect, 'published');
  const lives = env.CARD_LIFETIMES, life = () => lives.storageOf('b')._m.get('life');
  const confirm = (body) => lives.get(lives.idFromName('b')).fetch('https://card-lifetime.example/confirm', { method: 'POST', body: JSON.stringify({ handle: 'b', gen: life().gen, ...body }) });
  const reg = await (await lives.get(lives.idFromName('b')).fetch('https://card-lifetime.example/register', { method: 'POST', body: JSON.stringify({ handle: 'b', host: OWNER, gen: life().gen }) })).json();
  assert.equal(reg.order, 3, 'CONTROL: a later registration');
  const res = await (await confirm({ host: OWNER, order: reg.order, ticket: tx })).json();
  assert.equal(res.published, false, `the equal ticket of X was published over Y: ${JSON.stringify(res)}`);
  assert.equal(life().inverse.host, Y, 'the inverse left Y');
  assert.equal((await page(env, '/b')).headers.get('location'), `https://${Y}/`);
});

test('🔴 r13 a lifetime stored before highWater existed takes its inverse\'s ticket as that host\'s high water: an older acceptance of it is refused', async () => {
  // r12 storage: inverse { host, order, ticket } and no highWater. Its inverse is an acceptance it
  // confirmed, so the load counts it; without that, the first older /confirm after the upgrade wins.
  const env = envWith({ b: B_CARD });
  assert.equal((await bindVanity(env, 'b', OWNER)).redirect, 'published');
  const lives = env.CARD_LIFETIMES, store = lives.storageOf('b')._m;
  const { highWater, ...r12 } = store.get('life');
  assert.ok(highWater, 'CONTROL: r13 stores highWater');
  store.set('life', structuredClone(r12));
  const tx = r12.inverse.ticket;
  const res = await (await lives.get(lives.idFromName('b')).fetch('https://card-lifetime.example/confirm', { method: 'POST',
    body: JSON.stringify({ handle: 'b', host: OWNER, gen: r12.gen, order: r12.inverse.order + 5, ticket: tx - 1 }) })).json();
  assert.equal(res.published, false, `an older acceptance overwrote an r12 inverse: ${JSON.stringify(res)}`);
  assert.equal(store.get('life').inverse.ticket, tx, 'the r12 inverse\'s ticket went down');
});

// ── the fenced asset delete (tile#209, reef#2600 door 3) ─────────────────────────────────────────
//
// A console delete of an unused picture names the version the site owner's editor READ. Between that
// read and the delete, another editor or agent may `put_asset` the same id — put_asset takes
// caller-chosen ids and replaces one — leaving it still unreferenced. An unfenced delete then removes
// the NEW bytes and nothing says so. The fenced route refuses when the card moved; and because KV has
// no compare-and-set, its check and its removal run in the handle's CardLifetime object, in one
// queue shared by every card write (put_asset, save_card's base_version, both deletes), so no other
// write can land between the check and the removal.
//
// 🔴 Exact answers: reef's hosted delete_asset (reef PR #2683) reads `fence`, `conflict`,
// `referenced`, `deleted` and `checked_version` by name, and treats a 404/405 WITHOUT `fence` as
// "this Worker has no fenced route" (a refusal, never a fallback).

const AVATAR_OLD = 'T0xEIGJ5dGVz'; // "OLD bytes"
const AVATAR_NEW = 'TkVXIGJ5dGVz'; // "NEW bytes"
/** a card with one referenced picture (`pic`) and one unreferenced (`unused`), as CARD */
const fencedCall = (env, id, ifVersion, { handle = 't', method = 'DELETE' } = {}) => {
  const url = new URL(`https://card.example/_api/card/${handle}/asset/${encodeURIComponent(id)}/fenced`);
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (ifVersion !== undefined) headers['if-version'] = ifVersion;
  return handleApi(new Request(url, { method, headers }), env, url);
};
const versionOf = async (env, handle = 't') => (await (await call(env, 'GET', `/_api/card/${handle}`)).json()).version;
const assetsOf = async (env, handle = 't') => parseCard(await bodyOf(env, handle)).assets;
/** an env whose card `t` has an unreferenced `unused` at OLD bytes, and the version the owner read */
const fencedFixture = async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/unused', { base64: AVATAR_OLD, mime: 'image/png' })).status, 200);
  return { env, read: await versionOf(env) };
};
/** let every queued microtask and the fake objects' awaits run */
const settle = () => new Promise((r) => setTimeout(r, 20));
/** a held write that never starts fails the test by name instead of hanging the file (and cancelling every test after it) */
const started = (held, what) => Promise.race([held.started,
  new Promise((_, no) => setTimeout(() => no(new Error(`${what} never reached the store`)), 2000))]);

test('🔴 fenced: a same-id put_asset between the read and the delete → 409 conflict, nothing removed, the NEW bytes survive', async () => {
  const { env, read } = await fencedFixture();
  // the other editor replaces `unused` after the site owner's read
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/unused', { base64: AVATAR_NEW, mime: 'image/png' })).status, 200);
  const res = await fencedCall(env, 'unused', read);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.conflict, true);
  assert.equal(body.expected, read);
  assert.equal(body.current, await versionOf(env));
  assert.equal(body.fence, 'if-version');
  assert.equal(typeof body.why, 'string');
  assert.equal((await assetsOf(env)).unused?.b64, AVATAR_NEW, "the other editor's replacement was removed");
});

test('🔴 fenced: a put_asset IN FLIGHT when the delete arrives — the delete waits for it, then refuses; the NEW bytes survive', async () => {
  // put_asset is held inside its KV write (after its read, inside the object's write queue). The
  // fenced delete, sent with the version read before the put, must not read the card until the put
  // has landed: if it did, its check would pass against the old bytes and its removal would erase
  // the replacement.
  const { env, read } = await fencedFixture();
  const held = holdPut(env, (k) => k === cardKey('t', '0'));
  const putting = call(env, 'PUT', '/_api/card/t/asset/unused', { base64: AVATAR_NEW, mime: 'image/png' });
  await started(held, 'the put_asset');
  let answered = false;
  const deleting = fencedCall(env, 'unused', read).then((r) => { answered = true; return r; });
  await settle();
  assert.equal(answered, false, 'the fenced delete answered while a write to the same card was in flight');
  held.release();
  assert.equal((await putting).status, 200);
  const res = await deleting;
  assert.equal(res.status, 409, 'the delete checked the version before the in-flight put landed');
  assert.equal((await res.json()).fence, 'if-version');
  assert.equal((await assetsOf(env)).unused?.b64, AVATAR_NEW);
});

test('🔴 fenced: a put_asset arriving while the delete is between its check and its removal waits — and lands after it', async () => {
  // The other order: the fenced delete has passed its check and is held inside its write. A put of
  // the same id arriving now must queue behind it, so the replacement is written AFTER the removal
  // (and survives), never computed from the card the delete is about to replace.
  const { env, read } = await fencedFixture();
  const held = holdPut(env, (k) => k === cardKey('t', '0'));
  const deleting = fencedCall(env, 'unused', read);
  await started(held, 'the fenced delete');
  let answered = false;
  const putting = call(env, 'PUT', '/_api/card/t/asset/unused', { base64: AVATAR_NEW, mime: 'image/png' })
    .then((r) => { answered = true; return r; });
  await settle();
  assert.equal(answered, false, 'put_asset answered while the fenced delete was between its check and its removal');
  held.release();
  const del = await deleting;
  assert.equal(del.status, 200);
  assert.equal((await putting).status, 200);
  assert.equal((await assetsOf(env)).unused?.b64, AVATAR_NEW, 'the replacement was lost to the delete');
});

test('🔴 fenced: an already-stale card (moved before the call, by any write) → 409, nothing removed', async () => {
  const { env, read } = await fencedFixture();
  const md = thinCard(await bodyOf(env)).replace('hello', 'edited elsewhere');
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: md, base_version: read })).status, 200);
  const before = await bodyOf(env);
  const res = await fencedCall(env, 'unused', read);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['conflict', 'current', 'expected', 'fence', 'why']);
  assert.equal(await bodyOf(env), before, 'a refused delete wrote');
});

test('🔴 fenced: If-Version missing or blank → 400 {error, fence}, nothing removed; CONTROL: the same call with it deletes', async () => {
  const { env, read } = await fencedFixture();
  for (const missing of [undefined, '', '   ']) {
    const res = await fencedCall(env, 'unused', missing);
    assert.equal(res.status, 400, `If-Version ${JSON.stringify(missing)}`);
    const body = await res.json();
    assert.equal(body.fence, 'if-version');
    assert.equal(typeof body.error, 'string');
    assert.ok('unused' in await assetsOf(env), 'a refused delete removed the asset');
  }
  const ok = await fencedCall(env, 'unused', read);
  assert.equal(ok.status, 200);
  assert.equal('unused' in await assetsOf(env), false);
});

test('🔴 fenced: still referenced → 409 {error, referenced, fence}; at the current version, so the reference is what refused it', async () => {
  const env = envWith({ t: CARD });
  const res = await fencedCall(env, 'pic', await versionOf(env));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.referenced, true);
  assert.equal(body.fence, 'if-version');
  assert.equal(typeof body.error, 'string');
  assert.equal(body.conflict, undefined, 'a reference refusal reported as a version conflict');
  assert.ok('pic' in await assetsOf(env));
});

test('fenced: no card, no asset → 404 carrying fence (so reef reads it as the Worker\'s answer, not "no such route")', async () => {
  const env = envWith({ t: CARD });
  const noCard = await fencedCall(env, 'unused', 'v1:0000000000000000', { handle: 'nobody' });
  assert.equal(noCard.status, 404);
  assert.equal((await noCard.json()).fence, 'if-version');
  const noAsset = await fencedCall(env, 'ghost', await versionOf(env));
  assert.equal(noAsset.status, 404);
  const body = await noAsset.json();
  assert.equal(body.fence, 'if-version');
  assert.match(body.error, /No asset "ghost"/);
});

test('fenced: nothing moved → 200 {handle, id, deleted, version, checked_version} — exactly those keys, and version is the card after', async () => {
  const { env, read } = await fencedFixture();
  const res = await fencedCall(env, 'unused', read);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['checked_version', 'deleted', 'handle', 'id', 'version']);
  assert.deepEqual({ handle: body.handle, id: body.id, deleted: body.deleted, checked_version: body.checked_version },
    { handle: 't', id: 'unused', deleted: true, checked_version: read });
  assert.equal(body.version, await versionOf(env));
  assert.notEqual(body.version, read);
  assert.equal('unused' in await assetsOf(env), false);
});

test('fenced: only DELETE is a fenced route — PUT there is 405 with fence, and writes nothing', async () => {
  const { env } = await fencedFixture();
  const before = await bodyOf(env);
  const res = await fencedCall(env, 'unused', await versionOf(env), { method: 'PUT' });
  assert.equal(res.status, 405);
  assert.equal((await res.json()).fence, 'if-version');
  assert.equal(await bodyOf(env), before);
});

test('🔴 CONTROL — the old route is unchanged: no If-Version needed, no fence in its answers, and it still deletes a card that moved', async () => {
  const { env, read } = await fencedFixture();
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/unused', { base64: AVATAR_NEW, mime: 'image/png' })).status, 200);
  assert.notEqual(await versionOf(env), read, 'CONTROL: the card moved');
  const res = await call(env, 'DELETE', '/_api/card/t/asset/unused');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['deleted', 'handle', 'id', 'version']);
  assert.equal('unused' in await assetsOf(env), false, 'the unfenced delete took the replacement — the race the fence exists for');
  const ghost = await (await call(env, 'DELETE', '/_api/card/t/asset/ghost')).json();
  assert.equal(ghost.fence, undefined);
  const ref = await (await call(env, 'DELETE', '/_api/card/t/asset/pic')).json();
  assert.deepEqual(Object.keys(ref).sort(), ['error', 'referenced']);
});

test('🔴 save_card\'s base_version is checked in the same queue: a save read before an in-flight put_asset is refused, and the picture survives', async () => {
  const env = envWith({ t: CARD });
  const read = await versionOf(env);
  const held = holdPut(env, (k) => k === cardKey('t', '0'));
  const putting = call(env, 'PUT', '/_api/card/t/asset/extra', { base64: AVATAR_NEW, mime: 'image/png' });
  await started(held, 'the put_asset');
  // admitted against the card as it was (the Worker's own check passes: the put has not landed)
  const saving = call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD).replace('hello', 'saved over'), base_version: read });
  await settle();
  held.release();
  assert.equal((await putting).status, 200);
  const res = await saving;
  assert.equal(res.status, 409, 'the save wrote a card assembled before the put landed');
  assert.equal((await res.json()).conflict, true);
  assert.equal((await assetsOf(env)).extra?.b64, AVATAR_NEW, 'the save erased the picture put while it was in flight');
});

test('🔴 two concurrent put_assets of different ids both survive (each reads the card the other wrote)', async () => {
  const env = envWith({ t: CARD });
  const held = holdPut(env, (k) => k === cardKey('t', '0'));
  const first = call(env, 'PUT', '/_api/card/t/asset/one', { base64: AVATAR_OLD, mime: 'image/png' });
  await started(held, 'the first put_asset');
  const second = call(env, 'PUT', '/_api/card/t/asset/two', { base64: AVATAR_NEW, mime: 'image/png' });
  await settle();
  held.release();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 200);
  const assets = await assetsOf(env);
  assert.equal(assets.one?.b64, AVATAR_OLD, 'the second put was computed from the card before the first landed');
  assert.equal(assets.two?.b64, AVATAR_NEW);
});

// ── r2: the fence's truth is the object's own storage, never a KV read (tile#209 r2, codex r1 P1) ──
//
// KV is eventually consistent, even at the location that wrote it. Serializing the writes in the
// object did not make its KV READ current: a stale body passed the If-Version check, and the fence
// acknowledged deleting the replacement it exists to protect. So the object keeps the card itself
// (chunked, per generation) and every queued write reads, checks and writes THAT first; KV is written
// through from it, for the pages. These tests make the KV read lag and nothing else.

/** every read of `key` answers `body` — the object's (and the Worker's) KV view is behind */
const lagKv = (env, key, body) => {
  const get = env.CARDS.get.bind(env.CARDS);
  env.CARDS.get = async (k) => (k === key ? body : get(k));
  return () => { env.CARDS.get = get; };
};
const keyT = () => cardKey('t', '0');

test('🔴 r2 a STALE KV read after a same-id replacement: the fenced delete → 409 naming the current version, and the NEW bytes survive', async () => {
  const { env, read } = await fencedFixture();
  const atRead = env.CARDS._m.get(keyT());
  const put = await (await call(env, 'PUT', '/_api/card/t/asset/unused', { base64: AVATAR_NEW, mime: 'image/png' })).json();
  assert.notEqual(put.version, read, 'CONTROL: the replacement moved the version');
  const restore = lagKv(env, keyT(), atRead);
  const res = await fencedCall(env, 'unused', read);
  const body = await res.json();
  restore();
  // the damage first: whatever the answer says, the replacement must still be stored
  assert.ok(env.CARDS._m.get(keyT()).includes(AVATAR_NEW), `the store lost the replacement (answered ${res.status} ${JSON.stringify(body)})`);
  assert.equal((await assetsOf(env)).unused?.b64, AVATAR_NEW);
  assert.equal(res.status, 409, `the fence passed on a stale body: ${JSON.stringify(body)}`);
  assert.equal(body.conflict, true);
  assert.equal(body.current, put.version, 'the conflict did not name the version the object holds');
  assert.equal(body.fence, 'if-version');
});

test('🔴 r2 CONTROL: fresh KV, If-Version = the current version → 200, removed', async () => {
  const { env } = await fencedFixture();
  const put = await (await call(env, 'PUT', '/_api/card/t/asset/unused', { base64: AVATAR_NEW, mime: 'image/png' })).json();
  const res = await fencedCall(env, 'unused', put.version);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).checked_version, put.version);
  assert.equal('unused' in await assetsOf(env), false);
});

test('🔴 r2 a stale KV read with the CURRENT If-Version: 200, and the removal is made from the object\'s card — a picture KV has not caught up on survives', async () => {
  const { env } = await fencedFixture();
  const before = env.CARDS._m.get(keyT());
  const put = await (await call(env, 'PUT', '/_api/card/t/asset/extra', { base64: AVATAR_NEW, mime: 'image/png' })).json();
  const restore = lagKv(env, keyT(), before); // KV has not seen `extra` yet
  const res = await fencedCall(env, 'unused', put.version);
  restore();
  assert.equal(res.status, 200, 'the fence compared against the stale KV body, not the object');
  const assets = await assetsOf(env);
  assert.equal('unused' in assets, false);
  assert.equal(assets.extra?.b64, AVATAR_NEW, 'the delete was computed from the stale body and erased `extra`');
});

test('🔴 r2 put_asset under a stale KV read keeps the picture KV has not caught up on', async () => {
  const env = envWith({ t: CARD });
  const before = (await liveCard(env.CARDS, 't')).md;
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/one', { base64: AVATAR_OLD, mime: 'image/png' })).status, 200);
  const restore = lagKv(env, keyT(), before);
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/two', { base64: AVATAR_NEW, mime: 'image/png' })).status, 200);
  restore();
  const assets = await assetsOf(env);
  assert.equal(assets.one?.b64, AVATAR_OLD, 'the second put was assembled on the stale body');
  assert.equal(assets.two?.b64, AVATAR_NEW);
});

test('🔴 r2 a save under a stale KV read re-attaches the OBJECT\'s assets lane — a picture put just before survives', async () => {
  const env = envWith({ t: CARD });
  const before = (await liveCard(env.CARDS, 't')).md;
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/extra', { base64: AVATAR_NEW, mime: 'image/png' })).status, 200);
  const restore = lagKv(env, keyT(), before);
  const res = await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD).replace('hello', 'edited') });
  restore();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.assets_carried, 3, 'the answer counted the stale lane');
  const md = await bodyOf(env);
  assert.ok(md.includes('edited'));
  assert.equal(parseCard(md).assets.extra?.b64, AVATAR_NEW, 'the save re-attached the stale KV lane and erased `extra`');
});

test('r2 migration: a handle the object has never written takes its card from KV ONCE; after that a KV body is not consulted', async () => {
  const env = envWith({ t: CARD });
  const life = env.CARD_LIFETIMES.storageOf('t')._m;
  assert.equal([...life.keys()].some((k) => k.startsWith('card:')), false, 'CONTROL: no record before the first write');
  const v = await versionOf(env);
  const res = await fencedCall(env, 'unused', v); // the first write: initialised from KV, at KV's version
  assert.equal(res.status, 200);
  assert.ok(life.has('card:0'), 'the object did not keep the card it wrote');
  const after = (await res.json()).version;
  // KV is now overwritten behind the object's back with the pre-delete body (a lagging or foreign write)
  env.CARDS._m.set(keyT(), CARD);
  const again = await fencedCall(env, 'unused', v);
  assert.equal(again.status, 409, 'the fence read KV again instead of the object');
  assert.equal((await again.json()).current, after);
});

test('🔴 r2 DELETE of the card leaves no copy of it in the object (nothing is kept)', async () => {
  const { env } = await fencedFixture();
  const life = env.CARD_LIFETIMES.storageOf('t')._m;
  assert.ok([...life.keys()].some((k) => k.startsWith('card:')), 'CONTROL: the object holds the card');
  assert.equal((await (await call(env, 'DELETE', '/_api/card/t')).json()).deleted, true);
  assert.deepEqual([...life.keys()].filter((k) => k.startsWith('card:')), [], 'the deleted card is still in the object');
});

test('r2 a card larger than one storage chunk is held in order: a write computed from the held card keeps a multi-chunk picture byte for byte', async () => {
  const { env } = await fencedFixture();
  // not uniform: a body joined out of order, or truncated at a chunk edge, must not compare equal
  let x = 0x9e3779b9;
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const big = Array.from({ length: 700 * 1024 }, () => { x = (x * 1103515245 + 12345) >>> 0; return ALPHA[x >>> 26]; }).join('');
  const before = env.CARDS._m.get(keyT());
  const put = await (await call(env, 'PUT', '/_api/card/t/asset/big', { base64: big, mime: 'image/png' })).json();
  const meta = env.CARD_LIFETIMES.storageOf('t')._m.get('card:0');
  assert.ok(meta.n >= 3, `CONTROL: the card spans ${meta.n} chunk(s), not several`);
  const restore = lagKv(env, keyT(), before); // KV has not seen `big`: only the held card has it
  const res = await fencedCall(env, 'unused', put.version);
  restore();
  assert.equal(res.status, 200);
  assert.equal((await assetsOf(env)).big?.b64, big, 'the held card did not come back byte for byte');
});

test('r2 a KV write-through that fails leaves the write done (the object holds it), pending; the alarm writes KV from the held card', async () => {
  const { env } = await fencedFixture();
  const put = env.CARDS.put.bind(env.CARDS);
  let failed = 0;
  env.CARDS.put = async (k, v, o) => { if (k === keyT() && !failed++) throw new Error('kv unavailable'); return put(k, v, o); };
  const res = await call(env, 'PUT', '/_api/card/t/asset/extra', { base64: AVATAR_NEW, mime: 'image/png' });
  assert.equal(res.status, 200, 'a write the object holds was reported as failed');
  const { version } = await res.json();
  assert.equal(failed, 1, 'CONTROL: the KV put did fail');
  assert.ok(!env.CARDS._m.get(keyT()).includes(AVATAR_NEW), 'CONTROL: KV does not have it yet');
  const life = env.CARD_LIFETIMES.storageOf('t');
  assert.equal(life._m.get('card:0').cache, 'pending');
  assert.ok(life._alarm, 'no retry was scheduled');
  // the fence answers from the held card, KV notwithstanding
  const del = await fencedCall(env, 'unused', version);
  assert.equal(del.status, 200);
  const after = (await del.json()).version;
  // …and once the alarm runs, KV is the held card
  life._m.get('card:0').cache = 'pending'; // as if the fenced write's own write-through had failed too
  env.CARDS._m.set(keyT(), 'stale');
  await env.CARD_LIFETIMES.alarm('t');
  assert.equal(await cardVersion(env.CARDS._m.get(keyT())), after, 'the alarm did not write the held card through');
  assert.equal(life._m.get('card:0').cache, 'written');
});

test('r2 the object refuses a save whose card is not the one the Worker checked, if what it would write links elsewhere than Web Risk saw', async () => {
  // Today a card's destinations come from its thin part alone, which the object does not change, so
  // this cannot be reached through the API; it is the guard that keeps Web Risk's answer true if a
  // renderer ever links from the assets lane. Sent straight to the object, as the Worker would.
  const env = envWith({ t: CARD });
  const lives = env.CARD_LIFETIMES;
  const save = (body) => lives.get(lives.idFromName('t')).fetch('https://card-lifetime.example/save', { method: 'POST',
    body: JSON.stringify({ handle: 't', gen: '0', markdown: thinCard(CARD), base: null, destBase: 'https://card.example/t/', ...body }) });
  const v = await versionOf(env);
  const moved = await save({ from: 'v1:0000000000000000', dests: ['https://elsewhere.example/'] });
  assert.equal(moved.status, 409);
  assert.match((await moved.json()).why, /links/);
  assert.equal(await versionOf(env), v, 'a refused save wrote');
  // CONTROL: the same card the Worker checked (`from` = the held version) is written whatever `dests` says
  const same = await save({ from: v, dests: ['https://elsewhere.example/'] });
  assert.equal(same.status, 200);
});
