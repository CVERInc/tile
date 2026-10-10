// REEF with Repo Facts — the page half's small pure parts.
//   run: node packages/dynamic-corals/repo-facts/repo-facts-core.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { repoOf, langOf, relative, UPDATED, ARCHIVED } from './repo-facts-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-10-10T12:00:00Z');

test('a repository link is exactly https://github.com/<owner>/<repo>, of the owner asked about', () => {
  for (const href of ['https://github.com/CVERInc/clikae', 'https://github.com/cverinc/Clikae/', 'https://github.com/CVERInc/clikae.git']) {
    assert.equal(repoOf(href, 'CVERInc'), 'clikae', href);
  }
  for (const href of ['https://github.com/CVERInc', 'https://github.com/CVERInc/clikae/issues', 'https://github.com/other/clikae',
    'https://github.com.evil.example/CVERInc/clikae', 'https://gist.github.com/CVERInc/clikae', 'https://site.example/oss/clikae', 'not a url']) {
    assert.equal(repoOf(href, 'CVERInc'), '', href);
  }
});

test('the language is the primary subtag, whole; anything without words reads English', () => {
  assert.deepEqual(['en', 'zh-Hant', 'zh-tw', 'ja', 'ja-JP', 'ko', 'jam', 'kok', 'fr', '', undefined].map(langOf),
    ['en', 'zh', 'zh', 'ja', 'ja', 'ko', 'en', 'en', 'en', 'en', 'en']);
});

test('day buckets: today, yesterday, N days (<30), N months (days/30), N years (days/365)', () => {
  const at = (d) => relative(d, NOW, 'en');
  assert.deepEqual(['2026-10-10', '2026-10-09', '2026-09-11', '2026-09-10', '2026-08-11', '2025-10-11', '2025-10-10', '2023-10-10'].map(at),
    ['today', 'yesterday', '29 days ago', 'last month', '2 months ago', '12 months ago', 'last year', '3 years ago']);
  assert.equal(at('2026-10-12'), 'today', 'a push "in the future" (a skewed clock) is today, never "in 2 days"');
  for (const bad of ['yesterday', '2026-10-07T00:00:00Z', '', undefined, '2026-13-01']) assert.equal(at(bad), '', String(bad));
});

test('🔴 a push dated the 9th is "yesterday" on the 10th in every zone — UTC days, not the visitor\'s', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { relative } from ${JSON.stringify(join(HERE, 'repo-facts-core.mjs'))}; console.log(relative('2026-10-09', ${NOW}, 'en'))`],
    { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'yesterday');
});

test('the browser\'s phrasing is the live pages\' phrasing (they were written the same way)', () => {
  assert.deepEqual(['zh-Hant', 'ja', 'ko'].map((t) => [relative('2026-10-08', NOW, t), relative('2026-09-01', NOW, t)]),
    [['前天', '上個月'], ['一昨日', '先月'], ['그저께', '지난달']]);
});

test('🔴 the wording around the phrase is the renderer\'s own, in all four languages', () => {
  // Collection.astro writes "Updated {x}" etc. when it renders the card; the coral rewrites the
  // same span. If the renderer's wording changes, this goes red rather than the two drifting apart.
  const astro = readFileSync(join(HERE, '../../sitetile/astro/src/components/sections/Collection.astro'), 'utf8');
  const forms = { en: '`Updated ${x}`', zh: "'zh-tw': { updated: (x) => `${x} 更新`", ja: "'ja-jp': { updated: (x) => `${x} 更新`", ko: "'ko-kr': { updated: (x) => `업데이트 날짜: ${x}`" };
  for (const [lang, form] of Object.entries(forms)) {
    assert.ok(astro.includes(form), `Collection.astro no longer says ${form}`);
    assert.equal(UPDATED[lang]('X'), form.replace(/.*`(.*)`$/, '$1').replace('${x}', 'X'));
  }
  assert.deepEqual(Object.keys(ARCHIVED).sort(), Object.keys(UPDATED).sort());
});
