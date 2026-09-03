// Lingo × Blog locale category/tag archives — the "link helper" this feature turns on.
//   run: node packages/sitetile/blog-locale-archives.test.mjs   (wired into scripts/test.sh)
//
// THE GAP (confirmed live on sodaart.co.jp, 2026-09-02, a Lingo site with translated posts at
// ir/posts/zh-tw/…, ir/posts/en-us/…): category/tag archives existed only at the BASE locale
// (pages/category/[slug]/, pages/tag/[slug]/), so on a zh-TW or en-US edition every category-rail
// entry and every tag chip that resolved to a category still pointed at `/category/<slug>/` — the
// JAPANESE posts, regardless of which locale was rendering. A third-party AI editing the site could
// only hide the rail; it had no correct page to send readers to.
//
// This file tests the PURE functions behind the fix (lib/blog.mjs): the href rewrite
// (localizeArchiveHref, and its use inside blogCategories/tagHref), the per-locale corpus
// resolution shared with pages/[...path].astro and the sitemap (localeBlogCorpora), and the
// reciprocal hreflang computation (termLocaleMap/alternateArchiveLocales) the new
// pages/[...loc]/category|tag/[slug]/… routes and their base siblings both call. The astro build
// itself (routes really exist, render the right locale's posts, carry the right <html lang> and
// hreflang) is asserted end-to-end by astro/smoke-build.mjs's "Lingo × Blog locale category/tag
// archives" checks — this file is the unit half: the DECISION, not the page.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve —
// same seam blog-unlisted.test.mjs already teaches the resolver.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') {
      return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const {
  allPosts, listedPosts, blogCategories, tagHref, routedCategories, routedTags,
  localeUrlPrefix, localizeArchiveHref, alternateArchiveLocales, localeBlogCorpora, termLocaleMap,
} = await import('./astro/src/lib/blog.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// Real markdown through the real parser (parsePost), matching blog-unlisted.test.mjs's own
// discipline: a hand-built {slug, categories, tags} object would only ever agree with what this
// test imagines parsePost does.
const md = (title, date, extra = '') => `---\ntitle: "${title}"\npubDate: ${date}\n${extra}---\n\n${title} body.\n`;

const BASE_POSTS = allPosts({
  '/s/blog/press-1.md': md('Press One', '2024-01-05', 'categories: [press]\ntags: [press]\n'),
  '/s/blog/press-2.md': md('Press Two', '2024-01-04', 'categories: [press]\ntags: [press]\n'),
  '/s/blog/diary-1.md': md('Diary One', '2024-01-03', 'categories: [diary]\ntags: [diary]\n'),
});
const SITE_META = {
  lang: 'en-US', locales: 'en-US, zh-TW',
  'blog-category-routes': 'true', 'blog-tag-routes': 'true',
  'blog-categories': 'Press|2|/category/press || All Posts|3|/devlog',
};

// ── localeUrlPrefix ────────────────────────────────────────────────────────────────────────────
test('localeUrlPrefix: the default locale is unprefixed', () => {
  assert.equal(localeUrlPrefix({ lang: 'en-US', locales: 'en-US, zh-TW' }), '');
});
test('localeUrlPrefix: a non-default locale gets its lowercase url form', () => {
  assert.equal(localeUrlPrefix({ lang: 'zh-TW', locales: 'en-US, zh-TW' }), '/zh-tw');
});
test('localeUrlPrefix: no lang, no locales, or a non-Lingo site → always \'\' (byte-identical)', () => {
  assert.equal(localeUrlPrefix({ locales: 'en-US, zh-TW' }), '');
  assert.equal(localeUrlPrefix({ lang: 'en-US' }), '');
  assert.equal(localeUrlPrefix({}), '');
  assert.equal(localeUrlPrefix(null), '');
});

// ── localizeArchiveHref ───────────────────────────────────────────────────────────────────────
const LISTED_L = listedPosts([BASE_POSTS[0]], SITE_META); // only the `press` post "translated"
test('localizeArchiveHref: no-op on the default locale', () => {
  assert.equal(localizeArchiveHref('/category/press', SITE_META, BASE_POSTS), '/category/press');
});
test('localizeArchiveHref: a slug THIS locale routes gets the /<loc> prefix', () => {
  const metaL = { ...SITE_META, lang: 'zh-TW' };
  assert.equal(localizeArchiveHref('/category/press', metaL, LISTED_L), '/zh-tw/category/press');
});
test('🔴 localizeArchiveHref: a slug THIS locale does NOT route falls back to the base href, unchanged', () => {
  // LISTED_L carries only the `press` post — `diary` was never "translated" for this locale.
  const metaL = { ...SITE_META, lang: 'zh-TW' };
  assert.equal(localizeArchiveHref('/category/diary', metaL, LISTED_L), '/category/diary');
});
test('localizeArchiveHref: a non-category href (the rail\'s own "All Posts" row) is left alone', () => {
  const metaL = { ...SITE_META, lang: 'zh-TW' };
  assert.equal(localizeArchiveHref('/devlog', metaL, LISTED_L), '/devlog');
});
test('localizeArchiveHref: blog-category-routes off → every slug falls back (no route exists to point at)', () => {
  const metaL = { ...SITE_META, lang: 'zh-TW', 'blog-category-routes': 'false' };
  assert.equal(localizeArchiveHref('/category/press', metaL, LISTED_L), '/category/press');
});
test('localizeArchiveHref: an empty/absent href passes through', () => {
  assert.equal(localizeArchiveHref('', { ...SITE_META, lang: 'zh-TW' }, LISTED_L), '');
});

// ── blogCategories(): the authored rail, end to end ───────────────────────────────────────────
test('blogCategories: the base/default locale is byte-identical to before this feature', () => {
  const rows = blogCategories(SITE_META, BASE_POSTS);
  assert.deepEqual(rows, [
    { label: 'Press', count: '2', href: '/category/press' },
    { label: 'All Posts', count: '3', href: '/devlog' },
  ]);
});
test('🔴 blogCategories: a locale edition rewrites ONLY the hrefs it actually routes', () => {
  const metaL = { ...SITE_META, lang: 'zh-TW' };
  const rows = blogCategories(metaL, LISTED_L);
  assert.deepEqual(rows.find((r) => r.label === 'Press').href, '/zh-tw/category/press');
  // "All Posts" is not a category link (categoryHrefSlug can't parse it) — left as authored,
  // exactly like sitemap.xml.js's own note on this: the physical archive is a literal directory,
  // not something this rewrite can verify for an arbitrary authored href.
  assert.deepEqual(rows.find((r) => r.label === 'All Posts').href, '/devlog');
});
test('blogCategories: unlisting still recounts against the LOCALE\'s own corpus, href still localized', () => {
  const metaL = { ...SITE_META, lang: 'zh-TW', 'blog-unlisted-categories': 'nothing-hidden' };
  const rows = blogCategories(metaL, LISTED_L);
  const press = rows.find((r) => r.label === 'Press');
  assert.equal(press.count, '1', 'recount branch engages once anything is unlisted — 1 locale post');
  assert.equal(press.href, '/zh-tw/category/press');
});

// ── tagHref(): chips (post cards, tag cloud) ──────────────────────────────────────────────────
test('tagHref: the default locale is byte-identical to before this feature', () => {
  const catSet = routedCategories(BASE_POSTS, SITE_META);
  assert.equal(tagHref(SITE_META, 'press', undefined, catSet), '/category/press/');
});
test('🔴 tagHref: a chip on a locale page links to that locale\'s own archive', () => {
  const metaL = { ...SITE_META, lang: 'zh-TW' };
  const catSet = routedCategories(LISTED_L, metaL); // the SAME corpus the chip's post came from
  assert.equal(tagHref(metaL, 'press', undefined, catSet), '/zh-tw/category/press/');
});
test('tagHref: the real WP tag-route branch is locale-scoped too', () => {
  const metaL = { ...SITE_META, lang: 'zh-TW', 'blog-category-routes': 'false' }; // force the tag branch
  const catSet = routedCategories(LISTED_L, metaL); // empty — category routes are off
  assert.equal(catSet.size, 0);
  assert.equal(tagHref(metaL, 'press', undefined, catSet), '/zh-tw/tag/press/');
});
test('tagHref: the query-string fallback needs no locPrefix of its own — blogBase(meta) is already locale-prefixed', () => {
  const metaL = { lang: 'zh-TW', locales: 'en-US, zh-TW', 'blog-path': '/zh-tw/devlog' };
  assert.equal(tagHref(metaL, 'anything'), '/zh-tw/devlog?tag=anything');
});

// ── routedTags ─────────────────────────────────────────────────────────────────────────────────
test('routedTags mirrors routedCategories: empty when the flag is off', () => {
  assert.equal(routedTags(BASE_POSTS, { 'blog-tag-routes': 'false' }).size, 0);
});
test('routedTags: the slug set, mapped through blog-tag-slugs', () => {
  const meta = { 'blog-tag-routes': 'true', 'blog-tag-slugs': 'press=pr' };
  assert.deepEqual([...routedTags(BASE_POSTS, meta)].sort(), ['diary', 'pr']);
});

// ── alternateArchiveLocales ────────────────────────────────────────────────────────────────────
test('alternateArchiveLocales: only locales that route THIS exact slug are offered', () => {
  const mapByUrl = { '': new Set(['press', 'diary']), 'zh-tw': new Set(['press']) };
  const urlToLocale = (u) => (u === '' ? 'en-US' : 'zh-TW');
  assert.deepEqual(alternateArchiveLocales(mapByUrl, 'press', urlToLocale), ['en-US', 'zh-TW']);
  assert.deepEqual(alternateArchiveLocales(mapByUrl, 'diary', urlToLocale), ['en-US'], 'zh-TW never routed diary');
});
test('🔴 alternateArchiveLocales: never offers a locale for a slug NEITHER side has — the whole point', () => {
  const mapByUrl = { '': new Set(['press']), 'zh-tw': new Set(['press']) };
  const urlToLocale = (u) => (u === '' ? 'en-US' : 'zh-TW');
  assert.deepEqual(alternateArchiveLocales(mapByUrl, 'ghost', urlToLocale), []);
});

// ── localeBlogCorpora ──────────────────────────────────────────────────────────────────────────
const CONTENT_FILES = {}; // no content/<loc>/_site.md overrides in this corpus
const LOCALE_BLOG_FILES = {
  '/s/blog/zh-tw/press-1.md': md('新聞一', '2024-01-05'),       // no categories of its own
  '/s/blog/zh-tw/diary-1.md': md('日記一', '2024-01-03', 'categories: [diary-own]\n'), // DOES carry its own
};
test('localeBlogCorpora: skips the default locale and any locale with zero translated posts', () => {
  const out = localeBlogCorpora(CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS);
  assert.equal(out.length, 1, 'only zh-TW has files under blog/zh-tw/');
  assert.equal(out[0].locale, 'zh-TW');
  assert.equal(out[0].url, 'zh-tw');
});
test('🔴 localeBlogCorpora: categories are inherited by SLUG when the translation states none itself', () => {
  const [{ posts }] = localeBlogCorpora(CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS);
  const pressL = posts.find((p) => p.slug === 'press-1');
  assert.deepEqual(pressL.categories, ['press'], 'inherited from the base post of the same slug');
});
test('localeBlogCorpora: a translation that DOES carry its own categories keeps them (no override)', () => {
  const [{ posts }] = localeBlogCorpora(CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS);
  const diaryL = posts.find((p) => p.slug === 'diary-1');
  assert.deepEqual(diaryL.categories, ['diary-own']);
});
test('localeBlogCorpora: blog-path/blog-url-pattern gain the /<loc> prefix; `lang` becomes the locale\'s own', () => {
  const [{ meta }] = localeBlogCorpora(CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS);
  assert.equal(meta.lang, 'zh-TW');
  assert.equal(meta['blog-path'], '/zh-tw/devlog');
  assert.equal(meta['blog-url-pattern'], '/zh-tw/devlog/%postname%');
});
test('localeBlogCorpora: `tags` is NOT back-filled from the base post — only categories are', () => {
  const [{ posts }] = localeBlogCorpora(CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS);
  assert.deepEqual(posts.find((p) => p.slug === 'press-1').tags, [], 'the translation set no tags/categories of its own');
});

// ── termLocaleMap ──────────────────────────────────────────────────────────────────────────────
test('termLocaleMap: the base entry (\'\') is this site\'s own routed categories', () => {
  const baseListed = listedPosts(BASE_POSTS, SITE_META);
  const { mapByUrl, defaultLocale } = termLocaleMap('category', CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS, baseListed);
  assert.equal(defaultLocale, 'en-US');
  assert.deepEqual([...mapByUrl['']].sort(), ['diary', 'press']);
});
test('termLocaleMap: each locale entry is THAT locale\'s own routed categories (not the base\'s)', () => {
  const baseListed = listedPosts(BASE_POSTS, SITE_META);
  const { mapByUrl, urlToLocale } = termLocaleMap('category', CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS, baseListed);
  assert.deepEqual([...mapByUrl['zh-tw']], ['press', 'diary-own'], 'diary-1 in blog/zh-tw carries its OWN category, diary-own — not "diary"');
  assert.equal(urlToLocale('zh-tw'), 'zh-TW');
  assert.equal(urlToLocale(''), 'en-US');
});
test('termLocaleMap: kind=\'tag\' reads the tag flag/slugs, never the category ones', () => {
  const baseListed = listedPosts(BASE_POSTS, SITE_META);
  const { mapByUrl } = termLocaleMap('tag', CONTENT_FILES, LOCALE_BLOG_FILES, SITE_META, BASE_POSTS, baseListed);
  assert.deepEqual([...mapByUrl['']].sort(), ['diary', 'press']);
});

console.log(`\n${passed} passed`);
