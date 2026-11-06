// Cards settings and the one glass layer, driven in a real browser against the Worker's own editor page.
//
//   node packages/cardtile/verify/settings-panel.mjs
//
// Claims, each with the control that would catch it passing by accident:
//   1. ONE GLASS LAYER. While settings, a tile's sheet or the picker is open, the top bar is UNDER the glass: a
//      tap where Save is lands on the layer, not on Save. Only ✕ is above it, at the top-left where the logo is.
//      CONTROL: with nothing open, the same point IS Save.
//   2. ✕ and Escape close (✕ the top-most layer first: the sign-in door before settings). The panel slides back
//      down before it goes — an animation runs; with reduced motion there is none and it goes at once.
//   3. Narrow (390): a row with a page pushes it; the page's "‹ Settings" (in the panel) comes back.
//   4. Wide (1280): the sidebar switches the group shown on the right; the panel is at most 1000px, centred.
//   5. The sandbox's sign-in row opens the SAME door Save opens (#doormodal).
//   6. Start over asks first: an action sheet narrow, a centred alert wide. Cancel changes nothing.
//   7. A change in settings goes into the draft (and the top bar's Save shows the unsaved dot); no Save inside.
//   8. A downward swipe on the panel's header closes it.
//   9. Host mode (framed by a http://localhost parent): no sign-in, pool, domain, transfer or Start over; the
//      address is read-only.
//  10. No sideways scroll at 390; no console errors anywhere.
import http from 'node:http';
import { PLAYWRIGHT, readCard } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

const SPEC = readCard('specimen-rich');
const store = { get: async () => null, async getWithMetadata() { return { value: null, metadata: null }; } };
let port = 0;
// the host-mode parent: frames /edit?host=<this origin> and hands it a card when it says it is ready
const parent = (lang) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>
<iframe id="f" src="/edit?host=${encodeURIComponent(`http://localhost:${port}`)}&lang=${lang}"></iframe>
<script>const md=${JSON.stringify(SPEC).replace(/</g, '\\u003c')};addEventListener('message',(e)=>{if((e.data||{}).type==='card:ready')document.getElementById('f').contentWindow.postMessage({v:1,type:'card:load',md,handle:'specimen-rich'},location.origin);});</script>`;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/_parent') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(parent(u.searchParams.get('lang') || 'en')); return; }
  const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`), { CARDS: store });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((ok) => server.listen(0, 'localhost', ok));
port = server.address().port;
const base = `http://localhost:${port}`;
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch();
let bad = 0;
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) bad++; };

async function open(width, { reduced = false, host = false, lang = 'en' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference', locale: lang });
  const page = await ctx.newPage();
  const errors = [];
  // A failed fetch is counted by its response, so it can be named. The one expected miss: the specimen's links
  // point at example domains, and this harness's Worker has no icon store, so their /_icon/ fetches 404 — the
  // card preview's business, not this panel's.
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { const p = new URL(r.url()).pathname; if (r.status() >= 400 && !p.startsWith('/_icon/')) errors.push(`${r.status()} ${p}`); });
  let f = page;
  if (host) {
    await page.goto(`${base}/_parent?lang=${lang}`);
    f = page.frameLocator('#f');
    await page.waitForFunction(() => { const d = document.getElementById('f').contentDocument; return d && !d.body.dataset.hostWaiting && d.querySelector('#cardset'); }, null, { timeout: 15000 });
    f = page.frames().find((x) => x.url().includes('/edit?host='));
  } else {
    await page.goto(`${base}/try/edit?lang=${lang}`);
    await page.waitForFunction(() => window.__cardtileW3, null, { timeout: 15000 });
  }
  return { ctx, page, f, errors };
}
// what a tap at the centre of `sel` would hit
const hits = (f, sel) => f.evaluate((s) => { const n = document.querySelector(s), r = n.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return at === n || n.contains(at) ? 'self' : at.closest('[id]')?.id || at.tagName; }, sel);
const shown = (f, sel) => f.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.hidden && n.getClientRects().length > 0; }, sel);
const settle = (page) => page.waitForTimeout(500);

// ── narrow, sandbox ──
{
  const { ctx, page, f, errors } = await open(390);
  check(await hits(f, '#editbtn') === 'self', 'control: with nothing open, a tap on Save hits Save');
  await page.click('#cardset');
  const animating = await page.evaluate(() => document.getElementById('set-panel').getAnimations().length > 0);
  check(animating, 'settings slides up (an animation runs on the panel)');
  await settle(page);
  check(await hits(f, '#editbtn') === 'settings', '1. settings open: the top bar is under the glass (a tap on Save lands on the layer)');
  check(await hits(f, '#cardset') === 'settings', '1. …and so is the settings button');
  const x = await page.evaluate(() => { const c = document.getElementById('close').getBoundingClientRect(), l = document.getElementById('lockup').getBoundingClientRect(), h = document.querySelector('header').getBoundingClientRect(), p = document.getElementById('set-panel').getBoundingClientRect(); return { dx: Math.abs(c.left - l.left), inBar: c.top >= h.top && c.bottom <= h.bottom, clear: c.bottom <= p.top }; });
  check(x.dx <= 2 && x.inBar, '1. ✕ sits where the logo is (the bar\'s row, the lockup\'s left edge)');
  check(x.clear, '1. …and the panel never covers it');
  check(await hits(f, '#close') === 'self', '1. ✕ is the one thing above the glass');
  check(await page.evaluate(() => !!document.querySelector('.set-big h2') && !document.querySelector('.set-pg .set-nav')), '3. the root has a large title and no empty nav strip');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '10. no sideways scroll at 390');
  // 3. push / back
  await page.click('#opt-theme'); await settle(page);
  const pushed = await page.evaluate(() => { const b = document.querySelector('.set-pg:last-child .set-back'); return b && b.textContent.trim(); });
  check(pushed === 'Settings', '3. a row pushes its page; its top-left says ‹ Settings');
  check(await page.evaluate(() => document.querySelectorAll('.set-pg:last-child [role=radio]').length === 3 && !document.querySelector('.set-pg:last-child select, .set-pg:last-child .open-seg')), '3. a 3-option choice is a checkmark list (no select, no segmented control)');
  // 7. a change goes into the draft
  await page.click('.set-pg:last-child [data-v="dark"]');
  check(await page.evaluate(() => /^theme: dark$/m.test(window.__cardtileW3.md)), '7. picking Dark writes it into the draft');
  check(await page.evaluate(() => document.querySelector('.set-pg:last-child [data-v="dark"]').getAttribute('aria-checked') === 'true'), '7. …and the checkmark moves');
  await page.click('.set-pg:last-child .set-back'); await settle(page);
  check(await page.evaluate(() => document.querySelectorAll('.set-pg').length === 1 && document.querySelector('#opt-theme .set-v').textContent === 'Dark'), '3. back: the root again, showing the new value');
  // 6. Start over asks first (an action sheet), Cancel changes nothing
  const before = await page.evaluate(() => window.__cardtileW3.md);
  await page.click('#opt-reset');
  check(await shown(f, '.set-confirm.is-sheet .set-sheet'), '6. Start over asks first, as an action sheet');
  await page.keyboard.press('Escape');
  check(!(await shown(f, '#set-confirm')) && await shown(f, '#settings'), '2. Escape closes the action sheet first, settings stays');
  check(await page.evaluate(() => window.__cardtileW3.md) === before, '6. …and nothing was cleared');
  // 5. the sign-in row opens the same door Save opens
  await page.click('#opt-signin');
  check(await shown(f, '#doormodal'), '5. the sign-in row opens the door Save opens');
  await page.click('#close');
  check(!(await shown(f, '#doormodal')) && await shown(f, '#settings'), '2. ✕ closes the door first; settings is still there under it');
  // 2. ✕ closes, with the slide down
  await page.click('#close');
  const closing = await page.evaluate(() => document.getElementById('settings').classList.contains('is-closing'));
  check(closing, '2. ✕ closes the panel with its slide down');
  await settle(page);
  check(await page.evaluate(() => document.getElementById('settings').hidden), '2. …and then it is gone');
  check(await page.evaluate(() => !!document.querySelector('#editbtn .hd-dot')), '7. the top bar\'s Save carries the unsaved dot');
  // 8. swipe down on the header
  await page.click('#cardset'); await settle(page);
  const h = await page.evaluate(() => { const r = document.querySelector('.set-big').getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; });
  await page.evaluate(({ x, y }) => {
    const n = document.querySelector('.set-big'), ev = (type, dy) => n.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y + dy, button: 0 }));
    ev('pointerdown', 0); ev('pointermove', 60); ev('pointermove', 140); ev('pointerup', 140);
  }, h);
  await settle(page);
  check(await page.evaluate(() => document.getElementById('settings').hidden), '8. a downward swipe on the header closes the panel');
  // 1. the tile sheets wear the same glass: the picker
  await page.click('.slot.add .new'); await settle(page);
  check(await hits(f, '#editbtn') === 'picker', '1. the picker open: the top bar is under the glass too');
  const px = await page.evaluate(() => { const c = document.getElementById('close').getBoundingClientRect(), l = document.getElementById('lockup').getBoundingClientRect(); return Math.abs(c.left - l.left) <= 2 && !document.getElementById('close').hidden; });
  check(px, '1. …with ✕ in the same place');
  await page.keyboard.press('Escape');
  check(!(await shown(f, '#picker')), '2. Escape closes the picker');
  check(errors.length === 0, `10. no console errors (narrow): ${errors.join(' | ')}`);
  await ctx.close();
}

// ── reduced motion: no animation, closes at once ──
{
  const { ctx, page } = await open(390, { reduced: true });
  await page.click('#cardset');
  check(await page.evaluate(() => document.getElementById('set-panel').getAnimations().length === 0), '2. reduced motion: the panel does not slide');
  await page.click('#close');
  check(await page.evaluate(() => document.getElementById('settings').hidden), '2. reduced motion: ✕ closes at once');
  await ctx.close();
}

// ── wide, sandbox ──
{
  const { ctx, page, f, errors } = await open(1280);
  await page.click('#cardset'); await settle(page);
  const w = await page.evaluate(() => { const r = document.getElementById('set-panel').getBoundingClientRect(); return { w: r.width, l: r.left, rgt: innerWidth - r.right }; });
  check(w.w <= 1000 && Math.abs(w.l - w.rgt) <= 1, `4. the panel is at most 1000px and centred (${Math.round(w.w)}px)`);
  check(await hits(f, '#editbtn') === 'settings', '1. wide: the top bar is under the glass');
  await page.click('.set-si[data-g="look"]');
  check(await page.evaluate(() => document.querySelector('.set-ttl').textContent === 'Look' && document.querySelector('.set-main select#opt-theme') && document.querySelector('.set-si[data-g="look"]').getAttribute('aria-current') === 'true'), '4. the sidebar switches the group; simple choices are inline dropdowns');
  // a thing with a page of its own pushes WITHIN the right side, its back naming the group
  await page.click('.set-si[data-g="name"]'); await page.click('#opt-hchange');
  check(await page.evaluate(() => document.querySelector('.set-main .set-back')?.textContent.trim() === 'Name and address' && !!document.querySelector('.set-side')), '4. wide: the address page pushes inside the right side, "‹ Name and address"');
  await page.fill('#opt-hnew', 'admin');
  check(await page.evaluate(() => document.getElementById('opt-herr').classList.contains('is-err') && document.getElementById('opt-hgo').disabled), '4. …and its footnote says why a reserved address cannot be had');
  await page.click('.set-main .set-back');
  await page.click('.set-si[data-g="more"]');
  await page.click('#opt-reset');
  check(await shown(f, '.set-confirm.is-alert .set-alert'), '6. wide: Start over asks with a centred alert');
  await page.click('#set-go'); await settle(page);
  check(await page.evaluate(() => document.getElementById('settings').hidden && window.__cardtileW3.md === '## cards\n\n'), '6. confirming Start over empties the card and closes the panel');
  check(errors.length === 0, `10. no console errors (wide): ${errors.join(' | ')}`);
  await ctx.close();
}

// ── host mode, framed by a http://localhost parent ──
{
  const { ctx, page, f, errors } = await open(390, { host: true });
  await f.click('#cardset'); await page.waitForTimeout(500);
  const gone = await f.evaluate(() => ['opt-signin', 'opt-reset', 'opt-pool', 'opt-domain', 'opt-transfer'].filter((id) => document.getElementById(id)));
  check(gone.length === 0, `9. host mode: no sign-in, Start over, pool, domain or transfer (${gone.join(', ')})`);
  check(await f.evaluate(() => { const r = document.getElementById('opt-handle'); return !!r && r.tagName === 'DIV' && /reef\.cards\/specimen-rich/.test(r.textContent); }), '9. host mode: the address is shown read-only');
  check(await hits(f, '#editbtn') === 'settings', '1. host mode: the top bar is under the glass');
  await f.click('#close'); await page.waitForTimeout(500);
  check(await f.evaluate(() => document.getElementById('settings').hidden), '2. host mode: ✕ closes');
  check(errors.length === 0, `10. no console errors (host): ${errors.join(' | ')}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
