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
import { MAIN, JA, call, withJapanese, visit, mainMetadata, langKeys, disagreements } from './languages-harness.mjs';
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
