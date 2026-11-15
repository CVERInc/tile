// The corner dock's size, edge distance and motion in a real browser (reef#3306): what the node tests
// cannot see — computed geometry at two widths in both corners, the installed-app bar staying at its
// own size, and which transitions of presence play an animation.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/dock/dock-motion.smoke.mjs [path/to/dock.js]
//
// The optional argument is a different copy of dock.js (the mutation runs use it: break the copy,
// the matching arm must go red). Chromium only. Exits 1 on any failure.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;
const { readFileSync } = await import('node:fs');
const SRC = readFileSync(process.argv[2] || new URL('./dock.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const failures = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

const ICON = '<svg slot="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>';
const item = (id, attrs = '') => `<div id="${id}" data-dynamic-coral="dock" ${attrs} data-label="${id}" hidden>${ICON}<div><h2>Panel</h2></div></div>`;
const page = (body, htmlAttr = '') => `<!doctype html><html ${htmlAttr}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:200vh}</style></head><body>${body}</body></html>`;

// Counts every Element.animate call from before any script runs, so "nothing played" is a count of
// zero rather than an absence of evidence at one instant.
const HOOK = `(() => { const a = Element.prototype.animate; window.__anims = []; Element.prototype.animate = function (k, o) {
  window.__anims.push({ id: this.id || this.localName, opts: JSON.parse(JSON.stringify(o)) }); return a.call(this, k, o); }; })();`;

const browser = await lib.chromium.launch();

async function open({ width, height = 800, body, htmlAttr, reduced = false }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage();
  await p.addInitScript(HOOK);
  await p.route('http://dock.test/', (r) => r.fulfill({ contentType: 'text/html', body: page(body, htmlAttr) }));
  await p.goto('http://dock.test/');
  await p.addScriptTag({ content: SRC });
  await p.waitForFunction(() => !!document.querySelector('dc-dock'));
  return { p, close: () => ctx.close() };
}

const bubbleBox = (p, id) => p.evaluate((i) => {
  const host = document.getElementById(i);
  const b = host.shadowRoot.querySelector('.b').getBoundingClientRect();
  const svg = host.querySelector('svg[slot="icon"]').getBoundingClientRect();
  return { w: b.width, h: b.height, right: innerWidth - b.right, left: b.left, bottom: innerHeight - b.bottom, icon: svg.width };
}, id);

// ── 1 + 2: size, icon and edge distance, at two widths, in both corners ────────────────────────────
for (const [width, size, icon, edge] of [[1440, 52, 22, 20], [390, 44, 20, 16], [700, 52, 22, 20], [699, 44, 20, 16]]) {
  const { p, close } = await open({ width, body: item('R') + item('L', 'data-dock="left"') });
  await sleep(50);
  const r = await bubbleBox(p, 'R');
  const l = await bubbleBox(p, 'L');
  check(`${width}px: right bubble is ${size}px, glyph ${icon}px, ${edge}px off the right and bottom edges`,
    r.w === size && r.h === size && Math.round(r.icon) === icon && Math.round(r.right) === edge && Math.round(r.bottom) === edge, JSON.stringify(r));
  check(`${width}px: left bubble is ${size}px, glyph ${icon}px, ${edge}px off the left and bottom edges`,
    l.w === size && l.h === size && Math.round(l.icon) === icon && Math.round(l.left) === edge && Math.round(l.bottom) === edge, JSON.stringify(l));
  await close();
}
{
  // Two stacked bubbles: the gap stays 8px.
  const { p, close } = await open({ width: 1440, body: item('A') + item('B') });
  await sleep(50);
  const gap = await p.evaluate(() => {
    const [a, b] = ['A', 'B'].map((i) => document.getElementById(i).shadowRoot.querySelector('.b').getBoundingClientRect());
    return a.top - b.bottom;
  });
  check('bubbles in one corner are 8px apart', Math.round(gap) === 8, String(gap));
  await close();
}

// ── 7: the installed-app bar is not a bubble ──────────────────────────────────────────────────────
for (const width of [1440, 390]) {
  const bar = '<dc-dock name="bar" hidden><a href="/" style="display:flex">Home</a></dc-dock>';
  const { p, close } = await open({ width, body: bar + item('A'), htmlAttr: 'data-dc-dock-bar' });
  await sleep(50);
  const m = await p.evaluate(() => {
    const dock = document.querySelector('dc-dock[name="bar"]');
    const a = document.getElementById('A');
    const b = a.shadowRoot.querySelector('.b').getBoundingClientRect();
    const cs = getComputedStyle(dock);
    return { barH: dock.getBoundingClientRect().height, tabH: b.height, size: cs.getPropertyValue('--dc-dock-size').trim(), icon: a.querySelector('svg').getBoundingClientRect().width };
  });
  check(`${width}px: the bar keeps its 3.5rem (56px) height and tab size`, m.tabH === 56 && m.barH === 56 && Math.round(m.icon) === 26, JSON.stringify(m));
  await close();
}

// ── 4 5 6: motion ─────────────────────────────────────────────────────────────────────────────────
const anims = (p) => p.evaluate(() => window.__anims.slice());
const reset = (p) => p.evaluate(() => { window.__anims.length = 0; });
const panelOf = (id) => `document.getElementById('${id}').querySelector(':scope > div')`;
// A bubble that joins the dock long after load, the way an inbox behind its claim gate does.
const join = (p, id) => p.evaluate((i) => {
  const d = document.createElement('div'); d.id = i; d.textContent = i;
  document.querySelector('dc-dock[name="right"]').appendChild(d);
}, id);

{
  const { p, close } = await open({ width: 1440, body: item('A') + item('B') });
  await sleep(100);
  check('the page arriving plays nothing: the bubbles are simply there', (await anims(p)).length === 0, JSON.stringify(await anims(p)));
  const visible = await p.evaluate(() => ['A', 'B'].every((i) => !document.getElementById(i).hidden));
  check('...and they are visible', visible);

  // (a) a bubble that first joins 2s after load is also just there.
  await sleep(2000);
  await join(p, 'L');
  await sleep(100);
  const lateJoin = await p.evaluate(() => { const l = document.getElementById('L'); return { in: l.parentNode.localName === 'dc-dock', vis: getComputedStyle(l).display !== 'none' }; });
  check('a bubble that first joins the dock 2s after load plays nothing', (await anims(p)).length === 0 && lateJoin.in && lateJoin.vis, JSON.stringify({ a: await anims(p), lateJoin }));

  // A re-order, an attribute update and a re-render are not a change of who is there — and the
  // re-inserted bubble has been seen before.
  await p.evaluate(() => {
    const a = document.getElementById('A');
    a.parentNode.insertBefore(a, null);
    a.setAttribute('data-label', 'renamed');
    a.querySelector('h2').textContent = 'again';
  });
  await sleep(100);
  check('re-order, attribute update and re-render play nothing', (await anims(p)).length === 0, JSON.stringify(await anims(p)));

  // (b) the same bubble hidden and shown again now plays: out 160ms ease, then in 320ms spring.
  await p.evaluate(() => { document.getElementById('L').hidden = true; });
  await sleep(40);
  const mid = await p.evaluate(() => {
    const l = document.getElementById('L');
    return { shown: getComputedStyle(l).display !== 'none', leaving: l.hasAttribute('data-dc-leaving'), inert: l.hasAttribute('inert'), aria: l.getAttribute('aria-hidden') };
  });
  const out = await anims(p);
  check('a bubble that leaves plays 160ms ease out, is still drawn, and is inert and aria-hidden meanwhile',
    out.length === 1 && out[0].id === 'L' && out[0].opts.duration === 160 && out[0].opts.easing === 'ease' && mid.shown && mid.leaving && mid.inert && mid.aria === 'true', JSON.stringify({ out, mid }));
  await sleep(250);
  const gone = await p.evaluate(() => { const l = document.getElementById('L'); return getComputedStyle(l).display === 'none' && !l.hasAttribute('data-dc-leaving') && !l.hasAttribute('inert') && !l.hasAttribute('aria-hidden'); });
  check('...then it is gone and the flags are cleared', gone);

  await reset(p);
  await p.evaluate(() => { document.getElementById('L').hidden = false; });
  await sleep(40);
  const inn = await anims(p);
  check('the same bubble shown again plays 320ms spring-in with no delay when the corner is not empty',
    inn.length === 1 && inn[0].id === 'L' && inn[0].opts.duration === 320 && inn[0].opts.easing === 'cubic-bezier(.34,1.3,.64,1)' && !inn[0].opts.delay, JSON.stringify(inn));

  // Empty corner: everything goes, then one comes back (it has been seen) → waits 180ms.
  await sleep(400);
  await p.evaluate(() => { for (const i of ['A', 'B']) document.getElementById(i).querySelector(':scope > div').hidden = true; document.getElementById('L').hidden = true; });
  await sleep(400);
  await reset(p);
  await p.evaluate(() => { document.getElementById('A').querySelector(':scope > div').hidden = false; });
  await sleep(40);
  const late = await anims(p);
  check('the first bubble back into an empty corner waits 180ms before the spring-in', late.length === 1 && late[0].opts.delay === 180, JSON.stringify(late));

  // (c) swap: A leaves, a NEW bubble (first join) is there at once and plays nothing.
  await sleep(600);
  await reset(p);
  await join(p, 'P');
  await sleep(100);
  await reset(p);
  await p.evaluate(() => {
    document.getElementById('P').hidden = true;
    const d = document.createElement('div'); d.id = 'N'; d.textContent = 'N';
    document.querySelector('dc-dock[name="right"]').appendChild(d);
  });
  await sleep(40);
  const swap = await anims(p);
  const nState = await p.evaluate(() => { const n = document.getElementById('N'); return { op: getComputedStyle(n).opacity, disp: getComputedStyle(n).display }; });
  check('a swap: the old bubble leaves (160ms); the new one is invisible until the exit ends, then springs in (320ms, delay = the wait, no 180)',
    swap.length === 2 && swap[0].id === 'P' && swap[0].opts.duration === 160 && swap[1].id === 'N' && swap[1].opts.duration === 320
      && swap[1].opts.delay >= 120 && swap[1].opts.delay <= 160 && nState.op === '0', JSON.stringify({ swap, nState }));
  await sleep(500);
  const nEnd = await p.evaluate(() => getComputedStyle(document.getElementById('N')).opacity);
  check('...and it is fully visible afterwards', nEnd === '1', nEnd);

  // A seen bubble coming back DURING another's exit waits for it (delay ~ 160, no extra beat).
  await sleep(600);
  await reset(p);
  await p.evaluate(() => { document.getElementById('N').hidden = true; });
  await sleep(10);
  await p.evaluate(() => { document.getElementById('P').hidden = false; });
  await sleep(40);
  const back = await anims(p);
  const bi = back.find((a) => a.id === 'P' && a.opts.duration === 320);
  check('a seen bubble returning while another leaves waits for it (delay between 120 and 160)', !!bi && bi.opts.delay >= 120 && bi.opts.delay <= 160, JSON.stringify(back));

  // Removal of a collapsed bubble: shrinks first, inert, removed after.
  await sleep(600);
  await reset(p);
  await p.evaluate(() => { document.getElementById('L').hidden = false; });
  await sleep(500);
  await reset(p);
  await p.evaluate(() => { document.getElementById('L').remove(); });
  await sleep(40);
  const rm = await p.evaluate(() => { const l = document.getElementById('L'); return { there: !!l, inert: !!l && l.hasAttribute('inert') && l.getAttribute('aria-hidden') === 'true', n: window.__anims.length }; });
  await sleep(250);
  const rm2 = await p.evaluate(() => !!document.getElementById('L'));
  check('a removed collapsed bubble shrinks out first (inert meanwhile) and is removed after', rm.there && rm.inert && rm.n === 1 && !rm2, JSON.stringify({ rm, rm2 }));
  await close();
}
// An open panel just goes: no shrink, hidden or removed.
for (const how of ['hidden', 'removed']) {
  const { p, close } = await open({ width: 1440, body: item('A') + item('B') });
  await sleep(1200);
  await p.evaluate(() => { document.getElementById('A').shadowRoot.querySelector('.b').click(); });
  await sleep(100);
  const opened = await p.evaluate(() => document.getElementById('A').shadowRoot.querySelector('.b').getAttribute('aria-expanded'));
  await reset(p);
  if (how === 'hidden') await p.evaluate(() => { document.getElementById('A').querySelector(':scope > div').hidden = true; });
  else await p.evaluate(() => { document.getElementById('A').remove(); });
  await sleep(40);
  const st = await p.evaluate(() => { const a = document.getElementById('A'); return { drawn: !!a && getComputedStyle(a).display !== 'none', n: window.__anims.length }; });
  check(`a bubble whose panel is open goes at once when ${how}: no exit animation, nothing left drawn`, opened === 'true' && st.n === 0 && !st.drawn, JSON.stringify({ opened, st }));
  await close();
}
// An inbox bubble whose panel is open is removed: it vanishes, no ghost, no shrink.
{
  const { readFileSync: rd } = await import('node:fs');
  const inboxJs = rd(new URL('../inbox-bubble/inbox-bubble.js', import.meta.url), 'utf8');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript(HOOK);
  await p.route('http://dock.test/inbox-bubble.js', (r) => r.fulfill({ contentType: 'text/javascript', body: inboxJs }));
  await p.route('http://dock.test/', (r) => r.fulfill({ contentType: 'text/html', body: page('<div id="ib" data-dynamic-coral="inbox-bubble" data-kind="site" data-id="m" data-api-base="http://api.test" data-site-name="M"></div><script type="module" src="http://dock.test/inbox-bubble.js"></script>') }));
  await p.route('http://api.test/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: r.request().url().includes('/api/inbox/session') ? '{"ok":true,"claimed":true}' : '{}' }));
  await p.goto('http://dock.test/');
  await p.waitForSelector('.dc-inbox-host', { state: 'attached' });
  await sleep(1200);
  await p.evaluate(() => { document.querySelector('.dc-inbox-host').shadowRoot.querySelector('button.dc-inbox-open').click(); });
  await sleep(200);
  const open1 = await p.evaluate(() => document.querySelector('.dc-inbox-host').shadowRoot.querySelector('button[aria-expanded="true"]') !== null);
  await reset(p);
  await p.evaluate(() => document.getElementById('ib').remove());
  await sleep(60);
  const st = await p.evaluate(() => ({ host: !!document.querySelector('.dc-inbox-host'), n: window.__anims.length }));
  check('an inbox bubble whose panel is open, removed: gone at once, no ghost, no shrink', open1 && !st.host && st.n === 0, JSON.stringify({ open1, st }));
  await ctx.close();
}
{
  const { p, close } = await open({ width: 1440, body: item('A') + item('B'), reduced: true });
  await sleep(1200);
  await p.evaluate(() => { document.getElementById('B').querySelector(':scope > div').hidden = true; });
  await sleep(300);
  await p.evaluate(() => { document.getElementById('B').querySelector(':scope > div').hidden = false; document.getElementById('A').remove(); });
  await sleep(100);
  const n = (await anims(p)).length;
  const aGone = await p.evaluate(() => !document.getElementById('A'));
  check('prefers-reduced-motion: reduce plays nothing (and removal is immediate)', n === 0 && aGone, JSON.stringify({ n, aGone }));
  await close();
}

await browser.close();
console.log(results.join('\n'));
console.log(failures.length ? `\n${failures.length} FAILED` : `\nall ${results.length} passed`);
process.exit(failures.length ? 1 : 0);
