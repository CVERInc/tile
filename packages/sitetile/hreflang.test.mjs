// hreflang must be MEASURED, not assumed.
//   run: node packages/sitetile/hreflang.test.mjs
//
// 🩸 2026-08-06. SiteLayout advertised every configured locale on every page — `locales.map(...)`.
// That is true for content pages, which are authored one file per locale, and false for everything
// the build GENERATES. Measured on a live site: /devlog, its 79 posts, /search and 62 tag pages
// each advertised ja / ko / zh-Hant, and all of those were 404 — roughly 429 dead declarations on a
// 244-page site — while /oss, a real four-locale page, was correct all along. A search engine that
// meets an hreflang pointing at a 404 discards the whole reciprocal cluster, so the broken half was
// poisoning the working half.
//
// The defect was never i18n. It was a claim about existence made without checking existence, in a
// place where nothing could ever go red. This file is the thing that goes red.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { alternateLocales, contentRelsOf } from './astro/src/packages/lingo/locale.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(join(HERE, 'astro/src/layouts/SiteLayout.astro'), 'utf8');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// A four-locale site: some pages translated, some not.
const GLOB = {
  '/b/content/home.md': 1, '/b/content/ja-jp/home.md': 1, '/b/content/ko-kr/home.md': 1, '/b/content/zh-tw/home.md': 1,
  '/b/content/about.md': 1, '/b/content/ja-jp/about.md': 1, '/b/content/ko-kr/about.md': 1, '/b/content/zh-tw/about.md': 1,
  '/b/content/legal/terms.md': 1, '/b/content/ja-jp/legal/terms.md': 1,
  '/b/content/donate.md': 1,
  '/b/content/_site.md': 1, '/b/content/_theme.md': 1,
  '/b/content/ja-jp/_site.md': 1,
};
const RELS = contentRelsOf(GLOB);
const LOCALES = ['en-US', 'ja-JP', 'ko-KR', 'zh-TW'];
const at = (subPath, all = false) => alternateLocales({ locales: LOCALES, defaultLocale: 'en-US', subPath, contentRels: RELS, all });

test('a page translated into every locale advertises every locale', () => {
  assert.deepEqual(at('about'), LOCALES);
  assert.deepEqual(at(''), LOCALES, 'the site root maps to content/home.md');
});

test('a page translated into SOME locales advertises only those', () => {
  assert.deepEqual(at('legal/terms'), ['en-US', 'ja-JP'], 'nested path, two locales');
  assert.deepEqual(at('donate'), ['en-US'], 'base locale only');
});

test('🔴 a GENERATED route advertises nothing — this is the bug', () => {
  for (const p of ['devlog', 'devlog/some-post', 'search', 'tag/archive', 'category/news', '2026/07']) {
    assert.deepEqual(at(p), [], `${p} has no content file in any locale, so it may claim none`);
  }
});

test('🔴 the control: the OLD behaviour would fail every case above', () => {
  // `locales.map(...)` — what the layout used to do. If a future edit reverts to it, the assertion
  // below is what breaks. Written as the actual old expression so it cannot drift into a paraphrase.
  const oldBehaviour = (_subPath) => [...LOCALES];
  assert.notDeepEqual(oldBehaviour('devlog'), at('devlog'));
  assert.notDeepEqual(oldBehaviour('donate'), at('donate'));
  assert.deepEqual(oldBehaviour('about'), at('about'), 'and it agreed on the pages that were fine');
});

test('site DATA does not vouch for a locale', () => {
  // content/ja-jp/_site.md exists in the fixture. If _site counted, `_site` would resolve and — worse —
  // any locale carrying only a config file would look like a translated site.
  assert.ok(!RELS.has('_site'), '_site is not a page');
  assert.ok(!RELS.has('ja-jp/_site'), 'nor is a locale-scoped one');
  assert.ok(!RELS.has('_theme'), 'nor is the theme');
});

test('all:true is the one override, and it is opt-IN', () => {
  // /language fans out per locale with no content file behind it, so it has to be told. Opt-in means
  // forgetting it costs a MISSING alternate (harmless) rather than a DEAD one (not harmless).
  assert.deepEqual(at('language', true), LOCALES);
  assert.deepEqual(at('language'), [], 'without the flag it stays silent rather than guessing');
});

test('🔴 the layout renders the measured set, not the configured one', () => {
  assert.match(layout, /altLocales\.map\(\(l\) => <link rel="alternate"/, 'hreflang comes from altLocales');
  assert.doesNotMatch(layout, /\{locales\.map\(\(l\) => <link rel="alternate"/, 'and never from locales directly');
  assert.match(layout, /altLocales\.includes\(defaultLocale\)/, 'x-default is gated by the same set');
});

test('🔴 exactly one route claims all:true', () => {
  const hits = execSync(`grep -rl 'alternates="all"' ${JSON.stringify(join(HERE, 'astro/src'))} || true`, { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.equal(hits.length, 1, `expected only the language route to opt in, got:\n${hits.join('\n')}`);
  assert.match(hits[0], /language\.astro$/);
});

test('🔴 the language chooser is told the SAME measured set', () => {
  // The chooser's inline script has always supported `?has=` — a locale not listed falls back to
  // that locale's home instead of the return path — and nothing ever populated it, so from /devlog
  // it offered three 404s. Both consumers now read altLocales; neither may drift back to `locales`.
  assert.match(layout, /const hasParam = hasLingo && altLocales\.length/, 'has= is built from the measured set');
  assert.match(layout, /\$\{hasParam\}/, 'and actually appended to the chooser href');
});

test('🔴 the self-referencing hreflang matches the canonical, to the character', () => {
  // canonicalHref comes from Astro.url.pathname (directory-style, trailing slash); localePath built
  // its own string and dropped it. A cluster whose self-link does not equal the canonical is a
  // cluster a search engine is entitled to ignore — the dead-alternate defect at one character.
  assert.match(layout, /return subPath \? `\$\{prefix\}\/\$\{subPath\}\/`/,
    'localePath must emit the trailing slash the build actually serves');
});

test('🔴 a locale HOME keeps its alternates through the build\'s filename collapse', () => {
  // content/<loc>/home.md is emitted as content/<loc>.md, so a check for "<loc>/home" alone finds
  // nothing. Found by site-parity on its first run: a live `/<locale>/` home declared en and x-default and
  // NOT itself — a cluster with no self-reference, which is worse than none. lib/sitemap.mjs
  // already knew about the collapse; this did not. One fix, two places, one of them missed.
  //
  // The fixture ISOLATES it: zh-TW exists ONLY in the collapsed form. The first version of this
  // test used a locale that had both, so removing the collapse branch changed nothing and the
  // mutation survived — a specimen that cannot show the difference proves nothing about it.
  const COLLAPSED = contentRelsOf({
    '/b/content/home.md': 1,
    '/b/content/ja-jp/home.md': 1,   // uncollapsed
    '/b/content/zh-tw.md': 1,        // collapsed — the ONLY form for this locale
  });
  const got = alternateLocales({ locales: LOCALES, defaultLocale: 'en-US', subPath: '', contentRels: COLLAPSED });
  assert.deepEqual(got, ['en-US', 'ja-JP', 'zh-TW'], 'both spellings of a locale home count');
  assert.ok(!got.includes('ko-KR'), 'and a locale with neither is still correctly absent');

  // …and the collapse must not leak into ordinary pages: content/zh-tw.md is a HOME, not evidence
  // that /zh-tw/about exists.
  assert.deepEqual(
    alternateLocales({ locales: LOCALES, defaultLocale: 'en-US', subPath: 'about', contentRels: COLLAPSED }),
    [], 'no page named about exists in any locale here',
  );
});

console.log(`\n${passed} passed`);
