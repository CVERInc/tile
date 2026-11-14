// tile#304 r2 — which language file a visitor may be served, under every interleaving of writes
//
// 🔴 What a visitor can be served is decided by the main file's own KV record, written in the same put
// as the main body: its metadata `{ languages: { <tag>: <rev> } }` names each LIVE language file, and
// the Worker reads exactly `card:<handle>:<gen>:<tag>:<rev>` for a tag the record names — nothing else.
// A rev key is written once and never rewritten, so a body under an old rev is unreachable as soon as a
// main record that no longer names it lands, whether or not its deletion has settled. A named key that
// is missing is the main file. The API reads a language file through the handle's object (the
// authority), never from KV.
//
// Each test is one row of the interleaving table (LANE-t304-r2-report.md), driven with a KV double
// whose individual writes and deletes can be made to fail or to wait (languages-harness.mjs).
//
// run: node --test packages/cardtile/serve/languages-interleave.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCard } from './card-api.mjs';
import {
  MAIN, JA, call, save, saveLang, visit, htmlLang, langKeys, withMain, withJapanese,
  kvFails, kvHolds, storageHolds, within, settled, mainKey, mainMetadata,
} from './languages-harness.mjs';

const NO_JA = MAIN.replace('locales: [en-US, ja-JP, zh-TW]', 'locales: [en-US, zh-TW]');
const NO_ZH = MAIN.replace('locales: [en-US, ja-JP, zh-TW]', 'locales: [en-US, ja-JP]');
const ZH = JA.replace('lang: ja-JP', 'lang: zh-TW').replace('イラストレーター。', '插畫家。');
const JA2 = JA.replace('イラストレーター。', '新しい日本語。');
/** what a visitor asking for `tag` gets, on every exit that chooses a language */
async function servedFor(env, tag) {
  const out = [];
  for (const [path, headers] of [[`/t?lang=${tag}`, {}], ['/t', { 'accept-language': tag }], [`/t.md?lang=${tag}`, {}], [`/t?lang=${tag}`, { accept: 'text/markdown' }]]) {
    const v = await visit(env, path, headers);
    assert.equal(v.status, 200, path);
    out.push(v);
  }
  return out;
}
const objectKeys = (env) => [...env.CARD_LIFETIMES.storageOf('t')._m.keys()];

// ── the record ───────────────────────────────────────────────────────────────────────────────────

test('the main record names each live language file, in the same KV put as the main body', async () => {
  const env = await withJapanese();
  const meta = await mainMetadata(env);
  assert.deepEqual(Object.keys(meta.languages), ['ja-JP']);
  const rev = meta.languages['ja-JP'];
  assert.match(rev, /^[0-9a-f]{12}$/);
  const { gen } = await liveCard(env.CARDS, 't');
  assert.deepEqual(langKeys(env), [`card:t:${gen}:ja-JP:${rev}`], 'one versioned key, the one the record names');
  assert.match(env.CARDS._m.get(`card:t:${gen}:ja-JP:${rev}`), /イラストレーター/);
  // a second write of the file is a new rev: a new key, and the record moves to it
  assert.equal((await saveLang(env, 'ja-JP', JA2)).status, 200);
  const next = (await mainMetadata(env)).languages['ja-JP'];
  assert.notEqual(next, rev);
  assert.deepEqual(langKeys(env), [`card:t:${gen}:ja-JP:${next}`], 'the superseded key is gone once the record moved');
  // 🔴 CONTROL: a Card with no language file (and one with no `locales:`) has no metadata on its main key
  const plain = await withMain({}, MAIN.replace(/^locales:.*\n/m, ''));
  assert.equal(await mainMetadata(plain), null);
  assert.ok(plain.CARDS.puts.filter(([k]) => k === 'card:t:0').every(([, opts]) => opts === false), 'its main key is put exactly as before: no options argument');
  assert.equal(await mainMetadata(await withMain()), null, 'listed languages and no file: no metadata either');
});

test('🔴 KV metadata stays under its 1024-byte ceiling at the most a Card can hold', async () => {
  // the longest tags there are (35 characters, MAX_LOCALES - 1 language files)
  const tags = Array.from({ length: 12 }, (_, i) => `x${String.fromCharCode(97 + i)}a-bbbbbbbb-cccccccc-dddddddd-eeee`);
  assert.ok(tags.every((t) => t.length === 35));
  const main = MAIN.replace('locales: [en-US, ja-JP, zh-TW]', `locales: [${tags.join(', ')}]`).replace('lang: en-US', `lang: ${tags[0]}`);
  const env = await withMain({}, main);
  for (const t of tags.slice(1)) {
    const r = await saveLang(env, t, JA.replace('lang: ja-JP', `lang: ${t}`));
    assert.equal(r.status, 200, `${t}: ${JSON.stringify(r.json)}`);
  }
  const meta = await mainMetadata(env);
  assert.equal(Object.keys(meta.languages).length, 11);
  // every rev is 12 hex digits, so this is the most the metadata can ever be
  const bytes = Buffer.byteLength(JSON.stringify(meta));
  assert.ok(bytes <= 1024, `${bytes} bytes`);
});

// ── row 1: the reviewer's case ───────────────────────────────────────────────────────────────────

test('🔴 row 1 — removed, then re-added before its KV deletion settled: no old words, on any door', async () => {
  const env = await withJapanese();
  const { gen } = await liveCard(env.CARDS, 't');
  const del = kvFails(env, 'delete', /^card:t:[^:]+:ja-JP/);
  const drop = await save(env, NO_JA);
  assert.equal(drop.status, 200);
  assert.deepEqual(drop.json.languages_removed, ['ja-JP']);
  assert.ok(del.hits.length >= 1, 'the deletion of the old Japanese key was attempted, and failed');
  const readd = await save(env, MAIN.replace('Illustrator.', 'NEW MAIN OWNER WORDS'));
  assert.equal(readd.status, 200);
  assert.equal(readd.json.languages_removed, undefined);
  assert.ok(langKeys(env).some((k) => k.startsWith(`card:t:${gen}:ja-JP`)), 'the old body is still in KV: it is unreachable, not deleted');
  // the API asks the object, which holds no Japanese file
  const api = await call(env, 'GET', '/_api/card/t/lang/ja-JP');
  assert.equal(api.status, 404);
  assert.equal(api.json.error, 'cards_language_missing');
  assert.equal((await call(env, 'GET', '/_api/card/t')).json.languages['ja-JP'], null);
  // every door a visitor uses: the new main words, never the removed Japanese file
  for (const v of await servedFor(env, 'ja-JP')) {
    assert.doesNotMatch(v.body, /イラストレーター/);
    assert.match(v.body, /NEW MAIN OWNER WORDS/);
  }
  assert.equal(htmlLang((await visit(env, '/t?lang=ja-JP')).body), 'en-US');
  assert.deepEqual(objectKeys(env).filter((k) => k.includes('@ja-JP')), [], 'the object holds none of it');
  // the alarm settles the deletion; a NEW Japanese file is a new rev, and is what is served
  del.heal();
  await env.CARD_LIFETIMES.alarm('t');
  assert.deepEqual(langKeys(env).filter((k) => k.includes(':ja-JP')), []);
  assert.equal((await saveLang(env, 'ja-JP', JA2)).status, 200);
  const v = await visit(env, '/t?lang=ja-JP');
  assert.match(v.body, /新しい日本語/);
  assert.doesNotMatch(v.body, /イラストレーター/);
});

test('row 1b — a language DELETE whose KV deletion fails: the file is gone for visitors and the API at once', async () => {
  const env = await withJapanese();
  const del = kvFails(env, 'delete', /^card:t:[^:]+:ja-JP/);
  const r = await call(env, 'DELETE', '/_api/card/t/lang/ja-JP');
  assert.equal(r.status, 200);
  assert.ok(del.hits.length >= 1);
  for (const v of await servedFor(env, 'ja-JP')) assert.doesNotMatch(v.body, /イラストレーター/);
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.error, 'cards_language_missing');
  del.heal();
  await env.CARD_LIFETIMES.alarm('t');
  assert.deepEqual(langKeys(env), []);
});

// ── row 2: a language PUT against a main save that removes its tag ───────────────────────────────

test('row 2a — PUT first, the removing save waits for it, then removes it', async () => {
  const env = await withJapanese();
  const held = kvHolds(env, 'put', /^card:t:[^:]+:zh-TW/);
  const put = saveLang(env, 'zh-TW', ZH);
  await within(held.reached, 'the zh-TW body put');
  const drop = save(env, NO_ZH);
  assert.equal(await settled(drop), false, 'the save waits for the language write');
  held.release();
  assert.equal((await put).status, 200);
  const dropped = await drop;
  assert.equal(dropped.status, 200);
  assert.deepEqual(dropped.json.languages_removed, ['zh-TW']);
  assert.deepEqual(Object.keys((await mainMetadata(env)).languages), ['ja-JP']);
  assert.deepEqual(langKeys(env).filter((k) => k.includes(':zh-TW')), []);
  for (const v of await servedFor(env, 'zh-TW')) assert.doesNotMatch(v.body, /插畫家/);
});

test('row 2b — the removing save first: a PUT admitted before it is refused by the object', async () => {
  const env = await withJapanese();
  const life = env.CARD_LIFETIMES.get({ name: 't' });
  const ask = async (body) => { const r = await life.fetch('https://card-lifetime.example/language', { method: 'POST', body: JSON.stringify({ handle: 't', ...body }) }); return { status: r.status, json: await r.json() }; };
  const { gen } = await liveCard(env.CARDS, 't');
  // the Worker's admission check passes (the tag is listed) …
  assert.equal((await ask({ gen, tag: 'zh-TW', kind: 'put', markdown: ZH, check: true })).status, 200);
  // … a save removes the tag (its main put held, so the PUT queues behind it) …
  const held = kvHolds(env, 'put', /^card:t:[^:]+$/);
  const drop = save(env, NO_ZH);
  await within(held.reached, 'the main put');
  const put = ask({ gen, tag: 'zh-TW', kind: 'put', markdown: ZH });
  assert.equal(await settled(put), false);
  held.release();
  assert.equal((await drop).status, 200);
  // … and the write itself is refused
  const r = await put;
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'cards_language_not_listed');
  assert.deepEqual(langKeys(env).filter((k) => k.includes(':zh-TW')), []);
  assert.deepEqual(Object.keys((await mainMetadata(env)).languages), ['ja-JP']);
});

// ── row 3: the body and the record, one of the two puts failing ──────────────────────────────────

test('🔴 row 3a — the body lands, the record does not: visitors keep the previous pair, whole', async () => {
  const env = await withJapanese();
  const failMain = kvFails(env, 'put', /^card:t:[^:]+$/);
  const r = await saveLang(env, 'ja-JP', JA2);
  assert.equal(r.status, 200);
  assert.equal(r.json.cache, 'pending');
  assert.ok(failMain.hits.length >= 1);
  // the record still names the previous rev, whose body is still there: the previous file is served,
  // never the new body under the previous record
  const v = await visit(env, '/t?lang=ja-JP');
  assert.match(v.body, /イラストレーター/);
  assert.doesNotMatch(v.body, /新しい日本語/);
  // the API answers from the object: the file it holds
  assert.match((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.markdown, /新しい日本語/);
  failMain.heal();
  await env.CARD_LIFETIMES.alarm('t');
  assert.match((await visit(env, '/t?lang=ja-JP')).body, /新しい日本語/);
  assert.equal(langKeys(env).length, 1, 'the superseded key went once the record moved');
});

test('🔴 row 3b — the record lands, the body does not: that language is the main file until the body lands', async () => {
  const env = await withJapanese();
  const failBody = kvFails(env, 'put', /^card:t:[^:]+:ja-JP/);
  const r = await saveLang(env, 'ja-JP', JA2);
  assert.equal(r.status, 200);
  assert.equal(r.json.cache, 'pending');
  assert.ok(failBody.hits.length >= 1);
  for (const v of await servedFor(env, 'ja-JP')) {
    assert.doesNotMatch(v.body, /イラストレーター/, 'not the file the object no longer holds');
    assert.doesNotMatch(v.body, /新しい日本語/);
    assert.match(v.body, /Illustrator/, 'the main file');
  }
  failBody.heal();
  await env.CARD_LIFETIMES.alarm('t');
  assert.match((await visit(env, '/t?lang=ja-JP')).body, /新しい日本語/);
});

test('row 3c — while a new body is on its way to KV, visitors get the previous file (the record moves only after it)', async () => {
  const env = await withJapanese();
  const held = kvHolds(env, 'put', /^card:t:[^:]+:ja-JP:/);
  const put = saveLang(env, 'ja-JP', JA2);
  await within(held.reached, 'the new ja-JP body put');
  for (const v of await servedFor(env, 'ja-JP')) {
    assert.match(v.body, /イラストレーター/, 'the previous file, whole: the record still names it');
    assert.doesNotMatch(v.body, /新しい日本語/);
  }
  held.release();
  assert.equal((await put).status, 200);
  assert.match((await visit(env, '/t?lang=ja-JP')).body, /新しい日本語/);
});

// ── row 4: the Card deleted while a language write is in flight ──────────────────────────────────

test('row 4a — DELETE while the language body put is in flight: the write is stale, nothing is served', async () => {
  const env = await withJapanese();
  const { gen: first } = await liveCard(env.CARDS, 't');
  const held = kvHolds(env, 'put', /^card:t:[^:]+:zh-TW/);
  const put = saveLang(env, 'zh-TW', ZH);
  await within(held.reached, 'the zh-TW body put');
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  held.release();
  const r = await put;
  assert.equal(r.status, 409);
  assert.equal(r.json.stale_generation, true);
  // the late body landed under the ended generation; the next owner's Card lists zh-TW and has no file
  assert.equal((await save(env, MAIN.replace('Illustrator.', 'NEXT OWNER'), { create: true })).status, 200);
  const { gen: second } = await liveCard(env.CARDS, 't');
  assert.notEqual(second, first);
  for (const v of await servedFor(env, 'zh-TW')) { assert.doesNotMatch(v.body, /插畫家/); assert.match(v.body, /NEXT OWNER/); }
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/zh-TW')).json.error, 'cards_language_missing');
  assert.equal(await mainMetadata(env), null);
});

test('row 4b — DELETE between the file kept and the record naming it: the write is stale, nothing reaches KV', async () => {
  const env = await withJapanese();
  const before = new Set(langKeys(env));
  // the main record's put in the object is the language write's commit; hold it
  const held = storageHolds(env, /^card:0$/);
  const put = saveLang(env, 'zh-TW', ZH);
  await within(held.reached, 'the object putting the main record');
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  held.release();
  const r = await put;
  assert.equal(r.status, 409);
  assert.equal(r.json.stale_generation, true);
  assert.deepEqual(langKeys(env).filter((k) => !before.has(k)), [], 'no zh-TW body was written to KV');
  assert.deepEqual(objectKeys(env).filter((k) => k.startsWith('card:')), [], 'the object holds nothing of the ended lifetime');
});

// ── row 5: a reused handle ───────────────────────────────────────────────────────────────────────

test('🔴 row 5 — a reused handle: no key of the previous lifetime, and no key its record does not name, is ever read', async () => {
  const env = await withJapanese();
  const { gen: first } = await liveCard(env.CARDS, 't');
  const firstRev = (await mainMetadata(env)).languages['ja-JP'];
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  // late writes of the ended lifetime (KV has no CAS): its versioned key, back after the sweep
  env.CARDS._m.set(`card:t:${first}:ja-JP:${firstRev}`, JA.replace('イラストレーター。', 'PREVIOUS OWNER'));
  assert.equal((await save(env, MAIN.replace('Illustrator.', 'NEW OWNER'), { create: true })).status, 200);
  const { gen: second } = await liveCard(env.CARDS, 't');
  // keys under the CURRENT generation that its record does not name: a round-1 key (no rev, a layout
  // this Worker no longer reads) and a rev the record never named
  env.CARDS._m.set(`card:t:${second}:ja-JP`, JA.replace('イラストレーター。', 'ROUND ONE KEY'));
  env.CARDS._m.set(`card:t:${second}:ja-JP:${firstRev}`, JA.replace('イラストレーター。', 'UNNAMED REV'));
  for (const v of await servedFor(env, 'ja-JP')) {
    assert.doesNotMatch(v.body, /PREVIOUS OWNER|ROUND ONE KEY|UNNAMED REV/);
    assert.match(v.body, /NEW OWNER/);
  }
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.error, 'cards_language_missing');
  assert.equal((await call(env, 'GET', '/_api/card/t')).json.languages['ja-JP'], null);
  // a write admitted in the ended lifetime is refused by the object
  const late = await env.CARD_LIFETIMES.get({ name: 't' }).fetch('https://card-lifetime.example/language', {
    method: 'POST', body: JSON.stringify({ handle: 't', gen: first, tag: 'ja-JP', kind: 'put', markdown: JA }),
  });
  assert.equal(late.status, 409);
  assert.equal((await late.json()).stale_generation, true);
  // and the new owner's own Japanese file, once written, is what is served
  assert.equal((await saveLang(env, 'ja-JP', JA2)).status, 200);
  assert.match((await visit(env, '/t?lang=ja-JP')).body, /新しい日本語/);
});

// ── row 6: a record that lost its language fields (a write by an older Worker, a rollback) ───────

test('🔴 row 6 — after a write that dropped the language fields, a new file never lands under a rev key still in KV', async () => {
  const env = await withJapanese();
  const { gen } = await liveCard(env.CARDS, 't');
  const oldKey = langKeys(env)[0];
  // what an older Worker's main save leaves: the object's record without its language fields, and the
  // main key put without metadata. The old Japanese body stays in KV, under the key that named it.
  const storage = env.CARD_LIFETIMES.storageOf('t');
  const { languages: _l, langSeq: _s, owed: _o, ...bare } = storage._m.get(`card:${gen}`);
  storage._m.set(`card:${gen}`, bare);
  env.CARDS._meta.delete(`card:t:${gen}`);
  assert.ok(env.CARDS._m.has(oldKey));
  // the new Japanese file's body put fails; the record that names it lands
  const failBody = kvFails(env, 'put', /^card:t:[^:]+:ja-JP:/);
  const r = await saveLang(env, 'ja-JP', JA2);
  assert.equal(r.status, 200);
  assert.ok(failBody.hits.length >= 1);
  assert.ok(!failBody.hits.includes(oldKey), `the new rev is not the old one (${oldKey})`);
  for (const v of await servedFor(env, 'ja-JP')) assert.doesNotMatch(v.body, /イラストレーター/, 'never the file from before the rollback');
  failBody.heal();
  await env.CARD_LIFETIMES.alarm('t');
  assert.match((await visit(env, '/t?lang=ja-JP')).body, /新しい日本語/);
});

// ── the Card's DELETE takes every language key, live and owed ────────────────────────────────────

test('DELETE of the Card removes live and owed language keys, even when its listing misses them', async () => {
  const env = await withJapanese();
  await saveLang(env, 'zh-TW', ZH);
  const del = kvFails(env, 'delete', /^card:t:[^:]+:ja-JP/);
  await saveLang(env, 'ja-JP', JA2); // the superseded ja-JP rev is owed
  assert.equal(langKeys(env).filter((k) => k.includes(':ja-JP')).length, 2);
  del.heal();
  const realList = env.CARDS.list.bind(env.CARDS);
  env.CARDS.list = async (opts) => { const r = await realList(opts); return { ...r, keys: r.keys.filter((k) => !/^card:t:[^:]+:/.test(k.name)) }; };
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  assert.deepEqual(langKeys(env), []);
  assert.equal(await mainKey(env).then((k) => env.CARDS._m.has(k)), false);
});
