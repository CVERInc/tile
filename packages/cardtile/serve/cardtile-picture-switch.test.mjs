// tile#339 — the measurement prototype's local switch (`CARDTILE_PICTURES`, asset-urls.mjs).
// run: node --test packages/cardtile/serve/cardtile-picture-switch.test.mjs
//
// 🔴 What this holds: with the switch unset — every deployment — a Cards page and the `…/a/<sha256>.<ext>`
// paths answer exactly as they did before tile#339 (inline pictures; an unknown path's 404, with no store
// read). The by-URL strategy's own contract is cardtile-asset-urls.test.mjs; the hybrid strategies'
// is below. The card, handle, domain and pictures are made up.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import worker, { renderCardHTML } from './card-worker.mjs';
// a namespace, so a missing export fails its own test rather than the whole file
import * as AU from './asset-urls.mjs';
import * as R from '../card-render.mjs';

const HANDLE = 'tidepool';
const VHOST = 'links.tidepool-example.test';
const PAGE = `https://card.feelreef.com/${HANDLE}`;
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pad = (head, n, seed) => {
  const out = [head];
  for (let i = 0, len = head.length; len < n; i++) { const b = createHash('sha256').update(`${seed}:${i}`).digest(); out.push(b); len += b.length; }
  return Buffer.concat(out).subarray(0, n);
};
const le24 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];

// real file headers (what pictureSize reads), padded past the inline threshold with stable bytes
const pngOf = (w, h) => {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(h * (1 + 3 * w)))), chunk('IEND', Buffer.alloc(0))]);
};
const jpgHead = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0]);
const webpHead = (kind, w, h) => {
  const head = Buffer.alloc(30);
  head.write('RIFF', 0); head.write('WEBP', 8); head.write(kind, 12);
  if (kind === 'VP8 ') { head.set([0x9d, 0x01, 0x2a], 23); head.writeUInt16LE(w, 26); head.writeUInt16LE(h, 28); }
  if (kind === 'VP8L') { head[20] = 0x2f; const bits = (w - 1) | ((h - 1) << 14); head.writeUInt32LE(bits >>> 0, 21); }
  if (kind === 'VP8X') { head.set(le24(w - 1), 24); head.set(le24(h - 1), 27); }
  return head;
};
const gifHead = (w, h) => { const b = Buffer.alloc(30); b.write('GIF89a', 0); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };

const PICS = [
  ['bd', 'image/webp', pad(webpHead('VP8X', 1600, 900), 40_000, 'bd'), [1600, 900]],
  ['avatar', 'image/png', pad(pngOf(512, 512), 30_000, 'av'), [512, 512]],
  ['f1', 'image/jpeg', pad(jpgHead(1200, 800), 50_000, 'f1'), [1200, 800]],
  ['f2', 'image/webp', pad(webpHead('VP8 ', 1000, 1000), 45_000, 'f2'), [1000, 1000]],
  ['f3', 'image/gif', pad(gifHead(640, 480), 20_000, 'f3'), [640, 480]],
].map(([name, mime, b, size]) => ({ name, mime, b, size, id: `sha256-${sha(b).slice(0, 16)}`, hex: sha(b), ext: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mime] }));
const P = Object.fromEntries(PICS.map((p) => [p.name, p]));
const CARD = [
  '---', `card-page: ${HANDLE}`, 'title: Tide Pool', `backdrop: asset:${P.bd.id}`, '---', '', '## grid', '',
  `- [ ] %% card: profile w=6 avatar=asset:${P.avatar.id} %% a made-up rock-pool guide`,
  `- [ ] %% card: feature w=6 img=asset:${P.f1.id} %%`,
  `- [ ] %% card: feature w=3 img=asset:${P.f2.id} %%`,
  `- [ ] %% card: feature w=3 img=asset:${P.f3.id} %%`,
  '', '## assets', '', ...PICS.map((p) => `- [ ] %% card: asset id=${p.id} mime=${p.mime} %% ${p.b.toString('base64')}`),
].join('\n') + '\n';

const envWith = (md, { pictures, vanity = false } = {}) => {
  const kv = new Map([[HANDLE, md], ...(vanity ? [[`vanity:${VHOST}`, HANDLE], [`vanityof:${HANDLE}`, VHOST]] : [])]);
  const reads = [];
  return {
    reads, PREVIEW: 'false', ...(pictures !== undefined ? { CARDTILE_PICTURES: pictures } : {}),
    CARDS: { get: async (k) => { reads.push(k); return kv.get(k) ?? null; }, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } },
  };
};
const get = async (url, env) => {
  const res = await worker.fetch(new Request(url, { redirect: 'manual' }), env, { waitUntil() {} });
  return { res, text: Buffer.from(await res.arrayBuffer()).toString('utf8') };
};

// ── 1. off: today's page ──────────────────────────────────────────────────────────────────────────

test('🔴 #339 switch — unset or unknown, the page is the inline page byte for byte and names no picture URL', async () => {
  const inline = renderCardHTML(CARD, { handle: HANDLE, cardUrl: PAGE, canonicalUrl: PAGE });
  for (const pictures of [undefined, '', 'inline', 'URL', 'by-url', 'hybrid']) {
    const { res, text } = await get(PAGE, envWith(CARD, { pictures }));
    assert.equal(res.status, 200, String(pictures));
    assert.equal(text, inline, `switch ${JSON.stringify(pictures)}: the page is not the inline page`);
    assert.ok(!text.includes(`/${HANDLE}/a/`), `switch ${JSON.stringify(pictures)}: a picture URL in the page`);
  }
  // control: the same page with the switch on is a different page
  assert.notEqual((await get(PAGE, envWith(CARD, { pictures: 'url' }))).text, inline);
});

test('🔴 #339 switch — unset, a picture path is an unknown path: the same 404, and no store read', async () => {
  const pathOf = `${PAGE}/a/${P.f1.hex}.jpg`;
  const off = envWith(CARD), unknown = envWith(CARD);
  const a = await get(pathOf, off);
  const b = await get(`${PAGE}/nothing-lives-here`, unknown);
  assert.equal(a.res.status, 404);
  assert.equal(a.text, b.text);
  assert.deepEqual([...a.res.headers].sort(), [...b.res.headers].sort());
  assert.deepEqual(off.reads, [], 'the switched-off picture path read the store');
  // control: switched on, the same path answers the picture
  assert.equal((await get(pathOf, envWith(CARD, { pictures: 'url' }))).res.status, 200);
});

// ── 2. the hybrids ────────────────────────────────────────────────────────────────────────────────

test('🔴 #339 switch — hybrid-inline-*: the first two pictures named stay inline, the rest go by URL with their box reserved', async () => {
  assert.equal(AU.FIRST_SCREEN_PICTURES, 2);
  for (const rest of ['lazy', 'after-paint']) {
    const { text } = await get(PAGE, envWith(CARD, { pictures: `hybrid-inline-${rest}` }));
    // the backdrop (frontmatter) and the avatar are the first two the text names
    for (const p of [P.bd, P.avatar]) {
      assert.ok(text.includes(p.b.toString('base64').slice(0, 300)), `${rest}: ${p.name} is not inline`);
      assert.ok(!text.includes(p.hex), `${rest}: ${p.name} has a URL`);
    }
    for (const p of [P.f1, P.f2, P.f3]) {
      const u = `/${HANDLE}/a/${p.hex}.${p.ext}`;
      assert.ok(text.includes(`src="${u}"`), `${rest}: ${p.name} is not by URL`);
      assert.ok(text.includes(`img[src="${u}"],.st-card [data-w="6"] img[src="${u}"]{aspect-ratio:auto ${p.size[0]}/${p.size[1]}}`), `${rest}: ${p.name} has no reserved box`);
    }
    assert.ok(!text.includes('rel="preload" as="image"'), `${rest}: a preload on an inline-first page`);
    assert.equal(text.includes(`img[loading="lazy"][src^="/${HANDLE}/a/"]`), rest === 'after-paint', `${rest}: the after-paint switch`);
  }
});

test('🔴 #339 switch — hybrid-preload-*: every picture by URL, the first two preloaded at high priority in <head>', async () => {
  const { text } = await get(PAGE, envWith(CARD, { pictures: 'hybrid-preload-after-paint' }));
  const head = text.slice(0, text.indexOf('</head>'));
  for (const p of [P.bd, P.avatar]) {
    assert.ok(head.includes(`<link rel="preload" as="image" href="/${HANDLE}/a/${p.hex}.${p.ext}" fetchpriority="high">`), `${p.name} is not preloaded`);
  }
  assert.equal((head.match(/rel="preload" as="image"/g) || []).length, 2);
  assert.ok(head.indexOf('rel="preload"') < head.indexOf('<style>'), 'the preloads come after the stylesheet');
  assert.ok(!/data:image\/(png|jpeg|webp|gif);base64,.{1000}/.test(text), 'a picture is still inline');
  // the creator's own domain: the same plan under /a/
  const v = await get(`https://${VHOST}/`, envWith(CARD, { pictures: 'hybrid-preload-after-paint', vanity: true }));
  assert.equal(v.res.status, 200);
  assert.ok(v.text.includes(`href="/a/${P.bd.hex}.webp"`), 'the vanity page preloads by /a/');
  assert.ok(v.text.includes(`img[loading="lazy"][src^="/a/"]`), 'the vanity page switches /a/ pictures');
});

// The first screen is what the page DRAWS first, never what its text names first (review of tile PR #354,
// finding 1). Two references the page never draws sit in an unused frontmatter field, and a back (what a
// tile shows when it turns over, closed when the page opens) is written before the front lane; the front
// draws one feature picture, then another. By text order the first two would be the unused pair.
const ghostPage = () => {
  const [g1, g2, back, seen, next] = [P.bd, P.f2, P.f3, P.f1, P.avatar];
  const md = [
    '---', `card-page: ${HANDLE}`, 'title: Tide Pool', `note: asset:${g1.id} asset:${g2.id}`, '---', '',
    '## back: more', '', `- [ ] %% card: feature w=6 img=asset:${back.id} %%`, '',
    '## front', '', `- [ ] %% card: feature w=6 img=asset:${seen.id} %%`, `- [ ] %% card: feature w=6 img=asset:${next.id} %%`,
    '', '## assets', '', ...PICS.map((p) => `- [ ] %% card: asset id=${p.id} mime=${p.mime} %% ${p.b.toString('base64')}`),
  ].join('\n') + '\n';
  return { md, ghosts: [g1, g2], back, seen, next };
};
const urlOf = (p) => `/${HANDLE}/a/${p.hex}.${p.ext}`;

test('🔴 #339 switch — hybrid-preload: the preloads are the first two pictures the front draws, never an unused or back reference', async () => {
  const { md, ghosts, back, seen, next } = ghostPage();
  for (const rest of ['lazy', 'after-paint']) {
    const { text } = await get(PAGE, envWith(md, { pictures: `hybrid-preload-${rest}` }));
    const head = text.slice(0, text.indexOf('</head>'));
    const preloads = [...head.matchAll(/<link rel="preload" as="image" href="([^"]+)" fetchpriority="high">/g)].map((m) => m[1]);
    assert.deepEqual(preloads, [urlOf(seen), urlOf(next)], `${rest}: the preloads are not the front's first two pictures`);
    // control: the back's picture is on the page, by URL, and gets its box — it is just not first
    assert.ok(text.includes(`src="${urlOf(back)}"`), `${rest}: CONTROL: the back's picture is on the page`);
    for (const g of ghosts) assert.ok(!text.includes(g.hex), `${rest}: ${g.name}, never drawn, is named by the page`);
  }
  // a front with one picture: the second slot stays empty rather than go to the closed back
  const one = md.replace(`- [ ] %% card: feature w=6 img=asset:${next.id} %%\n`, '');
  assert.notEqual(one, md, 'CONTROL: the second front picture was taken out');
  const { text } = await get(PAGE, envWith(one, { pictures: 'hybrid-preload-lazy' }));
  const preloads = [...text.matchAll(/<link rel="preload" as="image" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(preloads, [urlOf(seen)], 'a back\'s picture took a first-screen slot');
  assert.ok(text.includes(`src="${urlOf(back)}"`), 'CONTROL: the back\'s picture is on the page by URL');
});

test('🔴 #339 switch — hybrid-inline: the pictures left inline are the first two the front draws, never an unused or back reference', async () => {
  const { md, ghosts, back, seen, next } = ghostPage();
  const { text } = await get(PAGE, envWith(md, { pictures: 'hybrid-inline-lazy' }));
  for (const p of [seen, next]) {
    assert.ok(text.includes(p.b.toString('base64').slice(0, 300)), `${p.name}, drawn first, is not inline`);
    assert.ok(!text.includes(p.hex), `${p.name}, drawn first, still has a URL`);
  }
  assert.ok(text.includes(`src="${urlOf(back)}"`), 'the back\'s picture is not by URL');
  assert.ok(text.includes(`img[src="${urlOf(back)}"]`), 'the back\'s picture has no reserved box');
  for (const g of ghosts) assert.ok(!text.includes(g.hex) && !text.includes(g.b.toString('base64').slice(0, 300)), `${g.name}, never drawn, is on the page`);
});

test('🔴 #339 switch — picturesInRenderOrder: where each URL first stands in the markup, the absent left out', () => {
  assert.equal(typeof R.picturesInRenderOrder, 'function');
  const html = '<img src="/h/a/b.png"><i style="background:url(&quot;/h/a/a.png&quot;)"></i><img src="/h/a/b.png">';
  assert.deepEqual(R.picturesInRenderOrder(html, ['/h/a/a.png', '/h/a/c.png', '/h/a/b.png', '/h/a/a.png']), ['/h/a/b.png', '/h/a/a.png']);
  assert.deepEqual(R.picturesInRenderOrder('', ['/h/a/a.png']), []);
});

// ── 3. the pieces ─────────────────────────────────────────────────────────────────────────────────

test('🔴 #339 switch — pictureSize reads width and height off PNG, JPEG, WebP (VP8, VP8L, VP8X) and GIF headers', () => {
  assert.equal(typeof AU.pictureSize, 'function');
  for (const p of PICS) assert.deepEqual(AU.pictureSize(new Uint8Array(p.b)), p.size, p.name);
  assert.deepEqual(AU.pictureSize(new Uint8Array(pad(webpHead('VP8L', 777, 333), 2000, 'l'))), [777, 333]);
  // a JPEG with an APPn segment before SOF, and fill bytes
  const jfill = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 6, 1, 2, 3, 4, 0xff, 0xff]), jpgHead(300, 200).subarray(20)]);
  assert.deepEqual(AU.pictureSize(new Uint8Array(pad(jfill, 2000, 'j'))), [300, 200]);
  for (const junk of [Buffer.alloc(0), Buffer.from('not a picture at all, just words here'), pad(Buffer.from([0xff, 0xd8, 0x00]), 64, 'x'),
    pad(Buffer.from('....ftypavif'), 64, 'a')]) {
    assert.equal(AU.pictureSize(new Uint8Array(junk)), null);
  }
});

test('🔴 #339 switch — the renderer writes only plain paths from `pictures`, and nothing when it is absent', () => {
  const md = CARD;
  const plain = renderCardHTML(md, { handle: HANDLE });
  assert.equal(renderCardHTML(md, { handle: HANDLE, pictures: undefined }), plain);
  const bad = '/x"><script>alert(1)</script>';
  const html = renderCardHTML(md, { handle: HANDLE, pictures: { first: 'preload', count: 2, reserve: [[bad, 1, 1]], afterPaint: bad } });
  assert.ok(!html.includes('alert(1)'), 'a non-path value reached the page');
  const viaMap = renderCardHTML(md, { handle: HANDLE, assetUrls: { [P.avatar.id]: bad }, pictures: { first: 'preload', count: 2, reserve: [[bad, 1, 1]], afterPaint: '' } });
  assert.ok(!viaMap.includes('<script>alert(1)'), 'a non-path picture URL reached the page unescaped');
  assert.ok(!viaMap.includes('rel="preload" as="image"'), 'a non-path picture URL was preloaded');
  const ok = renderCardHTML(md, { handle: HANDLE, assetUrls: { [P.avatar.id]: '/t/a/x.png' }, pictures: { first: 'preload', count: 2, reserve: [['/t/a/x.png', 4, 3]], afterPaint: '/t/a/' } });
  assert.ok(ok.includes('<link rel="preload" as="image" href="/t/a/x.png" fetchpriority="high">'));
  assert.ok(ok.includes('{aspect-ratio:auto 4/3}'));
  assert.ok(ok.includes(`src^="/t/a/"`));
});
