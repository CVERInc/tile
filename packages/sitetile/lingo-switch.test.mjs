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
import { lingoEnabled, sameLocale, localeOf, toUrlLocale, parseLocales, defaultLocaleOf, rootLangMismatch, LocaleListError, tagLocalesSource, localesSourceOf, pageLocalesOrWarn } from './astro/src/packages/lingo/locale.mjs';

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
  assert.match(layout, /const localeBanner = hasLingo\s*\?\s*lingo\.suggestionBanner\(\{ locales, lang, defaultLocale, altLocales, routeLocales: bannerLocales, copy: bannerCopyOverrides \}\)\s*:\s*null;/);
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

// An entry as an error message shows it: JSON's quoting for printable ASCII, `\u{…}` for the rest.
const shown = (s) => `"${[...s].map((ch) => {
  const cp = ch.codePointAt(0);
  if (ch === '\\' || ch === '"') return `\\${ch}`;
  return cp >= 0x20 && cp <= 0x7e ? ch : `\\u{${cp.toString(16).toUpperCase().padStart(4, '0')}}`;
}).join('')}"`;
const refusal = (value, source) => {
  try { parseLocales(value, source); } catch (e) { assert.ok(e instanceof LocaleListError, String(e)); return e.message; }
  assert.fail(`${JSON.stringify(value)} was accepted`);
};

test('🔴 parseLocales: anything that is not a locale code is refused BY NAME, never made a path', () => {
  const refused = ['../kiln', 'ko/kr', '..', 'en-US/', '/ja-JP', 'zh_TW', 'en US', 'zh"TW', 'en-', '-en', 'en--US',
    'zh-TW;ja-JP', 'en.US', 'ja\\JP', '%2e%2e', 'en-US?x', 'zh-TW#', '日本語'];
  for (const bad of refused) {
    assert.throws(() => parseLocales(`zh-TW, ${bad}`), (e) => {
      assert.ok(e instanceof LocaleListError, `${bad}: not a LocaleListError`);
      assert.equal(e.name, 'LocaleListError');
      assert.ok(e.message.includes(shown(bad)), `${bad}: the message does not name the entry — ${e.message}`);
      return true;
    }, bad);
  }
  // The control: the same call with a real code in that position does not throw.
  assert.deepEqual(parseLocales('zh-TW, ko-KR'), ['zh-TW', 'ko-KR']);
  assert.deepEqual(parseLocales('zh-Hant-TW, es-419, en'), ['zh-Hant-TW', 'es-419', 'en']);
});

test('🔴 parseLocales: what a keyboard puts AROUND a code is not a reason to fail a build', () => {
  const want = ['en-US', 'zh-TW'];
  // Invisible or whitespace-class characters beside an entry: dropped, like an ordinary space.
  for (const [name, pad] of [['zero-width space', '​'], ['BOM', '﻿'], ['no-break space', ' '],
    ['ideographic space', '　'], ['zero-width joiner', '‍'], ['left-to-right mark', '‎'], ['word joiner', '⁠']]) {
    assert.deepEqual(parseLocales(`en-US,${pad}zh-TW`), want, `${name} after the comma`);
    assert.deepEqual(parseLocales(`${pad}en-US${pad}, zh-TW${pad}`), want, `${name} around an entry`);
  }
  // The two commas a Chinese or Japanese keyboard types: separators, exactly like `,`.
  assert.deepEqual(parseLocales('en-US，zh-TW'), want, 'full-width comma');
  assert.deepEqual(parseLocales('en-US、zh-TW'), want, 'ideographic comma');
  assert.deepEqual(parseLocales('ja-JP、　en-US，​zh-TW, ko-KR'), ['ja-JP', 'en-US', 'zh-TW', 'ko-KR'], 'mixed');
  assert.deepEqual(parseLocales('[zh-TW，"en-US"]'), ['zh-TW', 'en-US'], 'with list punctuation too');
  assert.deepEqual(parseLocales('zh-TW，zh-tw、en'), ['zh-TW', 'en'], 'a repeat is still one locale');
});

test('🔴 parseLocales: the same characters INSIDE a code are refused, and the message makes them visible', () => {
  for (const [bad, escape] of [['zh​-TW', '\\u{200B}'], ['en US', '\\u{00A0}'], ['ja﻿JP', '\\u{FEFF}'], ['zh　TW', '\\u{3000}']]) {
    const msg = refusal(`en-US, ${bad}`);
    assert.ok(msg.includes(shown(bad)) && msg.includes(escape), `${escape}: not shown — ${msg}`);
    // The entry is shown ONLY escaped: the raw character is nowhere in the message.
    assert.equal(msg.includes(bad), false, `${escape}: the invisible character itself is in the message`);
  }
  // The control: an ASCII entry is quoted as written, with nothing escaped.
  assert.ok(refusal('en-US, ko/kr').includes('locales entry "ko/kr" is not a locale code'));
  assert.equal(refusal('en-US, ko/kr').includes('\\u{'), false);
});

test('🔴 parseLocales: an underscore is refused with the hyphen form offered; a comment, with the `#` named', () => {
  assert.ok(refusal('zh_TW').includes('Did you mean "zh-TW"?'));
  assert.ok(refusal('en-US，zh_Hant_TW').includes('Did you mean "zh-Hant-TW"?'), 'after a full-width comma, too');
  // …but only when the hyphen form IS a code: nothing is offered for these.
  for (const bad of ['zh_', '_en', 'ko/kr', 'en US']) assert.equal(refusal(bad).includes('Did you mean'), false, bad);
  // This frontmatter has no comments on any key, so one is not stripped here either.
  for (const line of ['en-US, zh-TW  # two languages', 'en-US # default, zh-TW', 'en-US, zh-TW #']) {
    const msg = refusal(line);
    assert.ok(msg.includes('remove the `#`'), `${line}: the message does not name the # — ${msg}`);
    assert.equal(msg.includes('Did you mean'), false);
  }
  assert.equal(refusal('ko/kr').includes('#'), false, 'the # hint is on every refusal');
});

test('🔴 parseLocales: the message names the FILE the line is in — the tag travels with `locales` through a merge', () => {
  assert.ok(refusal('zh-TW, ko/kr', 'content/_site.md').endsWith('Fix the `locales:` line in content/_site.md.'));
  assert.ok(refusal('zh-TW, ko/kr', 'content/about.md').endsWith('Fix the `locales:` line in content/about.md.'));
  // No source known: it does not guess the site config.
  assert.equal(/_site\.md|in the site config/.test(refusal('zh-TW, ko/kr')), false);
  const siteLayer = () => tagLocalesSource({ locales: 'zh-TW, en-US', brand: 'A' }, 'content/_site.md');
  // A page that writes its own `locales` owns the merged value; one that does not leaves the site's.
  const own = { ...siteLayer(), ...tagLocalesSource({ title: 'About', locales: 'zh-TW, ko/kr' }, 'content/about.md') };
  const plain = { ...siteLayer(), ...tagLocalesSource({ title: 'About' }, 'content/about.md') };
  assert.equal(localesSourceOf(own), 'content/about.md');
  assert.equal(localesSourceOf(plain), 'content/_site.md');
  assert.ok(refusal(own.locales, localesSourceOf(own)).includes('content/about.md'));
  // …and the tag is not a frontmatter key: nothing that lists or serialises meta sees it.
  assert.deepEqual(Object.keys(own).sort(), ['brand', 'locales', 'title']);
  assert.equal(JSON.stringify(own).includes('about.md'), false);
  assert.equal(localesSourceOf({}), '');
  assert.equal(localesSourceOf(undefined), '');
});

test('🔴 a PAGE\'s own bad `locales` is warned about and dropped — it never throws, and never survives the merge', () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    const site = tagLocalesSource({ locales: 'en-US, zh-TW', brand: 'A' }, 'content/_site.md');
    const page = { title: 'About', locales: 'en-US, zh​_TW' };
    const msg = pageLocalesOrWarn(page, 'content/warn-a.md', site);
    assert.equal(Object.prototype.hasOwnProperty.call(page, 'locales'), false, 'the bad value is still on the page');
    const merged = { ...site, ...page };
    assert.deepEqual(parseLocales(merged.locales, localesSourceOf(merged)), ['en-US', 'zh-TW'], 'the page does not fall back to the site\'s list');
    assert.equal(localesSourceOf(merged), 'content/_site.md');
    assert.ok(msg.startsWith('sitetile: locales entry "zh\\u{200B}_TW" in content/warn-a.md is not a locale code'), msg);
    assert.ok(msg.endsWith('This page\'s own `locales:` line is IGNORED: the page uses the site\'s list from content/_site.md.'), msg);
    assert.equal(msg.includes('​'), false, 'the invisible character itself is in the warning');
    // Said once per file, however many routes read that file.
    pageLocalesOrWarn({ locales: 'en-US, zh​_TW' }, 'content/warn-a.md', site);
    assert.deepEqual(warned, [msg]);
    // No site list to fall back to: it says that instead, and offers the hyphen form where there is one.
    const alone = pageLocalesOrWarn({ locales: 'zh_TW' }, 'content/warn-b.md', null);
    assert.ok(alone.includes('Did you mean "zh-TW"?') && alone.endsWith('the page is treated as declaring none.'), alone);
    // The control: a good page-level value is kept, tagged with the page, and says nothing.
    const good = { locales: 'ja-JP、en-US' };
    assert.equal(pageLocalesOrWarn(good, 'content/warn-c.md', site), null);
    assert.equal(localesSourceOf({ ...site, ...good }), 'content/warn-c.md');
    assert.equal(pageLocalesOrWarn({ title: 'x' }, 'content/warn-d.md', site), null);
    assert.equal(warned.length, 2);
  } finally { console.warn = realWarn; }
});

test('🔴 every reader of a meta object\'s `locales` hands the parser that object\'s source', () => {
  const calls = walk(SRC).filter((p) => !p.endsWith('lingo/locale.mjs')).flatMap((p) =>
    [...readFileSync(p, 'utf8').matchAll(/parseLocales\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].map((m) => [relative(SRC, p), m[1]]));
  assert.ok(calls.length >= 7, `only ${calls.length} parseLocales calls found — the pattern stopped matching`);
  const bare = calls.filter(([, args]) => !/^\s*(\w+)(?: && \1)?\.locales, localesSourceOf\(\1\)\s*$/.test(args.replace(/lingo\./g, '')));
  assert.deepEqual(bare, [], 'a parseLocales call that does not pass localesSourceOf(<the same object>)');
  // The files that READ frontmatter are the ones that know the path, so they are the ones that tag.
  const page = readFileSync(join(SRC, 'pages/[...path].astro'), 'utf8');
  for (const [name, text, cfg] of [['[...path].astro', page, 'siteConfig'], ['language.astro', language, 'cfg']]) {
    assert.ok(text.includes(`if (${cfg} || rel !== 'home') pageLocalesOrWarn(site.meta, \`content/\${rel}.md\`, ${cfg});`), `${name}: a page's own locales is not checked as a page's`);
    assert.ok(text.includes('else tagLocalesSource(site.meta, `content/${rel}.md`);'), `${name}: the legacy root home is not tagged`);
  }
  assert.match(readFileSync(join(SRC, 'lib/blog.mjs'), 'utf8'), /base = tagLocalesSource\(meta, 'content\/_site\.md'\)/);
});

test('🔴 SiteLayout: "the owner wrote a Language link" is decided on what safeHref accepted', () => {
  assert.match(layout, /const showLanguageLink = multilingual \|\| \(locales\.length > 0 && !!ownLanguageHref\);/);
  assert.match(layout, /const ownLanguageHref = meta\['language-href'\] \? \(safeHref\([^\n]*\) \|\| ''\) : '';/);
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


// ── CVERInc/reef#1888: the banner's three sentences can be overridden per locale ──────────────
// A site wanted a formal register and had no setting for it. The override opens TEXT ONLY, in the
// site layer, as flat keys in the `locales` family (the site layer has no nested blocks):
//   locales-banner-<url-locale>-prompt | -continue | -dismiss
// Unset ⇒ the default. One sentence missing ⇒ that one sentence is the default. A key that is not
// one of those three, or names a locale the site does not declare, is ignored with a warning —
// never a failed build.
const bannerOverrides = (meta, locales, pageMeta) => {
  assert.equal(typeof lingoMod.bannerOverrides, 'function', 'locale.mjs exports bannerOverrides()');
  return lingoMod.bannerOverrides(meta, locales, pageMeta);
};
const TWO = ['en-US', 'zh-TW'];
const DEFAULT_ZH = lingoMod.bannerCopy('zh-TW');

test('🔴 #1888 an override replaces the sentence it names, in the option for that locale', () => {
  const { copy, warnings } = bannerOverrides({
    'locales-banner-zh-tw-prompt': '本網站提供中文版',
    'locales-banner-zh-tw-continue': '切換至中文',
    'locales-banner-zh-tw-dismiss': '繼續瀏覽英文版',
  }, TWO);
  assert.deepEqual(warnings, []);
  const b = banner({ locales: TWO, lang: 'en-US', defaultLocale: 'en-US', altLocales: TWO, copy });
  assert.equal(b.options[0].prompt, '本網站提供中文版');
  assert.equal(b.options[0].continue, '切換至中文');
  assert.equal(b.options[0].dismiss, '繼續瀏覽英文版');
});

test('🔴 #1888 no override ⇒ the default copy, byte for byte', () => {
  const { copy } = bannerOverrides({ title: 'x' }, TWO);
  const b = banner({ locales: TWO, lang: 'en-US', defaultLocale: 'en-US', altLocales: TWO, copy });
  assert.equal(b.options[0].prompt, DEFAULT_ZH.prompt);
  assert.equal(b.options[0].continue, DEFAULT_ZH.continue);
  assert.equal(b.options[0].dismiss, DEFAULT_ZH.dismiss);
  const without = banner({ locales: TWO, lang: 'en-US', defaultLocale: 'en-US', altLocales: TWO });
  assert.deepEqual(b, without, 'passing an empty override changes nothing');
});

test('🔴 #1888 a missing sentence falls back to that one default, never to empty', () => {
  const { copy } = bannerOverrides({ 'locales-banner-zh-tw-prompt': '本網站提供中文版', 'locales-banner-zh-tw-dismiss': '   ' }, TWO);
  const b = banner({ locales: TWO, lang: 'en-US', defaultLocale: 'en-US', altLocales: TWO, copy });
  assert.equal(b.options[0].prompt, '本網站提供中文版');
  assert.equal(b.options[0].continue, DEFAULT_ZH.continue, 'unset ⇒ default');
  assert.equal(b.options[0].dismiss, DEFAULT_ZH.dismiss, 'blank ⇒ default, not a blank button');
});

test('🔴 #1888 an unknown field or an undeclared locale is ignored with a readable warning, never a throw', () => {
  const { copy, warnings } = bannerOverrides({
    'locales-banner-zh-tw-title': 'x',
    'locales-banner-fr-fr-prompt': 'Bonjour',
    'locales-banner-zh-tw-prompt': '本網站提供中文版',
  }, TWO);
  assert.equal(warnings.length, 2, warnings.join(' | '));
  assert.match(warnings.join('\n'), /locales-banner-zh-tw-title/);
  assert.match(warnings.join('\n'), /prompt, continue, dismiss/);
  assert.match(warnings.join('\n'), /locales-banner-fr-fr-prompt/);
  const b = banner({ locales: TWO, lang: 'en-US', defaultLocale: 'en-US', altLocales: TWO, copy });
  assert.equal(b.options[0].prompt, '本網站提供中文版', 'the good key still applies');
  assert.equal(b.options[0].continue, DEFAULT_ZH.continue);
});

test('🔴 #1888 a locale is matched however the site spells it (zh-TW, zh-tw, zh-Hant)', () => {
  for (const spell of ['zh-TW', 'zh-tw', 'zh-hant']) {
    const { copy, warnings } = bannerOverrides({ [`locales-banner-${spell}-continue`]: '切換至中文' }, TWO);
    assert.deepEqual(warnings, [], spell);
    const b = banner({ locales: TWO, lang: 'en-US', defaultLocale: 'en-US', altLocales: TWO, copy });
    assert.equal(b.options[0].continue, '切換至中文', spell);
  }
});

test('🔴 #1888 SiteLayout feeds the site-layer overrides into the banner', () => {
  assert.match(layout, /lingo\.bannerOverrides\(meta, locales\)/);
  assert.match(layout, /lingo\.suggestionBanner\(\{ locales, lang, defaultLocale, altLocales, routeLocales: bannerLocales, copy: bannerCopyOverrides \}\)/);
});


// ── tile#128 review round 1 ──────────────────────────────────────────────────────────────────
test('🔴 r1-1 a declared locale outside the four: each sentence falls back on its own, ending at en — never empty', () => {
  const loc = ['en-US', 'fr-FR'];
  const { copy, warnings, findings } = bannerOverrides({ 'locales-banner-fr-fr-prompt': 'Bonjour' }, loc);
  // reef#2061 r1-5: declared but outside the four the banner is offered in ⇒ said, not silent.
  assert.deepEqual(findings, [{ key: 'locales-banner-fr-fr-prompt', reason: 'banner-unsupported-locale' }], warnings.join(' | '));
  const b = banner({ locales: loc, lang: 'en-US', defaultLocale: 'en-US', altLocales: loc, copy });
  const en = lingoMod.bannerCopy('en-US');
  assert.equal(b.options[0].prompt, 'Bonjour');
  assert.equal(b.options[0].continue, en.continue);
  assert.equal(b.options[0].dismiss, en.dismiss);
  const none = banner({ locales: loc, lang: 'en-US', defaultLocale: 'en-US', altLocales: loc });
  for (const f of ['prompt', 'continue', 'dismiss']) assert.ok(none.options[0][f], `no override: ${f} is not empty`);
});

// tile#128 r2-1: the site layer is what loadSite says it is — base _site.md plus the page's own
// locale _site.md — and `page-level` is decided by WHERE a key was written, not by its value.
const { registerHooks } = await import('node:module');
const { pathToFileURL } = await import('node:url');
registerHooks({ resolve(spec, ctx, next) { return spec === '@sitetile' ? { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true } : next(spec, ctx); } });
const { loadSite } = await import(pathToFileURL(join(SRC, 'lib/blog.mjs')).href);
const fm = (o) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
/** What the page route does: loadSite for this page, merge the page over it, then put the banner
 *  keys back to the site layer's and remember which ones the page wrote. */
function pageMeta(files, rel, own) {
  const siteConfig = loadSite(files, rel);
  return lingoMod.siteLayerBannerMeta(own, siteConfig, { ...siteConfig, ...own });
}
const FILES = {
  '/x/content/_site.md': fm({ locales: 'en-US, zh-TW', 'locales-banner-zh-tw-prompt': '站台的句子', 'locales-banner-en-us-prompt': 'Base English' }),
  '/x/content/zh-tw/_site.md': fm({ 'locales-banner-en-us-prompt': 'Locale-file English' }),
};

test('🔴 r2-1 a locale _site.md is site layer: its override applies on that locale\'s pages, no warning', () => {
  const meta = pageMeta(FILES, 'zh-tw/about', { title: 'A' });
  const { copy, findings } = bannerOverrides(meta, TWO);
  assert.deepEqual(findings, []);
  const b = banner({ locales: TWO, lang: 'zh-TW', defaultLocale: 'en-US', altLocales: TWO, copy });
  assert.equal(b.options[0].prompt, 'Locale-file English');
  const base = pageMeta(FILES, 'about', { title: 'A' });
  assert.equal(bannerOverrides(base, TWO).copy['en-US'].prompt, 'Base English', 'the base pages keep the base value');
});

test('🔴 r2-1 a page frontmatter key is ignored and warned page-level — even when it equals the site value', () => {
  const meta = pageMeta(FILES, 'about', { title: 'A', 'locales-banner-zh-tw-prompt': '站台的句子', 'locales-banner-zh-tw-dismiss': '頁面婉拒' });
  const { copy, findings } = bannerOverrides(meta, TWO);
  const b = banner({ locales: TWO, lang: 'en-US', defaultLocale: 'en-US', altLocales: TWO, copy });
  assert.equal(b.options[0].prompt, '站台的句子');
  assert.equal(b.options[0].dismiss, DEFAULT_ZH.dismiss, 'the page value is not used');
  assert.deepEqual(findings.map((f) => `${f.key}:${f.reason}`).sort(), ['locales-banner-zh-tw-dismiss:page-level', 'locales-banner-zh-tw-prompt:page-level']);
});

test('🔴 r2-1 the page route stamps the page keys before handing meta to the layout', () => {
  const route = readFileSync(join(SRC, 'pages/[...path].astro'), 'utf8');
  assert.match(route, /siteLayerBannerMeta\(/);
});

// tile#128 r2-2: cut by grapheme, never inside one; say what was dropped.
test('🔴 r2-2 a sentence longer than 120 graphemes is cut to 120 without splitting one, and the drop is shown', () => {
  const family = '👨‍👩‍👧‍👦';
  const long = '字'.repeat(119) + family + '多出來的字';
  const { copy, warnings, findings } = bannerOverrides({ 'locales-banner-zh-tw-prompt': long }, TWO);
  const seg = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(copy['zh-TW'].prompt)];
  assert.equal(seg.length, 120);
  assert.ok(copy['zh-TW'].prompt.endsWith(family), 'the whole family emoji is kept — no orphan code point');
  const f = findings.find((x) => x.reason === 'too-long');
  assert.equal(f.dropped, '多出來的字');
  assert.match(warnings.join('\n'), /多出來的字/);
});
console.log(`\n${passed} passed`);
