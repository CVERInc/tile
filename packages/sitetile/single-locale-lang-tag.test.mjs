// A site with one language spells it the same way in <html lang>, JSON-LD inLanguage and RSS.
//   run: node packages/sitetile/single-locale-lang-tag.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 reef#3925. A site that writes `lang: zh-TW` and has no Lingo install (one language, no
// `packages: lingo`) wrote `<html lang="zh-TW">` and `"inLanguage":"zh-TW"`, while its RSS feed
// wrote `<language>zh-Hant</language>`: SiteLayout ran the config code through toBcp47 only when
// Lingo was on, and public-artifacts.mjs always did. Measured live on a customer site, all three
// on one build. A Lingo site with the same `lang:` has always said zh-Hant everywhere, so the same
// language had two spellings depending on whether a second locale was installed, and a coral or
// embed keyed on the document language saw a different tag on each kind of site.
//
// The rule this file holds (r2, after review): a single-locale site runs its `lang:` through
// siteLangTag (locale-tags.mjs). An EDITION code (zh-TW, zh-CN, en-US, ja-JP, ko-KR) becomes the
// tag a Lingo site writes for it, so <html lang>, JSON-LD and RSS agree on zh-Hant. Every other
// value is kept as written, in all three: en-GB, zh-HK, zh-Hant-HK, zh-yue, pt-BR, fr-FR, th and
// bare zh. The first cut used toBcp47, which falls back on the first subtag and so collapsed en-GB
// to `en` and zh-HK to zh-Hant. That costs a screen reader its Cantonese voice, changes client-side
// date formatting, and breaks lookups keyed on the site's own spelling (countdown data-src-zh-hk).
// Bare zh must stay zh: square-shop sends document.documentElement.lang to checkout, and zh-Hant
// there would switch a single-locale `lang: zh` shop's buyer-facing language.
// Lingo sites keep toBcp47 (the control below).
//
// Needs the renderer's dependencies and SAYS SO when they are absent (same shape as
// form-copy-default-locale.test.mjs).

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';
import { siteLangTag } from './locale-tags.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const plain = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: prose %%\n\nA fixture page.\n`;
const POST = '---\ntitle: P1\ndate: 2026-01-02\n---\nBody text.\n';
// One language, written as the config code, with a blog so the same build writes rss.xml.
const single = (lang) => ({
  '_site.md': `---\nbrand: Paper Crane\nlang: ${lang}\npackages: blog\n---\n`,
  'home.md': plain('sitetile-page: home\ntitle: Paper Crane', 'Paper Crane'),
  'about.md': plain('sitetile-page: about\ntitle: About', 'About'),
  'posts/p1.md': POST,
});
// What each single-locale site must declare in all three outputs.
const CASES = [
  // edition codes → the edition's tag (what a Lingo site and RSS already wrote)
  { name: 'zhTW', lang: 'zh-TW', tag: 'zh-Hant' },
  { name: 'zhCN', lang: 'zh-CN', tag: 'zh-Hans' },
  { name: 'enUS', lang: 'en-US', tag: 'en' },
  { name: 'jaJP', lang: 'ja-JP', tag: 'ja' },
  // everything else → as written (the r2 review: these were collapsed by toBcp47)
  { name: 'zhHant', lang: 'zh-Hant', tag: 'zh-Hant' },
  { name: 'enGB', lang: 'en-GB', tag: 'en-GB' },
  { name: 'zhHK', lang: 'zh-HK', tag: 'zh-HK' },
  { name: 'zhHantHK', lang: 'zh-Hant-HK', tag: 'zh-Hant-HK' },
  { name: 'zhYue', lang: 'zh-yue', tag: 'zh-yue' },
  { name: 'ptBR', lang: 'pt-BR', tag: 'pt-BR' },
  { name: 'frFR', lang: 'fr-FR', tag: 'fr-FR' },
  { name: 'th', lang: 'th', tag: 'th' },
  { name: 'zh', lang: 'zh', tag: 'zh' },                     // P3-2: a `lang: zh` shop keeps sending zh
];
const SITES = Object.fromEntries(CASES.map((c) => [c.name, single(c.lang)]));
// Control: the same `lang:` on a Lingo site (two locales). This already wrote zh-Hant.
SITES.lingo = {
  '_site.md': '---\nbrand: Paper Crane\nlang: zh-TW\nlocales: zh-TW, en-US\npackages: blog\n---\n',
  'home.md': plain('sitetile-page: home\ntitle: Paper Crane', 'Paper Crane'),
  'en-us/home.md': plain('sitetile-page: home\ntitle: Paper Crane\nlang: en-US', 'Paper Crane'),
  'posts/p1.md': POST,
};
// Control: a Lingo site keeps toBcp47, including its fallback. `lang: zh-HK` there is read as the
// zh-TW edition and written zh-Hant, in RSS too (the feed takes the Lingo branch).
SITES.lingoHK = {
  '_site.md': '---\nbrand: Paper Crane\nlang: zh-HK\nlocales: zh-TW, en-US\npackages: blog\n---\n',
  'home.md': plain('sitetile-page: home\ntitle: Paper Crane', 'Paper Crane'),
  'en-us/home.md': plain('sitetile-page: home\ntitle: Paper Crane\nlang: en-US', 'Paper Crane'),
  'posts/p1.md': POST,
};

const htmlLang = (html) => (/<html lang="([^"]*)"/.exec(html) || [])[1];
const inLanguage = (html) => [...new Set([...html.matchAll(/"inLanguage":"([^"]*)"/g)].map((m) => m[1]))];
const feedLanguage = (xml) => (/<language>([^<]*)<\/language>/.exec(xml) || [])[1];
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

// The helper on its own (no renderer needed). Case and padding of an edition code do not matter;
// nothing else is rewritten, only trimmed.
for (const [input, want] of [
  ['zh-TW', 'zh-Hant'], ['zh-tw', 'zh-Hant'], [' ZH-TW ', 'zh-Hant'], ['zh-CN', 'zh-Hans'], ['en-US', 'en'],
  ['ja-JP', 'ja'], ['ko-KR', 'ko'],
  ['en-GB', 'en-GB'], ['zh-HK', 'zh-HK'], ['zh-Hant-HK', 'zh-Hant-HK'], ['zh-yue', 'zh-yue'], ['pt-BR', 'pt-BR'],
  ['fr-FR', 'fr-FR'], ['th', 'th'], ['zh', 'zh'], ['en', 'en'], ['zh-Hant', 'zh-Hant'], ['zh-Hant-TW', 'zh-Hant-TW'],
  ['en-US-x-foo', 'en-US-x-foo'], [' en-GB ', 'en-GB'], ['', ''], [undefined, ''],
]) {
  await test(`siteLangTag(${JSON.stringify(input)}) → ${JSON.stringify(want)}`, () => assert.equal(siteLangTag(input), want));
}
for (const c of CASES) {
  await test(`the end-to-end table agrees with siteLangTag: ${c.lang} → ${c.tag}`, () => assert.equal(siteLangTag(c.lang), c.tag));
}

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · single-locale-lang-tag END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-single-locale-lang-'));
  const out = {};
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
      out[name] = outDir;
    }
    const page = (name, rel) => readFileSync(join(out[name], rel, 'index.html'), 'utf8');
    const feed = (name) => readFileSync(join(out[name], 'rss.xml'), 'utf8');

    for (const c of CASES) {
      await test(`🔴 single locale, lang: ${c.lang} → <html lang>, JSON-LD and RSS all say ${c.tag}`, () => {
        const home = page(c.name, '');
        assert.equal(feedLanguage(feed(c.name)), c.tag, 'the fixture stopped exercising the RSS spelling');
        assert.equal(htmlLang(home), c.tag, '<html lang> disagrees with RSS');
        assert.deepEqual(inLanguage(home), [c.tag], 'JSON-LD inLanguage disagrees with RSS');
      });
    }

    // Every built page (blog, post, 404, about), not only the home: an edition code is rewritten
    // everywhere, a regional tag is kept everywhere.
    for (const [name, want] of [['zhTW', 'zh-Hant'], ['zhHK', 'zh-HK']]) {
      await test(`🔴 single locale ${name}: every built page (blog, post, 404, about) declares ${want}`, () => {
        const pages = walk(out[name]).filter((p) => p.endsWith('.html'));
        assert.ok(pages.length >= 4, `expected home, about, blog and a post; built ${pages.length} pages`);
        const wrong = pages.filter((p) => {
          const html = readFileSync(p, 'utf8');
          return htmlLang(html) !== want || inLanguage(html).some((t) => t !== want);
        }).map((p) => `${relative(out[name], p)} → lang=${htmlLang(readFileSync(p, 'utf8'))}`);
        assert.deepEqual(wrong, [], `pages not on ${want}:\n${wrong.join('\n')}`);
      });
    }

    await test('single locale: no hreflang alternates (one language has nothing to switch to; unchanged)', () => {
      assert.ok(!/hreflang=/.test(page('zhTW', '')), 'a single-locale site advertised an alternate');
    });

    await test('Lingo control: lang: zh-TW + locales zh-TW, en-US → zh-Hant / en, as before', () => {
      const zh = page('lingo', '');
      assert.equal(htmlLang(zh), 'zh-Hant');
      assert.deepEqual(inLanguage(zh), ['zh-Hant']);
      assert.equal(feedLanguage(feed('lingo')), 'zh-Hant');
      assert.equal(htmlLang(page('lingo', 'en-us')), 'en');
    });

    await test('Lingo control: lang: zh-HK + locales zh-TW, en-US → zh-Hant in all three, as before (toBcp47)', () => {
      const zh = page('lingoHK', '');
      assert.equal(htmlLang(zh), 'zh-Hant');
      assert.deepEqual(inLanguage(zh), ['zh-Hant']);
      assert.equal(feedLanguage(feed('lingoHK')), 'zh-Hant');
    });
  } finally {
    if (process.env.KEEP_SINGLE_LOCALE_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
