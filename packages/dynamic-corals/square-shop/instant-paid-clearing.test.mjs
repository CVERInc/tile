// A paid INSTANT order writes down what it sold — the other half of round-4's P2-2.
//
// Review round 4, P2-1. `startCartCheckout` calls `recordSoldLines` before handing the shopper
// to the payment page; `startCheckout` (the single-item Buy button) did not. A basket accumulated
// on the product detail page — whose Add button has no cart-mode gate, so it fills even on an
// instant-mode site — survived every payment EXCEPT the one the shopper actually completed: with
// no sold record, the completion page's `cartAfterOrder(cart, null)` returns `null`, and `null`
// there means `removeItem` the whole key (see ./cart-paid-clearing.test.mjs for that decision).
// One instant Buy deleted rows it never touched.
//
// This file is `./cart-paid-clearing.test.mjs`'s shape, run against `startCheckout` instead of
// `startCartCheckout`. `cartAfterOrder` itself is not retested here — it already has its own
// coverage — only that the instant path now feeds it a record to work with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartAfterOrder } from './shop-function-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(
	/\nexport \{[\s\S]*?\n\};?\s*$/,
	'\n'
);

const GUILD = 'g_instant_paid';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;
const A = 'VZ_A';
const B = 'VZ_B';
const C = 'VZINE';

function makeStorage(initial) {
	const map = new Map(Object.entries(initial || {}));
	return {
		map,
		ls: {
			get length() { return map.size; },
			key: (i) => [...map.keys()][i] ?? null,
			getItem: (k) => (map.has(k) ? map.get(k) : null),
			setItem: (k, v) => { map.set(k, String(v)); },
			removeItem: (k) => { map.delete(k); }
		}
	};
}

const fakeBtn = () => ({
	textContent: 'Buy', disabled: false, classList: { add() {}, remove() {} },
	setAttribute() {}, removeAttribute() {}, parentElement: null
});

function loadCoral(storage, { ok = true } = {}) {
	const store = makeStorage(storage);
	const posts = [];
	const document = { readyState: 'complete', head: {}, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {} };
	const window = {
		location: { href: 'https://shop.example/shop/product/zine', origin: 'https://shop.example', pathname: '/shop/product/zine' },
		localStorage: store.ls,
		dispatchEvent: () => true,
		addEventListener() {}
	};
	const fetchImpl = async (url, init) => {
		posts.push({ url: String(url), body: JSON.parse(init.body) });
		return ok
			? { ok: true, status: 200, json: async () => ({ url: 'https://squareup.example/checkout/xyz' }) }
			: { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { startCheckout };'
	);
	return { ...factory(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent), store, posts, window };
}

test('an instant buy that reaches the payment page writes down exactly what it sent', async () => {
	// Three Adds on the product page, byte for byte the round-4 repro: two rows, not three —
	// two clicks landed on A, one on B.
	const sb = loadCoral({ [CART_KEY]: JSON.stringify([[A, 2], [B, 1]]) });
	await sb.startCheckout('https://api.test', GUILD, C, fakeBtn(), new Map(), { checkoutPending: '…' }, undefined, '/shop');

	assert.equal(sb.posts.length, 1);
	assert.equal(sb.posts[0].body.variation_id, C);
	const ref = sb.posts[0].body.client_request_ref;
	assert.ok(ref, 'the POST names the attempt');
	assert.ok(sb.store.map.has('dc-square-shop-sold:' + ref),
		'startCheckout must record the sold line before redirecting — this is the fix, P2-1');
	const record = JSON.parse(sb.store.map.get('dc-square-shop-sold:' + ref));
	assert.deepEqual(record.ids, [C], 'only the id this attempt sent, same as the cart path');
	assert.ok(record.t > 0, 'stamped, so an abandoned attempt can be swept');
	assert.equal(sb.window.location.href, 'https://squareup.example/checkout/xyz');
});

test('paid completion after an instant buy keeps every row the order never touched', async () => {
	// C ships as its own row too (a shopper can Add the same item the Buy button later sells
	// instantly — nothing on the product page stops that), so this is the case that shows the
	// record actually being used, not just written.
	const sb = loadCoral({ [CART_KEY]: JSON.stringify([[A, 2], [B, 1], [C, 1]]) });
	await sb.startCheckout('https://api.test', GUILD, C, fakeBtn(), new Map(), {}, undefined, '/shop');

	const ref = sb.posts[0].body.client_request_ref;
	const kept = cartAfterOrder(sb.store.map.get(CART_KEY), sb.store.map.get('dc-square-shop-sold:' + ref));
	assert.deepEqual(kept, [[A, 2], [B, 1]],
		'the basket keeps A and B; only the instantly bought line (C) is gone');
});

test('an instant buy that never reaches a payment page writes nothing down', async () => {
	const sb = loadCoral({ [CART_KEY]: JSON.stringify([[A, 2], [B, 1]]) }, { ok: false });
	await sb.startCheckout('https://api.test', GUILD, C, fakeBtn(), new Map(), {}, undefined, '/shop');
	assert.deepEqual(
		[...sb.store.map.keys()].filter((k) => k.indexOf('dc-square-shop-sold:') === 0),
		[],
		'a failed attempt must not leave a record behind — nothing was sold'
	);
});
