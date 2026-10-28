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
//   • a noindex page — content, blog index or post: its own source says `noindex: true`, or a
//     form's thanks= lands on it (reef#2554)
//
// The list is DERIVED from the same globs the routers use, so it cannot claim a page that was
// never built. That is the whole point of it: the previous defect on this site was an index
// (hreflang) that asserted pages into existence, and a sitemap is the same promise at larger scale.
import { allPosts, listedPosts, siteMeta, postUrl, postHasPage, blogBase, blogInstalled, tagSlugMap, localeBlogCorpora, toPath, indexUrl } from '../lib/blog.mjs';
import { contentUrls, tagUrls, categoryUrls, canonicalPath } from '../lib/sitemap.mjs';
import { isSiteFile } from '@sitetile';
import { noindexPolicy, writtenRoutes, routeOutputFile } from '../lib/noindex.mjs';

const contentGlob = import.meta.glob('../../content/**/*.md', { query: '?raw', import: 'default', eager: true });
const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));
const allPostsIn = allPosts(import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true }));
// 🔴 The sitemap is the list we hand to crawlers, so it is where "unlisted" and "deleted"
// are easiest to confuse. Dropping an unlisted post from here is the FADE (its URL still
// answers 200 for anyone holding a link, and no 404 burns its history); emitting a 404 or a
// noindex instead would be the other decision entirely, and that one is retire_page's.
const posts = listedPosts(allPostsIn, meta);
// Locale-scoped blog corpora — same resolution [...path].astro's own routes and the locale
// category/tag archives use (localeBlogCorpora, lib/blog.mjs), so a translated post's URL, and
// its locale's term archives, can't be listed here differently than the build actually emits them.
const localeBlogFiles = import.meta.glob('../../blog/*/*.md', { query: '?raw', import: 'default', eager: true });
const localeCorpora = localeBlogCorpora(contentGlob, localeBlogFiles, meta, allPostsIn);

const esc = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function GET({ site }) {
  const origin = site ? String(site).replace(/\/$/, '') : '';
  const entries = [];
  // reef#2554 r4: `routes` is every [...path] route an entry could share a file with, in the order
  // the router emits them — content, then per edition the blog index, its pager, every post (an
  // unlisted one too: it is not listed here, but it is still what the build writes at its file).
  // writtenRoutes() below keeps an entry only when it IS the route written at its file.
  const routes = [];
  const add = (e) => { entries.push(e); routes.push(e); };
  const blogRoutes = (m, all, listed, list) => {
    const index = { loc: canonicalPath(blogBase(m) || (m === meta ? '/' : `/${list}/`)), path: toPath(indexUrl(m, 1)), index: true };
    if (listed.length) add(index); else routes.push(index);
    const pageSize = Number(m['blog-page-size']) || 0;
    if (pageSize) for (let n = 2; n <= (Math.ceil(listed.length / pageSize) || 1); n++) routes.push({ path: toPath(indexUrl(m, n)), index: true });
    const shown = new Set(listed);
    // #31: a post whose permalink points off this site has no page here, and a sitemap may only
    // name URLs on its own host — so it is left out, not written as origin + permalink.
    for (const p of all) if (postHasPage(p, m)) (shown.has(p) ? add : (e) => routes.push(e))({ loc: canonicalPath(postUrl(p, m)), lastmod: p.date || '', path: toPath(postUrl(p, m)), post: p });
  };
  for (const u of contentUrls(contentGlob, meta, isSiteFile)) add({ loc: u, path: toPath(u) });
  if (blogInstalled(meta, allPostsIn)) blogRoutes(meta, allPostsIn, posts);
  for (const u of tagUrls(posts, meta, tagSlugMap(meta))) entries.push({ loc: u });
  for (const u of categoryUrls(posts, meta)) entries.push({ loc: u });
  // Locale editions: index + posts (already locale-prefixed via metaL's blog-path — see
  // localeBlogCorpora) and their own term archives. tagUrls/categoryUrls build hrefs from
  // meta['blog-tag-base']/['blog-category-base'], which stays the SITE-WIDE (unprefixed) value
  // even on metaL — deliberately: the physical archive route is a literal `/<loc>/category/…`
  // directory (pages/[...loc]/category/[slug]/…), mirroring how the base archive route is a
  // literal `/category/…` directory regardless of what blog-category-base says. So the locale
  // prefix is applied HERE, on the returned path, not inside those two shared functions.
  for (const { url, meta: metaL, posts: postsL, listed: listedL } of localeCorpora) {
    blogRoutes(metaL, postsL, listedL, url);
    if (!listedL.length) continue;
    for (const u of tagUrls(listedL, metaL, tagSlugMap(metaL))) entries.push({ loc: `/${url}${u}` });
    for (const u of categoryUrls(listedL, metaL)) entries.push({ loc: `/${url}${u}` });
  }

  // reef#2554: a noindex page (its own source's `noindex: true`, or a form's thanks= target — a
  // content page, the blog index, a post, any locale's) is built but not handed to crawlers. The
  // same decision its <meta name="robots"> reads, asked with the route param pages/[...path].astro
  // emits it at — `path`, built from the same URL as that route's — and, for a post, the post
  // (lib/noindex.mjs). Entries without `path` are term archives: other routes, generated lists
  // nobody is sent to. r4: an entry whose route is not the one written at its file (a content page
  // under a post or the blog index) is a displaced source — dropped, whatever it says, so the file
  // is listed by its producer's decision alone; [...path].astro names the collision in the build log.
  const policy = noindexPolicy(contentGlob);
  // A file is listed once, in its first entry's place (so a root-mounted blog's `/` keeps the slot
  // home's entry had), by the entry of the route written there — none when that route is unlisted.
  const written = writtenRoutes(routes, (e) => e.path);
  const listedEntries = new Set(entries);
  const files = new Set();
  const producers = entries.flatMap((e) => {
    if (!('path' in e)) return [e];
    const file = routeOutputFile(e.path);
    if (files.has(file)) return [];
    files.add(file);
    const w = written.get(file);
    return listedEntries.has(w) ? [w] : [];
  });
  const noindex = (e) => 'path' in e && (e.post ? policy.post(e.path, e.post) : e.index ? policy.index(e.path) : policy.page(e.path));
  const seen = new Set();
  const body = producers.filter((e) => e.loc && !noindex(e) && !seen.has(e.loc) && seen.add(e.loc)).map((e) => {
    const lastmod = e.lastmod ? `\n    <lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : '';
    return `  <url>\n    <loc>${esc(origin + e.loc)}</loc>${lastmod}\n  </url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
