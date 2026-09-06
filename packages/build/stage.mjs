// stage — put ONE site's IR into the renderer's tree, and put the renderer back afterwards.
//
// The renderer (packages/sitetile/astro) is a general machine that ships its own content/, blog/,
// pagetile/ and public/ as worked examples. Building a site means those four are moved aside, the
// site's own material is written in their place, `astro build` runs, and every one of them is moved
// back — including when the build throws. That unconditional restore is the whole reason this is a
// module and not four lines at a call site: a renderer left holding somebody's pages is a renderer
// that will put them inside the NEXT site built here.
//
// 🔴 blog/ and pagetile/ are EMPTIED even for a site that has neither. Left in place, the
// renderer's own demo posts and demo book build into your site, under your domain, with nothing
// saying so.

import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

/**
 * Reduce ONE page path to something safe to be a filename, keeping the slashes.
 *
 * 🔴 THIS is where a path becomes a filename, and therefore the only place sanitising belongs.
 * Each segment keeps Unicode letters, digits, `_` and `-`; everything else — spaces, punctuation,
 * and the `.` of `..` — collapses to `-`, so traversal cannot survive. Empty segments (from `//`,
 * or a leading slash) are dropped, and a path that sanitises away to nothing becomes `home`.
 *
 * Unicode letters are KEPT on purpose: CJK slugs are live URLs on real sites, and an ASCII-only
 * rule would silently rewrite a working address into a row of dashes.
 *
 * See README §"Three sanitisers, one rule" for the comparison against the two implementations this
 * one replaces.
 */
export function safePagePath(pagePath) {
  const segs = String(pagePath).split('/').map((s) => s.replace(/[^\p{L}\p{N}_-]/gu, '-')).filter(Boolean);
  return segs.length ? segs.join('/') : 'home';
}

// A theme name is also a FILENAME, and it arrives from site content (_site.md is writable through
// whatever authors the IR). `theme: ../../../../somewhere` would otherwise copy outside the
// renderer tree entirely. Letters, digits, dot, dash, underscore; 64 max; must not start with a dot.
export const THEME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Which skin does this site say it wears? The name comes from the IR itself — the `theme:` key,
 * in _site.md on the config-layer model or repeated per page on the older one; either is found
 * here, because the first page that carries the key wins.
 *
 * @returns {string} the declared name, or '' when the site declares none
 */
export function themeNameFromPages(pages) {
  const withTheme = pages.find((p) => /^theme:/m.test(p?.markdown || ''));
  const hit = (withTheme?.markdown || '').match(/^theme:\s*(\S+)\s*$/m);
  return hit ? hit[1] : '';
}

/**
 * Stage a site into the renderer, and hand back the way out.
 *
 * @param {object} o
 * @param {string} o.astroDir      the renderer: <engine>/packages/sitetile/astro
 * @param {{path: string, markdown: string}[]} o.pages   from collectPages()
 * @param {string} [o.assetsDir]   the site's media, overlaid onto public/
 * @param {string} [o.blogDir]     the site's posts, staged into blog/
 * @param {string} [o.pagetileDir] the site's books (*.book.md), staged into pagetile/
 * @param {string} [o.themeFile]   the site's compiled theme.css
 * @returns {Promise<{restore: () => Promise<void>, pageCount: number, themeName: string}>}
 *
 * 🔴 If this function throws, it has ALREADY restored. The caller owns `restore` only on success.
 */
export async function stageSite({ astroDir, pages, assetsDir, blogDir, pagetileDir, themeFile }) {
  if (!astroDir) throw new Error('stageSite: astroDir is required');
  if (!Array.isArray(pages)) throw new Error('stageSite: pages must be an array of {path, markdown}');
  for (const p of pages) {
    if (!p || typeof p.path !== 'string' || typeof p.markdown !== 'string') {
      throw new Error('stageSite: each page needs {path, markdown}');
    }
  }
  if (!(await exists(path.join(astroDir, 'package.json')))) {
    throw new Error(`stageSite: not a renderer directory — ${astroDir} has no package.json`);
  }

  const contentDir = path.join(astroDir, 'content');
  const blogBuildDir = path.join(astroDir, 'blog');
  const pagetileBuildDir = path.join(astroDir, 'pagetile');
  const publicDir = path.join(astroDir, 'public');
  const themesDir = path.join(astroDir, 'src/themes');

  // 🔴 The stash lives INSIDE the renderer, not in the system temp dir. Two reasons: a rename
  // across devices fails (EXDEV) and the temp dir is routinely on a different one; and none of the
  // renderer's globs are rooted here — they all name ../../content, ../../blog, ../themes — so a
  // directory sitting beside them is invisible to the build.
  const stash = await mkdtemp(path.join(astroDir, '.tile-build-stash-'));
  const stashed = new Set();   // moved aside, and owed back
  const touched = new Set();   // emptied or created by US, and therefore ours to undo
  let stagedTheme = null;
  let restored = false;

  async function takeOver(dir, name) {
    if (await exists(dir)) {
      await rename(dir, path.join(stash, name));
      stashed.add(name);
    }
    await mkdir(dir, { recursive: true });
    touched.add(name);
  }

  async function restore() {
    if (restored) return;
    restored = true;
    // A site's theme belongs to that site's repo, never to the renderer (the renderer ships only
    // the baseline skin). Staged in for the build, removed after — so a site's theme can never
    // accumulate here.
    if (stagedTheme) await rm(stagedTheme, { force: true });
    for (const [dir, name] of [[contentDir, 'content'], [publicDir, 'public'],
      [blogBuildDir, 'blog'], [pagetileBuildDir, 'pagetile']]) {
      // 🩸 `touched` IS THE POINT. The shell this came from removed blog/ and pagetile/
      // unconditionally in its EXIT trap, and the trap was armed before the staging began — so an
      // early exit (a `--blog dir not found`, three lines in) deleted the renderer's own blog/ and
      // pagetile/ and had no stash to put back. Measured here 2026-09-06, by the test that walks
      // the renderer before and after a throw. Undo only what this run actually did.
      if (!touched.has(name) && !stashed.has(name)) continue;
      await rm(dir, { recursive: true, force: true });
      if (stashed.has(name)) await rename(path.join(stash, name), dir);
      // content/ is the one directory the renderer cannot be left without, even if it arrived
      // without one: the renderer's globs name it.
      else if (name === 'content') await mkdir(dir, { recursive: true });
    }
    await rm(stash, { recursive: true, force: true });
  }

  try {
    await takeOver(contentDir, 'content');

    await takeOver(blogBuildDir, 'blog');
    if (blogDir) {
      if (!(await exists(blogDir))) throw new Error(`stageSite: blog dir not found: ${blogDir}`);
      await cp(blogDir, blogBuildDir, { recursive: true, force: true });
    }

    await takeOver(pagetileBuildDir, 'pagetile');
    if (pagetileDir) {
      if (!(await exists(pagetileDir))) throw new Error(`stageSite: pagetile dir not found: ${pagetileDir}`);
      await cp(pagetileDir, pagetileBuildDir, { recursive: true, force: true });
    }

    // ── the site's OWN theme, from the site's OWN repo ──────────────────────────────────────────
    const themeName = themeNameFromPages(pages);
    if (themeName && !THEME_NAME_PATTERN.test(themeName)) {
      throw new Error(`stageSite: this site's IR declares an unusable 'theme: ${themeName}'. `
        + 'A theme name is also a filename: letters, digits, dot, dash or underscore (max 64).');
    }
    // 🔴 The guard that matters. A site declaring `theme: <name>` whose CSS is not staged still
    // BUILDS — the renderer just wears the baseline skin and reports success. Measured on a real
    // site: 68.9KB of stylesheet down to 32.5KB, zero errors, and a naked site ready to deploy.
    if (themeName && !themeFile) {
      throw new Error(`stageSite: this site's IR declares 'theme: ${themeName}' but no themeFile was given. `
        + 'A theme lives in the SITE\'s repo, not in the renderer — pass it, or the build silently '
        + 'succeeds wearing only the baseline skin.');
    }
    if (themeFile) {
      if (!(await exists(themeFile))) throw new Error(`stageSite: theme file not found: ${themeFile}`);
      if (!themeName) throw new Error('stageSite: a themeFile was given but the IR declares no \'theme:\' — '
        + 'a site must say which skin it wears');
      await mkdir(themesDir, { recursive: true });
      const target = path.join(themesDir, `${themeName}.css`);
      // 🔴 Check BEFORE assigning stagedTheme: restore deletes whatever that variable names, so
      // setting it first and then bailing here would make the guard delete the renderer's OWN file.
      if (await exists(target)) {
        throw new Error(`stageSite: the renderer already has a theme named '${themeName}' (${target}). `
          + 'Refusing to shadow it — a site theme and a shipped theme must never collide.');
      }
      await cp(themeFile, target, { force: true });
      stagedTheme = target;   // only now is it OURS to remove
    }

    // ── the site's media, overlaid onto the renderer's public/ ──────────────────────────────────
    if (assetsDir) {
      if (!(await exists(assetsDir))) throw new Error(`stageSite: assets dir not found: ${assetsDir}`);
      // The renderer's public/ may not exist at all — every site brings its own media, so an absent
      // public/ is a normal state to be created rather than died on.
      await mkdir(publicDir, { recursive: true });
      // public/ is COPIED aside rather than moved: the site's media is an overlay onto whatever the
      // renderer ships there, not a replacement for it.
      await cp(publicDir, path.join(stash, 'public'), { recursive: true });
      stashed.add('public');
      touched.add('public');
      // 🩸 This overlay is a file-level REPLACE per path. A site shipping its own `_redirects`
      // therefore REPLACES the renderer's rather than merging with it. Merging is a deployment
      // concern and is deliberately not in this repo — see README §"What is not here".
      await cp(assetsDir, publicDir, { recursive: true, force: true });
    }

    // ── this site's IR pages into content/ ──────────────────────────────────────────────────────
    for (const p of pages) {
      const outPath = path.join(contentDir, `${safePagePath(p.path)}.md`);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, p.markdown);
    }

    return { restore, pageCount: pages.length, themeName };
  } catch (err) {
    await restore();
    throw err;
  }
}

// Exported for the tests and for anyone auditing what a staged tree looks like without staging one.
export const stagedDirNames = ['content', 'blog', 'pagetile', 'public'];

// A tiny helper the tests use to read a staged tree back. Kept here rather than duplicated in the
// suite so "what stage.mjs wrote" has one reader.
export async function listStaged(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await listStaged(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}
