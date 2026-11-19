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
// page is withheld when either of these says so:
//   gated      = (REQUIRED) an array of path strings: the paths the build hands to the membership
//                verdict (reef-verdict.json's `paths`, getGatedPaths in
//                sitetile/astro/src/pages/reef-verdict.json.js, i.e. gatedPostPaths in
//                sitetile/astro/src/lib/blog.mjs). It is the ONLY privacy reader here: gatedPostPaths
//                decides with isPrivatePost over the post as the builder parsed it (quoted keys and
//                values, duplicate keys, CRLF), and a translated post inherits its base post's privacy
//                there while its own frontmatter says nothing. This file never reads `visibility:`
//                from a page's meta: that would be a second reading of frontmatter, and a weaker one.
//                Pass `[]` for a site with no members-only post; anything but an array of strings
//                (undefined, null, a string, a Set, the verdict object itself) throws.
//   redirected = (optional) an array of the `from` column of the site's path redirect rules
//                (`_redirects`): a redirect answers that address before the page does. `*` and `:name`
//                match the way that grammar reads them. Query rules are not passed: they leave the bare
//                page alone. Anything but an array of strings throws.
// Both sides are compared through one normaliser (pageKey below), so every spelling the site worker
// and the static server answer as one page is one page here: the directory spelling, an explicit
// `/index.html`, an encoded separator, a run of slashes, a dot segment, any escape. A page path whose
// escape does not decode is withheld. Case is kept: a case-different path is another page (see
// pageKey). A withheld page is in neither `entries` nor `excluded`: it is not the owner's to tick.
// When one spelling of a page is withheld, every spelling of it is. The menu still walks through a
// withheld item to its children.
// The caller still owns two edges this file cannot see: an unlisted post (pass the listed corpus,
// listedPosts) and an unclaimed content file (contentUrls with isSiteFile, as sitemap.xml does).
//
// A SCOPED book (buildTagSpine): the posts carrying one tag — the tag archive's own selection,
// `p.tags.includes(tag)` over the listed corpus — in the order the caller passes them (the archive's
// corpus order, allPosts'), with the same withheld rule and the same `book: false`.

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

// pageKey: THE normaliser. A site path (a page's, a nav href, a verdict path, a redirect `from`) → the
// identity of the page it names. Every comparison in this file goes through it, on both sides.
// It is the site worker's normalizeVerdictPath (packages/dynamic-corals/square-shop/
// shop-function-template.js: `%2F` is `/`, the directory spelling and the explicit `/index.html` are
// the page), plus what the URL parser and the static server make of a path before either compares it,
// so neither side has to guess the other's spelling:
//   - query and fragment are dropped; `\` is `/` (how the URL parser reads an http path)
//   - every escape is decoded, once, per segment (decodeURIComponent): `%2B` is `+`, `%26` is `&`
//   - runs of `/` collapse, `.` and `..` segments resolve (never above the root)
//   - a last segment `index.html` names its directory
//   - case is KEPT. The worker gates by exact comparison (pathMatchesRule: `===`), its emitter
//     (emit-shop-function.mjs, normalizeSitePath) does not fold case, and the renderer writes one
//     directory per route on a case-sensitive file system, from the same postUrl() that writes the
//     verdict's paths. So `/Devlog/Paid/` is not the members-only post's address, and folding it here
//     would withhold a page the site serves.
// → '/', '/devlog/paid', '/rss.xml' (no trailing slash but the root's); '' when it names no page of
//   this site (external or protocol-relative URL, relative href, a scheme, `#`); null when an escape
//   does not decode (the caller withholds: fail closed).
function pageKey(href) {
  const s = String(href == null ? '' : href).trim().replace(/\\/g, '/');
  if (!s.startsWith('/') || s.startsWith('//')) return '';
  let p = s.replace(/[?#].*$/, '');
  p = p.replace(/%2f/gi, '/');
  p = p.replace(/\/{2,}/g, '/');
  const segs = [];
  for (const raw of p.split('/').slice(1)) {
    let seg;
    try { seg = decodeURIComponent(raw); } catch { return null; }
    if (seg === '.') continue;
    if (seg === '..') { segs.pop(); continue; }
    segs.push(seg);
  }
  if (segs[segs.length - 1] === '') segs.pop();
  if (segs[segs.length - 1] === 'index.html') segs.pop();
  return '/' + segs.join('/');
}

// spinePath: a nav href (or a page path) → the page path it names, spelled the way the sitemap
// spells a page (canonicalPath in sitetile/astro/src/lib/sitemap.mjs: directory form with a trailing
// slash, unless the last segment is a file), from its pageKey. '' when it names no page of this site
// or does not decode. `/about#team`, `/about`, `/about//` and `/about/index.html` are all `/about/`.
function spinePath(href) {
  const key = pageKey(href);
  if (!key) return '';
  if (key === HOME || /\.[a-z0-9]{1,8}$/i.test(key)) return key;
  return key + '/';
}

// keysOf: a path the build wrote as TEXT (a verdict path, a redirect `from`) → the page keys it can
// name. Such a path is not a URL: `/devlog/100%` is a slug with a percent sign in it, while
// `/devlog/caf%C3%A9` can be an author's escaped permalink. Both readings go through pageKey: as
// written, and literally (every `%` its own character, which always decodes).
function keysOf(text) {
  return [...new Set([pageKey(text), pageKey(text.replace(/%/g, '%25'))].filter(Boolean))];
}

// pathList: an option that must be an array of strings → that array; anything else throws, so a
// missing or mistyped list can never read as "nothing to withhold".
function pathList(value, name) {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new TypeError(`spine: \`${name}\` must be an array of path strings`
      + (name === 'gated' ? " (the verdict's `paths`; pass [] for a site with no members-only post)" : ''));
  }
  return value;
}

// gatedKeys: the verdict's paths → the set of page keys they gate. A path that names no page of this
// site is not a verdict path: it throws rather than gate nothing.
function gatedKeys(gated) {
  const keys = new Set();
  for (const g of pathList(gated, 'gated')) {
    const ks = keysOf(g);
    if (!ks.length) throw new TypeError(`spine: \`gated\` holds ${JSON.stringify(g)}, which is not a site path`);
    ks.forEach((k) => keys.add(k));
  }
  return keys;
}

// redirectMatcher: the `from` column of the site's path redirect rules → (page key) → answered by a
// redirect? A literal `from` names one page in any spelling (pageKey). `*` matches any run of
// characters and `:name` one path segment, as the `_redirects` grammar reads them. A `from` with a
// query or fragment is a query rule and shadows no page; an off-site `from` names none here.
function redirectMatcher(rules) {
  const exact = new Set();
  const patterns = [];
  for (const r of pathList(rules, 'redirected')) {
    const s = r.trim();
    if (/[?#]/.test(s)) continue;
    for (const key of keysOf(s)) {
      if (!/\*|\/:[A-Za-z]/.test(key)) { exact.add(key); continue; }
      const re = key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\/:[A-Za-z]\w*/g, '/[^/]+');
      patterns.push(new RegExp('^' + re + '$'));
    }
  }
  return (key) => exact.has(key) || patterns.some((re) => re.test(key) || (key !== HOME && re.test(key + '/')));
}

// publicPages: pages → Map(path → page) of the pages a book may hold: one entry per page (its first
// spelling wins), none of them withheld (see WITHHELD above). Input order is kept.
function publicPages(pages, { gated, redirected = [] }) {
  const gatedSet = gatedKeys(gated);
  const shadowed = redirectMatcher(redirected);
  const byPath = new Map();
  const withheld = new Set();
  for (const pg of pages || []) {
    // '' names no page of this site; null does not decode and is withheld (fail closed): neither
    // enters the book.
    const key = pageKey(pg && pg.path);
    if (!key) continue;
    const path = spinePath(pg.path);
    if (gatedSet.has(key) || shadowed(key)) { withheld.add(path); continue; }
    if (!byPath.has(path)) byPath.set(path, { path, meta: pg.meta || {}, tags: pg.tags });
  }
  for (const path of withheld) byPath.delete(path);
  return byPath;
}

const titleOf = (meta) => (meta.title == null ? '' : String(meta.title));

// buildSiteSpine: pages + nav + what is withheld (+ this book's home path) → the whole-site spine.
// Pure. `gated` is required (see WITHHELD).
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

// buildTagSpine: pages + one tag + what is withheld → that tag's book. Pure. `gated` is required.
//   pages = [{ path, meta, tags }]   tags: the post's parsed list (parsePost in sitetile's blog.mjs);
//                                    anything but an array is no tags — this file never re-reads the
//                                    tag grammar. Pass the LISTED corpus, in its own order.
//   tag   = the tag as posts carry it (the archive's `tag`, not its URL slug), matched exactly.
// Output: the site spine's shape — { entries: [{ path, depth: 0, navLabel: '', title }], excluded }.
function buildTagSpine(pages, tag, { gated, redirected } = {}) {
  const book = publicPages(pages, { gated, redirected });
  const entries = [];
  const excluded = [];
  const want = tag == null ? '' : String(tag);
  if (!want) return { entries, excluded };
  for (const { path, meta, tags } of book.values()) {
    if (!Array.isArray(tags) || !tags.includes(want)) continue;
    if (!bookFlag(meta[OPT_OUT_KEY])) { excluded.push(path); continue; }
    entries.push({ path, depth: 0, navLabel: '', title: titleOf(meta) });
  }
  return { entries, excluded };
}

export { buildSiteSpine, buildTagSpine, bookFlag, spinePath, OPT_OUT_KEY };
