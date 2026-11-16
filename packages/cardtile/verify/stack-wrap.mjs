// The first card peeks under the last, and a tap on it goes back to the start (tile#345) — asked of
// a real browser, because the unit suite (w3/deck-views.test.mjs, "tile#345") runs the deck in a
// stand-in DOM with no layout, no paint and no animations. What only a browser can say:
//
//   edge      at the last card, the first card is drawn under it AND a point of it shows past the top
//             card (document.elementFromPoint answers the first card there): the peek is visible and
//             hittable, not only a class. Its size is printed (px of edge past the top card).
//   tap       a real pointer (a mouse click; on the phone arm a touchscreen tap) on that point: the
//             deck walks back to the first card and the page is at its top.
//   phone     🔴 NOTED, not judged: on a phone the peek is a sliver (8 / 8 / 12 px past the top card at
//             390 px wide — the next card's resting pose, the prototype's too). Nine points on it are
//             tapped once each, and which card the browser handed the pointerdown to is printed:
//             Chromium's touch adjustment hands some of them to the TOP card, which then turns over.
//   motion    every frame of the walk back: which card is up, and the animation each travelling card
//             runs, with its computed duration and easing, against the deck prototype's values —
//               first card to rise   deck-from-back-side-1  .36s cubic-bezier(.3,0,.6,1)  (--fdir 1)
//                                    deck-from-back-side-2  .3s  cubic-bezier(.3,0,.7,1)
//               every other card     deck-from-back-1       .36s cubic-bezier(.3,0,.6,1)
//                                    deck-from-back-2       .3s  cubic-bezier(.3,0,.7,1)
//               pace                 one card per 120 ms (deck.js run(): `let wait=120`)
//             The pace is printed as the median gap between the frames where the top card changed.
//   reduced   prefers-reduced-motion: the tap goes back with no card travelling and no animation.
//   linear    at the last card, ArrowRight, End and a wheel past the end leave the last card up: only
//             the tap goes round.
//   long      a Card of 21 cards: what the tap does there. 🔴 NOTED, not judged: past JUMP (12 cards)
//             the deck jumps instead of walking — the prototype does the same (its sync() has the
//             same JUMP), so the walk-back is a short Card's motion only.
//
// The page is the Worker's own renderCardHTML; /_deck/ is answered by the Worker, so the deck is the
// GENERATED bundle (serve/deck-assets.mjs), the bytes production serves.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/stack-wrap.mjs
import http from 'node:http';
import fs from 'node:fs';
import { join } from 'node:path';
import { PLAYWRIGHT, OUT } from './paths.mjs';
import worker, { renderCardHTML } from '../serve/card-worker.mjs';

const SHOTS = join(OUT, 'stack-wrap'); fs.mkdirSync(SHOTS, { recursive: true });
const md = (n) => ['---', 'card-page: wrap', 'title: Specimen — the first card under the last', 'view: stack', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% The first card.',
  ...Array.from({ length: n - 1 }, (_, i) => `- [ ] %% card: text w=6 %% Card ${i + 2}.`), ''].join('\n');
// the reef.cards card as the last card, both ways a page can have one, and a page with none
const PAGES = { none: [md(5), {}], deck: [md(5), { deck: { pool: true } }], renderer: [md(5), { pool: true }], long: [md(21), {}] };
const store = { get: async () => null, async getWithMetadata() { return { value: null, metadata: null }; } };
const server = http.createServer(async (req, res) => {
  try {
    const page = PAGES[req.url.slice(1)];
    if (page) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderCardHTML(page[0], { handle: 'wrap', ...page[1] })); return; }
    const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = 'http://127.0.0.1:' + server.address().port;

const mod = await import(PLAYWRIGHT); const pw = mod.default || mod;
const browser = await pw.chromium.launch();
console.log(`stack-wrap: chromium ${browser.version()}`);
let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '   ✓ ' : '   🔴 ') + msg); if (!cond) bad++; return !!cond; };
const note = (msg) => console.log('   ⚠ ' + msg);

const DEVICES = {
  desktop: { viewport: { width: 900, height: 800 } },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const EXPECT = {
  'deck-from-back-side-1': ['0.36s', 'cubic-bezier(0.3, 0, 0.6, 1)'], 'deck-from-back-side-2': ['0.3s', 'cubic-bezier(0.3, 0, 0.7, 1)'],
  'deck-from-back-1': ['0.36s', 'cubic-bezier(0.3, 0, 0.6, 1)'], 'deck-from-back-2': ['0.3s', 'cubic-bezier(0.3, 0, 0.7, 1)'],
};

async function arm(name, { page, device = 'desktop', reduced = false }) {
  console.log(`\n── ${name}  (/${page}, ${device}${reduced ? ', reduced motion' : ''})`);
  const ctx = await browser.newContext({ ...DEVICES[device], ...(reduced ? { reducedMotion: 'reduce' } : {}) });
  const pg = await ctx.newPage();
  const errors = []; pg.on('pageerror', (e) => errors.push(e.message));
  try {
    await pg.goto(BASE + '/' + page); await pg.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }); await pg.waitForTimeout(1500);
    const N = await pg.evaluate(() => window.__deckCount());
    await pg.evaluate((n) => window.__deckJump(n - 1), N); await pg.waitForTimeout(1200);
    // edge: the first card under the last, and a point of it past the top card
    if (device === 'desktop') { const b = await pg.evaluate(() => { const r = document.querySelector('.deck-stack').getBoundingClientRect(); return [r.right, r.top + r.height / 2]; }); await pg.mouse.move(b[0] + 20, b[1]); await pg.waitForTimeout(700); }   // a mouse comes from somewhere: over the peek, where a visitor's would be
    const edge = await pg.evaluate(() => {
      const c = document.querySelector('.deck-card[data-i="0"]'), top = document.querySelector('.deck-card.is-top'); if (!c || !top) return null;
      const r = c.getBoundingClientRect(), t = top.getBoundingClientRect(); const pts = [];
      // how far a point is from the top card's box: where a finger is least likely to be read as a tap on the top card
      const off = (x, y) => Math.max(t.left - x, x - t.right, t.top - y, y - t.bottom);
      for (let y = Math.floor(r.top); y < r.bottom; y += 2) for (let x = Math.floor(r.left); x < r.right; x += 2) { const e = document.elementFromPoint(x, y); if (e && e.closest('.deck-card') === c) pts.push([x, y, off(x, y)]); }
      const hit = pts.length ? pts.reduce((a, b) => (b[2] > a[2] ? b : a)) : null;
      return { cls: c.className, top: +top.dataset.i, hit, pts: pts.length ? Array.from({ length: 8 }, (_, k) => pts[Math.floor(k * (pts.length - 1) / 7)]) : [], px: pts.length * 4, past: [Math.round(t.left - r.left), Math.round(r.right - t.right), Math.round(r.bottom - t.bottom)] };
    });
    await pg.screenshot({ path: join(SHOTS, `${name}-last.png`) });
    ok(edge && edge.top === N - 1, `the last card (${N - 1}) is up`);
    ok(edge && /\bis-next1\b/.test(edge.cls) && /\bwrap\b/.test(edge.cls), `the first card is under it: "${edge && edge.cls}"`);
    ok(edge && edge.hit, `the first card shows past the top card: ~${edge && edge.px} px² of it answers elementFromPoint (left/right/bottom past the top card: ${edge && edge.past.join('/')} px); tapped ${edge && edge.hit ? Math.round(edge.hit[2]) : '—'} px outside the top card`);
    if (!edge || !edge.hit) return;
    let at = edge.hit;
    // 🔴 NOTED, not judged: on a phone the peek is the next card's resting pose — a sliver a few px past the top card, the
    // same pose as the prototype's. The browser may hand a tap there to the TOP card (Chromium's touch adjustment moves the
    // tap onto a nearby box that answers clicks; the top card then turns over). Eight points spread over the visible edge,
    // and the one farthest from the top card, are each tapped once: which card the pointerdown went to, and whether the
    // deck went back, is printed. The motion below is then judged from a point the browser did hand to the first card.
    if (device === 'phone') {
      await pg.evaluate(() => { window.__pd = []; document.addEventListener('pointerdown', (e) => window.__pd.push(((e.target.closest && e.target.closest('.deck-card')) || { dataset: {} }).dataset.i), true); });
      const where = []; let back = 0; at = null;
      for (const p of [...edge.pts, edge.hit]) {
        await pg.evaluate((n) => window.__deckJump(n - 1), N); await pg.waitForTimeout(900); await pg.evaluate(() => { window.__pd.length = 0; });
        await pg.touchscreen.tap(p[0], p[1]); await pg.waitForTimeout(reduced ? 300 : 1500);
        const c = await pg.evaluate(() => window.__deckCur()), to = await pg.evaluate(() => window.__pd.join(','));
        if (c === 0) { back++; if (!at) at = p; }
        where.push(`${Math.round(p[2])}px→card ${to || '?'}:${c === 0 ? 'back' : 'stayed'}`);
      }
      note(`a tap went back from ${back} of ${edge.pts.length + 1} points on the visible edge (px outside the top card → the card the pointerdown went to: ${where.join('  ')})`);
      if (!ok(at, 'a tap somewhere on the visible edge reaches the first card')) return;
      await pg.evaluate((n) => window.__deckJump(n - 1), N); await pg.waitForTimeout(1200);
    }
    // the walk, frame by frame
    await pg.evaluate(() => { const t0 = performance.now(); window.__tl = []; const f = () => { const top = document.querySelector('.deck-card.is-top');
      const tr = [...document.querySelectorAll('.deck-card.travel')].map((c) => { const s = getComputedStyle(c); return { i: +c.dataset.i, a: s.animationName, d: s.animationDuration, e: s.animationTimingFunction, fdir: c.style.getPropertyValue('--fdir') }; });
      window.__tl.push({ t: performance.now() - t0, top: top ? +top.dataset.i : -1, y: scrollY, tr, anim: document.getAnimations().length }); if (performance.now() - t0 < 3500) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    if (device === 'phone') await pg.touchscreen.tap(at[0], at[1]); else await pg.mouse.click(at[0], at[1]);
    await pg.waitForTimeout(3700);
    const tl = await pg.evaluate(() => window.__tl);
    const cur = await pg.evaluate(() => window.__deckCur()), y = await pg.evaluate(() => scrollY);
    ok(cur === 0 && y === 0, `after the tap the first card is up (card ${cur}) and the page is at its top (scrollY ${y})`);
    const flew = new Map(); for (const f of tl) for (const c of f.tr) if (c.a !== 'none') flew.set(c.i + ' ' + c.a, c);
    const changes = []; for (let k = 1; k < tl.length; k++) if (tl[k].top !== tl[k - 1].top) changes.push(tl[k].t);
    const gaps = changes.slice(1).map((t, k) => t - changes[k]).sort((a, b) => a - b), med = gaps.length ? gaps[gaps.length >> 1] : null;
    const done = tl.find((f) => f.top === 0 && !f.tr.length);
    if (reduced) {
      ok(flew.size === 0, `no card travelled (${flew.size} flights seen)`);
      ok(tl.every((f) => f.anim === 0 || f.tr.length === 0), 'no animation ran on a card');
      ok(done && done.t < 300, `the first card was up ${done ? Math.round(done.t) : '—'} ms after the tap`);
    } else if (N - 1 > 12) {
      note(`${N} cards: the tap ${flew.size ? 'walked' : 'JUMPED'} to the first card (${flew.size} flights, first card up after ${done ? Math.round(done.t) : '—'} ms) — past JUMP the prototype jumps too`);
    } else {
      const first = [...flew.values()].find((c) => c.i === N - 2 && /side-1$/.test(c.a));
      ok(first && first.fdir === '1', `the first card to rise (${N - 2}) is flung in from the side it was tapped on: ${first ? first.a + ' --fdir ' + first.fdir : 'no side flight seen'}`);
      const wrong = [...flew.values()].filter((c) => !EXPECT[c.a] || EXPECT[c.a][0] !== c.d || EXPECT[c.a][1] !== c.e);
      ok(flew.size >= 2 * (N - 1) && wrong.length === 0, `${flew.size} flight halves for ${N - 1} cards, each with the prototype's duration and easing${wrong.length ? ' — off: ' + wrong.map((c) => `${c.i} ${c.a} ${c.d} ${c.e}`).join('; ') : ''}`);
      for (const [a, [d, e]] of Object.entries(EXPECT)) { const c = [...flew.values()].find((v) => v.a === a); if (c) console.log(`      ${a.padEnd(22)} ${c.d.padEnd(6)} ${c.e}`); }
      ok(med != null && med >= 100 && med <= 150, `one card every ${med != null ? Math.round(med) : '—'} ms (median of ${gaps.length} gaps; the prototype's pace is 120)`);
      console.log(`      the walk: ${N - 1} cards, the first card up after ${done ? Math.round(done.t) : '—'} ms, settled (no card travelling) by then`);
    }
    // linear: nothing but the tap goes round
    await pg.evaluate((n) => window.__deckJump(n - 1), N); await pg.waitForTimeout(800);
    await pg.mouse.move(10, 10);
    await pg.keyboard.press('End'); await pg.waitForTimeout(600);
    await pg.mouse.wheel(0, 3000); await pg.waitForTimeout(900);
    const afterScroll = await pg.evaluate(() => window.__deckCur());
    await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(900);
    const afterKey = await pg.evaluate(() => window.__deckCur());
    ok(afterScroll === N - 1 && afterKey === N - 1, `End, a wheel past the end and ArrowRight leave the last card up (${afterScroll}, ${afterKey})`);
    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally { await ctx.close(); }
}

try {
  await arm('desktop-none', { page: 'none' });
  await arm('desktop-deck-pool', { page: 'deck' });
  await arm('desktop-renderer-pool', { page: 'renderer' });
  await arm('phone-deck-pool', { page: 'deck', device: 'phone' });
  await arm('reduced-desktop', { page: 'deck', reduced: true });
  await arm('reduced-phone', { page: 'deck', device: 'phone', reduced: true });
  await arm('long', { page: 'long' });
} finally { await browser.close(); server.close(); }
console.log(`\npictures: ${SHOTS}`);
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ the first card peeks under the last, and a tap on it goes back the way the prototype does');
process.exit(bad ? 1 : 0);
