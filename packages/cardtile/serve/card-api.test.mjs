// The Card write API.  run: node --test card-api.test.mjs
//
// 🔴 Every gate here is asserted BOTH ways. A test that only shows the happy path proves a route
// exists; it does not prove the guard on it has ever fired — 「從沒看過它失敗的檢查」. So each refusal
// is paired with the same call made legitimately, and each acceptance with the version that must be
// refused. Where the pairing is not obvious the comment says which half is the control.
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi, previewKey, goneKey, liveCard, cardKey, stopKey, genKey, PREVIEW_TTL, _internal } from './card-api.mjs';
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

const envWith = (seed) => ({ CARDS: fakeKv(seed), MCP_TOKEN_HASH: TOKEN_HASH });
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
  assert.equal(env.CARDS._m.has('vanity:me.example'), false);
  assert.equal(env.CARDS._m.has('vanityof:t'), false);
  assert.equal(env.CARDS._m.get('vanity:else.example'), 'other');
  assert.equal(env.CARDS._m.get('vanityof:other'), 'else.example');
  // a reused handle is served at its own address, not 301'd to the previous owner's domain
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) });
  assert.equal((await page(env, '/t')).status, 200);
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
  // a marker here would make the public page claim a card that never was
  assert.deepEqual([...env.CARDS._m.keys()], ['other']);
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

test('a DELETE that reads nothing but a gone marker still starts a new generation', async () => {
  // The listing can lag too. A marker is evidence enough that a lifetime ended here and a later one may
  // be live where these reads cannot see; a fresh generation costs one small put.
  const env = await reborn();
  const before = env.CARDS._m.get(genKey('t'));
  env.CARDS._m.set(goneKey('t'), JSON.stringify({ deleted_at: new Date().toISOString() }));
  const blind = { ...env, CARDS: { ...env.CARDS,
    get: async (k) => (k === goneKey('t') ? env.CARDS._m.get(k) : null),
    list: async () => ({ keys: [], list_complete: true }) } };
  await call(blind, 'DELETE', '/_api/card/t');
  assert.notEqual(env.CARDS._m.get(genKey('t')), before);
  assert.equal((await page(env, '/t')).status, 410);
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
