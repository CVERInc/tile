// reef#2554 — which emitted pages are noindex, decided after the build over the files it wrote.
//   run: node packages/sitetile/noindex.test.mjs
//
// noindex-pass.mjs reads ONLY an output dir: each page's stamps (what its own source said, put in
// its head by SiteLayout), the `thanks_to` fields of the inbox forms in the emitted HTML, and the
// route's sitemap.xml for order and spelling. These tests hand it output dirs written the way the
// build writes them and read back what it wrote. The built-site half (real Astro builds, every
// review's inputs, the byte comparison) is in astro/smoke-build.mjs.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyNoindex, fileForPath } from './astro/noindex-pass.mjs';
import { noindexFlag, routeOutputFile } from './astro/src/lib/noindex.mjs';

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);

const ROBOTS = '<meta name="robots" content="noindex">';
/** A page as SiteLayout writes it: the noindex stamp ('' = not said, written bare like Astro does),
 *  the sitemap stamp, and the body (forms go here). `stamp: null` = a page no [...path] view made. */
const html = ({ flag = '', sitemap = 'list', stamp = true, robots = false, body = '<p>Text.</p>', title = 'T' } = {}) =>
  `<!DOCTYPE html><html><head><title>${title}</title>`
  + (robots ? ROBOTS : '')
  + (stamp && !robots ? (flag === '' ? '<meta name="sitetile:noindex" content>' : `<meta name="sitetile:noindex" content="${flag}">`) : '')
  + (stamp ? `<meta name="sitetile:sitemap" content="${sitemap}">` : '')
  + `<meta property="og:type" content="website"></head><body>${body}</body></html>`;
/** Form.astro's inbox form: `thanks_to` rides beside `return_to` only when thanks= was accepted. */
const form = (...targets) => targets.map((t) => '<form class="st-form" action="/__reef/inbox" method="post">'
  + '<input type="hidden" name="return_to" value="/c/">'
  + (t == null ? '' : `<input type="hidden" name="thanks_to" value="${t.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`)
  + '</form>').join('');
const sitemapOf = (dir, files) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map(([loc, lastmod]) => `  <url>\n    <loc>https://example.com${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`).join('\n')}
</urlset>\n`;

const dirs = [];
/** Write an output dir: { 'rel/path.html': html } plus an optional route sitemap; run the pass. */
function site(files, routeSitemap) {
  const dir = mkdtempSync(join(tmpdir(), 'noindex-pass-'));
  dirs.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  if (routeSitemap) writeFileSync(join(dir, 'sitemap.xml'), sitemapOf(dir, routeSitemap));
  const out = applyNoindex(dir);
  const read = (rel) => readFileSync(join(dir, rel), 'utf8');
  return { dir, decided: out.noindex, read, sitemap: () => read('sitemap.xml'),
    listed: () => [...read('sitemap.xml').matchAll(/<loc>https:\/\/example\.com([^<]*)<\/loc>/g)].map((m) => m[1]) };
}
const which = (files) => site(files).decided;

test('own flag: noindex: true → noindex; noindex: false and not said → not', () => {
  assert.deepEqual(which({ 'on/index.html': html({ flag: 'true' }), 'off/index.html': html({ flag: 'false' }), 'plain/index.html': html() }),
    ['on/index.html']);
});

test('a form\'s thanks target is noindex by default; an explicit noindex: false wins; the form page itself is untouched', () => {
  assert.deepEqual(which({
    'contact/index.html': html({ body: form('/thanks', '/kept/?from=order#top') }),
    'thanks/index.html': html(),
    'kept/index.html': html({ flag: 'false' }),
  }), ['thanks/index.html']);
});

// codex r1 P3: the target is the page, not its query.
test('a query/fragment target with NO flag is noindex', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/plain/?x=1#top') }), 'plain/index.html': html() }), ['plain/index.html']);
});

test('only an emitted thanks_to counts: a form with none (no thanks=, or one Form.astro refused) makes no thanks page', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form(null) }), 'thanks/index.html': html() }), []);
});

// codex r4 P2 (displaced form): a form that reached no emitted HTML is no input at all. The control
// is the same site with the form on a page that WAS emitted.
test('a thanks target counts only from a form in an emitted file — and from any emitted file, noindex or not', () => {
  assert.deepEqual(which({ 'devlog/shared/index.html': html({ title: 'Post' }), 'public/index.html': html() }), []);
  assert.deepEqual(which({ 'devlog/shared/index.html': html({ flag: 'true', body: form('/public/') }), 'public/index.html': html() }),
    ['devlog/shared/index.html', 'public/index.html']);
});

// codex r1 P2: content/thanks.fr.md is written to thanks.fr/index.html — a directory.
test('a dotted page: /thanks.fr/ and /merci.fr both land on their index.html', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/thanks.fr/', '/merci.fr') }), 'thanks.fr/index.html': html(), 'merci.fr/index.html': html() }),
    ['merci.fr/index.html', 'thanks.fr/index.html']);
});

// codex r1 P3, r4 P2 (double slash): resolved like the browser resolves it, then as a filesystem path.
test('resolved like navigation, then as a path: /./x, %-escapes, /x/index.html (the file), and x//y is the file x/y', () => {
  const s = site({
    'c/index.html': html({ body: form('/./dot-thanks', '/%74ilde', '/idx/index.html', '/x//y/') }),
    ...Object.fromEntries(['dot-thanks', 'tilde', 'idx', 'x/y'].map((n) => [`${n}/index.html`, html()])),
  });
  assert.deepEqual(s.decided, ['dot-thanks/index.html', 'idx/index.html', 'tilde/index.html', 'x/y/index.html']);
  assert.equal(fileForPath(s.dir, '/x//y/'), 'x/y/index.html');
  assert.equal(fileForPath(s.dir, '/x/y'), 'x/y/index.html');
});

test('a thanks target naming `/` or /index.html is the home page', () => {
  assert.deepEqual(which({ 'index.html': html(), 'c/index.html': html({ body: form('/') }) }), ['index.html']);
  assert.deepEqual(which({ 'index.html': html(), 'c/index.html': html({ body: form('/index.html') }) }), ['index.html']);
});

// codex r2 P2: identity is the file — /done/index.html/ (done/index.html/index.html) and /done/
// (done/index.html) are two pages; /parent/ is not the page at parent/index.html/index.html.
test('/done/index.html/ and /done/ are two files: each target reaches only its own', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/done/index.html/') }), 'done/index.html/index.html': html(), 'done/index.html.keep/index.html': html() }),
    ['done/index.html/index.html']);
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/parent/') }), 'parent/index.html/index.html': html() }), []);
});

test('no case folding: /INDEX.HTML is not index.html; a missing target matches nothing', () => {
  assert.deepEqual(which({ 'index.html': html(), 'c/index.html': html({ body: form('/INDEX.HTML', '/missing') }) }), []);
});

// codex r2 P3: each segment decoded on its own.
test('percent-encoded reserved characters name the file: /thank%26you/ → thank&you; %2F names no file', () => {
  assert.deepEqual(which({
    'c/index.html': html({ body: form('/thank%26you/', '/a%3Db/', '/a%2Fb/', '/devlog/caf%C3%A9/') }),
    'thank&you/index.html': html(), 'a=b/index.html': html(), 'a/b/index.html': html(), 'devlog/café/index.html': html(),
  }), ['a=b/index.html', 'devlog/café/index.html', 'thank&you/index.html']);
});

test('the thanks_to value is read as the visitor gets it: attribute entities decoded once', () => {
  assert.deepEqual(which({ 'c/index.html': html({ body: form('/a&b/') }), 'a&b/index.html': html() }), ['a&b/index.html']);
});

test('the robots meta takes the noindex stamp\'s place; every other byte, and every other page, is as rendered minus the stamps', () => {
  const s = site({ 'on/index.html': html({ flag: 'true' }), 'plain/index.html': html() });
  const bare = (opts) => html({ ...opts, stamp: false });
  assert.equal(s.read('on/index.html'), bare({}).replace('<meta property="og:type"', ROBOTS + '<meta property="og:type"'));
  assert.equal(s.read('plain/index.html'), bare({}));
});

test('a page with no stamp (not a [...path] view) gets robots before </head> when targeted; one that already says robots is untouched', () => {
  const s = site({ 'c/index.html': html({ body: form('/language/', '/404') }), 'language/index.html': html({ stamp: false }), '404.html': html({ stamp: false, robots: true }) });
  assert.deepEqual(s.decided, ['language/index.html']);
  assert.equal(s.read('language/index.html'), html({ stamp: false }).replace('</head>', ROBOTS + '</head>'));
  assert.equal(s.read('404.html'), html({ stamp: false, robots: true }));
});

test('stamps are read from the head only: a body that quotes one decides nothing', () => {
  assert.deepEqual(which({ 'q/index.html': html({ body: '<pre><meta name="sitetile:noindex" content="true"></pre>' }) }), []);
});

test('sitemap: the route\'s order and spelling, minus noindex files, `omit` pages, and <loc>s that name no emitted file', () => {
  const s = site({
    'index.html': html(), 'about/index.html': html(), 'on/index.html': html({ flag: 'true' }),
    'devlog/page/2/index.html': html({ sitemap: 'omit' }), 'thanks.fr/index.html': html(),
  }, [['/about/'], ['/'], ['/on/'], ['/devlog/page/2/'], ['/thanks.fr'], ['/gone/']]);
  assert.deepEqual(s.listed(), ['/about/', '/', '/thanks.fr']);
});

// codex r3/r4: the page on disk is the producer — its stamp, not whichever route claimed the URL.
test('sitemap: a file is listed by its own stamp and lastmod, once, under the first <loc> that names it', () => {
  const s = site({
    'devlog/shared/index.html': html({ sitemap: 'list 2026-01-03' }),
    'devlog/hidden/index.html': html({ sitemap: 'omit' }),
    'x/y/index.html': html({ flag: 'false' }),
  }, [['/devlog/shared/'], ['/devlog/hidden/'], ['/x/y/'], ['/devlog/shared/', '2026-01-01'], ['/x//y/', '2026-01-09']]);
  assert.equal(s.sitemap(), sitemapOf(null, [['/devlog/shared/', '2026-01-03'], ['/x/y/']]));
});

test('sitemap: a page with no stamp (a term archive) is listed only when the route names it, with the route\'s lastmod', () => {
  const s = site({ 'tag/a/index.html': html({ stamp: false }), 'author/b/index.html': html({ stamp: false }) }, [['/tag/a/']]);
  assert.deepEqual(s.listed(), ['/tag/a/']);
});

test('sitemap: a listed page the route never names is appended, spelled from its file', () => {
  const s = site({ 'index.html': html(), 'caf&é/index.html': html() }, [['/']]);
  assert.deepEqual(s.listed(), ['/', '/caf%26%C3%A9/']);
});

test('sitemap: every page noindex → a valid, empty urlset in the route\'s format', () => {
  const s = site({ 'index.html': html({ flag: 'true' }) }, [['/']]);
  assert.equal(s.sitemap(), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n</urlset>\n');
});

test('no sitemap.xml in the output → none is written', () => {
  const s = site({ 'index.html': html() });
  assert.equal(existsSync(join(s.dir, 'sitemap.xml')), false);
});

test('routeOutputFile (build-log collision naming): one file per route param; x//y is the file x/y', () => {
  assert.equal(routeOutputFile(undefined), 'index.html');
  assert.equal(routeOutputFile('about'), 'about/index.html');
  assert.equal(routeOutputFile('/about/'), 'about/index.html');
  assert.equal(routeOutputFile('done/index.html'), 'done/index.html/index.html');
  assert.equal(routeOutputFile('thank&you'), 'thank&you/index.html');
  assert.equal(routeOutputFile('x//y'), 'x/y/index.html');
  assert.equal(routeOutputFile('404'), '404.html');
});

test('noindexFlag: absent/empty → undefined; false (any case, padded) → false; any other value → true', () => {
  assert.equal(noindexFlag(undefined), undefined);
  assert.equal(noindexFlag(''), undefined);
  assert.equal(noindexFlag('false'), false);
  assert.equal(noindexFlag(' FALSE '), false);
  assert.equal(noindexFlag(false), false);
  assert.equal(noindexFlag('true'), true);
  assert.equal(noindexFlag(true), true);
  assert.equal(noindexFlag('no'), true);
});

for (const [name, fn] of pending) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(`\n${process.exitCode ? '❌' : '✅'} noindex: ${passed} passed`);
