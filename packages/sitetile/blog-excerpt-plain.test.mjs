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
  // a code span is literal on the page (tile#267), so `<br>`, `<small>` and a link written inside
  // one are the visible text there, and the excerpt keeps them
  ['Use `<br>` between lines.', 'Use <br> between lines.'],
  ['Use `<small>text</small>` here.', 'Use <small>text</small> here.'],
  ['Write `[label](/path)` here.', 'Write [label](/path) here.'],
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
  // round 4: an email is one token — its host is not a web address, and a mailto: link stays whole
  ['Contact help@www.example.com today.', 'Contact help@www.example.com today.'],
  ['Contact [help@www.example.com](mailto:help@www.example.com) today.', 'Contact help@www.example.com today.'],
  ['Write to team.www@example.com or visit www.example.com today.', 'Write to team.www@example.com or visit today.'],
  // round 4: the body renderer's own blocks — what the page shows is what the excerpt reads
  ['Keep <!--\n- important instruction\n--> today.', 'Keep <!-- important instruction --> today.'],
  ['    Show <!-- note --> here.', 'Show <!-- note --> here.'],
  ['Example\n~~~sh\ncurl https://example.com/api\n~~~\ntoday.', 'Example curl https://example.com/api today.'],
  ['~~~ini\n[section]\n~~~', '[section]'],
  // headings, hashtag runs and quotes are skipped by source line, as excerpts always skipped them —
  // outside fenced code only (inside a fence they are code the page shows)
  ['## Heading\nBody text', 'Body text'],
  ['> quoted\n\nafter', 'after'],
  ['#comics #daily\nToday we drew a cat.', 'Today we drew a cat.'],
  ['~~~sh\n# install\n> out.txt\n~~~', '# install > out.txt'],
  ['一行目\n二行目', '一行目 二行目'],
  ['[#a](https://x.example/a) [#b](https://x.example/b)\nprose line', 'prose line'],
  // round 5: an email is found whole, before any web address is looked for
  ['Contact www.support@example.com today.', 'Contact www.support@example.com today.'],
  ['Contact a!www.support@example.com today.', 'Contact a!www.support@example.com today.'],
  ['Contact help@[www.example.com](/contact) today.', 'Contact help@www.example.com today.'],
  ['See https://example.com/a@b.example.com today.', 'See today.'],
  // round 5: a mailto: link's text is left whole even when it reads like a web address
  ['Contact [www.example.com](mailto:help@example.com) today.', 'Contact www.example.com today.'],
  // round 5: a skipped heading still splits the body where the page splits it, so a comment above
  // it does not pair with a `-->` below it
  ['<!--\n# Heading\nImportant visible instruction\n-->\nEnd', '<!-- Important visible instruction --> End'],
  ['Keep <!--\n> quoted\n--> today.', 'Keep <!-- --> today.'],
  // round 7: a skipped line keeps every word it has for the renderer — only its visible text is
  // dropped — so a comment closer on it still closes the comment, and the public text after it stays
  ['<!-- Draft notes\n> -->\nDo not enter the closed trail.\n<!-- End notes -->\nOpen trails are listed below.',
    'Do not enter the closed trail. Open trails are listed below.'],
  ['<!--\n[ends -->\nImportant visible instruction\n<!-- private\n-->\nEnd', 'Important visible instruction End'],
  // round 8: the marks are trusted only when the page shows every one of them, in order. When a
  // comment hides one, the excerpt falls back to the page's own blocks — the unmarked page less its
  // heading and quote elements — so these keep a skipped line's visible remnant, as the page shows it
  ['<!-- open\n> q --> quote tail\nafter', 'quote tail after'],
  ['Intro\n[<!-- x\nstill hidden --> visible tail', 'Intro [ visible tail'],
  // a line whose mark would change what the page shows (a quoted comment opener) falls back too
  ['> <!-- start\nhidden\n-->\nvisible', 'visible'],
  // round 8: a close mark swallowed by a link destination (https, mailto, a destination that starts
  // on the next line) must not leave the prose after it dropped — the fallback keeps the page's text
  ['[label](https://example.com\n/path)\nDo not enter the closed trail.', 'label Do not enter the closed trail.'],
  ['[label](mailto:help@example.com/-->\nrest)\nKeep this.', 'label Keep this.'],
  ['[label](\nhttps://example.com)\nKeep this.', 'label Keep this.'],
  // …while a link-list line the page shows whole is still skipped
  ['[a](/x)\nKeep this.', 'Keep this.'],
  // round 7: a colon alone is label punctuation — the address after it is an email, not a URL…
  ['Contact:www.support@example.com today.', 'Contact:www.support@example.com today.'],
  ['Contact:help@example.com today.', 'Contact:help@example.com today.'],
  // …while the user info of a web address that started earlier is still part of that address
  ['See https://user:www.pass@example.com/x today.', 'See today.'],
  ['See https://user:pass@example.com/x today.', 'See today.'],
  // round 8: a web address is looked for inside one run (a link's text, or the prose around it), so a
  // URL-labelled link never reaches past its own anchor into an email after it
  ['See [https://example.com](/go):www.support@example.com today.', 'See:www.support@example.com today.'],
  ['See [https://example.com](/go),www.support@example.com today.', 'See,www.support@example.com today.'],
  ['See [https://example.com](/go)/www.support@example.com today.', 'See /www.support@example.com today.'],
  ['See [https://example.com](/go),[www.support@example.com](/contact) today.', 'See,www.support@example.com today.'],
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

// round 5: an email grid. The expected text is the address exactly as written — every shape below
// shows the whole address on the page — built by string templates, not by the code under test.
test('email grid: every address the page shows survives whole', () => {
  const locals = ['help', 'www.support', 'a!www.support', 'first.last', 'x+tag', "o'brien", 'www'];
  const domains = ['example.com', 'www.example.com', 'mail.example.co.uk', 'www.ex-ample.org'];
  const shapes = [
    (e) => [`Contact ${e} today.`, `Contact ${e} today.`],
    (e) => [`Contact \`${e}\` today.`, `Contact ${e} today.`],
    (e) => [`Contact [${e}](mailto:${e}) today.`, `Contact ${e} today.`],
    (e) => [`Contact [${e}](/contact) today.`, `Contact ${e} today.`],
    (e) => [`Email (${e}).`, `Email (${e}).`],
    (e) => [`Mail ${e}, then wait.`, `Mail ${e}, then wait.`],
    (e) => [`「${e}」まで`, `「${e}」まで`],
  ];
  let n = 0;
  const bad = [];
  for (const l of locals) for (const d of domains) for (const shape of shapes) {
    const [input, want] = shape(`${l}@${d}`);
    n++;
    const got = excerptOf(input);
    if (got !== want) bad.push(`${JSON.stringify(input)} → ${JSON.stringify(got)}`);
  }
  assert.equal(bad.length, 0, `${bad.length} of ${n} lost text:\n    ` + bad.slice(0, 5).join('\n    '));
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
