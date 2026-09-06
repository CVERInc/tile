// Behavioural test of the EMITTED _worker.js composing the contract's SITE-OWNED
// buyer pages into the site's own repository-built shell. Emit a real worker, load
// it, and drive `default.fetch` with a mock RSP binding and mock ASSETS — same
// shape as emit-api-transport.test.mjs, nothing asserted about source text that
// could be asserted about behaviour.
//
// 🔴 THE FIXTURE CONTRACT DELIBERATELY DISAGREES WITH THE REAL ONE. Its pages are
// /tiers and /hub, not /membership and /account; its facts endpoints are
// /zapi/tier-facts and /zapi/hub-facts; its binding is SEAMLINK. Only `kind`
// (membership | account) is shared, because kind is the BODY RENDERER selector.
// An emitter or worker that recognised these pages from a path literal would pass
// a test written against the real contract and fail every one of these.
//
// The real contract lives in another repo of ours (reef,
// apps/mixfairy/scripts/site-api-transport.contract.json). Point
// SITE_API_TRANSPORT_CONTRACT at it and the last block also runs against the real
// paths; without it that block says by name that it was skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'buyer-page-composition-'));

const BINDING = 'SEAMLINK';
const MISSING_STATUS = 599;
const MISSING_CC = 'private, max-age=0, no-store, fixture-marker';

// Both pages are ALSO in `forward`, exactly as the real contract keeps
// /membership and /account there for already-emitted workers. That is what makes
// "the early claim wins" a real contest rather than a vacuous one.
const FIXTURE_CONTRACT = {
	schemaVersion: 2,
	bindingName: BINDING,
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: MISSING_STATUS, cacheControl: MISSING_CC },
	siteOwnedBuyerPages: [
		{ path: '/tiers', method: 'GET', kind: 'membership', factsPath: '/zapi/tier-facts' },
		{ path: '/hub', method: 'GET', kind: 'account', factsPath: '/zapi/hub-facts' }
	],
	forward: [
		{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: '/tiers', methods: ['GET'] },
		{ match: 'exact', value: '/hub', methods: ['GET'] }
	]
};
const { siteOwnedBuyerPages: _claimed, ...OLD_FIXTURE_CONTRACT } = FIXTURE_CONTRACT;

const fixturePath = join(workDir, 'fixture.contract.json');
writeFileSync(fixturePath, JSON.stringify(FIXTURE_CONTRACT, null, 2));
const oldFixturePath = join(workDir, 'old-fixture.contract.json');
writeFileSync(oldFixturePath, JSON.stringify({ ...OLD_FIXTURE_CONTRACT, schemaVersion: 1 }, null, 2));

let emitted = 0;
function emitFile(args) {
	const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
	execFileSync('node', [join(here, 'emit-shop-function.mjs'), ...args, '--out', out],
		{ stdio: ['ignore', 'ignore', 'pipe'] });
	return out;
}
async function emitWorker(args) {
	return import(pathToFileURL(emitFile(args)).href);
}

// A site with NO shop at all: /tiers and /hub must work on one, which is why the
// donor shell cannot be a shop page.
const claimed = await emitWorker(['--site-id', 'site-1', '--api-contract', fixturePath]);
const oldWorker = await emitWorker(['--site-id', 'site-1', '--api-contract', oldFixturePath]);

// ── the site's own repository-built shell ────────────────────────────────────
const NAV = 'NAV-燈塔灣';
const FOOT = 'FOOT-燈塔灣';
const SHELL = `<!doctype html><html lang="zh-Hant"><head><title>燈塔灣</title>` +
	`<meta name="description" content="DONOR-DESC"><meta property="og:image" content="/donor-og.jpg">` +
	`<link rel="canonical" href="https://s.example/"></head>` +
	`<body><header class="site-nav">${NAV}</header><main class="site-main"><p>HOME-BODY</p></main>` +
	`<footer class="site-foot">${FOOT}</footer></body></html>`;
const SHELL_NO_MAIN = `<!doctype html><html lang="zh-Hant"><head><title>燈塔灣</title></head>` +
	`<body><header>${NAV}</header><div id="content"><p>HOME-BODY</p></div></body></html>`;

const PLANS = {
	state: 'available',
	plans: [
		{ plan_id: 'plan_gold', display_name: '金級會員', amount: 1200, currency: 'TWD', interval: 'month' },
		{ plan_id: 'plan_silver', display_name: '銀級會員', amount: 600, currency: 'TWD', interval: 'month' }
	]
};

// `shell` chooses what ASSETS answers for the site root; everything else is a
// plain static hit, so a page that fell through is visible rather than assumed.
function makeEnv({ rsp = null, shell = SHELL, bindingName = BINDING } = {}) {
	const seenByRsp = [];
	const seenByAssets = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				const url = new URL(typeof req === 'string' ? req : req.url);
				seenByAssets.push({ method: req.method || 'GET', url, path: url.pathname });
				if (url.pathname === '/') {
					if (shell === null) return new Response('missing', { status: 404 });
					return new Response(shell, { status: 200, headers: { 'content-type': 'text/html' } });
				}
				return new Response('STATIC:' + url.pathname, { status: 200 });
			}
		}
	};
	if (rsp) {
		env[bindingName] = {
			fetch: async (req) => {
				const url = new URL(req.url);
				seenByRsp.push({ method: req.method, path: url.pathname, headers: req.headers });
				return rsp(url.pathname, req);
			}
		};
	}
	return { env, seenByRsp, seenByAssets };
}
const factsRsp = (byPath) => (pathname) => {
	const entry = byPath[pathname];
	if (!entry) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
	if (typeof entry === 'function') return entry();
	return new Response(JSON.stringify(entry), { status: 200, headers: { 'content-type': 'application/json' } });
};
const get = (path, init) => new Request('https://s.example' + path, init);
const keepsShell = (html) => html.includes('<html lang="zh-Hant"') && html.includes(NAV) && html.includes(FOOT);

// ── 1. the shell is the site's; only the body follows the facts ──────────────

test('membership: the donor shell keeps lang, nav, main chrome and footer', async () => {
	const { env } = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }) });
	const res = await claimed.default.fetch(get('/tiers'), env);
	const html = await res.text();

	assert.equal(res.status, 200);
	assert.equal(html.includes('<html lang="zh-Hant"'), true, 'the site declares the language, not the platform');
	assert.equal(html.includes(NAV), true, 'the site nav survives');
	assert.equal(html.includes(FOOT), true, 'the site footer survives');
	assert.equal(html.includes('<main class="site-main"'), true, 'the shell main element and its class survive');
	assert.equal(html.includes('HOME-BODY'), false, 'the donor body is replaced, not appended to');
	assert.equal(html.includes('DONOR-DESC'), false, 'the donor description is stripped');
	assert.equal(html.includes('/donor-og.jpg'), false, 'the donor og is stripped');
});

test('membership: plan facts render with the island subscribe slot and plan ids', async () => {
	const { env } = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }) });
	const html = await (await claimed.default.fetch(get('/tiers'), env)).text();

	assert.equal(html.includes('data-ejecta-membership-state="available"'), true);
	assert.equal(html.includes('data-ejecta-slot="subscribe" data-ejecta-plan="plan_gold"'), true);
	assert.equal(html.includes('data-ejecta-slot="subscribe" data-ejecta-plan="plan_silver"'), true);
	assert.equal(html.includes('金級會員'), true);
	assert.equal(html.includes('data-ejecta-slot="auth-state"'), true, 'the auth-state slot the island fills');
	assert.equal(html.includes('src="/seam/island.js"'), true, 'the island script is loaded');
});

test('membership: visible copy follows the SHELL locale, never a platform default', async () => {
	const hant = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }) });
	const hantHtml = await (await claimed.default.fetch(get('/tiers'), hant.env)).text();
	assert.equal(hantHtml.includes('會員方案'), true, 'zh-Hant shell gets zh-TW copy');
	assert.equal(hantHtml.includes('Membership'), false);
	assert.equal(hantHtml.includes('メンバーシップ'), false, 'no Japanese platform default leaks in');

	const en = makeEnv({
		rsp: factsRsp({ '/zapi/tier-facts': PLANS }),
		shell: SHELL.replace('lang="zh-Hant"', 'lang="en-US"')
	});
	const enHtml = await (await claimed.default.fetch(get('/tiers'), en.env)).text();
	assert.equal(enHtml.includes('Membership'), true, 'an en shell gets en copy');
	assert.equal(enHtml.includes('會員方案'), false);
});

test('membership: changing the facts changes ONLY the body', async () => {
	const withPlans = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }) });
	const empty = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': { state: 'empty', plans: [] } }) });
	const a = await (await claimed.default.fetch(get('/tiers'), withPlans.env)).text();
	const b = await (await claimed.default.fetch(get('/tiers'), empty.env)).text();

	assert.equal(keepsShell(a) && keepsShell(b), true, 'both keep the same site shell');
	assert.equal(a.slice(0, a.indexOf('<main')), b.slice(0, b.indexOf('<main')),
		'everything before <main> — doctype, lang, head — is identical');
	assert.equal(a.slice(a.indexOf('</main>')), b.slice(b.indexOf('</main>')),
		'everything after </main> — footer, closing chrome — is identical');
	assert.notEqual(a.slice(a.indexOf('<main')), b.slice(b.indexOf('<main')), 'the body did change');
	assert.equal(b.includes('data-ejecta-membership-state="empty"'), true);
	assert.equal(b.includes('data-ejecta-slot="subscribe"'), false, 'an empty catalog offers nothing to buy');
});

// ── 2. /account signed out and signed in ─────────────────────────────────────

test('account signed out: same shell, the auth-request form, no section markers', async () => {
	const { env } = makeEnv({ rsp: factsRsp({ '/zapi/hub-facts': { signed_in: false, sections: [] } }) });
	const res = await claimed.default.fetch(get('/hub'), env);
	const html = await res.text();

	assert.equal(res.status, 200);
	assert.equal(keepsShell(html), true);
	assert.equal(html.includes('data-ejecta-account-state="logged-out"'), true);
	assert.equal(html.includes('data-ejecta-slot="auth-request"'), true);
	assert.equal(html.includes('data-ejecta-account-section='), false, 'signed out stamps no sections');
	assert.equal(html.includes('data-ejecta-slot="email-change"'), false,
		'the change-email slot belongs to a signed-in member only');
	assert.equal(html.includes('登入'), true, 'the form copy follows the shell locale');
});

test('account signed in: the server-returned section set, and nothing else', async () => {
	const { env } = makeEnv({
		rsp: factsRsp({ '/zapi/hub-facts': { signed_in: true, sections: ['orders', 'membership', 'profile', 'contact'] } })
	});
	const html = await (await claimed.default.fetch(get('/hub'), env)).text();

	assert.equal(keepsShell(html), true);
	assert.equal(html.includes('data-ejecta-account-state="logged-in"'), true);
	for (const section of ['orders', 'membership', 'profile', 'contact']) {
		assert.equal(html.includes('data-ejecta-account-section="' + section + '"'), true, section + ' is stamped');
	}
	assert.equal(html.includes('data-ejecta-account-section="discord"'), false,
		'a section the server did not return is never invented here');
	assert.equal((html.match(/data-ejecta-account-section=/g) || []).length, 4);
	assert.equal(html.includes('data-ejecta-slot="auth-request"'), false, 'signed in gets no login form');
	assert.equal(html.includes('src="/seam/island.js"'), true);

	// The change-email entry is a submit slot, not a gated read section: the server
	// returns no marker for it and a signed-in member always has it.
	assert.equal(html.includes('data-ejecta-slot="email-change"'), true);
	assert.equal(html.includes('data-ejecta-email-change-status='), true, 'its status line is present for the island');
	assert.equal(html.includes('id="ejecta-account-new-email"'), true);
	assert.equal(html.includes('新的電子郵件'), true, 'its copy follows the shell locale too');
	assert.equal(html.includes('新しいメールアドレス'), false, 'no Japanese platform default leaks in');
});

test('account: the cookie reaches the facts binding, on the contract-declared path', async () => {
	const { env, seenByRsp } = makeEnv({
		rsp: factsRsp({ '/zapi/hub-facts': { signed_in: true, sections: ['profile'] } })
	});
	await claimed.default.fetch(get('/hub', { headers: { cookie: 'ej_session=member-1; other=2' } }), env);

	assert.equal(seenByRsp.length, 1);
	assert.equal(seenByRsp[0].path, '/zapi/hub-facts', 'the contract names the facts path, not this worker');
	assert.equal(seenByRsp[0].method, 'GET');
	assert.equal(seenByRsp[0].headers.get('cookie'), 'ej_session=member-1; other=2');
});

test('account and membership responses are private and never cached', async () => {
	for (const [path, facts] of [['/tiers', PLANS], ['/hub', { signed_in: false, sections: [] }]]) {
		const { env } = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': facts, '/zapi/hub-facts': facts }) });
		const res = await claimed.default.fetch(get(path), env);
		assert.equal(res.headers.get('cache-control'), 'private, no-store', path);
		assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', path);
	}
});

// ── 3. honest failure, with the passing control in the same test ─────────────

test('failure arms: the control passes, each failure is honest, none is a fabricated 200', async () => {
	// POSITIVE CONTROL — shell available and facts available. If this ever stops
	// passing, every "must not" below is vacuous.
	const control = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }) });
	const controlRes = await claimed.default.fetch(get('/tiers'), control.env);
	const controlHtml = await controlRes.text();
	assert.equal(controlRes.status, 200, 'control: a working page is 200');
	assert.equal(controlHtml.includes('data-ejecta-slot="subscribe"'), true, 'control: plans render');
	assert.equal(controlHtml.includes('data-ejecta-membership-unavailable'), false,
		'control: the unavailable marker is ABSENT when nothing failed');

	// binding never wired — the contract's own onBindingMissing status
	const noBinding = makeEnv({ rsp: null });
	const nb = await claimed.default.fetch(get('/tiers'), noBinding.env);
	const nbHtml = await nb.text();
	assert.equal(nb.status, MISSING_STATUS, 'the status comes from the contract, not a literal here');
	assert.notEqual(nb.status, 200);
	assert.equal(keepsShell(nbHtml), true, 'an available shell still owns the page');
	assert.equal(nbHtml.includes('data-ejecta-membership-state="unavailable"'), true);
	assert.equal(nbHtml.includes('data-ejecta-slot="subscribe"'), false, 'no plan is invented');

	// the facts read fails in each way it can, shell available
	const failures = [
		['throws', () => { throw new Error('binding down'); }, null],
		['non-2xx', () => new Response('nope', { status: 500 }), 500],
		['unparseable', () => new Response('<html>not json</html>', { status: 200 }), 502],
		['null body', () => new Response('null', { status: 200 }), 502]
	];
	for (const [name, answer, expected] of failures) {
		const { env } = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': answer }) });
		const res = await claimed.default.fetch(get('/tiers'), env);
		const html = await res.text();
		assert.notEqual(res.status, 200, name + ' must not answer 200');
		if (expected !== null) assert.equal(res.status, expected, name);
		assert.equal(keepsShell(html), true, name + ' stays inside the site shell');
		assert.equal(html.includes('data-ejecta-membership-state="unavailable"'), true, name);
		assert.equal(html.includes('data-ejecta-slot="subscribe"'), false, name + ' must not fabricate plans');
	}

	// the facts seam REFUSES (the module is not on this site) — the refusal keeps
	// its own status and carries no plan or subscribe marker
	const refused = makeEnv({ rsp: factsRsp({}) }); // every path answers 404
	const rf = await claimed.default.fetch(get('/tiers'), refused.env);
	const rfHtml = await rf.text();
	assert.equal(rf.status, 404, 'a refusal stays a refusal, not a generic unavailable');
	assert.equal(rfHtml.includes('data-ejecta-slot="subscribe"'), false);
	assert.equal(rfHtml.includes('data-ejecta-plan='), false);
	assert.equal(keepsShell(rfHtml), true, 'the refusal is still the site\'s own page');
	assert.equal(rfHtml.includes('data-ejecta-membership-route="unavailable"'), true,
		'the route-level refusal keeps its own marker, as the RSP page does');
	assert.equal(rfHtml.includes('data-ejecta-membership-state="unavailable"'), false,
		'a permanent refusal is not the transient could-not-read-state');
	assert.equal(rfHtml.includes('請稍後再試'), false,
		'a permanent refusal must not promise a later retry');
	assert.equal(rfHtml.includes('找不到這個頁面'), true, 'it says what is actually true');

	// NO SHELL — must not synthesize a platform HTML document
	const noShell = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }), shell: null });
	const ns = await claimed.default.fetch(get('/tiers'), noShell.env);
	const nsHtml = await ns.text();
	assert.notEqual(ns.status, 200);
	assert.equal((ns.headers.get('content-type') || '').includes('text/html'), false,
		'no site shell means no HTML page at all');
	assert.equal(nsHtml.includes('<html'), false);
	assert.equal(nsHtml.includes('<main'), false);
	assert.equal(ns.headers.get('cache-control'), 'private, no-store');

	// a shell with no <main> cannot be composed into — returning it unchanged would
	// be the site's ROOT page answering 200 under this URL
	const noMain = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }), shell: SHELL_NO_MAIN });
	const nm = await claimed.default.fetch(get('/tiers'), noMain.env);
	const nmHtml = await nm.text();
	assert.notEqual(nm.status, 200);
	assert.equal(nmHtml.includes('HOME-BODY'), false, 'the donor page must not be served as this page');

	// signed-in account, facts unavailable: no member section is guessed
	const acct = makeEnv({ rsp: factsRsp({ '/zapi/hub-facts': () => new Response('boom', { status: 503 }) }) });
	const ar = await claimed.default.fetch(get('/hub'), acct.env);
	const arHtml = await ar.text();
	assert.notEqual(ar.status, 200);
	assert.equal(keepsShell(arHtml), true);
	assert.equal(arHtml.includes('data-ejecta-account-state="unavailable"'), true);
	assert.equal(arHtml.includes('data-ejecta-account-section='), false, 'no section is invented on failure');
});

test('a 2xx answer this page cannot render is never served as a working 200', async () => {
	const unusable = [{}, [], { state: 'weird' }, { state: 'available', plans: [] }, { signed_in: 'yes' }];
	for (const path of ['/tiers', '/hub']) {
		for (const payload of unusable) {
			const label = path + ' ' + JSON.stringify(payload);
			const { env } = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': payload, '/zapi/hub-facts': payload }) });
			const res = await claimed.default.fetch(get(path), env);
			const html = await res.text();
			assert.notEqual(res.status, 200, label + ' must not be a fabricated 200');
			assert.equal(res.status, 502, label + ' is "no usable answer", the same code the verdict gate uses');
			assert.equal(keepsShell(html), true, label + ' stays inside the site shell');
			assert.equal(html.includes('-state="unavailable"'), true, label + ' says so honestly');
		}
	}
	// control: a usable payload on those same paths IS 200, so the rule above is
	// not just "this page never answers 200"
	const tiers = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }) });
	const hub = makeEnv({ rsp: factsRsp({ '/zapi/hub-facts': { signed_in: false, sections: [] } }) });
	assert.equal((await claimed.default.fetch(get('/tiers'), tiers.env)).status, 200);
	assert.equal((await claimed.default.fetch(get('/hub'), hub.env)).status, 200);
});

test('the composed document has exactly one main landmark', async () => {
	const cases = [
		['/tiers', { '/zapi/tier-facts': PLANS }],
		['/tiers', { '/zapi/tier-facts': { state: 'empty', plans: [] } }],
		['/tiers', {}], // the route refusal
		['/hub', { '/zapi/hub-facts': { signed_in: false, sections: [] } }],
		['/hub', { '/zapi/hub-facts': { signed_in: true, sections: ['orders', 'profile'] } }]
	];
	for (const [path, answers] of cases) {
		const { env } = makeEnv({ rsp: factsRsp(answers) });
		const html = await (await claimed.default.fetch(get(path), env)).text();
		const label = path + ' ' + JSON.stringify(answers);
		assert.equal((html.match(/<main\b/gi) || []).length, 1, label + ' opens exactly one main');
		assert.equal((html.match(/<\/main>/gi) || []).length, 1, label + ' closes exactly one main');
		assert.equal(html.includes('<main class="site-main"'), true, label + ' and it is the donor\'s');
	}
	// with no binding at all the unavailable body composes into the same one main
	const { env } = makeEnv({ rsp: null });
	const html = await (await claimed.default.fetch(get('/tiers'), env)).text();
	assert.equal((html.match(/<main\b/gi) || []).length, 1);
});

// ── 4. rolling compatibility: old contract forwards, new contract claims ─────

test('a contract WITHOUT siteOwnedBuyerPages keeps the generic forward for both pages', async () => {
	for (const path of ['/tiers', '/hub']) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: () => new Response('RSP-WHOLE-PAGE', { status: 200 }) });
		const res = await oldWorker.default.fetch(get(path), env);
		assert.equal(await res.text(), 'RSP-WHOLE-PAGE', path + ' still reaches the whole-page fallback');
		assert.equal(seenByRsp.length, 1, path);
		assert.equal(seenByRsp[0].path, path, path + ' is forwarded verbatim, not turned into a facts read');
		assert.deepEqual(seenByAssets, [], path + ' never asks the site for a shell');
	}
});

test('with siteOwnedBuyerPages present the early claim beats the forward rule', async () => {
	for (const [path, factsPath, facts] of [
		['/tiers', '/zapi/tier-facts', PLANS],
		['/hub', '/zapi/hub-facts', { signed_in: false, sections: [] }]
	]) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: factsRsp({ [factsPath]: facts }) });
		const res = await claimed.default.fetch(get(path), env);
		const html = await res.text();
		assert.equal(res.status, 200, path);
		assert.equal(html.includes(NAV), true, path + ' is composed here, not forwarded whole');
		assert.equal(seenByRsp.length, 1, path);
		assert.equal(seenByRsp[0].path, factsPath, path + ' asks for FACTS, never forwards the page path');
		assert.equal(seenByAssets.length, 1, path);
		assert.equal(seenByAssets[0].path, '/', path + ' takes its shell from the site root');
	}
});

test('only the contract-declared path AND method are claimed', async () => {
	// a verb the entry does not declare, and a near miss beside the path
	for (const [path, init] of [['/tiers', { method: 'POST' }], ['/tiers/', {}], ['/hub/gold', {}], ['/tiersx', {}]]) {
		const { env, seenByAssets } = makeEnv({ rsp: factsRsp({ '/zapi/tier-facts': PLANS }) });
		const res = await claimed.default.fetch(get(path, init), env);
		const html = await res.text();
		assert.equal(html.includes('data-ejecta-membership'), false, path + ' must not be claimed');
		assert.equal(seenByAssets.some((hit) => hit.path === '/'), false, path + ' must not ask for a shell');
	}
});

test('matchSiteOwnedBuyerPage answers null for an absent or empty route set', async () => {
	assert.equal(claimed.matchSiteOwnedBuyerPage(get('/tiers'), undefined), null);
	assert.equal(claimed.matchSiteOwnedBuyerPage(get('/tiers'), []), null);
	assert.equal(claimed.matchSiteOwnedBuyerPage(get('/tiers'), FIXTURE_CONTRACT.siteOwnedBuyerPages).kind, 'membership');
	assert.equal(claimed.matchSiteOwnedBuyerPage(get('/hub'), FIXTURE_CONTRACT.siteOwnedBuyerPages).kind, 'account');
});

// ── 5. the emitter refuses a contract it cannot serve ────────────────────────

test('a malformed siteOwnedBuyerPages entry is fatal, never silently unclaimed', async () => {
	const bad = (pages) => JSON.stringify({ ...FIXTURE_CONTRACT, siteOwnedBuyerPages: pages });
	const cases = [
		['not an array', JSON.stringify({ ...FIXTURE_CONTRACT, siteOwnedBuyerPages: { path: '/tiers' } })],
		['unknown kind', bad([{ path: '/tiers', method: 'GET', kind: 'wishlist', factsPath: '/zapi/x' }])],
		['missing kind', bad([{ path: '/tiers', method: 'GET', factsPath: '/zapi/x' }])],
		['non-GET method', bad([{ path: '/tiers', method: 'POST', kind: 'membership', factsPath: '/zapi/x' }])],
		['relative path', bad([{ path: 'tiers', method: 'GET', kind: 'membership', factsPath: '/zapi/x' }])],
		['relative factsPath', bad([{ path: '/tiers', method: 'GET', kind: 'membership', factsPath: 'zapi/x' }])],
		['missing factsPath', bad([{ path: '/tiers', method: 'GET', kind: 'membership' }])]
	];
	for (const [name, body] of cases) {
		const file = join(workDir, 'bad-' + name.replace(/\W+/g, '-') + '.json');
		writeFileSync(file, body);
		assert.throws(() => emitFile(['--api-contract', file]), undefined, name + ' must refuse');
	}
	// control: the well-formed fixture still emits, so the refusals above are not
	// an emitter that refuses everything
	assert.doesNotThrow(() => emitFile(['--api-contract', fixturePath]));
});

// ── the REAL contract, when this machine has it ──────────────────────────────

const realPath = process.env.SITE_API_TRANSPORT_CONTRACT || '';
test('the real contract: its own site-owned pages are claimed and composed', async () => {
	if (!realPath || !existsSync(realPath)) {
		console.log('  (skipped: set SITE_API_TRANSPORT_CONTRACT to reef apps/mixfairy/scripts/site-api-transport.contract.json)');
		return;
	}
	const real = JSON.parse(readFileSync(realPath, 'utf8'));
	assert.equal(Array.isArray(real.siteOwnedBuyerPages) && real.siteOwnedBuyerPages.length > 0, true,
		'the real contract must carry the site-owned buyer pages this worker claims');
	const worker = await emitWorker(['--site-id', 'site-1', '--api-contract', realPath]);
	const bindingName = real.bindingName;

	for (const entry of real.siteOwnedBuyerPages) {
		const facts = entry.kind === 'account'
			? { signed_in: true, sections: ['profile', 'contact'] }
			: PLANS;
		const { env, seenByRsp, seenByAssets } = makeEnv({
			rsp: factsRsp({ [entry.factsPath]: facts }), bindingName
		});
		const res = await worker.default.fetch(get(entry.path, { method: entry.method }), env);
		const html = await res.text();
		assert.equal(res.status, 200, entry.path);
		assert.equal(keepsShell(html), true, entry.path + ' is composed into the site shell');
		assert.equal(res.headers.get('cache-control'), 'private, no-store', entry.path);
		assert.equal(seenByRsp.length, 1, entry.path);
		assert.equal(seenByRsp[0].path, entry.factsPath, entry.path + ' reads the contract-declared facts path');
		assert.equal(seenByAssets.length, 1, entry.path);
		assert.equal(seenByAssets[0].path, '/', entry.path);
		if (entry.kind === 'account') {
			assert.equal(html.includes('data-ejecta-account-section="profile"'), true, entry.path);
		} else {
			assert.equal(html.includes('data-ejecta-slot="subscribe"'), true, entry.path);
		}
	}

	// the forward entries the real contract keeps for already-emitted workers are
	// still there — this claim did not remove the rolling-compatible fallback
	for (const entry of real.siteOwnedBuyerPages) {
		assert.equal(
			real.forward.some((rule) => rule.match === 'exact' && rule.value === entry.path),
			true, entry.path + ' must stay in forward for workers already emitted');
	}

	// and with no binding at all the real contract's own status answers
	const missing = makeEnv({ rsp: null, bindingName });
	const mres = await worker.default.fetch(get(real.siteOwnedBuyerPages[0].path), missing.env);
	assert.equal(mres.status, real.onBindingMissing.status);
	assert.equal(keepsShell(await mres.text()), true);
});
