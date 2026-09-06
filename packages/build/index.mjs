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
 * @param {AbortSignal} [o.signal]    unwind the build: the running `astro build` is stopped, the
 *                                    renderer is put back, and this rejects with an AbortError.
 *                                    🔴 It does NOT exit and installs NO process-level handler —
 *                                    the program owns its own signals, and `cli.mjs` is the program
 *                                    that turns Ctrl-C into one of these.
 * @param {number} [o.killGraceMs=5000]  how long an aborted `astro build` gets after SIGTERM before
 *                                    it is SIGKILLed. It never gets to outlive this call.
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
  signal,
  killGraceMs = 5000,
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

  const abortError = () => Object.assign(
    new Error('buildSite: aborted — the build was stopped and the renderer has been put back.'),
    { name: 'AbortError', code: 'ABORT_ERR' },
  );

  const { restore } = await stageSite({
    astroDir, pages, assetsDir, blogDir: blog, pagetileDir, themeFile, signal,
  });

  // 🩸 AN ABORTED BUILD MUST TAKE THE `astro build` WITH IT, and the reason is the one line
  // stage.mjs exists for. `docker stop` sends SIGTERM to PID 1 only; `kill -INT <pid>` reaches one
  // process. Neither is a process group, so the child survived its parent — and restore had already
  // put the renderer's OWN content/ back underneath it. Measured 2026-09-07: the CLI reported 130
  // and left, and three seconds later the orphan wrote the RENDERER'S demo pages into the site
  // owner's --outDir, under the owner's domain, with nothing saying so. The exact outcome the whole
  // stash mechanism is here to prevent, reached through its own signal path.
  //
  // 🩸 And the lock went with it: restore() removes `.tile-build-lock` (stage.mjs), so for those
  // three seconds a build was running with no lock held and any second build could have taken the
  // renderer out from under it. "One build at a time" was broken by the thing meant to unwind one.
  let child = null;
  let killTimer = null;
  const signalChild = (sig) => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    try {
      // 🔴 The GROUP, not the process. `npx` execs `astro`, which spawns more; killing only the
      // first of them is how an orphan is made. The child leads its own group (`detached` below)
      // precisely so this one call reaches all of it.
      if (process.platform === 'win32') child.kill(sig);
      else process.kill(-child.pid, sig);
    } catch (err) {
      if (err.code !== 'ESRCH') throw err;   // already gone is the outcome being asked for
    }
  };
  const onAbort = () => {
    signalChild('SIGTERM');
    // …and it does not get to ignore that. A grace, and then the one signal nothing can catch.
    killTimer = setTimeout(() => signalChild('SIGKILL'), killGraceMs);
    killTimer.unref?.();
  };

  let code = 1;
  try {
    // Aborted between staging and spawning: there is nothing to interrupt, so do not start one.
    if (signal?.aborted) throw abortError();
    signal?.addEventListener('abort', onAbort, { once: true });
    code = await new Promise((resolve) => {
      child = spawn(npxBin, ['astro', 'build', '--outDir', absOut], {
        cwd: astroDir,
        stdio: 'inherit',
        detached: true,
        env: { ...process.env, SITE_ID: siteId, SITE_URL: siteUrl },
      });
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    clearTimeout(killTimer);
    // 🔴 A last sweep of the group before anything is put back: the child's own `exit` says nothing
    // about what IT started, and one surviving grandchild is the whole defect.
    if (signal?.aborted && child?.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group is empty, which is the point */ }
    }
    // 🔴 ORDER. restore() is what releases the lock, and it runs only after the `exit` above — so
    // the renderer is put back with nothing left running in it, and the lock outlives the child
    // rather than the other way round.
    await restore();
  }

  if (signal?.aborted) throw abortError();
  return { code, outDir: absOut, pageCount: pages.length };
}

export { collectPages } from './mkpages.mjs';
export { stageSite, safePagePath, themeNameFromPages, THEME_NAME_PATTERN } from './stage.mjs';
