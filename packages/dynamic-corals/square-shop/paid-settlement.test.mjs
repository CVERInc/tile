// tile#84 r2: the paid settle has to be durable and idempotent, and must never fall back to
// clearing the whole basket once this browser holds settlement state for the store.
//
// The review of r1 (PR #327) reproduced four ways a paid order cost the visitor either a basket or
// a second payment. Each is a test below, driven through the REAL emitted completion page (the
// `<script>` a site's _worker.js serves) and, where the shop's side matters, the REAL coral
// (square-shop.js, run with the smallest DOM it accepts). Each fails on r1 (bdf9a84):
//
//   finding 2  the page is closed during its first wait. Nothing was on disk; the paid lines stayed
//              in the basket, and the shop loaded them and sent them to the till again.
//   finding 3  storage refuses the settlement marker. The basket was already written and the record
//              consumed, so a reload found neither and cleared everything added since.
//   finding 4  an order pushed off the end of r1's 50-ref list, or junk written over that list,
//              looked like an order never settled here, so the whole basket was cleared.
//
// The protocol these hold is written down in ./PROVENANCE.md § tile#84 and in
// shop-function-template.js above settleCartAfterOrder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as template from './shop-function-template.js';
import { cartRowQty } from '../shared/cart-badge-count.mjs';

const { completionBody, COMPLETE_COPY } = template;
const here = dirname(fileURLToPath(import.meta.url));
const CORAL = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(/\nexport \{[\s\S]*?\n\};?\s*$/, '\n');

const GUILD = 'g_paid';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;
const FLAG_KEY = `dc-square-shop-settled:${GUILD}`;
const soldKey = (ref) => 'dc-square-shop-sold:' + ref;
const intentKey = (ref) => 'dc-square-shop-paid:' + ref;
const SOLD = 'VSOLD';
const HELD = 'VHELD';
const NEW = 'VNEWUNPAID';

const record = (lines) => JSON.stringify({ t: Date.now(), ids: lines.map((l) => l[0]), lines });

/**
 * A localStorage double that can list its keys (as a browser's can) and can refuse a write the
 * way a full origin does. `refuse(key, value, map)` returning true throws QuotaExceededError.
 */
function makeStorage(initial, refuse = null) {
	const map = new Map(Object.entries(initial || {}));
	const ls = {
		get length() { return map.size; },
		key: (i) => [...map.keys()][i] ?? null,
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => {
			if (refuse && refuse(k, String(v), map)) {
				const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
			}
			map.set(k, String(v));
		},
		removeItem: (k) => { map.delete(k); }
	};
	return { map, ls, get cart() { return JSON.parse(map.get(CART_KEY) || 'null'); } };
}

/** A full origin: any write that would make the stored total larger is refused. */
const noGrowth = (k, v, map) => {
	const old = map.has(k) ? k.length + map.get(k).length : 0;
	return k.length + v.length > old;
};

/**
 * Open the paid completion page for `ref` against `ls`.
 *
 * `waits: 'run'`: the settle's short waits run (at 0 ms, so 51 orders take a moment, not seconds),
 * and `done` resolves once the page has answered and no short wait is pending.
 * `waits: 'hold'`: every short wait is held and never fires unless `release()` is called. This is a
 * page closed or frozen at its first wait. Its continuation never runs; `ready` resolves once the
 * page has answered (the receipt is on screen).
 *
 * `navigator` is given no `locks`: one Node event loop over one Map cannot model two browser tabs,
 * so the lock path is not what is measured here.
 */
function openPaidPage(ls, ref, { waits = 'run' } = {}) {
	const html = completionBody(COMPLETE_COPY['en-US'], 'en-US', '/api/out?ref=' + ref, '/shop', GUILD, true, ref);
	const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
	const el = () => ({ textContent: '', innerHTML: '' });
	const nodes = { 'dc-shop-outcome': el(), 'dc-shop-heading': el() };
	const document = { getElementById: (id) => nodes[id], createElement: () => ({ textContent: '', innerHTML: '' }), title: '' };
	const events = [];
	const window = { dispatchEvent: (e) => { events.push(e.type); return true; } };
	const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, state: 'paid', lines: [], total_minor: 0, currency: 'USD' }) });
	let pending = 0;
	const held = [];
	const timer = (fn, ms) => {
		if (!(ms < 1000)) return 0; // the 3 s pending re-check: never reached on a paid answer
		if (waits === 'hold') { held.push(fn); return 0; }
		pending++;
		return setTimeout(() => { pending--; fn(); }, 0);
	};
	new Function('document', 'window', 'localStorage', 'fetch', 'CustomEvent', 'setTimeout', 'navigator', script)(
		document, window, ls, fetchImpl, globalThis.CustomEvent, timer, {});
	const answered = () => /\S/.test(nodes['dc-shop-heading'].textContent);
	const until = async (cond) => {
		let quiet = 0;
		for (let i = 0; i < 2000 && quiet < 3; i++) {
			await new Promise((r) => setImmediate(r));
			quiet = cond() ? quiet + 1 : 0;
		}
		assert.ok(quiet >= 3, 'the completion page never finished');
	};
	return {
		nodes, events,
		ready: until(answered),
		done: until(() => answered() && pending === 0),
		release() { const fns = held.splice(0); waits = 'run'; for (const fn of fns) { pending++; setTimeout(() => { pending--; fn(); }, 0); } }
	};
}
const settlePaid = async (store, ref) => { const p = openPaidPage(store.ls, ref); await p.done; return p; };

// ── the coral, with the smallest DOM it accepts (same shim shape as cart-variant-collapse.test.mjs) ──
function makeEl(tag) {
	const el = {
		tagName: String(tag).toUpperCase(), children: [], className: '', textContent: '', disabled: false, type: '', href: '',
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
const walk = (el, out = []) => { out.push(el); for (const c of el.children) walk(c, out); return out; };
const byClass = (root, cls) => walk(root).filter((e) => String(e.className).split(/\s+/).includes(cls));
const flush = () => new Promise((r) => setTimeout(r, 0));

const CATALOG = [SOLD, HELD, NEW].map((vid, i) => ({
	id: 'item-' + i, slug: 'item-' + i, title: 'Item ' + i, name: 'Item ' + i, variation_id: vid,
	price_minor: 500, display_price: 5, currency: 'USD'
}));

/** Load the shop page in cart mode on `store`. Its checkout POST is recorded (and then refused). */
function openShop(store) {
	const posts = [];
	const events = [];
	const document = { readyState: 'complete', head: makeEl('head'), body: makeEl('body'), createElement: (t) => makeEl(t), querySelectorAll: () => [], addEventListener() {} };
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		history: { replaceState() {} },
		localStorage: store.ls,
		dispatchEvent: (e) => { events.push(e.type); return true; }
	};
	const fetchImpl = async (url, init) => {
		posts.push(JSON.parse(init.body));
		return { ok: false, status: 500, json: async () => ({ error: 'not under test' }) };
	};
	const sb = new Function('document', 'window', 'crypto', 'fetch', 'CustomEvent', CORAL + '\nreturn { renderCart, readLabels, withVariantSummary };')(
		document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	const root = makeEl('div');
	sb.renderCart(root, CATALOG.map(sb.withVariantSummary), 'https://api.test', GUILD, sb.readLabels(root), false, '/shop', new Map());
	const checkout = async () => {
		const btns = byClass(root, 'dc-square-shop-checkout');
		assert.equal(btns.length, 1, 'expected exactly one Checkout button');
		for (const fn of btns[0]._listeners.click || []) await fn();
		await flush();
	};
	const sent = () => posts.map((p) => p.items.map((l) => [l.variation_id, l.quantity]));
	return { sb, root, posts, events, checkout, sent };
}

// ── finding 2: the page closed before its first wait ended ───────────────────────────────────

test('review finding 2: a completion page closed at its first wait — the shop does not load or charge the paid lines again', async () => {
	const ref = 'r-closed';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) });
	const page = openPaidPage(store.ls, ref, { waits: 'hold' });
	await page.ready;
	assert.match(page.nodes['dc-shop-heading'].textContent, /./, 'the receipt is on screen');
	// The document is destroyed here: its held wait never fires and its continuation never runs.

	const shop = openShop(store);
	assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]], 'the shop loaded the paid zine back into the basket');
	await shop.checkout();
	assert.deepEqual(shop.sent(), [[[SOLD, 1], [HELD, 1]]], 'the next checkout charged for the paid line again');
	assert.equal(store.map.has(intentKey(ref)), false, 'the intent is applied once and gone');
	assert.ok(shop.events.includes('dc-cart-changed'), 'the header badge is told the basket changed');
});

test('tile#84 r2: the paid transition is on disk before the page yields for the first time', async () => {
	const ref = 'r-transition';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) });
	const page = openPaidPage(store.ls, ref, { waits: 'hold' });
	await page.ready;
	const intent = JSON.parse(store.map.get(intentKey(ref)));
	assert.equal(intent.s, GUILD, 'the intent names its store');
	assert.deepEqual(intent.lines, [[SOLD, 1]], 'and carries the sold quantities');
	assert.equal(store.map.get(FLAG_KEY), '1', 'the store flag is written with it');
	assert.equal(store.map.has(soldKey(ref)), false, 'the record\'s content now lives in the intent');
	assert.deepEqual(store.cart, [[SOLD, 2], [HELD, 1]], 'nothing comes off until the wait is over');
	page.release();
	await page.done;
	assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]]);
	assert.equal(store.map.has(intentKey(ref)), false);
});

test('tile#84 r2: a shop tab already open checks nothing out until the paid lines are off, and the next press sends the rest', async () => {
	const ref = 'r-open-tab';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 2]]) });
	const shop = openShop(store); // loaded while the order was still on the payment page
	const page = openPaidPage(store.ls, ref, { waits: 'hold' });
	await page.ready; // ... and then the completion page was closed mid-settle
	await shop.checkout();
	assert.deepEqual(shop.sent(), [], 'the first press must not send the paid zines to the till');
	assert.deepEqual(store.cart, [[HELD, 1]]);
	await shop.checkout();
	assert.deepEqual(shop.sent(), [[[HELD, 1]]], 'the press after the redraw sends what the panel now shows');
});

test('tile#84 r2: the shop and a page still waiting in another tab take the paid lines off once', async () => {
	const ref = 'r-race';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 3], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) });
	const page = openPaidPage(store.ls, ref, { waits: 'hold' });
	await page.ready;
	openShop(store); // applies the intent
	assert.deepEqual(store.cart, [[SOLD, 2], [HELD, 1]]);
	page.release(); // the waiting page wakes up and finds no intent
	await page.done;
	assert.deepEqual(store.cart, [[SOLD, 2], [HELD, 1]], 'one zine was paid for, so one comes off, not two');
	assert.equal(page.events.includes('dc-cart-changed'), false);
});

// ── finding 3: storage refuses the settlement marker ─────────────────────────────────────────

for (const [label, refuse] of [
	['the review\'s model: only the settlement marker is refused', (k) => k === FLAG_KEY],
	['a full origin: no write may grow storage', noGrowth]
]) {
	test(`review finding 3 (${label}): a reload neither clears what was added nor takes the paid line twice`, async () => {
		const ref = 'r-quota';
		const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) }, refuse);
		await settlePaid(store, ref);
		assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]], 'the paid zine came off');

		// The visitor shops on (written straight to the map: the space was freed elsewhere).
		store.map.set(CART_KEY, JSON.stringify([[SOLD, 1], [HELD, 1], [NEW, 1]]));
		await settlePaid(store, ref);
		assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1], [NEW, 1]],
			'a reload of the paid page must not clear the basket, nor take the paid zine a second time');
	});
}

test('tile#84 r2: with storage full, the page settles in the same task and leaves a record that a reload reads as settled', async () => {
	const ref = 'r-full';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) }, noGrowth);
	const page = openPaidPage(store.ls, ref, { waits: 'hold' }); // closed at once: nothing may be left for later
	await page.ready;
	assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]], 'with no durable state possible, the page settles before it yields');
	assert.deepEqual(JSON.parse(store.map.get(soldKey(ref))).ids, [], 'the record is shrunk to a settled marker');
	assert.equal(store.map.has(intentKey(ref)), false);
	assert.equal(store.map.has(FLAG_KEY), false);
});

test('tile#84 r2: an apply whose basket write is refused keeps the intent, and the next reader takes the line off once', () => {
	const ref = 'r-refused-apply';
	let refuseCart = true;
	const store = makeStorage({
		[CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]),
		[intentKey(ref)]: JSON.stringify({ s: GUILD, t: 1, ids: [SOLD], lines: [[SOLD, 1]] })
	}, (k) => refuseCart && k === CART_KEY);
	assert.throws(() => template.applyPaidIntent(store.ls, CART_KEY, intentKey(ref)), /quota/);
	assert.ok(store.map.has(intentKey(ref)), 'a refused basket write must not consume the intent');
	assert.deepEqual(store.cart, [[SOLD, 2], [HELD, 1]]);
	refuseCart = false;
	assert.equal(template.applyPaidIntent(store.ls, CART_KEY, intentKey(ref)), true);
	assert.equal(template.applyPaidIntent(store.ls, CART_KEY, intentKey(ref)), false, 'a second apply finds nothing');
	assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]]);
});

// ── finding 4: eviction and junk ─────────────────────────────────────────────────────────────

test('review finding 4: an order settled 50 orders ago, reopened, does not clear the basket', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey('old')]: record([[SOLD, 1]]) });
	await settlePaid(store, 'old');
	for (let i = 0; i < 50; i++) {
		store.map.set(CART_KEY, JSON.stringify([[SOLD, 1], [HELD, 1]]));
		store.map.set(soldKey('later-' + i), record([[SOLD, 1]]));
		await settlePaid(store, 'later-' + i);
	}
	store.map.set(CART_KEY, JSON.stringify([[NEW, 1]]));
	await settlePaid(store, 'old');
	assert.deepEqual(store.cart, [[NEW, 1]], 'the old receipt cleared a basket it never had anything to do with');
});

test('review finding 4: junk written over the settlement marker after settling does not make an old receipt destructive', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey('corrupt')]: record([[SOLD, 1]]) });
	await settlePaid(store, 'corrupt');
	store.map.set(FLAG_KEY, 'not JSON');
	store.map.set(CART_KEY, JSON.stringify([[NEW, 1]]));
	await settlePaid(store, 'corrupt');
	assert.deepEqual(store.cart, [[NEW, 1]], 'a damaged marker read as "never settled" and cleared the basket');
});

test('tile#84 r2: with no record and no flag, the first paid page still clears the whole key once (an older coral), and writes the flag', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 1], [HELD, 2]]) });
	await settlePaid(store, 'r-legacy');
	assert.equal(store.map.has(CART_KEY), false, 'the pre-0.11.16 fallback is kept for a shopper whose coral wrote no record');
	assert.equal(store.map.get(FLAG_KEY), '1');
	store.map.set(CART_KEY, JSON.stringify([[NEW, 1]]));
	await settlePaid(store, 'r-legacy');
	await settlePaid(store, 'r-another-legacy');
	assert.deepEqual(store.cart, [[NEW, 1]], 'once the store has a flag, no paid page clears the whole key again');
});

// ── the coral's side ─────────────────────────────────────────────────────────────────────────

test('tile#84 r2: the shop applies only its own store\'s intents, and leaves one it cannot read', () => {
	const store = makeStorage({
		[CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]),
		[intentKey('other-store')]: JSON.stringify({ s: 'g_other', t: 1, ids: [SOLD], lines: [[SOLD, 1]] }),
		[intentKey('damaged')]: '{not json',
		[intentKey('mine')]: JSON.stringify({ s: GUILD, t: 1, ids: [HELD], lines: [[HELD, 1]] })
	});
	openShop(store);
	assert.deepEqual(store.cart, [[SOLD, 2]], 'only this store\'s intent applies');
	assert.ok(store.map.has(intentKey('other-store')), 'another store\'s intent is that store\'s to apply');
	assert.ok(store.map.has(intentKey('damaged')), 'an intent naming no store is left for its own page');
	assert.equal(store.map.has(intentKey('mine')), false);
});

test('tile#84 r2: the shop\'s copies of cartAfterOrder and applyPaidIntent are the completion page\'s, byte for byte', () => {
	assert.ok(CORAL.includes('\n' + template.applyPaidIntent.toString() + '\n'),
		'square-shop.js must carry applyPaidIntent exactly as shop-function-template.js ships it');

	// cartAfterOrder: byte for byte except its one quantity-read line. The template inlines the read
	// (its function ships as text into the completion page and may name nothing outside itself); the
	// coral uses its own pinned cartRowQty mirror, because cart-badge-count.test.mjs allows one copy
	// of that read per file. The inline read must be cartRowQty's own expression, so for an array row
	// (the only kind cartAfterOrder passes it) the two lines are the same function.
	const src = template.cartAfterOrder.toString();
	const inline = /\tconst rowQty = function \(e\) \{ (.*) \};\n/.exec(src);
	assert.ok(inline, 'the template\'s cartAfterOrder has no inline rowQty line to compare');
	assert.ok(String(cartRowQty).includes('if (!Array.isArray(e)) return 0; ' + inline[1] + ' }'),
		'the template\'s inline row quantity is not cartRowQty\'s expression');
	const coralCopy = src.replace(inline[0], '\tconst rowQty = cartRowQty;\n');
	assert.ok(CORAL.includes('\n' + coralCopy + '\n'),
		'square-shop.js must carry cartAfterOrder as shop-function-template.js ships it, with only its rowQty line changed');
});
