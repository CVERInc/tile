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

function loadSquareShop({ storage = {}, catalog = null } = {}) {
	const store = new Map(Object.entries(storage));
	const fetchCalls = [];
	// Catalog READS are counted apart from checkout POSTs, because "did this page re-fetch?" is
	// itself an assertion here (the SSR fast path exists to avoid exactly one request) and folding
	// the two into one list would make every POST assertion below depend on whether a GET happened.
	const catalogCalls = [];
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
	// The checkout POST always fails, so it lands on the honest-failure path — what this suite
	// reads is the REQUEST BODY, which is already written by then. A catalog GET is answered with
	// `catalog` when the test supplied one (mount()'s fall-through path needs a real answer).
	const fetchImpl = async (url, init) => {
		const href = String(url);
		if (!init || !init.body) {
			catalogCalls.push(href);
			if (!catalog) throw new Error('this test did not expect a catalog fetch');
			return { ok: true, status: 200, json: async () => ({ connected: true, items: catalog }) };
		}
		fetchCalls.push({ url: href, body: JSON.parse(init.body) });
		return { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { mount, renderCart, readLabels, withVariantSummary, itemsFromSsr };'
	);
	const api = factory(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	return { ...api, fetchCalls, catalogCalls, store };
}

// A mount HOST, i.e. the `<div data-dynamic-coral="square-shop">` on the page. It differs from
// makeEl in one way that decides these tests: makeEl's querySelector INVENTS the node it is asked
// for, so a host built with it would report an SSR grid on every page and mount would never take
// the fetch path at all. This one answers by actually looking.
function makeHost(attrs, ssrGrid) {
	const el = makeEl('div');
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	const generic = el.querySelector;
	el.querySelector = (sel) => (sel === `.${PREFIX}-grid[data-ssr]` ? (ssrGrid || null) : generic(sel));
	return el;
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

// ── the two artifacts, out of step ───────────────────────────────────────────
// `data-variants` is written by product-page-core.js#renderShopGrid, which reaches a live shop
// inside that site's own `dist/_worker.js` (emit-shop-function.mjs, at SITE BUILD time) — NOT
// inside this coral. Publishing the coral rebuilds no worker and no version links the two, so the
// state below is not hypothetical: it is what every shop looks like between the first deploy and
// the second. Reviewed 2026-09-14 as P1-1 — "publish the coral and the reported basket is still
// short" — and the mechanism that closes it is square-shop.js#ssrCatalogMissesSiblings.
function oldWorkerGrid(gridHtml) {
	// Exactly the same render with `data-variants` taken back out, which is what the previous
	// worker emitted, character for character.
	const stripped = gridHtml.replace(/ data-variants="[^"]*"/g, '');
	assert.ok(stripped !== gridHtml, 'the fixture must actually lose the attribute it is about');
	assert.ok(!stripped.includes(PRINT_D), 'an old card names no sibling variation');
	return stripped;
}

function mountHost(sb, { ssr, cart = '1' }) {
	const host = makeHost({
		'data-guild-id': GUILD,
		'data-api-base': 'https://api.test',
		'data-cart': cart,
		'data-detail-base': '/shop'
	}, ssr ? ssrGridStub(ssr) : null);
	return host;
}

test('an SSR grid from an OLD worker is not trusted: mount fetches, and the basket is whole', async () => {
	const { gridHtml } = renderShopGrid(CATALOG, { cart: true, detailBase: '/shop', labels: {} });
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET }, catalog: CATALOG });
	const host = mountHost(sb, { ssr: oldWorkerGrid(gridHtml) });

	await sb.mount(host);
	click(checkoutBtn(host), 'checkout'); await flush();

	assert.equal(sb.catalogCalls.length, 1,
		'a card that stands for 4 variations and names none of them describes an INCOMPLETE ' +
		'catalog — hydrating from it is what deleted the shopper lines in the first place');
	const sent = sb.fetchCalls[0].body.items.map((l) => l.variation_id).sort();
	assert.deepEqual(
		sent,
		[ZINE_VID, PRINT_A, PRINT_B, PRINT_C, PRINT_D].sort(),
		'with only the CORAL deployed and the site worker still old, the till must still get five lines'
	);
});

test('an SSR grid from a NEW worker still hydrates with no fetch at all', async () => {
	const { gridHtml } = renderShopGrid(CATALOG, { cart: true, detailBase: '/shop', labels: {} });
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	const host = mountHost(sb, { ssr: gridHtml });

	await sb.mount(host);
	click(checkoutBtn(host), 'checkout'); await flush();

	assert.equal(sb.catalogCalls.length, 0,
		'the SSR fast path exists to save exactly this request; a complete set must still take it');
	const sent = sb.fetchCalls[0].body.items.map((l) => l.variation_id).sort();
	assert.deepEqual(sent, [ZINE_VID, PRINT_A, PRINT_B, PRINT_C, PRINT_D].sort());
});

test('a single-variation SSR card hydrates without a fetch, old worker or new', async () => {
	// The control for the arm above: the fall-through is keyed on a card that CLAIMS siblings and
	// names none, not on the attribute being absent. A one-variation shop never emitted it and must
	// not start paying for a request because of this change.
	const single = [CATALOG[0]];
	const { gridHtml } = renderShopGrid(single, { cart: true, detailBase: '/shop', labels: {} });
	assert.ok(!gridHtml.includes('data-variants='), 'a single-variation card names no siblings');

	const sb = loadSquareShop({ storage: { [CART_KEY]: JSON.stringify([[ZINE_VID, 2]]) } });
	const host = mountHost(sb, { ssr: gridHtml });

	await sb.mount(host);
	click(checkoutBtn(host), 'checkout'); await flush();

	assert.equal(sb.catalogCalls.length, 0, 'no sibling claim, no reason to re-fetch');
	assert.deepEqual(sb.fetchCalls[0].body.items, [{ variation_id: ZINE_VID, quantity: 2 }]);
});

test('instant mode keeps the old cards: no basket is held against them, so no extra request', async () => {
	const { gridHtml } = renderShopGrid(CATALOG, { cart: false, detailBase: '/shop', labels: {} });
	const sb = loadSquareShop({ storage: {} });
	const host = mountHost(sb, { ssr: oldWorkerGrid(gridHtml), cart: '0' });

	await sb.mount(host);

	assert.equal(sb.catalogCalls.length, 0,
		'instant mode holds no localStorage line against this catalog — a missing sibling list ' +
		'costs it nothing, and a fetch here would be a permanent charge for no change on screen');
});

// ── the badge and the till, on one set of rows ───────────────────────────────
// The header badge is painted on EVERY page of the site and counts the RAW localStorage rows;
// the cart panel exists only on /shop and shows the RECONCILED ones. While the reconcile dropped
// a row in memory alone, those two disagreed silently and indefinitely — the reported bug's exact
// shape (two numbers from two truths, no error in between) with a different cause. Reviewed
// 2026-09-14 as P2-1.
//
// 🔴 The badge is counted here the way header-actions-cart.js#count counts it — sum of `e[1]` over
// the raw rows — because that is the algorithm under test. Copied deliberately and kept to one
// place: that file is an IIFE island with no export, so there is nothing to import.
function badgeCount(sb) {
	const raw = JSON.parse(sb.store.get(CART_KEY) || '[]');
	return raw.reduce((n, e) => n + (Array.isArray(e) ? (parseInt(e[1], 10) || 0) : 0), 0);
}

test('a ghost line leaves the badge and the POST on the SAME number', async () => {
	const sb = loadSquareShop({
		storage: { [CART_KEY]: JSON.stringify([[ZINE_VID, 1], ['GONE_VARIATION_ID', 3]]) }
	});
	const root = mountCart(sb, CATALOG);

	assert.equal(badgeCount(sb), 1,
		'the reconcile threw a row away — the rows on disk, which the header badge counts on ' +
		'every page of the site, must say so too');

	click(checkoutBtn(root), 'checkout'); await flush();
	const postSum = sb.fetchCalls[0].body.items.reduce((n, l) => n + l.quantity, 0);
	assert.equal(postSum, badgeCount(sb), 'the badge must count what the checkout will carry');
	assert.deepEqual(sb.fetchCalls[0].body.items, [{ variation_id: ZINE_VID, quantity: 1 }]);
});

test('a clean basket is not rewritten — the write-back happens only when a row was dropped', () => {
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	mountCart(sb, CATALOG);
	assert.equal(sb.store.get(CART_KEY), BUYERS_BASKET,
		'nothing was dropped, so the shopper’s own rows must come back byte for byte');
	assert.equal(badgeCount(sb), 5);
});
