// Card excerpts are plain text, and a `posts=N` carousel prints dates the way the blog index does.
//   run: node packages/sitetile/blog-excerpt-plain.test.mjs   (wired into scripts/test.sh)
//
// THE GAP (two of them, reported together by a live blog's own agent):
//  1. `.bl-desc` was cut from the post's MARKDOWN. Images were stripped, links were not, so a post
//     imported from a social feed — prose interleaved with long `[#tag](https://…/hashtag/…?…)`
//     links — listed raw markdown, and the 180-character cut could land inside a URL: one
//     unbreakable string that made a 390px index page 427px wide.
//  2. `.st-car-date` on a `posts=N` carousel always printed YY/M/D (`26/11/1`). `blog-date-format`
//     reached the blog index and never the carousel, so a site rewrote its carousel dates with a
//     script after load.
process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve —
// the same seam blog-date-format.test.mjs teaches the resolver.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') {
      return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const blog = await import('./astro/src/lib/blog.mjs');
const { parsePost, fmtDate } = blog;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// A long hashtag link the way a social-feed export writes one: percent-encoded tag, tracking query.
const tag = (t) => `[#${t}](https://social.example.com/hashtag/${encodeURIComponent(t)}?__eep__=6&__cft__[0]=AZXJRRPAmm3NjKwegA-nEvG1Bqy6qylTaECmZCUfuchCQth&__tn__=*NK-R)`;
const HASHTAG_POST = `---
title: Signing day
pubDate: 2026-11-01
---
![](/media/cover.jpg)

Book signing this weekend ${tag('signing-rules')} ${tag('new-book')} ${tag('meet-the-author')} ${tag('weekend-event')}
Bring your copy and come early, the first fifty readers get a sticker.
`;

test('an excerpt from a post full of long hashtag links is plain text', () => {
  const p = parsePost('signing-day', HASHTAG_POST);
  for (const field of ['excerpt', 'excerptText']) {
    const s = p[field];
    assert.ok(!/\]\(|\[#|https?:|__eep__|%[0-9A-F]{2}/i.test(s), `${field} still carries markdown or a URL fragment: ${s}`);
  }
  assert.ok(p.excerptText.startsWith('Book signing this weekend #signing-rules #new-book #meet-the-author #weekend-event Bring your copy'),
    `the link TEXT is kept, in place: ${p.excerptText}`);
});

test('the excerpt is still cut at the same budget, now counted in visible characters', () => {
  const p = parsePost('signing-day', HASHTAG_POST, 60);
  assert.ok(p.excerpt.endsWith(' […]'), p.excerpt);
  assert.equal(p.excerpt, p.excerptText.slice(0, 60).trim() + ' […]');
  const def = parsePost('signing-day', HASHTAG_POST);
  assert.ok(def.excerptText.length <= 180 ? def.excerpt === def.excerptText : def.excerpt === def.excerptText.slice(0, 180).trim() + ' […]');
});

test('no run in the excerpt is longer than a word: nothing a narrow card cannot wrap', () => {
  const p = parsePost('signing-day', HASHTAG_POST);
  const longest = Math.max(...p.excerpt.split(/\s+/).map((w) => w.length));
  assert.ok(longest <= 20, `longest unbroken run is ${longest} characters: ${p.excerpt}`);
});

test('links with brackets inside the URL, emphasis, code, autolinks and bare URLs', () => {
  const post = `---\ntitle: t\n---\nThanks to [A Channel](https://social.example.com/achannel?__cft__[0]=AZX&__tn__=-]K-R) for **the** _feature_ and \`code\` ~~old~~ <https://example.com/x> see https://example.com/long/path?q=1 or [https://short.example/AB](https://short.example/AB?ref=1) a < b & c\n`;
  const s = parsePost('t', post).excerptText;
  assert.equal(s, 'Thanks to A Channel for the feature and code old see or a < b & c');
});

test('a plain excerpt is unchanged (no site whose posts are prose moves)', () => {
  const post = `---\ntitle: t\n---\nFirst line of prose.\nSecond line, still prose.\n`;
  assert.equal(parsePost('t', post).excerpt, 'First line of prose. Second line, still prose.');
});

test('the listing stylesheet keeps any excerpt from widening the page', () => {
  const css = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /:where\(\.bl-desc\)\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

// ── item 2: carousel dates ────────────────────────────────────────────────────────────────────
test('carousel cards use blog-date-format, with the blog index formatter and language rule', () => {
  assert.equal(typeof blog.carouselPostDate, 'function', 'blog.mjs exports carouselPostDate');
  const { carouselPostDate } = blog;
  for (const format of ['ymd-slash', 'cjk-full', 'cjk-md']) {
    const meta = { 'blog-date-format': format, lang: 'zh-TW' };
    assert.equal(carouselPostDate('2026-11-01', meta, 'zh-TW'), fmtDate('2026-11-01', format, 'zh-TW'));
  }
  assert.equal(carouselPostDate('2026-11-01', { 'blog-date-format': 'ymd-slash' }), '2026/11/01');
  assert.equal(carouselPostDate('2026-11-01', { 'blog-date-format': 'cjk-full', lang: 'zh-TW' }), '2026 年 11 月 1 日');
});

test('a site with no blog-date-format keeps the historic YY/M/D carousel date', () => {
  assert.equal(blog.carouselPostDate('2026-11-01', {}), '26/11/1');
  assert.equal(blog.carouselPostDate('', {}), '');
  assert.equal(blog.carouselPostDate('not a date', { 'blog-date-format': 'ymd-slash' }), '');
});

test('the carousel component builds its post-card dates through carouselPostDate', () => {
  const src = readFileSync(join(HERE, 'astro/src/components/sections/Carousel.astro'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /date:\s*carouselPostDate\(p\.date,\s*meta,\s*lang\)/);
  assert.ok(!/slice\(2\)/.test(src), 'no second, local YY/M/D formatter left in the component');
});

console.log(`blog-excerpt-plain: ${passed} passed`);
