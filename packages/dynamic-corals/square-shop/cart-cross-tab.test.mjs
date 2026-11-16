// A shop tab that loaded the basket BEFORE an order, and writes after the paid completion page has
// settled it (tile#328).
//
// The shop coral keeps the basket in memory. Through 0.11.20 its next add/±/remove wrote that whole
// in-memory copy back over the key, so a basket the completion page had already taken the paid
// lines off came back with them in it, ready to be checked out and paid for again.
//
// Three parts are tested here:
//   1. the merge rule (`mergeCartEntries`), as the pure function it is;
//   2. the real renderCart against a storage double, in the case the `storage` listener cannot
//      cover: the click is handled before the other tab's `storage` event is (separate tasks, either
//      can run first; and a page restored from the back/forward cache never receives the event).
//      These fail on 0.11.20, which wrote its stale copy back.
//   3. the same, with another process writing between this tab's write and its next read. These
//      fail on the first 0.11.21 draft, which took the bytes it read back as already taken in.
// The browser half — a real second tab, a real `storage` event — is settle.smoke.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCartEntries } from './square-shop.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(/\nexport \{[\s\S]*?\n\};?\s*$/, '\n');

const GUILD = 'g_crosstab';
const CART_KEY = `dc-square-shop-cart:${GUILD}`;
const ZINE = 'VZINE';
const PA = 'VPRINTA';
const PB = 'VPRINTB';

// ── 1. the merge rule ─────────────────────────────────────────────────────────
// base = what this tab last saw stored · ours = this tab now (with the latest action) · theirs = stored now

test('merge: a line another tab removed (the settle) is not put back by an edit to another line', () => {
	assert.deepEqual(
		mergeCartEntries([[ZINE, 2], [PA, 3]], [[ZINE, 2], [PA, 4]], [[PA, 3]]),
		[[PA, 4]]);
});

test('merge: a line another tab removed is not put back by a write that changed nothing', () => {
	assert.deepEqual(mergeCartEntries([[ZINE, 2], [PA, 3]], [[ZINE, 2], [PA, 3]], [[PA, 3]]), [[PA, 3]]);
	assert.deepEqual(mergeCartEntries([[ZINE, 2]], [[ZINE, 2]], []), []);
});

test('merge: a line this tab just added is kept, even when the stored basket has never heard of it', () => {
	assert.deepEqual(
		mergeCartEntries([[ZINE, 2], [PA, 3]], [[ZINE, 2], [PA, 3], [PB, 1]], [[PA, 3]]),
		[[PA, 3], [PB, 1]]);
	assert.deepEqual(mergeCartEntries([[ZINE, 2]], [[ZINE, 2], [PB, 1]], []), [[PB, 1]],
		'the stored key is gone altogether (a no-record settle clears it): the new line is still written');
});

test('merge: + on a line whose quantity was paid for elsewhere adds ONE, not the stale total plus one', () => {
	assert.deepEqual(mergeCartEntries([[ZINE, 2]], [[ZINE, 3]], []), [[ZINE, 1]]);
	// a partial settle: 2 of 5 were in the order, this tab pressed + once
	assert.deepEqual(mergeCartEntries([[ZINE, 5]], [[ZINE, 6]], [[ZINE, 3]]), [[ZINE, 4]]);
});

test('merge: − on a line that is no longer stored leaves it gone; − on a line another tab grew takes one off', () => {
	assert.deepEqual(mergeCartEntries([[ZINE, 2]], [[ZINE, 1]], []), []);
	assert.deepEqual(mergeCartEntries([[PA, 3]], [[PA, 2]], [[PA, 5]]), [[PA, 4]]);
	assert.deepEqual(mergeCartEntries([[PA, 3]], [[PA, 2]], [[PA, 1]]), [],
		'a change that takes the stored quantity below one removes the line');
});

test('merge: a line this tab removed stays removed, whatever another tab did to it', () => {
	assert.deepEqual(mergeCartEntries([[PA, 3], [PB, 1]], [[PB, 1]], [[PA, 7], [PB, 1]]), [[PB, 1]]);
});

test('merge: a line another tab added or changed, and this tab did not touch, is the stored one', () => {
	assert.deepEqual(
		mergeCartEntries([[PA, 3]], [[PA, 4]], [[PA, 3], [PB, 2]]),
		[[PA, 4], [PB, 2]]);
	assert.deepEqual(mergeCartEntries([[PA, 3], [PB, 1]], [[PA, 4], [PB, 1]], [[PA, 3], [PB, 6]]), [[PA, 4], [PB, 6]]);
});

test('merge: the quantity stays within 1..99', () => {
	assert.deepEqual(mergeCartEntries([[PA, 50]], [[PA, 60]], [[PA, 95]]), [[PA, 99]]);
});

test('merge: nothing changed elsewhere → exactly this tab\'s basket; nothing changed here → exactly the stored one', () => {
	const cases = [
		[[[ZINE, 2], [PA, 3]], [[PA, 3], [PB, 1]]],
		[[], [[ZINE, 1]]],
		[[[ZINE, 2]], []]
	];
	for (const [base, ours] of cases) {
		assert.deepEqual(mergeCartEntries(base, ours, base).map(([v, q]) => [v, q]).sort(),
			ours.slice().sort(), `theirs == base: ${JSON.stringify([base, ours])}`);
		assert.deepEqual(mergeCartEntries(base, base, ours), ours, `ours == base: ${JSON.stringify([base, ours])}`);
	}
});

test('merge: rows that are not [id, qty] come from the stored basket byte for byte, and a 0.11.15 row is read by its quantity', () => {
	const odd = { note: 'from another writer' };
	assert.deepEqual(mergeCartEntries([[PA, 3], 'x'], [[PA, 4], 'x'], [[PA, 3], odd]), [[PA, 4], odd],
		'this tab\'s copy of a foreign row is not resurrected; the stored one is kept');
	assert.deepEqual(mergeCartEntries([[PA, 0, 3]], [[PA, 4]], [[PA, 0, 3]]), [[PA, 4]]);
});

test('merge: order is the stored basket\'s, then lines only this tab has', () => {
	assert.deepEqual(
		mergeCartEntries([], [[PB, 1], [PA, 1]], [[ZINE, 1], [PA, 2]]),
		[[ZINE, 1], [PA, 3], [PB, 1]]);
});

// ── 2. the real renderCart, against a storage double ──────────────────────────

const CATALOG = [
	{ variation_id: ZINE, name: 'Zine', display_price: 20, currency: 'USD', variants: [] },
	{ variation_id: PA, name: 'Print A', display_price: 5, currency: 'USD', variants: [] },
	{ variation_id: PB, name: 'Print B', display_price: 5, currency: 'USD', variants: [] }
];

function makeEl(tag) {
	const el = {
		tagName: String(tag).toUpperCase(), children: [], className: '', textContent: '',
		disabled: false, type: '', href: '', isConnected: true,
		_attrs: Object.create(null), _listeners: Object.create(null), _qs: new Map(), _html: '',
		appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
		append(...cs) { for (const c of cs) { c.parentElement = el; el.children.push(c); } },
		setAttribute(k, v) { el._attrs[k] = String(v); },
		getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
		removeAttribute(k) { delete el._attrs[k]; },
		addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
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

// `refuse`: setItem throws, as a full storage does.
// `afterNextWrite(store)`: runs once, right after this tab's next write of the basket key lands and
// before the coral's next storage call returns: another browser process writing the key in between.
function loadShop(initial, { refuse = false, afterNextWrite = null } = {}) {
	const store = new Map(Object.entries(initial || {}));
	const writes = [];
	const posts = [];
	const winListeners = Object.create(null);
	let interleave = afterNextWrite;
	const localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => {
			if (refuse) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
			writes.push([k, v]); store.set(k, String(v));
			if (k === CART_KEY && interleave) { const fn = interleave; interleave = null; fn(store); }
		},
		removeItem: (k) => { store.delete(k); }
	};
	const document = {
		createElement: makeEl, querySelector: () => null, querySelectorAll: () => [],
		head: makeEl('head'), addEventListener() {}, readyState: 'complete'
	};
	const window = {
		localStorage,
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		dispatchEvent() { return true; },
		addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
		removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); },
		matchMedia: () => ({ matches: false, addEventListener() {} })
	};
	const fetchImpl = async (url, init) => {
		if (init && init.method === 'POST') posts.push(JSON.parse(init.body));
		return { ok: true, status: 200, json: async () => ({ url: 'https://pay.example/checkout/abc' }) };
	};
	const api = new Function('document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { renderCart, readLabels, withVariantSummary };'
	)(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);

	const root = makeEl('div');
	root.setAttribute('data-dynamic-coral', 'square-shop');
	root.setAttribute('data-cart', '1');
	const mountOnce = () => api.renderCart(root, CATALOG.map(api.withVariantSummary), 'https://api.test', GUILD,
		api.readLabels(root), false, '/shop', new Map());
	mountOnce();

	// Another tab writes the key. `deliver`: also hand this tab the `storage` event a browser would.
	const otherTabWrites = (value, deliver) => {
		const oldValue = store.has(CART_KEY) ? store.get(CART_KEY) : null;
		if (value === null) store.delete(CART_KEY); else store.set(CART_KEY, value);
		if (deliver) for (const fn of winListeners.storage || []) fn({ key: CART_KEY, oldValue, newValue: value, storageArea: localStorage });
	};
	const panelLine = (name) => byClass(root, 'dc-square-shop-line')
		.find((l) => byClass(l, 'dc-square-shop-line-name').some((n) => n.textContent === name));
	const press = (el) => Promise.all((el._listeners.click || []).map((fn) => fn()));
	const plusOn = (name) => press(walk(panelLine(name)).find((b) => b.getAttribute && b.getAttribute('aria-label') === 'Increase quantity'));
	const minusOn = (name) => press(walk(panelLine(name)).find((b) => b.getAttribute && b.getAttribute('aria-label') === 'Decrease quantity'));
	const removeOn = (name) => press(byClass(panelLine(name), 'dc-square-shop-rm')[0]);
	const addButtons = () => byClass(root, 'dc-square-shop-buy');
	const checkoutButton = () => byClass(root, 'dc-square-shop-checkout')[0];
	const lineNames = () => byClass(root, 'dc-square-shop-line').map((l) => byClass(l, 'dc-square-shop-line-name')[0].textContent);
	const stored = () => JSON.parse(store.get(CART_KEY) || 'null');
	const afterNextWriteOf = (fn) => { interleave = fn; };
	return { root, store, writes, posts, winListeners, otherTabWrites, plusOn, minusOn, removeOn, press, addButtons,
		checkoutButton, lineNames, stored, mountOnce, afterNextWriteOf };
}

const BEFORE = JSON.stringify([[ZINE, 2], [PA, 3]]);
const SETTLED = JSON.stringify([[PA, 3]]); // what the completion page leaves: the two zines were the order

test('stale tab, event not handled yet: + on another line does not bring the sold zines back', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	assert.deepEqual(t.lineNames(), ['Zine', 'Print A']);
	t.otherTabWrites(SETTLED, false);
	t.plusOn('Print A');
	assert.deepEqual(t.stored(), [[PA, 4]], 'the paid lines were written back (tile#328)');
	assert.deepEqual(t.lineNames(), ['Print A'], 'and the panel shows the basket that was written');
});

test('stale tab, event not handled yet: × and − on another line do not bring them back either', () => {
	const a = loadShop({ [CART_KEY]: JSON.stringify([[ZINE, 2], [PA, 3], [PB, 1]]) });
	a.otherTabWrites(JSON.stringify([[PA, 3], [PB, 1]]), false);
	a.removeOn('Print B');
	assert.deepEqual(a.stored(), [[PA, 3]]);
	const b = loadShop({ [CART_KEY]: BEFORE });
	b.otherTabWrites(SETTLED, false);
	b.minusOn('Print A');
	assert.deepEqual(b.stored(), [[PA, 2]]);
});

test('stale tab, event not handled yet: an Add in this tab is written, and the sold lines stay off', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.otherTabWrites(SETTLED, false);
	assert.equal(t.addButtons().length, 1, 'only Print B is not in the basket');
	t.press(t.addButtons()[0]);
	assert.deepEqual(t.stored(), [[PA, 3], [PB, 1]]);
});

test('stale tab, event not handled yet: + on the sold line adds one zine, not three', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.otherTabWrites(SETTLED, false);
	t.plusOn('Zine');
	assert.deepEqual(t.stored(), [[PA, 3], [ZINE, 1]]);
});

test('stale tab, event not handled yet: Checkout sends nothing the first time, draws the stored basket, then sends that', async () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.otherTabWrites(SETTLED, false);
	await t.press(t.checkoutButton());
	assert.deepEqual(t.posts, [], 'the paid zines were sent to checkout again (tile#328)');
	assert.deepEqual(t.lineNames(), ['Print A']);
	await t.press(t.checkoutButton());
	assert.equal(t.posts.length, 1);
	assert.deepEqual(t.posts[0].items, [{ variation_id: PA, quantity: 3 }]);
});

test('the storage event redraws the basket another tab wrote, and writes nothing itself', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	const writesBefore = t.writes.length;
	t.otherTabWrites(SETTLED, true);
	assert.deepEqual(t.lineNames(), ['Print A']);
	assert.equal(t.writes.length, writesBefore, 'a storage event must never write: two tabs would answer each other');
	// an event for another key, or for sessionStorage, is not this basket
	t.store.set(CART_KEY, BEFORE);
	for (const fn of t.winListeners.storage) fn({ key: 'something-else', storageArea: null });
	for (const fn of t.winListeners.storage) fn({ key: CART_KEY, storageArea: {} });
	assert.deepEqual(t.lineNames(), ['Print A']);
	// storage.clear() in another tab arrives with key === null
	t.store.delete(CART_KEY);
	for (const fn of t.winListeners.storage) fn({ key: null, storageArea: undefined });
	assert.deepEqual(t.lineNames(), []);
});

test('a page restored from the back/forward cache re-reads the basket; a fresh page show does not', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.store.set(CART_KEY, SETTLED); // the receipt settled while this page sat in the cache: no event
	for (const fn of t.winListeners.pageshow) fn({ persisted: false });
	assert.deepEqual(t.lineNames(), ['Zine', 'Print A']);
	for (const fn of t.winListeners.pageshow) fn({ persisted: true });
	assert.deepEqual(t.lineNames(), ['Print A']);
});

test('a storage that refuses writes: lines added in this tab are not dropped by the re-read', () => {
	const t = loadShop({ [CART_KEY]: SETTLED }, { refuse: true });
	t.press(t.addButtons()[0]); // Zine
	t.plusOn('Zine');
	assert.deepEqual(t.lineNames(), ['Print A', 'Zine']);
	assert.deepEqual(t.stored(), [[PA, 3]], 'nothing reached storage');
	const zine = byClass(t.root, 'dc-square-shop-line').find((l) => byClass(l, 'dc-square-shop-line-name')[0].textContent === 'Zine');
	assert.equal(byClass(zine, 'dc-square-shop-qty')[0].textContent, '2');
});

test('a re-mount on the same root replaces the window listeners instead of adding a second set', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	assert.equal(t.winListeners.storage.length, 1);
	t.mountOnce();
	t.mountOnce();
	assert.equal(t.winListeners.storage.length, 1);
	assert.equal(t.winListeners.pageshow.length, 1);
});

test('a root taken out of the page stops listening at the next event', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.root.isConnected = false;
	t.otherTabWrites(SETTLED, true);
	assert.equal(t.winListeners.storage.length, 0);
	assert.equal(t.winListeners.pageshow.length, 0);
});

test('one tab alone: every write is exactly what it was before (no other writer, nothing to merge)', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.plusOn('Print A');
	t.press(t.addButtons()[0]);
	t.minusOn('Zine');
	t.removeOn('Print B');
	assert.deepEqual(t.writes.map(([, v]) => JSON.parse(v)), [
		[[ZINE, 2], [PA, 4]],
		[[ZINE, 2], [PA, 4], [PB, 1]],
		[[ZINE, 1], [PA, 4], [PB, 1]],
		[[ZINE, 1], [PA, 4]]
	]);
});

// ── 3. another process writes between this tab's write and anything it reads next ──────────────
// The completion page settles the order in the instant after this tab wrote its basket. Whatever this
// tab reads next is bytes it never put into its in-memory basket; the tab must not take them as its
// baseline without taking them in. If it did, the completion's own `storage` event (raw === baseline)
// and the Checkout re-read would both see "nothing changed" while the panel still held the paid lines.

const PLUSSED = JSON.stringify([[ZINE, 2], [PA, 4]]);
const SETTLED_AFTER_PLUS = JSON.stringify([[PA, 4]]);

test('a settle that lands right after this tab\'s write: the panel takes it in, the event changes nothing more, Checkout sends no paid line', async () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.afterNextWriteOf((store) => { store.set(CART_KEY, SETTLED_AFTER_PLUS); });
	t.plusOn('Print A');
	assert.deepEqual(t.writes.map(([, v]) => v), [PLUSSED], 'the + itself was written as it was before');
	assert.deepEqual(t.stored(), [[PA, 4]], 'the settle won on disk');
	assert.deepEqual(t.lineNames(), ['Print A'], 'the settle is taken in at once, before its event arrives');
	const writesBefore = t.writes.length;
	t.otherTabWrites(SETTLED_AFTER_PLUS, true); // the completion page's own storage event, delivered late
	assert.deepEqual(t.lineNames(), ['Print A'], 'the paid zines are still on screen after the settle\'s own event');
	assert.equal(t.writes.length, writesBefore, 'taking the settle in writes nothing');
	await t.press(t.checkoutButton());
	await t.press(t.checkoutButton());
	assert.ok(t.posts.length >= 1, 'a checkout was sent');
	for (const p of t.posts) {
		assert.deepEqual(p.items, [{ variation_id: PA, quantity: 4 }], 'the paid zines were sent to checkout again');
	}
});

test('a settle that lands right after this tab\'s write, event never delivered: the next edit does not write the paid lines back', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.afterNextWriteOf((store) => { store.set(CART_KEY, SETTLED_AFTER_PLUS); });
	t.plusOn('Print A');
	t.press(t.addButtons().at(-1)); // Print B: the grid's last card, and never in the basket
	assert.deepEqual(t.stored(), [[PA, 4], [PB, 1]], 'the paid zines were written back by the next edit');
});

test('a whole-key clear that lands right after this tab\'s write (a settle with nothing left): nothing paid stays, nothing paid is sent', async () => {
	const t = loadShop({ [CART_KEY]: JSON.stringify([[ZINE, 2]]) });
	t.afterNextWriteOf((store) => { store.delete(CART_KEY); });
	t.plusOn('Zine');
	assert.equal(t.store.has(CART_KEY), false, 'the clear won on disk');
	t.otherTabWrites(null, true);
	assert.deepEqual(t.lineNames(), [], 'the cleared basket is still on screen after the clear\'s own event');
	const checkout = t.checkoutButton();
	if (checkout && !checkout.disabled) { await t.press(checkout); await t.press(t.checkoutButton()); }
	assert.deepEqual(t.posts, [], 'a cleared basket was sent to checkout');
});

test('a settle that lands right after the mount\'s one automatic write: its event is taken in', () => {
	// A 0.11.15 three-element row makes the mount rewrite the basket in this file's own shape.
	const t = loadShop({ [CART_KEY]: JSON.stringify([[ZINE, 1, 2], [PA, 3]]) },
		{ afterNextWrite: (store) => { store.set(CART_KEY, SETTLED); } });
	assert.deepEqual(t.writes.map(([, v]) => v), [BEFORE], 'the mount wrote the basket in the two-element shape');
	assert.deepEqual(t.lineNames(), ['Print A'], 'the first drawing already shows the settled basket');
	t.otherTabWrites(SETTLED, true);
	assert.deepEqual(t.lineNames(), ['Print A']);
});

test('a write that lands as written is the baseline: one tab alone still rebases nothing', () => {
	const t = loadShop({ [CART_KEY]: BEFORE });
	t.plusOn('Print A');
	t.otherTabWrites(PLUSSED, true); // an event repeating exactly what this tab wrote
	assert.deepEqual(t.lineNames(), ['Zine', 'Print A']);
	assert.deepEqual(t.writes.map(([, v]) => v), [PLUSSED]);
});
