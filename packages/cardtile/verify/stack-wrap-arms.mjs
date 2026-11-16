// The arms of the stack-wrap harnesses (tile#345): verify/stack-wrap.mjs runs them in Chromium,
// verify/stack-wrap-webkit.mjs in WebKit. A helper, not a harness (run-all.mjs NOT_A_HARNESS): it exports.
//
// What each arm asks a real browser, because the unit suite (w3/deck-views.test.mjs, "tile#345") runs the deck in a
// stand-in DOM with no layout, no paint and no animations:
//
//   edge      at the last card, the first card is drawn under it AND a point of it shows past the top card
//             (document.elementFromPoint answers the first card there): the peek is visible and hittable, not only
//             a class. Its size is printed (px of edge past the top card).
//   tap       a real pointer (a mouse click; on a phone arm a touchscreen tap) on that point: the deck goes back to
//             the first card and the page is at its top.
//   phone     ⚠ NOTED, not judged: on a phone the peek is a sliver (8 / 8 / 12 px past the top card at 390 px wide —
//             the next card's resting pose, the prototype's too). Nine points on it are tapped once each, and which
//             card the browser handed the pointerdown to is printed: Chromium's touch adjustment hands some of them
//             to the TOP card, which then turns over.
//   motion    every frame of the way back: which card is up, and the animation each travelling card runs, with its
//             computed duration and easing, against the deck prototype's values —
//               first card to rise   deck-from-back-side-1  .36s cubic-bezier(.3,0,.6,1)  (--fdir 1)
//                                    deck-from-back-side-2  .3s  cubic-bezier(.3,0,.7,1)
//               every other card     deck-from-back-1       .36s cubic-bezier(.3,0,.6,1)
//                                    deck-from-back-2       .3s  cubic-bezier(.3,0,.7,1)
//               pace                 a pile of up to 13 cards: one card per 120 ms (deck.js run(): `let wait=120`);
//                                    a longer one: every card, at the riffle's pace — fast, settling into 120 ms
//                                    (deck.js wrapBack). It used to JUMP there, with no motion at all.
//             The pace is the gaps between the frames where the top card changed.
//   reduced   prefers-reduced-motion: the tap goes back with no card travelling and no animation.
//   linear    at the last card, ArrowRight, End and a wheel past the end leave the last card up: only the tap goes
//             round.
//   whole     a pile past the whole pile (61 cards; deck.js 2·WIN+3 = 51): ⚠ NOTED, not judged — the tap there is
//             still the jump.
//
// 🔴 NO FIXED SLEEPS. Every wait is a condition the page is asked for (the deal over, the deck at rest, the run
// landed), so an arm takes as long as the deck does and no longer: the seven Chromium arms used to sleep 105.5 s
// between them, past run-all.mjs's 90 s budget (review of PR #347). The one quiet window left is QUIET ms with no
// scroll event, after a key or a wheel that should change NOTHING — there is no event to wait for when nothing
// happens.
//
// The page is the cardtile worker's own renderCardHTML; /_deck/ is answered by the cardtile worker, so the deck is the GENERATED bundle
// (serve/deck-assets.mjs), the bytes production serves.
import http from 'node:http';
import fs from 'node:fs';
import { join } from 'node:path';
import { PLAYWRIGHT, OUT } from './paths.mjs';
import worker, { renderCardHTML } from '../serve/card-worker.mjs';

const QUIET = 150;
const md = (n) => ['---', 'card-page: wrap', 'title: Specimen — the first card under the last', 'view: stack', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% The first card.',
  ...Array.from({ length: n - 1 }, (_, i) => `- [ ] %% card: text w=6 %% Tile ${i + 2}.`), ''].join('\n');
// the reef.cards card as the last card, both ways a page can have one, and a page with none; a pile of 22 is the shape the
// jump was seen on (21 tiles and the deck's own reef.cards card)
const PAGES = { none: [md(5), {}], deck: [md(5), { deck: { pool: true } }], renderer: [md(5), { pool: true }],
  long: [md(21), { deck: { pool: true } }], whole: [md(60), { deck: { pool: true } }] };
const COUNT = { none: 5, deck: 6, renderer: 6, long: 22, whole: 61 };   // renderer: its reef.cards tile is a sixth card
const EXPECT = {
  'deck-from-back-side-1': ['0.36s', 'cubic-bezier(0.3, 0, 0.6, 1)'], 'deck-from-back-side-2': ['0.3s', 'cubic-bezier(0.3, 0, 0.7, 1)'],
  'deck-from-back-1': ['0.36s', 'cubic-bezier(0.3, 0, 0.6, 1)'], 'deck-from-back-2': ['0.3s', 'cubic-bezier(0.3, 0, 0.7, 1)'],
};
const JUMP = 12, WHOLE = 51;   // deck.js: JUMP, and 2·WIN+3

// in the page: the deck at rest — dealt, nothing travelling, no animation or transition running on a card
const AT_REST = () => { const st = document.querySelector('.deck-stack'); if (!st || window.__deckBoot !== 'ready') return false;
  if (st.classList.contains('dealing') || st.classList.contains('dealt') || st.classList.contains('busy') || document.querySelector('.deck-card.travel')) return false;
  for (const c of document.querySelectorAll('.deck-card')) if (c.style.transform || c.style.opacity) return false;
  return !document.getAnimations().some((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.deck-stack')); };

/** run the arms in one engine. engine: 'chromium' | 'webkit'; devices: { name: context options }; arms: [name, opts]. */
export async function runStackWrap({ engine, devices, arms, label }) {
  const t0 = Date.now();
  const SHOTS = join(OUT, label); fs.mkdirSync(SHOTS, { recursive: true });
  const mod = await import(PLAYWRIGHT); const pw = mod.default || mod;
  let browser;
  try { browser = await pw[engine].launch(); } catch (e) {
    // 🔴 no browser of this engine for this playwright is "could not look", never "looked and it is broken" (run-all: SKIPPED)
    console.log(`usage: needs a ${engine} build that this PLAYWRIGHT can launch — PLAYWRIGHT=/path/to/playwright node packages/cardtile/verify/${label}.mjs`);
    console.log(`   (${engine}: ${String(e && e.message || e).split('\n')[0].slice(0, 160)})`);
    process.exit(0);
  }
  const server = http.createServer(async (req, res) => {
    try {
      const page = PAGES[req.url.slice(1)];
      if (page) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(renderCardHTML(page[0], { handle: 'wrap', ...page[1] })); return; }
      const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: { get: async () => null, async getWithMetadata() { return { value: null, metadata: null }; } }, PREVIEW: 'true' });
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  console.log(`${label}: ${engine} ${browser.version()}`);
  let bad = 0;
  const ok = (cond, msg) => { console.log((cond ? '   ✓ ' : '   🔴 ') + msg); if (!cond) bad++; return !!cond; };
  const note = (msg) => console.log('   ⚠ ' + msg);

  async function arm(name, { page, device = 'desktop', reduced = false }) {
    const a0 = Date.now();
    console.log(`\n── ${name}  (/${page}, ${device}${reduced ? ', reduced motion' : ''})`);
    const ctx = await browser.newContext({ ...devices[device], ...(reduced ? { reducedMotion: 'reduce' } : {}) });
    const pg = await ctx.newPage();
    await pg.addInitScript({ content: `window.__atRest=${AT_REST.toString()};` });   // for the frame recorder below (no eval in the page)
    const errors = []; pg.on('pageerror', (e) => errors.push(e.message));
    const rest = (timeout = 8000) => pg.waitForFunction(AT_REST, null, { timeout, polling: 'raf' });
    // nothing should change: after `act`, QUIET ms with no scroll event (counted from the act, so a scroll that has not begun
    // yet is waited for), and the deck at rest
    const quiet = async (act) => { await pg.evaluate(() => { window.__actT = performance.now(); }); await act();
      await pg.waitForFunction((q) => performance.now() - Math.max(window.__actT, window.__lastScroll || 0) > q && window.__atRest(), QUIET, { timeout: 8000, polling: 'raf' }); };
    const jumpLast = async (N) => { await pg.evaluate((n) => window.__deckJump(n - 1), N); await rest(); };
    try {
      await pg.goto(BASE + '/' + page); await pg.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 10000 }); await rest();
      await pg.evaluate(() => addEventListener('scroll', () => { window.__lastScroll = performance.now(); }, { passive: true }));
      const N = await pg.evaluate(() => window.__deckCount());
      ok(N === COUNT[page], `CONTROL: the pile has ${N} cards (${COUNT[page]} asked for)`);
      await jumpLast(N);
      // edge: the first card under the last, and a point of it past the top card. On a desktop a mouse comes from somewhere:
      // over the peek, where a visitor's would be (the stack's right, where the next card is revealed)
      if (device === 'desktop') { const b = await pg.evaluate(() => { const r = document.querySelector('.deck-stack').getBoundingClientRect(); return [r.right, r.top + r.height / 2]; }); await pg.mouse.move(b[0] + 20, b[1]); await pg.waitForFunction(() => { const c = document.querySelector('.deck-card[data-i="0"]'); return c && c.classList.contains('hovc'); }, null, { timeout: 4000, polling: 'raf' }).catch(() => {}); await rest(); }
      const edge = await pg.evaluate((desk) => {
        const c = document.querySelector('.deck-card[data-i="0"]'), top = document.querySelector('.deck-card.is-top'); if (!c || !top) return null;
        const r = c.getBoundingClientRect(), t = top.getBoundingClientRect(); const pts = [];
        // how far a point is from the top card's box: where a finger is least likely to be read as a tap on the top card
        const off = (x, y) => Math.max(t.left - x, x - t.right, t.top - y, y - t.bottom);
        for (let y = Math.floor(r.top); y < r.bottom; y += 2) for (let x = Math.floor(r.left); x < r.right; x += 2) { const e = document.elementFromPoint(x, y); if (e && e.closest('.deck-card') === c) pts.push([x, y, off(x, y)]); }
        // on a desktop the point is on the right, where the mouse revealed it (on the left the previous card is revealed)
        const cand = desk ? pts.filter((p) => p[0] > t.right) : pts;
        const hit = cand.length ? cand.reduce((a, b) => (b[2] > a[2] ? b : a)) : null;
        return { cls: c.className, top: +top.dataset.i, hit, pts: pts.length ? Array.from({ length: 8 }, (_, k) => pts[Math.floor(k * (pts.length - 1) / 7)]) : [], px: pts.length * 4, past: [Math.round(t.left - r.left), Math.round(r.right - t.right), Math.round(r.bottom - t.bottom)] };
      }, device === 'desktop');
      await pg.screenshot({ path: join(SHOTS, `${name}-last.png`) });
      ok(edge && edge.top === N - 1, `the last card (${N - 1}) is up`);
      ok(edge && /\bis-next1\b/.test(edge.cls) && /\bwrap\b/.test(edge.cls), `the first card is under it: "${edge && edge.cls}"`);
      ok(edge && edge.hit, `the first card shows past the top card: ~${edge && edge.px} px² of it answers elementFromPoint (left/right/bottom past the top card: ${edge && edge.past.join('/')} px); tapped ${edge && edge.hit ? Math.round(edge.hit[2]) : '—'} px outside the top card`);
      if (!edge || !edge.hit) return;
      let at = edge.hit;
      // ⚠ NOTED, not judged: on a phone the peek is the next card's resting pose — a sliver a few px past the top card, the
      // same pose as the prototype's. The browser may hand a tap there to the TOP card (Chromium's touch adjustment moves the
      // tap onto a nearby box that answers clicks; the top card then turns over). Eight points spread over the visible edge,
      // and the one farthest from the top card, are each tapped once: which card the pointerdown went to, and whether the
      // deck went back, is printed. The motion below is then judged from a point the browser did hand to the first card.
      if (device === 'phone') {
        await pg.evaluate(() => { window.__pd = []; document.addEventListener('pointerdown', (e) => window.__pd.push(((e.target.closest && e.target.closest('.deck-card')) || { dataset: {} }).dataset.i), true); document.addEventListener('click', () => { window.__tapT = performance.now(); }, true); });
        const where = []; let back = 0; at = null;
        for (const p of [...edge.pts, edge.hit]) {
          await jumpLast(N); await pg.evaluate(() => { window.__pd.length = 0; window.__tapT = performance.now(); });
          await pg.touchscreen.tap(p[0], p[1]);
          // what the tap did: the page went to the first card's place (the top) and the deck left the last card — the way back
          // itself is judged once, frame by frame, below — or, where it did not go back, the deck at rest 300 ms after the
          // click with no scroll since (the top card may have turned over). (The deck moves on the frame AFTER the click,
          // when sync() reads the scroll: on the click's own frame it is still at rest on the last card.)
          await pg.waitForFunction((n) => (scrollY === 0 && window.__deckCur() < n - 1) || (window.__atRest() && performance.now() - Math.max(window.__tapT, window.__lastScroll || 0) > 300), N, { timeout: 8000, polling: 'raf' });
          const c = await pg.evaluate((n) => (scrollY === 0 && window.__deckCur() < n - 1 ? 0 : window.__deckCur()), N), to = await pg.evaluate(() => window.__pd.join(','));
          if (c === 0) { back++; if (!at) at = p; }
          where.push(`${Math.round(p[2])}px→card ${to || '?'}:${c === 0 ? 'back' : 'stayed'}`);
        }
        note(`a tap went back from ${back} of ${edge.pts.length + 1} points on the visible edge (px outside the top card → the card the pointerdown went to: ${where.join('  ')})`);
        if (!ok(at, 'a tap somewhere on the visible edge reaches the first card')) return;
        await jumpLast(N);
      }
      // The way back, by EVENTS, not by sampled frames: a loaded machine drops frames (headless WebKit at load 13 painted 11
      // of 21 top-card changes, with gaps of a second), and a pace read off painted frames is then a measure of the machine.
      //   rises   when a card is marked `travel` (a MutationObserver: the deck's own tick, as it runs) — the pace
      //   flights each animationstart on a card, with that card's computed duration and easing at that moment
      //   done    the first frame the first card is up and the deck at rest (cards landed, nothing running)
      await pg.evaluate(() => { const atRest = window.__atRest; const t0 = performance.now(); const R = window.__wb = { rises: [], flights: [], done: null };
        new MutationObserver((ms) => { const t = performance.now() - t0; for (const m of ms) { const c = m.target; if (c.classList && c.classList.contains('deck-card') && c.classList.contains('travel') && !(m.oldValue || '').split(' ').includes('travel')) R.rises.push([t, +c.dataset.i]); } })
          .observe(document.querySelector('.deck-stack'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
        document.addEventListener('animationstart', (e) => { const c = e.target.closest && e.target.closest('.deck-card'); if (!c || c !== e.target) return; const s = getComputedStyle(c); R.flights.push({ t: performance.now() - t0, i: +c.dataset.i, a: e.animationName, d: s.animationDuration, e: s.animationTimingFunction, fdir: c.style.getPropertyValue('--fdir') }); }, true);
        let still = 0; const f = () => { const t = performance.now() - t0; const c0 = document.querySelector('.deck-card[data-i="0"]');
          if (R.up == null && window.__deckCur() === 0 && c0 && c0.classList.contains('is-top')) R.up = t;   // the first card up (it may still be settling)
          still = window.__deckCur() === 0 && atRest() ? still + 1 : 0; if (still === 1) R.done = t; if (still >= 3 || t > 6000) R.end = true; else requestAnimationFrame(f); }; requestAnimationFrame(f); });
      if (device === 'phone') await pg.touchscreen.tap(at[0], at[1]); else await pg.mouse.click(at[0], at[1]);
      await pg.waitForFunction(() => window.__wb.end, null, { timeout: 9000, polling: 'raf' });
      const wb = await pg.evaluate(() => window.__wb);
      const cur = await pg.evaluate(() => window.__deckCur()), y = await pg.evaluate(() => scrollY);
      ok(cur === 0 && y === 0, `after the tap the first card is up (card ${cur}) and the page is at its top (scrollY ${y})`);
      const flew = new Map(); for (const c of wb.flights) if (/^deck-from-back/.test(c.a)) flew.set(c.i + ' ' + c.a, c);
      const rose = wb.rises.map(([, i]) => i), times = wb.rises.map(([t]) => t), gaps = times.slice(1).map((t, k) => t - times[k]);
      const mid = (g) => { const s = [...g].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
      const done = wb.done, up = wb.up;
      if (reduced) {
        ok(rose.length === 0 && flew.size === 0, `no card travelled (${rose.length} marked travel, ${flew.size} flights)`);
        ok(!wb.flights.length, `no animation ran on a card${wb.flights.length ? ': ' + wb.flights.map((c) => c.i + ' ' + c.a).join(', ') : ''}`);
        ok(up != null && up < 300, `the first card was up ${up != null ? Math.round(up) : '—'} ms after the tap`);
      } else if (N > WHOLE) {
        note(`${N} cards, past the whole pile (${WHOLE}): the tap ${rose.length ? 'ran' : 'JUMPED'} to the first card (${rose.length} cards rose, first card up after ${up != null ? Math.round(up) : '—'} ms)`);
      } else {
        const want = Array.from({ length: N - 1 }, (_, k) => N - 2 - k);
        ok(rose.join() === want.join(), `every card rose in turn, ${N - 2} down to 0 (${rose.length} rose${rose.length && rose.join() !== want.join() ? ': ' + rose.join(',') : ''})`);
        const first = [...flew.values()].find((c) => c.i === N - 2 && /side-1$/.test(c.a));
        ok(first && first.fdir === '1', `the first card to rise (${N - 2}) is flung in from the side it was tapped on: ${first ? first.a + ' --fdir ' + first.fdir : 'no side flight seen — the tap jumped'}`);
        const wrong = [...flew.values()].filter((c) => !EXPECT[c.a] || EXPECT[c.a][0] !== c.d || EXPECT[c.a][1] !== c.e);
        ok(flew.size >= 2 * (N - 1) && wrong.length === 0, `${flew.size} flight halves for ${N - 1} cards, each with the prototype's duration and easing${wrong.length ? ' — off: ' + wrong.map((c) => `${c.i} ${c.a} ${c.d} ${c.e}`).join('; ') : ''}`);
        for (const [a] of Object.entries(EXPECT)) { const c = [...flew.values()].find((v) => v.a === a); if (c) console.log(`      ${a.padEnd(22)} ${c.d.padEnd(6)} ${c.e}`); }
        const span = times.length > 1 ? times[times.length - 1] - times[0] : null;
        if (N - 1 <= JUMP) { const med = mid(gaps); ok(med != null && med >= 100 && med <= 150, `one card every ${med != null ? Math.round(med) : '—'} ms (median of ${gaps.length} gaps; the prototype's pace is 120)`); }
        else {
          // the riffle's pace: 28+92·(k/K)² ms after card k — fast first, settling towards 120. The first half's median gap is
          // under the last half's, and the run is scheduled in about half the time a 120 ms walk would take
          const h = gaps.length >> 1, m1 = mid(gaps.slice(0, h)), m2 = mid(gaps.slice(h));
          const riffle = Array.from({ length: N - 2 }, (_, k) => 28 + 92 * ((k + 1) / (N - 1)) ** 2).reduce((a, b) => a + b, 0), walk = (N - 2) * 120;
          ok(m1 != null && m2 != null && m1 < m2 && m1 < 80, `fast, settling: the first half's median gap ${m1 != null ? Math.round(m1) : '—'} ms, the last half's ${m2 != null ? Math.round(m2) : '—'} ms (riffle: 28 → ${Math.round(28 + 92 * ((N - 2) / (N - 1)) ** 2)} ms)`);
          ok(span != null && span < (riffle + walk) / 2, `the ${N - 1} cards rose over ${span != null ? Math.round(span) : '—'} ms (the riffle's ${Math.round(riffle)}, a 120 ms walk's ${walk}; judged under ${Math.round((riffle + walk) / 2)})`);
        }
        console.log(`      the way back: ${rose.length} cards rose over ${span != null ? Math.round(span) : '—'} ms; the first card up and every card landed ${done != null ? Math.round(done) : '—'} ms after the tap`);
      }
      // linear: nothing but the tap goes round
      await jumpLast(N);
      await pg.mouse.move(10, 10);
      await quiet(() => pg.keyboard.press('End'));
      // a wheel past the end; mobile WebKit has no wheel (Playwright refuses it), so there it is a scroll past the end
      let past = 'a wheel';
      await quiet(async () => { try { await pg.mouse.wheel(0, 3000); } catch (e) { if (!/not supported/i.test(String(e && e.message))) throw e; past = 'a scroll (no wheel here)'; await pg.evaluate(() => scrollBy(0, 3000)); } });
      const afterScroll = await pg.evaluate(() => window.__deckCur());
      await quiet(() => pg.keyboard.press('ArrowRight'));
      const afterKey = await pg.evaluate(() => window.__deckCur());
      ok(afterScroll === N - 1 && afterKey === N - 1, `End, ${past} past the end and ArrowRight leave the last card up (${afterScroll}, ${afterKey})`);
      ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    } catch (e) { ok(false, `the arm stopped: ${String(e && e.message || e).split('\n')[0]}`); }
    finally { await ctx.close(); console.log(`      (${((Date.now() - a0) / 1000).toFixed(1)} s)`); }
  }

  try { for (const [name, opts] of arms) await arm(name, opts); }
  finally { await browser.close(); server.close(); }
  console.log(`\npictures: ${SHOTS}   (${((Date.now() - t0) / 1000).toFixed(1)} s in all)`);
  console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ the first card peeks under the last, and a tap on it goes back the way the prototype does');
  process.exit(bad ? 1 : 0);
}
