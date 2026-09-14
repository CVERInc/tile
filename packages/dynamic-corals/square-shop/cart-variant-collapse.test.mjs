// A cart that holds SIBLING VARIANTS must reach the till whole.
//
// Reported from a live shop (2026-09-14): a buyer put one hardcover zine and all FOUR designs
// of a four-variant art-print item into the basket. The header badge said 5; Square's hosted
// checkout page listed two lines — the zine and ONE print.
//
// The cause is that the grid's catalog index is keyed by each item's DEFAULT variation
// (`renderCart`'s `itemsById`), while the product detail page writes the variation the shopper
// actually PICKED into the same localStorage basket. Every sibling id is therefore unknown to
// the index, and `loadPersistedCart`'s ghost-reconcile drops it — silently, before any network
// call, so the POST body itself is already short.
//
// Fixture ids, titles and prices are the live ones from the reported shop's own public catalog
// (GET /api/v2/shop/catalog), so this suite fails for the same reason that buyer's cart did.
//
// square-shop.js is a browser script that self-mounts on load, so — exactly as
// ./cart-checkout-ref.test.mjs does — this suite runs the file's SOURCE as a function body with
// document/window/crypto/fetch injected. Nothing in the source is rewritten; the appended line
// only hands back the internals under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderShopGrid } from './product-page-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(
	/\nexport \{[\s\S]*?\n\};?\s*$/,
	'\n'
);

const PREFIX = 'dc-square-shop';
const GUILD = 'site_01KWXZH4PB613182EKKN0KSZSG';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;

// The two products of the report, as the live catalog answers them.
const ZINE_VID = 'GRHHYS7CI6I4WY2BKCPY6LRU';
const PRINT_A = 'T2BKDPOEAYH5HSJWA55F4GWP'; // the item's DEFAULT variation — the one that survived
const PRINT_B = 'C2GVEMM4UMNWNJBURDRXH6FM';
const PRINT_C = 'UBL7MUMSWZBGQLHUGUPNGXFO';
const PRINT_D = 'QYVJDKPZTC3K2H7R5LTQQCSQ';

const CATALOG = [
	{
		id: 'LZJ3DYLBZTTL36DWX4HCYRK7',
		slug: 'mbpa-zine-the-room',
		title: 'MBPA Zine - The Room',
		name: 'MBPA Zine - The Room',
		variation_id: ZINE_VID,
		price_minor: 2000,
		display_price: 20,
		currency: 'USD',
		image_url: 'https://items.example/zine.jpeg',
		variants: [
			{ id: ZINE_VID, title: 'Regular', price_minor: 2000, currency: 'USD', display_price: 20, available: true }
		]
	},
	{
		id: 'SAK5JY7IFRXCEXKROYAQERLJ',
		slug: 'mbpa-small-art-prints',
		title: 'MBPA - Small Art Prints',
		name: 'MBPA - Small Art Prints',
		variation_id: PRINT_A,
		price_minor: 500,
		display_price: 5,
		currency: 'USD',
		image_url: 'https://items.example/prints.jpeg',
		variants: [
			{ id: PRINT_A, title: 'A - Vincent', price_minor: 500, currency: 'USD', display_price: 5, available: true },
			{ id: PRINT_B, title: 'B - Eli', price_minor: 500, currency: 'USD', display_price: 5, available: true },
			{ id: PRINT_C, title: 'C - Eli & Vincent', price_minor: 500, currency: 'USD', display_price: 5, available: true },
			{ id: PRINT_D, title: 'D - Special Moments', price_minor: 500, currency: 'USD', display_price: 5, available: true }
		]
	}
];

// What the shopper's machine holds after one add on the zine page and four on the prints page
// (product-page-core.js writes `[variationId, qty]` pairs into this exact key).
const BUYERS_BASKET = JSON.stringify([
	[ZINE_VID, 1], [PRINT_A, 1], [PRINT_B, 1], [PRINT_C, 1], [PRINT_D, 1]
]);

// ── the smallest DOM this widget can run on (same shim shape as cart-checkout-ref.test.mjs) ──
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

function loadSquareShop({ storage = {} } = {}) {
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
	// Always fails, so the checkout lands on the honest-failure path — what this suite reads is
	// the REQUEST BODY, which is already written by then.
	const fetchImpl = async (url, init) => {
		fetchCalls.push({ url: String(url), body: JSON.parse(init.body) });
		return { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { renderCart, readLabels, withVariantSummary, itemsFromSsr };'
	);
	const api = factory(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	return { ...api, fetchCalls, store };
}

function mountCart(sb, items) {
	const root = makeEl('div');
	// mount() hands renderCart the catalog run through withVariantSummary; do the same.
	const prepared = items.map(sb.withVariantSummary);
	const labels = sb.readLabels(root);
	sb.renderCart(root, prepared, 'https://api.test', GUILD, labels, false, '/shop', new Map());
	return root;
}

const checkoutBtn = (root) => {
	const found = byClass(root, `${PREFIX}-checkout`);
	assert.equal(found.length, 1, 'expected exactly one Checkout button');
	return found[0];
};

test('a basket of four sibling variants reaches the till with all four lines', async () => {
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	const root = mountCart(sb, CATALOG);

	click(checkoutBtn(root), 'checkout'); await flush();

	assert.equal(sb.fetchCalls.length, 1, 'the click must reach the cart endpoint');
	const sent = sb.fetchCalls[0].body.items.map((l) => l.variation_id).sort();
	assert.deepEqual(
		sent,
		[ZINE_VID, PRINT_A, PRINT_B, PRINT_C, PRINT_D].sort(),
		'every variation the shopper chose must be on the wire — a basket that silently loses ' +
		'three of five lines charges for an order nobody placed'
	);
});

test('the cart panel shows one line per chosen variant, named by its variant', () => {
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	const root = mountCart(sb, CATALOG);

	const lines = byClass(root, `${PREFIX}-line`);
	assert.equal(lines.length, 5, 'the panel must show the five lines the badge counted');

	const names = byClass(root, `${PREFIX}-line-name`).map((n) => n.textContent);
	assert.ok(
		names.some((n) => n.includes('B - Eli')) && names.some((n) => n.includes('D - Special Moments')),
		`each sibling must be tellable apart in the basket; got ${JSON.stringify(names)}`
	);
});

test('a variant the seller has since removed is still dropped', async () => {
	// The reconcile exists for a real reason — a stale basket must not check out ghosts. Widening
	// it to sibling variants must not widen it to ids the live catalog no longer knows at all.
	const sb = loadSquareShop({
		storage: { [CART_KEY]: JSON.stringify([[ZINE_VID, 1], ['GONE_VARIATION_ID', 3]]) }
	});
	const root = mountCart(sb, CATALOG);
	click(checkoutBtn(root), 'checkout'); await flush();

	assert.deepEqual(
		sb.fetchCalls[0].body.items,
		[{ variation_id: ZINE_VID, quantity: 1 }],
		'an id absent from the live catalog is still a ghost'
	);
});

// ── the SSR path ─────────────────────────────────────────────────────────────
// The edge worker renders the grid server-side and the client hydrates from the cards' own
// data-* attributes with no re-fetch (square-shop.js#itemsFromSsr). That rebuilt catalog has to
// carry the sibling variants too, or the very same basket collapses on the very same page.
function ssrGridStub(html) {
	// Not a parser: pull each card's attributes out of the emitted markup and hand back node
	// stubs shaped the way itemsFromSsr reads them.
	const cards = html.split('<a class="dc-square-shop-card').slice(1)
		.concat(html.split('<div class="dc-square-shop-card').slice(1))
		.map((chunk) => chunk.slice(0, chunk.indexOf('>')));
	const attr = (chunk, k) => {
		const m = chunk.match(new RegExp(`${k}="([^"]*)"`));
		return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
	};
	return {
		querySelectorAll: () => cards.map((chunk) => ({
			getAttribute: (k) => attr(chunk, k),
			querySelector: () => null
		}))
	};
}

test('the SSR-hydrated grid carries the sibling variants too', async () => {
	const { gridHtml } = renderShopGrid(CATALOG, { cart: true, detailBase: '/shop', labels: {} });
	assert.ok(
		gridHtml.includes(PRINT_D),
		'the multi-variant card must embed every variation id it stands for'
	);

	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	const hydrated = sb.itemsFromSsr(ssrGridStub(gridHtml));
	assert.equal(hydrated.length, 2, 'both products hydrate');

	const root = makeEl('div');
	sb.renderCart(root, hydrated, 'https://api.test', GUILD, sb.readLabels(root), false, '/shop', new Map());
	click(checkoutBtn(root), 'checkout'); await flush();

	const sent = sb.fetchCalls[0].body.items.map((l) => l.variation_id).sort();
	assert.deepEqual(
		sent,
		[ZINE_VID, PRINT_A, PRINT_B, PRINT_C, PRINT_D].sort(),
		'the SSR page must hand the till the same five lines the fetched page does'
	);
});
