// REEF with Site — /favicon.ico, emitted for every build whose owner has not set `favicon:`.
//
// 🩸 THE PATH THAT WAS 404ing. Every browser requests /favicon.ico on its own, with no <link> to
// tell it to, and so do crawlers and link-preview bots; three live sites built by this renderer
// answered 404 to all of them (measured 2026-08-28). This route is why they cannot again.
//
// One 32×32 PNG inside an ICO container — see encodeIco in the model for why PNG-in-ICO rather
// than a legacy BMP. A hand-placed public/favicon.ico wins the path (Astro skips this route).
import { siteMeta } from '../lib/blog.mjs';
import { faviconIco, badgePaths, ICON_PATHS } from '@icons';

// The layout's own src gate: a mark it would refuse to link keeps this file (icon-core's linkedMark).
import { safeSrc } from '../../../site-core.js';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  // An owner who set `favicon:` gets no generated file here (icon-core's badgePaths). An endpoint
  // response with no body is a file Astro does not write, so the path is simply absent and the
  // browser uses the page's <link rel=icon>, which names the owner's mark.
  if (!badgePaths(meta, null, safeSrc).has(ICON_PATHS.ico)) return new Response(null, { status: 404 });
  return new Response(faviconIco(meta), {
    headers: { 'Content-Type': 'image/x-icon' },
  });
}
