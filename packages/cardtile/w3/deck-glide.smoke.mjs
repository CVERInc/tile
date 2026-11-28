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
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/w3/deck-glide.smoke.mjs [<base URL>]
//   … --engine chromium|webkit|firefox   (default: EVERY one of the three that launches — the defect this was written
//                                        for was in one engine only, and a run of the default engine was green; one
//                                        that does not launch is named as not looked at, and none launching is exit 2)
//   … --frames <dir>                     also write a picture of the page at every other stop to <dir>
//   … --trace                            print the way at every stop
//
// The base URL scripts/test.sh hands every browser smoke is accepted and not used (the pages are the cardtile worker's
// own, answered in-process, as in deck-switcher.smoke.mjs). Exits 1 on any failure, 2 when the browser does not launch.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import worker from '../serve/card-worker.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
const ENGINES = opt('--engine') ? [opt('--engine')] : ['chromium', 'webkit', 'firefox'];
let ENGINE = ENGINES[0];
const FRAMES = opt('--frames') ? resolve(opt('--frames')) : '';
const TRACE = args.includes('--trace');
if (FRAMES) mkdirSync(FRAMES, { recursive: true });

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;

const INNER = { stack: 'deck', list: 'list', wall: 'spread' };
const SIZES = [[390, 844], [1280, 800]];
const STOPS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const CARD = ['---', 'card-page: glide', 'title: Specimen — the card you are on travels', 'view: stack', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% The card you are on travels.',
  '- [ ] %% card: text w=6 %% It does not jump.',
  '- [ ] %% card: link w=6 %% [Shop](https://example.com/shop)',
  '- [ ] %% card: link w=6 %% [Newsletter](https://example.com/news)',
  '- [ ] %% card: link w=3 %% [Left](https://example.com/l)',
  '- [ ] %% card: link w=3 %% [Right](https://example.com/r)',
  ...Array.from({ length: 8 }, (_, i) => `- [ ] %% card: text w=${i % 3 ? 3 : 6} %% Tile ${i + 1}: enough of them that the wall scrolls.`), ''].join('\n');
const store = { get: async (h) => (h === 'glide' ? CARD : null), async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// counts the view transitions the page starts, and says while one's pseudo-elements exist
const HOOK = `(() => { window.__vts = 0; const s = Document.prototype.startViewTransition; if (!s) return;
  Document.prototype.startViewTransition = function (cb) { window.__vts++; const t = s.call(this, cb); window.__vt = t; window.__vtLive = false;
    t.ready.then(() => { if (window.__vt === t) window.__vtLive = true; }, () => {});
    t.finished.finally(() => { if (window.__vt === t) window.__vtLive = false; }); return t; }; })();`;

let browser;

const failures = [];
let passes = 0;
const check = (name, ok, detail = '') => { name = `${ENGINE}, ${name}`; if (ok) passes++; else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`   🔴 ${name}${detail ? ' — ' + detail : ''}`); } return ok; };
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
})();`;

async function open({ width, height, reduced = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(HOOK);
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host !== 'card.test') return route.abort();
    if (/^\/_icon\//.test(u.pathname)) return route.fulfill({ contentType: 'image/png', body: PIXEL });
    const r = await worker.fetch(new Request('http://x' + u.pathname + u.search), { CARDS: store, PREVIEW: 'true' });
    const headers = Object.fromEntries(r.headers); delete headers['content-length'];
    return route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
  });
  await page.goto('http://card.test/glide');
  await page.waitForFunction(() => window.__deckBoot === 'ready', null, { timeout: 15000 });
  await page.waitForTimeout(1600);   // the deal is over
  await page.evaluate(() => window.__deckJump(4)); await page.waitForTimeout(500);
  await page.evaluate(PAGE);
  return { ctx, page };
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
for (ENGINE of ENGINES) {
try { browser = await lib[ENGINE].launch(); } catch (e) { const why = String(e && e.message || e).split('\n')[0]; missing.push(ENGINE); console.log(`\n💥 ${ENGINE} did not launch: ${why}`); continue; }
looked.push(`${ENGINE} ${browser.version()}`);
console.log(`\ndeck-glide smoke — ${ENGINE} ${browser.version()}`);
const rows = [];
let caps = null;
for (const [width, height] of SIZES) {
  const size = `${width}×${height}`;
  const { ctx, page } = await open({ width, height });
  if (!caps) {
    caps = await page.evaluate(() => ({ svt: typeof document.startViewTransition === 'function', mb: typeof Element.prototype.moveBefore === 'function' }));
    console.log(`\ncaps — document.startViewTransition: ${caps.svt ? 'yes' : 'no'}; Element.prototype.moveBefore: ${caps.mb ? 'yes' : 'no'}`);
  }
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
    }
    at = to;
  }
  await ctx.close();
  // less motion: the switch is there at once
  const q = await open({ width, height, reduced: true });
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

table.push(...rows.map((r) => `| ${ENGINE} ${browser.version()} | ${r.size} | ${r.from} → ${r.to} | ${caps.svt ? 'yes' : 'no'} | ${caps.mb ? 'yes' : 'no'} | ${r.vts} | ${r.how} | ${r.first.toFixed(2)} | ${r.mid} / ${STOPS.length} | ${r.step.toFixed(2)} | ${r.back.toFixed(2)} | ${r.last.toFixed(2)} | ${r.verdict}${r.held ? '' : ' (not held)'} |`));
await browser.close();
}

console.log('\n| engine | size | switch | startViewTransition | moveBefore | view transitions started | drawn as | starts at | stops on the way | largest 50 ms step | furthest back | at 500 ms | verdict |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
console.log(table.join('\n'));

if (missing.length) console.log(`\n⚠ NOT LOOKED AT: ${missing.join(', ')} (did not launch with this Playwright) — nothing above says the card travels there`);
if (!looked.length) { console.log('💥 no engine launched'); process.exit(2); }
console.log(`\n${passes} passed, ${failures.length} failed (${looked.join('; ')})`);
if (failures.length) { console.log('\n' + failures.map((f) => '🔴 ' + f).join('\n')); process.exit(1); }
console.log(`✅ the card you are on travels to and from the wall; under reduced motion nothing does — in ${looked.join(' and ')}`);
