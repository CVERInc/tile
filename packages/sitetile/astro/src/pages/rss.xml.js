// REEF with Blog — a real RSS 2.0 feed for the blog (the index's "RSS FEED" link
// points here). Generated from the per-site blog/ store through the same parser.
// Emitted on every build — a harmless static file even for a site with no blog, the same
// convention manifest.webmanifest.js follows; only a site WITH a blog links to it.
//
// The document itself is built by lib/feed.mjs, which the /feed and /feeds/posts/default aliases
// also call. One builder, so an alias can never serve a different feed from the canonical URL.
import { allPosts, listedPosts, siteMeta, postUrl, blogBase, feedTitle, feedDescription } from '../lib/blog.mjs';
import { toBcp47 } from '../packages/lingo/locale.mjs';
import { feedXml, latestBuildDate, FEED_PATH } from '../lib/feed.mjs';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));
// A feed is a list, and the one that travels furthest: an item that reaches a reader's
// inbox cannot be unsent. Unlisted posts never enter it.
const posts = listedPosts(allPosts(import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true })), meta);

/** The channel + items for this site, ready for feedXml. Exported so the alias routes build from
 *  exactly this, and not from their own second reading of the same data. */
export function feedInput(origin) {
  // Byline, same resolution order the post page uses: the post's own `author`, else the site's
  // `blog-author`. Carried as `dc:creator`, NOT RSS 2.0's `<author>` — that element is specified
  // as an email address, so readers that honour the spec either drop a bare name or print it as a
  // broken mailto. dc:creator is where a display name belongs and what feed readers actually show.
  const siteAuthor = String(meta['blog-author'] || '').trim();
  const items = posts.map((p) => ({
    title: p.title,
    url: origin + postUrl(p, meta),
    description: p.description,
    date: p.date,
    author: String(p.author || '').trim() || siteAuthor,
  }));
  return {
    // Channel copy comes from the SITE, never from a literal here. The two lines this replaced
    // were `${site title} — Devlog` and the vendor's own tagline, hardcoded with no override
    // path — which is how four unrelated tenants ended up publishing feeds in the vendor's
    // voice, and how a site with no `title` key published one literally called "Devlog — Devlog".
    title: feedTitle(meta),
    link: origin + blogBase(meta),
    description: feedDescription(meta),
    language: meta.lang ? toBcp47(meta.lang) : '',
    selfUrl: origin ? origin + FEED_PATH : '',
    buildDate: latestBuildDate(items),
    items,
  };
}

export function GET({ site }) {
  const origin = site ? String(site).replace(/\/$/, '') : '';
  return new Response(feedXml(feedInput(origin)), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
