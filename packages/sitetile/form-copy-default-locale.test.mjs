// An inbox form speaks the language its page's <html lang> says, including when no `lang:` is written.
//   run: node packages/sitetile/form-copy-default-locale.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 A Site whose `_site.md` says `locales: en, zh-TW` and writes no `lang:` rendered
// `<html lang="en">` (PageView: `site.meta.lang || systemPageLang(...)`, i.e. locales[0]) while its
// form baked the engine default's copy — `data-required-msg="這是必填欄位。"`, `送出中…`, the zh
// success card — because Form.astro read only the page's own `lang` and fell to DEFAULT_LANG.
// The rule this file holds: with no `lang:`, the form's copy follows the same default the document
// language uses (meta.lang, else locales[0], else DEFAULT_LANG). A Site that writes `lang:` (site
// config or page) is unchanged: its copy is that language, as before.
//
// Needs the renderer's dependencies and SAYS SO when they are absent (same shape as
// form-home-locale.test.mjs).

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';
import { inboxFormCopy } from './astro/src/packages/lingo/locale.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const formPage = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: form action=inbox %%\n\nA fixture form.\n\n### Email {email}\n### Message {textarea}\n`;
const plain = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: prose %%\n\nA fixture page.\n`;
const SITES = {
  // The defect: locales declared, no `lang:` anywhere.
  localesOnly: {
    '_site.md': '---\nbrand: Paper Crane\nlocales: en, zh-TW\n---\n',
    'home.md': plain('sitetile-page: home\ntitle: Paper Crane', 'Paper Crane'),
    'contact.md': formPage('sitetile-page: contact\ntitle: Contact', 'Contact'),
  },
  // Explicit `lang:` in the site config over a locales list whose first entry is another language.
  siteLang: {
    '_site.md': '---\nbrand: Paper Crane\nlang: zh-Hant\nlocales: en, zh-TW\n---\n',
    'home.md': plain('sitetile-page: home\ntitle: Paper Crane', 'Paper Crane'),
    'contact.md': formPage('sitetile-page: contact\ntitle: Contact', 'Contact'),
  },
  // Explicit `lang:` on the page itself.
  pageLang: {
    '_site.md': '---\nbrand: Paper Crane\nlocales: en, zh-TW\n---\n',
    'home.md': plain('sitetile-page: home\ntitle: Paper Crane\nlang: en', 'Paper Crane'),
    'contact.md': formPage('sitetile-page: contact\ntitle: 聯絡\nlang: ja', 'Contact'),
  },
  // Nothing declared at all: the engine default, as before.
  undeclared: {
    '_site.md': '---\nbrand: Nobody\n---\n',
    'home.md': plain('sitetile-page: home\ntitle: Nobody', 'Nothing declared'),
    'contact.md': formPage('sitetile-page: contact\ntitle: Contact', 'Contact'),
  },
};

const htmlLang = (html) => (/<html lang="([^"]*)"/.exec(html) || [])[1];
const requiredMsgs = (html) => [...html.matchAll(/data-required-msg="([^"]*)"/g)].map((m) => m[1]);
const copyOf = (lang) => inboxFormCopy(lang);

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · form-copy-default-locale END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-form-copy-lang-'));
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
    const msgs = (html) => { const m = requiredMsgs(html); assert.ok(m.length >= 1, 'the fixture form has no required field'); return m; };

    await test('🔴 locales: en, zh-TW and no lang → <html lang="en"> and the form copy is English', () => {
      const html = built.localesOnly('contact');
      assert.equal(htmlLang(html), 'en', 'the fixture stopped exercising locales[0] as the document language');
      const en = copyOf('en');
      for (const m of msgs(html)) assert.equal(m, en.fieldRequired);
      assert.ok(html.includes(en.submitting), `submitting copy is not English (${en.submitting})`);
      const zh = copyOf('zh-Hant');
      assert.ok(!html.includes(zh.fieldRequired), 'zh-Hant required-field copy still baked in');
      assert.ok(!html.includes(zh.submitting), 'zh-Hant submitting copy still baked in');
    });

    await test('site config lang: zh-Hant over locales: en, zh-TW → zh-Hant copy (unchanged)', () => {
      const html = built.siteLang('contact');
      assert.equal(htmlLang(html), 'zh-Hant');
      for (const m of msgs(html)) assert.equal(m, copyOf('zh-Hant').fieldRequired);
    });

    await test('page lang: ja → ja copy (unchanged)', () => {
      const html = built.pageLang('contact');
      assert.equal(htmlLang(html), 'ja');
      for (const m of msgs(html)) assert.equal(m, copyOf('ja').fieldRequired);
    });

    await test('nothing declared → the engine default copy (unchanged)', () => {
      const html = built.undeclared('contact');
      for (const m of msgs(html)) assert.equal(m, copyOf('zh-Hant').fieldRequired);
    });
  } finally {
    if (process.env.KEEP_FORM_COPY_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
