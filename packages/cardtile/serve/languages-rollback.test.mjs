// tile#304 r3 — a rollback to the Worker in production before this PR, and forward again (review r2 #2)
//
// 🔴 The previous Worker (5d974ca1ed, no language support) rewrites the main record `card:<gen>` whole
// on every save, and puts the main KV key without metadata. So the live-language map does not live in
// that record: it has its own object key, `languages:<gen>`, which the older Worker never reads, lists
// or deletes (its only deletes are of `card:` keys). What it does drop — the KV metadata naming the
// files — this Worker puts back: the next time the handle's object is activated (any API call, any
// alarm) it sees that KV may not carry the map it last published, and republishes the main key with
// it. Until then visitors (who read KV only) get the main file for every language; an operator can
// force the republish per handle with `POST /_api/card/<handle>/lang`.
//
// The OLD Worker here is the real one: card-api.mjs as it was at 5d974ca1ed, read from git history
// (its imports pointed at this tree's modules). Without the history (a shallow clone) the tests skip,
// and say so.
//
// run: node --test packages/cardtile/serve/languages-rollback.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CardLifetime, HostBindings, _internal } from './card-api.mjs';
import { MAIN, GIF, call, withJapanese, visit, mainMetadata, langKeys, disagreements, quiet, kvFails } from './languages-harness.mjs';
import { thinCard } from '../card-save.mjs';

const OLD = '5d974ca1ed';
const here = dirname(fileURLToPath(import.meta.url));
let old = null, why = null, scratch = null;
try {
  const src = execFileSync('git', ['show', `${OLD}:packages/cardtile/serve/card-api.mjs`], {
    cwd: here, encoding: 'utf8', timeout: 15000, maxBuffer: 16 << 20, stdio: ['ignore', 'pipe', 'pipe'],
  });
  scratch = mkdtempSync(join(tmpdir(), `card-api-${OLD}-`));
  const at = (rel) => pathToFileURL(join(here, rel)).href;
  const pointed = src.replace(/from '(\.\.?\/[^']+)'/g, (_, rel) => `from '${at(rel)}'`);
  writeFileSync(join(scratch, 'card-api.mjs'), pointed);
  old = await import(pathToFileURL(join(scratch, 'card-api.mjs')).href);
} catch (e) {
  why = `the previous Worker's card-api.mjs is not readable from git history here (${String(e && e.message).split('\n')[0]})`;
}
test.after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });
const needsOld = old ? {} : { skip: why };

const TOKEN = 'super-secret-bearer';
/** one call to the OLD Worker's API (the same bearer) */
async function oldCall(env, method, path, body) {
  const url = new URL(`https://card.feelreef.com${path}`);
  const res = await old.handleApi(new Request(url, {
    method, headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, url);
  return { status: res.status, text: await res.text() };
}
const deployOld = (env) => { env.CARD_LIFETIMES.deploy(old.CardLifetime); env.HOST_BINDINGS.deploy(old.HostBindings); };
const deployNew = (env) => { env.CARD_LIFETIMES.deploy(CardLifetime); env.HOST_BINDINGS.deploy(HostBindings); };
const SAVED_BY_OLD = MAIN.replace('Illustrator.', 'Illustrator, saved by the previous Worker.');

/** a Card with a live Japanese file, then the previous Worker deployed and an ordinary save of its main file */
async function rolledBackAndSaved() {
  const env = await withJapanese();
  assert.equal(env.MCP_TOKEN_HASH, await _internal.sha256Hex(TOKEN));
  const before = {
    file: (await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.markdown,
    rev: (await mainMetadata(env)).languages['ja-JP'],
    body: env.CARDS._m.get(langKeys(env)[0]),
    page: await visit(env, '/t?lang=ja-JP'),
  };
  assert.match(before.page.body, /イラストレーター/);
  await quiet(env); // the setup's own alarms fire now: what is armed later, the activation armed
  deployOld(env);
  const s = await oldCall(env, 'PUT', '/_api/card/t', { markdown: thinCard(SAVED_BY_OLD) });
  assert.equal(s.status, 200, s.text);
  return { env, before };
}

test('🔴 review r2 #2 — the previous Worker\'s ordinary main save, then this Worker again: the language file is served again, byte for byte', needsOld, async () => {
  const { env, before } = await rolledBackAndSaved();
  const storage = env.CARD_LIFETIMES.storageOf('t');
  // what the previous Worker did: KV lost the metadata naming the file; the map in its own key did not
  assert.equal(await mainMetadata(env), null, 'the old put carries no metadata');
  assert.deepEqual(storage._m.get('languages:0').languages, { 'ja-JP': before.rev }, 'the old Worker left the map alone');
  assert.equal(env.CARDS._m.get(langKeys(env)[0]), before.body, 'and the file\'s body');
  assert.doesNotMatch((await visit(env, '/t?lang=ja-JP')).body, /イラストレーター/, 'while it is deployed, visitors get the main file');

  deployNew(env);
  // 🔴 documented: until the object is activated, visitors (KV only) still get the main file
  assert.doesNotMatch((await visit(env, '/t?lang=ja-JP')).body, /イラストレーター/);
  assert.equal(storage._alarm, null, 'nothing is armed before the activation');
  // any API call activates it; it arms the alarm that republishes (and answers as before)
  assert.equal((await call(env, 'GET', '/_api/card/t/lifetime')).status, 200);
  assert.equal(await env.CARD_LIFETIMES.tick('t'), true);
  assert.deepEqual((await mainMetadata(env)).languages, { 'ja-JP': before.rev }, 'the same file, named again');
  assert.equal(env.CARDS._m.get(`card:t:0:ja-JP:${before.rev}`), before.body, 'byte for byte the body that was served before');
  const page = await visit(env, '/t?lang=ja-JP');
  assert.equal(page.headers.get('content-language'), 'ja-JP');
  assert.match(page.body, /イラストレーター/);
  assert.match((await visit(env, '/t')).body, /saved by the previous Worker/, 'the old Worker\'s save stands');
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.markdown, before.file, 'the API file, byte for byte');
  assert.deepEqual(await disagreements(env), []);
});

test('🔴 the republish an operator can force: POST /_api/card/<handle>/lang — authenticated, idempotent, at once', needsOld, async () => {
  const { env, before } = await rolledBackAndSaved();
  deployNew(env);
  const anon = await call(env, 'POST', '/_api/card/t/lang', undefined, { authorization: '' });
  assert.equal(anon.status, 401);
  for (let i = 0; i < 2; i++) {
    const r = await call(env, 'POST', '/_api/card/t/lang');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { handle: 't', republished: true, languages: ['ja-JP'] });
    assert.deepEqual((await mainMetadata(env)).languages, { 'ja-JP': before.rev }, `call ${i + 1}`);
    assert.match((await visit(env, '/t?lang=ja-JP')).body, /イラストレーター/, `call ${i + 1}: served at once, no alarm needed`);
  }
  assert.equal((await call(env, 'POST', '/_api/card/nobody/lang')).json.error, 'cards_language_no_card');
  // CONTROL: the other methods on that path are what they were (no such endpoint)
  assert.equal((await call(env, 'GET', '/_api/card/t/lang')).status, 404);
});

test('the previous Worker\'s DELETE of the Card: its own sweep, then this Worker leaves no language state of the ended lifetime', needsOld, async () => {
  const { env } = await rolledBackAndSaved();
  const storage = env.CARD_LIFETIMES.storageOf('t');
  const d = await oldCall(env, 'DELETE', '/_api/card/t');
  assert.equal(d.status, 200, d.text);
  assert.deepEqual(langKeys(env), [], 'its listing of card:t: took the language bodies');
  assert.deepEqual([...storage._m.keys()].filter((k) => k.startsWith('card:')), [], 'and its sweep the language slots');
  assert.ok(storage._m.has('languages:0'), 'the map key it does not know is left (it names nothing that exists)');
  deployNew(env);
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(MAIN), create: true })).status, 200);
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  assert.deepEqual([...storage._m.keys()].filter((k) => k.startsWith('languages:')), [], 'this Worker\'s end takes every ended lifetime\'s map');
});

test('a Card with no language file: the previous Worker\'s save and this Worker again change nothing (no map key is ever made)', needsOld, async () => {
  const env = (await import('./languages-harness.mjs')).envWith();
  assert.equal((await call(env, 'PUT', '/_api/card/t', { markdown: thinCard(MAIN), create: true })).status, 200);
  deployOld(env);
  assert.equal((await oldCall(env, 'PUT', '/_api/card/t', { markdown: thinCard(SAVED_BY_OLD) })).status, 200);
  deployNew(env);
  assert.equal((await call(env, 'GET', '/_api/card/t/lifetime')).status, 200);
  await env.CARD_LIFETIMES.tick('t');
  const storage = env.CARD_LIFETIMES.storageOf('t');
  assert.deepEqual([...storage._m.keys()].filter((k) => !k.startsWith('card:') && k !== 'life'), []);
  assert.equal(await mainMetadata(env), null);
  assert.ok(env.CARDS.puts.filter(([k]) => k === 'card:t:0').every(([, opts]) => opts === false), 'every main put without options');
});

// ── tile#304 r4 (closing review P1): the previous Worker can take the metadata off KV's main key
// WITHOUT changing the record's serial (its alarm, paying a write this Worker left pending), so the
// object's `published` marker still matches. The rule: a (re)activated object reads the main key's
// metadata once when its language map names any file, and any difference is owed work.

/** a Card with a live Japanese file whose republish is left pending (KV refused the main key's put) */
async function pendingRepublish() {
  const env = await withJapanese();
  await quiet(env);
  const storage = env.CARD_LIFETIMES.storageOf('t');
  const rev = (await mainMetadata(env)).languages['ja-JP'];
  const fail = kvFails(env, 'put', /^card:t:0$/);
  const r = await call(env, 'POST', '/_api/card/t/lang');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.cache, 'pending');
  assert.equal(storage._m.get('card:0').cache, 'pending');
  assert.deepEqual((await mainMetadata(env)).languages, { 'ja-JP': rev }, 'KV still names the file');
  fail.heal();
  return { env, storage, rev };
}
/** this Worker again, one API call (the activation), its alarms: the Japanese file is served again */
async function forwardServesJapanese(env, rev, what) {
  deployNew(env);
  assert.equal((await call(env, 'GET', '/_api/card/t/lifetime')).status, 200);
  await quiet(env);
  assert.deepEqual(await mainMetadata(env), { languages: { 'ja-JP': rev } }, `${what}: KV names the file again`);
  const page = await visit(env, '/t?lang=ja-JP');
  assert.equal(page.headers.get('content-language'), 'ja-JP', `${what}: Japanese is served`);
  assert.match(page.body, /イラストレーター/);
  assert.deepEqual(await disagreements(env), [], what);
}

test('🔴 closing review P1 — a pending republish, the previous Worker\'s alarm writes the same serial without metadata, this Worker again: Japanese is served again', needsOld, async () => {
  const { env, storage, rev } = await pendingRepublish();
  const serial = storage._m.get('card:0').serial;
  deployOld(env);
  assert.equal(await env.CARD_LIFETIMES.tick('t'), true, 'the alarm this Worker armed fires in the previous Worker');
  assert.equal(await mainMetadata(env), null, 'its put carries no metadata');
  assert.equal(storage._m.get('card:0').serial, serial, 'and the record keeps its serial');
  assert.equal(storage._m.get('card:0').cache, 'written');
  assert.deepEqual(storage._m.get('languages:0').published, { serial, languages: { 'ja-JP': rev } }, 'the marker still says KV holds the map');
  assert.notEqual((await visit(env, '/t?lang=ja-JP')).headers.get('content-language'), 'ja-JP');
  await forwardServesJapanese(env, rev, 'after the old alarm');
});

test('the same, when this Worker\'s first activation is an alarm (one left armed), not an API call: that alarm puts the map back', needsOld, async () => {
  const { env, storage, rev } = await pendingRepublish();
  deployOld(env);
  assert.equal(await env.CARD_LIFETIMES.tick('t'), true);
  assert.equal(await mainMetadata(env), null);
  deployNew(env);
  storage._alarm = Date.now(); // an alarm armed for anything else, due now
  let at = env.CARDS.reads.length;
  assert.equal(await env.CARD_LIFETIMES.tick('t'), true);
  assert.deepEqual(env.CARDS.reads.slice(at), ['card:t:0'], 'one read of the main key');
  assert.deepEqual(await mainMetadata(env), { languages: { 'ja-JP': rev } }, 'put back by that alarm itself');
  at = env.CARDS.reads.length;
  assert.equal((await call(env, 'GET', '/_api/card/t/lifetime')).status, 200);
  assert.deepEqual(env.CARDS.reads.slice(at), [], 'the API call that follows, in the same instance, reads it no more');
  await quiet(env);
  assert.equal((await visit(env, '/t?lang=ja-JP')).headers.get('content-language'), 'ja-JP');
  assert.deepEqual(await disagreements(env), []);
});

test('🔴 the same, with the previous Worker\'s ordinary main save instead of its alarm', needsOld, async () => {
  const { env, rev } = await pendingRepublish();
  deployOld(env);
  assert.equal((await oldCall(env, 'PUT', '/_api/card/t', { markdown: thinCard(SAVED_BY_OLD) })).status, 200);
  assert.equal(await mainMetadata(env), null);
  await forwardServesJapanese(env, rev, 'after the old save');
  assert.match((await visit(env, '/t')).body, /saved by the previous Worker/);
});

test('negative control — no rollback: a fresh activation reads the main key once, writes nothing and arms nothing', async () => {
  const env = await withJapanese();
  await quiet(env);
  const storage = env.CARD_LIFETIMES.storageOf('t');
  const before = { kv: [...env.CARDS._m.entries()], meta: [...env.CARDS._meta.entries()], storage: JSON.stringify([...storage._m.entries()]) };
  const puts = env.CARDS.puts.length;
  env.CARD_LIFETIMES.restart('t');
  const at = env.CARDS.reads.length;
  assert.equal((await call(env, 'GET', '/_api/card/t/lifetime')).status, 200);
  const fresh = env.CARDS.reads.slice(at);
  const at2 = env.CARDS.reads.length;
  assert.equal((await call(env, 'GET', '/_api/card/t/lifetime')).status, 200);
  const warm = env.CARDS.reads.slice(at2);
  assert.deepEqual(fresh, ['card:t:0', ...warm], 'the activation adds exactly one read, of the main key, before the answer\'s own');
  assert.equal(env.CARDS.puts.length, puts, 'no KV put');
  assert.deepEqual([...env.CARDS._m.entries()], before.kv);
  assert.deepEqual([...env.CARDS._meta.entries()], before.meta);
  assert.equal(JSON.stringify([...storage._m.entries()]), before.storage, 'no storage write');
  assert.equal(storage._alarm, null, 'no alarm');
});

// r5 (closing check P2, port of closing-wake-short-circuit.mjs): the check runs on activation even
// when the lifetime (`life`) or the main record (`card:0`) is pending, before the object answers.
for (const pending of ['life', 'card:0']) {
  test(`🔴 closing check P2 — KV lost the map and \`${pending}\` is pending: the first answered request has read the main key and cleared \`published\``, async () => {
    const env = await withJapanese();
    await quiet(env);
    const storage = env.CARD_LIFETIMES.storageOf('t');
    const rev = (await mainMetadata(env)).languages['ja-JP'];
    await env.CARDS.put('card:t:0', env.CARDS._m.get('card:t:0')); // an older worker's put: no metadata
    assert.equal(await mainMetadata(env), null);
    assert.ok(storage._m.get('languages:0').published, 'the marker still says KV holds the map');
    // (this Card has no `life` record yet; a pending one is a whole lifetime, as read() makes it, so
    // the alarm's card-level flushes see the same generation — a bare `{ cache }` would stop them)
    const was = storage._m.get(pending) || { gen: '0', hosts: [], pending: {}, handle: 't' };
    storage._m.set(pending, { ...was, cache: 'pending' });
    env.CARD_LIFETIMES.restart('t');
    const at = env.CARDS.reads.length;
    assert.equal((await call(env, 'GET', '/_api/card/t/lifetime')).status, 200);
    assert.ok(env.CARDS.reads.slice(at).includes('card:t:0'), 'the activation read the main key');
    assert.equal(storage._m.get('languages:0').published, null, '`published` is cleared');
    assert.notEqual(storage._alarm, null, 'an alarm is armed');
    await quiet(env);
    assert.deepEqual(await mainMetadata(env), { languages: { 'ja-JP': rev } }, 'KV names the file again');
    assert.equal((await visit(env, '/t?lang=ja-JP')).headers.get('content-language'), 'ja-JP');
    assert.deepEqual(await disagreements(env), []);
  });
}

// the other transitions the previous Worker can make on a Card with a language file, each followed by
// this Worker again (settle/adopt has no test: a record adopted or unknown never coexists with a map
// that names a file, so the previous Worker's settleCard returns at its first line — see the r4 report)
for (const [name, act] of [
  ['stop, then resume', async (env) => {
    assert.equal((await oldCall(env, 'PUT', '/_api/card/t/stop', { reason: 'r4' })).status, 200);
    assert.equal((await oldCall(env, 'DELETE', '/_api/card/t/stop')).status, 200);
  }],
  ['put_asset', async (env) => {
    assert.equal((await oldCall(env, 'PUT', '/_api/card/t/asset/x2', { base64: GIF, mime: 'image/gif' })).status, 200);
  }],
  ['put_asset, then delete_asset', async (env) => {
    assert.equal((await oldCall(env, 'PUT', '/_api/card/t/asset/x2', { base64: GIF, mime: 'image/gif' })).status, 200);
    const d = await oldCall(env, 'DELETE', '/_api/card/t/asset/x2');
    assert.equal(d.status, 200, d.text);
  }],
]) {
  test(`the previous Worker's ${name} on a Card with a language file, then this Worker again: KV names the map`, needsOld, async () => {
    const env = await withJapanese();
    await quiet(env);
    const rev = (await mainMetadata(env)).languages['ja-JP'];
    deployOld(env);
    await act(env);
    await quiet(env);
    await forwardServesJapanese(env, rev, name);
  });
}
