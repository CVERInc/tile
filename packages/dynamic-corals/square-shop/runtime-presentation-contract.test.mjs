// Worker↔renderer presentation contract for every site-owned runtime buyer/member surface:
// native storefront listing/detail, /membership, /account, /shop/complete (incl. one
// locale-prefixed path), native checkout success, and /subscribe/success.
//
// ONE declarative registry (STATES below), not one test file per surface family: each entry says
// how to render a real state through the actual emitted Worker/template (the same emit()/
// renderCompletion() shapes the family's own pre-existing tests already use — see each render
// helper's comment for which existing test it mirrors), which renderer-owned `st-*` presentation
// roots the rendered body must carry, and which existing behavioral hooks (data-*, dc-*,
// ejecta-*, ids) must survive unrenamed. `checkEntry` below then proves, for every entry:
//   (a) each registered presentation class occurs in the rendered body AND resolves to a real
//       rule inside @layer reef.base in site.css;
//   (b) every registered behavioral hook is still present;
//   (c) the rendered body carries no <style> element and no presentation style="" attribute;
//   (d) a presentation root is never satisfied merely by a behavioral hook's own name — an entry
//       may only claim `st-*` classes as presentation, or one of the four explicitly registered
//       PINNED_HOOK_EXCEPTIONS below (a hook that is itself pinned exact-string markup elsewhere
//       and cannot carry a class of its own), each proven to have a real, correctly-scoped rule.
//   (e) `contextPresentation` entries (a renderer class that styles its descendants rather than
//       itself, e.g. `.st-form-head h1`) are checked for presence in the body and for a matching
//       reef.base rule the same whole-token way, without the own-subject requirement (a) applies.
//
// This closes the blind spot where runtime-composed markup existed outside any static renderer
// presentation check, and fails if a surface loses its presentation connection even while
// routing/facts tests (storefront-source-routing.test.mjs, buyer-page-composition.test.mjs,
// shop-complete.test.mjs, subscribe-result-composition.test.mjs — none of them edited here) stay
// green.
//
// run: node packages/dynamic-corals/square-shop/runtime-presentation-contract.test.mjs
// (globbed by scripts/test.sh's SUITE_GLOBS via packages/dynamic-corals/square-shop/*.test.mjs)

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatMoney } from './product-page-core.js';
import { renderCompletion } from './shop-function-template.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const emitterPath = path.join(here, 'emit-shop-function.mjs');

// ── CSS-side reader ──────────────────────────────────────────────────────────────────────────
// Same consecutive-rule sweep as packages/sitetile/base-paint.test.mjs / section-inset.test.mjs /
// runtime-presentation.test.mjs (anchored on the selector run itself, so it cannot skip
// alternating rules — see base-paint.test.mjs's own regression test for why that anchor
// matters); computed once and filtered per needle below instead of re-parsed per class.
const CSS_PATH = path.join(here, '..', '..', 'sitetile', 'astro', 'src', 'styles', 'site.css');
const CSS = readFileSync(CSS_PATH, 'utf8');
function parseReefBaseRules(cssText) {
	const body = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
	const baseStart = body.indexOf('@layer reef.base {');
	const responsiveStart = body.indexOf('@layer reef.responsive {');
	const rules = [];
	for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (m.index <= baseStart || m.index >= responsiveStart) continue;
		rules.push({ selector: m[1].trim(), css: m[2] });
	}
	return rules;
}

const CSS_BODY = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const REEF_BASE_START = CSS_BODY.indexOf('@layer reef.base {');
const REEF_RESPONSIVE_START = CSS_BODY.indexOf('@layer reef.responsive {');

test('🔴 CONTROL: the layer boundaries this file relies on are actually found', () => {
	assert.ok(REEF_BASE_START > -1, 'site.css must open @layer reef.base');
	assert.ok(REEF_RESPONSIVE_START > REEF_BASE_START, 'site.css must open @layer reef.responsive after reef.base');
});

const REEF_BASE_RULES = parseReefBaseRules(CSS);

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rules inside reef.base whose selector contains `needle` as a whole token — `st-cell` must not
 *  be satisfied by a `.st-cells` rule, so the match requires a non-identifier character (or the
 *  end of the selector) right after the needle. */
function reefBaseRulesFor(needle) {
	const re = new RegExp(`${escapeRegExp(needle)}(?![\\w-])`);
	return REEF_BASE_RULES.filter((r) => re.test(r.selector));
}

function splitSelectorList(selector) {
	const parts = [];
	let start = 0;
	let parens = 0;
	let brackets = 0;
	let quote = '';
	for (let i = 0; i < selector.length; i += 1) {
		const char = selector[i];
		if (quote) {
			if (char === quote && selector[i - 1] !== '\\') quote = '';
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '(') parens += 1;
		else if (char === ')') parens -= 1;
		else if (char === '[') brackets += 1;
		else if (char === ']') brackets -= 1;
		else if (char === ',' && parens === 0 && brackets === 0) {
			parts.push(selector.slice(start, i).trim());
			start = i + 1;
		}
	}
	parts.push(selector.slice(start).trim());
	return parts.filter(Boolean);
}

function rightmostCompound(selector) {
	let lastCombinator = -1;
	let parens = 0;
	let brackets = 0;
	let quote = '';
	for (let i = 0; i < selector.length;) {
		const char = selector[i];
		if (quote) {
			if (char === quote && selector[i - 1] !== '\\') quote = '';
			i += 1;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			i += 1;
			continue;
		}
		if (char === '(') {
			parens += 1;
			i += 1;
			continue;
		}
		if (char === ')') {
			parens -= 1;
			i += 1;
			continue;
		}
		if (char === '[') {
			brackets += 1;
			i += 1;
			continue;
		}
		if (char === ']') {
			brackets -= 1;
			i += 1;
			continue;
		}
		if (parens === 0 && brackets === 0 && /[>+~]/.test(char)) {
			lastCombinator = i;
			i += 1;
			continue;
		}
		if (parens === 0 && brackets === 0 && /\s/.test(char)) {
			let next = i;
			while (next < selector.length && /\s/.test(selector[next])) next += 1;
			const previous = selector.slice(0, i).trimEnd().at(-1);
			const following = selector[next];
			if (previous && following && !/[>+~]/.test(previous) && !/[>+~]/.test(following)) lastCombinator = i;
			i = next;
			continue;
		}
		i += 1;
	}
	return selector.slice(lastCombinator + 1).trim();
}

function matchingParen(text, open) {
	let depth = 0;
	let quote = '';
	for (let i = open; i < text.length; i += 1) {
		const char = text[i];
		if (quote) {
			if (char === quote && text[i - 1] !== '\\') quote = '';
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '(') depth += 1;
		else if (char === ')' && --depth === 0) return i;
	}
	return -1;
}

function compoundOwnsClass(compound, cls) {
	const direct = new RegExp(`\\.${escapeRegExp(cls)}(?![\\w-])`);
	let parens = 0;
	let brackets = 0;
	let quote = '';
	for (let i = 0; i < compound.length; i += 1) {
		const char = compound[i];
		if (quote) {
			if (char === quote && compound[i - 1] !== '\\') quote = '';
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '[') {
			brackets += 1;
			continue;
		}
		if (char === ']') {
			brackets -= 1;
			continue;
		}
		if (brackets > 0) continue;
		if (char === '(') {
			parens += 1;
			continue;
		}
		if (char === ')') {
			parens -= 1;
			continue;
		}
		if (parens === 0 && char === '.' && direct.test(compound.slice(i))) return true;
		if (parens === 0 && char === ':') {
			const open = compound.indexOf('(', i + 1);
			if (open === -1 || !/^[a-zA-Z-][\w-]*$/.test(compound.slice(i + 1, open))) continue;
			const close = matchingParen(compound, open);
			if (close === -1) continue;
			if (selectorHasOwnClass(compound.slice(open + 1, close), cls)) return true;
			i = close;
		}
	}
	return false;
}

function selectorHasOwnClass(selector, cls) {
	return splitSelectorList(selector).some((part) => compoundOwnsClass(rightmostCompound(part), cls));
}

function reefBaseOwnRulesFor(needle, rules = REEF_BASE_RULES) {
	return rules.filter((r) => splitSelectorList(r.selector).some((selector) => selectorHasOwnClass(selector, needle)));
}

// ── the four hooks that cannot carry a presentation class of their own ─────────────────────────
// Every other runtime surface adds a plain `st-*` class. These four are pinned exact-string
// markup in an existing, unedited test (that assertion is never touched), so their look is read
// back through a selector instead of a new class. Registered explicitly, with the reason, rather
// than left for an entry's presentation field to silently accept any old hook name.
const PINNED_HOOK_EXCEPTIONS = {
	'dc-native-buy': {
		label: '.dc-native-buy',
		reason: 'class="dc-native-buy" is a pinned exact string (storefront-source-routing.test.mjs); read back through a low-specificity selector scoped under .st-runtime instead of a second class token',
		presenceRegex: /class="dc-native-buy"/,
		cssNeedle: 'dc-native-buy',
		scopedRegex: /\.st-runtime\s*:where\(\.dc-native-buy\)/,
	},
	'dc-shop-heading': {
		label: '#dc-shop-heading',
		reason: '<h1 id="dc-shop-heading"> is a pinned exact string (shop-complete.test.mjs); its heading scale is read back through a zero-specificity :where() id selector',
		presenceRegex: /id="dc-shop-heading"/,
		cssNeedle: 'dc-shop-heading',
		scopedRegex: /:where\(#dc-shop-heading\)/,
	},
	'subscribe-result-h1': {
		label: '[data-ejecta-subscribe-result] h1',
		reason: 'the subscribe-result <h1> carries no class of its own; its heading scale is read back through the existing data-ejecta-subscribe-result hook',
		presenceRegex: /data-ejecta-subscribe-result=""[\s\S]*?<h1>/,
		cssNeedle: 'data-ejecta-subscribe-result',
		scopedRegex: /:where\(\[data-ejecta-subscribe-result\]\s*h1\)/,
	},
	'dc-shop-total': {
		label: '.dc-shop-total',
		reason: 'existing unrenamed hook (client-composed paid-state total line); its look is read back through a :where() selector scoped under .st-runtime',
		presenceRegex: /class="dc-shop-total"/,
		cssNeedle: 'dc-shop-total',
		scopedRegex: /:where\(\.st-runtime[^)]*\.dc-shop-total\)/,
	},
};

// ── native storefront: emit a real worker, same fixture contract/harness shape as
//    storefront-source-routing.test.mjs ──────────────────────────────────────────────────────
const NATIVE_API = 'https://api.example';
const nativeTemp = mkdtempSync(path.join(os.tmpdir(), 'runtime-presentation-contract-native-'));
const nativeContractPath = path.join(nativeTemp, 'site-api-transport.contract.json');
const NATIVE_BINDING = 'SHOP_API';
writeFileSync(nativeContractPath, JSON.stringify({
	bindingName: NATIVE_BINDING,
	checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
	forward: [{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] }],
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));
function emitNative(name, args) {
	const out = path.join(nativeTemp, `${name}.mjs`);
	execFileSync('node', [emitterPath, '--api-contract', nativeContractPath, ...args, '--api', NATIVE_API, '--out', out], { stdio: 'pipe' });
	return { load: () => import(`${pathToFileURL(out).href}?${Date.now()}-${Math.random()}`) };
}
const nativeShell = '<!doctype html><html data-theme="reef"><head><title>Donor</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>';
async function serveNative(name, { path: reqPath = '/shop', projection }) {
	const { load } = emitNative(name, ['--site-id', 'site-native-runtime', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
	const mod = await load();
	const response = await mod.default.fetch(new Request('https://site.example' + reqPath), {
		ASSETS: { fetch: async () => new Response(nativeShell) },
		[NATIVE_BINDING]: { fetch: async (request) => projection(new URL(request.url)) },
	});
	return { status: response.status, html: await response.text() };
}
const nativeProduct = {
	slug: 'sample-tee',
	copy: { name: 'Sample Tee', description_html: '<p>Repo-backed copy</p>', image_ref: '/tee.jpg', media: [{ url: '/tee.jpg' }] },
	commerce: { sku: 'tee-sku', currency: 'USD', unit_price: 1900, tracked: true, available: 2, reserved: 0, status: 'IN_STOCK' },
};
const nativeSoldOut = { ...nativeProduct, commerce: { ...nativeProduct.commerce, available: 0, status: 'OUT_OF_STOCK' } };
const NATIVE_PRICE = formatMoney({ minor: 1900, currency: 'USD', locale: 'en-US' });
const listOk = (items) => async (url) => (url.searchParams.has('slug')
	? Response.json({ ok: true, source: 'native', item: items[0] })
	: Response.json({ ok: true, source: 'native', items }));
const detailOk = (item) => async () => Response.json({ ok: true, source: 'native', item });
const unavailable503 = async () => Response.json({ ok: false }, { status: 503 });
const notFound404 = async () => Response.json({ ok: false, error: 'not_found' }, { status: 404 });

// ── membership + account: emit a real site runtime, same fixture-contract/harness shape as
//    buyer-page-composition.test.mjs (which pins the
//    class-before-data-attribute adjacency this checks preserve) ────────────────────────────
const memberTemp = mkdtempSync(path.join(os.tmpdir(), 'runtime-presentation-contract-member-'));
const MEMBER_BINDING = 'SEAMLINK';
const memberContractPath = path.join(memberTemp, 'fixture.contract.json');
writeFileSync(memberContractPath, JSON.stringify({
	schemaVersion: 2,
	bindingName: MEMBER_BINDING,
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 599, cacheControl: 'private, max-age=0, no-store, fixture-marker' },
	siteOwnedBuyerPages: [
		{ path: '/tiers', method: 'GET', kind: 'membership', factsPath: '/zapi/tier-facts' },
		{ path: '/hub', method: 'GET', kind: 'account', factsPath: '/zapi/hub-facts' },
	],
	forward: [
		{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: '/tiers', methods: ['GET'] },
		{ match: 'exact', value: '/hub', methods: ['GET'] },
	],
}, null, 2));
const memberOutPath = path.join(memberTemp, 'worker.mjs');
execFileSync('node', [emitterPath, '--site-id', 'site-1', '--api-contract', memberContractPath, '--out', memberOutPath], { stdio: ['ignore', 'ignore', 'pipe'] });
const memberWorker = await import(pathToFileURL(memberOutPath).href);
const MEMBER_SHELL = '<!doctype html><html lang="en-US"><head><title>t</title></head>' +
	'<body><header>NAV</header><main class="site-main"><p>HOME</p></main><footer>F</footer></body></html>';
function makeMemberEnv(facts) {
	return {
		ASSETS: { fetch: async (req) => {
			const url = new URL(typeof req === 'string' ? req : req.url);
			if (url.pathname === '/') return new Response(MEMBER_SHELL, { status: 200, headers: { 'content-type': 'text/html' } });
			return new Response('STATIC', { status: 200 });
		} },
		[MEMBER_BINDING]: { fetch: async (req) => facts(new URL(req.url).pathname) },
	};
}
const memberFacts = (byPath) => (pathname) => {
	const entry = byPath[pathname];
	if (!entry) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
	if (typeof entry === 'function') return entry();
	return new Response(JSON.stringify(entry), { status: 200, headers: { 'content-type': 'application/json' } });
};
const memberGet = (p) => new Request('https://s.example' + p);
const PLANS = { state: 'available', plans: [{ plan_id: 'plan_gold', display_name: 'Gold', amount: 1200, currency: 'USD', interval: 'month' }] };
async function renderMembershipHtml(byPath) {
	return (await memberWorker.default.fetch(memberGet('/tiers'), makeMemberEnv(memberFacts(byPath)))).text();
}
async function renderAccountHtml(facts) {
	return (await memberWorker.default.fetch(memberGet('/hub'), makeMemberEnv(memberFacts({ '/zapi/hub-facts': facts })))).text();
}

// Provider coral pages (square-shop.js) keep their own coral package presentation and are not
// registered in this contract.

// ── results: /shop/complete + native checkout success call renderCompletion() directly, the
//    same shape shop-complete.test.mjs already uses; /subscribe/success emits a real worker,
//    the same shape subscribe-result-composition.test.mjs already uses ──────────────────────
const resultsShell = '<!doctype html><html lang="en-US"><head><title>Shop</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>';
const resultsEnv = { ASSETS: { fetch: async () => new Response(resultsShell) } };
const RESULTS_SHOP = { shopPath: '/shop', lang: 'en-US' };
async function renderCompletionHtml(qs) {
	const req = new Request(`https://shop.example/shop/complete${qs}`);
	return (await renderCompletion(req, resultsEnv, { siteId: 'site-key' }, RESULTS_SHOP)).text();
}
async function renderLocaleCompletionHtml() {
	const req = new Request('https://shop.example/ja/shop/complete?ref=ref-123');
	return (await renderCompletion(req, resultsEnv, { siteId: 'site-key' }, RESULTS_SHOP)).text();
}
async function renderCheckoutSuccessHtml() {
	const shop = { shopPath: '/shop', source: 'native' };
	const route = { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' };
	const req = new Request('https://shop.example/checkout/success?order_id=ord-1');
	return (await renderCompletion(req, resultsEnv, { siteId: 'site-key' }, shop, route)).text();
}

const subTemp = mkdtempSync(path.join(os.tmpdir(), 'runtime-presentation-contract-subscribe-'));
const SUB_BINDING = 'SEAMLINK';
const SUB_PAGE = '/join/done';
const SUB_PARAM = 'sid';
const subContractPath = path.join(subTemp, 'fixture.contract.json');
writeFileSync(subContractPath, JSON.stringify({
	schemaVersion: 2,
	bindingName: SUB_BINDING,
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 599, cacheControl: 'private, no-store, fixture-marker' },
	subscribeResult: { path: SUB_PAGE, method: 'GET', sessionParam: SUB_PARAM, factsPath: '/zapi/join-result' },
	forward: [
		{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: SUB_PAGE, methods: ['GET'] },
	],
}, null, 2));
const subOutPath = path.join(subTemp, 'worker.mjs');
execFileSync('node', [emitterPath, '--site-id', 'site-1', '--api-contract', subContractPath, '--out', subOutPath], { stdio: ['ignore', 'ignore', 'pipe'] });
const subscribeWorker = await import(pathToFileURL(subOutPath).href);
const subShell = '<!doctype html><html lang="en-US"><head><title>Site</title></head><body><header>NAV</header><main>HOME</main><footer>FOOT</footer></body></html>';
const SUB_PLAN = { plan_id: 'plan_gold', display_name: 'Gold', amount: 1200, currency: 'USD', interval: 'month' };
const subAssetsFetch = async (req) => {
	const url = new URL(typeof req === 'string' ? req : req.url);
	if (url.pathname === '/') return new Response(subShell, { status: 200, headers: { 'content-type': 'text/html' } });
	return new Response('STATIC', { status: 200 });
};
const subGet = (p) => new Request('https://s.example' + p);
async function renderSubscribeHtml(answer) {
	const env = { ASSETS: { fetch: subAssetsFetch }, [SUB_BINDING]: { fetch: async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }) } };
	return (await subscribeWorker.default.fetch(subGet(SUB_PAGE + '?' + SUB_PARAM + '=cs1'), env)).text();
}
async function renderSubscribeUnavailableHtml() {
	const env = { ASSETS: { fetch: subAssetsFetch } }; // no binding at all — subscribe-result-composition.test.mjs's own "no binding" shape
	return (await subscribeWorker.default.fetch(subGet(SUB_PAGE + '?' + SUB_PARAM + '=cs1'), env)).text();
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────
// `presentation`: renderer-owned `st-*` classes only, each required to carry its own reef.base
// rule (enforced below). `contextPresentation`: renderer-owned `st-*` classes that instead style
// their descendants (e.g. `.st-form-head h1, .st-form-head h2`) — same presence-in-body check,
// but the CSS check only needs the class to appear as a whole token somewhere in a reef.base
// selector, not as the rule's own subject. `pinnedExceptions`: keys into PINNED_HOOK_EXCEPTIONS.
// `hooks`: existing behavioral markers that must survive unrenamed. `extra`: optional additional
// assertions unique to that state (a pinned byte-exact shape, a negative control, …) that do not
// fit the presentation/hook/CSS shape above.
const STATES = [
	{
		id: 'native listing: items',
		render: () => serveNative('c-native-listing-items', { projection: listOk([nativeProduct]) }).then((r) => r.html),
		presentation: ['st-runtime', 'st-cells', 'st-cell', 'st-native-card', 'st-img', 'st-runtime-status'],
		pinnedExceptions: ['dc-native-buy'],
		hooks: [/data-storefront-source="native"/, /class="dc-native-grid st-runtime"/, /data-native-sku="tee-sku"/, /<p data-native-status role="status"/],
		extra: (html) => assert.ok(html.includes(`<p>${NATIVE_PRICE}</p>`), 'the price <p> did not render in its expected formatted form'),
	},
	{
		id: 'native listing: empty',
		render: () => serveNative('c-native-listing-empty', { projection: async (url) => (url.searchParams.has('slug') ? Response.json({ ok: false }, { status: 404 }) : Response.json({ ok: true, source: 'native', items: [] })) }).then((r) => r.html),
		presentation: ['st-runtime', 'st-runtime-status'],
		hooks: [/class="dc-native-grid st-runtime"/],
		extra: (html) => assert.doesNotMatch(html, /st-cells/, 'an empty catalog must not emit an empty card grid container'),
	},
	{
		id: 'native listing: unavailable',
		render: () => serveNative('c-native-listing-unavailable', { projection: unavailable503 }).then((r) => r.html),
		presentation: ['st-runtime'],
		hooks: [/data-storefront-source="native"/, /data-storefront-state="unavailable"/],
	},
	{
		id: 'native detail: enabled',
		render: () => serveNative('c-native-detail-enabled', { path: '/shop/sample-tee', projection: detailOk(nativeProduct) }).then((r) => r.html),
		presentation: ['st-runtime', 'st-native-detail', 'st-img', 'st-native-actions', 'st-runtime-status'],
		pinnedExceptions: ['dc-native-buy'],
		hooks: [/data-storefront-source="native"/, /class="dc-native-product st-runtime st-native-detail"/, /data-native-sku="tee-sku"/, /<p data-native-status role="status"/],
		extra: (html) => assert.ok(html.includes(`<p>${NATIVE_PRICE}</p>`), 'the price <p> must stay unclassed/unwrapped'),
	},
	{
		id: 'native detail: sold-out',
		render: () => serveNative('c-native-detail-sold-out', { path: '/shop/sample-tee', projection: detailOk(nativeSoldOut) }).then((r) => r.html),
		presentation: ['st-runtime', 'st-native-detail', 'st-native-actions', 'st-runtime-status'],
		pinnedExceptions: ['dc-native-buy'],
		hooks: [/class="dc-native-buy" disabled>Unavailable/],
		extra: (html) => assert.doesNotMatch(html, /data-native-sku="tee-sku"/),
	},
	{
		id: 'native detail: not-found',
		render: () => serveNative('c-native-detail-not-found', { path: '/shop/nope', projection: notFound404 }).then((r) => r.html),
		presentation: ['st-runtime'],
		hooks: [/data-storefront-source="native"/, /data-storefront-state="not-found"/],
		extra: (html) => assert.match(html, /<div class="st-runtime"><section data-storefront-source="native" data-storefront-state="not-found"><h1>Product not found<\/h1><\/section><\/div>/),
	},
	{
		id: 'native detail: unavailable',
		render: () => serveNative('c-native-detail-unavailable', { path: '/shop/sample-tee', projection: unavailable503 }).then((r) => r.html),
		presentation: ['st-runtime'],
		hooks: [/data-storefront-source="native"/, /data-storefront-state="unavailable"/],
	},
	{
		id: 'membership: available',
		render: () => renderMembershipHtml({ '/zapi/tier-facts': PLANS }),
		presentation: ['st-runtime', 'st-runtime-status', 'st-cells', 'st-runtime-list', 'st-cell', 'st-runtime-action'],
		hooks: [/data-ejecta-membership-state="available"/, /data-ejecta-slot="subscribe" data-ejecta-plan="plan_gold"/, /Gold/],
	},
	{
		id: 'membership: empty',
		render: () => renderMembershipHtml({ '/zapi/tier-facts': { state: 'empty', plans: [] } }),
		presentation: ['st-runtime', 'st-runtime-status'],
		hooks: [/data-ejecta-membership-state="empty"/, /data-ejecta-membership-empty=""/],
	},
	{
		id: 'membership: unavailable',
		render: () => renderMembershipHtml({ '/zapi/tier-facts': () => new Response('<html>not json</html>', { status: 200 }) }),
		presentation: ['st-runtime', 'st-runtime-status'],
		hooks: [/data-ejecta-membership-state="unavailable"/, /data-ejecta-membership-unavailable=""/],
	},
	{
		id: 'membership: not-found (route refused)',
		render: () => renderMembershipHtml({}), // every facts path 404s
		presentation: ['st-runtime'],
		hooks: [/data-ejecta-membership-route="unavailable"/],
	},
	{
		id: 'account: signed-out',
		render: () => renderAccountHtml({ signed_in: false, sections: [] }),
		presentation: ['st-runtime', 'st-form', 'st-form-field', 'st-form-label', 'st-form-input', 'st-runtime-action', 'st-runtime-status'],
		contextPresentation: ['st-form-head'],
		hooks: [/data-ejecta-account-state="logged-out"/, /data-ejecta-slot="auth-request" data-ejecta-account-login-form=""/, /id="ejecta-account-email"/, /data-ejecta-auth-status=""/],
	},
	{
		id: 'account: signed-in',
		render: () => renderAccountHtml({ signed_in: true, sections: ['orders', 'profile'] }),
		presentation: ['st-runtime', 'st-account-sections', 'st-form', 'st-form-field', 'st-form-label', 'st-form-input', 'st-runtime-action', 'st-runtime-status'],
		hooks: [/data-ejecta-account-state="logged-in"/, /data-ejecta-account-sections=""/, /data-ejecta-account-section="orders"/, /data-ejecta-account-section="profile"/, /data-ejecta-slot="email-change" data-ejecta-account-email-change-form=""/, /id="ejecta-account-new-email"/, /data-ejecta-email-change-status=""/],
	},
	{
		id: 'shop complete: pending (has ref)',
		render: () => renderCompletionHtml('?ref=ref-123'),
		// st-list / st-runtime-action here are read back from the emitted client script's own
		// paid-state markup text (checked as source text, same pattern cart-paid-clearing.test.mjs
		// already uses for this script — the paid/canceled/unknown branches never exist as
		// server-rendered DOM, only as JS string literals inside the Worker response).
		presentation: ['st-runtime', 'st-list', 'st-runtime-action'],
		pinnedExceptions: ['dc-shop-heading', 'dc-shop-total'],
		hooks: [/id="dc-shop-outcome"/, /<section class="dc-shop-complete" aria-live="polite">/],
		extra: (html) => {
			assert.ok(html.includes("shouldClearCartForOutcome(d.state)") && html.includes("d.state==='pending'"),
				'the cart-clearing decision and the pending-state literal cart-paid-clearing.test.mjs pins stay untouched');
			assert.ok(html.includes(`<a class="st-runtime-action" href="'+esc(C.shopPath)+'">`), 'the canceled/unknown back() link carries the shared action class, href hook untouched');
		},
	},
	{
		id: 'shop complete: unknown (no ref)',
		render: () => renderCompletionHtml(''),
		presentation: ['st-runtime', 'st-runtime-action'],
		pinnedExceptions: ['dc-shop-heading'],
		hooks: [/<section class="dc-shop-complete"/],
		extra: (html) => {
			assert.ok(html.includes('<a class="st-runtime-action" href="/shop">'), 'the SSR unknown-state back link carries the primary-action class');
			assert.doesNotMatch(html, /<script>/, 'a direct visit with no ref renders unknown immediately and does not poll');
		},
	},
	{
		id: 'shop complete: locale-prefixed path (/ja/shop/complete)',
		render: () => renderLocaleCompletionHtml(),
		presentation: ['st-runtime'],
		pinnedExceptions: ['dc-shop-heading'],
		hooks: [/<section class="dc-shop-complete"/],
	},
	{
		id: 'checkout success (native, via renderCompletion\'s checkoutResult route)',
		render: () => renderCheckoutSuccessHtml(),
		presentation: ['st-runtime'],
		pinnedExceptions: ['dc-shop-heading'],
		hooks: [/<section class="dc-shop-complete"/, /id="dc-shop-outcome"/],
	},
	{
		id: 'subscribe success: active',
		render: () => renderSubscribeHtml({ state: 'active', plan: SUB_PLAN }),
		presentation: ['st-runtime', 'st-runtime-status'],
		pinnedExceptions: ['subscribe-result-h1'],
		hooks: [/data-ejecta-subscribe-result=""/, /data-ejecta-subscribe-state="active"/, /data-ejecta-subscribe-plan="plan_gold"/],
	},
	{
		id: 'subscribe success: confirming',
		render: () => renderSubscribeHtml({ state: 'confirming', plan: SUB_PLAN }),
		presentation: ['st-runtime', 'st-runtime-status'],
		pinnedExceptions: ['subscribe-result-h1'],
		hooks: [/data-ejecta-subscribe-state="confirming"/],
	},
	{
		id: 'subscribe success: unknown',
		render: () => renderSubscribeHtml({ state: 'unknown', plan: null }),
		presentation: ['st-runtime', 'st-runtime-action'],
		pinnedExceptions: ['subscribe-result-h1'],
		hooks: [/data-ejecta-subscribe-state="unknown"/],
		extra: (html) => assert.ok(html.includes('<a class="st-runtime-action" href="/">'), 'the back-home link is styled as a primary action, href hook untouched'),
	},
	{
		id: 'subscribe success: unavailable',
		render: () => renderSubscribeUnavailableHtml(),
		presentation: ['st-runtime', 'st-runtime-status'],
		pinnedExceptions: ['subscribe-result-h1'],
		hooks: [/data-ejecta-subscribe-state="unavailable"/, /data-ejecta-subscribe-unavailable=""/],
	},
];

function renderedClassTokens(html) {
	const tokens = new Set();
	for (const match of html.matchAll(/(?<![\w-])class\s*=\s*(["'])(.*?)\1/gs)) {
		for (const token of match[2].trim().split(/\s+/)) {
			if (token) tokens.add(token);
		}
	}
	return tokens;
}

function checkEntry(entry, html) {
	const classTokens = renderedClassTokens(html);
	assert.ok(entry.presentation.includes('st-runtime'), `${entry.id}: registry must require the st-runtime root`);
	for (const cls of entry.presentation) {
		assert.match(cls, /^st-/, `[registry bug] ${entry.id}: presentation entries must be st-* classes, got "${cls}"`);
		assert.ok(classTokens.has(cls),
			`${entry.id}: presentation class "${cls}" not found in the rendered body`);
		assert.ok(reefBaseOwnRulesFor(cls).length > 0, `${entry.id}: .${cls} has no own-subject rule inside @layer reef.base`);
	}
	for (const cls of entry.contextPresentation || []) {
		assert.match(cls, /^st-/, `[registry bug] ${entry.id}: contextPresentation entries must be st-* classes, got "${cls}"`);
		assert.ok(classTokens.has(cls),
			`${entry.id}: context presentation class "${cls}" not found in the rendered body`);
		assert.ok(reefBaseRulesFor(cls).length > 0, `${entry.id}: .${cls} has no rule inside @layer reef.base`);
	}
	for (const key of entry.pinnedExceptions || []) {
		const exc = PINNED_HOOK_EXCEPTIONS[key];
		assert.ok(exc, `[registry bug] ${entry.id}: unknown pinned-hook exception "${key}"`);
		assert.ok(exc.presenceRegex.test(html), `${entry.id}: pinned hook ${exc.label} not found in the rendered body`);
		const rules = reefBaseRulesFor(exc.cssNeedle);
		assert.ok(rules.length > 0, `${entry.id}: ${exc.label} has no rule inside @layer reef.base`);
		assert.ok(rules.some((r) => exc.scopedRegex.test(r.selector)),
			`${entry.id}: ${exc.label}'s rule is not scoped the way a pinned-hook exception requires (${exc.reason}): ${rules.map((r) => r.selector).join(' | ')}`);
	}
	for (const hook of entry.hooks) {
		assert.match(html, hook, `${entry.id}: behavioral hook ${hook} missing`);
	}
	assert.doesNotMatch(html, /<style[\s>]/, `${entry.id}: rendered body must not contain an inline <style> element`);
	assert.doesNotMatch(html, /\sstyle="/, `${entry.id}: rendered body must not contain a presentation style="" attribute`);
	assert.ok((entry.presentation && entry.presentation.length > 0) || (entry.pinnedExceptions && entry.pinnedExceptions.length > 0),
		`[registry bug] ${entry.id}: entry declares no presentation root at all`);
	if (entry.extra) entry.extra(html);
}

test('🔴 CONTROL: a prefixed class token does not satisfy the registered class', () => {
	assert.throws(
		() => checkEntry({ id: 'exact-class-control', presentation: ['st-runtime'], hooks: [] }, '<body><div class="st-runtime-status"></div></body>'),
		/Presentation class "st-runtime" not found in the rendered body/i,
	);
});

test('🔴 CONTROL: a descendant selector does not count as an own-subject rule', () => {
	const syntheticRules = parseReefBaseRules('@layer reef.base { .st-runtime :where(.x) {} } @layer reef.responsive {}');
	assert.equal(reefBaseOwnRulesFor('st-runtime', syntheticRules).length, 0);
});

for (const entry of STATES) {
	test(entry.id, async () => {
		const html = await entry.render();
		checkEntry(entry, html);
	});
}

// ── negative control: the no-donor-shell document must NOT gain any of this slice's presentation ──
// nativeUnavailableDocument() is a different function from nativeUnavailableBody() above (it is
// that body's own byte-for-byte source when there is no site shell at all to wrap) and this slice
// never edits it; a regression where the .st-runtime wrap leaked into the shared body itself would
// show up here as an added <div>.
test('🔴 CONTROL: the no-donor-shell document stays the bare pinned document, no .st-runtime leaks in', async () => {
	const { load } = emitNative('c-native-no-shell', ['--site-id', 'site-native-runtime', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
	const mod = await load();
	const response = await mod.default.fetch(new Request('https://site.example/shop'), {
		ASSETS: { fetch: async () => new Response('missing', { status: 404 }) },
		[NATIVE_BINDING]: { fetch: async () => unavailable503() },
	});
	const html = await response.text();
	assert.equal(response.status, 503);
	assert.equal(html, '<!doctype html><main><section data-storefront-source="native" data-storefront-state="unavailable"><h1>Storefront unavailable</h1><p>Please try again later.</p></section></main>',
		'nativeUnavailableDocument() must stay byte-for-byte — this slice never touches it');
	assert.doesNotMatch(html, /st-runtime|st-native/, 'no presentation class may leak into the honest no-shell document');
});
