// The Card's icon set, through the Worker (reef#1090).  run: node --test card-icon.test.mjs
//
// 🩸 WHAT THIS IS HOLDING (measured 2026-09-25 on a creator's own domain): the card's <head> named no
// icon, and `/favicon.ico` + `/apple-touch-icon.png` answered 200 text/html with the whole 1.2 MB
// card. So these assertions are about what a CLIENT gets — status, content-type, the bytes — through
// worker.fetch, not about which helper was called. The cards below are made up; no real person.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import worker, { renderCardHTML, cardPath } from './card-worker.mjs';
import { badgeMeta, cardAvatar } from '../card-icon.mjs';
import { parseCard } from '../card-core.js';
import { badgeSvg, encodePng } from '../../sitetile/icon-core.mjs';

const HOST = 'links.pebble-example.test';      // a made-up creator domain
const HANDLE = 'pebble';

// a webp is never decoded here — only carried — so any RIFF/WEBP-shaped bytes will do
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 7)]);
// a real PNG avatar, 4×4 solid red, so the apple-touch path can be shown to hand it through as-is
const PNG = encodePng(new Uint8Array(4 * 4 * 4).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0)), 4);

const card = ({ avatar = '', assets = [], accent = '#2a7fff' } = {}) => [
  '---', `card-page: ${HANDLE}`, 'title: Pebble Studio', `accent: '${accent}'`, '---', '',
  '## grid', '',
  `- [ ] %% card: profile w=6${avatar ? ` avatar=${avatar}` : ''} %% a made-up potter`,
  '- [ ] %% card: link w=2 %% [Shop](https://example.com/shop)',
  ...(assets.length ? ['', '## assets', '', ...assets.map(([id, mime, buf]) => `- [ ] %% card: asset id=${id} mime=${mime} %% ${buf.toString('base64')}`)] : []),
].join('\n') + '\n';

const WEBP_CARD = card({ avatar: 'asset:sha256-aaaaaaaaaaaaaaaa', assets: [['sha256-aaaaaaaaaaaaaaaa', 'image/webp', WEBP]] });
const PNG_CARD = card({ avatar: 'asset:sha256-bbbbbbbbbbbbbbbb', assets: [['sha256-bbbbbbbbbbbbbbbb', 'image/png', PNG]] });
const BARE_CARD = card();

/** a CARDS store holding one card, bound to HOST; `reads` records every key asked for */
function envWith(md) {
  const kv = new Map([[HANDLE, md], [`vanity:${HOST}`, HANDLE], [`vanityof:${HANDLE}`, HOST]]);
  const reads = [];
  return { env: { PREVIEW: 'false', CARDS: { get: async (k) => { reads.push(k); return kv.get(k) ?? null; } } }, reads };
}
const get = async (md, url, headers = {}) => {
  const { env, reads } = envWith(md);
  const res = await worker.fetch(new Request(url, { headers, redirect: 'manual' }), env);
  return { res, body: new Uint8Array(await res.arrayBuffer()), reads };
};
const text = (u8) => Buffer.from(u8).toString('utf8');

/** decode the PNG we produce (colour type 6, filter 0) far enough to read a pixel */
function png(u8) {
  const b = Buffer.from(u8);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const idat = [];
  for (let off = 8; off < b.length;) {
    const len = b.readUInt32BE(off), type = b.subarray(off + 4, off + 8).toString('latin1');
    if (type === 'IDAT') idat.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const at = (x, y) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)];
  return { w, h, at };
}
const links = (html) => (/<head>(.*?)<\/head>/s.exec(html)[1].match(/<link [^>]*>/g) || []);

// ── <head> ─────────────────────────────────────────────────────────────────────────────────────

test('avatar card: <head> links the avatar as the ONE rel=icon, plus an apple-touch-icon', () => {
  const html = renderCardHTML(WEBP_CARD, { handle: HANDLE, cardUrl: `https://${HOST}` });
  assert.deepEqual(links(html), [
    '<link rel="icon" type="image/webp" href="/favicon.ico">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  ]);
});

test('on the shared canonical host the files sit under the card\'s own path', () => {
  const html = renderCardHTML(BARE_CARD, { handle: HANDLE, cardUrl: `https://card.feelreef.com/${HANDLE}` });
  assert.deepEqual(links(html), [
    `<link rel="icon" sizes="32x32" href="/${HANDLE}/favicon.ico">`,
    `<link rel="icon" type="image/svg+xml" href="/${HANDLE}/favicon.svg">`,
    `<link rel="apple-touch-icon" href="/${HANDLE}/apple-touch-icon.png">`,
  ]);
});

test('no cardUrl (a preview, an editor frame) → no icon links, never a link to a file nobody serves', () => {
  assert.deepEqual(links(renderCardHTML(WEBP_CARD, { handle: '', cardUrl: '' })), []);
});

// ── the three files ────────────────────────────────────────────────────────────────────────────

test('avatar card: all three paths answer with an image; ico IS the avatar, svg holds it', async () => {
  const ico = await get(WEBP_CARD, `https://${HOST}/favicon.ico`);
  assert.equal(ico.res.status, 200);
  assert.equal(ico.res.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(ico.body), WEBP, '/favicon.ico is not the avatar\'s own bytes');

  const svg = await get(WEBP_CARD, `https://${HOST}/favicon.svg`);
  assert.equal(svg.res.status, 200);
  assert.equal(svg.res.headers.get('content-type'), 'image/svg+xml');
  assert.ok(text(svg.body).includes(`href="data:image/webp;base64,${WEBP.toString('base64')}"`), 'favicon.svg does not carry the avatar');

  // 🔴 webp cannot be the apple-touch-icon (iOS wants PNG) → the card's badge PNG, 180×180, opaque
  const apple = await get(WEBP_CARD, `https://${HOST}/apple-touch-icon.png`);
  assert.equal(apple.res.status, 200);
  assert.equal(apple.res.headers.get('content-type'), 'image/png');
  const p = png(apple.body);
  assert.deepEqual([p.w, p.h], [180, 180]);
  assert.deepEqual(p.at(0, 0), [0x2a, 0x7f, 0xff, 255], 'the badge is not the card\'s accent colour');
});

test('a PNG avatar IS the apple-touch-icon, byte for byte', async () => {
  const { res, body } = await get(PNG_CARD, `https://${HOST}/apple-touch-icon.png`);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(body), PNG);
});

test('no avatar: the badge is icon-core\'s own, at all three paths', async () => {
  const meta = badgeMeta({ name: 'Pebble Studio', accent: '#2a7fff' });
  const svg = await get(BARE_CARD, `https://${HOST}/favicon.svg`);
  assert.equal(svg.res.headers.get('content-type'), 'image/svg+xml');
  assert.equal(text(svg.body), badgeSvg(meta), 'favicon.svg is not icon-core\'s badge');
  assert.match(text(svg.body), />P<\/text>/, 'the badge does not carry the card\'s initial');

  const ico = await get(BARE_CARD, `https://${HOST}/favicon.ico`);
  assert.equal(ico.res.headers.get('content-type'), 'image/x-icon');
  const b = Buffer.from(ico.body);
  assert.deepEqual([b.readUInt16LE(0), b.readUInt16LE(2), b.readUInt16LE(4)], [0, 1, 1], 'ICONDIR');
  const inner = png(b.subarray(b.readUInt32LE(18), b.readUInt32LE(18) + b.readUInt32LE(14)));
  assert.deepEqual([inner.w, inner.h], [32, 32]);
  assert.deepEqual(inner.at(16, 3), [0x2a, 0x7f, 0xff, 255], 'the ico badge is not the card\'s accent');

  const apple = await get(BARE_CARD, `https://${HOST}/apple-touch-icon.png`);
  const p = png(apple.body);
  assert.deepEqual([p.w, p.h], [180, 180]);
  assert.ok(p.at(90, 90).some((v, i) => i < 3 && v > 0xf0), 'the glyph drew no ink at the centre');
});

test('the canonical path to a card\'s icon is an image, NOT the 301 its page gets', async () => {
  const { res } = await get(WEBP_CARD, `https://card.feelreef.com/${HANDLE}/favicon.ico`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
});

test('an asset whose mime is not a raster image is not an avatar (it would be served as that type)', () => {
  const md = card({ avatar: 'asset:sha256-cccccccccccccccc', assets: [['sha256-cccccccccccccccc', 'text/html', Buffer.from('<script>1</script>')]] });
  assert.equal(cardAvatar(parseCard(md)), null);
});

// ── the catch-all ──────────────────────────────────────────────────────────────────────────────

test('a path that is not the card is a 404 on the creator\'s domain — not the whole card', async () => {
  for (const path of ['/robots.txt', '/wp-login.php', '/favicon.png', '/a/b', '/index.html']) {
    const { res, body, reads } = await get(WEBP_CARD, `https://${HOST}${path}`);
    assert.equal(res.status, 404, `${path} → ${res.status}`);
    assert.ok(body.length < 200, `${path} answered ${body.length} bytes`);
    assert.ok(!reads.includes(HANDLE), `${path} read the card to say nothing is there`);
  }
});

test('…and the card itself still answers where it lives', async () => {
  const root = await get(WEBP_CARD, `https://${HOST}/?utm_source=qr`);
  assert.equal(root.res.status, 200);
  assert.match(text(root.body), /<main class="st-wrap">/);
  const fat = await get(WEBP_CARD, `https://${HOST}/index.md`);
  assert.equal(fat.res.headers.get('content-type'), 'text/markdown; charset=utf-8');
  // the pre-binding address on the creator's own domain lands on the root, query and all
  const alias = await get(WEBP_CARD, `https://${HOST}/${HANDLE}?x=1`);
  assert.equal(alias.res.status, 301);
  assert.equal(alias.res.headers.get('location'), `https://${HOST}/?x=1`);
});

test('cardPath: the canonical host has the same rule under /<handle>', () => {
  assert.equal(cardPath(`/${HANDLE}`, HANDLE, false), 'page');
  assert.equal(cardPath(`/${HANDLE}/`, HANDLE, false), 'page');
  assert.equal(cardPath(`/${HANDLE}.md`, HANDLE, false), 'fat');
  assert.equal(cardPath(`/${HANDLE}/apple-touch-icon.png`, HANDLE, false), 'apple');
  assert.equal(cardPath(`/${HANDLE}/robots.txt`, HANDLE, false), null);
  assert.equal(cardPath('/robots.txt', HANDLE, true), null);
});

// ── determinism ────────────────────────────────────────────────────────────────────────────────

test('the same card, asked twice, gives byte-identical icon files', async () => {
  for (const md of [BARE_CARD, WEBP_CARD]) {
    for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
      const a = (await get(md, `https://${HOST}/${f}`)).body;
      const b = (await get(md, `https://${HOST}/${f}`)).body;
      assert.ok(a.length > 0);
      assert.deepEqual(Buffer.from(a), Buffer.from(b), `${f} differs between two requests`);
    }
  }
});

// ── the Worker can actually load this ──────────────────────────────────────────────────────────

test('🔴 nothing the Worker imports reaches node:* statically (it runs without nodejs_compat)', () => {
  // icon-core used to open with `import { deflateSync } from 'node:zlib'`. Imported by the Worker,
  // that is a warning at `wrangler deploy` and a missing module at runtime — while every node test
  // stays green, because node has node:zlib. So walk the Worker's real import graph and look.
  const here = dirname(fileURLToPath(import.meta.url));
  const seen = new Set();
  const offenders = [];
  (function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
      if (m[1].startsWith('node:')) offenders.push(`${file}: ${m[1]}`);
      else if (m[1].startsWith('.')) walk(resolve(dirname(file), m[1]));
    }
  })(join(here, 'card-worker.mjs'));
  assert.ok(seen.size > 5, 'the walk did not follow the import graph');
  assert.ok([...seen].some((f) => f.endsWith('icon-core.mjs')), 'icon-core is not in the graph — the walk missed it');
  assert.deepEqual(offenders, []);
});
