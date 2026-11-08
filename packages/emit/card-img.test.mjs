// The shared post-card image (card-img.mjs): what it writes, and what it refuses to make up.
//   run: node packages/emit/card-img.test.mjs   (wired into scripts/test.sh via packages/emit/*.test.mjs)
import assert from 'node:assert/strict';
import test from 'node:test';
import { cardImgAttrs, cardImg, cardSizes, carouselCols, CARD_SIZES } from './card-img.mjs';
import { emitCarousel } from './carousel.mjs';
import { parseSite, inlineHtml, bodyHtml } from '../sitetile/site-core.js';

const LOCAL = { src: '/images/2024/page-01.jpg', cls: 'bl-entry-img', layout: 'list', width: 2048, height: 1365 };

test('lazy + async decode + sizes on every card image; src is the post image, unchanged', () => {
  const a = cardImgAttrs(LOCAL);
  assert.equal(a.src, LOCAL.src);
  assert.equal(a.loading, 'lazy');
  assert.equal(a.decoding, 'async');
  assert.equal(a.sizes, CARD_SIZES.list);
  assert.equal(a.class, 'bl-entry-img');
  assert.equal(a.alt, '');
});

test('sizes follows the layout: the list column, and 1/N of the viewport for an N-column carousel', () => {
  assert.equal(cardSizes('list'), '100vw');
  assert.equal(cardSizes('carousel', '3'), 'calc(100vw / 3)');
  assert.equal(cardSizes('carousel', 2), 'calc(100vw / 2)');
  assert.equal(cardSizes('carousel', '4'), 'calc(100vw / 4)');
  // site.css: no rule → the default 5; `6` is mapped to 5 too.
  for (const c of [undefined, '', '5', '6', '7', 'x']) assert.equal(carouselCols(c), 5, `cols=${c}`);
  assert.throws(() => cardSizes('grid'), /unknown card layout/);
});

test('width/height only when both are known positive integers — a remote image gets neither', () => {
  const a = cardImgAttrs(LOCAL);
  assert.equal(a.width, '2048');
  assert.equal(a.height, '1365');
  const remote = cardImgAttrs({ src: 'https://cdn.example.com/p/page-01.jpg', cls: 'bl-entry-img', layout: 'list' });
  assert.ok(!('width' in remote) && !('height' in remote), 'a remote image must not be given a size');
  for (const [w, h] of [[2048, undefined], [0, 10], [-1, 10], [10.5, 10], ['2048', '1365'], [NaN, 1]]) {
    const x = cardImgAttrs({ ...LOCAL, width: w, height: h });
    assert.ok(!('width' in x) && !('height' in x), `width=${w} height=${h} must not be emitted`);
  }
});

test('srcset only when real derivatives exist', () => {
  assert.ok(!('srcset' in cardImgAttrs(LOCAL)), 'no derivatives → no srcset');
  assert.ok(!('srcset' in cardImgAttrs({ ...LOCAL, derivatives: [] })));
  assert.ok(!('srcset' in cardImgAttrs({ ...LOCAL, derivatives: [{ src: '/a 1.jpg', width: 360 }, { src: '/b.jpg' }] })),
    'unusable candidates (a space in the url, no width) are dropped, not guessed');
  const a = cardImgAttrs({ ...LOCAL, derivatives: [{ src: '/d/page-01-360.jpg', width: 360 }, { src: '/d/page-01-720.jpg', width: 720 }] });
  assert.equal(a.srcset, '/d/page-01-360.jpg 360w, /d/page-01-720.jpg 720w');
  assert.equal(a.src, LOCAL.src, 'the original stays the src fallback');
});

test('no src → nothing at all', () => {
  assert.equal(cardImgAttrs({ src: '', layout: 'list' }), null);
  assert.equal(cardImg({ layout: 'list' }), '');
});

test('the string form escapes like an Astro attribute', () => {
  const html = cardImg({ ...LOCAL, src: '/a?b=1&c="2"' });
  assert.ok(html.startsWith('<img class="bl-entry-img" src="/a?b=1&amp;c=&quot;2&quot;"'), html);
  assert.match(html, / sizes="100vw" width="2048" height="1365" alt="" loading="lazy" decoding="async">$/);
});

// The carousel's `posts=N` cells (sitetile Carousel.astro) carry their post's image as `image`.
const ctx = { inline: inlineHtml, block: bodyHtml };
const section = (body) => parseSite('---\ntitle: T\n---\n\n## Strip\n<!-- carousel -->\n' + body).sections[0];
const imgsOf = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);

test('carousel post cells go through the helper, sized for the carousel\'s columns', () => {
  const cells = [
    { title: 'Local', href: '/blog/a', date: '24/1/2', body: '', image: { src: '/images/a.png', width: 1280, height: 720 } },
    { title: 'Remote', href: '/blog/b', date: '24/1/1', body: '', image: { src: 'https://cdn.example.com/b.jpg' } },
  ];
  const html = emitCarousel(section(''), { cols: '3', more: null, isBlogFull: true, cells }, ctx);
  const [a, b] = imgsOf(html);
  assert.equal(a, cardImg({ src: '/images/a.png', cls: 'st-img', layout: 'carousel', cols: '3', width: 1280, height: 720 }));
  assert.match(a, /sizes="calc\(100vw \/ 3\)"/);
  assert.match(a, /width="1280" height="720"/);
  assert.match(b, /decoding="async"/);
  assert.doesNotMatch(b, /width=|height=/, 'remote → no size');
});

test('a hand-authored carousel cell is untouched by this change', () => {
  const html = emitCarousel(section(''), { cols: '3', more: null, isBlogFull: false, cells: [{ title: 'Cast', body: '![a](/a.png)' }] }, ctx);
  const [a] = imgsOf(html);
  assert.ok(a.includes('class="st-img"') && !a.includes('sizes='), a);
});
