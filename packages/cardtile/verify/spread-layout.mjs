// The spread layout (today's only Card layout), measured the way tile-lab#55 補 5 says a layout is
// verified: at a phone in portrait, a phone in landscape and a desktop window, nothing overflows the
// viewport, nothing escapes its cell, and the page logs zero errors. On top of that, one computed
// assertion for each of the five renderer defects #55 補 3/補 4 found on a real iPhone, all of which
// the live spread Card has independently of the Deck build:
//
//   1. text-size-adjust  `html{-webkit-text-size-adjust:100%}` — without it iOS inflates the footer.
//   2. qr-holder         the QR coral's `#qr-holder` follows the avatar. It used to be sized inline
//                        to whatever the avatar measured at mount, so any later size change (a
//                        breakpoint, a rotation, the Deck's 140px avatar) left the picture
//                        overflowing a stale box, 30px off centre.
//   3. backdrop          `.st-backdrop` is sized to the LARGE viewport (100lvh), not `inset:0`.
//                        `inset:0` follows the iOS toolbar as it collapses, and `background-size:
//                        cover` re-crops the artwork on every change.
//   4. social            `.st-social-btn` declares `text-decoration:none`; the UA underline leaked.
//   5. footer            footer links are quiet: the footer's own colour and weight, no underline,
//                        the accent on hover only — and NO `!important` colour layer on them, which
//                        is how the old accent got there (three stacked layers and a credit class).
//
// 🔴 What Chromium cannot show, said plainly: there is no collapsing toolbar here, so `lvh` and
// `inset:0` compute to the same height. Claim 3 is therefore asserted on the DECLARED cascade (the
// effective `height` and `bottom` of `.st-backdrop`), plus a computed check that it still covers the
// window. iOS's text inflation is the same: Chromium only reports the declared value back.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/spread-layout.mjs
import http from 'node:http';
import { readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

// specimen-rich carries every subject (backdrop, avatar → QR, social row); specimen-plain is the
// no-backdrop control, where the footer is NOT on artwork and a different colour layer applied.
const CARDS = ['specimen-rich', 'specimen-plain'];
// 🔴 `powered-by: on`, injected here and not in the specimen: the footer has a link only when the
// credit is on, and the specimens are generated (edit the generator, never the file). Without it
// claim 5 would measure zero links and pass.
const withCredit = (md) => md.replace(/^(card-page:.*)$/m, '$1\npowered-by: on');
const VIEWS = [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }];
const SCHEMES = ['dark', 'light'];

const store = {
  get: async (h) => (CARDS.includes(h) ? withCredit(readCard(h)) : null),
  async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; },
};
// 🔴 Link marks (/_icon/<domain>.ico) are answered here with a fixed 1×1 PNG instead of going to the
// Worker, whose relay asks DuckDuckGo and then Google live. The specimens link to example.com, which
// has no mark at either, so the relay answers its documented 404 ("a missing mark is not an error —
// the card's fallback chain takes over") and the BROWSER logs that 404 as a console error — on
// origin/main exactly as after this change, and differently again on a machine with no network.
// A layout ruler must not depend on what a third party says about example.com today. (What a
// missing mark does to a live card's console is a separate question, reported, not hidden: see the
// PR for tile-lab#55.)
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const server = http.createServer(async (req, res) => {
  if (/^\/_icon\/[^/]+\.ico$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PIXEL); return; }
  const r = await worker.fetch(new Request('http://x' + req.url), { CARDS: store, PREVIEW: 'true' });
  const b = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(b);
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://127.0.0.1:' + server.address().port;
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;
const fail = (msg) => { console.log('   🔴 ' + msg); bad++; };

// The layout ruler — the same definition as tile-lab lab/deck/verify.mjs, so "spread passes here"
// and "spread passes there" are one claim.
function layout() {
  const out = { overflowX: document.documentElement.scrollWidth > innerWidth, cells: 0, escapes: [] };
  const fits = (c, b, t = 2) => c.right <= b.right + t && c.left >= b.left - t && c.bottom <= b.bottom + t && c.top >= b.top - t;
  for (const c of document.querySelectorAll('.st-cell')) {
    if (c.closest('[hidden]')) continue;
    const box = c.getBoundingClientRect(); if (!box.width) continue; out.cells++;
    for (const el of c.querySelectorAll('h1,h2,h3,h5,p,img,svg,input,select,textarea,button')) {
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      if (!fits(r, box)) out.escapes.push(String(c.className).slice(0, 30) + ' > ' + el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 24));
    }
  }
  return out;
}

// Walk the cascade for one selector: every style rule whose selector list names it exactly, in
// document order, descending into @media blocks that currently match. Same specificity throughout,
// so the LAST declaration of a property is the effective one unless an earlier one is !important.
function declared({ selector, props }) {
  const hits = {};
  const visit = (rules) => {
    for (const r of rules) {
      if (r.media && r.cssRules) { if (matchMedia(r.media.mediaText).matches) visit(r.cssRules); continue; }
      if (!r.selectorText || !r.style) continue;
      if (!r.selectorText.split(',').map((s) => s.trim()).includes(selector)) continue;
      for (const p of props) {
        const v = r.style.getPropertyValue(p);
        if (!v) continue;
        const imp = r.style.getPropertyPriority(p) === 'important';
        if (hits[p] && hits[p].imp && !imp) continue;
        hits[p] = { v, imp };
      }
    }
  };
  for (const s of document.styleSheets) { try { visit(s.cssRules); } catch { /* cross-origin */ } }
  return Object.fromEntries(Object.entries(hits).map(([k, o]) => [k, o.v + (o.imp ? ' !important' : '')]));
}

async function probe(handle, view, scheme) {
  const ctx = await browser.newContext({ viewport: view, deviceScaleFactor: 1, colorScheme: scheme });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  // a console "Failed to load resource" does not say WHICH resource; this does
  const net = [];
  page.on('response', (r) => { if (r.status() >= 400) net.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${base}/${handle}`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Array.from(document.images).map((i) =>
    i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))).then(() => {}));
  await page.waitForTimeout(500);
  const tag = `${handle.padEnd(14)} ${String(view.width + '×' + view.height).padEnd(8)} ${scheme.padEnd(5)}`;

  // ── the layout ruler ──────────────────────────────────────────────────────────────────────────
  const L = await page.evaluate(layout);
  const layoutOk = !L.overflowX && L.escapes.length === 0;
  console.log(`  ${tag} layout  cells=${L.cells} overflowX=${L.overflowX} escapes=${L.escapes.length}`);
  if (!L.cells) fail('no cells measured — the ruler saw nothing');
  if (!layoutOk) fail(`layout: ${L.overflowX ? 'horizontal overflow; ' : ''}${[...new Set(L.escapes)].slice(0, 8).join(' | ')}`);

  // ── 1. text-size-adjust ───────────────────────────────────────────────────────────────────────
  const tsa = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { computed: cs.webkitTextSizeAdjust || cs.textSizeAdjust || '', declared: '' };
  });
  const tsaDecl = (await page.evaluate(declared, { selector: 'html', props: ['-webkit-text-size-adjust', 'text-size-adjust'] }));
  const tsaOk = tsa.computed === '100%' || tsaDecl['-webkit-text-size-adjust'] === '100%';
  console.log(`    1 text-size-adjust  computed=${JSON.stringify(tsa.computed)} declared=${JSON.stringify(tsaDecl)}  ${tsaOk ? 'ok' : 'FAIL'}`);
  if (!tsaOk) fail('html does not set -webkit-text-size-adjust:100% — iOS inflates the footer');

  // ── 3. backdrop: the large viewport, not the toolbar-following inset ──────────────────────────
  const bd = await page.evaluate(declared, { selector: '.st-backdrop', props: ['height', 'bottom', 'top', 'inset'] });
  const bdBox = await page.evaluate(() => { const b = document.querySelector('.st-backdrop'); if (!b) return null; const r = b.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), ih: innerHeight }; });
  if (handle === 'specimen-rich') {
    const bdOk = !!bdBox && /lvh/.test(bd.height || '') && !/^0(px)?$/.test(bd.bottom || '') && bdBox.h >= bdBox.ih;
    console.log(`    3 backdrop          declared=${JSON.stringify(bd)} box=${JSON.stringify(bdBox)}  ${bdOk ? 'ok' : 'FAIL'}`);
    if (!bdOk) fail('.st-backdrop is not pinned to 100lvh (or no longer covers the window) — iOS re-crops it as the toolbar moves');
  }

  // ── 4. social buttons carry no underline ──────────────────────────────────────────────────────
  const soc = await page.evaluate(() => [...document.querySelectorAll('.st-social-btn')].map((a) => getComputedStyle(a).textDecorationLine));
  if (handle === 'specimen-rich') {
    const socOk = soc.length > 0 && soc.every((d) => d === 'none');
    console.log(`    4 social            n=${soc.length} text-decoration-line=${JSON.stringify([...new Set(soc)])}  ${socOk ? 'ok' : 'FAIL'}`);
    if (!socOk) fail(soc.length ? '.st-social-btn is underlined' : 'no .st-social-btn on the rich specimen — nothing measured');
  }

  // ── 5. footer links: the footer's colour and weight, no underline, accent on hover ─────────────
  const ft = await page.evaluate(() => {
    const links = [...document.querySelectorAll('.st-footer a')];
    const rows = links.map((a) => {
      const cs = getComputedStyle(a), ps = getComputedStyle(a.parentElement);
      return { color: cs.color, parent: ps.color, weight: cs.fontWeight, parentWeight: ps.fontWeight, deco: cs.textDecorationLine };
    });
    // every colour rule on `.st-footer a`, across every stylesheet, that still claims !important
    const imp = [];
    const visit = (rules) => { for (const r of rules) { if (r.cssRules && !r.selectorText) { visit(r.cssRules); continue; }
      if (r.selectorText && /\.st-footer a\b(?!:)/.test(r.selectorText) && r.style.getPropertyPriority('color') === 'important') imp.push(r.cssText.slice(0, 90)); } };
    for (const s of document.styleSheets) { try { visit(s.cssRules); } catch {} }
    // the accent the hover should land on, resolved by the browser in the footer's own context
    const probeEl = document.createElement('span'); probeEl.style.color = 'var(--cp-accent-bright)';
    document.querySelector('.st-footer').appendChild(probeEl);
    const accent = getComputedStyle(probeEl).color; probeEl.remove();
    return { rows, imp, credit: document.querySelectorAll('.st-footer-credit').length, accent };
  });
  let hover = null;
  if (ft.rows.length) {
    await page.hover('.st-footer a');
    await page.waitForTimeout(400);
    hover = await page.evaluate(() => getComputedStyle(document.querySelector('.st-footer a')).color);
    await page.mouse.move(0, 0);
  }
  const quiet = ft.rows.length > 0 && ft.rows.every((r) => r.color === r.parent && r.weight === r.parentWeight && r.deco === 'none');
  const ftOk = quiet && ft.imp.length === 0 && ft.credit === 0 && hover === ft.accent && hover !== ft.rows[0].color;
  console.log(`    5 footer            n=${ft.rows.length} ${JSON.stringify(ft.rows[0] || {})} hover=${hover} accent=${ft.accent} !important=${ft.imp.length} credit-class=${ft.credit}  ${ftOk ? 'ok' : 'FAIL'}`);
  if (!ft.rows.length) fail('no footer link — the credit injection did not take, nothing measured');
  else {
    if (!quiet) fail('footer links are not quiet (accent colour, bold, or underline)');
    if (ft.imp.length) fail(`${ft.imp.length} !important colour layer(s) on .st-footer a: ${ft.imp.join(' ‖ ')}`);
    if (ft.credit) fail('.st-footer-credit is still emitted');
    if (hover !== ft.accent || hover === ft.rows[0].color) fail(`hover is not the accent (${hover} vs ${ft.accent})`);
  }

  // ── 2. the QR holder follows the avatar ───────────────────────────────────────────────────────
  if (handle === 'specimen-rich') {
    const geo = () => page.evaluate(() => {
      const h = document.getElementById('qr-holder'), f = document.querySelector('.st-hero .st-figure');
      if (!h || !f) return null;
      // while the QR is open the avatar is OUT of the hero (in #qr-group); the holder is measured alone
      const i = document.querySelector('.st-hero .cp-icon') || document.querySelector('#qr-group .cp-icon');
      const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, w: r.width, h: r.height }; };
      return { inlineW: h.style.width, inlineH: h.style.height, holder: R(h), icon: i ? R(i) : null, inHero: !!document.querySelector('.st-hero .cp-icon'), fig: R(f), hero: Math.round(document.querySelector('.st-hero').getBoundingClientRect().height) };
    });
    const follows = (g) => g && g.inHero && g.icon && Math.abs(g.holder.w - g.icon.w) <= 1 && Math.abs(g.holder.h - g.icon.h) <= 1 && Math.abs(g.icon.x - g.fig.x) <= 1;
    const g0 = await geo();
    // the Deck's case, and any breakpoint's: the avatar changes size AFTER the coral mounted
    await page.addStyleTag({ content: '.st-card .st-hero .cp-icon{width:140px!important;height:140px!important}' });
    await page.waitForTimeout(100);
    const g1 = await geo();
    // and the flight: open the QR, the holder must keep the avatar's place (no layout jump under
    // the overlay); close it, and the holder must go back to following the avatar
    await page.click('.st-hero .cp-icon');
    await page.waitForTimeout(1600);
    const gOpen = await geo();
    const opened = await page.evaluate(() => !!document.getElementById('qr-group'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1800);
    const g2 = await geo();
    const qrOk = follows(g0) && follows(g1) && opened && gOpen && !gOpen.inHero && gOpen.hero === g1.hero && Math.abs(gOpen.holder.w - g1.icon.w) <= 1 && follows(g2) && !g2.inlineW;
    const f = (g) => !g ? 'missing' : `holder ${g.holder.w.toFixed(0)}×${g.holder.h.toFixed(0)} inline=${JSON.stringify(g.inlineW)}`
      + (g.inHero ? ` icon ${g.icon.w.toFixed(0)}×${g.icon.h.toFixed(0)} off-centre ${(g.icon.x - g.fig.x).toFixed(1)}px` : ' (avatar out on the flight)');
    console.log(`    2 qr-holder         mount: ${f(g0)}\n                        avatar→140: ${f(g1)}\n                        open: ${f(gOpen)} hero ${gOpen && gOpen.hero} (was ${g1 && g1.hero}) group=${opened}\n                        closed: ${f(g2)}  ${qrOk ? 'ok' : 'FAIL'}`);
    if (!g0) fail('no #qr-holder / avatar — the QR coral did not mount');
    else if (!qrOk) fail('#qr-holder does not follow the avatar (stale inline size, off centre, or a layout jump while open)');
  }

  console.log(`    errors=${errs.length}${errs.length ? '\n      ' + errs.join('\n      ') : ''}${net.length ? '\n      failed requests: ' + net.join(', ') : ''}`);
  if (errs.length) fail(`${errs.length} console error(s)`);
  await ctx.close();
}

for (const handle of CARDS) for (const view of VIEWS) for (const scheme of SCHEMES) await probe(handle, view, scheme);

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ spread layout clean at 390×844, 844×390 and 1280×800, and all five renderer fixes hold');
process.exitCode = bad ? 1 : 0;
