// The /language chooser's row links carry the same hreflang as the page's own <head> alternates.
//   run: node packages/sitetile/language-hreflang.test.mjs
//
// 🩸 The head writes each locale's alternate as its BCP-47 tag (toBcp47: zh-TW → zh-Hant), and the
// chooser's rows wrote their URL form (`hreflang="zh-tw"`) — two spellings of one locale on one page,
// one of them not the tag the rest of the site uses for it. Every row's hreflang is now the tag the
// head gives the page that row links to.
//
// Built from real IR, read from the HTML the renderer wrote: the row markup and the head are two
// files (language.astro, SiteLayout.astro), and only the built page has both. Needs the renderer's
// dependencies; names itself SKIPPED without them, like the astro smoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../build/index.mjs';
import { toBcp47, toUrlLocale } from './locale.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
if (!existsSync(join(ENGINE, 'packages/sitetile/astro/node_modules'))) {
  console.log('  · language-hreflang SKIPPED — no packages/sitetile/astro/node_modules (run npm install there)');
  process.exit(0);
}

// Every edition the table knows, each with a home, so every row is a real link. en-US is the default.
const LOCALES = ['en-US', 'zh-TW', 'zh-CN', 'ja-JP', 'ko-KR'];
const DEFAULT_URL = toUrlLocale(LOCALES[0]);
const URL_LOCALES = LOCALES.slice(1).map(toUrlLocale);
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: prose %%\n\nA fixture page.\n`;
const FILES = {
  '_site.md': `---\nbrand: Fixture\nlocales: ${LOCALES.join(', ')}\n---\n`,
  'home.md': page('sitetile-page: home\ntitle: Home\nlang: en-US', 'Home'),
  ...Object.fromEntries(LOCALES.slice(1).map((l) => [`${toUrlLocale(l)}/home.md`,
    page(`sitetile-page: home\ntitle: Home ${l}\nlang: ${l}`, `Home ${l}`)])),
};

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)].slice(1).map((m) => [m[1], m[2] ?? '']));
const headAlternates = (html) => [...html.matchAll(/<link\b[^>]*\brel="alternate"[^>]*>/g)]
  .map((m) => attrs(m[0])).filter((a) => a.hreflang && a.hreflang !== 'x-default')
  .map((a) => ({ hreflang: a.hreflang, path: new URL(a.href, 'https://example.com/').pathname }));
const chooserRows = (html) => [...html.matchAll(/<a\b[^>]*\bdata-language-link\b[^>]*>/g)]
  .map((m) => attrs(m[0])).map((a) => ({ hreflang: a.hreflang, path: a.href, locale: a['data-locale'] }));

const work = mkdtempSync(join(tmpdir(), 'tile-language-hreflang-'));
try {
  const irDir = join(work, 'ir');
  for (const [rel, body] of Object.entries(FILES)) {
    mkdirSync(dirname(join(irDir, rel)), { recursive: true });
    writeFileSync(join(irDir, rel), body);
  }
  const outDir = join(work, 'out');
  const r = await buildSite({ irDir, engineDir: ENGINE, outDir, siteUrl: 'https://example.com' });
  assert.equal(r.code, 0, 'astro build failed for the fixture');
  const chooserPages = { '/language/': 'language/index.html',
    ...Object.fromEntries(LOCALES.slice(1).map((l) => [`/${toUrlLocale(l)}/language/`, `${toUrlLocale(l)}/language/index.html`])) };

  for (const [at, file] of Object.entries(chooserPages)) {
    const html = readFileSync(join(outDir, file), 'utf8');
    const head = headAlternates(html);
    const rows = chooserRows(html);

    await test(`${at}: the fixture is what it claims — a row and an alternate per edition`, () => {
      assert.equal(rows.length, LOCALES.length, `rows: ${JSON.stringify(rows)}`);
      assert.equal(head.length, LOCALES.length, `head alternates: ${JSON.stringify(head)}`);
      assert.deepEqual(head.map((h) => h.hreflang).sort(), LOCALES.map(toBcp47).sort(), 'the head writes the BCP-47 tag');
    });

    await test(`🔴 ${at}: every row's hreflang is the head's hreflang for that row's locale`, () => {
      // The head's alternates on this page point at each locale's /language page; a row points at
      // that locale's home. Both are told apart by the path's locale prefix (none = the default).
      const localeOfPath = (p) => (URL_LOCALES.includes(p.split('/')[1]) ? p.split('/')[1] : DEFAULT_URL);
      for (const row of rows) {
        assert.equal(localeOfPath(row.path), row.locale, `row ${row.locale} links ${row.path}`);
        const alt = head.filter((h) => localeOfPath(h.path) === row.locale);
        assert.equal(alt.length, 1, `head alternates for ${row.locale}: ${JSON.stringify(alt)}`);
        assert.equal(row.hreflang, alt[0].hreflang, `row ${row.locale} → ${row.path}`);
      }
      assert.deepEqual(rows.map((r) => r.hreflang).sort(), head.map((h) => h.hreflang).sort());
    });

    await test(`${at}: data-locale keeps the URL form — the ?return= script prefixes paths with it`, () => {
      assert.deepEqual(rows.map((r) => r.locale).sort(), LOCALES.map(toUrlLocale).sort());
    });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
