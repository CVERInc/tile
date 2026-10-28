// reef#2554 — which content pages are noindex. ONE list, read by both places that must agree
// about it: the page's <meta name="robots"> (pages/[...path].astro) and sitemap.xml. A page whose
// head says noindex while the sitemap still hands it to crawlers is two declarations about one
// URL, differing — the defect the sitemap's own header is about.
//
// A page is noindex when its OWN frontmatter says `noindex: true`, or — by default — when it is
// where a form's `thanks=` sends a visitor after a successful submit. An explicit `noindex: false`
// on that page wins: some owners want their thanks page found. Own frontmatter only, not the
// `_site.md` layer: a site-wide `noindex:` would quietly take every page out of search, which is
// not something one line in a config file should be able to do by accident.
//
// Like sitemap.mjs, no `@sitetile` alias here, so plain `node` can test it (noindex.test.mjs).
import { parseSite, parseParams, isSiteFile, safeInternalPathQuiet } from '../../../site-core.js';
import { contentUrls, canonicalPath } from './sitemap.mjs';

/** `noindex:` as written → true | false | undefined (not said). Same reading as the site's other
 *  boolean keys (`blog-tag-routes` …): present and not `false` is on. */
export function noindexFlag(v) {
  if (v === true || v === false) return v;
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  return s !== 'false';
}

/** Where a form's `thanks=` lands, as a canonical site path — or null when Form.astro would not
 *  wire it: only `action=inbox` forms redirect to `thanks=`, and only a value safeInternalPath
 *  accepts reaches the page. The query/fragment are not part of which page it is. */
function thanksTarget(section) {
  if (section.type !== 'form') return null;
  const pm = parseParams(section.params);
  if (pm.action !== 'inbox') return null;
  const p = safeInternalPathQuiet(pm.thanks);
  if (!p) return null;
  let path = p.split(/[?#]/, 1)[0];
  try { path = decodeURI(path); } catch { /* keep as written */ }
  return canonicalPath(path);
}

/** content/**.md glob → the Set of URL paths (contentUrls' form) that are noindex. */
export function noindexUrls(glob, siteMetaObj = {}) {
  const own = new Map();          // url → this page's own noindex flag
  const targets = new Set();      // every url some form's thanks= lands on
  for (const [path, raw] of Object.entries(glob || {})) {
    if (typeof raw !== 'string') continue;
    const [url] = contentUrls({ [path]: raw }, siteMetaObj, isSiteFile);
    if (!url) continue;
    const site = parseSite(raw);
    own.set(url, noindexFlag(site.meta.noindex));
    for (const s of site.sections) {
      const t = thanksTarget(s);
      if (t) targets.add(t);
    }
  }
  const out = new Set();
  for (const [url, flag] of own) if (flag === true || (flag === undefined && targets.has(url))) out.add(url);
  return out;
}
