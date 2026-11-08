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
import { crc32 as zlibCrc32 } from 'node:zlib';

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

const be16 = (n) => [n >>> 8 & 255, n & 255];
const le16 = (n) => [n & 255, n >>> 8 & 255];
const le24 = (n) => [n & 255, n >>> 8 & 255, n >>> 16 & 255];
const be32 = (n) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const le32 = (n) => be32(n).reverse();
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts) => Uint8Array.from(parts.flat(Infinity));

// Fixtures are built to the formats' own rules, so a reader that validates them can pass: the IHDR
// carries its real CRC (node:zlib's, not the reader's), and the RIFF size holds the chunk.
const ihdr = (w, h, rest = [8, 6, 0, 0, 0]) => { const d = [...ascii('IHDR'), ...be32(w), ...be32(h), ...rest]; return [...be32(13), ...d, ...be32(zlibCrc32(Uint8Array.from(d)))]; };
const png = (w, h) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ihdr(w, h));
const gif = (w, h) => bytes(ascii('GIF89a'), le16(w), le16(h), [0, 0, 0]);
const riff = (fourcc, payload) => bytes(ascii('RIFF'), le32(4 + 8 + payload.length + (payload.length % 2)), ascii('WEBP'), ascii(fourcc), le32(payload.length), payload, payload.length % 2 ? [0] : []);
const webpX = (w, h) => riff('VP8X', [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]);
const webpL = (w, h) => { const v = ((w - 1) | ((h - 1) << 14)) >>> 0; return riff('VP8L', [0x2f, ...le32(v)]); };
const webp = (w, h) => riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]);
// SOI, APP0 (JFIF), [APP1 EXIF orientation], DHT (C4 — inside the SOF range, must be skipped), SOF0.
const segment = (m, p) => [0xff, m, ...be16(p.length + 2), ...p];
const exifPayload = (o, le = false) => { const r16 = le ? le16 : be16, r32 = le ? le32 : be32; return [...ascii('Exif\0\0'), ...ascii(le ? 'II' : 'MM'), ...r16(42), ...r32(8), ...r16(1), ...r16(0x0112), ...r16(3), ...r32(1), ...r16(o), 0, 0, ...r32(0)]; };
const exif = (o, le = false) => segment(0xe1, exifPayload(o, le));
const xmp = segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'));
const sof = (w, h) => segment(0xc0, [8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const jpeg = (w, h, orientation) => bytes([0xff, 0xd8], segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
  orientation ? exif(orientation) : [], segment(0xc4, [0, 0, 0]), sof(w, h));
const jpegWith = (...metadata) => bytes([0xff, 0xd8], ...metadata, sof(2048, 1365));
const LANDSCAPE = { width: 2048, height: 1365 }, PORTRAIT = { width: 1365, height: 2048 };

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

// ── tile#269 review: the reviewer's own inputs, built here byte-for-byte as their probe built them ──

test('🔴 review P2-1: an XMP APP1 after the EXIF one does not reset the orientation (both byte orders, 1–8)', () => {
  for (const le of [false, true]) for (let o = 1; o <= 8; o++) {
    const want = o >= 5 ? PORTRAIT : LANDSCAPE;
    assert.deepEqual(imageSizeFromBytes(jpegWith(exif(o, le), xmp)), want, `${le ? 'II' : 'MM'} o${o} + XMP`);
    assert.deepEqual(imageSizeFromBytes(jpegWith(xmp, exif(o, le))), want, `${le ? 'II' : 'MM'} XMP + o${o}`);
    assert.deepEqual(imageSizeFromBytes(jpegWith(exif(o, le))), want, `${le ? 'II' : 'MM'} o${o}`);
  }
});

test('🔴 review P2-2: a structure cut short, empty, out of range or mistyped yields null, not a size', () => {
  const badType = exif(6); badType[22] = 0; badType[23] = 0;              // Orientation type 0, not SHORT
  const cases = {
    'PNG ending inside IHDR': png(1280, 1810).subarray(0, 24),
    'PNG width 0xffffffff (valid CRC)': png(0xffffffff, 10),
    'GIF missing the rest of its screen descriptor': bytes(ascii('GIF89a'), le16(640), le16(480)),
    'JPEG SOF declaring length 2': bytes([0xff, 0xd8, 0xff, 0xc0, 0, 2, 8], be16(1365), be16(2048)),
    'JPEG SOF declaring 17 with 7 present': bytes([0xff, 0xd8], sof(2048, 1365).slice(0, 9)),
    'VP8X declaring zero payload bytes': bytes(ascii('RIFF'), le32(22), ascii('WEBPVP8X'), le32(0), [0, 0, 0, 0, 255, 255, 255, 255, 255, 255]),
    'EXIF Orientation of TIFF type 0': jpegWith(badType),
  };
  for (const [name, input] of Object.entries(cases)) assert.equal(imageSizeFromBytes(input), null, name);
});

test('the same rules, one boundary further: CRC, RIFF size, EXIF count/value/bounds, SOF component count', () => {
  const crcFlipped = png(1280, 1810); crcFlipped[32] ^= 1;
  const riffShort = webpX(2048, 1536); riffShort[4] = 4;                  // RIFF smaller than its chunk
  const count2 = exif(6); count2[27] = 2;                                 // Orientation count 2
  const nine = exifPayload(9);
  const entriesPastEnd = exifPayload(6); entriesPastEnd[15] = 2;           // claims 2 entries, holds 1
  const sofBadComps = segment(0xc0, [8, ...be16(1365), ...be16(2048), 2, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const cases = {
    'PNG with a bad IHDR CRC': crcFlipped,
    'PNG with colour type 6 at depth 4': bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ihdr(10, 10, [4, 6, 0, 0, 0])),
    'WebP whose RIFF size cannot hold the chunk': riffShort,
    'EXIF Orientation with count 2': jpegWith(count2),
    'EXIF Orientation value 9': jpegWith(segment(0xe1, nine)),
    'EXIF IFD entries running past the segment': jpegWith(segment(0xe1, entriesPastEnd)),
    'two EXIF segments that disagree': jpegWith(exif(6), exif(1)),
    'SOF whose length does not match its component count': bytes([0xff, 0xd8], sofBadComps),
    'SOF with height 0 (defined later by DNL)': bytes([0xff, 0xd8], sof(2048, 0)),
  };
  for (const [name, input] of Object.entries(cases)) assert.equal(imageSizeFromBytes(input), null, name);
  // …and an EXIF with no Orientation entry, or a repeated one that agrees, still reads.
  const noOrientation = exifPayload(6); noOrientation[16] = 0x01; noOrientation[17] = 0x10;   // tag 0x0110 (Model)
  assert.deepEqual(imageSizeFromBytes(jpegWith(segment(0xe1, noOrientation))), LANDSCAPE);
  assert.deepEqual(imageSizeFromBytes(jpegWith(exif(6), exif(6))), PORTRAIT);
});
