import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

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
	focus() { focuses++; }
}

/** Every `.focus()` the coral made — an open it handled twice focuses twice (codex round 2, P2). */
let focuses = 0;
const storage = new Map();
/**
 * How this browser's storage misbehaves, per test (codex round 2, P1): `ok`, `getter` (reading
 * `window.localStorage` throws), `read` (`getItem` throws), `write` (`setItem` throws — a full
 * quota, a privacy mode), `claim-write` (a quota with room for the loader's short probe and none for
 * the claim — codex round 2's reproduction of why the probe is not a guarantee).
 */
let storageFault = 'ok';
const localStore = {
	getItem: (k) => {
		if (storageFault === 'read') throw new Error('SecurityError');
		return storage.has(k) ? storage.get(k) : null;
	},
	setItem: (k, v) => {
		if (storageFault === 'write') throw new Error('QuotaExceededError');
		if (storageFault === 'claim-write' && k.startsWith('reef-inbox:claim:')) throw new Error('QuotaExceededError');
		storage.set(k, v);
	},
	removeItem: (k) => storage.delete(k)
};
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
	get localStorage() {
		if (storageFault === 'getter') throw new Error('SecurityError');
		return localStore;
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
const { bubbleLoader, bubbleLoaderScript, CORAL_FLOOR } = await import('./astro/src/lib/inbox-bubble-loader.mjs');

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
	storageFault = 'ok';
	windowListeners.clear();
	requests.length = 0;
	delays.length = 0;
	focuses = 0;
	delete win.__coralVersions;
	delete win.__reefInboxLoader;
}

/** What the visitor and the network saw, after everything settled. */
function observe(el) {
	const stored = storage.get(claimKey(el.getAttribute('data-id')));
	return {
		claimRequests: claimRequests(),
		delays: [...delays],
		drawn: el.children.length > 0,
		open: el.children.length > 0 && el.children[0].innerHTML.includes('role="dialog"'),
		focuses,
		claimKey: stored === undefined ? 'absent' : JSON.parse(stored).claim === true ? 'yes' : stored
	};
}

/** The coral alone — what `<script type="module" src>` did. */
async function coralAlone(scenario, id) {
	reset();
	scenario.before?.(id);
	storageFault = scenario.storage ?? 'ok';
	script = scenario.answers();
	const el = new El({ 'data-kind': 'site', 'data-id': id, ...scenario.attrs });
	const mounting = coral.mount(el);
	// Either way the open lands once the coral's listeners exist: while it asks, or (`openAtEvaluation`)
	// in the turn its module evaluated — for a <script src> coral those are the same moment.
	if (scenario.openEarly || scenario.openAtEvaluation) win.dispatchEvent(new FakeCustomEvent('reef-inbox:open'));
	await mounting;
	await settle();
	return { seen: observe(el), imports: 'n/a' };
}

/**
 * The two corals the `v0` channel can serve behind the loader. `handoff` is this checkout (0.7.12+):
 * its module evaluation is `mountAll()`, which takes `window.__reefInboxLoader`. `older` is every
 * published coral before it (≤ 0.7.11): its `mountAll()` mounts each element knowing nothing of the
 * handoff — `mount(el)` with none is exactly that — and the registry's stamp is the artifact's last
 * statement (build.mjs `reg`).
 */
const CORALS = {
	handoff: () => coral.mountAll(),
	older: () => {
		for (const el of pageEls) {
			if (el.getAttribute('data-dynamic-coral-mounted') === '1') continue;
			el.setAttribute('data-dynamic-coral-mounted', '1');
			void coral.mount(el);
		}
		(win.__coralVersions ??= {})['inbox-bubble'] = '0.7.11';
	}
};

/** The loader, importing the coral (which mounts the element, as its auto-mount does) on demand. */
async function behindLoader(scenario, id, served = 'handoff') {
	reset();
	scenario.before?.(id);
	storageFault = scenario.storage ?? 'ok';
	script = scenario.answers();
	const el = new El({ 'data-kind': 'site', 'data-id': id, ...scenario.attrs });
	pageEls = [el];
	let imports = 0;
	const loading = bubbleLoader(SRC, win, async (src) => {
		assert.equal(src, SRC);
		imports++;
		// The module's own evaluation — every listener it installs exists from here.
		CORALS[served]();
		// 🩸 codex round 2, P2: an open dispatched after the coral evaluated and before the import's
		// continuation runs (another task, a focus handler). The coral hears it; nothing may hear it twice.
		if (scenario.openAtEvaluation) win.dispatchEvent(new FakeCustomEvent('reef-inbox:open'));
	});
	if (scenario.openEarly) win.dispatchEvent(new FakeCustomEvent('reef-inbox:open'));
	const outcome = await loading;
	await settle();
	return { seen: observe(el), imports, outcome, handoffLeft: win.__reefInboxLoader };
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
	{ name: 'an open dispatched while asking, KAITO', openEarly: true, attrs: { 'data-kaito': '1' }, answers: () => [no()], draws: true },
	// 🩸 codex round 2, P1 — storage that cannot carry a yes from the loader to the coral. The second
	// answer is the one round 1 let decide: the coral asked again and lost the bubble the first yes
	// earned. A store that cannot carry it means the coral is imported at once and asks its own one
	// question — the <script src> behaviour, for any coral the channel serves — so a no there still
	// downloads it (`imports: 1`), as it always did in those browsers.
	{ name: 'storage refuses the write, then yes (a second answer would say no)', storage: 'write', answers: () => [yes(), no()], draws: true },
	{ name: 'storage refuses the write, then no', storage: 'write', answers: () => [no(), yes()], draws: false, imports: 1 },
	{ name: 'storage refuses the write, could not ask, then yes', storage: 'write', answers: () => [503, yes(), no()], draws: true },
	{ name: 'storage refuses the read, then yes (a second answer would say no)', storage: 'read', answers: () => [yes(), no()], draws: true },
	{ name: 'storage refuses the read, then no', storage: 'read', answers: () => [no(), yes()], draws: false, imports: 1 },
	{ name: 'no storage at all (the getter throws), then yes', storage: 'getter', answers: () => [yes(), no()], draws: true },
	{ name: 'no storage at all (the getter throws), then no', storage: 'getter', answers: () => [no(), yes()], draws: false, imports: 1 },
	// 🩸 codex round 2, P2 — an open dispatched in the window between the coral's evaluation and the
	// import's continuation: heard by the coral, and must not be handled a second time.
	{ name: 'an open dispatched as the coral evaluates, an Inbox', openAtEvaluation: true, answers: () => [yes()], draws: true },
	{ name: 'an open dispatched as the coral evaluates, KAITO', openAtEvaluation: true, attrs: { 'data-kaito': '1' }, answers: () => [no()], draws: true },
	{ name: 'an open dispatched as the coral evaluates, remembered yes', openAtEvaluation: true, before: (id) => storage.set(claimKey(id), JSON.stringify({ claim: true, at: Date.now() - HOUR })), answers: () => [], draws: true },
	{ name: 'an open dispatched as the coral evaluates, storage refuses the write', openAtEvaluation: true, storage: 'write', answers: () => [yes()], draws: true }
];

// Every row twice: behind the loader with the coral this checkout publishes, and with an older one.
// The older-coral rows show the fallbacks hold on THESE rows — not that an older coral is safe behind
// the loader in general: it is not (see the floor tests at the end), which is why the coral goes
// first and the channel never drops below `CORAL_FLOOR` while loader pages exist.
let n = 0;
for (const served of Object.keys(CORALS)) {
	for (const scenario of SCENARIOS) {
		test(`parity with the coral alone (${served} coral): ${scenario.name}`, async () => {
			const id = `p${++n}`;
			const alone = await coralAlone(scenario, id);
			const loaded = await behindLoader(scenario, id, served);
			assert.equal(alone.seen.drawn, scenario.draws, 'the scenario table is wrong about the coral itself');
			assert.deepEqual(loaded.seen, alone.seen);
			// The coral is imported when it draws, and — but for the rows that say so — never on a
			// page where it draws nothing.
			const imports = scenario.imports ?? (scenario.draws ? 1 : 0);
			assert.equal(loaded.imports, imports);
			assert.equal(loaded.outcome, imports ? 'loaded' : 'skipped');
			assert.equal(loaded.handoffLeft, undefined, 'the handoff outlived the page load');
		});
	}
}

test('no Inbox, no KAITO: the coral is never imported and the loader leaves no listener behind', async () => {
	const loaded = await behindLoader({ answers: () => [no()] }, 'quiet-1');
	assert.equal(loaded.imports, 0);
	assert.equal(loaded.seen.claimRequests, 1, 'the one question the coral always asked');
	assert.equal(openListeners(), 0, 'the held-open listener outlived a no');
	assert.deepEqual(requests.map((r) => new URL(r.url).pathname), ['/api/inbox/session']);
});

for (const served of Object.keys(CORALS)) {
	test(`two opens — one before the coral, one as it evaluates — are handled twice, never three times (${served} coral)`, async () => {
		// Not a parity row: alone, the coral is still asking when both arrive and folds them into one.
		// Behind the loader the second lands on a panel that is already open, which is a refocus — the
		// coral's documented answer to an open on an open panel. What must not happen is the first one
		// reaching the coral a second time.
		const loaded = await behindLoader({ openEarly: true, openAtEvaluation: true, answers: () => [yes()] }, `twice-${served}`, served);
		assert.equal(loaded.seen.open, true);
		assert.equal(loaded.seen.focuses, 2);
	});
}

test('the handoff coral takes the loader\'s yes in memory: a consent script that clears storage before it evaluates costs no second question', async () => {
	reset();
	const el = new El({ 'data-kind': 'site', 'data-id': 'wiped' });
	pageEls = [el];
	script = [yes(), no()];
	const outcome = await bubbleLoader(SRC, win, async () => {
		storage.clear();
		coral.mountAll();
	});
	await settle();
	assert.equal(outcome, 'loaded');
	assert.equal(claimRequests(), 1, 'the coral asked again');
	assert.equal(el.children.length > 0, true, 'the bubble the first yes earned was lost');
	assert.equal(win.__reefInboxLoader, undefined);
});

test('a handoff of a shape the coral does not know is left alone: it asks, as without one', async () => {
	reset();
	const el = new El({ 'data-kind': 'site', 'data-id': 'forged' });
	pageEls = [el];
	script = [no()];
	win.__reefInboxLoader = { v: 1, claims: { 'site:forged': 'yes' }, open: false, taken: false };
	coral.mountAll();
	await settle();
	assert.equal(claimRequests(), 1);
	assert.equal(el.children.length, 0);
	win.__reefInboxLoader = { v: 2, claims: { 'site:forged': true } };
	coral.mountAll();
	assert.equal(win.__reefInboxLoader?.v, 2, 'a version this coral does not speak was consumed');
});

test('first intent to draw imports the coral once, and a held open is replayed once to a coral that takes no handoff', async () => {
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
	// 4.5 KB raw since the round-2 handoff (round 1: 4 KB); the wire carries the gzip line below.
	assert.ok(s.length < 4608, `the loader is ${s.length} bytes`);
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

// ── the floor (codex review of tile#151, round 2) ─────────────────────────────────────────────────
//
// 🔴 CORAL FIRST IS MANDATORY. The loader's fallbacks for a coral that predates the handoff narrow the
// gap; they do not close it. The tests below pin both halves: the coral this checkout publishes takes
// the handoff and is at or above the floor the loader names, and an older coral is shown failing the
// cases the probe cannot see — so nobody reads the older-coral parity rows as a licence to ship the
// engine first or roll the channel back below the floor.

const semver = (v) => v.split('.').map(Number);
const atLeast = (v, floor) => {
	const [a, b] = [semver(v), semver(floor)];
	for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
	return true;
};

/** Two bubbles for two tenants on one page, behind the loader; returns what each one saw. */
async function twoTenants(served, answers) {
	reset();
	const a = new El({ 'data-kind': 'site', 'data-id': `mix-a-${served}` });
	const b = new El({ 'data-kind': 'site', 'data-id': `mix-b-${served}` });
	pageEls = [a, b];
	script = answers;
	let imports = 0;
	const outcome = await bubbleLoader(SRC, win, async () => { imports++; CORALS[served](); });
	await settle();
	return { outcome, imports, claimRequests: claimRequests(), drawn: [a.children.length > 0, b.children.length > 0] };
}

test('the floor: the emitted loader and the coral\'s handoff contract name the same minimum version, and this coral meets it', async () => {
	assert.match(CORAL_FLOOR, /^\d+\.\d+\.\d+$/);
	assert.equal(coral.LOADER_HANDOFF_SINCE, CORAL_FLOOR, 'the coral\'s handoff contract and the loader disagree about the floor');
	const s = bubbleLoaderScript(SRC);
	assert.ok(s.startsWith(`/*inbox-bubble>=${CORAL_FLOOR}*/(function bubbleLoader(`), 'built pages no longer name the floor they need');
	const pkg = JSON.parse(readFileSync(new URL('../dynamic-corals/inbox-bubble/package.json', import.meta.url), 'utf8'));
	assert.ok(atLeast(pkg.version, CORAL_FLOOR), `inbox-bubble ${pkg.version} is below the loader's floor ${CORAL_FLOOR}`);
	// The publishing checklist verifies the floor by name.
	const readme = readFileSync(new URL('../dynamic-corals/inbox-bubble/README.md', import.meta.url), 'utf8');
	assert.ok(readme.includes(`X-Coral-Resolved: ${CORAL_FLOOR}`) && readme.includes(`/*inbox-bubble>=${CORAL_FLOOR}*/`),
		'the coral README\'s rollout checklist does not name the floor');

	// And the contract itself, end to end: the object THIS loader writes is the one THIS coral takes.
	// Storage keeps nothing for the claim, so only the handoff can carry the yes.
	reset();
	storageFault = 'claim-write';
	const el = new El({ 'data-kind': 'site', 'data-id': 'floor' });
	pageEls = [el];
	script = [yes(), no()];
	let handed;
	const outcome = await bubbleLoader(SRC, win, async () => {
		handed = win.__reefInboxLoader;
		coral.mountAll();
	});
	await settle();
	assert.equal(outcome, 'loaded');
	assert.equal(handed?.v, 1);
	assert.equal(handed.taken, true, 'the coral did not take the loader\'s handoff');
	assert.equal(claimRequests(), 1, 'the coral asked again');
	assert.equal(el.children.length > 0, true, 'the bubble the first yes earned was lost');
});

test('the floor coral takes a handed no and a handed could-not-say: a second tenant on the page is not asked again', async () => {
	// codex round 2: "treat a handed false as absent" passed every single-element row, because a lone
	// no never imports the coral. Two tenants, one yes, imports it — and the other is handed its answer.
	const no2 = await twoTenants('handoff', [yes(), no()]);
	assert.deepEqual(no2, { outcome: 'loaded', imports: 1, claimRequests: 2, drawn: [true, false] });
	const unknown = await twoTenants('handoff', [yes(), 500, 500, 500, 500]);
	assert.deepEqual(unknown, { outcome: 'loaded', imports: 1, claimRequests: 5, drawn: [true, false] });
});

test('an older coral behind the loader is NOT at parity — why coral first is mandatory', async () => {
	// 🔴 Not a wish: a record. If one of these ever turns into parity, that is news — re-read the coral
	// README's floor section before relaxing the rollout order, do not just flip the numbers.
	const scenario = { storage: 'claim-write', answers: () => [yes(), no()], draws: true };
	const alone = await coralAlone(scenario, 'quota-older');
	assert.deepEqual([alone.seen.claimRequests, alone.seen.drawn], [1, true], 'the eager coral itself');
	// A quota with room for the probe and none for the claim: the probe passes, the claim never lands,
	// and the older coral asks again — the second answer takes away the bubble.
	const older = await behindLoader(scenario, 'quota-older', 'older');
	assert.deepEqual([older.seen.claimRequests, older.seen.drawn], [2, false]);
	const floor = await behindLoader(scenario, 'quota-floor', 'handoff');
	assert.deepEqual([floor.seen.claimRequests, floor.seen.drawn], [1, true]);
	// Two tenants, yes and no: the older coral asks the no tenant a second time.
	assert.equal((await twoTenants('older', [yes(), no(), no()])).claimRequests, 3);
});
