// square-shop.js — recurring plans: shown with their interval, bought alone, never in the cart.
//
// The catalog read always carries `include=recurring`; each plan's price renders as "<amount> / month" with a Subscribe button, and
// that button posts a price id (and nothing about money) to POST /api/v2/shop/subscribe and follows
// the redirect. A plan is not an item: it is not in the cart, the stored basket or the cart request.
//
// The file's SOURCE runs as a function body with document/window/crypto/fetch injected, the way
// instant-checkout-ref.test.mjs does it; nothing in the source is rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const stripExports = (src) => src.replace(/\nexport \{[\s\S]*?\n\};?\s*$/, '\n');
// The coral as it was before plans (0.11.21), kept beside the tests as the yardstick for "renders exactly as before".
const BASE_SOURCE = stripExports(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'recurring-plans-base.fixture.js'), 'utf8'));
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(/\nexport \{[\s\S]*?\n\};?\s*$/, '\n');

const PREFIX = 'dc-square-shop';
const API = 'https://api.test';
const SUBSCRIBE_URL = `${API}/api/v2/shop/subscribe`;
const CART_URL = `${API}/api/v2/shop/cart`;
const PAY_URL = 'https://checkout.stripe.test/c/pay_1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ITEMS = [{ variation_id: 'V1', name: 'Tee', display_price: 5, currency: 'USD' }];
const PLANS = [
	{ product_id: 'prod_a', name: 'Friends', prices: [
		{ id: 'price_month', amount_minor: 500, currency: 'USD', display_price: 5, interval: 'month', interval_count: 1 },
		{ id: 'price_quarter', amount_minor: 1300, currency: 'USD', display_price: 13, interval: 'month', interval_count: 3 }
	] },
	{ product_id: 'prod_b', name: 'Patrons', prices: [
		{ id: 'price_year', amount_minor: 9000, currency: 'USD', display_price: 90, interval: 'year', interval_count: 1 }
	] }
];

// ── a DOM with a real tree and a selector engine for what the coral asks ──────
// innerHTML is not parsed. A class the coral looks up inside markup it assigned (the card body it
// appends the Buy button to) is minted as a child on first ask, which is what the other suites'
// shims do; a class that is not in that markup is simply not found.
function makeEl(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		children: [],
		parentElement: null,
		className: '',
		textContent: '',
		disabled: false,
		type: '',
		style: {},
		_html: '',
		_attrs: Object.create(null),
		_listeners: Object.create(null),
		classList: {
			add(c) { const p = String(el.className).split(/\s+/).filter(Boolean); if (p.indexOf(c) < 0) p.push(c); el.className = p.join(' '); },
			remove(c) { el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
			contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; }
		},
		appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
		append(...cs) { for (const c of cs) el.appendChild(c); },
		remove() { if (el.parentElement) el.parentElement.children = el.parentElement.children.filter((c) => c !== el); el.parentElement = null; },
		setAttribute(k, v) { el._attrs[k] = String(v); },
		getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
		removeAttribute(k) { delete el._attrs[k]; },
		addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
		querySelector(sel) {
			const found = findAll(el, sel)[0];
			if (found) return found;
			const m = /^\.([\w-]+)$/.exec(sel);
			if (m && el._html.includes(m[1])) { const c = makeEl('div'); c.className = m[1]; return el.appendChild(c); }
			return null;
		},
		querySelectorAll(sel) { return findAll(el, sel); }
	};
	Object.defineProperty(el, 'innerHTML', {
		get() { return el._html; },
		set(v) { el._html = String(v); el.children = []; }
	});
	return el;
}
function matches(e, sel) {
	const m = /^(?:\.([\w-]+))?(?:\[([\w-]+)\])?$/.exec(sel);
	if (!m || (!m[1] && !m[2])) throw new Error(`fake selector cannot parse: ${sel}`);
	if (m[1] && String(e.className).split(/\s+/).indexOf(m[1]) < 0) return false;
	if (m[2] && e.getAttribute(m[2]) === null) return false;
	return true;
}
function findAll(root, sel, out = []) {
	for (const c of root.children) { if (matches(c, sel)) out.push(c); findAll(c, sel, out); }
	return out;
}
function walk(el, out = []) { out.push(el); for (const c of el.children) walk(c, out); return out; }
function byClass(root, cls) { return walk(root).filter((e) => String(e.className).split(/\s+/).includes(cls)); }
function text(el) { return [el.textContent, ...el.children.map(text)].join(''); }
const flush = () => new Promise((r) => setTimeout(r, 0));
function click(el) { for (const fn of el._listeners.click || []) fn(); }

function load({ catalog, post, store = {}, lang, source = SOURCE } = {}) {
	const calls = [];
	const writes = [];
	const state = { store: { ...store } };
	const document = {
		readyState: 'complete', head: makeEl('head'), body: makeEl('body'),
		documentElement: { lang: lang || '' },
		createElement: (t) => makeEl(t), querySelectorAll: () => [], addEventListener: () => {}
	};
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		history: { replaceState() {} },
		localStorage: {
			getItem: (k) => (k in state.store ? state.store[k] : null),
			setItem: (k, v) => { writes.push(k); state.store[k] = String(v); },
			removeItem: (k) => { delete state.store[k]; }
		},
		dispatchEvent: () => true
	};
	const fetchImpl = async (url, init) => {
		const u = String(url);
		calls.push({ url: u, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : undefined });
		if (u.startsWith(`${API}/api/v2/shop/catalog?`)) return { ok: true, status: 200, json: async () => catalog };
		if (u === SUBSCRIBE_URL) {
			const r = post ? post() : { status: 200, body: { attempt_id: 'a1', url: PAY_URL } };
			return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
		}
		if (u === CART_URL) return { ok: false, status: 500, json: async () => ({ error: 'no' }) };
		throw new Error(`unexpected fetch: ${u}`);
	};
	const api = new Function('document', 'window', 'crypto', 'fetch', 'CustomEvent',
		source + '\nreturn { mount, readLabels, ...(typeof planIntervalText === "function" ? { planIntervalText, normalizePlans } : {}) };')(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	return { ...api, calls, writes, window, state };
}

async function mountShop(sb, attrs = {}, setup) {
	const root = makeEl('div');
	root.setAttribute('data-guild-id', 'g1');
	root.setAttribute('data-api-base', API);
	for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
	if (setup) setup(root);
	await sb.mount(root);
	await flush();
	return root;
}
const subscribeButtons = (root) => byClass(root, `${PREFIX}-subscribe`);
const planTexts = (root) => byClass(root, `${PREFIX}-plan-price`).map((r) => text(r.children[0]));
const withPlans = { connected: true, items: ITEMS, recurring_plans: PLANS };

// ── render with and without plans ───────────────────────────────────────────
test('a shop asks the catalogue for plans and draws each price with its interval and a Subscribe button', async () => {
	const sb = load({ catalog: withPlans });
	const root = await mountShop(sb, {});

	assert.equal(sb.calls[0].url, `${API}/api/v2/shop/catalog?guild_id=g1&include=recurring`);
	assert.deepEqual(planTexts(root), ['USD\u00a05.00 / month', 'USD\u00a013.00 / 3 months', 'USD\u00a090.00 / year']);
	assert.deepEqual(subscribeButtons(root).map((b) => b.textContent), ['Subscribe', 'Subscribe', 'Subscribe']);
	assert.equal(byClass(root, `${PREFIX}-plan`).length, 2, 'one card per plan');
	assert.equal(byClass(root, `${PREFIX}-card`).filter((c) => !c.classList.contains(`${PREFIX}-plan`)).length, 1, 'the item grid is still there');
});

test('a shop whose catalogue has no usable plans draws exactly its items: no plans block', async () => {
	for (const catalog of [
		{ connected: true, items: ITEMS, recurring_plans: [] },
		{ connected: true, items: ITEMS },
		{ connected: true, items: ITEMS, recurring_plans: [{ name: 'Broken', prices: [{ id: 'p', interval: 'fortnight', amount_minor: 1 }] }] }
	]) {
		const root = await mountShop(load({ catalog }), {});
		assert.equal(byClass(root, `${PREFIX}-plans`).length, 0);
		assert.equal(subscribeButtons(root).length, 0);
		assert.equal(byClass(root, `${PREFIX}-buy`).length, 1, 'the item Buy is untouched');
	}
});

test('a shop that sells only plans shows the plans and not the empty-shop line', async () => {
	const root = await mountShop(load({ catalog: { connected: true, items: [], recurring_plans: PLANS } }), {});
	assert.equal(subscribeButtons(root).length, 3);
	assert.equal(byClass(root, `${PREFIX}-empty`).length, 0);
});

test('the Subscribe label and the interval words follow the shopper\'s language, and the site may rename the button', async () => {
	const jpPlans = [{ product_id: 'p', name: 'X', prices: [
		{ id: 'a', amount_minor: 500, currency: 'JPY', display_price: 500, interval: 'month', interval_count: 1 },
		{ id: 'b', amount_minor: 1300, currency: 'JPY', display_price: 1300, interval: 'month', interval_count: 3 }] }];
	const ja = await mountShop(load({ catalog: { connected: true, items: ITEMS, recurring_plans: jpPlans } }), { 'data-locale': 'ja-JP' });
	assert.equal(subscribeButtons(ja)[0].textContent, '定期購入');
	assert.deepEqual(planTexts(ja), ['¥500 / 月', '¥1,300 / 3か月']);
	const tw = await mountShop(load({ catalog: withPlans }), { 'data-locale': 'zh-TW' });
	assert.equal(subscribeButtons(tw)[0].textContent, '訂閱');
	assert.deepEqual(planTexts(tw).slice(0, 2), ['USD\u00a05.00 / 月', 'USD\u00a013.00 / 3 個月']);
	const cn = await mountShop(load({ catalog: withPlans }), { 'data-locale': 'zh-CN' });
	assert.equal(subscribeButtons(cn)[0].textContent, '订阅');
	assert.deepEqual(planTexts(cn).slice(0, 2), ['USD\u00a05.00 / 月', 'USD\u00a013.00 / 3 个月']);
	const renamed = await mountShop(load({ catalog: withPlans }), { 'data-subscribe-label': 'Join' });
	assert.equal(subscribeButtons(renamed)[0].textContent, 'Join');
});

test('the interval is said for every unit and count in every language', () => {
	const { planIntervalText } = load({ catalog: {} });
	const units = ['day', 'week', 'month', 'year'];
	assert.deepEqual(units.map((u) => [planIntervalText(u, 1, 'en-US'), planIntervalText(u, 2, 'en-US')]),
		[['/ day', '/ 2 days'], ['/ week', '/ 2 weeks'], ['/ month', '/ 2 months'], ['/ year', '/ 2 years']]);
	assert.deepEqual(units.map((u) => planIntervalText(u, 2, 'ja')), ['/ 2日', '/ 2週間', '/ 2か月', '/ 2年']);
	assert.deepEqual(units.map((u) => planIntervalText(u, 2, 'zh-TW')), ['/ 2 天', '/ 2 週', '/ 2 個月', '/ 2 年']);
	assert.deepEqual(units.map((u) => planIntervalText(u, 1, 'zh-CN')), ['/ 天', '/ 周', '/ 月', '/ 年']);
	assert.equal(planIntervalText('fortnight', 1, 'en-US'), '');
});

// ── Subscribe posts the exact body and follows the redirect ─────────────────
test('Subscribe posts exactly {guild_id, price_id, client_request_ref, redirect_url} and follows the redirect', async () => {
	const sb = load({ catalog: withPlans });
	const root = await mountShop(sb, {});
	click(subscribeButtons(root)[1]);
	await flush();

	const post = sb.calls.filter((c) => c.method === 'POST');
	assert.equal(post.length, 1);
	assert.equal(post[0].url, SUBSCRIBE_URL);
	assert.deepEqual(Object.keys(post[0].body), ['guild_id', 'price_id', 'client_request_ref', 'redirect_url']);
	assert.equal(post[0].body.guild_id, 'g1');
	assert.equal(post[0].body.price_id, 'price_quarter');
	assert.match(post[0].body.client_request_ref, UUID_V4);
	assert.equal(post[0].body.redirect_url, `https://shop.example/shop/complete?ref=${encodeURIComponent(post[0].body.client_request_ref)}`);
	assert.equal(sb.window.location.href, PAY_URL, 'the shopper is sent to the payment page');
});

test('a site-keyed shop sends site_id and never an empty guild_id', async () => {
	const sb = load({ catalog: withPlans });
	const root = makeEl('div');
	root.setAttribute('data-site-id', 's1');
	root.setAttribute('data-api-base', API);
	await sb.mount(root); await flush();
	assert.equal(sb.calls[0].url, `${API}/api/v2/shop/catalog?site_id=s1&include=recurring`);
	click(subscribeButtons(root)[0]); await flush();
	const body = sb.calls.find((c) => c.method === 'POST').body;
	assert.deepEqual(Object.keys(body), ['site_id', 'price_id', 'client_request_ref', 'redirect_url']);
	assert.equal(body.site_id, 's1');
});

test('the body carries no money: no amount, currency, quantity, lines or items', async () => {
	const sb = load({ catalog: withPlans });
	const root = await mountShop(sb, {});
	for (const b of subscribeButtons(root)) { click(b); await flush(); }
	const posts = sb.calls.filter((x) => x.method === 'POST');
	assert.ok(posts.length >= 1);
	for (const c of posts) {
		for (const k of ['amount', 'amount_minor', 'amount_total', 'unit_amount', 'price_minor', 'total', 'currency', 'quantity', 'lines', 'items']) {
			assert.ok(!(k in c.body), `${k} must not be sent`);
		}
	}
});

test('a retried Subscribe replays the same client_request_ref; a different price gets its own', async () => {
	const sb = load({ catalog: withPlans, post: () => ({ status: 502, body: { error: 'x' } }) });
	const root = await mountShop(sb, {});
	const [month, quarter] = subscribeButtons(root);
	click(month); await flush(); click(month); await flush(); click(quarter); await flush();
	const posts = sb.calls.filter((c) => c.method === 'POST').map((c) => c.body);
	assert.equal(posts.length, 3);
	assert.equal(posts[0].client_request_ref, posts[1].client_request_ref);
	assert.notEqual(posts[2].client_request_ref, posts[0].client_request_ref);
});

test('a 409 drops the ref, so the next click mints a fresh one', async () => {
	const sb = load({ catalog: withPlans, post: () => ({ status: 409, body: { error: 'client_request_ref already in use' } }) });
	const root = await mountShop(sb, {});
	const [month] = subscribeButtons(root);
	click(month); await flush(); click(month); await flush();
	const posts = sb.calls.filter((c) => c.method === 'POST').map((c) => c.body);
	assert.notEqual(posts[0].client_request_ref, posts[1].client_request_ref);
});

// ── a refused Subscribe shows the existing checkout labels ──────────────────
test('a refused Subscribe says what a refused checkout says, and the button is usable again', async () => {
	const labels = load({ catalog: {} }).readLabels(makeEl('div'));
	const cases = [
		[400, labels.checkoutError], [403, labels.checkoutError], [404, labels.checkoutClosed],
		[409, labels.checkoutAgain], [429, labels.checkoutBusy], [502, labels.checkoutUnavailable], [500, labels.checkoutUnavailable]
	];
	for (const [status, expected] of cases) {
		const sb = load({ catalog: withPlans, post: () => ({ status, body: { error: 'machine words' } }) });
		const root = await mountShop(sb, {});
		const button = subscribeButtons(root)[0];
		click(button); await flush();
		const msg = byClass(button.parentElement, `${PREFIX}-msg`)[0];
		assert.ok(msg, `${status}: a message is shown`);
		assert.equal(msg.textContent, expected, String(status));
		assert.equal(msg.getAttribute('role'), 'alert');
		assert.equal(button.disabled, false, `${status}: the button is usable again`);
		assert.notEqual(sb.window.location.href, PAY_URL);
	}
});

test('a site that renamed a checkout label gets its own words on a refused Subscribe', async () => {
	const sb = load({ catalog: withPlans, post: () => ({ status: 429, body: {} }) });
	const root = await mountShop(sb, { 'data-checkout-busy-label': 'Slow down' });
	click(subscribeButtons(root)[0]); await flush();
	assert.equal(byClass(root, `${PREFIX}-msg`)[0].textContent, 'Slow down');
});

// ── the cart never holds a plan ─────────────────────────────────────────────
test('a plan is not an item: no variation id, no cart row, no cart request, and a paid return clears nothing', async () => {
	const stored = JSON.stringify([['V1', 2]]);
	const sb = load({ catalog: withPlans, store: { 'dc-square-shop-cart:g1': stored } });
	const root = await mountShop(sb, { 'data-cart': '1' });

	for (const card of byClass(root, `${PREFIX}-plan`)) assert.equal(card.getAttribute('data-variation-id'), null);
	sb.writes.length = 0;
	click(subscribeButtons(root)[0]); await flush();

	assert.equal(sb.calls.filter((c) => c.url === CART_URL).length, 0, 'Subscribe never goes through the cart');
	assert.equal(sb.state.store['dc-square-shop-cart:g1'], stored, 'the stored basket is untouched');
	assert.ok(!sb.writes.includes('dc-square-shop-cart:g1'), 'the basket is not even rewritten');
	const sold = sb.writes.filter((k) => k.startsWith('dc-square-shop-sold:'));
	assert.equal(sold.length, 1);
	const rec = JSON.parse(sb.state.store[sold[0]]);
	assert.deepEqual([rec.ids, rec.lines], [[], []], 'an empty sold record: the paid return takes nothing off the basket');
});

test('in cart mode the plans sit outside the cart layout', async () => {
	const sb = load({ catalog: withPlans });
	const root = await mountShop(sb, { 'data-cart': '1' });
	const layout = byClass(root, `${PREFIX}-layout`)[0];
	assert.ok(layout, 'the cart layout is there');
	assert.equal(byClass(layout, `${PREFIX}-plan`).length, 0, 'no plan inside the layout the cart reads');
	assert.equal(byClass(root, `${PREFIX}-plan`).length, 2);
});

// ── the edge-rendered grid ──────────────────────────────────────────────────
function ssrSetup(withPlanBlock) {
	return (root) => {
		const grid = makeEl('div');
		grid.className = `${PREFIX}-grid`;
		grid.setAttribute('data-ssr', '1');
		const card = makeEl('div');
		card.className = `${PREFIX}-card`;
		card.setAttribute('data-variation-id', 'V1');
		card.setAttribute('data-price', '5');
		card.setAttribute('data-currency', 'USD');
		const name = makeEl('p'); name.className = `${PREFIX}-name`; name.textContent = 'Tee';
		card.appendChild(name); grid.appendChild(card); root.appendChild(grid);
		if (withPlanBlock) {
			const block = makeEl('div');
			block.className = `${PREFIX}-grid ${PREFIX}-plans`;
			block.setAttribute('data-plans-ssr', JSON.stringify(PLANS));
			root.appendChild(block);
		}
	};
}

test('plans the edge already drew hydrate with no catalogue request', async () => {
	const sb = load({ catalog: { connected: true, items: ITEMS, recurring_plans: [] } });
	const root = await mountShop(sb, {}, ssrSetup(true));
	assert.equal(sb.calls.length, 0);
	assert.deepEqual(planTexts(root), ['USD\u00a05.00 / month', 'USD\u00a013.00 / 3 months', 'USD\u00a090.00 / year']);
	click(subscribeButtons(root)[0]); await flush();
	assert.equal(sb.calls[0].body.price_id, 'price_month');
});

test('an edge grid with no plans block makes no request and draws no plan', async () => {
	const sb = load({ catalog: withPlans });
	const root = await mountShop(sb, {}, ssrSetup(false));
	assert.equal(sb.calls.length, 0);
	assert.equal(subscribeButtons(root).length, 0);
	assert.equal(byClass(root, `${PREFIX}-card`).length, 1);
});

// ── a catalogue with no plans is drawn exactly as the coral before plans drew it ─────────────────
// The same fixture is mounted in the base coral and in this one; what the shopper would see (the whole
// tree, text, classes and attributes) and every request except the `include=recurring` the new
// coral appends to the catalogue read must be identical.
function serialize(el) {
	const attrs = Object.keys(el._attrs).sort().map((k) => `${k}=${el._attrs[k]}`).join(' ');
	return `<${el.tagName} class="${el.className}" ${attrs}>${el._html}${el.textContent}${el.children.map(serialize).join('')}</${el.tagName}>`;
}
const withoutInclude = (calls) => calls.map((c) => ({ ...c, url: c.url.replace('&include=recurring', '') }));

async function bothRender(catalog, attrs = {}, setup) {
	const base = load({ catalog, source: BASE_SOURCE });
	const next = load({ catalog });
	const a = await mountShop(base, attrs, setup);
	const b = await mountShop(next, attrs, setup);
	return { a, b, base, next };
}

const NO_PLAN_CATALOGS = {
	'a catalogue answer without recurring_plans (an older backend)': { connected: true, processor: 'stripe', items: ITEMS },
	'a Square shop': { connected: true, processor: 'square', items: ITEMS, recurring_plans: [] },
	'a Stripe shop with recurring_plans: []': { connected: true, processor: 'stripe', items: ITEMS, recurring_plans: [] }
};

for (const [name, catalog] of Object.entries(NO_PLAN_CATALOGS)) {
	for (const [mode, attrs] of [['instant buy', {}], ['cart', { 'data-cart': '1' }], ['cart with header', { 'data-cart': 'header' }]]) {
		test(`${name}: the new coral draws exactly what the coral before plans drew (${mode})`, async () => {
			const { a, b, base, next } = await bothRender(catalog, attrs);
			assert.ok(byClass(a, `${PREFIX}-card`).length > 0, 'the fixture really draws a shop');
			assert.equal(serialize(b), serialize(a));
			assert.deepEqual(withoutInclude(next.calls), withoutInclude(base.calls));
			assert.equal(subscribeButtons(b).length, 0);
			assert.equal(byClass(b, `${PREFIX}-plans`).length, 0);
			assert.equal(byClass(b, `${PREFIX}-error`).length, 0);
		});
	}
	test(`${name}: an edge-drawn grid is left exactly as the coral before plans left it`, async () => {
		const { a, b, next } = await bothRender(catalog, { 'data-cart': '1' }, ssrSetup(false));
		assert.equal(serialize(b), serialize(a));
		assert.equal(next.calls.length, 0);
	});
}

test('an empty or unconnected catalogue is also drawn exactly as before', async () => {
	for (const catalog of [{ connected: true, items: [], recurring_plans: [] }, { connected: false, items: [] }, { connected: true, items: [] }]) {
		const { a, b } = await bothRender(catalog);
		assert.equal(serialize(b), serialize(a));
	}
});

test('the request differs from the coral before plans in one thing only: include=recurring', async () => {
	const { base, next } = await bothRender({ connected: true, items: ITEMS });
	assert.equal(base.calls[0].url, `${API}/api/v2/shop/catalog?guild_id=g1`);
	assert.equal(next.calls[0].url, `${API}/api/v2/shop/catalog?guild_id=g1&include=recurring`);
});
