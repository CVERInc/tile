// modaltile smoke — the surface really is host-agnostic, proven by opening it against NO backend.
//
//   (cd <this repo> && python3 -m http.server 8731 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node hosts/web/modaltile/smoke.mjs http://localhost:8731/hosts/web/modaltile/
//
// 🩸 The instruction here used to be "run it from a dir that has playwright", with a `cd` into one.
// That cannot work and never did: Node resolves a bare ESM specifier from the IMPORTING FILE's
// location, not from the working directory — so `import 'playwright'` looks next to this file, in a
// repo that deliberately has no browser dependency, whatever you cd into first. The command was
// written down, committed, and had never been run.
//
// So the specifier is an input. This repo ships no playwright and should not: a browser is 300 MB
// and nothing else here needs one. Point PLAYWRIGHT at whichever install you already have — the
// version matters, because each playwright pins a browser build and only installs its own.
// `?? .default` because playwright is CommonJS: importing the package by NAME gets you named
// exports, importing its index.js by PATH gets you `{ default: … }`. Both are valid inputs here.
const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const url = process.argv[2];
const b = await chromium.launch();
const p = await b.newContext().then((c) => c.newPage());
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch((e) => errs.push('goto:' + e.message));

await p.click('#open');
await p.waitForTimeout(900);

const modal   = await p.evaluate(() => !!document.querySelector('.ej-modal-full'));
const editor  = await p.evaluate(() => !!document.querySelector('.ej-mount [contenteditable="true"]'));
const title   = await p.evaluate(() => document.querySelector('.ej-title')?.value || '');
const buttons = await p.evaluate(() => [...document.querySelectorAll('.ej-act')].map((b) => b.dataset.a).join(','));
const fetched = await p.evaluate(() => document.getElementById('log').textContent.includes('GET  /api/post/'));

// The viewcycle is modaltile's own behaviour, not the shared engine's — cycle it and watch the
// gate classes actually move, so "it rendered" is not mistaken for "it works".
const before = await p.evaluate(() => document.querySelector('.ej-mount').className);
await p.click('[data-a=mode]'); await p.waitForTimeout(150);
const after = await p.evaluate(() => document.querySelector('.ej-mount').className);

// And a save has to reach the host contract, since that is the whole reason this surface moves.
await p.click('.ej-mount [contenteditable="true"]');
await p.keyboard.type('搬家測試');
await p.click('[data-a=save]'); await p.waitForTimeout(400);
const saved = await p.evaluate(() => document.getElementById('log').textContent.includes('POST /api/save'));

console.log('modal opens:      ', modal);
console.log('editor mounted:   ', editor);
console.log('title from host:  ', JSON.stringify(title));
console.log('action cluster:   ', buttons);
console.log('GET /api/post hit:', fetched);
console.log('viewcycle moves:  ', before !== after, `(${before} → ${after})`);
console.log('POST /api/save hit:', saved);
console.log('JS errors:', errs.length); errs.slice(0, 6).forEach((e) => console.log('  ✗', e.slice(0, 160)));
const pass = modal && editor && fetched && saved && before !== after && errs.length === 0;
console.log(pass ? '\n✅ SMOKE PASS — modaltile runs standalone, no backend, no ejecta' : '\n❌ SMOKE FAIL');
await b.close();
process.exit(pass ? 0 : 1);
