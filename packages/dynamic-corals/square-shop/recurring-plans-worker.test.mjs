// Recurring plans on the edge: the shared render core and the emitted worker.
//
// A Stripe shop's generated worker asks the catalogue for plans (`include=recurring`) and draws them
// into the shop grid and into the matching product page, with the interval and a Subscribe button.
// Everything below also pins the other half: a catalogue with no plans, and a shop on another
// provider, get the request and the bytes they always got.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderShopGrid, renderProductPage, planIntervalText, planCopy } from './product-page-core.js';
import { planIntervalText as coralIntervalText, localeDictionary } from './square-shop.js';

const here = dirname(fileURLToPath(import.meta.url));

const ITEM = {
	variation_id: 'V1', product_id: 'prod_a', slug: 'tee', name: 'Tee', title: 'Tee', display_price: 5, currency: 'USD',
	variants: [{ id: 'V1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5, available: true }]
};
const PLANS = [
	{ product_id: 'prod_a', name: 'Friends', prices: [
		{ id: 'price_month', amount_minor: 500, currency: 'USD', display_price: 5, interval: 'month', interval_count: 1 },
		{ id: 'price_quarter', amount_minor: 1300, currency: 'USD', display_price: 13, interval: 'month', interval_count: 3 }
	] },
	{ product_id: 'prod_b', name: 'Patrons', prices: [
		{ id: 'price_year', amount_minor: 9000, currency: 'USD', display_price: 90, interval: 'year', interval_count: 1 }
	] }
];

// ── the shop grid ───────────────────────────────────────────────────────────
test('the grid without plans is byte for byte the grid it was, whether plans are absent, empty or unusable', () => {
	for (const cart of [false, true]) {
		const base = renderShopGrid([ITEM], { cart, detailBase: '/shop' });
		for (const recurringPlans of [undefined, [], null, [{ name: 'x', prices: [{ id: 'p', interval: 'fortnight', amount_minor: 1 }] }]]) {
			assert.deepEqual(renderShopGrid([ITEM], { cart, detailBase: '/shop', recurringPlans }), base);
		}
	}
});

test('the grid with plans appends a plans block after the grid, with intervals and Subscribe buttons', () => {
	for (const cart of [false, true]) {
		const { gridHtml } = renderShopGrid([ITEM], { cart, detailBase: '/shop', recurringPlans: PLANS });
		const base = renderShopGrid([ITEM], { cart, detailBase: '/shop' }).gridHtml;
		assert.ok(gridHtml.startsWith(base), 'the items and the cart panel are exactly what they were');
		const block = gridHtml.slice(base.length);
		assert.match(block, /data-plans-ssr="/);
		assert.deepEqual([...block.matchAll(/dc-square-shop-price">([^<]*)</g)].map((m) => m[1]), ['USD\u00a05.00 / month', 'USD\u00a013.00 / 3 months', 'USD\u00a090.00 / year']);
		assert.equal((block.match(/dc-square-shop-subscribe">Subscribe</g) || []).length, 3);
		assert.ok(!block.includes('data-variation-id'), 'a plan carries no variation id: it cannot be hydrated into the cart');
		assert.ok(!base.includes('dc-square-shop-plan'));
	}
});

test('the plans block escapes what the catalogue gave and keeps only plans it can sell', () => {
	const { gridHtml } = renderShopGrid([ITEM], { recurringPlans: [
		{ product_id: 'p"><x', name: '<b>Bold</b>', prices: [{ id: 'pr"1', amount_minor: 100, currency: 'USD', interval: 'week', interval_count: 2 }] },
		{ product_id: 'q', name: 'No price', prices: [] }
	] });
	assert.ok(!gridHtml.includes('<b>Bold</b>'));
	assert.ok(gridHtml.includes('&lt;b&gt;Bold&lt;/b&gt;'));
	assert.ok(gridHtml.includes('USD\u00a01.00 / 2 weeks'));
	assert.ok(!gridHtml.includes('No price'));
});

test('the Subscribe word follows the shop language and a site-set label wins', () => {
	const word = (locale, labels) => renderShopGrid([ITEM], { locale, labels, recurringPlans: PLANS }).gridHtml.match(/dc-square-shop-subscribe">([^<]*)</)[1];
	assert.equal(word('en-US'), 'Subscribe');
	assert.equal(word('ja-JP'), '定期購入');
	assert.equal(word('zh-TW'), '訂閱');
	assert.equal(word('zh-CN'), '订阅');
	assert.equal(word('en-US', { subscribe: 'Join' }), 'Join');
});

// ── the product page ────────────────────────────────────────────────────────
test('a product page without plans is byte for byte the page it was', () => {
	const cfg = { guildId: 'g1', siteId: 's1', apiBase: 'https://api.test', shopPath: '/shop', locale: 'en-US' };
	const base = renderProductPage(ITEM, cfg);
	for (const recurringPlans of [undefined, [], null]) assert.deepEqual(renderProductPage(ITEM, { ...cfg, recurringPlans }), base);
});

test('a product page with plans shows each price with its interval and a Subscribe button, apart from the cart controls', () => {
	const cfg = { guildId: 'g1', siteId: 's1', apiBase: 'https://api.test', shopPath: '/shop', locale: 'en-US' };
	const base = renderProductPage(ITEM, cfg);
	const page = renderProductPage(ITEM, { ...cfg, recurringPlans: [PLANS[0]] });
	assert.deepEqual([...page.bodyHtml.matchAll(/class="dc-pp-price">([^<]*)</g)].map((m) => m[1]), ['Friends — USD\u00a05.00 / month', 'Friends — USD\u00a013.00 / 3 months']);
	assert.equal((page.bodyHtml.match(/data-dc-subscribe>Subscribe</g) || []).length, 2);
	assert.ok(page.bodyHtml.includes('data-api-base="https://api.test"'));
	assert.equal(page.bodyHtml.match(/data-dc-add[^>]*>Add to cart</g).length, 1, 'the cart Add button is still the one');
	// the cart script is the same text; the subscribe script is a separate one
	const cartScript = (html) => html.match(/<script type="module">[\s\S]*?<\/script>/)[0];
	assert.equal(cartScript(page.bodyHtml), cartScript(base.bodyHtml));
	assert.deepEqual(page.headMeta, base.headMeta);
});

test('the product page script posts the exact body, follows the redirect and says the checkout labels on a refusal', async () => {
	const page = renderProductPage(ITEM, { guildId: 'g1', siteId: 's1', apiBase: 'https://api.test', shopPath: '/shop', locale: 'en-US', recurringPlans: [PLANS[0]] });
	const scripts = [...page.bodyHtml.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	assert.equal(scripts.length, 2);
	const run = async (status) => {
		const calls = [];
		const stored = {};
		const msg = { textContent: '', hidden: true };
		const row = { getAttribute: () => 'price_month', querySelector: () => msg };
		const button = { disabled: false, textContent: 'Subscribe', listeners: {}, closest: () => row, setAttribute() {}, removeAttribute() {}, addEventListener(t, f) { this.listeners[t] = f; } };
		const attrs = { 'data-guild-id': 'g1', 'data-site-id': 's1', 'data-shop-path': '/shop', 'data-api-base': 'https://api.test' };
		const root = { getAttribute: (k) => (k in attrs ? attrs[k] : null), querySelectorAll: () => [button] };
		const win = { location: { href: 'https://shop.example/shop/tee', origin: 'https://shop.example' } };
		const fetchStub = async (url, init) => {
			calls.push({ url, body: JSON.parse(init.body), method: init.method });
			return { ok: status === 200, status, json: async () => (status === 200 ? { attempt_id: 'a', url: 'https://pay.test/x' } : { error: 'machine' }) };
		};
		await new Function('document', 'window', 'fetch', 'crypto', 'localStorage', scripts[1])(
			{ querySelector: () => root }, win, fetchStub, globalThis.crypto, { setItem: (k, v) => { stored[k] = v; } });
		await button.listeners.click();
		return { calls, stored, msg, button, win };
	};

	const ok = await run(200);
	assert.equal(ok.calls.length, 1);
	assert.equal(ok.calls[0].url, 'https://api.test/api/v2/shop/subscribe');
	assert.deepEqual(Object.keys(ok.calls[0].body), ['guild_id', 'price_id', 'client_request_ref', 'redirect_url']);
	assert.equal(ok.calls[0].body.price_id, 'price_month');
	assert.equal(ok.calls[0].body.redirect_url, `https://shop.example/shop/complete?ref=${encodeURIComponent(ok.calls[0].body.client_request_ref)}`);
	assert.equal(ok.win.location.href, 'https://pay.test/x');
	const sold = JSON.parse(Object.values(ok.stored)[0]);
	assert.deepEqual([sold.ids, sold.lines], [[], []]);

	const copy = planCopy('en-US');
	for (const [status, label] of [[400, copy.error], [403, copy.error], [404, copy.closed], [409, copy.again], [429, copy.busy], [502, copy.unavailable]]) {
		const refused = await run(status);
		assert.equal(refused.msg.textContent, label, String(status));
		assert.equal(refused.msg.hidden, false);
		assert.equal(refused.button.disabled, false);
	}
});

// ── the worker core and the coral say the same words ───────────────────────
test('the worker\'s interval words, Subscribe word and refusal sentences are the coral\'s, in every language', () => {
	for (const locale of ['en-US', 'en', 'fr-FR', 'ja', 'ja-JP', 'zh', 'zh-TW', 'zh-Hant', 'zh-CN', 'zh-Hans', 'zh-SG']) {
		for (const unit of ['day', 'week', 'month', 'year']) {
			for (const n of [1, 2, 3, 12]) assert.equal(planIntervalText(unit, n, locale), coralIntervalText(unit, n, locale), `${locale} ${unit} ${n}`);
		}
		const d = localeDictionary(locale);
		const c = planCopy(locale);
		assert.deepEqual(
			{ subscribe: c.subscribe, pending: c.pending, error: c.error, busy: c.busy, closed: c.closed, again: c.again, unavailable: c.unavailable },
			{ subscribe: d.subscribe, pending: d.checkoutPending, error: d.checkoutError, busy: d.checkoutBusy, closed: d.checkoutClosed, again: d.checkoutAgain, unavailable: d.checkoutUnavailable },
			locale);
	}
});

// ── the emitted worker ──────────────────────────────────────────────────────
function emitWorker(name, provider = 'stripe') {
	const out = join(tmpdir(), `recurring-plans-${name}-${process.pid}.mjs`);
	execFileSync('node', [
		join(here, 'emit-shop-function.mjs'),
		'--guild', 'g1', '--name', 'NORTHWIND',
		'--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }]),
		'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider }]),
		'--api', 'https://api.example',
		'--out', out
	], { stdio: 'inherit' });
	return out;
}

const shellWith = (coralAttrs) => '<!doctype html><html><head><title>Shop</title></head><body><main>' +
	`<div data-dynamic-coral="square-shop" data-guild-id="g1" data-cart="1" data-detail-base="/shop"${coralAttrs}></div>` +
	'</main></body></html>';

async function drive(file, path, shell, { plans = true } = {}) {
	const asked = [];
	const real = globalThis.fetch;
	globalThis.fetch = async (url) => {
		const u = String(url);
		asked.push(u);
		const parsed = new URL(u);
		if (parsed.pathname === '/api/v2/shop/catalog') {
			const recurring = parsed.searchParams.get('include') === 'recurring';
			return new Response(JSON.stringify({ connected: true, processor: 'stripe', items: [ITEM], ...(recurring && plans ? { recurring_plans: plans === 'empty' ? [] : PLANS } : {}) }), { headers: { 'content-type': 'application/json' } });
		}
		if (parsed.pathname === '/api/v2/shop/catalog/item') {
			// The item read answers this product's plan only (zero or one entry), as the list read shapes it.
			const recurring = parsed.searchParams.get('include') === 'recurring';
			const own = PLANS.filter((p) => p.product_id === ITEM.product_id);
			return new Response(JSON.stringify({ connected: true, item: ITEM, ...(recurring && plans ? { recurring_plans: plans === 'empty' ? [] : own } : {}) }), { headers: { 'content-type': 'application/json' } });
		}
		throw new Error(`unexpected fetch: ${u}`);
	};
	const env = { ASSETS: { fetch: async (req) => {
		const u = String(req.url || req);
		if (u.endsWith('/shop/')) return new Response(shell, { headers: { 'content-type': 'text/html' } });
		return new Response('STATIC:' + u, { status: 200 });
	} } };
	try {
		const mod = await import(pathToFileURL(file).href + '?' + Math.random());
		const res = await mod.default.fetch(new Request('https://example.com' + path), env, { waitUntil() {} });
		return { html: await res.text(), asked };
	} finally { globalThis.fetch = real; }
}

test('the emitted worker: a Stripe shop asks for plans and server-renders them into /shop', async () => {
	const file = emitWorker('grid-on');
	const { html, asked } = await drive(file, '/shop/', shellWith(''));
	assert.deepEqual(asked, ['https://example.com/api/v2/shop/catalog?guild_id=g1&payment_rail=stripe&include=recurring']);
	assert.ok(html.includes('data-ssr="1"'));
	assert.ok(html.includes('data-plans-ssr='));
	assert.ok(html.includes('USD\u00a05.00 / month') && html.includes('USD\u00a013.00 / 3 months') && html.includes('USD\u00a090.00 / year'));
	assert.equal((html.match(/dc-square-shop-subscribe">Subscribe</g) || []).length, 3);
});

test('the emitted worker: a Stripe catalogue with no plans renders the grid it always did, however the answer says so', async () => {
	const file = emitWorker('grid-none');
	for (const plans of [false, 'empty']) {
		const { html, asked } = await drive(file, '/shop/', shellWith(''), { plans });
		assert.deepEqual(asked, ['https://example.com/api/v2/shop/catalog?guild_id=g1&payment_rail=stripe&include=recurring']);
		assert.ok(html.includes('data-ssr="1"'));
		for (const marker of ['dc-square-shop-plan', 'data-plans-ssr', 'Subscribe']) assert.ok(!html.includes(marker), marker);
		const none = renderShopGrid([ITEM], { cart: true, detailBase: '/shop' }).gridHtml;
		assert.ok(html.includes(none), 'the grid is exactly what the core draws for these items');
	}
});

test('the emitted worker: a shop on another provider asks and renders exactly what it did', async () => {
	const file = emitWorker('grid-square', 'square');
	const { html, asked } = await drive(file, '/shop/', shellWith(''));
	assert.ok(asked.length > 0);
	assert.ok(asked.every((u) => !u.includes('include=recurring')));
	assert.ok(!html.includes('dc-square-shop-plan') && !html.includes('Subscribe'));
});

const ITEM_URL = 'https://example.com/api/v2/shop/catalog/item?guild_id=g1&slug=tee&payment_rail=stripe&include=recurring';

test('the emitted worker: the product page of a product with plans draws them from its one item read', async () => {
	const file = emitWorker('product-on');
	const { html, asked } = await drive(file, '/shop/tee', shellWith(''));
	assert.deepEqual(asked, [ITEM_URL], 'one catalogue read: the item, asked for its plans, and no list read');
	assert.ok(html.includes('Friends — USD\u00a05.00 / month'));
	assert.ok(html.includes('Friends — USD\u00a013.00 / 3 months'));
	assert.ok(!html.includes('Patrons'), 'another product\'s plan does not appear on this page');
	assert.equal((html.match(/data-dc-subscribe>Subscribe</g) || []).length, 2);
	assert.ok(html.includes('/api/v2/shop/subscribe'));
});

// The frozen 178d9be template and core, emitted by the current emitter in a scratch tree: the
// worker a Stripe Site had before plans existed, for the same fixture.
function emitBaseWorker(name) {
	const root = join(tmpdir(), `recurring-plans-base-${name}-${process.pid}`);
	const dir = join(root, 'packages', 'dynamic-corals', 'square-shop');
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(root, 'packages', 'sitetile'), { recursive: true });
	writeFileSync(join(root, 'package.json'), '{"private":true,"type":"module"}');
	cpSync(join(here, '..', '..', 'sitetile', 'query-redirects.mjs'), join(root, 'packages', 'sitetile', 'query-redirects.mjs'));
	for (const f of readdirSync(here)) if (/\.(mjs|js)$/.test(f) && !/\.test\.mjs$/.test(f) && !/\.fixture\.js$/.test(f)) cpSync(join(here, f), join(dir, f));
	cpSync(join(here, 'package.json'), join(dir, 'package.json'));
	for (const f of ['shop-function-template.js', 'product-page-core.js']) cpSync(join(here, 'fixtures', 'recurring-plans-base-178d9be', f), join(dir, f));
	const out = join(root, 'worker.mjs');
	execFileSync('node', [
		join(dir, 'emit-shop-function.mjs'),
		'--guild', 'g1', '--name', 'NORTHWIND',
		'--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }]),
		'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'stripe' }]),
		'--api', 'https://api.example',
		'--out', out
	], { stdio: 'inherit' });
	return out;
}

test('the emitted worker: against an RSP whose item answer has no plans, the product page is the page the 178d9be worker drew', async () => {
	const base = await drive(emitBaseWorker('skew'), '/shop/tee', shellWith(''), { plans: false });
	for (const plans of [false, 'empty']) {
		const now = await drive(emitWorker('product-skew-' + plans), '/shop/tee', shellWith(''), { plans });
		assert.equal(now.html, base.html, 'the full page, byte for byte');
		assert.deepEqual(now.asked, base.asked.map((u) => u + '&include=recurring'), 'the same one read, asked for plans');
	}
});

test('the emitted worker: a product page with no plan, or on another provider, is the page it always was', async () => {
	const stripe = await drive(emitWorker('product-none'), '/shop/tee', shellWith(''), { plans: 'empty' });
	assert.ok(!stripe.html.includes('data-dc-subscribe') && !stripe.html.includes('/api/v2/shop/subscribe'));
	const square = await drive(emitWorker('product-square', 'square'), '/shop/tee', shellWith(''));
	assert.ok(square.asked.every((u) => !u.includes('include=recurring')));
	assert.ok(!square.html.includes('data-dc-subscribe') && !square.html.includes('/api/v2/shop/subscribe'));
});

test('the emitted worker carries the plan code', () => {
	const file = emitWorker('exports');
	const src = readFileSync(file, 'utf8');
	assert.ok(src.includes('include=recurring'));
	assert.ok(src.includes('data-plans-ssr'));
});
