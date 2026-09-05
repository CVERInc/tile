// Acceptance for the backdrop scrim — the half that arithmetic cannot answer.
//
// 🔴 This harness is also what refuted the design it was written to confirm. The plan was a FLOOR
// on `backdrop-dim`, justified by "text floats on the scrim". Reading the stylesheet said the card's
// footer was `display:none`, so nothing floated on the only live card that has a backdrop — and
// that reading was wrong: the rule is inside `@media print`. Rendering the page and asking the
// browser is what found it. (Third time in one day that a premise came from grepping a source
// instead of measuring the output.)
//
// What the correction produced is better than the plan: every element that floats is MID-LIGHTNESS
// (the footer's #5a9aaa, a lane label in the accent) and a photograph can be brighter or darker
// than a mid-tone colour, so no scrim opacity below 100 rescues one. A floor would have been a gate
// that never fires. The shadow is the mechanism; the scrim is taste.
//
// So the two questions here are:
//   1. Did the fix cost the author anything? A stated `backdrop-dim` must survive, and nothing outside
//      the footer's box may change. Pixels, not reasoning.
//   2. When text floats, does the browser paint what the maths promised? A scrim in a ::after under
//      a fixed element has been wrong before in ways computed style cannot see.
//
// Text that floats gets two treatments, and neither is a colour override: a lane label carries a
// shadow, and the footer gets a ground-coloured PLATE so its ink — derived against --cp-ground — is
// actually standing on --cp-ground. Forcing the footer to light ink instead was tried and was wrong
// in light mode, where the scrim mixes toward a LIGHT ground: it measured 1.12:1.
//
//   node packages/cardtile/verify/backdrop-legibility.mjs
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';
import { contrast, parseColour, backdropDimDefault } from '../colour.mjs';

const VIEW = { width: 390, height: 844 };
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;

const serveOnce = async (md) => {
  const server = http.createServer(async (req, res) => {
    const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: { get: async () => md }, PREVIEW: 'true' });
    const b = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(b);
  });
  await new Promise((ok) => server.listen(0, ok));
  return { base: 'http://127.0.0.1:' + server.address().port, close: () => server.close() };
};

async function shoot(html, name) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  await page.waitForTimeout(600);
  const buf = await page.screenshot({ fullPage: true });
  fs.writeFileSync(join(OUT, name), buf);
  await ctx.close();
  return buf;
}

/** Where the footer sits, in CSS pixels — the one element the shadow is supposed to touch. */
async function footerBox(html) {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => {
    const el = document.querySelector('.st-footer');
    if (!el || getComputedStyle(el).display === 'none') return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height, plate: cs.backgroundImage };
  });
  await ctx.close();
  return b;
}

/** Differing pixels, whole page and outside a given CSS-pixel box. */
async function diff(a, b, box) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent('<canvas id=c></canvas>');
  const pct = await page.evaluate(async ([ba, bb, bx]) => {
    const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = 'data:image/png;base64,' + s; });
    const [ia, ib] = await Promise.all([load(ba), load(bb)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return -1;
    const grab = (img) => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    };
    const da = grab(ia), db = grab(ib);
    const s = ia.width / 390;                       // device pixels per CSS pixel
    const pad = 24;                                 // a shadow bleeds past the text box
    let all = 0, outside = 0;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i] - db[i]) <= 2 && Math.abs(da[i + 1] - db[i + 1]) <= 2 && Math.abs(da[i + 2] - db[i + 2]) <= 2) continue;
      all++;
      if (!bx) { outside++; continue; }
      const px = (i / 4) % ia.width, py = Math.floor((i / 4) / ia.width);
      const inBox = px >= (bx.x - pad) * s && px <= (bx.x + bx.w + pad) * s
                 && py >= (bx.y - pad) * s && py <= (bx.y + bx.h + pad) * s;
      if (!inBox) outside++;
    }
    const total = da.length / 4;
    return { all: (all / total) * 100, outside: (outside / total) * 100 };
  }, [a.toString('base64'), b.toString('base64'), box || null]);
  await ctx.close();
  return pct;
}

// ── 1. the backdrop specimen as production renders it, vs the same page with the rule removed ──
//
// 🩸 This block read `readCard('specimen-rich')` while still asserting the literal 48 — which was
// the backdrop-dim of the card this specimen REPLACED. The label had been swapped and the
// measured value left behind, so the test was checking one card against another card's number.
// The expectation is derived from the specimen now, which is the only form of this that cannot rot.
const card = readCard('specimen-rich');
const WANT_DIM = Number(/^backdrop-dim:\s*(\d+)/m.exec(card)?.[1]);
if (!Number.isFinite(WANT_DIM)) {
  throw new Error('specimen-rich states no backdrop-dim, so "the author\'s value survives" has nothing to survive — this harness needs a specimen that sets one');
}
const srv = await serveOnce(card);
const html = await (await fetch(`${srv.base}/probe`)).text();
srv.close();

const dim = /--cp-ground,#[0-9a-f]+\)\s+([\d.]+)%/.exec(html);
console.log('\n── the backdrop specimen');
console.log(`   backdrop-dim in the card: ${WANT_DIM}    rendered scrim: ${dim ? dim[1] : '??'}%`);
console.log(`   floats text on the scrim: ${html.includes('class="st-grid-label"')}`);
if (!dim || Number(dim[1]) !== WANT_DIM) { console.log(`   🔴 the author's ${WANT_DIM} did NOT survive into the scrim`); bad++; }
const box = await footerBox(html);
console.log(`   footer floats on the artwork:  ${box ? `yes, at y=${Math.round(box.y)}  plate: ${box.plate !== 'none'}` : 'no footer'}`);
// 🔴 REVERSED 2026-07-30 — this required a PLATE, and chodaict asked for the backgrounds to go
// (「st-footer 也是,不要背景色」). The plate's purpose was to keep the footer's ink standing on the
// ground it was derived against. The same end is now reached without a background: the footer uses
// `--cp-ink` (not `--cp-page-ink`, which is derived for the page mist and measured 2.86:1 on her
// artwork), plus a `--cp-ground` halo carried by the glyphs. Measured after: 6.39 dark, 12.96 light.
// The claim below — ink vs the pixels actually behind it — is unchanged and is what carries the file.
if (box && box.plate !== 'none') { console.log('   🔴 the footer still has a background plate — 不要背景色'); bad++; }
if (!box) { console.log('   🔴 no visible footer — the region test has nothing to scope to'); bad++; }

// The two things BACKDROP_CSS adds for text that floats on a creator's artwork: a shadow for the
// lane label, and a ground-coloured PLATE for the footer. (The footer used to get forced light ink
// instead — wrong in light mode, where the scrim mixes toward a light ground and light ink scored
// 1.12:1. A plate keeps its ink derived rather than asserted.)
let without = html
  .replace(/\.st-grid-label\{text-shadow:[^}]*\}/, '')
  // the floating-ink block replaced the plate; removing it is what "before the fix" now means
  .replace(/\.st-footer,\.st-footer>div\{color:var\(--cp-ink\)![^}]*\}/, '');
if (without === html) { console.log('   🔴 could not find the rules to remove — the control is testing nothing'); bad++; }
const [now, before] = [await shoot(html, 'backdrop-now.png'), await shoot(without, 'backdrop-before.png')];
const d = await diff(now, before, box);
console.log(`   pixels changed by the fix:      ${d.all.toFixed(4)}%  (whole page)`);
console.log(`   …of those, OUTSIDE the footer:  ${d.outside.toFixed(4)}%`);
// The shadow is meant to touch exactly one thing on her card: the footer, which floats on her
// artwork. Anything changing outside that box would mean the fix reached somewhere it should not.
if (d.outside !== 0) { console.log('   🔴 the fix changed pixels outside the footer'); bad++; }
// 🔴 NOT "did pixels change". They do not, and that is the good outcome: by the time the page
// reaches the footer the scrim has ramped to dim+18, so a ground-coloured plate over a
// nearly-ground background costs nothing to look at. The claim being tested is the one the plate
// exists to make — that the footer's ink, which is derived against --cp-ground, is standing on
// --cp-ground. So measure THAT, against the pixels.
const foot = await (async () => {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    // 🔴 The element that CARRIES the text, not the <footer> box. `.st-footer` is #5a9aaa and holds
    // no text node of its own; `.st-footer > div` is --cp-page-ink and is what a reader reads.
    // Measuring the wrapper reported 2.52:1 for a colour nothing is painted in.
    const el = [...document.querySelectorAll('.st-footer, .st-footer *')]
      .find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      || document.querySelector('.st-footer');
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const rgb = (css) => { g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
    const b = el.getBoundingClientRect();
    return { ink: rgb(getComputedStyle(el).color), ground: rgb(getComputedStyle(document.documentElement).getPropertyValue('--cp-ground')),
      y: b.y + scrollY, x: b.x + b.width / 2 };
  });
  await ctx.close();
  return r;
})();
const seat = contrast(foot.ink, foot.ground);
console.log(`   footer ink on --cp-ground:      ${seat.toFixed(2)}:1`);
if (seat < 4.5) { console.log('   🔴 the footer ink does not clear its own ground'); bad++; }

// ── 2. a card that DOES float text: does the paint match the promise? ──────────────────────────
const LABELLED = [
  '---', 'card-page: t', 'title: T', 'accent: #0556ff',
  'backdrop: https://example.com/x.jpg', 'backdrop-dim: 10', '---', '',
  '## grid', '', '- [ ] %% card: link w=6 %% [One](https://example.com)', '',
  '## Shop', '', '- [ ] %% card: link w=6 %% [Two](https://example.com)', '',
].join('\n');
const lab = await serveOnce(LABELLED);
let labHtml = await (await fetch(`${lab.base}/t`)).text();
lab.close();

const dflt = backdropDimDefault('#0556ff');
const labDim = Number(/--cp-ground,#[0-9a-f]+\)\s+([\d.]+)%/.exec(labHtml)[1]);
console.log('\n── a card with a named lane (text floats on the scrim)');
console.log(`   backdrop-dim in the card: 10    rendered scrim: ${labDim}%   (default would be ${dflt}%)`);
if (labDim !== 10) { console.log("   🔴 the author's number was overridden"); bad++; }

// Paint the worst case the floor is supposed to survive: a pure WHITE backdrop.
labHtml = labHtml.replace(/background-image:url\("[^"]*"\)/, 'background-image:none;background-color:#fff');
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.setContent(labHtml, { waitUntil: 'load' });
await page.waitForTimeout(500);
const measured = await page.evaluate(() => {
  const el = document.querySelector('.st-grid-label');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { colour: getComputedStyle(el).color, shadow: getComputedStyle(el).textShadow !== 'none',
    x: Math.round(r.x + r.width + 8), y: Math.round(r.y + r.height / 2), text: el.textContent };
});
const shot = await page.screenshot({ clip: { x: 0, y: 0, ...VIEW } });
fs.writeFileSync(join(OUT, 'labelled-over-white.png'), shot);
await ctx.close();

if (!measured) { console.log('   🔴 no label rendered — nothing was measured'); bad++; } else {
  const probe = await browser.newContext().then(async (c) => {
    const p = await c.newPage();
    await p.setContent(`<img id=i src="data:image/png;base64,${shot.toString('base64')}">`);
    await p.waitForFunction(() => document.getElementById('i').complete);
    const px = await p.evaluate(([x, y]) => {
      const img = document.getElementById('i');
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const s = img.naturalWidth / 390;
      const d = g.getImageData(Math.round(x * s), Math.round(y * s), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, [measured.x, measured.y]);
    await c.close();
    return px;
  });
  const ratio = contrast(parseColour(measured.colour), probe);
  console.log(`   label "${measured.text}"  fg=${measured.colour}  painted bg=rgb(${probe.join(',')})`);
  console.log(`   measured contrast over a WHITE backdrop: ${ratio.toFixed(2)}:1   shadow: ${measured.shadow}`);
  // The scrim carries body ink; a mid-tone label is carried by its shadow, which WCAG does not
  // score. So this reports rather than gates — but a label with NO shadow over white would be a
  // real failure, and that is what is asserted.
  if (!measured.shadow) { console.log('   🔴 the floating label has no shadow'); bad++; }
  if (ratio < 4.5) { console.log(`   ⚠️  ${ratio.toFixed(2)}:1 — the shadow is carrying it; WCAG does not score shadows`); }
}

await browser.close();
console.log(`\n${OUT}\n${bad ? '🔴 ' + bad + ' problem(s)' : '✅ the stated backdrop-dim survives, nothing outside the footer moves, and floating text stands on its own ground'}`);
process.exitCode = bad ? 1 : 0;
