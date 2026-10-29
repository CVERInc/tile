// Simplified Chinese is its own Lingo edition (zh-CN / attr zh-Hans), not a spelling of zh-TW.
//   run: node --test packages/sitetile/lingo-simplified.test.mjs
//
// Before: _canon folded every Chinese tag into zh-TW, so `locales: zh-TW, zh-CN` was ONE language —
// lingoEnabled false, no hreflang alternates, no banner, no Language link — and a zh-CN page said
// <html lang="zh-Hant">. Identity changes; chrome copy (uiCopy, dateHeading) deliberately does not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './locale.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(join(HERE, 'astro/src/layouts/SiteLayout.astro'), 'utf8');
const SIMPLIFIED = ['zh-CN', 'zh-cn', 'ZH-CN', 'zh-Hans', 'zh-hans', 'zh-SG', 'zh-Hans-CN', 'zh-Hans-SG'];
const TRADITIONAL = ['zh-TW', 'zh-tw', 'zh-Hant', 'zh-Hant-TW', 'zh-Hant-CN', 'zh-HK', 'zh-MO', 'zh'];

test('two editions: zh-TW + zh-CN / zh-Hans is a bilingual site; spellings of one edition are not', () => {
  assert.equal(L.lingoEnabled({ locales: 'zh-TW, zh-CN' }), true);
  assert.equal(L.lingoEnabled({ locales: 'zh-TW, zh-Hans' }), true);
  assert.equal(L.lingoEnabled({ locales: 'zh-CN, zh-Hans' }), false);
  assert.equal(L.lingoEnabled({ locales: 'zh-cn, zh-SG, zh-Hans-CN' }), false);
  assert.equal(L.lingoEnabled({ locales: 'zh-TW, zh-Hant' }), false);
  assert.equal(L.lingoEnabled({ locales: 'zh-TW, zh-HK, zh' }), false);
  assert.equal(L.sameLocale('zh-CN', 'zh-TW'), false);
  assert.equal(L.sameLocale('zh-Hans', 'zh-cn'), true);
  assert.equal(L.sameLocale('zh', 'zh-CN'), false, 'bare zh keeps its zh-TW reading');
  assert.equal(L.localeOf('zh-TW, zh-CN', 'zh-Hans'), 'zh-CN');
  assert.equal(L.localeOf('zh-TW, zh-CN', 'zh-Hant'), 'zh-TW');
});

test('toBcp47 / label: Simplified spellings -> zh-Hans / 简体中文; Traditional unchanged', () => {
  for (const s of SIMPLIFIED) { assert.equal(L.toBcp47(s), 'zh-Hans', s); assert.equal(L.label(s), '简体中文', s); }
  for (const s of TRADITIONAL) { assert.equal(L.toBcp47(s), 'zh-Hant', s); assert.equal(L.label(s), '繁體中文', s); }
  assert.equal(L.toBcp47('en-US'), 'en');
  assert.equal(L.toBcp47('fr-FR'), 'fr-FR', 'unknown passes through');
  assert.equal(L.label('ko'), '한국어');
});

test('prefixes: Simplified option matches zh-cn/zh-sg/zh-hans; zh-TW gives up bare zh only beside a Simplified edition', () => {
  assert.deepEqual(L.prefixes('zh-CN'), ['zh-cn', 'zh-sg', 'zh-hans']);
  assert.deepEqual(L.prefixes('zh-TW'), ['zh']);
  assert.deepEqual(L.prefixes('zh-TW', ['en-US', 'ja-JP']), ['zh']);
  assert.deepEqual(L.prefixes('zh-TW', ['zh-TW', 'zh-Hans']), ['zh-tw', 'zh-hant', 'zh-hk', 'zh-mo']);
  assert.deepEqual(L.prefixes('en-US', ['zh-CN']), ['en']);
});

test('banner and /language copy: Simplified has its own rows; Traditional rows are untouched', () => {
  for (const s of SIMPLIFIED) {
    assert.deepEqual(L.bannerCopy(s), { prompt: '改用简体中文阅读也许更顺？', continue: '好啊', dismiss: '先不用没关系' }, s);
    assert.deepEqual(L.languageCopy(s), { word: '语言', prompt: '请选择你想在此网站使用的语言。', current: '当前', switch: '切换' }, s);
  }
  assert.deepEqual(L.bannerCopy('zh-TW'), { prompt: '改用台灣華語讀也許更順？', continue: '好啊', dismiss: '先不用沒關係' });
  assert.deepEqual(L.languageCopy('zh-Hant'), { word: '語言', prompt: '請選擇你想在此網站使用的語言。', current: '目前', switch: '切換' });
});

test('alternateLocales / suggestionBanner: a zh-TW + zh-CN site offers both editions, matched per R6', () => {
  const locales = ['zh-TW', 'zh-CN'];
  const alt = L.alternateLocales({ locales, defaultLocale: 'zh-TW', all: true });
  assert.deepEqual(alt, ['zh-TW', 'zh-CN']);
  const fromTw = L.suggestionBanner({ locales, lang: 'zh-Hant', defaultLocale: 'zh-TW', altLocales: alt });
  assert.equal(fromTw.current, 'zh-tw');
  assert.deepEqual(fromTw.options.map((o) => o.id), ['zh-cn']);
  assert.deepEqual(fromTw.options[0].match, ['zh-cn', 'zh-sg', 'zh-hans']);
  assert.equal(fromTw.options[0].prompt, '改用简体中文阅读也许更顺？');
  const fromCn = L.suggestionBanner({ locales, lang: 'zh-Hans', defaultLocale: 'zh-TW', altLocales: alt });
  assert.equal(fromCn.current, 'zh-cn', 'the Simplified page never offers itself');
  assert.deepEqual(fromCn.options.map((o) => o.id), ['zh-tw']);
  assert.deepEqual(fromCn.options[0].match, ['zh-tw', 'zh-hant', 'zh-hk', 'zh-mo'], 'no bare zh');
  assert.equal(fromCn.options[0].prompt, L.bannerCopy('zh-TW').prompt);
  // A site without a Simplified edition keeps bare zh.
  const en = L.suggestionBanner({ locales: ['en-US', 'zh-TW'], lang: 'en-US', defaultLocale: 'en-US', altLocales: ['en-US', 'zh-TW'] });
  assert.deepEqual(en.options[0].match, ['zh']);
});

test('bannerOverrides: a zh-cn key lands under zh-CN and leaves zh-TW copy alone', () => {
  const locales = ['zh-TW', 'zh-CN'];
  for (const spell of ['zh-cn', 'zh-CN', 'zh-hans']) {
    const { copy, warnings } = L.bannerOverrides({ [`locales-banner-${spell}-prompt`]: '请切换' }, locales);
    assert.deepEqual(warnings, [], spell);
    assert.deepEqual(copy, { 'zh-CN': { prompt: '请切换' } }, spell);
    const b = L.suggestionBanner({ locales, lang: 'zh-Hant', defaultLocale: 'zh-TW', altLocales: locales, copy });
    assert.equal(b.options[0].prompt, '请切换');
    assert.equal(b.options[0].continue, '好啊');
  }
  const tw = L.bannerOverrides({ 'locales-banner-zh-tw-prompt': '請切換' }, locales).copy;
  assert.deepEqual(tw, { 'zh-TW': { prompt: '請切換' } });
  const b = L.suggestionBanner({ locales, lang: 'zh-Hans', defaultLocale: 'zh-TW', altLocales: locales, copy: tw });
  assert.equal(b.options[0].prompt, '請切換');
  // Undeclared on a zh-TW-only site: still ignored with the undeclared-locale finding.
  const r = L.bannerOverrides({ 'locales-banner-zh-cn-prompt': 'x' }, ['en-US', 'zh-TW']);
  assert.deepEqual(r.findings, [{ key: 'locales-banner-zh-cn-prompt', reason: 'undeclared-locale' }]);
});

test('R8: LINGO_LOCALES and LINGO_LABELS keep exactly their four entries', () => {
  assert.deepEqual(L.LINGO_LOCALES, ['en-US', 'ja-JP', 'zh-TW', 'ko-KR']);
  assert.deepEqual(Object.keys(L.LINGO_LABELS), ['en-US', 'ja-JP', 'zh-TW', 'ko-KR']);
  assert.equal(L.LINGO_LABELS['zh-TW'], '繁體中文');
});

// R7 differential. For a Simplified spelling every chrome-copy lookup must equal what the base
// helper gave it: the zh-TW row (the base folded all Chinese into zh-TW). Literals pin the row
// itself so "both changed together" cannot pass.
const plainUi = (loc) => {
  const c = L.uiCopy(loc);
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    out[k] = typeof v === 'function' ? [v(1), v(7), v(12), v('ab', 3)] : v;
  }
  out.shareTo = c.shareTo('X'); out.pageSuffix = c.pageSuffix(2);
  return out;
};

test('R7: uiCopy / dateHeading give a Simplified spelling the zh-TW output, byte for byte', () => {
  const want = plainUi('zh-TW');
  assert.equal(want.recent, '最新文章');
  assert.equal(want.archive, '所有貼文');
  assert.equal(want.notFoundTitle, '找不到頁面');
  for (const s of SIMPLIFIED) {
    assert.deepEqual(plainUi(s), want, s);
    assert.equal(L.uiCopy(s).count('x', 5), 'x（5）', s);
    assert.equal(L.dateHeading(s, 2026, 7), '2026 年 7 月', s);
    assert.equal(L.dateHeading(s, 2026), '2026 年', s);
    assert.equal(L.dateHeading(s, 2026, 7), L.dateHeading('zh-TW', 2026, 7));
  }
  assert.equal(L.dateHeading('en-US', 2026, 7), 'July 2026');
  assert.equal(L.dateHeading('ja-JP', 2026, 7), '2026年7月');
  assert.equal(L.dateHeading('ko-KR', 2026, 7), '2026년 7월');
});

test('R7: inboxFormCopy keeps its own Simplified/Traditional table (does not read the identity)', () => {
  assert.deepEqual(L.inboxFormCopy('zh-Hans'), L.inboxFormCopy('zh-CN'));
  assert.notDeepEqual(L.inboxFormCopy('zh-CN'), L.inboxFormCopy('zh-TW'));
});

// Layout-level: SiteLayout is an Astro template (no cheap render here — see lingo-switch.test.mjs),
// so pin the wiring it uses and evaluate those same helper calls on a zh-TW + zh-CN site.
test('SiteLayout on a zh-TW + zh-CN site: hasLingo, hreflang zh-Hant/zh-Hans, Language link', () => {
  assert.match(layout, /const hasLingo = lingo\.lingoEnabled\(\{ packages, locales \}\);/);
  assert.match(layout, /const localeTag = \(l\) => \(hasLingo \? lingo\.toBcp47\(l\) : l\);/);
  assert.match(layout, /<link rel="alternate" hreflang=\{localeTag\(l\)\}/);
  assert.match(layout, /const multilingual = hasLingo && locales\.length > 1;/);

  const meta = { locales: 'zh-TW, zh-CN', lang: 'zh-Hant' };
  const locales = L.parseLocales(meta.locales);
  const hasLingo = L.lingoEnabled({ packages: [], locales });
  assert.equal(hasLingo, true);
  const multilingual = hasLingo && locales.length > 1;
  const defaultLocale = L.defaultLocaleOf(locales, meta.lang);
  const altLocales = L.alternateLocales({ locales, defaultLocale, subPath: '', contentRels: ['home', 'zh-cn/home'] });
  assert.deepEqual(altLocales.map((l) => L.toBcp47(l)), ['zh-Hant', 'zh-Hans']);
  // /zh-cn/ page: <html lang>, URL prefix of the Language link, the chooser's own labels.
  const cnLang = 'zh-CN';
  assert.equal(L.toBcp47(cnLang), 'zh-Hans');
  const pageLocale = L.localeOf(locales, cnLang);
  const langUrlPrefix = multilingual && !L.sameLocale(pageLocale, defaultLocale) ? `/${L.toUrlLocale(pageLocale)}` : '';
  assert.equal(langUrlPrefix, '/zh-cn');
  assert.equal(multilingual, true);
  assert.deepEqual(locales.map((l) => L.label(l)), ['繁體中文', '简体中文']);
  assert.equal(L.languageCopy(pageLocale).word, '语言');
  // x-default guard from the layout: the default must be among the measured alternates.
  assert.ok(altLocales.includes(defaultLocale));
  // Control: the same site spelled as ONE edition stays un-installed.
  assert.equal(L.lingoEnabled({ locales: 'zh-TW, zh-Hant' }), false);
});

test('three locales zh-TW, zh-CN, ja-JP: the zh-CN page keeps its own html lang, hreflang and banner identity', () => {
  const locales = L.parseLocales('zh-TW, zh-CN, ja-JP');
  assert.equal(L.lingoEnabled({ locales }), true);
  const defaultLocale = 'zh-TW';
  const alt = L.alternateLocales({ locales, defaultLocale, all: true });
  const tags = alt.map((l) => L.toBcp47(l));
  assert.deepEqual(tags, ['zh-Hant', 'zh-Hans', 'ja']);
  assert.equal(new Set(tags).size, 3, 'no duplicate hreflang');
  assert.equal(L.toBcp47(alt.find((l) => L.toUrlLocale(l) === 'zh-cn')), 'zh-Hans');
  for (const lang of ['zh-CN', 'zh-Hans']) {
    assert.equal(L.toBcp47(lang), 'zh-Hans', `<html lang> for ${lang}`);
    assert.equal(L.localeOf(locales, lang), 'zh-CN', lang);
    const b = L.suggestionBanner({ locales, lang, defaultLocale, altLocales: alt });
    assert.equal(b.current, 'zh-cn', lang);
    assert.deepEqual(b.options.map((o) => o.id), ['zh-tw', 'ja-jp'], lang);
  }
});
