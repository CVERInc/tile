// @tile/build — the page-generation half of a site build, in public.
//
// buildSite() is the whole of how a page is produced: collect the IR into the `site_pages` shape,
// stage it into the renderer, run `astro build`, put the renderer back. Everything a PLATFORM does
// around that — uploading, stamping, merging redirects, rewriting canonical hosts, emitting an API
// worker — is deployment, belongs to whoever runs the deployment, and is not here. See README.

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { collectPages } from './mkpages.mjs';
import { stageSite } from './stage.mjs';

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

/** Where the renderer lives inside an engine checkout. One string, one place to change it. */
export const RENDERER_SUBPATH = 'packages/sitetile/astro';

/**
 * Build one site's IR into static HTML with the public renderer and nothing else.
 *
 * @param {object} o
 * @param {string} o.irDir            the site's IR directory (holds home.md, _site.md, posts/…)
 * @param {string} o.engineDir        a checkout of this engine
 * @param {string} o.outDir           where the built site goes (created by astro)
 * @param {string} [o.siteId='']      🔴 EMPTY BY DEFAULT. The layout emits its ask-me bubble — a
 *                                    script fetched from a platform, calling that platform — only
 *                                    when a site id is set. A build that quietly phoned home would
 *                                    be a strange thing to hand somebody who just left.
 * @param {string} [o.siteUrl='']     the site's own origin, so canonical/og:url are the site's own.
 *                                    Left empty the renderer falls back to https://example.com,
 *                                    which is obviously wrong rather than quietly somebody else's.
 * @param {boolean} [o.includePosts]  treat `posts(-|$)/` as pages too (rarely what you want)
 * @param {string} [o.themeFile]      the site's compiled theme.css; required if its IR declares one
 * @param {string} [o.assetsDir]      the site's media, overlaid onto the renderer's public/
 * @param {string} [o.blogDir]        the site's posts; defaults to <irDir>/posts when that exists
 * @param {string} [o.pagetileDir]    the site's books (*.book.md)
 * @param {string} [o.npxBin='npx']   the runner for `astro build` (a seam for tests)
 * @returns {Promise<{code: number, outDir: string, pageCount: number}>}
 *
 * The renderer is ALWAYS restored — on success, on a failed build, and on a throw.
 */
export async function buildSite({
  irDir,
  engineDir,
  outDir,
  siteId = '',
  siteUrl = '',
  includePosts = false,
  themeFile,
  assetsDir,
  blogDir,
  pagetileDir,
  npxBin = 'npx',
} = {}) {
  if (!irDir) throw new Error('buildSite: irDir is required');
  if (!engineDir) throw new Error('buildSite: engineDir is required');
  if (!outDir) throw new Error('buildSite: outDir is required');

  const astroDir = path.resolve(engineDir, RENDERER_SUBPATH);
  if (!(await exists(path.join(astroDir, 'package.json')))) {
    throw new Error(`buildSite: not an engine checkout — ${astroDir} has no package.json`);
  }
  if (!(await exists(path.join(astroDir, 'node_modules')))) {
    throw new Error(`buildSite: the renderer's dependencies are not installed. Run:\n`
      + `      (cd ${astroDir} && npm install)`);
  }

  // 🔴 astro resolves --outDir against ITS OWN cwd, which is the renderer, not yours. Absolutise
  // here or a caller's relative "dist" lands inside the engine checkout.
  const absOut = path.resolve(outDir);

  const pages = collectPages(irDir, { includePosts });
  const defaultBlog = path.join(irDir, 'posts');
  const blog = blogDir ?? (!includePosts && await exists(defaultBlog) ? defaultBlog : undefined);

  const { restore } = await stageSite({
    astroDir, pages, assetsDir, blogDir: blog, pagetileDir, themeFile,
  });

  let code = 1;
  try {
    code = await new Promise((resolve) => {
      const child = spawn(npxBin, ['astro', 'build', '--outDir', absOut], {
        cwd: astroDir,
        stdio: 'inherit',
        env: { ...process.env, SITE_ID: siteId, SITE_URL: siteUrl },
      });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
  } finally {
    await restore();
  }

  return { code, outDir: absOut, pageCount: pages.length };
}

export { collectPages } from './mkpages.mjs';
export { stageSite, safePagePath, themeNameFromPages, THEME_NAME_PATTERN } from './stage.mjs';
