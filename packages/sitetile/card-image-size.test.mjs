// A post card's width/height come from the image file's own header, read at build time — and only
// from there (astro/src/lib/image-size.mjs). Remote, unreadable or unknown-format → no size.
//   run: node packages/sitetile/card-image-size.test.mjs   (wired into scripts/test.sh)
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
// public-file.mjs fixes public/ at import time from the cwd (as Astro does), so the fixture site
// is entered BEFORE the module is loaded.
const SITE = mkdtempSync(join(tmpdir(), 'card-img-'));
const OUTSIDE = mkdtempSync(join(tmpdir(), 'card-img-out-'));
process.on('exit', () => { rmSync(SITE, { recursive: true, force: true }); rmSync(OUTSIDE, { recursive: true, force: true }); });
process.chdir(SITE);
const { imageSizeFromBytes, localImageSize } = await import(join(HERE, 'astro/src/lib/image-size.mjs'));
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { allPosts, searchIndex, postCards } = await import(join(HERE, 'astro/src/lib/blog.mjs'));

const be16 = (n) => [n >> 8 & 255, n & 255];
const le16 = (n) => [n & 255, n >> 8 & 255];
const le24 = (n) => [n & 255, n >> 8 & 255, n >> 16 & 255];
const be32 = (n) => [n >>> 24 & 255, n >> 16 & 255, n >> 8 & 255, n & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts) => Uint8Array.from(parts.flat());

const png = (w, h) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), ascii('IHDR'), be32(w), be32(h), [8, 6, 0, 0, 0], [0, 0, 0, 0]);
const gif = (w, h) => bytes(ascii('GIF89a'), le16(w), le16(h), [0, 0, 0]);
const webpX = (w, h) => bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'), ascii('VP8X'), [10, 0, 0, 0], [0, 0, 0, 0], le24(w - 1), le24(h - 1));
const webpL = (w, h) => { const v = ((w - 1) | ((h - 1) << 14)) >>> 0; return bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'), ascii('VP8L'), [5, 0, 0, 0], [0x2f], [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255], [0, 0, 0, 0, 0]); };
const webp = (w, h) => bytes(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBP'), ascii('VP8 '), [10, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], le16(w), le16(h), [0, 0]);
// SOI, APP0 (JFIF), [APP1 EXIF orientation], DHT (C4 — inside the SOF range, must be skipped), SOF0.
const exif = (o) => { const p = [...ascii('Exif\0\0'), ...ascii('MM'), 0, 42, ...be32(8), ...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(o), 0, 0, ...be32(0)]; return [0xff, 0xe1, ...be16(p.length + 2), ...p]; };
const jpeg = (w, h, orientation) => bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), ascii('JFIF\0'), [1, 1, 0, 0, 1, 0, 1, 0, 0],
  orientation ? exif(orientation) : [], [0xff, 0xc4], be16(5), [0, 0, 0], [0xff, 0xc0], be16(17), [8], be16(h), be16(w), [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

test('reads the pixel size from PNG, GIF, WebP (all three kinds) and JPEG headers', () => {
  assert.deepEqual(imageSizeFromBytes(png(1280, 1810)), { width: 1280, height: 1810 });
  assert.deepEqual(imageSizeFromBytes(gif(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(imageSizeFromBytes(webpX(2048, 1536)), { width: 2048, height: 1536 });
  assert.deepEqual(imageSizeFromBytes(webpL(1600, 900)), { width: 1600, height: 900 });
  assert.deepEqual(imageSizeFromBytes(webp(1024, 768)), { width: 1024, height: 768 });
  assert.deepEqual(imageSizeFromBytes(jpeg(2048, 1365)), { width: 2048, height: 1365 });
});

test('a JPEG turned a quarter by EXIF reports the box the browser displays', () => {
  assert.deepEqual(imageSizeFromBytes(jpeg(2048, 1365, 1)), { width: 2048, height: 1365 });
  assert.deepEqual(imageSizeFromBytes(jpeg(2048, 1365, 3)), { width: 2048, height: 1365 }, '180° keeps the box');
  assert.deepEqual(imageSizeFromBytes(jpeg(2048, 1365, 6)), { width: 1365, height: 2048 });
  assert.deepEqual(imageSizeFromBytes(jpeg(2048, 1365, 8)), { width: 1365, height: 2048 });
});

test('anything it cannot read with certainty is null — never a guess', () => {
  assert.equal(imageSizeFromBytes(null), null);
  assert.equal(imageSizeFromBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')), null, 'SVG is not sized');
  assert.equal(imageSizeFromBytes(jpeg(2048, 1365).subarray(0, 30)), null, 'frame header beyond the bytes read');
  assert.equal(imageSizeFromBytes(png(1280, 1810).subarray(0, 20)), null, 'truncated IHDR');
  assert.equal(imageSizeFromBytes(png(0, 10)), null, 'a zero dimension');
});

test('a remote image is never read and gets no size', () => {
  let calls = 0;
  const reader = () => { calls++; return png(10, 10); };
  for (const src of ['https://cdn.example.com/a.png', '//cdn.example.com/a.png', 'data:image/png;base64,AAAA', '', '/../etc/a.png']) {
    assert.equal(localImageSize(src, reader), null, src);
  }
  assert.equal(calls, 0, 'nothing outside public/ is ever opened');
});

test('a file the site ships in public/ is sized from its header; a percent-encoded name finds the same file', () => {
  mkdirSync(join(SITE, 'public/images/2024'), { recursive: true });
  writeFileSync(join(SITE, 'public/images/2024/page-01.png'), png(1280, 1810));
  writeFileSync(join(SITE, 'public/images/2024/封面.jpg'), jpeg(2048, 1365, 6));
  writeFileSync(join(SITE, 'public/images/2024/broken.jpg'), Buffer.from('not an image'));
  assert.deepEqual(localImageSize('/images/2024/page-01.png?v=2'), { width: 1280, height: 1810 });
  assert.deepEqual(localImageSize('/images/2024/' + encodeURIComponent('封面') + '.jpg'), { width: 1365, height: 2048 });
  assert.equal(localImageSize('/images/2024/broken.jpg'), null);
  assert.equal(localImageSize('/images/2024/missing.png'), null);
});

test('🔴 a symlink out of public/ is not followed (the readPublic rule)', () => {
  writeFileSync(join(OUTSIDE, 'secret.png'), png(99, 99));
  symlinkSync(join(OUTSIDE, 'secret.png'), join(SITE, 'public/escape.png'));
  assert.equal(localImageSize('/escape.png'), null);
});

test('the size travels with the post: allPosts reads it, cards and the archive island\'s index carry it', () => {
  const posts = allPosts({
    '../../blog/local.md': '---\ntitle: Local\ndate: 2024-01-02\n---\n\n![](/images/2024/page-01.png)\n\nBody.\n',
    '../../blog/remote.md': '---\ntitle: Remote\ndate: 2024-01-01\n---\n\n![](https://cdn.example.com/p/page-02.jpg)\n\nBody.\n',
  });
  const [local, remote] = posts;
  assert.equal(local.imageWidth, 1280);
  assert.equal(local.imageHeight, 1810);
  assert.ok(!('imageWidth' in remote) && !('imageHeight' in remote), 'a remote image is never sized');
  const [lc, rc] = postCards(posts, {});
  assert.equal(lc.imageWidth, 1280);
  assert.equal(rc.imageWidth, undefined);
  const [li, ri] = searchIndex(posts, {});
  assert.equal(li.iw, 1280);
  assert.equal(li.ih, 1810);
  assert.ok(!('iw' in ri) && !('ih' in ri), 'the index row carries no size it does not know');
});
