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
// Nothing under test here needs the network to SUCCEED: the assistant-name read is allowed to fail
// (that is its documented "change nothing" path) and a transcript fetch only happens for a stored
// handle. What the calls carry is the point — which conversation id this browser asks about and
// sends under is the only place a handle it adopted becomes visible from outside.
const requests = [];
globalThis.fetch = async (url, init = {}) => {
	requests.push({ url, init });
	return { ok: false, status: 500, json: async () => ({}) };
};

/** The conversation id on each transcript GET — the header `fetchTranscript` puts it in. */
const transcriptConvs = (from = 0) =>
	requests.slice(from).filter((r) => r.init.headers && r.init.headers['x-inbox-conversation'])
		.map((r) => r.init.headers['x-inbox-conversation']);

/** The conversation id on each message POST — what the visitor's message is actually filed under. */
const postedConvs = (from = 0) =>
	requests.slice(from).filter((r) => r.init.method === 'POST')
		.map((r) => JSON.parse(r.init.body).conversation_id);

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

/**
 * ONE panel's own way in — a click on its closed bubble, which reaches no other mount on the page.
 * `dispatch('reef-inbox:open')` is a broadcast and every earlier test's panel is still listening,
 * so anything counting what a single mount did (a poller, a request) has to open it like a visitor.
 */
const openBubble = (root) => root.querySelector('.dc-inbox-open').emit('click');

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

// REVIEW B3 (2026-09-08, round 3). The header sentence about hand-offs was pinned by a source regex
// in compose.test.mjs — a test that a claim is WRITTEN DOWN, which is the instrument round 2's B11
// rejected. What the file can actually promise is measured here instead: after a mount the only
// door on `window` is the one that names no conversation, no export takes a handle, and round 2's
// payload moves neither the stored handle nor the id the visitor's next message is filed under.
//
// 🔴 WHAT THIS DOES NOT MEASURE, and the README now says so out loud: a same-origin script that
// writes `reef-inbox:<kind>:<id>` and navigates still chooses that conversation. That intake is
// reachable by any script the site loads, third-party ones included. What removing the event took
// away is the in-place, invisible version — not the capability.

test('B3: the only window listener names no conversation, and no export takes a handle', async () => {
	const api = await import('./inbox-bubble.js');
	const el = new El({ 'data-kind': 'site', 'data-id': `t${++seq}` });
	const key = `reef-inbox:site:${el.attrs['data-id']}`;
	storage.set(key, JSON.stringify({ conv: 'visitor-own', ts: Date.now(), hasEmail: false, mode: 'human' }));
	await mount(el);
	const root = el.children[0];

	assert.deepEqual([...windowListeners.keys()], ['reef-inbox:open'],
		'a second window event type exists — the only one there may be names no conversation');

	// Round 2's payload, addressed to this mount and unaddressed, exactly as the review dispatched
	// it. There is nobody to receive either, and the visitor's own handle does not move.
	const stored = storage.get(key);
	const payload = { target: el, conv: 'ATTACKER-OWNED-CONV-ID', ts: Date.now(), mode: 'human' };
	dispatch('reef-inbox:handle', payload);
	dispatch('reef-inbox:handle', { ...payload, target: undefined });
	assert.equal(windowListeners.has('reef-inbox:handle'), false, 'the hand-off listener is back');
	assert.equal(storage.get(key), stored, 'a dispatched hand-off rewrote the stored handle');

	// Nor is there an export to hand one to. `parseHandle` is the only export that understands the
	// shape at all, and it is a pure reader: given the payload it returns a value and adopts nothing.
	assert.deepEqual(Object.keys(api).filter((name) => /hand|adopt/i.test(name)).sort(),
		['handoffConcluded', 'handoffFormHtml', 'parseHandle', 'refusalNeedsHandoffForm'],
		'an export that takes a handle appeared');
	assert.equal(api.parseHandle(payload).conv, 'ATTACKER-OWNED-CONV-ID');
	assert.equal(storage.get(key), stored, 'parseHandle adopted the handle it was shown');

	// The measurement the review's own probe made: the next message is filed under the id the
	// SERVER minted for this visitor.
	const from = requests.length;
	await openBubble(root);
	composeBox(root).value = 'my next message';
	await root.querySelector('.dc-inbox-form').emit('submit');
	assert.deepEqual(postedConvs(from), ['visitor-own'],
		'the visitor\'s next message was filed under a conversation a page script chose');
});

const DAY = 24 * 60 * 60 * 1000;

// REVIEW B12 (2026-09-08, round 3): the 30-day handle TTL is what the manifest's `stores` entry and
// the README promise a visitor, and since B3 removed the event that had the other copy, `loadHandle`
// is its only enforcement point. It was pinned by a source regex, and the review's mutant —
// `if (false && Date.now() - handle.ts > HANDLE_TTL_MS)` — left that string in place and the whole
// suite green. So it is measured: one panel, one markup, one day either side of the line, and what
// differs is whether the handle is adopted at all.

test('B12: a handle past the 30-day TTL is not adopted at mount, and one inside it is', async () => {
	// 29 days. Adopted: read at mount, opened as the human thread, polled.
	const live = new El({ 'data-kind': 'site', 'data-id': `t${++seq}`, 'data-kaito': '1' });
	const liveKey = `reef-inbox:site:${live.attrs['data-id']}`;
	storage.set(liveKey, JSON.stringify(
		{ conv: 'inside-the-ttl', ts: Date.now() - 29 * DAY, hasEmail: false, mode: 'human' }));
	let from = requests.length;
	let armed = timers.size;
	await mount(live);
	assert.equal(storage.has(liveKey), true, 'a handle inside the TTL was deleted');
	assert.deepEqual(transcriptConvs(from), ['inside-the-ttl'],
		'a handle inside the TTL was not read at mount');
	await openBubble(live.children[0]);
	assert.match(live.children[0].innerHTML, /name="text"/,
		'the adopted thread did not open as the human thread');
	assert.equal(timers.size, armed + 1, 'the adopted thread armed no poller');

	// 31 days. Same markup, same stored shape, only the ts differs: the key is DELETED rather than
	// hidden, nothing is fetched for it, and the panel opens as if this visitor had never written.
	const stale = new El({ 'data-kind': 'site', 'data-id': `t${++seq}`, 'data-kaito': '1' });
	const staleKey = `reef-inbox:site:${stale.attrs['data-id']}`;
	storage.set(staleKey, JSON.stringify(
		{ conv: 'past-the-ttl', ts: Date.now() - 31 * DAY, hasEmail: false, mode: 'human' }));
	from = requests.length;
	armed = timers.size;
	await mount(stale);
	assert.equal(storage.has(staleKey), false, 'the expired handle was left in storage');
	assert.deepEqual(transcriptConvs(from), [], 'the expired conversation was fetched anyway');
	await openBubble(stale.children[0]);
	assert.match(stale.children[0].innerHTML, /name="q"/,
		'the expired handle still opened the human thread');
	assert.doesNotMatch(stale.children[0].innerHTML, /name="text"/);
	assert.equal(timers.size, armed, 'ask mode armed a poller');
});
