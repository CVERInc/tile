// An inbox form's success card sends the visitor back to the home of the language they are reading.
//   run: node packages/sitetile/form-home-locale.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 CVERInc/reef#1891. Measured on a two-locale site whose default is English: after a successful
// submit on the zh-TW contact page, the card's two links were
//     <a href="/zh-tw/contact/" data-inbox-again>   ← in the visitor's language
//     <a href="/">                                  ← the ENGLISH home
// The first is the page's own built path. The second was a literal. The engine writes both links
// and the owner can edit neither, so a visitor who had just written to the site in one language
// was handed back to it in another.
//
// The rule this file holds: "Back to homepage" is the home of the locale the page's own URL sits
// under, and the locale prefix is used only when that locale's home CONTENT FILE exists. A language
// with a contact page and no home file yet keeps `/`: a link to the other language's home is a
// detour, a link to a missing page is a dead end. The measurement is "the content file is there" —
// the same one hreflang uses — so a content file that exists but is never built into a page (for
// instance a `home.md` with no `sitetile-page:`) is outside what this file checks.
//
// The header logo is deliberately NOT measured: it keeps the prefix alone, because changing that
// would move the logo on every page of every multi-language site. Its answer is pinned below.
//
// It needs the renderer's dependencies and SAYS SO when they are absent — same shape as
// not-found-locale.test.mjs. The pure half below runs regardless.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';
import * as lingo from './astro/src/packages/lingo/locale.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// ── the pure half ────────────────────────────────────────────────────────────────────────────
// `localeHomePath({ locales, pathname, contentRels })`. Uneven on purpose: the default (ko-KR) is
// neither first nor last alphabetically, zh-TW is mixed-case, and `en` has pages but no home.
const LOCALES = 'ko-KR, zh-TW, en';
const RELS = new Set(['home', 'help/contact', 'zh-tw', 'zh-tw/help/contact', 'en/help/contact']);
const home = (pathname, over = {}) => {
  assert.equal(typeof lingo.localeHomePath, 'function', 'lingo/locale.mjs does not export localeHomePath');
  return lingo.localeHomePath({ locales: LOCALES, pathname, contentRels: RELS, ...over });
};

await test('🔴 a page under a non-default locale → that locale\'s home, in its URL spelling', () => {
  assert.equal(home('/zh-tw/help/contact/'), '/zh-tw/');
  assert.equal(home('/zh-tw/'), '/zh-tw/');
  assert.equal(home('zh-tw/help/contact'), '/zh-tw/', 'slashes on the pathname are not part of the question');
});

await test('a default-locale page → /', () => {
  assert.equal(home('/help/contact/'), '/');
  assert.equal(home('/'), '/');
  // The default locale has no prefix; a path that happens to start with its code is an ordinary page.
  assert.equal(home('/ko-kr/help/', { contentRels: new Set([...RELS, 'ko-kr']) }), '/');
});

await test('🔴 a locale with pages but NO home content file → /, not the prefix', () => {
  assert.equal(home('/en/help/contact/'), '/');
});

await test('a locale home written as <loc>/home, before the build collapses it, counts too', () => {
  assert.equal(home('/en/help/contact/', { contentRels: new Set(['home', 'en/home']) }), '/en/');
});

await test('no measurement handed in → the prefix alone decides (the header logo\'s existing answer)', () => {
  assert.equal(home('/en/help/contact/', { contentRels: undefined }), '/en/');
  assert.equal(home('/help/contact/', { contentRels: undefined }), '/');
});

await test('a site that declares no locales → / for every path, whatever it looks like', () => {
  for (const locales of ['', undefined, []]) {
    assert.equal(home('/zh-tw/help/contact/', { locales }), '/');
    assert.equal(home('/en/', { locales }), '/');
  }
  // One declared language: it is the default, so nothing is prefixed.
  assert.equal(home('/zh-tw/help/contact/', { locales: 'zh-TW' }), '/');
});

await test('a first segment that only LOOKS like a locale is a page, not a language', () => {
  assert.equal(home('/english/help/'), '/');
  assert.equal(home('/zh-TW/help/'), '/', 'the URL form is lowercase; the data spelling is not a prefix');
  assert.equal(home('/zh/help/'), '/');
});

// ── the real half: IR in, HTML out ───────────────────────────────────────────────────────────
const formPage = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: form action=inbox %%\n\nA fixture form.\n\n### Email {email}\n### Message {textarea}\n`;
const plain = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: prose %%\n\nA fixture page.\n`;
const SITES = {
  // Three declared languages. The default (ko-KR) is not the first alphabetically. zh-TW has a home
  // and spells its pages `lang: zh-Hant` — a correct spelling that is NOT its URL prefix. `en` has a
  // contact page and no home. Every form sits two levels down, so "the page's own path" and "the
  // home" are never the same string.
  multi: {
    '_site.md': '---\nbrand: Tsuru Paper\nlocales: ko-KR, zh-TW, en\n---\n',
    'home.md': plain('sitetile-page: home\ntitle: 종이학\nlang: ko-KR', '종이학'),
    'help/contact.md': formPage('sitetile-page: contact\ntitle: 문의\nlang: ko-KR', '문의'),
    'zh-tw/home.md': plain('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-Hant', '紙鶴'),
    'zh-tw/help/contact.md': formPage('sitetile-page: contact\ntitle: 聯絡我們\nlang: zh-Hant', '聯絡我們'),
    'en/help/contact.md': formPage('sitetile-page: contact\ntitle: Contact\nlang: en', 'Contact'),
  },
  // One language, no `locales:`. `en/contact` is a folder that merely looks like a locale.
  mono: {
    '_site.md': '---\nbrand: 折り鶴\n---\n',
    'home.md': plain('sitetile-page: home\ntitle: 折り鶴\nlang: ja', '折り鶴'),
    'help/contact.md': formPage('sitetile-page: contact\ntitle: お問い合わせ\nlang: ja', 'お問い合わせ'),
    'en/contact.md': formPage('sitetile-page: contact-en\ntitle: Contact\nlang: ja', 'Contact'),
  },
  // Says nothing at all about language.
  undeclared: {
    '_site.md': '---\nbrand: Nobody\n---\n',
    'home.md': plain('sitetile-page: home\ntitle: Nobody', 'Nothing declared'),
    'help/contact.md': formPage('sitetile-page: contact\ntitle: Contact', 'Contact'),
  },
};

// EVERY "back" and "again" link in the page, not the first: a later one would be the one clicked.
const hrefs = (html, cls) => [...html.matchAll(new RegExp(`<p class="${cls}"><a href="([^"]*)"`, 'g'))].map((m) => m[1]);
const backLinks = (html) => hrefs(html, 'st-form-success-back');
const againLinks = (html) => hrefs(html, 'st-form-success-again');
const logoLinks = (html) => [...html.matchAll(/<a class="rf-logo reef-logo" href="([^"]*)"/g)].map((m) => m[1]);

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · form-home-locale END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (the three builds below are the only part that reads a real form page; a green run without them is narrower)');
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-form-home-'));
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
      built[name] = { outDir, read: (rel) => readFileSync(join(outDir, rel, 'index.html'), 'utf8') };
    }
    const resolves = (outDir, href) => existsSync(join(outDir, href.replace(/^\/+|\/+$/g, ''), 'index.html'));
    // One card per fixture page, so "exactly one link" also proves the fixture still renders it.
    const one = (list, what) => { assert.equal(list.length, 1, `expected exactly one ${what}, found ${list.length}`); return list[0]; };

    await test('🔴 non-default locale with a home → Back to homepage is /zh-tw/, and it exists', () => {
      const { outDir, read } = built.multi;
      const html = read('zh-tw/help/contact');
      assert.equal(one(againLinks(html), '"send another" link'), '/zh-tw/help/contact/', 'the fixture stopped being a locale form page');
      const back = one(backLinks(html), '"back to homepage" link');
      assert.equal(back, '/zh-tw/');
      assert.ok(resolves(outDir, back), `points at a page the build never wrote: ${back}`);
      assert.equal(back, one(logoLinks(html), 'header logo'), 'the card and the header logo disagree about where home is');
    });

    await test('default-locale form page → /', () => {
      const html = built.multi.read('help/contact');
      assert.equal(one(againLinks(html), '"send another" link'), '/help/contact/');
      assert.equal(one(backLinks(html), '"back to homepage" link'), '/');
    });

    await test('🔴 a locale with a form page but no home file → /, and /en/ really is not there', () => {
      const { outDir, read } = built.multi;
      const html = read('en/help/contact');
      assert.equal(one(againLinks(html), '"send another" link'), '/en/help/contact/');
      const back = one(backLinks(html), '"back to homepage" link');
      assert.equal(back, '/');
      assert.ok(resolves(outDir, back));
      // CONTROL: without this, "/" could be passing on a fixture that grew an /en/ home.
      assert.equal(resolves(outDir, '/en/'), false, 'the fixture has an /en/ home now — this case no longer tests the fallback');
      assert.equal(resolves(outDir, '/zh-tw/'), true, '`resolves` cannot see a home that is there');
    });

    // The logo is NOT the same rule as the card, on purpose. The card measures that the locale's home
    // content exists (this PR, measured); the logo has always used the URL prefix alone and this PR
    // leaves it alone, because measuring it would change the logo on every page of every
    // multi-language site. So on `en/help/contact` (an `en` with no home) the two answers differ:
    // logo `/en/` (a 404 today, unchanged), card `/`. These three pin the logo's side of that.
    await test('🔴 the header logo is the URL prefix alone: /en/ where en has no home, / on the default locale', () => {
      const { read } = built.multi;
      const en = read('en/help/contact');
      assert.equal(one(logoLinks(en), 'header logo'), '/en/', 'the logo now measures the home (or got hard-coded): its output changed');
      assert.equal(one(backLinks(en), '"back to homepage" link'), '/', 'the card should have stayed measured');
      const def = read('help/contact');
      assert.equal(one(logoLinks(def), 'header logo'), '/');
      assert.equal(one(backLinks(def), '"back to homepage" link'), '/');
    });

    await test('one language, no locales → / on every form page, locale-looking folder included', () => {
      const { read } = built.mono;
      assert.equal(one(backLinks(read('help/contact')), '"back to homepage" link'), '/');
      assert.equal(one(againLinks(read('en/contact')), '"send another" link'), '/en/contact/');
      assert.equal(one(backLinks(read('en/contact')), '"back to homepage" link'), '/');
    });

    await test('nothing declared → the two links exactly as they were', () => {
      const html = built.undeclared.read('help/contact');
      const tail = /<p class="st-form-success-again">[\s\S]*?<\/div>/.exec(html);
      assert.ok(tail, 'no success card on the undeclared fixture');
      assert.equal(tail[0], '<p class="st-form-success-again"><a href="/help/contact/" data-inbox-again>再送一則</a></p> <p class="st-form-success-back"><a href="/">回首頁</a></p> </div>');
    });
  } finally {
    if (process.env.KEEP_FORM_HOME_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
