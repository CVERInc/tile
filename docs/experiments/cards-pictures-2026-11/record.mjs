// tile#339 measurement — record what a visitor SEES: one cold, throttled visit per strategy, frames from
// Chromium's own screencast, composed side by side into a filmstrip (JPEG) and a video (WebM).
//
//   node record.mjs --pw <playwright index.js> --fixtures <dir> --cert <pem> --key <pem> --out <dir>
//                   [--page specimen-heavy] [--strategies inline,url,hybrid-…] [--video inline,url,hybrid-…]
//
// Same conditions as measure.mjs (CPU ×4, 9/1.5 Mbit/s, +150 ms, 390×844 @3x, empty cache), no scrolling.
// The screencast itself costs the throttled renderer something, so these recordings show the ORDER and
// SHAPE of what appears; the times to quote are measure.mjs's. No image tool is needed: the composing is
// done in Chromium (a page of <img>s, screenshotted; a canvas fed to MediaRecorder).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { startServers, spkiOf } from './serve.mjs';
import { NETWORK, CPU_RATE, DEVICE } from './conditions.mjs';

const { values: a } = parseArgs({ options: {
  pw: { type: 'string' }, fixtures: { type: 'string' }, cert: { type: 'string' }, key: { type: 'string' }, out: { type: 'string' },
  page: { type: 'string', default: 'specimen-heavy' },
  strategies: { type: 'string', default: 'inline,url,hybrid-inline-lazy,hybrid-inline-after-paint,hybrid-preload-lazy,hybrid-preload-after-paint' },
  video: { type: 'string', default: 'inline,url,hybrid-preload-lazy' },
  'port-base': { type: 'string', default: '9700' }, 'max-s': { type: 'string', default: '30' },
} });
const STRATS = a.strategies.split(',');
const { chromium } = createRequire(import.meta.url)(a.pw);
const cert = fs.readFileSync(a.cert);
const { servers, close } = await startServers({ fixtures: a.fixtures, cert, key: fs.readFileSync(a.key), portBase: Number(a['port-base']), strategies: STRATS });
const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${spkiOf(cert)}`] });
fs.mkdirSync(a.out, { recursive: true });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// warm the server memo, unmeasured
for (const s of servers) { const c = await browser.newContext(DEVICE); const p = await c.newPage(); await p.goto(`${s.origin}/${a.page}`, { waitUntil: 'load', timeout: 120000 }); await p.waitForTimeout(1000); await c.close(); }

const tracks = {};
for (const s of servers) {
  const context = await browser.newContext(DEVICE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => { frames.push({ ts: f.metadata.timestamp * 1000, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
  const before = Date.now();
  await page.goto(`${s.origin}/${a.page}`, { waitUntil: 'commit', timeout: 120000 });
  // record until every picture on the first screen is in and two quiet seconds have passed, or max-s
  const end = before + Number(a['max-s']) * 1000;
  let doneAt = null;
  while (Date.now() < end) {
    const ok = await page.evaluate(() => {
      if (document.readyState === 'loading') return false;
      const on = [...document.querySelectorAll('img[elementtiming]')].filter((i) => { const r = i.getBoundingClientRect(); return r.width > 1 && r.bottom > 0 && r.top < innerHeight; });
      return on.length > 0 && on.every((i) => i.complete && i.naturalWidth);
    }).catch(() => false);
    if (ok && !doneAt) doneAt = Date.now();
    if (doneAt && Date.now() - doneAt > 2000) break;
    await sleep(200);
  }
  const origin = await page.evaluate(() => performance.timeOrigin);
  await cdp.send('Page.stopScreencast').catch(() => {});
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
  tracks[s.strategy] = frames.map((f) => ({ t: Math.max(0, Math.round(f.ts - origin)), data: f.data }));
  console.log(`${s.strategy}: ${frames.length} frames, last at ${tracks[s.strategy].at(-1)?.t} ms`);
  await context.close();
}

// ── compose ───────────────────────────────────────────────────────────────────────────────────────
const at = (track, t) => { let f = null; for (const x of track) { if (x.t <= t) f = x; else break; } return f; };
const end = Math.max(...Object.values(tracks).map((tr) => tr.at(-1)?.t || 0));
const marks = [500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000, 25000].filter((t) => t <= end + 500);
const W = 130, H = Math.round(844 * W / 390);
const strip = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#fff;font:12px sans-serif}table{border-collapse:collapse}td{padding:3px;text-align:center;vertical-align:top}th{font-weight:600;padding:3px 6px;text-align:right;white-space:nowrap}img,.e{width:${W}px;height:${H}px;display:block;background:#ddd;border:1px solid #999}</style>
<table><tr><th></th>${marks.map((t) => `<td>${(t / 1000).toFixed(1)} s</td>`).join('')}</tr>
${STRATS.map((s) => `<tr><th>${s}</th>${marks.map((t) => { const f = at(tracks[s], t); return `<td>${f ? `<img src="data:image/jpeg;base64,${f.data}">` : '<div class=e></div>'}</td>`; }).join('')}</tr>`).join('\n')}</table>`;
const cpage = await browser.newPage({ viewport: { width: 200 + marks.length * (W + 8), height: 60 + STRATS.length * (H + 10) } });
await cpage.setContent(strip);
await cpage.screenshot({ path: join(a.out, `filmstrip-${a.page}.jpg`), type: 'jpeg', quality: 72, fullPage: true });

// the video: the chosen strategies side by side, real time, 10 frames a second
const VID = a.video.split(',').filter((s) => tracks[s]);
const vtracks = Object.fromEntries(VID.map((s) => [s, tracks[s].map((f) => ({ t: f.t, src: `data:image/jpeg;base64,${f.data}` }))]));
await cpage.setViewportSize({ width: 400, height: 300 });
await cpage.setContent('<!doctype html><body></body>');
const webmB64 = await cpage.evaluate(async ({ vtracks, VID, end }) => {
  const PW = 390, PH = 844, TOP = 40;
  const cv = Object.assign(document.createElement('canvas'), { width: PW * VID.length + 10 * (VID.length - 1), height: PH + TOP });
  document.body.append(cv);
  const g = cv.getContext('2d');
  const imgs = {};
  for (const s of VID) imgs[s] = await Promise.all(vtracks[s].map((f) => new Promise((ok) => { const i = new Image(); i.onload = () => ok({ t: f.t, i }); i.src = f.src; })));
  const rec = new MediaRecorder(cv.captureStream(10), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start(500);
  const t0 = performance.now();
  await new Promise((done) => {
    const draw = () => {
      const t = performance.now() - t0;
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      VID.forEach((s, k) => {
        const x = k * (PW + 10);
        let f = null; for (const fr of imgs[s]) { if (fr.t <= t) f = fr; else break; }
        g.fillStyle = '#ddd'; g.fillRect(x, TOP, PW, PH);
        if (f) g.drawImage(f.i, x, TOP, PW, PH);
        g.fillStyle = '#000'; g.font = '600 18px sans-serif'; g.fillText(s, x + 6, 26);
      });
      g.fillStyle = '#c00'; g.font = '700 18px sans-serif'; g.fillText(`${(t / 1000).toFixed(1)} s`, cv.width - 80, 26);
      if (t > end + 1500) done(); else setTimeout(draw, 50);
    };
    draw();
  });
  rec.stop();
  await new Promise((ok) => { rec.onstop = ok; });
  const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}, { vtracks, VID, end });
fs.writeFileSync(join(a.out, `side-by-side-${a.page}.webm`), Buffer.from(webmB64, 'base64'));
fs.writeFileSync(join(a.out, `frames-${a.page}.json`), JSON.stringify(Object.fromEntries(Object.entries(tracks).map(([s, tr]) => [s, tr.map((f) => f.t)]))));
console.log(`wrote filmstrip-${a.page}.jpg (${marks.length} marks) and side-by-side-${a.page}.webm (${VID.join(', ')})`);
await browser.close();
await close();
