// REEF with Site — the sitemap. Emitted on every build, like rss.xml and the webmanifest.
//
// 🩸 2026-08-06. Until today the platform generated no sitemap at all, and `robotsFor()` in
// reef-mcp said so in as many words: it deliberately omitted the `Sitemap:` line because pointing
// at a file that does not exist is the fake-200 trap with our own name on it. That reasoning was
// right; the missing half was this file. Most tenants arrive from WordPress or Blogger, both of
// which publish a sitemap automatically, so "migrate to feelreef" quietly meant "lose a sitemap you
// had" — a regression nobody would ever see, because a missing sitemap has no symptom.
//
// What goes in: every URL the build actually emits and a crawler should index —
//   • content pages, in every locale they were authored in (content/**.md, minus site DATA)
//   • the blog index and its posts, at whatever paths this site's blog config produces
//   • tag archives, but ONLY when the site opted into them (`blog-tag-routes`)
// What stays out, on purpose:
//   • /search — an interaction surface, not content (and inert unless `blog-search`)
//   • /language — a chooser; the pages it points at are already listed
//   • /preview — a working surface
//   • paginated /page/<n> — the same posts again, one rank-diluting step away from the index
//
// The list is DERIVED from the same globs the routers use, so it cannot claim a page that was
// never built. That is the whole point of it: the previous defect on this site was an index
// (hreflang) that asserted pages into existence, and a sitemap is the same promise at larger scale.
import { allPosts, siteMeta, postUrl, blogBase, tagSlugMap } from '../lib/blog.mjs';
import { contentUrls, tagUrls, canonicalPath } from '../lib/sitemap.mjs';
import { isSiteFile } from '@sitetile';

const contentGlob = import.meta.glob('../../content/**/*.md', { query: '?raw', import: 'default', eager: true });
const posts = allPosts(import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true }));
const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

const esc = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function GET({ site }) {
  const origin = site ? String(site).replace(/\/$/, '') : '';
  const entries = [];
  for (const u of contentUrls(contentGlob, meta, isSiteFile)) entries.push({ loc: u });
  if (posts.length) {
    entries.push({ loc: canonicalPath(blogBase(meta) || '/') });
    for (const p of posts) entries.push({ loc: canonicalPath(postUrl(p, meta)), lastmod: p.date || '' });
  }
  for (const u of tagUrls(posts, meta, tagSlugMap(meta))) entries.push({ loc: u });

  const seen = new Set();
  const body = entries.filter((e) => e.loc && !seen.has(e.loc) && seen.add(e.loc)).map((e) => {
    const lastmod = e.lastmod ? `\n    <lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : '';
    return `  <url>\n    <loc>${esc(origin + e.loc)}</loc>${lastmod}\n  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
