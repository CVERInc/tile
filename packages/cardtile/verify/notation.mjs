// Read a live page and print its layout the way chodaict reads it off the screen:
//
//   高x寬 in six-column units, with (slide*N) when a block is a carousel.
//
//   node packages/cardtile/verify/notation.mjs https://portaly.cc/<slug> [more…]
//
// 🩸 WHY. On 2026-07-30 he typed HTL's page out by hand — 方(6x6)、方(6x6)、細(1x6)、長方(3x6)、
// 長方(3x6)、細(1x6) — and then Incrediville's, and both times it took me straight to a defect I had
// been circling for hours. His notation carries the one thing my own output never could: that three
// of those blocks are ONE moving thing each. 「我不知道為什麼你都不看 live 就用猜的」 — I had looked
// at the live pages for heights, requests, thumbnail sizes and colours, and then gone back to the
// JSON to reason about STRUCTURE. This is the ruler that stops me asking him again.
//
// Verified against his reading of HTL: 6x6 6x6 1x6 3x6 3x6 1x6 — exact.
//
// 🔴 The slide COUNT here is not authoritative: a looping carousel clones slides, so this reports 8
// where the page has 5. Use it to learn THAT a block is a carousel; the true count is in the
// payload's item list.
import { PLAYWRIGHT } from './paths.mjs';
const pw = (await import(PLAYWRIGHT)).default;
const b = await pw.chromium.launch();
const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage();
// 🩸 With no URLs this file used to print NOTHING and exit 0, and the inventory called it GREEN —
// a pass earned by never looking at anything. Silence and satisfaction must not be the same output.
const URLS = process.argv.slice(2);
if (!URLS.length) {
  console.log('usage: node notation.mjs <url> [more…]  — no URLs given, so nothing was surveyed');
  process.exit(0);
}

for (const url of URLS) {
  await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
  await p.evaluate(async () => { for (let y=0;y<document.body.scrollHeight;y+=300){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));} window.scrollTo(0,0); });
  await p.waitForTimeout(1200);
  const rows = await p.evaluate(() => {
    // 🔴 Find the block host by COVERAGE, not by a guess: the parent whose direct children together
    // span the most vertical distance is the column the page is built out of.
    let host = null, best = 0;
    for (const el of document.querySelectorAll('div,section,main,ul')) {
      const kids = [...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 30 && r.width > 200);
      if (kids.length < 4) continue;
      const span = Math.max(...kids.map((r) => r.bottom)) - Math.min(...kids.map((r) => r.top));
      if (span > best) { best = span; host = el; }
    }
    if (!host) return [];
    const W = Math.max(...[...host.children].map((c) => c.getBoundingClientRect().width));
    const unit = W / 6;
    return [...host.children].map((el) => {
      const r = el.getBoundingClientRect();
      if (r.height < 30 || r.width < 60) return null;
      const imgs = el.querySelectorAll('img').length;
      // 🔴 A carousel is a STACK, not a grid: its pictures occupy the same box. Overflow/dots were the
      // wrong signals — Portaly's slider is neither a scroller nor dotted with a guessable class.
      // Overlap is what a stack looks like from the outside, whatever library drew it.
      const boxes = [...el.querySelectorAll('img')].map((i) => i.getBoundingClientRect()).filter((r) => r.width > 40 && r.height > 40);
      let stacked = 0, offstage = 0;
      for (let i = 1; i < boxes.length; i++) {
        const a = boxes[0], c = boxes[i];
        const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (ox > a.width * 0.5 && oy > a.height * 0.5) stacked++;
      }
      // …or a TRACK: siblings parked outside the block's own box, clipped by overflow:hidden. That is
      // what a swipe carousel looks like from the outside — same picture count, none of them stacked.
      for (const c of boxes) if (c.left > r.right - 4 || c.right < r.left + 4) offstage++;
      const slide = (stacked || offstage) ? boxes.length : 0;
      return { h: Math.max(1, Math.round(r.height / unit)), w: Math.max(1, Math.round(r.width / unit)), slide };
    }).filter(Boolean);
  });
  console.log(`\n== ${url}`);
  rows.forEach((r) => console.log(`  ${r.h}x${r.w}${r.slide > 1 ? `(slide*${r.slide})` : ''}`));
}
await b.close();
