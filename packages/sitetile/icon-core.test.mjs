// REEF with Site — the icon set's guard: every built site has a favicon and an apple-touch-icon.
//   run: node packages/sitetile/icon-core.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 WHAT THIS IS HOLDING (measured 2026-08-28, from outside, on live sites): /favicon.ico,
// /favicon.svg and /apple-touch-icon.png all answered 404. Nothing was broken — the files were
// never emitted, and the <link> that would have named them was written `{favicon && …}`, so a site
// that had not set `favicon:` in its frontmatter emitted no link either. Two absences that hide
// each other: no tag pointing at a missing file, therefore no dead link to find.
//
// So the assertions below are deliberately about the ARTIFACTS, not about the code paths. The bytes
// are decoded and looked at — IHDR really says 180×180, the corner pixel really is the site's
// colour, the glyph really drew ink, the apple-touch icon really is opaque — because "a function
// returned a Buffer" is exactly what a broken encoder also does. The PNG chunk CRCs are checked
// against node:zlib's own crc32, which is an implementation this file does not own.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, crc32 } from 'node:zlib';
import {
  ICON_PATHS, APPLE_TOUCH_PX, ICO_PX, DEFAULT_BADGE_BG,
  siteMark, markType, siteInitial, badgeColors, iconHrefs, monogramKey,
  badgeSvg, badgePixels, appleTouchPng, faviconIco,
} from './icon-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASTRO = join(HERE, 'astro');
const layout = readFileSync(join(ASTRO, 'src/layouts/SiteLayout.astro'), 'utf8');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// ── a PNG decoder this file owns, so the assertions can look at pixels ───────────────────────────
function decodePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const declared = buf.readUInt32BE(off + 8 + len);
    // 🔴 the control on our own CRC table: node's zlib.crc32 is the independent implementation.
    assert.equal(declared, crc32(buf.subarray(off + 4, off + 8 + len)), `${type} chunk CRC`);
    chunks.push({ type, data });
    off += 12 + len;
  }
  assert.equal(off, buf.length, 'chunks cover the file exactly');
  const ihdr = chunks[0];
  assert.equal(ihdr.type, 'IHDR');
  assert.equal(chunks[chunks.length - 1].type, 'IEND', 'IEND is last');
  const width = ihdr.data.readUInt32BE(0), height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8], color = ihdr.data[9];
  assert.equal(depth, 8); assert.equal(color, 6, 'RGBA');
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = width * 4;
  assert.equal(raw.length, height * (stride + 1), 'one filter byte per row');
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, `row ${y} uses filter None`);
    raw.copy(px, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  }
  return { width, height, at: (x, y) => [...px.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)] };
}
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
/** every distinct opaque colour in the image — how we ask "did a glyph draw?" */
function inkPixels(img, fg) {
  let n = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (hex(img.at(x, y)) === fg) n++;
  return n;
}

// ── the born-valid claim ─────────────────────────────────────────────────────────────────────────

test('🔴 a site with NO frontmatter at all still gets all three icons', () => {
  const meta = {};
  const svg = badgeSvg(meta);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'an SVG');
  assert.ok(svg.includes(DEFAULT_BADGE_BG), 'painted with the shared default colour');
  const png = appleTouchPng(meta);
  const img = decodePng(png);
  assert.equal(img.width, APPLE_TOUCH_PX);
  assert.equal(img.height, APPLE_TOUCH_PX);
  const ico = faviconIco(meta);
  assert.ok(ico.length > 0);
  // it has no name, so it has no initial and no glyph — but it is still a valid, painted icon.
  assert.equal(siteInitial(meta), '');
  assert.equal(hex(img.at(0, 0)), DEFAULT_BADGE_BG);
});

test('🔴 the apple-touch icon is 180×180 and FULLY OPAQUE', () => {
  const img = decodePng(appleTouchPng({ brand: 'Lilac' }));
  assert.equal(img.width, APPLE_TOUCH_PX);
  let transparent = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.at(x, y)[3] !== 255) transparent++;
  // iOS composites transparency onto black; a rounded or padded icon wears black wedges.
  assert.equal(transparent, 0, 'not one non-opaque pixel');
});

test('the badge really draws its letter (and the corner stays the site colour)', () => {
  const meta = { brand: 'Lilac', 'icon-color': '#3d2b56' };
  const { bg, fg } = badgeColors(meta);
  const img = decodePng(appleTouchPng(meta));
  assert.equal(hex(img.at(2, 2)), bg, 'corner is the background');
  const ink = inkPixels(img, fg);
  assert.ok(ink > 500, `the L drew ink (got ${ink} px)`);
});

test('🔴 CONTROL: an initial this alphabet cannot draw yields a valid icon with NO ink', () => {
  // The honest limitation, asserted rather than described: 山 has no geometric skeleton here, so
  // the raster badge is the site's colour and nothing else. If this ever starts finding ink, the
  // monogram table has begun drawing a letter that is not the site's initial.
  const meta = { brand: '山田珈琲', 'icon-color': '#3d2b56' };
  assert.equal(siteInitial(meta), '山');
  assert.equal(monogramKey('山'), '', 'not in the alphabet');
  const img = decodePng(appleTouchPng(meta));
  assert.equal(inkPixels(img, badgeColors(meta).fg), 0, 'no glyph, no wrong glyph');
  // and the SVG — which the browser draws with its own fonts — still carries the real character.
  assert.ok(badgeSvg(meta).includes('>山</text>'), 'the SVG favicon keeps the initial');
});

test('every letter of the monogram alphabet actually draws', () => {
  for (const ch of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']) {
    assert.equal(monogramKey(ch), ch, `${ch} is in the table`);
    const px = badgePixels({ brand: ch }, 64, 0);
    let ink = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] > 200 && px[i + 1] > 200) ink++;   // white-ish
    assert.ok(ink > 60, `${ch} drew ${ink} ink pixels`);
  }
});

test('accents fold to their base letter; nothing else is guessed at', () => {
  assert.equal(monogramKey('É'), 'E');
  assert.equal(monogramKey('ü'), 'U');
  assert.equal(monogramKey('Ж'), '', 'Cyrillic is not Latin lookalikes');
  assert.equal(monogramKey('한'), '');
  assert.equal(monogramKey('🐟'), '');
  assert.equal(monogramKey(''), '');
});

// ── determinism: a rebuild must not churn these files ────────────────────────────────────────────

test('🔴 same site → byte-identical icons (a rebuild cannot churn them)', () => {
  const meta = { brand: 'Atlas', 'theme-color-dark': '#123456' };
  assert.equal(Buffer.compare(appleTouchPng(meta), appleTouchPng(meta)), 0, 'apple-touch-icon.png');
  assert.equal(Buffer.compare(faviconIco(meta), faviconIco(meta)), 0, 'favicon.ico');
  assert.equal(badgeSvg(meta), badgeSvg(meta), 'favicon.svg');
  // and it is a function of the SITE, not of the object it arrived in
  assert.equal(Buffer.compare(appleTouchPng({ ...meta }), appleTouchPng(meta)), 0);
});

// ── the .ico container ───────────────────────────────────────────────────────────────────────────

test('favicon.ico is a real ICO wrapping a 32×32 PNG', () => {
  const ico = faviconIco({ brand: 'Atlas' });
  assert.equal(ico.readUInt16LE(0), 0, 'reserved');
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 = icon');
  assert.equal(ico.readUInt16LE(4), 1, 'one image');
  assert.equal(ico[6], ICO_PX); assert.equal(ico[7], ICO_PX);
  const size = ico.readUInt32LE(14), offset = ico.readUInt32LE(18);
  assert.equal(offset, 22, 'the image starts right after the one directory entry');
  assert.equal(size, ico.length - 22, 'the declared byte count is the real one');
  const img = decodePng(ico.subarray(offset, offset + size));
  assert.equal(img.width, ICO_PX);
  assert.equal(img.at(0, 0)[3], 0, 'the corners are rounded away (transparent)');
  assert.equal(img.at(ICO_PX / 2, 1)[3], 255, 'the top edge between them is not');
});

// ── which name, which colour ─────────────────────────────────────────────────────────────────────

test('the initial is the first LETTER of what the site calls itself', () => {
  assert.equal(siteInitial({ brand: 'LILAC', title: 'Studio Lilac — comics' }), 'L', 'brand wins');
  assert.equal(siteInitial({ 'site-title': 'Atlas', title: 'About — Atlas' }), 'A', 'then the site title');
  assert.equal(siteInitial({ title: 'yamada coffee' }), 'Y', 'uppercased');
  assert.equal(siteInitial({ title: '「山田珈琲」' }), '山', 'leading punctuation is skipped');
  assert.equal(siteInitial({ title: '3 Little Birds' }), '3', 'a digit is a fine initial');
  assert.equal(siteInitial({ title: '— ??? —' }), '', 'a name with no letter in it has no initial');
  assert.equal(siteInitial({}), '');
});

test('the badge colour is the site\'s own, and the ink is never a choice', () => {
  assert.equal(badgeColors({ 'icon-color': '#ff5a36' }).bg, '#ff5a36', 'the explicit field wins');
  assert.equal(badgeColors({ 'theme-color-dark': '"#120d1c"', 'theme-color-light': '#b98fe0' }).bg, '#120d1c',
    'then the dark chrome colour, quotes and all');
  assert.equal(badgeColors({ 'theme-color-light': '#b98fe0' }).bg, '#b98fe0');
  assert.equal(badgeColors({}).bg, DEFAULT_BADGE_BG);
  assert.equal(badgeColors({ 'icon-color': 'rebeccapurple' }).bg, DEFAULT_BADGE_BG, 'only a hex is trusted');
  // ink: contrast, not preference. A site cannot configure itself into an unreadable icon.
  assert.equal(badgeColors({ 'icon-color': '#120d1c' }).fg, '#ffffff');
  assert.equal(badgeColors({ 'icon-color': '#aceace' }).fg, '#101010');
});

test('the SVG cannot be talked into carrying markup', () => {
  // The initial is always a letter or digit, so the glyph slot is closed by construction — but the
  // colours come from frontmatter too, and frontmatter is authored content.
  const svg = badgeSvg({ title: '<script>alert(1)</script>', 'icon-color': '#fff"><script>x</script>' });
  assert.ok(!svg.includes('<script'), 'no script survived');
  assert.ok(svg.includes(DEFAULT_BADGE_BG), 'the unparseable colour fell back');
  assert.ok(svg.includes('>S</text>'), 'and the initial is still the first letter of the name');
  assert.ok(!/on\w+=/.test(svg), 'no event handlers');
});

// ── what <head> links ────────────────────────────────────────────────────────────────────────────

test('a site with no mark links both generated files', () => {
  const { icon, appleTouch } = iconHrefs({ title: 'Atlas' }, {});
  assert.deepEqual(icon, [
    { href: ICON_PATHS.ico, sizes: '32x32' },
    { href: ICON_PATHS.svg, type: 'image/svg+xml' },
  ]);
  assert.equal(appleTouch, ICON_PATHS.apple);
});

test("🔴 an owner's mark wins — and only the mark is linked", () => {
  const svgMark = iconHrefs({ favicon: '/brand/mark.svg' }, {});
  assert.deepEqual(svgMark.icon, [{ href: '/brand/mark.svg', type: 'image/svg+xml' }]);
  // iOS ignores SVG, so the apple slot falls to the badge rather than to an icon that never draws.
  assert.equal(svgMark.appleTouch, ICON_PATHS.apple);
  const pngMark = iconHrefs({ favicon: '/brand/mark.png' }, {});
  assert.deepEqual(pngMark.icon, [{ href: '/brand/mark.png', type: 'image/png' }]);
  assert.equal(pngMark.appleTouch, '/brand/mark.png', 'a raster mark IS the touch icon');
  // the older fields SiteLayout has always fallen back to still work, in the same order
  assert.equal(siteMark({ 'site-logo': '/a.png', 'footer-logo': '/b.png' }), '/a.png');
  assert.equal(siteMark({ 'footer-logo': '/b.png' }), '/b.png');
  assert.equal(markType('/x/y.JPG?v=2'), 'image/jpeg');
  assert.equal(markType('https://cdn.example/x'), '', 'an untyped mark is linked without a type');
});

test('a PWA site keeps pointing at its own generated icon set', () => {
  // gen-icons.sh writes public/apple-touch-icon.png; Astro skips a route a public/ file claims.
  assert.equal(iconHrefs({ favicon: '/brand/mark.png' }, { hasPwa: true }).appleTouch, ICON_PATHS.apple);
});

// ── the wiring: a link that names a file nothing emits is the defect we started from ─────────────

test('🔴 the three routes exist and are the paths <head> names', () => {
  for (const [kind, path] of Object.entries(ICON_PATHS)) {
    const route = join(ASTRO, 'src/pages', path.slice(1) + '.js');
    assert.ok(existsSync(route), `${path} is emitted by src/pages/${path.slice(1)}.js (${kind})`);
    const src = readFileSync(route, 'utf8');
    assert.match(src, /from '@icons'/, `${path} draws from the shared model`);
    assert.match(src, /export function GET/, `${path} is a real endpoint`);
  }
  assert.match(readFileSync(join(ASTRO, 'astro.config.mjs'), 'utf8'), /'@icons':\s*fileURLToPath/,
    'the @icons alias is configured — without it every route above fails to build');
});

test('🔴 the icon links are UNCONDITIONAL in the layout', () => {
  assert.match(layout, /const iconLinks = iconHrefs\(meta, \{ hasPwa \}\)/, 'the rule comes from the model');
  assert.match(layout, /\{iconLinks\.icon\.map\(\(l\) => <link rel="icon"/, 'rel=icon comes from iconHrefs');
  assert.match(layout, /^\s*<link rel="apple-touch-icon" href=\{iconLinks\.appleTouch\} \/>$/m,
    'apple-touch-icon is emitted on every page, not gated on a site having set `favicon:`');
  // the shape of the original defect: an icon link that only exists when frontmatter did.
  assert.ok(!/\{favicon && <link rel="icon"/.test(layout), 'no conditional favicon link is left');
});

console.log(`\n${process.exitCode ? '❌' : '✅'} icon-core: ${passed} checks`);
