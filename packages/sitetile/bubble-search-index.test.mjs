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
// A later change that trims rows "for the bubble" (drops `e`, caps rows) or widens them (turns
// excerpts on) would fail here first.
//
// 🩸 tile#194 review: the first version of this guard built its header fixture by spreading
// BUBBLE_ONLY, which carries `blog-search-body: true` — so the DEFAULT header index (titles only, no
// `e`) was never exercised, and forcing excerpts on "for the bubble" stayed green. It also tried each
// bubble switch off alone but never both off together, so an early `[]` for that case stayed green.
// The header fixtures below start from nothing but `blog-search`, and the bubble matrix is the full
// cross product of both switches over absent / on / off.
//
// Twelve posts, not two: a row cap ("the bubble only needs a few") must have rows to cut.
const BIG = Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return [`../../blog/post-${n}.md`, post(`Post ${n}`, '', `body-${n} words that run past twenty characters`)];
}));
const bigCorpus = () => allPosts(BIG);

const HEADER_CONFIGS = {
  'default (blog-search alone, titles only)': { title: 'Fixture Site', packages: 'blog', 'blog-search': 'true' },
  'body search explicitly off': { title: 'Fixture Site', packages: 'blog', 'blog-search': 'true', 'blog-search-body': 'false' },
  'body search on, default excerpt length': { title: 'Fixture Site', packages: 'blog', 'blog-search': 'true', 'blog-search-body': 'true' },
  'body search on, 20-char excerpts': { title: 'Fixture Site', packages: 'blog', 'blog-search': 'true', 'blog-search-body': 'true', 'blog-search-excerpt-chars': '20' },
};
const SWITCH_VALUES = [undefined, 'on', 'off'];
const BUBBLE_MATRIX = SWITCH_VALUES.flatMap((bubble) => SWITCH_VALUES.map((search) => ({
  ...(bubble === undefined ? {} : { 'inbox-bubble': bubble }),
  ...(search === undefined ? {} : { 'inbox-bubble-search': search }),
})));

test('the bubble matrix is the full cross product, both-off included', () => {
  assert.equal(BUBBLE_MATRIX.length, 9);
  assert.ok(BUBBLE_MATRIX.some((b) => b['inbox-bubble'] === 'off' && b['inbox-bubble-search'] === 'off'), 'both-off is missing');
  assert.ok(BUBBLE_MATRIX.some((b) => Object.keys(b).length === 0), 'the all-default bubble is missing');
});

for (const [name, header] of Object.entries(HEADER_CONFIGS)) {
  test(`blog-search on, ${name}: the index is byte-identical under every bubble-switch combination`, () => {
    const { searchIndex } = blog;
    for (const k of Object.keys(header)) assert.ok(!k.startsWith('inbox-bubble'), `header fixture ${name} carries a bubble switch: ${k}`);
    const before = JSON.stringify(searchIndex(bigCorpus(), header));
    // An expectation that does not come from searchIndex, so a change inside it cannot move both sides.
    const withBody = header['blog-search-body'] === 'true';
    const expected = rows(before);
    assert.equal(expected.length, 12, 'the reference index lost rows');
    for (const r of expected) {
      assert.deepEqual(Object.keys(r).sort(), withBody ? ['d', 'e', 'g', 'i', 't', 'u'] : ['d', 'g', 'i', 't', 'u'],
        `reference row shape for ${name}: ${JSON.stringify(r)}`);
    }
    for (const bubble of BUBBLE_MATRIX) {
      const body = buildSearchIndexBody(bigCorpus(), { ...header, ...bubble });
      assert.equal(body, before,
        `the header magnifier's index (${name}) changed under bubble switches ${JSON.stringify(bubble)}`);
    }
  });
}

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
