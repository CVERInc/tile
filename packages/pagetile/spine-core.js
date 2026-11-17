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
//           the book is the same whatever order the caller listed the pages in.
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

const OPT_OUT_KEY = 'book';
const HOME = '/';

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

// buildSiteSpine: pages + nav (+ this book's home path) → the whole-site spine. Pure.
function buildSiteSpine(pages, nav, { home = HOME } = {}) {
  const byPath = new Map();
  for (const pg of pages || []) {
    const path = spinePath(pg && pg.path);
    if (path && !byPath.has(path)) byPath.set(path, (pg && pg.meta) || {});
  }

  const entries = [];
  const excluded = [];
  const placed = new Set();
  const place = (path, depth, navLabel) => {
    if (!byPath.has(path) || placed.has(path)) return;
    placed.add(path);
    const meta = byPath.get(path);
    if (!bookFlag(meta[OPT_OUT_KEY])) { excluded.push(path); return; }
    entries.push({ path, depth, navLabel, title: meta.title == null ? '' : String(meta.title) });
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

export { buildSiteSpine, bookFlag, spinePath, OPT_OUT_KEY };
