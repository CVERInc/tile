// Behavioural test of the EMITTED _worker.js composing the contract's SUBSCRIBE
// RESULT landing into the site's own repository-built shell. Emit a real worker,
// load it, and drive `default.fetch` with a mock RSP binding and mock ASSETS —
// same shape as buyer-page-composition.test.mjs, nothing asserted about source
// text that could be asserted about behaviour.
//
// 🔴 THE FIXTURE CONTRACT DELIBERATELY DISAGREES WITH THE REAL ONE. Its landing is
// /join/done, not /subscribe/success; its locator parameter is `sid`, not
// `session_id`; its facts endpoint is /zapi/join-result, not /api/subscribe/result;
// its binding is SEAMLINK. A worker that recognised this page from a path literal
// would pass a test written against the real contract and fail every one of these.
// /join/done is ALSO in `forward`, exactly as the real contract keeps
// /subscribe/success there for already-emitted workers — that is what makes "the
// early claim wins" a real contest rather than a vacuous one.
//
// The real contract lives in another repo of ours (reef,
// apps/mixfairy/scripts/site-api-transport.contract.json). Point
// SITE_API_TRANSPORT_CONTRACT at it and the last block also runs against the real
// path — and says by name when that contract does not carry the capability yet,
// because the Reef side adds it separately. This test never requires it to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { formatMoney } from './product-page-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'subscribe-result-composition-'));

const BINDING = 'SEAMLINK';
const MISSING_STATUS = 599;
const MISSING_CC = 'private, max-age=0, no-store, fixture-marker';
const PAGE = '/join/done';
const PARAM = 'sid';
const FACTS = '/zapi/join-result';

const FIXTURE_CONTRACT = {
	schemaVersion: 2,
	bindingName: BINDING,
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: MISSING_STATUS, cacheControl: MISSING_CC },
	subscribeResult: { path: PAGE, method: 'GET', sessionParam: PARAM, factsPath: FACTS },
	forward: [
		{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: PAGE, methods: ['GET'] }
	]
};
const { subscribeResult: _claimed, ...OLD_FIXTURE_CONTRACT } = FIXTURE_CONTRACT;

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

// A site with NO shop at all: this landing must work on one, which is why the
// donor shell is the site root rather than a shop page.
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

const PLAN = { plan_id: 'plan_gold', display_name: '金級會員', amount: 1200, currency: 'TWD', interval: 'month' };
const ACTIVE = { state: 'active', plan: PLAN };
const CONFIRMING = { state: 'confirming', plan: PLAN };
const UNKNOWN = { state: 'unknown', plan: null };

const RSP_PAGE = 'RSP-WHOLE-PAGE-LEGACY-LANDING';

function makeEnv({ rsp = null, shell = SHELL, bindingName = BINDING } = {}) {
	const seenByRsp = [];
	const seenByAssets = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				const url = new URL(typeof req === 'string' ? req : req.url);
				seenByAssets.push({ method: req.method || 'GET', url, path: url.pathname, search: url.search });
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
				seenByRsp.push({ method: req.method, path: url.pathname, search: url.search, url, headers: req.headers });
				return rsp(url.pathname, req);
			}
		};
	}
	return { env, seenByRsp, seenByAssets };
}
// Anything that is not the declared facts path answers the LEGACY whole page, so a
// forward that should not have happened is visible in the body rather than assumed.
const factsRsp = (byPath) => (pathname) => {
	const entry = byPath[pathname];
	if (entry === undefined) return new Response(RSP_PAGE, { status: 200 });
	if (typeof entry === 'function') return entry();
	return new Response(JSON.stringify(entry), { status: 200, headers: { 'content-type': 'application/json' } });
};
const get = (path, init) => new Request('https://s.example' + path, init);
const keepsShell = (html) => html.includes('<html lang="zh-Hant"') && html.includes(NAV) && html.includes(FOOT);

// ── 1. rolling compatibility: old contract forwards, new contract claims ─────

test('a contract WITHOUT subscribeResult forwards the landing verbatim and never asks for a shell', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: () => new Response(RSP_PAGE, { status: 200 }) });
	const res = await oldWorker.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env);
	assert.equal(await res.text(), RSP_PAGE, 'the landing still reaches the whole-page fallback');
	assert.equal(seenByRsp.length, 1);
	assert.equal(seenByRsp[0].path, PAGE, 'forwarded verbatim, not turned into a facts read');
	assert.equal(seenByRsp[0].search, '?' + PARAM + '=cs_real', 'query included');
	assert.deepEqual(seenByAssets, [], 'the site is never asked for a shell');
});

test('with subscribeResult present the early claim beats the forward rule', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({
		rsp: factsRsp({ [FACTS]: ACTIVE })
	});
	const res = await claimed.default.fetch(
		get(PAGE + '?' + PARAM + '=cs_real', { headers: { cookie: 'ej_session=member-1; other=2' } }), env);
	const html = await res.text();

	assert.equal(res.status, 200);
	assert.equal(html.includes(RSP_PAGE), false, 'the legacy whole page is never what the buyer sees');
	assert.equal(seenByRsp.length, 1, 'exactly one call to the binding');
	assert.equal(seenByRsp[0].method, 'GET');
	assert.equal(seenByRsp[0].path, FACTS, 'the contract names the facts path, not this worker');
	assert.equal(seenByRsp[0].search, '?' + PARAM + '=cs_real', 'only the locator is sent, under the declared name');
	assert.equal(seenByRsp[0].url.searchParams.get('plan'), null, 'the plan is RSP\'s to name, never the query\'s');
	assert.equal(seenByRsp[0].headers.get('cookie'), 'ej_session=member-1; other=2',
		'the browser\'s own headers ride along, which is how RSP sees the member session');
	assert.equal(seenByAssets.length, 1);
	assert.equal(seenByAssets[0].path, '/', 'the shell comes from the site root');
});

test('the donor shell keeps lang, nav, main chrome and footer; only the body follows the facts', async () => {
	const { env } = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const html = await (await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env)).text();

	assert.equal(html.includes('<html lang="zh-Hant"'), true, 'the site declares the language, not the platform');
	assert.equal(html.includes(NAV), true);
	assert.equal(html.includes(FOOT), true);
	assert.equal(html.includes('<main class="site-main"'), true, 'the shell main element and its class survive');
	assert.equal(html.includes('HOME-BODY'), false, 'the donor body is replaced, not appended to');
	assert.equal(html.includes('DONOR-DESC'), false, 'the donor description is stripped');
	assert.equal(html.includes('/donor-og.jpg'), false, 'the donor og is stripped');
	assert.equal((html.match(/<main\b/gi) || []).length, 1, 'exactly one main landmark');
	assert.equal((html.match(/<\/main>/gi) || []).length, 1);
});

// ── 2. what the page says, and in whose language ─────────────────────────────

test('active: the confirmed copy, the plan name and its price, in the SHELL locale', async () => {
	const { env } = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const res = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env);
	const html = await res.text();

	assert.equal(res.status, 200);
	assert.equal(html.includes('data-ejecta-subscribe-state="active"'), true);
	assert.equal(html.includes('感謝您的訂閱'), true, 'zh-Hant shell gets zh-TW copy');
	assert.equal(html.includes('您的訂閱已生效。'), true);
	assert.equal(html.includes('正在確認您的付款'), false, 'an active subscription is not still confirming');
	assert.equal(html.includes('金級會員'), true, 'the plan RSP named is shown');
	assert.equal(html.includes(formatMoney({ minor: 1200, currency: 'TWD', locale: 'zh-TW' })), true,
		'the price is the minor amount converted exactly as formatMoney does');
	assert.equal(html.includes('每月'), true, 'the interval label follows the same copy table');
	assert.equal(html.includes('Thank you for subscribing'), false, 'no English platform default leaks in');
	assert.equal(html.includes('ご登録ありがとうございます'), false, 'no Japanese platform default leaks in');
});

test('confirming: the same heading, a conservative state line, no active claim', async () => {
	const { env } = makeEnv({ rsp: factsRsp({ [FACTS]: CONFIRMING }) });
	const res = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env);
	const html = await res.text();

	assert.equal(res.status, 200, 'the payment happened; this is not an error page');
	assert.equal(html.includes('data-ejecta-subscribe-state="confirming"'), true);
	assert.equal(html.includes('感謝您的訂閱'), true);
	assert.equal(html.includes('正在確認您的付款'), true);
	assert.equal(html.includes('您的訂閱已生效。'), false, 'an unsettled subscription is never called active');
	assert.equal(html.includes('金級會員'), true);
});

test('the copy follows the shell locale on every locale the table carries', async () => {
	const cases = [
		['en-US', 'Thank you for subscribing', 'Your subscription is active.'],
		['ja-JP', 'ご登録ありがとうございます', 'サブスクリプションは有効です。'],
		['zh-Hans', '感谢您的订阅', '您的订阅已生效。']
	];
	for (const [lang, heading, line] of cases) {
		const { env } = makeEnv({
			rsp: factsRsp({ [FACTS]: ACTIVE }),
			shell: SHELL.replace('lang="zh-Hant"', 'lang="' + lang + '"')
		});
		const html = await (await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env)).text();
		assert.equal(html.includes(heading), true, lang + ' heading');
		assert.equal(html.includes(line), true, lang + ' state line');
		assert.equal(html.includes('感謝您的訂閱'), false, lang + ' must not fall back to the zh-TW copy');
		assert.equal(html.includes('<html lang="' + lang + '"'), true, lang + ' declaration survives');
	}
});

test('the landing is private, never cached, never indexed, and loads no island', async () => {
	const { env } = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const res = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env);
	const html = await res.text();
	assert.equal(res.headers.get('cache-control'), 'private, no-store');
	assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(html.includes('name="robots" content="noindex"'), true,
		'one buyer\'s per-session payment result is not a page of the site');
	assert.equal(html.includes('src="/seam/island.js"'), false, 'this page has no island slot to fill');
});

// ── 3. no locator, and a locator RSP does not know ───────────────────────────

test('a missing or empty locator is answered here, without asking RSP anything', async () => {
	for (const query of ['', '?' + PARAM + '=', '?' + PARAM + '=%20%20', '?other=cs_real']) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
		const res = await claimed.default.fetch(get(PAGE + query), env);
		const html = await res.text();
		const label = JSON.stringify(query);

		assert.deepEqual(seenByRsp, [], label + ': there is nothing to ask about, so nothing is asked');
		assert.equal(res.status, 404, label + ': nothing was found under this URL');
		assert.equal(keepsShell(html), true, label + ': still the site\'s own page');
		assert.equal(html.includes(RSP_PAGE), false, label + ': never forwarded to the legacy page');
		assert.equal(html.includes('data-ejecta-subscribe-state="unknown"'), true, label);
		assert.equal(html.includes('找不到這筆訂閱'), true, label + ': it says what is actually true');
		assert.equal(html.includes('感謝您的訂閱'), false, label + ': nothing is thanked for');
		assert.equal(html.includes('href="/"'), true, label + ': and the buyer is given the way back');
		assert.equal(seenByAssets.length, 1, label);
		assert.equal(seenByAssets[0].path, '/', label);
	}
});

test('facts that say unknown are a 404 in the site shell, not a fabricated success', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: factsRsp({ [FACTS]: UNKNOWN }) });
	const res = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_stale'), env);
	const html = await res.text();
	assert.equal(seenByRsp.length, 1, 'a locator IS asked about');
	assert.equal(res.status, 404);
	assert.equal(keepsShell(html), true);
	assert.equal(html.includes('data-ejecta-subscribe-state="unknown"'), true);
	assert.equal(html.includes('找不到這筆訂閱'), true);
	assert.equal(html.includes('金級會員'), false, 'no plan is invented for an unknown result');
});

// ── 4. honest failure, with the passing control in the same test ─────────────

test('failure arms: the control passes, each failure is honest, none is a fabricated 200', async () => {
	// POSITIVE CONTROL — if this stops passing, every "must not" below is vacuous.
	const control = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const controlRes = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), control.env);
	const controlHtml = await controlRes.text();
	assert.equal(controlRes.status, 200, 'control: a working page is 200');
	assert.equal(controlHtml.includes('data-ejecta-subscribe-state="active"'), true);
	assert.equal(controlHtml.includes('data-ejecta-subscribe-unavailable'), false,
		'control: the unavailable marker is ABSENT when nothing failed');

	// binding never wired — the contract's own onBindingMissing answer
	const noBinding = makeEnv({ rsp: null });
	const nb = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), noBinding.env);
	const nbHtml = await nb.text();
	assert.equal(nb.status, MISSING_STATUS, 'the status comes from the contract, not a literal in the worker');
	assert.notEqual(nb.status, 200);
	assert.equal(keepsShell(nbHtml), true, 'an available shell still owns the page');
	assert.equal(nbHtml.includes('data-ejecta-subscribe-state="unavailable"'), true);
	assert.equal(nbHtml.includes('感謝您的訂閱'), false, 'nothing is confirmed that was never read');

	const failures = [
		['throws', () => { throw new Error('binding down'); }, 502],
		['non-2xx', () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }), 503],
		['unparseable', () => new Response('<html>not json</html>', { status: 200 }), 502],
		['null body', () => new Response('null', { status: 200 }), 502],
		['state the page cannot read', { state: 'weird', plan: null }, 502],
		['no state at all', {}, 502]
	];
	for (const [name, answer, expected] of failures) {
		const { env } = makeEnv({ rsp: factsRsp({ [FACTS]: answer }) });
		const res = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env);
		const html = await res.text();
		assert.equal(res.status, expected, name);
		assert.notEqual(res.status, 200, name + ' must not answer 200');
		assert.equal(keepsShell(html), true, name + ' stays inside the site shell');
		assert.equal(html.includes(RSP_PAGE), false, name + ' is never the legacy RSP page');
		assert.equal(html.includes('data-ejecta-subscribe-state="unavailable"'), true, name);
		assert.equal(html.includes('感謝您的訂閱'), false, name + ' must not claim a subscription');
		assert.equal(html.includes('金級會員'), false, name + ' must not invent a plan');
		assert.equal(res.headers.get('cache-control'), 'private, no-store', name);
	}

	// NO SHELL — must not synthesize a platform HTML document
	const noShell = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }), shell: null });
	const ns = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), noShell.env);
	const nsHtml = await ns.text();
	assert.equal(ns.status, 503);
	assert.equal((ns.headers.get('content-type') || '').includes('text/html'), false,
		'no site shell means no HTML page at all');
	assert.equal(nsHtml.includes('<html'), false);
	assert.equal(nsHtml.includes('<main'), false);
	assert.equal(ns.headers.get('cache-control'), 'private, no-store');

	// a shell with no <main> cannot be composed into — returning it unchanged would
	// be the site's ROOT page answering under this URL
	const noMain = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }), shell: SHELL_NO_MAIN });
	const nm = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), noMain.env);
	const nmHtml = await nm.text();
	assert.equal(nm.status, 503);
	assert.equal((nm.headers.get('content-type') || '').includes('text/html'), false);
	assert.equal(nmHtml.includes('HOME-BODY'), false, 'the donor page must not be served as this page');
});

test('the binding-missing answer carries the contract\'s own cache-control', async () => {
	const { env } = makeEnv({ rsp: null });
	const res = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=cs_real'), env);
	assert.equal(res.status, MISSING_STATUS);
	assert.equal(res.headers.get('cache-control'), 'private, no-store',
		'a composed page is always private/no-store; onBindingMissing.cacheControl belongs to the forward path');
	assert.notEqual(MISSING_CC, 'private, no-store', 'the two really are different values');
});

// ── 5. only what the contract declared is claimed ────────────────────────────

test('only the contract-declared path AND method are claimed', async () => {
	for (const [path, init] of [
		[PAGE, { method: 'POST' }],
		[PAGE + '/', {}],
		[PAGE + 'x', {}],
		['/join', {}]
	]) {
		const { env, seenByAssets } = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
		const res = await claimed.default.fetch(get(path + '?' + PARAM + '=cs_real', init), env);
		const html = await res.text();
		const label = (init.method || 'GET') + ' ' + path;
		assert.equal(html.includes('data-ejecta-subscribe-result'), false, label + ' must not be claimed');
		assert.equal(seenByAssets.some((hit) => hit.path === '/'), false, label + ' must not ask for a shell');
	}
});

test('matchSubscribeResult answers null for an absent route and honours the declared method', async () => {
	const route = FIXTURE_CONTRACT.subscribeResult;
	assert.equal(claimed.matchSubscribeResult(get(PAGE), undefined), null);
	assert.equal(claimed.matchSubscribeResult(get(PAGE), null), null);
	assert.equal(claimed.matchSubscribeResult(get(PAGE, { method: 'POST' }), route), null);
	assert.equal(claimed.matchSubscribeResult(get(PAGE + '?' + PARAM + '=x'), route), route);
});

test('the claimed landing is dropped from the markdown mapping, and only it', async () => {
	const mapping = join(workDir, 'markdown.json');
	writeFileSync(mapping, JSON.stringify({
		schemaVersion: 1,
		routes: [{ path: '/', asset: '/index.md' }, { path: '/about/', asset: '/about/index.md' },
			{ path: PAGE, asset: '/join/done/index.md' }]
	}));
	const bakedRoutes = (file) => {
		const m = readFileSync(file, 'utf8').match(/"markdown":\{"routes":(\{[^}]*\})\}/);
		return m ? JSON.parse(m[1]) : null;
	};
	assert.deepEqual(bakedRoutes(emitFile(['--site-id', 'site-1', '--api-contract', fixturePath, '--markdown-manifest', mapping])),
		{ '/': '/index.md', '/about': '/about/index.md' },
		'this worker answers the landing itself, so ASSETS has no twin to negotiate');
	// CONTROL: the drop is a function of the baked capability, not of the spelling
	assert.deepEqual(bakedRoutes(emitFile(['--site-id', 'site-1', '--api-contract', oldFixturePath, '--markdown-manifest', mapping])),
		{ '/': '/index.md', '/about': '/about/index.md', [PAGE]: '/join/done/index.md' });
});

// ── 6. the emitter refuses a contract it cannot serve ────────────────────────

test('a malformed subscribeResult is fatal, never silently unclaimed', async () => {
	const bad = (entry) => JSON.stringify({ ...FIXTURE_CONTRACT, subscribeResult: entry });
	const cases = [
		['not an object', bad('/join/done'), 'subscribeResult'],
		['non-GET method', bad({ ...FIXTURE_CONTRACT.subscribeResult, method: 'POST' }), 'method'],
		['missing method', bad({ path: PAGE, sessionParam: PARAM, factsPath: FACTS }), 'method'],
		['sessionParam with a space', bad({ ...FIXTURE_CONTRACT.subscribeResult, sessionParam: 'session id' }), 'sessionParam'],
		['sessionParam empty', bad({ ...FIXTURE_CONTRACT.subscribeResult, sessionParam: '' }), 'sessionParam'],
		['missing factsPath', bad({ path: PAGE, method: 'GET', sessionParam: PARAM }), 'factsPath'],
		['relative factsPath', bad({ ...FIXTURE_CONTRACT.subscribeResult, factsPath: 'zapi/join-result' }), 'factsPath'],
		['relative path', bad({ ...FIXTURE_CONTRACT.subscribeResult, path: 'join/done' }), 'subscribeResult.path']
	];
	for (const [name, body, field] of cases) {
		const file = join(workDir, 'bad-' + name.replace(/\W+/g, '-') + '.json');
		writeFileSync(file, body);
		let stderr = null;
		try {
			emitFile(['--api-contract', file]);
		} catch (e) {
			stderr = String(e.stderr || '');
		}
		assert.notEqual(stderr, null, name + ' must refuse');
		assert.equal(stderr.includes(field), true, name + ' must name ' + field + ', got: ' + stderr);
	}
	// control: the well-formed fixture still emits, so the refusals above are not an
	// emitter that refuses everything
	assert.doesNotThrow(() => emitFile(['--api-contract', fixturePath]));
});

// ── the REAL contract, when this machine has it ──────────────────────────────

const realPath = process.env.SITE_API_TRANSPORT_CONTRACT || '';
test('the real contract: its own subscribe landing is claimed and composed', async () => {
	if (!realPath || !existsSync(realPath)) {
		console.log('  (skipped: set SITE_API_TRANSPORT_CONTRACT to reef apps/mixfairy/scripts/site-api-transport.contract.json)');
		return;
	}
	const real = JSON.parse(readFileSync(realPath, 'utf8'));
	// The capability is OPTIONAL and arrives with the Reef leg that adds it. A real
	// contract without it is a valid contract, so this says so by name instead of failing.
	if (!real.subscribeResult) {
		console.log('  (skipped: the real contract does not carry subscribeResult yet — it is added on the Reef side)');
		return;
	}
	const entry = real.subscribeResult;
	const worker = await emitWorker(['--site-id', 'site-1', '--api-contract', realPath]);
	const bindingName = real.bindingName;

	const { env, seenByRsp, seenByAssets } = makeEnv({
		rsp: factsRsp({ [entry.factsPath]: ACTIVE }), bindingName
	});
	const res = await worker.default.fetch(get(entry.path + '?' + entry.sessionParam + '=cs_real', { method: entry.method }), env);
	const html = await res.text();
	assert.equal(res.status, 200, entry.path);
	assert.equal(keepsShell(html), true, entry.path + ' is composed into the site shell');
	assert.equal(html.includes(RSP_PAGE), false, entry.path + ' is never the legacy whole page');
	assert.equal(res.headers.get('cache-control'), 'private, no-store', entry.path);
	assert.equal(seenByRsp.length, 1, entry.path);
	assert.equal(seenByRsp[0].path, entry.factsPath, entry.path + ' reads the contract-declared facts path');
	assert.equal(seenByAssets.length, 1, entry.path);
	assert.equal(seenByAssets[0].path, '/', entry.path);

	// the forward entry the real contract keeps for already-emitted workers is still
	// there — this claim did not remove the rolling-compatible fallback
	assert.equal(
		real.forward.some((rule) => rule.match === 'exact' && rule.value === entry.path),
		true, entry.path + ' must stay in forward for workers already emitted');
});
