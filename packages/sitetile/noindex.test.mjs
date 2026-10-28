// reef#2554 — which content pages are noindex.
//   run: node packages/sitetile/noindex.test.mjs
//
// One list feeds BOTH places that must agree about it: the page's <meta name="robots"> (via
// pages/[...path].astro) and sitemap.xml. A page that says noindex in its head while the sitemap
// still hands it to crawlers is two declarations about one URL, differing — so both read
// noindexUrls(), and this file tests that one function.

import assert from 'node:assert/strict';
import { noindexUrls, noindexFlag } from './astro/src/lib/noindex.mjs';
import { contentUrls } from './astro/src/lib/sitemap.mjs';
import { isSiteFile, takeDropWarnings } from './site-core.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const page = (fm, body = '## Body\n%% sitetile: prose %%\nText.\n') =>
  `---\nsitetile-page: x\ntitle: T\n${fm}---\n\n${body}`;
const form = (params) => `## Contact\n%% sitetile: form ${params} %%\n### Your name\n`;
const META = { locales: 'en-US, zh-TW' };
const urls = (glob) => [...noindexUrls(glob, META)].sort();

test('noindex: true → listed; noindex: false and absent → not', () => {
  assert.deepEqual(urls({
    '/b/content/on.md': page('noindex: true\n'),
    '/b/content/off.md': page('noindex: false\n'),
    '/b/content/plain.md': page(''),
  }), ['/on/']);
});

test('a form\'s thanks= target is noindex by default; an explicit noindex: false wins', () => {
  assert.deepEqual(urls({
    '/b/content/contact.md': page('', form('action=inbox thanks=/thanks')),
    '/b/content/order.md': page('', form('action=inbox thanks=/kept/?from=order#top')),
    '/b/content/thanks.md': page(''),
    '/b/content/kept.md': page('noindex: false\n'),
  }), ['/thanks/']);
});

test('the form page itself is untouched — only the page it sends a visitor to', () => {
  const got = urls({ '/b/content/contact.md': page('', form('action=inbox thanks=/thanks')), '/b/content/thanks.md': page('') });
  assert.ok(!got.includes('/contact/'));
});

test('thanks= without action=inbox is never wired (Form.astro), so it makes no thanks page', () => {
  assert.deepEqual(urls({
    '/b/content/contact.md': page('', form('action=https://example.test/x thanks=/thanks')),
    '/b/content/thanks.md': page(''),
  }), []);
});

test('an off-site or invalid thanks= is dropped like Form.astro drops it — and records NO second drop warning', () => {
  takeDropWarnings();
  assert.deepEqual(urls({
    '/b/content/contact.md': page('', form('action=inbox thanks=https://example.test/thanks')),
    '/b/content/c2.md': page('', form('action=inbox thanks=//evil.example/thanks')),
    '/b/content/thanks.md': page(''),
  }), []);
  assert.deepEqual(takeDropWarnings(), [], 'the build-time reader must not double the diagnostics queue Form.astro owns');
});

test('a locale target matches the locale page URL; a locale form naming a base path hits the base page', () => {
  assert.deepEqual(urls({
    '/b/content/zh-tw/contact.md': page('', form('action=inbox thanks=/form-thanks-landing') + form('action=inbox thanks=/zh-tw/thanks')),
    '/b/content/zh-tw/thanks.md': page(''),
    '/b/content/form-thanks-landing.md': page(''),
  }), ['/form-thanks-landing/', '/zh-tw/thanks/']);
});

test('a thanks= naming the home page noindexes `/`', () => {
  assert.deepEqual(urls({ '/b/content/home.md': page(''), '/b/content/c.md': page('', form('action=inbox thanks=/')) }), ['/']);
});

test('site data (_site.md / _theme.md) and non-site files are never pages here', () => {
  assert.deepEqual(urls({
    '/b/content/_site.md': page('noindex: true\n'),
    '/b/content/_theme.md': page('noindex: true\n'),
    '/b/content/notes.md': '# not a sitetile page\nnoindex: true\n',
  }), []);
});

test('a page\'s noindex is its OWN frontmatter — a `noindex:` in _site.md does not blanket the site', () => {
  assert.deepEqual(urls({ '/b/content/_site.md': '---\nnoindex: true\n---\n', '/b/content/about.md': page('') }), []);
});

test('every URL it returns is one contentUrls() emits for that file (same router rules)', () => {
  const glob = { '/b/content/zh-tw.md': page('noindex: true\n'), '/b/content/legal/terms.md': page('noindex: true\n') };
  const got = urls(glob);
  assert.deepEqual(got, contentUrls(glob, META, isSiteFile));
});

test('noindexFlag: absent/empty → undefined; false → false; any other value → true (the `blog-*-routes` convention)', () => {
  assert.equal(noindexFlag(undefined), undefined);
  assert.equal(noindexFlag(''), undefined);
  assert.equal(noindexFlag('false'), false);
  assert.equal(noindexFlag(' FALSE '), false);
  assert.equal(noindexFlag(false), false);
  assert.equal(noindexFlag('true'), true);
  assert.equal(noindexFlag(true), true);
});

console.log(`\n${process.exitCode ? '❌' : '✅'} noindex: ${passed} passed`);
