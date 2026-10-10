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
// It needs the renderer's dependencies and SAYS SO when they are absent — same shape as
// packages/build/build-site.test.mjs. The pure half below runs regardless.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';
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
  return blog.siteDefaultLang(meta, glob(files));
};

await test('the site config\'s own `lang` wins over everything else', () => {
  assert.equal(sdl({ lang: 'ko-KR', locales: 'zh-TW, en' }, { 'home.md': 'sitetile-page: home\nlang: ja' }), 'ko-KR');
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

// ── the real half: IR in, HTML out ───────────────────────────────────────────────────────────
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: hero %%\n\nA fixture page.\n`;
const SITES = {
  // The measured shape: two locales, English default, `lang` only on the pages.
  multiEn: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: en, zh-TW\npackages: lingo\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
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
  // Says nothing at all. Must keep getting exactly what it got before.
  undeclared: {
    '_site.md': '---\nbrand: Nobody\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Nobody', 'Nothing declared'),
  },
};

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
  try {
    for (const [name, files] of Object.entries(SITES)) {
      const irDir = join(work, name, 'ir');
      for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(irDir, rel)), { recursive: true });
        writeFileSync(join(irDir, rel), body);
      }
      const outDir = join(work, name, 'out');
      const r = await buildSite({ irDir, engineDir: ENGINE, outDir, siteUrl: 'https://example.com' });
      assert.equal(r.code, 0, `astro build failed for the ${name} fixture`);
      built[name] = { outDir, notFound: readFileSync(join(outDir, '404.html'), 'utf8') };
    }

    // A chooser href must name a file this build wrote. That is the whole defect, stated as a check.
    const resolves = (outDir, href) => {
      const p = href.split('?')[0].replace(/^\/+|\/+$/g, '');
      return existsSync(join(outDir, p, 'index.html')) || existsSync(join(outDir, `${p}.html`));
    };

    await test('🔴 two locales, English default → the 404 is English', () => {
      const { notFound } = built.multiEn;
      assert.equal(htmlLang(notFound), 'en');
      assert.match(notFound, /Page not found/);
      assert.doesNotMatch(notFound, /找不到頁面/);
      assert.deepEqual([...new Set(inLanguage(notFound))], ['en'], 'the JSON-LD names another language than the document');
    });

    await test('🔴 two locales, English default → the Language link is /language, and it exists', () => {
      const { notFound, outDir } = built.multiEn;
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
      const { outDir } = built.multiEn;
      assert.equal(resolves(outDir, '/zh-hant/language?return=%2F404%2F'), false);
      assert.equal(resolves(outDir, '/zh-tw/language?return=%2F404%2F'), true, 'the non-default chooser should exist');
    });

    await test('two locales, zh-TW default → still zh-Hant, and its link resolves too', () => {
      const { notFound, outDir } = built.multiZh;
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
      const { notFound } = built.monoJa;
      assert.equal(htmlLang(notFound), 'ja');
      assert.match(notFound, /ページが見つかりません/);
      assert.deepEqual([...new Set(inLanguage(notFound))], ['ja']);
    });

    await test('nothing declared → exactly the shared default, as before', () => {
      const { notFound } = built.undeclared;
      assert.equal(htmlLang(notFound), DEFAULT_LANG);
      assert.match(notFound, /找不到頁面/);
      assert.deepEqual(langLinks(notFound), [], 'a site with no locales grew a Language link');
    });
  } finally {
    if (process.env.KEEP_404_LOCALE_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
