// REEF with Blog — a real RSS 2.0 feed for the blog (the index's "RSS FEED" link
// points here). Generated from the per-site blog/ store through the same parser.
// Emitted on every build — a harmless static file even for a site with no blog, the same
// convention manifest.webmanifest.js follows; only a site WITH a blog links to it.
//
// The document itself is built by lib/feed.mjs, which the /feed and /feeds/posts/default aliases
// also call. One builder, so an alias can never serve a different feed from the canonical URL.
import { allPosts, siteMeta } from '../lib/blog.mjs';
import { buildFeedBody } from '../lib/public-artifacts.mjs';

// A feed is a public document handed to anyone who follows it, so the corpus it is built from
// is the public-facing one: a private post keeps its title, link and date and loses its
// description.
const posts = allPosts(import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true }));
const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET({ site }) {
  const origin = site ? String(site).replace(/\/$/, '') : '';
  return new Response(buildFeedBody(posts, meta, origin), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
