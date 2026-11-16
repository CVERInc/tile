// The paid completion page settling the basket, in a real browser (tile#84).
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/square-shop/settle.smoke.mjs \
//       http://127.0.0.1:8749/packages/dynamic-corals/square-shop/
//
// Three arms, each in a fresh browser context with a shop tab and a completion tab:
//
//   one tab      control: the two sold zines come off, the prints stay.
//   reload       the visitor shops on after the order, then reloads the receipt. The first render
//                consumed the sold record; before tile#84 the reload took the "no record" path and
//                removed the whole basket. Now the order's tombstone makes the reload touch nothing.
//   closed       the completion tab is closed the moment it has read the basket. The paid lines
//                must already be off: the settle runs in the task that receives the `paid` answer,
//                so no later timer or other tab is needed to finish it.
//
// An earlier version of this smoke also had a second tab write the basket during a 50 ms wait the
// settle used to take. That wait is gone (the settle is synchronous again), so there is no window
// inside the settle for another tab's write to land in; a shop tab that writes a stale basket back
// after the settle is tile#328, not this smoke.
//
// Every request is answered by page.route; nothing leaves the machine.
import { completionBody, COMPLETE_COPY } from './shop-function-template.js';

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const base = process.argv[2];
if (!base) throw new Error('usage: node settle.smoke.mjs <url of packages/dynamic-corals/square-shop/>');

const STORE = 'g_smoke';
const CART_KEY = `dc-square-shop-cart:${STORE}`;
const ZINE = 'VZINE', PA = 'VPRINTA', PB = 'VPRINTB';
const completeUrl = new URL('__settle-complete.html', base).href;
const shopUrl = new URL('__settle-shop.html', base).href;

const completePage = (ref) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title></head><body><main>${
	completionBody(COMPLETE_COPY['en-US'], 'en-US', '/__settle-api/out?ref=' + ref, '/shop', STORE, true, ref)
}</main></body></html>`;

// Runs in the completion tab before its own script: counts the basket reads, and tells the test
// (over a BroadcastChannel the shop tab listens on) when the first one happened.
const completionProbe = ({ cartKey }) => {
	window.__cartReads = 0;
	const ch = new BroadcastChannel('settle-smoke');
	const get = Storage.prototype.getItem;
	Storage.prototype.getItem = function (k) {
		const v = get.call(this, k);
		if (k === cartKey && ++window.__cartReads === 1) ch.postMessage('first-read');
		return v;
	};
};

const b = await chromium.launch();
const failures = [];

async function arm({ label, reload, closeAtFirstRead, expectCart, expectReads }) {
	const ctx = await b.newContext();
	const ref = 'r-' + label.replace(/\W+/g, '-');
	await ctx.route(completeUrl, (r) => r.fulfill({ contentType: 'text/html', body: completePage(ref) }));
	await ctx.route(shopUrl, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>shop</title>' }));
	await ctx.route('**/__settle-api/out**', (r) => r.fulfill({ contentType: 'application/json',
		body: JSON.stringify({ ok: true, state: 'paid', lines: [], total_minor: 0, currency: 'USD' }) }));

	// The shop tab: seeds the basket and the record the coral writes as the checkout leaves.
	const shop = await ctx.newPage();
	await shop.goto(shopUrl, { waitUntil: 'load', timeout: 20000 });
	await shop.evaluate(({ cartKey, ref, ZINE, PA }) => {
		localStorage.clear();
		localStorage.setItem(cartKey, JSON.stringify([[ZINE, 2], [PA, 3]]));
		localStorage.setItem('dc-square-shop-sold:' + ref, JSON.stringify({ t: Date.now(), ids: [ZINE], lines: [[ZINE, 2]] }));
		window.__firstRead = false;
		new BroadcastChannel('settle-smoke').onmessage = () => { window.__firstRead = true; };
	}, { cartKey: CART_KEY, ref, ZINE, PA });

	const page = await ctx.newPage();
	const errs = [];
	page.on('pageerror', (e) => errs.push(String(e)));
	await page.addInitScript(completionProbe, { cartKey: CART_KEY });
	await page.goto(completeUrl, { waitUntil: 'load', timeout: 20000 });
	const problems = [];
	let reads = null;
	if (closeAtFirstRead) {
		// Close the completion tab as soon as the shop tab hears it read the basket. Nothing the
		// completion tab would have done later can happen after this.
		await shop.waitForFunction(() => window.__firstRead, null, { timeout: 10000 });
		await page.close();
	} else {
		await page.waitForFunction((ref) => localStorage.getItem('dc-square-shop-sold:' + ref) === null, ref, { timeout: 10000 });
		if (reload) {
			await shop.evaluate(({ cartKey, PA, PB, ZINE }) => localStorage.setItem(cartKey, JSON.stringify([[PA, 3], [PB, 1], [ZINE, 1]])),
				{ cartKey: CART_KEY, PA, PB, ZINE });
			await page.reload({ waitUntil: 'load', timeout: 20000 });
			await page.waitForFunction(() => /\S/.test(document.getElementById('dc-shop-heading').textContent), null, { timeout: 10000 });
		}
		reads = await page.evaluate(() => window.__cartReads);
	}
	// Read from the shop tab: it is the one still open in every arm.
	const cart = JSON.parse(await shop.evaluate((k) => localStorage.getItem(k), CART_KEY) || 'null');
	const tomb = await shop.evaluate((k) => localStorage.getItem(k), `dc-square-shop-settled:${STORE}:${ref}`);

	if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
	if (JSON.stringify(cart) !== JSON.stringify(expectCart)) problems.push(`basket ${JSON.stringify(cart)}, expected ${JSON.stringify(expectCart)}`);
	if (tomb === null) problems.push('no tombstone for the settled order');
	if (reads !== null && reads !== expectReads) problems.push(`the page read the basket ${reads} time(s), expected ${expectReads}`);
	console.log(`  ${problems.length ? '✗' : '✓'} ${label}  basket=${JSON.stringify(cart)}${reads !== null ? ` reads=${reads}` : ''}`);
	for (const x of problems) failures.push(`${label}: ${x}`);
	await ctx.close();
}

// The settle reads the basket once (0.11.19 read it twice in one task, to no effect).
await arm({ label: 'one tab', expectCart: [[PA, 3]], expectReads: 1 });
// What the visitor put in the basket after the order stays, including a new zine. The reloaded
// page counts its own reads from zero; it reads the tombstone and stops, so `reads` is checked as 0.
await arm({ label: 'reload after the visitor shopped on', reload: true, expectCart: [[PA, 3], [PB, 1], [ZINE, 1]], expectReads: 0 });
await arm({ label: 'the completion tab is closed at its first basket read; the paid lines are already off', closeAtFirstRead: true, expectCart: [[PA, 3]] });
await b.close();

if (failures.length) {
	console.error('✗ settle smoke:\n' + failures.map((f) => '    ' + f).join('\n'));
	process.exit(1);
}
console.log('✓ settle smoke: the basket settles once, in the task that receives the paid answer, and a reload touches nothing');
