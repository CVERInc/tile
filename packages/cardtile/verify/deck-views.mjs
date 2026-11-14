// Stack, list and wall are one set of nodes (tile#297) — asked of a real browser, because the unit
// suite (w3/deck-views.test.mjs) runs the deck in a stand-in DOM with no layout and no paint.
//
// What this measures, per opening view (`view: stack | list | wall`), at a phone and a desktop window:
//
//   1. BEFORE THE DECK'S SCRIPT. deck.js is held back for a second and a half and the page is looked
//      at while it waits. A page that opens on a pile must not be showing the wall (no tile has a
//      box); a page that opens on the wall must be showing it. Screenshot: prepaint-*.png.
//   2. NO LAYOUT SHIFT AT LOAD. The browser's own `layout-shift` entries, summed over the load of an
//      unhindered page. A pile is dealt onto the table (cards arrive by transform, which is not a
//      shift), so the sum is expected to be 0.
//   3. THE SIX SWITCHES. From the opening view to each other view and on, until every ordered pair
//      has been made at least once — with the keyboard (focus the button, press Enter). After each:
//      no navigation (no new document request, no main-frame navigation, a value set on `window`
//      at load is still there), the tiles are the SAME nodes and all in the document, the root names
//      the view, focus is on the pressed button, and the wall — whenever it is the view — has every
//      tile back under the parent the engine gave it. Screenshot after each: switch-*.png.
//   4. A CARD TURNS OVER in stack and in list (tap → html.open, Escape → put back), and on the wall
//      the engine's own door to a back is in its tile and has a box.
//   5. PRINT. Each view under print media, as a screenshot (print-*.png) and a count of tiles with a
//      box. Nothing is asserted: "as before" needs the pictures from --base to compare with.
//   6. A LONG CARD. 200 tiles, opened on stack: time from navigation start to the top card being on
//      the table, median of RUNS loads — and the same on --base when given, side by side.
//   7. THE EDITOR. /try/edit: the preview frame's window survives a stack → list change.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/deck-views.mjs
//   … --base /path/to/another/checkout     also serve THAT checkout's worker (e.g. a worktree of
//                                          main) and take its pictures as before-*.png, its timing
//                                          in step 6, and its print pictures
//   … --full                               every view at both window sizes, both specimens, and more
//                                          timing runs (minutes). The default is the short walk — each
//                                          opening view at the phone, stack at the desktop as well —
//                                          sized to finish inside run-all.mjs's 90 seconds a harness.
//   … --dry                                no browser: serve the pages, read the markup back, exit
//
// 🔴 What Chromium cannot show: iOS Safari's toolbar, its text inflation, and WebKit's own handling of
// the pile's 3D cards. This harness says nothing about those. Element.moveBefore exists in Chromium
// 133+; whether the run had it is printed, because without it a frame inside a tile reloads when the
// tile changes homes and with it it does not.
import http from 'node:http';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCard, PLAYWRIGHT, OUT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const BASE = args.includes('--base') ? resolve(args[args.indexOf('--base') + 1] || '') : '';
const FULL = args.includes('--full');
const RUNS = FULL ? 9 : 5;
const SHOTS = join(OUT, 'deck-views');
fs.mkdirSync(SHOTS, { recursive: true });

const VIEWS = ['stack', 'list', 'wall'];
const INNER = { stack: 'deck', list: 'list', wall: 'spread' };
// (the anchor is the claim line, in either spelling: `cardtile:` is accepted beside `card-page:`)
// 🔴 A specimen opens with comment lines above its frontmatter fence, and the deck reads `view:` only
// from a fence that starts the file (deck-page.mjs frontOf), as a real card file's does. Left on, the
// line below was written and never read: every page opened on stack and `--dry` said so.
const withView = (md, view) => md.slice(Math.max(0, md.indexOf('---\n'))).replace(/^((?:cardtile|card-page):.*)$/m, `$1\nview: ${view}`);
const long = (view) => ['---', 'card-page: long', 'title: Two hundred', `view: ${view}`, '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% Two hundred tiles.',
  ...Array.from({ length: 199 }, (_, i) => `- [ ] %% card: link w=${[2, 3, 6][i % 3]} %% [Tile ${i + 1}](https://example.com/${i + 1})`), ''].join('\n');
const CARDS = {};
for (const v of VIEWS) { CARDS[`rich-${v}`] = withView(readCard('specimen-rich'), v); CARDS[`plain-${v}`] = withView(readCard('specimen-plain'), v); }
CARDS['long-stack'] = long('stack');

const store = {
  get: async (h) => CARDS[h] ?? null,
  async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
};
// link marks are answered with a fixed pixel: a layout ruler must not depend on a third party (see spread-layout.mjs)
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function serve(w) {
  const server = http.createServer(async (req, res) => {
    try {
      if (/^\/_icon\/[^/]+\.ico$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); return; }
      const r = await w.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
      const b = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(b);
    } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}

const head = await serve(worker);
let base = null;
if (BASE) {
  const p = join(BASE, 'packages/cardtile/serve/card-worker.mjs');
  if (!fs.existsSync(p)) { console.log(`💥 --base ${BASE}: no packages/cardtile/serve/card-worker.mjs there`); process.exit(2); }
  base = await serve((await import(pathToFileURL(p).href)).default);
}
const done = () => { head.server.close(); if (base) base.server.close(); };

let bad = 0;
const fail = (msg) => { console.log('   🔴 ' + msg); bad++; };
const ok = (cond, msg) => { if (cond) console.log('   ✓ ' + msg); else fail(msg); };

if (DRY) {
  console.log('deck-views --dry: the pages this harness serves, read back without a browser');
  for (const h of Object.keys(CARDS)) {
    const r = await fetch(`${head.url}/${h}`); const t = await r.text();
    const m = /<html [^>]*data-view="(\w+)" data-views="([\w ]+)"/.exec(t);
    ok(r.status === 200 && !!m && h.endsWith(m[1]), `${h}: ${r.status}, opens on ${m ? m[1] : '?'} of [${m ? m[2] : '?'}]`);
  }
  done();
  console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ the harness serves what it says (nothing was looked at in a browser)');
  process.exit(bad ? 1 : 0);
}

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];
const sz = (v) => `${v.width}x${v.height}`;

// ── in the page ──────────────────────────────────────────────────────────────────────────────────
const TILES = 'main .st-cells > .st-cell, main .st-cells > .st-run > .st-cell, main .st-bleed > .st-cell';
/**
 * Remember the tiles on window, so a later call can compare identity — and where the ENGINE put each
 * one. 🔴 That second part is read from the served markup, fetched again and parsed apart from the
 * live page: on a page that opens on a pile the live tiles are already on their cards, and a
 * baseline taken from the live page the first time it shows the wall would agree with anything.
 */
async function remember(sel) {
  const tiles = [...document.querySelectorAll('main .st-cell')].filter((c) => !c.closest('.dc-drawer, .dc-drawer-body'));
  window.__vTiles = tiles;
  window.__vWhere = (root) => [...root.querySelectorAll(sel)].filter((c) => !c.closest('.dc-drawer, .dc-drawer-body, .deck-table'))
    .map((c) => `${c.parentElement.parentElement.className}>${c.parentElement.className}[${[...c.parentElement.children].indexOf(c)}]>${c.dataset.coralType || ''}`);
  const served = new DOMParser().parseFromString(await (await fetch(location.href)).text(), 'text/html');
  window.__vHomes = window.__vWhere(served);
  window.__vSentinel = window.__vSentinel || Math.random();
  return { tiles: tiles.length, homes: window.__vHomes.length, sentinel: window.__vSentinel };
}
function state() {
  const tiles = [...document.querySelectorAll('main .st-cell')].filter((c) => !c.closest('.dc-drawer, .dc-drawer-body'));
  const was = window.__vTiles || [];
  const root = document.documentElement, wall = !root.classList.contains('deck');
  const where = wall ? window.__vWhere(document) : null;
  const boxed = was.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
  const a = document.activeElement;
  return {
    view: root.dataset.view, cls: root.className, sentinel: window.__vSentinel,
    same: was.length === tiles.length && was.every((c) => tiles.includes(c)),
    connected: was.every((c) => c.isConnected),
    home: wall ? where.length === window.__vHomes.length && where.every((w, i) => w === window.__vHomes[i]) : null,
    seated: wall ? null : was.every((c) => c.parentNode.classList.contains('deck-front') && !!c.closest('.deck-table')),
    boxed, total: was.length,
    focus: a && a.closest('.deck-seg') ? a.dataset.m : (a ? a.tagName.toLowerCase() : ''),
    pressed: [...document.querySelectorAll('.deck-seg button[aria-pressed="true"]')].map((b) => b.dataset.m).join(','),
    scrollY: Math.round(scrollY), cur: typeof window.__deckCur === 'function' ? window.__deckCur() : null,
    open: root.classList.contains('open'), moveBefore: typeof Element.prototype.moveBefore === 'function',
    navEntries: performance.getEntriesByType('navigation').length,
  };
}

async function newPage(view, track) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const seen = { docs: 0, navs: 0, errs: [] };
  page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) seen.docs++; });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.navs++; });
  page.on('pageerror', (e) => seen.errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') seen.errs.push(m.text()); });
  if (track) await page.addInitScript(() => {
    window.__vShift = 0; window.__vTop = 0;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vShift += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { window.__vShift = -1; }
    // when the top card is first on the table (a page that opens on a pile)
    const look = () => { if (!window.__vTop && document.querySelector('.deck-stack > .deck-card.is-top')) window.__vTop = performance.now(); };
    new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  return { ctx, page, seen };
}
const settle = async (page, ms = 700) => { await page.waitForTimeout(ms); };   // a glide between piles takes 560 ms

// ── 1. before the deck's script ──────────────────────────────────────────────────────────────────
async function prepaint(handle, view, size) {
  const { ctx, page } = await newPage(size);
  await page.route(/\/_deck\/deck-[0-9a-f]+\.js$/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  const nav = page.goto(`${head.url}/${handle}`, { waitUntil: 'load' });
  await page.waitForSelector('footer.st-footer', { state: 'attached' });
  await page.waitForTimeout(600);
  const s = await page.evaluate((sel) => {
    const tiles = [...document.querySelectorAll(sel)].filter((c) => !c.closest('.dc-drawer'));
    return { deckRan: !!document.querySelector('.deck-bar'), cls: document.documentElement.className, view: document.documentElement.dataset.view,
      boxed: tiles.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, total: tiles.length };
  }, TILES);
  await page.screenshot({ path: join(SHOTS, `prepaint-${handle}-${sz(size)}.png`) });
  console.log(`  ${handle} ${sz(size)}  before deck.js: view=${s.view} class="${s.cls}" tiles with a box ${s.boxed}/${s.total}`);
  ok(!s.deckRan, 'CONTROL: deck.js had not run when the page was looked at');
  ok(s.view === view, `the markup opens on ${view}`);
  if (view === 'wall') ok(s.boxed === s.total && s.total > 0, 'a page that opens on the wall is showing the wall');
  else ok(s.boxed === 0 && s.total > 0, `a page that opens on ${view} is NOT showing the wall while the deck's script is on its way`);
  await nav; await ctx.close();
}

// ── 2 + 3 + 4. load, the six switches, a card turned over ────────────────────────────────────────
// every ordered pair, as one walk from each opening view
const WALK = { stack: ['list', 'wall', 'stack', 'wall', 'list', 'stack'], list: ['stack', 'wall', 'list', 'wall', 'stack', 'list'], wall: ['stack', 'list', 'wall', 'list', 'stack', 'wall'] };
const madePairs = new Set();
async function switches(handle, view, size) {
  const { ctx, page, seen } = await newPage(size, true);
  await page.goto(`${head.url}/${handle}`, { waitUntil: 'load' });
  await settle(page, 2000);
  const first = await page.evaluate(remember, TILES);
  const shift = await page.evaluate(() => window.__vShift);
  console.log(`  ${handle} ${sz(size)}  loaded: ${first.tiles} tiles, layout-shift ${shift}`);
  ok(first.tiles > 0 && first.homes === first.tiles, `CONTROL: the page has tiles, and the served markup places every one (${first.homes}/${first.tiles})`);
  if (shift < 0) console.log('   · layout-shift is not observable in this browser — not asserted');
  else ok(shift < 0.01, `no layout shift at load (sum ${shift.toFixed(4)})`);
  await page.screenshot({ path: join(SHOTS, `after-${handle}-${sz(size)}.png`) });
  const docs0 = seen.docs, navs0 = seen.navs;
  let at = view; const turned = new Set();
  for (const to of WALK[view]) {
    const btn = page.locator(`.deck-seg button[data-m="${INNER[to]}"]`);
    await btn.focus(); await page.keyboard.press('Enter');
    await settle(page);
    const s = await page.evaluate(state);
    madePairs.add(`${at}>${to}`);
    const tag = `${at} → ${to}`;
    console.log(`    ${tag.padEnd(14)} view=${s.view} scrollY=${s.scrollY} cur=${s.cur} focus=${s.focus} boxed=${s.boxed}/${s.total} moveBefore=${s.moveBefore}`);
    ok(seen.docs === docs0 && seen.navs === navs0 && s.sentinel === first.sentinel && s.navEntries === 1, `${tag}: no navigation`);
    ok(s.same && s.connected, `${tag}: the tiles are the same nodes, all in the document`);
    ok(s.view === to && s.pressed === INNER[to], `${tag}: the root and the switcher name ${to}`);
    ok(s.focus === INNER[to], `${tag}: focus is on the pressed button`);
    if (to === 'wall') ok(s.home === true && s.boxed === s.total, `${tag}: every tile is back under the engine's parent, with a box`);
    else ok(s.seated === true, `${tag}: every tile is the front of a card on the table`);
    await page.screenshot({ path: join(SHOTS, `switch-${handle}-${sz(size)}-${at}-${to}.png`) });
    // 4. a card turns over in a pile, and is put back
    if (to !== 'wall' && handle.startsWith('rich') && !turned.has(to)) {
      turned.add(to);
      await settle(page, 1200);   // coming from the wall the pile is dealt, and the top card lands last
      const flip = await page.evaluate(async () => {
        const top = document.querySelector('.deck-card.is-top.can-flip'); if (!top) return 'none';
        const r = top.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 24 };
      });
      if (flip === 'none') console.log('   · the top card has no back — not turned over');
      else {
        await page.mouse.click(flip.x, flip.y); await settle(page, 900);
        const opened = await page.evaluate(() => document.documentElement.classList.contains('open'));
        await page.keyboard.press('Escape'); await settle(page, 900);
        const closed = await page.evaluate(() => !document.documentElement.classList.contains('open'));
        ok(opened && closed, `${to}: the top card turns over on a tap and goes back on Escape`);
        await btn.focus();
      }
    }
    if (to === 'wall' && handle.startsWith('rich')) {
      const door = await page.evaluate(() => { const d = document.querySelector('main .st-cell [data-drawer]'); if (!d) return null; const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (door == null) console.log('   · this card has no tile with a back — the door is not checked');
      else ok(door, 'wall: the engine\'s way into a back is in its tile and has a box');
    }
    at = to;
  }
  ok(seen.errs.length === 0, `no console errors (${seen.errs.slice(0, 3).join(' | ') || 'none'})`);
  await ctx.close();
}

// ── 5. print ─────────────────────────────────────────────────────────────────────────────────────
async function print(origin, name, handle) {
  const { ctx, page } = await newPage(SIZES[1]);
  await page.goto(`${origin}/${handle}`, { waitUntil: 'load' }); await settle(page, 1500);
  await page.emulateMedia({ media: 'print' }); await settle(page, 300);
  const boxed = await page.evaluate(() => [...document.querySelectorAll('.st-cell')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length);
  await page.screenshot({ path: join(SHOTS, `print-${name}-${handle}.png`), fullPage: true });
  console.log(`  print ${name} ${handle}: ${boxed} tiles with a box`);
  await ctx.close();
}

// ── 6. a long Card ───────────────────────────────────────────────────────────────────────────────
async function timeLong(origin) {
  const t = [];
  for (let i = 0; i < RUNS; i++) {
    const { ctx, page } = await newPage(SIZES[0], true);
    await page.goto(`${origin}/long-stack`, { waitUntil: 'load' }); await settle(page, 400);
    const r = await page.evaluate(() => ({ top: window.__vTop, load: performance.getEntriesByType('navigation')[0].loadEventEnd, cards: document.querySelectorAll('.deck-stack > .deck-card').length }));
    t.push(r); await ctx.close();
  }
  const med = (k) => { const a = t.map((x) => x[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
  return { top: med('top'), load: med('load'), cards: t[0].cards };
}

// ── 7. the editor ────────────────────────────────────────────────────────────────────────────────
async function editor() {
  const { ctx, page, seen } = await newPage(SIZES[1]);
  await page.goto(`${head.url}/try/edit`, { waitUntil: 'load' }); await settle(page, 2500);
  const ready = await page.evaluate(() => { const p = document.getElementById('preview'), f = document.getElementById('deckframe'); return !!(p && !p.hidden && f && f.contentWindow && typeof f.contentWindow.__deckView === 'function'); });
  if (!ready) { console.log('  · the editor did not open on its preview here (an empty draft opens on the row) — step 7 NOT checked'); await ctx.close(); return; }
  const before = await page.evaluate(() => { const w = document.getElementById('deckframe').contentWindow; w.__vSentinel = Math.random(); return { s: w.__vSentinel, view: w.document.documentElement.dataset.view }; });
  const other = before.view === 'list' ? 'stack' : 'list';
  await page.click(`.modes button[data-view="${other}"]`); await settle(page, 1200);
  const after = await page.evaluate(() => { const w = document.getElementById('deckframe').contentWindow; return { s: w.__vSentinel, view: w.document.documentElement.dataset.view }; });
  console.log(`  editor: ${before.view} → ${other}; the frame's window ${after.s === before.s ? 'survived' : 'was replaced'}; it shows ${after.view}`);
  ok(after.s === before.s, 'the editor\'s preview frame was not handed the document again');
  ok(after.view === other, `the preview shows ${other}`);
  ok(seen.errs.length === 0, `no console errors (${seen.errs.slice(0, 3).join(' | ') || 'none'})`);
  await ctx.close();
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
console.log('── 1. before the deck\'s script');
// the walk: [specimen, opening view, window]. Short by default; --full is the whole matrix.
const PLAN = FULL
  ? ['rich', 'plain'].flatMap((h) => VIEWS.flatMap((v) => SIZES.map((s) => [h, v, s])))
  : [...VIEWS.map((v) => ['rich', v, SIZES[0]]), ['rich', 'stack', SIZES[1]]];
console.log(FULL ? '(--full: every view, both sizes, both specimens)' : '(the short walk — --full for every view at both sizes and both specimens)');
for (const [h, v, s] of PLAN) if (h === 'rich') await prepaint(`rich-${v}`, v, s);
console.log('── 2–4. load, the six switches, a card turned over');
for (const [h, v, s] of PLAN) await switches(`${h}-${v}`, v, s);
const pairs = VIEWS.flatMap((a) => VIEWS.filter((b) => b !== a).map((b) => `${a}>${b}`));
ok(pairs.every((p) => madePairs.has(p)), `every ordered pair was made (${[...madePairs].sort().join(' ')})`);
if (base) {
  console.log('── before: the same pages from --base');
  for (const [h, v, s] of PLAN) {
    if (h !== 'rich') continue;
    const { ctx, page } = await newPage(s);
    await page.goto(`${base.url}/rich-${v}`, { waitUntil: 'load' }); await settle(page, 2000);
    await page.screenshot({ path: join(SHOTS, `before-rich-${v}-${sz(s)}.png`) });
    await ctx.close();
  }
}
console.log('── 5. print (pictures only)');
for (const v of VIEWS) { await print(head.url, 'after', `rich-${v}`); if (base) await print(base.url, 'before', `rich-${v}`); }
console.log(`── 6. 200 tiles, opened on stack (median of ${RUNS})`);
{
  const now = await timeLong(head.url);
  console.log(`  this checkout: top card on the table at ${now.top.toFixed(0)} ms, load event ${now.load.toFixed(0)} ms, ${now.cards} cards on the table`);
  ok(now.top > 0, 'the pile was dealt');
  if (base) {
    const was = await timeLong(base.url);
    console.log(`  --base:        top card on the table at ${was.top.toFixed(0)} ms, load event ${was.load.toFixed(0)} ms, ${was.cards} cards on the table`);
    ok(now.top <= was.top * 1.15 + 20, `not slower to open than --base (now ${now.top.toFixed(0)} ms, was ${was.top.toFixed(0)} ms; allowance 15% + 20 ms)`);
  } else console.log('  · no --base: the number above has nothing to be compared with');
}
console.log('── 7. the editor\'s preview');
await editor();

await browser.close(); done();
console.log(`\npictures: ${SHOTS}`);
console.log(bad ? `🔴 ${bad} problem(s)` : '✅ stack, list and wall are one set of nodes here');
process.exit(bad ? 1 : 0);
