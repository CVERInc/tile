// first-link — the owner's two-minute rule, scripted: on a phone viewport, from a cold sandbox, add a link
// with an address and see it on the card. Prints each step with its time and the card's cells at the end;
// exits non-zero if the link never appears. A script cannot measure a human's two minutes, but it pins the
// tap count (5) and the mechanics, so a regression in either shows up before a person has to find it.
//   PW=<playwright install> node verify/first-link.mjs [url]
const PW = process.env.PW || 'playwright';
const { chromium } = await import(PW.endsWith('.mjs') || PW.endsWith('.js') ? PW : `${PW}/index.mjs`).catch(() => import('playwright'));
const URL_ = process.argv[2] || 'https://card.feelreef.com/try/edit';
const b = await chromium.launch(); const p = await b.newPage({ viewport:{width:390,height:844}, hasTouch:true, isMobile:true });
const t0 = Date.now(); const steps = [];
const step = (n) => steps.push(`${n} @${Date.now()-t0}ms`);
await p.goto(URL_, { waitUntil:'networkidle' }); step('page ready');
const canvas = p.frameLocator('#canvas');
await canvas.locator('.ct2-add').first().tap(); step('tap ＋');
await p.locator('.ctw-modal:visible button', { hasText: /^Link$/ }).first().tap(); step('tap Link');
const sheet = p.locator('.ctw-modal:visible').first();
const inputs = await sheet.locator('input').evaluateAll(es => es.map(e => ({ type: e.type, name: e.name || e.dataset.field || '', ph: e.placeholder, val: e.value })));
await sheet.locator('input').nth(0).fill('My shop'); step('type label');
await sheet.locator('input').nth(1).fill('https://example.com/shop'); step('type address');
await sheet.locator('button', { hasText: /^Done$/ }).tap(); step('tap Done');
await p.waitForTimeout(800);
const onCard = await canvas.locator('[data-cell]').evaluateAll(es => es.map(e => e.textContent.trim().slice(0,30)));
step('card shows: ' + JSON.stringify(onCard));
const wordsOnScreen = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' ').slice(0,300));
console.log(JSON.stringify({ steps, wordsOnScreen }, null, 1)); await b.close();
if (!onCard.some(t => t.includes('My shop'))) { console.error('the link never appeared on the card'); process.exit(1); }
