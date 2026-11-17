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
//           from, so it opens the book even when the menu does not name it. Pages the menu does
//           not name follow, sorted by path, so the book is the same whatever order the caller
//           listed the pages in.
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
// One spine is one locale's book: the caller passes that locale's pages and that locale's nav.

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

// buildSiteSpine: pages + nav → the whole-site spine. Pure.
function buildSiteSpine(pages, nav) {
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

  // the root first, unless the menu names it (then it takes the menu's place and label)
  const named = new Set();
  (function collect(items) {
    for (const it of items || []) { named.add(spinePath(it && it.href)); collect(it && it.children); }
  })(nav);
  if (!named.has(HOME)) place(HOME, 0, '');

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
