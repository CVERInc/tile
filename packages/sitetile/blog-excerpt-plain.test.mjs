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
  assert.equal(s, 'Thanks to A Channel for the feature and code ~~old~~ see or a < b & c');
});

// Review fixtures. THE ORACLE IS THE POST PAGE: each expected value is the text a reader sees where
// the post renders that line (inlineHtml's HTML, with the hidden .st-mk markers not shown), written
// by hand from that HTML — not produced by the code under test. The excerpt's one rule of its own is
// that URLs go, keeping the sentence around them.
const excerptOf = (line) => parsePost('t', `---\ntitle: t\n---\n${line}\n`).excerptText;
const REVIEW_CASES = [
  // a line break the page renders is a word boundary
  ['Contact<br>Support', 'Contact Support'],
  ['line<br/>two<br />three', 'line two three'],
  // code: what the page renders inside the code span, unchanged
  ['Use `~~` as the operator.', 'Use ~~ as the operator.'],
  ['Use `<b>text</b>` and `&amp;` here, ~~not this~~.', 'Use <b>text</b> and &amp; here, ~~not this~~.'],
  ['see `https://code.example/x` here', 'see https://code.example/x here'],
  // the page's inline code span collapses whitespace (span.st-code is white-space: normal)
  ['Use `a  b` here.', 'Use a b here.'],
  // page-renderer behaviour, not excerpt: inlineHtml renders these INSIDE a code span as a real line
  // break, a <small> and a link, so the page shows them that way and so does the excerpt
  ['Use `<br>` between lines.', 'Use between lines.'],
  ['Use `<small>text</small>` here.', 'Use text here.'],
  ['Write `[label](/path)` here.', 'Write label here.'],
  // escaped characters are literal on the page; the backslash is a hidden marker
  ['Use \\~\\~word\\~\\~ here.', 'Use ~~word~~ here.'],
  ['**b** *i* \\*lit\\*', 'b i *lit*'],
  // page-renderer behaviour, not excerpt: inlineHtml escapes authored HTML and entities, so the page
  // shows them as typed — and so does the excerpt (no comparison or attribute can be eaten)
  ['Keep x<y and y>z.', 'Keep x<y and y>z.'],
  ['a < b and c > d, x<y', 'a < b and c > d, x<y'],
  ['Read <span title="x > y">this</span> today.', 'Read <span title="x > y">this</span> today.'],
  ['Read <b>this</b> and <em>that</em>.', 'Read <b>this</b> and <em>that</em>.'],
  ['Save &frac12; the space.', 'Save &frac12; the space.'],
  ['Enjoy caf&eacute; &agrave; la carte.', 'Enjoy caf&eacute; &agrave; la carte.'],
  ['Write &lt;b&gt;bold&lt;/b&gt; here.', 'Write &lt;b&gt;bold&lt;/b&gt; here.'],
  ['Bread &amp; butter &#38; jam &#x26; tea', 'Bread &amp; butter &#38; jam &#x26; tea'],
  ['Read [Bread &amp; butter](/post) today.', 'Read Bread &amp; butter today.'],
  // removing an address keeps the sentence around it, and an emptied bracket pair goes too
  ['See (https://example.com/page). Next sentence.', 'See. Next sentence.'],
  ['See https://example.com/page. Next sentence.', 'See. Next sentence.'],
  ['Wiki (https://en.example.org/wiki/Foo_(bar)), then more.', 'Wiki, then more.'],
  ['見（https://example.com/a）。下一句', '見。下一句'],
  ['See ((https://example.com/a)). Next.', 'See. Next.'],
  ['Visit <https://example.com/my_long_path> today.', 'Visit today.'],
  ['Read [https://short.example/AB](https://short.example/AB?ref=1) now', 'Read now'],
  // round 3: a link's own boundary holds while its address is removed — prose after it survives
  ['Read [https://example.com](https://example.com),please read carefully.', 'Read,please read carefully.'],
  ['Call [www.example.com](https://example.com)/support today.', 'Call /support today.'],
  ['Read (https://example.com),please read carefully.', 'Read,please read carefully.'],
  ['See {https://example.com/a}. Next.', 'See. Next.'],
  ['Call awww.example.com today.', 'Call awww.example.com today.'],
  // round 3: a paragraph is rendered in one call, so a code span soft-wrapped across a source newline
  // is one code element — and code is never touched by the URL rule
  ['Run `curl\nhttps://example.com/api` daily.', 'Run curl https://example.com/api daily.'],
  ['Always **back up\nbefore upgrading** today.', 'Always back up before upgrading today.'],
  // round 3: private-use characters are author text (custom-font glyphs), kept verbatim
  ['Keep \uE002\uE0000\uE001 here.', 'Keep \uE002\uE0000\uE001 here.'],
  ['Keep \uE002\uE0000\uE001 and `other` here.', 'Keep \uE002\uE0000\uE001 and other here.'],
  ['Keep \uE002 here.', 'Keep \uE002 here.'],
  // HTML collapses ASCII whitespace only; an ideographic space is shown as typed
  ['Alpha Beta\u3000Gamma', 'Alpha Beta\u3000Gamma'],
];
for (const [input, want] of REVIEW_CASES) {
  test(`review fixture: ${JSON.stringify(input)}`, () => assert.equal(excerptOf(input), want));
}

test('deeply nested markup the page renders does not abort loading posts (round 3)', () => {
  const raw = '---\ntitle: deep\n---\nStart ' + '<small>'.repeat(5000) + 'visible' + '</small>'.repeat(5000) + ' end.\n';
  const posts = blog.allPosts({ '/blog/deep.md': raw });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].excerptText, 'Start visible end.');
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

test('carousel date language is the blog index rule, not the view language, when a format is set', () => {
  // indexDateLang: an explicit format keeps meta.lang. With meta.lang and the view language apart,
  // passing the view language straight through would print the other language.
  assert.equal(blog.carouselPostDate('2026-11-01', { 'blog-date-format': 'cjk-full', lang: 'zh-TW' }, 'en'), '2026 年 11 月 1 日');
  assert.equal(blog.carouselPostDate('2026-11-01', { 'blog-date-format': 'cjk-full', lang: 'en' }, 'zh-TW'), 'November 1, 2026');
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
