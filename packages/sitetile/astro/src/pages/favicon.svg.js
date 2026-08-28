// REEF with Site — /favicon.svg, emitted for EVERY build (like rss.xml / manifest.webmanifest:
// read the site meta from the content glob, return a Response). The badge itself is drawn by the
// pure model, packages/sitetile/icon-core.mjs (aliased @icons) — this file is only the route.
//
// SVG is the format a modern browser prefers for a tab icon, and the only one of the three that
// can carry ANY script's initial, because the browser draws the text with its own fonts.
//
// A site that wants its own file here just puts favicon.svg in public/: Astro SKIPS a route whose
// name a public/ file already claims (it says so in the build log), so a hand-placed icon wins
// without anyone wiring an opt-out.
import { siteMeta } from '../lib/blog.mjs';
import { badgeSvg } from '@icons';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  return new Response(badgeSvg(meta), {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
}
