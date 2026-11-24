import {
  absoluteUrl,
  blogBase,
  blogSearchOn,
  feedDescription,
  feedTitle,
  postUrl,
  publicFacingPosts,
  searchIndex,
} from './blog.mjs';
import { toBcp47, siteLangTag, lingoEnabled, parseLocales, localesSourceOf } from '../packages/lingo/locale.mjs';
import { sitePackages } from '../../../site-packages.mjs';
import { bubbleSearchOn } from './inbox-bubble.mjs';
import { FEED_PATH, feedXml, feedIcon, latestBuildDate } from './feed.mjs';

// reef#2160: the index serves TWO readers — the header magnifier (`blog-search`, blogSearchOn) and
// the inbox bubble's in-browser search (bubbleSearchOn, on by default). Either switch alone is
// enough; a site with both off, or with no posts at all, still ships the inert `[]`.
// 🩸 Measured 2026-10-18: cver and another live site (a blog, a bubble, no `blog-search`) served `[]`, so the
// bubble had nothing to filter. The gate was the magnifier's switch, not "does this site have posts".
export function buildSearchIndexBody(posts, meta) {
  return (blogSearchOn(meta) || bubbleSearchOn(meta)) ? JSON.stringify(searchIndex(posts, meta)) : '[]';
}

export function buildReefPostsBody(posts, meta) {
  return JSON.stringify((posts || []).map((p) => ({ slug: p.slug, url: postUrl(p, meta) })));
}

// The feed's <language>, the same choice SiteLayout makes for <html lang>: toBcp47 on a Lingo site,
// siteLangTag on a single-locale one (an edition code becomes its tag, anything else as written).
// 🩸 reef#3925 r2: this ran toBcp47 on every site, so a single-locale `lang: en-GB` feed said `en`
// and `lang: zh-HK` said zh-Hant. Pinned by single-locale-lang-tag.test.mjs.
function feedLanguage(meta) {
  if (!meta.lang) return '';
  const hasLingo = lingoEnabled({ packages: sitePackages(meta), locales: parseLocales(meta.locales, localesSourceOf(meta)) });
  return hasLingo ? toBcp47(meta.lang) : siteLangTag(meta.lang);
}

export function buildFeedBody(posts, meta, origin = '') {
  const publicPosts = publicFacingPosts(posts);
  const siteAuthor = String(meta['blog-author'] || '').trim();
  const items = publicPosts.map((p) => ({
    title: p.title,
    url: absoluteUrl(origin, postUrl(p, meta)), // #31: an absolute permalink is used as written
    description: p.description,
    date: p.date,
    author: String(p.author || '').trim() || siteAuthor,
  }));
  return feedXml({
    title: feedTitle(meta),
    link: origin + blogBase(meta),
    description: feedDescription(meta),
    language: feedLanguage(meta),
    selfUrl: origin ? origin + FEED_PATH : '',
    buildDate: latestBuildDate(items),
    image: feedIcon(meta, origin), // tile#177 — the PNG this build emits, absolute; '' without an origin
    items,
  });
}
