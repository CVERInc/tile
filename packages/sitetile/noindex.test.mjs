// reef#2554 — which emitted pages are noindex.
//   run: node packages/sitetile/noindex.test.mjs
//
// One decision feeds BOTH places that must agree about it: the <meta name="robots"> on every route
// pages/[...path].astro emits, and sitemap.xml. Both ask noindexPolicy() with the route param they
// emit the page at, which it turns into the page's output file (routeOutputFile — Astro's own
// route → file steps, checked against Astro's functions below). This file tests that one decision,
// asked the way they ask it. The built-site half (blog posts, the root-mounted blog, an empty
// sitemap, the codex r2 inputs) is in astro/smoke-build.mjs.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { noindexPolicy, noindexFlag, routeOutputFile } from './astro/src/lib/noindex.mjs';
import { takeDropWarnings } from './site-core.js';

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push([name, fn]);

const page = (fm, body = '## Body\n%% sitetile: prose %%\nText.\n') =>
  `---\nsitetile-page: x\ntitle: T\n${fm}---\n\n${body}`;
const form = (params) => `## Contact\n%% sitetile: form ${params} %%\n### Your name\n`;
const thanks = (...targets) => targets.map((t) => form(`action=inbox thanks="${t}"`)).join('');
/** The route params, of those asked about, whose page the policy calls noindex (as content pages). */
const which = (glob, asked) => { const p = noindexPolicy(glob); return asked.filter((r) => p.page(r)); };

test('noindex: true → noindex; noindex: false and absent → not', () => {
  assert.deepEqual(which({
    '/b/content/on.md': page('noindex: true\n'),
    '/b/content/off.md': page('noindex: false\n'),
    '/b/content/plain.md': page(''),
  }, ['on', 'off', 'plain']), ['on']);
});

test('a form\'s thanks= target is noindex by default; an explicit noindex: false wins', () => {
  assert.deepEqual(which({
    '/b/content/contact.md': page('', thanks('/thanks')),
    '/b/content/order.md': page('', thanks('/kept/?from=order#top')),
    '/b/content/thanks.md': page(''),
    '/b/content/kept.md': page('noindex: false\n'),
  }, ['thanks', 'kept', 'contact', 'order']), ['thanks']);
});

// codex r1 P3: a target with no key, so a target that kept its `?…#…` would leave it indexed.
test('a query/fragment target with NO noindex key is noindex (the target is the page, not its query)', () => {
  assert.deepEqual(which({
    '/b/content/c.md': page('', thanks('/plain/?x=1#top')),
    '/b/content/plain.md': page(''),
  }, ['plain']), ['plain']);
});

test('the form page itself is untouched — only the page it sends a visitor to', () => {
  const p = noindexPolicy({ '/b/content/contact.md': page('', thanks('/thanks')), '/b/content/thanks.md': page('') });
  assert.equal(p.page('contact'), false);
  assert.equal(p.page('thanks'), true);
});

test('thanks= without action=inbox is never wired (Form.astro), so it makes no thanks page', () => {
  assert.deepEqual(which({
    '/b/content/contact.md': page('', form('action=https://example.test/x thanks=/thanks')),
    '/b/content/thanks.md': page(''),
  }, ['thanks']), []);
});

test('an off-site or invalid thanks= is dropped like Form.astro drops it — and records NO second drop warning', () => {
  takeDropWarnings();
  assert.deepEqual(which({
    '/b/content/contact.md': page('', form('action=inbox thanks=https://example.test/thanks')),
    '/b/content/c2.md': page('', form('action=inbox thanks=//evil.example/thanks')),
    '/b/content/thanks.md': page(''),
  }, ['thanks']), []);
  assert.deepEqual(takeDropWarnings(), [], 'the build-time reader must not double the diagnostics queue Form.astro owns');
});

test('a locale target matches the locale page; a locale form naming a base path hits the base page', () => {
  assert.deepEqual(which({
    '/b/content/zh-tw/contact.md': page('', thanks('/form-thanks-landing', '/zh-tw/thanks')),
    '/b/content/zh-tw/thanks.md': page(''),
    '/b/content/form-thanks-landing.md': page(''),
  }, ['form-thanks-landing', 'zh-tw/thanks', 'zh-tw/contact']), ['form-thanks-landing', 'zh-tw/thanks']);
});

// codex r1 P2: content/thanks.fr.md is written to thanks.fr/index.html — a directory, not a file
// with an `.fr` extension — so /thanks.fr and /thanks.fr/ both land on it.
test('a dotted (locale-suffixed) page: thanks=/thanks.fr/ and thanks=/merci.fr both land on its index.html', () => {
  const p = noindexPolicy({
    '/b/content/contact.md': page('', thanks('/thanks.fr/', '/merci.fr')),
    '/b/content/thanks.fr.md': page('lang: fr\n'),
    '/b/content/merci.fr.md': page(''),
  });
  assert.equal(p.page('thanks.fr'), true);
  assert.equal(p.page('merci.fr'), true);
});

// codex r1 P3: the target is matched where a browser's navigation lands, not as typed.
test('thanks= is resolved like navigation: /./x, \\ separators, %-escapes, /x/index.html (the file) — a refused `..` stays refused', () => {
  const p = noindexPolicy({
    '/b/content/c.md': page('', thanks('/./dot-thanks', '/a/../up-thanks', '/thanks\\sub', '/%74ilde', '/idx/index.html')),
    ...Object.fromEntries(['dot-thanks', 'up-thanks', 'thanks/sub', 'tilde', 'idx'].map((n) => [`/b/content/${n}.md`, page('')])),
  });
  for (const r of ['dot-thanks', 'thanks/sub', 'tilde', 'idx']) assert.equal(p.page(r), true, r);
  assert.equal(p.page('up-thanks'), false, 'safeInternalPath refuses a `..` target; normalising must not bring it back');
});

// codex r1 P2: blog routes have no content file of their own; the decision is asked by the file a
// route is written to, so a post is a page like any other.
test('a thanks= on a blog post (base or locale) makes that post noindex; its neighbour is not', () => {
  const p = noindexPolicy({ '/b/content/c.md': page('', thanks('/devlog/thank-post/', '/zh-tw/devlog/thank-post')) });
  assert.equal(p.post('devlog/thank-post', {}), true);
  assert.equal(p.post('zh-tw/devlog/thank-post', {}), true);
  assert.equal(p.post('devlog/other-post', {}), false);
});

// codex r2 P2 (post opt-out): the post's own frontmatter is the post's own flag.
test('a post\'s own noindex: false wins over a thanks= that lands on it; its own noindex: true needs no form', () => {
  const p = noindexPolicy({ '/b/content/contact.md': page('', thanks('/devlog/kept/')) });
  assert.equal(p.post('devlog/kept', { noindex: false }), false);
  assert.equal(p.post('devlog/kept', { noindex: 'false' }), false);
  assert.equal(p.post('devlog/kept', {}), true, 'control: the same target with no flag is noindex');
  assert.equal(p.post('devlog/private', { noindex: true }), true);
  assert.equal(p.post('devlog/private', {}), false);
});

test('a root-mounted blog index is decided at index.html, where home.md would be written — so home\'s own flag is its own', () => {
  assert.equal(noindexPolicy({ '/b/content/home.md': page('packages: blog\nblog-path: /\nnoindex: true\n') }).page(undefined), true);
  assert.equal(noindexPolicy({ '/b/content/home.md': page('packages: blog\nblog-path: /\n') }).page(undefined), false);
  assert.equal(noindexPolicy({ '/b/content/home.md': page('noindex: false\n'), '/b/content/c.md': page('', thanks('/')) }).page(undefined), false);
});

test('a thanks= naming the home page noindexes `/`; /index.html is that same file', () => {
  assert.deepEqual(which({ '/b/content/home.md': page(''), '/b/content/c.md': page('', thanks('/')) }, [undefined, 'c']), [undefined]);
  assert.deepEqual(which({ '/b/content/home.md': page(''), '/b/content/c.md': page('', thanks('/index.html')) }, [undefined, 'c']), [undefined]);
});

// codex r2 P2 (index.html folding): identity is the file, so a route at /done/index.html/ (file
// done/index.html/index.html) and a route at /done/ (file done/index.html) are two pages.
test('/done/index.html/ and /done/ are two files: each target reaches only its own', () => {
  const exact = noindexPolicy({ '/b/content/c.md': page('', thanks('/done/index.html/')) });
  assert.equal(exact.post('done/index.html', {}), true);
  assert.equal(exact.post('done', {}), false);
  const dir = noindexPolicy({ '/b/content/c.md': page('', thanks('/done/')) });
  assert.equal(dir.post('done', {}), true);
  assert.equal(dir.post('done/index.html', {}), false);
  // and the content-file form of the same thing (content/parent/index.html.md)
  assert.deepEqual(which({ '/b/content/c.md': page('', thanks('/parent/')), '/b/content/parent/index.html.md': page('') },
    ['parent/index.html', 'parent']), ['parent']);
});

test('no case folding: thanks=/INDEX.HTML is not index.html, and a missing target suppresses nothing', () => {
  assert.deepEqual(which({ '/b/content/home.md': page(''), '/b/content/c.md': page('', thanks('/INDEX.HTML')) }, [undefined, 'c']), []);
  assert.deepEqual(which({ '/b/content/c.md': page('', thanks('/Thanks/')), '/b/content/thanks.md': page('') }, ['thanks']), []);
});

// codex r2 P3: decodeURI keeps %26; each segment is decoded with decodeURIComponent.
test('percent-encoded reserved characters name the file: /thank%26you/ → thank&you; %2F names no file', () => {
  assert.deepEqual(which({ '/b/content/c.md': page('', thanks('/thank%26you/')), '/b/content/thank&you.md': page('') }, ['thank&you']), ['thank&you']);
  assert.deepEqual(which({ '/b/content/c.md': page('', thanks('/a%3Db/')), '/b/content/a=b.md': page('') }, ['a=b']), ['a=b']);
  assert.deepEqual(which({ '/b/content/c.md': page('', thanks('/a%2Fb/')), '/b/content/a/b.md': page('') }, ['a/b']), []);
  assert.deepEqual(which({ '/b/content/c.md': page('', thanks('/devlog/caf%C3%A9/')) }, ['devlog/café']), ['devlog/café']);
});

test('a thanks= at a page that does not exist is harmless: no route writes that file, so nothing matches', () => {
  const p = noindexPolicy({ '/b/content/c.md': page('', thanks('/missing')) });
  assert.equal(p.page('c'), false);
  assert.equal(p.page(undefined), false);
});

test('site data (_site.md / _theme.md) and non-site files are never pages here', () => {
  assert.deepEqual(which({
    '/b/content/_site.md': page('noindex: true\n'),
    '/b/content/_theme.md': page('noindex: true\n'),
    '/b/content/notes.md': '# not a sitetile page\nnoindex: true\n',
  }, ['_site', '_theme', 'notes', undefined]), []);
});

test('a page\'s noindex is its OWN frontmatter — a `noindex:` in _site.md does not blanket the site', () => {
  assert.deepEqual(which({ '/b/content/_site.md': '---\nnoindex: true\n---\n', '/b/content/about.md': page('') }, ['about', undefined]), []);
});

const PARAMS = [undefined, '', 'about', '/about/', 'legal/terms', 'thanks.fr', 'done/index.html', 'INDEX.HTML',
  'thank&you', 'a#b', 'a?b', 'café', 'café', '404', '500', 'fr/404', '//x', 'x//', 'devlog/page/2'];
test('routeOutputFile: one file per route param, as the build writes it', () => {
  assert.equal(routeOutputFile(undefined), 'index.html');
  assert.equal(routeOutputFile('about'), 'about/index.html');
  assert.equal(routeOutputFile('done/index.html'), 'done/index.html/index.html');
  assert.equal(routeOutputFile('thanks.fr'), 'thanks.fr/index.html');
  assert.equal(routeOutputFile('thank&you'), 'thank&you/index.html');
  assert.equal(routeOutputFile('404'), '404.html');
});

// The mirror is only as good as its agreement with the code it mirrors: Astro's own stringifyParams
// + getOutputFilename (internal modules, imported by file path) over the same params. Needs
// packages/sitetile/astro/node_modules, and names itself SKIPPED without it, like the astro smoke.
const ASTRO = new URL('./astro/node_modules/astro/dist/core/', import.meta.url);
if (existsSync(new URL('output-filename.js', ASTRO))) {
  const { getOutputFilename } = await import(new URL('output-filename.js', ASTRO));
  const { stringifyParams } = await import(new URL('routing/params.js', ASTRO));
  const { getParts } = await import(new URL('routing/parts.js', ASTRO)).catch(() => ({}));
  test('routeOutputFile agrees with Astro\'s own stringifyParams + getOutputFilename on every param', () => {
    const segments = getParts ? [getParts('[...path]', 'src/pages/[...path].astro')] : [[{ content: '...path', dynamic: true, spread: true }]];
    const route = { type: 'page', route: '/[...path]', component: 'src/pages/[...path].astro', segments, isIndex: false };
    for (const p of PARAMS) {
      const pathname = stringifyParams({ path: p }, route, 'ignore');
      assert.equal(routeOutputFile(p), getOutputFilename('directory', pathname, route).replace(/^\//, ''), JSON.stringify(p));
    }
  });
} else {
  console.log('  · routeOutputFile ↔ Astro parity SKIPPED — no packages/sitetile/astro/node_modules');
}

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
console.log(`\n${process.exitCode ? '❌' : '✅'} noindex: ${passed} passed`);
