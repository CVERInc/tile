// round 5 (R4-P1-1): unit-level proof that blog.mjs's URL builders gate an author-controlled
// destination AT THE HELPER'S RETURN — postUrl() (permalink + blog-url-pattern), blogBase()
// (blog-path), categoryBase()/tagBase() (blog-category-base/blog-tag-base). The astro smoke
// (smoke-build.mjs) proves the same fix end-to-end through a real build's HTML/rss/sitemap; this
// file exists because two of these four fields (blog-category-base/blog-tag-base) only reach a
// LIVE href through a pager link that needs more than one archive page to even render — a
// real-build assertion could pass by accident (no pager, no assertion fired) while the function
// itself stayed ungated. Testing the function directly has no such blind spot.
//   run: node packages/sitetile/blog-url-gating.test.mjs   (wired into scripts/test.sh)
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve
// on its own — same shim as blog-unlisted.test.mjs et al. Resolves to the REAL site-core.js (not
// a stub), so safeHref/safeSrc/takeDropWarnings here are the exact functions the build uses.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

const { blogBase, postUrl, categoryBase, tagBase, authorBase } = await import('./astro/src/lib/blog.mjs');
const { takeDropWarnings } = await import('./site-core.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

takeDropWarnings(); // drain whatever an earlier import-time render left queued, so counts below start at 0

// ---- blogBase (blog-path) ----
test('blogBase: unset → the historic /devlog default (Phase 1 "pure refactor" byte-identity)', () => {
  assert.equal(blogBase(undefined), '/devlog');
  assert.equal(blogBase({}), '/devlog');
});
test('blogBase: a safe custom path is kept verbatim — the fix must not touch a site that configured nothing hostile', () => {
  assert.equal(blogBase({ 'blog-path': '/diary' }), '/diary');
});
test('blogBase: root mount ("" / "/") is still distinct from "unset" — both are legitimate, neither is a drop', () => {
  assert.equal(blogBase({ 'blog-path': '' }), '');
  assert.equal(blogBase({ 'blog-path': '/' }), '');
});
test('🔴 blogBase: a disallowed scheme degrades to the historic default, not to the raw value', () => {
  takeDropWarnings();
  assert.equal(blogBase({ 'blog-path': 'javascript:void(0)' }), '/devlog');
  const drops = takeDropWarnings();
  assert.equal(drops.length, 1, 'the disallowed blog-path must be recorded as a drop');
  assert.equal(drops[0].scheme, 'javascript:');
});
test('blogBase: vbscript:/data:text/html degrade the same way', () => {
  assert.equal(blogBase({ 'blog-path': 'vbscript:msgbox(1)' }), '/devlog');
  assert.equal(blogBase({ 'blog-path': 'data:text/html,<script>1</script>' }), '/devlog');
});

// ---- postUrl (permalink, blog-url-pattern) ----
const post = (extra) => ({ slug: 'my-post', date: '2026-01-05', title: 'x', tags: [], ...extra });

test('postUrl: no permalink, no pattern → the historic ${base}/%postname% default, byte-identical', () => {
  assert.equal(postUrl(post({}), {}), '/devlog/my-post');
});
test('postUrl: a safe absolute permalink override is honoured verbatim (the documented "odd source URL" escape hatch)', () => {
  assert.equal(postUrl(post({ permalink: 'https://old-site.example/2019/01/my-post/' }), {}), 'https://old-site.example/2019/01/my-post/');
});
test('🔴 postUrl: a disallowed permalink falls through to the pattern-based URL, not to the raw value', () => {
  takeDropWarnings();
  assert.equal(postUrl(post({ permalink: 'javascript:void(0)' }), {}), '/devlog/my-post');
  assert.ok(takeDropWarnings().some((d) => d.scheme === 'javascript:'), 'the disallowed permalink must be recorded as a drop');
});
test('🔴 postUrl: a disallowed blog-url-pattern (site-wide) falls through to the canonical ${base}/<slug>, for a post with NO permalink of its own', () => {
  const meta = { 'blog-url-pattern': 'javascript:void(0)#%postname%' };
  assert.equal(postUrl(post({}), meta), '/devlog/my-post');
});
test('🔴 postUrl: permalink AND blog-url-pattern both disallowed still degrades to a real, internal URL — never blank, never the raw scheme', () => {
  const meta = { 'blog-url-pattern': 'javascript:void(0)#%postname%' };
  const url = postUrl(post({ permalink: 'javascript:alert(1)' }), meta);
  assert.equal(url, '/devlog/my-post');
  assert.doesNotMatch(url, /javascript:/i);
});
test('postUrl: a disallowed blog-url-pattern with a SAFE custom blog-path falls back to THAT base, not to /devlog — the fallback preserves the site\'s real config, it does not reset it', () => {
  const meta = { 'blog-path': '/diary', 'blog-url-pattern': 'javascript:void(0)#%postname%' };
  assert.equal(postUrl(post({}), meta), '/diary/my-post');
});
test('postUrl: a safe custom blog-url-pattern still expands its WP tokens normally (the fix gates the RESULT, it does not disable template expansion)', () => {
  const meta = { 'blog-url-pattern': '/blog/%year%/%monthnum%/%postname%' };
  assert.equal(postUrl(post({}), meta), '/blog/2026/01/my-post');
});

// ---- categoryBase / tagBase / authorBase (blog-category-base / blog-tag-base / blog-author-base) ----
test('categoryBase/tagBase/authorBase: unset → the historic /category, /tag, /author defaults', () => {
  assert.equal(categoryBase(undefined), '/category');
  assert.equal(tagBase(undefined), '/tag');
  assert.equal(authorBase(undefined), '/author');
});
test('categoryBase/tagBase/authorBase: a safe custom base is kept verbatim', () => {
  assert.equal(categoryBase({ 'blog-category-base': '/topics' }), '/topics');
  assert.equal(tagBase({ 'blog-tag-base': '/label' }), '/label');
  assert.equal(authorBase({ 'blog-author-base': '/by' }), '/by');
});
test('🔴 categoryBase/tagBase/authorBase: a disallowed scheme degrades to the historic default — the term-archive-URLs shape R4-P1-1 named', () => {
  takeDropWarnings();
  assert.equal(categoryBase({ 'blog-category-base': 'javascript:void(0)' }), '/category');
  assert.equal(tagBase({ 'blog-tag-base': 'javascript:alert(1)' }), '/tag');
  assert.equal(authorBase({ 'blog-author-base': 'javascript:alert(2)' }), '/author');
  const drops = takeDropWarnings();
  assert.equal(drops.length, 3, 'all three disallowed bases must be recorded as drops');
});

console.log(`\nblog-url-gating: ${passed} passed${process.exitCode ? ', SOME FAILED' : ', all green'}`);
