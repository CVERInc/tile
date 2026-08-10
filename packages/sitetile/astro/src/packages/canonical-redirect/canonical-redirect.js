// REEF with Blog — canonical-redirect island. Generalizes WordPress's redirect_canonical: maps a
// site's LEGACY / alternate URL forms (a query-string permalink like ?p=123, ?cat=4, ?m=201307, or
// a Blogger/Wix equivalent) to its CURRENT canonical pretty URL, so old shared links and shortlinks
// survive a recast cutover instead of dead-ending. This is the redirect half of the Blog module's
// source-faithful routing (the other halves are postUrl's %postname% permalinks + the /tag /category
// /author /YYYY archive routes). It is NOT a dynamic coral — it fetches no feelreef backend data and
// has no data-dynamic-coral mount; it's a Blog behavior, loaded (bundled) by SiteLayout like the
// blog-archive / blog-search islands, gated on `blog-canonical-redirects`.
//
// Platform-neutral BY DESIGN: it knows nothing about WordPress — every rule lives in the site's
// /redirect-map.json (per-site data). Client-side (a location.replace), not a server 301 — a human
// clicking an old link lands on the right page; if SEO link-equity ever needs a true 301, the same
// /redirect-map.json feeds an edge worker instead, no data rework.
//
// SiteLayout sets `window.__canonicalRedirect` = the watched param list (from
// `blog-canonical-redirects: p,cat,author,m`). The guard below fetches nothing unless one of THOSE
// params is in the URL, so normal pages and the internal ?tag=/?ym= blog filters pay nothing.
//
// Rule shape (in /redirect-map.json): { param, template, lookup?, transform? }
//   - lookup:   { "<value>": "<resolved>" } — param value is an id/key → resolved slug (skip if absent)
//   - transform:"yyyymm"  — 201307 → "2013/07", 2013 → "2013" (skip otherwise)
//   - neither:  the param value is used verbatim (already a slug)
//   template:   "/category/{v}/" — {v} replaced with the resolved value, each path segment encoded.
(async function () {
  try {
    const params = (typeof window !== 'undefined' && window.__canonicalRedirect) || [];
    const search = location.search;
    // Guard: bail before any network unless a WATCHED legacy param is present.
    if (!search || !params.some((p) => new RegExp('[?&]' + p + '=').test(search))) return;
    const q = new URLSearchParams(search);
    const res = await fetch('/redirect-map.json', { cache: 'force-cache' });
    if (!res.ok) return;
    const { rules = [] } = await res.json();
    for (const r of rules) {
      if (!r || !q.has(r.param)) continue;
      const raw = q.get(r.param);
      let v;
      if (r.lookup) {
        v = r.lookup[raw];
        if (v == null) continue;                       // unknown id → let the page fall through
      } else if (r.transform === 'yyyymm') {
        if (/^\d{6}$/.test(raw)) v = raw.slice(0, 4) + '/' + raw.slice(4, 6);
        else if (/^\d{4}$/.test(raw)) v = raw;
        else continue;
      } else {
        v = raw;                                        // already a slug
      }
      const enc = String(v).split('/').map(encodeURIComponent).join('/');
      const target = r.template.replace('{v}', enc);
      if (target && target !== location.pathname) { location.replace(target); return; }
    }
  } catch (e) { /* best-effort; a redirect must never break the page */ }
})();
