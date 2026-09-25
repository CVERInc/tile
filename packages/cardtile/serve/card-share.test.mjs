// A Card's link preview and its avatar's raster copy (reef#1092).  run: node --test card-share.test.mjs
//
// 🩸 WHAT THIS IS HOLDING (measured 2026-09-25 on a creator's own domain): the card's <head> had no
// og:*, no twitter:*, no description, so a shared card previewed as a bare URL. These assertions are
// about what a crawler and a phone GET — the head through renderCardHTML, the image through
// worker.fetch. The cards below are made up; no real person.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { renderCardHTML } from './card-worker.mjs';
import { parseCard, serializeCard, rasterCopyId, rasterCopyOwner } from '../card-core.js';
import { cardRaster, pngSize } from '../card-icon.mjs';
import { describe, DESCRIPTION_MAX } from '../card-share.mjs';
import { assembleSave, assetManifest, thinCard } from '../card-save.mjs';
import { splitCard } from '../w2/host-bridge.mjs';
import { planBackfill } from '../assets/backfill-raster.mjs';
import { encodePng } from '../../sitetile/icon-core.mjs';

const HOST = 'links.maple-example.test';       // a made-up creator domain
const HANDLE = 'maple';
const AV = 'sha256-aaaaaaaaaaaaaaaa';

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 7)]);
const solid = (n, rgb) => encodePng(new Uint8Array(n * n * 4).map((_, i) => (i % 4 === 3 ? 255 : rgb[i % 4])), n);
const COPY = solid(8, [0, 200, 0]);           // stands in for the 256px copy; 8×8 so IHDR says 8
const PNG_AVATAR = solid(4, [200, 0, 0]);

// in card-core's canonical form (serializeCard), so a byte-identical round trip is a fair question
const card = (o) => serializeCard(parseCard(rawCard(o)));
const rawCard = ({ avatar = '', tagline = 'a made-up bookbinder', assets = [], title = 'Maple Bindery' } = {}) => [
  '---', `card-page: ${HANDLE}`, `title: ${title}`, '---', '',
  '## grid', '',
  `- [ ] %% card: profile w=6${avatar ? ` avatar=${avatar}` : ''} %% ${tagline}`,
  '- [ ] %% card: link w=2 %% [Shop](https://example.com/shop)',
  ...(assets.length ? ['', '## assets', '', ...assets.map(([id, mime, buf]) => `- [ ] %% card: asset id=${id} mime=${mime} %% ${buf.toString('base64')}`)] : []),
].join('\n') + '\n';

// a card made after reef#1092: webp avatar + its PNG copy
const COPY_CARD = card({ avatar: `asset:${AV}`, assets: [[AV, 'image/webp', WEBP], [rasterCopyId(AV), 'image/png', COPY]] });
// a card from before: the webp avatar and nothing else
const OLD_CARD = card({ avatar: `asset:${AV}`, assets: [[AV, 'image/webp', WEBP]] });

const head = (html) => /<head>(.*?)<\/head>/s.exec(html)[1];
/** every <meta property|name=… content=…> in the head, as [key, content] in order */
const metas = (html) => [...head(html).matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)">/g)].map((m) => [m[1], m[2]]);
const meta = (html, key) => (metas(html).find(([k]) => k === key) || [])[1];
const vanity = (md) => renderCardHTML(md, { handle: HANDLE, cardUrl: `https://${HOST}` });

function envWith(md) {
  const kv = new Map([[HANDLE, md], [`vanity:${HOST}`, HANDLE], [`vanityof:${HANDLE}`, HOST]]);
  return { PREVIEW: 'false', CARDS: { get: async (k) => kv.get(k) ?? null } };
}
const get = async (md, url) => {
  const res = await worker.fetch(new Request(url, { redirect: 'manual' }), envWith(md));
  return { res, body: Buffer.from(await res.arrayBuffer()) };
};

// ── <head> ─────────────────────────────────────────────────────────────────────────────────────

test('a card with a copy: every share tag, og:image absolute and pointing at the copy', () => {
  const html = vanity(COPY_CARD);
  assert.deepEqual(metas(html).filter(([k]) => k !== 'generator' && k !== 'viewport'), [
    ['description', 'a made-up bookbinder'],
    ['og:type', 'website'],
    ['og:title', 'Maple Bindery'],
    ['og:description', 'a made-up bookbinder'],
    ['og:url', `https://${HOST}`],
    ['og:image', `https://${HOST}/apple-touch-icon.png`],
    ['og:image:type', 'image/png'],
    ['og:image:width', '8'],
    ['og:image:height', '8'],
    ['og:image:alt', 'Maple Bindery'],
    ['twitter:card', 'summary'],
    ['twitter:title', 'Maple Bindery'],
    ['twitter:description', 'a made-up bookbinder'],
    ['twitter:image', `https://${HOST}/apple-touch-icon.png`],
  ]);
  assert.ok(head(html).includes(`<link rel="canonical" href="https://${HOST}">`), 'no canonical link');
});

test('on the canonical host og:image and og:url carry the card\'s own path', () => {
  const html = renderCardHTML(COPY_CARD, { handle: HANDLE, cardUrl: `https://card.feelreef.com/${HANDLE}` });
  assert.equal(meta(html, 'og:url'), `https://card.feelreef.com/${HANDLE}`);
  assert.equal(meta(html, 'og:image'), `https://card.feelreef.com/${HANDLE}/apple-touch-icon.png`);
});

test('🔴 an old card (webp avatar, no copy) has no og:image — never the badge — but keeps the rest', () => {
  const html = vanity(OLD_CARD);
  for (const k of ['og:image', 'og:image:type', 'og:image:width', 'twitter:image']) assert.equal(meta(html, k), undefined, k);
  assert.equal(meta(html, 'og:title'), 'Maple Bindery');
  assert.equal(meta(html, 'description'), 'a made-up bookbinder');
  assert.equal(meta(html, 'twitter:card'), 'summary');
});

test('a PNG avatar needs no copy: it is the og:image itself', () => {
  const md = card({ avatar: `asset:${AV}`, assets: [[AV, 'image/png', PNG_AVATAR]] });
  assert.equal(meta(vanity(md), 'og:image'), `https://${HOST}/apple-touch-icon.png`);
  assert.equal(meta(vanity(md), 'og:image:width'), '4');
});

test('an avatar hosted elsewhere: png/jpeg over https is linked as-is; webp or http is not', () => {
  assert.equal(meta(vanity(card({ avatar: 'https://img.example.com/me.jpg' })), 'og:image'), 'https://img.example.com/me.jpg');
  assert.equal(meta(vanity(card({ avatar: 'https://img.example.com/me.webp' })), 'og:image'), undefined);
  assert.equal(meta(vanity(card({ avatar: 'http://img.example.com/me.png' })), 'og:image'), undefined);
});

test('no cardUrl (a preview, an editor frame) → no share tags and no canonical', () => {
  const html = renderCardHTML(COPY_CARD, { handle: '', cardUrl: '' });
  assert.deepEqual(metas(html).filter(([k]) => k !== 'generator' && k !== 'viewport'), []);
  assert.ok(!/rel="canonical"/.test(html));
});

test('description: the tagline\'s words — markdown and HTML gone, whitespace collapsed', () => {
  const md = card({ tagline: 'Hand-bound **notebooks** & *zines* — <b>see</b> [the shop](https://example.com/s)' });
  assert.equal(describe(parseCard(md)), 'Hand-bound notebooks & zines — see the shop');
  // …and escaped into the attribute, not spliced raw
  assert.equal(meta(vanity(md), 'og:description'), 'Hand-bound notebooks &amp; zines — see the shop');
});

test('description: cut at DESCRIPTION_MAX code points with an ellipsis, CJK counted per character', () => {
  const long = '書'.repeat(DESCRIPTION_MAX + 40);
  const d = describe(parseCard(card({ tagline: long })));
  assert.equal([...d].length, DESCRIPTION_MAX);
  assert.ok(d.endsWith('…'));
  assert.equal(describe(parseCard(card({ tagline: '書'.repeat(DESCRIPTION_MAX) }))), '書'.repeat(DESCRIPTION_MAX), 'exactly the limit is not cut');
});

test('no tagline → no description tags at all', () => {
  const html = vanity(card({ tagline: '' }));
  for (const k of ['description', 'og:description', 'twitter:description']) assert.equal(meta(html, k), undefined, k);
});

test('a title with quotes and markup stays inside its attribute', () => {
  const html = vanity(card({ title: 'Maple "&" <Co>' }));
  assert.equal(meta(html, 'og:title'), 'Maple &quot;&amp;&quot; &lt;Co&gt;');
});

// ── the file ───────────────────────────────────────────────────────────────────────────────────

test('/apple-touch-icon.png (= og:image) is the copy, byte for byte, as image/png', async () => {
  const { res, body } = await get(COPY_CARD, `https://${HOST}/apple-touch-icon.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(body, COPY);
});

test('🔴 a copy is bound to ITS avatar: one named for another picture is not used', () => {
  const stale = card({ avatar: `asset:${AV}`, assets: [[AV, 'image/webp', WEBP], [rasterCopyId('sha256-bbbbbbbbbbbbbbbb'), 'image/png', COPY]] });
  assert.equal(cardRaster(parseCard(stale)), null);
  assert.equal(meta(vanity(stale), 'og:image'), undefined);
});

test('🔴 a "copy" whose bytes are not PNG is not served under the PNG name', () => {
  const lie = card({ avatar: `asset:${AV}`, assets: [[AV, 'image/webp', WEBP], [rasterCopyId(AV), 'image/png', WEBP]] });
  assert.equal(cardRaster(parseCard(lie)), null);
  assert.equal(pngSize(WEBP.toString('base64')), null);
  assert.deepEqual(pngSize(COPY.toString('base64')), { width: 8, height: 8 });
  // an IHDR in the right place is not enough: the eight signature bytes are what say "PNG"
  const unsigned = Buffer.concat([Buffer.alloc(8), COPY.subarray(8)]);
  assert.equal(pngSize(unsigned.toString('base64')), null);
});

// ── the format ─────────────────────────────────────────────────────────────────────────────────

test('round trip: a card carrying a copy comes back byte-identical, copy included', () => {
  const m = parseCard(COPY_CARD);
  assert.deepEqual(Object.keys(m.assets).sort(), [AV, rasterCopyId(AV)]);
  assert.equal(serializeCard(m), COPY_CARD);
  assert.equal(serializeCard(parseCard(OLD_CARD)), OLD_CARD);
});

test('the copy id rule: `<id>.png`, and only that shape is a copy', () => {
  assert.equal(rasterCopyId(AV), `${AV}.png`);
  assert.equal(rasterCopyOwner(`${AV}.png`), AV);
  assert.equal(rasterCopyOwner(AV), null);
  assert.equal(rasterCopyOwner('.png'), null);
});

test('🔴 a copy is never an orphan while its avatar is referenced — and is one once it is not', () => {
  const stored = COPY_CARD;
  assert.deepEqual(assembleSave(thinCard(stored), stored).orphans, []);
  const withoutAvatar = thinCard(card({ avatar: '' }));
  assert.deepEqual(assembleSave(withoutAvatar, stored).orphans, [AV, rasterCopyId(AV)]);
  assert.ok(assetManifest(stored).every((a) => a.referenced));
});

test('the host bridge\'s splitCard carries the copy with the avatar', () => {
  assert.deepEqual(Object.keys(splitCard(COPY_CARD).assets).sort(), [AV, rasterCopyId(AV)]);
});

// ── the backfill ───────────────────────────────────────────────────────────────────────────────

/** stands in for sharp: every chain ends in the COPY bytes. The plan is under test, not libvips. */
const fakeSharp = () => { const c = { rotate: () => c, resize: () => c, flatten: () => c, png: () => c, toBuffer: async () => COPY }; return c; };

test('backfill: an old card gets exactly one new asset line, and says how many bytes', async () => {
  const p = await planBackfill(fakeSharp, OLD_CARD);
  assert.equal(p.status, 'add');
  assert.equal(p.copyBytes, COPY.length);
  assert.equal(p.md.length - OLD_CARD.length, p.deltaBytes);
  assert.equal(p.md, COPY_CARD, 'the backfilled card is not the card ingest would have made');
});

test('backfill: nothing to do for a card with a copy, a PNG avatar, or no avatar of its own', async () => {
  assert.equal((await planBackfill(fakeSharp, COPY_CARD)).status, 'has-copy');
  assert.equal((await planBackfill(fakeSharp, card({ avatar: `asset:${AV}`, assets: [[AV, 'image/png', PNG_AVATAR]] }))).status, 'png-avatar');
  assert.equal((await planBackfill(fakeSharp, card())).status, 'no-own-avatar');
  assert.equal((await planBackfill(fakeSharp, card({ avatar: 'https://img.example.com/me.jpg' }))).status, 'no-own-avatar');
});

test('🔴 backfill refuses a card that would not round-trip byte-identical', async () => {
  assert.equal((await planBackfill(fakeSharp, OLD_CARD.replace('## grid\n\n', '## grid\n\n\n'))).status, 'not-round-trip');
});

// ── sharp never reaches the Worker ─────────────────────────────────────────────────────────────

test('🔴 sharp — and the ingest-side assets/ modules — are not in the Worker\'s import graph', () => {
  // The raster copy is made at ingest (embed.mjs, backfill-raster.mjs) with a native library. In the
  // Worker that is a bundle that does not load, and the whole design is that the Worker serves bytes
  // it never decodes. Walk the real graph, static AND dynamic imports.
  const here = dirname(fileURLToPath(import.meta.url));
  const seen = new Set();
  const offenders = [];
  (function walk(file) {
    if (seen.has(file)) return;
    seen.add(file);
    if (/[/\\]cardtile[/\\]assets[/\\]/.test(file)) offenders.push(`${file}: ingest-side module`);
    const src = readFileSync(file, 'utf8');
    // `import x from '…'`, `export … from '…'`, a bare side-effect `import '…'`, and `import('…')`
    const specs = [
      ...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
      ...src.matchAll(/\bimport\(\s*['"`]([^'"`]+)['"`]/g),
    ].map((m) => m[1]);
    for (const s of specs) {
      if (/(^|\/)sharp(\/|$)/.test(s)) offenders.push(`${file}: ${s}`);
      else if (s.startsWith('.')) walk(resolve(dirname(file), s));
    }
  })(join(here, 'card-worker.mjs'));
  assert.ok([...seen].some((f) => f.endsWith('card-share.mjs')), 'card-share is not in the graph — the walk missed it');
  assert.deepEqual(offenders, []);
});
