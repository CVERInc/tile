// The drawer, end to end, against the real Worker.
//
// 🔴 Visibility is MEASURED, not inferred from an attribute. The first version of this checked
// `!panel.hidden && panel.classList.contains('is-open')` — both of which the renderer happened to
// set at the time. When opening moved into the drawer coral (CSS `:has(:checked)`, no attribute
// and no class), the check reported the drawer as closed while it was plainly on screen, and
// reported it as open once it had closed. A probe that reads bookkeeping instead of the thing
// itself fails in whichever direction the bookkeeping changed.
import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
import http from 'node:http';
import worker from '../serve/card-worker.mjs';
const pw = (await import(PLAYWRIGHT)).default;
const { chromium } = pw;
const md = readCard('specimen-rich');
const env = { CARDS: { get: async () => md } };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://localhost' + req.url, { headers: req.headers }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((ok) => server.listen(0, ok));
const base = 'http://localhost:' + server.address().port;
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
const errs = []; pg.on('pageerror', (e) => errs.push('' + e.message));

/** Is this drawer actually on screen? computed visibility + a box inside the viewport. */
const shown = (id) => pg.evaluate((drawerId) => {
  const p = document.querySelector(`[data-drawer-panel="${drawerId}"]`);
  if (!p) return { onScreen: false, why: 'no panel' };
  const cs = getComputedStyle(p);
  const r = p.getBoundingClientRect();
  return {
    onScreen: cs.visibility === 'visible' && Number(cs.opacity) > 0.5
      && r.width > 100 && r.top < window.innerHeight && r.bottom > 0,
    visibility: cs.visibility, opacity: cs.opacity,
    top: Math.round(r.top), height: Math.round(r.height),
  };
}, id);

await pg.goto(base + '/probe', { waitUntil: 'load' });
await pg.waitForTimeout(700);
console.log('BEFORE   :', JSON.stringify(await shown('about')));

// 1. open a drawer by clicking its tile
await pg.$eval('[data-drawer="about"]', (el) => el.click());
await pg.waitForTimeout(1200);
const open = await pg.evaluate(() => {
  const p = document.querySelector('[data-drawer-panel="about"]');
  return {
    hash: location.hash,
    title: p?.querySelector('.dc-drawer-title')?.textContent || '(none)',
    named: p?.getAttribute('aria-labelledby') || '(none)',
    hasProse: !!p?.querySelector('.st-prose'),
    proseChars: p?.querySelector('.st-prose')?.textContent.trim().length || 0,
    focusInside: !!p?.contains(document.activeElement),
    nestedDrawerLinks: p?.querySelectorAll('[data-drawer]').length,
    scrollLocked: getComputedStyle(document.body).overflow === 'hidden',   // CSS does this now, not script
  };
});
await pg.screenshot({ path: OUT + '/drawer-open.png' });
console.log('OPEN     :', JSON.stringify(await shown('about')), JSON.stringify(open));

// 2. Esc closes it and restores the URL
await pg.keyboard.press('Escape');
await pg.waitForTimeout(900);
console.log('AFTER ESC:', JSON.stringify(await shown('about')),
  JSON.stringify(await pg.evaluate(() => ({ hash: location.hash || '(none)' }))));

// 3. deep link straight to a drawer
await pg.goto(base + '/probe#about', { waitUntil: 'load' });
await pg.waitForTimeout(1200);
console.log('DEEP LINK:', JSON.stringify(await shown('about')));

// 4. 🔴 the promise the coral makes: content is reachable with NO script at all. Opening is CSS.
// 🩸 `reducedMotion: 'reduce'` because CI said so, and only CI could have. This click is on the
// REAL trigger with JS disabled, and Playwright refuses to click something that is still moving:
// "element is not stable", 90s, TimeoutError. On this Mac the entry animation had always settled
// before the click; on a slower headless runner it had not. The harness passed locally for weeks.
//
// 🔴 And it is not a `force: true` — that would skip the actionability check and quietly stop
// testing whether a reader can actually hit the thing. The card's CSS already answers reduced
// motion with `*{animation-duration:.01ms!important}` (7 rules), so this turns the animation off at
// the source rather than teaching the test to look away. Checked before writing it: a reducedMotion
// flag against CSS that ignores the query would have been one more inert fix.
const noJs = await b.newContext({
  javaScriptEnabled: false, reducedMotion: 'reduce', viewport: { width: 900, height: 1000 },
});
const p2 = await noJs.newPage();
await p2.goto(base + '/probe', { waitUntil: 'load' });
// Click the real trigger the way a reader would. Nothing is simulated: with JS disabled the anchor
// is just an anchor, the browser moves the fragment, and :target does the rest.
await p2.click('[data-drawer="about"]');
await p2.waitForTimeout(700);
const cssOnly = await p2.evaluate(() => {
  const p = document.querySelector('[data-drawer-panel="about"]');
  const cs = getComputedStyle(p);
  const r = p.getBoundingClientRect();
  return { opened: cs.visibility === 'visible' && r.top < window.innerHeight && r.bottom > 0,
           hash: location.hash, visibility: cs.visibility, opacity: cs.opacity,
           scrollLocked: getComputedStyle(document.body).overflow === 'hidden' };
});
console.log('NO-JS open :', JSON.stringify(cssOnly));
// Click the close link at its own coordinates. `page.click()` waits for the element to hold still,
// and a position:sticky control inside a scrolling panel never quite does — it timed out on an
// element that was visible, hit-testable and perfectly clickable by a person.
const box = await p2.evaluate(() => {
  const a = document.querySelector('.dc-drawer-layer .dc-drawer-close');
  const r = a.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, onTop: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === a };
});
await p2.mouse.click(box.x, box.y);
await p2.waitForTimeout(700);
const cssClosed = await p2.evaluate(() => ({
  closed: getComputedStyle(document.querySelector('[data-drawer-panel="about"]')).visibility === 'hidden',
  hash: location.hash || '(none)',
  scrollFree: getComputedStyle(document.body).overflow !== 'hidden',
}));
console.log('NO-JS close:', JSON.stringify({ ...cssClosed, hitTestOk: box.onTop }));
await noJs.close();

console.log('ERRORS   :', errs.length ? errs.join(' | ') : '(none)');
await b.close(); server.close();
