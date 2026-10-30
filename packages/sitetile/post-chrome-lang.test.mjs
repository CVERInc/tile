// Post chrome follows the post's resolved language; one <html lang> per Site.
//   run: node packages/sitetile/post-chrome-lang.test.mjs
//
// The Astro components need a build to render, so the logic is covered at the lowest level that
// runs in a bare checkout: the copy table itself, and the component sources for the wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { uiCopy } from './locale.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};
const COMP = join(dirname(fileURLToPath(import.meta.url)), 'astro', 'src', 'components');
const read = (f) => readFileSync(join(COMP, f), 'utf8');

const WANT = {
  'en-US': ['Newer', 'Older', 'Keep reading', 'All posts'],
  'zh-TW': ['較新文章', '較舊文章', '繼續閱讀', '所有貼文'],
  'ja-JP': ['新しい記事', '古い記事', '続きを読む', 'すべての記事'],
  'ko-KR': ['최신 글', '이전 글', '계속 읽기', '모든 글'],
};
for (const [lang, [n, o, k, a]] of Object.entries(WANT)) {
  test(`uiCopy(${lang}) carries newer/older/keepReading/archive`, () => {
    const c = uiCopy(lang);
    assert.equal(c.newer, n); assert.equal(c.older, o); assert.equal(c.keepReading, k); assert.equal(c.archive, a);
  });
}
test('no lang falls to the English row (unchanged defaults)', () => {
  const c = uiCopy('');
  assert.equal(c.newer, 'Newer'); assert.equal(c.older, 'Older'); assert.equal(c.keepReading, 'Keep reading'); assert.equal(c.archive, 'All posts');
});

test('PostArticle: labels default from uiCopy and blog-*-label overrides still win', () => {
  const s = read('PostArticle.astro');
  assert.match(s, /meta\['blog-newer-label'\] \|\| ui\.newer/);
  assert.match(s, /meta\['blog-older-label'\] \|\| ui\.older/);
  assert.match(s, /meta\['blog-keep-reading-label'\] \|\| ui\.keepReading/);
  assert.match(s, /\{ui\.archive\}<\/a>/);
  assert.doesNotMatch(s, /\/>All posts</);
});
test('PostArticle: every date uses dateOpts.lang; an explicit format keeps meta.lang', () => {
  const s = read('PostArticle.astro');
  assert.match(s, /const dateOpts = \{ lang: dateFormat \? meta\.lang : \(meta\.lang \|\| lang\) \};/);
  assert.doesNotMatch(s, /fmtDate\([^)]*meta\.lang\)/);
  assert.equal((s.match(/\bfmtDate\([^)]*, dateFormat, dateOpts\.lang\)/g) || []).length, 5);
});
test('PageView: <html lang> is site lang, else systemPageLang over the root content glob', () => {
  const s = read('PageView.astro');
  assert.match(s, /import\.meta\.glob\('\.\.\/\.\.\/content\/\*\.md'/);
  assert.match(s, /site\.meta\.lang \|\| systemPageLang\(site\.meta, viewFiles\)/);
  assert.match(s, /lang=\{pageLang\}/);
  assert.doesNotMatch(s, /DEFAULT_LANG/);
});
console.log(`${passed} passed`);
