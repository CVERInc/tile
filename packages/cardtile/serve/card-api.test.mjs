// The Card write API.  run: node --test card-api.test.mjs
//
// 🔴 Every gate here is asserted BOTH ways. A test that only shows the happy path proves a route
// exists; it does not prove the guard on it has ever fired — 「從沒看過它失敗的檢查」. So each refusal
// is paired with the same call made legitimately, and each acceptance with the version that must be
// refused. Where the pairing is not obvious the comment says which half is the control.
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi, previewKey, PREVIEW_TTL, _internal } from './card-api.mjs';
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
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v, opts) { m.set(k, v); if (opts?.expirationTtl) this._ttl.set(k, opts.expirationTtl); },
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

// ── save_card ────────────────────────────────────────────────────────────────────────────────────

test('🔴 a save sent WITHOUT assets keeps the pictures — this is the whole thin-card bargain', async () => {
  // The failure this prevents: an agent does the obvious thing (get_card → edit → save_card) and
  // blanks every image on someone's live page, because the card it sent honestly had no assets lane.
  const env = envWith({ t: CARD });
  const thin = thinCard(CARD).replace('hello', 'hello there');
  const res = await call(env, 'PUT', '/_api/card/t', { markdown: thin });
  assert.equal(res.status, 200);
  const stored = await env.CARDS.get('t');
  assert.ok(stored.includes(GIF), 'the assets were dropped');
  assert.equal(Object.keys(parseCard(stored).assets).length, 2);
  assert.ok(stored.includes('hello there'), 'the edit did not land');
});

test('CONTROL: the same round trip with NO edit is byte-identical to what was stored', async () => {
  // If this drifts, every "the edit landed" assertion above is measuring serialization noise.
  const env = envWith({ t: CARD });
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) });
  assert.equal(await env.CARDS.get('t'), CARD);
});

test('🔴 a NON-canonical card is normalised ONCE and then stops moving', async () => {
  // The property that matters is convergence, not identity: a save must not be a file that grows a
  // blank line every time somebody edits it. HAND_TYPED is the specimen — asserted to actually
  // differ, so this measures normalisation rather than a no-op.
  assert.notEqual(HAND_TYPED, CARD, 'the fixture is already canonical — this test proves nothing');
  const env = envWith({ t: HAND_TYPED });
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(HAND_TYPED) });
  const first = await env.CARDS.get('t');
  assert.notEqual(first, HAND_TYPED, 'nothing was normalised');
  await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(first) });
  assert.equal(await env.CARDS.get('t'), first, 'the card is still drifting on the second save');
});

test('🔴 orphans are REPORTED, and the bytes are still there afterwards', async () => {
  const env = envWith({ t: CARD });
  const body = await (await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD) })).json();
  assert.deepEqual(body.orphans, ['unused']);
  assert.equal(body.assets_carried, 2);
  // the report is not a deletion
  assert.ok((await env.CARDS.get('t')).includes('id=unused'), 'reporting an orphan collected it');
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
  assert.equal(await env.CARDS.get('t'), CARD, 'a refused save wrote anyway');
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
  assert.equal(await env.CARDS.get('t'), CARD, 'dry_run wrote');
  // CONTROL: an unchanged dry_run reports wouldChange:false — so the flag tracks the content.
  const same = await (await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(CARD), dry_run: true })).json();
  assert.equal(same.wouldChange, false);
});

test('an empty markdown is refused — a save is never how a card gets deleted', async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: '' })).status, 400);
  assert.equal((await call(env, 'PUT', '/_api/card/t', {})).status, 400);
  assert.equal(await env.CARDS.get('t'), CARD);
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
  assert.equal(Object.keys(parseCard(await env.CARDS.get('t')).assets).length, 3);
});

test('put_asset refuses input that is not base64, and a bad id', async () => {
  const env = envWith({ t: CARD });
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/two', { base64: 'not base64!!' })).status, 400);
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/' + encodeURIComponent('a/b'), { base64: GIF })).status, 400);
  assert.equal(Object.keys(parseCard(await env.CARDS.get('t')).assets).length, 2, 'a refused put wrote anyway');
  // CONTROL: valid base64 under a valid id lands.
  assert.equal((await call(env, 'PUT', '/_api/card/t/asset/two', { base64: GIF })).status, 200);
});

test('🔴 delete_asset REFUSES while the card still points at it', async () => {
  const env = envWith({ t: CARD });
  const res = await call(env, 'DELETE', '/_api/card/t/asset/pic');
  assert.equal(res.status, 409);
  assert.equal((await res.json()).referenced, true);
  assert.ok((await env.CARDS.get('t')).includes('id=pic'));
  // CONTROL: the UNreferenced one deletes. So the 409 is about the reference, not about DELETE.
  const gone = await call(env, 'DELETE', '/_api/card/t/asset/unused');
  assert.equal(gone.status, 200);
  assert.equal(Object.keys(parseCard(await env.CARDS.get('t')).assets).length, 1);
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
  assert.equal(await env.CARDS.get('t'), CARD);
});

test('an unknown endpoint under /_api/ is a 404 WITH a token — not a silent pass to the renderer', async () => {
  assert.equal((await call(envWith({}), 'GET', '/_api/whatever')).status, 404);
  assert.equal((await call(envWith({ t: CARD }), 'POST', '/_api/card/t')).status, 405);
});

// ── the pure half ────────────────────────────────────────────────────────────────────────────────

test('referencedAssets over-counts rather than under-counts, on purpose', () => {
  assert.deepEqual([...referencedAssets('avatar="asset:a" and prose mentioning asset:b')], ['a', 'b']);
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
