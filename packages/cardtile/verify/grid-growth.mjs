// `grid-auto-rows: minmax(<one unit>, auto)` — what looked like the safe half of dropping `h`.
//
// 🔴 IT IS NOT SHIPPED, and this harness is why. The rule is completely inert on its own: `.st-cell`
// carries `overflow:hidden`, so the grid never learns that anything overflowed and `auto` never
// grows. Claim 1 passed at 0.0000% on all three cards; claim 2's control then showed the same 0% on
// a card built specifically to overflow. A rule that can never fire is exactly the defect that made
// a video render as a black box, so it was reverted rather than left in looking helpful.
//
// Lifting `overflow:hidden` is what unblocks it, and that is also what clips a picture to the cell's
// radius — so it belongs to the cell-layer rebuild, not before it. Run this again then.
//
// Two claims, and the second is the one that makes the first worth having:
//
//   1. NOTHING that fits today moves. The minimum is still exactly one unit, so every existing card
//      renders pixel-for-pixel as before. Measured as a pixel diff against the old fixed rule.
//   2. Something that does NOT fit grows instead of being cut off by `overflow:hidden`. Measured by
//      forcing an overflow and checking the cell got taller — with a CONTROL that the same content
//      under the old rule really is clipped, or claim 2 proves nothing.
//
//   node packages/cardtile/verify/grid-growth.mjs
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// 🩸 THE SUBJECT OF THIS HARNESS IS NOT IN THE PAGE. The rule was reverted (see the header), and
// with it gone claim 1 stopped comparing "the new rule" against "the old one" and started comparing
// TODAY'S SHIPPED LAYOUT against a hand-written reconstruction of the layout as it was before the
// cell-layer rebuild. Those differ on purpose — cells no longer author heights — so on 2026-08-12
// this printed four reds, all of them about its own expired baseline and none of them actionable.
//
// So it asks first whether there is anything here to measure. If somebody ships the rule, this wakes
// up on its own; until then it says what it is waiting for instead of manufacturing a red. A control
// fetched from a reconstruction has a shelf life, and this one's ran out.
const SHIPPED_CSS = (await import('./paths.mjs')).CSS();
if (!/grid-auto-rows\s*:\s*minmax/.test(SHIPPED_CSS)) {
  console.log('usage: the rule under test is NOT shipped — `grid-auto-rows: minmax(...)` is absent from');
  console.log('  the served CSS, so both arms would render the same page and claim 1 would be comparing');
  console.log('  today\'s layout against a reconstruction of the pre-rebuild one. Nothing was measured.');
  console.log('  Re-base OLD and run this again when the cell-layer rebuild lands the rule.');
  process.exit(0);
}

const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const VIEW = { width: 390, height: 844 };
// The rule as it was: a fixed row height, so anything too tall meets overflow:hidden.
// The cell layer as it was: a fixed row height, h authored via data-span, the picture absolutely
// positioned inside a box the grid supplied.
const OLD = `.st-card .st-cells{grid-auto-rows:calc((100cqw - 5 * 14px) / 6)!important;grid-auto-flow:dense!important;align-items:stretch!important}
.st-card .st-cell{overflow:hidden!important}
.st-card .st-gal-link{height:100%!important}
.st-card .st-gal-img{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;aspect-ratio:auto!important}
${[[2,2],[3,2],[3,3],[6,1],[6,2],[6,3],[6,4]].map(([w,h])=>`.st-card [data-span="${w}x${h}"]{grid-column:span ${w}!important;grid-row:span ${h}!important}`).join('\n')}`;

const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : md) };
let md = '';
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

async function shoot(handle, pinOld) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  if (pinOld) { await page.addStyleTag({ content: OLD }); await page.waitForTimeout(200); }
  await page.waitForTimeout(600);
  const buf = await page.screenshot({ fullPage: true });
  await ctx.close();
  return buf;
}

async function diff(a, b) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent('<div></div>');
  const out = await page.evaluate(async ([x, y]) => {
    const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.height, ib.height], pct: -1 };
    const grab = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, img.width, img.height).data; };
    const da = grab(ia), db = grab(ib);
    let n = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) > 2 || Math.abs(da[i + 1] - db[i + 1]) > 2 || Math.abs(da[i + 2] - db[i + 2]) > 2) n++;
    return { size: [ia.height, ib.height], pct: (n / (da.length / 4)) * 100 };
  }, [a.toString('base64'), b.toString('base64')]);
  await ctx.close();
  return out;
}

console.log('CLAIM 1 — nothing that fits moves');
for (const handle of CARDS) {
  const [now, then] = [await shoot(handle, false), await shoot(handle, true)];
  const d = await diff(now, then);
  console.log(`  ${handle.padEnd(11)} page height ${d.size[0]} vs ${d.size[1]}   pixels differing: ${d.pct < 0 ? 'DIFFERENT SIZE' : d.pct.toFixed(4) + '%'}`);
  if (d.pct !== 0) { console.log('     🔴 an existing card moved'); bad++; }
  fs.writeFileSync(join(OUT, `grid-${handle}.png`), now);
}

// ── CLAIM 2, with its control ──────────────────────────────────────────────────────────────────
// A LABEL, not a `sub` — the first attempt padded `sub` and the control caught that it never
// overflowed at all, so claim 2 would have been proving nothing about nothing.
md = ['---', 'card-page: over', 'title: Over', 'accent: #0556ff', '---', '',
  '## grid', '',
  '- [ ] %% card: link w=2 h=2 %% [' + 'far too much text to fit inside a two column cell '.repeat(5) + '](https://example.com)',
  '- [ ] %% card: link w=2 h=2 %% [Ok](https://example.com)',
].join('\n');

async function cellHeights(pinOld) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/over`, { waitUntil: 'load' });
  if (pinOld) { await page.addStyleTag({ content: OLD }); }
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => Array.from(document.querySelectorAll('.st-cells > *')).map((el) => ({
    h: Math.round(el.getBoundingClientRect().height),
    clipped: el.scrollHeight - el.clientHeight > 2,
  })));
  await ctx.close();
  return m;
}

const grown = await cellHeights(false);
const fixed = await cellHeights(true);
console.log('\nCLAIM 2 — content that does not fit grows instead of being cut off');
console.log(`  now:  ${grown.map((c) => c.h + (c.clipped ? ' CLIPPED' : '')).join('  ')}`);
console.log(`  was:  ${fixed.map((c) => c.h + (c.clipped ? ' CLIPPED' : '')).join('  ')}`);
if (!grown.length) { console.log('  🔴 no cells rendered — nothing was measured'); bad++; }
if (grown.some((c) => c.clipped)) { console.log('  🔴 a cell is still clipping its content'); bad++; }
// 🔴 CONTROL: the old rule must actually clip this, or claim 2 is about nothing.
if (!fixed.some((c) => c.clipped)) { console.log('  🔴 CONTROL: the old rule did NOT clip this content, so nothing was fixed'); bad++; }
// and the row-mate is dragged along — the geometry the spec calls out rather than hides
if (grown.length > 1 && grown[0].h !== grown[1].h) { console.log(`  ⚠️  row-mates differ (${grown[0].h} vs ${grown[1].h}) — a shared row should not`); }

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ existing cards untouched; overflow grows instead of clipping');
process.exitCode = bad ? 1 : 0;
