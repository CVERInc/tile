// A paid completion takes the sold lines off the basket AS IT IS when the order lands — not an
// answer computed from an earlier look at it. (tile#40, PR #39 round-4 P3-3.)
//
// The basket is ONE localStorage key holding the whole array, and the completion page wrote its
// answer back over that whole key. Two writes could be lost that way:
//
//   1. A write that lands between the page's read and its write-back — another tab's add-to-cart.
//      The page's `setItem` carried an array computed without it.
//   2. An add of MORE of a line that is in the order, made in another tab while the shopper sat on
//      the hosted payment page. The sold record named ids only, so the page deleted the row — and
//      the later add inside it. The record is the earlier snapshot here: it was written when the
//      checkout left, and the row kept moving after that.
//
// Both tests below run the REAL emitted completion script (completionBody's <script>, the bytes a
// site's _worker.js serves), against a storage double — so they exercise the page, not a re-typed
// model of it. Both fail on the code before 0.11.19.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completionBody, COMPLETE_COPY, cartAfterOrder } from './shop-function-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORAL = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(/\nexport \{[\s\S]*?\n\};?\s*$/, '\n');

const GUILD = 'g_race';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;
const ZINE = 'VZINE';
const PA = 'VPRINTA';
const PB = 'VPRINTB';

function makeStorage(initial) {
	const map = new Map(Object.entries(initial || {}));
	const ls = {
		get length() { return map.size; },
		key: (i) => [...map.keys()][i] ?? null,
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => { map.set(k, String(v)); },
		removeItem: (k) => { map.delete(k); }
	};
	return { map, ls };
}

// Run the completion page's own script against `ls`, answered `paid`.
async function runCompletionPage(ls, ref) {
	const html = completionBody(COMPLETE_COPY['en-US'], 'en-US', '/api/out?ref=' + ref, '/shop', GUILD, true, ref);
	const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
	const el = () => ({ textContent: '', innerHTML: '' });
	const nodes = { 'dc-shop-outcome': el(), 'dc-shop-heading': el() };
	const document = { getElementById: (id) => nodes[id], createElement: () => ({ textContent: '', innerHTML: '' }), title: '' };
	const events = [];
	const window = { dispatchEvent: (e) => { events.push(e.type); return true; } };
	const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, state: 'paid', lines: [], total_minor: 0, currency: 'USD' }) });
	new Function('document', 'window', 'localStorage', 'fetch', 'CustomEvent', 'setTimeout', script)(
		document, window, ls, fetchImpl, globalThis.CustomEvent, () => {});
	for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
	return { nodes, events };
}

// The coral half, driven for real: a cart checkout that reaches the payment page.
async function checkoutFrom(store, cart) {
	const posts = [];
	const document = { readyState: 'complete', head: {}, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {} };
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		localStorage: store.ls, dispatchEvent: () => true, addEventListener() {}
	};
	const fetchImpl = async (url, init) => {
		posts.push(JSON.parse(init.body));
		return { ok: true, status: 200, json: async () => ({ url: 'https://pay.example/checkout/abc' }) };
	};
	const api = new Function('document', 'window', 'crypto', 'fetch', 'CustomEvent', CORAL + '\nreturn { startCartCheckout };')(
		document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	const btn = { textContent: 'Checkout', disabled: false, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, parentElement: null };
	await api.startCartCheckout('https://api.test', GUILD, cart, false, btn, {}, new Map(), '');
	assert.equal(posts.length, 1, 'the checkout reached the payment page');
	return posts[0].client_request_ref;
}

test('a write another tab lands between the page\'s read and its write-back survives', async () => {
	const ref = 'r-interleave';
	const store = makeStorage({
		[CART_KEY]: JSON.stringify([[ZINE, 2], [PA, 3]]),
		['dc-square-shop-sold:' + ref]: JSON.stringify({ t: Date.now(), ids: [ZINE] })
	});
	// The first time the page reads the basket, a second tab adds PB right after the read returns.
	const realGet = store.ls.getItem;
	let armed = true;
	store.ls.getItem = (k) => {
		const v = realGet(k);
		if (armed && k === CART_KEY) {
			armed = false;
			store.map.set(CART_KEY, JSON.stringify([[ZINE, 2], [PA, 3], [PB, 1]]));
		}
		return v;
	};

	const { events } = await runCompletionPage(store.ls, ref);

	assert.ok(!armed, 'the interleaved write actually fired (the probe ran)');
	assert.deepEqual(JSON.parse(store.map.get(CART_KEY)), [[PA, 3], [PB, 1]],
		'the zine that was sold goes; the print added in the other tab after the read must not be overwritten');
	assert.ok(!store.map.has('dc-square-shop-sold:' + ref), 'the record is consumed');
	assert.ok(events.includes('dc-cart-changed'));
});

test('two tabs: more of a sold line added while the shopper is on the payment page is kept', async () => {
	// Tab A checks out 2 zines and a print. The record is written as the shopper leaves for the
	// hosted checkout.
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[ZINE, 2], [PA, 1]]) });
	const ref = await checkoutFrom(store, new Map([[ZINE, 2], [PA, 1]]));

	// Tab B, still open on the shop, adds one more zine and a different print meanwhile.
	store.map.set(CART_KEY, JSON.stringify([[ZINE, 3], [PA, 1], [PB, 1]]));

	// The order lands paid; the completion page runs.
	await runCompletionPage(store.ls, ref);

	assert.deepEqual(JSON.parse(store.map.get(CART_KEY)), [[ZINE, 1], [PB, 1]],
		'the order carried 2 zines and 1 print A — the third zine and print B were added after it left, and are still the shopper\'s');
});

test('the same two tabs with nothing added in between empty the basket, as before', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[ZINE, 2], [PA, 1]]) });
	const ref = await checkoutFrom(store, new Map([[ZINE, 2], [PA, 1]]));
	await runCompletionPage(store.ls, ref);
	assert.equal(store.map.has(CART_KEY), false, 'an order that carried the whole basket leaves no key');
});

test('a held row the order never carried is still kept (the 0.11.16 guarantee)', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[ZINE, 2], [PA, 3]]) });
	const ref = await checkoutFrom(store, new Map([[ZINE, 2]]));
	await runCompletionPage(store.ls, ref);
	assert.deepEqual(JSON.parse(store.map.get(CART_KEY)), [[PA, 3]]);
});

test('a record from a 0.11.16–0.11.18 coral (ids only) still drops the row whole', () => {
	assert.deepEqual(cartAfterOrder(JSON.stringify([[ZINE, 3], [PA, 1]]), JSON.stringify({ t: 1, ids: [ZINE] })), [[PA, 1]]);
});

test('a malformed `lines` falls back to the ids reading, never to a partial subtraction', () => {
	const cart = JSON.stringify([[ZINE, 3], [PA, 1]]);
	assert.deepEqual(cartAfterOrder(cart, JSON.stringify({ ids: [ZINE], lines: [[ZINE, 'x']] })), [[PA, 1]]);
	assert.deepEqual(cartAfterOrder(cart, JSON.stringify({ ids: [ZINE], lines: [['', 2]] })), [[PA, 1]]);
	assert.deepEqual(cartAfterOrder(cart, JSON.stringify({ ids: [ZINE], lines: [[ZINE, 2]] })), [[ZINE, 1], [PA, 1]]);
});

test('no record still clears the whole key — an older coral writes none', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[ZINE, 1], [PA, 2]]) });
	await runCompletionPage(store.ls, 'r-no-record');
	assert.equal(store.map.has(CART_KEY), false);
});
