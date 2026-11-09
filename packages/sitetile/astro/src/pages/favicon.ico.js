// REEF with Site — /favicon.ico, emitted for EVERY build.
//
// 🩸 THE PATH THAT WAS 404ing. Every browser requests /favicon.ico on its own, with no <link> to
// tell it to, and so do crawlers and link-preview bots; three live sites built by this renderer
// answered 404 to all of them (measured 2026-08-28). This route is why they cannot again — and
// that includes a site that set `favicon:`, which used to get no file here at all.
//
// A site whose `favicon:` names a PNG in public/ gets that PNG here, inside an ICO container and
// not resampled (icon-core's faviconIcoFile). Every other site gets one 32×32 badge PNG in the same
// container — see encodeIco in the model for why PNG-in-ICO rather than a legacy BMP. A
// hand-placed public/favicon.ico wins the path (Astro skips this route).
import { siteMeta } from '../lib/blog.mjs';
import { faviconIcoFile } from '@icons';
import { readPublic } from '../lib/public-file.mjs';

// The layout's own src gate: a mark it would refuse to link keeps the badge (icon-core's linkedMark).
import { safeSrc } from '../../../site-core.js';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  return new Response(faviconIcoFile(meta, readPublic, safeSrc), {
    headers: { 'Content-Type': 'image/x-icon' },
  });
}
