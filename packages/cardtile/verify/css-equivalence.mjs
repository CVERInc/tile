// Does the REGENERATED stylesheet render the same card as the shipped one?
//
// gen-card-css.mjs was stale (de0c32b renamed the vocabulary in the generated card.css and not in
// the generator), and running it dropped every `.st-*` rule. Teaching it the rename fixes that — but
// it does not reproduce the committed file byte-for-byte: 127 rules against 113, and the extra ones
// are real rules in the legacy sheet that genuinely match a card.
//
// So byte-equality is the wrong question. It was the right DoD while the claim was "the generator
// reproduces the artifact"; the claim that actually matters to three live cards is "the two
// stylesheets render the same page". This measures that, on both themes, on all three cards:
//
//   · every cell's geometry, to the pixel
//   · every link, in order
//   · the visible text
//   · the computed colour of every element that carries one
//   · a full-page pixel diff
//
// 🔴 CONTROL: a deliberately broken stylesheet must fail every one of those. Without it, "no
// difference" and "the comparison is between two copies of the same render" look identical.
//
//   node packages/cardtile/verify/css-equivalence.mjs <other.css>
import fs from 'node:fs';
import http from 'node:http';
import { readCard, PLAYWRIGHT } from './paths.mjs';
import { renderCardHTML } from '../serve/card-worker.mjs';
import { CSS } from '../serve/card-assets.mjs';

const OTHER = process.argv[2];
if (!OTHER) { console.log('usage: node verify/css-equivalence.mjs <other.css>'); process.exit(2); }
const otherCss = fs.readFileSync(OTHER, 'utf8');
const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const THEMES = ['dark', 'light'];
const VIEW = { width: 900, height: 1400 };

// The CONTROL stylesheet: the shipped one with two overrides APPENDED.
//
// 🔴 The first version edited card.css's own `grid-column:span N` and `border-radius` declarations —
// and changed nothing, because the SPANS COME FROM THE RENDERER'S INLINE <style>, which is later in
// the document and wins. A control that blunts outranked rules fires on nothing and reports "the
// probe cannot see layout" when the truth is "there was nothing there to break". Appending wins by
// order, so these are certainly in effect.
// 🔴 `!important`, and on a property card.css can actually reach. The renderer's inline <style> is
// LATER in the document, so an appended ordinary rule still loses to it — which is how the first two
// attempts produced a control that changed 55% of the pixels and no geometry at all, and reported
// "the probe is not reading layout".
const brokenCss = CSS + '\n.st-cell{width:50%!important;border-radius:0!important;background:#ff00ff!important}\n';

const which = { a: CSS, b: otherCss, control: brokenCss };
const server = http.createServer((req, res) => {
  const [, variant, handle] = (req.url || '').split('?')[0].split('/');
  const md = CARDS.includes(handle) ? readCard(handle) : null;
  if (!md || !which[variant]) { res.writeHead(404).end('no'); return; }
  const html = renderCardHTML(md, { handle, cardUrl: `https://card.feelreef.com/${handle}` })
    .replace(CSS, which[variant]);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();

/** everything that must not move, read out of a rendered page */
async function probe(variant, handle, theme) {
  // 🔴 reduced motion, or the diff measures the carousel's phase. A card's slider and the QR's
  // hint both animate, and a pixel comparison of two independent page loads catches them mid-stride:
  // measured 0.918% "difference" between a stylesheet and ITSELF before this was added.
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}/${variant}/${handle}`, { waitUntil: 'load' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const rect = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','); };
    const boxes = [...document.querySelectorAll('.st-cell, .st-run, .st-grid, .st-bleed, .st-footer')].map(rect);
    const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h && h !== '#');
    // computed colour of everything that paints one — the class of defect that geometry misses
    const colours = [...document.querySelectorAll('.st-card *')].slice(0, 400).map((e) => {
      const cs = getComputedStyle(e);
      return [cs.color, cs.backgroundColor, cs.borderTopColor, cs.outlineColor].join('|');
    });
    return { boxes, links, colours, text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(), height: document.documentElement.scrollHeight };
  });
  const shot = await page.screenshot({ fullPage: true });
  await ctx.close();
  return { ...m, shot };
}

/** fraction of differing pixels between two PNG buffers of the same size, via canvas in the browser */
async function pixelDiff(a, b) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pct = await page.evaluate(async ([da, db]) => {
    const load = (d) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = d; });
    const [ia, ib] = await Promise.all([load(da), load(db)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: `${ia.width}x${ia.height} vs ${ib.width}x${ib.height}` };
    const c = (img) => { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; cv.getContext('2d').drawImage(img, 0, 0); return cv.getContext('2d').getImageData(0, 0, img.width, img.height).data; };
    const pa = c(ia); const pb = c(ib);
    let diff = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 12) diff++;
    }
    return { pct: +((diff / (pa.length / 4)) * 100).toFixed(3) };
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
  await ctx.close();
  return pct;
}

const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
let bad = 0;
const rows = [];

// 🔴 NOISE FLOOR first. Two independent loads of the SAME stylesheet — one specimen carries a JS
// fish sim that scatters swimmers randomly and another a carousel, so a nonzero pixel diff does not by
// itself mean the stylesheets differ. Without this number every row below is unreadable.
console.log('noise floor — the SHIPPED sheet against itself, two separate loads\n');
const floor = {};
for (const handle of CARDS) {
  const one = await probe('a', handle, 'dark');
  const two = await probe('a', handle, 'dark');
  const px = await pixelDiff(one.shot, two.shot);
  floor[handle] = typeof px.pct === 'number' ? px.pct : 100;
  console.log(`   ${handle.padEnd(12)} ${floor[handle]}%`);
}
console.log('');

for (const handle of CARDS) {
  for (const theme of THEMES) {
    const A = await probe('a', handle, theme);
    const B = await probe('b', handle, theme);
    const px = await pixelDiff(A.shot, B.shot);
    const r = {
      handle, theme,
      geometry: eq(A.boxes, B.boxes),
      links: eq(A.links, B.links),
      text: A.text === B.text,
      colours: eq(A.colours, B.colours),
      px: px.sizeMismatch || px.pct,
      cells: A.boxes.length,
      elems: A.colours.length,
    };
    rows.push(r);
    // a pixel difference counts only if it clears that card's own noise floor
    r.overFloor = typeof r.px === 'number' ? r.px > floor[handle] + 0.05 : true;
    if (!r.geometry || !r.links || !r.text || !r.colours || r.overFloor) bad++;
  }
}

console.log(`shipped card.css  vs  ${OTHER}\n`);
console.log('card         theme   cells  elems  geometry  links  text  colours  pixels differ');
for (const r of rows) {
  console.log(`${r.handle.padEnd(12)} ${r.theme.padEnd(7)} ${String(r.cells).padEnd(6)} ${String(r.elems).padEnd(6)} `
    + `${(r.geometry ? 'same' : 'DIFF').padEnd(9)} ${(r.links ? 'same' : 'DIFF').padEnd(6)} `
    + `${(r.text ? 'same' : 'DIFF').padEnd(5)} ${(r.colours ? 'same' : 'DIFF').padEnd(8)} ${r.px}${typeof r.px === 'number' ? '%' : ''}${r.overFloor ? '  ← over the noise floor' : ''}`);
}

// 🔴 CONTROL — a stylesheet with its spans and radii blunted must fail. If it does not, every "same"
// above is a comparison between two renders of the same thing and means nothing.
console.log('\nCONTROL — the shipped sheet with grid spans and radii blunted');
{
  const A = await probe('a', CARDS[CARDS.length - 1], 'dark');
  const C = await probe('control', CARDS[CARDS.length - 1], 'dark');
  const px = await pixelDiff(A.shot, C.shot);
  const geomSame = eq(A.boxes, C.boxes);
  console.log(`   geometry ${geomSame ? 'same' : 'DIFF'}   pixels differ ${px.sizeMismatch || px.pct + '%'}`);
  if (geomSame) { console.log('   🔴 CONTROL: blunting every grid span changed no geometry — the probe is not reading layout'); bad++; }
  if (px.pct === 0) { console.log('   🔴 CONTROL: the pixel diff saw nothing — it is not comparing renders'); bad++; }
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} difference(s) — the two stylesheets do NOT render the same card` : '\n✅ the two stylesheets render the same card, to the pixel, on both themes');
process.exitCode = bad ? 1 : 0;
