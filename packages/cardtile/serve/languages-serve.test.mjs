// tile#304 — a Card in several languages: serving a visitor
//
//   storage   `card:<handle>:<gen>:<tag>` beside the main `card:<handle>:<gen>`, written by the handle's
//             CardLifetime like the main file, generation-scoped like it
//   API       GET/PUT/DELETE `/_api/card/<handle>/lang/<tag>` (+ `/full`), on both prefixes
//   serving   no locale in the path: `?lang=`, then Accept-Language; a listed language with a file is
//             that file over the main file's whole-Card keys and assets; anything else is the main file
//
// The pure rules (tags, matching, keys, the composed file) are in ../languages.test.mjs; the fixtures
// and doubles in languages-harness.mjs. Every gate is asserted with its control beside it.
//
// run: node --test packages/cardtile/serve/languages-serve.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './card-worker.mjs';
import { liveCard } from './card-api.mjs';
import { MAIN, PLAIN, call, visit, htmlLang, hreflangs, canonicalOf, withMain, withJapanese } from './languages-harness.mjs';

// ── serving ──────────────────────────────────────────────────────────────────────────────────────

test('serving: the resolution table, end to end (never a 404 because of language)', async () => {
  const env = await withJapanese();
  const T = [
    // [path, Accept-Language, served <html lang>, served words]
    ['/t', undefined, 'en-US', 'Illustrator'],
    ['/t?lang=ja-JP', undefined, 'ja-JP', 'イラストレーター'],
    ['/t?lang=ja', undefined, 'ja-JP', 'イラストレーター'],
    ['/t?lang=JA_jp', undefined, 'ja-JP', 'イラストレーター'],
    ['/t', 'ja-JP,en;q=0.5', 'ja-JP', 'イラストレーター'],
    ['/t', 'fr,ja;q=0.3', 'ja-JP', 'イラストレーター'],
    ['/t', 'ja;q=0,en', 'en-US', 'Illustrator'],
    ['/t?lang=en-US', 'ja', 'en-US', 'Illustrator'],
    ['/t?lang=fr', 'ja', 'en-US', 'Illustrator'],
    ['/t?lang=zh-TW', undefined, 'en-US', 'Illustrator'],            // listed, no file → main
    ['/t', 'zh-TW', 'en-US', 'Illustrator'],
    ['/t', 'zh-CN', 'en-US', 'Illustrator'],
    ['/t?lang=%3Cx%3E', 'ja', 'ja-JP', 'イラストレーター'],          // malformed ?lang= ignored
    ['/t?lang=', 'ja', 'ja-JP', 'イラストレーター'],
    ['/t', '*;q=0.9,,;;', 'en-US', 'Illustrator'],
  ];
  for (const [path, al, lang, words] of T) {
    const v = await visit(env, path, al == null ? {} : { 'accept-language': al });
    const what = `${path} [${al}]`;
    assert.equal(v.status, 200, what);
    assert.equal(htmlLang(v.body), lang, what);
    assert.match(v.body, new RegExp(words), what);
    assert.equal(v.headers.get('vary'), 'Accept, Accept-Language', what);
    assert.equal(v.headers.get('content-language'), lang, what);
  }
});

test('serving a language file: whole-Card keys and the assets come from the main file', async () => {
  const env = await withJapanese();
  const v = await visit(env, '/t?lang=ja-JP');
  assert.match(v.body, /<title>アスター<\/title>/, 'the language file’s title');
  assert.match(v.body, /--cp-accent:#c0392b/, 'the main file’s accent');
  assert.match(v.body, /data:image\/gif;base64,R0lGOD/, 'the main file’s picture, by the same asset id');
});

test('hreflang alternates for every listed language plus x-default, and a self-canonical for ?lang=', async () => {
  const env = await withJapanese();
  const v = await visit(env, '/t?lang=ja-JP');
  assert.deepEqual(hreflangs(v.body), [
    ['en-US', 'https://card.feelreef.com/t?lang=en-US'],
    ['ja-JP', 'https://card.feelreef.com/t?lang=ja-JP'],
    ['zh-TW', 'https://card.feelreef.com/t?lang=zh-TW'],
    ['x-default', 'https://card.feelreef.com/t'],
  ]);
  assert.equal(canonicalOf(v.body), 'https://card.feelreef.com/t?lang=ja-JP');
  assert.match(v.body, /<meta property="og:url" content="https:\/\/card\.feelreef\.com\/t\?lang=ja-JP">/);
  const bare = await visit(env, '/t', { 'accept-language': 'ja' });
  assert.equal(canonicalOf(bare.body), 'https://card.feelreef.com/t', 'chosen by the header: the bare address is canonical');
  assert.equal(hreflangs(bare.body).length, 4);
});

test('cache variance: one URL, two Accept-Language values, two bodies — and the response says it varies', async () => {
  const env = await withJapanese();
  const a = await visit(env, '/t', { 'accept-language': 'en' });
  const b = await visit(env, '/t', { 'accept-language': 'ja' });
  assert.notEqual(a.body, b.body);
  for (const r of [a, b]) {
    assert.equal(r.headers.get('vary'), 'Accept, Accept-Language');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=60');
  }
});

test('the markdown exits take the same choice: thin by Accept, fat by .md, both composed', async () => {
  const env = await withJapanese();
  const thin = await visit(env, '/t?lang=ja-JP', { accept: 'text/markdown' });
  assert.equal(thin.status, 200);
  assert.match(thin.body, /^lang: ja-JP$/m);
  assert.match(thin.body, /^accent: #c0392b$/m);
  assert.doesNotMatch(thin.body, /## assets/);
  assert.equal(thin.headers.get('content-language'), 'ja-JP');
  assert.equal(thin.headers.get('vary'), 'Accept, Accept-Language');
  assert.match(thin.headers.get('link'), /<https:\/\/card\.feelreef\.com\/t\.md\?lang=ja-JP>; rel="alternate"; type="text\/markdown"/);
  const fat = await visit(env, '/t.md', { 'accept-language': 'ja' });
  assert.match(fat.body, /イラストレーター/);
  assert.match(fat.body, /## assets/);
  assert.equal(fat.headers.get('content-language'), 'ja-JP');
  const main = await visit(env, '/t.md');
  assert.equal(main.body, MAIN, 'no choice: the main file, byte for byte');
});

test('the avatar and the icon files are the main file’s, whatever language is asked', async () => {
  const env = await withJapanese();
  for (const p of ['/t/avatar', '/t/favicon.ico', '/t/apple-touch-icon.png']) {
    const a = await worker.fetch(new Request(`https://card.feelreef.com${p}`), env, {});
    const b = await worker.fetch(new Request(`https://card.feelreef.com${p}?lang=ja-JP`, { headers: { 'accept-language': 'ja' } }), env, {});
    assert.equal(a.status, b.status, p);
    assert.deepEqual(new Uint8Array(await a.arrayBuffer()), new Uint8Array(await b.arrayBuffer()), p);
    assert.equal(b.headers.get('vary'), a.headers.get('vary'), p);
  }
});

test('a stopped Card stops in every language', async () => {
  const env = await withJapanese();
  assert.equal((await call(env, 'PUT', '/_api/card/t/stop', {})).status, 200);
  const v = await visit(env, '/t?lang=ja-JP');
  assert.equal(v.status, 404);
  assert.doesNotMatch(v.body, /イラストレーター/);
});

test('the reef.cards open stage chooses the language exactly as the old host does', async () => {
  const env = await withJapanese({ CARDS_HOST_OPEN: 'reef.cards' });
  for (const [path, headers] of [['/t?lang=ja-JP', {}], ['/t', { 'accept-language': 'ja' }], ['/t.md?lang=ja-JP', {}], ['/t', { accept: 'text/markdown', 'accept-language': 'ja' }]]) {
    const old = await visit(env, path, headers);
    const open = await visit(env, path, headers, 'reef.cards');
    assert.equal(open.status, 200, path);
    assert.equal(open.body, old.body, path);
    assert.equal(open.headers.get('content-language'), 'ja-JP', path);
    assert.equal(open.headers.get('vary'), 'Accept, Accept-Language', path);
    assert.equal(open.headers.get('x-robots-tag'), 'noindex, nofollow', path);
  }
});

test('a Card on its own domain: the same choice, and alternates on that domain', async () => {
  const env = await withJapanese();
  const { gen } = await liveCard(env.CARDS, 't');
  // a binding as the vanity route leaves it (generation 0 has no lifetime keys: the pointer alone binds)
  assert.equal(gen, '0');
  env.CARDS._m.set('vanity:aster.example', 't');
  const v = await visit(env, '/?lang=ja-JP', {}, 'aster.example');
  assert.equal(v.status, 200);
  assert.equal(htmlLang(v.body), 'ja-JP');
  assert.equal(hreflangs(v.body)[1][1], 'https://aster.example?lang=ja-JP');
  assert.equal(canonicalOf(v.body), 'https://aster.example?lang=ja-JP');
});

// ── a Card with no `locales:` is today's Card ────────────────────────────────────────────────────

test('🔴 no locales: no language read, no new header, the same bytes whatever language is asked', async () => {
  const env = await withMain({}, PLAIN);
  const asks =[['/t', {}], ['/t?lang=ja-JP', {}], ['/t', { 'accept-language': 'ja' }], ['/t.md?lang=ja-JP', {}], ['/t', { accept: 'text/markdown', 'accept-language': 'ja' }]];
  const base = await visit(env, '/t');
  for (const [path, headers] of asks) {
    env.CARDS.reads.length = 0;
    const v = await visit(env, path, headers);
    assert.equal(v.status, 200, path);
    assert.equal(v.headers.get('content-language'), null, path);
    assert.equal(v.headers.get('vary'), 'Accept', `${path}: a Card that declares lang: does not vary by Accept-Language`);
    assert.deepEqual(hreflangs(v.body), [], path);
    assert.ok(!env.CARDS.reads.some((k) => /^card:t:[^:]+:/.test(k)), `${path}: read ${env.CARDS.reads.join(', ')}`);
    if (!path.includes('.md') && !headers.accept) assert.equal(v.body, base.body, `${path}: the same page`);
  }
});
