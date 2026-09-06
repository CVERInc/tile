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

// One spelling for the directory this module hides the renderer's own material in — it is named by
// `.gitignore`, by the leftover check below, and by the tests, and those three must not drift.
export const STASH_PREFIX = '.tile-build-stash-';

// The same, for the one-build-at-a-time lock. A DIRECTORY, because `mkdir` either creates it or
// says EEXIST and never both — which is the entire concurrency argument.
export const LOCK_NAME = '.tile-build-lock';

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
 * @param {AbortSignal} [o.signal] abort staging: the renderer is put back and this rejects with an
 *                                 AbortError. 🔴 It does NOT exit, and NOTHING here listens on the
 *                                 process's signals — see the note above `abortError`.
 * @returns {Promise<{restore: () => Promise<void>, pageCount: number, themeName: string}>}
 *
 * 🔴 If this function throws, it has ALREADY restored. The caller owns `restore` only on success.
 */
export async function stageSite({ astroDir, pages, assetsDir, blogDir, pagetileDir, themeFile, signal }) {
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

  // 🩸 A LIBRARY DOES NOT OWN THE HOST PROCESS'S SIGNALS. This function used to install
  // `SIGINT`/`SIGTERM` handlers on `process` the moment it was called, and those handlers ended in
  // `process.exit(130/143)`. Measured 2026-09-07 against a consumer that manages its own shutdown:
  // its own SIGTERM handler ran, started draining, and never finished — the process left with 143
  // where it had asked for 0, and its "drained cleanly" line was never printed. `import { stageSite }
  // from '@tile/build'` is an invitation in the README; taking over the caller's shutdown and then
  // killing it is not something an import may do.
  //
  // So: nothing here touches `process`. A caller that wants a signal to unwind a build passes an
  // AbortSignal and keeps its own handler, its own ordering and its own exit code — `cli.mjs` is the
  // program that does exactly that, and it is where the 130/143 lives.
  const abortError = () => Object.assign(
    new Error('stageSite: aborted — the renderer has been put back and nothing of this site is left in it.'),
    { name: 'AbortError', code: 'ABORT_ERR' },
  );
  // 🔴 Checked at the seams rather than mid-copy: an abort that landed inside a `cp` and started a
  // restore beside it is the race this is here to avoid. A long copy finishes, and THEN we unwind.
  const checkAborted = () => { if (signal?.aborted) throw abortError(); };
  checkAborted();

  const contentDir = path.join(astroDir, 'content');
  const blogBuildDir = path.join(astroDir, 'blog');
  const pagetileBuildDir = path.join(astroDir, 'pagetile');
  const publicDir = path.join(astroDir, 'public');
  const themesDir = path.join(astroDir, 'src/themes');

  const leftovers = async () =>
    (await readdir(astroDir)).filter((n) => n.startsWith(STASH_PREFIX)).map((n) => path.join(astroDir, n));

  // 🩸 ONE BUILD AT A TIME, and `mkdir` is the whole mechanism: it is atomic, so EEXIST IS the
  // answer. Two concurrent stageSites did not merely mix content — the second stashed what the
  // first had staged, and the renderer's own content/ was gone for good afterwards, with no line of
  // output saying so. Measured 2026-09-07, both in one process and across two.
  //
  // 🔴 The lock is taken BEFORE the leftover check below, and that order is the whole distinction:
  // a running build's stash and a dead build's stash look identical on disk. The lock is what says
  // which one you are looking at.
  const lock = path.join(astroDir, LOCK_NAME);
  try {
    await mkdir(lock);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const held = await leftovers();
    throw new Error(`stageSite: another build is already using this renderer (${lock} exists). `
      + 'One site at a time — a second would stash what the first just staged, and the renderer '
      + 'would not survive it. Wait for that build to finish; if nothing is running it was killed, '
      + `and ${held.length ? `its stash is ${held[0]} — put those directories back and remove both`
        : 'that directory is stale and can be removed'}.`);
  }

  // 🩸 A STASH THAT OUTLIVED ITS BUILD IS THE RENDERER WEARING SOMEBODY ELSE'S CLOTHES, and the
  // next build here would put that site's leftover pages inside YOURS. `.gitignore` hides the stash
  // from `git status`, and a site owner working from a tarball has no `git status` at all — so this
  // is the only place it can be noticed. Refusing rather than auto-restoring is deliberate: what is
  // in content/ right now may be a half-staged site, and only the person looking knows which of the
  // two is theirs.
  const orphans = await leftovers();
  if (orphans.length) {
    await rm(lock, { recursive: true, force: true });
    throw new Error('stageSite: a previous build here was killed and left its stash behind — '
      + `${orphans[0]}${orphans.length > 1 ? ` (and ${orphans.length - 1} more)` : ''}. `
      + `That directory holds the renderer's OWN ${stagedDirNames.join('/, ')}/, and what is in their `
      + 'place now belongs to another site. Move the ones inside it back over the renderer\'s, remove '
      + 'it, and run this again.');
  }

  // 🔴 The stash lives INSIDE the renderer, not in the system temp dir. Two reasons: a rename
  // across devices fails (EXDEV) and the temp dir is routinely on a different one; and none of the
  // renderer's globs are rooted here — they all name ../../content, ../../blog, ../themes — so a
  // directory sitting beside them is invisible to the build.
  const stash = await mkdtemp(path.join(astroDir, STASH_PREFIX))
    .catch(async (err) => { await rm(lock, { recursive: true, force: true }); throw err; });
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

  // 🩸 `restored` IS SET AT THE END, not the start. It used to be the first statement here, so a
  // restore that threw half way — a rename losing a race, an ENOTEMPTY — marked itself done and
  // every later call returned immediately. That renderer could never be put back, and the contract
  // "if this function throws, it has ALREADY restored" was false on exactly the path that needed it.
  // Every step below is therefore idempotent: a second call finishes what the first one dropped.
  //
  // 🩸 …AND A FLAG SET AT THE END CANNOT SERIALISE ANYTHING. Two restores in flight at once both saw
  // `restored === false` and both ran the whole body: measured 2026-09-07, 2 concurrent calls → 1
  // rejected with ENOENT, 3 → 2 rejected, because the second call renamed a directory the first had
  // already moved. That is not a hypothetical arrangement — it is the documented one. The README
  // hands a consumer `finally { await restore() }` and a `signal`, and a signal landing inside the
  // restore window fires both. So a restore in flight IS the answer to a second call: one attempt,
  // one result, every caller awaiting the same promise.
  let restoring = null;
  function restore() {
    if (restored) return Promise.resolve();
    if (restoring) return restoring;
    restoring = doRestore().then(
      () => { restored = true; restoring = null; },
      (err) => {
        // 🔴 A failed restore leaves `restoring` null ON PURPOSE: the next call must be a real
        // retry, not a replay of the failure. `restored` stays false, so the work is still owed.
        restoring = null;
        // 🔴 …and it leaves as a SENTENCE. A bare `ENOENT: rename '<stash>/public' -> '<astro>/public'`
        // was what a person got here, and it named the one directory that HAD come back while the
        // two that had not went unmentioned. Say where the renderer's own material is and what to do.
        throw new Error(`stageSite: the renderer could not be put back — ${err.message}. Its own `
          + `${stagedDirNames.join('/, ')}/ are in ${stash}: move each one back over the renderer's, `
          + `then remove that directory and ${lock}. Calling restore() again retries and is safe.`,
        { cause: err });
      },
    );
    return restoring;
  }

  async function doRestore() {
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
      if (stashed.has(name)) {
        // …and only if it is still IN the stash. On a retry it is already back where it belongs,
        // and removing `dir` first would delete the thing this loop just finished putting there.
        const from = path.join(stash, name);
        if (!(await exists(from))) continue;
        await rm(dir, { recursive: true, force: true });
        await rename(from, dir);
      } else {
        await rm(dir, { recursive: true, force: true });
        // content/ is the one directory the renderer cannot be left without, even if it arrived
        // without one: the renderer's globs name it.
        if (name === 'content') await mkdir(dir, { recursive: true });
      }
    }
    await rm(stash, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }

  try {
    await takeOver(contentDir, 'content');
    checkAborted();

    await takeOver(blogBuildDir, 'blog');
    if (blogDir) {
      if (!(await exists(blogDir))) throw new Error(`stageSite: blog dir not found: ${blogDir}`);
      await cp(blogDir, blogBuildDir, { recursive: true, force: true });
    }
    checkAborted();

    await takeOver(pagetileBuildDir, 'pagetile');
    if (pagetileDir) {
      if (!(await exists(pagetileDir))) throw new Error(`stageSite: pagetile dir not found: ${pagetileDir}`);
      await cp(pagetileDir, pagetileBuildDir, { recursive: true, force: true });
    }
    checkAborted();

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
        + 'The compiled theme.css is produced by the platform and travels with the export, beside '
        + 'ir/ — pass that file (--theme ./theme.css), or the build silently succeeds wearing only '
        + 'the baseline skin.');
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
    checkAborted();

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
    checkAborted();

    // ── this site's IR pages into content/ ──────────────────────────────────────────────────────
    // 🩸 `safePagePath` IS MANY-TO-ONE, and until this map existed nothing on the writing side was
    // looking. `our team & friends` and `our-team---friends` both become `our-team---friends.md`,
    // so the second write silently replaced the first — and `pageCount` still said two, and the CLI
    // still printed `✓ 2 page(s) →`, and the site was one page short with nothing anywhere saying
    // which one. (The fixture already ships `our team & friends.md`; a site owner adding the dashed
    // spelling is all it takes.) Others measured in the same corpus: `a b` / `a.b` / `a&b` all land
    // on `a-b`, and `` / `/` / `home` all land on `home`. The private shell this rule came from
    // refused here too; a package handed to somebody rebuilding their OWN site can do no less.
    //
    // 🩸 AND THE KEY IS FOLDED, because the question is "do these two become the same FILE", not
    // "do these two become the same STRING". `About` and `about` sanitise to two different strings
    // and are one file on APFS and on NTFS: measured 2026-09-07, `pageCount` said 2, `content/` held
    // one file named `About.md`, and its body was the second page's. Identical to the failure above,
    // reached by a different road. Jamo-decomposed `한글` is the same shape in the other direction —
    // one file on a filesystem that composes, two strings here.
    //
    // 🔴 The fold is done HERE, in memory, and never by asking the filesystem: a package that
    // refused on macOS and accepted on Linux would hand a Linux CI a green run for an IR that
    // cannot be rebuilt on the owner's laptop. Same input, same refusal, every host.
    const foldForFs = (safe) => safe.normalize('NFC').toLowerCase();
    const claimedBy = new Map();
    for (const p of pages) {
      const safe = safePagePath(p.path);
      const first = claimedBy.get(foldForFs(safe));
      if (first !== undefined) {
        const how = first.safe === safe
          ? `both sanitise to content/${safe}.md`
          : `sanitise to content/${first.safe}.md and content/${safe}.md, which are ONE file on a `
            + 'case-insensitive or normalising filesystem (APFS, NTFS)';
        throw new Error(`stageSite: two pages become the same file — ${JSON.stringify(first.path)} and `
          + `${JSON.stringify(p.path)} ${how}, so one would silently `
          + 'replace the other while the build still reported both. Rename one in the IR.');
      }
      claimedBy.set(foldForFs(safe), { path: p.path, safe });
      const outPath = path.join(contentDir, `${safe}.md`);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, p.markdown);
      checkAborted();
    }

    // 🔴 The last seam, and the one that closes the window: between the final write and handing
    // `restore` to the caller there is no owner for it. An abort landing here unwinds on THIS side.
    checkAborted();
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
