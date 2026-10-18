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
// WHICH files: only the routes Astro itself reports in `pages` whose path is `<one segment>/404`. The
// hook never walks the output directory looking for things called 404 — an owner's own `/zh-tw/404/`
// content page would be a route Astro reports too, and it is in the same position: a 404 page at that
// locale, which Pages can only read at `<loc>/404.html`. A one-language site builds no such route, so
// the hook finds nothing and the output is byte-identical to a build without it (proved by
// not-found-locale.test.mjs and the smoke's single-locale fixture).
import { existsSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `zh-tw/404/`, `/zh-tw/404`, `zh-tw/404` → `zh-tw`; anything else (root `404`, deeper paths) → null. */
export function locale404Segment(pathname) {
  const m = /^\/?([^/]+)\/404\/?$/.exec(String(pathname || ''));
  return m ? m[1] : null;
}

/** The `{ from, to }` renames a build's page list asks for — relative to the output directory. */
export function locale404Renames(pages) {
  const out = [];
  for (const p of pages || []) {
    const seg = locale404Segment(p && p.pathname);
    if (seg && !out.some((r) => r.seg === seg)) out.push({ seg, from: join(seg, '404', 'index.html'), to: join(seg, '404.html') });
  }
  return out;
}

/**
 * Perform the renames inside `distDir`. Returns the list actually moved (relative `to` paths).
 * A `from` that does not exist is skipped (Astro reported a route it did not write — nothing to do);
 * the emptied `<seg>/404/` directory is removed so no stray folder shadows the file.
 */
export function relocateLocale404s(distDir, pages) {
  const moved = [];
  for (const { from, to } of locale404Renames(pages)) {
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
      'astro:build:done': ({ dir, pages }) => { relocateLocale404s(fileURLToPath(dir), pages); },
    },
  };
}
