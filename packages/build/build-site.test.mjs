// buildSite end to end — the fixture site, the real renderer, real HTML on disk.
//
// This is the only test here that proves the promise: an IR directory in, a directory of static
// HTML out, and the renderer put back. It needs the renderer's dependencies, so it SAYS SO by name
// when they are absent rather than passing quietly on a check that never ran — the same shape
// scripts/test.sh uses for the astro smoke.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// reef#2301 — the site-wide `announce` gained `announce-href` and `announce-until`. Built for real,
// because the promise is about what lands in the HTML: no `until` ⇒ the band exactly as before; a
// past `until` ⇒ nothing at all; a future one ⇒ a corner card the browser takes down itself.
// A page may override a site key, so one build carries all four shapes, one page each.
if (existsSync(join(ASTRO, 'node_modules'))) {
  test('announce: band unchanged, past `until` renders nothing, future `until` renders the card', async (t) => {
    const irDir = mkdtempSync(join(tmpdir(), 'tile-announce-ir-'));
    const outDir = mkdtempSync(join(tmpdir(), 'tile-announce-out-'));
    t.after(() => { rmSync(irDir, { recursive: true, force: true }); rmSync(outDir, { recursive: true, force: true }); });
    const page = (name, fm) => writeFileSync(join(irDir, `${name}.md`),
      `---\nsitetile-page: ${name}\ntitle: ${name}\nlang: en-US\n${fm}\n---\n\n## ${name}\n\nBody of ${name}.\n`);
    writeFileSync(join(irDir, '_site.md'), '---\nbrand: Announce Fixture\nlang: en-US\n---\n');
    page('home', 'announce: Plain band text');
    page('linked', 'announce: Linked band text\nannounce-href: /home/');
    page('past', 'announce: Expired promo\nannounce-until: 2020-01-01T00:00:00+09:00');
    page('future', 'announce: Spring class enrolling\nannounce-href: /linked/\nannounce-until: 2099-12-01T23:59:00+09:00');
    page('unsafe', 'announce: Unsafe link\nannounce-href: javascript:alert(1)');

    const result = await buildSite({ irDir, engineDir: ENGINE, outDir, siteUrl: 'https://announce.example' });
    assert.equal(result.code, 0, 'astro build exited non-zero');
    const html = (p) => readFileSync(join(outDir, p, 'index.html'), 'utf8');

    // string-only — byte-identical to the band every existing site already has.
    assert.ok(html('').includes('<div class="rf-announce" role="note">Plain band text</div>'),
      'the string-only announce is no longer the exact band it was');
    assert.doesNotMatch(html(''), /rf-announce-card/, 'a string-only announce grew a card');
    // past until — nothing rendered: no band, no card, no script for it.
    assert.doesNotMatch(html('past'), /rf-announce/, 'an expired announce still renders');
    assert.doesNotMatch(html('past'), /Expired promo/, 'the expired text is still on the page');
    // href without until — still the band, with the text as its link.
    assert.ok(html('linked').includes('<div class="rf-announce" role="note"><a href="/home/">Linked band text</a></div>'),
      'announce-href without until did not link the band');
    // href through safeHref — a javascript: destination is dropped, the text stays.
    assert.ok(html('unsafe').includes('<div class="rf-announce" role="note">Unsafe link</div>'),
      'a javascript: announce-href was not dropped');
    // future until — the corner card: data-until, the link, the ×, the countdown slot.
    const card = html('future').match(/<aside class="rf-announce-card"[\s\S]*?<\/aside>/);
    assert.ok(card, 'a future until did not render .rf-announce-card');
    assert.match(card[0], /data-until="2099-12-01T14:59:00\.000Z"/, 'until is not normalised to UTC ISO on the card');
    assert.match(card[0], /<a class="rf-announce-t" href="\/linked\/">Spring class enrolling<\/a>/, 'the card lost its link');
    assert.match(card[0], /<span class="rf-announce-cd" data-until="2099-12-01T14:59:00\.000Z" data-prefix="Ends in "><\/span>/, 'no countdown slot');
    assert.match(card[0], /<button type="button" class="rf-announce-x" aria-label="Close" hidden>×<\/button>/, 'no × button');
    assert.doesNotMatch(html('future'), /class="rf-announce"/, 'a card page also drew the band');
    // The before-first-paint guard is the card's next sibling — its whole contract.
    assert.match(html('future'), /<\/aside>\s*<script>\(function\(\)\{var s=document\.currentScript/, 'the guard does not follow the card');
    // …and only a card page carries any of it.
    assert.doesNotMatch(html(''), /rf-announce-x:|announce-card/, 'a band page ships the card\'s script');
  });
}

// 🩸 …and "SKIPPED" only means something if something can make it stop being true. The CI workflow
// ran `bash scripts/test.sh` and installed nothing at all, while the renderer's node_modules is
// gitignored — so the case above, the only one in this repo that turns an IR directory into real
// HTML, had never run there once. A long green scrolled past its own skip line. These two hold the
// install step and the announcement in place; without them this file goes quiet again and no gate
// notices. Measured 2026-09-07 on a clean clone.
test('CI installs the renderer\'s dependencies, so the case above is not skipped there', () => {
  const workflow = readFileSync(join(ENGINE, '.github/workflows/ci.yml'), 'utf8');
  assert.match(workflow, /npm ci --prefix packages\/sitetile\/astro/,
    'the workflow no longer installs the renderer — this file\'s end-to-end case is dead in CI');
  assert.ok(workflow.indexOf('npm ci --prefix') < workflow.indexOf('bash scripts/test.sh'),
    'the install must come before the suite that needs it');
});

test('scripts/test.sh says out loud whether the end-to-end ran', () => {
  const suite = readFileSync(join(ENGINE, 'scripts/test.sh'), 'utf8');
  assert.match(suite, /packages\/build END-TO-END SKIPPED/,
    'nothing announces the skip, so a green run cannot be told from a narrower one');
  assert.match(suite, /packages\/build\/\*\.test\.mjs/, 'this package is not in SUITE_GLOBS at all');
});

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
