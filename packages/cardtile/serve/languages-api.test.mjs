// tile#304 — a Card in several languages: the store and the write API
//
//   storage   `card:<handle>:<gen>:<tag>:<rev>` beside the main `card:<handle>:<gen>`, whose KV metadata
//             names the live rev of each tag; written by the handle's CardLifetime like the main file,
//             generation-scoped like it (the interleavings: languages-interleave.test.mjs)
//   API       GET/PUT/DELETE `/_api/card/<handle>/lang/<tag>` (+ `/full`), on both prefixes
//   serving   no locale in the path: `?lang=`, then Accept-Language; a listed language with a file is
//             that file over the main file's whole-Card keys and assets; anything else is the main file
//
// The pure rules (tags, matching, keys, the composed file) are in ../languages.test.mjs; the fixtures
// and doubles in languages-harness.mjs. Every gate is asserted with its control beside it.
//
// run: node --test packages/cardtile/serve/languages-api.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { liveCard } from './card-api.mjs';
import { cardVersion } from '../card-save.mjs';
import { CARD_MAX_BYTES } from '../card-core.js';
import { GIF, MAIN, PLAIN, JA, envWith, call, save, saveLang, visit, langKeys, withMain, withJapanese, mainMetadata } from './languages-harness.mjs';

// ── the write API ────────────────────────────────────────────────────────────────────────────────

test('PUT then GET a language file: its own version, the main file’s assets, stored thin', async () => {
  const env = await withJapanese();
  const got = await call(env, 'GET', '/_api/card/t/lang/ja-JP');
  assert.equal(got.status, 200);
  assert.equal(got.json.handle, 't');
  assert.equal(got.json.lang, 'ja-JP');
  assert.match(got.json.markdown, /イラストレーター/);
  assert.equal(got.json.version, await cardVersion(got.json.markdown), 'the version is the language file’s own');
  assert.deepEqual(got.json.assets.map((a) => a.id), ['pic'], 'the manifest is the main file’s assets');
  // the KV key: the main file's plus the tag and the file's rev, in the main file's generation; the
  // main file's record names that rev
  const { gen } = await liveCard(env.CARDS, 't');
  const rev = (await mainMetadata(env)).languages['ja-JP'];
  assert.deepEqual(langKeys(env), [`card:t:${gen}:ja-JP:${rev}`]);
  assert.doesNotMatch(env.CARDS._m.get(`card:t:${gen}:ja-JP:${rev}`), /## assets/, 'stored thin');
  // /full: the language file with the main file's assets lane, as a complete file
  const full = await call(env, 'GET', '/_api/card/t/lang/ja-JP/full');
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.match(full.text, /イラストレーター/);
  assert.match(full.text, new RegExp(`id=pic mime=image/gif %% ${GIF.replace(/[+/]/g, '\\$&')}`));
  // the main file is untouched by a language write
  assert.equal((await liveCard(env.CARDS, 't')).md, MAIN);
});

test('the main GET lists the languages only when the main file lists some (else its answer is as before)', async () => {
  const env = await withJapanese();
  const main = await call(env, 'GET', '/_api/card/t');
  assert.deepEqual(main.json.locales, ['en-US', 'ja-JP', 'zh-TW']);
  assert.deepEqual(Object.keys(main.json.languages), ['ja-JP', 'zh-TW']);
  assert.match(main.json.languages['ja-JP'], /^v1:/);
  assert.equal(main.json.languages['zh-TW'], null, 'listed, no file');
  const plain = envWith();
  await save(plain, PLAIN, { create: true });
  const p = await call(plain, 'GET', '/_api/card/t');
  assert.deepEqual(Object.keys(p.json), ['handle', 'version', 'markdown', 'assets', 'total_bytes'], 'CONTROL: no locales, no new field');
});

test('base_version of a language file is that file’s version, checked by the handle’s object', async () => {
  const env = await withJapanese();
  const { json: read } = await call(env, 'GET', '/_api/card/t/lang/ja-JP');
  const stale = await saveLang(env, 'ja-JP', JA.replace('ショップ', '店'), { base_version: 'v1:0000000000000000' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.conflict, true);
  assert.equal(stale.json.current, read.version);
  const ok = await saveLang(env, 'ja-JP', JA.replace('ショップ', '店'), { base_version: read.version });
  assert.equal(ok.status, 200, 'CONTROL: the version just read passes');
  assert.notEqual(ok.json.version, read.version);
  // the MAIN file's version is not this file's
  const { json: main } = await call(env, 'GET', '/_api/card/t');
  assert.equal((await saveLang(env, 'ja-JP', JA, { base_version: main.version })).status, 409);
  // a base_version for a file that does not exist yet is a conflict, like the main file's
  const none = await saveLang(env, 'zh-TW', JA.replace('lang: ja-JP', 'lang: zh-TW'), { base_version: read.version });
  assert.equal(none.status, 409);
  assert.equal(none.json.current, null);
});

test('dry_run checks a language file and writes nothing', async () => {
  const env = await withJapanese();
  const before = new Map(env.CARDS._m);
  const dry = await saveLang(env, 'ja-JP', JA.replace('ショップ', '店'), { dry_run: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.json.dry_run, true);
  assert.equal(dry.json.wouldChange, true);
  assert.deepEqual(new Map(env.CARDS._m), before);
});

test('🔴 the refusals, each with its code, and each beside a call that is accepted', async () => {
  const env = await withJapanese();
  const zh = JA.replace('lang: ja-JP', 'lang: zh-TW');
  const T = [
    // [what, path tag, markdown, status, code, extra check]
    ['unlisted language', 'fr', JA.replace('lang: ja-JP', 'lang: fr'), 409, 'cards_language_not_listed'],
    ['the main file’s own language', 'en-US', JA.replace('lang: ja-JP', 'lang: en-US'), 409, 'cards_language_is_main'],
    ['malformed tag', 'en_US_POSIX!', JA, 400, 'cards_language_tag_invalid'],
    ['wildcard tag', '*', JA, 400, 'cards_language_tag_invalid'],
    ['a whole-Card key', 'zh-TW', zh.replace('lang: zh-TW', 'lang: zh-TW\naccent: #000000'), 422, 'cards_language_key_refused', (j) => assert.equal(j.key, 'accent')],
    ['the claim', 'zh-TW', zh.replace('lang: zh-TW', 'lang: zh-TW\ncard-page: someone'), 422, 'cards_language_key_refused', (j) => assert.equal(j.key, 'card-page')],
    ['views', 'zh-TW', zh.replace('lang: zh-TW', 'lang: zh-TW\nviews: wall'), 422, 'cards_language_key_refused', (j) => assert.equal(j.key, 'views')],
    ['locales', 'zh-TW', zh.replace('lang: zh-TW', 'lang: zh-TW\nlocales: [fr]'), 422, 'cards_language_key_refused', (j) => assert.equal(j.key, 'locales')],
    ['lang: not the tag', 'zh-TW', JA, 422, 'cards_language_lang_mismatch'],
    ['an unsafe link scheme', 'zh-TW', zh.replace('https://example.com/shop', 'javascript:alert(1)'), 422, 'card_url_scheme'],
    ['empty markdown', 'zh-TW', '', 400, null],
  ];
  for (const [what, tag, md, status, code, more] of T) {
    const r = await saveLang(env, tag, md);
    assert.equal(r.status, status, `${what}: ${JSON.stringify(r.json)}`);
    if (code) assert.equal(r.json.error, code, what);
    if (more) more(r.json);
  }
  assert.deepEqual(langKeys(env).map((k) => k.split(':')[3]), ['ja-JP'], 'nothing refused was stored');
  // CONTROL: the same file, written right, is accepted under the listed tag — in any spelling of it
  const ok = await saveLang(env, 'ZH_tw', zh);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.lang, 'zh-TW');
});

test('🔴 no card at the handle: a language file cannot be written, read or deleted', async () => {
  const env = envWith();
  assert.equal((await saveLang(env, 'ja-JP', JA)).json.error, 'cards_language_no_card');
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).status, 404);
  assert.equal((await call(env, 'DELETE', '/_api/card/t/lang/ja-JP')).status, 404);
});

test('GET of a language: listed with no file, and unlisted, are two different 404s', async () => {
  const env = await withJapanese();
  const missing = await call(env, 'GET', '/_api/card/t/lang/zh-TW');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, 'cards_language_missing');
  const unlisted = await call(env, 'GET', '/_api/card/t/lang/fr');
  assert.equal(unlisted.status, 404);
  assert.equal(unlisted.json.error, 'cards_language_not_listed');
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-jp')).status, 200, 'CONTROL: the tag in another spelling');
});

test('🔴 a size over the per-file ceiling is refused (413), like the main file', async () => {
  const env = await withJapanese();
  const big = JA.replace('イラストレーター。', 'x'.repeat(CARD_MAX_BYTES));
  const r = await saveLang(env, 'ja-JP', big);
  assert.equal(r.status, 413);
});

test('🔴 `?lang=` on the main routes is refused: a dropped path segment must not become a main write', async () => {
  const env = await withJapanese();
  for (const [method, path, body] of [['PUT', '/_api/card/t?lang=ja-JP', { markdown: JA }], ['DELETE', '/_api/card/t?lang=ja-JP'], ['GET', '/_api/card/t?lang=ja-JP'], ['GET', '/_api/card/t/full?lang=ja-JP']]) {
    const r = await call(env, method, path, body);
    assert.equal(r.status, 400, `${method} ${path}`);
    assert.equal(r.json.error, 'cards_language_use_path');
  }
  assert.equal((await liveCard(env.CARDS, 't')).md, MAIN, 'the main file is untouched');
  assert.equal((await call(env, 'GET', '/_api/card/t')).status, 200, 'CONTROL: without the query');
});

test('main save: `locales:` is validated (bad entry, too many) and a Card without it is never asked', async () => {
  const env = envWith();
  const bad = await save(env, MAIN.replace('locales: [en-US, ja-JP, zh-TW]', 'locales: [en-US, b@d]'), { create: true });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error, 'cards_locales_invalid');
  const tags = Array.from({ length: 13 }, (_, i) => `x${String.fromCharCode(97 + i)}`);
  const many = await save(env, MAIN.replace('locales: [en-US, ja-JP, zh-TW]', `locales: [${tags.join(', ')}]`), { create: true });
  assert.equal(many.status, 422);
  assert.equal(many.json.error, 'cards_locales_too_many');
  assert.equal((await save(env, PLAIN, { create: true })).status, 200, 'CONTROL');
});

test('DELETE one language file: gone from the object and from KV; the Card and the other files stay', async () => {
  const env = await withJapanese();
  await saveLang(env, 'zh-TW', JA.replace('lang: ja-JP', 'lang: zh-TW'));
  const del = await call(env, 'DELETE', '/_api/card/t/lang/ja-JP');
  assert.equal(del.status, 200);
  assert.deepEqual(del.json, { handle: 't', lang: 'ja-JP', deleted: true });
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.error, 'cards_language_missing');
  assert.deepEqual(langKeys(env).map((k) => k.split(':')[3]), ['zh-TW']);
  assert.equal((await liveCard(env.CARDS, 't')).md, MAIN);
  assert.equal((await call(env, 'DELETE', '/_api/card/t/lang/ja-JP')).status, 404, 'a second delete finds nothing');
  // If-Version guards it like the fenced asset delete
  const { json: zh } = await call(env, 'GET', '/_api/card/t/lang/zh-TW');
  assert.equal((await call(env, 'DELETE', '/_api/card/t/lang/zh-TW', null, { 'if-version': 'v1:0000000000000000' })).status, 409);
  assert.equal((await call(env, 'DELETE', '/_api/card/t/lang/zh-TW', null, { 'if-version': zh.version })).status, 200, 'CONTROL');
});

test('🔴 removing a language from `locales:` removes its file, in the same write', async () => {
  const env = await withJapanese();
  const dropped = await save(env, MAIN.replace('locales: [en-US, ja-JP, zh-TW]', 'locales: [en-US, zh-TW]'));
  assert.equal(dropped.status, 200);
  assert.deepEqual(dropped.json.languages_removed, ['ja-JP']);
  assert.deepEqual(langKeys(env), []);
  const store = env.CARD_LIFETIMES.storageOf('t')._m;
  assert.deepEqual([...store.keys()].filter((k) => k.includes('@')), [], 'the object holds none of it');
  // listing it again does not bring it back
  await save(env, MAIN);
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.error, 'cards_language_missing');
  // CONTROL: a save that keeps the language keeps its file, and says nothing about removal
  await saveLang(env, 'ja-JP', JA);
  const kept = await save(env, MAIN.replace('Illustrator.', 'Illustrator and printer.'));
  assert.equal(kept.json.languages_removed, undefined);
  assert.equal(langKeys(env).length, 1);
  // a dry run says what a save would remove, and removes nothing
  const dry = await save(env, PLAIN, { dry_run: true });
  assert.deepEqual(dry.json.languages_removed, ['ja-JP']);
  assert.equal(langKeys(env).length, 1);
});

test('🔴 deleting the Card removes every language file, from KV and from the object', async () => {
  const env = await withJapanese();
  await saveLang(env, 'zh-TW', JA.replace('lang: ja-JP', 'lang: zh-TW'));
  assert.equal(langKeys(env).length, 2);
  const del = await call(env, 'DELETE', '/_api/card/t');
  assert.equal(del.status, 200);
  assert.equal(del.json.deleted, true);
  assert.deepEqual(langKeys(env), []);
  assert.deepEqual([...env.CARDS._m.keys()].filter((k) => k.startsWith('card:t:')), []);
  const store = env.CARD_LIFETIMES.storageOf('t')._m;
  assert.deepEqual([...store.keys()].filter((k) => k.startsWith('card:')), []);
});

test('🔴 a deletion whose KV listing lags still removes the language files the object held', async () => {
  const env = await withJapanese();
  const realList = env.CARDS.list.bind(env.CARDS);
  // the listing has not caught up on any language key (KV list is eventually consistent)
  env.CARDS.list = async (opts) => { const r = await realList(opts); return { ...r, keys: r.keys.filter((k) => !/^card:t:[^:]+:/.test(k.name)) }; };
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  assert.deepEqual(langKeys(env), []);
});

test('🔴 a reused handle is never served a previous owner’s language file', async () => {
  const env = await withJapanese();
  const { gen: first } = await liveCard(env.CARDS, 't');
  const rev = (await mainMetadata(env)).languages['ja-JP'];
  assert.equal((await call(env, 'DELETE', '/_api/card/t')).status, 200);
  // a write-through of the ended lifetime that lands AFTER the delete's sweep (KV has no CAS): the
  // previous owner's Japanese file is back in the store under the ended generation's key
  env.CARDS._m.set(`card:t:${first}:ja-JP:${rev}`, JA.replace('イラストレーター。', 'PREVIOUS OWNER'));
  // the next owner makes a Card listing Japanese, and writes no Japanese file
  assert.equal((await save(env, MAIN.replace('Illustrator.', 'NEW OWNER'), { create: true })).status, 200);
  const { gen: second } = await liveCard(env.CARDS, 't');
  assert.notEqual(second, first);
  for (const [path, headers] of [['/t?lang=ja-JP', {}], ['/t', { 'accept-language': 'ja' }], ['/t.md?lang=ja-JP', {}], ['/t?lang=ja-JP', { accept: 'text/markdown' }]]) {
    const v = await visit(env, path, headers);
    assert.equal(v.status, 200, path);
    assert.doesNotMatch(v.body, /PREVIOUS OWNER/, `${path} ${JSON.stringify(headers)}`);
    assert.match(v.body, /NEW OWNER/, `${path}: the new owner’s main file`);
  }
  assert.equal((await call(env, 'GET', '/_api/card/t/lang/ja-JP')).json.error, 'cards_language_missing');
  // and a write admitted in the ended lifetime is refused by the object (it names the old generation)
  const late = await env.CARD_LIFETIMES.get({ name: 't' }).fetch('https://card-lifetime.example/language', {
    method: 'POST', body: JSON.stringify({ handle: 't', gen: first, tag: 'ja-JP', kind: 'put', markdown: JA }),
  });
  assert.equal(late.status, 409);
  assert.equal((await late.json()).stale_generation, true);
});

// ── an asset is in use while ANY current file of the Card refers to it (review r1 #1) ──────────────

const NO_PIC = MAIN.replace(' avatar="asset:pic"', '');

test('🔴 review r1 #1: an asset only a language file uses cannot be deleted, on either route (port of asset-only-in-language.mjs)', async () => {
  const env = await withJapanese();
  const saved = await save(env, NO_PIC);
  assert.equal(saved.status, 200);
  const before = await visit(env, '/t?lang=ja-JP');
  assert.ok(before.body.includes('data:image/gif;base64,'), 'the Japanese page shows the picture');
  const plain = await call(env, 'DELETE', '/_api/card/t/asset/pic');
  assert.equal(plain.status, 409, JSON.stringify(plain.json));
  assert.equal(plain.json.referenced, true);
  assert.deepEqual(plain.json.used_by, ['ja-JP']);
  assert.match(plain.json.error, /ja-JP/);
  const { json: main } = await call(env, 'GET', '/_api/card/t');
  const fenced = await call(env, 'DELETE', '/_api/card/t/asset/pic/fenced', null, { 'if-version': main.version });
  assert.equal(fenced.status, 409, JSON.stringify(fenced.json));
  assert.equal(fenced.json.fence, 'if-version');
  assert.deepEqual(fenced.json.used_by, ['ja-JP']);
  const after = await visit(env, '/t?lang=ja-JP');
  assert.ok(after.body.includes('data:image/gif;base64,'), 'the Japanese page still shows it');
  // the main file and a language file both: both are named, the main file first
  await save(env, MAIN);
  assert.deepEqual((await call(env, 'DELETE', '/_api/card/t/asset/pic')).json.used_by, ['main', 'ja-JP']);
  // CONTROL: once no current file refers to it, it goes
  await save(env, NO_PIC);
  assert.equal((await call(env, 'DELETE', '/_api/card/t/lang/ja-JP')).status, 200);
  const gone = await call(env, 'DELETE', '/_api/card/t/asset/pic');
  assert.equal(gone.status, 200, JSON.stringify(gone.json));
});

test('a Card with no language file answers a referenced delete exactly as before (no new field)', async () => {
  const env = await withMain({}, PLAIN);
  const r = await call(env, 'DELETE', '/_api/card/t/asset/pic');
  assert.equal(r.status, 409);
  assert.deepEqual(Object.keys(r.json).sort(), ['error', 'referenced']);
  assert.equal(r.json.error, '"pic" is still used by this card. Remove the reference first, then delete the asset.');
});

test('🔴 the main save’s orphans, and the manifests, count what the language files use', async () => {
  const env = await withJapanese();
  const saved = await save(env, NO_PIC);
  assert.deepEqual(saved.json.orphans, [], 'pic is used by the Japanese file: not an orphan');
  const dry = await save(env, NO_PIC, { dry_run: true });
  assert.deepEqual(dry.json.orphans, []);
  const { json: main } = await call(env, 'GET', '/_api/card/t');
  assert.equal(main.assets.find((a) => a.id === 'pic').referenced, true);
  const { json: ja } = await call(env, 'GET', '/_api/card/t/lang/ja-JP');
  assert.equal(ja.assets.find((a) => a.id === 'pic').referenced, true);
  // a save that removes the only language using it reports it as an orphan in the same answer
  const drop = await save(env, NO_PIC.replace('locales: [en-US, ja-JP, zh-TW]', 'locales: [en-US, zh-TW]'));
  assert.deepEqual(drop.json.languages_removed, ['ja-JP']);
  assert.deepEqual(drop.json.orphans, ['pic']);
});

test('a language file that refers to an asset the Card does not hold is treated as a main save treats one', async () => {
  // a main save stores such a reference (the renderer draws nothing for it) and refuses nothing; a
  // language file gets the same answer, so the two doors never disagree about one Card
  const env = await withJapanese();
  const mainSave = await save(env, MAIN.replace('avatar="asset:pic"', 'avatar="asset:nope"'));
  const langSave = await saveLang(env, 'ja-JP', JA.replace('avatar="asset:pic"', 'avatar="asset:nope"'));
  assert.equal(mainSave.status, 200);
  assert.equal(langSave.status, mainSave.status);
});

test('a language write-through that fails is retried by the alarm (the object is the truth)', async () => {
  const env = await withJapanese();
  const realPut = env.CARDS.put.bind(env.CARDS);
  env.CARDS.put = async (k, v, o) => { if (/^card:t:[^:]+:zh-TW:/.test(k)) throw new Error('kv down'); return realPut(k, v, o); };
  const r = await saveLang(env, 'zh-TW', JA.replace('lang: ja-JP', 'lang: zh-TW'));
  assert.equal(r.status, 200);
  assert.equal(r.json.cache, 'pending');
  assert.equal(langKeys(env).filter((k) => k.includes(':zh-TW:')).length, 0);
  env.CARDS.put = realPut;
  await env.CARD_LIFETIMES.alarm('t');
  assert.equal(langKeys(env).filter((k) => k.includes(':zh-TW:')).length, 1);
});
