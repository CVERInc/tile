// WordPress home paging: /page/<n> forwards to the blog's own page <n>, when a site opts in.
//   run: node packages/sitetile/blog-home-paging.test.mjs   (globbed into scripts/test.sh)
//
// A site that arrived from WordPress with its posts on the front page has /page/2/, /page/3/, …
// out in the world. Here the blog lives under a `blog-path`, so those addresses answered 404, and
// the only way to keep them was one `_redirects` line each — a large site spends a hundred-plus of
// its static redirect rules on one pattern. `blog-home-paging-redirects` makes the engine emit the
// forwards itself, as Astro's static redirect pages: no `_redirects` line at all.
//
// The pure half holds the rule (opt-in, range, root mount, a real page wins). The build half reads
// what the build WROTE: the forward file, the page it did not displace, the pager it must not have
// changed, the sitemap it must stay out of, and a `_redirects` it must not have touched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RENDERER_SUBPATH } from '../build/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);
// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve —
// the same seam blog-unlisted.test.mjs teaches the resolver.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const blog = await import('./astro/src/lib/blog.mjs');

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// ── the pure half ────────────────────────────────────────────────────────────────────────────
const fwd = (meta, total, claimed) => {
  assert.equal(typeof blog.homePagingForwards, 'function', 'lib/blog.mjs does not export homePagingForwards');
  return blog.homePagingForwards(meta, total, claimed);
};
const ON = { 'blog-path': '/blog', 'blog-home-paging-redirects': 'true' };

await test('off unless the site says so: absent and "false" make nothing', () => {
  assert.deepEqual(fwd({ 'blog-path': '/blog' }, 5), []);
  assert.deepEqual(fwd({ ...ON, 'blog-home-paging-redirects': 'false' }, 5), []);
  assert.deepEqual(fwd(undefined, 5), []);
});
await test('on: /page/2../page/<last> forward to the pager\'s own hrefs, and nothing else', () => {
  // With the trailing slash: the directory form the build writes, which is the target's own canonical.
  assert.deepEqual(fwd(ON, 3), [{ path: 'page/2', to: '/blog/page/2/' }, { path: 'page/3', to: '/blog/page/3/' }]);
  // Any present value but "false" is on — the blog-date-routes rule.
  assert.deepEqual(fwd({ ...ON, 'blog-home-paging-redirects': 'on' }, 2), [{ path: 'page/2', to: '/blog/page/2/' }]);
  // The target is indexUrl's, so it follows blog-path (the historic default included).
  assert.deepEqual(fwd({ 'blog-home-paging-redirects': 'true' }, 2), [{ path: 'page/2', to: '/devlog/page/2/' }]);
  // A blog-path written with a trailing slash still makes one slash, not two.
  assert.deepEqual(fwd({ ...ON, 'blog-path': '/blog/' }, 2), [{ path: 'page/2', to: '/blog/page/2/' }]);
});
await test('a one-page blog has no page <n> to forward to', () => {
  assert.deepEqual(fwd(ON, 1), []);
  assert.deepEqual(fwd(ON, 0), []);
});
await test('🔴 a root-mounted blog makes nothing: its pager already IS /page/<n>', () => {
  assert.deepEqual(fwd({ ...ON, 'blog-path': '' }, 5), []);
  assert.deepEqual(fwd({ ...ON, 'blog-path': '/' }, 5), []);
});
await test('🔴 a path another route claims keeps its page — no forward is made there', () => {
  assert.deepEqual(fwd(ON, 4, (p) => p === 'page/3'), [{ path: 'page/2', to: '/blog/page/2/' }, { path: 'page/4', to: '/blog/page/4/' }]);
});

// ── the build half ───────────────────────────────────────────────────────────────────────────
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: prose %%\n\nBody.\n`;
const posts = Object.fromEntries([1, 2, 3, 4, 5].map((i) =>
  [`posts/p${i}.md`, `---\ntitle: P${i}\ndate: 2026-01-0${i}\n---\nBody text ${i}.\n`]));
const SITE = (extra) => `---\nbrand: Paging Test\nlang: en\npackages: blog\nblog-path: /blog\nblog-page-size: 2\n${extra}---\n`;
const SITES = {
  // 5 posts, 2 per page → the pager is /blog, /blog/page/2, /blog/page/3. A content page sits at
  // /page/3, so only /page/2 is forwarded.
  on: { '_site.md': SITE('blog-home-paging-redirects: true\n'), 'home.md': page('sitetile-page: home\ntitle: Home', 'Home'),
    'page/3.md': page('sitetile-page: page-3\ntitle: A real page', 'A real page'), ...posts },
  off: { '_site.md': SITE(''), 'home.md': page('sitetile-page: home\ntitle: Home', 'Home'), ...posts },
};

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · blog-home-paging END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-home-paging-'));
  const build = (name) => {
    const irDir = join(work, name, 'ir');
    for (const [rel, body] of Object.entries(SITES[name])) {
      mkdirSync(dirname(join(irDir, rel)), { recursive: true });
      writeFileSync(join(irDir, rel), body);
    }
    const outDir = join(work, name, 'out');
    const r = spawnSync(process.execPath, [join(ENGINE, 'packages/build/cli.mjs'), irDir, outDir, '--site-url', 'https://example.com', '--engine', ENGINE], { encoding: 'utf8' });
    assert.equal(r.status, 0, `astro build failed for the ${name} fixture:\n${`${r.stdout}\n${r.stderr}`.slice(-1500)}`);
    const read = (rel) => (existsSync(join(outDir, rel)) ? readFileSync(join(outDir, rel), 'utf8') : null);
    return { read };
  };
  const built = {};
  for (const name of Object.keys(SITES)) {
    try { built[name] = build(name); } catch (e) { built[name] = e; }
  }
  const site = (name) => { if (built[name] instanceof Error) throw built[name]; return built[name]; };

  await test('🔴 on: /page/2 is a forward to /blog/page/2/ — 0-second refresh, noindex, canonical to the target', () => {
    const html = site('on').read('page/2/index.html');
    assert.ok(html, 'no page/2/index.html was written');
    assert.match(html, /<meta http-equiv="refresh" content="0;url=\/blog\/page\/2\/">/);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/blog\/page\/2\/">/);
  });
  await test('🔴 on: the forward names exactly the URL the target page calls its own canonical (no second hop)', () => {
    const canon = (html) => (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
    const target = site('on').read('blog/page/2/index.html');
    assert.ok(target && canon(target), 'control: blog/page/2/index.html carries a canonical');
    assert.equal(canon(site('on').read('page/2/index.html')), canon(target));
    assert.match(site('on').read('page/2/index.html'), new RegExp(`content="0;url=${new URL(canon(target)).pathname.replace(/\//g, '\\/')}"`));
  });
  await test('🔴 on: the content page at /page/3 is still that page, not a forward', () => {
    const html = site('on').read('page/3/index.html');
    assert.ok(html, 'page/3/index.html is missing');
    assert.match(html, /A real page/);
    assert.doesNotMatch(html, /http-equiv="refresh"/);
  });
  await test('on: nothing past the blog\'s last page', () => {
    assert.equal(site('on').read('page/4/index.html'), null);
  });
  await test('on: the blog\'s own pages are still pages (a forward in the same route changes no other render)', () => {
    for (const rel of ['blog/index.html', 'blog/page/2/index.html', 'blog/page/3/index.html', 'index.html']) {
      const html = site('on').read(rel);
      assert.ok(html, `${rel} is missing`);
      assert.doesNotMatch(html, /http-equiv="refresh"/, `${rel} became a redirect`);
    }
  });
  await test('on: the forwards are not in sitemap.xml, and _redirects is the renderer\'s own', () => {
    const sitemap = site('on').read('sitemap.xml') || '';
    assert.match(sitemap, /\/blog\//, 'control: the sitemap lists the blog');
    assert.doesNotMatch(sitemap, /example\.com\/page\/2/);
    assert.equal(site('on').read('_redirects'), readFileSync(join(ASTRO, 'public/_redirects'), 'utf8'));
  });
  await test('off: no /page/<n> at all', () => {
    assert.equal(site('off').read('page/2/index.html'), null);
    assert.ok(site('off').read('blog/page/2/index.html'), 'control: the off site has a page 2');
  });
  rmSync(work, { recursive: true, force: true });
}

console.log(`\nblog-home-paging: ${passed} passed`);
