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
import { lingoEnabled, sameLocale, localeOf, toUrlLocale, parseLocales, defaultLocaleOf, rootLangMismatch, LocaleListError } from './astro/src/packages/lingo/locale.mjs';

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

// 🩸 2026-10-11. A generated blog route measures its own other editions (which locales build this
// url) and hands them over as `routeLocales`. SiteLayout let that answer REPLACE the one measured
// from content files. On a root-mounted blog `/` is the blog index, and a second language with no
// posts yet but a home page of its own (content/<loc>.md) was known to the content measurement —
// the same page emitted hreflang to it — and unknown to the route's. Replaced, the home page of
// such a site lost its banner while its other edition existed. Two measurements of "this page
// exists there" are both true: the answer is their union.
test('🔴 a route\'s own measurement ADDS to the content one — neither replaces the other', () => {
  const two = ['zh-TW', 'en-US'];
  // root-mounted blog index: the route found no other edition, content found /en-us/ (a home page).
  const fromContent = banner({ locales: two, lang: 'zh-Hant', defaultLocale: 'zh-TW', altLocales: two, routeLocales: ['zh-TW'] });
  assert.ok(fromContent, 'the content measurement still counts when the route also answered');
  assert.deepEqual(ids(fromContent), ['en-us']);
  // an ordinary blog post: no content file anywhere, the route found the translation.
  const fromRoute = banner({ locales: two, lang: 'zh-Hant', defaultLocale: 'zh-TW', altLocales: [], routeLocales: two });
  assert.ok(fromRoute, 'the route measurement counts when content found nothing');
  assert.deepEqual(ids(fromRoute), ['en-us']);
  // neither found another edition → still no banner; a union must not invent one.
  assert.equal(banner({ locales: two, lang: 'zh-Hant', defaultLocale: 'zh-TW', altLocales: [], routeLocales: ['zh-TW'] }), null);
  assert.equal(banner({ locales: two, lang: 'zh-Hant', defaultLocale: 'zh-TW', altLocales: ['zh-TW'], routeLocales: [] }), null);
});

test('the union keeps `locales` order and lists a locale once, whichever measurement found it', () => {
  const b = banner({ locales: FOUR, lang: 'en-US', defaultLocale: 'en-US', altLocales: ['en-US', 'ko-KR', 'zh-TW'], routeLocales: ['ja-JP', 'zh-TW'] });
  assert.deepEqual(ids(b), ['zh-tw', 'ja-jp', 'ko-kr']);
});

test('no route measurement (every non-blog page) → the content set, untouched, in the order given', () => {
  const b = banner({ locales: FOUR, lang: 'en-US', defaultLocale: 'en-US', altLocales: ['ko-KR', 'zh-TW'] });
  assert.deepEqual(ids(b), ['ko-kr', 'zh-tw'], 'an archive route hands its own list as altLocales; it is not re-sorted');
});

test('🔴 SiteLayout hands the banner BOTH measurements — content (altLocales) and the route\'s own', () => {
  assert.match(layout, /const localeBanner = hasLingo\s*\?\s*lingo\.suggestionBanner\(\{ locales, lang, defaultLocale, altLocales, routeLocales: bannerLocales \}\)\s*:\s*null;/);
  // …and does not pick between them itself: the choice that lost a banner was made right here.
  assert.doesNotMatch(layout, /Array\.isArray\(bannerLocales\)/);
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

test('🔴 the /language default and SiteLayout\'s are the ONE definition, not two spellings of it', () => {
  assert.match(language, /const defaultLocale = defaultLocaleOf\(locales, rootHome\.lang\);/);
  assert.match(layout, /const defaultLocale = lingo\.defaultLocaleOf\(locales, lang\);/,
    'and SiteLayout says the same thing — if this moves, move the route with it');
});

test('🔴 SiteLayout derives the page\'s URL prefix from localeOf, not the raw lang:', () => {
  assert.match(layout, /const pageLocale = lingo\.localeOf\(locales, lang\);/);
  assert.match(layout, /const langUrlPrefix = multilingual && !lingo\.sameLocale\(pageLocale, defaultLocale\)/);
  assert.doesNotMatch(layout, /lingo\.toUrlLocale\(lang\) !== defaultUrlLocale/, 'the old raw comparison is gone');
});

// ── CVERInc/reef#1910: one parser for `locales`, one definition of the default ──────────────
// 🩸 Eleven places split `locales` on commas themselves and nine took the first entry (or, in one
// of them, the site config's `lang:` BEFORE it). The frontmatter reader is not YAML and hands the
// value over verbatim, so each copy turned `[zh-TW, en-US]` into a directory called `en-us]`.

test('🔴 parseLocales: the three list spellings a site writes are the same list', () => {
  const want = ['zh-TW', 'en-US'];
  assert.deepEqual(parseLocales('zh-TW, en-US'), want);
  assert.deepEqual(parseLocales('[zh-TW, en-US]'), want, 'inline array');
  assert.deepEqual(parseLocales('"zh-TW, en-US"'), want, 'one quoted string');
  assert.deepEqual(parseLocales('["zh-TW", \'en-US\']'), want, 'quoted entries in an array');
  assert.deepEqual(parseLocales(['zh-TW', 'en-US']), want, 'an array, as SiteLayout passes it on');
  // The control for the case above: uneven on purpose, so a parser that kept only the first or only
  // the last entry, or lower-cased them, would be caught.
  assert.deepEqual(parseLocales(' ko-KR ,ja-JP,en '), ['ko-KR', 'ja-JP', 'en']);
});

test('🔴 parseLocales: an empty entry is skipped and a repeated one is kept once, first spelling', () => {
  assert.deepEqual(parseLocales('zh-TW, en-US,'), ['zh-TW', 'en-US'], 'trailing comma');
  assert.deepEqual(parseLocales('zh-TW,, en-US'), ['zh-TW', 'en-US']);
  assert.deepEqual(parseLocales('zh-TW, en-US, zh-TW'), ['zh-TW', 'en-US'], 'the same code twice');
  // Different case is the same URL segment (/zh-tw/) — one directory, written twice.
  assert.deepEqual(parseLocales('zh-TW, zh-tw, ja-JP'), ['zh-TW', 'ja-JP']);
  assert.deepEqual(parseLocales('zh-tw, zh-TW'), ['zh-tw'], 'first spelling wins, whichever it is');
  for (const empty of ['', '  ', ',', '[]', '""', undefined, null]) assert.deepEqual(parseLocales(empty), [], JSON.stringify(empty));
});

test('🔴 parseLocales: anything that is not a locale code is refused BY NAME, never made a path', () => {
  const refused = ['../kiln', 'ko/kr', '..', 'en-US/', '/ja-JP', 'zh_TW', 'en US', 'zh"TW', 'en-', '-en', 'en--US',
    'zh-TW;ja-JP', 'en.US', 'ja\\JP', '%2e%2e', 'en-US?x', 'zh-TW#', '日本語'];
  for (const bad of refused) {
    assert.throws(() => parseLocales(`zh-TW, ${bad}`), (e) => {
      assert.ok(e instanceof LocaleListError, `${bad}: not a LocaleListError`);
      assert.equal(e.name, 'LocaleListError');
      assert.ok(e.message.includes(JSON.stringify(bad)), `${bad}: the message does not name the entry — ${e.message}`);
      return true;
    }, bad);
  }
  // The control: the same call with a real code in that position does not throw.
  assert.deepEqual(parseLocales('zh-TW, ko-KR'), ['zh-TW', 'ko-KR']);
  assert.deepEqual(parseLocales('zh-Hant-TW, es-419, en'), ['zh-Hant-TW', 'es-419', 'en']);
});

test('🔴 defaultLocaleOf: the first declared locale, else the caller\'s own fallback', () => {
  assert.equal(defaultLocaleOf('ja-JP, en-US, zh-TW'), 'ja-JP');
  assert.equal(defaultLocaleOf('[ko-KR, en]', 'zh-Hant'), 'ko-KR', 'a declared locale outranks the fallback');
  assert.equal(defaultLocaleOf('', ' zh-Hant '), 'zh-Hant');
  assert.equal(defaultLocaleOf(undefined), '');
});

test('🔴 nobody splits `locales` or takes its first entry inline — one parser, one default', () => {
  const SPLIT = /locales\b[^\n;]*\.split\(\s*['"],['"]\s*\)/;
  const FIRST = /[lL]ocales\[0\]/;
  const code = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const hits = walk(SRC).filter((p) => { const c = code(p); return SPLIT.test(c) || FIRST.test(c); }).map((p) => relative(SRC, p));
  assert.deepEqual(hits, [], `inline locale-list handling found:\n${hits.join('\n')}`);
  // The control: the same two patterns DO see the spellings that were removed.
  assert.ok(SPLIT.test("const locales = String(meta.locales || '').split(',').map((s) => s.trim());"));
  assert.ok(FIRST.test("const defaultLocale = locales[0] || '';") && FIRST.test('const d = blogLocales[0];'));
});

test('🔴 rootLangMismatch: names both values and says which one wins; silent when they agree', () => {
  const msg = rootLangMismatch({ locales: 'en-US, zh-TW', rootLang: 'zh-Hant' });
  assert.match(msg, /^sitetile: /, 'the build log\'s own prefix');
  assert.ok(msg.includes('lang: zh-Hant') && msg.includes('en-US first'), msg);
  assert.match(msg, /en-US wins/);
  assert.ok(msg.includes('/zh-tw/'), 'and where the home page\'s language is expected instead');
  // Two correct spellings of one locale are not a disagreement.
  assert.equal(rootLangMismatch({ locales: 'en-US, zh-TW', rootLang: 'en' }), null);
  assert.equal(rootLangMismatch({ locales: 'zh-TW, ja-JP', rootLang: 'zh-Hant' }), null);
  assert.equal(rootLangMismatch({ locales: 'ja-JP, ko-KR', rootLang: '' }), null, 'a home page that says nothing');
  assert.equal(rootLangMismatch({ locales: '', rootLang: 'ko' }), null, 'a site that declares nothing');
});

test('🔴 SiteLayout: alternates, the chooser link and its prefix all wait for a SECOND locale', () => {
  assert.match(layout, /const multilingual = hasLingo && locales\.length > 1;/);
  assert.match(layout, /const altLocales = !multilingual \? \[\] :/);
  assert.match(layout, /const computedLanguageHref = multilingual\s*\?/);
  assert.match(layout, /\{multilingual && defaultLocale && altLocales\.includes\(defaultLocale\) && <link rel="alternate" hreflang="x-default"/);
  assert.doesNotMatch(layout, /locales\.length > 0 && <a class="rf-lang"/, 'the plain footer no longer links on one locale');
});

console.log(`\n${passed} passed`);
