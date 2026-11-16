// The two sides of a tile in stack and list (tile#343) — asked of a real browser, because every
// question here is about boxes and paint: is all of a side's content reachable, can its words be
// read, and is anything drawn around a held tile that is not the tile.
//
// One specimen (below): a profile, a wide picture, a video, a social tile, a link, and four tiles
// whose content is LONGER than the fixed-size side — a long text on the front, many social rows on the
// front, a back that is a tall stack of tiles, a back that is a long text, a back that is a wide
// picture and more. It is opened on stack and on list, at 390 and 1280 wide, and every tile is
// measured on its front, turned over, and measured on its back.
//
//   reach     NOTHING IS CUT OFF WITHOUT A WAY TO REACH IT. For each side: every piece of content
//             (a run of text, a picture, a frame, a control) against every box that clips it — the
//             side itself (overflow: hidden, the rounded edge) and anything between. With every
//             scroller at its start nothing may lie above a clipping edge; with every scroller at
//             its end nothing may lie below one. So content that scrolls is fine, and content that
//             is centred on a side shorter than itself (cut at BOTH ends, the top unreachable) is
//             not. The numbers kept: the content's height beside the side's, and the px cut at each
//             end.
//   cue       A SIDE THAT HOLDS MORE THAN IT SHOWS SAYS SO. Where a side scrolls, the edge that
//             has more beyond it is marked (data-more on the side, drawn by the stylesheet), and
//             the mark follows the scroll: `down` at the start, `up` at the end.
//   contrast  THE BACK'S WORDS CAN BE READ. Every run of text on a back: its colour against the
//             ground actually behind it (backgrounds composited up to the first opaque one), as a
//             WCAG ratio. 4.5 for body text, 3 for large text (24 px, or 18.66 px bold).
//   around    A HELD TILE IS THE ONLY THING DRAWN IN FRONT OF THE TABLE. While a tile is turned
//             over: every box outside it that is painted (a ground, or a backdrop filter) and
//             that stops short of the window — a panel with edges of its own beside the tile.
//             The film over the rest of the pile must cover the whole window or not be there.
//
// CONTROL (must FAIL, every run): the same page with one rule put back — a back's content centred on
// its side — and `reach` must then report the long backs cut at the top. A run where the control
// passes is a ruler that cannot see the defect, and is reported as a problem of its own.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/tile-sides.mjs
//   … --full            also 1280 wide in both views with motion on (the default is sized for
//                       run-all.mjs's 90 seconds: both views at 390, stack at 1280, reduced motion)
//   … --shots <dir>     keep a picture of every side there (front-/back-<n>-<view>-<width>.png)
//   … --only a,b        just these tiles, by their name in TILES below
//   … --options <dir>   draw the ways a long side could behave (the report's pictures), then exit
//   … --dump            print every number, not only the failures
//   … --base <checkout>  measure THAT checkout instead (a worktree of main): the same specimen and rulers, served by its
//                       worker — how a defect is shown on the code that has it. Its CONTROL is not run.
//
// 🔴 What this does not show: iOS Safari. Its rubber-band and toolbar are a phone's, not this engine's.
import http from 'node:http';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { readCard, PLAYWRIGHT, PKG } from './paths.mjs';
import { pathToFileURL } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
const FULL = args.includes('--full'), DUMP = args.includes('--dump');
const BASE = opt('--base') ? resolve(opt('--base')) : '';
const workerAt = BASE ? join(BASE, 'packages/cardtile/serve/card-worker.mjs') : join(PKG, 'serve/card-worker.mjs');
if (!fs.existsSync(workerAt)) { console.log(`💥 --base ${BASE}: no packages/cardtile/serve/card-worker.mjs there`); process.exit(2); }
const worker = (await import(pathToFileURL(workerAt).href)).default;
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : '';
const OPTIONS = opt('--options') ? resolve(opt('--options')) : '';
const ONLY = opt('--only') ? opt('--only').split(',') : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
if (OPTIONS) fs.mkdirSync(OPTIONS, { recursive: true });

// ---- the specimen ----
// the wide picture is the rich specimen's own asset (300 × 220): a real image, no network. The tall one is made here
// (120 × 480, one colour): a picture taller than its side is the case "a picture fits its side by scaling" has to hold.
const ASSET = readCard('specimen-rich').split('\n').find((l) => /%% card: asset /.test(l));
const AID = /id=(\S+)/.exec(ASSET)[1];
const png = (w, h, rgb) => {
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body) >>> 0); return Buffer.concat([len, body, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const TALL = png(120, 480, [200, 90, 40]); const TID = 'sha256-' + createHash('sha256').update(TALL).digest('hex').slice(0, 16);
const TALL_ASSET = `- [ ] %% card: asset id=${TID} mime=image/png %% ${TALL.toString('base64')}`;
const para = (n) => Array.from({ length: n }, (_, i) => `\tParagraph ${i + 1} of ${n}: a side holds what it holds, and a long text is longer than the side it is printed on.`).join('\n\t\n');
/** the tiles of the specimen, in order: [name, line] — the name says what the tile is here for */
const TILES = [
  ['profile', `- [ ] %% card: profile w=6 avatar=asset:${AID} %% A profile: its back names the page and its address.`],
  ['picture', `- [ ] %% card: feature w=6 img=asset:${AID} back=#picture %% A wide picture.`],
  ['tall-picture', `- [ ] %% card: feature w=6 img=asset:${TID} %%`],
  ['video', '- [ ] %% card: video w=6 yt=aaaaaaaaaaa %% A video, with a title of its own under the picture'],
  ['social', '- [ ] %% card: social w=6 %% [Instagram](https://instagram.com/example)\n\t[YouTube](https://www.youtube.com/@example)'],
  ['tall-back', '- [ ] %% card: text w=6 back=#tall %% The back of this one is a tall stack of tiles.'],
  ['long-back', '- [ ] %% card: text w=6 back=#long %% The back of this one is a long text.'],
  ['long-front', `- [ ] %% card: text w=6 %%\n${para(18)}`],
  ['tall-front', `- [ ] %% card: social w=6 %% ${Array.from({ length: 18 }, (_, i) => `[Place ${i + 1}](https://example.com/place-${i + 1})`).join('\n\t')}`],
  ['captioned', `- [ ] %% card: feature w=6 img=asset:${AID} href=https://example.com/read %% A wide picture with words of its own, and a link to follow.`],
  ['link', '- [ ] %% card: link w=6 %% [A link](https://example.com/a)'],
];
/** the sides that hold more than they show, at both widths. A ruler that finds nothing long there has measured nothing, and says so. */
const LONG = { front: ['long-front', 'tall-front'], back: ['picture', 'tall-back', 'long-back'] };
/** sides that are not long by design and still hold more than the smallest tile shows: [tile, view, width]. Each is a
 *  measured fact about the specimen (it scrolls, with its marks, and nothing is cut), not an excuse. */
const SCROLLS_WHEN_SMALL = { front: [], back: [] };
const specimen = (view, theme) => ['---', 'card-page: sides', 'title: Specimen — the two sides of a tile', `view: ${view}`, ...(theme ? [`theme: ${theme}`] : []), '---', '', '## cards', '',
  ...TILES.map((t) => t[1]), '', '',
  '## back: picture | A picture and more', '',
  `- [ ] %% card: feature w=6 img=asset:${AID} %% A wide picture on a back.`,
  `- [ ] %% card: text %%\n${para(7)}`,
  ...Array.from({ length: 3 }, (_, i) => `- [ ] %% card: link w=6 %% [More ${i + 1}](https://example.com/more-${i + 1})`), '', '',
  '## back: tall | Eighteen tiles', '',
  ...Array.from({ length: 18 }, (_, i) => `- [ ] %% card: link w=6 %% [Tile ${i + 1} of 18](https://example.com/tile-${i + 1})`), '', '',
  '## back: long | A long text', '',
  `- [ ] %% card: text %%\n${para(20)}`, '', '',
  '## assets', '', ASSET, TALL_ASSET, ''].join('\n');
const FILES = {};
for (const v of ['stack', 'list']) for (const th of ['', 'light', 'dark']) FILES[`sides-${v}${th ? '-' + th : ''}`] = specimen(v, th);

const store = { get: async (h) => FILES[h] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };
// link marks are answered with a fixed pixel: a layout ruler must not depend on a third party
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const server = http.createServer(async (req, res) => {
  try {
    if (/^\/_icon\/[^/]+\.ico$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); return; }
    const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const URL0 = 'http://127.0.0.1:' + server.address().port;

let bad = 0; const fails = [];
const ok = (cond, msg) => { if (cond) { if (DUMP) console.log('   ✓ ' + msg); } else { console.log('   🔴 ' + msg); bad++; fails.push(msg); } return !!cond; };

const mod = await import(PLAYWRIGHT); const pw = mod.default || mod;
const browser = await pw.chromium.launch();
// every wait here is bounded, and so is the run: a browser that hangs must not outlive its harness
const DEADLINE = setTimeout(() => { console.log('💥 tile-sides: ran out of time'); browser.close().finally(() => process.exit(2)); }, FULL || SHOTS || OPTIONS ? 420_000 : 85_000);
const settle = (page, ms) => page.waitForTimeout(ms);

// ---- the rulers, in the page ----
/** measure one side of tile `i`: 'front' or 'back' */
const measureSide = (page, i, side) => page.evaluate(async ({ i, side }) => {
  const tile = [...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i);
  const pane = tile && tile.querySelector(side === 'back' ? '.deck-back' : '.deck-front');
  if (!pane) return null;
  // 🔴 Read once nothing on the side is still on its way: visibility is inherited and transitioned, so the tiles on a back
  // that has just been turned up are hidden for a beat after the side itself shows — read then, a long back was one title
  // tall (26 px) and every ruler passed on it. Bounded: two seconds, then it is read as it is (and `pieces` says what was there).
  for (const t0 = performance.now(); performance.now() - t0 < 2000;) {
    const busy = pane.getAnimations({ subtree: true }).some((a) => a.playState === 'running' && Number.isFinite(a.effect && a.effect.getComputedTiming().endTime));
    if (!busy) break; await new Promise((ok) => setTimeout(ok, 40));
  }
  const cs = (e) => getComputedStyle(e);
  // what clips: the side, and every box between a piece of content and the side that does not let its overflow show
  const clipsY = (e) => { const o = cs(e).overflowY; return o !== 'visible'; };
  const scrollers = [pane, ...pane.querySelectorAll('*')].filter((e) => /auto|scroll/.test(cs(e).overflowY) && e.scrollHeight > e.clientHeight + 1);
  // the pieces of content: runs of text, and the boxes that are content in themselves
  const pieces = [];
  const tw = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.nodeValue.trim()) continue; const p = n.parentElement; if (!p || cs(p).visibility === 'hidden' || cs(p).display === 'none' || p.closest('style,script,template')) continue; pieces.push({ n, el: p, text: true }); }
  for (const e of pane.querySelectorAll('img,svg,iframe,canvas,video,button,input,select,textarea,.qr')) { if (e.closest('.tile-more') || e.closest('svg') && e.closest('svg') !== e) continue;   /* (a side's own marks are not what it holds) */ const r = e.getBoundingClientRect(); if (r.width && r.height && cs(e).visibility !== 'hidden') pieces.push({ n: e, el: e, text: false }); }
  const rectOf = (p) => { if (!p.text) return p.n.getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(p.n); return r.getBoundingClientRect(); };
  const clippersOf = (el) => { const out = []; for (let e = el.parentElement; e; e = e.parentElement) { if (clipsY(e)) out.push(e); if (e === pane) break; } if (el === pane) out.push(pane); return out; };
  const name = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const pass = (end) => {   // end: 'start' | 'end' — every scroller there; the worst cut at that end of any piece
    for (const s of scrollers) s.scrollTop = end === 'start' ? 0 : s.scrollHeight;
    let worst = 0, who = '', lo = Infinity, hi = -Infinity, side = 0, sideWho = '';
    for (const p of pieces) { const r = rectOf(p); if (!r.width && !r.height) continue; lo = Math.min(lo, r.top); hi = Math.max(hi, r.bottom);
      const what = () => (p.text ? JSON.stringify(p.n.nodeValue.trim().slice(0, 28)) : name(p.n));
      for (const c of clippersOf(p.el)) { const b = c.getBoundingClientRect(); const cut = end === 'start' ? b.top - r.top : r.bottom - b.bottom; if (cut > worst) { worst = cut; who = what() + ' under ' + name(c); }
        // …and sideways, where nothing scrolls: a piece past a clipping box's left or right edge is cut for good (a box that
        // scrolls sideways itself — a block of code — is let be)
        if (c.scrollWidth <= c.clientWidth + 1 || !/auto|scroll/.test(cs(c).overflowX)) { const sx = Math.max(b.left - r.left, r.right - b.right); if (sx > side) { side = sx; sideWho = what() + ' under ' + name(c); } } } }
    return { worst: Math.round(worst * 10) / 10, who, lo, hi, side: Math.round(side * 10) / 10, sideWho };
  };
  // the marks: which of the side's two (up, down) is drawn — has a box inside the side, is visible, and is not see-through
  const marks = () => { const fr = pane.getBoundingClientRect(); const out = {};
    for (const m of pane.querySelectorAll('.tile-more')) { const s = cs(m), r = (m.firstElementChild || m).getBoundingClientRect(); const on = r.width > 8 && r.height > 8 && s.visibility !== 'hidden' && +s.opacity > 0.5 && r.top >= fr.top - 1 && r.bottom <= fr.bottom + 1;
      out[m.dataset.to || '?'] = on ? (r.top + r.height / 2 < fr.top + fr.height / 2 ? 'top' : 'bottom') : ''; }
    return out; };
  // (the mark is set on the scroll event, and fades: each end is read after it has had its turn)
  const turn = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 260))));
  const a = pass('start');
  // (a side that does not scroll has one end, and no mark to wait for: two frames, not two fades)
  const beat = () => (scrollers.length ? turn() : new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  return beat().then(() => { const more0 = pane.getAttribute('data-more') || '', marks0 = marks();
    const b = pass('end'); const scrolled = scrollers.map((s) => Math.round(s.scrollTop));
    return beat().then(() => { const more1 = pane.getAttribute('data-more') || '', marks1 = marks();
      for (const s of scrollers) s.scrollTop = 0;
      const fr = pane.getBoundingClientRect();
      // how tall the content is, laid end to end: from its first edge at the start to its last edge at the end, plus what was scrolled
      const content = Math.round((b.hi - a.lo) + Math.max(0, ...scrolled));
      return { height: Math.round(fr.height), width: Math.round(fr.width), content, cutTop: a.worst, cutTopWho: a.who, cutBottom: b.worst, cutBottomWho: b.who, cutSide: Math.max(a.side, b.side), cutSideWho: a.side >= b.side ? a.sideWho : b.sideWho,
        scrollers: scrollers.map(name), scrolls: scrollers.length > 0, moreAtStart: more0, moreAtEnd: more1, marksAtStart: marks0, marksAtEnd: marks1, pieces: pieces.length,
        state: `tile "${tile.className}", side visibility ${cs(pane).visibility}, display ${cs(pane).display}, the tile up is ${window.__deckCur ? window.__deckCur() : '?'}` }; }); });
}, { i, side });

/** every run of text on the held tile's back: colour against the ground behind it */
const contrastOf = (page, i) => page.evaluate((i) => {
  const tile = [...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i);
  const pane = tile && tile.querySelector('.deck-back'); if (!pane) return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((k) => top[k] * a + under[k] * (1 - a)).concat(1); };   // premultiplied by canvas already un-done: straight alpha
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  // the ground behind an element: backgrounds from it outwards, composited until one is opaque. The side is the last word
  // (a tile keeps its shape: what is behind the side is not behind its text) — if even the side is not opaque, that is said.
  const ground = (el) => { const layers = []; let opaque = false; for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 0.999) { opaque = true; break; } } if (e === pane) break; }
    let base = opaque ? layers.pop() : [255, 255, 255, 1]; for (let k = layers.length - 1; k >= 0; k--) base = over(layers[k], base); return { c: base, opaque }; };
  const K = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--deck-k')) || 1;
  const out = []; const tw = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.nodeValue.trim()) continue; const p = n.parentElement; const s = getComputedStyle(p); if (s.visibility === 'hidden' || s.display === 'none' || p.closest('style,script,template')) continue;
    const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect(); if (!b.width || !b.height) continue;
    // words laid over a picture (a caption on its scrim) stand on the picture, which no colour here describes: named, not judged
    const meets = (k) => { const q = k.getBoundingClientRect(); return q.left < b.right && q.right > b.left && q.top < b.bottom && q.bottom > b.top; };
    let overPicture = false; for (let e = p; e && e !== pane && !overPicture; e = e.parentElement) overPicture = getComputedStyle(e).backgroundImage !== 'none' || [...e.children].some((k) => /^(IMG|PICTURE|VIDEO|CANVAS)$/.test(k.tagName) && meets(k));
    if (overPicture) { out.push({ overPicture, text: n.nodeValue.trim().slice(0, 32), opaque: true, ratio: 0, need: 0 }); continue; }
    const gr = ground(p); let ink = rgba(s.color); ink = over(ink, gr.c); const L1 = lum(ink), L2 = lum(gr.c); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize) * K, bold = +s.fontWeight >= 700; const large = px >= 24 || (px >= 18.66 && bold);   // as drawn: what a side holds is zoomed by --deck-k
    // a control that paints a ground of its own (the accent pill): its label stands on the accent the owner chose
    let onControl = false; for (let e = p; e && e !== pane; e = e.parentElement) { if (/^(A|BUTTON)$/.test(e.tagName) && rgba(getComputedStyle(e).backgroundColor)[3] >= 0.999) { onControl = true; break; } }
    out.push({ onControl, text: n.nodeValue.trim().slice(0, 32), cls: (p.className && typeof p.className === 'string' ? p.className : p.tagName.toLowerCase()) + ' in ' + ((p.parentElement || {}).className || ''), ratio: Math.round(ratio * 100) / 100, need: large ? 3 : 4.5, ink: s.color, ground: 'rgb(' + gr.c.slice(0, 3).map(Math.round).join(',') + ')', opaque: gr.opaque, px: Math.round(px * 10) / 10 }); }
  return out;
}, i);

/** while a tile is held: every painted box outside it that stops short of the window */
const panelsAround = (page, i) => page.evaluate((i) => {
  const tile = [...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i);
  // the window, less a scrollbar's gutter (a classic scrollbar keeps its strip; nothing is drawn there)
  // 🔴 "The window" is what a fixed box with inset 0 covers — asked of the browser, not assumed. With a classic scrollbar
  // the page keeps its gutter while a tile is held (scrollbar-gutter: stable), and nothing fixed can be drawn in that strip.
  const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none'; document.body.appendChild(probe);
  const pr = probe.getBoundingClientRect(); probe.remove();
  const W = pr.right, H = pr.bottom, out = [];
  const cardR = tile.querySelector('.deck-back').getBoundingClientRect();
  for (const e of document.querySelectorAll('body *')) {
    if (tile.contains(e) || e.closest('.deck-card,.deck-bar,footer,.deck-bench,dc-dock,script,style,template')) continue;
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) continue;
    if (/blur\(/.test(s.filter)) continue;   // a shadow (the ground shadow under the held tile): blurred itself, it has no edge
    const bf = s.backdropFilter && s.backdropFilter !== 'none' ? s.backdropFilter : (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none' ? s.webkitBackdropFilter : '');
    const m = /rgba?\(([^)]+)\)/.exec(s.backgroundColor); const alpha = m ? (m[1].split(/[,/]/).length > 3 ? parseFloat(m[1].split(/[,/]/)[3]) : 1) : (/^(transparent)$/.test(s.backgroundColor) ? 0 : 1);
    if (!bf && !(alpha > 0) && s.backgroundImage === 'none') continue;
    let p = e, hidden = false; for (; p; p = p.parentElement) { const ps = getComputedStyle(p); if (ps.display === 'none' || ps.visibility === 'hidden' && p !== e || +ps.opacity === 0) { hidden = true; break; } } if (hidden) continue;
    const r = e.getBoundingClientRect(); const x0 = Math.max(0, r.left), x1 = Math.min(W, r.right), y0 = Math.max(0, r.top), y1 = Math.min(H, r.bottom);
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;   // not in the window
    const covers = r.left <= 0.5 && r.top <= 0.5 && r.right >= W - 0.5 && r.bottom >= H - 0.5; if (covers) continue;
    // an edge of its own inside the window, beside the held tile (not hidden behind it)
    const behind = r.left >= cardR.left - 0.5 && r.right <= cardR.right + 0.5 && r.top >= cardR.top - 0.5 && r.bottom <= cardR.bottom + 0.5; if (behind) continue;
    out.push({ el: e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\s+/).join('.'), box: [r.left, r.top, r.right, r.bottom].map(Math.round), radius: s.borderTopLeftRadius, backdrop: bf, ground: s.backgroundColor, card: [cardR.left, cardR.top, cardR.right, cardR.bottom].map(Math.round) });
  }
  return { W, H, panels: out };
}, i);

const SIZES = { 390: { width: 390, height: 844 }, 1280: { width: 1280, height: 800 } };
const plan = FULL || SHOTS ? [['stack', 390], ['list', 390], ['stack', 1280], ['list', 1280]] : [['stack', 390], ['list', 390], ['list', 1280]];
const MOTION = FULL || !!SHOTS;   // with motion, a turn takes its 620 ms; the rulers read layout, which does not move with it

/** one page of the specimen: every tile's front, then its back */
async function walk(view, width, o = {}) {
  const ctx = await browser.newContext({ viewport: SIZES[width], deviceScaleFactor: 1, reducedMotion: MOTION ? 'no-preference' : 'reduce', hasTouch: width < 600, isMobile: false });
  const page = await ctx.newPage(); page.setDefaultTimeout(15_000);
  await page.route((u) => !String(u).startsWith(URL0), (r) => r.abort());   // nothing here depends on a third party (a video's poster, a font)
  await page.goto(`${URL0}/sides-${view}${o.theme ? '-' + o.theme : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__deckBoot === 'ready' && window.__deckJump, null, { timeout: 15_000 });
  if (o.css) await page.addStyleTag({ content: o.css });
  await settle(page, MOTION ? 1500 : 400);
  // the pile holds the specimen's tiles, in its order: every measurement below names a tile by its place
  const n = await page.evaluate(() => window.__deckCount());
  ok(n === TILES.length, `${view} ${width}: the pile has the specimen's ${TILES.length} tiles (${n})`);
  const rows = [];
  for (let i = 0; i < TILES.length; i++) {
    const name = TILES[i][0]; if ((ONLY || o.only) && !(ONLY || o.only).includes(name)) continue;
    await page.evaluate((i) => window.__deckJump(i), i);
    // 🔴 Waited for, not slept through: a side's visibility follows its tile a quarter of a second late (deck.css: the side's
    // own transition), so a front read 200 ms after the jump is a side with nothing visible on it — and every ruler passes.
    row0: { const up = await page.waitForFunction((i) => { const c = [...document.querySelectorAll('.deck-card')].find((k) => +k.dataset.i === i), f = c && c.querySelector('.deck-front');
      return !!f && !c.classList.contains('flipped') && getComputedStyle(f).visibility === 'visible'; }, i, { timeout: 8000 }).then(() => true, () => false);
      ok(up, `${view} ${width} · ${name}: the tile came up, front showing`); }
    await settle(page, MOTION ? 900 : 120);
    const row = { name, view, width, front: await measureSide(page, i, 'front') };
    if (o.shots) { await settle(page, 350); await page.screenshot({ path: join(o.shots, `${o.tag || ''}front-${i}-${name}-${view}-${width}.png`) }); }
    if (o.shots && row.front && row.front.scrolls) {   // …and the far end of a front that scrolls
      await page.evaluate((i) => { const f = [...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i).querySelector('.deck-front'); f.scrollTop = f.scrollHeight; }, i); await settle(page, 400);
      await page.screenshot({ path: join(o.shots, `${o.tag || ''}front-${i}-${name}-${view}-${width}-end.png`) });
      await page.evaluate((i) => { [...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i).querySelector('.deck-front').scrollTop = 0; }, i);
    }
    const hasBack = await page.evaluate((i) => !![...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i)?.querySelector('.deck-back'), i);
    if (hasBack) {
      await page.evaluate((i) => window.__deckJump(i, { open: true }), i);
      // 🔴 Waited for, not slept through: the back is on show when the page is `open`, the tile is flipped and the back's own
      // visibility has switched (it does so a quarter of a second into the turn). Measured before that, a back has no visible
      // content and every ruler here passes on nothing — on a loaded machine a fixed sleep did exactly that.
      row.open = await page.waitForFunction((i) => { const c = [...document.querySelectorAll('.deck-card')].find((k) => +k.dataset.i === i), b = c && c.querySelector('.deck-back');
        // (with reduced motion there is no turn to end, and the class that names the turn stays on the card: the back's own visibility is the answer)
        return !!b && document.documentElement.classList.contains('open') && c.classList.contains('flipped') && (!c.classList.contains('flipping-open') || matchMedia('(prefers-reduced-motion: reduce)').matches) && getComputedStyle(b).visibility === 'visible'; }, i, { timeout: 8000 }).then(() => true, () => false);
      await settle(page, MOTION ? 300 : 120);
      row.back = await measureSide(page, i, 'back');
      row.contrast = await contrastOf(page, i);
      row.around = await panelsAround(page, i);
      if (o.shots) { await settle(page, 350); await page.screenshot({ path: join(o.shots, `${o.tag || ''}back-${i}-${name}-${view}-${width}.png`) }); }   // (the marks fade: the picture is taken once they have)
      if (o.shots && row.back && row.back.scrolls) {   // …and the far end of a back that scrolls
        await page.evaluate((i) => { const f = [...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i).querySelector('.deck-back'); for (const e of [f, ...f.querySelectorAll('*')]) if (e.scrollHeight > e.clientHeight + 1) e.scrollTop = e.scrollHeight; }, i); await settle(page, 400);
        await page.screenshot({ path: join(o.shots, `${o.tag || ''}back-${i}-${name}-${view}-${width}-end.png`) });
      }
      await page.keyboard.press('Escape'); await settle(page, MOTION ? 800 : 200);
      if (await page.evaluate(() => document.documentElement.classList.contains('open'))) { await page.evaluate(() => document.querySelector('.deck-close').click()); await settle(page, MOTION ? 800 : 200); }
    }
    rows.push(row);
  }
  await ctx.close();
  return rows;
}

const fmtSide = (f) => f ? `content ${f.content} px on a ${f.height} px side · cut ${f.cutTop} px at the top, ${f.cutBottom} px at the bottom, ${f.cutSide} px sideways${f.scrolls ? ' · scrolls' : ''}${f.moreAtStart || f.moreAtEnd ? ` · more: "${f.moreAtStart}" → "${f.moreAtEnd}"` : ''}` : 'no such side';
const judge = (rows, o = {}) => {
  for (const r of rows) {
    const at = `${r.view} ${r.width} · ${r.name}`;
    for (const side of ['front', 'back']) { const f = r[side]; if (!f) continue;
      if (DUMP || o.say) console.log(`   · ${at} ${side}: ${fmtSide(f)}`);
      // (a side with nothing on it to measure is a ruler laid on nothing: every line below would pass)
      if (!ok(f.pieces > 0, `${at} ${side}: the side has content to measure (${f.pieces} pieces; ${f.state})`)) continue;
      ok(f.cutTop <= 1, `${at} ${side}: nothing is cut at the top (${f.cutTop} px of ${f.cutTopWho || '—'}; ${fmtSide(f)})`);
      ok(f.cutBottom <= 1, `${at} ${side}: nothing is cut at the bottom (${f.cutBottom} px of ${f.cutBottomWho || '—'}; ${fmtSide(f)})`);
      ok(f.cutSide <= 1, `${at} ${side}: nothing is cut sideways (${f.cutSide} px of ${f.cutSideWho || '—'})`);
      const drawn = (m) => JSON.stringify(m || {});
      if (LONG[side].includes(r.name)) ok(f.content > f.height && f.scrolls, `${at} ${side}: this side holds more than it shows, and scrolls (content ${f.content} px, side ${f.height} px, scrollers: ${f.scrollers.join(', ') || 'none'})`);
      // …and a side whose content fits does NOT scroll: a fix that made every side a scroller (a tile that no longer fits
      // its picture or its frame to its box) would pass every line above. Listed, so a new long tile has to be named.
      else if (!(SCROLLS_WHEN_SMALL[side] || []).some(([n, v, w]) => n === r.name && v === r.view && w === r.width)) ok(!f.scrolls, `${at} ${side}: this side holds no more than it shows, and does not scroll (content ${f.content} px, side ${f.height} px, scrollers: ${f.scrollers.join(', ') || 'none'})`);
      // a picture taller than its side is made to fit, whole: it is not a reason to scroll
      if (side === 'front' && r.name === 'tall-picture') ok(!f.scrolls && f.content <= f.height, `${at} front: a picture taller than its side fits it whole, and the side does not scroll (content ${f.content} px, side ${f.height} px)`);
      if (f.scrolls) { ok(f.moreAtStart === 'down', `${at} ${side}: a side that scrolls says there is more below, at the start (data-more="${f.moreAtStart}", want "down")`);
        ok(f.marksAtStart.down === 'bottom' && !f.marksAtStart.up, `${at} ${side}: …and draws that mark at its bottom edge, and no other (${drawn(f.marksAtStart)})`);
        ok(f.moreAtEnd === 'up', `${at} ${side}: at the end it says there is more above (data-more="${f.moreAtEnd}", want "up")`);
        ok(f.marksAtEnd.up === 'top' && !f.marksAtEnd.down, `${at} ${side}: …and draws that mark at its top edge, and no other (${drawn(f.marksAtEnd)})`); }
      else { ok(!f.moreAtStart, `${at} ${side}: a side that shows everything marks nothing (data-more="${f.moreAtStart}")`);
        ok(!f.marksAtStart.down && !f.marksAtStart.up, `${at} ${side}: …and draws no mark (${drawn(f.marksAtStart)})`); }
    }
    if (r.back) {
      ok(r.open, `${at}: the tile turned over`);
      // 🔴 Words on the side's own ground are held to WCAG AA (4.5, or 3 for large text). A label on a control that paints
      // its own ground — the accent pill — stands on the accent the owner chose: it is held to 3 (the floor for a control)
      // and its number is printed every run, because white on the default accent is 4.07:1 and that is the palette's to
      // answer (colour.mjs), not this stylesheet's.
      const low = (r.contrast || []).filter((c) => !c.overPicture && c.ratio < (c.onControl ? 3 : c.need));
      if (DUMP || o.say) for (const c of r.contrast || []) console.log(c.overPicture ? `   · ${at} back text ${JSON.stringify(c.text)} lies over a picture: not judged` : `   · ${at} back text ${JSON.stringify(c.text)} [${c.cls}] ${c.ratio}:1 (needs ${c.onControl ? '3, on a control' : c.need}) ${c.ink} on ${c.ground}${c.opaque ? '' : ' (no opaque ground)'} ${c.px}px`);
      ok((r.contrast || []).some((c) => !c.overPicture), `${at} back: it has words to measure`);
      for (const c of (r.contrast || []).filter((c) => c.onControl && c.ratio < 4.5).slice(0, 1)) console.log(`   ⚠ ${at} back: a control's label is ${c.ratio}:1 on its own ground (${c.ink} on ${c.ground}) — above the floor of 3, below 4.5`);
      ok(!low.length, `${at} back: every run of text reaches its contrast (${low.length} below: ${low.slice(0, 3).map((c) => `${JSON.stringify(c.text)} ${c.ratio}:1 < ${c.onControl ? 3 : c.need} [${c.cls}] ${c.ink} on ${c.ground}`).join('; ')})`);
      ok((r.contrast || []).every((c) => c.opaque), `${at} back: its words stand on a ground of the side's own`);
      const p = r.around.panels;
      ok(!p.length, `${at}: nothing with edges of its own is drawn beside the held tile (${p.length}: ${p.slice(0, 2).map((x) => `${x.el} box ${x.box.join(',')} in a ${r.around.W}×${r.around.H} window, corners ${x.radius}, ${x.backdrop || x.ground}; the tile is ${x.card.join(',')}`).join('; ')})`);
    }
  }
};

if (OPTIONS) {
  // the ways a long side could behave, drawn on the two long backs and the long front (the report's pictures; nothing is judged)
  // 🔴 These are SKETCHES, laid over whatever stylesheet this checkout has by a <style> added to the page: they show what each
  // way looks like on the specimen, not how it is built. Kept so the pictures in the decision can be drawn again.
  const PILL = 'position:absolute;left:50%;bottom:12px;width:34px;height:34px;margin-left:-17px;border-radius:50%;display:grid;place-items:center;font:600 20px/1 system-ui;color:var(--cp-accent);background:color-mix(in srgb,var(--cp-ground) 80%,transparent);border:1px solid color-mix(in srgb,var(--cp-accent) 35%,transparent);pointer-events:none';
  const OPT = {
    // A: the side scrolls; content that fits is centred as before, content that does not starts at the top; a mark where there is more
    'A-scroll-from-top': `html.deck .deck-back-scroll{justify-content:flex-start!important}html.deck .deck-back .dc-drawer-body{justify-content:flex-start!important;min-height:0!important}html.deck .deck-front{overflow-y:auto!important}html.deck .deck-front > .st-cell{min-height:auto!important;flex:1 0 auto!important}html.deck .deck-face::after{content:"\\2193";${PILL}}`,
    // B: the content is made smaller until it fits (set by script below)
    'B-shrink-to-fit': 'html.deck .deck-back-scroll{justify-content:flex-start!important}html.deck .deck-back .dc-drawer-body{justify-content:flex-start!important;min-height:0!important}html.deck .deck-front > .st-cell{justify-content:flex-start!important}',
    // C: the content starts at the top and is cut at the bottom; the rest is somewhere else (the wall, or a sheet), behind a control
    'C-cut-with-a-way-on': `html.deck .deck-back-scroll{justify-content:flex-start!important;overflow:hidden!important}html.deck .deck-back .dc-drawer-body{justify-content:flex-start!important;min-height:0!important}html.deck .deck-front > .st-cell{justify-content:flex-start!important;overflow:hidden!important}html.deck .deck-face::before{content:"";position:absolute;left:0;right:0;bottom:0;height:96px;pointer-events:none;background:linear-gradient(transparent,var(--cp-ground) 70%)}html.deck .deck-face::after{content:"\\2026";${PILL};width:56px;margin-left:-28px;border-radius:999px}`,
  };
  for (const [k, css] of Object.entries(OPT)) {
    const ctx = await browser.newContext({ viewport: SIZES[390], deviceScaleFactor: 2, reducedMotion: 'reduce' }); const page = await ctx.newPage();
    await page.route((u) => !String(u).startsWith(URL0), (r) => r.abort());
    await page.goto(`${URL0}/sides-stack`, { waitUntil: 'load' }); await page.waitForFunction(() => window.__deckBoot === 'ready'); if (css) await page.addStyleTag({ content: css });
    for (const [name, back] of [['long-back', true], ['picture', true], ['long-front', false]]) {
      const i = TILES.findIndex((t) => t[0] === name);
      await page.evaluate(({ i, back }) => window.__deckJump(i, { open: back }), { i, back }); await settle(page, 500);
      if (k.startsWith('B')) await page.evaluate(({ i, back }) => { const f = [...document.querySelectorAll('.deck-card')].find((c) => +c.dataset.i === i).querySelector(back ? '.deck-back' : '.deck-front'); const box = back ? f.querySelector('.deck-back-scroll') : f.firstElementChild; const inner = back ? box.firstElementChild : box; box.style.justifyContent = 'flex-start'; box.style.overflow = 'hidden'; if (back) inner.style.minHeight = '0';
        // one uniform scale, from the top: the whole of the content, as tall as the room there is for it
        const s = getComputedStyle(box); const room = box.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
        const kids = back ? [inner] : [...box.children]; const tall = kids.reduce((h, k) => h + Math.max(k.offsetHeight, k.scrollHeight), 0) + (kids.length - 1) * (parseFloat(s.rowGap) || 0);
        const k = Math.min(1, room / tall); let y = 0; for (const el of kids) { el.style.transformOrigin = '50% 0'; el.style.transform = `translateY(${-y * (1 - k)}px) scale(${k})`; y += Math.max(el.offsetHeight, el.scrollHeight) + (parseFloat(s.rowGap) || 0); } }, { i, back });
      await settle(page, 200); await page.screenshot({ path: join(OPTIONS, `${k}-${name}.png`) });
      if (back) { await page.keyboard.press('Escape'); await settle(page, 300); }
    }
    await ctx.close();
  }
  console.log(`✅ the options are drawn in ${OPTIONS} (pictures only: nothing was judged)`);
  clearTimeout(DEADLINE); await browser.close(); server.close(); process.exit(0);
}

console.log(`tile-sides${BASE ? ' on --base ' + BASE : ''}: every tile of the specimen, front and back — ${plan.map((p) => p.join(' ')).join(', ')}${MOTION ? '' : ' (reduced motion)'}`);
for (const [view, width] of plan) {
  console.log(` ${view} at ${width}`);
  judge(await walk(view, width, { shots: SHOTS }), {});
}
// a profile's back (the page's name and address), on light Cards and on dark (the default follows the visitor's system: light here)
for (const theme of ['light', 'dark']) {
  console.log(` stack at 390, theme: ${theme} (the profile's back)`);
  judge(await walk('stack', 390, { theme, only: ['profile', 'tall-back'], shots: SHOTS, tag: theme + '-' }), {});
}

// CONTROL: a back's content centred on its side again — the long backs must be reported cut at the top
if (!BASE) { console.log(' CONTROL — a back centred on its side (must FAIL)');
  const was = bad, wasFails = fails.length;
  // what the stylesheet did: the side clips, the box inside it is exactly as tall as the side and scrolls, and centres what it holds
  const rows = await walk('stack', 390, { only: ['long-back'], css: 'html.deck .deck-face{overflow:hidden!important}html.deck .deck-back-scroll{flex:0 1 auto!important;height:100%!important;overflow:auto!important;justify-content:center!important}' });
  const row = rows.find((r) => r.name === 'long-back'); const f = row && row.back; const seen = !!f && f.pieces > 0 && f.cutTop > 1;
  bad = was; fails.length = wasFails;
  if (seen) console.log(`   ✓ the control is seen: ${f.cutTop} px cut at the top (${fmtSide(f)})`);
  else { console.log(`   🔴 the control was NOT seen — the ruler cannot see a centred, clipped back (${fmtSide(f)})`); bad++; }
}

clearTimeout(DEADLINE); await browser.close(); server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ every side shows or reaches all it holds, its back can be read, and a held tile stands alone');
process.exit(bad ? 1 : 0);
