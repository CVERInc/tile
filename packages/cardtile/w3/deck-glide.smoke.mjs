// The card you are on TRAVELS when the view changes to or from the wall; it does not jump — in every engine, in a real
// browser.
//
// deck-switcher.smoke.mjs holds the wall's view transition to the pixel where there is one (the engines deck.js glide
// lets in), and held every other engine to the instant swap: so a browser family with no motion at all was green. This
// one asks the question an eye asks, of every engine and without caring how the motion is made: a press on the switcher,
// then the box the card you are on is DRAWN in, at every 50 ms of the motion's own clock.
//
//   caps    what the engine has: document.startViewTransition, Element.moveBefore (printed; deck.js glide picks by them:
//           both, a view transition; anything less, the same motion made by hand — deck.js flip)
//   travel  ALL SIX SWITCHES, at 390 × 844 and 1280 × 800, from a pile on its fifth card and a wall read far down (so the
//           document scrolls on every switch to or from the wall). The press is made and, in the same turn (after the
//           transition's pictures exist, where there is a transition), every animation on the page is paused; then they
//           are set to 0, 50, … 500 ms and the box is read at each stop. The clock is stopped rather than watched in real
//           time because a frame that comes late is this machine's, not the page's (the WebKit that runs here draws the
//           list at 1280 px with 200 ms between frames, with or without this motion). The box that is drawn: the
//           ::view-transition-group while a view transition plays; otherwise the card (in a pile) or its tile (on the
//           wall), transforms and all (getBoundingClientRect). What is SEEN in that box is the thing that lands, kept
//           in its own proportions: shrunk or grown to fit, in the middle (deck.css gives the transition's pictures
//           object-fit:contain; deck.js flip scales the node itself the same way). So every box is read as the box of
//           where-it-lands' proportions fitted into it, the box before the press too. The way from there to the box
//           after everything has settled is a number, 0 → 1 (the largest edge distance left, over the largest edge
//           distance at the start).
//           TRAVELLING: it starts where it was (within 0.15 of the way), at least three stops are on the way (between
//           0.1 and 0.9), no 50 ms covers more than 0.6 of it, it is never further from where it lands than where it
//           started (a card dealt in from below the window is not the card travelling), and at 500 ms it is home.
//           JUMPING: anything else. HELD for the four switches to or from the wall. Stack ⇄ list is deck.js
//           __deckLayout's own glide, older than this file: read and printed, not held.
//   still   UNDER prefers-reduced-motion NOTHING TRAVELS: to and from the wall no stop from 50 ms on is on the way, and no
//           view transition starts.
//   cut     THE NEWEST ACTION WINS AT ONCE, and nothing is left behind. While the card is still on its way (two frames
//           after the press): another switch, Enter (the card turns over), the fan, a walk to the next card, the way
//           back to the wall and in again — after each, no animation made by script is still playing on anything the
//           action touches, and the action has happened. A fan folded by leaving for the wall is not still folding when
//           the pile is back. NO INPUT REACHES WHAT TRAVELS: with the clock stopped half-way, a real click in the
//           middle of the box it is drawn in turns no card over, opens no fan and follows no link; once it has landed
//           the same click turns the card over. Where the flight is made by hand (below): an animation that never
//           ends inside the tile does not keep the ones after it from being ended, and in a pile of 60 only what can
//           be seen in the window is animated.
//
// 🔴 THE FLIGHT MADE BY HAND IS ALWAYS RUN. deck.js makes the flight by hand where the browser lacks one of the two
// APIs (the WebKit we can run: no Element.moveBefore). A Playwright with no WebKit used to leave that code unrun and
// this file green. So every engine that launches is run more than once: as it is, then with moveBefore taken away
// before the deck's script loads (the hand-made flight, forced), then with startViewTransition taken away as well (a
// browser with neither: the same flight). A run where no hand-made flight was seen travelling is a FAILURE, whatever
// else passed. One more page has Element.animate taken away: there the switch is the instant one and the pile is dealt.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/w3/deck-glide.smoke.mjs [<base URL>]
//   … --engine chromium|webkit|firefox   (default: EVERY one of the three that launches — the defect this was written
//                                        for was in one engine only, and a run of the default engine was green; one
//                                        that does not launch is named as not looked at, and none launching is exit 2)
//   … --frames <dir>                     also write a picture of the page at every other stop to <dir>
//   … --trace                            print the way at every stop
//
// The base URL scripts/test.sh hands every browser smoke is accepted and not used (the pages are the cardtile worker's
// own, answered in-process, as in deck-switcher.smoke.mjs). Exits 1 on any failure (and when the hand-made flight was
// never run), 2 when no browser launches.
//   … --only travel|cut                  one step
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import worker from '../serve/card-worker.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
const ENGINES = opt('--engine') ? [opt('--engine')] : ['chromium', 'webkit', 'firefox'];
let ENGINE = ENGINES[0];
const FRAMES = opt('--frames') ? resolve(opt('--frames')) : '';
const TRACE = args.includes('--trace');
const ONLY = opt('--only');
if (FRAMES) mkdirSync(FRAMES, { recursive: true });

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;

const INNER = { stack: 'deck', list: 'list', wall: 'spread' };
const SIZES = [[390, 844], [1280, 800]];
const STOPS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const tilesOf = (n) => Array.from({ length: n }, (_, i) => `- [ ] %% card: text w=${i % 3 ? 3 : 6} %% Tile ${i + 1}: enough of them that the wall scrolls.`);
const CARD = ['---', 'card-page: glide', 'title: Specimen — the card you are on travels', 'view: stack', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% The card you are on travels.',
  '- [ ] %% card: text w=6 %% It does not jump.',
  '- [ ] %% card: link w=6 %% [Shop](https://example.com/shop)',
  '- [ ] %% card: link w=6 %% [Newsletter](https://example.com/news)',
  '- [ ] %% card: link w=3 %% [Left](https://example.com/l)',
  '- [ ] %% card: link w=3 %% [Right](https://example.com/r)',
  ...tilesOf(8), ''].join('\n');
const LONG = ['---', 'card-page: long', 'title: Specimen — a long pile', 'view: stack', '---', '', '## cards', '', ...tilesOf(60), ''].join('\n');
const store = { get: async (h) => (h === 'glide' ? CARD : h === 'long' ? LONG : null), async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// counts the view transitions the page starts, and says while one's pseudo-elements exist
const HOOK = `(() => { window.__vts = 0; const s = Document.prototype.startViewTransition; if (!s) return;
  Document.prototype.startViewTransition = function (cb) { window.__vts++; const t = s.call(this, cb); window.__vt = t; window.__vtLive = false;
    t.ready.then(() => { if (window.__vt === t) window.__vtLive = true; }, () => {});
    t.finished.finally(() => { if (window.__vt === t) window.__vtLive = false; }); return t; }; })();`;

// what a variant takes away, before any script of the page runs
const STRIP = { mb: 'for (const P of [Element, Document, DocumentFragment]) delete P.prototype.moveBefore;', svt: 'delete Document.prototype.startViewTransition;', anim: 'delete Element.prototype.animate;' };
let browser, VAR = '';

const failures = [];
let passes = 0;
const check = (name, ok, detail = '') => { name = `${ENGINE}${VAR ? ' [' + VAR + ']' : ''}, ${name}`; if (ok) passes++; else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`   🔴 ${name}${detail ? ' — ' + detail : ''}`); } return ok; };
const fmt = (b) => (b ? `[${b.map((x) => Math.round(x)).join(', ')}]` : 'none');

// In the page. __press(m): note the tile of the card you are on (the same node in every view; on the wall it is the tile
// under the middle of the window, as deck.js wallAt has it) and the box it is drawn in, press, and stop the clock.
// __stop(ms): every stopped animation at that time of its own; the box. __go(): let them all finish.
const PAGE = `(() => {
  const TILES = 'main .st-cells > .st-cell, main .st-cells > .st-run > .st-cell, main .st-bleed > .st-cell';
  const box = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
  const wall = () => [...document.querySelectorAll(TILES)].filter((c) => !c.closest('.dc-drawer,.deck-table'));
  const subject = () => { if (document.documentElement.dataset.view !== 'wall') { const c = document.querySelector('.deck-card.is-top'); return c && c.querySelector('.deck-front > .st-cell'); }
    const all = wall(); if (scrollY <= 2) return all[0];
    const mid = innerHeight / 2; let best = null, far = Infinity;
    for (const c of all) { const r = c.getBoundingClientRect(); if (!r.height) continue; const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid)); if (d < far) { far = d; best = c; } } return best; };
  const drawn = (t) => { if (window.__vtLive) { const c = getComputedStyle(document.documentElement, '::view-transition-group(deck-up)'); if (c.transform && c.transform !== 'none' && parseFloat(c.width)) { const m = new DOMMatrix(c.transform); return { how: 'view transition', box: [m.e, m.f, parseFloat(c.width), parseFloat(c.height)] }; } }
    const card = t.closest('.deck-card'); return { how: card ? 'card' : 'tile', box: box(card || t) }; };
  let T = null, held = [];
  window.__farTile = () => { const all = wall(); all[all.length - 3].scrollIntoView({ block: 'center', behavior: 'instant' }); };
  window.__press = async (m) => { T = subject(); if (!T) return null; const start = drawn(T).box, n0 = window.__vts;
    document.querySelector('.deck-seg button[data-m="' + m + '"]').click();
    if (window.__vts > n0) { try { await window.__vt.ready; } catch (_) {} }
    held = document.getAnimations(); for (const a of held) a.pause();
    return { start, vts: window.__vts - n0, anims: held.length }; };
  window.__stop = (ms) => { for (const a of held) { try { a.currentTime = Math.min(ms, a.effect.getComputedTiming().endTime); } catch (_) {} } return drawn(T); };
  window.__go = () => { for (const a of held) { try { a.finish(); } catch (_) {} } held = []; };
  window.__end = () => ({ ...drawn(T), view: document.documentElement.dataset.view });
  // ---- cut ----
  // an animation made by script (Element.animate), still playing: the flight made by hand, a fold. Not the browser's own
  // (a rule's animation or transition, a view transition's pictures).
  const made = (a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition);
  const live = (a) => a.playState === 'running' || a.playState === 'paused';
  const seen = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && s.visibility !== 'hidden'; };
  window.__flights = () => document.getAnimations().filter((a) => made(a) && live(a) && a.effect && a.effect.target).map((a) => { const e = a.effect.target;
    return { el: e, cls: String(e.className).slice(0, 48), props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)), seen: seen(e), card: e.classList.contains('deck-card'), top: e.classList.contains('is-top') }; });
  const plain = (f) => f.map(({ el, ...x }) => x);
  window.__frames = (n) => new Promise((done) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : done()); f(); });
  // a press that has been acted on: where the switch is a view transition, its update has run
  window.__switch = async (m) => { const n0 = window.__vts; document.querySelector('.deck-seg button[data-m="' + m + '"]').click(); if (window.__vts > n0) { try { await window.__vt.updateCallbackDone; } catch (_) {} } };
  window.__subject = subject;
  window.__top = () => document.querySelector('.deck-card.is-top');
  window.__state = () => { const r = document.documentElement, f = window.__flights(), t = window.__top(); return { view: r.dataset.view, open: r.classList.contains('open'), fan: r.classList.contains('fan'), folding: r.classList.contains('fan-folding'), flights: plain(f), cur: window.__deckCur ? window.__deckCur() : -1,
    z: t ? [getComputedStyle(t).zIndex, t.style.zIndex] : null, turned: !!(t && t.classList.contains('is-open')), named: document.querySelectorAll('[data-deck-up]').length }; };
  window.__on = (e) => window.__flights().filter((f) => f.el === e || e.contains(f.el)).length;
  window.__got = []; document.addEventListener('click', (e) => window.__got.push(e.target.tagName + '.' + String(e.target.className).slice(0, 30)));
  window.__box = (e) => box(e);
})();`;

async function open({ width, height, reduced = false, strip = [], path = '/glide', at = 4 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errs = [], ext = [], pops = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message || e).split('\n')[0])); ctx.on('page', (p) => { if (p !== page) pops.push(p); });
  for (const k of strip) await page.addInitScript(STRIP[k]);
  await page.addInitScript(HOOK);
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host !== 'card.test') { ext.push(u.href); return route.abort(); }
    if (/^\/_icon\//.test(u.pathname)) return route.fulfill({ contentType: 'image/png', body: PIXEL });
    const r = await worker.fetch(new Request('http://x' + u.pathname + u.search), { CARDS: store, PREVIEW: 'true' });
    const headers = Object.fromEntries(r.headers); delete headers['content-length'];
    return route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
  await page.goto('http://card.test' + path);
  await page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 15000 });
  await page.waitForTimeout(1600);   // the deal is over
  await page.evaluate((i) => window.__deckJump(i), at); await page.waitForTimeout(500);
  await page.evaluate(PAGE);
  return { ctx, page, errs, ext, pops };
}

const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[0] + a[2] - b[0] - b[2]), Math.abs(a[1] + a[3] - b[1] - b[3]));

// one switch, read at every stop: a row of the table
async function watchSwitch(page, from, to, tag) {
  if (from === 'wall') await page.evaluate(() => window.__farTile());
  await page.waitForTimeout(900);   // whatever the last switch started is over
  const pressed = await page.evaluate((m) => window.__press(m), INNER[to]);
  const seen = [];
  for (const ms of STOPS) {
    seen.push({ ms, ...(await page.evaluate((ms) => window.__stop(ms), ms)) });
    if (FRAMES && ms % 100 === 0) writeFileSync(join(FRAMES, `${ENGINE}-${tag.replace(/[^\w]+/g, '-')}-${String(ms).padStart(3, '0')}.png`), await page.screenshot({ animations: 'allow' }));
  }
  await page.evaluate(() => window.__go());
  await page.waitForTimeout(1300);   // home, and whatever a pile deals is dealt
  const end = await page.evaluate(() => window.__end());
  const how = [...new Set(seen.map((s) => s.how))].join(' → ');
  // what is seen in a box: the thing that lands, in its own proportions, fitted in and centred
  const fit = (b) => { const k = Math.min(b[2] / end.box[2], b[3] / end.box[3]), w = end.box[2] * k, h = end.box[3] * k; return [b[0] + (b[2] - w) / 2, b[1] + (b[3] - h) / 2, w, h]; };
  const start = fit(pressed.start);
  const span = dist(start, end.box);
  for (const s of seen) s.p = span ? 1 - dist(fit(s.box), end.box) / span : 1;
  const mid = seen.filter((s) => s.p > 0.1 && s.p < 0.9).length, late = seen.filter((s) => s.ms >= 50 && s.p > 0.1 && s.p < 0.9).length;
  let step = 0; for (let i = 1; i < seen.length; i++) step = Math.max(step, seen[i].p - seen[i - 1].p);
  const back = Math.min(...seen.map((s) => s.p)), first = seen[0].p, last = seen[seen.length - 1].p;
  const travels = span > 20 && Math.abs(first) <= 0.15 && mid >= 3 && step <= 0.6 && back >= -0.15 && last >= 0.98;
  if (TRACE) console.log(`      ${tag}: ${seen.map((s) => `${s.ms}:${s.p.toFixed(2)}`).join(' ')}`);
  return { from, to, vts: pressed.vts, anims: pressed.anims, view: end.view, from0: pressed.start, start, end: end.box, span, mid, late, step, back, first, last, how, travels, verdict: span <= 20 ? 'same place' : travels ? 'travels' : 'JUMPS' };
}

const table = [], looked = [], missing = [];
let handMade = 0;   // switches to or from the wall SEEN TRAVELLING with no view transition: the flight made by hand

// travel + still: one row of the table per switch
async function travel(V, caps, hand) {
  const rows = [];
  for (const [width, height] of SIZES) {
    const size = `${width}×${height}`;
    const { ctx, page } = await open({ width, height, strip: V.strip });
    console.log(`\ntravel — ${size}`);
    let at = 'stack';
    for (const to of ['wall', 'stack', 'list', 'wall', 'list', 'stack']) {
      const tag = `${size}: ${at} → ${to}`, held = at === 'wall' || to === 'wall';
      const r = await watchSwitch(page, at, to, tag); rows.push({ size, held, ...r });
      const said = `starts at ${r.first.toFixed(2)} of the way, ${r.mid} of ${STOPS.length} stop(s) on the way, largest 50 ms step ${r.step.toFixed(2)}, furthest back ${r.back.toFixed(2)}, at 500 ms ${r.last.toFixed(2)}`;
      console.log(`   ${tag}: ${r.verdict}${held ? '' : ' (not held)'} — ${fmt(r.from0)} → ${fmt(r.end)} (seen: ${fmt(r.start)} → ${fmt(r.end)}, ${Math.round(r.span)} px); ${said}; drawn as ${r.how}; ${r.vts} view transition(s), ${r.anims} animation(s) stopped`);
      check(`${tag}: the page is on ${to}`, r.view === to, r.view);
      if (held) {
        check(`${tag}: the two layouts differ (there is a way to travel)`, r.span > 20, `${fmt(r.start)} → ${fmt(r.end)}`);
        check(`${tag}: the card you are on travels, it does not jump`, r.travels, said);
        if (hand) { check(`${tag}: made by hand — no view transition starts`, r.vts === 0, `${r.vts}`); if (r.vts === 0 && r.travels) handMade++; }
      }
      at = to;
    }
    await ctx.close();
    // less motion: the switch is there at once
    const q = await open({ width, height, reduced: true, strip: V.strip });
    at = 'stack';
    for (const to of ['wall', 'stack']) {
      const tag = `${size}, reduced motion: ${at} → ${to}`;
      const r = await watchSwitch(q.page, at, to, tag);
      console.log(`   ${tag}: ${r.late} stop(s) on the way from 50 ms on; ${r.vts} view transition(s)`);
      check(`${tag}: nothing travels, and the page is on ${to}`, r.late === 0 && r.vts === 0 && r.view === to, `${r.late} stop(s) on the way, ${r.vts} view transition(s), on ${r.view}`);
      at = to;
    }
    await q.ctx.close();
  }
  table.push(...rows.map((r) => `| ${ENGINE} ${browser.version()} | ${VAR || 'as it is'} | ${r.size} | ${r.from} → ${r.to} | ${caps.svt ? 'yes' : 'no'} | ${caps.mb ? 'yes' : 'no'} | ${r.vts} | ${r.how} | ${r.first.toFixed(2)} | ${r.mid} / ${STOPS.length} | ${r.step.toFixed(2)} | ${r.back.toFixed(2)} | ${r.last.toFixed(2)} | ${r.verdict}${r.held ? '' : ' (not held)'} |`));
}

// cut: the newest action wins at once; no input reaches what travels; nothing is left behind
async function cuts(V, hand) {
  console.log(`\ncut — 390×844${hand ? ' (the flight is made by hand)' : ' (the flight is a view transition)'}`);
  const scene = async (name, o, fn) => { const s = await open({ width: 390, height: 844, strip: V.strip, ...o });
    try { await fn(s.page, s, (what, ok, detail) => check(`cut, ${name}: ${what}`, ok, detail)); } catch (e) { check(`cut, ${name}: ran to its end`, false, String(e && e.message || e).split('\n')[0]); }
    check(`cut, ${name}: no script error`, s.errs.length === 0, s.errs.join(' | ')); await s.ctx.close(); };
  const toWall = async (page) => { await page.evaluate(() => window.__switch('spread')); await page.waitForTimeout(900); await page.evaluate(() => window.__farTile()); await page.waitForTimeout(300); };
  const fl = (f) => `${f.length} still playing${f.length ? ': ' + f.slice(0, 6).map((x) => `${x.cls || '(no class)'} {${x.props}}`).join('; ') + (f.length > 6 ? '; …' : '') : ''}`;
  const control = (ok, mid, name) => { if (hand) ok(`CONTROL a flight made by hand was on its way ${name}`, mid.flights.length > 0, fl(mid.flights)); };

  await scene('another switch, 2 frames into the flight', {}, async (page, s, ok) => {
    await toWall(page);
    const r = await page.evaluate(async () => { await window.__switch('deck'); await window.__frames(2); const mid = window.__state(); await window.__switch('list'); return { mid, after: window.__state() }; });
    console.log(`   wall → stack, then list: ${fl(r.mid.flights)} before; ${fl(r.after.flights)} after; the card's z-index is ${r.after.z && r.after.z[0]} (the glide asks for ${r.after.z && r.after.z[1]})`);
    control(ok, r.mid, 'when list was pressed');
    ok('the page is the list', r.after.view === 'list', r.after.view);
    ok('no animation made by script is still playing', r.after.flights.length === 0, fl(r.after.flights));
    ok('the card you are on is drawn over the others, as the pile\'s own glide asks', !!r.after.z && r.after.z[1] !== '' && r.after.z[0] === r.after.z[1], `computed ${r.after.z && r.after.z[0]}, asked ${r.after.z && r.after.z[1]}`);
    await page.waitForTimeout(900);
    const end = await page.evaluate(() => ({ ...window.__state(), style: window.__top().getAttribute('style') || '' }));
    ok('afterwards nothing is left on the card', end.flights.length === 0 && end.named === 0 && !/transform|z-index|opacity|pointer-events/.test(end.style), `${fl(end.flights)}; ${end.named} named; style "${end.style}"`);
  });

  await scene('Enter, 2 frames into the flight', {}, async (page, s, ok) => {
    await toWall(page);
    const r = await page.evaluate(async () => { await window.__switch('deck'); await window.__frames(2); const mid = window.__state(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return { mid, after: window.__state() }; });
    console.log(`   wall → stack, then Enter: ${fl(r.mid.flights)} before; ${fl(r.after.flights)} after; turned over: ${r.after.turned}`);
    control(ok, r.mid, 'when Enter was pressed');
    ok('the card is turned over', r.after.open && r.after.turned, `open ${r.after.open}, turned ${r.after.turned}`);
    ok('no animation made by script is still playing', r.after.flights.length === 0, fl(r.after.flights));
  });

  await scene('the fan, 2 frames into the flight', {}, async (page, s, ok) => {
    await toWall(page);
    const r = await page.evaluate(async () => { await window.__switch('deck'); await window.__frames(2); const mid = window.__state(); window.__deckFan(); return { mid, after: window.__state() }; });
    console.log(`   wall → stack, then the fan: ${fl(r.mid.flights)} before; ${fl(r.after.flights)} after; fanned: ${r.after.fan}`);
    control(ok, r.mid, 'when the fan was opened');
    ok('the fan is open', r.after.fan, String(r.after.fan));
    ok('no animation made by script is still playing', r.after.flights.length === 0, fl(r.after.flights));
  });

  await scene('a walk to the next card, 2 frames into the flight', { at: 2 }, async (page, s, ok) => {
    await page.evaluate(() => window.__switch('spread')); await page.waitForTimeout(900);
    const r = await page.evaluate(async () => { const all = [...document.querySelectorAll('main .st-cells .st-cell')]; all[4].scrollIntoView({ block: 'center', behavior: 'instant' }); await window.__frames(3);
      await window.__switch('deck'); await window.__frames(2); const mid = window.__state();
      scrollTo({ top: scrollY + (document.scrollingElement.scrollHeight - innerHeight) / (window.__deckCount() - 1), behavior: 'instant' }); await window.__frames(4); return { mid, after: window.__state() }; });
    console.log(`   wall → stack, then one card on: ${fl(r.mid.flights)} before; ${fl(r.after.flights)} after; card ${r.mid.cur} → ${r.after.cur}`);
    control(ok, r.mid, 'when the page was scrolled');
    ok('the pile is on the next card', r.after.cur === r.mid.cur + 1, `${r.mid.cur} → ${r.after.cur}`);
    ok('no animation made by script is still playing', r.after.flights.length === 0, fl(r.after.flights));
  });

  await scene('out to the wall and in again, 2 frames apart', {}, async (page, s, ok) => {
    const r = await page.evaluate(async () => { const tile = window.__subject(); await window.__switch('spread'); await window.__frames(2); const mid = window.__state(), was = window.__on(tile);
      await window.__switch('deck'); const after = window.__state(); return { mid, was, on: window.__flights().filter((f) => f.el === tile).length, after }; });
    console.log(`   stack → wall → stack: on the tile ${r.was} before, ${r.on} after; ${fl(r.after.flights)} in all`);
    if (hand) ok('CONTROL the tile was on its way to the wall', r.was > 0, `${r.was}`);
    ok('the page is the stack', r.after.view === 'stack', r.after.view);
    ok('the flight to the wall is over: nothing plays on the tile itself', r.on === 0, `${r.on}`);
    if (hand) ok('the newer flight is on its way, on the card', r.after.flights.some((f) => f.top && f.props.includes('transform')), fl(r.after.flights));
    ok('nothing that cannot be seen is animated', r.after.flights.every((f) => f.seen), fl(r.after.flights.filter((f) => !f.seen)));
  });

  await scene('a click on the card while it lands in the pile', {}, async (page, s, ok) => {
    await toWall(page);
    await page.evaluate(() => window.__press('deck')); const mid = await page.evaluate(() => window.__stop(250));
    const [x, y, w, h] = mid.box; await page.evaluate(() => { window.__got.length = 0; }); await page.mouse.click(x + w / 2, y + h / 2); await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ ...window.__state(), got: window.__got.slice() }));
    console.log(`   clicked at ${Math.round(x + w / 2)}, ${Math.round(y + h / 2)} (drawn as ${mid.how}, half-way): turned over ${after.turned}, fan ${after.fan}, clicks the page saw: ${after.got.join(' ') || 'none'}`);
    ok('the card is not turned over', !after.open && !after.turned, `open ${after.open}`);
    ok('no fan opens', !after.fan, String(after.fan));
    if (hand) ok('the click reached nothing in the page', after.got.length === 0, after.got.join(' '));
    await page.evaluate(() => window.__go()); await page.waitForTimeout(800);
    const b = await page.evaluate(() => window.__box(window.__top())); await page.mouse.click(b[0] + b[2] / 2, b[1] + b[3] / 2); await page.waitForTimeout(100);
    const later = await page.evaluate(() => window.__state());
    ok('once it has landed, the same click turns it over', later.open && later.turned, `open ${later.open}`);
  });

  await scene('a click on the tile while it lands on the wall', {}, async (page, s, ok) => {
    await page.evaluate(() => window.__press('spread')); const mid = await page.evaluate(() => window.__stop(250));
    const [x, y, w, h] = mid.box, n0 = s.ext.length, url = page.url(); await page.evaluate(() => { window.__got.length = 0; }); await page.mouse.click(x + w / 2, y + h / 2); await page.waitForTimeout(400);
    const got = await page.evaluate(() => (window.__got || ['(the page is gone)']).slice()).catch(() => ['(the page is gone)']);
    const asked = s.ext.slice(n0);
    console.log(`   clicked at ${Math.round(x + w / 2)}, ${Math.round(y + h / 2)} (drawn as ${mid.how}, half-way; a link tile): addresses asked for ${asked.join(' ') || 'none'}, windows opened ${s.pops.length}, clicks the page saw: ${got.join(' ') || 'none'}`);
    ok('no link is followed', asked.length === 0 && s.pops.length === 0 && page.url() === url, `${asked.join(' ')} ${s.pops.length} window(s) ${page.url()}`);
    if (hand) ok('the click reached nothing in the page', got.length === 0, got.join(' '));
  });

  await scene('a fan folded by leaving for the wall', {}, async (page, s, ok) => {
    const r = await page.evaluate(async () => { window.__deckFan(); await new Promise((d) => setTimeout(d, 600)); const fan = window.__state();
      await window.__switch('spread'); await window.__frames(2); const wall = window.__state(); await window.__switch('deck'); return { fan, wall, after: window.__state() }; });
    const fold = (st) => st.flights.filter((f) => f.card && !f.top && f.props.includes('transform'));
    console.log(`   fan → wall → stack, 2 frames apart: a fold's flights on the wall ${fold(r.wall).length}, back in the pile ${fold(r.after).length}`);
    ok('CONTROL the fan was open', r.fan.fan, String(r.fan.fan));
    ok('on the wall no card is still folding', fold(r.wall).length === 0 && !r.wall.folding, `${fold(r.wall).length} card(s), fan-folding ${r.wall.folding}`);
    ok('back in the pile no other card is still folding', r.after.view === 'stack' && fold(r.after).length === 0 && !r.after.folding, `${fold(r.after).length} card(s), on ${r.after.view}`);
  });

  if (hand) await scene('an animation that never ends, inside the tile', {}, async (page, s, ok) => {
    await toWall(page);
    const r = await page.evaluate(async () => { const t = window.__subject(); const st = document.createElement('style'); st.textContent = '@keyframes g-k{from{opacity:.9}to{opacity:1}} .g-inf{animation:g-k 1s infinite} .g-fin{animation:g-k 20s}'; document.head.append(st);
      const a = document.createElement('i'), b = document.createElement('i'); a.className = 'g-inf'; b.className = 'g-fin'; t.append(a, b); await window.__frames(2);
      let threw = ''; try { a.getAnimations()[0].finish(); } catch (e) { threw = e.name; }
      await window.__switch('deck'); const fa = b.getAnimations()[0], ia = a.getAnimations()[0];
      return { threw, fin: fa ? fa.playState : 'none', inf: ia ? ia.playState : 'none', inCard: !!b.closest('.deck-card.is-top') }; });
    console.log(`   finish() on the endless one: ${r.threw || 'did not throw'}; after the switch the endless one is ${r.inf}, the one after it ${r.fin}`);
    ok('CONTROL finish() on an animation that never ends throws', r.threw === 'InvalidStateError', r.threw);
    ok('CONTROL both are in the card that lands', r.inCard && r.inf === 'running', `${r.inCard}, ${r.inf}`);
    ok('the animation after it is ended all the same', r.fin === 'finished' || r.fin === 'none', r.fin);
  });

  if (hand) await scene('a pile of 60', { path: '/long', at: 30 }, async (page, s, ok) => {
    await toWall(page);
    for (const m of ['deck', 'spread', 'list', 'spread']) {
      if (m !== 'spread') { await page.evaluate(() => window.__farTile()); await page.waitForTimeout(300); }
      const r = await page.evaluate(async (m) => { await window.__switch(m); return { ...window.__state(), cards: document.querySelectorAll('.deck-card').length }; }, m);
      const unseen = r.flights.filter((f) => !f.seen);
      console.log(`   → ${r.view}: ${r.flights.length} animation(s) made, ${unseen.length} on something that cannot be seen; ${r.cards} cards in the page`);
      ok(`→ ${r.view}: CONTROL the pile is long and a flight is on its way`, r.cards >= 40 && r.flights.length > 0, `${r.cards} cards, ${r.flights.length} animations`);
      ok(`→ ${r.view}: nothing that cannot be seen is animated`, unseen.length === 0, fl(unseen));
      ok(`→ ${r.view}: a handful of animations, not one per card`, r.flights.length <= 16, `${r.flights.length}`);
      await page.waitForTimeout(900);
    }
  });
}

for (ENGINE of ENGINES) {
VAR = '';
try { browser = await lib[ENGINE].launch(); } catch (e) { const why = String(e && e.message || e).split('\n')[0]; missing.push(ENGINE); console.log(`\n💥 ${ENGINE} did not launch: ${why}`); continue; }
looked.push(`${ENGINE} ${browser.version()}`);
console.log(`\ndeck-glide smoke — ${ENGINE} ${browser.version()}`);
const capsOf = async (strip) => { const { ctx, page } = await open({ width: 390, height: 844, strip }); const c = await page.evaluate(() => ({ svt: typeof document.startViewTransition === 'function', mb: typeof Element.prototype.moveBefore === 'function', anim: typeof Element.prototype.animate === 'function' })); await ctx.close(); return c; };
const own = await capsOf([]);
const variants = [{ name: '', strip: [] }];
if (own.mb) variants.push({ name: 'moveBefore taken away', strip: ['mb'] });
if (own.svt) variants.push({ name: own.mb ? 'both taken away' : 'startViewTransition taken away', strip: ['mb', 'svt'] });
for (const V of variants) {
  VAR = V.name;
  const caps = await capsOf(V.strip), hand = !(caps.svt && caps.mb);
  console.log(`\n── ${ENGINE}${VAR ? ', ' + VAR : ', as it is'} — document.startViewTransition: ${caps.svt ? 'yes' : 'no'}; Element.prototype.moveBefore: ${caps.mb ? 'yes' : 'no'} → the flight is ${hand ? 'made by hand (deck.js flip)' : 'a view transition'}`);
  if (V.strip.length) check('what was taken away is gone', V.strip.every((k) => !caps[k]), JSON.stringify(caps));
  if (!ONLY || ONLY === 'travel') await travel(V, caps, hand);
  if (!ONLY || ONLY === 'cut') await cuts(V, hand);
}
// no Element.animate either: no flight can be made, so the switch is the instant one and the pile is dealt
if (!ONLY || ONLY === 'cut') {
  VAR = 'moveBefore and Element.animate taken away';
  const s = await open({ width: 390, height: 844, strip: ['mb', 'anim'] });
  await s.page.evaluate(() => window.__switch('spread')); await s.page.waitForTimeout(900);
  const r = await s.page.evaluate(async () => { await window.__switch('deck'); const pile = document.querySelector('.deck-stack'); return { view: document.documentElement.dataset.view, dealt: /deal/.test(pile.className), anim: typeof Element.prototype.animate }; });
  console.log(`\n── ${ENGINE}, ${VAR}: wall → stack lands on ${r.view}; the pile is dealt: ${r.dealt}`);
  check('wall → stack: the page is the stack, and the pile is dealt (no flight can be made)', r.anim === 'undefined' && r.view === 'stack' && r.dealt, `animate ${r.anim}, on ${r.view}, dealt ${r.dealt}`);
  check('wall → stack: no script error', s.errs.length === 0, s.errs.join(' | '));
  await s.ctx.close();
}
VAR = '';
await browser.close();
}

if (table.length) {
  console.log('\n| engine | run | size | switch | startViewTransition | moveBefore | view transitions started | drawn as | starts at | stops on the way | largest 50 ms step | furthest back | at 500 ms | verdict |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  console.log(table.join('\n'));
}

if (missing.length) console.log(`\n⚠ NOT LOOKED AT: ${missing.join(', ')} (did not launch with this Playwright) — nothing above says the card travels there`);
if (!looked.length) { console.log('💥 no engine launched'); process.exit(2); }
// 🔴 whatever launched, the flight made by hand has to have been seen travelling
if (!ONLY || ONLY === 'travel') { VAR = ''; ENGINE = looked.map((l) => l.split(' ')[0]).join('+'); check('the flight made by hand was run, and travelled', handMade > 0, `${handMade} switch(es)`); console.log(`\nthe flight made by hand travelled on ${handMade} switch(es)`); }
console.log(`\n${passes} passed, ${failures.length} failed (real engines run: ${looked.join('; ')}${missing.length ? `; not run: ${missing.join(', ')}` : ''})`);
if (failures.length) { console.log('\n' + failures.map((f) => '🔴 ' + f).join('\n')); process.exit(1); }
console.log(`✅ the card you are on travels to and from the wall, by view transition and by hand; the newest action wins; under reduced motion nothing travels — in ${looked.join(' and ')}`);
