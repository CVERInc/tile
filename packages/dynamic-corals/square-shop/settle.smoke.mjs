// The paid completion page settling the basket, in a real browser with a second tab (tile#84).
//
//   (cd <this repo> && python3 -m http.server 8749 &)
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/dynamic-corals/square-shop/settle.smoke.mjs \
//       http://127.0.0.1:8749/packages/dynamic-corals/square-shop/
//
// 🩸 WHY THIS EXISTS. 0.11.19's settle step re-read the basket "immediately before writing" and
// retried up to eight times if it had moved. Every read was synchronous and in one task, and a
// browser applies another tab's localStorage write to this tab only between tasks — so the loop ran
// exactly once in the one environment it was written for. Its unit test proved a retry by changing
// the value INSIDE a `getItem` double, which no browser does. Only a browser with two tabs can say
// whether a write from the other tab is now seen and kept.
//
// THE SECOND TAB IS THE REALISTIC ONE: a shop tab that loaded the basket before the order landed
// and writes its whole in-memory basket back on its next add (that is what square-shop.js's
// `persistCart` does). It writes at the moment the completion page first reads the basket — told
// so over a BroadcastChannel by a getItem wrapper in the completion tab — i.e. a write landing
// between the page's read and its write, the exact window the loop exists for.
//
// 🔴 THE WAIT IS STRETCHED, AND ONLY THE WAIT. The completion tab's 50 ms timers run as 400 ms here,
// so the other tab's write reaches it inside the wait even on a loaded machine. That widens the
// window the new code leaves for the other tab; it cannot help the old code, which had no wait.
// Run with SETTLE_SMOKE_STRETCH=1 to measure the shipped 50 ms as it is.
//
// Every request is answered by page.route; nothing leaves the machine.
import { completionBody, COMPLETE_COPY } from './shop-function-template.js';

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT || 'playwright'}`);
const base = process.argv[2];
if (!base) throw new Error('usage: node settle.smoke.mjs <url of packages/dynamic-corals/square-shop/>');
const STRETCH = Math.max(1, Number(process.env.SETTLE_SMOKE_STRETCH || 8));

const STORE = 'g_smoke';
const CART_KEY = `dc-square-shop-cart:${STORE}`;
const SETTLED_KEY = `dc-square-shop-settled:${STORE}`;
const ZINE = 'VZINE', PA = 'VPRINTA', PB = 'VPRINTB';
const completeUrl = new URL('__settle-complete.html', base).href;
const shopUrl = new URL('__settle-shop.html', base).href;

const completePage = (ref) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shop</title></head><body><main>${
	completionBody(COMPLETE_COPY['en-US'], 'en-US', '/__settle-api/out?ref=' + ref, '/shop', STORE, true, ref)
}</main></body></html>`;

// Runs in the completion tab before its own script: counts the basket reads, tells the shop tab
// the first one happened, and stretches the settle step's short timers (see the header).
const completionProbe = ({ cartKey, stretch }) => {
	window.__cartReads = 0;
	const ch = new BroadcastChannel('settle-smoke');
	const get = Storage.prototype.getItem;
	Storage.prototype.getItem = function (k) {
		const v = get.call(this, k);
		if (k === cartKey && ++window.__cartReads === 1) ch.postMessage('first-read');
		return v;
	};
	const st = window.setTimeout;
	window.setTimeout = function (fn, ms, ...rest) { return st.call(this, fn, ms > 0 && ms < 1000 ? ms * stretch : ms, ...rest); };
};

const b = await chromium.launch();
const failures = [];

async function arm({ label, otherTab, reload, expectCart, expectMinReads }) {
	const ctx = await b.newContext();
	const ref = 'r-' + label.replace(/\W+/g, '-');
	await ctx.route(completeUrl, (r) => r.fulfill({ contentType: 'text/html', body: completePage(ref) }));
	await ctx.route(shopUrl, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>shop</title>' }));
	await ctx.route('**/__settle-api/out**', (r) => r.fulfill({ contentType: 'application/json',
		body: JSON.stringify({ ok: true, state: 'paid', lines: [], total_minor: 0, currency: 'USD' }) }));

	// The shop tab: seeds the basket and the record the coral writes as the checkout leaves, and
	// keeps the basket it loaded in memory.
	const shop = await ctx.newPage();
	await shop.goto(shopUrl, { waitUntil: 'load', timeout: 20000 });
	await shop.evaluate(({ cartKey, ref, ZINE, PA, PB, otherTab }) => {
		localStorage.clear();
		const basket = [[ZINE, 2], [PA, 3]];
		localStorage.setItem(cartKey, JSON.stringify(basket));
		localStorage.setItem('dc-square-shop-sold:' + ref, JSON.stringify({ t: Date.now(), ids: [ZINE], lines: [[ZINE, 2]] }));
		window.__wrote = false;
		if (!otherTab) return;
		new BroadcastChannel('settle-smoke').onmessage = () => {
			// The stale tab's next add: its in-memory basket plus one print, over the whole key.
			localStorage.setItem(cartKey, JSON.stringify(basket.concat([[PB, 1]])));
			window.__wrote = true;
		};
	}, { cartKey: CART_KEY, ref, ZINE, PA, PB, otherTab });

	const page = await ctx.newPage();
	const errs = [];
	page.on('pageerror', (e) => errs.push(String(e)));
	await page.addInitScript(completionProbe, { cartKey: CART_KEY, stretch: STRETCH });
	const settled = () => page.waitForFunction(({ k, ref }) => {
		// The old page writes no list; it consumes the record. Either is the end of a settle.
		const list = localStorage.getItem(k);
		return (list && list.includes(ref)) || localStorage.getItem('dc-square-shop-sold:' + ref) === null;
	}, { k: SETTLED_KEY, ref }, { timeout: 10000 });
	await page.goto(completeUrl, { waitUntil: 'load', timeout: 20000 });
	await settled();
	// Give a write the other tab still has in flight time to land, so the result read is final.
	await page.waitForTimeout(300);
	if (reload) {
		await shop.evaluate(({ cartKey, PA, PB, ZINE }) => localStorage.setItem(cartKey, JSON.stringify([[PA, 3], [PB, 1], [ZINE, 1]])),
			{ cartKey: CART_KEY, PA, PB, ZINE });
		await page.reload({ waitUntil: 'load', timeout: 20000 });
		await page.waitForFunction(() => /\S/.test(document.getElementById('dc-shop-heading').textContent), null, { timeout: 10000 });
		await page.waitForTimeout(100 * STRETCH + 300);
	}
	// The page's own reads, taken before this probe reads the basket itself.
	const reads = await page.evaluate(() => window.__cartReads);
	const cart = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), CART_KEY) || 'null');
	const wrote = await shop.evaluate(() => window.__wrote);

	const problems = [];
	if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
	if (otherTab && !wrote) problems.push('control: the other tab never wrote — this arm measured nothing');
	if (JSON.stringify(cart) !== JSON.stringify(expectCart)) problems.push(`basket ${JSON.stringify(cart)}, expected ${JSON.stringify(expectCart)}`);
	if (expectMinReads && reads < expectMinReads) problems.push(`the page read the basket ${reads} time(s); a retry needs at least ${expectMinReads}`);
	console.log(`  ${problems.length ? '✗' : '✓'} ${label}  basket=${JSON.stringify(cart)} reads=${reads}${otherTab ? ` otherTabWrote=${wrote}` : ''}`);
	for (const x of problems) failures.push(`${label}: ${x}`);
	await ctx.close();
}

// Control: nobody else writes. The two sold zines come off; the prints stay.
await arm({ label: 'one tab', otherTab: false, expectCart: [[PA, 3]] });
// The stale shop tab writes between the page's read and its write. Its print must survive and the
// sold zines it wrote back must still come off. Settling with nobody else writing is three reads
// (read, wait, read again, then the read the answer is computed from); a fourth is the retry.
await arm({ label: 'a second tab writes during the settle', otherTab: true, expectCart: [[PA, 3], [PB, 1]], expectMinReads: 4 });
// The reload: what the visitor put in the basket after the order stays, including a new zine.
await arm({ label: 'reload after the visitor shopped on', otherTab: false, reload: true, expectCart: [[PA, 3], [PB, 1], [ZINE, 1]] });
await b.close();

if (failures.length) {
	console.error('✗ settle smoke:\n' + failures.map((f) => '    ' + f).join('\n'));
	process.exit(1);
}
console.log(`✓ settle smoke: the basket settles once, and a second tab's write during it is kept (waits ×${STRETCH})`);
