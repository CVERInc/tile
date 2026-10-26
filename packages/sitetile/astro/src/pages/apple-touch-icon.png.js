// REEF with Site — /apple-touch-icon.png, emitted for EVERY build.
//
// iOS asks for this exact path when someone adds a page to their home screen, and it ignores SVG
// entirely: without a real PNG here, a site that has been added to a home screen shows a
// screenshot of itself as its icon. 180×180 is Apple's documented size; iOS downscales from it.
//
// OPAQUE and full-bleed on purpose: iOS masks its own rounded corners and composites transparency
// onto black, so an icon that rounded its own corners would wear black wedges.
//
// REEF with PWA's gen-icons.sh writes public/apple-touch-icon.png from a site's real mark; that
// file wins this path (Astro skips a route a public/ file already claims), so a PWA site keeps the
// icon it generated and every other site stops shipping nothing.
//
// A site whose `favicon:` names a PNG in public/ gets that PNG here, byte for byte, instead of the
// badge (icon-core's appleTouchFile), unless a public/apple-touch-icon.png exists: a file placed
// at the path wins it, `favicon:` or not (icon-core's PRECEDENCE note).
import { siteMeta } from '../lib/blog.mjs';
import { appleTouchFile } from '@icons';
import { readPublic } from '../lib/public-file.mjs';
import { safeSrc } from '../../../site-core.js';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  return new Response(appleTouchFile(meta, readPublic, safeSrc), {
    headers: { 'Content-Type': 'image/png' },
  });
}
