// reef#2554 — which emitted pages are noindex.
//   run: node packages/sitetile/noindex.test.mjs
//
// One decision feeds BOTH places that must agree about it: the <meta name="robots"> on every route
// pages/[...path].astro emits, and sitemap.xml. Both ask noindexPolicy() about the page they emit,
// by the path it lands at — so this file tests that one function, asked the way they ask it. The
// built-site half (blog posts, the root-mounted blog, an empty sitemap) is in astro/smoke-build.mjs.

import assert from 'node:assert/strict';
import { noindexPolicy, noindexFlag, pageIdentity } from './astro/src/lib/noindex.mjs';
import { takeDropWarnings } from './site-core.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const page = (fm, body = '## Body\n%% sitetile: prose %%\nText.\n') =>
  `---\nsitetile-page: x\ntitle: T\n${fm}---\n\n${body}`;
const form = (params) => `## Contact\n%% sitetile: form ${params} %%\n### Your name\n`;
/** The identities, of those asked about, that the policy calls noindex. */
const which = (glob, asked) => { const is = noindexPolicy(glob); return asked.filter((p) => is(p)); };

test('noindex: true → noindex; noindex: false and absent → not', () => {
  assert.deepEqual(which({
    '/b/content/on.md': page('noindex: true\n'),
    '/b/content/off.md': page('noindex: false\n'),
    '/b/content/plain.md': page(''),
  }, ['/on/', '/off/', '/plain/']), ['/on/']);
});

test('a form\'s thanks= target is noindex by default; an explicit noindex: false wins', () => {
  assert.deepEqual(which({
    '/b/content/contact.md': page('', form('action=inbox thanks=/thanks')),
    '/b/content/order.md': page('', form('action=inbox thanks=/kept/?from=order#top')),
    '/b/content/thanks.md': page(''),
    '/b/content/kept.md': page('noindex: false\n'),
  }, ['/thanks/', '/kept/', '/contact/', '/order/']), ['/thanks/']);
});

// codex r1 P3: the case above only proved `kept` stays indexed, which it does whether the
// query/fragment is stripped or the target is missed outright. This one has no key, so a target
// that kept its `?…#…` would leave it indexed.
test('a query/fragment target with NO noindex key is noindex (the target is the page, not its query)', () => {
  assert.deepEqual(which({
    '/b/content/c.md': page('', form('action=inbox thanks=/plain/?x=1#top')),
    '/b/content/plain.md': page(''),
  }, ['/plain/']), ['/plain/']);
});

test('the form page itself is untouched — only the page it sends a visitor to', () => {
  const is = noindexPolicy({ '/b/content/contact.md': page('', form('action=inbox thanks=/thanks')), '/b/content/thanks.md': page('') });
  assert.equal(is('/contact/'), false);
  assert.equal(is('/thanks/'), true);
});

test('thanks= without action=inbox is never wired (Form.astro), so it makes no thanks page', () => {
  assert.deepEqual(which({
    '/b/content/contact.md': page('', form('action=https://example.test/x thanks=/thanks')),
    '/b/content/thanks.md': page(''),
  }, ['/thanks/']), []);
});

test('an off-site or invalid thanks= is dropped like Form.astro drops it — and records NO second drop warning', () => {
  takeDropWarnings();
  assert.deepEqual(which({
    '/b/content/contact.md': page('', form('action=inbox thanks=https://example.test/thanks')),
    '/b/content/c2.md': page('', form('action=inbox thanks=//evil.example/thanks')),
    '/b/content/thanks.md': page(''),
  }, ['/thanks/']), []);
  assert.deepEqual(takeDropWarnings(), [], 'the build-time reader must not double the diagnostics queue Form.astro owns');
});

test('a locale target matches the locale page; a locale form naming a base path hits the base page', () => {
  assert.deepEqual(which({
    '/b/content/zh-tw/contact.md': page('', form('action=inbox thanks=/form-thanks-landing') + form('action=inbox thanks=/zh-tw/thanks')),
    '/b/content/zh-tw/thanks.md': page(''),
    '/b/content/form-thanks-landing.md': page(''),
  }, ['/form-thanks-landing/', '/zh-tw/thanks/', '/zh-tw/contact/']), ['/form-thanks-landing/', '/zh-tw/thanks/']);
});

// codex r1 P2: content/thanks.fr.md lands at thanks.fr/index.html, but the old reader keyed it by
// sitemap's canonicalPath, which reads `.fr` as a file extension → `/thanks.fr`, never equal to
// the target `/thanks.fr/`. One identity for both sides, in every spelling a consumer might use.
test('a dotted (locale-suffixed) page is one identity: /thanks.fr, /thanks.fr/, /thanks.fr/index.html', () => {
  const is = noindexPolicy({
    '/b/content/contact.md': page('', form('action=inbox thanks=/thanks.fr/')),
    '/b/content/thanks.fr.md': page('lang: fr\n'),
    '/b/content/c2.md': page('', form('action=inbox thanks=/merci.fr')),
    '/b/content/merci.fr.md': page(''),
  });
  for (const p of ['/thanks.fr', '/thanks.fr/', '/thanks.fr/index.html', '/merci.fr', '/merci.fr/']) assert.equal(is(p), true, p);
});

// codex r1 P3: the target is matched where a browser's navigation lands, not as typed.
test('thanks= is resolved like navigation: /./x, \\ separators, %-escapes, /x/index.html — a refused `..` stays refused', () => {
  const is = noindexPolicy({
    '/b/content/c.md': page('', ['/./dot-thanks', '/a/../up-thanks', '/thanks\\sub', '/%74ilde', '/idx/index.html'].map((t) => form(`action=inbox thanks="${t}"`)).join('')),
    ...Object.fromEntries(['dot-thanks', 'up-thanks', 'thanks/sub', 'tilde', 'idx'].map((n) => [`/b/content/${n}.md`, page('')])),
  });
  for (const p of ['/dot-thanks/', '/thanks/sub/', '/tilde/', '/idx/']) assert.equal(is(p), true, p);
  assert.equal(is('/up-thanks/'), false, 'safeInternalPath refuses a `..` target; normalising must not bring it back');
});

// codex r1 P2: blog routes have no content file of their own, so the r1 reader (which only knew
// content-file URLs) dropped these targets. The decision is asked by emitted path, so a post is a
// page like any other.
test('a thanks= on a blog post (base or locale) makes that post noindex; its neighbour is not', () => {
  const is = noindexPolicy({
    '/b/content/c.md': page('', form('action=inbox thanks=/devlog/thank-post/') + form('action=inbox thanks=/zh-tw/devlog/thank-post/')),
  });
  assert.equal(is('/devlog/thank-post/'), true);
  assert.equal(is('/devlog/thank-post'), true);
  assert.equal(is('/zh-tw/devlog/thank-post/'), true);
  assert.equal(is('/devlog/other-post/'), false);
});

test('a root-mounted blog index is asked at `/`, where home.md lands — so home\'s noindex reaches it', () => {
  assert.equal(noindexPolicy({ '/b/content/home.md': page('packages: blog\nblog-path: /\nnoindex: true\n') })('/'), true);
  assert.equal(noindexPolicy({ '/b/content/home.md': page('packages: blog\nblog-path: /\n') })('/'), false);
});

test('a thanks= naming the home page noindexes `/`', () => {
  assert.deepEqual(which({ '/b/content/home.md': page(''), '/b/content/c.md': page('', form('action=inbox thanks=/')) }, ['/', '/c/']), ['/']);
});

test('a thanks= at a page that does not exist is harmless: only a page someone asks about is decided', () => {
  const is = noindexPolicy({ '/b/content/c.md': page('', form('action=inbox thanks=/missing')) });
  assert.equal(is('/c/'), false);
  assert.equal(is('/missing/'), true);   // nobody emits /missing, so nobody asks — no phantom page
});

test('site data (_site.md / _theme.md) and non-site files are never pages here', () => {
  assert.deepEqual(which({
    '/b/content/_site.md': page('noindex: true\n'),
    '/b/content/_theme.md': page('noindex: true\n'),
    '/b/content/notes.md': '# not a sitetile page\nnoindex: true\n',
  }, ['/_site/', '/_theme/', '/notes/', '/']), []);
});

test('a page\'s noindex is its OWN frontmatter — a `noindex:` in _site.md does not blanket the site', () => {
  assert.deepEqual(which({ '/b/content/_site.md': '---\nnoindex: true\n---\n', '/b/content/about.md': page('') }, ['/about/', '/']), []);
});

test('pageIdentity: every spelling of one page is one identity', () => {
  assert.equal(pageIdentity(undefined), '/');
  assert.equal(pageIdentity('/'), '/');
  assert.equal(pageIdentity('/index.html'), '/');
  assert.equal(pageIdentity('legal/terms'), '/legal/terms/');
  assert.equal(pageIdentity('/a/?q=1#f'), '/a/');
  assert.equal(pageIdentity('/a.zh-tw'), '/a.zh-tw/');
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

console.log(`\n${process.exitCode ? '❌' : '✅'} noindex: ${passed} passed`);
