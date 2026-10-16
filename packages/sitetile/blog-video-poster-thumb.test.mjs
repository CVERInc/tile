// A post whose only media is a video must still get an archive-card thumbnail: the poster the
// author put in the alt slot (`![poster-url](clip.mp4)`, the slot imgTag reads for <video poster>).
//
// Measured on a Wix recast (sodaart, 2026-10-16): 116 showcase posts carried a video and nothing
// else. `image` came out '' for every one, so the /diary cards were blank and the image-first news
// carousel (Carousel.astro filters on `p.image`) dropped them altogether — the owner's report was
// "video posts do not get into the news section, and show no thumbnail".
//
// What stays true: a still image anywhere in the body still wins over a poster, and a video with
// no poster (or a poster that is not a URL — plain alt text) still yields '' rather than the .mp4.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') {
      return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
const { parsePost } = await import('./astro/src/lib/blog.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}
const post = (body) => parsePost('p', '---\ntitle: T\npubDate: 2026-01-01\n---\n\n' + body);

test('video-only post: the poster in the alt slot becomes the featured image', () => {
  const p = post('Debut done!\n\n![https://m.example/poster/abc.jpg](https://m.example/video/abc.mp4)\n');
  assert.equal(p.image, 'https://m.example/poster/abc.jpg');
});

test('a site-relative poster works too', () => {
  const p = post('![/media/abc.poster.webp](/media/abc.mp4)\n');
  assert.equal(p.image, '/media/abc.poster.webp');
});

test('a still image anywhere in the body still wins over a poster', () => {
  const p = post('![/p.jpg](/clip.mp4)\n\ntext\n\n![](/still.webp)\n');
  assert.equal(p.image, '/still.webp');
});

test('a video with plain alt text (not a URL) yields no image — never the .mp4', () => {
  const p = post('![demo of the mouth shape](https://m.example/video/abc.mp4)\n');
  assert.equal(p.image, '');
});

test('a video with an empty alt yields no image (the pre-fix shape, unchanged)', () => {
  const p = post('![](https://video.example/file.mp4)\n');
  assert.equal(p.image, '');
});

test('the poster is still gated by safeSrc (a data: svg poster is refused)', () => {
  const p = post('![data:image/svg+xml;base64,PHN2Zy8+](/clip.mp4)\n');
  assert.equal(p.image, '');
});

console.log(`blog-video-poster-thumb: ${passed} passed`);
