// EXPERIMENT — drop `h`, let the browser pack.
//
// Nothing in the repo is touched. The whole change is CSS, which is only possible because spans are
// already a data attribute: `data-span="2x2"` lets a stylesheet read the WIDTH and ignore the height.
// If spans were still a class this experiment would have needed a renderer change to even try.
//
//   today   grid-auto-rows: <one column width>   →  a 1×1 is a square, h is authored, packGrid places
//   flow    grid-auto-rows: auto + dense         →  height is content, only w is authored, CSS packs
//
// Measured per card: page height, whether anything overflows its box, whether anything overlaps,
// and how much empty grid there is (the raggedness the change is expected to introduce).
//
// 🔴 THE CARDS THIS ORIGINALLY RAN ON ARE NOT IN THIS REPO. It read three live creators' cards
// through `readCard`, which at the time resolved to copies of their pages. Those left the package
// on 2026-08-12 (see verify/paths.mjs) and `readCard` resolves to the SPECIMENS now — so the
// handles below are the specimens, and this file runs again instead of dying on ENOENT. The
// numbers in README.md are from the original run on the live cards and are NOT reproducible here;
// they are kept because the finding is the finding, and re-deriving it needs cards of comparable
// shape, not those particular people's.
import fs from 'node:fs';
import http from 'node:http';
import { OUT, readCard, PLAYWRIGHT } from '../../../packages/cardtile/verify/paths.mjs';
import worker from '../../../packages/cardtile/serve/card-worker.mjs';

const CARDS = ['specimen-rich', 'specimen-plain', 'specimen-assets'];

// The whole proposal, as a stylesheet. `.st-card.st-card` doubles a class to outrank NATIVE_CSS,
// which is printed inside the body and so beats anything added to the head.
const FLOW = `
/* 🔴 !important throughout, because this is an EXPERIMENT and specificity is not the question being
   asked. Shipping it would use real selectors. */
.st-cells{grid-auto-rows:auto!important;grid-auto-flow:row dense!important;align-items:start!important}
${[1, 2, 3, 4, 5, 6].map((w) => `[data-span^="${w}x"]{grid-column:span ${w}!important;grid-row:auto!important}`).join('\n')}
.st-hero{grid-row:auto!important}

/* THE STRUCTURAL PART, and the reason this is not a one-line change: every image tile is currently
   an absolutely-positioned picture filling a box whose height the GRID supplies. Take the grid's
   height away and the picture stops contributing any, so the cell collapses to one row while the
   image spills 329px out of it. In a flow model the picture has to be in flow and carry its own
   aspect — which is also where the 防醜 guarantee moves to: square because it is a picture tile,
   not because the layout engine squashed the box. */
.st-gal-img{position:static!important;display:block!important;width:100%!important;height:auto!important;aspect-ratio:1!important;object-fit:cover!important}
.st-gal-link{position:relative!important;display:block!important;height:auto!important}
.st-gal-cell,.st-cell-tile{height:auto!important}
/* Linktree's 64 is a floor, not a lid */
[data-span^="6x"].st-cell-tile{min-height:64px!important}
`;

const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://x' + req.url, { headers: req.headers }), { CARDS: store, PREVIEW: 'true' });
  const b = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(b);
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://127.0.0.1:' + server.address().port;
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();

async function look(handle, flow) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  await pg.goto(`${base}/${handle}`, { waitUntil: 'load' }).catch(() => {});
  await pg.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  if (flow) { await pg.addStyleTag({ content: FLOW }); await pg.waitForTimeout(600); }
  await pg.waitForTimeout(600);

  const m = await pg.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.st-cells > *'));
    const boxes = cells.map((el) => {
      const r = el.getBoundingClientRect();
      // does the content need more room than the box gives it?
      const overflow = Math.max(0, el.scrollHeight - el.clientHeight);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), overflow };
    });
    // overlaps — a packing failure would show here
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b2 = boxes[j];
      if (a.x < b2.x + b2.w && b2.x < a.x + a.w && a.y < b2.y + b2.h && b2.y < a.y + a.h) overlaps++;
    }
    // how much of the grid's area is not covered by a cell = the raggedness
    const grids = Array.from(document.querySelectorAll('.st-cells'));
    let gridArea = 0, cellArea = 0;
    for (const g of grids) {
      const gr = g.getBoundingClientRect();
      gridArea += gr.width * gr.height;
      for (const c of Array.from(g.children)) {
        const cr = c.getBoundingClientRect();
        cellArea += cr.width * cr.height;
      }
    }
    return {
      pageHeight: document.documentElement.scrollHeight,
      cells: boxes.length,
      overflowing: boxes.filter((b2) => b2.overflow > 2).length,
      worstOverflow: Math.max(0, ...boxes.map((b2) => b2.overflow)),
      overlaps,
      emptyPct: gridArea ? +((1 - cellArea / gridArea) * 100).toFixed(1) : 0,
      squareish: boxes.filter((b2) => b2.w > 60 && Math.abs(b2.w - b2.h) / b2.w < 0.12).length,
    };
  });
  await pg.screenshot({ path: `/tmp/flow-${handle}-${flow ? 'after' : 'before'}.png`, fullPage: true });
  await ctx.close();
  return m;
}

console.log('card        mode     height  cells  overflowing  worst  overlaps  empty%  square-ish');
for (const h of CARDS) {
  for (const flow of [false, true]) {
    const m = await look(h, flow);
    console.log(`${h.padEnd(11)} ${(flow ? 'flow' : 'today').padEnd(8)} ${String(m.pageHeight).padEnd(7)} `
      + `${String(m.cells).padEnd(6)} ${String(m.overflowing).padEnd(12)} ${String(m.worstOverflow).padEnd(6)} `
      + `${String(m.overlaps).padEnd(9)} ${String(m.emptyPct).padEnd(7)} ${m.squareish}`);
  }
}
await browser.close(); server.close();
console.log('\nscreenshots: /tmp/flow-<card>-{before,after}.png');
