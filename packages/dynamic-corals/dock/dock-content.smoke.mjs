// What a dock item does when its panel's content arrives AFTER it is mounted, in a real browser:
// the panel's width at four viewport widths, the bubble taking its name from a heading written
// later, and auto-open kept once per content (`data-auto-open-by`). The node tests drive the same
// rules against a hand-fired observer; here the browser's own MutationObserver, layout and
// sessionStorage do it.
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/dock/dock-content.smoke.mjs http://127.0.0.1:8749/packages/dynamic-corals/dock/
//
// The argument is the base URL of this directory, the one scripts/test.sh hands every browser smoke;
// dock.js is read from it. DOCK_CONTENT_SRC=<path> reads dock.js from that file instead (for a
// mutation run: break a copy, the matching arm must go red). Chromium only. Exits 1 on any failure.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const lib = pw.default ?? pw;
const base = process.argv[2];
if (!base) throw new Error('usage: node dock-content.smoke.mjs <url of packages/dynamic-corals/dock/>');
const { readFileSync } = await import('node:fs');
const SRC = process.env.DOCK_CONTENT_SRC
  ? readFileSync(process.env.DOCK_CONTENT_SRC, 'utf8')
  : await (async () => {
    const r = await fetch(new URL('dock.js', base), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`dock.js: HTTP ${r.status}`);
    return r.text();
  })();

const results = [];
const failures = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

const ICON = '<svg slot="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>';
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:200vh}</style></head><body>${body}</body></html>`;

const browser = await lib.chromium.launch();
async function context(width, height = 800) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  // One origin for every load in this context, so sessionStorage is the visit's.
  let html = page('');
  await p.route('http://dock.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  const load = async (body) => {
    html = page(body);
    await p.goto('http://dock.test/');
    await p.addScriptTag({ content: SRC });
    await p.waitForFunction(() => !!document.querySelector('dc-dock'));
  };
  return { p, load, close: () => ctx.close() };
}
const state = (p, id) => p.evaluate((i) => {
  const host = document.getElementById(i);
  const b = host.shadowRoot.querySelector('.b');
  const panel = host.shadowRoot.querySelector('.p');
  return {
    hidden: host.hidden, open: b.getAttribute('aria-expanded') === 'true', name: b.getAttribute('aria-label'),
    dialog: panel.getAttribute('aria-label'), panelWidth: panel.hidden ? null : panel.getBoundingClientRect().width,
    keys: Object.keys(sessionStorage).filter((k) => k.startsWith('dc-dock:')).sort(),
  };
}, id);
const settle = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));

// ── 1: the panel's width — 440 from 700px wide, 22rem below, never wider than the screen leaves ──
for (const [width, want] of [[1440, 440], [700, 440], [699, 352], [390, 352], [340, 308]]) {
  const { p, load, close } = await context(width);
  await load(`<div id="a" data-dynamic-coral="dock" data-dock="left" data-label="A" hidden>${ICON}<div><h2>Panel</h2><p>content</p></div></div>`);
  await p.evaluate(() => document.getElementById('a').shadowRoot.querySelector('.b').click());
  await settle(p);
  const s = await state(p, 'a');
  check(`panel width at ${width}px wide is ${want}px`, s.panelWidth === want, `got ${s.panelWidth}`);
  await close();
}

// ── 2: the bubble is named by a heading that is written after it is mounted ──────────────────────
{
  const { p, load, close } = await context(1280);
  await load(`<div id="a" data-dynamic-coral="dock" data-dock="left" hidden>${ICON}<div><h2 id="h"></h2><p>content</p></div></div>`);
  let s = await state(p, 'a');
  check('with no label and an empty heading the bubble has no name yet', s.name === null && s.dialog === null, JSON.stringify(s));
  await p.evaluate(() => { document.getElementById('h').textContent = 'Studio events'; });
  await settle(p);
  s = await state(p, 'a');
  check('the heading, written later, names the bubble and the dialog', s.name === 'Studio events' && s.dialog === 'Studio events', JSON.stringify(s));
  await p.evaluate(() => document.getElementById('a').shadowRoot.querySelector('.b').click());
  await settle(p);
  s = await state(p, 'a');
  check('open, the bubble says what it closes', s.open && s.name === 'Close Studio events', JSON.stringify(s));
  await p.evaluate(() => { document.getElementById('h').textContent = 'Workshops'; });
  await settle(p);
  s = await state(p, 'a');
  check('renamed while open, it is still the close control', s.name === 'Close Workshops' && s.dialog === 'Workshops', JSON.stringify(s));
  // a text node edited in place (characterData), not replaced
  await p.evaluate(() => { document.getElementById('h').firstChild.data = 'Talks'; });
  await settle(p);
  s = await state(p, 'a');
  check('a heading whose text node is edited in place renames it too', s.name === 'Close Talks', JSON.stringify(s));
  await p.evaluate(() => document.getElementById('a').setAttribute('data-label', 'Events'));
  await settle(p);
  s = await state(p, 'a');
  check('a data-label written later wins over the heading', s.name === 'Close Events' && s.dialog === 'Events', JSON.stringify(s));
  await close();
}

// ── 3: data-auto-open-by — once per content, across page loads of one visit ──────────────────────
{
  const { p, load, close } = await context(1280);
  // The content un-hides itself and fills its text later, the way a countdown reading a feed does.
  const body = `<div id="a" data-dynamic-coral="dock" data-dock="left" data-label="Events" data-open-on-hash="events" data-auto-open="1" data-auto-open-by=".when,.title" hidden>${ICON}
    <div id="c" hidden><span class="when"></span> <strong class="title"></strong></div></div>`;
  const fill = (when, title) => p.evaluate(([w, t]) => {
    const c = document.getElementById('c');
    c.querySelector('.when').textContent = w; c.querySelector('.title').textContent = t; c.hidden = false;
  }, [when, title]);

  await load(body);
  await settle(p);
  let s = await state(p, 'a');
  check('before its content exists the item is retired and nothing is remembered', s.hidden && !s.open && s.keys.length === 0, JSON.stringify(s));
  await fill('Oct 12 – Dec 1', 'Applications open');
  await settle(p);
  s = await state(p, 'a');
  check('the content arrives: it opens, and remembers WHAT it showed', s.open && s.keys.join() === 'dc-dock:events|Oct 12 – Dec 1 | Applications open', JSON.stringify(s));

  await load(body);
  await fill('Oct 12 – Dec 1', 'Applications open');
  await settle(p);
  s = await state(p, 'a');
  check('next page of the visit, same event: it does not open again', !s.hidden && !s.open && s.keys.length === 1, JSON.stringify(s));

  await load(body);
  await fill('Feb 1 – Mar 15', 'Applications open');
  await settle(p);
  s = await state(p, 'a');
  check('the calendar has moved on to another event: it opens once more', s.open && s.keys.length === 2, JSON.stringify(s));

  // A visitor closes it and the content ticks on (same text re-written): it stays closed.
  await p.evaluate(() => document.getElementById('a').shadowRoot.querySelector('.b').click());
  await fill('Feb 1 – Mar 15', 'Applications open');
  await settle(p);
  s = await state(p, 'a');
  check('closed by the visitor, re-written content does not reopen it', !s.open, JSON.stringify(s));

  // Without data-auto-open-by: decided at mount, keyed by the item alone — as before.
  await p.evaluate(() => sessionStorage.clear());
  await load(`<div id="a" data-dynamic-coral="dock" data-dock="left" data-label="Events" data-open-on-hash="events" data-auto-open="1" hidden>${ICON}<div><p>content</p></div></div>`);
  await settle(p);
  s = await state(p, 'a');
  check('without data-auto-open-by the key is the item’s own', s.open && s.keys.join() === 'dc-dock:events', JSON.stringify(s));
  await close();
}

await browser.close();
console.log(results.join('\n'));
if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n` + failures.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}
console.log(`\ndock-content: ${results.length} passed`);
