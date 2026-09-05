// Behavioural test of the cart's `client_request_ref` policy in square-shop.js —
// the one value on the cart-checkout call that decides whether a retry replays the
// SAME Square payment link or mints a second one.
//
// square-shop.js is a browser script with no exports (it self-mounts on load), so
// this suite runs the file's SOURCE as a function body with document/window/crypto/
// fetch injected as parameters. Nothing in the source is rewritten and no global is
// touched; the appended line only hands back the internals under test.
//
// The DOM stub does NOT parse HTML. It does not need to: every node the ref policy
// travels through (the Add button, the ± steppers, the Checkout button and their
// click listeners) is built programmatically, and `querySelector` hands back a real
// stub child so a button appended into an innerHTML-built card still lands in the
// tree this test walks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The coral grew a named-export block upstream (square-shop.js, `export { mount, … }`), and an
// `export` statement is illegal inside the function body this suite builds below. Dropped from
// the SOURCE string only — the file on disk keeps its exports, and every function this suite
// drives is defined above that block.
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(
	/\nexport \{[\s\S]*?\n\};?\s*$/,
	'\n'
);

const PREFIX = 'dc-square-shop';
const CART_KEY = 'dc-square-shop-cart:g1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ITEMS = [{ variation_id: 'V1', name: 'Apron Set', display_price: 40, currency: 'USD', variant_count: 1 }];

// ── the smallest DOM this widget can run on ────────────────────────────────
function makeEl(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		children: [],
		className: '',
		textContent: '',
		disabled: false,
		type: '',
		href: '',
		_attrs: Object.create(null),
		_listeners: Object.create(null),
		_qs: new Map(),
		_html: '',
		// parentElement is set on the way in, because the coral reads it: the refusal is
		// shown on `btn.parentElement`, so a shim without it silently swallows the message.
		appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
		append(...cs) { for (const c of cs) { c.parentElement = el; el.children.push(c); } },
		setAttribute(k, v) { el._attrs[k] = String(v); },
		getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
		addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
		removeAttribute(k) { delete el._attrs[k]; },
		// Not a selector engine: the first ask for a selector mints a stub child and
		// remembers it, so `card.querySelector('.…-body').appendChild(btn)` keeps the
		// button reachable from the root.
		querySelector(sel) {
			if (!el._qs.has(sel)) {
				const child = makeEl('div');
				child.className = String(sel).replace(/^\./, '');
				child.parentElement = el;
				el.children.push(child);
				el._qs.set(sel, child);
			}
			return el._qs.get(sel);
		},
		querySelectorAll() { return []; }
	};
	// className and classList are two views of ONE string in a real DOM, so byClass() below
	// keeps finding a button the pending state has added a class to.
	el.classList = {
		add(c) {
			const s = String(el.className).split(/\s+/).filter(Boolean);
			if (s.indexOf(c) < 0) s.push(c);
			el.className = s.join(' ');
		},
		remove(c) {
			el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' ');
		},
		contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; }
	};
	Object.defineProperty(el, 'innerHTML', {
		get() { return el._html; },
		set(v) { el._html = String(v); el.children = []; el._qs = new Map(); }
	});
	return el;
}

function walk(el, out = []) {
	out.push(el);
	for (const c of el.children) walk(c, out);
	return out;
}

function byClass(root, cls) {
	return walk(root).filter((e) => String(e.className).split(/\s+/).includes(cls));
}

function byText(root, text) {
	return walk(root).filter((e) => e.textContent === text);
}

// A browser swallows a listener that throws — the button just goes dead. Here a throw
// is surfaced, because "the click died before the handler body ran" is the failure
// this suite exists to catch.
function click(el, what) {
	for (const fn of el._listeners.click || []) {
		try {
			fn();
		} catch (e) {
			assert.fail(`${what} threw before doing anything: ${e && e.message}`);
		}
	}
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function loadSquareShop({ randomUUID = true, storage = {} } = {}) {
	const store = new Map(Object.entries(storage));
	const fetchCalls = [];
	const document = {
		readyState: 'complete',
		head: makeEl('head'),
		body: makeEl('body'),
		createElement: (t) => makeEl(t),
		querySelectorAll: () => [],
		addEventListener: () => {}
	};
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		history: { replaceState() {} },
		localStorage: {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => { store.set(k, String(v)); },
			removeItem: (k) => { store.delete(k); }
		},
		dispatchEvent: () => true
	};
	// randomUUID:false is the http:// page / old WebView — `crypto` is there,
	// `crypto.randomUUID` (secure-context-gated) is not.
	const cryptoObj = randomUUID
		? globalThis.crypto
		: { getRandomValues: (b) => globalThis.crypto.getRandomValues(b) };
	// Always fails, so every checkout lands on the honest-failure path and the button
	// stays clickable — which is exactly the retry the ref policy is about.
	const fetchImpl = async (url, init) => {
		fetchCalls.push({ url: String(url), body: JSON.parse(init.body) });
		return { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { renderCart, readLabels };'
	);
	const api = factory(document, window, cryptoObj, fetchImpl, globalThis.CustomEvent);
	return { ...api, fetchCalls, store };
}

function mountCart(sb) {
	const root = makeEl('div');
	const labels = sb.readLabels(root);
	// The per-mount ref map the coral keeps for the real embed, handed in here for the same
	// reason: it is what makes a retry reuse ONE ref, which is the whole subject of this file.
	const checkoutRefs = new Map();
	sb.renderCart(root, ITEMS, 'https://api.test', 'g1', labels, false, '', checkoutRefs);
	return { root, labels, checkoutRefs };
}

const checkoutBtn = (root) => {
	const found = byClass(root, `${PREFIX}-checkout`);
	assert.equal(found.length, 1, 'expected exactly one Checkout button');
	return found[0];
};

test('a retry with the cart untouched reuses the same client_request_ref', async () => {
	const sb = loadSquareShop();
	const { root } = mountCart(sb);

	const add = byClass(root, `${PREFIX}-buy`);
	assert.equal(add.length, 1, 'expected one Add button on an empty cart');
	click(add[0], 'add');

	const checkout = checkoutBtn(root);
	click(checkout, 'checkout'); await flush();
	click(checkout, 'checkout retry'); await flush(); // same button, cart untouched

	assert.equal(sb.fetchCalls.length, 2, 'both clicks must reach the cart endpoint');
	const [first, second] = sb.fetchCalls;
	assert.match(first.body.client_request_ref, UUID_V4);
	assert.equal(
		second.body.client_request_ref,
		first.body.client_request_ref,
		'a retry of the same cart must replay one payment link, not mint a second'
	);
});

test('changing a quantity mints a new client_request_ref', async () => {
	const sb = loadSquareShop();
	const { root } = mountCart(sb);
	click(byClass(root, `${PREFIX}-buy`)[0], 'add');
	click(checkoutBtn(root), 'checkout'); await flush();

	const plus = byText(root, '+');
	assert.ok(plus.length > 0, 'expected a + stepper once the item is in the cart');
	click(plus[0], 'plus'); // 1 → 2
	click(checkoutBtn(root), 'checkout after change'); await flush();

	assert.equal(sb.fetchCalls.length, 2);
	const [first, second] = sb.fetchCalls;
	assert.deepEqual(first.body.items, [{ variation_id: 'V1', quantity: 1 }]);
	assert.deepEqual(second.body.items, [{ variation_id: 'V1', quantity: 2 }]);
	assert.match(second.body.client_request_ref, UUID_V4);
	assert.notEqual(
		second.body.client_request_ref,
		first.body.client_request_ref,
		'a different cart must not collide with the earlier ref'
	);
});

test('a quantity write that changes nothing (q === previous) keeps the ref', async () => {
	// 99 is the cart's clamp ceiling, so + there is a real user action that runs
	// setQty with q === previous — the case the guard exists for.
	const sb = loadSquareShop({ storage: { [CART_KEY]: JSON.stringify([['V1', 99]]) } });
	const { root } = mountCart(sb);
	click(checkoutBtn(root), 'checkout'); await flush();

	const plus = byText(root, '+');
	assert.ok(plus.length > 0, 'expected a + stepper for the hydrated cart');
	click(plus[0], 'plus at the ceiling'); // 99 → clamped back to 99
	click(checkoutBtn(root), 'checkout after the no-op'); await flush();

	assert.equal(sb.fetchCalls.length, 2);
	const [first, second] = sb.fetchCalls;
	assert.deepEqual(first.body.items, [{ variation_id: 'V1', quantity: 99 }]);
	assert.deepEqual(second.body.items, [{ variation_id: 'V1', quantity: 99 }], 'the clamp must have held');
	assert.equal(
		second.body.client_request_ref,
		first.body.client_request_ref,
		'nothing changed, so this is still the same buy-intent'
	);
});

test('without crypto.randomUUID the Checkout button still works and the ref is UUIDv4-shaped', async () => {
	const sb = loadSquareShop({ randomUUID: false });
	const { root, labels } = mountCart(sb);
	click(byClass(root, `${PREFIX}-buy`)[0], 'add');

	const checkout = checkoutBtn(root);
	// The ref is an ARGUMENT to the checkout call: a throw here kills the click before
	// the handler can disable the button or show its error label — a dead button.
	click(checkout, 'checkout on a page without crypto.randomUUID'); await flush();

	assert.equal(sb.fetchCalls.length, 1, 'the click must reach the network');
	assert.match(sb.fetchCalls[0].body.client_request_ref, UUID_V4);
	assert.equal(checkout.disabled, false, 'the button is usable again after the failure');
	// The refusal is written into the `-msg` node beside the button, not into the button
	// itself — a payment button that keeps its own words is the readable half of a failure.
	// A 500 is the "not responding" sentence, not the generic one.
	const msg = byClass(root, `${PREFIX}-msg`)[0];
	assert.ok(msg, 'the refusal has somewhere to be said');
	assert.equal(msg.textContent, labels.checkoutUnavailable, 'honest failure still reaches the shopper');
	assert.equal(checkout.textContent, 'Checkout', 'the button keeps its own words');
});
