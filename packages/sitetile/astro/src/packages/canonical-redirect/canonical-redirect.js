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
// Same origin only: a value with a doubled `/` or a `.` / `..` segment is refused, and a target
// (template included) is resolved against this page and followed only when it keeps this page's
// origin and scheme; the island then navigates to that resolved absolute URL, never the raw string.
// A rule that is refused, or whose target cannot be resolved, falls through to the next rule.
// Tested by packages/sitetile/canonical-redirect.test.mjs, which runs this file's text in a vm.
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
      try {
        if (!r || !q.has(r.param)) continue;
        const raw = q.get(r.param);
        let v;
        if (r.lookup) {
          v = r.lookup[raw];
          if (v == null) continue;                     // unknown id → let the page fall through
        } else if (r.transform === 'yyyymm') {
          if (/^\d{6}$/.test(raw)) v = raw.slice(0, 4) + '/' + raw.slice(4, 6);
          else if (/^\d{4}$/.test(raw)) v = raw;
          else continue;
        } else {
          v = raw;                                      // already a slug
        }
        // A value is path segments joined by `/`. A doubled `/` (an empty segment between two
        // others, which includes a leading `//`) and a `.` or `..` segment are refused; a single
        // leading or trailing `/` is kept. Each segment is then encoded, so a backslash or `%` in
        // the value reaches the URL as `%5C` / `%25`, never as a separator.
        const segs = String(v).split('/');
        if (segs.slice(1, -1).some((seg) => seg === '')) continue;
        if (segs.some((seg) => seg === '.' || seg === '..')) continue;
        const target = r.template.replace('{v}', segs.map(encodeURIComponent).join('/'));
        if (!target) continue;
        // The canonical redirect only follows same-origin targets. The target is resolved against
        // this page, as the browser would, and followed only when the result keeps this page's
        // origin and scheme. The resolved absolute URL is what is navigated to.
        const u = new URL(target, location.href);
        if (u.origin !== location.origin || u.protocol !== location.protocol) continue;
        // Already there: the same URL, or (as before) the same path for a target with no query or
        // fragment of its own.
        if (u.href === location.href || u.pathname + u.search + u.hash === location.pathname) continue;
        location.replace(u.href);
        return;
      } catch (e) { /* this rule's target could not be resolved: try the next rule */ }
    }
  } catch (e) { /* best-effort; a redirect must never break the page */ }
})();
