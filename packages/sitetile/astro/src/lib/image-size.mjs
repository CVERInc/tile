// The intrinsic pixel size of an image the site ships in public/, read from its header at build
// time — so a post card can carry width/height and stop shifting the layout as images arrive.
//
// Read, never guessed: anything this cannot read with certainty returns null and the card gets no
// width/height at all, which is exactly what it had before. That covers remote images (never
// fetched at build), SVG/AVIF/anything not listed below, a truncated header, and a JPEG whose
// frame header sits past HEAD_BYTES.
//
// Formats: PNG (IHDR), GIF (logical screen), WebP (VP8 / VP8L / VP8X), JPEG (first SOFn). A JPEG's
// EXIF orientation 5–8 is a quarter turn, and browsers apply it (`image-orientation: from-image`
// is the default), so the displayed box is the stored one swapped — the size reported here is the
// DISPLAYED one, because that is the box the browser has to reserve.
import { publicFilePath } from '../../../icon-core.mjs';
import { readPublicHead } from './public-file.mjs';

/** Bytes read per image. A JPEG's frame header follows its APPn segments (EXIF, ICC, XMP), which
 *  are each ≤ 64 KB; 256 KB covers every layout measured without reading whole photos. */
export const HEAD_BYTES = 256 * 1024;

const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));
const sized = (width, height) => (width > 0 && height > 0 ? { width, height } : null);

function pngSize(b) {
  if (b.length < 24 || u32be(b, 0) !== 0x89504e47 || u32be(b, 4) !== 0x0d0a1a0a) return null;
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') return null;
  return sized(u32be(b, 16), u32be(b, 20));
}

function gifSize(b) {
  if (b.length < 10 || !/^GIF8[79]a$/.test(ascii(b, 0, 6))) return null;
  return sized(u16le(b, 6), u16le(b, 8));
}

function webpSize(b) {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8X') return sized(u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  return null;
}

/** EXIF orientation (1–8) from an APP1 payload starting at `o` ("Exif\0\0" + TIFF), or 1. */
function exifOrientation(b, o, end) {
  if (ascii(b, o, 6) !== 'Exif\0\0') return 1;
  const t = o + 6;
  const le = ascii(b, t, 2) === 'II';
  if (!le && ascii(b, t, 2) !== 'MM') return 1;
  const r16 = (p) => (le ? u16le(b, p) : u16be(b, p));
  const r32 = (p) => (le ? (u16le(b, p) + u16le(b, p + 2) * 65536) : u32be(b, p));
  const ifd = t + r32(t + 4);
  if (ifd + 2 > end) return 1;
  const n = r16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) return 1;
    if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2, orientation = 1;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; }                         // fill byte
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }  // no length
    if (m === 0xd9 || m === 0xda) return null;                 // end / scan data before any frame
    const len = u16be(b, o + 2);
    if (len < 2) return null;
    if (m === 0xe1 && o + 2 + len <= b.length) orientation = exifOrientation(b, o + 4, o + 2 + len);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (o + 9 > b.length) return null;
      const s = sized(u16be(b, o + 7), u16be(b, o + 5));
      if (!s) return null;
      return orientation >= 5 ? { width: s.height, height: s.width } : s;
    }
    o += 2 + len;
  }
  return null;                                                 // frame header beyond what was read
}

/** The displayed pixel size encoded in these leading bytes, or null. */
export function imageSizeFromBytes(bytes) {
  if (!bytes || !bytes.length) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return pngSize(b) || jpegSize(b) || gifSize(b) || webpSize(b);
}

const cache = new Map();

/** `{ width, height }` for an image this build ships at `src` (a same-origin path under public/),
 *  else null. Remote and unreadable images are null — never a guess. One read per path per build. */
export function localImageSize(src, readHead = readPublicHead) {
  let rel = publicFilePath(src);
  if (!rel) return null;
  // `/img/%E5%9C%96.jpg` names the file `img/圖.jpg` on disk (the server decodes it the same way).
  // The decoded form is checked again, so an encoded `..` cannot climb out of public/.
  try { const d = decodeURIComponent(rel); if (publicFilePath('/' + d) === d) rel = d; } catch { /* keep the raw path */ }
  if (readHead === readPublicHead && cache.has(rel)) return cache.get(rel);
  let size = null;
  try { size = imageSizeFromBytes(readHead(rel, HEAD_BYTES)); } catch { size = null; }
  if (readHead === readPublicHead) cache.set(rel, size);
  return size;
}
