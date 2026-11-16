// A side of a tile that holds more than it shows takes the visitor's wheel and keys before the pile does
// (tile#343, review of #352). Asked of a real browser with real input, because the stand-in DOM of
// w3/deck-views.test.mjs can say what the deck's script decides but not what a wheel or a key then does.
//
// The specimen is one long text tile with a back: in stack, the document is at its last snap point as
// soon as the page opens, while the tile's front still has most of its text below.
//
//   wheel   A wheel down on the front scrolls the front and does not turn the tile over; nor does the
//           rest of the same gesture after the front has reached its end. A new wheel down on a front at
//           its end turns it over, as the last tile always has (CONTROL: proves the turn still works).
//   keys    Tab reaches the front (a scrolling side is a Tab stop, named "Front", with the page's own
//           focus ring); PageDown, Space and End then scroll it, and never turn the tile over.
//   fits    A side that shows everything is not a Tab stop: a short front has no tabindex, and a back that
//           fits keeps -1 (the place its turn sends focus to).
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/tile-side-gestures.mjs
//   … --browser webkit        WebKit instead of Chromium
//   … --pw <path>             the Playwright (or playwright-core) entry to use, instead of PLAYWRIGHT
//   … --exec <path>           the browser's executable, when the Playwright install has none of its own
//   … --base <checkout>       ask THAT checkout's worker instead (a worktree of an older commit)
//   … --shots <dir>           keep a picture of the focused front there (front-focused-<browser>.png)
//
// 🔴 What this does not show: a finger. Playwright has no native touch scroll; an upward finger on a front is
// held by deck-views.test.mjs (the pile's drag lets it go), and how iOS hands a scroll on is a phone's question.
// It also does not show the momentum of a trackpad: its wheel events come from the test, 30 ms apart.
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLAYWRIGHT, PKG } from './paths.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] || '' : '');
const WHICH = opt('--browser') || 'chromium', EXEC = opt('--exec');
const BASE = opt('--base') ? resolve(opt('--base')) : '';
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : '';
const worker = (await import(pathToFileURL(BASE ? join(BASE, 'packages/cardtile/serve/card-worker.mjs') : join(PKG, 'serve/card-worker.mjs')).href)).default;

const para = (n) => Array.from({ length: n }, (_, i) => `\tParagraph ${i + 1} of ${n}: a long text is longer than the side it is printed on.`).join('\n\t\n');
const page = (title, n) => ['---', 'card-page: gestures', `title: ${title}`, 'view: stack', '---', '', '## cards', '',
  `- [ ] %% card: text w=6 back=#about %%\n${para(n)}`, '', '## back: about | About', '', '- [ ] %% card: text %% The back.', ''].join('\n');
const FILES = { 'gestures-long': page('A long last tile', 30), 'gestures-short': page('A short last tile', 1) };
const store = { get: async (h) => FILES[h] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } };

let bad = 0;
const ok = (cond, msg) => { console.log(`   ${cond ? '✓' : '🔴'} ${msg}`); if (!cond) bad++; return !!cond; };

const mod = await import(opt('--pw') ? pathToFileURL(resolve(opt('--pw'))).href : PLAYWRIGHT); const pw = mod.default || mod;
const browser = await pw[WHICH].launch({ headless: true, ...(EXEC ? { executablePath: EXEC } : {}) });
const DEADLINE = setTimeout(() => { console.log('💥 tile-side-gestures: ran out of time'); browser.close().finally(() => process.exit(2)); }, 90_000);

const openPage = async (h) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  // served by the worker itself, through the browser's router: no port to open
  await ctx.route('http://cards.test/**', async (route) => {
    const u = new URL(route.request().url());   // the worker is asked as tile-sides.mjs asks it: by path, on a host it does not map to a handle
    const r = await worker.fetch(new Request('http://x' + u.pathname + u.search), { CARDS: store, PREVIEW: 'true' });
    await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
  });
  await ctx.route(/^(?!http:\/\/cards\.test\/)/, (route) => route.abort());
  const p = await ctx.newPage();
  const res = await p.goto(`http://cards.test/${h}`, { waitUntil: 'load', timeout: 20_000 });
  if (!res || res.status() !== 200) throw new Error(`tile-side-gestures: ${h} answered ${res && res.status()}`);
  await p.waitForFunction(() => typeof window.__deckCount === 'function' && document.querySelector('.deck-card.is-top .deck-front'), null, { timeout: 15_000 });
  await p.waitForTimeout(600);
  return { ctx, p };
};
const state = (p) => p.evaluate(() => {
  const f = document.querySelector('.deck-card.is-top .deck-front'), b = document.querySelector('.deck-card.is-top .deck-back'), a = document.activeElement;
  const cs = getComputedStyle(f);
  return { open: document.documentElement.classList.contains('open'), count: window.__deckCount(), top: Math.round(f.scrollTop), max: f.scrollHeight - f.clientHeight,
    atDocEnd: scrollY >= document.documentElement.scrollHeight - innerHeight - 2, tabindex: f.getAttribute('tabindex'), role: f.getAttribute('role'), name: f.getAttribute('aria-label'),
    backTabindex: b && b.getAttribute('tabindex'), focused: a === f ? 'front' : a === b ? 'back' : (a && a.tagName) || '', outline: a === f ? `${cs.outlineStyle} ${cs.outlineWidth}` : '' };
});

console.log(`tile-side-gestures (${WHICH}${BASE ? ', ' + BASE : ''}): one long last tile with a back, stack 390`);
try {
  // ---- wheel ----
  {
    const { ctx, p } = await openPage('gestures-long');
    const s0 = await state(p);
    ok(s0.count === 1 && s0.atDocEnd && s0.max > 300, `the specimen: one tile, the document at its end, the front ${s0.max} px longer than it shows`);
    const box = await p.locator('.deck-card.is-top .deck-front').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 100); await p.waitForTimeout(30); }
    await p.waitForTimeout(250);
    const s1 = await state(p);
    ok(!s1.open, `wheel: six wheels down on the front did not turn the tile over (front at ${s1.top} of ${s1.max})`);
    ok(s1.top > 0, 'wheel: …and they scrolled the front');
    // one gesture to the front's end and past it: no gap longer than the deck's 180 ms
    for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(30); }
    await p.waitForTimeout(250);
    const s2 = await state(p);
    ok(s2.top >= s2.max - 1, `wheel: the front reached its end (${s2.top} of ${s2.max})`);
    ok(!s2.open, 'wheel: the rest of a gesture the front took did not turn the tile over');
    await p.waitForTimeout(700);   // a new gesture
    for (let i = 0; i < 3; i++) { await p.mouse.wheel(0, 100); await p.waitForTimeout(30); }
    await p.waitForTimeout(400);
    ok((await state(p)).open, 'CONTROL wheel: a new wheel down on a front at its end turns the last tile over');
    await ctx.close();
  }
  // ---- keys ----
  {
    const { ctx, p } = await openPage('gestures-long');
    let s = await state(p), tabs = 0;
    ok(s.tabindex === '0' && s.role === 'region' && s.name === 'Front', `keys: the long front is a Tab stop, a region named "Front" (tabindex ${s.tabindex}, role ${s.role}, name ${s.name})`);
    while (s.focused !== 'front' && tabs < 30) { await p.keyboard.press('Tab'); tabs++; s = await state(p); }
    ok(s.focused === 'front', `keys: Tab reached the front (${tabs} presses)`);
    ok(/^solid 2px$/.test(s.outline), `keys: the focused front shows the page's ring (${s.outline})`);
    if (SHOTS) await p.screenshot({ path: join(SHOTS, `front-focused-${WHICH}.png`) });
    for (const key of ['PageDown', 'Space']) {
      const before = (await state(p)).top; await p.keyboard.press(key); await p.waitForTimeout(500); const after = await state(p);
      ok(after.top > before && !after.open, `keys: ${key} scrolled the front (${before} → ${after.top}) and did not turn the tile over`);
    }
    await p.keyboard.press('End'); await p.waitForTimeout(500);
    for (const key of ['Space', 'PageDown', 'ArrowDown']) { await p.keyboard.press(key); await p.waitForTimeout(400); }
    const e = await state(p);
    ok(e.top >= e.max - 1 && !e.open, `keys: at the front's end, Space / PageDown / ArrowDown did not turn the tile over (${e.top} of ${e.max})`);
    await ctx.close();
  }
  // ---- fits ----
  {
    const { ctx, p } = await openPage('gestures-short');
    const s = await state(p);
    ok(s.max <= 1 && s.tabindex === null && s.role === null && s.name === null, `fits: a front that shows everything is not a Tab stop (tabindex ${s.tabindex}, ${s.max} px more)`);
    await p.keyboard.press('Enter'); await p.waitForTimeout(800);
    const o = await state(p);
    ok(o.open && o.backTabindex === '-1', `fits: a back that shows everything keeps tabindex -1 (${o.backTabindex})`);
    await ctx.close();
  }
} finally { clearTimeout(DEADLINE); await browser.close(); }
console.log(bad ? `🔴 tile-side-gestures: ${bad} problem(s)` : '✅ tile-side-gestures: all held');
process.exit(bad ? 1 : 0);
