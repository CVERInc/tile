// pagetile — the spine: a site read as a book (platform-free, no DOM, no imports).
//
// A book is a SCOPE (which pages) plus a reading ORDER (the spine). This file builds the one book
// every site has without being asked: the whole site.
//
//   scope = every page of the site. Nothing is filtered by the platform: no page is judged "not
//           content". A page leaves the book only when its owner says so, in that page's own
//           frontmatter: `book: false`.
//   order = the site's navigation (the `nav:` menu), read depth-first, the way the menu reads:
//           a parent, then its children in menu order. The home page is the root the menu hangs
//           from, so it opens the book wherever the menu names it, or whether it does (with the
//           menu's label when it has one). Pages the menu does not name follow, sorted by path, so
//           the book is the same whatever order the caller listed the pages in. A blog post the
//           menu does not name is such a page too; whether posts should follow the blog's own order
//           instead is not settled.
//
// Inputs are what sitetile already produces, passed in rather than imported, so this file stays
// importable from any host:
//   pages = [{ path, meta }]     path: the page's URL path as the sitemap spells it ('/', '/about/');
//                                meta: that page's frontmatter (splitFrontmatter in sitetile/site-core.js)
//   nav   = [{ label, href, children }]   the menu tree (navMenuOf in sitetile/chrome-links.mjs)
//
// Output:
//   Spine = { entries: [Entry], excluded: [path] }
//   Entry = { path, depth, navLabel, title }
//     depth    the menu depth (0 = top bar); 0 for a page the menu does not name
//     navLabel the label the menu shows for it; '' when the menu does not name it
//     title    the page's own `title:`; '' when it has none
//   excluded = the pages whose owner unchecked them, in the place they would have had, so an
//              editor can list them as unchecked rather than make them vanish.
//
//   home  = (optional, `{ home }`) this book's home page path; default '/'. For a translated book
//           it is that locale's home as the site spells it ('/fr/'): compute it with
//           localeHomePath({ locales, pathname, contentRels }) in sitetile/locale.mjs, the function
//           the logo and footer read. It is passed in, not derived here, because deriving it needs
//           the site's locales and content files, which this file is not given. Returned paths are
//           never rewritten: the French home stays '/fr/'.
//
// One spine is one locale's book: the caller passes that locale's pages, nav and home.
//
// WITHHELD — "nothing is filtered" has one hard edge: a book never holds a page an anonymous visitor
// cannot read. The page list a caller naturally reaches for (the sitemap's) lists members-only posts:
// their card is public, their bytes are behind the membership verdict. So before anything else, a
// page is withheld when any of these says so:
//   gated      = (optional) the paths the build hands to the membership verdict (reef-verdict.json's
//                `paths`, getGatedPaths in sitetile/astro/src/pages/reef-verdict.json.js). This is the
//                authority: a translated post inherits its base post's privacy there, while its own
//                frontmatter says nothing.
//   visibility = the page's own `visibility: private`, read the way isPrivatePost reads a post
//                (sitetile/astro/src/lib/blog.mjs): that one value, trimmed. It is a second line of
//                defense, never the only one.
//   redirected = (optional) the `from` column of the site's path redirect rules (`_redirects`): a
//                redirect answers that address before the page does. `*` and `:name` match the way
//                that grammar reads them. Query rules are not passed: they leave the bare page alone.
// A withheld page is in neither `entries` nor `excluded`: it is not the owner's to tick. When one
// spelling of a page is withheld, every spelling of it is. The menu still walks through a withheld
// item to its children.
// The caller still owns two edges this file cannot see: an unlisted post (pass the listed corpus,
// listedPosts) and an unclaimed content file (contentUrls with isSiteFile, as sitemap.xml does).
//
// A SCOPED book (buildTagSpine): the posts carrying one tag — the tag archive's own selection,
// `p.tags.includes(tag)` over the listed corpus — in the order the caller passes them (the archive's
// corpus order, allPosts'), with the same withheld rule and the same `book: false`.

const OPT_OUT_KEY = 'book';
const HOME = '/';
const PRIVATE = 'private';

// bookFlag: a page's `book:` value → is the page in the book? The grammar is noindex's
// (sitetile/astro/src/lib/noindex.mjs, noindexFlag): only `false`, any case, says no. Absent, empty
// or any other value keeps the page in, because "in" is the default the owner did not change.
function bookFlag(v) {
  if (v === false) return false;
  if (v == null || v === true) return true;
  return String(v).trim().toLowerCase() !== 'false';
}

// spinePath: a nav href (or a page path) → the page path it names, spelled the way the sitemap
// spells a page (canonicalPath in sitetile/astro/src/lib/sitemap.mjs: directory form with a trailing
// slash, unless the last segment is a file). '' when it names no page of this site: an external or
// protocol-relative URL, a relative href, a label-only `#`, a scheme, an undecodable escape.
// Query and fragment are dropped: `/about#team` is the page `/about/`.
function spinePath(href) {
  const s = String(href == null ? '' : href).trim();
  if (!s.startsWith('/') || s.startsWith('//')) return '';
  let p = s.replace(/[?#].*$/, '');
  try { p = decodeURI(p); } catch { return ''; }
  if (p === HOME || p.endsWith('/') || /\.[a-z0-9]{1,8}$/i.test(p)) return p;
  return p + '/';
}

// isPrivateMeta: a page's own `visibility:` → is it marked private? The post gate's one value
// (isPrivatePost in sitetile/astro/src/lib/blog.mjs), trimmed, nothing else.
function isPrivateMeta(meta) {
  return String(meta && meta.visibility != null ? meta.visibility : '').trim() === PRIVATE;
}

// redirectMatcher: the `from` column of the site's path redirect rules → (page path) → answered by a
// redirect? A literal `from` names one page in either slash spelling (spinePath). `*` matches any
// run of characters and `:name` one path segment, as the `_redirects` grammar reads them. A `from`
// with a query or fragment is a query rule and shadows no page; an off-site `from` names none here.
function redirectMatcher(rules) {
  const exact = new Set();
  const patterns = [];
  for (const r of rules || []) {
    const s = String(r == null ? '' : r).trim();
    if (!s.startsWith('/') || s.startsWith('//') || /[?#]/.test(s)) continue;
    if (!/\*|\/:[A-Za-z]/.test(s)) { const p = spinePath(s); if (p) exact.add(p); continue; }
    let src = s;
    try { src = decodeURI(s); } catch { /* matched as written */ }
    const re = src.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\/:[A-Za-z]\w*/g, '/[^/]+');
    patterns.push(new RegExp('^' + re + '$'));
  }
  return (path) => exact.has(path)
    || patterns.some((re) => re.test(path) || (path !== HOME && re.test(path.replace(/\/$/, ''))));
}

// publicPages: pages → Map(path → page) of the pages a book may hold: one entry per page (its first
// spelling wins), none of them withheld (see WITHHELD above). Input order is kept.
function publicPages(pages, { gated, redirected } = {}) {
  const gatedSet = new Set([...(gated || [])].map(spinePath).filter(Boolean));
  const shadowed = redirectMatcher(redirected);
  const byPath = new Map();
  const withheld = new Set();
  for (const pg of pages || []) {
    const path = spinePath(pg && pg.path);
    if (!path) continue;
    const meta = (pg && pg.meta) || {};
    if (gatedSet.has(path) || isPrivateMeta(meta) || shadowed(path)) { withheld.add(path); continue; }
    if (!byPath.has(path)) byPath.set(path, { path, meta, tags: pg.tags });
  }
  for (const path of withheld) byPath.delete(path);
  return byPath;
}

const titleOf = (meta) => (meta.title == null ? '' : String(meta.title));

// buildSiteSpine: pages + nav (+ this book's home path, + what is withheld) → the whole-site spine. Pure.
function buildSiteSpine(pages, nav, { home = HOME, gated, redirected } = {}) {
  const byPath = new Map([...publicPages(pages, { gated, redirected })].map(([p, pg]) => [p, pg.meta]));

  const entries = [];
  const excluded = [];
  const placed = new Set();
  const place = (path, depth, navLabel) => {
    if (!byPath.has(path) || placed.has(path)) return;
    placed.add(path);
    const meta = byPath.get(path);
    if (!bookFlag(meta[OPT_OUT_KEY])) { excluded.push(path); return; }
    entries.push({ path, depth, navLabel, title: titleOf(meta) });
  };

  // The home page opens the book wherever the menu names it, or whether it does: it is the root
  // the menu hangs from, not one of its items. It keeps the label of the first menu item that
  // names it, and that item's later place in the walk is skipped (place() places a path once).
  // An unchecked home page goes to `excluded` here, so nothing else is pulled to the front.
  const homePath = spinePath(home);
  let homeLabel = '';
  (function findHome(items) {
    for (const it of items || []) {
      if (!it) continue;
      if (spinePath(it.href) === homePath) { homeLabel = it.label == null ? '' : String(it.label); return true; }
      if (findHome(it.children)) return true;
    }
    return false;
  })(nav);
  if (homePath) place(homePath, 0, homeLabel);

  (function walk(items, depth) {
    for (const it of items || []) {
      if (!it) continue;
      place(spinePath(it.href), depth, it.label == null ? '' : String(it.label));
      walk(it.children, depth + 1);
    }
  })(nav, 0);

  [...byPath.keys()].filter((p) => !placed.has(p)).sort().forEach((p) => place(p, 0, ''));
  return { entries, excluded };
}

// buildTagSpine: pages + one tag (+ what is withheld) → that tag's book. Pure.
//   pages = [{ path, meta, tags }]   tags: the post's parsed list (parsePost in sitetile's blog.mjs);
//                                    anything but an array is no tags — this file never re-reads the
//                                    tag grammar. Pass the LISTED corpus, in its own order.
//   tag   = the tag as posts carry it (the archive's `tag`, not its URL slug), matched exactly.
// Output: the site spine's shape — { entries: [{ path, depth: 0, navLabel: '', title }], excluded }.
function buildTagSpine(pages, tag, { gated, redirected } = {}) {
  const entries = [];
  const excluded = [];
  const want = tag == null ? '' : String(tag);
  if (!want) return { entries, excluded };
  for (const { path, meta, tags } of publicPages(pages, { gated, redirected }).values()) {
    if (!Array.isArray(tags) || !tags.includes(want)) continue;
    if (!bookFlag(meta[OPT_OUT_KEY])) { excluded.push(path); continue; }
    entries.push({ path, depth: 0, navLabel: '', title: titleOf(meta) });
  }
  return { entries, excluded };
}

export { buildSiteSpine, buildTagSpine, bookFlag, spinePath, OPT_OUT_KEY };
