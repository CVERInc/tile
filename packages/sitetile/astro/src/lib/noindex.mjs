// reef#2554 — which emitted pages are noindex. ONE decision, read by both places that must agree
// about it: the page's <meta name="robots"> (pages/[...path].astro, on every route it emits) and
// sitemap.xml. A page whose head says noindex while the sitemap still hands it to crawlers is two
// declarations about one URL, differing — the defect the sitemap's own header is about.
//
// A page's identity is its OUTPUT FILE: the file the build writes for its route, computed by
// routeOutputFile() — Astro's own route → file steps, not a guess at what spellings mean the same
// page. Both consumers hand the policy the route param they emit (the `[...path]` value), so the
// head and the sitemap entry of one page are decided by one file name. Nothing is folded: two
// routes the build writes to two files are two pages, whatever their URLs look like.
//
// A page is noindex when its OWN source says `noindex: true`, or — by default — when it is where an
// `action=inbox` form's `thanks=` sends a visitor after a successful submit. An explicit
// `noindex: false` on that source wins: some owners want their thanks page found. The own source is
// the one that produces the page: a content page's content file; a post's own frontmatter; the blog
// index's — home.md for a blog mounted at `/` (the router never emits home there), else none. And
// only the route the build actually WRITES at a file decides it (writtenRoutes): when a post or the
// blog index lands on a content page's file, the content page is displaced, unpublished, and its
// flag, thanks default and sitemap entry all count for nothing. Own frontmatter only, not the `_site.md` layer: a
// site-wide `noindex:` would quietly take every page out of search, which is not something one line
// in a config file should be able to do by accident.
//
// A thanks= target is resolved to the file a static host serves for it: the path exactly as a file
// (`/x/index.html` → x/index.html), or its directory's index.html (`/x`, `/x/` → x/index.html).
// A target whose file no route writes matches nothing (`/INDEX.HTML` is not index.html;
// `/done/` is not done/index.html/index.html).
//
// Like sitemap.mjs, no `@sitetile` alias here, so plain `node` can test it (noindex.test.mjs).
import { parseSite, parseParams, isSiteFile, safeInternalPathQuiet } from '../../../site-core.js';

/** `noindex:` as written → true | false | undefined (not said). Absent or empty is "not said";
 *  `false` in any case or padding is off; any other value is on. (The `blog-*-routes` keys read
 *  empty and `FALSE` as on — this key's own reading is the one above, and its tests pin it.) */
export function noindexFlag(v) {
  if (v === true || v === false) return v;
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  return s !== 'false';
}

/** A `[...path]` route param → the file the build writes for it, relative to the output dir.
 *  The same steps astro 7.3.5 takes (static output, default build.format 'directory'):
 *  routing/params.js stringifyParams (one leading and one trailing slash trimmed off the value),
 *  routing/generator.js (NFC, `#` → %23, `?` → %3F, a leading `/`, duplicate leading slashes
 *  collapsed, `/` for the empty path), core/output-filename.js getOutputFilename (`/` →
 *  index.html, `/404` and `/500` → <name>.html, else <pathname minus one trailing slash>/index.html).
 *  noindex.test.mjs runs Astro's own functions beside this one over the same params. */
export function routeOutputFile(param) {
  const v = param == null ? '' : String(param).replace(/^\/|\/$/g, '');
  const seg = v.normalize().replace(/#/g, '%23').replace(/\?/g, '%3F');
  const pathname = seg ? ('/' + seg).replace(/^\/+/, '/') : '/';
  if (pathname === '/') return 'index.html';
  if (pathname === '/404' || pathname === '/500') return pathname.slice(1) + '.html';
  return pathname.slice(1).replace(/\/$/, '') + '/index.html';
}

/** content/<rel>.md → its route param, or null when it is no page. Mirrors contentPageRel
 *  (lib/locale-editions.mjs, which this file cannot import without the alias): `_site`/`_theme`
 *  are data, a non-site file is not a page, `home` is the root, every other rel is its own path. */
function contentParam(path, raw) {
  if (/(^|\/)_(site|theme)\.md$/.test(path)) return null;
  if (typeof raw !== 'string' || !isSiteFile(raw)) return null;
  const rel = String(path).split('/content/')[1];
  if (!rel) return null;
  const bare = rel.replace(/\.md$/, '');
  return bare === 'home' ? undefined : bare;
}

const NAV_BASE = 'http://sitetile.invalid/';
/** The files a form's `thanks=` can land on — none when Form.astro would not wire it: only
 *  `action=inbox` forms redirect to `thanks=`, and only a value safeInternalPath accepts reaches
 *  the page. The value is resolved the way the browser's navigation resolves it (`/./x` → `/x`,
 *  `\` → `/`, query and fragment dropped), then each path segment is decoded on its own with
 *  decodeURIComponent, so `/thank%26you/` names the file thank&you/index.html — a decoded `?` or
 *  `#` is part of a file name, never a new query or fragment, and a segment that decodes to a `/`
 *  names no file at all. No case folding: a host matches file names exactly. */
function thanksFiles(section) {
  if (section.type !== 'form') return [];
  const pm = parseParams(section.params);
  if (pm.action !== 'inbox') return [];
  const p = safeInternalPathQuiet(pm.thanks);
  if (!p) return [];
  let segs;
  try { segs = new URL(p, NAV_BASE).pathname.slice(1).split('/').map(decodeURIComponent); } catch { return []; }
  if (segs.some((s) => s.includes('/'))) return [];
  const path = segs.join('/');
  const files = [];
  if (path !== '' && !path.endsWith('/')) files.push(path);      // the path, as a file
  files.push(path.replace(/\/$/, '') ? path.replace(/\/$/, '') + '/index.html' : 'index.html');
  return files;
}

/** Routes, in the order pages/[...path].astro emits them → output file → the ONE route written
 *  there. When two routes land on one file the build writes the LAST of them: astro 7.3.5's
 *  core/build/generate.js keeps the first pathname's slot (and warns PrerenderRouteConflict for the
 *  rest), but renders it with the props core/render/route-cache.js keyed for that pathname —
 *  `keyed.set(paramsKey, sp)` over getStaticPaths' result, a later entry overwriting an earlier one —
 *  and render/params-and-props.js reads them back through findPathItemByKey. Two params whose
 *  pathnames differ but whose files agree both render, in order, the later one over the earlier.
 *  Every other route at that file is DISPLACED: nothing of it is published, so nothing of it may
 *  decide anything — not its noindex: and not a sitemap entry (reef#2554 r4). */
export function writtenRoutes(routes, paramOf) {
  const written = new Map();
  for (const r of routes) written.set(routeOutputFile(paramOf(r)), r);
  return written;
}

/** content/**.md glob → the decision for the route WRITTEN at a file (writtenRoutes), asked by its
 *  route param:
 *    page(param)        — a content page: the own flag is its content file's (two content files at
 *                         one file: the later in glob order, which is the one the router emits later);
 *    index(param)       — the blog index or its pager: no content file of its own, except home.md
 *                         for the index written at index.html — a blog mounted at `/`, where the
 *                         router does not emit home as a page at all and hands `/` to the index.
 *                         Any other content file at an index's file is an emitted route the index
 *                         displaced, so its flag counts for nothing;
 *    post(param, post)  — a post: the own flag is the post's own `noindex:` (post.noindex). */
export function noindexPolicy(glob) {
  const own = new Map();          // output file → the flag of the content file that writes it
  const targets = new Set();      // every file some form's thanks= lands on
  for (const [path, raw] of Object.entries(glob || {})) {
    const param = contentParam(path, raw);
    if (param === null) continue;
    const site = parseSite(raw);
    own.set(routeOutputFile(param), noindexFlag(site.meta.noindex));
    for (const s of site.sections) for (const f of thanksFiles(s)) targets.add(f);
  }
  const decide = (file, flag) => flag === true || (flag === undefined && targets.has(file));
  return {
    page: (param) => { const f = routeOutputFile(param); return decide(f, own.get(f)); },
    index: (param) => { const f = routeOutputFile(param); return decide(f, f === 'index.html' ? own.get(f) : undefined); },
    post: (param, post) => decide(routeOutputFile(param), noindexFlag(post && post.noindex)),
  };
}
