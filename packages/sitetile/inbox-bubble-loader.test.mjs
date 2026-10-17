import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

// reef#1921 — the site layout's inbox-bubble LOADER (astro/src/lib/inbox-bubble-loader.mjs).
//
// 🔴 WHAT THIS PROVES, AND AGAINST WHAT. The loader's promise is "behaviour unchanged wherever a
// bubble is drawn, and no coral where none is". The only honest ruler for "unchanged" is the coral
// itself, so the parity table below runs the REAL coral's `mount()` twice per scenario — once alone
// (what `<script src>` did) and once behind the loader (what the layout now emits) — against the
// same scripted answers from `/api/inbox/session`, and compares what a visitor and the network can
// see: how many claim requests went, which waits were scheduled between them, whether a bubble was
// drawn, and what was left in the claim key. A gate that drifts from the coral's fails here.
//
// 🔴 WHAT THIS IS NOT: a browser. The DOM, events, timers and network are the smallest stand-ins
// that let `mount()` run (the same shape as dynamic-corals/inbox-bubble/mount.test.mjs). The layout
// emitting the loader instead of a <script src> is asserted by the astro smoke (smoke-build.mjs).

class El {
	constructor(attrs = {}) {
		this.attrs = attrs;
		this.listeners = {};
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
	set innerHTML(value) { this.html = value; this.nodes.clear(); }
	get innerHTML() { return this.html; }
	querySelector(selector) {
		if (!this.nodes.has(selector)) this.nodes.set(selector, new El());
		return this.nodes.get(selector);
	}
	focus() {}
}

const storage = new Map();
const windowListeners = new Map();
/** The elements the loader finds on "the page" — set per test. */
let pageEls = [];
const requests = [];
const delays = [];
/** One scripted answer per request; an entry is a response, a function (to throw or hang), or a status. */
let script = [];

const realSetTimeout = globalThis.setTimeout;
const fakeSetTimeout = (fn, ms = 0, ...rest) => {
	if (ms >= 1000) {
		delays.push(ms);
		// The fifteen-second ceiling still loses to a reply a promise away; a retry wait runs at once.
		return realSetTimeout(fn, ms === 15_000 ? 25 : 0, ...rest);
	}
	return realSetTimeout(fn, ms, ...rest);
};
const fakeFetch = async (url, init = {}) => {
	requests.push({ url, init });
	if (!url.includes('/api/inbox/session') || init.method === 'POST') return { ok: false, status: 500, json: async () => ({}) };
	const step = script.shift();
	if (typeof step === 'function') return step();
	if (typeof step === 'number') return { ok: false, status: step, json: async () => ({}) };
	return step ?? { ok: false, status: 500, json: async () => ({}) };
};
class FakeCustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }

const win = {
	localStorage: {
		getItem: (k) => (storage.has(k) ? storage.get(k) : null),
		setItem: (k, v) => storage.set(k, v),
		removeItem: (k) => storage.delete(k)
	},
	addEventListener: (type, fn) => {
		if (!windowListeners.has(type)) windowListeners.set(type, []);
		windowListeners.get(type).push(fn);
	},
	removeEventListener: (type, fn) => {
		const list = windowListeners.get(type);
		const at = list ? list.indexOf(fn) : -1;
		if (at >= 0) list.splice(at, 1);
	},
	dispatchEvent: (event) => {
		for (const fn of [...(windowListeners.get(event.type) ?? [])]) fn(event);
		return true;
	},
	fetch: fakeFetch,
	setTimeout: fakeSetTimeout,
	clearTimeout: (id) => clearTimeout(id),
	AbortController,
	CustomEvent: FakeCustomEvent
};
win.document = {
	// `loading` while the coral is imported, so its own auto-mount registers DOMContentLoaded and
	// mounts nothing; flipped to `complete` once it is in, so the loader's replay runs at once.
	readyState: 'loading',
	addEventListener() {},
	documentElement: new El({ lang: 'en' }),
	head: new El(),
	createElement: () => new El(),
	querySelector: () => null,
	querySelectorAll: (selector) => (selector === '[data-dynamic-coral="inbox-bubble"]' ? pageEls : [])
};
globalThis.window = win;
globalThis.document = win.document;
globalThis.location = { hash: '', hostname: 'example.test', href: 'https://example.test/' };
globalThis.fetch = fakeFetch;
globalThis.setTimeout = fakeSetTimeout;
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: () => true }, configurable: true, writable: true });

const coral = await import('../dynamic-corals/inbox-bubble/inbox-bubble.js');
win.document.readyState = 'complete';
const { bubbleLoader, bubbleLoaderScript } = await import('./astro/src/lib/inbox-bubble-loader.mjs');

const SRC = 'https://feelreef.com/corals/inbox-bubble/v0/inbox-bubble.js';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const yes = () => ok({ ok: true, claimed: true });
const no = () => ok({ ok: true, claimed: false });
const claimKey = (id) => `reef-inbox:claim:site:${id}`;
const settle = (ms = 60) => new Promise((r) => realSetTimeout(r, ms));
const claimRequests = () => requests.filter((r) => r.url.includes('/api/inbox/session') && r.init.method !== 'POST').length;
const openListeners = () => (windowListeners.get('reef-inbox:open') ?? []).length;

function reset() {
	storage.clear();
	windowListeners.clear();
	requests.length = 0;
	delays.length = 0;
}

/** What the visitor and the network saw, after everything settled. */
function observe(el) {
	const stored = storage.get(claimKey(el.getAttribute('data-id')));
	return {
		claimRequests: claimRequests(),
		delays: [...delays],
		drawn: el.children.length > 0,
		open: el.children.length > 0 && el.children[0].innerHTML.includes('role="dialog"'),
		claimKey: stored === undefined ? 'absent' : JSON.parse(stored).claim === true ? 'yes' : stored
	};
}

/** The coral alone — what `<script type="module" src>` did. */
async function coralAlone(scenario, id) {
	reset();
	scenario.before?.(id);
	script = scenario.answers();
	const el = new El({ 'data-kind': 'site', 'data-id': id, ...scenario.attrs });
	const mounting = coral.mount(el);
	if (scenario.openEarly) win.dispatchEvent(new FakeCustomEvent('reef-inbox:open'));
	await mounting;
	await settle();
	return { seen: observe(el), imports: 'n/a' };
}

/** The loader, importing the coral (which mounts the element, as its auto-mount does) on demand. */
async function behindLoader(scenario, id) {
	reset();
	scenario.before?.(id);
	script = scenario.answers();
	const el = new El({ 'data-kind': 'site', 'data-id': id, ...scenario.attrs });
	pageEls = [el];
	let imports = 0;
	const loading = bubbleLoader(SRC, win, async (src) => {
		assert.equal(src, SRC);
		imports++;
		// The module's own evaluation: `mountAll()` → `mount(el)`, which installs its listeners
		// synchronously up to its first await.
		void coral.mount(el);
	});
	if (scenario.openEarly) win.dispatchEvent(new FakeCustomEvent('reef-inbox:open'));
	const outcome = await loading;
	await settle();
	return { seen: observe(el), imports, outcome };
}

const SCENARIOS = [
	{ name: 'no Inbox', answers: () => [no()], draws: false },
	{ name: 'an Inbox', answers: () => [yes()], draws: true },
	{ name: 'could not ask, four times', answers: () => [500, 500, 500, 500, yes()], draws: false },
	{ name: 'a 5xx, then yes', answers: () => [503, yes()], draws: true },
	{ name: 'a network failure, then no', answers: () => [() => { throw new Error('offline'); }, no()], draws: false },
	{ name: 'a body of the wrong shape twice, then yes', answers: () => [ok({ claimed: 'yes' }), ok({}), yes()], draws: true },
	{ name: 'throttled (not retried)', answers: () => [ok({ claimed: false, throttled: true }), yes()], draws: false },
	{ name: 'a 4xx (not retried)', answers: () => [400, yes()], draws: false },
	{ name: 'a request that never returns, then yes', answers: () => [() => new Promise(() => {}), yes()], draws: true },
	{ name: 'remembered yes, an hour old', before: (id) => storage.set(claimKey(id), JSON.stringify({ claim: true, at: Date.now() - HOUR })), answers: () => [no()], draws: true },
	// 🔴 The one import that draws nothing, on purpose: with a yes inside the 30-day fallback the
	// coral's gate is the one that settles on a non-answer, so the loader hands it over unasked
	// rather than ask first and make the coral ask again. Cost: one download on the first page after
	// an owner closed an Inbox they had. Every request and pixel still matches.
	{ name: 'remembered yes, ten days old, endpoint says no', before: (id) => storage.set(claimKey(id), JSON.stringify({ claim: true, at: Date.now() - 10 * DAY })), answers: () => [no()], draws: false, imports: 1 },
	{ name: 'remembered yes, ten days old, nobody answers', before: (id) => storage.set(claimKey(id), JSON.stringify({ claim: true, at: Date.now() - 10 * DAY })), answers: () => [500, yes()], draws: true },
	{ name: 'remembered yes, 31 days old', before: (id) => storage.set(claimKey(id), JSON.stringify({ claim: true, at: Date.now() - 31 * DAY })), answers: () => [no()], draws: false },
	{ name: 'a yes stamped in the future', before: (id) => storage.set(claimKey(id), JSON.stringify({ claim: true, at: Date.now() + DAY })), answers: () => [yes()], draws: true },
	{ name: 'KAITO, no Inbox (ask-only)', attrs: { 'data-kaito': '1' }, answers: () => [no()], draws: true },
	{ name: 'KAITO, could not ask', attrs: { 'data-kaito': '1' }, answers: () => [500, yes()], draws: true },
	{ name: 'KAITO, an Inbox', attrs: { 'data-kaito': '1' }, answers: () => [yes()], draws: true },
	{ name: 'an open dispatched while asking, an Inbox', openEarly: true, answers: () => [yes()], draws: true },
	{ name: 'an open dispatched while asking, no Inbox', openEarly: true, answers: () => [no()], draws: false },
	{ name: 'an open dispatched while asking, KAITO', openEarly: true, attrs: { 'data-kaito': '1' }, answers: () => [no()], draws: true }
];

let n = 0;
for (const scenario of SCENARIOS) {
	test(`parity with the coral alone: ${scenario.name}`, async () => {
		const id = `p${++n}`;
		const alone = await coralAlone(scenario, id);
		const loaded = await behindLoader(scenario, id);
		assert.equal(alone.seen.drawn, scenario.draws, 'the scenario table is wrong about the coral itself');
		assert.deepEqual(loaded.seen, alone.seen);
		// The coral is imported when it draws, and — but for the one row that says so — never on a
		// page where it draws nothing.
		const imports = scenario.imports ?? (scenario.draws ? 1 : 0);
		assert.equal(loaded.imports, imports);
		assert.equal(loaded.outcome, imports ? 'loaded' : 'skipped');
	});
}

test('no Inbox, no KAITO: the coral is never imported and the loader leaves no listener behind', async () => {
	const loaded = await behindLoader({ answers: () => [no()] }, 'quiet-1');
	assert.equal(loaded.imports, 0);
	assert.equal(loaded.seen.claimRequests, 1, 'the one question the coral always asked');
	assert.equal(openListeners(), 0, 'the held-open listener outlived a no');
	assert.deepEqual(requests.map((r) => new URL(r.url).pathname), ['/api/inbox/session']);
});

test('first intent to draw imports the coral once, and a held open is replayed once', async () => {
	reset();
	const a = new El({ 'data-kind': 'site', 'data-id': 'twice-a' });
	const b = new El({ 'data-kind': 'site', 'data-id': 'twice-b' });
	pageEls = [a, b];
	script = [yes(), yes()];
	let imports = 0;
	let replays = 0;
	const loading = bubbleLoader(SRC, win, async () => {
		imports++;
		win.addEventListener('reef-inbox:open', () => replays++);
	});
	win.dispatchEvent(new FakeCustomEvent('reef-inbox:open'));
	win.dispatchEvent(new FakeCustomEvent('reef-inbox:open'));
	assert.equal(await loading, 'loaded');
	assert.equal(imports, 1, 'two elements that both draw imported the coral twice');
	assert.equal(replays, 1, 'the held opens were not replayed exactly once');
	assert.equal(openListeners(), 1, 'the loader kept its own listener after handing over');
});

test('a page without the element: the loader does nothing at all', async () => {
	reset();
	pageEls = [];
	let imports = 0;
	assert.equal(await bubbleLoader(SRC, win, async () => { imports++; }), 'none');
	assert.equal(imports, 0);
	assert.equal(requests.length, 0);
	assert.equal(openListeners(), 0);
});

test('the emitted script is the loader only — no coral body, small, same URL, same host', () => {
	const s = bubbleLoaderScript(SRC);
	assert.doesNotThrow(() => new Function(s), 'the inline module does not parse');
	// The coral's own code, by names only it defines.
	for (const marker of ['renderClosed', 'injectStyles', 'createAiLog', 'OPEN_ICON', 'dc-inbox']) {
		assert.ok(!s.includes(marker), `the loader carries the coral's ${marker}`);
	}
	assert.equal(s.split(SRC).length - 1, 1, 'the coral URL is not named exactly once');
	assert.ok(!/<\/?script/i.test(s), 'the inline module can close its own <script>');
	assert.ok(s.length < 4096, `the loader is ${s.length} bytes`);
	assert.ok(gzipSync(s).length < 2048, `the loader is ${gzipSync(s).length} bytes gzipped`);
	assert.ok(!bubbleLoaderScript('x</script><b>').includes('</script>'), 'a src can break out of the inline module');
});

test('the emitted string itself, run as the page runs it, imports the coral once on a yes and never on a no', async () => {
	// A data: module stands in for the coral, so the string's own `import(src)` is what runs.
	globalThis.__loaderImports = 0;
	const fakeCoral = 'data:text/javascript,globalThis.__loaderImports%2B%2B';
	for (const [answer, expected] of [[no, 0], [yes, 1]]) {
		reset();
		globalThis.__loaderImports = 0;
		pageEls = [new El({ 'data-kind': 'site', 'data-id': `str-${expected}` })];
		script = [answer()];
		new Function('window', bubbleLoaderScript(fakeCoral))(win);
		await settle(100);
		assert.equal(globalThis.__loaderImports, expected);
		assert.equal(claimRequests(), 1);
	}
});

test('the mirrored gate constants still match the coral', () => {
	const s = bubbleLoaderScript(SRC);
	assert.deepEqual([...coral.CLAIM_GATE_RETRY_MS], [2000, 8000, 30000]);
	assert.ok(s.includes('[2000, 8000, 30000]'));
	assert.equal(coral.CLAIM_GATE_TIMEOUT_MS, 15000);
	assert.ok(s.includes('TIMEOUT = 15000'));
	assert.equal(coral.CLAIM_GATE_STALE_MS, 30 * DAY);
	assert.ok(s.includes('STALE = 30 * 24 * 60 * 60 * 1000'));
	assert.equal(coral.claimGateKey('site:x'), 'reef-inbox:claim:site:x');
	assert.ok(s.includes("'reef-inbox:claim:' + t"));
});
