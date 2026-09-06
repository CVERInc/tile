// buildSite end to end — the fixture site, the real renderer, real HTML on disk.
//
// This is the only test here that proves the promise: an IR directory in, a directory of static
// HTML out, and the renderer put back. It needs the renderer's dependencies, so it SAYS SO by name
// when they are absent rather than passing quietly on a check that never ran — the same shape
// scripts/test.sh uses for the astro smoke.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from './index.mjs';
import { listStaged } from './stage.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const IR = fileURLToPath(new URL('./fixtures/ir', import.meta.url));
const THEME = fileURLToPath(new URL('./fixtures/theme.css', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · buildSite end-to-end SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (it is the only test in this package that builds real pages; a green run without it is narrower)');
} else {
  test('buildSite turns the fixture IR into static HTML and hands the renderer back', async (t) => {
    const outDir = mkdtempSync(join(tmpdir(), 'tile-build-out-'));
    t.after(() => rmSync(outDir, { recursive: true, force: true }));
    const rendererBefore = await listStaged(join(ASTRO, 'content'));

    const result = await buildSite({
      irDir: IR,
      engineDir: ENGINE,
      outDir,
      siteUrl: 'https://paper-kite.example',
      themeFile: THEME,
    });

    assert.equal(result.code, 0, 'astro build exited non-zero');
    assert.equal(result.pageCount, 7);
    assert.equal(result.outDir, outDir);

    // The home page and the nested page — the two shapes the whole path mapping exists for.
    const home = join(outDir, 'index.html');
    const terms = join(outDir, 'legal/terms/index.html');
    assert.ok(existsSync(home), 'no index.html for the home page');
    assert.ok(existsSync(terms), 'no index.html for the nested legal/terms page');
    assert.match(readFileSync(home, 'utf8'), /Paper Kite Atelier/);
    assert.match(readFileSync(terms, 'utf8'), /Terms/);

    // A locale home collapses to /zh-tw/, which is the defect the collapse rule exists for.
    assert.ok(existsSync(join(outDir, 'zh-tw/index.html')), 'no index.html for the zh-tw locale home');
    assert.equal(existsSync(join(outDir, 'zh-tw/home/index.html')), false,
      'the locale home did not collapse — /zh-tw/home/ is the wrong route');

    // 🔴 The renderer's OWN example pages must not be in this site. If they are, the stash did not
    // happen and somebody else's demo content is about to be served under this site's domain.
    for (const stray of ['blocks', 'markers', 'forms']) {
      assert.equal(existsSync(join(outDir, stray, 'index.html')), false,
        `the renderer's own /${stray} page built into this site`);
    }

    // …and the renderer is back to how it was found.
    assert.deepEqual(await listStaged(join(ASTRO, 'content')), rendererBefore);
    assert.equal(existsSync(join(ASTRO, 'src/themes/paperkite.css')), false,
      "the site's theme stayed behind in the renderer");
  });
}

test('buildSite refuses a directory that is not an engine checkout', async () => {
  await assert.rejects(
    () => buildSite({ irDir: IR, engineDir: tmpdir(), outDir: join(tmpdir(), 'unused') }),
    /not an engine checkout/,
  );
});

test('buildSite states its three required arguments by name', async () => {
  await assert.rejects(() => buildSite({}), /irDir is required/);
  await assert.rejects(() => buildSite({ irDir: IR }), /engineDir is required/);
  await assert.rejects(() => buildSite({ irDir: IR, engineDir: ENGINE }), /outDir is required/);
});
