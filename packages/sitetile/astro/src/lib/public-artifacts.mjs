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
import { toBcp47 } from '../packages/lingo/locale.mjs';
import { bubbleSearchOn } from './inbox-bubble.mjs';
import { FEED_PATH, feedXml, feedIcon, latestBuildDate } from './feed.mjs';

// reef#2160: the index serves TWO readers — the header magnifier (`blog-search`, blogSearchOn) and
// the inbox bubble's in-browser search (bubbleSearchOn, on by default). Either switch alone is
// enough; a site with both off, or with no posts at all, still ships the inert `[]`.
// 🩸 Measured 2026-10-18: cver and sodaart (a blog, a bubble, no `blog-search`) served `[]`, so the
// bubble had nothing to filter. The gate was the magnifier's switch, not "does this site have posts".
export function buildSearchIndexBody(posts, meta) {
  return (blogSearchOn(meta) || bubbleSearchOn(meta)) ? JSON.stringify(searchIndex(posts, meta)) : '[]';
}

export function buildReefPostsBody(posts, meta) {
  return JSON.stringify((posts || []).map((p) => ({ slug: p.slug, url: postUrl(p, meta) })));
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
    language: meta.lang ? toBcp47(meta.lang) : '',
    selfUrl: origin ? origin + FEED_PATH : '',
    buildDate: latestBuildDate(items),
    image: feedIcon(meta, origin), // tile#177 — the PNG this build emits, absolute; '' without an origin
    items,
  });
}
