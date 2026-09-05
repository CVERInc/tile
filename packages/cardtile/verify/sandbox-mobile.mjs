// cardtile-w's public sandbox (card.feelreef.com/try/edit) at phone width, in several of the nine
// console locales — the owner ruling that started this (2026-09-05: 「mobile 不順＝不能用」,
// REEF with Card is mobile-first, 100%). Three claims, each with a control, same shape as this
// directory's other harnesses:
//
//   1. NO H-SCROLL     the page never gets wider than the viewport at 390px — the actual bug the
//                       owner reported ("慘不忍睹").
//   2. REACHABLE       the door CTA and the cell-editor sheet are both on-screen and tap-sized
//                       (≥44px) without needing to pinch-zoom, and the sheet is bottom-anchored.
//   3. LOCALISED       the banner text on screen is the ACTUAL persona copy for the locale asked
//                       for — not English leaking through, not the wrong locale's copy.
//
// Runs against the SAME editor.mjs/index.html a real deploy bundles (gen-editor-assets.mjs), served
// locally by w/serve.mjs — not a copy, not the bundled Worker output, so this cannot pass by testing
// something a `git push` would not ship.
//
//   node packages/cardtile/verify/sandbox-mobile.mjs
import { PLAYWRIGHT } from './paths.mjs';
import { createServer } from '../w/serve.mjs';
import { SANDBOX_LOCALES } from '../w/sandbox-i18n.mjs';

const server = createServer();
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/packages/cardtile/w/`;

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;
const fail = (msg) => { console.log(`   🔴 ${msg}`); bad++; };

/** Boot the LOCAL editor in sandbox mode — `w/serve.mjs` never sets `__CARDTILE_W_OPTS__` itself
 *  (that is card-worker.mjs's job, on the real deploy), so this harness sets it the same way the
 *  edge Worker's served page does: before index.html's own module script runs. */
async function openSandbox(locale, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((opts) => { window.__CARDTILE_W_OPTS__ = opts; }, { sandbox: true, locale });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__cardtileW && window.__cardtileW.sandbox === true);
  return { ctx, page, errors };
}

const MOBILE = { width: 390, height: 844 };
const SMOKE_LOCALES = ['zh', 'zh-Hans', 'ja', 'de', 'pt']; // a cross-section, not all nine — this is
// a layout/reachability smoke, not sandbox-i18n.test.mjs's job (which already checks all nine's
// content in isolation, no browser needed).

console.log(`1. NO H-SCROLL at ${MOBILE.width}px — every locale in the smoke set\n`);
for (const locale of SMOKE_LOCALES) {
  const { ctx, page, errors } = await openSandbox(locale, MOBILE);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  console.log(`   ${locale.padEnd(8)} scrollWidth=${scrollWidth} clientWidth=${clientWidth} ${scrollWidth <= clientWidth ? 'ok' : 'OVERFLOW'}`);
  if (scrollWidth > clientWidth) fail(`${locale}: page scrolls horizontally at ${MOBILE.width}px (${scrollWidth}px content)`);
  if (errors.length) fail(`${locale}: page errors — ${errors[0]}`);
  await ctx.close();
}
// CONTROL: this is NOT a check that the old grid overflowed the page — a CSS grid's `1fr` track
// shrinks its content instead of overflowing it, so it never did (that is precisely how "慘不忍睹"
// happened invisibly: no scrollbar, no error, just a canvas squeezed to a sliver). What the fixed
// layout actually changes is the WIDTH the canvas gets — this proves check 1 is not vacuously true
// for any layout by showing the specific, real thing the old fixed-340px column did at 390px.
{
  const { ctx, page } = await openSandbox('en', MOBILE);
  const oldCanvasWidth = await page.evaluate(() => {
    const main = document.querySelector('.ctw-main');
    const side = document.querySelector('.ctw-side');
    const canvas = document.querySelector('.ctw-canvas-wrap');
    const prevMain = main.style.cssText;
    const prevSide = side.style.cssText;
    const prevCanvas = canvas.style.cssText;
    main.style.cssText = 'display:grid;grid-template-columns:340px 1fr;';
    // the mobile stylesheet also sets `order` on both (DOM order puts the canvas first on phone,
    // side panel second) — reset both back to DOM order, which is what the pre-fix CSS actually had.
    side.style.cssText = 'order:0';
    canvas.style.cssText = 'order:0';
    const w = canvas.getBoundingClientRect().width;
    main.style.cssText = prevMain;
    side.style.cssText = prevSide;
    canvas.style.cssText = prevCanvas;
    return w;
  });
  const fixedCanvasWidth = await page.evaluate(() => document.querySelector('.ctw-canvas-wrap').getBoundingClientRect().width);
  console.log(`\n   CONTROL  canvas width — old fixed-340px grid: ${Math.round(oldCanvasWidth)}px, current mobile layout: ${Math.round(fixedCanvasWidth)}px (viewport ${MOBILE.width}px)`);
  if (oldCanvasWidth >= 150) fail(`CONTROL: the old grid gave the canvas ${Math.round(oldCanvasWidth)}px at phone width — expected it to be squeezed to a sliver, so this proves nothing about check 1`);
  if (fixedCanvasWidth < MOBILE.width - 4) fail(`the current mobile layout only gives the canvas ${Math.round(fixedCanvasWidth)}px of a ${MOBILE.width}px viewport — "canvas fits the viewport width" is not holding`);
  await ctx.close();
}

console.log('\n2. REACHABLE — the door CTA and the cell-editor sheet, at phone width\n');
for (const locale of SMOKE_LOCALES) {
  const persona = SANDBOX_LOCALES[locale];
  const { ctx, page } = await openSandbox(locale, MOBILE);

  // the door button: on screen, tap-sized, says the persona's own door copy
  const door = page.locator('#publish');
  const doorBox = await door.boundingBox();
  const doorText = await door.textContent();
  if (!doorBox) fail(`${locale}: #publish (the door CTA) has no box — not on screen at all`);
  else {
    const inViewport = doorBox.y >= 0 && doorBox.y + doorBox.height <= MOBILE.height
      && doorBox.x >= 0 && doorBox.x + doorBox.width <= MOBILE.width;
    if (!inViewport) fail(`${locale}: door CTA box ${JSON.stringify(doorBox)} is outside the ${MOBILE.width}x${MOBILE.height} viewport`);
    if (doorBox.height < 44) fail(`${locale}: door CTA is ${doorBox.height}px tall, below the 44px tap-target floor`);
  }
  if ((doorText || '').trim() !== persona.doorCta) fail(`${locale}: door CTA reads ${JSON.stringify(doorText)}, expected ${JSON.stringify(persona.doorCta)}`);

  // the cell-editor sheet: click a canvas cell, the sheet opens bottom-anchored and on screen
  const frame = page.frameLocator('#canvas');
  await frame.locator('[data-cell]').first().click();
  await page.waitForSelector('#modal:not([hidden])');
  // 🩸 was `.ctw-modal-panel`, which stopped being unique the moment the door grew a sheet of its
  // own (2026-09-06, Top-10 #2) — two panels, strict-mode violation, harness dead. Scoped to the
  // CELL editor, which is the one this check is about.
  const panel = page.locator('#modal .ctw-modal-panel');
  const panelBox = await panel.boundingBox();
  if (!panelBox) fail(`${locale}: the cell-editor sheet did not open`);
  else {
    const nearBottom = panelBox.y + panelBox.height >= MOBILE.height - 4; // bottom-anchored, not floating centred
    const fullWidth = panelBox.width >= MOBILE.width - 4;
    if (!nearBottom) fail(`${locale}: cell-editor panel bottom is at ${panelBox.y + panelBox.height}px, not anchored to the ${MOBILE.height}px viewport bottom — looks centred, not a bottom sheet`);
    if (!fullWidth) fail(`${locale}: cell-editor panel is ${panelBox.width}px wide in a ${MOBILE.width}px viewport — not full-width`);
  }
  const closeBox = await page.locator('#modal-close').boundingBox();
  if (!closeBox || closeBox.height < 44 || closeBox.width < 44) fail(`${locale}: modal close button is ${JSON.stringify(closeBox)}, below the 44px tap-target floor`);
  console.log(`   ${locale.padEnd(8)} door=${doorBox ? 'onscreen' : 'MISSING'} sheet=${panelBox && panelBox.y + panelBox.height >= MOBILE.height - 4 ? 'bottom-anchored' : 'NOT anchored'}`);

  await ctx.close();
}

console.log('\n3. LOCALISED — the banner text on screen is the real persona copy, not English leaking through\n');
for (const locale of SMOKE_LOCALES) {
  const persona = SANDBOX_LOCALES[locale];
  const { ctx, page } = await openSandbox(locale, MOBILE);
  const bannerText = (await page.locator('#sandbox-banner-text').textContent() || '').trim();
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  console.log(`   ${locale.padEnd(8)} lang=${htmlLang.padEnd(6)} banner matches persona: ${bannerText === persona.bannerText ? 'yes' : 'NO'}`);
  if (bannerText !== persona.bannerText) fail(`${locale}: banner reads ${JSON.stringify(bannerText)}, expected ${JSON.stringify(persona.bannerText)}`);
  if (htmlLang !== persona.lang) fail(`${locale}: <html lang> is ${JSON.stringify(htmlLang)}, expected ${JSON.stringify(persona.lang)}`);
  await ctx.close();
}
// CONTROL: two different locales must NOT produce the same banner text, or "matches persona" above
// could be passing by coincidence (e.g. every locale silently falling back to one shared string).
{
  const a = await openSandbox('ja', MOBILE);
  const b = await openSandbox('de', MOBILE);
  const textA = await a.page.locator('#sandbox-banner-text').textContent();
  const textB = await b.page.locator('#sandbox-banner-text').textContent();
  console.log(`\n   CONTROL  ja and de banner text differ: ${textA !== textB ? 'yes' : 'NO'}`);
  if (textA === textB) fail('CONTROL: ja and de produced the SAME banner text — locale is not actually varying anything');
  await a.ctx.close();
  await b.ctx.close();
}

console.log('\n4. DESKTOP UNCHANGED — 1280px keeps the two-column grid (guardrail: desktop layout stays intact)\n');
{
  const { ctx, page } = await openSandbox('en', { width: 1280, height: 900 });
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.ctw-main')).gridTemplateColumns);
  const menuDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('actions-menu')).display);
  console.log(`   grid-template-columns: ${cols}`);
  console.log(`   .ctw-mobile-menu computed display: ${menuDisplay} (expect "contents" — invisible as a wrapper)`);
  if (!/^\d.*px\s+\d/.test(cols)) fail(`desktop: .ctw-main is not a two-column grid any more (got "${cols}")`);
  if (menuDisplay !== 'contents') fail(`desktop: .ctw-mobile-menu is styled as "${menuDisplay}", not "contents" — it may be visibly wrapping the toolbar`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ no h-scroll at 390px, the door + cell-editor sheet are reachable and tap-sized, the banner is genuinely localised, desktop is untouched');
process.exitCode = bad ? 1 : 0;
