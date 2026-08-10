// REEF with Blog — the site-wide search index the blog-search island fetches (once,
// lazily, only when a visitor opens search). Built AT BUILD TIME from the SAME per-site
// blog/*.md store the RSS feed + /devlog read, through the SAME parser — one corpus, no
// drift. Cloned from rss.xml.js (same glob, same allPosts/siteMeta). Emits searchIndex()'s
// lean {t,u,g,d}[] JSON when the site opts into `blog-search: true`; otherwise an empty []
// (so every non-search site ships a tiny inert file and the island's fetch just finds
// nothing). Zero backend: a static .json the CDN serves.
import { allPosts, siteMeta, searchIndex, blogSearchOn } from '../lib/blog.mjs';

const posts = allPosts(import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true }));
const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  const body = blogSearchOn(meta) ? JSON.stringify(searchIndex(posts, meta)) : '[]';
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
