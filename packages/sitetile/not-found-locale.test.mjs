// The 404 page speaks the SITE's language, and its Language link lands on a page that exists.
//   run: node packages/sitetile/not-found-locale.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 CVERInc/reef#1886, CVERInc/reef#1868. Measured on a two-locale site whose default is English:
// the 404 page was `<html lang="zh-Hant">` and read 找不到頁面 — the engine default, not the site's —
// and its footer Language link was built for that wrong language instead of opening the site's
// default-locale chooser. Every ordinary page on the same site was correct.
//
// One cause. A site's `_site.md` carries `locales:` but usually no `lang:` — `lang` is written on
// each PAGE, because it is what goes in that page's <html lang>. The 404 has no page behind it, so
// it asked the site-config layer for `lang`, got nothing, and took DEFAULT_LANG. The layout then
// did exactly what it does for any non-default locale: prefixed the chooser link with that
// language. The link was built correctly from a wrong answer. The rule this file holds: the 404 is
// rendered in the site's default language, and its Language link is the unprefixed `/language`.
//
// So this file does not test the link builder (it was never wrong, and it is the SAME one every
// page uses). It tests the answer: real IR in, real HTML out, and the href resolved against the
// files the build actually wrote.
//
// 🩸 CVERInc/reef#1910 is held here too, because its edges are read off the same kind of build: one
// declared locale, a root page that disagrees with `locales`, list spellings the frontmatter reader
// hands over verbatim, the way back from the 404's chooser, and the one definition of "the site's
// default language". Each has a fixture below and is asserted on what the build WROTE.
//
// It needs the renderer's dependencies and SAYS SO when they are absent — same shape as
// packages/build/build-site.test.mjs. The pure half below runs regardless.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RENDERER_SUBPATH } from '../build/index.mjs';
import { DEFAULT_LANG } from './astro/src/packages/lingo/locale.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve —
// same seam blog-unlisted.test.mjs already teaches the resolver.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const blog = await import('./astro/src/lib/blog.mjs');
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// ── the pure half ────────────────────────────────────────────────────────────────────────────
// `siteDefaultLang(meta, contentGlob)` — '' when the site says nothing, so the caller still takes
// the ONE shared DEFAULT_LANG (lang-default.test.mjs holds that in place).
const glob = (files) => Object.fromEntries(Object.entries(files).map(([rel, fm]) =>
  [`/x/content/${rel}`, `---\n${fm}\n---\n\n## A section\n%% sitetile: prose %%\n\nBody.\n`]));
const sdl = (meta, files = {}) => {
  assert.equal(typeof blog.siteDefaultLang, 'function', 'lib/blog.mjs does not export siteDefaultLang');
  // A real site config sits in the glob (siteMeta() only reads `meta.lang` as the site's when it does).
  return blog.siteDefaultLang(meta, glob({ '_site.md': 'brand: x', ...files }));
};

await test('🔴 the first declared locale outranks the site config\'s own `lang`', () => {
  // 🩸 CVERInc/reef#1910. This said the opposite — "the site config's own `lang` wins over
  // everything else" — and was the one reader of the site's default that did not put `locales`
  // first. Every URL on the site already obeyed `locales`; only the 404's language did not.
  assert.equal(sdl({ lang: 'ko-KR', locales: 'zh-TW, en' }, { 'home.md': 'sitetile-page: home\nlang: ja' }), 'zh-TW');
  // With no `locales` the config's `lang` is still the answer, ahead of the home page's.
  assert.equal(sdl({ lang: 'ko-KR' }, { 'home.md': 'sitetile-page: home\nlang: ja' }), 'ko-KR');
});

await test('the config\'s `lang` is returned AS WRITTEN when it names the first locale', () => {
  // `zh-Hant` over `locales: zh-TW` is one locale spelled two correct ways, and a one-language
  // site puts this value in <html lang> verbatim — so the spelling the site chose is kept.
  assert.equal(sdl({ lang: 'zh-Hant', locales: 'zh-TW' }), 'zh-Hant');
  assert.equal(sdl({ lang: 'en', locales: 'en-US, ja-JP' }), 'en');
});

await test('🔴 a multi-locale site: the FIRST declared locale, not the alphabetically first', () => {
  // Uneven on purpose: `zh-TW` is declared first and sorts last; mixed case must survive.
  assert.equal(sdl({ locales: 'zh-TW, en, ja-JP' }), 'zh-TW');
  assert.equal(sdl({ locales: ' en ,zh-TW' }), 'en');
});

await test('🔴 a single-language site: the HOME page\'s `lang`, not whichever page sorts first', () => {
  const files = {
    '_site.md': 'brand: Tsuru Paper',
    // A locale home is not THE home. It is listed FIRST so an implementation that accepts any
    // `*/home.md` would take it; the root home below is the only right answer.
    'ko-kr/home.md': 'sitetile-page: home\nlang: ko-KR',
    'about.md': 'sitetile-page: about\nlang: en',      // sorts before home, and disagrees with it
    'home.md': 'sitetile-page: home\nlang: ja',
  };
  assert.equal(sdl({ brand: 'Tsuru Paper' }, files), 'ja');
});

await test('🔴 a declared locale beats the root home\'s `lang`: locales[0] is ranked above it', () => {
  // The root home says `ja`; the site declares `en` first. Same order SiteLayout and the language
  // chooser page use, so the 404 and the rest of the site agree on what "the default" is.
  assert.equal(sdl({ locales: 'en, zh-TW' }, { 'home.md': 'sitetile-page: home\nlang: ja' }), 'en');
});

await test('a site that declares no language anywhere answers nothing', () => {
  assert.equal(sdl({ brand: 'Nobody' }, { '_site.md': 'brand: Nobody', 'home.md': 'sitetile-page: home\ntitle: Hi' }), '');
  assert.equal(sdl({}), '');
  assert.equal(sdl(undefined), '');
});

await test('🔴 #1868 no locales, no config `lang`: the MAJORITY of the root pages\' `lang`, home or not', () => {
  const pg = (l) => (l ? `sitetile-page: x\nlang: ${l}` : 'sitetile-page: x');
  // The home says nothing; three pages say English, one says Japanese.
  assert.equal(sdl({}, { 'home.md': pg(''), 'a.md': pg('en'), 'b.md': pg('en'), 'c.md': pg('ja') }), 'en');
  // The home disagrees with the majority — the majority is the site's language, not the home's.
  assert.equal(sdl({}, { 'home.md': pg('ja'), 'a.md': pg('en'), 'b.md': pg('en') }), 'en');
  // `en` and `en-US` are one vote, and the first spelling seen is kept as written.
  assert.equal(sdl({}, { 'a.md': pg('en-US'), 'b.md': pg('en'), 'c.md': pg('ja') }), 'en-US');
});

await test('🔴 #1868 a tie goes to the home page; a tie without it goes to the first path, not object order', () => {
  const pg = (l) => `sitetile-page: x\nlang: ${l}`;
  assert.equal(sdl({}, { 'about.md': pg('en'), 'home.md': pg('ja') }), 'ja');
  assert.equal(sdl({}, { 'b.md': pg('ja'), 'a.md': pg('en') }), 'en');
  assert.equal(sdl({}, { 'a.md': pg('en'), 'b.md': pg('ja') }), 'en');
});

await test('#1868 the majority is a fallback: `locales` and the config\'s `lang` both outrank it', () => {
  const pg = (l) => `sitetile-page: x\nlang: ${l}`;
  const files = { 'a.md': pg('en'), 'b.md': pg('en'), 'c.md': pg('en') };
  assert.equal(sdl({ locales: 'ja-JP, en-US' }, files), 'ja-JP');
  assert.equal(sdl({ lang: 'ko-KR' }, files), 'ko-KR');
});

await test('🔴 #1868 no `_site.md`: the home page\'s `lang` that siteMeta() falls back to is not a site-level `lang`', () => {
  const pg = (l) => `sitetile-page: x\nlang: ${l}`;
  const files = glob({ 'home.md': pg('ja'), 'a.md': pg('en'), 'b.md': pg('en') });
  const fellBack = { 'sitetile-page': 'x', lang: 'ja' };   // what siteMeta() hands over with no _site.md
  assert.equal(blog.siteDefaultLang(fellBack, files), 'en');
  assert.equal(blog.systemPageLang(fellBack, files), 'en');
});

await test('🔴 #1868 systemPageLang: config `lang` kept; locales site unchanged; otherwise the site default', () => {
  assert.equal(typeof blog.systemPageLang, 'function', 'lib/blog.mjs does not export systemPageLang');
  const files = glob({ '_site.md': 'brand: x', 'a.md': 'sitetile-page: a\nlang: en', 'b.md': 'sitetile-page: b\nlang: en' });
  assert.equal(blog.systemPageLang({ lang: 'ja' }, files), 'ja');
  // 🩸 CVERInc/reef#2066: this said DEFAULT_LANG ("a locales site must keep its old answer") — the one
  // intentional inconsistency tile#135 left. A site that declares `locales` and says no `lang` speaks locales[0].
  assert.equal(blog.systemPageLang({ locales: 'en, zh-TW' }, files), 'en', 'a locales site speaks its first locale, like its 404');
  assert.equal(blog.systemPageLang({ locales: 'zh-TW, en' }, files), 'zh-TW');
  assert.equal(blog.systemPageLang({ lang: 'ja', locales: 'en, zh-TW' }, files), 'en', 'locales[0] outranks the config lang, as the 404 does');
  assert.equal(blog.systemPageLang({}, files), 'en');
  assert.equal(blog.systemPageLang({}, {}), DEFAULT_LANG);
});

// ── the real half: IR in, HTML out ───────────────────────────────────────────────────────────
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: hero %%\n\nA fixture page.\n`;
const SITES = {
  // The measured shape: two locales, English default, `lang` only on the pages.
  multiEn: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en, zh-TW\npackages: lingo\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
  },
  // ── CVERInc/reef#2112: three locales, so the per-locale 404 is checked on a locale that is neither
  // the default nor the one every other fixture uses. `ja-JP` is declared second, `zh-TW` third.
  triEnJaZh: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en-US, ja-JP, zh-TW\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en-US', 'Paper cranes'),
    'ja-jp/home.md': page('sitetile-page: home\ntitle: 折り鶴\nlang: ja-JP', '折り鶴'),
    'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
  },
  // Same site, default flipped — the default sorts LAST and is not the DEFAULT_LANG literal either.
  multiZh: {
    '_site.md': '---\nbrand: 紙鶴工坊\nlocales: zh-TW, en\npackages: lingo\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'en/home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
  },
  // One language, no `locales:`, no Lingo. `about` sorts before `home` and disagrees with it.
  monoJa: {
    '_site.md': '---\nbrand: 折り鶴\n---\n',
    'about.md': page('sitetile-page: about\ntitle: About\nlang: en', 'About'),
    'home.md': page('sitetile-page: home\ntitle: 折り鶴\nlang: ja', '折り鶴'),
  },
  // ── CVERInc/reef#1910 ──
  // ONE declared locale and nothing else. `legal/terms` is nested on purpose: the dead hreflang was
  // built from the page's own path.
  oneLocale: {
    '_site.md': '---\nbrand: 紙鶴工坊\nlocales: zh-TW\ncopyright: © 紙鶴工坊\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'about.md': page('sitetile-page: about\ntitle: 關於\nlang: zh-TW', '關於'),
    'legal/terms.md': page('sitetile-page: terms\ntitle: 條款\nlang: zh-TW', '條款'),
  },
  // One locale WITH `packages: lingo` — the switch is on and there is still nothing to switch to.
  oneLocaleLingo: {
    '_site.md': '---\nbrand: 종이학\nlocales: ko-KR\npackages: lingo\ncopyright: © 종이학\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 종이학\nlang: ko-KR', '종이학'),
    'about.md': page('sitetile-page: about\ntitle: 소개\nlang: ko-KR', '소개'),
  },
  // The root home is Chinese; `locales` puts English first. No /zh-tw/ home was written.
  rootDisagrees: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en-US, zh-TW\ncopyright: © Tsuru Paper\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'about.md': page('sitetile-page: about\ntitle: 關於\nlang: zh-TW', '關於'),
  },
  // The two list spellings the frontmatter reader hands over verbatim. Different locales in each,
  // so one cannot pass on the other's directories.
  bracketed: {
    '_site.md': '---\nbrand: 折り鶴\nlocales: [ja-JP, en-US]\ncopyright: © 折り鶴\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 折り鶴\nlang: ja-JP', '折り鶴'),
    'en-us/home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en-US', 'Paper cranes'),
  },
  quoted: {
    '_site.md': '---\nbrand: 紙鶴工坊\nlocales: "zh-TW, ko-KR"\ncopyright: © 紙鶴工坊\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'ko-kr/home.md': page('sitetile-page: home\ntitle: 종이학\nlang: ko-KR', '종이학'),
  },
  // Not a locale code at all. The build must refuse it by name.
  unsafe: {
    '_site.md': '---\nbrand: 紙鶴工坊\nlocales: zh-TW, ../kiln\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
  },
  // The site config's own `lang` is NOT the first locale. Its 404 used to follow `lang`.
  configDisagrees: {
    '_site.md': '---\nbrand: Tsuru Paper\nlang: ja-JP\nlocales: en-US, ja-JP\ncopyright: © Tsuru Paper\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en-US', 'Paper cranes'),
    'ja-jp/home.md': page('sitetile-page: home\ntitle: 折り鶴\nlang: ja-JP', '折り鶴'),
  },
  // One locale and a `language-href:` the link policy refuses. The fallback was `/language`, which
  // a one-locale site never builds.
  oneLocaleUnsafeHref: {
    '_site.md': '---\nbrand: 紙鶴工坊\nlocales: zh-TW\ncopyright: © 紙鶴工坊\nlanguage-href: javascript:alert(1)\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'about.md': page('sitetile-page: about\ntitle: 關於\nlang: zh-TW', '關於'),
  },
  // One locale and a `language-href:` of the owner's own that is an ordinary link. Kept as written.
  oneLocaleOwnHref: {
    '_site.md': '---\nbrand: 折り鶴\nlocales: ja-JP\ncopyright: © 折り鶴\nlanguage-href: https://example.com/other-editions\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 折り鶴\nlang: ja-JP', '折り鶴'),
    'about.md': page('sitetile-page: about\ntitle: 紹介\nlang: ja-JP', '紹介'),
  },
  // Two locales and the same refused `language-href:`. The chooser exists here, so it is the link.
  multiUnsafeHref: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en-US, ko-KR\ncopyright: © Tsuru Paper\nlanguage-href: javascript:alert(1)\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en-US', 'Paper cranes'),
    'ko-kr/home.md': page('sitetile-page: home\ntitle: 종이학\nlang: ko-KR', '종이학'),
  },
  // The SITE's `locales` is fine; one PAGE writes its own, and that one is not.
  pageLocales: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en-US, zh-TW\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en-US', 'Paper cranes'),
    'about.md': page('sitetile-page: about\ntitle: About\nlang: en-US\nlocales: en-US, ko/kr', 'About'),
    'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW\nlocales: zh-TW, ../kiln', '紙鶴'),
    'zh-tw/about.md': page('sitetile-page: about\ntitle: 關於\nlang: zh-TW', '關於'),
  },
  // ── CVERInc/reef#1868: one language, no `locales`, nothing in `_site.md` ──
  // English throughout.
  monoEn: {
    '_site.md': '---\nbrand: Tsuru Paper\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'about.md': page('sitetile-page: about\ntitle: About\nlang: en', 'About'),
    'contact.md': page('sitetile-page: contact\ntitle: Contact\nlang: en', 'Contact'),
  },
  // The home page writes no `lang`; the other pages are English. The home page is not the only voice.
  monoEnSilentHome: {
    '_site.md': '---\nbrand: Tsuru Paper\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper', 'Paper cranes'),
    'about.md': page('sitetile-page: about\ntitle: About\nlang: en', 'About'),
    'contact.md': page('sitetile-page: contact\ntitle: Contact\nlang: en', 'Contact'),
  },
  // The same English site with a blog, search and tag routes: the other system pages.
  monoEnBlog: {
    '_site.md': '---\nbrand: Tsuru Paper\npackages: blog\nblog-search: true\nblog-label-routes: true\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'about.md': page('sitetile-page: about\ntitle: About\nlang: en', 'About'),
    'posts/p1.md': '---\ntitle: P1\ndate: 2026-01-02\ntags: [crane]\n---\nBody text.\n',
  },
  // No `_site.md` at all: siteMeta() hands the home page's own frontmatter over as the site's.
  noSiteFile: {
    'home.md': page('sitetile-page: home\ntitle: 折り鶴\nlang: ja', '折り鶴'),
    'a.md': page('sitetile-page: a\ntitle: A\nlang: en', 'A'),
    'b.md': page('sitetile-page: b\ntitle: B\nlang: en', 'B'),
  },
  // ── CVERInc/reef#2066: declared locales + a blog. The root pages are English, `locales` says
  // English first, `_site.md` has no `lang`. A translated post sits under posts/zh-tw/.
  multiEnBlog: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en, zh-TW\npackages: lingo, blog\nblog-search: true\nblog-label-routes: true\nblog-tag-routes: true\nblog-date-routes: true\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'about.md': page('sitetile-page: about\ntitle: About\nlang: en', 'About'),
    'contact.md': page('sitetile-page: contact\ntitle: Contact\nlang: en', 'Contact'),
    'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'posts/p1.md': '---\ntitle: P1\ndate: 2026-01-02\ntags: [crane]\n---\nBody text.\n',
    'posts/zh-tw/p1.md': '---\ntitle: 紙鶴一\ndate: 2026-01-02\ntags: [crane]\nlang: zh-TW\n---\n內文。\n',
    // No `lang:` of its own: the /zh-tw/ directory is what says which language it is.
    'posts/zh-tw/p2.md': '---\ntitle: 紙鶴二\ndate: 2026-01-03\ntags: [crane]\n---\n內文。\n',
  },
  // ── CVERInc/reef#2066, tile#136 review: the site config's `lang` DISAGREES with locales[0], and a
  // blog is on. The base views' meta.lang is then ja-JP (from `_site.md`) although the site's default
  // is en-US; a view must not take that for "this is a translated view".
  configDisagreesBlog: {
    '_site.md': '---\nbrand: Tsuru Paper\nlang: ja-JP\nlocales: en-US, ja-JP\npackages: lingo, blog\nblog-label-routes: true\nblog-tag-routes: true\ncopyright: © Tsuru Paper\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en-US', 'Paper cranes'),
    'ja-jp/home.md': page('sitetile-page: home\ntitle: 折り鶴\nlang: ja-JP', '折り鶴'),
    'posts/p1.md': '---\ntitle: P1\ndate: 2026-01-02\ntags: [crane]\n---\nBody text.\n',
    'posts/ja-jp/p1.md': '---\ntitle: 折り鶴一\ndate: 2026-01-02\ntags: [crane]\n---\n本文。\n',
  },
  // ── CVERInc/reef#1910 items 5 and 7: the engine's "home" links and the blog's hreflang. English
  // default, zh-TW second; a post in both languages (p1) and one in English only (p2).
  homeLinks: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en, zh-TW\npackages: lingo, blog\nbreadcrumb-label: Paper\nfooter-brand: Tsuru Paper\nfooter-cols: Shop: Cranes=/cranes\nblog-breadcrumb: true\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'about.md': page('sitetile-page: about\ntitle: About\nlang: en', 'About'),
    'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'zh-tw/about.md': page('sitetile-page: about\ntitle: 關於\nlang: zh-TW', '關於'),
    'posts/p1.md': '---\ntitle: P1\ndate: 2026-01-02\n---\nBody text.\n',
    'posts/p2.md': '---\ntitle: P2\ndate: 2026-01-03\n---\nBody text.\n',
    'posts/zh-tw/p1.md': '---\ntitle: 紙鶴一\ndate: 2026-01-02\nlang: zh-TW\n---\n內文。\n',
  },
  // CVERInc/reef#1910 item 5, the pager: page size 1, two English posts (two pages), one translated
  // (one page). Page 1 exists in both languages; English page 2 exists in one.
  homeLinksPager: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en, zh-TW\npackages: lingo, blog\nblog-page-size: 1\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'posts/p1.md': '---\ntitle: P1\ndate: 2026-01-02\n---\nBody text.\n',
    'posts/p2.md': '---\ntitle: P2\ndate: 2026-01-03\n---\nBody text.\n',
    'posts/zh-tw/p1.md': '---\ntitle: 紙鶴一\ndate: 2026-01-02\nlang: zh-TW\n---\n內文。\n',
  },
  // The same shape in zh-Hant: the old default must come out exactly as before.
  monoZh: {
    '_site.md': '---\nbrand: 紙鶴工坊\n---\n',
    'home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-Hant', '紙鶴'),
    'about.md': page('sitetile-page: about\ntitle: 關於\nlang: zh-Hant', '關於'),
  },
  // Says nothing at all. Must keep getting exactly what it got before.
  undeclared: {
    '_site.md': '---\nbrand: Nobody\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Nobody', 'Nothing declared'),
  },
  // ── CVERInc/reef#2112 r2 (tile#157 review): pages of the owner's own whose URL is `<seg>/404/`.
  // 🩸 The first rename moved ANY two-segment `…/404/` route, so this one-language site lost the
  // directory index of a page it wrote. `manual` is not a locale; nothing here declares one.
  monoManual404: {
    '_site.md': '---\nbrand: Tsuru Paper\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'manual/404.md': page('sitetile-page: manual-404\ntitle: What a 404 means\nlang: en', 'What a 404 means'),
  },
  // The same page on a two-locale site: `about` is not one of the editions, so it stays a page.
  multiAbout404: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en, zh-TW\npackages: lingo\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
    'about/404.md': page('sitetile-page: about-404\ntitle: Our 404 story\nlang: en', 'Our 404 story'),
  },
  // A declared edition with NO home of its own: ja-jp has a page and a site layer, not a home.md.
  // Its 404 (and its chooser) wore the root home's chrome — the English footer wordmark.
  noHomeJa: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en, ja-JP\nfooter-brand: Tsuru Paper Works\nfooter-cols: Shop: Cranes=/cranes\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
    'ja-jp/_site.md': '---\nfooter-brand: 折り鶴工房\nfooter-cols: 店: 鶴=/ja-jp/cranes\n---\n',
    'ja-jp/about.md': page('sitetile-page: about\ntitle: 紹介\nlang: ja-JP', '紹介'),
  },
};
// Built a second time by a copy of this engine with the reef#2112 feature taken out (the route and
// the integration) — the reference for "byte-identical to a build without it".
const BASELINE = ['monoManual404', 'monoEn', 'multiAbout404'];

const htmlLang = (html) => (/<html lang="([^"]*)"/.exec(html) || [])[1];
// EVERY language-chooser link on the page, not the first: a later one would be the one clicked.
const langLinks = (html) => [...html.matchAll(/<a class="[^"]*\brf-lang\b[^"]*" href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const inLanguage = (html) => [...html.matchAll(/"inLanguage":"([^"]*)"/g)].map((m) => m[1]);

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · not-found-locale END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (the four builds below are the only part that reads a real 404.html; a green run without them is narrower)');
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-404-locale-'));
  const built = {};
  const walk = (d) => (existsSync(d) ? readdirSync(d) : []).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  // The reference engine for BASELINE: this checkout with the reef#2112 route and integration taken
  // out, everything else the same files (symlinked; the renderer copied, because a build stages
  // content into it). Each removal throws if it found nothing to remove — a reference that quietly
  // still has the feature would make "byte-identical" true of anything.
  const shadowEngine = () => {
    const root = join(work, '_engine-without-2112');
    mkdirSync(root, { recursive: true });
    for (const n of readdirSync(ENGINE)) if (n !== 'packages' && n !== '.git') symlinkSync(join(ENGINE, n), join(root, n));
    mkdirSync(join(root, 'packages'), { recursive: true });
    for (const n of readdirSync(join(ENGINE, 'packages'))) if (n !== 'sitetile') symlinkSync(join(ENGINE, 'packages', n), join(root, 'packages', n));
    const skip = new Set([join(ASTRO, 'node_modules'), join(ASTRO, 'dist'), join(ASTRO, '.astro')]);
    cpSync(join(ENGINE, 'packages/sitetile'), join(root, 'packages/sitetile'), { recursive: true, filter: (src) => !skip.has(src) });
    const astro = join(root, RENDERER_SUBPATH);
    symlinkSync(realpathSync(join(ASTRO, 'node_modules')), join(astro, 'node_modules'));
    const route = join(astro, 'src/pages/[...loc]/404.astro');
    if (!existsSync(route)) throw new Error('shadow engine: no [...loc]/404.astro to remove');
    rmSync(route);
    const cfgPath = join(astro, 'astro.config.mjs');
    const cfg = readFileSync(cfgPath, 'utf8');
    const stripped = cfg.replace(/,\s*locale404Pages\(\)/, '');
    if (stripped === cfg) throw new Error('shadow engine: locale404Pages() not found in astro.config.mjs');
    writeFileSync(cfgPath, stripped);
    return root;
  };
  const buildOne = (name, files, engine, tag) => {
    const irDir = join(work, name, 'ir');
    if (!existsSync(irDir)) for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(irDir, rel)), { recursive: true });
      writeFileSync(join(irDir, rel), body);
    }
    const outDir = join(work, name, tag);
    // Through the CLI (which is buildSite and nothing else) so the build's own log can be READ:
    // a warning is part of what a build produces, and buildSite hands its child our stdio.
    const r = spawnSync(process.execPath, [join(ENGINE, 'packages/build/cli.mjs'), irDir, outDir, '--site-url', 'https://example.com', '--engine', engine], { encoding: 'utf8' });
    const log = `${r.stdout || ''}\n${r.stderr || ''}`;
    const pages = Object.fromEntries(walk(outDir).filter((p) => p.endsWith('.html')).map((p) => [relative(outDir, p), readFileSync(p, 'utf8')]));
    return { outDir, code: r.status, log, pages, notFound: pages['404.html'] };
  };
  // EVERY file a build wrote (not only .html), as bytes, relative to its output directory.
  const distBytes = (outDir) => Object.fromEntries(walk(outDir).map((p) => [relative(outDir, p), readFileSync(p)]));
  const baseline = {};
  try {
    for (const [name, files] of Object.entries(SITES)) built[name] = buildOne(name, files, ENGINE, 'out');
    const shadow = shadowEngine();
    for (const name of BASELINE) baseline[name] = buildOne(name, SITES[name], shadow, 'out-without-2112');

    // A fixture's build, which must have SUCCEEDED — asserted where it is used, so a build that
    // fails turns the tests that read it red, by name, and leaves the others to run.
    const site = (name) => {
      const b = built[name];
      assert.equal(b.code, 0, `astro build failed for the ${name} fixture:\n${b.log.slice(-1200)}`);
      return b;
    };

    // A chooser href must name a file this build wrote. That is the whole defect, stated as a check.
    const resolves = (outDir, href) => {
      const p = href.split('?')[0].replace(/^\/+|\/+$/g, '');
      return existsSync(join(outDir, p, 'index.html')) || existsSync(join(outDir, `${p}.html`));
    };
    const alternates = (html) => [...html.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map((m) => ({ tag: m[1], href: m[2] }));
    const topDirs = (outDir) => readdirSync(outDir).filter((n) => statSync(join(outDir, n)).isDirectory()).sort();
    const allOf = (name, fn) => Object.entries(site(name).pages).flatMap(([rel, html]) => fn(html).map((v) => [rel, v]));
    // The chooser's own `?return=` script, run against the rows the build wrote: what each row's
    // href IS after a visitor arrives with that query string. Resolved the way a browser resolves
    // it (WHATWG URL), because the question is where a click goes, not what the string looks like.
    const ORIGIN = 'https://example.com';
    const chooserRows = (chooserHtml, search) => {
      const rows = [...chooserHtml.matchAll(/<a href="([^"]*)" hreflang="[^"]*" data-language-link data-locale="([^"]*)"/g)]
        .map((m) => ({ built: m[1], href: m[1], locale: m[2] }));
      assert.ok(rows.length >= 2, 'no chooser rows found — the fixture stopped exercising the chooser');
      const script = [...chooserHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((t) => t.includes('data-language-link'));
      assert.equal(script.length, 1, 'expected exactly one ?return= script on the chooser');
      const els = rows.map((row) => ({ getAttribute: (k) => (k === 'data-locale' ? row.locale : null), setAttribute: (k, v) => { if (k === 'href') row.href = v; } }));
      vm.runInNewContext(script[0], {
        URL, URLSearchParams,
        window: { location: { search, href: `${ORIGIN}/language${search}`, origin: ORIGIN } },
        document: { querySelectorAll: () => els, addEventListener: () => {} },
      });
      return rows.map((row) => ({ ...row, url: new URL(row.href, `${ORIGIN}/language`) }));
    };

    // ── CVERInc/reef#2112: one 404.html per declared non-default locale ──
    // Every `404.html` a build wrote and every `404/` directory it left, relative to the output.
    const notFoundFiles = (b) => Object.keys(b.pages).filter((rel) => /(^|\/)404\.html$/.test(rel)).sort();
    const notFoundDirs = (b) => Object.keys(b.pages).filter((rel) => /(^|\/)404\/index\.html$/.test(rel)).sort();
    const robots = (html) => (/<meta name="robots" content="([^"]*)"/.exec(html) || [])[1];

    await test('🔴 #2112 two locales → `zh-tw/404.html` is a FILE at that path, and no `zh-tw/404/index.html` is left', () => {
      const b = site('multiEn');
      assert.deepEqual(notFoundFiles(b), ['404.html', 'zh-tw/404.html']);
      assert.deepEqual(notFoundDirs(b), [], 'Astro\'s directory-index 404 survived the rename — Pages reads only <loc>/404.html');
      assert.equal(existsSync(join(b.outDir, 'zh-tw/404')), false, 'an empty zh-tw/404/ directory was left behind');
    });

    await test('🔴 #2112 the zh-tw 404 speaks Chinese: <html lang> from the Lingo table (zh-Hant, never zh-TW) and the zh uiCopy', () => {
      const zh = site('multiEn').pages['zh-tw/404.html'];
      assert.equal(htmlLang(zh), 'zh-Hant');
      assert.match(zh, /<h1>找不到頁面<\/h1>/);
      assert.match(zh, /這個網站上沒有這個網址。/);
      assert.match(zh, /<a href="\/zh-tw\/">回到首頁<\/a>/, 'the "home" link goes to THIS locale\'s home, not /');
      assert.doesNotMatch(zh, /Page not found/);
      assert.equal(robots(zh), 'noindex', 'every 404 stays noindex');
      assert.deepEqual([...new Set(inLanguage(zh))], ['zh-Hant'], 'the JSON-LD names another language than the document');
    });

    await test('🔴 #2112 the zh-tw 404 wears the zh-tw edition\'s chrome (its home\'s title), not the root\'s', () => {
      const zh = site('multiEn').pages['zh-tw/404.html'];
      assert.match(zh, /<title>找不到頁面 — 紙鶴工坊<\/title>/);
    });

    await test('🔴 #2112 the zh-tw 404\'s Language link behaves like the root one: that locale\'s chooser, returning to its home, and it exists', () => {
      const { pages, outDir } = site('multiEn');
      const links = langLinks(pages['zh-tw/404.html']);
      assert.ok(links.length >= 1, 'no Language link on the zh-tw 404 at all — the fixture stopped exercising it');
      for (const href of links) {
        assert.equal(href, '/zh-tw/language?return=%2Fzh-tw%2F', `not the zh-tw chooser returning to the zh-tw home: ${href}`);
        assert.ok(resolves(outDir, href), `the Language link points at a page the build never wrote: ${href}`);
      }
      // …and the chooser, arriving with that return, sends every row to its own home (the missing
      // address has no page to come back to) — the same place the root 404's `return=/` lands.
      const rows = chooserRows(pages['zh-tw/language/index.html'], '?return=%2Fzh-tw%2F');
      assert.deepEqual(rows.map((r) => r.url.pathname), ['/', '/zh-tw/']);
      assert.deepEqual(chooserRows(pages['language/index.html'], '?return=%2F').map((r) => r.url.pathname), ['/', '/zh-tw/'], 'CONTROL: the root 404\'s own return');
    });

    await test('🔴 #2112 the root 404 is unchanged: site default language, unprefixed chooser (tile#135)', () => {
      const { notFound } = site('multiEn');
      assert.equal(htmlLang(notFound), 'en');
      assert.match(notFound, /<a href="\/">Go to the homepage<\/a>/);
      assert.deepEqual(langLinks(notFound), ['/language?return=%2F']);
      assert.equal(robots(notFound), 'noindex');
    });

    await test('🔴 #2112 three locales → one 404.html per NON-default locale, each in its own language', () => {
      const b = site('triEnJaZh');
      assert.deepEqual(notFoundFiles(b), ['404.html', 'ja-jp/404.html', 'zh-tw/404.html']);
      assert.deepEqual(notFoundDirs(b), []);
      assert.equal(htmlLang(b.pages['ja-jp/404.html']), 'ja');
      assert.match(b.pages['ja-jp/404.html'], /<h1>ページが見つかりません<\/h1>/);
      assert.match(b.pages['ja-jp/404.html'], /<a href="\/ja-jp\/">ホームへ<\/a>/);
      assert.deepEqual(langLinks(b.pages['ja-jp/404.html']), ['/ja-jp/language?return=%2Fja-jp%2F']);
      assert.equal(htmlLang(b.pages['zh-tw/404.html']), 'zh-Hant');
      assert.equal(htmlLang(b.pages['404.html']), 'en');
    });

    await test('🔴 #2112 the default flipped (zh-TW first): the ENGLISH edition gets `en/404.html`; no zh-tw/404.html', () => {
      const b = site('multiZh');
      assert.deepEqual(notFoundFiles(b), ['404.html', 'en/404.html']);
      assert.equal(htmlLang(b.pages['en/404.html']), 'en');
      assert.match(b.pages['en/404.html'], /Page not found/);
      assert.equal(htmlLang(b.pages['404.html']), 'zh-Hant');
    });

    await test('🔴 #2112 one-language sites build NO locale 404: the root one only, exactly as before', () => {
      for (const name of ['monoJa', 'oneLocale', 'oneLocaleLingo', 'monoEn', 'noSiteFile', 'undeclared']) {
        const b = site(name);
        assert.deepEqual(notFoundFiles(b), ['404.html'], name);
        assert.deepEqual(notFoundDirs(b), [], name);
      }
    });

    // ── tile#157 review r2 ──
    // Two files a build wrote, compared byte for byte; the message names the first that differs.
    const sameBytes = (a, b, label) => {
      const A = distBytes(a.outDir); const B = distBytes(b.outDir);
      assert.deepEqual(Object.keys(A).sort(), Object.keys(B).sort(), `${label}: the two builds wrote different files`);
      const differ = Object.keys(A).filter((rel) => !A[rel].equals(B[rel]));
      assert.deepEqual(differ, [], `${label}: files whose bytes differ from the build without reef#2112`);
    };

    await test('🔴 #2112 r2 a one-language site\'s own `manual/404.md` keeps its directory index: `manual/404/index.html`, no `manual/404.html`', () => {
      const b = site('monoManual404');
      assert.ok(b.pages['manual/404/index.html'], `the owner's /manual/404/ page lost its directory index; 404s written: ${notFoundFiles(b).join(', ')}`);
      assert.match(b.pages['manual/404/index.html'], /What a 404 means/);
      assert.equal(existsSync(join(b.outDir, 'manual/404.html')), false, 'an authored page was turned into a fallback 404 document');
      assert.deepEqual(notFoundFiles(b), ['404.html']);
    });

    await test('🔴 #2112 r2 one-language sites: the WHOLE dist is byte-identical to a build without reef#2112 (not just the 404 paths)', () => {
      for (const name of ['monoManual404', 'monoEn']) {
        const ref = baseline[name];
        assert.equal(ref.code, 0, `the reference build failed for ${name}:\n${ref.log.slice(-1200)}`);
        sameBytes(site(name), ref, name);
      }
    });

    await test('🔴 #2112 r2 two locales + an authored `about/404.md`: `about/404/index.html` untouched; the only new file is zh-tw/404.html', () => {
      const b = site('multiAbout404');
      const ref = baseline.multiAbout404;
      assert.equal(ref.code, 0, `the reference build failed:\n${ref.log.slice(-1200)}`);
      assert.deepEqual(notFoundFiles(b), ['404.html', 'zh-tw/404.html'], 'about is not an edition — it must not get an about/404.html');
      assert.ok(b.pages['about/404/index.html'], 'the owner\'s /about/404/ page lost its directory index');
      const A = distBytes(b.outDir); const B = distBytes(ref.outDir);
      assert.deepEqual(Object.keys(A).filter((rel) => !(rel in B)).sort(), ['zh-tw/404.html'], 'files only the reef#2112 build wrote');
      assert.deepEqual(Object.keys(B).filter((rel) => !(rel in A)).sort(), [], 'files the reef#2112 build lost');
      assert.equal(A['about/404/index.html'].equals(B['about/404/index.html']), true, 'about/404/index.html changed bytes');
    });

    await test('🔴 #2112 r2 an edition with no home of its own: its 404 wears its `ja-jp/_site.md` layer, not the root\'s chrome', () => {
      const b = site('noHomeJa');
      assert.deepEqual(notFoundFiles(b), ['404.html', 'ja-jp/404.html'], 'the declared ja-JP edition gets its 404 (the chooser offers it a row)');
      const ja = b.pages['ja-jp/404.html'];
      assert.equal(htmlLang(ja), 'ja');
      assert.match(ja, /class="rf-foot-wordmark"[^>]*>折り鶴工房</, 'the ja-jp/_site.md footer wordmark');
      assert.doesNotMatch(ja, /Tsuru Paper Works/, 'the root layer\'s footer wordmark on the Japanese 404');
      // CONTROL: the root 404 still wears the root layer — the fixture is not just Japanese everywhere.
      assert.match(b.notFound, /class="rf-foot-wordmark"[^>]*>Tsuru Paper Works</);
      // …and the Japanese chooser, which reads the same editionMeta, agrees with the 404.
      assert.match(b.pages['ja-jp/language/index.html'], /class="rf-foot-wordmark"[^>]*>折り鶴工房</);
      // CONTROL: an ordinary ja-jp page already wore that layer — the 404 is now consistent with it.
      assert.match(b.pages['ja-jp/about/index.html'], /class="rf-foot-wordmark"[^>]*>折り鶴工房</);
    });

    await test('🔴 two locales, English default → the 404 is English', () => {
      const { notFound } = site('multiEn');
      assert.equal(htmlLang(notFound), 'en');
      assert.match(notFound, /Page not found/);
      assert.doesNotMatch(notFound, /找不到頁面/);
      assert.deepEqual([...new Set(inLanguage(notFound))], ['en'], 'the JSON-LD names another language than the document');
    });

    await test('🔴 two locales, English default → the Language link is /language, and it exists', () => {
      const { notFound, outDir } = site('multiEn');
      const links = langLinks(notFound);
      assert.ok(links.length >= 1, 'no Language link on the 404 at all — the fixture stopped exercising it');
      for (const href of links) {
        assert.match(href, /^\/language\?return=/, `not the default-locale chooser: ${href}`);
        assert.ok(resolves(outDir, href), `the Language link points at a page the build never wrote: ${href}`);
      }
      assert.equal(/zh-hant/i.test(links.join(' ')), false, `an attribute tag leaked into a URL: ${links.join(' ')}`);
    });

    await test('🔴 CONTROL: `resolves` can tell a missing chooser from a present one', () => {
      // Without this the `resolves` check above could be passing because it resolves everything.
      // `/zh-hant/language` is an attribute tag where a URL locale goes — no build emits it — and
      // `/zh-tw/language` is the real non-default chooser on this site.
      const { outDir } = site('multiEn');
      assert.equal(resolves(outDir, '/zh-hant/language?return=%2F404%2F'), false);
      assert.equal(resolves(outDir, '/zh-tw/language?return=%2F404%2F'), true, 'the non-default chooser should exist');
    });

    await test('two locales, zh-TW default → still zh-Hant, and its link resolves too', () => {
      const { notFound, outDir } = site('multiZh');
      assert.equal(htmlLang(notFound), 'zh-Hant', 'the attribute form of zh-TW, as before');
      assert.match(notFound, /找不到頁面/);
      const links = langLinks(notFound);
      assert.ok(links.length >= 1);
      for (const href of links) {
        assert.match(href, /^\/language\?return=/, `not the default-locale chooser: ${href}`);
        assert.ok(resolves(outDir, href), `points at a page the build never wrote: ${href}`);
      }
    });

    await test('🔴 one language (ja), no locales → the 404 is Japanese, not the page that sorts first', () => {
      const { notFound } = site('monoJa');
      assert.equal(htmlLang(notFound), 'ja');
      assert.match(notFound, /ページが見つかりません/);
      assert.deepEqual([...new Set(inLanguage(notFound))], ['ja']);
    });

    // ── CVERInc/reef#1868: a one-language site that is not zh-Hant ───────────────────────────
    for (const name of ['monoEn', 'monoEnSilentHome', 'noSiteFile']) {
      await test(`🔴 #1868 ${name}: the 404 and /preview/ speak English, and the JSON-LD says so`, () => {
        const { pages } = site(name);
        for (const rel of ['404.html', 'preview/index.html']) {
          assert.equal(htmlLang(pages[rel]), 'en', rel);
          assert.deepEqual([...new Set(inLanguage(pages[rel]))], ['en'], `${rel}: JSON-LD names another language than the document`);
          assert.doesNotMatch(pages[rel], /找不到頁面/, rel);
        }
        assert.match(pages['404.html'], /Page not found/);
      });
    }

    await test('🔴 #1868 monoEnBlog: /search and /search/label/<tag> speak English too', () => {
      const { pages } = site('monoEnBlog');
      for (const rel of ['404.html', 'preview/index.html', 'search/index.html', 'search/label/crane/index.html']) {
        assert.ok(pages[rel], `${rel} was not built — the fixture stopped exercising it`);
        assert.equal(htmlLang(pages[rel]), 'en', rel);
        assert.deepEqual([...new Set(inLanguage(pages[rel]))], ['en'], rel);
      }
    });

    // ── CVERInc/reef#2066: a site that declares `locales` — every system page and blog view ───────
    await test('🔴 #2066 multiEnBlog: /preview, /search, tag, /devlog, post and archive are all `en`, like the 404', () => {
      const { pages } = site('multiEnBlog');
      const rels = ['404.html', 'preview/index.html', 'search/index.html', 'search/label/crane/index.html', 'tag/crane/index.html',
        'devlog/index.html', 'devlog/p1/index.html', '2026/index.html', '2026/01/index.html'];
      for (const rel of rels) {
        assert.ok(pages[rel], `${rel} was not built — the fixture stopped exercising it`);
        assert.equal(htmlLang(pages[rel]), 'en', rel);
        assert.deepEqual([...new Set(inLanguage(pages[rel]))].filter((l) => l !== 'en'), [], `${rel}: JSON-LD names another language than the document`);
      }
    });

    await test('🔴 #2066 multiEnBlog: base views link the default chooser (/language), as the 404 does', () => {
      const { pages } = site('multiEnBlog');
      for (const rel of ['404.html', 'preview/index.html', 'search/index.html', 'tag/crane/index.html', 'devlog/index.html', 'devlog/p1/index.html', '2026/index.html']) {
        const links = langLinks(pages[rel]);
        assert.ok(links.length >= 1, `${rel}: no Language link — the fixture stopped exercising it`);
        for (const href of links) assert.match(href, /^\/language\?return=/, `${rel}: ${href}`);
      }
    });

    await test('🔴 #2066 multiEnBlog: translated posts (with AND without `lang:`) and the locale blog stay zh-Hant, chooser /zh-tw/language', () => {
      const { pages } = site('multiEnBlog');
      for (const rel of ['zh-tw/devlog/index.html', 'zh-tw/devlog/p1/index.html', 'zh-tw/devlog/p2/index.html', 'zh-tw/tag/crane/index.html']) {
        assert.ok(pages[rel], `${rel} was not built — the fixture stopped exercising it`);
        assert.equal(htmlLang(pages[rel]), 'zh-Hant', rel);
        const links = langLinks(pages[rel]);
        assert.ok(links.length >= 1, `${rel}: no Language link`);
        for (const href of links) assert.match(href, /^\/zh-tw\/language\?return=/, `${rel}: ${href}`);
      }
    });

    await test('🔴 #2066 configDisagreesBlog: base /devlog, post and tag archive follow locales[0] (en), not the config `lang` (ja-JP)', () => {
      const { pages } = site('configDisagreesBlog');
      for (const rel of ['404.html', 'preview/index.html', 'devlog/index.html', 'devlog/p1/index.html', 'tag/crane/index.html']) {
        assert.ok(pages[rel], `${rel} was not built — the fixture stopped exercising it`);
        assert.equal(htmlLang(pages[rel]), 'en', rel);
        assert.deepEqual([...new Set(inLanguage(pages[rel]))].filter((l) => l !== 'en'), [], rel);
        assert.ok(langLinks(pages[rel]).length >= 1, `${rel}: no Language link — the fixture stopped exercising it`);
        for (const href of langLinks(pages[rel])) assert.match(href, /^\/language\?return=/, `${rel}: ${href}`);
      }
    });

    await test('🔴 #2066 configDisagreesBlog: the ja-JP edition (post without `lang:`) stays ja', () => {
      const { pages } = site('configDisagreesBlog');
      for (const rel of ['ja-jp/devlog/index.html', 'ja-jp/devlog/p1/index.html', 'ja-jp/tag/crane/index.html']) {
        assert.ok(pages[rel], `${rel} was not built — the fixture stopped exercising it`);
        assert.equal(htmlLang(pages[rel]), 'ja', rel);   // the attribute form of ja-JP
        assert.ok(langLinks(pages[rel]).length >= 1, `${rel}: no Language link — the fixture stopped exercising it`);
        for (const href of langLinks(pages[rel])) assert.match(href, /^\/ja-jp\/language\?return=/, `${rel}: ${href}`);
      }
    });

    // ── CVERInc/reef#2066, the last item: "`/zh-tw/search/` renders `<html lang="en">`" ─────────
    // 🩸 Measured on production (wtg, 2026-10-17): /search/, /zh-tw/search/, /zh-tw/preview/ and two
    // made-up paths all answered 404 with the SAME bytes (one md5) — the root 404.html, which speaks
    // the site's default language by the rule at the top of this file. The build writes no
    // locale-prefixed /search or /preview: the search route emits exactly /search (its own header
    // says so) and /preview has no locale in it. So there was no "prefixed system page" whose lang
    // could follow its prefix; the page with the wrong-looking lang was the 404 wearing that URL.
    // Two things are held here so the next reader does not fix a page that does not exist:
    //   1. the full set of pages written under a locale prefix, each in THAT locale's language — a
    //      sweep over what the build WROTE, so a new prefixed route is covered the day it appears;
    //   2. the two URLs the issue named are not written at all, while their unprefixed twins are
    //      (the control: the feature is ON, the locale edition is a true absence, not a gate).
    await test('🔴 #2066 multiEnBlog: EVERY page written under /zh-tw/ is zh-Hant — the sweep, not a hand-kept list', () => {
      const { pages } = site('multiEnBlog');
      const prefixed = Object.keys(pages).filter((rel) => rel.startsWith('zh-tw/')).sort();
      // The sweep has to see the whole family or it proves nothing: the locale home, the chooser,
      // the blog index, both translated posts (with and without `lang:`) and the tag archive.
      for (const must of ['zh-tw/index.html', 'zh-tw/language/index.html', 'zh-tw/devlog/index.html', 'zh-tw/devlog/p1/index.html', 'zh-tw/devlog/p2/index.html', 'zh-tw/tag/crane/index.html']) {
        assert.ok(prefixed.includes(must), `${must} was not built — the fixture stopped exercising it`);
      }
      const wrong = prefixed.filter((rel) => htmlLang(pages[rel]) !== 'zh-Hant').map((rel) => `${rel} → ${htmlLang(pages[rel])}`);
      assert.deepEqual(wrong, [], `pages under /zh-tw/ that do not speak zh-Hant:\n${wrong.join('\n')}`);
      const unprefixed = Object.keys(pages).filter((rel) => !rel.startsWith('zh-tw/'));
      const wrongBase = unprefixed.filter((rel) => htmlLang(pages[rel]) !== 'en').map((rel) => `${rel} → ${htmlLang(pages[rel])}`);
      assert.deepEqual(wrongBase, [], `unprefixed pages that do not speak the site default (en):\n${wrongBase.join('\n')}`);
    });

    await test('🔴 #2066 multiEnBlog: no /zh-tw/search/ or /zh-tw/preview/ is written; what production served there is the root 404', () => {
      const { pages, outDir } = site('multiEnBlog');
      // CONTROL first: the unprefixed twins exist, so an absence below is not "the feature is off".
      assert.ok(pages['search/index.html'], '/search/ was not built — blog-search is off in the fixture, the control is gone');
      assert.ok(pages['preview/index.html'], '/preview/ was not built');
      for (const rel of ['zh-tw/search/index.html', 'zh-tw/preview/index.html', 'zh-tw/404/index.html']) {
        assert.equal(pages[rel], undefined, `${rel} was written — then its lang is a real question, and this test is out of date`);
      }
      assert.equal(existsSync(join(outDir, 'zh-tw', 'search')), false);
      assert.equal(existsSync(join(outDir, 'zh-tw', 'preview')), false);
      // The ROOT 404 speaks the site's default, by the rule this whole file holds. 🩸 CVERInc/reef#2112:
      // this list used to hold `zh-tw/404.html` too, with "a per-locale 404 is a hosting question" — it
      // was, and the answer is one 404.html per declared locale, which Pages serves as the nearest one
      // up the tree. So a missing /zh-tw/… path is now answered by `zh-tw/404.html`, in Chinese.
      assert.equal(htmlLang(pages['404.html']), 'en');
      assert.equal(htmlLang(pages['zh-tw/404.html']), 'zh-Hant', 'the zh-tw edition\'s own 404 (reef#2112)');
    });

    await test('#1868 monoZh and undeclared: the system pages are exactly zh-Hant, as before', () => {
      for (const name of ['monoZh', 'undeclared']) {
        const { pages } = site(name);
        for (const rel of ['404.html', 'preview/index.html']) {
          assert.equal(htmlLang(pages[rel]), 'zh-Hant', `${name} ${rel}`);
          assert.deepEqual([...new Set(inLanguage(pages[rel]))], ['zh-Hant'], `${name} ${rel}`);
        }
        assert.match(pages['404.html'], /找不到頁面/);
      }
    });

    await test('nothing declared → exactly the shared default, as before', () => {
      const { notFound } = site('undeclared');
      assert.equal(htmlLang(notFound), DEFAULT_LANG);
      assert.match(notFound, /找不到頁面/);
      assert.deepEqual(langLinks(notFound), [], 'a site with no locales grew a Language link');
    });

    // ── CVERInc/reef#1910 · 1: one declared locale is not an install ──────────────────────────
    for (const [name, lang] of [['oneLocale', 'zh-TW'], ['oneLocaleLingo', 'ko']]) {
      await test(`🔴 ${name}: no alternates, no x-default, no Language link, no chooser, no banner`, () => {
        const { outDir, pages } = site(name);
        assert.ok(Object.keys(pages).length >= 4, `only ${Object.keys(pages).length} pages built — the fixture shrank`);
        assert.deepEqual(allOf(name, alternates), [], 'a one-language site advertised an alternate');
        assert.deepEqual(allOf(name, langLinks), [], 'a one-language site links to a language chooser');
        assert.equal(existsSync(join(outDir, 'language')), false, 'a chooser was built for one language');
        assert.deepEqual(Object.keys(pages).filter((rel) => /locale-banner/.test(pages[rel])), [], 'banner markup or CSS shipped');
        assert.deepEqual(topDirs(outDir).filter((d) => /^[a-z]{2}-[a-z]{2}$/.test(d)), [], 'a locale directory was written');
      });
      await test(`${name}: <html lang> still says the one language`, () => {
        const { pages } = site(name);
        for (const rel of ['index.html', 'about/index.html', '404.html']) assert.equal(htmlLang(pages[rel]), lang, rel);
      });
    }

    await test('🔴 CONTROL: the same counters DO see a two-locale site\'s alternates, links and chooser', () => {
      // Otherwise every "deepEqual(..., [])" above could be a regex that matches nothing.
      const { outDir } = site('multiEn');
      assert.ok(allOf('multiEn', alternates).length >= 4);
      assert.ok(allOf('multiEn', langLinks).length >= 2);
      assert.equal(existsSync(join(outDir, 'language', 'index.html')), true);
      assert.deepEqual(topDirs(outDir).filter((d) => /^[a-z]{2}-[a-z]{2}$/.test(d)), ['zh-tw']);
    });

    // ── 2: the root page's `lang` disagrees with locales[0] ──────────────────────────────────
    await test('🔴 rootDisagrees: the build SAYS the home page and `locales` disagree, and which wins', () => {
      const lines = site('rootDisagrees').log.split('\n').filter((l) => l.includes('sitetile: the home page says'));
      assert.equal(lines.length, 1, `expected the warning exactly once, got ${lines.length}`);
      assert.ok(lines[0].includes('lang: zh-TW') && lines[0].includes('en-US first'), lines[0]);
      assert.match(lines[0], /en-US wins/);
    });

    await test('rootDisagrees: nothing else changed — locales[0] still owns `/`', () => {
      const home = site('rootDisagrees').pages['index.html'];
      assert.equal(htmlLang(home), 'zh-Hant', 'the page still says its own language');
      assert.deepEqual(alternates(home), [
        { tag: 'en', href: 'https://example.com/' }, { tag: 'x-default', href: 'https://example.com/' }]);
    });

    await test('🔴 CONTROL: sites whose home page agrees with `locales` are not warned', () => {
      for (const name of ['multiEn', 'multiZh', 'bracketed', 'oneLocale', 'monoJa', 'undeclared']) {
        assert.equal(site(name).log.includes('the home page says'), false, `${name} was warned`);
      }
    });

    // ── 3: list spellings never become a path ────────────────────────────────────────────────
    for (const [name, other, rootLang] of [['bracketed', 'en-us', 'ja'], ['quoted', 'ko-kr', 'zh-Hant']]) {
      await test(`🔴 ${name}: the locale directory is ${other}/ — no bracket or quote in any path`, () => {
        const { outDir, pages } = site(name);
        assert.deepEqual(topDirs(outDir).filter((d) => !['_astro', 'preview', 'language'].includes(d)), [other]);
        assert.equal(existsSync(join(outDir, other, 'language', 'index.html')), true, 'its chooser was not built');
        const bad = Object.keys(pages).filter((rel) => /[\[\]"']|%5B|%5D|%22/i.test(rel));
        assert.deepEqual(bad, []);
        const hrefs = [...allOf(name, alternates).map(([, a]) => a.href), ...allOf(name, langLinks).map(([, h]) => h)];
        assert.ok(hrefs.length >= 6, 'too few links to mean anything');
        assert.deepEqual(hrefs.filter((h) => /[\[\]"']|%5B|%5D|%22|&quot;/i.test(h)), [], 'list punctuation reached a URL');
        assert.equal(htmlLang(pages['index.html']), rootLang);
        assert.equal(htmlLang(pages['404.html']), rootLang, 'the 404 read the first locale with its bracket still on');
      });
    }

    await test('🔴 unsafe: `../kiln` is refused BY NAME and nothing is built from it', () => {
      const { code, log, outDir } = built.unsafe;
      assert.notEqual(code, 0, 'the build accepted a path as a locale');
      assert.match(log, /sitetile: locales entry "\.\.\/kiln" is not a locale code/);
      assert.equal(existsSync(join(outDir, 'index.html')), false, 'pages were written anyway');
      assert.deepEqual(readdirSync(join(work, 'unsafe')).sort().filter((n) => n !== 'out'), ['ir'], 'something was written beside the output directory');
    });

    await test('🔴 unsafe: the message names the file the line is in', () => {
      assert.ok(built.unsafe.log.includes('Fix the `locales:` line in content/_site.md.'), built.unsafe.log.slice(-600));
    });

    await test('🔴 pageLocales: a PAGE\'s own bad `locales` does not fail the build — one warning per page, naming it', () => {
      const { log } = site('pageLocales');
      const lines = log.split('\n').filter((l) => l.includes('locales entry'));
      assert.equal(lines.length, 2, `expected one warning for each of the two pages, got ${lines.length}:\n${lines.join('\n')}`);
      const about = lines.filter((l) => l.includes('sitetile: locales entry "ko/kr" in content/about.md is not a locale code'));
      // A locale home is `content/zh-tw.md` to the renderer (the build collapses `<locale>/home.md`).
      const home = lines.filter((l) => l.includes('sitetile: locales entry "../kiln" in content/zh-tw.md is not a locale code'));
      assert.equal(about.length, 1, lines.join('\n'));
      assert.equal(home.length, 1, 'a locale home is read by the chooser route too — it must still be warned about once');
      for (const l of lines) assert.ok(l.endsWith('This page\'s own `locales:` line is IGNORED: the page uses the site\'s list from content/_site.md.'), l);
      assert.equal(log.includes('Fix the `locales:` line'), false, 'the build-failing message was printed for a page\'s line');
    });

    await test('🔴 pageLocales: the ignored value reaches no directory and no link, and the page gets the site\'s list', () => {
      const { outDir, pages } = site('pageLocales');
      assert.deepEqual(topDirs(outDir).filter((d) => !['_astro', 'preview', 'language', 'about'].includes(d)), ['zh-tw']);
      assert.deepEqual(walk(outDir).map((p) => relative(outDir, p)).filter((rel) => /ko|kr|kiln|\.\./i.test(rel)), [], 'a path was made from the ignored value');
      const hrefs = [...allOf('pageLocales', alternates).map(([, a]) => a.href), ...allOf('pageLocales', langLinks).map(([, h]) => h)];
      assert.ok(hrefs.length >= 8, 'too few links to mean anything');
      assert.deepEqual(hrefs.filter((h) => /ko|kr|kiln|\.\.|%2F%2E|%2e%2e/i.test(h.replace('https://example.com', ''))), [], 'the ignored value reached a URL');
      // The page that wrote the bad line advertises exactly what its sibling pages do.
      assert.deepEqual(alternates(pages['about/index.html']).map((a) => a.tag), ['en', 'zh-Hant', 'x-default']);
      assert.deepEqual(langLinks(pages['about/index.html']).map((h) => h.split('?')[0]), ['/language']);
      assert.equal(existsSync(join(outDir, 'zh-tw', 'language', 'index.html')), true, 'the zh-tw chooser was not built');
    });

    await test('🔴 CONTROL: no other fixture is warned about a page\'s `locales`', () => {
      for (const name of ['multiEn', 'oneLocale', 'bracketed', 'quoted', 'monoJa', 'undeclared']) {
        assert.equal(site(name).log.includes('locales entry'), false, `${name} was warned`);
      }
    });

    // ── 1, again: a `language-href:` the link policy refuses is not the owner's link ───────────
    await test('🔴 oneLocaleUnsafeHref: a refused `language-href:` leaves NO Language link — not a fallback to a chooser nobody built', () => {
      const { outDir, pages } = site('oneLocaleUnsafeHref');
      assert.ok(Object.keys(pages).length >= 3, `only ${Object.keys(pages).length} pages built — the fixture shrank`);
      assert.deepEqual(allOf('oneLocaleUnsafeHref', langLinks), []);
      assert.equal(existsSync(join(outDir, 'language')), false, 'a chooser was built for one language');
      assert.deepEqual(Object.keys(pages).filter((rel) => /javascript:/i.test(pages[rel])), [], 'the refused value reached a page');
    });

    await test('oneLocaleOwnHref: an ordinary `language-href:` on a one-locale site is kept exactly as written', () => {
      const { outDir, pages } = site('oneLocaleOwnHref');
      const links = allOf('oneLocaleOwnHref', langLinks);
      assert.equal(links.length, Object.keys(pages).length, 'not one Language link per page');
      assert.deepEqual([...new Set(links.map(([, href]) => href))], ['https://example.com/other-editions']);
      assert.equal(existsSync(join(outDir, 'language')), false, 'a chooser was built for one language');
    });

    await test('multiUnsafeHref: two locales and a refused `language-href:` → the built chooser, which exists', () => {
      const { outDir, pages } = site('multiUnsafeHref');
      // `/preview/` is the engine's own route and takes the engine's language, not this site's (a
      // known gap, the same on a site with no `language-href:` at all) — not what is measured here.
      const links = allOf('multiUnsafeHref', langLinks).filter(([rel]) => !rel.startsWith('preview/'));
      assert.ok(links.length >= 3, 'too few Language links to mean anything');
      for (const [rel, href] of links) {
        assert.match(href, /^(\/ko-kr)?\/language\?return=/, `${rel}: ${href}`);
        assert.ok(resolves(outDir, href), `${rel}: the Language link points at a page the build never wrote: ${href}`);
      }
      assert.deepEqual(Object.keys(pages).filter((rel) => /javascript:/i.test(pages[rel])), [], 'the refused value reached a page');
    });

    // ── 4: the way back from the 404's chooser ───────────────────────────────────────────────
    await test('🔴 the 404\'s Language link returns to the chosen language\'s HOME, not to /404/', () => {
      for (const name of ['multiEn', 'multiZh']) {
        const { outDir, pages, notFound } = site(name);
        const links = langLinks(notFound);
        assert.ok(links.length >= 1);
        for (const href of links) {
          assert.equal(new URL(href, ORIGIN).searchParams.get('return'), '/', `${name}: ${href}`);
          const rows = chooserRows(pages['language/index.html'], href.slice(href.indexOf('?')));
          for (const row of rows) {
            assert.ok(resolves(outDir, row.url.pathname), `${name}: choosing ${row.locale} lands on ${row.url.pathname}, which was never built`);
            assert.equal(row.href, row.built, 'home is where the row already pointed');
          }
        }
      }
    });

    await test('CONTROL: from an ordinary page the chooser still returns to THAT page', () => {
      // …so "return=/" above is the 404's own answer, not the return feature being switched off.
      const { pages } = site('multiEn');
      const rows = chooserRows(pages['language/index.html'], '?return=%2Fabout%2F&has=en,zh-tw');
      assert.deepEqual(rows.map((r) => r.href), ['/about/', '/zh-tw/about/']);
      // …and through a non-default page's own prefix, which bare() takes off first.
      assert.deepEqual(chooserRows(pages['zh-tw/language/index.html'], '?return=%2Fzh-tw%2Fabout%2F').map((r) => r.href), ['/about/', '/zh-tw/about/']);
    });

    await test('🔴 `return=` never takes a chooser row off this site', () => {
      // 🩸 CVERInc/reef#1910. The script checked "starts with one slash". A browser reads `/\` as
      // `//`, deletes a tab or newline between two slashes, and bare() itself removed a locale
      // prefix standing in front of two — each put another origin on the default locale's row.
      const hostile = ['/\\evil.example', '/\\/evil.example', '/\t/evil.example', '/\n/evil.example', '/zh-tw//evil.example',
        '/zh-tw/\\evil.example', '//evil.example', '///evil.example', 'https://evil.example/', 'javascript:alert(1)',
        '/..//evil.example', '/../../evil.example', '\\\\evil.example', ' //evil.example', '/%5Cevil.example', '/@evil.example'];
      const { pages } = site('multiEn');
      for (const chooser of ['language/index.html', 'zh-tw/language/index.html']) {
        for (const value of hostile) {
          for (const row of chooserRows(pages[chooser], `?return=${encodeURIComponent(value)}`)) {
            assert.equal(row.url.origin, ORIGIN, `${chooser} ?return=${JSON.stringify(value)}: the ${row.locale} row goes to ${row.url.href}`);
          }
        }
      }
    });

    // ── 5: one definition of the site's default language ─────────────────────────────────────
    await test('🔴 configDisagrees: the 404 follows `locales`, like every other route — not the config\'s `lang`', () => {
      const { notFound, outDir } = site('configDisagrees');
      assert.equal(htmlLang(notFound), 'en', 'the 404 is in the language that lives at /');
      assert.match(notFound, /Page not found/);
      for (const href of langLinks(notFound)) {
        assert.match(href, /^\/language\?return=%2F$/, `not the default-locale chooser: ${href}`);
        assert.ok(resolves(outDir, href));
      }
      // …which is what the home page at `/` said all along.
      assert.equal(htmlLang(site('configDisagrees').pages['index.html']), 'en');
    });

    // ── CVERInc/reef#1910 item 7: the engine's four "home" links follow the page's locale ─────────
    const homeHrefs = (html) => ({
      crumb: [...html.matchAll(/<nav class="[^"]*\brf-breadcrumb\b[^"]*"[^>]*>\s*<a href="([^"]*)"/g)].map((m) => m[1]),
      wordmark: [...html.matchAll(/<a class="rf-foot-wordmark" href="([^"]*)"/g)].map((m) => m[1]),
    });
    await test('🔴 #1910 homeLinks: on /zh-tw/ pages the breadcrumb home, the footer wordmark and the post breadcrumb are /zh-tw/', () => {
      const { pages } = site('homeLinks');
      for (const rel of ['zh-tw/about/index.html', 'zh-tw/devlog/p1/index.html']) {
        assert.ok(pages[rel], `${rel} was not built — the fixture stopped exercising it`);
        const h = homeHrefs(pages[rel]);
        assert.ok(h.crumb.length >= 1 && h.wordmark.length === 1, `${rel}: the links were not rendered (${JSON.stringify(h)}) — the fixture stopped exercising them`);
        for (const href of [...h.crumb, ...h.wordmark]) assert.equal(href, '/zh-tw/', rel);
      }
    });
    await test('CONTROL #1910 homeLinks: on default-locale pages the same links are still /', () => {
      const { pages } = site('homeLinks');
      for (const rel of ['about/index.html', 'devlog/p1/index.html']) {
        const h = homeHrefs(pages[rel]);
        assert.ok(h.crumb.length >= 1 && h.wordmark.length === 1, `${rel}: the links were not rendered`);
        for (const href of [...h.crumb, ...h.wordmark]) assert.equal(href, '/', rel);
      }
    });

    // ── CVERInc/reef#1910 item 5: the blog routes carry hreflang, measured by the route ───────────
    await test('🔴 #1910 homeLinks: a post that exists in both languages names both, reciprocally, plus x-default', () => {
      const { pages } = site('homeLinks');
      const want = [{ tag: 'en', href: 'https://example.com/devlog/p1/' }, { tag: 'zh-Hant', href: 'https://example.com/zh-tw/devlog/p1/' },
        { tag: 'x-default', href: 'https://example.com/devlog/p1/' }];
      for (const rel of ['devlog/p1/index.html', 'zh-tw/devlog/p1/index.html']) {
        assert.ok(pages[rel], `${rel} was not built`);
        assert.deepEqual(alternates(pages[rel]), want, rel);
      }
    });
    await test('🔴 #1910 homeLinks: the blog index in both languages is reciprocal', () => {
      const { pages } = site('homeLinks');
      for (const rel of ['devlog/index.html', 'zh-tw/devlog/index.html']) {
        assert.ok(pages[rel], `${rel} was not built`);
        assert.deepEqual(alternates(pages[rel]).map((a) => a.tag), ['en', 'zh-Hant', 'x-default'], rel);
      }
    });
    await test('CONTROL #1910 homeLinks: a post that exists in English only advertises nothing (no dead alternate)', () => {
      const { pages } = site('homeLinks');
      assert.ok(pages['devlog/p2/index.html'], 'devlog/p2 was not built');
      assert.deepEqual(alternates(pages['devlog/p2/index.html']), []);
    });
    await test('🔴 #1910 homeLinksPager: page 1 names both languages; English page 2 (no translation) names nothing', () => {
      const { pages } = site('homeLinksPager');
      const p2 = Object.keys(pages).filter((r) => /^devlog\/page\/2\/index\.html$/.test(r));
      assert.equal(p2.length, 1, 'English page 2 was not built — the fixture stopped exercising the pager');
      assert.deepEqual(alternates(pages[p2[0]]), [], 'a pager page that exists in one language emitted an alternate');
      assert.ok(!pages['zh-tw/devlog/page/2/index.html'], 'the translated blog grew a page 2 — the fixture stopped being uneven');
      for (const rel of ['devlog/index.html', 'zh-tw/devlog/index.html']) {
        assert.ok(pages[rel], `${rel} was not built`);
        assert.deepEqual(alternates(pages[rel]).map((a) => a.tag), ['en', 'zh-Hant', 'x-default'], rel);
      }
    });
  } finally {
    if (process.env.KEEP_404_LOCALE_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
