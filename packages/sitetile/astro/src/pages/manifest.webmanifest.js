// REEF with PWA — the web app manifest, built from the site's own frontmatter (brand / theme /
// description) via the shared @pwa model. Emitted for every build (harmless static file); the
// layout only <link>s it when a site opts in with `packages: pwa`. Mirrors rss.xml.js / the other
// endpoint routes: read the site meta from the content glob, return a Response.
//
// Its icons are only files this build ships (pwa-core's manifestIcons): gen-icons.sh output found
// in public/, else the owner's `favicon:` PNG at its real size, else none.
import { siteMeta } from '../lib/blog.mjs';
import { manifestJson, manifestIcons, PWA_ICON_FILES } from '@pwa';
import { ownerPng } from '@icons';
import { readPublic, publicHas } from '../lib/public-file.mjs';
import { safeSrc } from '../../../site-core.js';

const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));

export function GET() {
  const icons = manifestIcons(PWA_ICON_FILES.filter(publicHas), ownerPng(meta, readPublic, safeSrc));
  return new Response(manifestJson(meta, { icons }), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}
