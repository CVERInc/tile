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
// The rule this file holds: the document language is toBcp47(lang) whether or not Lingo is on, so
// <html lang>, JSON-LD and RSS agree, and a single-locale site says what a Lingo site says. A tag
// toBcp47 does not know (fr-FR) passes through unchanged, as it does for RSS.
//
// Needs the renderer's dependencies and SAYS SO when they are absent (same shape as
// form-copy-default-locale.test.mjs).

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';

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
// What each single-locale site must declare, and the spelling a Lingo site already uses for it.
const CASES = [
  { name: 'zhTW', lang: 'zh-TW', tag: 'zh-Hant' },
  { name: 'zhCN', lang: 'zh-CN', tag: 'zh-Hans' },
  { name: 'enUS', lang: 'en-US', tag: 'en' },
  { name: 'jaJP', lang: 'ja-JP', tag: 'ja' },
  { name: 'zhHant', lang: 'zh-Hant', tag: 'zh-Hant' },      // already the tag: unchanged
  { name: 'frFR', lang: 'fr-FR', tag: 'fr-FR' },            // unknown to toBcp47: passes through
];
const SITES = Object.fromEntries(CASES.map((c) => [c.name, single(c.lang)]));
// Control: the same `lang:` on a Lingo site (two locales). This already wrote zh-Hant.
SITES.lingo = {
  '_site.md': '---\nbrand: Paper Crane\nlang: zh-TW\nlocales: zh-TW, en-US\npackages: blog\n---\n',
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

    await test('🔴 single locale, lang: zh-TW → no built page anywhere declares zh-TW (blog, post, 404, about)', () => {
      const pages = walk(out.zhTW).filter((p) => p.endsWith('.html'));
      assert.ok(pages.length >= 4, `expected home, about, blog and a post; built ${pages.length} pages`);
      const wrong = pages.filter((p) => {
        const html = readFileSync(p, 'utf8');
        return htmlLang(html) !== 'zh-Hant' || inLanguage(html).some((t) => t !== 'zh-Hant');
      }).map((p) => `${relative(out.zhTW, p)} → lang=${htmlLang(readFileSync(p, 'utf8'))}`);
      assert.deepEqual(wrong, [], `pages not on zh-Hant:\n${wrong.join('\n')}`);
    });

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
  } finally {
    if (process.env.KEEP_SINGLE_LOCALE_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
