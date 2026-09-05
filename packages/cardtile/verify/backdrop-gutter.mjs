// A card with a backdrop must show its artwork all the way to the edge of the window.
//
// card.css declares `scrollbar-gutter: stable` on html. That reserves an 11px strip (the scrollbar is
// `thin`) and shrinks html's border box to 1189 of a 1200px window. `.st-backdrop` is `position:fixed;
// inset:0`, so it lays out against that shrunken box: the artwork stops 11px short, and the reserved
// strip falls through to the canvas, which the light-theme work painted with `--cp-ground`. The result
// is a full-height band of flat card-colour beside the photograph.
//
// 🔴 THIS HARNESS MEASURES PIXELS, NOT GEOMETRY, and that is the whole point of it. The first version
// checked `.st-backdrop`'s width and would have passed `.st-backdrop{width:100vw}` — a change that
// moves the box from 1189 to 1200 and alters NOT ONE PIXEL, because root `overflow-x:hidden` clips it
// straight back. A geometry-only check reports that fix as a success. So the assertion is on the
// colour of the rightmost column of an actual screenshot.
//
// Three claims:
//
//   1. the rightmost pixels of a backdrop card are ARTWORK, not flat ground
//   2. cards WITHOUT a backdrop keep `scrollbar-gutter: stable` and do not move at all
//   3. no horizontal scrollbar is introduced, and the backdrop card stays scrollable
//
// and claim 1 carries a CONTROL: with `stable` pinned back, those same pixels must actually BE flat
// ground. Without that column this passes just as happily on a browser that reserves no gutter, and
// reports a fix to a defect that was never reproduced.
//
//   node packages/cardtile/verify/backdrop-gutter.mjs
import http from 'node:http';
import fs from 'node:fs';
import { join } from 'node:path';
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// 🩸 These named a creator's handle and `['specimen-plain', 'specimen-assets']`, and BOTH were wrong
// by 2026-08-12: that card left the package with the hand-built ones, and specimen-assets turns out to
// carry a backdrop of its own — so the "nothing else moves" control was being run on a card that
// moves. A harness that names its specimens by hand needs to CHECK them, or it drifts the moment
// the specimen set changes and says nothing while it does.
const BACKDROP_CARD = 'specimen-rich';
const PLAIN_CARDS = ['specimen-plain'];             // the "nothing else moves" controls
const CARDS = [...PLAIN_CARDS, BACKDROP_CARD];

// 🔴 …and prove it, here, before anything is measured. Reading the specimen is cheap; discovering
// six weeks later that the control had a backdrop is not.
{
  const hasBackdrop = (h) => /^backdrop\s*:/m.test(readCard(h));
  if (!hasBackdrop(BACKDROP_CARD)) {
    throw new Error(`${BACKDROP_CARD} has no \`backdrop:\` — this harness measures the gutter of a backdrop card and there is nothing to measure`);
  }
  for (const h of PLAIN_CARDS) {
    if (hasBackdrop(h)) {
      throw new Error(`${h} HAS a backdrop, so it cannot be the "nothing else moves" control — pick a card without one`);
    }
  }
}
const VIEWS = [{ width: 390, height: 844 }, { width: 1200, height: 900 }];
// 🔴 !important: addStyleTag appends to <head>, and BACKDROP_CSS is printed in the <body>. Without it
// the "before" column silently measures the AFTER behaviour and both columns agree no matter what.
const OLD = 'html{scrollbar-gutter:stable!important}';
// How far apart two colours have to be before we call them different things.
const FAR = ([a, b, c], [x, y, z]) => Math.abs(a - x) + Math.abs(b - y) + Math.abs(c - z) > 24;
// 🔴 The band is identified WITHOUT a spatial reference, and that is deliberate. Comparing the edge
// against "the backdrop 30px to its left" fails at 390px, where 30px in from the edge is inside the
// CARD, not the artwork — the first version of this file read a blue cell as the backdrop and called
// a correct render a defect. What actually distinguishes them needs no neighbour:
//   a band is FLAT (identical all the way down) and equal to the canvas colour;
//   artwork VARIES down the page and is not the canvas colour.
const flat = (cols) => cols.every((c) => !FAR(c, cols[0]));
// 🔴 Chromium reports a color-mix() result as `color(srgb 0.041 0.052 0.137)`, NOT as `rgb(11,13,35)`.
// A naive /\d+/ over that reads "0", "041", "0" as the channels — the same mistake that once invented
// 90 contrast failures out of nothing. Both forms have to be handled, and the float form scaled.
const parseRgb = (s) => {
  const srgb = /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s);
  if (srgb) return srgb.slice(1, 4).map((n) => Math.round(Number(n) * 255));
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s);
  if (rgb) return rgb.slice(1, 4).map(Number);
  throw new Error(`cannot read a colour out of ${JSON.stringify(s)}`);
};

const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
  const b = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(b);
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://127.0.0.1:' + server.address().port;
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;

async function probe(handle, view, pinOld, scheme = 'dark') {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  await page.waitForTimeout(700);
  if (pinOld) { await page.addStyleTag({ content: OLD }); await page.waitForTimeout(250); }
  const geom = await page.evaluate(() => {
    const card = document.querySelector('.st-card') || document.querySelector('.st-cells-wrap');
    const r = card && card.getBoundingClientRect();
    const h = document.documentElement;
    return {
      reserved: window.innerWidth - h.offsetWidth,        // the strip, measured the way that works
      ground: getComputedStyle(h).backgroundColor,
      card: r ? Math.round(r.width) : null,
      cardLeft: r ? Math.round(r.left) : null,
      docH: Math.round(h.scrollHeight),
      overflowX: h.scrollWidth > h.clientWidth,
      scrollable: h.scrollHeight > h.clientHeight,
    };
  });
  const shot = await page.screenshot();
  // Sample the captured image itself — the rightmost column, and a reference column well inside it.
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((ok) => { img.onload = ok; img.src = 'data:image/png;base64,' + b64; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
    const ys = [Math.round(img.height * 0.25), Math.round(img.height * 0.5), Math.round(img.height * 0.75)];
    return {
      w: img.width,
      edge: ys.map((y) => at(img.width - 1, y)),        // the rightmost column
      inside: ys.map((y) => at(img.width - 30, y)),     // backdrop proper, same heights
    };
  }, shot.toString('base64'));
  await ctx.close();
  return { ...geom, ...px, shot };
}

const say = (c) => `rgb(${c.join(',')})`;

console.log('CLAIM 1 — the rightmost pixels of a backdrop card are artwork, not flat ground\n');
for (const view of VIEWS) {
  for (const scheme of ['dark', 'light']) {
    const now = await probe(BACKDROP_CARD, view, false, scheme);
    const then = await probe(BACKDROP_CARD, view, true, scheme);
    // A band is flat AND the canvas colour. Artwork is neither.
    const band = (m) => flat(m.edge) && !FAR(m.edge[0], parseRgb(m.ground));
    const nowBand = band(now);
    const thenBand = band(then);
    console.log(`${view.width}px ${scheme.padEnd(6)} reserved=${String(now.reserved).padEnd(3)} edge ${now.edge.map(say).join(' ')}   ${nowBand ? '🔴 BAND' : 'artwork'}`);
    console.log(`              was: reserved=${String(then.reserved).padEnd(3)} edge ${then.edge.map(say).join(' ')}   ${thenBand ? 'band' : 'artwork'}   ground ${then.ground}`);

    if (nowBand) { console.log('   🔴 a flat band of the canvas colour still runs down the edge'); bad++; }
    // 🔴 CONTROL: the old rule must actually produce the band, or claim 1 is about nothing.
    if (!thenBand) {
      console.log(`   🔴 CONTROL: with \`stable\` pinned back there was NO band — nothing was reproduced, so nothing was fixed`);
      bad++;
    }
    if (now.overflowX) { console.log('   🔴 the page now scrolls horizontally'); bad++; }
    if (!now.scrollable) { console.log('   ⚠️  card is not scrollable at this size — the gutter was moot here'); }
  }
}

console.log('\nCLAIM 2 — a card with no backdrop keeps its gutter and does not move');
for (const handle of PLAIN_CARDS) {
  for (const view of VIEWS) {
    const now = await probe(handle, view, false);
    const then = await probe(handle, view, true);
    const moved = now.card !== then.card || now.cardLeft !== then.cardLeft || now.docH !== then.docH;
    console.log(`  ${handle.padEnd(10)} ${String(view.width).padEnd(5)} reserved=${String(now.reserved).padEnd(3)} card ${now.card}@${now.cardLeft} h${now.docH}   was ${then.card}@${then.cardLeft} h${then.docH}   ${moved ? '🔴 MOVED' : 'unchanged'}`);
    if (moved) { bad++; }
    if (now.reserved === 0) { console.log('   🔴 this card lost its stable gutter — the change leaked past backdrop cards'); bad++; }
  }
}

const shot = (await probe(BACKDROP_CARD, VIEWS[1], false)).shot;
fs.writeFileSync(join(OUT, 'backdrop-gutter.png'), shot);

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ the artwork reaches the edge, and cards without one keep their gutter');
process.exitCode = bad ? 1 : 0;
