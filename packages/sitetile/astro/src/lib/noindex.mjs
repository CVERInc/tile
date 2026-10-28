// reef#2554 — the render-time half of noindex: what each page's OWN source says, stamped into the
// HTML for the post-build pass (noindex-pass.mjs) that decides it over the files the build wrote.
// Nothing here decides which pages are noindex; it only reads a source's own `noindex:` and names
// route collisions for the build log.
//
// Like sitemap.mjs, no `@sitetile` alias here, so plain `node` can test it (noindex.test.mjs).

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

/** A `[...path]` route param → the file the build writes for it, relative to the output dir — for
 *  NAMING collisions in the build log only (pages/[...path].astro); the noindex decision never
 *  reads it. Astro 7.3.5's steps (routing/params.js, routing/generator.js, core/output-filename.js),
 *  plus the filesystem's own: `x//y` is the file x/y. */
export function routeOutputFile(param) {
  const v = param == null ? '' : String(param).replace(/^\/|\/$/g, '');
  const seg = v.normalize().replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/\/{2,}/g, '/');
  const pathname = seg ? ('/' + seg).replace(/^\/+/, '/') : '/';
  if (pathname === '/') return 'index.html';
  if (pathname === '/404' || pathname === '/500') return pathname.slice(1) + '.html';
  return pathname.slice(1).replace(/\/$/, '') + '/index.html';
}
