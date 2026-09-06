import test from 'node:test';
import assert from 'node:assert/strict';

// REVIEW B11 (2026-09-08, round 2). compose.test.mjs proves the rules; this file proves the
// WIRING, against the real exported `mount()`.
//
// 🩸 WHY IT HAD TO EXIST. The round-2 review mutated the coral in a /tmp copy and the whole
// 75-test suite stayed green for two mutations a visitor would notice immediately: deleting the
// render call a listener makes, and leaving the focus call in place inside a branch that never
// runs (`if (false && textarea && ...)`). A source regex — which is what the B10 test was — cannot
// tell those apart from working code, because the string it looks for is still there. So the
// panel is actually mounted here, the event is actually dispatched, and what is asserted is what
// the DOM ended up holding.
//
// 🔴 WHAT THIS IS NOT. The DOM, the events, the timers and the network below are the smallest
// stand-ins that let `mount()` run — the shape the reviewer's own harness used, kept deliberately
// close to it so its probes stay replayable against this file. There is no browser here: no real
// CustomEvent, no layout, no scrolling, no focus ORDER, no accessibility tree, no GC. "focused"
// means this file's own `focus()` was called on the node the panel would have focused. A green
// run here is not a browser E2E pass and must not be reported as one.

/** The smallest element that satisfies what `mount()` and its renderers actually touch. */
class El {
	constructor(attrs = {}) {
		this.attrs = attrs;
		this.listeners = {};
		/** Memoised per selector, so two `querySelector` calls for one selector are one node. */
		this.nodes = new Map();
		this.children = [];
		this.value = '';
		this.style = {};
		this.html = '';
		this.parentNode = { insertBefore() {} };
	}

	getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
	setAttribute(name, value) { this.attrs[name] = value; }
	removeAttribute(name) { delete this.attrs[name]; }
	addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
	appendChild(child) { this.children.push(child); return child; }
	insertAdjacentHTML(_where, value) { this.html += value; }
	remove() {}

	set innerHTML(value) {
		this.html = value;
		// A re-render replaces the panel, so the nodes handed out for the old one go with it.
		this.nodes.clear();
	}

	get innerHTML() { return this.html; }

	querySelector(selector) {
		if (!this.nodes.has(selector)) this.nodes.set(selector, new El());
		return this.nodes.get(selector);
	}

	focus() { focused = this; }

	async emit(type) {
		for (const fn of this.listeners[type] ?? []) await fn({ preventDefault() {} });
	}
}

let focused = null;
const windowListeners = new Map();
const storage = new Map();
const timers = new Map();
let timerId = 0;

globalThis.window = {
	localStorage: {
		getItem: (k) => (storage.has(k) ? storage.get(k) : null),
		setItem: (k, v) => storage.set(k, v),
		removeItem: (k) => storage.delete(k)
	},
	addEventListener: (type, fn) => {
		if (!windowListeners.has(type)) windowListeners.set(type, []);
		windowListeners.get(type).push(fn);
	}
};
globalThis.document = {
	readyState: 'loading', // so importing the module registers DOMContentLoaded and mounts nothing
	addEventListener() {},
	documentElement: new El({ lang: 'en' }),
	head: new El(),
	createElement: () => new El(),
	querySelector: () => null,
	querySelectorAll: () => []
};
globalThis.location = { hash: '', hostname: 'example.test', href: 'https://example.test/' };
globalThis.setInterval = (fn) => { timers.set(++timerId, fn); return timerId; };
globalThis.clearInterval = (id) => timers.delete(id);
// Nothing under test here needs the network: the assistant-name read is allowed to fail (that is
// its documented "change nothing" path) and a transcript fetch only happens for a stored handle.
globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });

const { mount } = await import('./inbox-bubble.js');

/** The broadcast, as a page script makes it — every listener on `window`, in registration order. */
function dispatch(type, detail) {
	for (const fn of windowListeners.get(type) ?? []) fn({ detail });
}

function listenerCount() {
	return [...windowListeners.values()].reduce((n, list) => n + list.length, 0);
}

let seq = 0;
/** A fresh mount, with its own tenant so no two tests share a storage key. */
async function mountFresh(attrs = {}) {
	const el = new El({ 'data-kind': 'site', 'data-id': `t${++seq}`, ...attrs });
	await mount(el);
	return { el, root: el.children[0] };
}

/**
 * The compose box of the panel currently rendered into `root`.
 *
 * 🔴 THE ALIAS IS THE STAND-IN'S ONE FICTION, and it is named rather than hidden: a real
 * `root.querySelector('textarea')` and `form.querySelector('textarea')` find the same element,
 * and two independent memo entries here would not. `openPanel`'s refocus reads the first, the
 * renderers write the second, so the alias is what makes them the same node — exactly as the
 * reviewer's own harness did it.
 */
function composeBox(root) {
	const textarea = root.querySelector('.dc-inbox-form').querySelector('textarea');
	root.nodes.set('textarea', textarea);
	return textarea;
}

const isOpen = (root) => root.innerHTML.includes('role="dialog"');
const isClosedBubble = (root) => root.innerHTML.includes('dc-inbox-open');

test('B11: reef-inbox:open opens a mounted panel and focuses the compose box', async () => {
	const { root } = await mountFresh();
	assert.ok(isClosedBubble(root), 'a fresh mount is the closed bubble');
	assert.ok(!isOpen(root));

	focused = null;
	dispatch('reef-inbox:open');

	// 🔴 The mutation this catches: `openPanel` setting `open = true` and not rendering. The flag
	// is invisible; the panel is the thing a visitor sees.
	assert.ok(isOpen(root), 'the event set a flag but never rendered the panel');
	assert.ok(focused, 'the panel opened without putting the cursor anywhere');
	assert.equal(focused, composeBox(root), 'something other than the compose box took focus');
});

test('B11: an already-open panel refocuses, and does not throw away the draft', async () => {
	const { root } = await mountFresh();
	dispatch('reef-inbox:open');
	const textarea = composeBox(root);
	textarea.value = 'half-typed message';
	const renderedOnce = root.innerHTML;

	focused = null;
	dispatch('reef-inbox:open');

	// 🔴 The mutation this catches: `if (false && textarea && textarea.focus) textarea.focus();`.
	// The call is still in the source, so a regex still finds it; the cursor still never moves,
	// and the site's own "report a problem" link still reads as a dead click (B10).
	assert.equal(focused, textarea, 'the second open did not refocus the compose box');
	assert.equal(textarea.value, 'half-typed message', 're-rendering discarded the draft');
	assert.equal(root.innerHTML, renderedOnce, 'the already-open branch re-rendered the panel');
});

test('B11: the event is inert where the coral is not mounted', async () => {
	// The guard at the top of mount(): no data-id, so nothing is wired at all.
	const before = listenerCount();
	const el = new El({ 'data-kind': 'site' });
	await mount(el);
	assert.equal(listenerCount(), before, 'a failed mount registered a window listener');
	assert.match(el.innerHTML, /missing data-kind \/ data-id/);
	assert.equal(el.children.length, 0, 'a failed mount built a panel anyway');

	focused = null;
	dispatch('reef-inbox:open');
	assert.match(el.innerHTML, /missing data-kind \/ data-id/, 'the event rendered into a failed mount');
});

test('B11: one window listener per successful mount, and it is the only kind there is', async () => {
	const before = listenerCount();
	await mountFresh();
	assert.equal(listenerCount(), before + 1, 'a mount installs exactly one window listener');
	// 🔴 B3, round 2: `reef-inbox:handle` is gone. A page script can ask a panel to OPEN — that
	// names no conversation — and there is no event through which it can name one.
	assert.deepEqual([...windowListeners.keys()], ['reef-inbox:open']);
});

test('B11: #inbox opens the panel only for a site that opted in', async () => {
	location.hash = '#inbox';
	try {
		const plain = await mountFresh();
		assert.ok(isClosedBubble(plain.root), '#inbox opened a panel the site never opted into');
		assert.ok(!isOpen(plain.root));

		focused = null;
		const optedIn = await mountFresh({ 'data-open-on-hash': '1' });
		assert.ok(isOpen(optedIn.root), 'the opt-in did not honour #inbox');
		assert.equal(focused, composeBox(optedIn.root), 'the auto-opened panel took no focus');

		// Not a prefix match, opt-in or not (the site's own <h2 id="inbox-pricing">).
		location.hash = '#inbox-pricing';
		const near = await mountFresh({ 'data-open-on-hash': '1' });
		assert.ok(isClosedBubble(near.root), 'a fragment that merely starts with #inbox opened it');
	} finally {
		location.hash = '';
	}
});

test('B11: a mount whose panel is open still answers the event, and the stored handle is untouched', async () => {
	// The storage key is written by the visitor's own actions only — nothing about opening a panel
	// mints, adopts or rewrites a handle. This is the B3 invariant, observed from the outside.
	const el = new El({ 'data-kind': 'site', 'data-id': `t${++seq}` });
	storage.set(`reef-inbox:site:${el.attrs['data-id']}`,
		JSON.stringify({ conv: 'server-minted', ts: Date.now(), hasEmail: false, mode: 'human' }));
	await mount(el);
	const stored = storage.get(`reef-inbox:site:${el.attrs['data-id']}`);

	dispatch('reef-inbox:open');
	assert.ok(isOpen(el.children[0]));
	assert.equal(storage.get(`reef-inbox:site:${el.attrs['data-id']}`), stored,
		'opening the panel rewrote the visitor\'s handle');
});
