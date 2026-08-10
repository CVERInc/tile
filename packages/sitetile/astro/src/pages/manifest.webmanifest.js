// REEF with PWA — the web app manifest, built from the site's own frontmatter (brand / theme /
// description) via the shared @pwa model. Emitted for every build (harmless static file); the
// layout only <link>s it when a site opts in with `packages: pwa`. Mirrors rss.xml.js / the other
// endpoint routes: read the site meta from the content glob, return a Response.
import { siteMeta } from '../lib/blog.mjs';
import { manifestJson } from '@pwa';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  return new Response(manifestJson(meta), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}
