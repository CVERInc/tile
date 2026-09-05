import { existsSync, readFileSync } from 'node:fs';
import { OUT, PLAYWRIGHT } from './paths.mjs';
const pw = (await import(PLAYWRIGHT)).default;
const { chromium } = pw;

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
const errs = [];
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

// 🔴 SAY WHAT IS MISSING, rather than spending 30 seconds clicking nothing. This page is written
// by render-harness.mjs, and it is an input this file cannot fix — so if it is absent, or present
// without the avatar the QR mounts on, the message names the producer instead of timing out.
const PAGE = OUT + '/card-native-qr.html';
if (!existsSync(PAGE)) {
  throw new Error(`${PAGE} is not there — run render-harness.mjs first; it writes the page this drives`);
}
// 🔴 `class="cp-icon"` — THE ELEMENT, not the string. My first version of this check tested for
// `includes('cp-icon')` and passed on a page with no avatar at all, because the name also appears
// in the inlined stylesheet and in the QR coral's own querySelector. A check satisfied by the wrong
// occurrence is not a check.
if (!/class="cp-icon"/.test(readFileSync(PAGE, 'utf8'))) {
  throw new Error('card-native-qr.html carries no .cp-icon — render-harness rendered a card with no avatar, and the QR coral mounts on the avatar (querySelector(".cp-icon"); if(icon){…}). Point render-harness at a specimen that states one.');
}
await pg.goto('file://' + PAGE);
await pg.waitForTimeout(400);
await pg.screenshot({ path: OUT + '/qr-shot-1-card.png' });

// sanity: mount + icon present, coral saw it
const pre = await pg.evaluate(() => ({
  mount: !!document.querySelector('[data-dynamic-coral="qr"]'),
  icon: !!document.querySelector('.cp-icon'),
  holderWrapped: !!document.getElementById('qr-holder'), // coral wraps icon on mount
}));
console.log('PRE:', JSON.stringify(pre));

// click the avatar → the 表演
await pg.click('.cp-icon');
await pg.waitForTimeout(1600); // morph (.4s) + overlay (.4s) + card scale (.5s) + settle

await pg.screenshot({ path: OUT + '/qr-shot-2-popup.png' });

const post = await pg.evaluate(() => {
  const grid = document.querySelector('.qr-grid');
  const cells = grid ? grid.children.length : 0;
  const dark = grid ? Array.from(grid.children).filter((c) => {
    const bg = getComputedStyle(c).backgroundColor;
    return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  }).length : 0;
  const overlay = document.getElementById('qr-overlay');
  const grp = document.getElementById('qr-group');
  const gridEl = grid;
  const gr = gridEl ? gridEl.getBoundingClientRect() : null;
  return {
    grpExists: !!grp,               // avatar morphed into a fixed group at center
    overlayOpacity: overlay ? getComputedStyle(overlay).opacity : null,
    gridCells: cells,               // 33*33 = 1089
    gridDark: dark,                 // ~ the QR's dark modules (>400)
    gridW: gr ? Math.round(gr.width) : null,
    gridH: gr ? Math.round(gr.height) : null,
    title: document.getElementById('qr-modal-title')?.textContent,
  };
});
console.log('POST:', JSON.stringify(post));
// 🔴 Two classes of error, and printing them as one list is how a real one hides.
//
// This page is opened over file://, so anything the renderer emits as an absolute path — /_coral/,
// /_icon/ — cannot resolve. That is a property of how this harness LOADS the page, not of the page,
// and it has always been there. Listing it next to a genuine failure trains the reader to skim past
// both. So the expected ones are counted and named, and anything else stands alone.
const EXPECTED_OVER_FILE = /ERR_FILE_NOT_FOUND|net::ERR_FILE/;
const expected = errs.filter((e) => EXPECTED_OVER_FILE.test(e));
const real = errs.filter((e) => !EXPECTED_OVER_FILE.test(e));
if (expected.length) {
  console.log(`(${expected.length} absolute-path fetch(es) failed because this page is opened over file:// — /_coral/ and /_icon/ have no origin here. Expected.)`);
}
console.log('ERRORS:', real.length ? real.join('\n') : '(none)');
if (real.length) process.exitCode = 1;

await b.close();
