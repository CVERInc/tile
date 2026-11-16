// A paid order clears the rows it SOLD, and nothing else.
//
// Review round 3, P2-2. The completion page (this repo's shop-function-template.js, which ships in
// the SITE's _worker.js) answered `state === 'paid'` with
// `localStorage.removeItem('dc-square-shop-cart:' + storeId)` — the whole basket, whatever was in
// it. That was harmless while the basket could only ever hold rows that had just been sold. It
// stopped being harmless the moment the basket deliberately KEEPS a row the checkout left behind:
// a variation the catalog in hand could not confirm is held, excluded from the POST, and shown to
// the shopper with its own remove button — and then a paid order deleted it anyway.
//
// square-shop.js's own storage comment says "Only the shopper deletes a row". This file is what
// makes that sentence true on the one path where it was not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartAfterOrder, completionBody, COMPLETE_COPY } from './shop-function-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(
	/\nexport \{[\s\S]*?\n\};?\s*$/,
	'\n'
);

const GUILD = 'g_paid';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;
const ZINE = 'VZINE';
const PA = 'VPRINTA';
const PB = 'VPRINTB';

// ── the decision, on its own ─────────────────────────────────────────────────

test('the rows that were in the order go; a row that was not stays', () => {
	const cart = JSON.stringify([[ZINE, 2], [PA, 3], [PB, 1]]);
	const sold = JSON.stringify({ t: Date.now(), ids: [ZINE] });
	assert.deepEqual(cartAfterOrder(cart, sold), [[PA, 3], [PB, 1]],
		'two held rows were never on the wire — a paid order is not a reason to delete them');
});

test('an order that carried everything leaves an empty basket', () => {
	const cart = JSON.stringify([[ZINE, 2], [PA, 3]]);
	assert.deepEqual(cartAfterOrder(cart, JSON.stringify({ ids: [ZINE, PA] })), []);
});

test('rows this basket’s writers do not understand are kept, like everywhere else', () => {
	const cart = JSON.stringify([[ZINE, 1], { note: 'somebody else wrote this' }, 'a bare string']);
	assert.deepEqual(cartAfterOrder(cart, JSON.stringify({ ids: [ZINE] })),
		[{ note: 'somebody else wrote this' }, 'a bare string']);
});

test('NO record means clear the whole basket — an older coral writes none', () => {
	// 🔴 The degradation that matters: the coral and this page ship on two different deploys, so a
	// site can be running 0.11.16's completion page against a 0.11.12 coral. That shopper must end
	// up with the behaviour they had before, never with a basket that is never cleared.
	const cart = JSON.stringify([[ZINE, 1], [PA, 2]]);
	assert.equal(cartAfterOrder(cart, null), null);
	assert.equal(cartAfterOrder(cart, ''), null);
	assert.equal(cartAfterOrder(cart, 'not json'), null);
	assert.equal(cartAfterOrder(cart, JSON.stringify({ t: 1 })), null, 'a record with no ids is no record');
});

test('an unreadable basket means clear the whole key too', () => {
	assert.equal(cartAfterOrder('not json', JSON.stringify({ ids: [ZINE] })), null);
	assert.equal(cartAfterOrder(JSON.stringify({ rows: [] }), JSON.stringify({ ids: [ZINE] })), null);
	assert.equal(cartAfterOrder(null, JSON.stringify({ ids: [ZINE] })), null);
});

// ── the page that runs it ────────────────────────────────────────────────────

test('the emitted completion script runs cartAfterOrder, and carries the ref to key it by', () => {
	const html = completionBody(COMPLETE_COPY['en-US'], 'en-US', '/api/out?ref=r1', '/shop', GUILD, true, 'r1');
	assert.ok(html.includes('const cartAfterOrder=function cartAfterOrder(rawCart, rawSold)'),
		'the decision must ship as the same function this file tested, not a re-typed copy');
	assert.ok(html.includes('"ref":"r1"'), 'the sold-lines record is keyed by the ref');
	assert.ok(html.includes("'dc-square-shop-sold:'+C.ref"), 'and read back under that key');
	assert.ok(!/removeItem\('dc-square-shop-cart:'\+C\.storeId\)/.test(html.replace(/else localStorage\.removeItem\(CK\)/, '')),
		'the unconditional whole-key removal must be gone');
});

test('a page with no ref emits no ref, and still clears the basket', () => {
	const html = completionBody(COMPLETE_COPY['en-US'], 'en-US', '/api/out', '/shop', GUILD, false);
	assert.ok(!html.includes('<script>'), 'no ref, no polling script at all — unchanged');
});

// ── the coral half: the record is written by the attempt that sends the lines ─

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

function loadCoral(storage) {
	const store = makeStorage(storage);
	const posts = [];
	const document = { readyState: 'complete', head: {}, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {} };
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		localStorage: store.ls,
		dispatchEvent: () => true,
		addEventListener() {}
	};
	const fetchImpl = async (url, init) => {
		posts.push({ url: String(url), body: JSON.parse(init.body) });
		return { ok: true, status: 200, json: async () => ({ url: 'https://squareup.example/checkout/abc' }) };
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { startCartCheckout, readLabels };'
	);
	return { ...factory(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent), store, posts, window };
}

const fakeBtn = () => ({
	textContent: 'Checkout', disabled: false, classList: { add() {}, remove() {} },
	setAttribute() {}, removeAttribute() {}, parentElement: null
});

test('a cart checkout that reaches the payment page writes down exactly what it sent', async () => {
	const sb = loadCoral({ [CART_KEY]: JSON.stringify([[ZINE, 2], [PA, 3]]) });
	// The cart Map is the SENDABLE set — a held row is not in it, which is the whole point.
	const cart = new Map([[ZINE, 2]]);
	await sb.startCartCheckout('https://api.test', GUILD, cart, false, fakeBtn(), { checkoutPending: '…' }, new Map(), '');

	assert.equal(sb.posts.length, 1);
	const ref = sb.posts[0].body.client_request_ref;
	assert.ok(ref, 'the POST names the attempt');
	const record = JSON.parse(sb.store.map.get('dc-square-shop-sold:' + ref));
	assert.deepEqual(record.ids, [ZINE], 'only what was on the wire');
	assert.ok(record.t > 0, 'stamped, so an abandoned attempt can be swept');
	assert.equal(sb.window.location.href, 'https://squareup.example/checkout/abc');

	// …and the completion page, handed those two strings, leaves the held row alone.
	assert.deepEqual(
		cartAfterOrder(sb.store.map.get(CART_KEY), sb.store.map.get('dc-square-shop-sold:' + ref)),
		[[PA, 3]],
		'the shopper paid for the zine; the print they could not buy today is still theirs'
	);
});

test('records of attempts nobody finished are swept on the next write', async () => {
	const weekAndABit = Date.now() - (8 * 24 * 60 * 60 * 1000);
	const sb = loadCoral({
		[CART_KEY]: JSON.stringify([[ZINE, 1]]),
		'dc-square-shop-sold:old': JSON.stringify({ t: weekAndABit, ids: [PB] }),
		'dc-square-shop-sold:undated': JSON.stringify({ ids: [PB] }),
		'dc-square-shop-sold:fresh': JSON.stringify({ t: Date.now(), ids: [PB] })
	});
	await sb.startCartCheckout('https://api.test', GUILD, new Map([[ZINE, 1]]), false, fakeBtn(), {}, new Map(), '');

	const keys = [...sb.store.map.keys()].filter((k) => k.indexOf('dc-square-shop-sold:') === 0).sort();
	assert.ok(!keys.includes('dc-square-shop-sold:old'), 'a week-old attempt is swept');
	assert.ok(!keys.includes('dc-square-shop-sold:undated'), 'so is one with no timestamp to judge');
	assert.ok(keys.includes('dc-square-shop-sold:fresh'), 'a recent one is left alone');
	assert.equal(keys.length, 2, `swept too much or too little: ${JSON.stringify(keys)}`);
});

test('a storage that cannot enumerate loses the sweep, never the record', async () => {
	const sb = loadCoral({ [CART_KEY]: JSON.stringify([[ZINE, 1]]) });
	delete sb.store.ls.key; // a feelreef wrapper / a test double with get-set-remove only
	await sb.startCartCheckout('https://api.test', GUILD, new Map([[ZINE, 1]]), false, fakeBtn(), {}, new Map(), '');
	const ref = sb.posts[0].body.client_request_ref;
	assert.ok(sb.store.map.has('dc-square-shop-sold:' + ref), 'the record is still written');
});

test('a checkout that never reaches a payment page writes nothing down', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[ZINE, 1]]) });
	const document = { readyState: 'complete', head: {}, createElement: () => ({}), querySelectorAll: () => [], addEventListener() {} };
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		localStorage: store.ls, dispatchEvent: () => true, addEventListener() {}
	};
	const factory = new Function('document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { startCartCheckout };');
	const api = factory(document, window, globalThis.crypto,
		async () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) }), globalThis.CustomEvent);
	document.createElement = () => ({
		className: '', textContent: '', setAttribute() {}, appendChild() {},
		classList: { add() {}, remove() {} }, style: {}
	});
	const btn = fakeBtn(); btn.parentElement = { querySelector: () => null, appendChild() {}, removeChild() {} };
	await api.startCartCheckout('https://api.test', GUILD, new Map([[ZINE, 1]]), false, btn, {}, new Map(), '');
	assert.deepEqual([...store.map.keys()].filter((k) => k.indexOf('dc-square-shop-sold:') === 0), []);
});
