// reef#2159/#2160: the ONE filter over /search-index.json, shared by the header overlay, the
// /search page and the inbox bubble.
//   run: node --test packages/sitetile/search-filter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fold, filterIndex } from './astro/src/packages/blog-search/search-filter.mjs';

const INDEX = [
  { t: '深空眠的第一夜', u: '/diary/night-one', g: ['sleep'], d: '2025-11-11', i: '' },
  { t: 'Café notes', u: '/diary/cafe', g: ['coffee'], d: '2025-10-31', i: '' },
  { t: 'Spring cleaning', u: '/diary/spring', g: ['home', 'sleep'], d: '2025-10-07', i: '', e: 'a night of cafe talk' },
];

test('fold: NFC + lowercase + diacritics stripped, CJK untouched', () => {
  assert.equal(fold('Café'), 'cafe');
  assert.equal(fold('深空眠'), '深空眠');
  assert.equal(fold(null), '');
});

test('substring match, CJK and accent-folded, title hits rank before tag/excerpt hits', () => {
  assert.deepEqual(filterIndex(INDEX, '空眠', 10).map((r) => r.u), ['/diary/night-one']);
  assert.deepEqual(filterIndex(INDEX, 'cafe', 10).map((r) => r.u), ['/diary/cafe', '/diary/spring']);
  assert.deepEqual(filterIndex(INDEX, 'sleep', 10).map((r) => r.u), ['/diary/night-one', '/diary/spring']);
});

test('empty / whitespace query, or no index, is no results; max caps the list', () => {
  assert.deepEqual(filterIndex(INDEX, '', 10), []);
  assert.deepEqual(filterIndex(INDEX, '   ', 10), []);
  assert.deepEqual(filterIndex(null, 'cafe', 10), []);
  assert.equal(filterIndex(INDEX, 'e', 1).length, 1);
});

test('blog-search.js imports the shared filter and keeps no local copy', () => {
  const src = readFileSync(new URL('./astro/src/packages/blog-search/blog-search.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ fold, filterIndex \} from '\.\/search-filter\.mjs';/);
  assert.doesNotMatch(src, /function fold\(/, 'a second fold would be the second filter reef#2159 forbids');
  assert.doesNotMatch(src, /function run\(q\)/, 'ranking lives in filterIndex now');
});
