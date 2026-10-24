// reef#2160 — the inbox bubble searches the site from inside the browser, so the index it reads
// must exist whenever the bubble can draw, not only when the header magnifier is on.
//   run: node --test packages/sitetile/bubble-search-index.test.mjs
//
// 🩸 Measured 2026-10-18: tniop's /search-index.json carried 1,410 rows; cver's and another live site's were
// `[]`. All three have a blog and all three draw the bubble. The index was gated on `blog-search`
// (the header magnifier's switch) alone, so a bubble opened on cver had nothing to filter.
//
// The privacy verdict does not move: the same `listedPosts` corpus and the same `publicFacing`
// projection RSS uses. private-artifacts.test.mjs keeps proving that for `blog-search: true`; this
// file proves the new condition (bubble on, blog-search off) goes through the same gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro/src');
const SITE_CORE = pathToFileURL(join(HERE, 'site-core.js')).href;

register(
  'data:text/javascript,' + encodeURIComponent(
    `export function resolve(spec, ctx, next) {
       if (spec === '@sitetile') return { url: ${JSON.stringify(SITE_CORE)}, shortCircuit: true };
       return next(spec, ctx);
     }`),
  import.meta.url,
);

const blog = await import(pathToFileURL(join(SRC, 'lib/blog.mjs')).href);
const { allPosts } = blog;
const { buildSearchIndexBody } = await import(pathToFileURL(join(SRC, 'lib/public-artifacts.mjs')).href);
const { bubbleSearchOn } = await import(pathToFileURL(join(SRC, 'lib/inbox-bubble.mjs')).href);

const SENTINEL = 'QUARTZLINE-93715-PAIDWORDS';
// Only the gated post carries the sentinel, so a count of it in any artifact is that post's doing.
const post = (title, visibility, mark) => [
  '---',
  `title: ${title}`,
  `description: ${mark} teaser`,
  'pubDate: 2026-08-20',
  'tags: [alpha]',
  ...(visibility ? [`visibility: ${visibility}`] : []),
  '---',
  '',
  `${mark} body paragraph.`,
  '',
].join('\n');

const corpus = (visibility) => allPosts({
  '../../blog/gated-one.md': post('The Gated One', visibility, SENTINEL),
  '../../blog/open-one.md': post('The Open One', '', 'open'),
});

// A site like cver on 2026-10-18: a blog, the bubble at its default (on), NO `blog-search`.
const BUBBLE_ONLY = { title: 'Fixture Site', packages: 'blog', 'blog-search-body': 'true' };

const rows = (body) => JSON.parse(body);
const hits = (haystack) => haystack.split(SENTINEL).length - 1;

test('🔴 blog + bubble on + blog-search off emits the posts, not []', () => {
  const body = buildSearchIndexBody(corpus(), BUBBLE_ONLY);
  assert.notEqual(body, '[]', 'the index is gated on the header magnifier alone — the bubble has nothing to filter');
  assert.deepEqual(rows(body).map((r) => r.t).sort(), ['The Gated One', 'The Open One']);
  for (const r of rows(body)) assert.equal(typeof r.u, 'string');
});

test('🔴 a private post is still redacted in the bubble-only index (same verdict as RSS)', () => {
  const privateBody = buildSearchIndexBody(corpus('private'), BUBBLE_ONLY);
  assert.notEqual(privateBody, '[]');
  assert.equal(hits(privateBody), 0, `bubble-only index leaked the gated body:\n${privateBody}`);
  assert.ok(privateBody.includes('The Gated One'), 'the gated post is named, its content withheld');
  // control: same post, public, same serializer — the sentinel does travel
  assert.ok(hits(buildSearchIndexBody(corpus('public'), BUBBLE_ONLY)) > 0, 'control failed: the public build carries no sentinel');
});

test('the owner can turn the bubble search off in one line, and an off bubble emits [] too', () => {
  assert.equal(buildSearchIndexBody(corpus(), { ...BUBBLE_ONLY, 'inbox-bubble-search': 'off' }), '[]');
  assert.equal(buildSearchIndexBody(corpus(), { ...BUBBLE_ONLY, 'inbox-bubble': 'off' }), '[]');
  // but the header magnifier's own switch still wins on its own, as before
  assert.notEqual(buildSearchIndexBody(corpus(), { ...BUBBLE_ONLY, 'inbox-bubble': 'off', 'blog-search': 'true' }), '[]');
});

// The header magnifier's index must not notice the bubble: with `blog-search` on, every bubble
// switch yields the bytes the magnifier alone produced before reef#2160 (searchIndex, stringified).
// A later change that trims rows "for the bubble" (drops `e`, caps rows) would fail here first.
test('blog-search on: the index is byte-identical whatever the bubble switches say', () => {
  const { searchIndex } = blog;
  for (const extra of [{}, { 'blog-search-body': 'true', 'blog-search-excerpt-chars': '20' }]) {
    const header = { ...BUBBLE_ONLY, 'blog-search': 'true', ...extra };
    const before = JSON.stringify(searchIndex(corpus(), header));
    for (const bubble of [{}, { 'inbox-bubble': 'off' }, { 'inbox-bubble-search': 'off' }, { 'inbox-bubble': 'on', 'inbox-bubble-search': 'on' }]) {
      assert.equal(buildSearchIndexBody(corpus(), { ...header, ...bubble }), before,
        `the header magnifier's index changed under bubble switches ${JSON.stringify(bubble)}`);
    }
  }
});

test('a site without a blog still emits []', () => {
  assert.equal(buildSearchIndexBody(allPosts({}), BUBBLE_ONLY), '[]');
  assert.equal(buildSearchIndexBody([], BUBBLE_ONLY), '[]');
});

test('bubbleSearchOn: default on, off by either switch, site-level only', () => {
  assert.equal(bubbleSearchOn({}), true);
  assert.equal(bubbleSearchOn({ 'inbox-bubble': 'off' }), false);
  assert.equal(bubbleSearchOn({ 'inbox-bubble-search': 'off' }), false);
  assert.equal(bubbleSearchOn({ 'inbox-bubble-search': 'false' }), false);
  // a page exclusion list is per page; the index is per site, so it does not read it
  assert.equal(bubbleSearchOn({ 'inbox-bubble-except': '/*' }), true);
});
