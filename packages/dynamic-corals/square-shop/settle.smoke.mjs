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
// inside the settle for another tab's write to land in.
//
// Three more arms (tile#328) mount the REAL shop coral (./square-shop.js, cart mode) in a tab that
// loads the basket BEFORE the order, then let the completion tab settle it, then act in the stale
// shop tab. Through 0.11.20 that tab wrote its whole in-memory basket back and the paid lines came
// back with it:
//
//   stale tab, event delivered   the shop tab redraws from the `storage` event; + on another line
//                                writes no paid line.
//   stale tab, event withheld    the shop tab never hears the event (the click ran first, or the
//                                page sat in the back/forward cache); + still writes no paid line,
//                                because the coral re-reads the stored basket before it writes.
//   checkout, event withheld     Checkout on that stale screen sends nothing, draws the stored
//                                basket, and the next press sends only what is left.
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

// ── tile#328: a shop tab that loaded the basket before the order ─────────────
const coralUrl = new URL('__settle-coral.html', base).href;
const payUrl = new URL('__settle-pay.html', base).href;
const apiBase = new URL('/__settle-api', base).href;
const CATALOG = { connected: true, items: [
	{ variation_id: ZINE, name: 'Zine', display_price: 20, currency: 'USD', variants: [] },
	{ variation_id: PA, name: 'Print A', display_price: 5, currency: 'USD', variants: [] },
	{ variation_id: PB, name: 'Print B', display_price: 5, currency: 'USD', variants: [] }
] };
const coralPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>shop</title></head><body>
<div data-dynamic-coral="square-shop" data-guild-id="${STORE}" data-cart="1" data-api-base="${apiBase}"></div>
<script type="module" src="square-shop.js"></script></body></html>`;

// Runs in the shop tab before the coral: a capturing listener on the window runs before the coral's
// own and stops the event there, as if this tab had not handled it yet.
const withholdStorageEvents = () => {
	window.addEventListener('storage', (e) => e.stopImmediatePropagation(), true);
};

const lineNames = (page) => page.$$eval('.dc-square-shop-cart .dc-square-shop-line .dc-square-shop-line-name', (ns) => ns.map((n) => n.textContent));

async function staleArm({ label, withhold, act, expectCart, expectPosts }) {
	const ctx = await b.newContext();
	const ref = 'r-' + label.replace(/\W+/g, '-');
	const posts = [];
	await ctx.route(completeUrl, (r) => r.fulfill({ contentType: 'text/html', body: completePage(ref) }));
	await ctx.route(shopUrl, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>shop</title>' }));
	await ctx.route(coralUrl, (r) => r.fulfill({ contentType: 'text/html', body: coralPage }));
	await ctx.route(payUrl, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>pay</title>' }));
	await ctx.route('**/__settle-api/out**', (r) => r.fulfill({ contentType: 'application/json',
		body: JSON.stringify({ ok: true, state: 'paid', lines: [], total_minor: 0, currency: 'USD' }) }));
	await ctx.route('**/__settle-api/api/v2/shop/catalog**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(CATALOG) }));
	await ctx.route('**/__settle-api/api/v2/shop/cart', (r) => {
		posts.push(JSON.parse(r.request().postData() || 'null'));
		return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: payUrl }) });
	});

	// The basket and the sold record as they stand when the shopper leaves for the payment page.
	const seed = await ctx.newPage();
	await seed.goto(shopUrl, { waitUntil: 'load', timeout: 20000 });
	await seed.evaluate(({ cartKey, ref, ZINE, PA }) => {
		localStorage.clear();
		localStorage.setItem(cartKey, JSON.stringify([[ZINE, 2], [PA, 3]]));
		localStorage.setItem('dc-square-shop-sold:' + ref, JSON.stringify({ t: Date.now(), ids: [ZINE], lines: [[ZINE, 2]] }));
	}, { cartKey: CART_KEY, ref, ZINE, PA });

	// The stale shop tab: it mounts the coral and reads the basket now, before the order settles.
	const shop = await ctx.newPage();
	const errs = [];
	shop.on('pageerror', (e) => errs.push(String(e)));
	if (withhold) await shop.addInitScript(withholdStorageEvents);
	await shop.goto(coralUrl, { waitUntil: 'load', timeout: 20000 });
	await shop.waitForFunction(() => document.querySelectorAll('.dc-square-shop-cart .dc-square-shop-line').length === 2, null, { timeout: 10000 });

	// The receipt settles the order in another tab.
	const done = await ctx.newPage();
	await done.goto(completeUrl, { waitUntil: 'load', timeout: 20000 });
	await done.waitForFunction((ref) => localStorage.getItem('dc-square-shop-sold:' + ref) === null, ref, { timeout: 10000 });

	const problems = [];
	if (withhold) {
		// Give an event every chance to arrive, then confirm it was withheld: the screen is stale.
		await shop.waitForTimeout(300);
		const names = await lineNames(shop);
		if (JSON.stringify(names) !== JSON.stringify(['Zine', 'Print A'])) problems.push(`the event was not withheld: the panel shows ${JSON.stringify(names)}`);
	} else {
		try {
			await shop.waitForFunction(() => ![...document.querySelectorAll('.dc-square-shop-cart .dc-square-shop-line-name')].some((n) => n.textContent === 'Zine'),
				null, { timeout: 5000 });
		} catch {
			problems.push(`the shop tab did not redraw on the storage event: the panel still shows ${JSON.stringify(await lineNames(shop))}`);
		}
	}
	try {
		await act(shop);
		await shop.waitForTimeout(200);
	} catch (e) {
		problems.push(`the shop tab did not get through its action: ${String(e && e.message || e).split('\n')[0]}`);
	}
	const cart = JSON.parse(await done.evaluate((k) => localStorage.getItem(k), CART_KEY) || 'null');

	if (errs.length) problems.push(`page errors: ${errs.join(' | ')}`);
	if (JSON.stringify(cart) !== JSON.stringify(expectCart)) problems.push(`basket ${JSON.stringify(cart)}, expected ${JSON.stringify(expectCart)}`);
	if (expectPosts) {
		const items = posts.map((p) => p && p.items);
		if (JSON.stringify(items) !== JSON.stringify(expectPosts)) problems.push(`checkout sent ${JSON.stringify(items)}, expected ${JSON.stringify(expectPosts)}`);
	}
	console.log(`  ${problems.length ? '✗' : '✓'} ${label}  basket=${JSON.stringify(cart)}${expectPosts ? ` posts=${JSON.stringify(posts.map((p) => p && p.items))}` : ''}`);
	for (const x of problems) failures.push(`${label}: ${x}`);
	await ctx.close();
}

const plusOnPrintA = (shop) => shop.locator('.dc-square-shop-cart .dc-square-shop-line', { hasText: 'Print A' })
	.locator('button[aria-label="Increase quantity"]').click({ timeout: 5000 });

// The settle reads the basket once (0.11.19 read it twice in one task, to no effect).
await arm({ label: 'one tab', expectCart: [[PA, 3]], expectReads: 1 });
// What the visitor put in the basket after the order stays, including a new zine. The reloaded
// page counts its own reads from zero; it reads the tombstone and stops, so `reads` is checked as 0.
await arm({ label: 'reload after the visitor shopped on', reload: true, expectCart: [[PA, 3], [PB, 1], [ZINE, 1]], expectReads: 0 });
await arm({ label: 'the completion tab is closed at its first basket read; the paid lines are already off', closeAtFirstRead: true, expectCart: [[PA, 3]] });
await staleArm({ label: 'stale shop tab, storage event delivered: it redraws, and + writes no paid line', withhold: false,
	act: plusOnPrintA, expectCart: [[PA, 4]] });
await staleArm({ label: 'stale shop tab, storage event withheld: + still writes no paid line', withhold: true,
	act: plusOnPrintA, expectCart: [[PA, 4]] });
await staleArm({ label: 'stale shop tab, storage event withheld: Checkout sends nothing the screen did not show', withhold: true,
	act: async (shop) => {
		const checkout = shop.locator('.dc-square-shop-checkout');
		await checkout.click({ timeout: 5000 });
		// First press: nothing is sent, and the stored basket is drawn.
		await shop.waitForFunction(() => document.querySelectorAll('.dc-square-shop-cart .dc-square-shop-line').length === 1, null, { timeout: 5000 });
		await shop.waitForTimeout(200);
		await Promise.all([
			shop.waitForURL('**/__settle-pay.html', { timeout: 10000 }),
			checkout.click({ timeout: 5000 })
		]);
	},
	expectCart: [[PA, 3]], expectPosts: [[{ variation_id: PA, quantity: 3 }]] });
await b.close();

if (failures.length) {
	console.error('✗ settle smoke:\n' + failures.map((f) => '    ' + f).join('\n'));
	process.exit(1);
}
console.log('✓ settle smoke: the basket settles once, in the task that receives the paid answer, and a reload touches nothing');
