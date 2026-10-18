// One `404.html` per declared locale: `dist/<url-locale>/404/index.html` → `dist/<url-locale>/404.html`.
//
// 🩸 CVERInc/reef#2112. Cloudflare Pages serves the NEAREST `404.html` up the directory tree, so a
// Chinese edition's missing pages are caught by `dist/zh-tw/404.html` — a FILE at that path. Astro writes
// only the root `/404` (and `/500`) as a bare `.html` (its STATUS_CODE_PAGES); every other route, the
// per-locale 404 in pages/[...loc]/404.astro included, is a directory index, and `zh-tw/404/index.html`
// is just a page to Pages. This hook renames those files once the static output is written.
//
// WHY HERE and not in packages/build: the production deploy runs a plain `npx astro build` and nothing
// after it. A post-step in packages/build would be green on every test and absent from every site.
//
// WHICH files: a route Astro itself reports in `pages` whose path is `<url-locale>/404`, where
// `<url-locale>` is one of the editions pages/[...loc]/404.astro built a 404 FOR this build — the
// route declares that list (declareLocale404s) from the very paths its getStaticPaths returns, so the
// rename and the route read one discovery (lib/locale-editions.mjs). No list ⇒ nothing moves. The
// hook never walks the output directory looking for things called 404.
// 🩸 tile#157 review: the first version took "two segments, the second one 404" as the rule, so a
// one-language site's own `manual/404.md` (/manual/404/) lost its directory index and became a
// fallback document. A segment is a locale because the site declared it, never because of its shape.
// A one-language site declares nothing, so its output is byte-identical to a build without this hook
// (not-found-locale.test.mjs builds the same fixtures with the feature taken out and compares every
// file).
//
// WHY a global: the route runs inside Astro's bundled SSR build and this hook inside the config's own
// module graph — two copies of this file, one process. A `Symbol.for` key is the one thing both
// copies resolve to the same slot; `astro:build:start` clears it so a second build in the same
// process cannot inherit the first one's list.
import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DECLARED = Symbol.for('sitetile.locale-404.declared');

/** Called by pages/[...loc]/404.astro's getStaticPaths: the url-locales it builds a 404 for. */
export function declareLocale404s(urlLocales) {
  globalThis[DECLARED] = [...(urlLocales || [])].map(String);
}

/** What this build's 404 route declared, or null when it never ran (cleared at build:start). */
export function declaredLocale404s() {
  return Array.isArray(globalThis[DECLARED]) ? [...globalThis[DECLARED]] : null;
}

/** `zh-tw/404/`, `/zh-tw/404`, `zh-tw/404` → `zh-tw`; anything else (root `404`, deeper paths) → null. */
export function locale404Segment(pathname) {
  const m = /^\/?([^/]+)\/404\/?$/.exec(String(pathname || ''));
  return m ? m[1] : null;
}

/**
 * The `{ from, to }` renames a build's page list asks for — relative to the output directory — for
 * the declared `locales` (url form) only. No list, or an empty one ⇒ none.
 */
export function locale404Renames(pages, locales) {
  const declared = new Set(locales || []);
  const out = [];
  if (!declared.size) return out;
  for (const p of pages || []) {
    const seg = locale404Segment(p && p.pathname);
    if (seg && declared.has(seg) && !out.some((r) => r.seg === seg)) out.push({ seg, from: join(seg, '404', 'index.html'), to: join(seg, '404.html') });
  }
  return out;
}

/**
 * Perform the renames inside `distDir`. Returns the list actually moved (relative `to` paths).
 * A `from` that does not exist is skipped (Astro reported a route it did not write — nothing to do);
 * the emptied `<seg>/404/` directory is removed so no stray folder shadows the file.
 */
export function relocateLocale404s(distDir, pages, locales) {
  const moved = [];
  for (const { from, to } of locale404Renames(pages, locales)) {
    const src = join(distDir, from);
    if (!existsSync(src)) continue;
    const dst = join(distDir, to);
    if (existsSync(dst)) throw new Error(`locale 404: both ${from} and ${to} exist in the build output — refusing to overwrite`);
    renameSync(src, dst);
    const dir = join(distDir, from, '..');
    if (readdirSync(dir).length === 0) rmdirSync(dir);
    moved.push(to);
  }
  return moved;
}

/** Astro integration: runs after the static output is written, with the route list Astro built. */
export function locale404Pages() {
  return {
    name: 'sitetile-locale-404',
    hooks: {
      'astro:build:start': () => { delete globalThis[DECLARED]; },
      'astro:build:done': ({ dir, pages }) => { relocateLocale404s(fileURLToPath(dir), pages, declaredLocale404s()); },
    },
  };
}
