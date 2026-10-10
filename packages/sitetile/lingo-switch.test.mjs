// The Lingo install switch is DERIVED from `locales`, and defined in exactly one place.
//   run: node packages/sitetile/lingo-switch.test.mjs
//
// 🩸 2026-10-11. The renderer gated the whole bilingual install — lowercase locale URLs, BCP-47
// hreflang, x-default, the /language chooser, the columned footer's Language link — on
// `packages.includes('lingo')`, in two files. The platform's docs told owners "the second language
// is free, no Lingo module needed", and nothing on the platform ever wrote `packages: lingo`. So a
// site that declared `locales: en, zh-TW` exactly as told built hreflang to /en/ and /zh-TW/ (both
// 404), no Language link and no /language page — worse than staying monolingual. Measured on six
// fixture builds (A/A0/A0nocols/B/B0/C): the ones without `packages: lingo` broke, every time.
//
// Owner ruling 2026-10-10: the switch is the owner declaring a second language (`locales` ≥ 2).
// Free, not forced: a one-locale site stays un-installed. `packages: lingo` is still honoured.
//
// The fixture builds are too heavy for this suite (one `astro build` per fixture). What is pinned
// here is the decision (lingoEnabled), the spelling rule that broke fixture C (sameLocale /
// localeOf), and the WIRING — that both gates call the one helper and nobody re-derives it inline.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lingoMod from './astro/src/packages/lingo/locale.mjs';
import { lingoEnabled, sameLocale, localeOf, toUrlLocale } from './astro/src/packages/lingo/locale.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro/src');
const layout = readFileSync(join(SRC, 'layouts/SiteLayout.astro'), 'utf8');
const language = readFileSync(join(SRC, 'pages/[...loc]/language.astro'), 'utf8');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// The six probe fixtures, as the two inputs the switch reads (frontmatter strings, as written).
const FIX = {
  A:        { locales: 'en, zh-TW',    packages: 'lingo' },
  A0:       { locales: 'en, zh-TW',    packages: '' },        // the reported site, as it stands
  A0nocols: { locales: 'en, zh-TW',    packages: '' },
  B:        { locales: 'en-US, zh-TW', packages: 'lingo' },
  B0:       { locales: 'en-US, zh-TW', packages: '' },
  C:        { locales: 'en-US, zh-TW', packages: 'lingo' },
};

test('🔴 a declared second language turns Lingo on — packages: lingo is not required', () => {
  for (const [name, f] of Object.entries(FIX)) assert.equal(lingoEnabled(f), true, name);
});

test('the control: A0 and B0 really differ from A and B only in packages (else the case above proves nothing)', () => {
  assert.equal(FIX.A0.locales, FIX.A.locales); assert.equal(FIX.A0.packages, '');
  assert.equal(FIX.B0.locales, FIX.B.locales); assert.equal(FIX.B0.packages, '');
  // …and the OLD rule, written out as it was, says off for exactly those.
  const oldRule = (f) => String(f.packages || '').includes('lingo');
  assert.deepEqual(Object.keys(FIX).filter((k) => !oldRule(FIX[k])), ['A0', 'A0nocols', 'B0']);
});

test('free, not forced: one locale (or none) stays off', () => {
  assert.equal(lingoEnabled({ locales: 'en' }), false);
  assert.equal(lingoEnabled({ locales: '' }), false);
  assert.equal(lingoEnabled({}), false);
  assert.equal(lingoEnabled({ locales: 'en, , ' }), false, 'empty entries are not languages');
  assert.equal(lingoEnabled({ locales: 'en', packages: 'pwa, blog' }), false, 'other packages do not switch it');
});

test('packages: lingo is still honoured on its own (back-compat)', () => {
  assert.equal(lingoEnabled({ locales: 'en', packages: 'lingo' }), true);
  assert.equal(lingoEnabled({ packages: 'pwa , lingo' }), true, 'whitespace trimmed');
});

test('arrays and frontmatter strings are the same input (SiteLayout passes arrays, the route passes meta)', () => {
  assert.equal(lingoEnabled({ locales: ['en', 'zh-TW'], packages: [] }), true);
  assert.equal(lingoEnabled({ locales: ['en'], packages: ['lingo'] }), true);
  assert.equal(lingoEnabled({ locales: ['en'], packages: ['pwa'] }), false);
});

test('🔴 en ≡ en-US: one locale, two correct spellings (fixture C)', () => {
  assert.equal(sameLocale('en', 'en-US'), true);
  assert.equal(sameLocale('en-us', 'en-US'), true);
  assert.equal(sameLocale('zh-Hant', 'zh-TW'), true);
  assert.equal(sameLocale('zh-tw', 'zh-TW'), true);
  assert.equal(sameLocale('en', 'zh-TW'), false);
  assert.equal(sameLocale('fr', 'FR'), true, 'unknown codes: case-insensitive');
  assert.equal(sameLocale('fr', 'pt-BR'), false);
});

test('🔴 localeOf: a page\'s lang resolves to the entry in locales, so URL prefixes come from the list', () => {
  // Fixture C's root page: lang: en, locales: en-US, zh-TW. The URL form must be en-us — the
  // default — so the footer link has no prefix. Before, toUrlLocale('en') = 'en' ≠ 'en-us' and
  // every root page linked /en/language (404).
  assert.equal(localeOf('en-US, zh-TW', 'en'), 'en-US');
  assert.equal(toUrlLocale(localeOf(['en-US', 'zh-TW'], 'en')), 'en-us');
  assert.equal(localeOf(['en-US', 'zh-TW'], 'zh-Hant'), 'zh-TW', 'not zh-hant — there is no /zh-hant/');
  assert.equal(localeOf(['en', 'zh-TW'], 'fr'), 'fr', 'no match → the lang itself');
});

test('🔴 a locale listed twice is one language, not two', () => {
  assert.equal(lingoEnabled({ locales: 'zh-TW, zh-TW' }), false, 'exact duplicate');
  assert.equal(lingoEnabled({ locales: 'zh-TW, zh-tw' }), false, 'same locale, different case');
  assert.equal(lingoEnabled({ locales: ['en', 'en-US'] }), false, 'two spellings of one locale');
  assert.equal(lingoEnabled({ locales: 'fr, FR' }), false, 'unknown codes dedupe case-insensitively');
  // the control: a real second language among the duplicates still counts.
  assert.equal(lingoEnabled({ locales: 'zh-TW, zh-tw, en-US' }), true);
});

test('🔴 packages is matched by exact entry — a name that merely contains "lingo" is not Lingo', () => {
  assert.equal(lingoEnabled({ packages: 'bilingo' }), false);
  assert.equal(lingoEnabled({ packages: 'pwa, lingo-extras' }), false);
  assert.equal(lingoEnabled({ packages: ['bilingo'], locales: ['en'] }), false);
  assert.equal(lingoEnabled({ packages: 'bilingo, lingo' }), true, 'the control: the exact entry still switches it');
});

// ── the suggestion banner offers only what exists ───────────────────────────────────────────
// 🩸 2026-10-11. The banner's options were built from `locales` — every DECLARED language — while
// the hreflang set and the footer link's `?has=` on the same page were built from the measured
// set (the locales this page really exists in). So a page that existed only in the default
// language still asked an English-browser visitor "Easier to read in English?", and the answer
// was a 404. Deriving the switch from `locales` put that banner on every site the moment it
// declared a second language, which is exactly when most of its pages are not translated yet.
const banner = (o) => {
  assert.equal(typeof lingoMod.suggestionBanner, 'function', 'locale.mjs exports suggestionBanner()');
  return lingoMod.suggestionBanner(o);
};
const ids = (b) => b.options.map((o) => o.id);
const FOUR = ['en-US', 'zh-TW', 'ja-JP', 'ko-KR'];

test('🔴 banner options are the locales this page EXISTS in, minus the one being read', () => {
  // four declared, the page exists in two (the realistic "home everywhere, inner pages partly").
  const b = banner({ locales: FOUR, lang: 'en-US', defaultLocale: 'en-US', altLocales: ['en-US', 'zh-TW'] });
  assert.deepEqual(ids(b), ['zh-tw'], 'ja-jp and ko-kr are declared but have no such page');
  assert.equal(b.current, 'en-us');
  assert.equal(b.defaultLocale, 'en-us');
  assert.equal(b.hrefStrategy, 'prefix');
  assert.deepEqual(b.options[0].match, ['zh']);
  assert.ok(b.options[0].prompt && b.options[0].continue && b.options[0].dismiss, 'each option carries its own copy');
});

test('🔴 a page that exists in one language only gets no banner at all', () => {
  assert.equal(banner({ locales: FOUR, lang: 'en-US', defaultLocale: 'en-US', altLocales: ['en-US'] }), null);
  assert.equal(banner({ locales: FOUR, lang: 'ja', defaultLocale: 'en-US', altLocales: ['ja-JP'] }), null, 'a locale-only page, lang in BCP-47');
  assert.equal(banner({ locales: FOUR, lang: 'en-US', defaultLocale: 'en-US', altLocales: [] }), null, 'a generated route: nothing measured');
  assert.equal(banner({ locales: ['en-US'], lang: 'en-US', defaultLocale: 'en-US', altLocales: ['en-US'] }), null, 'one declared locale');
});

test('🔴 the page\'s own locale is resolved through `locales`, so `lang: zh-Hant` is zh-tw and never offers itself', () => {
  const b = banner({ locales: FOUR, lang: 'zh-Hant', defaultLocale: 'en-US', altLocales: ['en-US', 'zh-TW'] });
  assert.equal(b.current, 'zh-tw', 'not zh-hant — there is no /zh-hant/');
  assert.deepEqual(ids(b), ['en-us'], 'the page being read is not an option');
});

test('🔴 SiteLayout builds the banner from the measured set — the one hreflang and ?has= read', () => {
  assert.match(layout, /const localeBanner = hasLingo\s*\?\s*lingo\.suggestionBanner\(\{ locales, lang, defaultLocale, altLocales: bannerSet \}\)\s*:\s*null;/);
  // …where bannerSet is that measured set, unless a generated blog route measured its own.
  assert.match(layout, /const bannerSet = Array\.isArray\(bannerLocales\) \? bannerLocales\.filter\(Boolean\) : altLocales;/);
});

// ── wiring ──────────────────────────────────────────────────────────────────────────────────
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : /\.(astro|mjs|js|ts)$/.test(n) ? [p] : [];
});

test('🔴 SiteLayout\'s hasLingo IS the helper', () => {
  assert.match(layout, /const hasLingo = lingo\.lingoEnabled\(\{ packages, locales \}\);/);
});

test('🔴 the /language route uses the same helper, on the root home\'s meta', () => {
  assert.match(language, /if \(!rootHome \|\| !lingoEnabled\(rootHome\)\) return \[\];/);
});

test('🔴 nobody re-derives the switch inline — one definition, in locale.mjs', () => {
  // Every way this codebase has spelled the old gate: array.includes('lingo') and the meta-string
  // substring form. A third copy is how the two that existed drifted from the docs unnoticed.
  const GATE = /includes\(\s*['"]lingo['"]\s*\)/;
  const hits = walk(SRC)
    .filter((p) => GATE.test(readFileSync(p, 'utf8')))
    .map((p) => relative(SRC, p));
  assert.deepEqual(hits, ['packages/lingo/locale.mjs'], `inline Lingo gates found:\n${hits.join('\n')}`);
});

test('🔴 the /language default is SiteLayout\'s rule (locales[0]), not the root home\'s raw lang:', () => {
  assert.match(language, /const defaultLocale = locales\[0\] \|\| String\(rootHome\.lang/);
  assert.match(layout, /const defaultLocale = \(locales\[0\] \|\| lang \|\| ''\)\.trim\(\);/,
    'and SiteLayout still says the same thing — if this moves, move the route with it');
});

test('🔴 SiteLayout derives the page\'s URL prefix from localeOf, not the raw lang:', () => {
  assert.match(layout, /const pageLocale = lingo\.localeOf\(locales, lang\);/);
  assert.match(layout, /const langUrlPrefix = hasLingo && !lingo\.sameLocale\(pageLocale, defaultLocale\)/);
  assert.doesNotMatch(layout, /lingo\.toUrlLocale\(lang\) !== defaultUrlLocale/, 'the old raw comparison is gone');
});

console.log(`\n${passed} passed`);
