// Render a site's OG/share card to PNG — the picture that appears when someone posts a link.
//
// WHERE THIS RUNS. In the build container, after Astro has produced dist/ and before deploy —
// NOT at the edge, and not inside the Astro build. The reasoning, because it reverses twice:
//
//   • Not at the edge. An image that only exists because our worker renders it does not travel
//     with the site. Export the site, self-host it, and every share card dies. Portability is the
//     product here, so a feature that quietly un-ports the site is the wrong trade at any price.
//   • Not inside the Astro build. Rendering every page every time is the thing that walks a big
//     blog into the build-timeout wall (see the build-wall note); this runs once per page whose
//     title/description actually changed.
//   • So: a container, at publish. Which is also what makes satori the right tool rather than the
//     wrong one — the objection to satori was never the library, it was that a CJK font is ~16MB
//     and a Worker bundle has a hard limit. A container does not.
//
// 🔴 THE TRAP THIS FILE EXISTS TO CONTAIN. satori does NOT do per-glyph fallback between fonts
// that share a `name`. Hand it six chunks all called "OG" and it uses the first one; every glyph
// the others carried renders as a NO GLYPH box, with no error and exit code 0. CJK forces chunked
// fonts on you (one weight of Noto Sans TC is 106 unicode-range chunks), so this is not an exotic
// case — it is the default case, failing silently. Distinct names + a fontFamily cascade is the
// whole fix, and `familyList()` below is the only place allowed to build that list.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CARD_W = 1200;
export const CARD_H = 630;

/** Parse one fontsource package's per-weight CSS into [{pkg,file,ranges}] — the unicode-range map
 *  that says which chunk carries which codepoints. Built once per process, not per card. */
export function indexFontPackage(nodeModulesDir, pkg, weight) {
  const css = readFileSync(join(nodeModulesDir, '@fontsource', pkg, `${weight}.css`), 'utf8');
  const out = [];
  for (const block of css.split('@font-face').slice(1)) {
    // woff, deliberately not woff2: satori reads woff directly and fontsource ships both.
    const file = /url\(\.\/files\/([^)]+\.woff)\)/.exec(block);
    if (!file) continue;
    const decl = /unicode-range:\s*([^;]+);/.exec(block);
    const ranges = (decl ? decl[1] : 'U+0-10FFFF').split(',').map((s) => {
      const m = /U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?/.exec(s.trim());
      return m ? [parseInt(m[1], 16), parseInt(m[2] || m[1], 16)] : null;
    }).filter(Boolean);
    out.push({ pkg, file: file[1], ranges });
  }
  return out;
}

/** The chunks needed to draw `text`, in first-use order. Order matters: it becomes the cascade. */
export function chunksFor(text, index) {
  const picks = [];
  for (const ch of new Set([...String(text)])) {
    const cp = ch.codePointAt(0);
    const hit = index.find((e) => e.ranges.some(([a, b]) => cp >= a && cp <= b));
    if (hit && !picks.includes(hit)) picks.push(hit);
  }
  return picks;
}

/** 🔴 Distinct names, always. See the trap note at the top of this file. */
export function familyList(picks) {
  return picks.map((_, i) => `OGF${i}`);
}

export function fontsFor(nodeModulesDir, picks, weight) {
  const names = familyList(picks);
  return picks.map((p, i) => ({
    name: names[i],
    weight,
    style: 'normal',
    data: readFileSync(join(nodeModulesDir, '@fontsource', p.pkg, 'files', p.file)),
  }));
}

/** The card's markup. Kept as a plain object (satori's JSX-free form) so this file needs no
 *  transform step and can be unit-tested without a renderer. */
export function cardTree({ title, brand, bg, fg, family }) {
  const box = (children, style) => ({ type: 'div', props: { style: { display: 'flex', fontFamily: family, ...style }, children } });
  return box([
    box(title, { fontSize: 64, lineHeight: 1.25, maxHeight: 330, overflow: 'hidden' }),
    box(brand, { fontSize: 30, opacity: 0.75 }),
  ], {
    width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'space-between',
    padding: '70px', background: bg, color: fg,
  });
}

// ── reuse: a card says what it was drawn from ───────────────────────────────────────────────────
//
// A build may be handed cards a previous build drew — left in place, or offered in a directory —
// so that it draws only what changed. "The file exists" cannot be the test for that: a page's card
// depends on more than the page, and a file that exists says nothing about what it was drawn from.
// Rename the site and every card on disk still exists, and every one of them is wrong.
//
// So each card carries, inside the PNG, a key computed from everything it was drawn from, and it is
// kept only when that key equals the key of what this build would draw. Nothing has to remember to
// invalidate anything; there is no list of "things that affect a card" to keep in step with the
// drawing, because the key and the drawing read the same object:
//
//   · `cardInputs()` is the ONLY thing `renderCard` draws from, and its digest covers every key of
//     it — a new input cannot reach the picture without reaching the key.
//   · `rendererIdentity()` covers what turns those inputs into pixels: this file, the font files,
//     the renderer packages, the installed dependency tree, and the runtime.
//
// 🔴 Every doubt resolves to DRAWING. An unreadable, truncated, unstamped or differently-keyed file
// is not a card; it is redrawn. The two mistakes are not symmetric — drawing a card that was fine
// costs milliseconds, keeping one that is stale puts the wrong picture on someone's link.

/** Everything a card is drawn from, normalised: the one object both the drawing and its key read. */
export function cardInputs({ title, brand = '', bg = '#111111', fg = '#ffffff' } = {}) {
  return { title: String(title ?? ''), brand: String(brand), bg: String(bg), fg: String(fg) };
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Digest of a card's inputs. Covers EVERY key of `cardInputs()`, as [key, value] pairs so that
 *  moving a character from one field to the next cannot produce the same digest. */
export function inputsDigest(raw) {
  const card = cardInputs(raw);
  return sha256(JSON.stringify(Object.keys(card).sort().map((k) => [k, card[k]])));
}

/** The key stamped into a card: which renderer drew it, from which inputs. */
export function cardKey(rendererId, raw) {
  return `v1 ${rendererId} ${inputsDigest(raw)}`;
}
const KEY_SHAPE = /^v1 [0-9a-f]{64} ([0-9a-f]{64})$/;

/**
 * What turns inputs into pixels, as one digest — or null when that cannot be established.
 *
 * The installed dependency tree is read from the package manager's own record of it, because the
 * renderer's direct dependencies are not the whole story: the layout engine and the font parser
 * arrive transitively, and either can move a glyph without any version named here changing. With
 * no such record there is nothing to show two installs are the same, so the answer is null and
 * nothing is reused. Coarse on purpose — an unrelated dependency bump redraws every card once.
 */
/**
 * The parts of the machine a card's pixels depend on that no file under node_modules records.
 *
 * Line breaking asks the runtime where words end (so the Node and ICU versions matter), and the
 * rasteriser is a native binary chosen at load time by platform, architecture AND C library — the
 * package manager installs the glibc and the musl build side by side, so the install record is
 * identical on both and cannot tell them apart.
 */
export function currentRuntime() {
  let glibc = '';
  try { glibc = process.report?.getReport?.().header?.glibcVersionRuntime || ''; } catch { /* not glibc, or no report */ }
  return { node: process.version, platform: process.platform, arch: process.arch, icu: process.versions.icu || '', glibc };
}

export function rendererIdentity({ nodeModulesDir, packages, weight, index, runtime = currentRuntime() }) {
  const lock = [join(nodeModulesDir, '.package-lock.json'), join(nodeModulesDir, '..', 'package-lock.json')]
    .map((p) => { try { return readFileSync(p); } catch { return null; } }).find(Boolean);
  if (!lock) return null;
  const h = createHash('sha256');
  // Length-prefixed, so two neighbouring parts cannot trade bytes and hash the same.
  const add = (label, bytes) => { h.update(`${label}\0${bytes.length}\0`); h.update(bytes); };
  add('source', readFileSync(fileURLToPath(import.meta.url)));
  add('shape', Buffer.from(JSON.stringify({ packages, weight, w: CARD_W, h: CARD_H })));
  // Every key of it, as pairs — the same shape as the inputs digest, for the same reason.
  add('runtime', Buffer.from(JSON.stringify(Object.keys(runtime).sort().map((k) => [k, runtime[k]]))));
  add('tree', lock);
  for (const dep of ['satori', '@resvg/resvg-js']) add(`dep ${dep}`, readFileSync(join(nodeModulesDir, dep, 'package.json')));
  for (const pkg of packages) add(`ranges ${pkg}`, readFileSync(join(nodeModulesDir, '@fontsource', pkg, `${weight}.css`)));
  for (const e of index) add(`font ${e.pkg}/${e.file}`, readFileSync(join(nodeModulesDir, '@fontsource', e.pkg, 'files', e.file)));
  return h.digest('hex');
}

// The key travels INSIDE the PNG, as a text chunk. A separate list of keys would be a second file
// that has to agree with the first, fetched at a different moment; a card that carries its own key
// cannot disagree with itself.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const CARD_STAMP_KEYWORD = 'sitetile:card';
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The chunks of ONE COMPLETE, INTACT PNG — or null. Every checksum is verified and the image must
 *  end exactly at its end marker: a download cut short still starts like a PNG, and its key (which
 *  sits near the front) would otherwise vouch for a picture that is missing its bottom half. */
function pngChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunks = [];
  let at = 8;
  while (at + 12 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const end = at + 12 + len;
    if (end > buf.length) return null;
    if (crc32(buf, at + 4, at + 8 + len) !== buf.readUInt32BE(at + 8 + len)) return null;
    const type = buf.toString('latin1', at + 4, at + 8);
    chunks.push({ type, dataStart: at + 8, dataEnd: at + 8 + len, end });
    at = end;
    if (type === 'IEND') break;
  }
  if (chunks.length < 2 || chunks[0].type !== 'IHDR' || chunks[chunks.length - 1].type !== 'IEND' || at !== buf.length) return null;
  return chunks;
}
const stampsIn = (buf, chunks) => chunks
  .filter((c) => c.type === 'tEXt')
  .map((c) => buf.toString('latin1', c.dataStart, c.dataEnd).split('\0'))
  .filter((parts) => parts.length === 2 && parts[0] === CARD_STAMP_KEYWORD)
  .map((parts) => parts[1]);

/** Put `key` into a freshly drawn PNG. Throws when the bytes are not a PNG: a renderer that hands
 *  back something else has failed, and saving that under a .png name would hide it. */
export function stampCard(png, key) {
  const buf = Buffer.from(png);
  const chunks = pngChunks(buf);
  if (!chunks) throw new Error('og-card: the renderer returned bytes that are not a complete PNG');
  if (stampsIn(buf, chunks).length) throw new Error('og-card: refusing to stamp a card that is already stamped');
  const data = Buffer.from(`${CARD_STAMP_KEYWORD}\0${key}`, 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk, 4, 8 + data.length), 8 + data.length);
  const afterHeader = chunks[0].end;
  return Buffer.concat([buf.subarray(0, afterHeader), chunk, buf.subarray(afterHeader)]);
}

/** The key a card carries, or null — for anything that is not one intact PNG with exactly one key.
 *  Two keys is not "take the first": a card that says two things about itself says nothing. */
export function cardStamp(bytes) {
  const buf = Buffer.from(bytes);
  const chunks = pngChunks(buf);
  if (!chunks) return null;
  const stamps = stampsIn(buf, chunks);
  return stamps.length === 1 && KEY_SHAPE.test(stamps[0]) ? stamps[0] : null;
}

/**
 * May these bytes stand in for the card this build would draw?
 *
 * `key` is the full key, and it is what a build with a working renderer compares. `inputs` alone is
 * for a build whose renderer could not be set up at all: nothing can be drawn there, so the renderer
 * half cannot be compared with anything — but the card's content still can, and a card proven to
 * show this page's own title, name and colours is better kept than dropped. The moment a renderer
 * exists again its identity is compared again.
 */
export function cardMatches(bytes, { key = null, inputs = null } = {}) {
  const stamp = cardStamp(bytes);
  if (!stamp) return false;
  if (key) return stamp === key;
  return inputs ? KEY_SHAPE.exec(stamp)[1] === inputsDigest(inputs) : false;
}

/** Build a renderer bound to one font set. `satori` and `Resvg` are injected so this module stays
 *  importable (and testable) on a machine that has not installed them. */
export function makeCardRenderer({ satori, Resvg, nodeModulesDir, packages, weight = 700 }) {
  const index = packages.flatMap((pkg) => indexFontPackage(nodeModulesDir, pkg, weight));
  if (!index.length) throw new Error('og-card: no font chunks indexed — check the fontsource packages');
  const id = rendererIdentity({ nodeModulesDir, packages, weight, index });
  async function renderCard(raw) {
    // 🔴 Drawn from `card` and nothing else. The key below is computed from the same object, so an
    // input that reaches the picture by any other route is an input the key cannot see.
    const card = cardInputs(raw);
    const text = `${card.title}${card.brand}`;
    const picks = chunksFor(text, index);
    if (!picks.length) throw new Error(`og-card: no font covers any glyph of ${JSON.stringify(text.slice(0, 40))}`);
    const fonts = fontsFor(nodeModulesDir, picks, weight);
    const family = familyList(picks).join(', ');
    const svg = await satori(cardTree({ ...card, family }), { width: CARD_W, height: CARD_H, fonts });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_W } }).render().asPng();
    // No identity ⇒ no key ⇒ this card can never be shown unchanged, which is the honest outcome.
    return id ? stampCard(png, cardKey(id, card)) : Buffer.from(png);
  }
  /** The key `renderCard(raw)` would stamp, without drawing — or null when there is no identity. */
  renderCard.keyFor = (raw) => (id ? cardKey(id, raw) : null);
  return renderCard;
}

// ── the gate's own predicates, extracted so they have a permanent control group ──────────────────
// SiteLayout emits og:image before this build step creates the file. If a render silently fails the
// page ships a tag aimed at a 404, and a dead share card looks exactly like no share card to
// everyone except the person who clicked. These two are what the build step refuses on.

/** absolute-or-relative og:image → the site-root-relative path, or '' if it is somebody else's. */
export function ourCardPath(ogImage) {
  const path = String(ogImage || '').replace(/^https?:\/\/[^/]+/, '');
  // A `..` segment is never something the layout emits (a URL's pathname has none), and the path
  // is about to be joined onto dist/ to read, replace and delete a file.
  return path.startsWith('/og/') && path.endsWith('.png') && !path.split('/').includes('..') ? path : '';
}

/** the cards a page claims but disk does not have. `exists` is injected so this is testable. */
export function deadCards(pages, exists) {
  return pages.filter((p) => {
    const rel = ourCardPath(p.img);
    return rel && !exists(rel);
  });
}
