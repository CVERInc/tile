// reef#2160 — the ruler behind the numbers in the PR: time to first result after open, on a
// throttled profile, against the REAL coral and a REAL index (tniop's, 1,410 rows), served gzip
// from a local stub that answers the claim gate. Also proves, in a browser, that the index is not
// fetched before the first open and is fetched exactly once after it.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright \
//     node packages/dynamic-corals/inbox-bubble/search-measure.mjs /path/to/search-index.json
//
// Not in scripts/test.sh (it needs a browser and a real index); run it by hand when the filter,
// the fetch discipline or the index shape changes, and paste the lines into the PR.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT || 'playwright');

const indexPath = process.argv[2];
if (!indexPath) throw new Error('usage: node search-measure.mjs <path to a search-index.json>');
const coral = readFileSync(new URL('./inbox-bubble.js', import.meta.url));
const index = readFileSync(indexPath);
const indexGz = gzipSync(index, { level: 6 });
const page = (port) => `<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>m</title></head><body>
<div data-dynamic-coral="inbox-bubble" data-kind="site" data-id="measure" data-kaito="1" data-api-base="http://127.0.0.1:${port}" data-site-name="Measure" data-search-index="/search-index.json"></div>
<script type="module" src="/inbox-bubble.js"></script></body></html>`;

const hits = [];
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  hits.push(path);
  if (path === '/') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(server.address().port));
  if (path === '/inbox-bubble.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(coral);
  if (path === '/search-index.json') return res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }).end(indexGz);
  if (path === '/api/inbox/session') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, claimed: true }));
  if (path === '/api/inbox/assistant') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ resolved: false }));
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const PROFILES = [
  { name: 'unthrottled', cpu: 1, net: null },
  { name: 'Slow 4G ×4 CPU', cpu: 4, net: { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 } },
  { name: 'Slow 3G ×6 CPU', cpu: 6, net: { offline: false, latency: 400, downloadThroughput: 400e3 / 8, uploadThroughput: 400e3 / 8 } },
];
const browser = await pw.chromium.launch();
const out = [];
for (const prof of PROFILES) {
  const ctx = await browser.newContext();
  const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
  if (prof.net) await cdp.send('Network.emulateNetworkConditions', prof.net);
  hits.length = 0;
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await pg.waitForFunction(() => document.querySelector('.dc-inbox-host')?.shadowRoot?.querySelector('.dc-inbox-open'));
  await pg.waitForTimeout(500);
  const fetchedBeforeOpen = hits.filter((h) => h === '/search-index.json').length;
  const r = await pg.evaluate(async () => {
    const root = document.querySelector('.dc-inbox-host').shadowRoot;
    const t0 = performance.now();
    root.querySelector('.dc-inbox-open').click();
    const until = (f) => new Promise((res) => { const tick = () => (f() ? res(performance.now()) : requestAnimationFrame(tick)); tick(); });
    const tOpen = await until(() => root.querySelector('.dc-inbox-form textarea'));
    const tIndex = await until(() => { const b = root.querySelector('.dc-inbox-search'); return b && !b.hidden; });
    const ta = root.querySelector('.dc-inbox-form textarea');
    ta.value = '電'; // a CJK character common in tniop titles
    const tKey = performance.now();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const tList = await until(() => { const l = root.querySelector('.dc-inbox-results'); return l && !l.hidden && l.children.length; });
    const first = root.querySelector('.dc-inbox-results li a');
    const btn = root.querySelector('.dc-inbox-form button').textContent;
    const note = root.querySelector('.dc-inbox-search-note').textContent;
    return { open: tOpen - t0, index: tIndex - t0, keyToList: tList - tKey, firstResult: tList - t0, rows: root.querySelectorAll('.dc-inbox-results li').length, first: first.textContent, href: first.getAttribute('href'), btn, note };
  });
  const fetched = hits.filter((h) => h === '/search-index.json').length;
  out.push({ profile: prof.name, fetchedBeforeOpen, fetchedAfterOpen: fetched, ...r });
  await ctx.close();
}
await browser.close();
server.close();
console.log(`index bytes: raw ${index.length}, gzip-6 ${indexGz.length}`);
for (const o of out) console.log(JSON.stringify(o));
