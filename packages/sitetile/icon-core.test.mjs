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
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  ICON_PATHS, APPLE_TOUCH_PX, ICO_PX, DEFAULT_BADGE_BG,
  siteMark, markType, siteInitial, badgeColors, iconHrefs, monogramKey,
  badgeSvg, badgePixels, appleTouchPng, faviconIco,
  ownerFavicon, publicFilePath, pngSize, ownerPng, badgePaths, appleTouchFile,
} from './icon-core.mjs';
import { safeSrc } from './site-core.js';

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
    { href: ICON_PATHS.ico, sizes: '32x32', generated: true },
    { href: ICON_PATHS.svg, type: 'image/svg+xml', generated: true },
  ]);
  assert.deepEqual(appleTouch, { href: ICON_PATHS.apple, generated: true });
});

test("🔴 an owner's mark wins — and only the mark is linked", () => {
  const svgMark = iconHrefs({ favicon: '/brand/mark.svg' }, {});
  assert.deepEqual(svgMark.icon, [{ href: '/brand/mark.svg', type: 'image/svg+xml', generated: false }]);
  // iOS ignores SVG, so the apple slot falls to the badge rather than to an icon that never draws.
  assert.deepEqual(svgMark.appleTouch, { href: ICON_PATHS.apple, generated: true });
  const pngMark = iconHrefs({ favicon: '/brand/mark.png' }, {});
  assert.deepEqual(pngMark.icon, [{ href: '/brand/mark.png', type: 'image/png', generated: false }]);
  assert.deepEqual(pngMark.appleTouch, { href: '/brand/mark.png', generated: false }, 'a raster mark IS the touch icon');
  // the older fields SiteLayout has always fallen back to still work, in the same order
  assert.equal(siteMark({ 'site-logo': '/a.png', 'footer-logo': '/b.png' }), '/a.png');
  assert.equal(siteMark({ 'footer-logo': '/b.png' }), '/b.png');
  assert.equal(markType('/x/y.JPG?v=2'), 'image/jpeg');
  assert.equal(markType('https://cdn.example/x'), '', 'an untyped mark is linked without a type');
});

test('a PWA site that never ran gen-icons.sh gets tile\'s own badge — and it IS generated', () => {
  // 🔴 P2-2: `hasPwa` alone used to zero the flag by path-equality, regardless of whether
  // gen-icons.sh had ever actually run. With no `written` set supplied (the caller has no
  // filesystem opinion), the honest default is "the generator wrote every canonical path" — so a
  // site that only DECLARED `packages: pwa` gets a correctly-marked badge, not a silently
  // unmarked one that reef's matcher would then trust as the owner's own file.
  for (const ext of ['png', 'svg']) {
    const links = iconHrefs({ favicon: `/brand/mark.${ext}` }, { hasPwa: true });
    assert.equal(links.icon.length, 1);
    assert.equal(links.icon[0].generated, false);
    assert.deepEqual(links.appleTouch, { href: ICON_PATHS.apple, generated: true });
  }
});

test('generated means WRITTEN, not path-shaped — a real file at the same path is never marked', () => {
  // gen-icons.sh (or an owner's own file) really did put a PNG at /apple-touch-icon.png this
  // build: the caller's `written` set omits it, and `generated` must follow, not the href string.
  const reallyWritten = new Set([ICON_PATHS.ico, ICON_PATHS.svg]); // apple-touch missing == shadowed
  const pwaWithOwnFile = iconHrefs({ favicon: '/brand/mark.svg' }, { hasPwa: true, written: reallyWritten });
  assert.deepEqual(pwaWithOwnFile.appleTouch, { href: ICON_PATHS.apple, generated: false });
  // 🔴 P2-1: the collision — an owner names their OWN mark `/apple-touch-icon.png` (no PWA at
  // all). Same href reached two different ways; only `written` may decide `generated`, so a real
  // file there must silence BOTH the icon link and the apple-touch link, never just one.
  const collision = iconHrefs({ favicon: '/apple-touch-icon.png' }, { written: reallyWritten });
  assert.deepEqual(collision.icon, [{ href: '/apple-touch-icon.png', type: 'image/png', generated: false }]);
  assert.deepEqual(collision.appleTouch, { href: '/apple-touch-icon.png', generated: false });
  // And the mirror: no real file this build (written includes it) ⇒ the collision path really is
  // our fallback badge sitting there, and that IS generated.
  const noRealFile = iconHrefs({ favicon: '/apple-touch-icon.png' }, {});
  assert.deepEqual(noRealFile.appleTouch, { href: '/apple-touch-icon.png', generated: true });
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
  // round 4 (R3-P3-1): `favicon:`/`site-logo:`/`footer-logo:` is an author-controlled destination,
  // so it is gated by `safeSrc`. tile#203 r1: the gate is handed INTO the model (iconHrefs'
  // `safe`, icon-core's linkedMark) rather than applied to its result, so the routes can ask the
  // same question. The call to the model is still the ONE, unconditional source of truth.
  assert.match(layout, /const iconLinks = iconHrefs\(meta, \{ hasPwa, written: iconWritten, safe: safeSrc \}\)/, 'the rule comes from the model');
  // 🔴 P2-1/P2-2: `generated` must be driven by what THIS build actually wrote, not by `hasPwa`
  // alone or by an href that merely looks like one of the three canonical paths — the layout is
  // the one place with filesystem access, so it must be the one computing that set.
  assert.match(layout, /existsSync\(join\(ICON_PUBLIC_DIR, p\)\)/, 'written-paths is computed from a real disk check, not inferred from the href');
  assert.match(layout, /\{iconLinks\.icon\.map\(\(l\) => <link rel="icon"/, 'rel=icon comes from iconHrefs');
  assert.match(layout, /^\s*<link rel="apple-touch-icon" href=\{iconLinks\.appleTouch\.href\} data-generated=\{iconLinks\.appleTouch\.generated \? "badge" : undefined\} \/>$/m,
    'apple-touch-icon is emitted on every page, not gated on a site having set `favicon:`');
  // the shape of the original defect: an icon link that only exists when frontmatter did.
  assert.ok(!/\{favicon && <link rel="icon"/.test(layout), 'no conditional favicon link is left');
});

// ── `favicon:` reaches the FILES, not only the <link> ───────────────────────────────────────────
//
// 🩸 Measured on a fixture build: a site with `favicon: /favicon.png` and one without it served the
// SAME md5 at /favicon.ico, /favicon.svg and /apple-touch-icon.png. The routes never read the key.

/** A real PNG the owner might ship: 64×48 so its size cannot be mistaken for any size we draw. */
const OWNER_PNG = (() => {
  const w = 64, h = 48;
  // encodePng is square-only, so build the container by hand: signature, IHDR, IDAT, IEND.
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 200; raw[o + 3] = 255;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
/** A public/ dir as a map; records what was asked so a test can see the path that was read. */
const publicDir = (files) => {
  const asked = [];
  const read = (rel) => { asked.push(rel); return Object.prototype.hasOwnProperty.call(files, rel) ? files[rel] : null; };
  return Object.assign(read, { asked });
};
const md5 = (b) => createHash('md5').update(b).digest('hex');

test('🔴 CONTROL: with no `favicon:`, the three files are exactly what the routes wrote before', () => {
  const meta = { brand: 'Example Studio', lang: 'en-US' };
  const read = publicDir({ 'favicon.png': OWNER_PNG });          // a file on disk is not a setting
  assert.deepEqual([...badgePaths(meta, read)].sort(), Object.values(ICON_PATHS).sort(), 'all three still carry the badge');
  assert.ok(appleTouchFile(meta, read).equals(appleTouchPng(meta)), 'apple-touch-icon body is the badge, byte for byte');
  // pinned from tile 466a0ece (before this change): the same md5 its build wrote at /favicon.svg
  assert.equal(md5(badgeSvg(meta)), 'b26d7ff9e6762387f4a3e3febf2b6de5', 'favicon.svg bytes unchanged');
  // site-logo alone is a <link> fallback, not `favicon:`, and changes no file
  assert.equal(badgePaths({ ...meta, 'site-logo': '/logo.png' }, read).size, 3);
});

test("🔴 `favicon:` naming a PNG in public/ → apple-touch-icon IS that PNG, and no generated .ico/.svg", () => {
  const meta = { brand: 'Example Studio', favicon: '/favicon.png' };
  const read = publicDir({ 'favicon.png': OWNER_PNG });
  const body = appleTouchFile(meta, read);
  assert.ok(Buffer.from(body).equals(OWNER_PNG), `apple-touch-icon must be the owner's bytes (got md5 ${md5(body)}, owner ${md5(OWNER_PNG)})`);
  assert.deepEqual([...badgePaths(meta, read)], [], 'no path carries the badge');
  assert.deepEqual(ownerPng(meta, read) && { ...ownerPng(meta, read), bytes: '…' },
    { href: '/favicon.png', bytes: '…', width: 64, height: 48 }, 'the real size, read from IHDR');
  // quotes and a cache-buster are the same file
  assert.ok(Buffer.from(appleTouchFile({ favicon: '"/favicon.png?v=3"' }, read)).equals(OWNER_PNG));
});

test('`favicon:` the build cannot read as a PNG → no .ico/.svg, apple-touch-icon keeps the badge', () => {
  const read = publicDir({ 'mark.svg': Buffer.from('<svg/>'), 'fake.png': Buffer.from('not a png') });
  for (const favicon of ['https://cdn.example/mark.png', '/mark.svg', '/missing.png', '/fake.png']) {
    const meta = { brand: 'Example Studio', favicon };
    assert.deepEqual([...badgePaths(meta, read)], [ICON_PATHS.apple], favicon);
    assert.ok(appleTouchFile(meta, read).equals(appleTouchPng(meta)), `${favicon}: badge, not someone's bytes`);
  }
});

// ownerFavicon accepts a strict subset of what the layout's safeSrc links. A value safeSrc refuses
// makes the layout fall back to the generated links, so those files must still exist.
test('a `favicon:` that is not a root path or an https URL changes no file', () => {
  for (const favicon of ['javascript:void(0)', '//evil.example/x.png', 'http://plain.example/x.png', 'relative.png']) {
    assert.equal(ownerFavicon({ favicon }), '', favicon);
    assert.equal(badgePaths({ favicon }, publicDir({})).size, 3, favicon);
  }
});

// 🩸 tile#203 review r1, P1. `favicon: https://[` passed ownerFavicon's regex, so the .ico/.svg
// routes skipped themselves, while the layout's safeSrc refused the same value and fell back to
// linking /favicon.ico + /favicon.svg: two links to files the build had just declined to write. A
// quoted value went the other way: ownerFavicon stripped the quotes, the <link> kept them. Both now
// read linkedMark, with the layout's own gate handed in.
test('🔴 the .ico/.svg are suppressed ONLY when <head> links the owner mark in their place', () => {
  const read = publicDir({ 'brand/mark.png': OWNER_PNG });
  const inputs = ['https://[', '"/brand/mark.png"', "'/brand/mark.png'", '/brand/mark.png', 'javascript:void(0)',
    '"javascript:void(0)"', 'https://cdn.example/mark.png', 'relative.png', '""', 'http://plain.example/x.png'];
  for (const favicon of inputs) {
    const meta = { brand: 'Example Studio', favicon };
    const icon = iconHrefs(meta, { safe: safeSrc }).icon;
    const suppressed = !badgePaths(meta, read, safeSrc).has(ICON_PATHS.ico);
    assert.equal(!badgePaths(meta, read, safeSrc).has(ICON_PATHS.svg), suppressed, `${favicon}: .ico and .svg move together`);
    if (suppressed) {
      assert.deepEqual(icon.map((l) => l.href), [ownerFavicon(meta, safeSrc)], `${favicon}: suppressed, so <head> must link the mark`);
    }
    if (icon.some((l) => l.href === ICON_PATHS.ico || l.href === ICON_PATHS.svg)) {
      assert.ok(!suppressed, `${favicon}: <head> links a generated file, so it must be written`);
    }
  }
  // the reviewer's two inputs, by name
  const bad = { favicon: 'https://[' };
  assert.deepEqual(iconHrefs(bad, { safe: safeSrc }).icon.map((l) => l.href), [ICON_PATHS.ico, ICON_PATHS.svg]);
  assert.equal(badgePaths(bad, read, safeSrc).size, 3, 'a mark the layout refuses keeps all three generated files');
  const quoted = { favicon: '"/brand/mark.png"' };
  assert.deepEqual(iconHrefs(quoted, { safe: safeSrc }).icon.map((l) => l.href), ['/brand/mark.png'], 'the <link> carries no quotes');
  assert.equal(iconHrefs(quoted, { safe: safeSrc }).appleTouch.href, '/brand/mark.png');
  assert.deepEqual([...badgePaths(quoted, read, safeSrc)], [], 'and that linked mark is what suppresses the badge');
});

test('publicFilePath never leaves public/', () => {
  assert.equal(publicFilePath('/img/mark.png?v=2#x'), 'img/mark.png');
  for (const bad of ['/../secret.png', '/img/../../x.png', '/./x.png', '//host/x.png', 'x.png', '/a//b.png', '/a\\..\\b.png', 'https://h/x.png', ''])
    assert.equal(publicFilePath(bad), '', bad);
  const read = publicDir({});
  ownerPng({ favicon: '/../../etc/passwd.png' }, read);
  assert.deepEqual(read.asked, [], 'a climbing path is never even read');
});

test('pngSize reads IHDR and refuses what is not a PNG', () => {
  assert.deepEqual(pngSize(OWNER_PNG), { width: 64, height: 48 });
  assert.deepEqual(pngSize(appleTouchPng({})), { width: APPLE_TOUCH_PX, height: APPLE_TOUCH_PX });
  for (const bad of [null, Buffer.from('GIF89a'), faviconIco({}), OWNER_PNG.subarray(0, 20)]) assert.equal(pngSize(bad), null);
});

test('🔴 the routes and the layout read the rule from the model', () => {
  const route = (p) => readFileSync(join(ASTRO, 'src/pages', p), 'utf8');
  assert.match(route('apple-touch-icon.png.js'), /appleTouchFile\(meta, readPublic, safeSrc\)/, 'apple-touch route serves appleTouchFile');
  assert.match(route('favicon.ico.js'), /if \(!badgePaths\(meta, null, safeSrc\)\.has\(ICON_PATHS\.ico\)\) return new Response\(null/, '.ico skips itself');
  assert.match(route('favicon.svg.js'), /if \(!badgePaths\(meta, null, safeSrc\)\.has\(ICON_PATHS\.svg\)\) return new Response\(null/, '.svg skips itself');
  assert.match(route('manifest.webmanifest.js'), /ownerPng\(meta, readPublic, safeSrc\)/, 'manifest lists the same owner PNG');
  assert.match(layout, /\.filter\(\(p\) => iconBadge\.has\(p\)\)/, '`generated` follows badgePaths, so an owner PNG is never labelled a badge');
  // tile#203 r1 P1: the SAME gate on both sides. A layout that gated its links any other way could
  // link a file a route skipped.
  assert.match(layout, /badgePaths\(meta, readPublic, safeSrc\)/, 'the layout hands badgePaths its own gate');
  assert.match(layout, /iconHrefs\(meta, \{ hasPwa, written: iconWritten, safe: safeSrc \}\)/, 'the layout links what linkedMark decides');
  assert.equal((layout.match(/= iconHrefs\(/g) || []).length, 1, 'one iconHrefs call: no second fallback decision');
  for (const p of ['favicon.ico.js', 'favicon.svg.js', 'apple-touch-icon.png.js', 'manifest.webmanifest.js'])
    assert.match(route(p), /import \{ safeSrc \} from '\.\.\/\.\.\/\.\.\/site-core\.js';/, `${p} uses the layout's safeSrc`);
});

console.log(`\n${process.exitCode ? '❌' : '✅'} icon-core: ${passed} checks`);
