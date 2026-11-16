// tile#84: the paid settle runs in the task that received the `paid` answer, and leaves a
// per-order tombstone so that every later render of the same receipt touches nothing.
//
// Two review rounds of PR #327 reproduced ways a paid order cost the visitor either a basket or a
// second payment. Each input that still applies to this design is a test below, driven through the
// REAL emitted completion page (the `<script>` a site's _worker.js serves) and, where the shop's
// side matters, the REAL coral (square-shop.js, run with the smallest DOM it accepts):
//
//   · the receipt is drawn while the paid lines are still in the basket, and the page is closed
//     before they come off (the shop, old or new, then charges for them again);
//   · a settled order's marker is evicted, overwritten with junk, or swept with the week-old sold
//     records, so reopening the receipt clears a basket filled since;
//   · a later paid order whose sold record is missing must behave exactly as before tile#84;
//   · a stop between any two of the settle's writes must never take the lines off twice, and never
//     take the whole-key clear for an order that was settled;
//   · storage that refuses a write keeps the behaviour from before tile#84 (pinned here so a change
//     to it is a decision, not an accident).
//
// The design is written down above settleCartAfterOrder in shop-function-template.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completionBody, COMPLETE_COPY, settleCartAfterOrder } from './shop-function-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const CORAL = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(/\nexport \{[\s\S]*?\n\};?\s*$/, '\n');

const GUILD = 'g_paid';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;
const soldKey = (ref) => 'dc-square-shop-sold:' + ref;
const settledKey = (ref, store = GUILD) => `dc-square-shop-settled:${store}:${ref}`;
const SOLD = 'VSOLD';
const HELD = 'VHELD';
const NEW = 'VNEWUNPAID';
const DAY = 86400000;

const record = (lines, t = Date.now()) => JSON.stringify({ t, ids: lines.map((l) => l[0]), lines });

/**
 * A localStorage double that can list its keys (as a browser's can), can refuse a write the way a
 * full origin does, and can stop dead after a number of writes the way a crashed renderer does.
 *
 * `refuse(key, value, map)` returning true throws QuotaExceededError for that setItem.
 * `crashAfter: n` lets n writes (setItem or removeItem) land, then throws on the next one and
 * ignores every write after it: nothing the page runs after that point reaches the disk.
 */
function makeStorage(initial, { refuse = null, crashAfter = Infinity } = {}) {
	const map = new Map(Object.entries(initial || {}));
	let writes = 0, dead = false;
	const write = (fn) => {
		if (dead) return;
		if (writes >= crashAfter) { dead = true; throw new Error('renderer crashed'); }
		writes++;
		fn();
	};
	const ls = {
		get length() { return map.size; },
		key: (i) => [...map.keys()][i] ?? null,
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => write(() => {
			if (refuse && refuse(k, String(v), map)) {
				const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e;
			}
			map.set(k, String(v));
		}),
		removeItem: (k) => write(() => { map.delete(k); })
	};
	return { map, ls, get cart() { return JSON.parse(map.get(CART_KEY) || 'null'); } };
}

/**
 * Open the completion page for `ref` against `ls`, answered `state`.
 *
 * `atReceipt` is the basket as it was on disk at the moment the page drew the paid receipt: the
 * page cannot be closed any earlier than that, so whatever is not settled by then can be left
 * unsettled by a visitor who closes the tab on seeing it.
 */
async function openPage(ls, ref, state = 'paid') {
	const html = completionBody(COMPLETE_COPY['en-US'], 'en-US', '/api/out?ref=' + ref, '/shop', GUILD, true, ref);
	const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
	let atReceipt;
	let body = '';
	const outcome = {
		textContent: '',
		get innerHTML() { return body; },
		set innerHTML(v) { body = String(v); if (atReceipt === undefined) atReceipt = ls.getItem(CART_KEY); }
	};
	const nodes = { 'dc-shop-outcome': outcome, 'dc-shop-heading': { textContent: '', innerHTML: '' } };
	const document = { getElementById: (id) => nodes[id], createElement: () => ({ textContent: '', innerHTML: '' }), title: '' };
	const events = [];
	const window = { dispatchEvent: (e) => { events.push(e.type); return true; } };
	const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, state, lines: [], total_minor: 0, currency: 'USD' }) });
	new Function('document', 'window', 'localStorage', 'fetch', 'CustomEvent', 'setTimeout', script)(
		document, window, ls, fetchImpl, globalThis.CustomEvent, () => 0);
	for (let i = 0; i < 20 && !/\S/.test(nodes['dc-shop-heading'].textContent); i++) await new Promise((r) => setImmediate(r));
	assert.match(nodes['dc-shop-heading'].textContent, /\S/, 'the completion page never answered');
	return { nodes, events, atReceipt: JSON.parse(atReceipt || 'null') };
}

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

const CATALOG = [SOLD, HELD, NEW].map((vid, i) => ({
	id: 'item-' + i, slug: 'item-' + i, title: 'Item ' + i, name: 'Item ' + i, variation_id: vid,
	price_minor: 500, display_price: 5, currency: 'USD'
}));

function coral(store) {
	const document = { readyState: 'complete', head: makeEl('head'), body: makeEl('body'), createElement: (t) => makeEl(t), querySelectorAll: () => [], addEventListener() {} };
	const posts = [];
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		history: { replaceState() {} },
		localStorage: store.ls,
		dispatchEvent: () => true
	};
	const fetchImpl = async (url, init) => {
		posts.push(JSON.parse(init.body));
		return { ok: false, status: 500, json: async () => ({ error: 'not under test' }) };
	};
	const sb = new Function('document', 'window', 'crypto', 'fetch', 'CustomEvent', CORAL + '\nreturn { renderCart, readLabels, withVariantSummary, pruneSoldRecords };')(
		document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	return { sb, posts };
}

/** Load the shop page in cart mode on `store` and press Checkout. Returns what the POST carried. */
async function checkoutFromShop(store) {
	const { sb, posts } = coral(store);
	const root = makeEl('div');
	sb.renderCart(root, CATALOG.map(sb.withVariantSummary), 'https://api.test', GUILD, sb.readLabels(root), false, '/shop', new Map());
	const btns = byClass(root, 'dc-square-shop-checkout');
	assert.equal(btns.length, 1, 'expected exactly one Checkout button');
	for (const fn of btns[0]._listeners.click || []) await fn();
	await new Promise((r) => setTimeout(r, 0));
	return posts.map((p) => p.items.map((l) => [l.variation_id, l.quantity]));
}

// ── the receipt is never drawn over an unsettled basket ───────────────────────────────────────

test('tile#84: the paid lines are off the basket before the receipt is drawn, so closing the tab on it loses nothing', async () => {
	const ref = 'r-closed';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) });
	const page = await openPage(store.ls, ref);
	assert.deepEqual(page.atReceipt, [[SOLD, 1], [HELD, 1]], 'the receipt was drawn over a basket that still held the paid zine');
	assert.ok(page.events.includes('dc-cart-changed'));
	// The tab is closed here. The shop (this coral is byte for byte the one from before tile#84, so
	// this is also the "older coral on the same origin" case) checks out what is left.
	assert.deepEqual(await checkoutFromShop(store), [[[SOLD, 1], [HELD, 1]]], 'the next checkout must not carry the paid zine');
});

// ── the tombstone: a settled order stays settled ─────────────────────────────────────────────

test('tile#84: reopening a settled receipt touches nothing, however much the visitor shopped since', async () => {
	const ref = 'r-reopen';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) });
	await openPage(store.ls, ref);
	assert.ok(store.map.has(settledKey(ref)), 'the paid render leaves its tombstone');
	assert.equal(store.map.has(soldKey(ref)), false, 'and consumes the record');
	store.map.set(CART_KEY, JSON.stringify([[SOLD, 2], [HELD, 1], [NEW, 1]]));
	const again = await openPage(store.ls, ref);
	assert.deepEqual(store.cart, [[SOLD, 2], [HELD, 1], [NEW, 1]], 'nothing comes off a second time, and nothing else goes');
	assert.equal(again.events.includes('dc-cart-changed'), false, 'a render that changed nothing announces nothing');
});

test('review r1 finding 4: an order settled 50 orders ago, reopened, does not clear the basket', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey('old')]: record([[SOLD, 1]]) });
	await openPage(store.ls, 'old');
	for (let i = 0; i < 50; i++) {
		store.map.set(CART_KEY, JSON.stringify([[SOLD, 1], [HELD, 1]]));
		store.map.set(soldKey('later-' + i), record([[SOLD, 1]]));
		await openPage(store.ls, 'later-' + i);
	}
	store.map.set(CART_KEY, JSON.stringify([[NEW, 1]]));
	await openPage(store.ls, 'old');
	assert.deepEqual(store.cart, [[NEW, 1]], 'the old receipt cleared a basket it never had anything to do with');
});

test('review r1 finding 4: junk written over a tombstone still marks the order settled', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey('corrupt')]: record([[SOLD, 1]]) });
	await openPage(store.ls, 'corrupt');
	store.map.set(settledKey('corrupt'), 'not a time');
	store.map.set(CART_KEY, JSON.stringify([[NEW, 1]]));
	await openPage(store.ls, 'corrupt');
	assert.deepEqual(store.cart, [[NEW, 1]]);
});

test('review r2 finding 5: the tombstone outlives the coral\'s week-old sweep; the receipt reopened later touches nothing', async () => {
	const ref = 'r-swept';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) });
	await openPage(store.ls, ref);
	// An unfinished attempt from the same week, so the sweep has something it must remove.
	store.map.set(soldKey('r-abandoned'), record([[HELD, 1]]));
	coral(store).sb.pruneSoldRecords(Date.now() + 8 * DAY);
	assert.equal(store.map.has(soldKey('r-abandoned')), false, 'control: the sweep ran and removed a week-old record');
	assert.ok(store.map.has(settledKey(ref)), 'the sweep must not touch a tombstone');
	store.map.set(CART_KEY, JSON.stringify([[NEW, 1]]));
	await openPage(store.ls, ref);
	assert.deepEqual(store.cart, [[NEW, 1]], 'the reopened receipt cleared a basket filled after its order');
});

test('tile#84: a tombstone names its store and its order; another store, or another order, is not settled by it', async () => {
	const store = makeStorage({
		[CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]),
		[settledKey('r-here', 'g_other')]: '1',
		[settledKey('r-there')]: '1',
		[soldKey('r-here')]: record([[SOLD, 1]])
	});
	await openPage(store.ls, 'r-here');
	assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]], 'only this store\'s tombstone for this order counts');
});

test('tile#84: pending, canceled, refused and unknown answers write no tombstone; the paid one after them settles once', async () => {
	const ref = 'r-pending-then-paid';
	const cart = JSON.stringify([[SOLD, 1], [HELD, 1]]);
	const store = makeStorage({ [CART_KEY]: cart, [soldKey(ref)]: record([[SOLD, 1]]) });
	for (const state of ['pending', 'canceled', 'unknown', 'refunded']) {
		await openPage(store.ls, ref, state);
		assert.equal(store.map.get(CART_KEY), cart, `${state}: an order that has not gone through must not cost a row`);
		assert.ok(store.map.has(soldKey(ref)), `${state}: the record must survive until the order is paid`);
		assert.equal(store.map.has(settledKey(ref)), false, `${state}: nothing may be marked settled`);
	}
	await openPage(store.ls, ref);
	assert.deepEqual(store.cart, [[HELD, 1]]);
	assert.ok(store.map.has(settledKey(ref)));
});

// ── an order with no sold record: exactly as before tile#84, once ─────────────────────────────

test('review r2 finding 4: a later paid order with no sold record clears the basket as before tile#84, after an earlier order settled', async () => {
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey('first')]: record([[SOLD, 1]]) });
	await openPage(store.ls, 'first');
	// The next checkout's record was refused (or an older coral wrote none); that order is paid.
	store.map.set(CART_KEY, JSON.stringify([[SOLD, 1]]));
	await openPage(store.ls, 'second-no-record');
	assert.equal(store.map.has(CART_KEY), false, 'the pre-0.11.16 whole-key clear: the paid line must not stay behind to be charged again');
	assert.deepEqual(await checkoutFromShop(store), [], 'nothing is left to send to the till');
	// ... and only once: what the visitor adds next survives a reload of that receipt.
	store.map.set(CART_KEY, JSON.stringify([[NEW, 1]]));
	await openPage(store.ls, 'second-no-record');
	assert.deepEqual(store.cart, [[NEW, 1]]);
});

// ── a stop between any two writes ───────────────────────────────────────────────────────────

for (const [label, initial, writes, expected] of [
	// writes: 1 tombstone, 2 basket, 3 record. `expected` is the basket after a reload with NEW added.
	['with a sold record', { [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey('r-crash')]: record([[SOLD, 1]]) }, 3,
		{ 0: [[SOLD, 1], [HELD, 1], [NEW, 1]], 1: [[SOLD, 2], [HELD, 1], [NEW, 1]], 2: [[SOLD, 1], [HELD, 1], [NEW, 1]], 3: [[SOLD, 1], [HELD, 1], [NEW, 1]] }],
	// writes: 1 tombstone, 2 whole-key clear. (No record to remove.)
	['with no sold record', { [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]) }, 2,
		// 0: nothing was written, so the reload is the order's first render and takes the whole-key
		// clear, exactly as it would have the first time (the order was never settled).
		{ 0: null, 1: [[SOLD, 2], [HELD, 1], [NEW, 1]], 2: [[NEW, 1]] }]
]) {
	for (let n = 0; n <= writes; n++) {
		test(`tile#84 (${label}): a renderer that stops after ${n} of the settle's ${writes} writes never takes lines twice and never clears a settled order's later basket`, async () => {
			const ref = 'r-crash';
			const store = makeStorage(initial, { crashAfter: n });
			await openPage(store.ls, ref);
			// The visitor comes back and adds a line, then reopens the receipt (a fresh document).
			const after = store.cart;
			store.map.set(CART_KEY, JSON.stringify([...(after || []), [NEW, 1]]));
			const fresh = makeStorage(Object.fromEntries(store.map));
			await openPage(fresh.ls, ref);
			assert.deepEqual(fresh.cart, expected[n]);
			assert.ok(fresh.map.has(settledKey(ref)), 'after the reload the order is marked settled');
		});
	}
}

// ── refused writes: the behaviour from before tile#84, pinned ─────────────────────────────────

test('refused write: the tombstone is refused — the order settles as before tile#84, once; a reload takes the old whole-key clear', async () => {
	const ref = 'r-no-room-for-tombstone';
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) },
		{ refuse: (k) => k === settledKey(ref) });
	const page = await openPage(store.ls, ref);
	assert.deepEqual(page.atReceipt, [[SOLD, 1], [HELD, 1]], 'the paid zine comes off, in the same task');
	assert.equal(store.map.has(soldKey(ref)), false, 'the record is consumed, as before');
	// The listed follow-up case: with neither record nor tombstone, a reload is the pre-tile#84 one.
	store.map.set(CART_KEY, JSON.stringify([[SOLD, 1], [HELD, 1], [NEW, 1]]));
	await openPage(store.ls, ref);
	assert.equal(store.map.has(CART_KEY), false, 'pinned: storage with no room for the tombstone keeps the pre-tile#84 reload');
});

test('refused write: the basket write is refused — nothing comes off, the record and no tombstone stay, and the next render settles once', async () => {
	const ref = 'r-no-room-for-basket';
	let refuseBasket = true;
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey(ref)]: record([[SOLD, 1]]) },
		{ refuse: (k) => refuseBasket && k === CART_KEY });
	const page = await openPage(store.ls, ref);
	assert.match(page.nodes['dc-shop-heading'].textContent, /\S/, 'the receipt is still shown');
	assert.deepEqual(store.cart, [[SOLD, 2], [HELD, 1]], 'nothing came off');
	assert.ok(store.map.has(soldKey(ref)), 'the record is kept for the next render');
	assert.equal(store.map.has(settledKey(ref)), false, 'the tombstone is taken back: a refused basket write is not a settlement');
	assert.equal(page.events.includes('dc-cart-changed'), false);
	refuseBasket = false;
	await openPage(store.ls, ref);
	await openPage(store.ls, ref);
	assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]], 'one zine was paid for, so one comes off, not two');
});

// ── the loop that never retried ─────────────────────────────────────────────────────────────

test('tile#84: the settle reads the basket once and writes it once (0.11.19\'s re-read loop could never see another tab\'s write)', () => {
	// A browser applies another tab's localStorage write to this tab only between tasks, and the
	// 0.11.19 loop's reads all ran in one task: its second read always equalled its first. The loop
	// is gone rather than kept as dead code that looks like protection. This counts the reads, so a
	// re-read put back in the same task fails here.
	const store = makeStorage({ [CART_KEY]: JSON.stringify([[SOLD, 2], [HELD, 1]]), [soldKey('r-once')]: record([[SOLD, 1]]) });
	const get = store.ls.getItem;
	let reads = 0, writes = 0;
	store.ls.getItem = (k) => { if (k === CART_KEY) reads++; return get(k); };
	const set = store.ls.setItem;
	store.ls.setItem = (k, v) => { if (k === CART_KEY) writes++; return set(k, v); };
	settleCartAfterOrder(store.ls, CART_KEY, soldKey('r-once'), settledKey('r-once'));
	assert.equal(reads, 1, 'the basket is read once');
	assert.equal(writes, 1, 'and written once');
	assert.deepEqual(store.cart, [[SOLD, 1], [HELD, 1]]);
});
