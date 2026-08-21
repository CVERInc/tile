import {
  blogBase,
  blogSearchOn,
  feedDescription,
  feedTitle,
  postUrl,
  publicFacingPosts,
  searchIndex,
} from './blog.mjs';
import { toBcp47 } from '../packages/lingo/locale.mjs';
import { FEED_PATH, feedXml, latestBuildDate } from './feed.mjs';

export function buildSearchIndexBody(posts, meta) {
  return blogSearchOn(meta) ? JSON.stringify(searchIndex(posts, meta)) : '[]';
}

export function buildReefPostsBody(posts, meta) {
  return JSON.stringify((posts || []).map((p) => ({ slug: p.slug, url: postUrl(p, meta) })));
}

export function buildFeedBody(posts, meta, origin = '') {
  const publicPosts = publicFacingPosts(posts);
  const siteAuthor = String(meta['blog-author'] || '').trim();
  const items = publicPosts.map((p) => ({
    title: p.title,
    url: origin + postUrl(p, meta),
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
    items,
  });
}
