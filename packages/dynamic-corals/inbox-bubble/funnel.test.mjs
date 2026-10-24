import test from 'node:test';
import assert from 'node:assert/strict';

// reef#422 — the KAITO guidance funnel, as the bubble's side of reef PR #2310's contract.
//
// compose.test.mjs drives `createAiLog` without a DOM; this file does the same for `createFunnel`,
// and mount.test.mjs pins the WIRING against the real `mount()`. What is pinned here is the
// arithmetic: one event per call, the body's exact key set per stage, a journey in the server's
// namespace and never the log's session id, nothing at all before KAITO guides, and a transport
// that never throws.

globalThis.document = { readyState: 'loading', addEventListener() {} };
const {
	FUNNEL_FIELDS, FUNNEL_JOURNEY, FUNNEL_MAX_GUIDED, FUNNEL_NO_SECTION, FUNNEL_STAGES,
	createAiLog, createFunnel, funnelKey, funnelPageKey, funnelPayload, funnelSection, mintJourney,
	parseFunnel, sendFunnelEvent, aiLogKey
} = await import('./inbox-bubble.js');

// ── the server's side, mirrored ─────────────────────────────────────────────────────────────
//
// 🔴 A COPY OF THE RECEIVER'S RULES, NOT OF THIS FILE'S. Taken from reef
// `apps/feelreef/src/lib/inbox/funnel.ts` (`parseFunnelBody`, PR #2310) and written out here so a
// body that this coral considers fine but the route would refuse with a 400 fails a test instead of
// silently emptying the owner's funnel. If reef changes the contract, this block changes with it.
const SERVER_FIELDS = ['kind', 'id', 'journey', 'stage', 'page', 'cited_page', 'section', 'locale'];
const SERVER_JOURNEY = /^f_[0-9a-f]{16}$/;
const SERVER_SECTION = /^[\p{L}\p{N}_-]{1,80}$/u;
const SERVER_LOCALE = /^([a-z]{2,3}(-[a-z0-9]{2,8})?)?$/;
const SERVER_STAGES = ['guided', 'arrived', 'followed_up', 'handed_off'];
function serverRefusal(body) {
	const keys = Object.keys(body);
	if (keys.some((k) => ['answer', 'question', 'text'].includes(k.toLowerCase()))) return 'content_refused';
	if (keys.some((k) => !SERVER_FIELDS.includes(k))) return 'unknown_field';
	if (!SERVER_JOURNEY.test(typeof body.journey === 'string' ? body.journey : '')) return 'bad_journey';
	if (!SERVER_STAGES.includes(body.stage)) return 'bad_stage';
	if (typeof body.page !== 'string' || !body.page.trim()) return 'bad_page';
	if (body.stage === 'guided') {
		if (typeof body.cited_page !== 'string' || !body.cited_page.trim()) return 'bad_page';
	} else if (body.cited_page !== undefined) return 'bad_page';
	const section = body.section === undefined ? 'none' : body.section;
	if (typeof section !== 'string' || !SERVER_SECTION.test(section)) return 'bad_section';
	const locale = body.locale === undefined ? '' : body.locale;
	if (typeof locale !== 'string' || !SERVER_LOCALE.test(locale.toLowerCase())) return 'bad_locale';
	return null;
}

test('reef#422: the exported contract constants are the receiver\'s, value for value', () => {
	assert.deepEqual(FUNNEL_STAGES, SERVER_STAGES);
	assert.deepEqual(FUNNEL_FIELDS, SERVER_FIELDS);
	assert.equal(FUNNEL_JOURNEY.source, SERVER_JOURNEY.source);
	assert.equal(FUNNEL_NO_SECTION, 'none');
});

function funnelFixture(over = {}) {
	const cells = new Map();
	const storage = {
		getItem: (k) => (cells.has(k) ? cells.get(k) : null),
		setItem: (k, v) => cells.set(k, v)
	};
	const sent = [];
	let clock = 1_700_000_000_000;
	let n = 0;
	const funnel = createFunnel({
		tenant: 'site:acme',
		kind: 'site',
		id: 'acme',
		storage,
		now: () => clock,
		// Uneven on purpose: two journeys that differ only in their last digit would hide a funnel
		// that re-mints on every call behind one that keeps its id.
		newJourney: () => `f_${(++n).toString(16).padStart(4, '0')}9c3e7a1b5d2f`,
		send: (body) => {
			sent.push(body);
			return true;
		},
		...over
	});
	return { funnel, sent, cells, tick: (ms) => (clock += ms) };
}

test('reef#422: a whole journey sends ONE event per stage, each a body the receiver accepts', () => {
	const { funnel, sent } = funnelFixture();
	funnel.guided('/', 'https://example.test/FAQ/#Shipping-JP', 'ja-jp');
	assert.equal(sent.length, 1, 'guided did not send exactly one event');
	funnel.arrived('/faq', 'ja-jp');
	assert.equal(sent.length, 2, 'arrived did not send exactly one event');
	funnel.followedUp('/faq', 'ja-jp');
	assert.equal(sent.length, 3, 'followed_up did not send exactly one event');
	funnel.handedOff('/faq', 'ja-jp');
	assert.equal(sent.length, 4, 'handed_off did not send exactly one event');

	assert.deepEqual(sent.map((b) => b.stage), ['guided', 'arrived', 'followed_up', 'handed_off']);
	// 🔴 THE KEY SETS, EXACTLY — `cited_page` on `guided` and nowhere else.
	assert.deepEqual(Object.keys(sent[0]), ['kind', 'id', 'journey', 'stage', 'page', 'cited_page', 'section', 'locale']);
	for (const body of sent.slice(1)) {
		assert.deepEqual(Object.keys(body), ['kind', 'id', 'journey', 'stage', 'page', 'section', 'locale'], body.stage);
	}
	for (const body of sent) assert.equal(serverRefusal(body), null, `the receiver would refuse ${JSON.stringify(body)}`);

	// One journey for the whole story — the join the server needs to tell「resolved」apart.
	assert.equal(new Set(sent.map((b) => b.journey)).size, 1);
	assert.match(sent[0].journey, SERVER_JOURNEY);
	assert.deepEqual(sent[0], {
		kind: 'site', id: 'acme', journey: sent[0].journey, stage: 'guided',
		page: '/', cited_page: '/FAQ/', section: 'Shipping-JP', locale: 'ja-jp'
	});
	// The arrival names the section it was guided to; the two later stages have none.
	assert.equal(sent[1].page, '/faq');
	assert.equal(sent[1].section, 'Shipping-JP');
	assert.deepEqual([sent[2].section, sent[3].section], ['none', 'none']);
});

test('reef#422: NOTHING before KAITO guides — no request and no storage write (the control)', () => {
	const { funnel, sent, cells } = funnelFixture();
	assert.equal(funnel.arrived('/faq', ''), null);
	assert.equal(funnel.followedUp('/faq', ''), null);
	assert.equal(funnel.handedOff('/faq', ''), null);
	assert.deepEqual(sent, [], 'a stage outside a guided journey reached the network');
	assert.equal(cells.size, 0, 'a visitor who was never guided cost a storage write');
	// And the ruler can read something: the same fixture, guided once, does send.
	funnel.guided('/', '/faq', '');
	assert.equal(sent.length, 1);
});

test('reef#422: arrived only on the cited page, once per guidance — a reload is not a second arrival', () => {
	const { funnel, sent } = funnelFixture();
	funnel.guided('/', 'https://example.test/%E9%81%8B%E8%B2%BB/#zone', '');
	assert.equal(funnel.arrived('/about', ''), null, 'an arrival on a page nobody was guided to');
	// The same page, spelled the way the server would fold it.
	const arrived = funnel.arrived('/運費', '');
	assert.ok(arrived, 'the cited page did not count as reached');
	assert.equal(arrived.section, 'zone');
	assert.equal(funnel.arrived('/運費', ''), null, 'a reload counted as a second arrival');
	assert.deepEqual(sent.map((b) => b.stage), ['guided', 'arrived']);
	// Guided there again, it may arrive again — under the same journey.
	funnel.guided('/x', '/%E9%81%8B%E8%B2%BB', '');
	assert.ok(funnel.arrived('/運費/', ''));
	assert.equal(new Set(sent.map((b) => b.journey)).size, 1);
});

test('reef#422: funnelPageKey folds what reef\'s inboxPageKey folds, and keeps the path only', () => {
	assert.equal(funnelPageKey('https://example.test/FAQ/?token=secret#a'), '/faq');
	assert.equal(funnelPageKey('/a//b/'), '/a/b');
	assert.equal(funnelPageKey('/%E9%81%8B%E8%B2%BB'), '/運費');
	assert.equal(funnelPageKey('/%E5'), '/%e5');
	assert.equal(funnelPageKey(undefined), '/');
	assert.equal(funnelPageKey('https://example.test/'), '/');
});

test('reef#422: the cited section is the fragment when the server would take it, else none', () => {
	assert.equal(funnelSection('https://example.test/faq#stock'), 'stock');
	assert.equal(funnelSection('/faq#%E9%81%8B%E8%B2%BB'), '運費');
	assert.equal(funnelSection('/faq'), 'none');
	assert.equal(funnelSection('/faq#has space'), 'none');
	assert.equal(funnelSection('/faq#' + 'a'.repeat(81)), 'none');
	assert.equal(funnelSection(null), 'none');
});

test('reef#422: the body is assembled from named fields — words and odd values cannot ride along', () => {
	const body = funnelPayload('site', 'acme', 'f_0123456789abcdef', 'arrived', {
		page: '/p?email=a@b.test', cited_page: '/should-not-travel', section: 'bad section',
		locale: 'zh-Hant-TW-extra', text: 'KAITO said this', answer: 'x', question: 'y', at: 1
	});
	assert.deepEqual(body, {
		kind: 'site', id: 'acme', journey: 'f_0123456789abcdef', stage: 'arrived',
		page: '/p', section: 'none', locale: ''
	});
	assert.equal(serverRefusal(body), null);
	// A locale the server takes travels lowercased.
	assert.equal(funnelPayload('site', 'acme', 'f_0123456789abcdef', 'followed_up', { locale: 'JA-JP' }).locale, 'ja-jp');
	// Every key of every stage's body is one the contract names.
	for (const stage of FUNNEL_STAGES) {
		const b = funnelPayload('site', 'acme', 'f_0123456789abcdef', stage, { page: '/', cited_page: '/x' });
		for (const k of Object.keys(b)) assert.ok(FUNNEL_FIELDS.includes(k), `${stage}: ${k}`);
	}
});

test('reef#422: off means off — disabled, or a definite「no Inbox」, sends and stores nothing', () => {
	for (const over of [{ enabled: false }, { unclaimed: () => true }, { send: null }, { unclaimed: () => { throw new Error('x'); } }]) {
		const { funnel, sent, cells } = funnelFixture(over);
		assert.equal(funnel.enabled(), false);
		assert.equal(funnel.guided('/', '/faq', ''), null);
		assert.equal(funnel.arrived('/faq', ''), null);
		assert.equal(funnel.followedUp('/faq', ''), null);
		assert.equal(funnel.handedOff('/faq', ''), null);
		assert.deepEqual(sent, []);
		assert.equal(cells.size, 0);
	}
	// A「no」that lifts lets the next guidance through.
	let no = true;
	const { funnel, sent } = funnelFixture({ unclaimed: () => no });
	funnel.guided('/', '/faq', '');
	no = false;
	funnel.guided('/', '/faq', '');
	assert.deepEqual(sent.map((b) => b.stage), ['guided']);
});

test('reef#422: thirty idle minutes end the journey — the log\'s own session boundary', () => {
	const { funnel, sent, tick } = funnelFixture();
	funnel.guided('/', '/faq', '');
	tick(30 * 60 * 1000 + 1);
	assert.equal(funnel.arrived('/faq', ''), null, 'an arrival outlived its journey');
	funnel.guided('/', '/faq', '');
	assert.equal(sent.length, 2);
	assert.notEqual(sent[0].journey, sent[1].journey, 'a cold journey was resumed rather than replaced');
	// Activity keeps it warm: every stage moves `last`.
	tick(20 * 60 * 1000);
	funnel.followedUp('/', '');
	tick(20 * 60 * 1000);
	assert.ok(funnel.arrived('/faq', ''), 'a journey in use expired');
});

test('reef#422: a journey is not a session id — different minting, namespace and storage key', () => {
	const cells = new Map();
	const storage = { getItem: (k) => (cells.has(k) ? cells.get(k) : null), setItem: (k, v) => cells.set(k, v) };
	const sessions = [];
	const log = createAiLog({
		tenant: 'site:acme', kind: 'site', id: 'acme', storage,
		// The mount's own minting, not a stub: what is compared is what a browser would hold.
		newId: () => crypto.randomUUID(),
		send: (p) => (sessions.push(p), true), probeClaim: async () => true
	});
	const events = [];
	const funnel = createFunnel({
		tenant: 'site:acme', kind: 'site', id: 'acme', storage,
		send: (b) => events.push(b)
	});
	log.page('/');
	log.question('where is my order?', '/', 'https://example.test/faq#a', '');
	funnel.guided('/', 'https://example.test/faq#a', '');
	const sid = log.state().sid;
	const journey = events[0].journey;
	assert.match(journey, SERVER_JOURNEY);
	assert.notEqual(journey, sid);
	// 🔴 The server's disjointness rule, from both sides: no session id is in the `f_` namespace.
	assert.notEqual(sid.slice(0, 2).toLowerCase(), 'f_');
	assert.notEqual(funnelKey('site:acme'), aiLogKey('site:acme'));
	assert.equal(JSON.parse(cells.get(aiLogKey('site:acme'))).sid, sid);
	assert.equal(JSON.parse(cells.get(funnelKey('site:acme'))).journey, journey);
	// Neither cell carries the other's id.
	assert.equal(cells.get(aiLogKey('site:acme')).includes(journey), false);
	assert.equal(cells.get(funnelKey('site:acme')).includes(sid), false);
	// And a stream of minted journeys stays in the namespace (the fallback too).
	for (let i = 0; i < 200; i++) assert.match(mintJourney(), SERVER_JOURNEY);
	assert.match(mintJourney(() => { throw new Error('no Web Crypto'); }), SERVER_JOURNEY);
});

test('reef#422: a journey remembers at most FUNNEL_MAX_GUIDED guidances, newest kept', () => {
	const { funnel } = funnelFixture();
	for (let i = 0; i <= FUNNEL_MAX_GUIDED; i++) funnel.guided('/', `/p${i}`, '');
	const held = funnel.state();
	assert.equal(held.guided.length, FUNNEL_MAX_GUIDED);
	assert.equal(held.guided[0].page, '/p1');
	assert.equal(parseFunnel({ journey: 'not-one', last: 1, guided: [] }, 1), null);
	assert.equal(parseFunnel({ journey: 'f_0123456789abcdef', last: 'x', guided: [] }, 1), null);
});

test('reef#422: best effort — a transport or a store that throws never reaches the visitor', () => {
	// A `send` that throws: the call still returns, and the next stage still runs.
	const { funnel } = funnelFixture({ send: () => { throw new Error('offline'); } });
	assert.ok(funnel.guided('/', '/faq', ''));
	assert.ok(funnel.arrived('/faq', ''));
	// A store that stops taking writes: the journey goes on in memory for this document.
	const broken = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
	const sent = [];
	const mem = createFunnel({ tenant: 't', kind: 'site', id: 'acme', storage: broken, send: (b) => sent.push(b) });
	mem.guided('/', '/faq', '');
	assert.ok(mem.arrived('/faq', ''), 'a full quota lost the journey');
	assert.equal(sent[0].journey, sent[1].journey);
	// No storage at all works the same way.
	const none = createFunnel({ tenant: 't', kind: 'site', id: 'acme', storage: null, send: () => {} });
	none.guided('/', '/faq', '');
	assert.ok(none.arrived('/faq', ''));
});

test('reef#422: sendFunnelEvent is one keepalive JSON POST, and never throws', async () => {
	const calls = [];
	const ok = sendFunnelEvent('https://api.example/api/inbox/funnel', { kind: 'site' }, {
		fetch: (url, init) => (calls.push({ url, init }), Promise.resolve({ ok: true, status: 204 }))
	});
	assert.equal(ok, true);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://api.example/api/inbox/funnel');
	// 🔴 JSON, not `text/plain`: reef's cross-site form check exempts `/api/inbox/session` alone, so
	// a `text/plain` body (what `sendBeacon` with a string sends) would be refused 403 here.
	assert.deepEqual(calls[0].init, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: '{"kind":"site"}', credentials: 'omit', keepalive: true
	});
	// A fetch that rejects, one that throws, and no fetch at all: none of them throws.
	assert.equal(sendFunnelEvent('u', {}, { fetch: () => Promise.reject(new Error('net')) }), true);
	assert.equal(sendFunnelEvent('u', {}, { fetch: () => { throw new TypeError('bad'); } }), false);
	assert.equal(sendFunnelEvent('u', {}, { fetch: null }), false);
	await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run here
});
