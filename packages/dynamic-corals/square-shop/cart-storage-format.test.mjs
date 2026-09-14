// The BYTES under `dc-square-shop-cart:<store>` — one shape, and what reads them.
//
// 0.11.15 invented a second on-disk shape, `[id, 0, qty]`, to mark a row the catalog in hand did
// not confirm. It looked like a marking and behaved like a fork in the format, because three
// different writers share this key and only one of them was taught the new shape:
//
//   • square-shop.js          (the coral)                  — taught it
//   • product-page-core.js    (the detail page's Add)      — NOT taught it: it added 1 to the `0`,
//                                                            wrote `[id, 1, qty]`, and the shopper's
//                                                            3 reached the till as 1
//   • shop-function-template.js (the paid completion page) — NOT taught it: it deleted the whole key
//
// So the shape is gone again and "held" is derived per page load. What this file asserts is the
// property that replaces it: ONE shape on disk, every older reader can still read it, and a basket
// that met 0.11.15 keeps its quantity on the way back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProductPage } from './product-page-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(
	/\nexport \{[\s\S]*?\n\};?\s*$/,
	'\n'
);

const GUILD = 'g_storage';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;
const ZINE = 'VZINE';
const PA = 'VPRINTA';
const PB = 'VPRINTB';

const CATALOG = [
	{
		id: 'I1', slug: 'zine', title: 'Zine', name: 'Zine', variation_id: ZINE,
		price_minor: 2000, display_price: 20, currency: 'USD',
		variants: [{ id: ZINE, title: 'Regular', price_minor: 2000, currency: 'USD', display_price: 20, available: true }]
	},
	{
		id: 'I2', slug: 'prints', title: 'Prints', name: 'Prints', variation_id: PA,
		price_minor: 500, display_price: 5, currency: 'USD',
		variants: [
			{ id: PA, title: 'A', price_minor: 500, currency: 'USD', display_price: 5, available: true },
			{ id: PB, title: 'B', price_minor: 500, currency: 'USD', display_price: 5, available: true }
		]
	}
];
const TRUNCATED = [CATALOG[0]]; // page 1 of 2 — the prints item did not arrive

// ── the smallest DOM the coral runs on (same shim shape as ./cart-variant-collapse.test.mjs) ──
function makeEl(tag) {
	const el = {
		tagName: String(tag).toUpperCase(), children: [], className: '', textContent: '',
		disabled: false, type: '', href: '',
		_attrs: Object.create(null), _listeners: Object.create(null), _qs: new Map(), _html: '',
		appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
		append(...cs) { for (const c of cs) { c.parentElement = el; el.children.push(c); } },
		setAttribute(k, v) { el._attrs[k] = String(v); },
		getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
		addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
		removeAttribute(k) { delete el._attrs[k]; },
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
	el.classList = {
		add(c) { const s = String(el.className).split(/\s+/).filter(Boolean); if (s.indexOf(c) < 0) s.push(c); el.className = s.join(' '); },
		remove(c) { el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
		contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; }
	};
	Object.defineProperty(el, 'innerHTML', {
		get() { return el._html; },
		set(v) { el._html = String(v); el.children = []; el._qs = new Map(); }
	});
	return el;
}

function loadSquareShop(storage) {
	const store = new Map(Object.entries(storage || {}));
	const writes = [];
	const document = {
		createElement: makeEl,
		querySelector: () => null,
		querySelectorAll: () => [],
		head: makeEl('head'),
		addEventListener() {},
		readyState: 'complete'
	};
	const window = {
		localStorage: {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => { writes.push([k, v]); store.set(k, String(v)); },
			removeItem: (k) => { store.delete(k); }
		},
		location: { href: 'https://shop.example/shop', pathname: '/shop' },
		dispatchEvent() {},
		addEventListener() {},
		matchMedia: () => ({ matches: false, addEventListener() {} })
	};
	const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { renderCart, readLabels, withVariantSummary };'
	);
	const api = factory(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	return { ...api, store, writes };
}

function mountCart(sb, items) {
	const root = makeEl('div');
	root.setAttribute('data-dynamic-coral', 'square-shop');
	const prepared = items.map(sb.withVariantSummary);
	sb.renderCart(root, prepared, 'https://api.test', GUILD, sb.readLabels(root), false, '/shop', new Map());
	return root;
}

const rows = (sb) => JSON.parse(sb.store.get(CART_KEY) || '[]');

// ── one shape on disk ────────────────────────────────────────────────────────

test('a held row is written with TWO elements, exactly like a sellable one', () => {
	const sb = loadSquareShop({ [CART_KEY]: JSON.stringify([[ZINE, 1], [PA, 3], [PB, 2]]) });
	const root = mountCart(sb, TRUNCATED);

	assert.deepEqual(rows(sb), [[ZINE, 1], [PA, 3], [PB, 2]],
		'the catalog could not vouch for two of the three rows, and the bytes on the shopper’s ' +
		'own machine must not record that opinion — same ids, same quantities, same shape');
	assert.equal(sb.writes.length, 0,
		'and nothing was written at all: with held derived, there is no re-encoding to do');
	assert.deepEqual(JSON.parse(root.getAttribute('data-cart-held')), [PA, PB],
		'the derived answer is published on the mount instead, for the header badge to read');
});

test('the confirmed rows are the only ones the panel can sell, with the stored quantity', () => {
	const sb = loadSquareShop({ [CART_KEY]: JSON.stringify([[ZINE, 4], [PA, 3]]) });
	const root = mountCart(sb, TRUNCATED);
	const held = JSON.parse(root.getAttribute('data-cart-held'));
	assert.deepEqual(held, [PA]);
	assert.deepEqual(rows(sb), [[ZINE, 4], [PA, 3]], 'the held row keeps its 3 on disk');
});

test('a whole catalog publishes an EMPTY held set, so the badge counts every row', () => {
	const sb = loadSquareShop({ [CART_KEY]: JSON.stringify([[ZINE, 1], [PA, 2], [PB, 1]]) });
	const root = mountCart(sb, CATALOG);
	assert.equal(root.getAttribute('data-cart-held'), '[]');
	assert.equal(sb.writes.length, 0);
});

// ── the 0.11.15 basket, on the way back ──────────────────────────────────────

test('a basket written by 0.11.15 keeps its quantity and is rewritten as two elements, ONCE', () => {
	// Exactly what 0.11.15 left on disk under a truncated catalog.
	const bytes = JSON.stringify([[ZINE, 2], [PA, 0, 3], [PB, 0, 1]]);
	const sb = loadSquareShop({ [CART_KEY]: bytes });
	mountCart(sb, CATALOG); // the catalog is whole this time — every row is sellable again

	assert.deepEqual(rows(sb), [[ZINE, 2], [PA, 3], [PB, 1]],
		'the 3 and the 1 were in slot 2 and must come back as the quantity — read as slot 1, ' +
		'this basket reaches the till as 1 of each');
	assert.equal(sb.writes.length, 1, 'rewritten exactly once');

	// …and the next load has nothing left to do.
	const again = loadSquareShop({ [CART_KEY]: sb.store.get(CART_KEY) });
	mountCart(again, CATALOG);
	assert.equal(again.writes.length, 0, 'one-time: the migrated basket is not rewritten again');
});

test('a 0.11.15 basket whose row is STILL held keeps the quantity too', () => {
	const sb = loadSquareShop({ [CART_KEY]: JSON.stringify([[ZINE, 2], [PA, 0, 3]]) });
	const root = mountCart(sb, TRUNCATED);
	assert.deepEqual(rows(sb), [[ZINE, 2], [PA, 3]]);
	assert.deepEqual(JSON.parse(root.getAttribute('data-cart-held')), [PA]);
});

// ── the product page's Add button, which is the other writer ─────────────────
//
// The handler ships AS TEXT inside the built page, so it is LIFTED from the emitted script rather
// than retyped here: what runs below is the shipped source, character for character.
function liftAddHandler() {
	const html = renderProductPage(
		{ id: 'I2', slug: 'prints', title: 'Prints', variation_id: PA, price_minor: 500, currency: 'USD', display_price: 5 },
		{ guildId: GUILD, apiBase: 'https://api', shopPath: '/shop' }
	).bodyHtml;
	const qty = /\n\tfunction cartRowQty\(e\) \{.*\n/.exec(html);
	assert.ok(qty, 'cartRowQty is no longer in the emitted script — this probe is stale');
	const add = /\n\t\tif \(found\) \{ const cur = cartRowQty\(found\);.*\n/.exec(html);
	assert.ok(add, 'the Add write is no longer in the emitted script — this probe is stale');
	return new Function('cart', 'v', `${qty[0]}\nconst found = cart.find((e) => Array.isArray(e) && e[0] === v.id);\n${add[0]}\nreturn cart;`);
}

test('Add on a held row is an ordinary +1: 3 becomes 4', () => {
	const addOne = liftAddHandler();
	// The disk state of a shopper who has 3 of a variation the shop is not listing today.
	const cart = addOne([[ZINE, 1], [PA, 3]], { id: PA });
	assert.deepEqual(cart, [[ZINE, 1], [PA, 4]],
		'a shopper who has 3 and adds one has 4 — the state of the catalog is not this button’s ' +
		'business, and 0.11.15 answered 1 here');

	// And the coral agrees, because there is nothing special about the row.
	const sb = loadSquareShop({ [CART_KEY]: JSON.stringify(cart) });
	mountCart(sb, CATALOG);
	assert.deepEqual(rows(sb), [[ZINE, 1], [PA, 4]]);
});

test('Add on a 0.11.15 three-element row lands on the canonical shape, quantity intact', () => {
	const addOne = liftAddHandler();
	assert.deepEqual(addOne([[ZINE, 1], [PA, 0, 3]], { id: PA }), [[ZINE, 1], [PA, 4]]);
	// …including the shape 0.11.15's own Add produced, which no reader could make sense of.
	assert.deepEqual(addOne([[ZINE, 1], [PA, 1, 3]], { id: PA }), [[ZINE, 1], [PA, 4]]);
});

test('Add on a variation that is not in the basket still starts at 1', () => {
	const addOne = liftAddHandler();
	assert.deepEqual(addOne([[ZINE, 1]], { id: PA }), [[ZINE, 1], [PA, 1]]);
});
