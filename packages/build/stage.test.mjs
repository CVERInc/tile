// stageSite — what lands in the renderer, and that the renderer is always handed back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { collectPages } from './mkpages.mjs';
import { safePagePath, stageSite, themeNameFromPages, listStaged } from './stage.mjs';

const IR = fileURLToPath(new URL('./fixtures/ir', import.meta.url));
const THEME = fileURLToPath(new URL('./fixtures/theme.css', import.meta.url));

// ── a renderer to stage into: the shipped shape, not the real one ────────────────────────────────
// The point of these tests is that the four example directories come back exactly as they were, so
// each file below carries a distinct body and the assertions read them, not just their names.
const DEMO = {
  'content/demo.md': '---\nsitetile-page: demo\n---\nthe renderer\'s own example page\n',
  'content/zh-tw/demo.md': '---\nsitetile-page: demo\n---\n渲染器自己的範例\n',
  'blog/a-demo-post.md': '---\ntitle: "A demo post"\n---\nthe renderer\'s own post\n',
  'pagetile/a-demo.book.md': '---\ntitle: "A demo book"\n---\nthe renderer\'s own book\n',
  'public/_redirects': '/feed /rss.xml 301\n',
  'public/img/mark.svg': '<svg/>\n',
  'src/themes/README.md': 'the baseline skin lives elsewhere; site themes are staged in and removed\n',
};

function makeRenderer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tile-build-renderer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), '{ "name": "@tile/sitetile-astro-stub", "type": "module" }\n');
  for (const [rel, body] of Object.entries(DEMO)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const snapshot = async (dir) => {
  const files = await listStaged(dir);
  return Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
};
const noStashLeft = (dir) => assert.deepEqual(
  readdirSync(dir).filter((n) => n.startsWith('.tile-build-stash-')), [],
  'a stash directory survived — the renderer is not back to how it was found',
);

// ── sanitisation ────────────────────────────────────────────────────────────────────────────────
// THE canonical rule for this package, transcribed from the shell that has been doing this in
// production. See README §"Three sanitisers, one rule".
test('safePagePath: the rules, one case each', () => {
  const cases = {
    'home': 'home',
    'legal/terms': 'legal/terms',
    'our team & friends': 'our-team---friends',
    'zh-tw/關於': 'zh-tw/關於',                 // Unicode letters are URLs on real sites
    'zh-tw': 'zh-tw',                            // a dash is legal and is not touched
    'a_b': 'a_b',
    'page.html': 'page-html',                    // a dot is not a filename separator here
    '../../etc/passwd': '--/--/etc/passwd',      // traversal collapses to literal dashes
    '/leading/slash': 'leading/slash',           // empty segments are dropped…
    'double//slash': 'double/slash',
    'trailing/': 'trailing',
    '': 'home',                                  // …and a path that sanitises away becomes home
    '/': 'home',
    '...': '---',                                // a segment that is ALL punctuation survives as dashes
    'a b/c d': 'a-b/c-d',
    '2026': '2026',
  };
  for (const [input, want] of Object.entries(cases)) {
    assert.equal(safePagePath(input), want, `safePagePath(${JSON.stringify(input)})`);
  }
});

test('safePagePath is exactly the two implementations it replaces', () => {
  // Transcribed verbatim from the two places this logic used to live. The shell orchestrator's
  // (canonical) and the ejected builder's differ only in how they spell "nothing left → home", so
  // this is a proof of equivalence rather than a choice between behaviours — the difference in the
  // README is about WHAT each one is given, not about what it computes.
  const fromShellOrchestrator = (p) => {
    const segs = p.split('/').map((s) => s.replace(/[^\p{L}\p{N}_-]/gu, '-')).filter(Boolean);
    return segs.length ? segs.join('/') : 'home';
  };
  const fromEjectedBuilder = (p) =>
    p.split('/').map((s) => s.replace(/[^\p{L}\p{N}_-]/gu, '-')).filter(Boolean).join('/') || 'home';

  const corpus = ['home', '', '/', '//', 'a', 'a/b', '../x', '.', '..', '...', 'a b', 'a&b', 'zh-tw/關於',
    'ja-jp/はじめに', '한글/소개', 'legal/terms', 'x/', '/x', 'x//y', 'MiXeD/CaSe', '_site', '-', '_',
    'emoji-🎏-page', 'page.html', 'a\\b', 'a\tb', '2026/01/note'];
  for (const p of corpus) {
    assert.equal(fromShellOrchestrator(p), fromEjectedBuilder(p), `the two originals disagree on ${JSON.stringify(p)}`);
    assert.equal(safePagePath(p), fromShellOrchestrator(p), `this package disagrees on ${JSON.stringify(p)}`);
  }
});

// ── theme name ──────────────────────────────────────────────────────────────────────────────────
test('themeNameFromPages reads the first page that declares one', () => {
  assert.equal(themeNameFromPages(collectPages(IR)), 'paperkite');
  assert.equal(themeNameFromPages([{ path: 'home', markdown: '---\ntitle: x\n---\n' }]), '');
  // A `theme:` whose value is not one bare word yields nothing rather than half a word.
  assert.equal(themeNameFromPages([{ path: 'home', markdown: 'theme: two words\n' }]), '');
});

// ── staging ─────────────────────────────────────────────────────────────────────────────────────
test('stageSite writes the site into the renderer, then hands the renderer back', async (t) => {
  const astroDir = makeRenderer(t);
  const before = await snapshot(astroDir);
  const assetsDir = mkdtempSync(join(tmpdir(), 'tile-build-assets-'));
  t.after(() => rmSync(assetsDir, { recursive: true, force: true }));
  mkdirSync(join(assetsDir, 'img'), { recursive: true });
  writeFileSync(join(assetsDir, 'img/kite.svg'), '<svg id="kite"/>\n');
  writeFileSync(join(assetsDir, '_redirects'), '/old /new 301\n');

  const pages = collectPages(IR);
  const { restore, pageCount, themeName } = await stageSite({
    astroDir, pages, themeFile: THEME, assetsDir, blogDir: join(IR, 'posts'),
  });
  assert.equal(pageCount, 7);
  assert.equal(themeName, 'paperkite');

  const content = await listStaged(join(astroDir, 'content'));
  assert.deepEqual(content, [
    '_site.md', 'home.md', 'ja-jp.md', 'legal/terms.md',
    'our-team---friends.md', 'zh-tw.md', 'zh-tw/關於.md',
  ]);
  assert.equal(existsSync(join(astroDir, 'content/demo.md')), false,
    "the renderer's own example pages must not build into this site");
  assert.equal(readFileSync(join(astroDir, 'content/home.md'), 'utf8'),
    readFileSync(join(IR, 'home.md'), 'utf8'), 'a page is copied byte for byte');

  // blog/ is EMPTIED and then filled from the site's own posts — the renderer's demo post is gone.
  assert.deepEqual(await listStaged(join(astroDir, 'blog')), ['a-first-flight.md']);
  // pagetile/ is emptied even though this site has no book at all.
  assert.deepEqual(await listStaged(join(astroDir, 'pagetile')), []);

  // public/ is an OVERLAY: the renderer's own files stay unless the site names the same path.
  assert.equal(readFileSync(join(astroDir, 'public/img/mark.svg'), 'utf8'), '<svg/>\n');
  assert.equal(readFileSync(join(astroDir, 'public/img/kite.svg'), 'utf8'), '<svg id="kite"/>\n');
  assert.equal(readFileSync(join(astroDir, 'public/_redirects'), 'utf8'), '/old /new 301\n',
    'a file-level replace: the site wins its own paths, and merging is a deployment concern');

  assert.equal(readFileSync(join(astroDir, 'src/themes/paperkite.css'), 'utf8'),
    readFileSync(THEME, 'utf8'), "staged under the name the site's IR asks for");

  await restore();
  assert.deepEqual(await snapshot(astroDir), before, 'the renderer is not byte-identical to how it was found');
  noStashLeft(astroDir);
  await restore();   // idempotent: a caller that also has a finally block must not be punished
  assert.deepEqual(await snapshot(astroDir), before);
});

test('a site with no posts, no assets and no theme still empties blog/ and pagetile/', async (t) => {
  const astroDir = makeRenderer(t);
  const before = await snapshot(astroDir);
  const { restore } = await stageSite({
    astroDir, pages: [{ path: 'home', markdown: '# only page\n' }],
  });
  assert.deepEqual(await listStaged(join(astroDir, 'blog')), []);
  assert.deepEqual(await listStaged(join(astroDir, 'pagetile')), []);
  assert.deepEqual(await listStaged(join(astroDir, 'public')), ['_redirects', 'img/mark.svg'],
    'public/ is untouched when the site brings no media');
  await restore();
  assert.deepEqual(await snapshot(astroDir), before);
  noStashLeft(astroDir);
});

// ── restore on throw ────────────────────────────────────────────────────────────────────────────
// 🔴 The one that matters. Every early exit below happens AFTER content/ has been emptied and, in
// the assets case, after a site's theme has already been copied into the renderer. A stageSite that
// threw without restoring would leave the next site built here wearing this one's skin.
test('a throw restores the renderer — including a theme already staged', async (t) => {
  const astroDir = makeRenderer(t);
  const before = await snapshot(astroDir);
  await assert.rejects(
    () => stageSite({
      astroDir, pages: collectPages(IR), themeFile: THEME,
      assetsDir: join(astroDir, 'no-such-assets-dir'),
    }),
    /assets dir not found/,
  );
  assert.equal(existsSync(join(astroDir, 'src/themes/paperkite.css')), false,
    "the site's theme was staged before the throw and must not survive it");
  assert.deepEqual(await snapshot(astroDir), before);
  noStashLeft(astroDir);
});

// 🩸 The measured one. The shell orchestrator armed its restore trap BEFORE staging and then
// removed blog/ and pagetile/ unconditionally inside it — so a throw at the blog step deleted the
// renderer's own pagetile/, which had never been moved aside and could not be put back. The
// renderer stayed broken for every build after it, with nothing said.
test('a throw at the blog step does not delete a directory it never stashed', async (t) => {
  const astroDir = makeRenderer(t);
  const before = await snapshot(astroDir);
  await assert.rejects(
    () => stageSite({ astroDir, pages: collectPages(IR), themeFile: THEME, blogDir: join(astroDir, 'nope') }),
    /blog dir not found/,
  );
  assert.equal(readFileSync(join(astroDir, 'pagetile/a-demo.book.md'), 'utf8'), DEMO['pagetile/a-demo.book.md']);
  assert.deepEqual(await snapshot(astroDir), before);
  noStashLeft(astroDir);
});

test('the theme guards, each of which throws after content/ was emptied', async (t) => {
  const astroDir = makeRenderer(t);
  const before = await snapshot(astroDir);
  const pages = collectPages(IR);

  // Declares a skin, was handed none: the build would succeed wearing the baseline skin.
  await assert.rejects(() => stageSite({ astroDir, pages }), /declares 'theme: paperkite' but no themeFile/);
  assert.deepEqual(await snapshot(astroDir), before);

  // Handed a skin, declares none: nothing would ever load it.
  await assert.rejects(
    () => stageSite({ astroDir, pages: [{ path: 'home', markdown: '# no theme line\n' }], themeFile: THEME }),
    /the IR declares no 'theme:'/,
  );
  assert.deepEqual(await snapshot(astroDir), before);

  // A theme name is a filename, and it arrives from writable site content.
  await assert.rejects(
    () => stageSite({ astroDir, pages: [{ path: 'home', markdown: 'theme: ../../../../pwn\n' }], themeFile: THEME }),
    /unusable 'theme: \.\.\/\.\.\/\.\.\/\.\.\/pwn'/,
  );
  assert.equal(existsSync(join(astroDir, 'src/themes/../../../../pwn.css')), false);
  assert.deepEqual(await snapshot(astroDir), before);

  // Refusing to shadow a theme the renderer ships under the same name.
  writeFileSync(join(astroDir, 'src/themes/paperkite.css'), '/* the renderer\'s own */\n');
  const withShipped = await snapshot(astroDir);
  await assert.rejects(() => stageSite({ astroDir, pages, themeFile: THEME }), /Refusing to shadow it/);
  assert.deepEqual(await snapshot(astroDir), withShipped,
    "the renderer's own theme file must still be there — restore deletes only what we staged");

  noStashLeft(astroDir);
});

test('a missing theme file, a missing blog dir and a bad page array all throw before anything is lost', async (t) => {
  const astroDir = makeRenderer(t);
  const before = await snapshot(astroDir);
  const pages = collectPages(IR);

  await assert.rejects(() => stageSite({ astroDir, pages, themeFile: join(astroDir, 'nope.css') }),
    /theme file not found/);
  await assert.rejects(() => stageSite({ astroDir, pages, themeFile: THEME, blogDir: join(astroDir, 'nope') }),
    /blog dir not found/);
  await assert.rejects(() => stageSite({ astroDir, pages: [{ path: 'home' }] }), /each page needs \{path, markdown\}/);
  await assert.rejects(() => stageSite({ astroDir, pages: 'not an array' }), /pages must be an array/);
  await assert.rejects(() => stageSite({ pages }), /astroDir is required/);
  await assert.rejects(() => stageSite({ astroDir: join(astroDir, 'content'), pages }),
    /not a renderer directory/);

  assert.deepEqual(await snapshot(astroDir), before);
  noStashLeft(astroDir);
});
