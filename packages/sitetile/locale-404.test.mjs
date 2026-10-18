// One `404.html` per declared locale: the rename `<loc>/404/index.html` → `<loc>/404.html` at build:done.
//   run: node packages/sitetile/locale-404.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 CVERInc/reef#2112. Cloudflare Pages serves the nearest `404.html` up the tree; Astro writes only
// the ROOT 404 as a bare file, so a per-locale 404 route lands at `zh-tw/404/index.html` — a page
// to Pages, not a 404. The hook in astro/locale-404.mjs moves it. This file is the pure half: the
// route-list reading, the rename on a scratch directory, and the wiring in astro.config.mjs. The
// built half (a real site in, `zh-tw/404.html` in that locale's language out, a one-language site's
// output untouched) is in not-found-locale.test.mjs beside the root 404's own checks.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { locale404Segment, locale404Renames, relocateLocale404s, locale404Pages } from './astro/locale-404.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const scratch = mkdtempSync(join(tmpdir(), 'locale-404-'));
// A dist the way Astro leaves it: root 404.html, a locale's 404 as a directory index, ordinary pages.
const makeDist = (name, files) => {
  const dir = join(scratch, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
};
const walk = (d) => readdirSync(d, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name).slice(d.length + 1)).sort();

try {
  test('🔴 only `<one segment>/404` is a locale 404: the root 404 and deeper paths are left alone', () => {
    assert.equal(locale404Segment('zh-tw/404/'), 'zh-tw');
    assert.equal(locale404Segment('/zh-tw/404'), 'zh-tw');
    assert.equal(locale404Segment('ja-jp/404'), 'ja-jp');
    assert.equal(locale404Segment('404/'), null, 'the ROOT 404 is Astro\'s own bare file already');
    assert.equal(locale404Segment('/404'), null);
    assert.equal(locale404Segment('zh-tw/legal/404/'), null, 'a nested page called 404 is a page');
    assert.equal(locale404Segment('zh-tw/'), null);
    assert.equal(locale404Segment(''), null);
    assert.equal(locale404Segment(undefined), null);
  });

  test('the rename list comes from the routes Astro reports, one per locale, root excluded', () => {
    const pages = [{ pathname: '' }, { pathname: '404/' }, { pathname: 'zh-tw/' }, { pathname: 'zh-tw/404/' },
      { pathname: 'ja-jp/404/' }, { pathname: 'zh-tw/404/' }, { pathname: 'zh-tw/blocks/' }];
    assert.deepEqual(locale404Renames(pages), [
      { seg: 'zh-tw', from: 'zh-tw/404/index.html', to: 'zh-tw/404.html' },
      { seg: 'ja-jp', from: 'ja-jp/404/index.html', to: 'ja-jp/404.html' },
    ]);
    assert.deepEqual(locale404Renames([]), []);
    assert.deepEqual(locale404Renames(undefined), []);
  });

  test('🔴 the file moves to `<loc>/404.html`, the emptied `<loc>/404/` directory goes, nothing else is touched', () => {
    const dir = makeDist('move', {
      '404.html': 'root 404',
      'index.html': 'home',
      'zh-tw/index.html': 'zh home',
      'zh-tw/404/index.html': '<html lang="zh-Hant">zh 404',
      'zh-tw/blocks/index.html': 'zh blocks',
    });
    const moved = relocateLocale404s(dir, [{ pathname: '404/' }, { pathname: 'zh-tw/404/' }, { pathname: 'zh-tw/blocks/' }]);
    assert.deepEqual(moved, ['zh-tw/404.html']);
    assert.deepEqual(walk(dir), ['404.html', 'index.html', 'zh-tw/404.html', 'zh-tw/blocks/index.html', 'zh-tw/index.html']);
    assert.equal(readFileSync(join(dir, 'zh-tw/404.html'), 'utf8'), '<html lang="zh-Hant">zh 404');
    assert.equal(readFileSync(join(dir, '404.html'), 'utf8'), 'root 404', 'the root 404 is tile#135\'s and is not this hook\'s to touch');
    assert.equal(existsSync(join(dir, 'zh-tw/404')), false, 'the empty 404/ directory was left behind');
  });

  test('🔴 a one-language build (no locale 404 route) is left byte-for-byte alone', () => {
    const files = { '404.html': 'root 404', 'index.html': 'home', 'about/index.html': 'about' };
    const dir = makeDist('mono', files);
    const before = walk(dir).map((rel) => [rel, readFileSync(join(dir, rel), 'utf8')]);
    assert.deepEqual(relocateLocale404s(dir, [{ pathname: '' }, { pathname: '404/' }, { pathname: 'about/' }]), []);
    assert.deepEqual(walk(dir).map((rel) => [rel, readFileSync(join(dir, rel), 'utf8')]), before);
  });

  test('a reported route that was not written is skipped; a target that already exists is refused, not overwritten', () => {
    const dir = makeDist('edge', { '404.html': 'root', 'ko-kr/404.html': 'already a file', 'ko-kr/404/index.html': 'the new one' });
    assert.deepEqual(relocateLocale404s(dir, [{ pathname: 'ja-jp/404/' }]), [], 'ja-jp was reported but never written');
    assert.throws(() => relocateLocale404s(dir, [{ pathname: 'ko-kr/404/' }]), /both ko-kr\/404\/index\.html and ko-kr\/404\.html exist/);
    assert.equal(readFileSync(join(dir, 'ko-kr/404.html'), 'utf8'), 'already a file');
  });

  test('the Astro integration hook renames inside the directory Astro hands it, from the pages Astro reports', () => {
    const dir = makeDist('hook', { '404.html': 'root', 'ja-jp/404/index.html': 'ja 404' });
    const integration = locale404Pages();
    assert.equal(integration.name, 'sitetile-locale-404');
    integration.hooks['astro:build:done']({ dir: pathToFileURL(dir + '/'), pages: [{ pathname: '404/' }, { pathname: 'ja-jp/404/' }] });
    assert.deepEqual(walk(dir), ['404.html', 'ja-jp/404.html']);
  });

  test('🔴 the renderer is wired to it: astro.config.mjs registers the integration (production runs a plain `npx astro build`)', () => {
    const config = readFileSync(new URL('./astro/astro.config.mjs', import.meta.url), 'utf8');
    assert.match(config, /integrations:\s*\[[^\]]*locale404Pages\(\)/);
    // …and the route that produces the files it renames exists beside the root one.
    assert.ok(existsSync(new URL('./astro/src/pages/[...loc]/404.astro', import.meta.url)), 'pages/[...loc]/404.astro is missing');
    assert.ok(existsSync(new URL('./astro/src/pages/404.astro', import.meta.url)), 'the ROOT 404 route must stay (tile#135)');
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n  ${passed} passed`);
