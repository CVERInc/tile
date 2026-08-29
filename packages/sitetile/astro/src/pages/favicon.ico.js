// REEF with Site — /favicon.ico, emitted for EVERY build.
//
// 🩸 THE PATH THAT WAS 404ing. Every browser requests /favicon.ico on its own, with no <link> to
// tell it to, and so do crawlers and link-preview bots; three live sites built by this renderer
// answered 404 to all of them (measured 2026-08-28). This route is why they cannot again.
//
// One 32×32 PNG inside an ICO container — see encodeIco in the model for why PNG-in-ICO rather
// than a legacy BMP. A hand-placed public/favicon.ico wins the path (Astro skips this route).
import { siteMeta } from '../lib/blog.mjs';
import { faviconIco } from '@icons';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  return new Response(faviconIco(meta), {
    headers: { 'Content-Type': 'image/x-icon' },
  });
}
