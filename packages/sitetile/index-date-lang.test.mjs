// Blog listing dates follow the Site's language, like the post page does.
//   run: node packages/sitetile/index-date-lang.test.mjs
//
// A Site that sets its default language through `locales` has no meta.lang; the listing cards passed
// meta.lang to fmtDate and printed "October 26, 2026" on a zh-Hant Site while the post page read
// 2026年10月26日. The listing now asks indexDateLang for the language (the view's resolved language
// when no blog-date-format is set).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexDateLang } from './astro/src/lib/chrome-copy.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};
const SRC = join(dirname(fileURLToPath(import.meta.url)), 'astro', 'src');
const read = (f) => readFileSync(join(SRC, f), 'utf8');

test('no format and no meta.lang: the view language is used', () => {
  assert.equal(indexDateLang(undefined, {}, 'zh-Hant'), 'zh-Hant');
});
test('no format: meta.lang still wins over the view language (unchanged)', () => {
  assert.equal(indexDateLang(undefined, { lang: 'ja-JP' }, 'zh-Hant'), 'ja-JP');
});
test('explicit format keeps meta.lang, even when it is empty (unchanged)', () => {
  assert.equal(indexDateLang('cjk-full', {}, 'zh-Hant'), undefined);
  assert.equal(indexDateLang('cjk-full', { lang: 'zh-Hant' }, 'en'), 'zh-Hant');
});

const VIEWS = [
  'components/BlogIndexView.astro',
  'components/ArchiveView.astro',
  'pages/search/label/[tag]/index.astro',
  'pages/search/label/[tag]/page/[n].astro',
];
for (const f of VIEWS) {
  test(`${f}: card date is formatted with the view's date language, not bare meta.lang`, () => {
    const s = read(f);
    assert.match(s, /const lang = indexDateLang\(dateFormat, meta, (blogViewLang\(meta, viewFiles\)|systemPageLang\(meta, sysFiles\))\);/);
    assert.match(s, /\{fmtDate\(p\.date, dateFormat, lang\)\}/);
    assert.doesNotMatch(s, /fmtDate\([^)]*meta\.lang\)/);
  });
}
console.log(`${passed} passed`);
