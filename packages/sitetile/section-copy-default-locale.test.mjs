// Every section's built-in copy speaks the language its page's <html lang> says, including when no
// `lang:` is written.
//   run: node packages/sitetile/section-copy-default-locale.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 PageView resolved `<html lang>` as `site.meta.lang || systemPageLang(...)` (so `locales[0]` on a
// Site with no `lang:`) but handed its sections the bare `site.meta.lang`. A Site with
// `locales: zh-TW, en` and no `lang:` rendered `<html lang="zh-TW">` around a collection saying
// "Updated …" / "View on GitHub". The root-mounted blog home did the same with `meta.lang` and gave
// its home-body form no `meta` at all, so on `locales: en, zh-TW` the form there baked the engine
// default's zh copy under `<html lang="en">`.
// Collection also looked its chrome up by the exact lower-cased tag (`zh-tw`, `ja-jp`, `ko-kr`), while
// the resolved document language is written `zh-Hant` / `ja` / `ko`, so it fell to English even when
// it got the language. It now finds the table row by locale identity (sameLocale), as Lingo does.
// The rule this file holds: sections get the page's resolved language. A Site that writes `lang:`
// (site config or page) gets the same `lang` as before; only a Collection whose `lang:` is another
// spelling of zh/ja/ko (`zh-Hant`, `ja`, `ko`) changes, from English to that language.
//
// Needs the renderer's dependencies and SAYS SO when they are absent (same shape as
// form-copy-default-locale.test.mjs).

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';
import { inboxFormCopy } from './astro/src/packages/lingo/locale.mjs';

// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve —
// the same seam blog-excerpt-plain.test.mjs teaches the resolver.
const HERE = dirname(fileURLToPath(import.meta.url));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { carouselPostDate } = await import('./astro/src/lib/blog.mjs');

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const COLLECTION = '## Tools\n%% sitetile: collection %%\n\nA fixture collection.\n\n### Group\n'
  + '#### Compose →https://github.com/example/compose "Stable"\nArrange a page.\nlearn: /tools/compose\nupdated: 2026-08-29\n';
const FORM = '## Contact\n%% sitetile: form action=inbox %%\n\nA fixture form.\n\n### Email {email}\n### Message {textarea}\n';
const page = (fm, body) => `---\n${fm}\n---\n\n${body}`;
const POST = '---\ntitle: P1\ndate: 2026-01-02\n---\nBody text.\n';
const SITES = {
  // The defect on an ordinary page: locales declared (zh-TW first), no `lang:` anywhere.
  pageLocalesOnly: {
    '_site.md': '---\nbrand: Paper Crane\nlocales: zh-TW, en\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Paper Crane', COLLECTION),
  },
  // Nothing declared: the engine default (zh-Hant) is the document language, so zh chrome.
  pageUndeclared: {
    '_site.md': '---\nbrand: Paper Crane\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Paper Crane', COLLECTION),
  },
  // Explicit site `lang: zh-Hant`: the same language as the zh-tw row, written another way.
  pageZhHant: {
    '_site.md': '---\nbrand: Paper Crane\nlang: zh-Hant\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Paper Crane', COLLECTION),
  },
  // Explicit site `lang:` over a locales list whose first entry is another language: as before.
  pageSiteLang: {
    '_site.md': '---\nbrand: Paper Crane\nlang: ja-JP\nlocales: zh-TW, en\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Paper Crane', COLLECTION),
  },
  // The defect on a root-mounted blog home: its home-body sections (form + collection).
  blogHomeEn: {
    '_site.md': '---\nbrand: Paper Crane\nlocales: en, zh-TW\npackages: blog\nblog-path: /\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Paper Crane', FORM),
    'posts/p1.md': POST,
  },
  blogHomeZh: {
    '_site.md': '---\nbrand: Paper Crane\nlocales: zh-TW, en\npackages: blog\nblog-path: /\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Paper Crane', COLLECTION),
    'posts/p1.md': POST,
  },
  // Explicit site `lang:` on the blog home: as before.
  blogHomeSiteLang: {
    '_site.md': '---\nbrand: Paper Crane\nlang: ja-JP\nlocales: en, zh-TW\npackages: blog\nblog-path: /\n---\n',
    'home.md': page('sitetile-page: home\ntitle: Paper Crane', FORM + '\n' + COLLECTION),
    'posts/p1.md': POST,
  },
};

const htmlLang = (html) => (/<html lang="([^"]*)"/.exec(html) || [])[1];
const requiredMsgs = (html) => [...html.matchAll(/data-required-msg="([^"]*)"/g)].map((m) => m[1]);
const ZH_TW = { updated: '2026-08-29 更新', gh: '在 GitHub 看' };
const JA = { updated: '2026-08-29 更新', gh: 'GitHub で見る' };
const EN = { updated: 'Updated 2026-08-29', gh: 'View on GitHub' };
const hasChrome = (html, ui) => html.includes(ui.updated) && html.includes(ui.gh);

// Carousel takes `lang` too. Its date is the blog index's (indexDateLang reads meta.lang whenever a
// format is set, and no format means the fixed YY/M/D form), so the page language does not reach
// it: measured here so the pass-through claim stays true.
await test('carousel post dates do not depend on the section lang (every known date format)', () => {
  for (const fmt of [undefined, 'ymd-slash', 'cjk', 'cjk-full', 'cjk-badge', 'cjk-md']) {
    for (const metaLang of [undefined, 'en', 'zh-TW']) {
      const meta = { ...(fmt ? { 'blog-date-format': fmt } : {}), ...(metaLang ? { lang: metaLang } : {}), locales: 'en, zh-TW' };
      const bare = carouselPostDate('2026-01-02', meta, undefined);
      for (const viewLang of ['en', 'zh-TW', 'ja-JP']) {
        assert.equal(carouselPostDate('2026-01-02', meta, viewLang), bare, `format=${fmt} meta.lang=${metaLang} lang=${viewLang}`);
      }
    }
  }
});

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · section-copy-default-locale END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-section-copy-lang-'));
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
      built[name] = (rel) => readFileSync(join(outDir, rel, 'index.html'), 'utf8');
    }

    await test('🔴 page: locales: zh-TW, en and no lang → <html lang="zh-Hant"> and zh-TW collection chrome', () => {
      const html = built.pageLocalesOnly('');
      assert.equal(htmlLang(html), 'zh-Hant', 'the fixture stopped exercising locales[0] as the document language');
      assert.ok(hasChrome(html, ZH_TW), 'collection chrome is not zh-TW');
      assert.ok(!html.includes(EN.gh), 'English collection chrome still rendered');
    });

    await test('🔴 page: nothing declared → <html lang="zh-Hant"> and zh-TW collection chrome', () => {
      const html = built.pageUndeclared('');
      assert.equal(htmlLang(html), 'zh-Hant');
      assert.ok(hasChrome(html, ZH_TW), 'collection chrome is not zh-TW');
    });

    await test('🔴 page: site lang: zh-Hant → zh-TW collection chrome (the same locale, another spelling)', () => {
      const html = built.pageZhHant('');
      assert.equal(htmlLang(html), 'zh-Hant');
      assert.ok(hasChrome(html, ZH_TW), 'collection chrome is not zh-TW');
    });

    await test('page: site lang: ja-JP over locales: zh-TW, en → ja collection chrome (unchanged)', () => {
      const html = built.pageSiteLang('');
      assert.equal(htmlLang(html), 'ja');
      assert.ok(hasChrome(html, JA), 'collection chrome is not ja');
    });

    await test('🔴 blog home: locales: en, zh-TW and no lang → <html lang="en"> and the home form copy is English', () => {
      const html = built.blogHomeEn('');
      assert.equal(htmlLang(html), 'en', 'the fixture stopped exercising locales[0] on the blog home');
      const m = requiredMsgs(html);
      assert.ok(m.length >= 1, 'the blog home rendered no form');
      for (const s of m) assert.equal(s, inboxFormCopy('en').fieldRequired);
      assert.ok(!html.includes(inboxFormCopy('zh-Hant').submitting), 'zh-Hant submitting copy still baked in');
    });

    await test('🔴 blog home: locales: zh-TW, en and no lang → zh-TW collection chrome', () => {
      const html = built.blogHomeZh('');
      assert.equal(htmlLang(html), 'zh-Hant');
      assert.ok(hasChrome(html, ZH_TW), 'collection chrome is not zh-TW');
    });

    await test('blog home: site lang: ja-JP → ja form copy and ja collection chrome (unchanged)', () => {
      const html = built.blogHomeSiteLang('');
      const m = requiredMsgs(html);
      assert.ok(m.length >= 1, 'the blog home rendered no form');
      for (const s of m) assert.equal(s, inboxFormCopy('ja-JP').fieldRequired);
      assert.ok(hasChrome(html, JA), 'collection chrome is not ja');
    });
  } finally {
    if (process.env.KEEP_SECTION_COPY_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
