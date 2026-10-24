#!/usr/bin/env node
// a photobook's mat pages (reef#2283) in the built pagetile reader — measured in a real browser.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/sitetile/real-render/photobook-mat.smoke.mjs --tile <checkout>
//
// 🩸 tile#198 review, two P2s, both invisible to the unit tests (they never load the reader's CSS or JS):
//  1. On a spread's odd page the mat photo hugged the binding. The mat centring was (0,5,0); the
//     spread's `:nth-child(odd):not(:first-child)` hug is (0,6,0), and coming later in the file does
//     not beat a higher specificity. Even pages centred, so a spread looked half right.
//  2. A turning mat page enlarged a photo the resting page did not: at rest a 100×150 photo keeps its
//     size (auto, max 100%); the leaf face refitted it with width/height 100% + contain.
// The assertions are the visible outcome: the photo's margins on its paper, and the box the leaf's
// photo is DRAWN in (object-fit letterboxes inside the element) against the resting photo's, frozen
// at the start of the turn (front, stationary overlay) and at its end (back face).
// Lives beside announce-card.smoke.mjs for the same reasons and runs from the same gated block.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const argv = process.argv.slice(2);
const ti = argv.indexOf('--tile');
const TILE = path.resolve(ti >= 0 ? argv[ti + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const ASTRO = path.join(TILE, 'packages/sitetile/astro');
const FIX = path.join(TILE, 'packages/sitetile/.smoke-photobook-mat');
const DIST = path.join(FIX, 'dist');

// An RGB PNG of w×h: a 4×4 colour grid, so a screenshot shows which part of a photo is where.
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = Math.floor(x * 4 / w), gy = Math.floor(y * 4 / h), o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = 40 + gx * 60; raw[o + 1] = 40 + gy * 60; raw[o + 2] = (gx + gy) % 2 ? 200 : 60;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// idx 0 land cover | 1 port A | 2 port B | 3 small A | 4 small B | 5 small C | 6 port C
// In a spread: (1,2) and (3,4) are pairs, so page 3 (idx 2) is an odd spread page. small is 100×150,
// smaller than any page's mat area on either viewport, so the resting page does not enlarge it.
const BOOK = `---
pagetile-book: true
title: Mat Photobook
source: photobook
---

# Mats
${[['Cover', 'land'], ['Portrait A', 'port'], ['Portrait B', 'port'], ['Small A', 'small'], ['Small B', 'small'],
  ['Small C', 'small'], ['Portrait C', 'port']].map(([t, f]) => `\n## ${t}\n![[pagetile/pb/${f}.png]]\n`).join('')}`;

// A sibling of astro/ at the same depth (the config's aliases are relative to its own location).
rmSync(FIX, { recursive: true, force: true });
cpSync(ASTRO, FIX, { recursive: true, filter: (s) => !/[\\/](node_modules|\.astro|dist-[^\\/]+|\.smoke-[^\\/]+|pagetile)(?:[\\/]|$)/.test(s) });
symlinkSync(path.join(ASTRO, 'node_modules'), path.join(FIX, 'node_modules'), 'dir');
mkdirSync(path.join(FIX, 'pagetile'), { recursive: true });
writeFileSync(path.join(FIX, 'pagetile/mats.book.md'), BOOK);
mkdirSync(path.join(FIX, 'public/pagetile/pb'), { recursive: true });
for (const [f, w, h] of [['land', 900, 600], ['port', 600, 900], ['small', 100, 150]]) writeFileSync(path.join(FIX, `public/pagetile/pb/${f}.png`), png(w, h));
execFileSync('npx', ['astro', 'build', '--outDir', DIST], { cwd: FIX, stdio: 'inherit',
  env: { ...process.env, SITE_ID: 'smoke-site', PLATFORM_ORIGIN: 'https://feelreef.com' } });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (!existsSync(f) || !path.extname(f)) f = existsSync(path.join(f, 'index.html')) ? path.join(f, 'index.html') : f;
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch();

// The box the PICTURE is drawn in: object-fit contain letterboxes it inside the element's box.
const DRAWN = () => { window.__drawn = (im) => {
  const b = im.getBoundingClientRect();
  if (getComputedStyle(im).objectFit !== 'contain' || !im.naturalWidth) return { left: b.left, top: b.top, width: b.width, height: b.height, right: b.right };
  const k = Math.min(b.width / im.naturalWidth, b.height / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
  const left = b.left + (b.width - w) / 2, top = b.top + (b.height - h) / 2;
  return { left, top, width: w, height: h, right: left + w };
}; };
const near = (a, b, where) => {
  assert.ok(a && b, `${where}: missing box (leaf ${JSON.stringify(a)}, resting ${JSON.stringify(b)})`);
  const d = Math.max(...['left', 'top', 'width', 'height'].map((k) => Math.abs(a[k] - b[k])));
  assert.ok(d <= 1, `${where}: the leaf's photo ${JSON.stringify(a)} is not the resting photo ${JSON.stringify(b)}`);
};
const centred = (p, where) => {
  const l = p.img.left - p.paper.left, r = p.paper.right - p.img.right;
  assert.ok(Math.abs(l - r) <= 1, `${where}: the photo is not centred on its paper — left margin ${l.toFixed(1)}px, right ${r.toFixed(1)}px`);
};

async function open(viewport, spread) {
  const ctx = await browser.newContext({ viewport });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e.message || e)));
  await pg.addInitScript(DRAWN);
  await pg.goto(origin + '/preview/c1-mats/', { waitUntil: 'load' });
  // every photo now: lazy ones off-screen in the horizontal track would otherwise never load
  await pg.evaluate(() => document.querySelectorAll('.ptr-page img').forEach((i) => { i.loading = 'eager'; }));
  await pg.waitForFunction(() => [...document.querySelectorAll('.ptr-page img')].every((i) => i.complete && i.naturalWidth > 0));
  if ((await pg.getAttribute('.ptr', 'data-spread')) !== spread) await pg.click('[data-act="spread"]');
  assert.equal(await pg.getAttribute('.ptr', 'data-spread'), spread, `spread ${spread} could not be set`);
  return { ctx, pg, errors };
}
const rests = (pg) => pg.evaluate(() => [...document.querySelectorAll('.ptr-page')].map((f) => {
  const b = f.getBoundingClientRect();
  return { kind: f.dataset.kind || null, paper: { left: b.left, right: b.right }, img: window.__drawn(f.querySelector('img')) };
}));
async function goTo(pg, idx) {
  await pg.click(`.ptr-thumb[data-idx="${idx}"]`);
  // until the page lies wholly on screen and the track has stopped (smooth scroll + snap); polled,
  // not a guessed delay. A turn started mid-scroll lands on the snapped pair, not where it lifted off.
  // (evaluate, not waitForFunction: a predicate that returns a Promise was taken as truthy as is.)
  const settled = await pg.evaluate(async (idx) => {
    const t = document.querySelector('.ptr-track'), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0, last = NaN; i < 100; i++, await sleep(100)) {
      const b = document.querySelectorAll('.ptr-page')[idx].getBoundingClientRect(), s = t.getBoundingClientRect();
      if (t.scrollLeft === last && b.left >= s.left - 1 && b.right <= s.right + 1) return true;
      last = t.scrollLeft;
    }
    return false;
  }, idx);
  assert.ok(settled, `page ${idx + 1} never came to rest on screen`);
}
// Press Next and freeze the turn at its start (end = false) or end. One task, so the resting boxes
// are those of the frame the turn starts from (before) and of the pair it jumped to (after).
const turnFrozen = (pg, end) => pg.evaluate(async (end) => {
  const snap = () => [...document.querySelectorAll('.ptr-page')].map((f) => window.__drawn(f.querySelector('img')));
  const before = snap();
  document.querySelector('[data-act="next"]').click();
  const L = document.querySelector('.ptr-turn');
  if (!L) return null;
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = end ? a.effect.getComputedTiming().endTime : 0; }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const at = (sel) => { const im = L.querySelector(sel + ' img'); return im ? window.__drawn(im) : null; };
  return { front: at('.ptr-leaf-front'), stay: at('.ptr-leaf-stay'), back: at('.ptr-leaf-back'), before, after: snap() };
}, end);
const land = (pg) => pg.evaluate(() => { for (const a of document.getAnimations()) a.finish(); });

let failed = null;
try {
  // Spread on (desktop): every mat page centred, and the three faces of two turns.
  {
    const where = 'desktop 1280×800 spread on';
    const { ctx, pg, errors } = await open({ width: 1280, height: 800 }, 'on');
    await goTo(pg, 1);
    const R = await rests(pg);
    assert.equal(R[2].kind, 'mat', `${where}: page 3 is not a mat page`);
    centred(R[2], `${where}, page 3 (an odd spread page)`);
    R.forEach((p, i) => { if (p.kind === 'mat') centred(p, `${where}, page ${i + 1}`); });
    // pair (2,3) → next: the leaf is page 3, the overlay page 2, the back page 4 (small)
    let f = await turnFrozen(pg, false);
    near(f.front, f.before[2], `${where}, turn start, front (page 3)`);
    near(f.stay, f.before[1], `${where}, turn start, stationary overlay (page 2)`);
    await land(pg); await goTo(pg, 1);
    f = await turnFrozen(pg, true);
    near(f.back, f.after[3], `${where}, turn end, back face (page 4, 100×150)`);
    await land(pg);
    // pair (4,5) → next, all three small: front page 5, overlay page 4, back page 6
    await goTo(pg, 3);
    f = await turnFrozen(pg, false);
    near(f.front, f.before[4], `${where}, turn start, front (page 5, 100×150)`);
    near(f.stay, f.before[3], `${where}, turn start, stationary overlay (page 4, 100×150)`);
    await land(pg); await goTo(pg, 3);
    f = await turnFrozen(pg, true);
    near(f.back, f.after[5], `${where}, turn end, back face (page 6, 100×150)`);
    await land(pg);
    assert.deepEqual(errors, [], `${where}: page errors`);
    console.log(`  ${where}: page 3 margins ${(R[2].img.left - R[2].paper.left).toFixed(1)}/${(R[2].paper.right - R[2].img.right).toFixed(1)}px, leaf faces = resting photos`);
    await ctx.close();
  }
  // Spread off (phone, desktop): a 100×150 photo turns at its resting size and place.
  for (const [vp, viewport] of [['phone 390×844', { width: 390, height: 844 }], ['desktop 1280×800', { width: 1280, height: 800 }]]) {
    const where = `${vp} spread off`;
    const { ctx, pg, errors } = await open(viewport, 'off');
    await goTo(pg, 3);
    const R = await rests(pg);
    assert.equal(R[3].kind, 'mat', `${where}: the small photo's page is not a mat page`);
    assert.ok(Math.abs(R[3].img.width - 100) <= 1 && Math.abs(R[3].img.height - 150) <= 1, `${where}: the resting 100×150 photo is drawn at ${JSON.stringify(R[3].img)}`);
    centred(R[3], `${where}, page 4`);
    const f = await turnFrozen(pg, false);
    near(f.front, f.before[3], `${where}, turn start, front (page 4, 100×150)`);
    await land(pg);
    assert.deepEqual(errors, [], `${where}: page errors`);
    console.log(`  ${where}: leaf photo ${f.front.width}×${f.front.height} at ${f.front.left.toFixed(1)},${f.front.top.toFixed(1)} = resting`);
    await ctx.close();
  }
  console.log('photobook-mat smoke: ok');
} catch (e) { failed = e; } finally {
  await browser.close(); server.close(); rmSync(FIX, { recursive: true, force: true });
}
if (failed) { console.error(failed); process.exit(1); }
