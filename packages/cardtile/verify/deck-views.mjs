// Stack, list and wall are one set of nodes (tile#297) — asked of a real browser, because the unit
// suite (w3/deck-views.test.mjs) runs the deck in a stand-in DOM with no layout and no paint.
//
// One run = ONE engine, one browser instance, one page at a time. What it measures:
//
//   prepaint  FIRST PAINT. deck.js is held back for a second and a half. From the first animation
//             frame to after `load`, EVERY frame counts the engine's tiles that have a box: a page
//             that opens on a pile must never show one (no wall-then-pile flash); a page that opens
//             on the wall must show them all before the script arrives. Pictures while waiting, at
//             DOMContentLoaded and at load; the browser's own layout-shift sum at load. With --base
//             the same ruler is laid on that checkout, where it is EXPECTED to see the flash — a
//             ruler that has never been seen to fire is not trusted here.
//   walk      THE SIX SWITCHES, by keyboard (focus the button, Enter), until every ordered pair has
//             been made. Counted across each switch alone: main-frame `framenavigated`, document
//             requests, `beforeunload`, and a value on `window` set at load. The tiles are the SAME
//             nodes, all in the document; the root names the view; focus is on the pressed button;
//             on the wall every tile is back under the parent the engine gave it, with a box.
//             Then, in each pile: a card with a back of its own is turned over and put back (also
//             after a trip through the wall). On each wall: the engine's drawer is opened from its
//             tile and closed (also after a trip through a pile). An `embed` frame is asked for
//             the random word it wrote when it loaded, before and after every switch: a changed
//             word is a reload. 🔴 That is REPORTED, per engine, and only held as a failure where
//             the browser has Element.moveBefore (without it a moved frame loads again; --base
//             reloads the whole page).
//   print     each view under print media: a picture and the count of tiles with a box, beside --base
//   boot      THE DECK DOES NOT COME UP: the script fails to load, throws at its first line, throws
//             half-way through building the pile, or is merely slow. Each must leave the wall on
//             screen (every tile with a box), never an empty table.
//   long      200 tiles: the six switches, and the time from navigation start to the top card being
//             on the table — interleaved with --base, medians side by side.
//   editor    /try/edit with a card in it: the preview frame changes view in place (its window
//             survives), and hiding and showing the frame keeps the pile on the card it was on.
//   file      a page that carries its items as a card file (data-card-src → window.__cardMd): the
//             file wall (virtualBrick), the pile over it, and the switches between them.
//             🔴 SYNTHETIC: no page in this repository is served that way. The specimen is a Card
//             page of this Worker with the attribute, a cover template and a file added, built from
//             what deck.js reads. It shows that the code path runs; it is not a real page's shape.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/deck-views.mjs
//   … --engine chromium|webkit   (default chromium). The PLAYWRIGHT given must be one whose browser
//                                revision is installed; the run prints both versions.
//   … --base /path/to/checkout   also serve THAT checkout's worker (a worktree of main): its
//                                pictures are before-*, its numbers stand beside this checkout's
//   … --full                     both window sizes, every opening view, more timing runs (minutes).
//                                The default is a short walk sized for run-all.mjs's 90 seconds.
//   … --no-move-before           take Element.moveBefore away before the page runs: the path WebKit and
//                                Firefox take today. 🔴 Still Chromium underneath — it shows what the
//                                fallback does to a frame, not how another engine paints.
//   … --only a,b                 just these steps (prepaint walk print boot long editor file before)
//   … --dry                      no browser: serve the pages, read the markup back, exit
//
// Pictures: out/card-verify/deck-views/<engine>/ (walk/ holds one per switch), listed in
// out/card-verify/deck-views/INDEX.md; every check and number also lands in results-<engine>.json.
//
// 🔴 What no desktop engine shows: iOS Safari's toolbar, its text inflation, a finger. Playwright's
// WebKit is the WebKit engine on this OS, not Safari on a phone.
import http from 'node:http';
import fs from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCard, PLAYWRIGHT, OUT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
const DRY = args.includes('--dry');
const BASE = opt('--base') ? resolve(opt('--base')) : '';
const FULL = args.includes('--full');
const ENGINE = opt('--engine') || 'chromium';
const NOMB = args.includes('--no-move-before');   // take Element.moveBefore away: the path a browser without it takes
const LABEL = ENGINE + (NOMB ? '-no-movebefore' : '');
const ONLY = opt('--only') ? opt('--only').split(',') : null;
const want = (step) => !ONLY || ONLY.includes(step);
const RUNS = FULL ? 7 : 3;
const ROOT = join(OUT, 'deck-views'), SHOTS = join(ROOT, LABEL);
fs.mkdirSync(join(SHOTS, 'walk'), { recursive: true });

const VIEWS = ['stack', 'list', 'wall'];
const INNER = { stack: 'deck', list: 'list', wall: 'spread' };
// (the anchor is the claim line, in either spelling: `cardtile:` is accepted beside `card-page:`)
// 🔴 A specimen opens with comment lines above its frontmatter fence, and the deck reads `view:` only
// from a fence that starts the file (deck-page.mjs frontOf), as a real card file's does. Left on, the
// line below was written and never read: every page opened on stack and `--dry` said so.
const withView = (md, view) => md.slice(Math.max(0, md.indexOf('---\n'))).replace(/^((?:cardtile|card-page):.*)$/m, `$1\nview: ${view}`);
/** a link-in-bio Card: a run of full-width links, two tiles with a back of their own, an embed */
const bio = (view) => ['---', 'card-page: bio', 'title: Specimen — Bio', `view: ${view}`, '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% A link-in-bio specimen.',
  '- [ ] %% card: text w=6 back=#about %% Turn me over: I have a back of my own.',
  '- [ ] %% card: link w=6 %% [Shop](https://example.com/shop)',
  '- [ ] %% card: link w=6 %% [Newsletter](https://example.com/news)',
  '- [ ] %% card: link w=6 %% [Podcast](https://example.com/pod)',
  '- [ ] %% card: embed w=6 %% <p id="t" style="font:600 22px system-ui;text-align:center;margin-top:40%"></p><script>document.getElementById("t").textContent="embed "+Math.random().toString(36).slice(2,8)</script>',
  '- [ ] %% card: link w=3 %% [Left](https://example.com/l)',
  '- [ ] %% card: link w=3 %% [Right](https://example.com/r)',
  '- [ ] %% card: feature w=6 href="#about" %% A feature that opens the same back.',
  '- [ ] %% card: text w=6 %% A last word.',
  '', '', '## back: about | About', '', '- [ ] %% card: text %% The back of the card: who this is.', ''].join('\n');
const long = (view) => ['---', 'card-page: long', 'title: Two hundred', `view: ${view}`, '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% Two hundred tiles.',
  ...Array.from({ length: 199 }, (_, i) => `- [ ] %% card: link w=${[2, 3, 6][i % 3]} %% [Tile ${i + 1}](https://example.com/${i + 1})`), ''].join('\n');
const fileHost = (view) => ['---', 'card-page: filehost', 'title: Numbers', `view: ${view}`, '---', '', '## cards', '', '- [ ] %% card: profile w=6 %% A page whose items are a card file.', ''].join('\n');
const FILE_N = 600;
const fileMd = (view) => ['---', 'title: Numbers', `view: ${view}`, '---', '', '## cards', '',
  ...Array.from({ length: FILE_N }, (_, i) => `- [ ] %% card: text${i === 6 ? ' back=#rare' : ''} %% ${i + 1}`), '', '## back: rare | Rare', '', '- [ ] %% card: text %% A rare one', ''].join('\n');
const CARDS = {};
for (const v of VIEWS) { CARDS[`bio-${v}`] = bio(v); CARDS[`long-${v}`] = long(v); CARDS[`rich-${v}`] = withView(readCard('specimen-rich'), v); CARDS[`filehost-${v}`] = fileHost(v); }

const store = {
  get: async (h) => CARDS[h] ?? null,
  async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
};
// link marks are answered with a fixed pixel: a layout ruler must not depend on a third party (see spread-layout.mjs)
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function serve(w) {
  const ask = async (path) => w.fetch(new Request('http://x' + path), { CARDS: store, PREVIEW: 'true' });
  const server = http.createServer(async (req, res) => {
    try {
      if (/^\/_icon\/[^/]+\.ico$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); return; }
      // the card-file specimen (see the header: synthetic)
      const f = /^\/file-(stack|list|wall)$/.exec(req.url), fm = /^\/_file\/(stack|list|wall)\.card\.md$/.exec(req.url);
      if (fm) { res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); res.end(fileMd(fm[1])); return; }
      if (f) {
        const r = await ask(`/filehost-${f[1]}`); let t = await r.text();
        t = t.replace('<html', `<html data-card-src="/_file/${f[1]}.card.md"`);
        let cut = t.lastIndexOf('<script>window.'); if (cut < 0) cut = t.lastIndexOf('</body>');   // the cover template goes before the deck's own scripts, as markup would
        t = t.slice(0, cut) + '<template id="md-cover"><div class="st-cell md-cover-specimen" style="grid-column:1/-1"><h2>Numbers</h2><p data-range></p></div></template>' + t.slice(cut);
        const h = Object.fromEntries(r.headers); delete h['content-length'];
        res.writeHead(r.status, h); res.end(t); return;
      }
      const r = await ask(req.url);
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

// every check and number is kept, with where it was taken, for the table in results-<engine>.json
const results = { engine: LABEL, full: FULL, checks: [], numbers: [], notes: [], shots: [] };
let bad = 0, CTX = { step: '', specimen: '', view: '', size: '' };
const at = (step, specimen = '', view = '', size = '') => { CTX = { step, specimen, view, size }; };
const fail = (msg) => { console.log('   🔴 ' + msg); bad++; };
const ok = (cond, msg, key) => { results.checks.push({ ...CTX, key: key || msg, pass: !!cond, msg }); if (cond) console.log('   ✓ ' + msg); else fail(msg); return !!cond; };
const num = (key, value, unit = '') => { results.numbers.push({ ...CTX, key, value, unit }); };
const note = (msg) => { results.notes.push({ ...CTX, msg }); console.log('   ⚠ ' + msg); };

if (DRY) {
  console.log('deck-views --dry: the pages this harness serves, read back without a browser');
  for (const h of [...Object.keys(CARDS), ...VIEWS.map((v) => `file-${v}`)]) {
    const r = await fetch(`${head.url}/${h}`); const t = await r.text();
    const m = /<html [^>]*data-view="(\w+)" data-views="([\w ]+)"/.exec(t);
    ok(r.status === 200 && !!m && h.endsWith(m[1]), `${h}: ${r.status}, opens on ${m ? m[1] : '?'} of [${m ? m[2] : '?'}]`);
    if (h.startsWith('file-')) ok(/<html data-card-src="\/_file\//.test(t) && t.split('<template id="md-cover">').length === 2 && t.trimEnd().endsWith('</body></html>'), `${h}: carries its card file's address and a cover`);
  }
  { const t = await (await fetch(`${head.url}/_file/stack.card.md`)).text(); ok(t.split('\n').filter((l) => l.startsWith('- [ ] %% card: text')).length === FILE_N + 1, `the card file has ${FILE_N} items and one back line`); }
  done();
  console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ the harness serves what it says (nothing was looked at in a browser)');
  process.exit(bad ? 1 : 0);
}

const mod = await import(PLAYWRIGHT); const pw = mod.default || mod;
// which Playwright, which browser: said out loud, because "it ran in WebKit" is only worth the revision it ran in
const pwCore = [dirname(PLAYWRIGHT), join(dirname(PLAYWRIGHT), '../playwright-core')].find((d) => fs.existsSync(join(d, 'browsers.json')));
const pwVersion = pwCore ? JSON.parse(fs.readFileSync(join(pwCore, 'package.json'), 'utf8')).version : '?';
const pwRev = pwCore ? (JSON.parse(fs.readFileSync(join(pwCore, 'browsers.json'), 'utf8')).browsers.find((b) => b.name === ENGINE) || {}).revision : '?';
if (!pw[ENGINE]) { console.log(`💥 --engine ${ENGINE}: this Playwright has no such engine`); done(); process.exit(2); }
let browser;
try { browser = await pw[ENGINE].launch(); } catch (e) { console.log(`💥 ${ENGINE} did not launch (playwright ${pwVersion}, revision ${pwRev}):\n${e && e.message || e}`); done(); process.exit(2); }
results.playwright = pwVersion; results.revision = pwRev; results.browserVersion = browser.version();
console.log(`engine: ${LABEL} ${browser.version()} (playwright ${pwVersion}, browser revision ${pwRev})${base ? `; --base ${BASE}` : ''}`);
const PHONE = { width: 390, height: 844 }, DESK = { width: 1280, height: 800 };
const SIZES = FULL ? [PHONE, DESK] : [PHONE];
const sz = (v) => `${v.width}x${v.height}`;
const shot = async (page, rel, desc, o = {}) => { try { await page.screenshot({ path: join(SHOTS, rel), ...o }); results.shots.push({ file: `${LABEL}/${rel}`, desc }); } catch (e) { note(`no picture ${rel}: ${String(e && e.message || e).split('\n')[0]}`); } };

// ── in the page ──────────────────────────────────────────────────────────────────────────────────
const TILES = 'main .st-cells > .st-cell, main .st-cells > .st-run > .st-cell, main .st-bleed > .st-cell';
/** runs in every document before its own scripts: the per-frame ruler, the layout-shift sum, the unload count */
function ruler(sel) {
  if (window.top !== window) return;
  const s = window.__vS = { frames: 0, maxWall: 0, wallAtFirst: -1, top: 0, landed: 0, shift: 0, stop: false };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) s.shift += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { s.shift = -1; }
  addEventListener('beforeunload', () => { try { sessionStorage.setItem('__vUnload', String((+sessionStorage.getItem('__vUnload') || 0) + 1)); } catch { /* no storage */ } });
  const tick = () => {
    if (document.body) {
      s.frames++;
      if (!s.stop) {   // the engine's tiles that have a box and are NOT on a card: what a visitor sees of the wall
        let n = 0; for (const c of document.querySelectorAll(sel)) { if (c.closest('.deck-table,.dc-drawer')) continue; const r = c.getBoundingClientRect(); if (r.width > 0 && r.height > 0) n++; }
        if (s.wallAtFirst < 0 && document.querySelector('footer.st-footer')) s.wallAtFirst = n;
        if (n > s.maxWall) s.maxWall = n;
      }
      const t = document.querySelector('.deck-stack > .deck-card.is-top');
      if (t && !s.top) s.top = performance.now();
      if (t && !s.landed && t.style.opacity !== '0') s.landed = performance.now();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/**
 * Remember the tiles on window, so a later call can compare identity — and where the ENGINE put each
 * one. 🔴 That second part is read from the served markup, fetched again and parsed apart from the
 * live page: on a page that opens on a pile the live tiles are already on their cards, and a
 * baseline taken from the live page the first time it shows the wall would agree with anything.
 */
async function remember(sel) {
  const tiles = [...document.querySelectorAll('main .st-cell')].filter((c) => !c.closest('.dc-drawer, .dc-drawer-body, .deck-back') && !c.classList.contains('deck-ours') && !c.classList.contains('vb-cover'));
  window.__vTiles = tiles;
  window.__vWhere = (root) => [...root.querySelectorAll(sel)].filter((c) => !c.closest('.dc-drawer, .dc-drawer-body, .deck-table') && !c.classList.contains('vb-cover'))
    .map((c) => `${c.parentElement.parentElement.className.replace(/\s*\bvb\b/, '')}>${c.parentElement.className.replace(/\s*\bvb\b/, '')}[${[...c.parentElement.children].filter((x) => !x.classList.contains('vb-cover') && !x.classList.contains('vb-space')).indexOf(c)}]>${c.dataset.coralType || ''}`);
  const served = new DOMParser().parseFromString(await (await fetch(location.href)).text(), 'text/html');
  window.__vHomes = window.__vWhere(served);
  window.__vSentinel = window.__vSentinel || Math.random();
  return { tiles: tiles.length, homes: window.__vHomes.length, sentinel: window.__vSentinel };
}
function state() {
  const was = window.__vTiles || [];
  const tiles = new Set([...document.querySelectorAll('main .st-cell')]);
  const root = document.documentElement, wall = !root.classList.contains('deck');
  const where = wall ? window.__vWhere(document) : null;
  const boxed = was.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
  const a = document.activeElement;
  const top = document.querySelector('.deck-stack > .deck-card.is-top');
  let unload = 0; try { unload = +sessionStorage.getItem('__vUnload') || 0; } catch { /* none */ }
  return {
    view: root.dataset.view, cls: root.className, sentinel: window.__vSentinel, unload,
    same: was.every((c) => tiles.has(c)), connected: was.every((c) => c.isConnected),
    home: wall ? where.length === window.__vHomes.length && where.every((w, i) => w === window.__vHomes[i]) : null,
    // in a pile a tile is the front of a card — or, in a long Card, still where the engine put it until the pile reaches it
    seated: wall ? null : was.every((c) => (c.parentNode.classList.contains('deck-front') && !!c.closest('.deck-table')) || !c.closest('.deck-table')),
    onCards: was.filter((c) => c.parentNode.classList.contains('deck-front')).length,
    topHolds: wall ? null : !!(top && top.querySelector('.deck-front > .st-cell, .deck-front > .deck-ours, .deck-front > div')),
    boxed, total: was.length,
    focus: a && a.closest('.deck-seg') ? a.dataset.m : (a ? a.tagName.toLowerCase() : ''),
    pressed: [...document.querySelectorAll('.deck-seg button[aria-pressed="true"]')].map((b) => b.dataset.m).join(','),
    scrollY: Math.round(scrollY), cur: typeof window.__deckCur === 'function' ? window.__deckCur() : null,
    moveBefore: typeof Element.prototype.moveBefore === 'function',
  };
}

async function newPage(size) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const seen = { docs: 0, navs: 0, childNavs: 0, errs: [] };
  page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) seen.docs++; });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.navs++; else seen.childNavs++; });
  page.on('pageerror', (e) => seen.errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') seen.errs.push(m.text()); });
  await page.addInitScript(ruler, TILES);
  if (NOMB) await page.addInitScript(() => { try { delete Element.prototype.moveBefore; } catch { /* not there */ } });
  return { ctx, page, seen };
}
const settle = async (page, ms = 700) => { await page.waitForTimeout(ms); };   // a glide between piles takes 560 ms
const DECK_JS_URL = /\/_deck\/deck-[0-9a-f]+\.js$/;

// ── prepaint: the first paint, with the deck's script held back ──────────────────────────────────
const HOLD = 1500;
async function prepaint(origin, tag, handle, view, size) {
  at('prepaint', handle.split('-')[0], view, sz(size));
  const { ctx, page } = await newPage(size);
  let held = 0;
  await page.route(DECK_JS_URL, async (route) => { held++; await new Promise((r) => setTimeout(r, HOLD)); await route.continue(); });
  const name = `firstpaint-${tag}-${handle}-${sz(size)}`;
  const dcl = page.waitForEvent('domcontentloaded').then(() => shot(page, `${name}-2-domcontentloaded.png`, `${tag}: ${handle} at ${sz(size)}, at DOMContentLoaded (deck.js was held back ${HOLD} ms)`));
  const nav = page.goto(`${origin}/${handle}`, { waitUntil: 'load' });
  await page.waitForSelector('footer.st-footer', { state: 'attached' });
  await page.waitForTimeout(600);
  const w = await page.evaluate((sel) => {
    const tiles = [...document.querySelectorAll(sel)].filter((c) => !c.closest('.dc-drawer'));
    return { deckRan: !!document.querySelector('.deck-bar'), cls: document.documentElement.className, view: document.documentElement.dataset.view || '',
      boxed: tiles.filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, total: tiles.length };
  }, TILES);
  await shot(page, `${name}-1-waiting.png`, `${tag}: ${handle} at ${sz(size)}, while deck.js is still on its way`);
  await nav; await dcl;
  await shot(page, `${name}-3-load.png`, `${tag}: ${handle} at ${sz(size)}, at load`);
  await page.waitForTimeout(1200);
  const s = await page.evaluate(() => { window.__vS.stop = true; return { ...window.__vS, cls: document.documentElement.className, view: document.documentElement.dataset.view || '' }; });
  console.log(`  ${tag} ${handle} ${sz(size)}  waiting: class="${w.cls}" tiles with a box ${w.boxed}/${w.total} · over ${s.frames} frames the wall showed at most ${s.maxWall} tiles · layout-shift ${s.shift < 0 ? 'n/a' : s.shift.toFixed(4)} · ends on class="${s.cls}"`);
  num(`${tag}:maxWallTiles`, s.maxWall); num(`${tag}:cls-held`, s.shift);
  if (tag === 'after') {
    ok(held === 1 && !w.deckRan, 'CONTROL: deck.js was held back and had not run when the page was looked at', 'prepaint:control');
    ok(w.view === view, `the markup opens on ${view}`, 'prepaint:markup');
    if (view === 'wall') ok(w.boxed === w.total && w.total > 0 && s.maxWall === w.total, 'a page that opens on the wall shows the wall from its first frame', 'prepaint:no-flash');
    else ok(w.boxed === 0 && w.total > 0 && s.maxWall === 0 && s.frames > 5, `a page that opens on ${view} never shows a wall tile, in any of ${s.frames} frames from first frame to after load`, 'prepaint:no-flash');
    if (s.shift < 0) note('layout-shift is not observable in this engine — the number is not available here');
    else ok(s.shift < 0.01, `no layout shift with the script held back (sum ${s.shift.toFixed(4)})`, 'prepaint:cls');
  } else if (view !== 'wall') {
    // the same ruler on the checkout that is known to draw the wall first
    ok(s.maxWall > 0, `CONTROL (--base): the ruler sees the wall before the pile there (${s.maxWall} tiles) — it can fire`, 'prepaint:ruler-fires-on-base');
  }
  await ctx.close();
}

// ── walk: load, the six switches, a card turned over, the drawer, the embed ──────────────────────
// every ordered pair, as one walk from each opening view
const WALK = { stack: ['list', 'wall', 'stack', 'wall', 'list', 'stack'], list: ['stack', 'wall', 'list', 'wall', 'stack', 'list'], wall: ['stack', 'list', 'wall', 'list', 'stack', 'wall'] };
const madePairs = new Set();
const embedWord = async (page) => { for (const f of page.frames()) { if (f === page.mainFrame()) continue; try { const t = await f.evaluate(() => { const e = document.getElementById('t'); return e ? e.textContent : null; }); if (t && t.startsWith('embed ')) return t; } catch { /* a frame on its way */ } } return null; };
const drawerShown = (page) => page.evaluate(() => {
  const p = document.querySelector('[data-drawer-panel="about"]'); if (!p) return { on: false, why: 'no panel' };
  const cs = getComputedStyle(p), r = p.getBoundingClientRect();
  return { on: cs.visibility === 'visible' && Number(cs.opacity) > 0.5 && r.width > 100 && r.top < innerHeight && r.bottom > 0, text: p.textContent.includes('The back of the card') };
});
async function walk(handle, view, size, pics) {
  const spec = handle.split('-')[0];
  at('walk', spec, view, sz(size));
  const { ctx, page, seen } = await newPage(size);
  await page.goto(`${head.url}/${handle}`, { waitUntil: 'load' });
  await settle(page, 2000);
  const first = await page.evaluate(remember, TILES);
  const s0 = await page.evaluate(() => ({ shift: window.__vS.shift, maxWall: window.__vS.maxWall }));
  console.log(`  ${handle} ${sz(size)}  loaded: ${first.tiles} tiles, layout-shift ${s0.shift < 0 ? 'n/a' : s0.shift.toFixed(4)}`);
  ok(first.tiles > 0 && first.homes === first.tiles, `CONTROL: the page has tiles, and the served markup places every one (${first.homes}/${first.tiles})`, 'walk:control');
  num('cls-load', s0.shift);
  if (s0.shift >= 0) ok(s0.shift < 0.01, `no layout shift at load (sum ${s0.shift.toFixed(4)})`, 'load:cls');
  if (view !== 'wall') ok(s0.maxWall === 0, 'unhindered load: no frame showed a wall tile', 'load:no-flash');
  await shot(page, `after-${handle}-${sz(size)}.png`, `after (this branch): ${spec} opened on ${view} at ${sz(size)}`);
  let word = spec === 'bio' ? await embedWord(page) : null;
  if (spec === 'bio') ok(!!word, `CONTROL: the embed frame loaded and wrote its word (${word})`, 'embed:control');
  let from = view, wasWall = view === 'wall', wasPile = view !== 'wall'; const flips = { stack: 0, list: 0 }; let drawers = 0;
  for (const to of WALK[view]) {
    const btn = page.locator(`.deck-seg button[data-m="${INNER[to]}"]`);
    const b4 = { docs: seen.docs, navs: seen.navs, unload: (await page.evaluate(state)).unload };
    if (spec === 'bio') word = await embedWord(page);   // just before the switch: what happens in between (a card turned over) is asked separately
    await btn.focus(); await page.keyboard.press('Enter');
    await settle(page);
    const s = await page.evaluate(state);
    madePairs.add(`${from}>${to}`);
    const tag = `${from} → ${to}`;
    console.log(`    ${tag.padEnd(14)} view=${s.view} scrollY=${s.scrollY} cur=${s.cur} focus=${s.focus} boxed=${s.boxed}/${s.total} onCards=${s.onCards} moveBefore=${s.moveBefore}`);
    ok(seen.docs === b4.docs && seen.navs === b4.navs && s.unload === b4.unload && s.sentinel === first.sentinel, `${tag}: no navigation (framenavigated +${seen.navs - b4.navs}, document requests +${seen.docs - b4.docs}, beforeunload +${s.unload - b4.unload})`, `switch:${from}>${to}:no-navigation`);
    ok(s.same && s.connected, `${tag}: the tiles are the same nodes, all in the document`, `switch:${from}>${to}:same-nodes`);
    ok(s.view === to && s.pressed === INNER[to], `${tag}: the root and the switcher name ${to}`, `switch:${from}>${to}:names-view`);
    ok(s.focus === INNER[to], `${tag}: focus is on the pressed button`, `switch:${from}>${to}:focus`);
    if (to === 'wall') ok(s.home === true && s.boxed === s.total, `${tag}: every tile is back under the engine's parent, with a box (${s.boxed}/${s.total})`, `switch:${from}>${to}:placed`);
    else ok(s.seated === true && s.onCards > 0 && s.topHolds, `${tag}: the tiles are the fronts of cards on the table (${s.onCards} dealt)`, `switch:${from}>${to}:placed`);
    if (pics) await shot(page, `walk/switch-${handle}-${sz(size)}-${from}-${to}.png`, `${handle} at ${sz(size)}: after ${tag}`);
    if (spec === 'bio') {
      // the embed: did its frame load again?
      await settle(page, 300);
      const now = await embedWord(page);
      const reloaded = now !== word;
      results.numbers.push({ ...CTX, key: `embed-reload:${from}>${to}`, value: reloaded ? 1 : 0, unit: s.moveBefore ? 'moveBefore' : 'no moveBefore' });
      if (from === 'wall' || to === 'wall') {
        if (s.moveBefore) ok(!reloaded, `${tag}: the embed frame kept its document (${word} → ${now})`, `embed:${from}>${to}`);
        else if (reloaded) note(`${tag}: the embed frame LOADED AGAIN (${word} → ${now}) — this engine has no Element.moveBefore`);
        else console.log(`   · ${tag}: the embed frame kept its document without moveBefore`);
      } else if (s.moveBefore) ok(!reloaded, `${tag}: the embed frame kept its document (the cards are re-ordered, not re-inserted)`, `embed:${from}>${to}`);
      else if (reloaded) note(`${tag}: the embed frame LOADED AGAIN (${word} → ${now}) — the pile re-orders its cards, and without Element.moveBefore that is an insert`);
      word = now;
      // a card with a back of its own turns over and goes back — in each pile, and again after the wall
      if (to !== 'wall' && (flips[to] === 0 || wasWall)) {
        flips[to]++;
        await settle(page, 1300);   // coming from the wall the pile is dealt, and the top card lands last
        const w0 = await embedWord(page);
        await page.evaluate(() => window.__deckJump && window.__deckJump(1)); await settle(page, 900);   // tile 1 names a back
        const c = await page.evaluate(() => { const t = document.querySelector('.deck-card.is-top.can-flip'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(60, r.height / 4) }; });
        if (!c) fail(`${to}: the card of the tile that names a back cannot be turned over`);
        else {
          await page.mouse.click(c.x, c.y); await settle(page, 1000);
          const o = await page.evaluate(() => { const k = document.querySelector('.deck-card.is-open'); const b = k && k.querySelector('.deck-back'); const r = b && b.getBoundingClientRect(); return { open: document.documentElement.classList.contains('open'), back: !!b && r.width > 0 && getComputedStyle(b).visibility === 'visible', text: !!b && b.textContent.includes('The back of the card'), front: !!k && getComputedStyle(k.querySelector('.deck-front')).visibility }; });
          if (pics && wasWall) await shot(page, `flip-${handle}-${sz(size)}-${to}-after-wall.png`, `${handle} at ${sz(size)}: a card turned over in ${to}, after a trip through the wall`);
          await page.keyboard.press('Escape'); await settle(page, 1000);
          const cl = await page.evaluate(() => { const k = document.querySelector('.deck-card.is-top'); return { open: document.documentElement.classList.contains('open'), front: !!k && getComputedStyle(k.querySelector('.deck-front')).visibility === 'visible' }; });
          ok(o.open && o.back && o.text && o.front === 'hidden' && !cl.open && cl.front, `${to}${wasWall ? ' (after the wall)' : ''}: a card turns over to its own back and goes back (open=${o.open} back=${o.back} its text=${o.text} · put back=${!cl.open} front=${cl.front})`, `flip:${to}${wasWall ? ':after-wall' : ''}`);
        }
        await page.evaluate(() => window.__deckJump && window.__deckJump(0)); await settle(page, 500);
        // walking the pile re-orders the cards: does a frame on one of them load again?
        const w1 = await embedWord(page);
        if (flips[to] === 1) { if (s.moveBefore) ok(w1 === w0, `${to}: walking the pile (two jumps, a card turned over) leaves the embed frame its document`, `embed:walking-${to}`); else if (w1 !== w0) note(`${to}: walking the pile LOADED the embed frame AGAIN — no Element.moveBefore here (the same on --base)`); }
      }
      // the wall: the engine's drawer opens from its tile — and again after a pile
      if (to === 'wall' && drawers < 2) {
        drawers++;
        const door = page.locator('main .st-cell [data-drawer="about"]').first();
        const has = await door.count();
        if (!has) fail('wall: no tile carries the engine\'s way into the back');
        else {
          await door.scrollIntoViewIfNeeded(); await door.click(); await settle(page, 1200);
          const o = await drawerShown(page);
          if (pics) await shot(page, `drawer-${handle}-${sz(size)}-on-wall-after-${from}.png`, `${handle} at ${sz(size)}: the back opened as the engine's drawer on the wall, after ${from}`);
          await page.keyboard.press('Escape'); await settle(page, 900);
          const c2 = await drawerShown(page);
          ok(o.on && o.text && !c2.on, `wall (after ${wasPile ? 'a pile' : 'load'}): the drawer opens with the back's own text and closes (open=${o.on} text=${o.text} closed=${!c2.on})`, `drawer:after-${wasPile ? 'pile' : 'load'}`);
          await page.evaluate(() => scrollTo(0, 0));
        }
      }
    }
    if (to === 'wall') wasWall = true; else wasPile = true;
    from = to;
  }
  ok(seen.errs.length === 0, `no console errors (${seen.errs.slice(0, 3).join(' | ') || 'none'})`, 'walk:no-errors');
  await ctx.close();
}

// ── print ────────────────────────────────────────────────────────────────────────────────────────
async function print(origin, tag, handle) {
  at('print', handle.split('-')[0], handle.split('-')[1], sz(DESK));
  const { ctx, page } = await newPage(DESK);
  await page.goto(`${origin}/${handle}`, { waitUntil: 'load' }); await settle(page, 1500);
  await page.emulateMedia({ media: 'print' }); await settle(page, 400);
  const r = await page.evaluate(() => ({ boxed: [...document.querySelectorAll('.st-cell')].filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length, h: document.documentElement.scrollHeight }));
  await shot(page, `print-${tag}-${handle}.png`, `${tag}: ${handle} under print media (full page)`, { fullPage: true });
  console.log(`  print ${tag} ${handle}: ${r.boxed} tiles with a box, page height ${r.h}`);
  num(`print:${tag}:boxed`, r.boxed); num(`print:${tag}:height`, r.h, 'px');
  await ctx.close();
  return r;
}

// ── boot: the deck does not come up ──────────────────────────────────────────────────────────────
const HALF = 'const API={};';
async function boot(variant, handle) {
  at('boot', variant, handle.split('-')[1], sz(PHONE));
  const { ctx, page, seen } = await newPage(PHONE);
  let control = true;
  await page.route(DECK_JS_URL, async (route) => {
    if (variant === 'load-error') return route.abort();
    if (variant === 'throws-first-line') return route.fulfill({ contentType: 'text/javascript', body: 'throw new Error("injected: first line");' });
    if (variant === 'throws-half-way') { const r = await route.fetch(); const t = await r.text(); control = t.split(HALF).length === 2; return route.fulfill({ response: r, body: t.replace(HALF, 'throw new Error("injected: half-way");' + HALF) }); }
    await new Promise((r) => setTimeout(r, 5000)); return route.continue();   // slow
  });
  const look = () => page.evaluate((sel) => { const tiles = [...document.querySelectorAll(sel)].filter((c) => !c.closest('.dc-drawer, .deck-table')); const seg = document.querySelector('.deck-seg'); const r = seg && seg.getBoundingClientRect();
    return { cls: document.documentElement.className, view: document.documentElement.dataset.view, off: document.documentElement.hasAttribute('data-deck-off'), boot: window.__deckBoot || '', boxed: tiles.filter((c) => { const b = c.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).length, total: tiles.length, seg: !!(r && r.width > 0), top: !!document.querySelector('.deck-stack > .deck-card.is-top') }; }, TILES);
  const nav = page.goto(`${head.url}/${handle}`, { waitUntil: 'load' }).catch(() => {});
  if (variant === 'slow') {
    await page.waitForSelector('footer.st-footer', { state: 'attached' }); await page.waitForTimeout(3700);
    const w = await look();
    await shot(page, `boot-slow-1-wall-while-waiting-${handle}.png`, `deck.js is slow (5 s): ${handle} after 3.7 s — the wall, not an empty table`);
    console.log(`  slow ${handle}: after 3.7 s class="${w.cls}" view=${w.view} tiles with a box ${w.boxed}/${w.total}`);
    ok(w.boxed === w.total && w.total > 0 && !w.off && w.view === handle.split('-')[1], `the script is slow: the wall is on screen after the wait (${w.boxed}/${w.total}), and the page still means to open on ${handle.split('-')[1]}`, 'boot:slow:wall-meanwhile');
    await nav; await settle(page, 2500);
    const a = await look();
    await shot(page, `boot-slow-2-pile-after-arrival-${handle}.png`, `deck.js is slow (5 s): ${handle} once it arrived — the pile`);
    ok(a.cls.split(' ').includes('deck') && a.top && a.boot === 'ready', `…and the pile opens when the script arrives (class="${a.cls}")`, 'boot:slow:pile-after');
  } else {
    await nav; await settle(page, 1500);
    const a = await look();
    await shot(page, `boot-${variant}-${handle}.png`, `deck.js ${variant}: ${handle} — must be the wall`);
    console.log(`  ${variant} ${handle}: class="${a.cls}" view=${a.view} deck-off=${a.off} boot="${a.boot}" tiles with a box ${a.boxed}/${a.total} switcher drawn=${a.seg}`);
    if (variant === 'throws-half-way') ok(control, 'CONTROL: the place the throw is injected at is in the served script exactly once', 'boot:control');
    if (variant !== 'load-error') ok(seen.errs.some((e) => /injected|did not come up/.test(e)), 'CONTROL: the script did throw (the page\'s console says so)', `boot:${variant}:threw`);
    ok(a.boxed === a.total && a.total > 0 && !a.cls.split(' ').includes('deck'), `${variant}: the page is the wall — every tile has a box (${a.boxed}/${a.total})`, `boot:${variant}:wall`);
    ok(a.off && a.view === 'wall' && !a.seg, `${variant}: the root says the deck is off, and no switcher is drawn`, `boot:${variant}:says-so`);
  }
  await ctx.close();
}

// ── long: time to the top card ───────────────────────────────────────────────────────────────────
async function timeOnce(origin, handle) {
  const { ctx, page } = await newPage(PHONE);
  await page.goto(`${origin}/${handle}`, { waitUntil: 'load' }); await settle(page, 900);
  const r = await page.evaluate(() => ({ top: window.__vS.top, landed: window.__vS.landed, load: performance.getEntriesByType('navigation')[0].loadEventEnd, dcl: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd, cards: document.querySelectorAll('.deck-stack > .deck-card').length }));
  await ctx.close(); return r;
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
async function timeLong(view) {
  at('long', 'long', view, sz(PHONE));
  const now = [], was = [];
  await timeOnce(head.url, `long-${view}`); if (base) await timeOnce(base.url, `long-${view}`);   // one unmeasured load each: caches, JIT
  for (let i = 0; i < RUNS; i++) { now.push(await timeOnce(head.url, `long-${view}`)); if (base) was.push(await timeOnce(base.url, `long-${view}`)); }   // interleaved: the host's load drifts
  const line = (t) => `top card in the pile at ${med(t.map((x) => x.top)).toFixed(0)} ms (min ${Math.min(...t.map((x) => x.top)).toFixed(0)}), DOMContentLoaded ${med(t.map((x) => x.dcl)).toFixed(0)} ms, load ${med(t.map((x) => x.load)).toFixed(0)} ms, ${t[0].cards} cards on the table`;
  console.log(`  long-${view}, median of ${RUNS}\n    this checkout: ${line(now)}`);
  const top = med(now.map((x) => x.top));
  num('open:top:after', +top.toFixed(1), 'ms'); num('open:load:after', +med(now.map((x) => x.load)).toFixed(1), 'ms'); num('open:cards:after', now[0].cards);
  ok(top > 0, `long-${view}: the pile was dealt`, 'long:dealt');
  if (base) {
    const b = med(was.map((x) => x.top));
    console.log(`    --base:        ${line(was)}`);
    num('open:top:before', +b.toFixed(1), 'ms'); num('open:load:before', +med(was.map((x) => x.load)).toFixed(1), 'ms'); num('open:cards:before', was[0].cards);
    ok(top <= b * 1.15 + 20, `long-${view}: not slower to open than --base (now ${top.toFixed(0)} ms, was ${b.toFixed(0)} ms; allowance 15% + 20 ms)`, 'long:not-slower');
  } else console.log('    · no --base: the number above has nothing to be compared with');
}

// ── editor ───────────────────────────────────────────────────────────────────────────────────────
async function editor(size) {
  at('editor', 'bio', 'stack', sz(size));
  const { ctx, page, seen } = await newPage(size);
  await page.addInitScript((md) => { if (window.top === window && location.pathname === '/try/edit') { try { localStorage.setItem('cardtile:w3:saved', md); } catch { /* none */ } } }, bio('stack'));
  await page.goto(`${head.url}/try/edit`, { waitUntil: 'load' }); await settle(page, 3000);
  const fr = () => page.evaluate(() => { const p = document.getElementById('preview'), f = document.getElementById('deckframe'); const w = f && f.contentWindow; const ready = !!(p && !p.hidden && w && typeof w.__deckView === 'function');
    return { ready, hidden: !!(p && p.hidden), s: w && w.__vEd, view: ready ? w.document.documentElement.dataset.view : null, cur: ready && w.__deckCur ? w.__deckCur() : null, y: w ? Math.round(w.scrollY) : null, h: f ? Math.round(f.getBoundingClientRect().height) : 0 }; });
  let a = await fr();
  if (!ok(a.ready, 'CONTROL: the editor opened on its preview of the card it was given', 'editor:control')) { await shot(page, `editor-not-ready-${sz(size)}.png`, 'the editor, not on its preview'); await ctx.close(); return; }
  await page.evaluate(() => { document.getElementById('deckframe').contentWindow.__vEd = Math.random(); });
  a = await fr();
  await shot(page, `editor-${sz(size)}-1-${a.view}.png`, `the editor at ${sz(size)}: preview on ${a.view}`);
  const other = a.view === 'list' ? 'stack' : 'list';
  await page.click(`.modes button[data-view="${other}"]`); await settle(page, 1300);
  let b = await fr();
  console.log(`  editor ${sz(size)}: ${a.view} → ${other}; the frame's window ${b.s === a.s ? 'survived' : 'was replaced'}; it shows ${b.view}`);
  ok(b.s === a.s && b.s != null, `${a.view} → ${other}: the preview frame was not handed the document again`, 'editor:in-place');
  ok(b.view === other, `the preview shows ${other}`, 'editor:shows-view');
  await shot(page, `editor-${sz(size)}-2-${other}.png`, `the editor at ${sz(size)}: the same frame, switched in place to ${other}`);
  await page.click(`.modes button[data-view="${a.view}"]`); await settle(page, 1300);
  // the pile's place: go to the fifth card, hide the frame, show it again
  await page.evaluate(() => document.getElementById('deckframe').contentWindow.__deckJump(4)); await settle(page, 900);
  const p0 = await fr();
  ok(p0.cur === 4, `CONTROL: the preview's pile is on its fifth card (cur=${p0.cur})`, 'editor:position-control');
  // 🔴 REPORTED, not held: the frame hidden by something that is NOT the editor (the attribute set from outside). The browser
  // puts a hidden frame's page at the top and delivers it no event while it is hidden, so the deck inside cannot know; the
  // editor, which does the hiding, restores the place itself (next check). Another embedder would have to do the same.
  await page.evaluate(() => { document.getElementById('preview').hidden = true; }); await settle(page, 700);
  const hid = await fr();
  await page.evaluate(() => { document.getElementById('preview').hidden = false; }); await settle(page, 900);
  const p1 = await fr();
  console.log(`  editor ${sz(size)}: hidden from outside (frame height ${hid.h}) then shown: cur ${p0.cur} → ${p1.cur}, scrollY ${p0.y} → ${p1.y}`);
  num('editor:raw-hide-show:cur-after', p1.cur);
  if (p1.cur !== 4) note(`a preview frame hidden and shown from OUTSIDE the editor's own code loses the pile's place (cur 4 → ${p1.cur}) — the frame's window is told nothing`);
  await page.evaluate(() => document.getElementById('deckframe').contentWindow.__deckJump(4)); await settle(page, 900);
  // the editor's own way of hiding it: over to its wall (another pane) and back
  await page.click('.modes button[data-view="wall"]'); await settle(page, 1200);
  const onWall = await fr();
  await shot(page, `editor-${sz(size)}-3-wall-pane.png`, `the editor at ${sz(size)}: its wall (the preview frame is hidden behind it)`);
  await page.click(`.modes button[data-view="${a.view}"]`); await settle(page, 1300);
  const p2 = await fr();
  console.log(`  editor ${sz(size)}: to the editor's wall (preview hidden=${onWall.hidden}) and back: cur → ${p2.cur}, window ${p2.s === a.s ? 'survived' : 'was replaced'}`);
  ok(onWall.hidden, 'CONTROL: the editor\'s wall hides the preview frame', 'editor:wall-control');
  ok(p2.ready && p2.s === a.s && p2.cur === 4 && Math.abs(p2.y - p0.y) <= 2, `the editor's wall and back: the same frame, still on its card (cur=${p2.cur}, scrollY ${p2.y})`, 'editor:wall-and-back');
  await shot(page, `editor-${sz(size)}-4-back-on-${a.view}.png`, `the editor at ${sz(size)}: back from its wall, the preview where it was left`);
  ok(seen.errs.length === 0, `no console errors (${seen.errs.slice(0, 3).join(' | ') || 'none'})`, 'editor:no-errors');
  await ctx.close();
}

// ── file: a page whose items are a card file ─────────────────────────────────────────────────────
async function filePage(view, size) {
  at('file', 'file', view, sz(size));
  const { ctx, page, seen } = await newPage(size);
  await page.goto(`${head.url}/file-${view}`, { waitUntil: 'load' }); await settle(page, 2500);
  const look = () => page.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return { view: document.documentElement.dataset.view, cls: document.documentElement.className, boot: window.__deckBoot || '', count: window.__deckCount ? window.__deckCount() : null, cur: window.__deckCur ? window.__deckCur() : null,
      rows: [...document.querySelectorAll('.vb-tile')].filter(vis).length, spaces: document.querySelectorAll('.vb-space').length, covers: [...document.querySelectorAll('.vb-cover')].filter(vis).length, hit: (document.querySelector('.vb-hit') || {}).textContent || '',
      top: ((document.querySelector('.deck-stack > .deck-card.is-top') || {}).textContent || '').trim().slice(0, 24), host: document.querySelectorAll('main .st-cell:not(.vb-cover)').length, sentinel: (window.__vSentinel = window.__vSentinel || Math.random()), y: Math.round(scrollY) }; });
  let s = await look();
  console.log(`  file-${view} ${sz(size)}: boot="${s.boot}" view=${s.view} count=${s.count} rows on screen=${s.rows} top card="${s.top}"`);
  ok(s.boot === 'ready' && s.view === view, `the page came up on ${view} from its card file (boot="${s.boot}")`, 'file:opens');
  ok(s.count === FILE_N + 2 || s.count === FILE_N + 1, `the deck counts the file's ${FILE_N} items and its cover (${s.count})`, 'file:count');
  await shot(page, `file-${view}-${sz(size)}.png`, `SYNTHETIC card-file page (${FILE_N} items) opened on ${view} at ${sz(size)}`);
  const sent = s.sentinel; let from = view;
  for (const to of WALK[view]) {
    const b4 = { docs: seen.docs, navs: seen.navs };
    const btn = page.locator(`.deck-seg button[data-m="${INNER[to]}"]`); await btn.focus(); await page.keyboard.press('Enter'); await settle(page, 900);
    s = await look(); const tag = `${from} → ${to}`;
    console.log(`    ${tag.padEnd(14)} view=${s.view} rows=${s.rows} spaces=${s.spaces} cover=${s.covers} top="${s.top}" count=${s.count}`);
    ok(seen.docs === b4.docs && seen.navs === b4.navs && s.sentinel === sent && s.view === to, `${tag}: in place (no navigation), and the root names ${to}`, `file:${from}>${to}:in-place`);
    if (to === 'wall') {
      ok(s.rows > 0 && s.spaces === 1 && s.covers === 1, `${tag}: the file wall is drawn once — rows on screen ${s.rows}, one cover, one row space (${s.spaces})`, `file:${from}>${to}:wall`);
      await page.evaluate(() => window.__deckJump(301)); await settle(page, 600);
      const j = await look();
      ok(j.hit === '301' && j.y > 0, `${tag}: the wall jumps to item 301 and marks it (marked "${j.hit}", scrollY ${j.y})`, `file:${from}>${to}:jump`);
      if (from !== view || to === view) await shot(page, `file-wall-after-${from}-${sz(size)}.png`, `SYNTHETIC card-file page: its wall at item 301, reached from ${from}`);
      await page.evaluate(() => scrollTo(0, 0)); await settle(page, 300);
    } else {
      ok(s.top.length > 0 && s.count >= FILE_N + 1, `${tag}: the pile is on the table over the file (top card "${s.top}")`, `file:${from}>${to}:pile`);
      await page.evaluate(() => window.__deckJump(300)); await settle(page, 700);
      const j = await look();
      ok(j.cur === 300 && /\d/.test(j.top), `${tag}: the pile jumps to card 300 (cur=${j.cur}, top "${j.top}")`, `file:${from}>${to}:jump`);
      await page.evaluate(() => window.__deckJump(0)); await settle(page, 500);
    }
    from = to;
  }
  ok(seen.errs.length === 0, `no console errors (${seen.errs.slice(0, 3).join(' | ') || 'none'})`, 'file:no-errors');
  await ctx.close();
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
const OPEN = FULL ? VIEWS : ['stack', 'wall'];
try {
  if (want('prepaint')) {
    console.log(`── prepaint: the first paint, deck.js held back ${HOLD} ms`);
    for (const spec of FULL ? ['bio', 'long'] : ['bio']) for (const v of FULL ? VIEWS : ['stack']) for (const s of SIZES) {
      await prepaint(head.url, 'after', `${spec}-${v}`, v, s);
      if (base && (spec === 'bio' || s === PHONE)) await prepaint(base.url, 'before', `${spec}-${v}`, v, s);
    }
  }
  if (want('walk')) {
    console.log('── walk: load, the six switches, a card turned over, the drawer, the embed');
    for (const v of OPEN) for (const s of SIZES) await walk(`bio-${v}`, v, s, true);
    if (FULL) for (const v of VIEWS) for (const s of SIZES) await walk(`long-${v}`, v, s, false);
    at('walk');
    const pairs = VIEWS.flatMap((a) => VIEWS.filter((b) => b !== a).map((b) => `${a}>${b}`));
    ok(pairs.every((p) => madePairs.has(p)), `every ordered pair was made (${[...madePairs].sort().join(' ')})`, 'walk:all-pairs');
  }
  if (want('before') && base && FULL) {
    console.log('── before: the same pages from --base');
    for (const spec of ['bio', 'long']) for (const v of VIEWS) for (const s of SIZES) {
      at('before', spec, v, sz(s));
      const { ctx, page } = await newPage(s);
      await page.goto(`${base.url}/${spec}-${v}`, { waitUntil: 'load' }); await settle(page, 2000);
      await shot(page, `before-${spec}-${v}-${sz(s)}.png`, `before (origin/main): ${spec} opened on ${v} at ${sz(s)}`);
      if (spec === 'long') { const { ctx: c2, page: p2 } = await newPage(s); await p2.goto(`${head.url}/long-${v}`, { waitUntil: 'load' }); await settle(p2, 2000); await shot(p2, `after-long-${v}-${sz(s)}.png`, `after (this branch): long opened on ${v} at ${sz(s)}`); await c2.close(); }
      await ctx.close();
    }
  }
  if (want('print')) {
    console.log('── print: each view under print media');
    for (const v of FULL ? VIEWS : ['stack']) {
      const a = await print(head.url, 'after', `bio-${v}`);
      if (base) { const b = await print(base.url, 'before', `bio-${v}`); if (a.boxed !== b.boxed || Math.abs(a.h - b.h) > 2) note(`print bio-${v}: this checkout ${a.boxed} tiles / ${a.h}px tall, --base ${b.boxed} tiles / ${b.h}px tall — compare print-after-bio-${v}.png with print-before-bio-${v}.png`); else console.log(`   · print bio-${v}: the same tile count and page height as --base`); }
    }
  }
  if (want('boot')) {
    console.log('── boot: the deck does not come up');
    for (const variant of FULL ? ['load-error', 'throws-first-line', 'throws-half-way', 'slow'] : ['throws-half-way']) await boot(variant, 'bio-stack');
    if (FULL) await boot('throws-half-way', 'bio-list');
  }
  if (want('long')) {
    console.log('── long: 200 tiles, time to the top card');
    for (const v of FULL ? ['stack', 'list'] : ['stack']) await timeLong(v);
  }
  if (want('editor')) {
    console.log('── editor: the preview frame');
    for (const s of FULL ? [DESK, PHONE] : [DESK]) await editor(s);
  }
  if (want('file')) {
    console.log('── file: a page whose items are a card file (SYNTHETIC specimen)');
    for (const v of FULL ? VIEWS : ['wall']) await filePage(v, PHONE);
    if (FULL) await filePage('stack', DESK);
  }
} catch (e) { at('harness'); fail(`the harness itself stopped: ${String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')}`); }

await browser.close(); done();
results.bad = bad;
fs.writeFileSync(join(ROOT, `results-${LABEL}${ONLY ? '-' + ONLY.join('+') : ''}.json`), JSON.stringify(results, null, 1));
// the index of pictures: every engine's that has been run, in one file
if (!ONLY) fs.writeFileSync(join(ROOT, `index-${LABEL}.json`), JSON.stringify({ engine: LABEL, browserVersion: results.browserVersion, playwright: pwVersion, revision: pwRev, shots: results.shots }, null, 1));
{
  const parts = fs.readdirSync(ROOT).filter((f) => /^index-[\w-]+\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(join(ROOT, f), 'utf8')));
  const md = ['# deck-views — pictures', '', 'Written by `packages/cardtile/verify/deck-views.mjs`. `before` = the `--base` checkout (origin/main), `after` = this branch.',
    'Specimens: `bio` = a link-in-bio Card (a run of full-width links, tiles with a back, an embed); `long` = 200 tiles; `file` = a SYNTHETIC card-file page.', '',
    ...parts.flatMap((p) => [`## ${p.engine} ${p.browserVersion} (playwright ${p.playwright}, revision ${p.revision})`, '', '| file | what it shows |', '|---|---|', ...p.shots.map((s) => `| \`${s.file}\` | ${s.desc} |`), ''])].join('\n');
  if (parts.length) fs.writeFileSync(join(ROOT, 'INDEX.md'), md);
}
console.log(`\npictures: ${SHOTS}  (index: ${join(ROOT, 'INDEX.md')})`);
console.log(bad ? `🔴 ${bad} problem(s)` : `✅ stack, list and wall are one set of nodes in ${LABEL}`);
process.exit(bad ? 1 : 0);
