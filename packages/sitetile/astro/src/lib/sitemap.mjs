// Sitemap helpers — deliberately OUT of the route file so a plain `node` test can import them.
// The route imports `@sitetile`, an alias only Vite resolves; a pure function parked behind an
// alias is a function nothing can test, and untested derivation is exactly what produced the
// hreflang defect this sitemap sits next to. `isPage` and `slugMap` are injected for the same
// reason — importing them would drag `@sitetile` back in transitively through blog.mjs, which is
// how the alias got in here the first time.
import { toUrlLocale } from '../packages/lingo/locale.mjs';

/** Canonical form of a site path: directory-style, with the trailing slash.
 *
 *  🩸 caught on the first live build of this very file. The sitemap listed `/about` and
 *  `/devlog/<slug>`, both of which 308 to the trailing-slash form — so 238 of 238 entries were
 *  redirects, and every one of them disagreed with the `<link rel="canonical">` on the page it
 *  pointed at. That is the same defect this whole round has been about (two declarations about one
 *  URL, differing), committed by the fix for it. A sitemap is a list of canonical URLs or it is a
 *  list of guesses. */
export function canonicalPath(p) {
  const s = String(p || '/');
  if (!s.startsWith('/')) return s;                 // absolute URLs and oddities pass through
  if (s === '/' || s.endsWith('/')) return s;
  if (/\.[a-z0-9]{1,8}$/i.test(s)) return s;        // a real file (rss.xml) has no directory form
  return s + '/';
}

/** content/**.md → the URL path the root catch-all emits for it, mirroring [...path].astro's rules:
 *  `_site`/`_theme` are site data; non-site files are not pages; `home` is the locale root; a
 *  locale's own home collapses to `/<loc>/`. Anything this gets wrong shows up as a 404 in the
 *  sitemap, which is why it copies the router rather than inventing a second convention. */
export function contentUrls(glob, siteMetaObj = {}, isPage = () => true) {
  const locales = String(siteMetaObj.locales || '').split(',').map((s) => s.trim()).filter(Boolean);
  const urlLocales = new Set(locales.map((l) => toUrlLocale(l)));
  const out = [];
  for (const [path, raw] of Object.entries(glob || {})) {
    if (/(^|\/)_(site|theme)\.md$/.test(path)) continue;
    if (typeof raw === 'string' && !isPage(raw)) continue;
    const rel = String(path).split('/content/')[1];
    if (!rel) continue;
    const bare = rel.replace(/\.md$/, '');
    if (bare === 'home') { out.push('/'); continue; }
    const segs = bare.split('/');
    // content/<loc>/home.md → /<loc>/ ; the build also collapses it to content/<loc>.md, so a bare
    // single segment that IS a locale code is that locale's home too.
    if (segs.length === 2 && segs[1] === 'home' && urlLocales.has(segs[0])) { out.push(`/${segs[0]}/`); continue; }
    if (segs.length === 1 && urlLocales.has(segs[0])) { out.push(`/${segs[0]}/`); continue; }
    out.push(canonicalPath(`/${bare}`));
  }
  return [...new Set(out)].sort();
}

/** Tag archive paths — only when the site turned the routes on, because otherwise they 404. */
export function tagUrls(postList, siteMetaObj = {}, slugMap = {}) {
  const on = siteMetaObj['blog-tag-routes'] != null && String(siteMetaObj['blog-tag-routes']) !== 'false';
  if (!on) return [];
  const base = String(siteMetaObj['blog-tag-base'] || '/tag').replace(/\/$/, '');
  const seen = new Set();
  for (const p of postList) for (const t of p.tags || []) if (t) seen.add(slugMap[t] || t);
  return [...seen].sort().map((slug) => `${base}/${encodeURI(slug)}/`);
}

/** Category archive paths — the same "only when the site turned the routes on" rule as tagUrls,
 *  gated on `blog-category-routes` (mirrors pages/category/[slug]/index.astro's own getStaticPaths
 *  gate, and its locale sibling's). Until this feature, category archives were the one blog term
 *  the sitemap never listed at all — tagUrls existed, this did not — a bare gap, not a locale one:
 *  a base-locale site with `blog-category-routes: true` published pages the sitemap never named. */
export function categoryUrls(postList, siteMetaObj = {}) {
  const on = siteMetaObj['blog-category-routes'] != null && String(siteMetaObj['blog-category-routes']) !== 'false';
  if (!on) return [];
  const base = String(siteMetaObj['blog-category-base'] || '/category').replace(/\/$/, '');
  const seen = new Set();
  for (const p of postList) for (const c of p.categories || []) if (c) seen.add(c);
  return [...seen].sort().map((slug) => `${base}/${encodeURI(slug)}/`);
}

