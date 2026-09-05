// Does the shop work for a seller who connected STRIPE rather than Square?
//
// The catalog read and the cart checkout go to the backend's PROCESSOR-NEUTRAL
// `/api/v2/shop/*` surface (reef, apps/rsp/src/commerce/shop-endpoints.ts): it resolves
// which processor the site's owner actually connected and answers `{connected, processor,
// items}` either way. Before that, both calls named `/api/v2/square/*`, so a seller on
// Stripe could not list their own catalog on a built site AT ALL — independent of what the
// backend supported, and invisible to every test, because a Square fixture answers a
// Square path perfectly well.
//
// That is what this suite pins: the Square-specific paths are a hard error in the fetch
// stub, so a regression does not quietly degrade here, it throws. (The instant Buy is
// deliberately still on the Square surface — see the note above `startCheckout` — so this
// suite does not touch it.)
//
// square-shop.js is a browser script with no exports (it self-mounts on load), so this
// suite runs the file's SOURCE as a function body with document/window/crypto/fetch
// injected as parameters — the same harness as ./instant-checkout-ref.test.mjs. Nothing in
// the source is rewritten and no global is touched; the appended line only hands back the
// internals under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const API_BASE = 'https://api.test';
const CATALOG_URL = `${API_BASE}/api/v2/shop/catalog?guild_id=g1`;
const CART_URL = `${API_BASE}/api/v2/shop/cart`;
const PAY_URL = 'https://checkout.stripe.test/pay/cs_test_1';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// What the neutral surface answers for a site whose owner connected Stripe: the same
// `{connected, items}` a Square site gets, plus the `processor` field naming who takes the
// money. The widget renders off `items` and has no reason to read `processor`.
const CATALOG = {
	connected: true,
	processor: 'stripe',
	items: [
		{ variation_id: 'V1', name: 'Apron Set', display_price: 40, currency: 'USD', variants: [{ id: 'V1', display_price: 40 }] },
		{ variation_id: 'V2', name: 'Tea Towel', display_price: 12, currency: 'USD', variants: [{ id: 'V2', display_price: 12 }] }
	]
};

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', currencyDisplay: 'code' }).format(n);

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
		classList: { add() {} },
		_attrs: Object.create(null),
		_listeners: Object.create(null),
		_qs: new Map(),
		_html: '',
		appendChild(c) { el.children.push(c); return c; },
		append(...cs) { for (const c of cs) el.children.push(c); },
		setAttribute(k, v) { el._attrs[k] = String(v); },
		getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
		addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
		// Not a selector engine: the first ask for a selector mints a stub child and
		// remembers it, so `card.querySelector('.…-body').appendChild(buy)` keeps the
		// button reachable from the root.
		querySelector(sel) {
			if (!el._qs.has(sel)) {
				const child = makeEl('div');
				child.className = String(sel).replace(/^\./, '');
				el.children.push(child);
				el._qs.set(sel, child);
			}
			return el._qs.get(sel);
		},
		querySelectorAll() { return []; }
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

// The card bodies are built with innerHTML, which this stub stores rather than parses —
// so what a shopper would SEE on the cards is the concatenation of those strings.
function renderedHtml(root) {
	return walk(root).map((e) => e._html).join('\n');
}

// A browser swallows a listener that throws — the button just goes dead. Here a throw is
// surfaced, because "the click died before the handler body ran" is a failure, not a pass.
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

function loadSquareShop() {
	const calls = [];
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
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {}
		},
		dispatchEvent: () => true
	};
	// Only the neutral surface answers. A call to the Square-specific catalog or cart is
	// an unhandled throw, not an empty listing — mount()'s catch would otherwise turn a
	// wrong endpoint into the ordinary "couldn't load the shop" state and this suite would
	// pass a regression as a network hiccup.
	const fetchImpl = async (url, init) => {
		const u = String(url);
		const body = init && init.body ? JSON.parse(init.body) : null;
		calls.push({ url: u, method: (init && init.method) || 'GET', body });
		if (u === CATALOG_URL) {
			return { ok: true, status: 200, json: async () => CATALOG };
		}
		if (u === CART_URL) {
			return { ok: true, status: 200, json: async () => ({ attempt_id: 'att_1', url: PAY_URL }) };
		}
		throw new Error(`unexpected fetch: ${u}`);
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { mount };'
	);
	const api = factory(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	return { ...api, calls, window };
}

async function mountShop(sb, attrs = {}) {
	const root = makeEl('div');
	root.setAttribute('data-guild-id', 'g1');
	root.setAttribute('data-api-base', API_BASE);
	for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
	await sb.mount(root);
	return root;
}

test('a Stripe seller\'s catalog loads and renders its products', async () => {
	const sb = loadSquareShop();
	const root = await mountShop(sb);

	assert.deepEqual(
		sb.calls.map((c) => c.url),
		[CATALOG_URL],
		'the catalog read must go to the processor-neutral surface — the Square-specific one cannot answer for a Stripe seller'
	);

	const cards = byClass(root, `${PREFIX}-card`);
	assert.equal(cards.length, CATALOG.items.length, 'one card per item in the answer');

	const html = renderedHtml(root);
	for (const item of CATALOG.items) {
		assert.ok(html.includes(item.name), `"${item.name}" must be on the page`);
	}
	assert.ok(html.includes(money(40)), 'the price must be rendered, not just the name');
	assert.ok(
		!html.includes('No shop connected yet.') && !html.includes("Couldn't load the shop right now."),
		'a connected Stripe seller must not see the unconnected or the error state'
	);

	const buys = byClass(root, `${PREFIX}-buy`);
	assert.equal(buys.length, CATALOG.items.length, 'each single-variant card keeps its buy button');
});

test('a Stripe seller\'s cart checkout reaches the neutral cart and sends the buyer on', async () => {
	const sb = loadSquareShop();
	const root = await mountShop(sb, { 'data-cart': '1' });

	const add = byClass(root, `${PREFIX}-buy`);
	assert.ok(add.length > 0, 'cart mode puts an Add button on each card');
	click(add[0], 'add');

	const checkout = byClass(root, `${PREFIX}-checkout`);
	assert.equal(checkout.length, 1, 'expected exactly one Checkout button');
	click(checkout[0], 'checkout'); await flush();

	const post = sb.calls.filter((c) => c.method === 'POST');
	assert.equal(post.length, 1, 'one Checkout click, one cart call');
	assert.equal(
		post[0].url,
		CART_URL,
		'the cart must go to the processor-neutral surface, which routes it to whichever processor the seller connected'
	);
	// The neutral surface takes the lines under `items` OR `lines`, never both — sending
	// both is a 400 by design, so the wire shape here stays exactly one of them.
	assert.deepEqual(post[0].body.items, [{ variation_id: 'V1', quantity: 1 }]);
	assert.equal(post[0].body.lines, undefined, 'lines AND items together is a 400 on this surface');
	assert.equal(post[0].body.guild_id, 'g1');
	assert.match(post[0].body.client_request_ref, UUID_V4, 'the idempotency token still travels');
	assert.equal(sb.window.location.href, PAY_URL, 'the buyer is sent to the hosted checkout');
});

// ── the same question one layer out: the EMITTED _worker.js ────────────────
// The built site's /shop is server-rendered by the emitted worker before the widget above
// ever runs (shop-function-template.js#fetchCatalogList). That read was on the Square path
// too, and its failure mode is the quiet one: a miss falls back to the static page, so a
// Stripe seller's shop kept working while permanently losing its server-rendered,
// indexable grid — a degradation no assertion in this repo would have noticed.
// Canonical plan/canonical/site/platform.md: 「Locator, capability and catalog source are
// separate facts. ... None of those facts declares whether a given storefront surface is
// C/native catalog or B/provider catalog.」 The explicit descriptor below selects B/Stripe;
// the guild remains only its compatibility locator.
test('the emitted worker server-renders a Stripe seller\'s grid into /shop', async () => {
	const out = join(tmpdir(), 'stripe-catalog-worker-' + process.pid + '.mjs');
	execFileSync('node', [
		join(here, 'emit-shop-function.mjs'),
		'--guild', 'g1', '--name', 'NORTHWIND',
		'--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }]),
		'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'stripe' }]),
		// REQUIRED once a storefront is declared — see emit-shop-function.mjs. Synthetic origin.
		'--api', 'https://api.example',
		'--out', out
	], { stdio: 'inherit' });

	const SHELL = '<!doctype html><html><head><title>Shop</title></head><body><main>' +
		'<div data-dynamic-coral="square-shop" data-guild-id="g1" data-cart="1" data-detail-base="/shop"></div>' +
		'</main></body></html>';

	const asked = [];
	const realFetch = globalThis.fetch;
	// Same rule as the widget stub above: only the neutral surface answers, so a regression
	// is a thrown miss rather than an empty listing that silently serves the static page.
	globalThis.fetch = async (url) => {
		const u = String(url);
		asked.push(u);
		if (u === 'https://example.com/api/v2/shop/catalog?guild_id=g1&payment_rail=stripe') {
			return { ok: true, json: async () => CATALOG };
		}
		throw new Error(`unexpected fetch: ${u}`);
	};
	const env = {
		ASSETS: {
			fetch: async (req) => {
				const u = String(req.url || req);
				if (u.endsWith('/shop/')) return { ok: true, text: async () => SHELL };
				return new Response('STATIC:' + u, { status: 200 });
			}
		}
	};

	try {
		const mod = await import(pathToFileURL(out).href);
		const res = await mod.default.fetch(new Request('https://example.com/shop/'), env);
		const html = await res.text();

		assert.deepEqual(
			asked,
			['https://example.com/api/v2/shop/catalog?guild_id=g1&payment_rail=stripe'],
			'the SSR catalog read must stay on the selected provider rail'
		);
		assert.ok(html.includes('data-ssr="1"'), 'the grid must actually be server-rendered, not fall back to the static page');
		for (const item of CATALOG.items) {
			assert.ok(html.includes(item.name), `"${item.name}" must be in the server-rendered HTML`);
		}
		assert.ok(html.includes('data-variation-id="V1"'), 'the cards must carry what the widget hydrates from');
	} finally {
		globalThis.fetch = realFetch;
	}
});
