// tile#339 measurement — load each specimen under each picture strategy in throttled Chromium, cold and
// again two minutes later, and write every run's numbers to a JSON file (summarize.mjs makes the tables).
//
//   node measure.mjs --pw <playwright index.js> --fixtures <dir> --cert <pem> --key <pem> --out <json>
//                    [--reps 5] [--repeat-after 120] [--strategies a,b] [--pages h1,h2] [--port-base 9400]
//
// CONDITIONS (the same for every run):
//   Chromium (Playwright's build), 390×844 CSS px, deviceScaleFactor 3, touch, mobile;
//   CPU throttled ×4 (CDP Emulation.setCPUThrottlingRate rate 4);
//   network: 9 Mbit/s down (1,125,000 B/s), 1.5 Mbit/s up (187,500 B/s), 150 ms latency added per request
//   (CDP Network.emulateNetworkConditions — DevTools throttling: per-request latency, shared throughput;
//   connection setup is NOT delayed, which is the same constant for every strategy: one origin, one h2
//   connection);
//   one fresh browser context per cold visit (empty cache); the repeat visit is a NEW page in that same
//   context, opened `repeat-after` seconds after the cold page closed (page HTML: max-age=60, so stale).
//
// VISITOR MODEL: nobody touches the page until the first screen is complete; then the visitor scrolls one
// viewport every 0.7 s (SCROLL_MS) until the page ends (in the stack and list views one scroll is one card: the deck
// snaps), and the run ends when every picture is in (or at the cap).
//
// NUMBERS per run (ms from navigation start):
//   firstPaint / fcp           paint timing
//   firstScreen                the latest of fcp and the paint of every picture on screen before any
//                              scroll (Element Timing; `elementtiming` is added by serve.mjs)
//   allPictures                the last picture's load event (inline ones included)
//   lcp                        the last largest-contentful-paint candidate before the first scroll
//   clsBeforeScroll / cls      layout shift (session windows, the CLS definition) before scroll / whole run
//   blankSeen / blankMs        pictures that were on screen before they had loaded, and for how long in total
//   requests / bytes           network requests (not data:, not from cache) and their encoded bytes
//   fromCache                  requests answered by the HTTP cache
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { startServers, spkiOf } from './serve.mjs';
import { NETWORK, CPU_RATE, DEVICE } from './conditions.mjs';
import { PICTURE_STRATEGIES } from '../../../packages/cardtile/serve/asset-urls.mjs';

const { values: a } = parseArgs({ options: {
  pw: { type: 'string' }, fixtures: { type: 'string' }, cert: { type: 'string' }, key: { type: 'string' },
  out: { type: 'string' }, reps: { type: 'string', default: '5' }, 'repeat-after': { type: 'string', default: '120' },
  strategies: { type: 'string' }, pages: { type: 'string' }, 'port-base': { type: 'string', default: '9400' },
  'cap-s': { type: 'string', default: '150' },
} });
const STRATEGIES = a.strategies ? a.strategies.split(',') : [...PICTURE_STRATEGIES];
const PAGES = a.pages ? a.pages.split(',') : ['specimen-heavy', 'specimen-heavy-wall', 'specimen-medium', 'specimen-medium-wall'];
const REPS = Number(a.reps);
const REPEAT_AFTER_MS = Number(a['repeat-after']) * 1000;
const CAP_MS = Number(a['cap-s']) * 1000;
export const SCROLL_MS = 700;

const { chromium } = createRequire(import.meta.url)(a.pw);
const cert = fs.readFileSync(a.cert);
const key = fs.readFileSync(a.key);
const { servers, close } = await startServers({ fixtures: a.fixtures, cert, key, portBase: Number(a['port-base']), strategies: STRATEGIES });
const originOf = Object.fromEntries(servers.map((s) => [s.strategy, s.origin]));
const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${spkiOf(cert)}`] });

// Runs in the page before anything else. Cheap observers only; nothing polls.
const INIT = () => {
  const m = window.__m = { paints: {}, lcp: [], shifts: [], pics: [], scrollAt: null };
  const rec = (img) => {
    if (img.__r) return img.__r;
    const r = img.__r = { el: img, inline: /^data:/.test(img.getAttribute('src') || ''), seen: null, seenBlank: false, load: null, paint: null };
    m.pics.push(r);
    if (img.complete && img.naturalWidth) r.load = performance.now();
    io.observe(img);
    return r;
  };
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting || !e.intersectionRect.width || !e.intersectionRect.height) continue;
      const r = rec(e.target);
      if (r.seen == null) { r.seen = e.time; r.seenBlank = !(e.target.complete && e.target.naturalWidth); }
    }
  });
  // on document, not window: a `load` event's path stops at the Document (HTML, "get the parent")
  document.addEventListener('load', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.hasAttribute('elementtiming')) { const r = rec(t); if (r.load == null) r.load = performance.now(); } }, true);
  new MutationObserver((ms) => { for (const mu of ms) for (const n of mu.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches('img[elementtiming]')) rec(n);
    for (const i of n.querySelectorAll ? n.querySelectorAll('img[elementtiming]') : []) rec(i);
  } }).observe(document, { childList: true, subtree: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) m.paints[e.name] = e.startTime; }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) m.lcp.push(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) m.shifts.push([e.startTime, e.value]); }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.element) { const r = rec(e.element); if (r.paint == null) r.paint = e.renderTime || e.loadTime; } }).observe({ type: 'element', buffered: true });
  addEventListener('DOMContentLoaded', () => { m.dcl = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => { m.ready = performance.now(); })); });
};

// pictures on screen right now (in the page)
const ONSCREEN = () => [...document.querySelectorAll('img[elementtiming]')].filter((i) => {
  const r = i.getBoundingClientRect();
  return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(i).visibility !== 'hidden';
}).map((i) => ({ ok: !!(i.complete && i.naturalWidth), paint: i.__r ? i.__r.paint : null, load: i.__r ? i.__r.load : null }));

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const cls = (shifts) => {        // the largest session window: gaps < 1 s, windows ≤ 5 s
  let best = 0, cur = 0, start = -Infinity, last = -Infinity;
  for (const [t, v] of shifts.sort((x, y) => x[0] - y[0])) {
    if (t - last > 1000 || t - start > 5000) { cur = 0; start = t; }
    cur += v; last = t; best = Math.max(best, cur);
  }
  return +best.toFixed(4);
};

async function visit(context, strategy, handle, visitKind) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => { if (/^https?:/.test(e.request.url)) reqs.set(e.requestId, { url: e.request.url, cache: false, bytes: 0, done: false }); });
  cdp.on('Network.requestServedFromCache', (e) => { const r = reqs.get(e.requestId); if (r) r.cache = true; });
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r && (e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker)) r.cache = true; if (r) r.status = e.response.status; });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.done = true; } });
  cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.failed = e.errorText; r.done = true; } });
  const load1 = os.loadavg()[0];
  const t0 = Date.now();
  await page.goto(`${originOf[strategy]}/${handle}`, { waitUntil: 'commit', timeout: CAP_MS });
  const deadline = t0 + CAP_MS;
  // 1. the first screen: DOM parsed (+2 frames, so the deck has dealt), every picture on screen painted
  let first = null, okSince = null;
  while (Date.now() < deadline) {
    const s = await page.evaluate((f) => {
      const m = window.__m;
      if (!m || m.ready == null || m.paints['first-contentful-paint'] == null) return null;
      const on = (0, eval)(`(${f})`)();
      // every specimen shows its avatar first in every view, so an empty screen means "not dealt yet"
      if (!on.length || !on.every((p) => p.ok)) return null;
      return on;
    }, ONSCREEN.toString()).catch(() => null);
    // painted, by Element Timing; a picture that is loaded but has reported no paint for 1.5 s counts by its load
    if (s && (s.every((p) => p.paint != null) || (okSince && Date.now() - okSince > 1500))) { first = s; break; }
    okSince = s ? okSince || Date.now() : null;
    await sleep(100);
  }
  // 2. scroll a viewport every SCROLL_MS until the page stops moving, then wait for every picture
  await page.evaluate(() => { window.__m.scrollAt = performance.now(); });
  let lastY = -1, still = 0;
  while (Date.now() < deadline && still < 2) {
    await sleep(SCROLL_MS);
    const y = await page.evaluate(() => { window.scrollBy(0, innerHeight); return Math.round(scrollY); });
    still = y === lastY ? still + 1 : 0;
    lastY = y;
  }
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => window.__m.pics.length > 0 && window.__m.pics.every((p) => p.load != null));
    if (done) break;
    await sleep(250);
  }
  await sleep(300);
  const m = await page.evaluate(() => {
    const m = window.__m;
    const missing = m.pics.filter((p) => p.load == null).map((p) => { const i = p.el; const r = i.getBoundingClientRect(); return { src: (i.getAttribute('src') || '').slice(0, 40), connected: i.isConnected, loading: i.loading, complete: i.complete, nw: i.naturalWidth, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), cls: i.className, parent: i.parentElement && i.parentElement.className }; });
    return { paints: m.paints, lcp: m.lcp, shifts: m.shifts, pics: m.pics.map(({ el, ...p }) => p), scrollAt: m.scrollAt, dcl: m.dcl, ready: m.ready, missing, firstSeen: null };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
  await page.close();
  const net = [...reqs.values()];
  const fcp = m.paints['first-contentful-paint'] ?? null;
  // no Element Timing entry (the deck re-inserts the avatar card): loaded AND dealt (DOMContentLoaded + 2 frames)
  const firstScreen = first ? Math.max(fcp, ...first.map((p) => p.paint ?? Math.max(p.load, m.ready))) : null;
  const loads = m.pics.map((p) => p.load);
  const blank = m.pics.filter((p) => p.seenBlank);
  return {
    strategy, handle, visit: visitKind, load1, wallMs: Date.now() - t0, timedOut: Date.now() >= deadline,
    firstPaint: m.paints['first-paint'] ?? null, fcp, firstScreen, firstScreenPictures: first ? first.length : null,
    lcp: m.lcp.filter((t) => m.scrollAt == null || t <= m.scrollAt).at(-1) ?? null,
    allPictures: loads.length && loads.every((t) => t != null) ? Math.max(...loads) : null,
    pictures: m.pics.length, picturesInline: m.pics.filter((p) => p.inline).length, picturesMissing: loads.filter((t) => t == null).length,
    blankSeen: blank.length, blankMs: Math.round(blank.reduce((s, p) => s + Math.max(0, (p.load ?? p.seen) - p.seen), 0)),
    clsBeforeScroll: cls(m.shifts.filter(([t]) => t < (m.scrollAt ?? Infinity))), cls: cls(m.shifts),
    dcl: m.dcl ?? null, scrollAt: m.scrollAt,
    requests: net.filter((r) => !r.cache).length, bytes: net.filter((r) => !r.cache).reduce((s, r) => s + (r.bytes || 0), 0),
    fromCache: net.filter((r) => r.cache).length,
    htmlBytes: (net.find((r) => new URL(r.url).pathname === `/${handle}`) || {}).bytes ?? null,
    failed: net.filter((r) => r.failed).map((r) => `${r.url} ${r.failed}`),
    missing: m.missing.slice(0, 6), firstScreenSet: first,
  };
}

// ── the schedule: cold visits in rounds (every strategy once per page per round, shuffled), each cold
// visit's repeat run as soon as it is due; one measured page at a time, never two.
const shuffle = (xs, seed) => { let s = seed; const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); return xs.map((x) => [r(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]); };
const cold = [];
for (let rep = 0; rep < REPS; rep++) for (const [pi, handle] of PAGES.entries()) for (const strategy of shuffle(STRATEGIES, 1000 * rep + pi + 7)) cold.push({ rep, handle, strategy });
const pending = [];
const results = [];
const write = () => fs.writeFileSync(a.out, JSON.stringify({ conditions: { NETWORK, CPU_RATE, DEVICE, chromium: browser.version(), node: process.version, repeatAfterS: REPEAT_AFTER_MS / 1000, reps: REPS }, runs: results }, null, 1));

// warm the servers' memo (and check every path answers) with one unthrottled, unmeasured visit each
for (const strategy of STRATEGIES) for (const handle of PAGES) {
  const c = await browser.newContext(DEVICE);
  const p = await c.newPage();
  await p.goto(`${originOf[strategy]}/${handle}`, { waitUntil: 'load', timeout: 120000 });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { scrollBy(0, innerHeight); await new Promise((r) => setTimeout(r, 30)); } });
  await p.waitForTimeout(1500);
  await c.close();
}
console.log(`warm; ${cold.length} cold visits + as many repeats; chromium ${browser.version()}`);

const MAX_OPEN = 12;
while (cold.length || pending.length) {
  pending.sort((x, y) => x.due - y.due);
  let job = null;
  if (pending.length && pending[0].due <= Date.now()) job = pending.shift();
  else if (cold.length && pending.length < MAX_OPEN) job = cold.shift();
  if (!job) { await sleep(Math.max(200, Math.min(5000, pending[0].due - Date.now()))); continue; }
  const kind = job.context ? 'repeat' : 'cold';
  const context = job.context || await browser.newContext(DEVICE);
  if (!job.context) await context.addInitScript(INIT);
  let r;
  try { r = await visit(context, job.strategy, job.handle, kind); } catch (e) { r = { strategy: job.strategy, handle: job.handle, visit: kind, error: String(e && e.message) }; }
  r.rep = job.rep;
  results.push(r);
  write();
  console.log(`${kind.padEnd(6)} r${job.rep} ${job.handle.padEnd(20)} ${job.strategy.padEnd(27)} fcp=${Math.round(r.fcp)} first=${Math.round(r.firstScreen)} all=${Math.round(r.allPictures)} cls=${r.cls} blank=${r.blankSeen} req=${r.requests} bytes=${r.bytes} cache=${r.fromCache} load1=${r.load1}${r.error ? ' ERROR ' + r.error : ''}`);
  if (kind === 'cold') pending.push({ ...job, context, due: Date.now() + REPEAT_AFTER_MS });
  else await context.close();
}
write();
await browser.close();
await close();
