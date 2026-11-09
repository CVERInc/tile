// Guard: ONE site name per site, on every route, and the chain says which key it came from.
//   run: node packages/sitetile/site-name-source.test.mjs   (wired into scripts/test.sh by its glob)
//
// 🩸 Measured on a downstream platform's verify step: a site config with `title: Untitled site` (a
// seeded placeholder) and `site-title: Actual Name`. Content pages named the site "Untitled site"
// (the catch-all overwrites the `site-title` stash with the config's own `title`), while blog
// posts and indexes, archives, search and the 404 — which receive the site config as-is — named it
// "Actual Name". One site, two names, chosen by route.
//
// The decision follows the grammar: `site-title` is not a site-layer key (it is absent from
// SITE_LAYER_KEYS and from the platform's site-layer grammar); it is the catch-all's RESERVED
// per-page stash ("Reserved key, not authorable", pages/[...path].astro). So in `_site.md` it is
// ignored on every route: loadSite drops it and says so once in the build log.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const core = await import('./site-core.js');
const { loadSite } = await import('./astro/src/lib/blog.mjs');

const SITE_MD = '---\nsitetile-page: _site\ntitle: Untitled site\nsite-title: Actual Name\nlang: en-US\n---\n';
const PAGE_MD = { title: 'About us', 'sitetile-page': 'page' };

/** The meta each route shape hands SiteLayout, built the way the routes build it. */
function routeMetas(siteMd) {
  const cfg = loadSite({ '../../content/_site.md': siteMd }, 'about');
  // pages/[...path].astro: `{ ...siteConfig, ...page, 'site-title': siteConfig.title || '' }`
  const content = { ...cfg, ...PAGE_MD, 'site-title': cfg.title || '' };
  // blog/archive/search/404: siteMeta() → the config itself
  const blog = { ...cfg };
  return { cfg, content, blog };
}

test('one _site.md, one site name: a content page and a blog index agree (og:site_name and JSON-LD)', () => {
  const warn = console.warn; const said = []; console.warn = (m) => said.push(String(m));
  let metas;
  try { metas = routeMetas(SITE_MD); } finally { console.warn = warn; }
  const { content, blog } = metas;
  // SiteLayout: og:site_name = siteName(meta, headerBrand); JSON-LD = routeSiteName(meta, headerBrand)
  // SiteLayout's own fallback: headerBrand = brand → meta.title.
  const hb = (m) => String(m.brand || m.title || '').trim();
  const og = [core.siteName(content, hb(content)), core.siteName(blog, hb(blog))];
  // JSON-LD is og:site_name (tile#279 r2): SiteLayout's `jsonLdSiteName = ogSiteName`.
  const ld = og;
  assert.equal(og[0], og[1], `og:site_name differs by route: ${JSON.stringify(og)}`);
  assert.equal(ld[0], ld[1], `JSON-LD name differs by route: ${JSON.stringify(ld)}`);
  assert.equal(og[0], 'Untitled site', 'site-title in _site.md is ignored, so the placeholder is the only name left');
  assert.equal(metas.cfg['site-title'], 'Untitled site', 'loadSite drops the authored reserved key and stamps the config\'s own title as the stash');
  assert.ok(said.some((m) => /site-title.*content\/_site\.md.*IGNORED/.test(m)), `build log names it: ${JSON.stringify(said)}`);
});

test('tile#279 r2: the reviewer\'s _site.md (real title + brand + reserved site-title) — one name on every route shape', () => {
  const warn = console.warn; console.warn = () => {};
  let metas;
  try { metas = routeMetas('---\nsitetile-page: _site\ntitle: Atlas Observatory\nbrand: Atlas\nsite-title: Atlas Observatory\npackages: blog\n---\n'); }
  finally { console.warn = warn; }
  const hb = (m) => String(m.brand || m.title || '').trim();
  const post = { ...metas.blog, description: 'A post', 'og-type': 'article' };          // PostView headMeta
  const chooser = { ...metas.cfg, title: 'Welcome', 'sitetile-page': 'home' };          // editions: { ...cfg, ...home }
  const names = [metas.content, metas.blog, post, chooser].map((m) => core.siteName(m, hb(m)));
  assert.deepEqual(names, Array(4).fill('Atlas Observatory'));
});

test('a _site.md without site-title loads exactly as before (no key dropped, nothing logged)', () => {
  const warn = console.warn; const said = []; console.warn = (m) => said.push(String(m));
  try {
    const cfg = loadSite({ '../../content/_site.md': '---\nsitetile-page: _site\ntitle: Atlas Observatory\nbrand: Atlas\n---\n' }, 'about');
    assert.equal(cfg.title, 'Atlas Observatory');
    assert.equal(cfg.brand, 'Atlas');
  } finally { console.warn = warn; }
  assert.deepEqual(said.filter((m) => /site-title/.test(m)), []);
});

test('siteNameSource / routeSiteNameSource: { name, key } for every rung of the one chain', () => {
  const { siteNameSource, routeSiteNameSource, configSiteNameSource } = core;
  const P = 'Untitled site';
  const rows = [
    // [fn, meta, fallback, name, key]
    [siteNameSource, { 'site-title': 'Atlas Observatory', brand: 'Atlas' }, 'f', 'Atlas Observatory', 'site-title'],
    [siteNameSource, { 'site-title': P, brand: 'Atlas' }, 'f', 'Atlas', 'brand'],
    [siteNameSource, { 'site-title': P, 'footer-brand': 'Atlas Footer' }, 'f', 'Atlas Footer', 'footer-brand'],
    [siteNameSource, { 'site-title': P }, 'f', P, 'placeholder'],
    [siteNameSource, {}, 'Legacy', 'Legacy', 'fallback'],
    [siteNameSource, {}, '', '', 'fallback'],
    [routeSiteNameSource, { title: 'Atlas Observatory', brand: 'Atlas' }, 'f', 'Atlas Observatory', 'title'],
    [routeSiteNameSource, { title: P, brand: 'Atlas' }, 'f', 'Atlas', 'brand'],
    [routeSiteNameSource, { title: P }, 'f', P, 'placeholder'],
    [routeSiteNameSource, { 'site-title': 'Stash', title: 'About us' }, 'f', 'Stash', 'site-title'],
    // A raw site config, as a platform reads `_site.md`: the reserved key is ignored, as the build ignores it.
    [configSiteNameSource, { title: P, 'site-title': 'Actual Name' }, '', P, 'placeholder'],
    [configSiteNameSource, { title: P, 'site-title': 'Actual Name', brand: 'Atlas' }, '', 'Atlas', 'brand'],
    [configSiteNameSource, { title: 'Atlas Observatory' }, '', 'Atlas Observatory', 'title'],
  ];
  for (const [fn, meta, fallback, name, key] of rows) {
    assert.deepEqual(fn(meta, fallback), { name, key }, `${fn.name}(${JSON.stringify(meta)})`);
  }
  // The value-only functions are the same chain.
  for (const [fn, meta, fallback, name] of rows) {
    if (fn === siteNameSource) assert.equal(core.siteName(meta, fallback), name);
    if (fn === routeSiteNameSource) assert.equal(core.routeSiteName(meta, fallback), name);
  }
});
