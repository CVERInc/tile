// reef#2725 — the `embed` cell, in a real browser: what the author's script can and cannot reach.
//
//   PLAYWRIGHT=/path/to/playwright/index.js node packages/cardtile/verify/embed-sandbox.mjs
//
// embed-html.test.mjs proves the STRUCTURE (one iframe, `sandbox="allow-scripts"` and nothing else, a
// srcdoc that decodes to the author's HTML verbatim). This asks the browser what that structure
// MEANS, because the claim is about behaviour: a script pasted into A's card, run while B reads it,
// must not reach B's storage, B's cookies, the card's DOM, or B's address bar.
//
// The page is served by the real Worker (card-worker.mjs) from a real http origin, with a secret in
// that origin's localStorage and a cookie on it. The embed's script tries each door and posts what
// happened back to the card — postMessage is the one channel a sandboxed frame keeps, and the card
// has no listener that trusts an opaque origin (host-bridge.mjs checks `event.origin === host`).
//
// 🔴 CONTROL: the same probe runs in an iframe WITH `allow-same-origin` added — the one token we
// leave out. If the storage read does not succeed there, this harness cannot see the thing it
// guards and says so instead of passing.
import http from 'node:http';
import { PLAYWRIGHT } from './paths.mjs';
import worker from '../serve/card-worker.mjs';

const pw = (await import(PLAYWRIGHT)).default;
const { chromium } = pw;

const PROBE = `<div id="o">probe</div><script>
(async () => {
  const r = {};
  r.origin = self.origin;
  try { r.storage = 'READ:' + localStorage.getItem('secret'); } catch (e) { r.storage = e.name; }
  try { r.cookie = 'READ:' + document.cookie; } catch (e) { r.cookie = e.name; }
  try { r.parentDoc = 'READ:' + parent.document.title; } catch (e) { r.parentDoc = e.name; }
  try { r.idb = await new Promise((ok, no) => { const q = indexedDB.open('x'); q.onsuccess = () => ok('OPENED'); q.onerror = () => no(q.error); }); } catch (e) { r.idb = (e && e.name) || String(e); }
  r.ink = getComputedStyle(document.documentElement).getPropertyValue('--cp-ink').trim();
  r.bg = getComputedStyle(document.documentElement).backgroundColor;
  parent.postMessage({ probe: r }, '*');
  try { top.location.href = 'https://example.com/hijacked'; r.nav = 'no throw'; } catch (e) { r.nav = e.name; }
  parent.postMessage({ nav: r.nav }, '*');
})();
</script>`;
const BREAKOUT = '"><script>window.__pwned = 1</script><img src=x onerror="window.__pwned=2">';

const body = PROBE.split('\n').map((l) => '\t' + l).join('\n');
const md = ['---', 'title: Probe', 'accent: "#ff6b4a"', 'theme: light', '---', '', '## grid', '',
  `- [ ] %% card: embed w=6 %%\n${body}`,
  `- [ ] %% card: embed w=3 %% ${BREAKOUT}`,
  '- [ ] %% card: embed w=6 kind=slider images="https://i.example/1.png,https://i.example/2.png" %%',
  ''].join('\n');

// r4: the square embed and the cells packed after it — the review's shape (an embed, a tile beside
// it, a tile under it) at w=3 and w=6. The links are written the way a link cell reads them (the body
// `[text](url)`); a `url=` param is not one, and such a cell renders nothing — measuring nothing.
const NEIGHBOURS = {
  'grid-w3': ['- [ ] %% card: embed w=3 %% <b>embed</b>', '- [ ] %% card: link w=3 %% [Right](https://example.com)', '- [ ] %% card: link w=3 %% [Under](https://example.com)'],
  'grid-w6': ['- [ ] %% card: embed w=6 %% <b>embed</b>', '- [ ] %% card: link w=3 %% [Next](https://example.com)', '- [ ] %% card: link w=3 %% [Next2](https://example.com)'],
};
const cards = { probe: md };
for (const [k, lines] of Object.entries(NEIGHBOURS)) cards[k] = ['---', 'title: Grid', '---', '', '## grid', '', ...lines, ''].join('\n');
// the store shape every harness here uses: the card under its bare (legacy) key, nothing else
const env = { CARDS: { get: async (k) => cards[k] ?? null, async getWithMetadata(k) { return { value: await this.get(k), metadata: null }; } } };
const server = http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request('http://localhost' + req.url, { headers: req.headers }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((ok) => server.listen(0, ok));
const base = `http://localhost:${server.address().port}`;

const b = await chromium.launch();
const failures = [];
const check = (ok, what) => { console.log(`${ok ? '  ✓' : '  ✗'} ${what}`); if (!ok) failures.push(what); };
try {
  const pg = await b.newPage({ viewport: { width: 480, height: 1400 } });
  await pg.addInitScript(() => {
    window.__msgs = [];
    addEventListener('message', (e) => window.__msgs.push({ origin: e.origin, data: e.data }));
  });
  // the reader's secrets, on the card's own origin
  await pg.goto(base + '/probe');
  await pg.evaluate(() => { localStorage.setItem('secret', 's3cret'); document.cookie = 'sid=reader-session; path=/'; });
  await pg.reload({ waitUntil: 'load' });
  await pg.waitForFunction(() => window.__msgs.some((m) => m.data && m.data.nav), null, { timeout: 15000 });
  await pg.waitForTimeout(800);   // give a navigation, if one were allowed, time to happen
  const msgs = await pg.evaluate(() => window.__msgs);
  const probe = msgs.find((m) => m.data && m.data.probe);
  const nav = msgs.find((m) => m.data && m.data.nav);
  console.log('embed probe (sandbox="allow-scripts"):', JSON.stringify(probe), JSON.stringify(nav && nav.data));
  const p = probe.data.probe;
  check(probe.origin === 'null' && p.origin === 'null', `the embed's origin is opaque ("null"), not ${base} — got ${p.origin}`);
  check(!/^READ/.test(p.storage), `localStorage of the card's origin is unreachable — ${p.storage}`);
  check(!/^READ/.test(p.cookie), `the card's cookies are unreachable — ${p.cookie}`);
  check(!/^READ/.test(p.parentDoc), `the card's DOM is unreachable — ${p.parentDoc}`);
  check(p.idb !== 'OPENED', `IndexedDB is unavailable — ${p.idb}`);
  check(pg.url() === base + '/probe', `the page was not navigated away — at ${pg.url()}`);
  const ink = await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cp-ink').trim());
  check(p.ink && p.ink === ink, `--cp-ink inside the embed (${p.ink}) is the card's (${ink})`);
  check(/rgba\(0, 0, 0, 0\)|transparent/.test(p.bg), `the embed's document is transparent over its tile — ${p.bg}`);

  // the breakout payload: nothing ran in the card, and the frame holds the payload as text
  const pwned = await pg.evaluate(() => window.__pwned);
  check(pwned === undefined, `the attribute-breakout payload did not run in the card (window.__pwned = ${pwned})`);
  const tail = await pg.evaluate(() => document.querySelectorAll('.st-embed-html iframe')[1].getAttribute('srcdoc').slice(-200));
  check(tail.endsWith('"><script>window.__pwned = 1</script><img src=x onerror="window.__pwned=2">'), 'the browser parsed the srcdoc back to the payload, verbatim');
  check(await pg.evaluate(() => document.querySelectorAll('iframe').length) === 2, 'exactly two iframes on the page — the payload made none of its own');

  // the box: as tall as it is wide, and the carousel is still a carousel
  // the cell's INNER box (inside its 1px border) is what the frame fills
  const boxes = await pg.evaluate(() => [...document.querySelectorAll('.st-embed-html')].map((c) => { const f = c.querySelector('iframe').getBoundingClientRect(); return { w: c.clientWidth, h: c.clientHeight, fw: f.width, fh: f.height }; }));
  console.log('embed boxes:', JSON.stringify(boxes));
  check(boxes.length === 2 && boxes.every((x) => x.w > 50 && Math.abs(x.w - x.h) < 1.5 && Math.abs(x.fw - x.w) < 1.5 && Math.abs(x.fh - x.h) < 1.5), 'each embed fills a square cell of its own width');
  check(boxes.length === 2 && boxes[0].w > boxes[1].w * 1.8, 'w=6 is about twice w=3');
  check(await pg.evaluate(() => document.querySelectorAll('[data-coral-type="slides"] .st-slider figure').length) === 2, 'the old `embed kind=slider` still renders its two-slide carousel');

  // r4: nothing packed after a square embed overlaps it. The bento pack (card-core packGrid) gives every
  // cell ONE row and the CSS rows are content-sized (`grid-auto-rows:minmax(var(--cp-unit),auto)`), so the
  // square's own height is what its row becomes — measured, at a phone width and a desktop one.
  const overlaps = async (page) => page.evaluate(() => {
    const cells = [...document.querySelectorAll('.st-cells > *')];
    const out = [];
    cells.forEach((c, i) => {
      const f = c.querySelector('.st-embed-html iframe') || (c.matches('.st-embed-html') && c.querySelector('iframe'));
      if (!f) return;
      const e = f.getBoundingClientRect();
      for (const n of cells.slice(i + 1)) {
        const r = n.getBoundingClientRect();
        const sharesColumns = r.left < e.right - 1 && r.right > e.left + 1;
        if (sharesColumns && r.top < e.bottom - 0.5) out.push(`${n.textContent.trim() || n.getAttribute('data-coral-type')} top ${r.top.toFixed(1)} < iframe bottom ${e.bottom.toFixed(1)}`);
      }
    });
    return { cells: cells.length, out };
  });
  for (const k of Object.keys(NEIGHBOURS)) for (const width of [390, 900]) {
    const g = await b.newPage({ viewport: { width, height: 1400 } });
    await g.goto(`${base}/${k}`, { waitUntil: 'load' });
    const { cells, out } = await overlaps(g);
    check(cells === 3 && out.length === 0, `${k} @${width}px: the cells after the square embed start below the iframe's bottom (${cells} cells${out.length ? '; ' + out.join('; ') : ''})`);
    if (k === 'grid-w3' && width === 390) {
      // 🔴 CONTROL: pin the rows to one unit — the layout the review reasoned about — and the same
      // measure must report the overlap, or it cannot see the thing it guards
      await g.addStyleTag({ content: 'html body .st-card .st-cells{grid-auto-rows:var(--cp-unit)!important}' });
      const pinned = await overlaps(g);
      check(pinned.out.length > 0, `CONTROL: with rows pinned to one unit the measure DOES report the overlap (${pinned.out.join('; ') || 'nothing'})`);
    }
    await g.close();
  }

  // 🔴 CONTROL: allow-same-origin is the token we leave out. Add it, and the same probe must read.
  const ctl = await b.newPage();
  await ctl.addInitScript(() => { window.__msgs = []; addEventListener('message', (e) => window.__msgs.push({ origin: e.origin, data: e.data })); });
  await ctl.goto(base + '/probe');
  await ctl.evaluate(() => localStorage.setItem('secret', 's3cret'));
  await ctl.evaluate(() => {
    const f = document.querySelector('.st-embed-html iframe');
    const g = f.cloneNode();
    g.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    g.removeAttribute('loading');
    window.__msgs = [];   // only what the REPLACEMENT says — the original frame has already posted
    f.replaceWith(g);
  });
  await ctl.waitForFunction(() => window.__msgs.some((m) => m.data && m.data.probe), null, { timeout: 15000 });
  const c = (await ctl.evaluate(() => window.__msgs)).find((m) => m.data && m.data.probe).data.probe;
  console.log('CONTROL probe (allow-scripts allow-same-origin):', JSON.stringify(c));
  check(c.storage === 'READ:s3cret', `CONTROL: with allow-same-origin the probe DOES read the secret (${c.storage}) — so the ✓ above is the sandbox, not a broken probe`);
} finally {
  await b.close();
  server.close();
}
if (failures.length) { console.log(`\n🔴 ${failures.length} failed`); process.exit(1); }
console.log('\n✅ embed sandbox holds in a real browser');
