// REEF with Site — the site ICON SET (favicon + apple-touch-icon), the pure model.
// Same posture as site-core / pwa-core / og-card: zero I/O, node-runnable, unit-testable without a
// renderer. The Astro layer (astro/src/pages/favicon.*.js, apple-touch-icon.png.js) is a three-line
// wrapper around this file, and SiteLayout asks it what to put in <head>. One rule, one place.
//
// 🩸 WHY THIS EXISTS. Measured from outside on 2026-08-28: three sites built by this renderer
// answered 404 for /favicon.ico, /favicon.svg AND /apple-touch-icon.png. A fourth had an
// apple-touch-icon only because a person had hand-placed one. Every browser asks for /favicon.ico
// without being told to, iOS asks for /apple-touch-icon.png when it adds a page to the home screen,
// and link-preview crawlers ask for both — so a built site was answering "nothing" to the one
// question every client asks it unprompted. The site's own `favicon:` frontmatter had existed the
// whole time; a site that never set it emitted no icon link at all, which is why the gap was
// invisible to the sites that HAD set one.
//
// BORN-VALID is the whole point: no opt-in, no frontmatter, no build flag. A site with nothing
// configured gets a badge — its own initial on its own theme colour — at all three well-known
// paths, plus the <link> tags that name them. A site that HAS a mark keeps it: the mark wins in
// <head>, and a hand-placed public/favicon.ico (or apple-touch-icon.png, which is what REEF with
// PWA's gen-icons.sh writes) wins the FILE, because Astro skips a route whose name a public/ file
// already claims. Nothing here can take an icon away from a site that had one.
//
// NO RASTERIZER. iOS ignores SVG for apple-touch-icon — it wants a real PNG — and this package
// will not put a native image library (or a font engine) on the critical path of every site build.
// So the PNG is drawn here: an analytic distance-field rasterizer over a stroked geometric
// alphabet, encoded with node:zlib + a CRC32 table. ~200 lines, no dependency, no build step, and
// the bytes are testable in CI. What that costs is honest and documented at MONOGRAM below: the
// raster badge can draw A–Z and 0–9 (accents folded to their base letter) and nothing else — a
// site whose initial is 山 gets its character in the SVG favicon, which is what browsers use, and
// a plain colour badge on the iOS home screen.
//
// DETERMINISM. Same site → byte-identical files, every rebuild. Nothing here reads a clock, a
// random source, or the filesystem; the drawing is pure float math. That matters because these
// files are re-emitted on every build of every site: a badge that churned would show up as a diff
// in every deploy forever.

import { deflateSync } from 'node:zlib';

/** The three well-known paths. Client code names these constants, never the strings. */
export const ICON_PATHS = { ico: '/favicon.ico', svg: '/favicon.svg', apple: '/apple-touch-icon.png' };
/** Apple's documented home-screen size. iOS downscales from it for every other slot. */
export const APPLE_TOUCH_PX = 180;
/** The single image inside favicon.ico. 32 is what a browser tab actually paints at 2× DPR. */
export const ICO_PX = 32;
/** The badge colour a site that has declared NO colour at all falls back to. Deliberately the same
 *  constant SiteLayout already defaults `theme-color-dark` to, so the tab icon and the tab chrome
 *  are the same colour rather than two platform defaults that disagree. */
export const DEFAULT_BADGE_BG = '#084a4c';

// ── the site's own answers: mark, initial, colour ────────────────────────────────────────────────

const str = (v) => String(v == null ? '' : v).trim();
/** frontmatter values arrive with the author's quotes still on them (`theme-color-dark: "#111"`). */
const unquote = (v) => str(v).replace(/^["']|["']$/g, '');

/**
 * The owner's mark, as they wrote it. `favicon:` is the field for exactly this; `site-logo:` /
 * `footer-logo:` are the older ones SiteLayout has always fallen back to, kept in the same order so
 * this returns what the <head> has always linked.
 */
export function siteMark(meta) {
  const m = meta || {};
  return str(m.favicon || m['site-logo'] || m['footer-logo']);
}

/** The `<link rel=icon type=…>` value for a mark, or '' when its type is not one we can name. */
export function markType(mark) {
  const p = str(mark).split(/[?#]/)[0].toLowerCase();
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.ico')) return 'image/x-icon';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.webp')) return 'image/webp';
  return '';
}

/**
 * The badge's letter: the first LETTER OR DIGIT of what the site calls itself.
 * `brand:` first (the short wordmark a site picks for its own header), then the site title, then
 * the page title. Punctuation and leading quotes are skipped — a site titled 「山田珈琲」 is 山, not 「.
 * Grapheme-aware, so a combining pair or an emoji initial survives as one character.
 */
export function siteInitial(meta) {
  const m = meta || {};
  const name = str(m.brand) || str(m['site-title']) || str(m.title) || str(m['blog-title']);
  if (!name) return '';
  const graphemes = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter().segment(name)].map((s) => s.segment)
    : [...name];
  const first = graphemes.find((g) => /[\p{L}\p{N}]/u.test(g));
  if (!first) return '';
  // toUpperCase can lengthen a grapheme (ß → SS); the badge holds one.
  return [...first.toUpperCase()][0];
}

/** sRGB hex → relative luminance (WCAG 2.x), used only to choose ink. */
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const ch = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The badge's two colours.
 *
 * The BACKGROUND is the site's own, never the platform's: `icon-color:` if the owner named one,
 * else the theme colour the site already tells browsers to paint its chrome with (dark first — a
 * badge is a solid tile and the deep end of a palette is the one that reads as a mark), else the
 * one shared default. The INK is not a choice: it is whichever of white/near-black actually reads
 * on that background. A site cannot configure itself into an unreadable icon.
 */
export function badgeColors(meta) {
  const m = meta || {};
  const pick = [m['icon-color'], m['theme-color-dark'], m['theme-color-light']]
    .map(unquote).find((v) => HEX.test(v));
  const bg = (pick || DEFAULT_BADGE_BG).toLowerCase();
  return { bg, fg: luminance(bg) > 0.42 ? '#101010' : '#ffffff' };
}

// ── what <head> links ────────────────────────────────────────────────────────────────────────────

/**
 * The icon links for one page's <head>. The rule, in one place, so the layout cannot hold a second
 * copy of it that drifts:
 *
 *   · a site WITH a mark links the mark, and only the mark, for rel=icon. Emitting our badge
 *     beside it would put two rel=icon links on the page and let each browser's own preference
 *     order decide which brand a visitor sees.
 *   · a site with NO mark links the two generated files: .ico (what every browser and crawler
 *     already asks for) and .svg (crisp at any size, and the one a modern browser prefers).
 *   · apple-touch-icon is always linked, because iOS reads THAT and ignores rel=icon. It points at
 *     the mark only when the mark is a raster; an SVG mark linked here is an icon iOS silently
 *     drops — which is how a site with a perfectly good logo ends up with a screenshot on
 *     somebody's home screen.
 */
export function iconHrefs(meta, opts) {
  const mark = siteMark(meta);
  const type = markType(mark);
  const raster = /^image\/(png|jpeg|webp)$/.test(type);
  const icon = mark
    ? [{ href: mark, type: type || '' }]
    : [{ href: ICON_PATHS.ico, sizes: '32x32' }, { href: ICON_PATHS.svg, type: 'image/svg+xml' }];
  // REEF with PWA ships its own opaque icon set into public/ (gen-icons.sh); that file wins the
  // path by Astro's own public/-beats-route rule, so a PWA site keeps pointing at it.
  const appleTouch = (opts && opts.hasPwa) || !raster ? ICON_PATHS.apple : mark;
  return { icon, appleTouch };
}

// ── the SVG badge ────────────────────────────────────────────────────────────────────────────────

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The badge as SVG — the tab icon of every modern browser, and the only one of the three that can
 * show ANY script's initial, because the browser draws the text with its own fonts. No <script>,
 * no external reference: an SVG favicon is loaded in the image sandbox, where both are inert
 * anyway, and this keeps the file honest for anyone who opens it.
 */
export function badgeSvg(meta) {
  const { bg, fg } = badgeColors(meta);
  const initial = siteInitial(meta);
  const glyph = initial
    ? `<text x="32" y="32" dy=".35em" fill="${fg}" font-family="system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif"`
      + ` font-size="38" font-weight="700" text-anchor="middle">${escXml(initial)}</text>`
    : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img"'
    + ` aria-label="${escXml(initial || 'icon')}">`
    + `<rect width="64" height="64" rx="14" fill="${bg}"/>${glyph}</svg>\n`;
}

// ── MONOGRAM: the alphabet the raster badge can draw ─────────────────────────────────────────────
//
// A stroked geometric alphabet, defined as segments and arcs on a unit square (y down), drawn with
// one constant stroke width. It exists because the PNG has no font engine behind it: the only way
// to put a letter in these bytes is to describe the letter's SKELETON and stroke it.
//
// COVERAGE, stated plainly: A–Z and 0–9. A Latin initial carrying a diacritic is folded to its base
// letter (É → E) — the SVG favicon still shows É, and the alternative on the home screen is a blank
// tile. Anything else (CJK, Cyrillic, Greek, emoji, an initial that is only punctuation) draws no
// glyph at all: the badge is the site's colour and nothing more. That is the honest failure — a
// wrong letter would be worse than none, and hand-drawing more alphabets here would be a font.
//
// 🔴 WHAT THE TESTS CANNOT SEE. icon-core.test.mjs proves a glyph drew INK — it cannot prove the
// ink spells the right letter, which is the same limit og-card.test.mjs records ("the picture still
// needs eyes"). The 36 shapes below were checked by rendering the whole alphabet onto one proof
// sheet and looking at it; S was wrong the first time and looked like a circle with a hook. If you
// change a skeleton, render the sheet again and LOOK.
//
//   ['s', x1,y1, x2,y2]        a stroked segment, round caps
//   ['a', cx,cy, r, a0,a1]     a stroked arc, degrees, 0° = east, 90° = SOUTH (y is down),
//                              swept from a0 upward to a1 (a1 may exceed 360)
const G = {
  A: [['s', 0.5, 0, 0.06, 1], ['s', 0.5, 0, 0.94, 1], ['s', 0.19, 0.72, 0.81, 0.72]],
  B: [['s', 0.10, 0, 0.10, 1], ['s', 0.10, 0, 0.46, 0], ['s', 0.10, 0.5, 0.46, 0.5], ['s', 0.10, 1, 0.46, 1],
      ['a', 0.46, 0.25, 0.25, -90, 90], ['a', 0.46, 0.75, 0.25, -90, 90]],
  C: [['a', 0.5, 0.5, 0.44, 40, 320]],
  D: [['s', 0.10, 0, 0.10, 1], ['s', 0.10, 0, 0.40, 0], ['s', 0.10, 1, 0.40, 1], ['a', 0.40, 0.5, 0.5, -90, 90]],
  E: [['s', 0.12, 0, 0.12, 1], ['s', 0.12, 0, 0.82, 0], ['s', 0.12, 0.5, 0.72, 0.5], ['s', 0.12, 1, 0.82, 1]],
  F: [['s', 0.12, 0, 0.12, 1], ['s', 0.12, 0, 0.82, 0], ['s', 0.12, 0.5, 0.72, 0.5]],
  G: [['a', 0.5, 0.5, 0.44, 0, 320], ['s', 0.60, 0.5, 0.94, 0.5]],
  H: [['s', 0.10, 0, 0.10, 1], ['s', 0.90, 0, 0.90, 1], ['s', 0.10, 0.5, 0.90, 0.5]],
  I: [['s', 0.5, 0, 0.5, 1]],
  J: [['s', 0.72, 0, 0.72, 0.72], ['a', 0.44, 0.72, 0.28, 0, 180]],
  K: [['s', 0.12, 0, 0.12, 1], ['s', 0.86, 0, 0.16, 0.56], ['s', 0.36, 0.44, 0.88, 1]],
  L: [['s', 0.14, 0, 0.14, 1], ['s', 0.14, 1, 0.82, 1]],
  M: [['s', 0.08, 1, 0.08, 0], ['s', 0.08, 0, 0.5, 0.68], ['s', 0.5, 0.68, 0.92, 0], ['s', 0.92, 0, 0.92, 1]],
  N: [['s', 0.10, 1, 0.10, 0], ['s', 0.10, 0, 0.90, 1], ['s', 0.90, 1, 0.90, 0]],
  O: [['a', 0.5, 0.5, 0.44, 0, 360]],
  P: [['s', 0.12, 0, 0.12, 1], ['s', 0.12, 0, 0.44, 0], ['a', 0.44, 0.28, 0.28, -90, 90], ['s', 0.44, 0.56, 0.12, 0.56]],
  Q: [['a', 0.5, 0.5, 0.42, 0, 360], ['s', 0.62, 0.66, 0.94, 1]],
  R: [['s', 0.12, 0, 0.12, 1], ['s', 0.12, 0, 0.44, 0], ['a', 0.44, 0.28, 0.28, -90, 90],
      ['s', 0.44, 0.56, 0.12, 0.56], ['s', 0.42, 0.56, 0.90, 1]],
  // two bowls of equal sweep + the spine that joins them. Without the spine the arcs meet only if
  // one of them is swept nearly all the way round, and a 280° bowl reads as a circle with a hook.
  S: [['a', 0.5, 0.28, 0.28, -250, -20], ['s', 0.404, 0.543, 0.596, 0.457], ['a', 0.5, 0.72, 0.28, -70, 160]],
  T: [['s', 0.06, 0, 0.94, 0], ['s', 0.5, 0, 0.5, 1]],
  U: [['s', 0.10, 0, 0.10, 0.62], ['a', 0.5, 0.62, 0.40, 0, 180], ['s', 0.90, 0, 0.90, 0.62]],
  V: [['s', 0.06, 0, 0.5, 1], ['s', 0.94, 0, 0.5, 1]],
  W: [['s', 0.04, 0, 0.28, 1], ['s', 0.28, 1, 0.5, 0.30], ['s', 0.5, 0.30, 0.72, 1], ['s', 0.72, 1, 0.96, 0]],
  X: [['s', 0.08, 0, 0.92, 1], ['s', 0.92, 0, 0.08, 1]],
  Y: [['s', 0.08, 0, 0.5, 0.52], ['s', 0.92, 0, 0.5, 0.52], ['s', 0.5, 0.52, 0.5, 1]],
  Z: [['s', 0.10, 0, 0.90, 0], ['s', 0.90, 0, 0.10, 1], ['s', 0.10, 1, 0.90, 1]],
  0: [['a', 0.5, 0.5, 0.40, 0, 360]],
  1: [['s', 0.5, 0, 0.5, 1], ['s', 0.5, 0, 0.24, 0.22]],
  2: [['a', 0.5, 0.32, 0.32, 180, 400], ['s', 0.745, 0.526, 0.12, 1], ['s', 0.10, 1, 0.90, 1]],
  3: [['a', 0.5, 0.28, 0.28, -170, 90], ['a', 0.5, 0.72, 0.28, -90, 170]],
  4: [['s', 0.70, 0, 0.08, 0.70], ['s', 0.08, 0.70, 0.94, 0.70], ['s', 0.70, 0, 0.70, 1]],
  5: [['s', 0.84, 0, 0.20, 0], ['s', 0.20, 0, 0.20, 0.40], ['a', 0.5, 0.66, 0.34, -135, 140]],
  6: [['a', 0.5, 0.66, 0.32, 0, 360], ['a', 0.82, 0.66, 0.66, 200, 250]],
  7: [['s', 0.10, 0, 0.90, 0], ['s', 0.90, 0, 0.36, 1]],
  8: [['a', 0.5, 0.28, 0.27, 0, 360], ['a', 0.5, 0.74, 0.30, 0, 360]],
  9: [['a', 0.5, 0.34, 0.32, 0, 360], ['a', 0.18, 0.34, 0.66, 20, 70]],
};

/** Stroke width, in the same unit-square units the table above is written in. */
const STROKE = 0.17;

/** The drawable form of an initial, or '' when this alphabet has no letter for it. */
export function monogramKey(initial) {
  if (!initial) return '';
  // fold combining marks (É → E) — NFD splits the base letter from its accent, \p{M} drops it.
  const base = String(initial).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  const ch = [...base][0] || '';
  return Object.prototype.hasOwnProperty.call(G, ch) ? ch : '';
}

// ── the rasterizer: analytic distance fields, no dependency ──────────────────────────────────────
//
// Every primitive answers "how far is this pixel from my centre line", the shapes are unioned by
// taking the minimum, and coverage is the 1px ramp across that distance. That is the whole
// anti-aliasing story: no sampling, no jitter, and identical output on every machine, which is what
// keeps a rebuild from re-writing these files.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01((wx * vx + wy * vy) / len2);
  const dx = wx - vx * t, dy = wy - vy * t;
  return Math.hypot(dx, dy);
}

function sdArc(px, py, cx, cy, r, a0, a1) {
  const dx = px - cx, dy = py - cy;
  const len = Math.hypot(dx, dy);
  const sweep = a1 - a0;
  if (sweep >= 360) return Math.abs(len - r);            // full circle: no ends to fall off
  // 🩸 normalise INTO [a0, a0+360), not just upward. `while (ang < a0) ang += 360` looks equivalent
  // and is not: a point due west (atan2 → 180°) of an arc starting at -250° is already ≥ a0, so it
  // was compared as 180 against an end of -20 and fell outside a sweep it is squarely inside. Only
  // S reaches that far below zero, and S rendered as a circle with a hook on it.
  const raw = Math.atan2(dy, dx) * 180 / Math.PI;        // 0° = east, +90° = south (y is down)
  const ang = a0 + (((raw - a0) % 360) + 360) % 360;
  if (ang <= a1) return Math.abs(len - r);
  const end = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)];
  const [x0, y0] = end(a0), [x1, y1] = end(a1);
  return Math.min(Math.hypot(px - x0, py - y0), Math.hypot(px - x1, py - y1));
}

/** Distance from a point to the nearest centre line of a glyph's primitives. */
function sdGlyph(px, py, prims) {
  let d = Infinity;
  for (const p of prims) {
    d = Math.min(d, p[0] === 's' ? sdSegment(px, py, p[1], p[2], p[3], p[4])
                                 : sdArc(px, py, p[1], p[2], p[3], p[4], p[5]));
  }
  return d;
}

/** The glyph's real inked bounds, so a narrow letter (I) is centred instead of stretched. */
function glyphBounds(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const at = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of prims) {
    if (p[0] === 's') { at(p[1], p[2]); at(p[3], p[4]); continue; }
    const [, cx, cy, r, a0, a1] = p;
    for (let a = a0; a <= a1; a += 1) at(cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180));
    at(cx + r * Math.cos(a1 * Math.PI / 180), cy + r * Math.sin(a1 * Math.PI / 180));
  }
  const h = STROKE / 2;
  return { x0: x0 - h, y0: y0 - h, x1: x1 + h, y1: y1 + h };
}

/** '#rrggbb' | '#rgb' → [r,g,b] */
function rgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** Rounded-square distance (negative inside), used to knock the corners off the small icon. */
function sdRoundSquare(px, py, size, r) {
  const qx = Math.abs(px - size / 2) - (size / 2 - r), qy = Math.abs(py - size / 2) - (size / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Draw the badge into raw RGBA. `radius` is in pixels (0 = full bleed, which is what an
 * apple-touch-icon must be: iOS masks its own corners and composites anything transparent onto
 * black, so rounding it here would put black wedges on somebody's home screen).
 */
export function badgePixels(meta, size, radius = 0) {
  const { bg, fg } = badgeColors(meta);
  const [br, bgc, bb] = rgb(bg);
  const [fr, fg_, fb] = rgb(fg);
  const key = monogramKey(siteInitial(meta));
  const prims = key ? G[key] : null;

  // the glyph box: a square 56% of the icon, centred, with the letter fitted inside it uniformly.
  let sc = 0, ox = 0, oy = 0;
  if (prims) {
    const b = glyphBounds(prims);
    const box = size * 0.56;
    sc = Math.min(box / (b.x1 - b.x0), box / (b.y1 - b.y0));
    ox = size / 2 - ((b.x0 + b.x1) / 2) * sc;
    oy = size / 2 - ((b.y0 + b.y1) / 2) * sc;
  }
  const inkHalf = (STROKE / 2) * sc;

  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const inside = radius > 0 ? clamp01(0.5 - sdRoundSquare(cx, cy, size, radius)) : 1;
      let r = br, g = bgc, b = bb;
      if (prims) {
        const d = sdGlyph((cx - ox) / sc, (cy - oy) / sc, prims) * sc - inkHalf;
        const cov = clamp01(0.5 - d);
        if (cov > 0) { r = br + (fr - br) * cov; g = bgc + (fg_ - bgc) * cov; b = bb + (fb - bb) * cov; }
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r); px[i + 1] = Math.round(g); px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(inside * 255);
    }
  }
  return px;
}

// ── PNG + ICO containers ─────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA pixels → a PNG (colour type 6, 8-bit). Filter 0 on every row: a flat badge gives the
 *  deflater long runs to eat, and it keeps the encoder something a person can read. */
export function encodePng(px, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-image .ico wrapping a PNG. Every browser since IE11 reads PNG-in-ICO, and the alternative
 *  is a BMP encoder with a bottom-up upside-down bitmap and a legacy AND mask. */
export function encodeIco(png, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);   // reserved, type=icon, count
  head[6] = size >= 256 ? 0 : size; head[7] = size >= 256 ? 0 : size;             // 0 means 256
  head[8] = 0; head[9] = 0;
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);                          // planes, bpp
  head.writeUInt32LE(png.length, 14);                                             // bytes of the image
  head.writeUInt32LE(22, 18);                                                     // offset of the image
  return Buffer.concat([head, png]);
}

// ── what the routes emit ─────────────────────────────────────────────────────────────────────────

/** /apple-touch-icon.png — 180×180, full bleed, OPAQUE. */
export function appleTouchPng(meta) {
  return encodePng(badgePixels(meta, APPLE_TOUCH_PX, 0), APPLE_TOUCH_PX);
}

/** /favicon.ico — one 32×32 image, corners rounded (it is shown as a small tile, not a photo). */
export function faviconIco(meta) {
  const png = encodePng(badgePixels(meta, ICO_PX, Math.round(ICO_PX * 0.22)), ICO_PX);
  return encodeIco(png, ICO_PX);
}
