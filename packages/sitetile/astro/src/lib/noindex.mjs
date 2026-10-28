// reef#2554 — which emitted pages are noindex. ONE decision, read by both places that must agree
// about it: the page's <meta name="robots"> (pages/[...path].astro, on every route it emits) and
// sitemap.xml. A page whose head says noindex while the sitemap still hands it to crawlers is two
// declarations about one URL, differing — the defect the sitemap's own header is about.
//
// The decision is keyed by the page's EMITTED IDENTITY — the directory its index.html lands in
// (pageIdentity) — not by which source file produced it. That is what lets one rule cover every
// route kind: a content page, the blog index (including a blog mounted at `/`, where home.md's
// frontmatter is the one that mounts it), a blog post, a locale edition. Both consumers hand it the
// identity of what they emit; neither keeps a list of its own.
//
// A page is noindex when the content file that lands at its identity says `noindex: true`, or — by
// default — when it is where an `action=inbox` form's `thanks=` sends a visitor after a successful
// submit. An explicit `noindex: false` on that content file wins: some owners want their thanks
// page found. Own frontmatter only, not the `_site.md` layer: a site-wide `noindex:` would quietly
// take every page out of search, which is not something one line in a config file should be able
// to do by accident. A thanks= at a page nobody emits is harmless: nothing asks about it.
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

/** A site path → the identity of the page it lands on: the directory, with a trailing slash, that
 *  holds its index.html. `/thanks.fr`, `/thanks.fr/` and `/thanks.fr/index.html` are one page —
 *  every route [...path].astro emits is a directory, so a dotted last segment is not a file here
 *  (sitemap.mjs's canonicalPath guesses otherwise; it is a URL speller, not an identity). */
export function pageIdentity(p) {
  let s = String(p == null ? '' : p).split(/[?#]/, 1)[0];
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/index\.html$/i, '/');
  return s.endsWith('/') ? s : s + '/';
}

/** content/<rel>.md → the identity [...path].astro emits it at. Mirrors contentPageRel
 *  (lib/locale-editions.mjs, which this file cannot import without the alias): `_site`/`_theme`
 *  are data, a non-site file is not a page, `home` is the root, every other rel is its own path. */
function contentIdentity(path, raw) {
  if (/(^|\/)_(site|theme)\.md$/.test(path)) return null;
  if (typeof raw !== 'string' || !isSiteFile(raw)) return null;
  const rel = String(path).split('/content/')[1];
  if (!rel) return null;
  const bare = rel.replace(/\.md$/, '');
  return bare === 'home' ? '/' : pageIdentity('/' + bare);
}

const NAV_BASE = 'http://sitetile.invalid/';
/** Where a form's `thanks=` lands, as a page identity — or null when Form.astro would not wire it:
 *  only `action=inbox` forms redirect to `thanks=`, and only a value safeInternalPath accepts
 *  reaches the page. After that check the value is resolved the way the browser's navigation
 *  resolves it (`/./x` → `/x`, `\` → `/`, query and fragment dropped), then decoded so it compares
 *  with the raw file names a page identity is built from. */
function thanksTarget(section) {
  if (section.type !== 'form') return null;
  const pm = parseParams(section.params);
  if (pm.action !== 'inbox') return null;
  const p = safeInternalPathQuiet(pm.thanks);
  if (!p) return null;
  let path;
  try { path = new URL(p, NAV_BASE).pathname; } catch { return null; }
  try { path = decodeURI(path); } catch { /* keep the encoded form */ }
  return pageIdentity(path);
}

/** content/**.md glob → isNoindex(pathOrIdentity). Ask it about every page you emit or list. */
export function noindexPolicy(glob) {
  const own = new Map();          // identity → the flag of the content file that lands there
  const targets = new Set();      // every identity some form's thanks= lands on
  for (const [path, raw] of Object.entries(glob || {})) {
    const id = contentIdentity(path, raw);
    if (!id) continue;
    const site = parseSite(raw);
    own.set(id, noindexFlag(site.meta.noindex));
    for (const s of site.sections) {
      const t = thanksTarget(s);
      if (t) targets.add(t);
    }
  }
  return (p) => {
    const id = pageIdentity(p);
    const flag = own.get(id);
    return flag === true || (flag === undefined && targets.has(id));
  };
}
