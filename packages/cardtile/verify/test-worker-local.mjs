import { OUT, readCard, PLAYWRIGHT } from './paths.mjs';
// Local proof of the multi-tenant card Worker: mount its fetch() behind a node http server with a
// FAKE CARDS store (one row), then drive it with playwright exactly as the edge would be.
import http from 'node:http';
import fs from 'node:fs';
import worker, { resolveHandle } from '../serve/card-worker.mjs';

// 🩸 Read specimen-plain — which states no avatar — and served it under a customer's handle. Both
// were fine until 2026-08-12: the handle's card left the package, and a profile with no `avatar=`
// correctly stopped emitting the element this file clicks. It waited 30 seconds for `.cp-icon` and
// said nothing about why.
const HANDLE = 'specimen-rich';
const cardMd = readCard(HANDLE);
if (!/%% card: profile[^%]*\bavatar=/.test(cardMd)) {
  throw new Error(`${HANDLE} states no avatar, and every gesture below starts from one`);
}
const pw = (await import(PLAYWRIGHT)).default;
const { chromium } = pw;

// unit: handle resolution
// 🔴 The vanity map is INJECTED now — the bindings moved into the store on 2026-08-12, so
// resolveHandle takes them as a third argument instead of consulting a literal. That is why this
// supplies its own: a probe that relied on the built-in map was asserting who our customers are.
const VANITY_HOST = 'card.example.com';
const u1 = resolveHandle('card.feelreef.com', '/' + HANDLE);
const u2 = resolveHandle(VANITY_HOST, '/', { [VANITY_HOST]: HANDLE });
const u3 = resolveHandle('card.feelreef.com', '/');
console.log('RESOLVE canonical /' + HANDLE + ':', JSON.stringify(u1));
console.log('RESOLVE vanity host       :', JSON.stringify(u2));
console.log('RESOLVE bare canonical     :', JSON.stringify(u3), '(null = directory)');

// fake store — this is the ONLY per-card state; adding a card = one more entry, no repo/deploy
const env = { CARDS: { get: async (h) => (h === HANDLE ? cardMd : null) } };

const server = http.createServer(async (req, res) => {
  const reqUrl = 'http://' + (req.headers.host || 'localhost') + req.url;
  const request = new Request(reqUrl, { method: req.method, headers: req.headers });
  const r = await worker.fetch(request, env);
  const body = Buffer.from(await r.arrayBuffer());
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(body);
});
await new Promise((ok) => server.listen(0, ok));
const port = server.address().port;
const base = 'http://localhost:' + port;

// sanity: the coral is served with a JS content-type at the VERSIONED path the page asks for.
// Read the path out of the page rather than hard-coding it — a coral bump must not read as a break.
const pagePeek = await (await fetch(base + '/' + HANDLE)).text();
const coralPath = /src="(\/_coral\/qr-[^"]+\.js)"/.exec(pagePeek)?.[1];
// 🔴 Say it here. When the page fetch above lands on the 404 (a handle the fake store does not
// serve), this regex returns undefined and the next line builds `http://localhost:PORTundefined` —
// an ERR_INVALID_URL two steps downstream of the cause, naming neither the handle nor the page.
if (!coralPath) {
  throw new Error(`no \`src="/_coral/qr-*.js"\` in the page at /${HANDLE} — the store returned ${pagePeek.length} bytes, which is the 404 page when the handle is not the one it holds`);
}
const qrRes = await fetch(base + coralPath);
const pageRes = await fetch(base + '/' + HANDLE);
const pageHtml = await pageRes.text();
console.log('QR asset:', qrRes.status, qrRes.headers.get('content-type'), '| bytes', (await qrRes.text()).length);
console.log('PAGE /' + HANDLE + ':', pageRes.status, '| coral path:', coralPath, '| inline qr?', pageHtml.includes('getModuleCount'));

// e2e: real browser hits the worker, clicks avatar, QR 表演 must run from the EXTERNAL script
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
const errs = [];
pg.on('pageerror', (e) => errs.push('' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await pg.goto(base + '/' + HANDLE, { waitUntil: 'networkidle' });
await pg.screenshot({ path: OUT + '/worker-shot-1-card.png' });
await pg.click('.cp-icon');
await pg.waitForTimeout(1600);
await pg.screenshot({ path: OUT + '/worker-shot-2-qr.png' });

const post = await pg.evaluate(() => {
  const g = document.querySelector('.qr-grid');
  const dark = g ? Array.from(g.children).filter((c) => getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)').length : 0;
  // was the coral loaded as an EXTERNAL file (not inline)?
  const ext = !!Array.from(document.scripts).find((s) => /\/_coral\/qr-[^/]+\.js$/.test(s.src));
  // did the link icons render (the fidelity bug we fixed)?
  const iconSvgs = document.querySelectorAll('.st-cell-tile .st-cell-head svg').length;
  return {
    grpExists: !!document.getElementById('qr-group'),
    gridCells: g ? g.children.length : 0,
    gridDark: dark,
    coralExternal: ext,
    linkIconsRendered: iconSvgs,
    title: document.getElementById('qr-modal-title')?.textContent,
  };
});
console.log('E2E:', JSON.stringify(post));
console.log('ERRORS:', errs.length ? errs.join(' | ') : '(none)');
await b.close();
server.close();
