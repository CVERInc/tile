// A rename is safe when it changes NAMES and nothing else. That is a checkable claim, so check it.
//
//   node packages/cardtile/verify/rename-safety.mjs snapshot     → out/card-verify/rename-before.json
//   node packages/cardtile/verify/rename-safety.mjs check        → compares against the snapshot
//
// What it captures, per card, for every element in document order: the tag, the computed styles
// that decide how something LOOKS, its box, and its text. Deliberately NOT the class attribute —
// that is the thing being changed, and a check that pinned it would fail by design.
//
// This exists because "rename cp-* to st-*" is exactly the change where a typo produces a selector
// that matches nothing, and a selector that matches nothing looks like a page that renders. The
// screenshot diff catches that too, but this says WHICH element and WHICH property, which is the
// difference between a red light and a fix.
import fs from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
const FILE = join(OUT, 'rename-before.json');
const mode = process.argv[2];

// The properties that decide appearance. Layout, colour, type, and the box — not `content` or
// anything that merely reflects the DOM.
const PROPS = [
  'display', 'position', 'flexDirection', 'justifyContent', 'alignItems', 'gap',
  'gridTemplateColumns', 'gridAutoRows', 'gridColumn', 'gridRow',
  'backgroundColor', 'backgroundImage', 'color', 'borderRadius', 'borderTopWidth', 'borderTopColor',
  'boxShadow', 'opacity', 'visibility', 'overflow', 'objectFit', 'transform',
  'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textDecorationLine',
  'padding', 'margin', 'width', 'height', 'zIndex', 'aspectRatio'
];

async function snapshotAll() {
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
  const out = {};
  for (const handle of CARDS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
    // 🔴 Force the scrollbar. A page whose height lands near the viewport's has one on some runs and
    // not on others; that is 8px of container width, which makes `margin: 0 auto` resolve to `0 4px`
    // instead of `0 0`. Two runs of an unchanged page then disagree, and a ruler that wobbles cannot
    // tell me whether a rename broke something. Waiting for images was not enough — one card sits
    // right on the boundary.
    await page.addInitScript(() => {
      const st = document.createElement('style');
      st.textContent = 'html{overflow-y:scroll!important}';
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
    });
    await page.goto(`${base}/${handle}`, { waitUntil: 'load' }).catch(() => {});
    // 🔴 Wait for every image to settle before measuring. Until they do the page is shorter, which
    // can mean no scrollbar, which means 8px more width, which makes `margin: 0 auto` resolve to
    // `0 4px` instead of `0 0`. Two runs of an unchanged page then disagree by one property, and a
    // ruler that wobbles cannot tell me whether a rename broke something.
    await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
      i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
    await page.waitForTimeout(500);
    // reveal drawers so their elements are measured too
    await page.evaluate(() => document.querySelectorAll('[data-drawer-panel]').forEach((p) => { p.style.visibility = 'visible'; }));
    out[handle] = await page.evaluate((props) => {
      const els = Array.from(document.querySelectorAll('body *'))
        .filter((el) => !['SCRIPT', 'STYLE'].includes(el.tagName));
      return els.map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const style = {};
        for (const p of props) style[p] = cs[p];
        return {
          tag: el.tagName,
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          text: (el.children.length ? '' : (el.textContent || '').trim().slice(0, 60)),
          style
        };
      });
    }, PROPS);
    await page.close();
  }
  await browser.close();
  server.close();
  return out;
}

const snap = await snapshotAll();

if (mode === 'snapshot') {
  fs.writeFileSync(FILE, JSON.stringify(snap));
  for (const h of CARDS) console.log(`${h.padEnd(10)} ${snap[h].length} elements captured`);
  console.log('→', FILE);
  process.exit(0);
}

if (mode !== 'check') { console.error('usage: rename-safety.mjs snapshot|check'); process.exit(2); }

const before = JSON.parse(fs.readFileSync(FILE, 'utf8'));
let bad = 0;
for (const h of CARDS) {
  const a = before[h], b = snap[h];
  if (a.length !== b.length) {
    console.log(`  ❌ ${h}: element count ${a.length} → ${b.length} — a rename must not add or remove elements`);
    bad++; continue;
  }
  const diffs = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].tag !== b[i].tag) diffs.push(`#${i} tag ${a[i].tag} → ${b[i].tag}`);
    if (a[i].text !== b[i].text) diffs.push(`#${i} <${a[i].tag}> text "${a[i].text}" → "${b[i].text}"`);
    if (JSON.stringify(a[i].box) !== JSON.stringify(b[i].box)) diffs.push(`#${i} <${a[i].tag}> box ${a[i].box} → ${b[i].box}`);
    for (const p of PROPS) {
      if (a[i].style[p] !== b[i].style[p]) diffs.push(`#${i} <${a[i].tag}> ${p}: ${a[i].style[p]} → ${b[i].style[p]}`);
    }
  }
  if (diffs.length) {
    bad++;
    console.log(`  ❌ ${h}: ${diffs.length} difference(s) — a rename should produce none`);
    for (const d of diffs.slice(0, 12)) console.log(`       ${d}`);
    if (diffs.length > 12) console.log(`       …and ${diffs.length - 12} more`);
  } else {
    console.log(`  ✅ ${h}: ${a.length} elements, every box and computed style identical`);
  }
}
console.log(bad ? '\n❌ this is not a pure rename' : '\n✅ names changed, nothing else did');
process.exit(bad ? 1 : 0);
