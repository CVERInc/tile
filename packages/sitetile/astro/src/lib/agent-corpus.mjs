// REEF with Site — the glob-carrying seam between this build and lib/agent-artifacts.mjs.
//
// Everything with a RULE in it lives in agent-artifacts.mjs, which a plain `node --test` can
// import. This file holds only what a test cannot execute: the `import.meta.glob` calls (a literal
// Vite needs), the resolution of a route set from the same globs the routers read, and the one
// filesystem look at the site's own assets. The five endpoints under pages/ import it and render.
//
// The route set is DERIVED, not guessed: content page URLs come from lib/sitemap.mjs's contentUrls
// (the sitemap's own derivation, applied one file at a time so each URL keeps the file it came
// from), and post URLs come from postUrl() — the same builder pages/[...path].astro routes them
// with. A markdown asset can therefore never claim a page this build did not emit, which is the
// property the worker mapping rests on.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { deriveDescription, isSiteFile, parseSite } from '@sitetile';
import {
  allPosts,
  blogBase,
  blogInstalled,
  listedPosts,
  localeBlogCorpora,
  postUrl,
  siteMeta,
  toPath,
} from './blog.mjs';
import { canonicalPath, contentUrls } from './sitemap.mjs';
import {
  agentBundle,
  agentGate,
  assertNoAssetCollision,
  pageDoc,
  postDoc,
  publicDocs,
} from './agent-artifacts.mjs';

export const gate = agentGate(typeof process !== 'undefined' ? process.env : {});

// The site's own assets are overlaid into Astro's publicDir before the build, and publicDir
// defaults to <root>/public with root defaulting to the working directory — the same resolution
// Astro's own public-file conflict check uses.
const ASSETS_DIR = join(typeof process !== 'undefined' ? process.cwd() : '.', 'public');
const assetExists = (rel) => {
  try { return existsSync(join(ASSETS_DIR, rel)); } catch { return false; }
};

function buildCorpus() {
  const contentGlob = import.meta.glob('../../content/**/*.md', { query: '?raw', import: 'default', eager: true });
  const meta = siteMeta(import.meta.glob('../../content/*.md', { query: '?raw', import: 'default', eager: true }));
  const allPostsIn = allPosts(import.meta.glob('../../blog/*.md', { query: '?raw', import: 'default', eager: true }));
  const listed = listedPosts(allPostsIn, meta);
  const localeCorpora = localeBlogCorpora(
    contentGlob,
    import.meta.glob('../../blog/*/*.md', { query: '?raw', import: 'default', eager: true }),
    meta,
    allPostsIn,
  );
  // Root-mounted blog: `/` is the post list, and pages/[...path].astro deliberately does not emit
  // the home content page there. Same guard, so no markdown twin claims a page nobody serves.
  const rootMount = blogInstalled(meta, allPostsIn) && blogBase(meta) === '';

  const pages = [];
  for (const [path, raw] of Object.entries(contentGlob)) {
    const urls = contentUrls({ [path]: raw }, meta, isSiteFile);
    if (!urls.length) continue;
    if (rootMount && urls[0] === '/') continue;
    const site = parseSite(raw);
    pages.push({
      path: urls[0],
      title: String(site.meta.title || '').trim(),
      summary: String(site.meta.description || '').trim() || deriveDescription(site.sections),
      sections: site.sections,
    });
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));

  const posts = [];
  for (const post of listed) posts.push({ path: canonicalPath(postUrl(post, meta)), post });
  for (const corpus of localeCorpora) {
    for (const post of corpus.listed) posts.push({ path: canonicalPath(postUrl(post, corpus.meta)), post });
  }

  const home = pages.find((p) => p.path === '/');
  const docs = [];
  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.path)) continue;
    seen.add(page.path);
    docs.push(pageDoc(page));
  }
  for (const entry of posts) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    docs.push(postDoc(entry));
  }

  return {
    // Same site-name chain SiteLayout's ogSiteName resolves (site-level keys before any page's own
    // title), with the home page standing in for its last resort.
    site: {
      name: String(meta.title || meta.brand || meta['footer-brand'] || (home && home.title) || '').trim(),
      description: String(meta.description || '').trim() || String((home && home.summary) || ''),
      origin: '',
    },
    docs,
  };
}

export const corpus = gate.generate ? buildCorpus() : { site: {}, docs: [] };

// Fail closed BEFORE anything is written: a generated artifact must never silently clobber a file
// the owner put in their own assets.
if (gate.generate) assertNoAssetCollision(corpus, assetExists);

/** getStaticPaths input for the per-route markdown endpoint: exactly the public static routes this
 *  build emitted a document for. Empty when the gate is off, so the route emits nothing. */
export const markdownRoutes = publicDocs(corpus).map((doc) => ({
  params: { agentmd: toPath(doc.path) },
  props: { path: doc.path },
}));

let cached = null;

/** Every artifact this build emits, resolved once per origin. `site` is Astro's configured site
 *  URL, the same value rss.xml.js and sitemap.xml.js read from their endpoint context. */
export function agentArtifacts(site) {
  const origin = site ? String(site).replace(/\/$/, '') : '';
  if (!cached || cached.origin !== origin) {
    cached = { origin, ...agentBundle(corpus, { gate, origin, assetExists }) };
  }
  return cached;
}
