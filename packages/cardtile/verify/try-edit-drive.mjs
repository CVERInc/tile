// try-edit-drive — drive the /try/edit sandbox in a real Chromium: add a link from the card, close its sheet,
// drag it with the mouse, and print the order before/after plus the saved draft. The ruler behind tile #50.
//   PW=<path to a playwright install> node verify/try-edit-drive.mjs https://card.feelreef.com/try/edit
// 🔴 frameLocator boundingBox() is already in PAGE coordinates — do not add the iframe's own offset
// (the first version did, the mouse never touched the card, and 'drag is broken' was the probe's fault).
const PW = process.env.PW || 'playwright';
const { chromium } = await import(PW.endsWith('.mjs') || PW.endsWith('.js') ? PW : `${PW}/index.mjs`).catch(() => import('playwright'));
const URL_ = process.argv[2] || 'https://card.feelreef.com/try/edit';
const b = await chromium.launch(); const p = await b.newPage({ viewport:{width:1400,height:900} });
const logs=[]; p.on('console',m=>logs.push(m.type()+': '+m.text().slice(0,140)));
await p.goto(URL_,{waitUntil:'networkidle'}); await p.waitForTimeout(800);
const canvas = p.frameLocator('#canvas'); const cells = () => canvas.locator('[data-cell]');
const order = async () => cells().evaluateAll(es => es.map(e => e.dataset.cell + ':' + e.textContent.trim().slice(0,10)));
await canvas.locator('button', { hasText: /Add a tile/ }).first().click();
await p.locator('.ctw-modal:visible button', { hasText: /^Link$/ }).first().click(); await p.waitForTimeout(400);
const sheet = p.locator('.ctw-modal:visible').first();
const btns = await sheet.locator('button').evaluateAll(bs => bs.map(b => b.textContent.trim() + (b.disabled ? '(disabled)' : '')));
await sheet.locator('button', { hasText: '✕' }).first().click(); await p.waitForTimeout(600);
const out = { sheetButtons: btns, modalsOpen: await p.locator('.ctw-modal:visible').count(), afterAdd: await order() };
const f = p.frames().find(fr => fr.url().startsWith('about:srcdoc'));
out.opts = await f.evaluate(() => { const el = document.querySelector('.st-cells'); const s = window.Sortable && Sortable.get(el); return s ? { draggable: s.option('draggable'), forceFallback: s.option('forceFallback'), delay: s.option('delay'), delayOnTouchOnly: s.option('delayOnTouchOnly'), group: JSON.stringify(s.option('group')), filter: String(s.option('filter')).slice(0,40), n: el.children.length } : 'no instance'; });
const box = async (i) => { const bb = await cells().nth(i).boundingBox(); return { x: bb.x + bb.width/2, y: bb.y + bb.height/2, top: bb.y, h: bb.height }; };
const a = await box(1), c = await box(2);
await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.waitForTimeout(250);
for (let i=1;i<=25;i++){ await p.mouse.move(a.x + (c.x-a.x)*i/25, a.y + (c.top + c.h + 4 - a.y)*i/25); await p.waitForTimeout(30); }
await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(1000);
out.afterMouseDrag = await order();
out.draft = (await p.evaluate(() => { try { return localStorage.getItem('cardtile:try:draft:v1') } catch(e){ return 'err' } })).slice(0,400);
out.logs = logs; console.log(JSON.stringify(out, null, 1)); await b.close();
