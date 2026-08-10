// A sitemap may only list URLs the build actually emits.
//   run: node packages/sitetile/sitemap.test.mjs
//
// 🩸 2026-08-06. The platform published no sitemap, and reef-mcp's robotsFor() deliberately left out
// the `Sitemap:` line with the reason written down: "these sites do not generate a sitemap … and
// a Cloudflare-managed robots.txt already points at one that answers 200 with HTML because
// it does not exist". That reasoning was correct and the conclusion was half of one — the fix was to
// build the file, not to keep quiet about it. Tenants migrate here from WordPress and Blogger, which
// both publish a sitemap automatically, so arriving cost them one, silently.
//
// The risk this file guards is the sitemap version of the hreflang defect it sits next to: listing a
// URL that does not exist. So every assertion below is about NOT claiming something.

import assert from 'node:assert/strict';
import { contentUrls, tagUrls, canonicalPath } from './astro/src/lib/sitemap.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const META = { locales: 'en-US, ja-JP, ko-KR, zh-TW' };
const GLOB = {
  '/b/content/home.md': 'page',
  '/b/content/about.md': 'page',
  '/b/content/legal/terms.md': 'page',
  '/b/content/ja-jp/home.md': 'page',
  '/b/content/ja-jp/about.md': 'page',
  '/b/content/zh-tw.md': 'page',              // the build's <loc>/home.md → <loc>.md collapse
  '/b/content/_site.md': 'data',
  '/b/content/_theme.md': 'data',
  '/b/content/ja-jp/_site.md': 'data',
  '/b/content/notes.md': 'NOT-A-PAGE',
};
const isPage = (raw) => raw !== 'NOT-A-PAGE';

test('locale homes collapse to their locale root, the default home to /', () => {
  const urls = contentUrls(GLOB, META, isPage);
  assert.ok(urls.includes('/'), 'content/home.md → /');
  assert.ok(urls.includes('/ja-jp/'), 'content/ja-jp/home.md → /ja-jp/');
  assert.ok(urls.includes('/zh-tw/'), 'the collapsed content/zh-tw.md form too');
  assert.ok(!urls.includes('/ja-jp/home'), 'never the literal /home path');
});

test('ordinary and nested pages keep their path', () => {
  const urls = contentUrls(GLOB, META, isPage);
  // directory form throughout — the shape the build serves and the canonical declares
  assert.ok(urls.includes('/about/'));
  assert.ok(urls.includes('/ja-jp/about/'));
  assert.ok(urls.includes('/legal/terms/'));
});

test('🔴 site DATA is never a URL', () => {
  const urls = contentUrls(GLOB, META, isPage);
  for (const bad of ['/_site', '/_theme', '/ja-jp/_site']) {
    assert.ok(!urls.includes(bad), `${bad} is config, not a page`);
  }
});

test('🔴 a file the router would skip is not listed either', () => {
  // isPage mirrors isSiteFile in the real route. If the sitemap used a laxer rule than the router,
  // it would advertise a URL that 404s — the exact failure this file exists to prevent.
  assert.ok(!contentUrls(GLOB, META, isPage).includes('/notes/'));
  assert.ok(contentUrls(GLOB, META).includes('/notes/'), 'and the control: with no predicate it IS listed');
});

test('🔴 tag archives appear only when the site turned the routes on', () => {
  const posts = [{ tags: ['archive', 'diary'] }, { tags: ['diary'] }];
  assert.deepEqual(tagUrls(posts, {}), [], 'off by default — the routes emit nothing, so neither may we');
  assert.deepEqual(tagUrls(posts, { 'blog-tag-routes': 'false' }), [], 'explicitly off');
  assert.deepEqual(tagUrls(posts, { 'blog-tag-routes': true }), ['/tag/archive/', '/tag/diary/']);
});

test('tag archives honour the site\'s base and slug map', () => {
  const posts = [{ tags: ['研究筆記 RESEARCH'] }];
  const out = tagUrls(posts, { 'blog-tag-routes': true, 'blog-tag-base': '/label' }, { '研究筆記 RESEARCH': 'research' });
  assert.deepEqual(out, ['/label/research/'], 'slug, not display name — the route is slug-keyed');
});

test('a CJK tag with no slug entry is URL-encoded, like the route emits it', () => {
  const out = tagUrls([{ tags: ['路障'] }], { 'blog-tag-routes': true });
  assert.equal(out.length, 1);
  assert.ok(!/[^\x00-\x7F]/.test(out[0]), `must be encoded for a sitemap, got ${out[0]}`);
  assert.equal(decodeURI(out[0]), '/tag/路障/');
});

test('no duplicates, stable order', () => {
  const a = contentUrls(GLOB, META, isPage);
  assert.deepEqual(a, [...new Set(a)], 'a URL listed twice is a crawl-budget bug');
  assert.deepEqual(a, [...a].sort(), 'sorted, so a diff of two builds is readable');
});

test('🔴 every entry is the CANONICAL url, not one that redirects to it', () => {
  // Caught on the first live build of this file: 238 of 238 entries were 308s to the trailing-slash
  // form, and each disagreed with the canonical on the page it pointed at. A sitemap is a list of
  // canonical URLs or it is a list of guesses.
  assert.equal(canonicalPath('/about'), '/about/');
  assert.equal(canonicalPath('/devlog/a-post'), '/devlog/a-post/');
  assert.equal(canonicalPath('/'), '/', 'the root is already canonical');
  assert.equal(canonicalPath('/ja-jp/'), '/ja-jp/', 'and an already-slashed path is left alone');
  assert.equal(canonicalPath('/rss.xml'), '/rss.xml', 'a real FILE has no directory form');
  assert.equal(canonicalPath('/og/tag/x.png'), '/og/tag/x.png');
  for (const u of contentUrls(GLOB, META, isPage)) {
    assert.ok(u.endsWith('/'), `${u} must be the directory form the build actually serves`);
  }
});

console.log(`\n${passed} passed`);
