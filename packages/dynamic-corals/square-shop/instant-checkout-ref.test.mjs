// Behavioural test of the INSTANT path's `client_request_ref` in square-shop.js — the
// single-item Buy button, back-ported from the feelreef fork (see the BACK-PORT note
// above `startCheckout`, and reef's
// apps/feelreef/src/lib/dynamic-corals/square-shop/PROVENANCE.md § "Back-port debt").
// RSP rejects POST /api/v2/square/catalog/checkout with 400 when the field is missing,
// so this is the value that decides whether an instant Buy works at all against RSP —
// and, once it works, whether a retry replays ONE Square payment link or mints a second.
//
// The cart's half of the same policy is covered by ./cart-checkout-ref.test.mjs. This
// file covers what the cart cannot: the instant ref is keyed by variation_id inside a
// PER-MOUNT Map, so a retry of the same Buy reuses it, a different item never collides
// into RSP's 409 (same ref, different contents), and a fresh mount is a fresh purchase.
//
// square-shop.js is a browser script with no exports (it self-mounts on load), so this
// suite runs the file's SOURCE as a function body with document/window/crypto/fetch
// injected as parameters. Nothing in the source is rewritten and no global is touched;
// the appended line only hands back the internals under test.
//
// Driving the real `mount()` rather than calling `renderInstant` directly is deliberate:
// the ref Map is created inside mount, so a test that built its own Map would be
// asserting against its own fixture instead of the widget's actual ref lifetime.
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
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHECKOUT_URL = 'https://api.test/api/v2/square/catalog/checkout';
const ITEMS = [
	{ variation_id: 'V1', name: 'Apron Set', display_price: 40, currency: 'USD' },
	{ variation_id: 'V2', name: 'Tea Towel', display_price: 12, currency: 'USD' }
];

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
		// className and classList are two views of ONE string in a real DOM, so a class the
		// pending state adds is visible to the walk below and removable again.
		classList: {
			add(c) {
				const parts = String(el.className).split(/\s+/).filter(Boolean);
				if (parts.indexOf(c) < 0) parts.push(c);
				el.className = parts.join(' ');
			},
			remove(c) {
				el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' ');
			},
			contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; }
		},
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
		// remembers it, so `card.querySelector('.…-body').appendChild(buy)` keeps the
		// Buy button reachable from the root this test walks.
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

// A browser swallows a listener that throws — the button just goes dead. Here a throw is
// surfaced, because "the click died before the handler body ran" is a failure this suite
// exists to catch (the ref is an ARGUMENT to the checkout call).
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

function loadSquareShop({ randomUUID = true } = {}) {
	const checkoutCalls = [];
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
	// randomUUID:false is the http:// page / old WebView — `crypto` is there,
	// `crypto.randomUUID` (secure-context-gated) is not.
	const cryptoObj = randomUUID
		? globalThis.crypto
		: { getRandomValues: (b) => globalThis.crypto.getRandomValues(b) };
	const fetchImpl = async (url, init) => {
		const u = String(url);
		// The catalog read is on the processor-neutral surface; the instant checkout below is
		// still the Square-specific one. Both are matched so this suite stays about the ref and
		// not about which surface answers the listing.
		if (u.includes('/api/v2/shop/catalog?') || u.includes('/api/v2/square/catalog?')) {
			return { ok: true, status: 200, json: async () => ({ connected: true, items: ITEMS }) };
		}
		if (u === CHECKOUT_URL) {
			checkoutCalls.push({ url: u, body: JSON.parse(init.body) });
			// Always fails, so every Buy lands on the honest-failure path and the button
			// stays clickable — which is exactly the retry the ref policy is about.
			return { ok: false, status: 500, json: async () => ({ error: 'nope' }) };
		}
		throw new Error(`unexpected fetch: ${u}`);
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { mount };'
	);
	const api = factory(document, window, cryptoObj, fetchImpl, globalThis.CustomEvent);
	return { ...api, checkoutCalls };
}

// One mount of the instant coral (no data-cart ⇒ instant is the default mode).
async function mountShop(sb) {
	const root = makeEl('div');
	root.setAttribute('data-guild-id', 'g1');
	root.setAttribute('data-api-base', 'https://api.test');
	await sb.mount(root);
	return root;
}

function buyButtons(root) {
	return byClass(root, `${PREFIX}-buy`);
}

test('the instant Buy sends a client_request_ref at all (RSP 400s without it)', async () => {
	const sb = loadSquareShop();
	const root = await mountShop(sb);

	const buys = buyButtons(root);
	assert.equal(buys.length, ITEMS.length, 'expected one Buy button per single-variant item');
	click(buys[0], 'buy'); await flush();

	assert.equal(sb.checkoutCalls.length, 1, 'the click must reach the checkout endpoint');
	const body = sb.checkoutCalls[0].body;
	assert.equal(body.guild_id, 'g1');
	assert.equal(body.variation_id, 'V1');
	assert.match(
		body.client_request_ref,
		UUID_V4,
		'RSP requires a non-empty client_request_ref on the instant checkout — 400 without it'
	);
});

test('a retry of the same Buy reuses the same client_request_ref', async () => {
	const sb = loadSquareShop();
	const root = await mountShop(sb);

	const buy = buyButtons(root)[0];
	click(buy, 'buy'); await flush();
	assert.equal(buy.disabled, false, 'the button is usable again after the failure');
	click(buy, 'buy retry'); await flush();

	assert.equal(sb.checkoutCalls.length, 2, 'both clicks must reach the checkout endpoint');
	const [first, second] = sb.checkoutCalls;
	assert.equal(second.body.variation_id, first.body.variation_id, 'same item, so same contents');
	assert.equal(
		second.body.client_request_ref,
		first.body.client_request_ref,
		'a retry of the same buy-intent must replay one payment link, not mint a second'
	);
});

test('a different item gets a distinct client_request_ref', async () => {
	const sb = loadSquareShop();
	const root = await mountShop(sb);

	const buys = buyButtons(root);
	click(buys[0], 'buy V1'); await flush();
	click(buys[1], 'buy V2'); await flush();

	assert.equal(sb.checkoutCalls.length, 2);
	const [first, second] = sb.checkoutCalls;
	assert.equal(first.body.variation_id, 'V1');
	assert.equal(second.body.variation_id, 'V2');
	assert.match(second.body.client_request_ref, UUID_V4);
	assert.notEqual(
		second.body.client_request_ref,
		first.body.client_request_ref,
		'a different item on the same ref is RSP 409 — the ref must be keyed per variation'
	);
});

test('a fresh mount mints a fresh ref for the same item', async () => {
	// The map lives on the mount, not on the module: after the shopper comes back from a
	// completed hosted checkout the page has re-mounted, and buying the same item again is
	// a NEW purchase that must not replay the paid link.
	const sb = loadSquareShop();

	const first = await mountShop(sb);
	click(buyButtons(first)[0], 'buy on the first mount'); await flush();

	const second = await mountShop(sb);
	click(buyButtons(second)[0], 'buy on a fresh mount'); await flush();

	assert.equal(sb.checkoutCalls.length, 2);
	const [a, b] = sb.checkoutCalls;
	assert.equal(a.body.variation_id, b.body.variation_id, 'same item both times');
	assert.notEqual(
		b.body.client_request_ref,
		a.body.client_request_ref,
		'a fresh mount is a fresh buy-intent — the ref map must not outlive the mount'
	);
});

test('without crypto.randomUUID the Buy still works and the ref is UUIDv4-shaped', async () => {
	const sb = loadSquareShop({ randomUUID: false });
	const root = await mountShop(sb);

	const buy = buyButtons(root)[0];
	// The ref is an ARGUMENT to the checkout call: a throw here kills the click before the
	// handler can disable the button or restore its label — a dead Buy button.
	click(buy, 'buy on a page without crypto.randomUUID'); await flush();

	assert.equal(sb.checkoutCalls.length, 1, 'the click must reach the network');
	assert.match(sb.checkoutCalls[0].body.client_request_ref, UUID_V4);
	assert.equal(buy.disabled, false, 'the button is usable again after the failure');
	assert.equal(buy.textContent, 'Buy', 'the original label is restored, not left as …');
});
