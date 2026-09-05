// Every overlay on a Card closes the same way.
//
// chodaict: 「modal目前關閉看起來還是不同?我覺得該全部放左上角,行為就是跟qr一樣關閉可關、modal外也可關」
//
// There are two overlays — the QR popup and the drawer — and they had learned different manners. The
// QR pinned its ✕ top-LEFT over a full-screen morph; the drawer floated its own top-RIGHT inside the
// panel. A reader who learns where ✕ lives from one then has to hunt for it in the other, and every
// overlay on a Card is the same promise.
//
// Three claims, for EACH overlay:
//   1. the close control is in the top-LEFT quadrant of the thing it closes
//   2. pressing it closes
//   3. clicking OUTSIDE the panel closes
//
// 🔴 CONTROL on 3, and it is the one that matters: clicking INSIDE the panel must NOT close it. A
// "clicking outside closed it" that is really "any click closes it" is a broken overlay that passes.
//
//   node packages/cardtile/verify/overlay-close.mjs
import http from 'node:http';
import { readCard, PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

const CARDS = ['specimen-plain', 'specimen-assets', 'specimen-rich'];
// 🩸 Was a customer's handle, annotated "the only card with drawers" — true when it was written,
// and by 2026-08-12 that card had left the package. Every overlay this file closes (drawer, QR)
// hangs off the avatar or a drawer trigger, so the specimen must state both, and it says so rather
// than spending 30 seconds waiting for `.st-hero .cp-icon`.
const HANDLE = 'specimen-rich';
{
  const md = readCard(HANDLE);
  if (!/%% card: profile[^%]*\bavatar=/.test(md)) throw new Error(`${HANDLE} states no avatar — the QR overlay opens from it`);
  if (!/^## drawer:/m.test(md)) throw new Error(`${HANDLE} has no drawer lane — there is no drawer overlay to close`);
}
const VIEW = { width: 390, height: 844 };

const store = { get: async (h) => (CARDS.includes(h) ? readCard(h) : null) };
const server = http.createServer(async (req, res) => {
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

const open = async () => {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}/${HANDLE}`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  return { ctx, page };
};

// ── the QR popup ────────────────────────────────────────────────────────────────────────────────
async function qr(action) {
  const { ctx, page } = await open();
  await page.click('.st-hero .cp-icon');
  await page.waitForTimeout(700);
  const placed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => /close|關閉/i.test(b.getAttribute('aria-label') || '') && b.offsetParent);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: innerWidth, h: innerHeight };
  });
  const isOpen = () => page.evaluate(() => {
    const o = document.getElementById('qr-overlay');
    return !!(o && o.style.display !== 'none' && getComputedStyle(o).opacity !== '0');
  });
  let after = null;
  // 🔴 1500ms, not 800. The QR's close is nested timeouts — 650ms, then 420ms inside it — before
  // the overlay is finally set to display:none, so a shorter wait reports a closing overlay as
  // still open. The first run failed here and the coral was fine; the probe was early.
  const SETTLE = 1500;
  if (action === 'button' && placed) { await page.mouse.click(placed.cx, placed.cy); await page.waitForTimeout(SETTLE); after = await isOpen(); }
  if (action === 'outside') { await page.mouse.click(VIEW.width - 12, VIEW.height - 12); await page.waitForTimeout(SETTLE); after = await isOpen(); }
  if (action === 'inside') {
    // 🔴 the control: a click that lands ON the QR card itself must NOT dismiss
    const p = await page.evaluate(() => {
      const g = document.getElementById('qr-group');
      const r = g && g.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });
    if (p) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(SETTLE); after = await isOpen(); }
  }
  const wasOpen = action === null ? await isOpen() : null;
  await ctx.close();
  return { placed, after, wasOpen };
}

// ── the drawer ──────────────────────────────────────────────────────────────────────────────────
async function drawer(action) {
  const { ctx, page } = await open();
  const opened = await page.evaluate(() => {
    const a = document.querySelector('[data-drawer]');
    if (!a) return false;
    a.click();
    return true;
  });
  if (!opened) { await ctx.close(); return { placed: null, after: null, opened: false }; }
  await page.waitForTimeout(700);
  const placed = await page.evaluate(() => {
    // 🔴 The close now lives in the LAYER, not inside the panel — so it is looked up there, and
    // measured against the VIEWPORT like the QR's, because that is the whole point of moving it.
    // `.dc-drawer:target .dc-drawer-close` found nothing after the move, which the harness reported
    // as "no close control" rather than quietly passing. That is the selector doing its job.
    const btn = document.querySelector('.dc-drawer-layer .dc-drawer-close');
    const panel = document.querySelector('.dc-drawer:target');
    if (!btn || !panel) return null;
    const r = btn.getBoundingClientRect(); const p = panel.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    if (cs.visibility === 'hidden' || cs.opacity === '0') return null;   // present but inert ≠ offered
    return {
      cx: r.left + r.width / 2, cy: r.top + r.height / 2,
      w: window.innerWidth, h: window.innerHeight,       // it is fixed to the viewport now
      px: p.left, py: p.top, pw: p.width, ph: p.height,  // the panel, for the inside-click control
      fixed: cs.position === 'fixed',
    };
  });
  const isOpen = () => page.evaluate(() => !!document.querySelector('.dc-drawer:target'));
  let after = null;
  if (action === 'button' && placed) { await page.mouse.click(placed.cx, placed.cy); await page.waitForTimeout(700); after = await isOpen(); }
  if (action === 'outside') { await page.mouse.click(VIEW.width / 2, 40); await page.waitForTimeout(700); after = await isOpen(); }
  if (action === 'inside' && placed) {
    await page.mouse.click(placed.px + placed.pw / 2, placed.py + placed.ph - 30);
    await page.waitForTimeout(700); after = await isOpen();
  }
  await ctx.close();
  return { placed, after, opened: true };
}

console.log('CLAIM 1 — the close control sits in the TOP-LEFT of what it closes\n');
const q = await qr(null);
if (!q.placed) { console.log('  qr      🔴 no close control found — nothing was measured'); bad++; }
else {
  const leftHalf = q.placed.cx < q.placed.w / 2;
  const topThird = q.placed.cy < q.placed.h / 3;
  console.log(`  qr      ✕ at (${Math.round(q.placed.cx)}, ${Math.round(q.placed.cy)}) of ${q.placed.w}×${q.placed.h}   ${leftHalf && topThird ? 'top-left ✓' : '🔴 NOT top-left'}`);
  if (!leftHalf || !topThird) bad++;
}
const d = await drawer(null);
if (!d.opened) { console.log('  drawer  🔴 no drawer opened — nothing was measured'); bad++; }
else if (!d.placed) { console.log('  drawer  🔴 no close control found'); bad++; }
else {
  const leftHalf = d.placed.cx < d.placed.w / 2;
  const topThird = d.placed.cy < d.placed.h / 3;
  console.log(`  drawer  ✕ at (${Math.round(d.placed.cx)}, ${Math.round(d.placed.cy)}) of ${d.placed.w}×${d.placed.h}   position:${d.placed.fixed ? 'fixed' : 'NOT fixed'}   ${leftHalf && topThird ? 'top-left ✓' : '🔴 NOT top-left'}`);
  if (!leftHalf || !topThird) bad++;
  // 🔴 「搬到最外面」 is the claim, and "looks top-left" does not establish it. A sticky button inside
  // a scrolling panel also looks top-left — until the panel scrolls. Fixed is the difference, and it
  // is only achievable from outside `.dc-drawer`, whose transform would otherwise contain it.
  if (!d.placed.fixed) { console.log('   🔴 the close is not fixed to the viewport — it is still inside the panel'); bad++; }
  // and it must agree with the QR's corner rather than merely being in the same quadrant
  if (q.placed && (Math.abs(d.placed.cx - q.placed.cx) > 2 || Math.abs(d.placed.cy - q.placed.cy) > 2)) {
    console.log(`   🔴 the two overlays put ✕ in different places: qr (${Math.round(q.placed.cx)}, ${Math.round(q.placed.cy)}) vs drawer (${Math.round(d.placed.cx)}, ${Math.round(d.placed.cy)})`);
    bad++;
  }
}

console.log('\nCLAIM 2 & 3 — the button closes, and so does a click outside');
for (const [name, fn] of [['qr', qr], ['drawer', drawer]]) {
  for (const act of ['button', 'outside']) {
    const r = await fn(act);
    const closed = r.after === false;
    console.log(`  ${name.padEnd(7)} ${act.padEnd(8)} → ${closed ? 'closed ✓' : `🔴 STILL OPEN (${r.after})`}`);
    if (!closed) bad++;
  }
  // 🔴 THE CONTROL. Without it, "clicking outside closed it" is indistinguishable from "any click
  // closes it", which is a broken overlay that passes every assertion above.
  const ctl = await fn('inside');
  const stayed = ctl.after === true;
  console.log(`  ${name.padEnd(7)} ${'inside'.padEnd(8)} → ${stayed ? 'stayed open ✓ (control)' : '🔴 CONTROL: a click INSIDE also closed it — "outside closes" proves nothing'}`);
  if (!stayed) bad++;
}

await browser.close();
server.close();
console.log(bad ? `\n🔴 ${bad} problem(s)` : '\n✅ both overlays close the same way, and only from outside');
process.exitCode = bad ? 1 : 0;
