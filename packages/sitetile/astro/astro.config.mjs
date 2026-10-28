import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

// sitetile's Astro renderer. Static output, zero UNACCOUNTED client JS (native View Transitions are
// pure CSS; the only client JS is the self-gating PE set the smoke's allowlist names — see SiteLayout). The model layer (site-core.js) is aliased as `@sitetile` so the
// per-type components share ONE source of truth with the reference renderer + the test suite.
import { reefComponentsLayer } from './reef-components-layer.mjs';
// The build owns dist/_headers: the site's own rules first, then `/*.svg` as an attachment.
import { svgAttachmentHeaders } from './svg-attachment-headers.mjs';
// One 404.html per declared locale (CVERInc/reef#2112): `<loc>/404/index.html` → `<loc>/404.html`,
// because Cloudflare Pages reads a locale's 404 only at that path and Astro only writes the ROOT
// 404 as a bare file. Here, not in packages/build: production runs a plain `npx astro build`.
import { locale404Pages } from './locale-404.mjs';
// reef#2554: noindex is decided over the files the build wrote — each page's robots meta and
// sitemap.xml — after locale-404 has put every file where it will be served.
import { noindexPass } from './noindex-pass.mjs';

export default defineConfig({
  integrations: [svgAttachmentHeaders(), locale404Pages(), noindexPass()],
  // Absolute-URL base for the site being rendered. Lingo emits ABSOLUTE hreflang/canonical
  // from this (a real <head> uses absolute URLs). Per-build overridable via SITE_URL so the ONE
  // renderer stays general across sites; the fallback is a placeholder, never a real host — a
  // build that forgets SITE_URL should be obviously wrong, not quietly somebody else's domain.
  site: process.env.SITE_URL || 'https://example.com',
  output: 'static',
  compressHTML: true,
  vite: {
    plugins: [reefComponentsLayer()],
    resolve: {
      alias: {
        '@sitetile': fileURLToPath(new URL('../site-core.js', import.meta.url)),
        // REEF with PWA — the shared, framework-agnostic manifest model (root packages/pwa,
        // also consumed by cardtile). Same out-of-dir alias pattern as @sitetile.
        '@pwa': fileURLToPath(new URL('../../pwa/pwa-core.mjs', import.meta.url)),
        // The site icon set (favicon / apple-touch-icon) — pure model, zero deps, shared by the
        // three icon routes AND by SiteLayout's <head>, so the files and the links that name them
        // cannot disagree. Same out-of-dir alias pattern as @sitetile / @pwa.
        '@icons': fileURLToPath(new URL('../icon-core.mjs', import.meta.url)),
      },
    },
  },
});
