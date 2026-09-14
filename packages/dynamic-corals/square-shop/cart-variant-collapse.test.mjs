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
import { cartBadgeCount } from '../shared/cart-badge-count.mjs';

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

function loadSquareShop({ storage = {}, catalog = null, catalogAnswer = null } = {}) {
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
			// `catalogAnswer` is how the failure arms are driven: it stands in for the whole
			// response, including the ones that are not a response at all (a throw), so a test can
			// say what the backend did rather than what this shim would like it to have done.
			if (catalogAnswer) return catalogAnswer(href);
			if (!catalog) throw new Error('this test did not expect a catalog fetch');
			return { ok: true, status: 200, json: async () => ({ connected: true, items: catalog }) };
		}
		fetchCalls.push({ url: href, body: JSON.parse(init.body) });
		return { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { mount, renderCart, readLabels, withVariantSummary, itemsFromSsr, cartCatalogByVariation };'
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

test('a variant the seller has since removed is still kept OUT OF THE POST', async () => {
	// The reconcile exists for a real reason — a stale basket must not check out ghosts. Widening
	// it to sibling variants must not widen it to ids the live catalog no longer knows at all.
	// 🔴 "Dropped" here means dropped from the WIRE, never from the shopper's disk: the row is
	// held and shown (see the truncated-catalog block at the end of this file), because this page
	// cannot tell a product the seller deleted from a page of catalog that did not arrive.
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
// 🔴 The badge is counted with the FUNCTION THE BADGE USES — imported, not retyped. Round 3's
// P3-4 was that this assertion's ruler was a copy of the algorithm it measures, so the two could
// drift together and stay green. The inputs are the two things the header island reads: the raw
// rows on disk, and the held set square-shop.js publishes on its own mount (`data-cart-held`).
// Nothing on disk says which rows are held — that is derived from the catalog in hand.
function badgeCount(sb, root) {
	let held = [];
	try { held = JSON.parse((root && root.getAttribute('data-cart-held')) || '[]'); } catch { held = []; }
	return cartBadgeCount(JSON.parse(sb.store.get(CART_KEY) || '[]'), held);
}

test('a ghost line leaves the badge and the POST on the SAME number', async () => {
	const sb = loadSquareShop({
		storage: { [CART_KEY]: JSON.stringify([[ZINE_VID, 1], ['GONE_VARIATION_ID', 3]]) }
	});
	const root = mountCart(sb, CATALOG);

	assert.equal(badgeCount(sb, root), 1,
		'the badge counts the rows on disk minus the ones this page has derived as held, so an ' +
		'unconfirmed row is EXCLUDED from the count rather than deleted from the disk');

	click(checkoutBtn(root), 'checkout'); await flush();
	const postSum = sb.fetchCalls[0].body.items.reduce((n, l) => n + l.quantity, 0);
	assert.equal(postSum, badgeCount(sb, root), 'the badge must count what the checkout will carry');
	assert.deepEqual(sb.fetchCalls[0].body.items, [{ variation_id: ZINE_VID, quantity: 1 }]);
});

test('a clean basket is not rewritten', () => {
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	const root = mountCart(sb, CATALOG);
	assert.equal(sb.store.get(CART_KEY), BUYERS_BASKET,
		'nothing was dropped, so the shopper’s own rows must come back byte for byte');
	assert.equal(badgeCount(sb, root), 5);
});

// ── the index, as one rule ───────────────────────────────────────────────────
// Every variation id an item NAMES is a key: its own `variation_id` and every `variants[*].id`.
// The variant count decides the VALUE and nothing else. Reviewed 2026-09-14 as P3-2: the count
// used to decide the KEY too, and drew the line in two different places, so two catalog shapes
// had an id that no index knew — and an id no index knows is a line the ghost-reconcile deletes.
const ITEM_BASE = { name: 'Thing', title: 'Thing', display_price: 9, currency: 'USD' };
const INDEX_TABLE = [
	{
		what: 'no `variants` key at all — the flat default is still known',
		item: { ...ITEM_BASE, variation_id: 'FLAT' },
		keys: ['FLAT'], identity: ['FLAT']
	},
	{
		what: 'an empty `variants` array — same',
		item: { ...ITEM_BASE, variation_id: 'FLAT', variants: [] },
		keys: ['FLAT'], identity: ['FLAT']
	},
	{
		what: 'one variant, and it IS the flat default',
		item: { ...ITEM_BASE, variation_id: 'FLAT', variants: [{ id: 'FLAT', title: 'Regular' }] },
		keys: ['FLAT'], identity: ['FLAT']
	},
	{
		what: 'one variant whose id DIFFERS from the flat default — both are the same one thing',
		item: { ...ITEM_BASE, variation_id: 'FLAT', variants: [{ id: 'ODD', title: 'Regular' }] },
		keys: ['FLAT', 'ODD'], identity: ['FLAT', 'ODD']
	},
	{
		what: 'many variants, the default repeated inside them',
		item: {
			...ITEM_BASE, variation_id: 'A',
			variants: [{ id: 'A', title: 'A' }, { id: 'B', title: 'B' }, { id: 'C', title: 'C' }]
		},
		keys: ['A', 'B', 'C'], identity: []
	},
	{
		what: 'many variants and the default NOT among them — the default is still a key',
		item: { ...ITEM_BASE, variation_id: 'TOP', variants: [{ id: 'O1', title: 'O1' }, { id: 'O2', title: 'O2' }] },
		keys: ['TOP', 'O1', 'O2'], identity: ['TOP']
	},
	{
		what: 'no flat default, many variants — the variants alone',
		item: { ...ITEM_BASE, variants: [{ id: 'V1', title: 'V1' }, { id: 'V2', title: 'V2' }] },
		keys: ['V1', 'V2'], identity: []
	},
	{
		what: 'an item that names no variation at all is not indexed',
		item: { ...ITEM_BASE },
		keys: [], identity: []
	},
	{
		what: 'a variant with no id is not a variation',
		item: { ...ITEM_BASE, variation_id: 'FLAT', variants: [{ title: 'nameless' }, null] },
		keys: ['FLAT'], identity: ['FLAT']
	}
];

test('cartCatalogByVariation indexes every id an item names, whatever the shape', () => {
	const sb = loadSquareShop();
	for (const row of INDEX_TABLE) {
		const index = sb.cartCatalogByVariation([row.item]);
		assert.deepEqual([...index.keys()].sort(), [...row.keys].sort(), row.what);
		for (const id of row.identity) {
			assert.equal(index.get(id), row.item,
				`${row.what} — this item sells ONE variation, so the index must hold the item's own ` +
				'object: the conflict path rewrites a price in place and that write has to reach the grid card too');
		}
		for (const id of row.keys.filter((k) => !row.identity.includes(k))) {
			assert.notEqual(index.get(id), row.item, `${row.what} — a sibling needs its own line record`);
			assert.equal(index.get(id).variation_id, id, `${row.what} — a sibling record is keyed to itself`);
		}
	}
});

test('a basket written on either of the two odd shapes is no longer deleted on sight', async () => {
	const odd = [
		{ ...ITEM_BASE, id: 'I1', variation_id: 'FLAT', variants: [{ id: 'ODD', title: 'Regular', price_minor: 900, currency: 'USD' }] },
		{ ...ITEM_BASE, id: 'I2', variation_id: 'TOP', variants: [{ id: 'O1', title: 'O1', price_minor: 900, currency: 'USD' }, { id: 'O2', title: 'O2', price_minor: 900, currency: 'USD' }] }
	];
	const sb = loadSquareShop({ storage: { [CART_KEY]: JSON.stringify([['ODD', 1], ['TOP', 1]]) } });
	const root = mountCart(sb, odd);
	click(checkoutBtn(root), 'checkout'); await flush();

	assert.deepEqual(
		sb.fetchCalls[0].body.items.map((l) => l.variation_id).sort(),
		['ODD', 'TOP'],
		'the catalog names both of these ids; a line the catalog names is not a ghost'
	);
});

// ── the backend's line cap, said in the panel ────────────────────────────────
// RSP refuses a cart of more than PROVIDER_CATALOG_CART_MAX_LINES = 50 lines with a 400 that
// carries no `code`, so checkoutErrorLabelKey has nothing to recognise and the shopper is told
// "try again" — an instruction that can only ever fail. Reviewed 2026-09-14 as P3-3: this release
// is what made the cap reachable, because a line is now a VARIATION and no longer an item.
function manyVariantItem(n) {
	const variants = Array.from({ length: n }, (_, i) => ({
		id: `CAP_V${i}`, title: `Design ${i}`, price_minor: 500, currency: 'USD', display_price: 5, available: true
	}));
	return [{
		id: 'CAPITEM', slug: 'many', name: 'Print set', title: 'Print set',
		variation_id: variants[0].id, price_minor: 500, display_price: 5, currency: 'USD', variants
	}];
}

test('a basket over the backend cap says so, with the number, and holds the button shut', async () => {
	const items = manyVariantItem(51);
	const sb = loadSquareShop({
		storage: { [CART_KEY]: JSON.stringify(items[0].variants.map((v) => [v.id, 1])) }
	});
	const root = mountCart(sb, items);

	const notice = byClass(root, `${PREFIX}-cart-limit`);
	assert.equal(notice.length, 1, 'the shopper must be told BEFORE the request that cannot succeed');
	assert.match(notice[0].textContent, /\b50\b/, 'and told how many lines a checkout takes');
	assert.match(notice[0].textContent, /\b51\b/, 'and how many they have');

	const btn = checkoutBtn(root);
	assert.equal(btn.disabled, true, 'a checkout that can only be refused is not offered');
	click(btn, 'checkout'); await flush();
	assert.equal(sb.fetchCalls.length, 0, 'nothing leaves for a 400 we can already see coming');
});

test('a basket exactly AT the cap checks out normally', async () => {
	const items = manyVariantItem(50);
	const sb = loadSquareShop({
		storage: { [CART_KEY]: JSON.stringify(items[0].variants.map((v) => [v.id, 1])) }
	});
	const root = mountCart(sb, items);

	assert.equal(byClass(root, `${PREFIX}-cart-limit`).length, 0, '50 is allowed, not refused');
	const btn = checkoutBtn(root);
	assert.equal(btn.disabled, false);
	click(btn, 'checkout'); await flush();
	assert.equal(sb.fetchCalls[0].body.items.length, 50);
});

// ── what a variant costs, on both paths ──────────────────────────────────────
// Reviewed 2026-09-14 as P3-1, both axes. Latent before this branch — they only moved the card's
// price RANGE — and reachable now, because this release wired the same derivation to the basket
// line and to the total a shopper reads before paying.
// 🔴 These variants carry `display_price` and NO `price_minor`, which is the shape that tells the
// two paths apart: `display_price` is the field variantDisplayPrice reads FIRST and the SSR card
// used to carry only the fallback, so the hydrated basket fell back again — to the CARD's price,
// which for a multi-variant card is the cheapest variant. A fixture carrying both fields agrees
// either way and would have measured nothing.
const PRICED = [{
	id: 'TEE', slug: 'tee', name: 'Tee', title: 'Tee', variation_id: 'S',
	display_price: 20, currency: 'USD', image_url: '',
	variants: [
		{ id: 'S', title: 'Small', display_price: 20, currency: 'USD', available: true },
		{ id: 'XL', title: 'XL', display_price: 32, currency: 'USD', available: true }
	]
}];

test('the SSR path quotes a variant at ITS price, the same as the fetch path', async () => {
	const { gridHtml } = renderShopGrid(PRICED, { cart: true, detailBase: '/shop', labels: {} });
	const basket = JSON.stringify([['XL', 1]]);

	const ssr = loadSquareShop({ storage: { [CART_KEY]: basket } });
	const ssrRoot = makeEl('div');
	ssr.renderCart(ssrRoot, ssr.itemsFromSsr(ssrGridStub(gridHtml)), 'https://api.test', GUILD, ssr.readLabels(ssrRoot), false, '/shop', new Map());

	const fetched = loadSquareShop({ storage: { [CART_KEY]: basket } });
	const fetchedRoot = mountCart(fetched, PRICED);

	const priceOf = (root) => byClass(root, `${PREFIX}-line-price`).map((n) => n._html || n.textContent);
	assert.deepEqual(priceOf(ssrRoot), priceOf(fetchedRoot),
		'one variation, two hydrate paths, one price — the SSR card carries display_price so the ' +
		'basket cannot quote the item’s cheapest variant for the one the shopper picked');
	assert.ok(String(priceOf(ssrRoot)[0]).includes('32'), `XL costs 32, got ${priceOf(ssrRoot)}`);
});

test('a variant with no currency of its own is priced in the ITEM’s currency', async () => {
	// ¥ is zero-decimal: 2200 minor units is ¥2200, not ¥22. Read against an empty currency string
	// — which is what `v.currency` alone gave — the minor units were divided by 100.
	const jpy = [{
		id: 'ZINE', slug: 'zine', name: 'Zine', title: 'Zine', variation_id: 'JA',
		display_price: 2200, price_minor: 2200, currency: 'JPY', image_url: '',
		variants: [
			{ id: 'JA', title: 'A', price_minor: 2200 },
			{ id: 'JB', title: 'B', price_minor: 2200 }
		]
	}];
	const sb = loadSquareShop({ storage: { [CART_KEY]: JSON.stringify([['JB', 1]]) } });
	const root = mountCart(sb, jpy);
	const total = byClass(root, `${PREFIX}-cart-total`).map((n) => n.textContent);
	assert.ok(String(total[0]).includes('2,200') || String(total[0]).includes('2200'),
		`a ¥2,200 line must total ¥2,200, not ¥22 — got ${JSON.stringify(total)}`);
});

// ── a catalog that is SHORT, and the basket that must survive it ─────────────
// Reviewed 2026-09-14 as round 2's P1-1. The version before this one reconciled the basket
// against whatever catalog was in hand and WROTE THE RESULT BACK, on a premise it stated in its
// own comment: "the fetch path answers with the seller's whole catalog by definition". That is
// false on the backend a live shop runs on today. `square_catalog.py#fetch_catalog_items` (repo
// `reef`, apps/mixfairy/services/payments/byo/) POSTs Square's `search-catalog-items` ONCE and
// drops the cursor — the word `cursor` does not occur in that file — so a seller with more items
// than one page gets HTTP 200, non-empty, and SHORT. Every row off that page then looked exactly
// like a product the seller had deleted, and was deleted from the shopper's own machine. Measured
// irreversible: with the row gone from disk, the next load against a whole catalog had nothing to
// bring back.
//
// What is asserted below is the property that replaces that premise: a catalog this page cannot
// vouch for costs the shopper a few greyed lines for one load, and never a row.
const TRUNCATED = [CATALOG[0]]; // page 1 of 2: the zine arrived, the prints item did not

const rowsOf = (sb) => JSON.parse(sb.store.get(CART_KEY) || '[]');
const idsOnDisk = (sb) => rowsOf(sb).map((r) => r[0]).sort();

test('a truncated catalog does not delete one row: kept, marked, and out of the POST', async () => {
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	const root = mountCart(sb, TRUNCATED);

	assert.deepEqual(
		idsOnDisk(sb),
		[ZINE_VID, PRINT_A, PRINT_B, PRINT_C, PRINT_D].sort(),
		'every id the shopper put in the basket must still be on their own machine — a short ' +
		'catalog page is not the seller deleting four products'
	);

	const shown = byClass(root, `${PREFIX}-held-line`);
	assert.equal(shown.length, 4, 'and the panel must SAY the four are being held, not hide them');
	const noteText = byClass(root, `${PREFIX}-held-note`).map((n) => n.textContent).join(' ');
	assert.ok(noteText.length > 0 && !noteText.includes('{'),
		`the shopper is told why, in words, with no placeholder left in them: ${JSON.stringify(noteText)}`);

	click(checkoutBtn(root), 'checkout'); await flush();
	assert.deepEqual(
		sb.fetchCalls[0].body.items,
		[{ variation_id: ZINE_VID, quantity: 1 }],
		'only what the catalog in hand actually confirms may be sold'
	);
	assert.equal(badgeCount(sb, root), 1,
		'and the header badge — raw rows minus this page’s derived held set — must count the same ' +
		'one line the checkout will carry, WITHOUT a row having been deleted to make it agree');
});

test('the rows come back, with their quantities, the moment the catalog is whole again', async () => {
	const basket = JSON.stringify([[ZINE_VID, 1], [PRINT_A, 2], [PRINT_B, 3], [PRINT_C, 1], [PRINT_D, 1]]);
	const short = loadSquareShop({ storage: { [CART_KEY]: basket } });
	mountCart(short, TRUNCATED);
	const afterShortLoad = short.store.get(CART_KEY);

	// The next page load — same machine, same rows, the whole catalog this time.
	const whole = loadSquareShop({ storage: { [CART_KEY]: afterShortLoad } });
	const root = mountCart(whole, CATALOG);

	assert.equal(byClass(root, `${PREFIX}-held-line`).length, 0, 'nothing is being held any more');
	assert.equal(byClass(root, `${PREFIX}-line`).length, 5, 'all five lines are sellable again');
	click(checkoutBtn(root), 'checkout'); await flush();
	assert.deepEqual(
		whole.fetchCalls[0].body.items.sort((a, b) => a.variation_id.localeCompare(b.variation_id)),
		[
			{ variation_id: PRINT_B, quantity: 3 },
			{ variation_id: PRINT_C, quantity: 1 },
			{ variation_id: PRINT_A, quantity: 2 },
			{ variation_id: PRINT_D, quantity: 1 },
			{ variation_id: ZINE_VID, quantity: 1 }
		].sort((a, b) => a.variation_id.localeCompare(b.variation_id)),
		'the QUANTITIES survive the round trip too — a basket that comes back as 1 of each is ' +
		'still a basket the shopper did not build'
	);
	assert.equal(badgeCount(whole, root), 8, 'and the badge counts all eight items again');
});

test('a variation the seller merely made unsellable is held, not deleted', async () => {
	// Reviewed as P3-1. `apps/rsp/src/commerce/square-catalog.ts` drops any variation whose
	// `sellable` is false (`:294`) and returns NOTHING for an item left with none (`:206-208`),
	// so "out of stock until Monday" and "deleted forever" are the SAME answer on the wire. With
	// a reconcile that deleted, a seller flipping a switch on Friday emptied a shopper's basket
	// over the weekend; with one that holds, they get their basket back when the switch flips.
	const offForTheWeekend = [
		CATALOG[0],
		{ ...CATALOG[1], variants: CATALOG[1].variants.filter((v) => v.id !== PRINT_C) }
	];
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET } });
	const root = mountCart(sb, offForTheWeekend);

	assert.ok(idsOnDisk(sb).includes(PRINT_C), 'the row stays on the shopper’s machine');
	assert.equal(byClass(root, `${PREFIX}-held-line`).length, 1, 'and is shown as held');
	click(checkoutBtn(root), 'checkout'); await flush();
	assert.ok(
		!sb.fetchCalls[0].body.items.some((l) => l.variation_id === PRINT_C),
		'while a variation the catalog is not offering is not sent to the till'
	);
});

test('a held row leaves only when the shopper removes it', async () => {
	const sb = loadSquareShop({
		storage: { [CART_KEY]: JSON.stringify([[ZINE_VID, 1], ['GONE_VARIATION_ID', 3]]) }
	});
	const root = mountCart(sb, CATALOG);
	assert.deepEqual(idsOnDisk(sb), [ZINE_VID, 'GONE_VARIATION_ID'].sort(),
		'an id the catalog does not name is still the shopper’s row, not ours to delete');

	const held = byClass(root, `${PREFIX}-held-line`);
	assert.equal(held.length, 1);
	const rm = byClass(held[0], `${PREFIX}-rm`);
	assert.equal(rm.length, 1, 'every held row carries its own remove button');
	assert.ok(String(rm[0].getAttribute('aria-label')).includes('GONE_VARIATION_ID'),
		'named, so a screen reader says WHICH row this button throws away');

	click(rm[0], 'remove a held row'); await flush();
	assert.deepEqual(idsOnDisk(sb), [ZINE_VID], 'and now — and only now — it is gone');
});

test('a storage row this file did not write is carried through, not tidied away', async () => {
	// Non-destructive means non-destructive about things we do not understand either. A future
	// (or foreign) writer's row shape must survive a reconcile it was never designed for.
	const sb = loadSquareShop({
		storage: { [CART_KEY]: JSON.stringify([[ZINE_VID, 1], { from: 'somewhere else' }, []]) }
	});
	mountCart(sb, CATALOG);
	const rows = rowsOf(sb);
	assert.ok(rows.some((r) => r && r.from === 'somewhere else'), 'the foreign row is still there');
	assert.equal(rows.length, 3, 'and so is the empty one — nothing was dropped on the way past');
});

// ── the catalog cannot be read, and the edge already drew the shop ───────────
// Reviewed 2026-09-14 as round 2's P2-1. Cart mode refuses to hydrate a basket from an SSR grid
// whose cards claim siblings and name none (the old-worker case above) and falls through to the
// fetch. When that fetch fails, the previous behaviour replaced a complete, current, edge-rendered
// storefront with ONE LINE of error text — and an `items: []` 200 replaced it with "Nothing in the
// shop right now", which is the worst thing this widget can say about a shop that has stock.
//
// The window where that happens is exactly the window this branch is for: coral deployed, site
// worker not yet. So the failure arms are not an edge case here, they are the deploy.
//
// What must hold on every arm: the grid stays (browsable, product links intact), there is NO till
// (a basket that cannot be reconciled must not be sellable), and the shopper's stored cart is not
// read, written or reasoned about — byte for byte what it was.
const BROKEN_CATALOG = {
	'the fetch throws (network down)': () => { throw new Error('network'); },
	'the backend answers 500': async () => ({ ok: false, status: 500, json: async () => ({}) }),
	'the body is not JSON': async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('<!doctype html>'); } }),
	'a 200 with an empty catalog': async () => ({ ok: true, status: 200, json: async () => ({ connected: true, items: [] }) }),
	// Round 3, P3-1. This arm used to write "No shop connected yet." over the cards — the same
	// failure the empty-catalog arm was fixed for, with a stronger disproof available on the page
	// itself: the edge rendered THIS seller's products into THIS root a moment ago, so whatever the
	// backend means by `connected: false` right now, "there is no shop" is not it.
	'a 200 that says no shop is connected': async () => ({ ok: true, status: 200, json: async () => ({ connected: false, items: [] }) })
};

for (const [what, catalogAnswer] of Object.entries(BROKEN_CATALOG)) {
	test(`${what}: the SSR grid stays browsable, with no checkout and an untouched cart`, async () => {
		const { gridHtml } = renderShopGrid(CATALOG, { cart: true, detailBase: '/shop', labels: {} });
		const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET }, catalogAnswer });
		const host = mountHost(sb, { ssr: oldWorkerGrid(gridHtml) });

		await sb.mount(host); await flush();

		assert.equal(sb.catalogCalls.length, 1, 'the fall-through still asks — this is about the answer');
		assert.ok(byClass(host, `${PREFIX}-card`).length > 0,
			'the edge rendered this grid from the seller’s own catalog a moment ago; a catalog we ' +
			'cannot reach now is no reason to take the shop away from the shopper as well');
		assert.equal(byClass(host, `${PREFIX}-checkout`).length, 0,
			'and no till: a basket that could not be reconciled must not be sellable');
		assert.equal(byClass(host, `${PREFIX}-cart`).length, 0, 'no cart panel is rendered at all');
		assert.equal(sb.store.get(CART_KEY), BUYERS_BASKET,
			'the shopper’s rows are not read, not rewritten, not marked — untouched');

		const note = byClass(host, `${PREFIX}-cart-offline`);
		assert.equal(note.length, 1, 'the missing half is named, not left as an absent button');
		assert.ok(note[0].textContent.length > 0 && !note[0].textContent.includes('{'),
			`in words, with nothing unfilled in them: ${JSON.stringify(note[0].textContent)}`);
	});
}

test('with NO edge-rendered grid to keep, connected:false still says so', async () => {
	// The control for the arm above: browse-only is what an SSR grid buys. A page with nothing on
	// it has no honest alternative to the line, and must still get it.
	const sb = loadSquareShop({
		storage: { [CART_KEY]: BUYERS_BASKET },
		catalogAnswer: async () => ({ ok: true, status: 200, json: async () => ({ connected: false, items: [] }) })
	});
	const host = makeHost({
		'data-guild-id': GUILD, 'data-api-base': 'https://api.test', 'data-cart': '1', 'data-detail-base': '/shop'
	}, null);
	await sb.mount(host); await flush();

	assert.match(host.innerHTML, /dc-square-shop-empty/, 'the honest empty state is still reachable');
	assert.equal(byClass(host, `${PREFIX}-cart-offline`).length, 0, 'and it is not the browse-only note');
	assert.equal(sb.store.get(CART_KEY), BUYERS_BASKET, 'the cart is untouched either way');
});

test('the shop note is the shopper’s own language, not English on a ja-JP page', async () => {
	const { gridHtml } = renderShopGrid(CATALOG, { cart: true, detailBase: '/shop', labels: {} });
	const said = {};
	for (const locale of ['en-US', 'ja-JP', 'zh-TW', 'zh-CN']) {
		const sb = loadSquareShop({
			storage: { [CART_KEY]: BUYERS_BASKET },
			catalogAnswer: () => { throw new Error('network'); }
		});
		const host = makeHost({
			'data-guild-id': GUILD, 'data-api-base': 'https://api.test',
			'data-cart': '1', 'data-detail-base': '/shop', 'data-locale': locale
		}, ssrGridStub(oldWorkerGrid(gridHtml)));
		await sb.mount(host); await flush();
		said[locale] = byClass(host, `${PREFIX}-cart-offline`)[0].textContent;
	}
	assert.equal(new Set(Object.values(said)).size, 4,
		`four locales, four sentences — got ${JSON.stringify(said, null, 1)}`);
	assert.match(said['ja-JP'], /カート/);
	assert.match(said['zh-TW'], /購物車/);
	assert.match(said['zh-CN'], /购物车/);
});

test('the happy fall-through is unchanged: one fetch, five lines, a working till', async () => {
	// The control for the four arms above. The old-worker page that CAN read the catalog must
	// behave exactly as it did before this fallback existed.
	const { gridHtml } = renderShopGrid(CATALOG, { cart: true, detailBase: '/shop', labels: {} });
	const sb = loadSquareShop({ storage: { [CART_KEY]: BUYERS_BASKET }, catalog: CATALOG });
	const host = mountHost(sb, { ssr: oldWorkerGrid(gridHtml) });

	await sb.mount(host);
	assert.equal(byClass(host, `${PREFIX}-cart-offline`).length, 0, 'nothing to apologise for');
	click(checkoutBtn(host), 'checkout'); await flush();

	assert.equal(sb.catalogCalls.length, 1);
	assert.equal(sb.fetchCalls[0].body.items.length, 5);
	assert.equal(sb.store.get(CART_KEY), BUYERS_BASKET, 'and the rows are still the shopper’s own');
});
