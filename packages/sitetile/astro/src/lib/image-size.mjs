// The intrinsic pixel size of an image the site ships in public/, read from its header at build
// time — so a post card can carry width/height and stop shifting the layout as images arrive.
//
// Read, never guessed: anything this cannot read with certainty returns null and the card gets no
// width/height at all, which is exactly what it had before. That covers remote images (never
// fetched at build), SVG/AVIF/anything not listed below, a truncated header, and a JPEG whose
// frame header sits past HEAD_BYTES.
//
// Formats: PNG (IHDR), GIF (logical screen), WebP (VP8 / VP8L / VP8X), JPEG (8-bit SOF0/1/2 only;
// every other frame type is declined — this is a layout hint, and declining costs only the hint).
// A declared length is checked against the file's real size, and every field read must lie in
// the bytes actually read. A JPEG's EXIF orientation 5–8 is a quarter turn, and browsers apply it
// (`image-orientation: from-image` is the default), so the displayed box is the stored one
// swapped — the size reported here is the DISPLAYED one, the box the browser has to reserve.
import { publicFilePath } from '../../../icon-core.mjs';
import { readPublicHead } from './public-file.mjs';

/** Bytes read per image. A JPEG's frame header follows its APPn segments (EXIF, ICC, XMP), which
 *  are each ≤ 64 KB; 256 KB covers every layout measured without reading whole photos. */
export const HEAD_BYTES = 256 * 1024;

// 🔴 Any doubt → null. Every field is read only from inside a structure whose declared length has
// been checked against the bytes actually present AND against the format's own rule for that
// structure (tile#269 review: an empty SOF, a truncated IHDR, a zero-length VP8X chunk and a GIF
// cut inside its screen descriptor all used to "read" a size from bytes beyond the structure).
const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

let CRC_TABLE = null;
function crc32(b) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// PNG: the whole IHDR chunk — length 13, every field in range (W3C PNG §11.2.1), and its CRC.
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const PNG_MAX = 0x7fffffff;
function pngSize(b) {
  if (b.length < 8 || u32be(b, 0) !== 0x89504e47 || u32be(b, 4) !== 0x0d0a1a0a) return null;
  if (b.length < 8 + 4 + 4 + 13 + 4) return null;                    // IHDR incomplete
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') return null;
  if (crc32(b.subarray(12, 29)) !== u32be(b, 29)) return null;
  const width = u32be(b, 16), height = u32be(b, 20), depth = b[24], type = b[25];
  if (width < 1 || width > PNG_MAX || height < 1 || height > PNG_MAX) return null;
  if (!PNG_DEPTHS[type] || !PNG_DEPTHS[type].includes(depth)) return null;
  if (b[26] !== 0 || b[27] !== 0 || (b[28] !== 0 && b[28] !== 1)) return null;
  return { width, height };
}

// GIF: the complete 7-byte logical screen descriptor after the 6-byte signature.
function gifSize(b) {
  if (b.length < 6 || !/^GIF8[79]a$/.test(ascii(b, 0, 6))) return null;
  if (b.length < 13) return null;
  const width = u16le(b, 6), height = u16le(b, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

// WebP: the declared RIFF must end within the FILE (its real size, not the bounded read), the first
// chunk's declared payload must end within that RIFF, and every field read must lie in the bytes
// actually read. A large VP8/VP8L bitstream runs past the bounded read; that is fine, because its
// end is checked against the file's size, which the reader knows without reading it.
function webpSize(b, fileSize) {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  if (b.length < 20) return null;
  const riff = u32le(b, 4), chunk = ascii(b, 12, 4), size = u32le(b, 16);
  if (riff % 2 || 8 + riff > fileSize) return null;                  // RIFF claims bytes the file lacks
  if (20 + size + (size % 2) > 8 + riff) return null;                 // chunk does not fit the RIFF
  const body = 20;
  if (chunk === 'VP8X') {
    if (size !== 10 || b.length < body + 10) return null;
    const width = u24le(b, body + 4) + 1, height = u24le(b, body + 7) + 1;
    return width * height <= 0xffffffff ? { width, height } : null;   // spec: canvas product < 2^32
  }
  if (chunk === 'VP8L') {
    if (size < 5 || b.length < body + 5 || b[body] !== 0x2f) return null;
    const bits = u32le(b, body + 1);
    if (bits >>> 29 !== 0) return null;                              // version must be 0
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    if (size < 10 || b.length < body + 10) return null;
    if ((b[body] & 1) !== 0) return null;                            // not a key frame
    if (b[body + 3] !== 0x9d || b[body + 4] !== 0x01 || b[body + 5] !== 0x2a) return null;
    const width = u16le(b, body + 6) & 0x3fff, height = u16le(b, body + 8) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  return null;
}

/**
 * The orientation an EXIF APP1 payload (`b[start, end)`) declares: a number 1–8, `undefined` when
 * this payload is not EXIF or EXIF with no Orientation entry (so it changes nothing), or `NaN`
 * when it IS EXIF but its structure or Orientation entry is malformed — which the caller treats
 * as doubt, and doubt is null.
 */
function exifOrientation(b, start, end) {
  if (end - start < 6 || ascii(b, start, 6) !== 'Exif\0\0') return undefined;
  const t = start + 6, len = end - t;
  if (len < 8) return NaN;
  const order = ascii(b, t, 2);
  if (order !== 'II' && order !== 'MM') return NaN;
  const le = order === 'II';
  const r16 = (p) => (le ? u16le(b, t + p) : u16be(b, t + p));
  const r32 = (p) => (le ? u32le(b, t + p) : u32be(b, t + p));
  if (r16(2) !== 42) return NaN;
  const ifd = r32(4);
  if (ifd < 8 || ifd + 2 > len) return NaN;
  const n = r16(ifd);
  if (ifd + 2 + n * 12 + 4 > len) return NaN;                       // entries + 4-byte next-IFD offset (RFC 1314 §3.A)
  let found;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (r16(e) !== 0x0112) continue;
    if (found !== undefined) return NaN;                             // two Orientation entries
    if (r16(e + 2) !== 3 || r32(e + 4) !== 1) return NaN;           // must be one SHORT
    const v = r16(e + 8);
    if (v < 1 || v > 8) return NaN;
    found = v;
  }
  return found;
}

// JPEG: walk the marker segments; a segment is used only when its whole declared length is present.
function jpegSize(b, fileSize) {
  if (b.length < 2 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2, orientation;
  while (o + 2 <= b.length) {
    if (b[o] !== 0xff) return null;
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; }                               // fill byte
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }  // standalone markers
    if (m === 0x00 || m === 0xd8 || m === 0xd9 || m === 0xda) return null;  // no frame before scan/end
    if (o + 4 > b.length) return null;
    const len = u16be(b, o + 2);
    if (len < 2 || o + 2 + len > fileSize) return null;              // declared past the end of file
    if (o + 2 + len > b.length) return null;                         // not wholly inside what was read
    const seg = o + 4, end = o + 2 + len;
    if (m === 0xe1) {
      const v = exifOrientation(b, seg, end);
      if (Number.isNaN(v)) return null;
      if (v !== undefined) {
        if (orientation !== undefined && orientation !== v) return null;   // two EXIFs disagree
        orientation = v;
      }
    }
    // Any other frame type (lossless, hierarchical, arithmetic: SOF3, SOF5–7, SOF9–11, SOF13–15) is
    // declined, not parsed: these are a layout hint, and a card does not need them to be right.
    if (m === 0xc3 || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) return null;
    // SOF0 (baseline), SOF1 (extended), SOF2 (progressive), 8-bit only, every component record
    // valid (ITU-T T.81 §B.2.2): 1–4 components, distinct ids, sampling 1–4, table selector 0–3.
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      if (len < 8) return null;
      const precision = b[seg], height = u16be(b, seg + 1), width = u16be(b, seg + 3), comps = b[seg + 5];
      if (precision !== 8 || comps < 1 || comps > 4 || len !== 8 + 3 * comps) return null;
      const ids = new Set();
      for (let i = 0; i < comps; i++) {
        const c = seg + 6 + i * 3, h = b[c + 1] >> 4, v = b[c + 1] & 15;
        if (ids.has(b[c]) || h < 1 || h > 4 || v < 1 || v > 4 || b[c + 2] > 3) return null;
        ids.add(b[c]);
      }
      if (width < 1 || height < 1) return null;                      // 0 height = DNL-defined: unknown here
      return (orientation || 1) >= 5 ? { width: height, height: width } : { width, height };
    }
    o = end;
  }
  return null;                                                       // frame header beyond what was read
}

/** The displayed pixel size encoded in these leading bytes of a file `fileSize` bytes long, or null.
 *  `fileSize` defaults to the bytes given (a whole file); a declared length is checked against it. */
export function imageSizeFromBytes(bytes, fileSize) {
  if (!bytes || !bytes.length) return null;
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const total = fileSize === undefined ? b.length : fileSize;
  if (!Number.isSafeInteger(total) || total < b.length) return null;
  return pngSize(b) || jpegSize(b, total) || gifSize(b) || webpSize(b, total);
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
  try { const r = readHead(rel, HEAD_BYTES); size = r ? imageSizeFromBytes(r.bytes, r.size) : null; } catch { size = null; }
  if (readHead === readPublicHead) cache.set(rel, size);
  return size;
}
