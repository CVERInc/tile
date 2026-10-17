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

// `homes` is the site's locale homes beyond the root — `{ '/zh-tw/': <shell> }` —
// the build-owned fact "this locale has a home" that localeHomePath() reads at
// build time and this worker can only read by asking ASSETS. A path not in it
// 404s, exactly as a locale without a home does on the real ASSETS. A FUNCTION
// value is ASSETS itself misbehaving for that home: it is called and whatever it
// returns (or throws) is the answer.
//
// `authored` is the site's own pages at the PREFIXED result path (`/zh-tw/join/done`):
// the prefixed path is not reserved the way the bare one is, so a site can have one.
// A prefixed result path not listed there 404s, as it does on a site that authored
// nothing there; every other non-home path answers `STATIC:<path>`.
const PREFIXED_PAGE = new RegExp('^/[a-z]{2}(?:-[a-z]{2})?' + PAGE.replace(/\//g, '\\/') + '$');
function makeEnv({ rsp = null, shell = SHELL, bindingName = BINDING, homes = {}, authored = [] } = {}) {
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
				if (/^\/[a-z]{2}(?:-[a-z]{2})?\/$/.test(url.pathname)) {
					const home = homes[url.pathname];
					if (home == null) return new Response('missing', { status: 404 });
					if (typeof home === 'function') return home();
					return new Response(home, { status: 200, headers: { 'content-type': 'text/html' } });
				}
				if (PREFIXED_PAGE.test(url.pathname) && !authored.includes(url.pathname)) return new Response('missing', { status: 404 });
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
		// Buyer runtime states are named truthfully: the page presents the state the
		// runtime actually knows, and unknown wording is for what it cannot resolve. RSP's `unknown`
		// does not know the subscription is absent, so the old nonexistence heading pinned a defect.
		assert.equal(html.includes('在這裡無法確認這筆訂閱'), true, label + ': it says what is actually true');
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
	// Same ledgered change as above: cannot-confirm wording, not a nonexistence claim.
	assert.equal(html.includes('在這裡無法確認這筆訂閱'), true);
	assert.equal(html.includes('金級會員'), false, 'no plan is invented for an unknown result');
});

test('the unknown page says it cannot confirm here and names the next steps, on every locale and both unknown arms', async () => {
	const cases = [
		['en-US', "We can't confirm this subscription here", /sign in to your account/, /subscription confirmation email/, /Back to home/],
		['ja-JP', 'このサブスクリプションを確認できません', /アカウントにログイン/, /確認メール/, /ホームに戻る/],
		['zh-Hant', '在這裡無法確認這筆訂閱', /登入帳戶/, /訂閱確認信/, /返回首頁/],
		['zh-Hans', '在这里无法确认这笔订阅', /登录账户/, /订阅确认信/, /返回首页/]
	];
	const nonexistence = [/couldn.t find/i, /not found/i, '找不到這筆訂閱', '找不到这笔订阅', '見つかりません'];
	const arms = [
		['no locator', { rsp: factsRsp({ [FACTS]: ACTIVE }) }, PAGE],
		['RSP says unknown', { rsp: factsRsp({ [FACTS]: UNKNOWN }) }, PAGE + '?' + PARAM + '=cs_stale']
	];
	for (const [lang, heading, signIn, email, back] of cases) {
		for (const [arm, rspOptions, path] of arms) {
			const label = lang + ' / ' + arm;
			const { env } = makeEnv({ ...rspOptions, shell: SHELL.replace('lang="zh-Hant"', 'lang="' + lang + '"') });
			const res = await claimed.default.fetch(get(path), env);
			const html = await res.text();
			const section = html.slice(html.indexOf('data-ejecta-subscribe-result'));
			assert.equal(res.status, 404, label);
			assert.equal(html.includes('data-ejecta-subscribe-state="unknown"'), true, label);
			assert.equal(section.includes('<h1>' + heading + '</h1>'), true, label + ': heading');
			assert.match(section, signIn, label + ': sign in');
			assert.match(section, email, label + ': confirmation email');
			assert.match(section, back, label + ': back link text');
			assert.equal(section.includes('href="/"'), true, label + ': back link');
			for (const gone of nonexistence) {
				assert.equal(typeof gone === 'string' ? html.includes(gone) : gone.test(html), false, label + ': no nonexistence wording ' + gone);
			}
		}
	}
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

// ── 5b. the locale the buyer came from (CVERInc/reef#1910, last item) ────────
// The URL that sends a buyer here carries the shop's locale prefix — the caller
// contract — so /zh-tw/<path> is the zh-tw shop's result page. Its shell is that
// locale's home, its copy is that locale, and its way back is THAT home, the same
// answer localeHomePath() gives the 404 page, the breadcrumb and the footer
// wordmark (tile#137). A locale with no home on this site goes to `/`, as there.
//
// The fixture SITE: the default locale is served bare at `/` (en-US), and zh-TW
// lives at /zh-tw/. The two shells differ in lang AND chrome so the assertions can
// tell which one was composed into, not just which language the copy came out in.
const ROOT_EN = SHELL.replace('lang="zh-Hant"', 'lang="en-US"').replace(NAV, 'NAV-ROOT').replace(FOOT, 'FOOT-ROOT');
const HOME_ZHTW = SHELL.replace(NAV, 'NAV-ZHTW').replace(FOOT, 'FOOT-ZHTW');
const TWO_LOCALES = { shell: ROOT_EN, homes: { '/zh-tw/': HOME_ZHTW } };
const backLinkOf = (html) => {
	const section = html.slice(html.indexOf('data-ejecta-subscribe-result'));
	return (section.match(/<a class="st-runtime-action" href="([^"]*)"/) || [])[1];
};

test('two locales: the zh-tw result page composes into /zh-tw/ and sends the buyer back to /zh-tw/', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: UNKNOWN }) });
	const res = await claimed.default.fetch(get('/zh-tw' + PAGE + '?' + PARAM + '=cs_stale'), env);
	const html = await res.text();
	assert.equal(res.status, 404, 'RSP does not know this locator: the same unknown answer as the bare path');
	assert.equal(seenByRsp.length, 1, 'the locator is asked about');
	assert.deepEqual(seenByAssets.map((hit) => hit.path), ['/zh-tw' + PAGE, '/zh-tw/'],
		'the page itself is asked whether the site authored it; then the shell is the locale\'s own home, asked for once');
	assert.equal(html.includes('<html lang="zh-Hant"'), true, 'the zh-tw home declares the language');
	assert.equal(html.includes('NAV-ZHTW') && html.includes('FOOT-ZHTW'), true, 'the zh-tw chrome, not the root\'s');
	assert.equal(html.includes('NAV-ROOT'), false);
	assert.equal(html.includes('在這裡無法確認這筆訂閱'), true, 'zh-TW copy');
	assert.equal(backLinkOf(html), '/zh-tw/', 'the way back is the locale home');
});

test('two locales: an active zh-tw result still reads the locator and shows the plan, in the zh-tw shell', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const res = await claimed.default.fetch(get('/zh-tw' + PAGE + '?' + PARAM + '=cs_real'), env);
	const html = await res.text();
	assert.equal(res.status, 200);
	assert.equal(seenByRsp.length, 1);
	assert.equal(seenByRsp[0].path, FACTS);
	assert.equal(seenByRsp[0].search, '?' + PARAM + '=cs_real', 'the locale prefix never reaches the facts read');
	assert.deepEqual(seenByAssets.map((hit) => hit.path), ['/zh-tw/']);
	assert.equal(html.includes('NAV-ZHTW'), true);
	assert.equal(html.includes('感謝您的訂閱'), true);
	assert.equal(html.includes('金級會員'), true);
	assert.equal(html.includes(formatMoney({ minor: 1200, currency: 'TWD', locale: 'zh-TW' })), true);
});

test('two locales: the default locale\'s result page is the bare path, composed into `/`, and goes back to `/`', async () => {
	const { env, seenByAssets } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const html = await (await claimed.default.fetch(get(PAGE), env)).text();
	assert.deepEqual(seenByAssets.map((hit) => hit.path), ['/']);
	assert.equal(html.includes('<html lang="en-US"'), true);
	assert.equal(html.includes('NAV-ROOT'), true);
	assert.equal(html.includes("We can't confirm this subscription here"), true, 'en-US copy, from the root shell');
	assert.equal(backLinkOf(html), '/');
});

test('single locale: the bare path is unchanged, and a locale prefix this site has no home for falls back to `/`', async () => {
	// CONTROL — the site every already-emitted worker serves: one home, at `/`.
	const bare = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const bareHtml = await (await claimed.default.fetch(get(PAGE), bare.env)).text();
	assert.deepEqual(bare.seenByAssets.map((hit) => hit.path), ['/'], 'exactly the one shell read it always made');
	assert.equal(keepsShell(bareHtml), true);
	assert.equal(backLinkOf(bareHtml), '/');

	// A prefixed URL on a site with no such home: the same measurement localeHomePath
	// makes ("does this locale have a home?") says no, so the way back is `/` and the
	// shell is the root's — the buyer is not sent to a 404.
	const prefixed = makeEnv({ rsp: factsRsp({ [FACTS]: UNKNOWN }) });
	const res = await claimed.default.fetch(get('/zh-tw' + PAGE + '?' + PARAM + '=cs_stale'), prefixed.env);
	const html = await res.text();
	assert.equal(res.status, 404, 'still the unknown answer, not a shell failure');
	assert.deepEqual(prefixed.seenByAssets.map((hit) => hit.path), ['/zh-tw' + PAGE, '/zh-tw/', '/'],
		'whether the site authored the page is asked first, then the locale home; only the home\'s absence falls back to the root');
	assert.equal(keepsShell(html), true, 'the root shell owns the page');
	assert.equal(html.includes('在這裡無法確認這筆訂閱'), true, 'the copy follows the shell that was actually served');
	assert.equal(backLinkOf(html), '/', 'no home for that locale, so the way back is the root');
	assert.equal((html.match(/href="\/zh-tw\/"/g) || []).length, 0, 'never a link to a home that does not exist');
});

// "No home for this locale" is ONE answer ASSETS can give — a 404 — and only that
// one means the site has no such home. A 5xx or a fetch that rejects is ASSETS
// failing to serve a home the site may well have; reading it as "no home" would
// hand the buyer the root's language and the root's way back as if that were the
// site's decision. Those take the same unavailable path the bare route takes
// when its own shell cannot be read.
test('locale home: a 404 falls back to `/`; a 5xx or a rejected fetch is a shell failure, not a missing home', async () => {
	const locatorQuery = '?' + PARAM + '=cs_real';

	// 404 — the fallback (the control for the two arms below)
	const absent = makeEnv({ shell: ROOT_EN, rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const absentRes = await claimed.default.fetch(get('/zh-tw' + PAGE + locatorQuery), absent.env);
	const absentHtml = await absentRes.text();
	assert.equal(absentRes.status, 200, '404: the result page still composes');
	assert.deepEqual(absent.seenByAssets.map((hit) => hit.path), ['/zh-tw/', '/'], '404: the root is asked for after the locale home');
	assert.equal(absentHtml.includes('NAV-ROOT'), true, '404: the root shell');
	assert.equal(absentHtml.includes('Thank you for subscribing'), true, '404: the root\'s language');

	const failures = [
		['500', () => new Response('boom', { status: 500 })],
		['503', () => new Response('try later', { status: 503 })],
		['rejects', () => { throw new Error('assets down'); }]
	];
	for (const [name, answer] of failures) {
		const { env, seenByAssets } = makeEnv({ shell: ROOT_EN, rsp: factsRsp({ [FACTS]: ACTIVE }), homes: { '/zh-tw/': answer } });
		const res = await claimed.default.fetch(get('/zh-tw' + PAGE + locatorQuery), env);
		const body = await res.text();
		assert.equal(res.status, 503, name + ': unavailable, the same answer as the bare route\'s shell failure');
		assert.equal((res.headers.get('content-type') || '').includes('text/html'), false, name + ': no HTML page at all');
		assert.equal(body.includes('<html'), false, name);
		assert.equal(body.includes('NAV-ROOT'), false, name + ': the root shell is never served in the locale\'s place');
		assert.equal(body.includes('Thank you for subscribing'), false, name + ': nothing is confirmed in the wrong language');
		assert.equal(res.headers.get('cache-control'), 'private, no-store', name);
		assert.deepEqual(seenByAssets.map((hit) => hit.path), ['/zh-tw/'], name + ': the root is NOT asked for — a failure is not an absence');
	}

	// CONTROL: the bare route's own shell failing is the same 503 (what "the same path" means)
	const bareDown = makeEnv({ shell: null, rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const bareRes = await claimed.default.fetch(get(PAGE + locatorQuery), bareDown.env);
	assert.equal(bareRes.status, 503);
	assert.equal((bareRes.headers.get('content-type') || '').includes('text/html'), false);
});

// Whose language is the page in? When the locale home WAS served, the path is the
// authority: the buyer came from /ja-jp/, the copy is Japanese, and the document
// says so — a donor shell that declares some other lang does not get to put
// Japanese copy inside <html lang="en-US">, nor Simplified copy under a /zh-tw/
// path because the donor said zh-Hans. A donor that agrees keeps its own spelling
// (zh-Hant stays zh-Hant). When the locale home was NOT there and the page fell
// back to `/`, the root shell is what the buyer is looking at, so its declared
// lang stands and the copy follows it.
test('<html lang> and the copy: the path locale outranks a disagreeing donor when its home was served', async () => {
	const locatorQuery = '?' + PARAM + '=cs_real';
	const homeDeclaring = (lang, nav) => (lang === null
		? SHELL.replace(' lang="zh-Hant"', '')
		: SHELL.replace('lang="zh-Hant"', 'lang="' + lang + '"')).replace(NAV, nav);

	const cases = [
		// [path locale, donor lang, expected <html lang>, expected heading, headings that must NOT appear]
		['ja-jp', 'en-US', 'ja-JP', 'ご登録ありがとうございます', ['Thank you for subscribing']],
		['zh-tw', 'zh-Hans', 'zh-TW', '感謝您的訂閱', ['感谢您的订阅']],
		['zh-tw', 'zh-Hant', 'zh-Hant', '感謝您的訂閱', ['感谢您的订阅']],
		['ja', null, 'ja', 'ご登録ありがとうございます', ['Thank you for subscribing']],
		['en', 'zh-Hant', 'en', 'Thank you for subscribing', ['感謝您的訂閱']]
	];
	for (const [pathLocale, donorLang, expectedLang, heading, absent] of cases) {
		const label = '/' + pathLocale + '/ declaring ' + JSON.stringify(donorLang);
		const { env, seenByAssets } = makeEnv({
			shell: ROOT_EN, rsp: factsRsp({ [FACTS]: ACTIVE }),
			homes: { ['/' + pathLocale + '/']: homeDeclaring(donorLang, 'NAV-LOCALE') }
		});
		const res = await claimed.default.fetch(get('/' + pathLocale + PAGE + locatorQuery), env);
		const html = await res.text();
		assert.equal(res.status, 200, label);
		assert.deepEqual(seenByAssets.map((hit) => hit.path), ['/' + pathLocale + '/'], label + ': the locale home was served');
		assert.equal(html.includes('NAV-LOCALE'), true, label + ': composed into that home');
		assert.equal((html.match(/<html\b[^>]*>/i) || [''])[0], '<html lang="' + expectedLang + '">', label + ': the document declares the language of its copy');
		assert.equal((html.match(/<html\b/gi) || []).length, 1, label + ': one html element');
		assert.equal(html.includes('<h1>' + heading + '</h1>'), true, label + ': copy in the path\'s locale');
		for (const gone of absent) assert.equal(html.includes(gone), false, label + ': no ' + gone);
	}

	// fallback: no /ja-jp/ home, root declares zh-Hant → the root's lang stands and the copy follows it
	const fallback = makeEnv({ rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const res = await claimed.default.fetch(get('/ja-jp' + PAGE + locatorQuery), fallback.env);
	const html = await res.text();
	assert.equal(res.status, 200);
	assert.deepEqual(fallback.seenByAssets.map((hit) => hit.path), ['/ja-jp/', '/']);
	assert.equal((html.match(/<html\b[^>]*>/i) || [''])[0], '<html lang="zh-Hant">', 'fallback: the root shell\'s own declaration');
	assert.equal(html.includes('<h1>感謝您的訂閱</h1>'), true, 'fallback: the copy follows the root shell');
	assert.equal(html.includes('ご登録ありがとうございます'), false, 'fallback: the path locale does not outrank the shell the buyer is actually looking at');

	// fallback, unknown arm: the way back and the copy agree on the root too
	const fallbackUnknown = makeEnv({ rsp: factsRsp({ [FACTS]: UNKNOWN }) });
	const unknownHtml = await (await claimed.default.fetch(get('/ja-jp' + PAGE + '?' + PARAM + '=cs_stale'), fallbackUnknown.env)).text();
	assert.equal(unknownHtml.includes('<h1>在這裡無法確認這筆訂閱</h1>'), true);
	assert.equal(backLinkOf(unknownHtml), '/');
});

// The matcher accepts any `xx` / `xx-yy` prefix, but the copy table carries English,
// Chinese (both scripts) and Japanese only. A path locale with no copy does not get
// to choose the copy (it would choose English by default) nor the language tag.
// Its home, if served, may still declare a language the table has (`/jp/` declaring
// `ja`) — then that is the page's language. Otherwise the page is the root's: the
// root shell, its lang, its copy, its way back. And whichever shell is composed
// into, English copy never sits under a non-English <html lang>: a shell declaring a
// language the table lacks is re-declared `en`, the language of the copy it carries.
test('a path locale outside the copy table: the document\'s lang always describes the copy emitted', async () => {
	const locatorQuery = '?' + PARAM + '=cs_real';
	const declaring = (lang, nav) => SHELL.replace('lang="zh-Hant"', 'lang="' + lang + '"').replace(NAV, nav);
	const ROOT_FR = declaring('fr', 'NAV-ROOT');
	const cases = [
		// [label, path locale, root shell, homes, expected ASSETS reads, chrome, expected <html lang>, heading]
		['/fr/ declaring fr, root en-US', 'fr', ROOT_EN, { '/fr/': declaring('fr', 'NAV-FR') }, ['/fr/', '/'], 'NAV-ROOT', 'en-US', 'Thank you for subscribing'],
		['/fr-ca/ declaring fr-CA, root en-US', 'fr-ca', ROOT_EN, { '/fr-ca/': declaring('fr-CA', 'NAV-FR') }, ['/fr-ca/', '/'], 'NAV-ROOT', 'en-US', 'Thank you for subscribing'],
		['/fr/ declaring fr, root ja-JP', 'fr', declaring('ja-JP', 'NAV-ROOT'), { '/fr/': declaring('fr', 'NAV-FR') }, ['/fr/', '/'], 'NAV-ROOT', 'ja-JP', 'ご登録ありがとうございます'],
		['/fr/ declaring fr, root fr', 'fr', ROOT_FR, { '/fr/': declaring('fr', 'NAV-FR') }, ['/fr/', '/'], 'NAV-ROOT', 'en', 'Thank you for subscribing'],
		['/jp/ declaring ja', 'jp', ROOT_EN, { '/jp/': declaring('ja', 'NAV-JP') }, ['/jp/'], 'NAV-JP', 'ja', 'ご登録ありがとうございます'],
		['/ja-jp/ declaring ja-JP', 'ja-jp', ROOT_EN, { '/ja-jp/': declaring('ja-JP', 'NAV-JP') }, ['/ja-jp/'], 'NAV-JP', 'ja-JP', 'ご登録ありがとうございます'],
		['/ja-jp/ declaring fr', 'ja-jp', ROOT_EN, { '/ja-jp/': declaring('fr', 'NAV-JP') }, ['/ja-jp/'], 'NAV-JP', 'ja-JP', 'ご登録ありがとうございます'],
		['/en-gb/ declaring en-GB', 'en-gb', declaring('ja-JP', 'NAV-ROOT'), { '/en-gb/': declaring('en-GB', 'NAV-GB') }, ['/en-gb/'], 'NAV-GB', 'en-GB', 'Thank you for subscribing']
	];
	for (const [label, pathLocale, shell, homes, reads, chrome, expectedLang, heading] of cases) {
		const { env, seenByAssets } = makeEnv({ shell, homes, rsp: factsRsp({ [FACTS]: ACTIVE }) });
		const res = await claimed.default.fetch(get('/' + pathLocale + PAGE + locatorQuery), env);
		const html = await res.text();
		assert.equal(res.status, 200, label);
		assert.deepEqual(seenByAssets.map((hit) => hit.path), reads, label + ': shells read');
		assert.equal(html.includes(chrome), true, label + ': composed into ' + chrome);
		assert.equal((html.match(/<html\b[^>]*>/i) || [''])[0], '<html lang="' + expectedLang + '">', label + ': the document declares the language of its copy');
		assert.equal(html.includes('<h1>' + heading + '</h1>'), true, label + ': copy');
	}

	// unknown arm, nothing authored: the way back is the home whose shell was composed into
	const unknown = makeEnv({ shell: ROOT_EN, homes: { '/fr/': declaring('fr', 'NAV-FR') }, rsp: factsRsp({ [FACTS]: UNKNOWN }) });
	const unknownHtml = await (await claimed.default.fetch(get('/fr' + PAGE + '?' + PARAM + '=cs_stale'), unknown.env)).text();
	assert.equal((unknownHtml.match(/<html\b[^>]*>/i) || [''])[0], '<html lang="en-US">');
	assert.equal(unknownHtml.includes("We can't confirm this subscription here"), true);
	assert.equal(backLinkOf(unknownHtml), '/', 'never a link to /fr/ beside English copy from the root');

	// the bare path on a root declaring a language the table lacks: English copy, declared `en`
	const bareFr = makeEnv({ shell: ROOT_FR, rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const bareHtml = await (await claimed.default.fetch(get(PAGE + locatorQuery), bareFr.env)).text();
	assert.deepEqual(bareFr.seenByAssets.map((hit) => hit.path), ['/']);
	assert.equal((bareHtml.match(/<html\b[^>]*>/i) || [''])[0], '<html lang="en">', 'bare, root fr: re-declared en');
	assert.equal(bareHtml.includes('<h1>Thank you for subscribing</h1>'), true);
});

test('the locale prefix is claimed only in the shape the caller contract emits', async () => {
	for (const [path, init] of [
		['/zh-tw' + PAGE, { method: 'POST' }],
		['/zh-tw' + PAGE + '/', {}],
		['/zh-tw' + PAGE + 'x', {}],
		['/zh-twx' + PAGE, {}],
		['/zh-tw/en' + PAGE, {}],
		['/zh-tw', {}]
	]) {
		const { env, seenByAssets } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: ACTIVE }) });
		const res = await claimed.default.fetch(get(path + '?' + PARAM + '=cs_real', init), env);
		const html = await res.text();
		const label = (init.method || 'GET') + ' ' + path;
		assert.equal(html.includes('data-ejecta-subscribe-result'), false, label + ' must not be claimed');
		assert.equal(seenByAssets.some((hit) => hit.path === '/' || hit.path === '/zh-tw/'), false, label + ' must not ask for a shell');
	}
	// the matcher names the locale it found, and the bare path is still the route object itself
	const route = FIXTURE_CONTRACT.subscribeResult;
	assert.equal(claimed.matchSubscribeResult(get(PAGE), route), route);
	assert.equal(claimed.matchSubscribeResult(get(PAGE + '?' + PARAM + '=x'), route), route);
	assert.deepEqual(claimed.matchSubscribeResult(get('/zh-tw' + PAGE + '?' + PARAM + '=x'), route), { ...route, pathLocale: 'zh-tw' });
	assert.deepEqual(claimed.matchSubscribeResult(get('/ja' + PAGE + '?' + PARAM + '=x'), route), { ...route, pathLocale: 'ja' });
	assert.equal(claimed.matchSubscribeResult(get('/zh-tw' + PAGE + '/?' + PARAM + '=x'), route), null);
	// the prefixed shape is claimed ONLY with the locator the contract names (below)
	assert.equal(claimed.matchSubscribeResult(get('/zh-tw' + PAGE), route), null);
	assert.equal(claimed.matchSubscribeResult(get('/zh-tw' + PAGE + '?other=x'), route), null);
	assert.equal(claimed.matchSubscribeResult(get('/zh-tw' + PAGE + '?' + PARAM + '=%20'), route), null);
});

// The prefixed path is not reserved the way the bare one is: the manifest drops
// only `/join/done`, so `/zh-tw/join/done` can be a page the site AUTHORED (and
// `/en/…` can be an ordinary content directory that happens to spell like a
// locale). A result URL always carries the checkout locator, so the locator is
// what tells "the buyer coming back from checkout" from "a visitor reading a
// page" — without it the prefixed route is left to the site's own content, or
// its 404. The bare path keeps claiming with or without a locator, exactly as
// every already-emitted worker does.
test('a prefixed path without a locator is not claimed, so an authored page there is not shadowed', async () => {
	for (const [prefix, query] of [
		['/zh-tw', ''],
		['/zh-tw', '?other=cs_real'],
		['/zh-tw', '?' + PARAM + '='],
		['/zh-tw', '?' + PARAM + '=%20%20'],
		['/en', ''],
		['/ja', '']
	]) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: ACTIVE }), authored: [prefix + PAGE] });
		const res = await claimed.default.fetch(get(prefix + PAGE + query), env);
		const body = await res.text();
		const label = prefix + PAGE + query;
		assert.equal(res.status, 200, label + ': the authored page answers');
		assert.equal(body, 'STATIC:' + prefix + PAGE, label + ': the site\'s own content, byte for byte');
		assert.equal(body.includes('data-ejecta-subscribe-result'), false, label + ': not claimed');
		assert.deepEqual(seenByRsp, [], label + ': RSP is not asked');
		assert.deepEqual(seenByAssets.map((hit) => hit.path), [prefix + PAGE], label + ': one read, the page itself, no shell');
	}

	// CONTROL, same site: with the locator the prefixed URL is the result page
	const withLocator = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const res = await claimed.default.fetch(get('/zh-tw' + PAGE + '?' + PARAM + '=cs_real'), withLocator.env);
	const html = await res.text();
	assert.equal(res.status, 200);
	assert.equal(html.includes('data-ejecta-subscribe-state="active"'), true, 'with a locator the result page is composed');
	assert.equal(html.includes('NAV-ZHTW'), true);
	assert.deepEqual(withLocator.seenByAssets.map((hit) => hit.path), ['/zh-tw/']);

	// CONTROL: the bare path's behaviour is unchanged — claimed without a locator too
	const bare = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: ACTIVE }) });
	const bareRes = await claimed.default.fetch(get(PAGE), bare.env);
	const bareHtml = await bareRes.text();
	assert.equal(bareRes.status, 404);
	assert.equal(bareHtml.includes('data-ejecta-subscribe-state="unknown"'), true, 'the bare path still answers the no-locator case itself');
	assert.deepEqual(bare.seenByAssets.map((hit) => hit.path), ['/']);
});

// The locator KEY is an ordinary query name: `?sid=reader-token` on an authored
// /zh-tw/<path> page is a reader, not a buyer. What tells them apart is whether the
// locator names a real checkout — the same facts read the page itself makes. RSP
// confirming it (active / confirming) makes the prefixed URL the result page. Any
// other answer (unknown, a refusal, the seam unreachable) leaves the path to the
// site: an authored page there is served as authored; only where the site has
// nothing does this worker answer "we can't confirm this subscription here".
test('a stray locator on an authored prefixed page does not shadow it; only a real checkout claims the path', async () => {
	const authoredPath = '/zh-tw' + PAGE;
	const strayArms = [
		['unknown', { [FACTS]: UNKNOWN }],
		['facts 500', { [FACTS]: () => new Response('boom', { status: 500 }) }],
		['facts unreadable', { [FACTS]: () => new Response('not json', { status: 200 }) }],
		['facts rejects', { [FACTS]: () => { throw new Error('seam down'); } }]
	];
	for (const [name, facts] of strayArms) {
		const { env, seenByRsp } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp(facts), authored: [authoredPath] });
		const res = await claimed.default.fetch(get(authoredPath + '?' + PARAM + '=reader-token'), env);
		const body = await res.text();
		assert.equal(res.status, 200, name + ': the authored page answers');
		assert.equal(body, 'STATIC:' + authoredPath, name + ': the site\'s own content, byte for byte');
		assert.equal(seenByRsp.length, 1, name + ': the locator is looked up once');
		assert.equal(seenByRsp[0].search, '?' + PARAM + '=reader-token', name);
	}
	// binding missing: nobody to ask, so nothing is confirmed — the authored page stands
	const noBinding = makeEnv({ ...TWO_LOCALES, authored: [authoredPath] });
	const noBindingRes = await claimed.default.fetch(get(authoredPath + '?' + PARAM + '=reader-token'), noBinding.env);
	assert.equal(await noBindingRes.text(), 'STATIC:' + authoredPath, 'binding missing: the authored page');

	// CONTROL, the same authored site: a locator RSP confirms is the buyer, and composes
	for (const [state, facts] of [['active', ACTIVE], ['confirming', CONFIRMING]]) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: facts }), authored: [authoredPath] });
		const res = await claimed.default.fetch(get(authoredPath + '?' + PARAM + '=cs_real'), env);
		const html = await res.text();
		assert.equal(res.status, 200, state);
		assert.equal(html.includes('data-ejecta-subscribe-state="' + state + '"'), true, state + ': the result page is composed');
		assert.equal(html.includes('NAV-ZHTW'), true, state);
		assert.equal(seenByRsp.length, 1, state + ': one facts read');
		assert.deepEqual(seenByAssets.map((hit) => hit.path), ['/zh-tw/'], state + ': the shell only; the page is not probed');
	}

	// CONTROL: the same stray locator where the site authored nothing is still this page's unknown answer
	const bare = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: UNKNOWN }) });
	const bareRes = await claimed.default.fetch(get(authoredPath + '?' + PARAM + '=reader-token'), bare.env);
	const bareHtml = await bareRes.text();
	assert.equal(bareRes.status, 404);
	assert.equal(bareHtml.includes('data-ejecta-subscribe-state="unknown"'), true, 'nothing authored: the unknown page');
	assert.equal(backLinkOf(bareHtml), '/zh-tw/');

	// CONTROL: the bare path is unchanged — a stray locator there is still this page's (it is reserved)
	const reserved = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: UNKNOWN }) });
	const reservedRes = await claimed.default.fetch(get(PAGE + '?' + PARAM + '=reader-token'), reserved.env);
	assert.equal(reservedRes.status, 404);
	assert.equal((await reservedRes.text()).includes('data-ejecta-subscribe-state="unknown"'), true);
	assert.deepEqual(reserved.seenByAssets.map((hit) => hit.path), ['/'], 'the bare path makes the one shell read it always made');
});

// Whose route it is gets decided before the locale home is read at all. The home is
// only the shell to compose into; if it is read alongside the facts, a home read that
// REJECTS (ASSETS failing, not a 404) lands in the catch before anyone asked whether
// the site authored the page — and the worker's 503 shadows a healthy authored page.
// So: the facts alone decide a confirmed buyer; an unconfirmed locator asks ASSETS for
// the page; only once the worker owns the path is the home read, and a home that fails
// THEN is round 2's 503. Request counts per branch (RSP + ASSETS):
//   confirmed (active/confirming)          facts, home               — 1 + 1
//   unconfirmed, page authored             facts, page               — 1 + 1 (home never read)
//   unconfirmed, nothing authored          facts, page, home         — 1 + 2 (+ `/` on a home 404)
//   bare path                              facts ‖ home              — 1 + 1, unchanged
test('a failing locale home cannot shadow an authored prefixed page: ownership is decided before the home is read', async () => {
	const authoredPath = '/zh-tw' + PAGE;
	const homeRejects = () => { throw new Error('assets down'); };
	const strayArms = [
		['unknown', { [FACTS]: UNKNOWN }],
		['facts 500', { [FACTS]: () => new Response('boom', { status: 500 }) }],
		['facts rejects', { [FACTS]: () => { throw new Error('seam down'); } }]
	];
	for (const [name, facts] of strayArms) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ shell: ROOT_EN, homes: { '/zh-tw/': homeRejects }, rsp: factsRsp(facts), authored: [authoredPath] });
		const res = await claimed.default.fetch(get(authoredPath + '?' + PARAM + '=reader-token'), env);
		const body = await res.text();
		assert.equal(res.status, 200, name + ', home rejects: the authored page answers, not a 503');
		assert.equal(body, 'STATIC:' + authoredPath, name + ': the site\'s own content, byte for byte');
		assert.equal(seenByRsp.length, 1, name + ': one facts read');
		assert.deepEqual(seenByAssets.map((hit) => hit.path), [authoredPath, authoredPath],
			name + ': the page probe, then the dispatcher\'s own read — the home is never asked for');
	}
	// binding missing, home rejects: still nothing confirmed, still the authored page
	const noBinding = makeEnv({ shell: ROOT_EN, homes: { '/zh-tw/': homeRejects }, authored: [authoredPath] });
	const noBindingRes = await claimed.default.fetch(get(authoredPath + '?' + PARAM + '=reader-token'), noBinding.env);
	assert.equal(noBindingRes.status, 200);
	assert.equal(await noBindingRes.text(), 'STATIC:' + authoredPath, 'binding missing, home rejects: the authored page');

	// once the worker owns the path, a home that rejects is round 2's 503 — both ways of owning it
	for (const [name, facts, reads] of [
		['active', ACTIVE, ['/zh-tw/']],
		['unknown, nothing authored', UNKNOWN, [authoredPath, '/zh-tw/']]
	]) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ shell: ROOT_EN, homes: { '/zh-tw/': homeRejects }, rsp: factsRsp({ [FACTS]: facts }) });
		const res = await claimed.default.fetch(get(authoredPath + '?' + PARAM + '=cs_real'), env);
		const body = await res.text();
		assert.equal(res.status, 503, name + ': owned, and its shell cannot be read');
		assert.equal(body.includes('<html'), false, name);
		assert.equal(body.includes('NAV-ROOT'), false, name + ': the root is not served in the locale\'s place');
		assert.equal(res.headers.get('cache-control'), 'private, no-store', name);
		assert.equal(seenByRsp.length, 1, name);
		assert.deepEqual(seenByAssets.map((hit) => hit.path), reads, name + ': reads, in order');
	}

	// request counts on the healthy branches (the table above)
	const counted = async (facts, authored, path) => {
		const { env, seenByRsp, seenByAssets } = makeEnv({ ...TWO_LOCALES, rsp: factsRsp({ [FACTS]: facts }), authored });
		await (await claimed.default.fetch(get(path), env)).text();
		return [seenByRsp.length, seenByAssets.map((hit) => hit.path)];
	};
	const q = '?' + PARAM + '=cs_real';
	assert.deepEqual(await counted(ACTIVE, [], authoredPath + q), [1, ['/zh-tw/']], 'confirmed: facts + home');
	assert.deepEqual(await counted(CONFIRMING, [authoredPath], authoredPath + q), [1, ['/zh-tw/']], 'confirming over an authored page: facts + home, no probe');
	assert.deepEqual(await counted(UNKNOWN, [], authoredPath + q), [1, [authoredPath, '/zh-tw/']], 'unconfirmed, nothing authored: facts + page + home');
	assert.deepEqual(await counted(ACTIVE, [], PAGE + q), [1, ['/']], 'bare: facts + home, as before');
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
