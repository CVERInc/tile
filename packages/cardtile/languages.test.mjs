// tile#304 — the pure rules of a Card in several languages (languages.mjs): what a tag is, which
// listed language a request gets, which keys a language file may carry, and the file that is served.
// The store, the API and the Worker are in serve/languages.test.mjs.
//
// run: node --test packages/cardtile/languages.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseTag, matchTag, readLocales, languagesOf, localesRefusal, languageFileRefusal, storedLanguageFile,
  composeLanguage, chooseLanguage, fenceKeys, PER_LANGUAGE_KEYS, WHOLE_CARD_KEYS, MAX_LOCALES,
} from './languages.mjs';
import { pickAcceptLanguage, localeFromAcceptLanguage } from './w/sandbox-i18n.mjs';
import { parseCard, serializeCard } from './card-core.js';

const GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const MAIN = serializeCard(parseCard([
  '---', 'card-page: t', 'title: Aster', 'lang: en-US', 'locales: [en-US, ja-JP, zh-TW]', 'accent: #c0392b',
  'views: stack wall', 'back: "#about"', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% Illustrator.',
  '- [ ] %% card: link w=6 back=#about %% [Shop](https://example.com/shop)', '',
  '## back: about | About', '', '- [ ] %% card: text w=6 %% About me.', '',
  '## assets', '', `- [ ] %% card: asset id=pic mime=image/gif %% ${GIF}`, '',
].join('\n')));
const JA = [
  '---', 'title: アスター', 'lang: ja-JP', '---', '', '## grid', '',
  '- [ ] %% card: profile w=6 avatar="asset:pic" %% イラストレーター。',
  '- [ ] %% card: link w=6 back=#about %% [ショップ](https://example.com/shop)', '',
  '## back: about | 自己紹介', '', '- [ ] %% card: text w=6 %% 自己紹介です。', '',
].join('\n');

// ── tags ─────────────────────────────────────────────────────────────────────────────────────────

test('normaliseTag: validation and normalisation table', () => {
  const T = [
    // [input, canonical | null, why]
    ['en-US', 'en-US', 'already canonical'],
    ['EN-us', 'en-US', 'case: language lower, region upper'],
    ['zh-hant-tw', 'zh-Hant-TW', 'case: script Title'],
    ['zh_TW', 'zh-TW', 'underscore read as hyphen'],
    [' ja ', 'ja', 'surrounding space'],
    ['es-419', 'es-419', 'a numeric region stays'],
    ['sl-rozaj-biske', 'sl-rozaj-biske', 'variants lower'],
    ['zh-TW', 'zh-TW', 'zh-TW is not rewritten to zh-Hant-TW (no aliasing)'],
    ['', null, 'empty'],
    ['*', null, 'wildcard'],
    ['e', null, 'one-letter language'],
    ['english', null, 'too long a language subtag'],
    ['en-', null, 'trailing hyphen'],
    ['en--US', null, 'empty subtag'],
    ['en-x-private', null, 'private-use singleton'],
    ['de-u-co-phonebk', null, 'extension singleton'],
    ['<script>', null, 'markup'],
    ['ja;q=1', null, 'a header range is not a tag'],
    ['a'.repeat(2) + '-abcdefgh'.repeat(4), null, 'over 35 characters'],
    [42, null, 'not a string'],
  ];
  for (const [input, want, why] of T) assert.equal(normaliseTag(input), want, `${JSON.stringify(input)}: ${why}`);
});

test('matchTag: exact, then lookup, then same language — never across Chinese scripts', () => {
  const C = ['en-US', 'ja-JP', 'zh-TW', 'pt'];
  const T = [
    // [requested, candidates, served | null, rule]
    ['ja-JP', C, 'ja-JP', 'exact'],
    ['JA-jp', C, 'ja-JP', 'exact after normalisation'],
    ['ja', C, 'ja-JP', 'same language'],
    ['en-GB', C, 'en-US', 'same language, other region'],
    ['pt-BR', C, 'pt', 'lookup: pt-BR → pt'],
    ['zh-Hant-TW', C, 'zh-TW', 'same language, same script (Hant named vs implied by TW)'],
    ['zh-HK', C, 'zh-TW', 'same language, region-implied script Hant = Hant'],
    ['zh-CN', C, null, 'zh-CN (Hans) is never served zh-TW (Hant)'],
    ['zh-Hans', C, null, 'explicit Hans, same refusal'],
    ['zh', C, 'zh-TW', 'bare zh names no script: the first zh candidate'],
    ['fr', C, null, 'unlisted'],
    ['*', C, null, 'wildcard'],
    ['en;q=1', C, null, 'malformed'],
    ['zh-CN', ['zh-TW', 'zh'], 'zh', 'lookup reaches a bare zh before the same-language pass'],
    ['zh-Hant-TW', ['zh-Hant', 'zh-TW'], 'zh-Hant', 'lookup: zh-Hant-TW → zh-Hant before same-language'],
    ['en', ['en-GB', 'en-US'], 'en-GB', 'same language: the first listed wins'],
  ];
  for (const [req, cands, want, rule] of T) assert.equal(matchTag(req, cands), want, `${req} in [${cands}]: ${rule}`);
});

// ── the main file's list ─────────────────────────────────────────────────────────────────────────

test('readLocales / languagesOf: the forms of the line, dedup, and the main file’s own language', () => {
  const fm = (line, extra = '') => `---\ntitle: x\n${extra}${line}\n---\n\n## grid\n`;
  assert.deepEqual(readLocales(fm('locales: [en-US, ja-JP]')).tags, ['en-US', 'ja-JP']);
  assert.deepEqual(readLocales(fm('locales: en-US ja-JP')).tags, ['en-US', 'ja-JP']);
  assert.deepEqual(readLocales(fm('locales: "en-US", \'ja-jp\'')).tags, ['en-US', 'ja-JP']);
  assert.deepEqual(readLocales(fm('locales: [ja-JP, JA-jp, ja_JP]')).tags, ['ja-JP'], 'duplicates after normalisation collapse');
  assert.deepEqual(readLocales(fm('locales: [en-US, b@d!, ja]')), { tags: ['en-US', 'ja'], invalid: ['b@d!'], raw: true });
  assert.deepEqual(readLocales(fm('locales: [en-US, bad]')).tags, ['en-US', 'bad'], 'a well-formed tag nobody uses is still a tag: shape is the rule, not a registry');
  assert.deepEqual(readLocales(fm('theme: dark')), { tags: [], invalid: [], raw: false });
  assert.deepEqual(readLocales('## grid\nlocales: [ja]\n'), { tags: [], invalid: [], raw: false }, 'only the fence is read, never a line in the body');
  assert.deepEqual(languagesOf(MAIN), { listed: ['en-US', 'ja-JP', 'zh-TW'], main: 'en-US', files: ['ja-JP', 'zh-TW'] });
  const many = Array.from({ length: MAX_LOCALES + 3 }, (_, i) => `x${String.fromCharCode(97 + i)}`);
  assert.equal(languagesOf(fm(`locales: ${many.join(' ')}`)).listed.length, MAX_LOCALES, 'the cap holds on read too');
});

test('localesRefusal: a main save is refused for a malformed entry or too many — and never without the line', () => {
  assert.equal(localesRefusal(MAIN), null);
  assert.equal(localesRefusal('---\ntitle: x\n---\n'), null, 'CONTROL: no line, no refusal');
  const bad = localesRefusal('---\nlocales: [en-US, en_US_POSIX!]\n---\n');
  assert.equal(bad.error, 'cards_locales_invalid');
  assert.deepEqual(bad.entries, ['en_US_POSIX!']);
  const tags = Array.from({ length: MAX_LOCALES + 1 }, (_, i) => `x${String.fromCharCode(97 + i)}`);
  assert.equal(localesRefusal(`---\nlocales: [${tags.join(', ')}]\n---\n`).error, 'cards_locales_too_many');
  assert.equal(localesRefusal(`---\nlocales: [${tags.slice(0, MAX_LOCALES).join(', ')}]\n---\n`), null, 'CONTROL: exactly the cap is allowed');
});

// ── a language file ──────────────────────────────────────────────────────────────────────────────

test('languageFileRefusal: only title and lang; lang must be the tag', () => {
  assert.equal(languageFileRefusal(JA, 'ja-JP'), null);
  assert.equal(languageFileRefusal('## grid\n\n- [ ] %% card: text w=6 %% x\n', 'ja-JP'), null, 'no fence at all is fine');
  for (const key of [...WHOLE_CARD_KEYS, 'some-unknown-key']) {
    const r = languageFileRefusal(JA.replace('lang: ja-JP', `lang: ja-JP\n${key}: x`), 'ja-JP');
    assert.equal(r && r.error, 'cards_language_key_refused', key);
    assert.equal(r.key, key);
  }
  const two = languageFileRefusal(JA.replace('lang: ja-JP', 'lang: ja-JP\naccent: #000\nviews: wall'), 'ja-JP');
  assert.deepEqual(two.keys, ['accent', 'views']);
  // a key line OUTSIDE the fence is read by the Worker's frontmatter reader too: refused, named
  const prose = languageFileRefusal(JA.replace('\n## grid', '\naccent: #ff0000\n\n## grid'), 'ja-JP');
  assert.equal(prose && prose.error, 'cards_language_key_refused');
  assert.equal(prose.key, 'accent');
  assert.equal(prose.where, 'body');
  assert.equal(languageFileRefusal(JA.replace('\n## grid', '\nThe accent: warm.\n\n## grid'), 'ja-JP'), null, 'CONTROL: prose that is not a key line');
  assert.equal(languageFileRefusal(JA.replace('イラストレーター。', 'イラストレーター。\naccent: #ff0000'), 'ja-JP'), null, 'CONTROL: inside a lane the line is the tile’s (indented when stored)');
  assert.equal(languageFileRefusal(JA, 'zh-TW').error, 'cards_language_lang_mismatch');
  assert.equal(languageFileRefusal(JA.replace('lang: ja-JP', 'lang: JA_jp'), 'ja-JP'), null, 'the same tag in another spelling is the tag');
});

test('storedLanguageFile drops an assets lane the caller sent (assets are the main file’s)', () => {
  const fat = `${JA}\n## assets\n\n- [ ] %% card: asset id=other mime=image/gif %% ${GIF}\n`;
  const stored = storedLanguageFile(fat);
  assert.deepEqual(parseCard(stored).assets, {});
  assert.equal(stored, storedLanguageFile(JA), 'the same file with or without a lane');
});

test('composeLanguage: whole-Card keys and assets from the main file, words and lanes from the language file', () => {
  const served = composeLanguage(MAIN, storedLanguageFile(JA), 'ja-JP');
  const keys = fenceKeys(served);
  assert.deepEqual(keys, ['card-page', 'locales', 'accent', 'views', 'back', 'title', 'lang']);
  assert.match(served, /^title: アスター$/m);
  assert.match(served, /^lang: ja-JP$/m);
  assert.match(served, /^accent: #c0392b$/m);
  assert.deepEqual(parseCard(served).assets, parseCard(MAIN).assets, 'one assets lane for every language');
  assert.match(served, /イラストレーター/);
  assert.doesNotMatch(served, /Illustrator/);
  // a key the language file should not carry is IGNORED on read (refused on write)
  const sneaky = composeLanguage(MAIN, JA.replace('lang: ja-JP', 'lang: ja-JP\naccent: #000000\nviews: wall\ncard-page: someone-else'), 'ja-JP');
  assert.match(sneaky, /^accent: #c0392b$/m);
  assert.doesNotMatch(sneaky, /#000000|views: wall|someone-else/);
  // no title in the language file → the main file's
  const untitled = composeLanguage(MAIN, JA.replace('title: アスター\n', ''), 'ja-JP');
  assert.match(untitled, /^title: Aster$/m);
  // the served file is an ordinary card file: it round-trips
  assert.equal(serializeCard(parseCard(served)), served);
});

test('key classification: per-language and whole-Card are disjoint', () => {
  assert.deepEqual(PER_LANGUAGE_KEYS.filter((k) => WHOLE_CARD_KEYS.includes(k)), []);
});

// ── the choice ───────────────────────────────────────────────────────────────────────────────────

test('pickAcceptLanguage is the walk localeFromAcceptLanguage always made (same answers, other matcher)', () => {
  for (const h of ['', 'ja', 'ja;q=0,en', 'en;q=0.1,ja', 'fr,zh-CN;q=0.9,zh-TW;q=0.8', '*', 'xx;q=abc,de']) {
    assert.equal(localeFromAcceptLanguage(h), pickAcceptLanguage(h, (t) => ({ ja: 'ja', en: 'en', 'zh-cn': 'zh-Hans', 'zh-tw': 'zh', de: 'de', fr: 'fr' })[t.toLowerCase()] || null) || 'en', h);
  }
});

test('chooseLanguage: the resolution table (query, header, listed, unlisted, malformed)', () => {
  const pick = (q, al) => chooseLanguage(MAIN, { query: q, acceptLanguage: al }, pickAcceptLanguage);
  const T = [
    // [query, Accept-Language, file tag | null (main), by, why]
    [null, null, null, null, 'nothing said → main'],
    [null, 'ja-JP,en;q=0.5', 'ja-JP', 'header', 'header, listed'],
    [null, 'ja', 'ja-JP', 'header', 'header, same language'],
    [null, 'fr,ja;q=0.2', 'ja-JP', 'header', 'header: the unlisted range is skipped, the next one served'],
    [null, 'ja;q=0,zh-TW', 'zh-TW', 'header', 'q=0 excludes'],
    [null, 'ja;q=0.5,zh-Hant;q=0.9', 'zh-TW', 'header', 'the higher q wins over header order'],
    [null, 'en-GB,ja;q=0.9', null, 'header', 'header matches the main file’s own language → main'],
    [null, 'zh-CN', null, null, 'Simplified is never served Traditional → main'],
    [null, '*', null, null, 'wildcard → main'],
    [null, 'garbage;;;,,', null, null, 'malformed header → main'],
    ['ja-JP', 'zh-TW', 'ja-JP', 'query', '?lang= before the header'],
    ['zh-tw', null, 'zh-TW', 'query', '?lang= normalised'],
    ['en-US', 'ja', null, 'query', '?lang= naming the main file’s language → main, header not asked'],
    ['fr', 'ja', null, 'query', '?lang= unlisted → main, header not asked (the visitor said which)'],
    ['', 'ja', 'ja-JP', 'header', 'empty ?lang= is ignored'],
    ['<x>', 'ja', 'ja-JP', 'header', 'malformed ?lang= is ignored'],
  ];
  for (const [q, al, tag, by, why] of T) {
    const got = pick(q, al);
    assert.equal(got.tag, tag, `${why} (tag)`);
    assert.equal(got.by, by, `${why} (by)`);
  }
});

test('chooseLanguage: a Card with no locales: never chooses, whatever is asked', () => {
  const plain = MAIN.replace(/^locales:.*\n/m, '');
  for (const [q, al] of [[null, 'ja'], ['ja-JP', null], ['en-US', 'zh-TW']]) {
    assert.deepEqual(chooseLanguage(plain, { query: q, acceptLanguage: al }, pickAcceptLanguage), { tag: null, matched: null, by: null });
  }
});

test('chooseLanguage: the main file’s lang: need not be listed to be a candidate', () => {
  const md = MAIN.replace('locales: [en-US, ja-JP, zh-TW]', 'locales: [ja-JP]');
  assert.deepEqual(chooseLanguage(md, { acceptLanguage: 'en-AU,ja;q=0.5' }, pickAcceptLanguage), { tag: null, matched: 'en-US', by: 'header' });
  assert.deepEqual(chooseLanguage(md, { acceptLanguage: 'ja' }, pickAcceptLanguage), { tag: 'ja-JP', matched: 'ja-JP', by: 'header' });
});
