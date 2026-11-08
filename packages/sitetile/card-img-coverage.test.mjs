// Guard: every post-card image goes through the ONE helper (packages/emit/card-img.mjs).
//   run: node packages/sitetile/card-img-coverage.test.mjs   (wired into scripts/test.sh)
//
// 🩸 Seven places wrote a post's first image as a bare `<img src={p.image} loading="lazy">` — the
// blog index, the term/date archive, both tag-label pages, "Keep reading" and related cards, the
// `posts=N` carousel, and the archive island that rebuilds the list in the browser. A fix applied
// to six of them is a page that is light until somebody filters. So this reads every renderer
// file, not a list of the ones we remembered, and fails on any card image written by hand.
//
// Reading source text is the only way to see the island and every template branch at once (the
// built pages are checked too: smoke-build.mjs asserts the helper's attributes on real output).
// The CONTROL test proves the detector fires on the exact markup this replaced.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro', 'src');
const EMIT = join(HERE, '..', 'emit');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p);
    return /\.(astro|m?js)$/.test(n) && !/\.test\.m?js$/.test(n) ? [p] : [];
  });
}

const CARD_CLASSES = ['bl-entry-img', 'bl-keep-img'];

/** Every way a card image can be written by hand, found in one file's text. */
function handWritten(s) {
  const hits = [];
  // A template <img> fed the post's image field directly.
  for (const m of s.matchAll(/<img\b[^>]*\bsrc=\{[^}]*\.image\b[^}]*\}/g)) hits.push(m[0]);
  // A card class spelled anywhere but as the helper's `cls:` argument.
  for (const cls of CARD_CLASSES) {
    for (const m of s.matchAll(new RegExp(`(.{0,40})${cls}`, 'g'))) {
      if (!/\bcls:\s*['"]$/.test(m[1])) hits.push(m[0].trim());
    }
  }
  // The island's DOM spelling.
  for (const m of s.matchAll(/\bimg\.src\s*=/g)) hits.push(m[0]);
  // A post image smuggled back through a markdown cell (the carousel's old route).
  for (const m of s.matchAll(/!\[\]\(\$\{p\.image\}\)/g)) hits.push(m[0]);
  return hits;
}

test('no renderer writes a post-card image by hand', () => {
  const files = [...walk(SRC), ...walk(EMIT)];
  assert.ok(files.length > 50, 'the walk found the renderer tree');
  const bad = files.flatMap((f) => handWritten(readFileSync(f, 'utf8')).map((h) => `${relative(HERE, f)}: ${h}`));
  assert.deepEqual(bad, [], 'card images written without packages/emit/card-img.mjs:\n  ' + bad.join('\n  '));
});

// The renderers that show a post card image — if one of these stops calling the helper, the guard
// above can only stay green because the card image vanished, which this catches.
const RENDERERS = {
  'components/BlogIndexView.astro': 1,
  'components/ArchiveView.astro': 1,
  'pages/search/label/[tag]/index.astro': 1,
  'pages/search/label/[tag]/page/[n].astro': 1,
  'components/PostArticle.astro': 2,
  'packages/blog-archive/blog-archive.js': 1,
};

test('each card renderer calls the helper, with the list layout', () => {
  for (const [rel, n] of Object.entries(RENDERERS)) {
    const s = readFileSync(join(SRC, rel), 'utf8');
    const calls = [...s.matchAll(/cardImgAttrs\(\{[^}]*\}\)/g)].map((m) => m[0]);
    assert.equal(calls.length, n, `${rel}: expected ${n} cardImgAttrs call(s), found ${calls.length}`);
    for (const c of calls) assert.match(c, /layout: 'list'/, `${rel}: ${c}`);
    if (rel.endsWith('.astro')) {
      for (const c of calls) assert.match(c, /width: p\.imageWidth, height: p\.imageHeight/, `${rel}: the known size is not passed on`);
    }
  }
  const car = readFileSync(join(SRC, 'components/sections/Carousel.astro'), 'utf8');
  assert.match(car, /image: \{ src: p\.image, width: p\.imageWidth, height: p\.imageHeight \}/, 'Carousel.astro: posts=N cells must hand the image to the emitter as `image`');
  const emit = readFileSync(join(EMIT, 'carousel.mjs'), 'utf8');
  assert.match(emit, /cardImg\(\{ src: c\.image\.src,[^}]*layout: 'carousel', cols,/, 'emit/carousel.mjs: a post cell must be written by cardImg');
});

test('🔴 CONTROL: the detector fires on the markup this replaced', () => {
  const before = [
    '{p.image && <img class="bl-entry-img" src={p.image} alt="" loading="lazy" />}',
    '{p.image && <img class="bl-keep-img" src={p.image} alt="" loading="lazy" />}',
    "img.className = 'bl-entry-img';\n      img.src = x.i;",
    'body: `![](${p.image})` }))',
  ];
  for (const b of before) assert.ok(handWritten(b).length > 0, `not caught: ${b}`);
  const after = "{p.image && <img {...cardImgAttrs({ src: p.image, cls: 'bl-entry-img', layout: 'list', width: p.imageWidth, height: p.imageHeight })} />}";
  assert.deepEqual(handWritten(after), [], 'the helper call itself must pass');
});
