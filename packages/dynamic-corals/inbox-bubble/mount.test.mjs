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
	},
	// Browser semantics: removes the first registration of that exact function, and a function
	// that was never registered is a silent no-op. The key stays, so B3's key list is unaffected.
	removeEventListener: (type, fn) => {
		const list = windowListeners.get(type);
		const at = list ? list.indexOf(fn) : -1;
		if (at >= 0) list.splice(at, 1);
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
/**
 * A test's own router, or `null` for the default failure above. It is set for the ruling-54 tests
 * at the bottom, which are the only ones here that need an endpoint to ANSWER — a KAITO answer to
 * plant the machine's words in, and a claim probe that says yes so the questions may leave at all.
 */
let respond = null;

/**
 * The claim probe's default answer — `GET /api/inbox/session` — so that every test above the claim
 * gate section is a mount on a tenant that HAS an Inbox, i.e. the control: what such a mount does
 * must not have changed. Two shapes of tenant are uneven on purpose (an Inbox and none, `site` and
 * `ext`): an id starting `off-` has no Inbox, and `claimScript` lets one id answer a scripted
 * sequence — one entry per request — to drive the retry path. An entry is a response object, a
 * function to call (to throw, or to hang), or `undefined` for the default 500 below.
 */
const claimScript = new Map();
function claimRoute(url, init) {
	if (!url.includes('/api/inbox/session') || init.method === 'POST') return undefined;
	const id = new URL(url).searchParams.get('id');
	if (claimScript.has(id)) {
		const step = claimScript.get(id).shift();
		return typeof step === 'function' ? step() : step;
	}
	return { ok: true, status: 200, json: async () => ({ ok: true, claimed: !id.startsWith('off-') }) };
}
globalThis.fetch = async (url, init = {}) => {
	requests.push({ url, init });
	return respond?.(url, init) ?? claimRoute(url, init) ?? { ok: false, status: 500, json: async () => ({}) };
};

/**
 * Every delay of a second or more that the coral asks for, recorded and then run almost at once —
 * the claim gate's retry schedule is measured here rather than waited for. The per-request timeout
 * (fifteen seconds) runs after 25 ms instead of 0, so a stubbed reply that is merely a promise away
 * still wins the race, and only a request that never comes back loses it. Shorter timers (this
 * file's own `settle`) keep their real meaning.
 */
const longDelays = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0, ...rest) => {
	if (ms >= 1000) {
		longDelays.push(ms);
		return realSetTimeout(fn, ms === 15_000 ? 25 : 0, ...rest);
	}
	return realSetTimeout(fn, ms, ...rest);
};

/**
 * The beacon, which is the path a real `pagehide` takes and the one `requests` cannot see.
 *
 * 🔴 Node has its own `navigator` (a read-only accessor on `globalThis`), so it is REPLACED here
 * rather than assigned — without this the coral finds no `sendBeacon`, silently falls through to
 * the keepalive fetch, and a test believing it measured the beacon measured the other branch.
 */
const beacons = [];
let beaconResult = true;
const sendBeacon = (url, body) => (beacons.push({ url, body }), beaconResult);
const navStub = { sendBeacon };
Object.defineProperty(globalThis, 'navigator', { value: navStub, configurable: true, writable: true });

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The conversation id on each transcript GET — the header `fetchTranscript` puts it in. */
const transcriptConvs = (from = 0) =>
	requests.slice(from).filter((r) => r.init.headers && r.init.headers['x-inbox-conversation'])
		.map((r) => r.init.headers['x-inbox-conversation']);

/** The conversation id on each message POST — what the visitor's message is actually filed under. */
const postedConvs = (from = 0) =>
	requests.slice(from).filter((r) => r.init.method === 'POST')
		.map((r) => JSON.parse(r.init.body).conversation_id);

const coral = await import('./inbox-bubble.js');
const { mount } = coral;

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

test('B11: the window listeners per successful mount are the two there may be', async () => {
	const before = listenerCount();
	await mountFresh();
	// Two since 0.7.6: `reef-inbox:open` and ruling 54's `pagehide`.
	assert.equal(listenerCount(), before + 2, 'a mount installs a listener nobody named');
	// 🔴 B3, round 2: `reef-inbox:handle` is gone. A page script can ask a panel to OPEN — that
	// names no conversation — and there is no event through which it can name one. `pagehide` is
	// the browser's own event and carries nothing a page script chooses.
	assert.deepEqual([...windowListeners.keys()], ['reef-inbox:open', 'pagehide']);
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

test('tile #14: a de-DE page with a German title and placeholder gets German chrome, not English', async () => {
	// The reported panel: reef's marketing site sets these two through data-*, and until tile #14
	// everything else in the panel — Send, Close, the bubble's own name — was English beside them.
	document.documentElement.setAttribute('lang', 'de-DE');
	try {
		const { root } = await mountFresh({ 'data-title': 'Schreiben Sie uns', 'data-placeholder': 'Ihre Nachricht…' });
		assert.match(root.innerHTML, /aria-label="Nachricht senden"/, 'the closed bubble is named in English');
		openBubble(root);
		const html = root.innerHTML;
		assert.match(html, /aria-label="Schreiben Sie uns"/);
		assert.match(html, />Senden</, 'the Send button is not German');
		assert.match(html, /aria-label="Schließen"/, 'the close button is not named in German');
		assert.doesNotMatch(html, />Send<|aria-label="Close"/, 'English chrome beside a German title');
	} finally {
		document.documentElement.setAttribute('lang', 'en');
	}
});

test('tile#20: a mount without KAITO shows a status line — the locale default, or data-status', async () => {
	// The reported panel: kind=ext, no data-kaito. Site name, ×, the form and Send, and nothing
	// saying who reads what is sent.
	const plain = await mountFresh({ 'data-kind': 'ext', 'data-title': 'Aria only' });
	openBubble(plain.root);
	assert.match(plain.root.innerHTML, /<p class="dc-inbox-status">A person reads what you send<\/p>/,
		'a no-KAITO panel rendered no status line');
	// data-title stays the dialog's accessible name and nothing more — it is not the visible line.
	assert.match(plain.root.innerHTML, /role="dialog" aria-label="Aria only"/);
	assert.doesNotMatch(plain.root.innerHTML, />Aria only</, 'data-title became visible text');

	const custom = await mountFresh({ 'data-kind': 'ext', 'data-status': '  a person <b>reads</b> it\nnot this  ' });
	openBubble(custom.root);
	assert.match(custom.root.innerHTML, /<p class="dc-inbox-status">a person &lt;b&gt;reads&lt;\/b&gt; it<\/p>/,
		'data-status was not rendered as one escaped line');
	assert.doesNotMatch(custom.root.innerHTML, /not this/);
});

test('tile#20: data-status cannot replace the AI disclosure on a KAITO mount', async () => {
	const { root } = await mountFresh({ 'data-kaito': '1', 'data-status': 'Mei reads every message herself' });
	openBubble(root);
	assert.match(root.innerHTML, /<p class="dc-inbox-status">KAITO<span class="dc-inbox-ai-chip"/,
		'the AI status line was replaced by data-status');
	assert.doesNotMatch(root.innerHTML, /Mei reads every message herself/);
});

test('B3: the only window listener names no conversation, and no export takes a handle', async () => {
	const api = await import('./inbox-bubble.js');
	const el = new El({ 'data-kind': 'site', 'data-id': `t${++seq}` });
	const key = `reef-inbox:site:${el.attrs['data-id']}`;
	storage.set(key, JSON.stringify({ conv: 'visitor-own', ts: Date.now(), hasEmail: false, mode: 'human' }));
	await mount(el);
	const root = el.children[0];

	assert.deepEqual([...windowListeners.keys()], ['reef-inbox:open', 'pagehide'],
		'a window event type nobody named exists — neither of the two may name a conversation');

	// Round 2's payload, addressed to this mount and unaddressed, exactly as the review dispatched
	// it. There is nobody to receive either, and the visitor's own handle does not move.
	const stored = storage.get(key);
	const payload = { target: el, conv: 'ATTACKER-OWNED-CONV-ID', ts: Date.now(), mode: 'human' };
	dispatch('reef-inbox:handle', payload);
	dispatch('reef-inbox:handle', { ...payload, target: undefined });
	assert.equal(windowListeners.has('reef-inbox:handle'), false, 'the hand-off listener is back');
	assert.equal(storage.get(key), stored, 'a dispatched hand-off rewrote the stored handle');

	// Nor is there an export to hand one to. 🩸 REVIEW B15 (round 4): this used to be a list of
	// export NAMES matching /hand|adopt/ — which measures spelling, not capability. An export
	// called `restore(tenant, conv)` that writes the handle key passes a name filter untouched.
	// So every exported function is CALLED here, with every shape a conversation id could arrive
	// in, and one level into whatever object it returns; what is asserted is that the visitor's
	// stored handle did not move — and, below, that the next message is still filed under it.
	const tenant = `site:${el.attrs['data-id']}`;
	const conv = 'ATTACKER-OWNED-CONV-ID';
	const argShapes = [
		[payload], [conv], [JSON.stringify(payload)], [tenant, conv], [tenant, payload],
		[tenant, JSON.stringify(payload)], [tenant, conv, true, 'human'], [key, conv],
		[{ ...payload, tenant, kind: 'site', id: el.attrs['data-id'], handle: conv, storage: window.localStorage }]
	];
	const calls = async (fn, self) => {
		let n = 0;
		for (const args of argShapes) {
			let out;
			try { out = fn.apply(self, args); n++; } catch { continue; }
			try { out = await out; } catch { continue; }
			if (out && typeof out === 'object' && !Array.isArray(out)) {
				for (const m of Object.values(out)) {
					if (typeof m !== 'function') continue;
					for (const inner of argShapes) {
						try { await m.apply(out, inner); n++; } catch { /* a refusal is the point */ }
					}
				}
			}
		}
		return n;
	};
	let probed = 0;
	for (const [name, fn] of Object.entries(api)) {
		// `mount` is excluded only because the first argument it wants is an element, and handing
		// it THIS element would be a second mount, not an intake; `mountAll` finds none here.
		if (typeof fn !== 'function' || name === 'mount') continue;
		probed += await calls(fn, api);
		await settle();
		assert.equal(storage.get(key), stored, `export \`${name}\` adopted the handle it was shown`);
		// The second key (review D12): the question buffer carries a handle that goes onto the wire.
		const buffered = storage.get(`reef-inbox:ai:${tenant}`);
		assert.equal(buffered && buffered.includes(`"handle":"${conv}"`), false,
			`export \`${name}\` filed the buffered questions under the handle it was shown`);
	}
	// A probe that reached no export is measuring nothing — this file has ~30 functions exported.
	assert.ok(probed > 50, `only ${probed} calls completed — the harness is not reaching the exports`);

	// The measurement the review's own probe made: the next message is filed under the id the
	// SERVER minted for this visitor.
	const from = requests.length;
	await openBubble(root);
	composeBox(root).value = 'my next message';
	await root.querySelector('.dc-inbox-form').emit('submit');
	assert.deepEqual(postedConvs(from), ['visitor-own'],
		'the visitor\'s next message was filed under a conversation a page script chose');
	// The probe above filled this tenant's question buffer with junk; take the mount (and its
	// `pagehide` listener) off the page so later tests' pagehide does not send it.
	assert.equal(api.unmount(el), true);
});

// REVIEW B9 (2026-09-08, closed in 0.7.9). Every mount added two `window` listeners and nothing
// could remove them, so an SPA that mounted and dropped the same kind of container on each route
// change grew a pair per visit, each holding a detached panel. Measured here as a COUNT across N
// real mount/unmount cycles — the number of listeners on `window`, and the number of live pollers.

test('B9: mounting and unmounting N times leaves no listener or poller behind', async () => {
	const { unmount } = await import('./inbox-bubble.js');
	const count = () => [...windowListeners.values()].reduce((n, list) => n + list.length, 0);
	const before = count();
	const pollersBefore = timers.size;
	const el = new El({ 'data-kind': 'site', 'data-id': `t${++seq}` });
	const key = `reef-inbox:site:${el.attrs['data-id']}`;
	// A stored handle, so the mount also starts a transcript read and — once opened — a poller.
	storage.set(key, JSON.stringify({ conv: 'visitor-own', ts: Date.now(), hasEmail: false, mode: 'human' }));
	const stored = storage.get(key);
	const N = 25;
	for (let i = 0; i < N; i++) {
		el.setAttribute('data-dynamic-coral-mounted', '1');
		await mount(el);
		assert.ok(count() > before, 'a mount added no window listener — this test is measuring nothing');
		await openBubble(el.children[el.children.length - 1]);
		assert.ok(timers.size > pollersBefore, 'an open panel started no poller — nothing to stop');
		assert.equal(unmount(el), true, 'unmount did not recognise an element mount() set up');
		assert.equal(el.getAttribute('data-dynamic-coral-mounted'), null, 'the mounted flag was left set');
	}
	await settle();
	assert.equal(count(), before, `${count() - before} window listeners left after ${N} cycles`);
	assert.equal(timers.size, pollersBefore, 'a poller outlived its unmount');
	// Unmounting twice, or an element this file never mounted, is a no-op rather than a throw.
	assert.equal(unmount(el), false);
	assert.equal(unmount(new El()), false);
	// The visitor's conversation outlives the panel, as it outlives a navigation.
	assert.equal(storage.get(key), stored, 'unmount touched the stored handle');
	// And a dispatch after the last unmount reaches nobody from this element.
	const rendered = el.children.map((c) => c.innerHTML);
	dispatch('reef-inbox:open');
	assert.deepEqual(el.children.map((c) => c.innerHTML), rendered, 'an unmounted panel re-rendered on reef-inbox:open');
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

// ── ruling 54, observed from the outside ────────────────────────────────────────────────────
//
// compose.test.mjs drives `createAiLog` directly. What is measured HERE is what an ordinary page
// view actually costs a visitor, against the real `mount()`: the listener that exists, the storage
// key it writes, and — the number that matters — how many requests leave when nobody asked
// anything.

/** Every `pagehide` handler on `window`, as the browser would fire them. */
const firePagehide = () => {
	for (const fn of windowListeners.get('pagehide') ?? []) fn({});
};

test('54: an ordinary page view — nobody asked anything — sends NOTHING on pagehide', async () => {
	await mountFresh();
	const from = requests.length;
	beacons.length = 0;
	firePagehide();
	// 🔴 The whole cost claim, measured rather than asserted in prose: a visit where nobody typed
	// a question reaches the network exactly as often as it did before ruling 54 existed. Both
	// channels are counted — a beacon does not appear in `requests`, so counting only that array
	// would have called a beacon-shaped leak zero.
	assert.deepEqual(requests.slice(from).map((r) => r.url), []);
	assert.deepEqual(beacons, []);
});

test('54: the buffer is beside the handle, never inside it', async () => {
	const { el } = await mountFresh();
	const id = el.attrs['data-id'];
	// The page view is recorded locally, under its OWN key — a reader of the handle key sees the
	// same bytes it always did, which is what keeps `parseHandle`'s shape a shape.
	const buffer = JSON.parse(storage.get(`reef-inbox:ai:site:${id}`));
	assert.deepEqual(buffer.pages, ['/']);
	assert.equal(buffer.questions.length, 0);
	assert.ok(buffer.sid);
	// The claim gate asked before drawing, but under its own key: the log's answer is still its own.
	assert.equal(buffer.claim, null, 'the gate wrote its answer into the log');
	assert.equal(storage.has(`reef-inbox:site:${id}`), false, 'a mount minted a handle');
});

test('54: data-ai-log="0" installs no pagehide listener and writes no buffer', async () => {
	const before = listenerCount();
	const { el } = await mountFresh({ 'data-ai-log': '0' });
	assert.equal(listenerCount(), before + 1, 'the opt-out still wired a pagehide listener');
	assert.equal(storage.has(`reef-inbox:ai:site:${el.attrs['data-id']}`), false);
});

// ── review D3: the machine's answer, measured in BYTES against the real mount() ──────────────
//
// 🩸 THE RULE WITH NO RULER. Four documents say the machine's answers never leave, and the review
// put one on the wire by editing two tokens at the single call site — `answer.source_url` became
// `answer.text` — with all hundred tests green. compose.test.mjs now enumerates the key sets;
// what is measured HERE is the only thing that catches a wrong VALUE in a right-shaped field:
// a real answer, driven through the real `mount()`, and then every byte this mount handed to the
// network searched for it.
//
// 🔴 THE SENTINEL IS PLANTED EVERYWHERE IT COULD LIVE — in the KAITO response, in the buffer's
// own cell under three field names it does not have, and inside the question row. What the assert
// says is not「the field we remembered to check is clean」but「the string is in none of the bytes」.

const AI_ANSWER = 'KAITO-SAID-THIS-AND-IT-MUST-NEVER-TRAVEL';
const CITED = 'https://example.test/faq#stock';

/** A site with an Inbox, whose KAITO answers with a cited passage — and with the sentinel in it. */
const claimedSiteAnswering = () => (url) => {
	if (url.includes('/api/kaito')) {
		return { ok: true, status: 200, json: async () => ({ kind: 'grounded', text: AI_ANSWER, source_url: CITED }) };
	}
	if (url.includes('/api/inbox/session')) {
		return { ok: true, status: 200, json: async () => ({ ok: true, claimed: true }) };
	}
	return undefined;
};

/** Everything that left this mount, as text: beacon bodies and fetch bodies alike. */
const bytesSent = (from) => [
	...beacons.map((b) => b.body),
	...requests.slice(from).map((r) => String(r.init.body ?? ''))
];

/** One visitor, one question, on a claimed site whose KAITO answers. Returns the tenant id. */
async function askOneQuestion(question = 'do you ship to Japan?') {
	const { el, root } = await mountFresh({ 'data-kaito': '1' });
	const id = el.attrs['data-id'];
	respond = claimedSiteAnswering();
	await openBubble(root);

	// The answer, planted in the buffer under every name a future field might have — including
	// inside the question row itself, which is where M21 put it.
	const key = `reef-inbox:ai:site:${id}`;
	const planted = JSON.parse(storage.get(key));
	planted.answer = AI_ANSWER;
	planted.transcript = [{ role: 'assistant', text: AI_ANSWER }];
	planted.lastAnswer = { kind: 'grounded', text: AI_ANSWER, source_url: CITED };
	planted.questions = [{ text: 'an earlier question', page: '/', hit: null, lang: '', at: 1,
		answer: AI_ANSWER }];
	storage.set(key, JSON.stringify(planted));

	composeBox(root).value = question;
	await root.querySelector('.dc-inbox-form').emit('submit');
	await settle(); // the claim probe is a promise, and nothing may leave before it answers
	return { el, root, id, key };
}

test('D3: the answer is in no byte the beacon sends, and the body has only the contract keys', async () => {
	const { id } = await askOneQuestion();
	const from = requests.length;
	beacons.length = 0;
	beaconResult = true;
	firePagehide();

	assert.equal(beacons.length, 1, 'the questions did not leave as a beacon');
	const body = JSON.parse(beacons[0].body);
	assert.deepEqual(Object.keys(body).sort(), ['id', 'kind', 'pages', 'questions', 'session_id'],
		'the wire body grew a key the contract does not name');
	assert.equal(body.id, id);
	for (const row of body.questions) {
		assert.deepEqual(Object.keys(row), ['text', 'page', 'hit', 'lang', 'at'],
			'a question row grew a field nobody whitelisted');
	}
	// The visitor's own sentence travelled, and the citation — a URL — travelled with it.
	assert.equal(body.questions[body.questions.length - 1].text, 'do you ship to Japan?');
	assert.equal(body.questions[body.questions.length - 1].hit, CITED);

	// 🔴 THE MEASUREMENT. Not「the field we checked is clean」: the string is in none of the bytes.
	for (const sent of bytesSent(from)) {
		assert.equal(sent.includes(AI_ANSWER), false, `the machine's answer left in: ${sent}`);
	}
});

test('D3: the same is true of the keepalive fetch path — no browser has a cleaner branch', async () => {
	delete navStub.sendBeacon;
	try {
		await askOneQuestion('can I return it?');
		const from = requests.length;
		beacons.length = 0;
		firePagehide();

		const posts = requests.slice(from).filter((r) => r.url.includes('/api/inbox/session'));
		assert.equal(posts.length, 1, 'without sendBeacon the session did not go by fetch');
		assert.equal(posts[0].init.keepalive, true);
		const body = JSON.parse(posts[0].init.body);
		assert.deepEqual(Object.keys(body).sort(), ['id', 'kind', 'pages', 'questions', 'session_id']);
		assert.equal(beacons.length, 0, 'a beacon went out through a navigator that has none');
		for (const sent of bytesSent(from)) {
			assert.equal(sent.includes(AI_ANSWER), false, `the machine's answer left in: ${sent}`);
		}
	} finally {
		navStub.sendBeacon = sendBeacon;
		respond = null;
	}
});

// tile#19 — the compose form's honeypot, as `mount()` actually renders it (compose.test.mjs covers
// the hand-off form's). Why inline and not only the `.dc-inbox-hp` rule is written there: on a
// layered site that rule is in `@layer reef.corals` and any unlayered host `label` rule wins.
// 🔴 Markup only — no layout in this harness; honeypot.smoke.mjs is the browser half.
test('tile#19: the compose honeypot that mount() renders hides itself inline', async () => {
	const { root } = await mountFresh();
	await openBubble(root);
	assert.ok(isOpen(root));
	const label = root.innerHTML.match(/<label class="dc-inbox-hp"[^>]*>/)?.[0];
	assert.ok(label, 'the compose form lost its honeypot label');
	const style = Object.fromEntries((label.match(/style="([^"]*)"/)?.[1] ?? '')
		.split(';').filter(Boolean).map((d) => d.split(':').map((s) => s.trim())));
	assert.equal(style.position, 'absolute', `no inline off-screen position on ${label}`);
	assert.equal(style.left, '-9999px');
	assert.equal(style.opacity, '0');
	assert.match(label, /aria-hidden="true"/);
	const input = root.innerHTML.match(/<input[^>]*name="_hp"[^>]*>/)?.[0];
	assert.match(input, /tabindex="-1"/);
	assert.match(input, /autocomplete="off"/);
});

// ── the claim gate: a bubble only where a message can actually arrive ──────────────────────────
//
// 🩸 THE FAILURE THIS EXISTS FOR. A site layout turned the bubble on for every site at build time,
// and a build cannot know whether that site's Inbox was ever opened; the server refuses every
// message for a tenant without one, on purpose (nothing may switch itself on because a stranger
// used it). Both halves were right and together they were a button that fails every time it is
// pressed — on live sites, whose owners had no way to know. So the coral asks first.
//
// 🔴 THE RULER. No Inbox ⇒ nothing in the DOM (not a hidden node: no node). An Inbox ⇒ exactly
// what a mount did before the gate — measured against digests taken from the coral as it was
// before this section existed, not against itself. Cannot ask ⇒ nothing, retried on a fixed
// schedule up to a cap, and rendered the moment an answer arrives. A reply of the wrong shape is
// not an answer, and in particular not a yes.

/** Requests to the claim probe, from `from` on. */
const probes = (from = 0) =>
	requests.slice(from).filter((r) => r.url.includes('/api/inbox/session') && r.init.method !== 'POST');
/** Run every queued timer and promise until nothing moves — the retry schedule compressed. */
async function drain() {
	for (let round = 0; round < 6; round++) {
		for (let i = 0; i < 20; i++) await settle();
		await new Promise((r) => realSetTimeout(r, 30)); // past a compressed per-request timeout
	}
}
/** Every long delay except the per-request timeout's own — i.e. the waits between attempts. */
const PROBE_TIMEOUT_MS = 15_000;
const gaps = (from = 0) => longDelays.slice(from).filter((ms) => ms !== PROBE_TIMEOUT_MS);
const claimKey = (kind, id) => `reef-inbox:claim:${kind}:${id}`;
const SIX_HOURS = 6 * 60 * 60 * 1000;

/** What a page holds for this mount: the container's own children and any markup it was given. */
const nothingRendered = (el) => el.children.length === 0 && el.innerHTML === '';

// Digests of the panel exactly as the coral rendered it BEFORE the gate (taken from the unmodified
// file with this harness, three uneven tenants): the closed bubble, and the panel after one click.
const BEFORE = {
	closed: 'e87af6e900c15525',
	open: {
		site_kaito: 'f7b8b561c001101f',
		site_status: '5be86597072e2e67',
		ext_plain: 'efd03fa789db6e44'
	}
};
const { createHash } = await import('node:crypto');
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

test('gate: a tenant with no Inbox and no KAITO renders nothing — no node, no listener, no other request', async () => {
	// 🩸 Until 0.7.11 this mount carried `data-kaito="1"`, so the test pinned the regression it was
	// written beside: the ask-the-site half disappearing with the Inbox. That mount now has its own
	// section at the bottom of this file; this one is the tenant with neither.
	for (const kind of ['site', 'ext']) {
		const before = listenerCount();
		const from = requests.length;
		const el = new El({ 'data-kind': kind, 'data-id': `off-${kind}-1` });
		await mount(el);
		await drain();
		assert.ok(nothingRendered(el), `${kind}: an unclaimed tenant still got a bubble`);
		assert.equal(listenerCount(), before, `${kind}: an unclaimed mount installed a window listener`);
		// The probe is the one request, and a definite no is not retried.
		assert.deepEqual(requests.slice(from).map((r) => new URL(r.url).pathname), ['/api/inbox/session']);
		// Nothing written to this visitor's storage either: no buffer, no handle, no remembered no.
		assert.equal([...storage.keys()].some((k) => k.includes(`off-${kind}-1`)), false);
		// And the two programmatic ways in stay inert, because there is no panel for them to open.
		dispatch('reef-inbox:open');
		assert.ok(nothingRendered(el));
	}
});

test('gate: two tenants on one page, one with an Inbox and one without — only that one renders', async () => {
	const on = new El({ 'data-kind': 'ext', 'data-id': 'mixed-on' });
	const off = new El({ 'data-kind': 'site', 'data-id': 'off-mixed' });
	await Promise.all([mount(on), mount(off)]);
	await drain();
	assert.equal(digest(on.children[0].innerHTML), BEFORE.closed);
	assert.ok(nothingRendered(off));
});

test('gate: a tenant with an Inbox gets the bubble the coral rendered before the gate, byte for byte', async () => {
	const configs = {
		site_kaito: { 'data-kind': 'site', 'data-id': 'gold-1', 'data-kaito': '1', 'data-site-name': 'Example Shop' },
		site_status: { 'data-kind': 'site', 'data-id': 'gold-2', 'data-status': 'Hello there' },
		ext_plain: { 'data-kind': 'ext', 'data-id': 'gold-3' }
	};
	for (const [name, attrs] of Object.entries(configs)) {
		const before = listenerCount();
		const from = requests.length;
		const el = new El({ ...attrs });
		await mount(el);
		await settle();
		assert.equal(el.children.length, 1, name);
		assert.equal(digest(el.children[0].innerHTML), BEFORE.closed, `${name}: closed bubble changed`);
		assert.equal(listenerCount(), before + 2, `${name}: not the two window listeners a mount had`);
		// Apart from the probe, the same requests as before: the one assistant-name read.
		assert.deepEqual(requests.slice(from).map((r) => new URL(r.url).pathname),
			['/api/inbox/session', '/api/inbox/assistant'], name);
		await el.children[0].querySelector('.dc-inbox-open').emit('click');
		await settle();
		assert.equal(digest(el.children[0].innerHTML), BEFORE.open[name], `${name}: open panel changed`);
	}
});

test('gate: a yes is remembered for six hours and the next mount draws at once; a no is never kept', async () => {
	const first = new El({ 'data-kind': 'site', 'data-id': 'memo-1' });
	await mount(first);
	const stored = JSON.parse(storage.get(claimKey('site', 'memo-1')));
	assert.equal(stored.claim, true);

	// Same tenant, the next page: no probe, and the bubble is there before anything is awaited.
	const from = requests.length;
	const second = new El({ 'data-kind': 'site', 'data-id': 'memo-1' });
	const pending = mount(second);
	assert.equal(second.children.length, 1, 'a remembered yes still waited for something');
	await pending;
	assert.equal(probes(from).length, 0);

	// Past six hours it is asked again — and a stamp from the future is not believed at all.
	for (const at of [Date.now() - SIX_HOURS - 1000, Date.now() + 60_000]) {
		storage.set(claimKey('site', 'memo-1'), JSON.stringify({ claim: true, at }));
		const f = requests.length;
		await mount(new El({ 'data-kind': 'site', 'data-id': 'memo-1' }));
		assert.equal(probes(f).length, 1, `a stamp of ${at} was trusted`);
	}

	// A no is never written down: an owner who opens the Inbox sees the bubble on the next page.
	await mount(new El({ 'data-kind': 'site', 'data-id': 'off-memo' }));
	assert.equal(storage.has(claimKey('site', 'off-memo')), false);
	const f = requests.length;
	await mount(new El({ 'data-kind': 'site', 'data-id': 'off-memo' }));
	assert.equal(probes(f).length, 1);

	// And a remembered yes that the server now contradicts (a site that left) is dropped.
	storage.set(claimKey('site', 'off-gone'), JSON.stringify({ claim: true, at: Date.now() - SIX_HOURS - 1 }));
	const gone = new El({ 'data-kind': 'site', 'data-id': 'off-gone' });
	await mount(gone);
	assert.ok(nothingRendered(gone));
	assert.equal(storage.has(claimKey('site', 'off-gone')), false);
});

test('gate: cannot ask ⇒ nothing, retried at 2 s, 8 s and 30 s, and drawn when the answer comes', async () => {
	const ok = (body) => ({ ok: true, status: 200, json: async () => body });
	claimScript.set('retry-1', [
		{ ok: false, status: 500, json: async () => ({}) },
		() => { throw new TypeError('Failed to fetch'); },
		ok({ ok: true, claimed: 'yes' }), // a body of the wrong shape: could not ask, so asked again
		ok({ ok: true, claimed: true })
	]);
	const d = longDelays.length;
	const from = requests.length;
	const el = new El({ 'data-kind': 'site', 'data-id': 'retry-1' });
	const done = mount(el);
	await settle();
	assert.ok(nothingRendered(el), 'something was drawn before anybody answered');
	await done;
	await drain();
	assert.equal(probes(from).length, 4);
	assert.deepEqual(gaps(d), [2000, 8000, 30000]);
	assert.equal(digest(el.children[0].innerHTML), BEFORE.closed);
});

test('gate: never answers ⇒ stops after four requests and draws nothing', async () => {
	const hang = () => new Promise(() => {});
	claimScript.set('retry-2', [
		{ ok: false, status: 503, json: async () => ({}) },
		hang, // a request that never comes back is cut off by the per-request timeout
		{ ok: false, status: 502, json: async () => ({}) },
		() => { throw new TypeError('Failed to fetch'); },
		{ ok: true, status: 200, json: async () => ({ ok: true, claimed: true }) } // never reached
	]);
	const d = longDelays.length;
	const from = requests.length;
	const el = new El({ 'data-kind': 'ext', 'data-id': 'retry-2' });
	await mount(el);
	await drain();
	assert.equal(probes(from).length, 4, 'not the cap of one request and three retries');
	assert.deepEqual(gaps(d), [2000, 8000, 30000]);
	assert.ok(longDelays.slice(d).includes(PROBE_TIMEOUT_MS), 'no per-request timeout was set');
	assert.ok(nothingRendered(el));
});

test('gate: a reply of the wrong shape is not an answer — least of all a yes', async () => {
	const shapes = [
		{ ok: true, claimed: 'true' },
		{ ok: true },
		{ claimed: 1 },
		{ ok: true, claimed: true, throttled: true } // `throttled` wins: not an answer, and not retried
	];
	const ok = (body) => ({ ok: true, status: 200, json: async () => body });
	claimScript.set('shape-1', [...shapes.map(ok)]);
	const el = new El({ 'data-kind': 'site', 'data-id': 'shape-1' });
	await mount(el);
	await drain();
	assert.ok(nothingRendered(el), 'a malformed reply was taken as a yes');
	// A body that is not JSON at all, then a real answer: still drawn — it was a retry, not a no.
	claimScript.set('shape-2', [
		{ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } },
		ok({ ok: true, claimed: true })
	]);
	const el2 = new El({ 'data-kind': 'site', 'data-id': 'shape-2' });
	await mount(el2);
	await drain();
	assert.equal(el2.children.length, 1);
});

test('gate: unmount while the probe is in the air leaves nothing behind when it lands', async () => {
	let release;
	claimScript.set('late-1', [() => new Promise((r) => { release = r; })]);
	const before = listenerCount();
	const el = new El({ 'data-kind': 'site', 'data-id': 'late-1' });
	el.setAttribute('data-dynamic-coral-mounted', '1');
	const done = mount(el);
	await settle();
	assert.equal(coral.unmount(el), true, 'a mount waiting on its probe could not be taken off');
	assert.equal(el.getAttribute('data-dynamic-coral-mounted'), null);
	release({ ok: true, status: 200, json: async () => ({ ok: true, claimed: true }) });
	await done;
	await drain();
	assert.ok(nothingRendered(el));
	assert.equal(listenerCount(), before);
});

test('gate: a reef-inbox:open sent while the probe is still out is held, and opens the panel on yes', async () => {
	// A site's own DOMContentLoaded handler dispatches right after the module's mountAll: on a page
	// with no remembered yes the answer is a round trip away, and the request must not be lost in it.
	const before = listenerCount();
	const el = new El({ 'data-kind': 'site', 'data-id': 'held-1', 'data-kaito': '1', 'data-site-name': 'Example Shop' });
	const done = mount(el);
	dispatch('reef-inbox:open');
	await done;
	await drain();
	assert.equal(el.children.length, 1);
	assert.equal(digest(el.children[0].innerHTML), BEFORE.open.site_kaito,
		'the open asked for before the answer was dropped (panel still closed)');
	assert.equal(listenerCount(), before + 2, 'the holding listener outlived the answer');

	// On a no the held request goes nowhere, and the holding listener is gone with the answer.
	const before2 = listenerCount();
	const off = new El({ 'data-kind': 'site', 'data-id': 'off-held' });
	const doneOff = mount(off);
	dispatch('reef-inbox:open');
	await doneOff;
	await drain();
	assert.ok(nothingRendered(off));
	assert.equal(listenerCount(), before2);
});

test('gate: throttled or refused (4xx) ⇒ not asked again on this page — retries are for could-not-ask only', async () => {
	// The probe's rate limit counts per address across every site on the platform: three more asks
	// from a throttled visitor only spend that address's allowance on the next site too. And a 400
	// (`bad_kind`/`bad_id`) says the same thing every time it is asked.
	const ok = (body) => ({ ok: true, status: 200, json: async () => body });
	const cases = {
		'thr-1': ok({ ok: true, claimed: false, throttled: true }),
		'bad-1': { ok: false, status: 400, json: async () => ({ ok: false, reason: 'bad_kind' }) },
		'bad-2': { ok: false, status: 400, json: async () => ({ ok: false, reason: 'bad_id' }) },
		'lim-1': { ok: false, status: 429, json: async () => ({ ok: false, reason: 'rate_limited' }) }
	};
	for (const [id, first] of Object.entries(cases)) {
		claimScript.set(id, [first, ok({ ok: true, claimed: true })]); // the yes must never be reached
		const d = longDelays.length;
		const from = requests.length;
		const el = new El({ 'data-kind': 'site', 'data-id': id });
		await mount(el);
		await drain();
		assert.equal(probes(from).length, 1, `${id}: asked again`);
		assert.deepEqual(gaps(d), [], `${id}: waited to ask again`);
		assert.ok(nothingRendered(el), `${id}: drew without an answer`);
	}
	// A 5xx is still a could-not-ask, and still retried (the other tests pin the whole schedule).
	claimScript.set('srv-1', [{ ok: false, status: 500, json: async () => ({}) }, ok({ ok: true, claimed: true })]);
	const from = requests.length;
	const el = new El({ 'data-kind': 'site', 'data-id': 'srv-1' });
	await mount(el);
	await drain();
	assert.equal(probes(from).length, 2);
	assert.equal(el.children.length, 1);
});

test('gate: nobody could say, but this browser once heard yes (within 30 days) ⇒ drawn, without asking further', async () => {
	// Before the gate the bubble was drawn without asking anything; it must not add a way for a site that
	// HAS an Inbox to lose its bubble just because the question was throttled or timed out.
	const DAY = 24 * 60 * 60 * 1000;
	const ok = (body) => ({ ok: true, status: 200, json: async () => body });
	const stale = (id, age) => storage.set(claimKey('site', id), JSON.stringify({ claim: true, at: Date.now() - age }));

	// throttled + a yes from seven hours ago ⇒ drawn, exactly as before, one request, not re-dated.
	stale('stale-1', 7 * 60 * 60 * 1000);
	const kept = storage.get(claimKey('site', 'stale-1'));
	claimScript.set('stale-1', [ok({ ok: true, claimed: false, throttled: true })]);
	let from = requests.length;
	const a = new El({ 'data-kind': 'site', 'data-id': 'stale-1' });
	await mount(a);
	await drain();
	assert.equal(probes(from).length, 1);
	assert.equal(a.children.length, 1, 'a throttled ask took the bubble off a site that has an Inbox');
	assert.equal(digest(a.children[0].innerHTML), BEFORE.closed);
	assert.equal(storage.get(claimKey('site', 'stale-1')), kept, 'a non-answer re-dated the yes');

	// a timeout (could not ask) + a yes from 29 days ago ⇒ drawn at the first non-answer, no retry wait.
	stale('stale-2', 29 * DAY);
	claimScript.set('stale-2', [() => new Promise(() => {}), ok({ ok: true, claimed: false })]);
	const d = longDelays.length;
	from = requests.length;
	const b = new El({ 'data-kind': 'site', 'data-id': 'stale-2' });
	await mount(b);
	await drain();
	assert.equal(b.children.length, 1);
	assert.equal(probes(from).length, 1, 'kept asking after deciding to draw — a later no would have nothing to undo');
	assert.deepEqual(gaps(d), []);

	// a yes older than 30 days is not a yes any more ⇒ nothing.
	stale('stale-3', 31 * DAY);
	claimScript.set('stale-3', [ok({ ok: true, claimed: false, throttled: true })]);
	const c = new El({ 'data-kind': 'site', 'data-id': 'stale-3' });
	await mount(c);
	await drain();
	assert.ok(nothingRendered(c));

	// no record at all ⇒ nothing (the plain could-not-ask case, pinned again beside its sibling).
	claimScript.set('stale-4', [ok({ ok: true, claimed: false, throttled: true })]);
	const e = new El({ 'data-kind': 'site', 'data-id': 'stale-4' });
	await mount(e);
	await drain();
	assert.ok(nothingRendered(e));

	// a definite NO beats any remembered yes ⇒ nothing, and the record is gone.
	stale('stale-5', 7 * 60 * 60 * 1000);
	claimScript.set('stale-5', [ok({ ok: true, claimed: false })]);
	const f = new El({ 'data-kind': 'site', 'data-id': 'stale-5' });
	await mount(f);
	await drain();
	assert.ok(nothingRendered(f));
	assert.equal(storage.has(claimKey('site', 'stale-5')), false);

	// and a future stamp is no more believed here than it is fresh.
	storage.set(claimKey('site', 'stale-6'), JSON.stringify({ claim: true, at: Date.now() + DAY }));
	claimScript.set('stale-6', [ok({ ok: true, claimed: false, throttled: true })]);
	const g = new El({ 'data-kind': 'site', 'data-id': 'stale-6' });
	await mount(g);
	await drain();
	assert.ok(nothingRendered(g));
});

// ── KAITO without an Inbox: the ask-only bubble (CVERInc/reef#1866, owner ruling 54) ────────────
//
// 🩸 THE FAILURE THIS EXISTS FOR. The claim gate returned on every no, and a tenant that has the
// ask-the-site half and no Inbox — the state ruling 54 names and gives its own status line — got an
// empty container: script loaded, mount flagged, nothing drawn, no error anywhere.
//
// 🔴 THE RULER IS THE TABLE, one test per row:
//
//   data-kaito | Inbox    | bubble | a way to a person | deferred write | status line
//   1          | yes      | drawn  | yes               | yes            | 「answers first, a person reads…」
//   1          | no       | drawn  | NO                | NONE           | 「answers from this site's content」
//   1          | unknown  | drawn  | NO                | NONE           | 「answers from this site's content」
//   —          | yes      | drawn  | yes               | —              | 「A person reads what you send」
//   —          | no       | nothing
//   —          | unknown  | nothing, retried on the gate's schedule
//
// Rows 1, 4, 5 and 6 are measured against what the coral did BEFORE this section existed (the
// `BEFORE` digests above and the gate's own request lists), not against themselves.

const KAITO_ANSWER = 'We ship within three working days.';
const answering = (answer) => (url) => {
	if (url.includes('/api/kaito')) return { ok: true, status: 200, json: async () => answer };
	return undefined;
};
const GROUNDED = { kind: 'grounded', text: KAITO_ANSWER, source_url: 'https://example.com/faq#shipping' };
const REFUSED = { kind: 'refused', text: 'Nothing on this site covers that.' };
/** What the panel shows for any refusal — the locale's own sentence, never the server's. */
const REFUSAL_SHOWN = 'I don&#39;t have a record of that.';

/** Everything that left, in order: `METHOD path` for each fetch, then each beacon as a POST. */
const wire = (from) => [
	...requests.slice(from).map((r) => `${r.init.method || 'GET'} ${new URL(r.url).pathname}`),
	...beacons.map((b) => `BEACON ${new URL(b.url).pathname}`)
];

/**
 * One visit, start to finish, against the real `mount()`: mount → open the bubble → ask one
 * question → read the answer → leave the page. Returns what the page held and everything that left.
 *
 * 🔴 `pagehide` IS FIRED AT THIS MOUNT'S LISTENERS ONLY. Every earlier test's panel is still on
 * this file's one `window`, and some of them hold questions of their own; firing theirs would
 * measure them. How many this mount ADDED is returned too — zero is itself a claim.
 */
async function visit(attrs, answer = GROUNDED) {
	const el = new El({ 'data-kind': 'site', 'data-site-name': 'Example Shop', ...attrs });
	const id = el.attrs['data-id'];
	const from = requests.length;
	const listenersBefore = listenerCount();
	const hidersBefore = new Set(windowListeners.get('pagehide') ?? []);
	beacons.length = 0;
	beaconResult = true;
	respond = answering(answer);
	try {
		await mount(el);
		await drain();
		const root = el.children[0];
		if (!root) return { el, id, drawn: false, wire: wire(from), listeners: listenerCount() - listenersBefore };
		const closed = root.innerHTML;
		await openBubble(root);
		const panel = root.innerHTML;
		composeBox(root).value = 'do you ship to Japan?';
		await root.querySelector('.dc-inbox-form').emit('submit');
		await drain(); // the answer, and the log's own claim probe where there is a log
		const exchange = root.querySelector('.dc-inbox-log').innerHTML;
		// What the two requests that are NOT the gate's carried — the key sets, not only the paths.
		const sent = requests.slice(from);
		const kaitoPost = sent.find((r) => new URL(r.url).pathname === '/api/kaito');
		const nameRead = sent.find((r) => new URL(r.url).pathname === '/api/inbox/assistant');
		const kaitoBody = kaitoPost ? JSON.parse(kaitoPost.init.body) : null;
		const nameQuery = nameRead ? [...new URL(nameRead.url).searchParams.keys()] : null;
		const hiders = (windowListeners.get('pagehide') ?? []).filter((fn) => !hidersBefore.has(fn));
		for (const fn of hiders) fn({});
		await drain();
		return {
			el, id, root, drawn: true, closed, panel, exchange, hiders: hiders.length, kaitoBody, nameQuery,
			kaitoQuery: kaitoPost ? new URL(kaitoPost.url).search : null,
			nameInit: nameRead ? nameRead.init : null,
			wire: wire(from), listeners: listenerCount() - listenersBefore,
			keys: [...storage.keys()].filter((k) => k.endsWith(`:site:${id}`)).sort()
		};
	} finally {
		respond = null;
	}
}

const HAS_INBOX_LINE = 'answers first, a person reads what you send on';
const ASK_ONLY_LINE = 'answers from this site&#39;s content';
const CHIP = '<span class="dc-inbox-ai-chip" aria-label="AI">AI</span>';

/** What every ask-only visit must look like, whichever way the gate got there. */
function assertAskOnly(v, why) {
	assert.equal(v.drawn, true, `${why}: no bubble was drawn`);
	assert.match(v.closed, /class="dc-inbox-open"/, `${why}: no closed bubble`);
	// The ask view: KAITO's own box, the AI chip, and the line that is true without an Inbox.
	assert.match(v.panel, /name="q"/, `${why}: the panel did not open on the ask view`);
	assert.ok(v.panel.includes(`KAITO${CHIP}${ASK_ONLY_LINE}`), `${why}: not the KAITO-only status line: ${v.panel}`);
	assert.equal(v.panel.includes('a person reads'), false, `${why}: the panel promises a person`);
	// No way to a person anywhere: no compose form, no honeypot, no hand-off button, no second action.
	assert.doesNotMatch(v.panel, /name="text"|dc-inbox-hp|dc-inbox-second|dc-inbox-handoff/, `${why}: a compose half was drawn`);
	assert.ok(v.exchange.includes(KAITO_ANSWER) || v.exchange.includes(REFUSAL_SHOWN), `${why}: the answer was not shown`);
	assert.equal(v.exchange.includes('dc-inbox-tohuman'), false, `${why}: the answer offers a person: ${v.exchange}`);
	// Nothing named as a place to leave a message, for a screen reader either.
	assert.doesNotMatch(v.closed + v.panel, /Message us|Leave a message/, `${why}: an accessible name still says「message」`);
	// 🔴 AND WHAT THOSE REQUESTS CARRY, NOT ONLY WHERE THEY GO.「Nothing about the visitor travels」
	// is a claim about bodies: the question is sent with the tenant, the sentence and the page's
	// locale — no page URL, no session, no handle — and the name read with the tenant alone.
	assert.deepEqual(Object.keys(v.kaitoBody).sort(), ['id', 'kind', 'locale', 'query'], `${why}: the question's body grew a key`);
	assert.deepEqual([v.kaitoBody.kind, v.kaitoBody.id, v.kaitoBody.query], ['site', v.id, 'do you ship to Japan?'], why);
	assert.equal(v.kaitoQuery, '', `${why}: the question's URL grew a query string`);
	assert.deepEqual(v.nameQuery, ['kind', 'id'], `${why}: the name read's query grew a key`);
	assert.equal(v.nameInit.method, undefined, `${why}: the name read is not a GET`);
	assert.equal(v.nameInit.body, undefined, `${why}: the name read has a body`);
	assert.deepEqual(Object.keys(v.nameInit.headers), ['accept'], `${why}: the name read grew a header`);
	// 🔴 ZERO WRITES, AS A LIST. The gate's one question, the assistant's name (a read of the
	// platform's own setting — nothing about the visitor travels) and the question itself, which is
	// the product. No second claim probe (there is no log to ask for), no POST to /api/inbox, no
	// session POST, no beacon.
	assert.deepEqual(v.wire, ['GET /api/inbox/session', 'GET /api/inbox/assistant', 'POST /api/kaito'], why);
	assert.deepEqual(beacons, [], `${why}: a beacon left`);
	assert.equal(v.hiders, 0, `${why}: a pagehide listener was installed`);
	assert.equal(v.listeners, 1, `${why}: not exactly the one reef-inbox:open listener`);
	// And nothing held in this browser that a later page could send: no log buffer, no handle, no
	// remembered claim.
	assert.deepEqual(v.keys, [], `${why}: wrote to storage`);
}

test('#1866 row 1 — KAITO + an Inbox: the full bubble, unchanged, and the questions DO leave (the control)', async () => {
	const v = await visit({ 'data-id': 'r1-on', 'data-kaito': '1' });
	assert.equal(digest(v.closed), BEFORE.closed, 'closed bubble changed');
	assert.equal(digest(v.panel), BEFORE.open.site_kaito, 'open panel changed');
	assert.ok(v.panel.includes(`KAITO${CHIP}${HAS_INBOX_LINE}`), 'not the has-an-Inbox status line');
	assert.equal(v.panel.includes(ASK_ONLY_LINE), false, 'a site with an Inbox got the KAITO-only line');
	assert.match(v.exchange, /dc-inbox-tohuman/, 'the answer lost its way to a person');
	// 🔴 THE CONTROL FOR ROWS 2 AND 3: the same visit, on a site with an Inbox, does write — so the
	// empty lists below are measured by a ruler that can read something.
	assert.deepEqual(v.wire, [
		'GET /api/inbox/session', 'GET /api/inbox/assistant', 'POST /api/kaito',
		'GET /api/inbox/session', 'BEACON /api/inbox/session'
	]);
	assert.equal(JSON.parse(beacons[0].body).questions.at(-1).text, 'do you ship to Japan?');
	assert.equal(v.hiders, 1);
	assert.equal(v.listeners, 2);
	assert.deepEqual(v.keys, ['reef-inbox:ai:site:r1-on', 'reef-inbox:claim:site:r1-on']);
});

test('#1866 row 2 — KAITO, no Inbox: the ask-only bubble is drawn, offers no person, writes nothing', async () => {
	assertAskOnly(await visit({ 'data-id': 'off-r2-a', 'data-kaito': '1' }), 'answered');
	// A refusal is where the full bubble offers「Send this to a person」; here it is the whole reply.
	const refused = await visit({ 'data-id': 'off-r2-b', 'data-kaito': '1' }, REFUSED);
	assertAskOnly(refused, 'refused');
	assert.ok(refused.exchange.includes(REFUSAL_SHOWN), refused.exchange);
});

test('#1866 row 2 — a zh-TW page gets the ruled sentence, under the owner\'s own name for the assistant', async () => {
	const lang = document.documentElement.attrs.lang;
	document.documentElement.attrs.lang = 'zh-TW';
	try {
		const v = await visit({ 'data-id': 'off-r2-zh', 'data-kaito': '1', 'data-assistant-name': '小美' });
		assert.equal(v.drawn, true, 'no bubble was drawn');
		assert.ok(v.panel.includes(`小美${CHIP}用這個站的內容回答`), v.panel);
		assert.equal(v.panel.includes('真人會看'), false);
		assert.doesNotMatch(v.closed + v.panel, /傳訊息|留言給我們/);
	} finally {
		document.documentElement.attrs.lang = lang;
	}
});

test('#1866 row 2 — a stored handle is not adopted, an open asked for early is honoured, and the Inbox opening upgrades the next page', async () => {
	// A handle from some earlier day: left exactly where it is, never fetched, never shown.
	const handleKey = 'reef-inbox:site:off-r2-h';
	const handle = JSON.stringify({ conv: 'an-old-thread', ts: Date.now() - 1000, hasEmail: false, mode: 'human' });
	storage.set(handleKey, handle);
	const el = new El({ 'data-kind': 'site', 'data-id': 'off-r2-h', 'data-kaito': '1' });
	const done = mount(el);
	dispatch('reef-inbox:open'); // a site's own DOMContentLoaded handler, before the gate answers
	// Counted from here: the broadcast also reached every earlier test's panel, synchronously, and
	// what those fetched and armed is theirs. This mount has drawn nothing yet — its answer is a
	// round trip away.
	const from = requests.length;
	const armed = timers.size;
	await done;
	await drain();
	assert.equal(el.children.length, 1, 'no bubble was drawn');
	assert.match(el.children[0].innerHTML, /name="q"/, 'the held open did not open the ask view');
	assert.doesNotMatch(el.children[0].innerHTML, /name="text"|dc-inbox-second/);
	assert.deepEqual(transcriptConvs(from), [], 'the stored conversation was fetched');
	assert.equal(timers.size, armed, 'a transcript poller was armed');
	assert.equal(storage.get(handleKey), handle, 'the stored handle was rewritten');
	storage.delete(handleKey);

	// 🔴 NOT STUCK. A no is never remembered, so the page after the owner opens the Inbox asks
	// again, hears yes, and draws the full bubble — the same bytes any site with an Inbox gets.
	const ok = (body) => ({ ok: true, status: 200, json: async () => body });
	claimScript.set('up-1', [ok({ ok: true, claimed: false }), ok({ ok: true, claimed: true })]);
	const attrs = { 'data-kind': 'site', 'data-id': 'up-1', 'data-kaito': '1', 'data-site-name': 'Example Shop' };
	const first = new El({ ...attrs });
	await mount(first);
	await drain();
	await openBubble(first.children[0]);
	assert.ok(first.children[0].innerHTML.includes(ASK_ONLY_LINE), 'the first page was not ask-only');
	assert.equal(storage.has(claimKey('site', 'up-1')), false, 'a no was remembered');
	const f = requests.length;
	const second = new El({ ...attrs });
	await mount(second);
	await drain();
	assert.equal(probes(f).length, 1, 'the next page did not ask again');
	assert.equal(digest(second.children[0].innerHTML), BEFORE.closed);
	await openBubble(second.children[0]);
	assert.equal(digest(second.children[0].innerHTML), BEFORE.open.site_kaito, 'the next page is not the full bubble');
});

test('#1866 row 3 — KAITO, could not ask: ask-only at the first non-answer, and nothing leaves even if the site does have an Inbox', async () => {
	const ok = (body) => ({ ok: true, status: 200, json: async () => body });
	const yes = ok({ ok: true, claimed: true });
	// 🔴 EVERY SCRIPT ENDS IN A YES THAT MUST NOT BE REACHED. The site may well have an Inbox — that
	// is what「unknown」means — and a second ask (the gate retrying, or a question log probing for
	// itself) would hear so and send. Ask-only was decided without that answer and stays decided.
	const cases = {
		'unk-throttled': ok({ ok: true, claimed: false, throttled: true }),
		'unk-429': { ok: false, status: 429, json: async () => ({ ok: false, reason: 'rate_limited' }) },
		'unk-500': { ok: false, status: 500, json: async () => ({}) },
		'unk-offline': () => { throw new TypeError('Failed to fetch'); },
		'unk-hang': () => new Promise(() => {}),
		'unk-shape': ok({ ok: true, claimed: 'yes' })
	};
	for (const [id, first] of Object.entries(cases)) {
		claimScript.set(id, [first, yes, yes, yes]);
		const d = longDelays.length;
		const v = await visit({ 'data-id': id, 'data-kaito': '1' });
		assertAskOnly(v, id);
		assert.deepEqual(gaps(d), [], `${id}: kept asking after deciding to draw`);
		assert.equal(claimScript.get(id).length, 3, `${id}: the yes was reached`);
	}
	// A yes this browser heard within 30 days still stands in for the missing answer, as it always
	// has: that mount is the full bubble, not ask-only.
	storage.set(claimKey('site', 'unk-stale'), JSON.stringify({ claim: true, at: Date.now() - 7 * 60 * 60 * 1000 }));
	claimScript.set('unk-stale', [ok({ ok: true, claimed: false, throttled: true })]);
	const el = new El({ 'data-kind': 'site', 'data-id': 'unk-stale', 'data-kaito': '1', 'data-site-name': 'Example Shop' });
	await mount(el);
	await drain();
	await openBubble(el.children[0]);
	assert.equal(digest(el.children[0].innerHTML), BEFORE.open.site_kaito);
});

test('#1866 row 4 — no KAITO + an Inbox: the compose bubble, unchanged', async () => {
	const el = new El({ 'data-kind': 'site', 'data-id': 'r4-on', 'data-status': 'Hello there' });
	const from = requests.length;
	const before = listenerCount();
	await mount(el);
	await drain();
	assert.equal(digest(el.children[0].innerHTML), BEFORE.closed);
	assert.deepEqual(requests.slice(from).map((r) => new URL(r.url).pathname), ['/api/inbox/session', '/api/inbox/assistant']);
	assert.equal(listenerCount(), before + 2);
	await openBubble(el.children[0]);
	assert.equal(digest(el.children[0].innerHTML), BEFORE.open.site_status);
	assert.match(el.children[0].innerHTML, /name="text"/);
	assert.equal(el.children[0].innerHTML.includes(ASK_ONLY_LINE), false);
});

test('#1866 row 5 — no KAITO, no Inbox: still nothing', async () => {
	// `data-kaito` must be exactly "1": anything else is a mount without KAITO, and gets no bubble.
	for (const kaito of [undefined, '0', 'true', '']) {
		const before = listenerCount();
		const from = requests.length;
		const el = new El({ 'data-kind': 'site', 'data-id': `off-r5-${kaito ?? 'none'}` });
		if (kaito !== undefined) el.attrs['data-kaito'] = kaito;
		await mount(el);
		await drain();
		assert.ok(nothingRendered(el), `data-kaito=${kaito}: a tenant with neither half got a bubble`);
		assert.equal(listenerCount(), before);
		assert.deepEqual(requests.slice(from).map((r) => new URL(r.url).pathname), ['/api/inbox/session']);
		assert.equal([...storage.keys()].some((k) => k.includes('off-r5-')), false);
	}
});

test('#1866 row 6 — no KAITO, could not ask: nothing, and the gate\'s own retry schedule', async () => {
	const ok = (body) => ({ ok: true, status: 200, json: async () => body });
	// Throttled: not an answer, not retried, nothing drawn.
	claimScript.set('r6-thr', [ok({ ok: true, claimed: false, throttled: true }), ok({ ok: true, claimed: true })]);
	let d = longDelays.length;
	let from = requests.length;
	const a = new El({ 'data-kind': 'site', 'data-id': 'r6-thr' });
	await mount(a);
	await drain();
	assert.ok(nothingRendered(a));
	assert.equal(probes(from).length, 1);
	assert.deepEqual(gaps(d), []);
	// Unreachable: four requests at 2 s, 8 s and 30 s, and still nothing.
	const down = { ok: false, status: 503, json: async () => ({}) };
	claimScript.set('r6-down', [down, down, down, down, ok({ ok: true, claimed: true })]);
	d = longDelays.length;
	from = requests.length;
	const b = new El({ 'data-kind': 'site', 'data-id': 'r6-down' });
	await mount(b);
	await drain();
	assert.ok(nothingRendered(b));
	assert.equal(probes(from).length, 4);
	assert.deepEqual(gaps(d), [2000, 8000, 30000]);
});

test('#1866 row 2 — when the engine cannot answer, ask-only still offers no person', async () => {
	// 🩸 THE THIRD WAY AN ANSWER COMES BACK, and the one the first version of this section did not
	// drive: a 429, a 5xx or no network leaves `answer` null, and the full bubble's reply to that is
	// the error line with「Send this to a person」under it. Ask-only shows the error line alone.
	const failures = {
		'off-err-429': () => ({ ok: false, status: 429, json: async () => ({ reason: 'rate_limited' }) }),
		'off-err-500': () => ({ ok: false, status: 500, json: async () => ({}) }),
		'off-err-offline': () => { throw new TypeError('Failed to fetch'); },
		'off-err-shape': () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })
	};
	const ERROR_SHOWN = 'That didn&#39;t go through. Please try again.';
	const drive = async (id, fail) => {
		const el = new El({ 'data-kind': 'site', 'data-id': id, 'data-kaito': '1' });
		respond = (url) => (url.includes('/api/kaito') ? fail() : undefined);
		try {
			await mount(el);
			await drain();
			const root = el.children[0];
			assert.ok(root, `${id}: no bubble was drawn`);
			await openBubble(root);
			composeBox(root).value = 'do you ship to Japan?';
			await root.querySelector('.dc-inbox-form').emit('submit');
			await drain();
			return root.querySelector('.dc-inbox-log').innerHTML + root.innerHTML;
		} finally {
			respond = null;
		}
	};
	for (const [id, fail] of Object.entries(failures)) {
		const shown = await drive(id, fail);
		assert.ok(shown.includes(ERROR_SHOWN), `${id}: the error line was not shown: ${shown}`);
		// Nothing a visitor could press or type into to reach a person: no hand-off button, no
		// hand-off form, no compose box, no honeypot, no second action.
		assert.doesNotMatch(shown, /dc-inbox-tohuman|dc-inbox-handoff|dc-inbox-second|dc-inbox-hp|name="text"|name="visitor_/,
			`${id}: an engine error offered a person: ${shown}`);
		assert.doesNotMatch(shown, /Send this to a person|Ask a person instead/, id);
	}
	// The control — the same failure on a site WITH an Inbox does offer the person, so the absence
	// above is read by a ruler that can see the button.
	const control = await drive('err-on-500', failures['off-err-500']);
	assert.ok(control.includes(ERROR_SHOWN));
	assert.match(control, /dc-inbox-tohuman[^>]*>Send this to a person/);
});

test('#1866 row 2 — a late rename from the platform repaints the KAITO-only line, not the has-an-Inbox one', async () => {
	// The name read lands AFTER the first paint and patches the status node in place. That patch
	// is a second call to `statusFor`, and it has to say what the first one said.
	const run = async (id) => {
		let release;
		const el = new El({ 'data-kind': 'site', 'data-id': id, 'data-kaito': '1' });
		respond = (url) => (url.includes('/api/inbox/assistant') ? new Promise((r) => { release = r; }) : undefined);
		try {
			await mount(el);
			await drain();
			const root = el.children[0];
			assert.ok(root, `${id}: no bubble was drawn`);
			await openBubble(root);
			const before = root.innerHTML;
			// The stand-in hands out the status node the patch will write to; it is empty until then.
			const status = root.querySelector('.dc-inbox-status');
			assert.equal(status.innerHTML, '', 'the status node was patched before the name arrived');
			release({ ok: true, status: 200, json: async () => ({ ok: true, assistantName: 'Mika', resolved: true }) });
			await drain();
			assert.equal(root.innerHTML, before, `${id}: the rename re-rendered the panel instead of patching it`);
			return { before, patched: status.innerHTML };
		} finally {
			respond = null;
		}
	};
	const askOnly = await run('off-rename-1');
	assert.ok(askOnly.before.includes(`KAITO${CHIP}${ASK_ONLY_LINE}`));
	assert.equal(askOnly.patched, `Mika${CHIP}${ASK_ONLY_LINE}`);
	// The control: with an Inbox the same patch writes the other line.
	const full = await run('rename-on-1');
	assert.equal(full.patched, `Mika${CHIP}${HAS_INBOX_LINE}`);
});

test('#1866 row 2 — what the ask-only bubble is CALLED: the ask box\'s words, or the host\'s own data-title for the dialog', async () => {
	const names = (html) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
	const labels = async (attrs) => {
		const el = new El({ 'data-kind': 'site', ...attrs });
		await mount(el);
		await drain();
		const root = el.children[0];
		const closed = names(root.innerHTML)[0];
		await openBubble(root);
		return { closed, dialog: root.innerHTML.match(/role="dialog" aria-label="([^"]*)"/)[1] };
	};
	// 1. Ask-only, nothing set: the locale's ask placeholder WITHOUT its ellipsis — a name is read
	//    aloud. Never「Message us」/「Leave a message」.
	assert.deepEqual(await labels({ 'data-id': 'off-name-1', 'data-kaito': '1' }),
		{ closed: 'Ask about this site', dialog: 'Ask about this site' });
	// 2. Ask-only, the host set data-title (a site layout passes the site's name): it names the
	//    dialog. data-open-label is the override for「Message us」and is ignored here.
	assert.deepEqual(await labels({ 'data-id': 'off-name-2', 'data-kaito': '1', 'data-title': 'Example Shop', 'data-open-label': 'Write to us' }),
		{ closed: 'Ask about this site', dialog: 'Example Shop' });
	// 3. With an Inbox: both attributes, and both defaults, exactly as they have always been.
	assert.deepEqual(await labels({ 'data-id': 'name-on-1', 'data-kaito': '1' }),
		{ closed: 'Message us', dialog: 'Leave a message' });
	assert.deepEqual(await labels({ 'data-id': 'name-on-2', 'data-kaito': '1', 'data-title': 'Example Shop', 'data-open-label': 'Write to us' }),
		{ closed: 'Write to us', dialog: 'Example Shop' });
	// And no locale's ask-only name ends in an ellipsis, of either spelling.
	const lang = document.documentElement.attrs.lang;
	try {
		for (const locale of Object.keys(coral.COPY)) {
			document.documentElement.attrs.lang = locale;
			const got = await labels({ 'data-id': `off-name-${locale}`, 'data-kaito': '1' });
			assert.equal(got.closed, got.dialog);
			assert.ok(got.closed.length > 0, `${locale}: an empty accessible name`);
			assert.doesNotMatch(got.closed, /(…|\.\.\.)\s*$/, `${locale}: the name ends in an ellipsis`);
			assert.ok(coral.COPY[locale].ask.startsWith(got.closed), `${locale}: not the ask box's own words`);
		}
	} finally {
		document.documentElement.attrs.lang = lang;
	}
});
