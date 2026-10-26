// The checkout return a Site Worker answers when it has NO RSP binding but a platform reader (the
// dispatcher's ctx.props.CONNECTOR stub, or a baked read token): Workers for Platforms. The native
// claim (an order id on a site with a native shop) is unchanged; the requests it declines — no order
// id, or a site whose shops are all provider shops — get the same Site-composed completion page
// instead of the binding-missing 503. A site with no shop gets that page in its root document's shell,
// its existing "Back to the shop" link pointing at /. With the binding (Pages) they are still the
// verbatim forward, and with neither binding nor reader they are still the binding-missing 503.
//
// The subscribe landing needs no such branch: its bare path is claimed with or without a locator,
// and a prefixed path RSP does not confirm is handed back to the site's own content, never to the
// forward. The last tests pin that on the stub tier.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchCheckoutResultFallback } from './shop-function-template.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'checkout-result-fallback-'));
const SITE = 'https://site.example.test';

const CHECKOUT = { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' };
const SUBSCRIBE = { path: '/subscribe/success', method: 'GET', sessionParam: 'session_id', factsPath: '/api/subscribe/result' };
const contract = path.join(temp, 'contract.json');
writeFileSync(contract, JSON.stringify({
	bindingName: 'RSP',
	forward: [
		{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: '/checkout/success', methods: ['GET'] },
		{ match: 'exact', value: '/subscribe/success', methods: ['GET'] },
	],
	checkoutResult: CHECKOUT,
	subscribeResult: SUBSCRIBE,
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));

function emit(name, storefronts, { token = false } = {}) {
	const out = path.join(temp, name + '.mjs');
	const args = [emitter, '--api-contract', contract, '--site-id', 'site-1', '--name', 'Fixture', '--out', out];
	if (storefronts) args.push('--storefronts', JSON.stringify(storefronts), '--api', 'https://api.example.test');
	execFileSync('node', args, { stdio: 'pipe' });
	if (token) {
		const text = readFileSync(out, 'utf8');
		assert.equal(text.split('const CFG = {').length, 2, 'one config literal to splice into');
		writeFileSync(out, text.replace('const CFG = {', 'const CFG = {"readToken":' + JSON.stringify({ origin: 'https://rsp.example.test', token: 'fake-read-token' }) + ','));
	}
	return import(pathToFileURL(out).href + '?' + Math.random());
}

const mixed = await emit('mixed', [{ path: '/shop', source: 'native' }, { path: '/store', source: 'provider', provider: 'stripe' }]);
const providerOnly = await emit('provider-only', [{ path: '/store', source: 'provider', provider: 'stripe' }]);
const providerToken = await emit('provider-token', [{ path: '/store', source: 'provider', provider: 'stripe' }], { token: true });
const noShop = await emit('no-shop', null);

const SHELL = '<!doctype html><html lang="en"><head><title>Donor</title></head><body><header>NAV</header><main>BODY</main><footer>FOOT</footer></body></html>';
const SHELLS = new Set(['/', '/shop/', '/store/']);

async function drive(mod, url, { binding = false, stub = false, authored = [] } = {}) {
	const rspCalls = [];
	const stubCalls = [];
	const assets = [];
	const env = {
		ASSETS: { fetch: async (req) => {
			const p = new URL(String(req.url || req)).pathname;
			assets.push(p);
			if (authored.includes(p)) return new Response('AUTHORED', { headers: { 'content-type': 'text/html' } });
			return SHELLS.has(p) ? new Response(SHELL, { headers: { 'content-type': 'text/html' } }) : new Response('nf', { status: 404 });
		} },
		...(binding ? { RSP: { fetch: async (req) => { rspCalls.push(req); return new Response('rsp-legacy-page', { status: 200, headers: { 'x-from': 'rsp' } }); } } } : {}),
	};
	const connector = { fetch: async (req) => { stubCalls.push(req); return new Response(JSON.stringify({ state: 'unknown' }), { headers: { 'content-type': 'application/json' } }); } };
	const ctx = { waitUntil() {}, ...(stub ? { props: { CONNECTOR: connector, generation: 1 } } : {}) };
	const real = globalThis.fetch;
	const globalCalls = [];
	globalThis.fetch = async (input, init) => { globalCalls.push(String(input instanceof Request ? input.url : input)); return new Response('{}', { headers: { 'content-type': 'application/json' } }); };
	try {
		const res = await mod.default.fetch(new Request(SITE + url), env, ctx);
		return { res, body: await res.text(), rspCalls, stubCalls, assets, globalCalls };
	} finally { globalThis.fetch = real; }
}

const FALLBACKS = [
	['provider-only site, order id', providerOnly, '/checkout/success?order_id=ord_1', '/store/', true],
	['provider-only site, no order id', providerOnly, '/checkout/success', '/store/', false],
	['native site, no order id', mixed, '/checkout/success', '/shop/', false],
];

for (const [name, mod, url, shell, hasKey] of FALLBACKS) {
	test(`stub tier, ${name}: composed in the shop shell, never the 503 or RSP`, async () => {
		const r = await drive(mod, url, { stub: true });
		assert.equal(r.res.status, 200);
		assert.equal(r.res.headers.get('cache-control'), 'private, no-store');
		assert.match(r.res.headers.get('content-type') || '', /text\/html/);
		assert.ok(r.assets.includes(shell), r.assets.join(','));
		assert.match(r.body, /<header>NAV<\/header>/);
		assert.match(r.body, /<footer>FOOT<\/footer>/);
		assert.doesNotMatch(r.body, /rsp_binding_missing|rsp-legacy-page/);
		assert.match(r.body, hasKey ? /Confirming your payment/ : /We can(&#39;|')t confirm this order here/);
		if (hasKey) assert.match(r.body, /\/api\/v2\/shop\/checkout\/outcome\?site=site-1&amp;ref=ord_1|\/api\/v2\/shop\/checkout\/outcome\?site=site-1&ref=ord_1/);
		assert.equal(r.stubCalls.length, 0, 'no server-side read: the page reads its outcome over /api/');
	});
}

test('token tier (no stub, no binding) composes the same fallback', async () => {
	const r = await drive(providerToken, '/checkout/success');
	assert.equal(r.res.status, 200);
	assert.match(r.body, /We can(&#39;|')t confirm this order here/);
	assert.equal(r.globalCalls.length, 0);
});

test('the binding (Pages) still forwards every fallback request verbatim', async () => {
	for (const [, mod, url] of FALLBACKS) {
		const r = await drive(mod, url, { binding: true, stub: true });
		assert.equal(r.res.headers.get('x-from'), 'rsp', url);
		assert.equal(r.body, 'rsp-legacy-page');
		assert.equal(r.rspCalls.length, 1);
		assert.equal(new URL(r.rspCalls[0].url).pathname + new URL(r.rspCalls[0].url).search, url);
		assert.equal(r.assets.length, 0);
	}
});

test('neither binding nor reader: still the binding-missing 503', async () => {
	for (const [, mod, url] of FALLBACKS) {
		const r = await drive(mod, url);
		assert.equal(r.res.status, 503, url);
		assert.deepEqual(JSON.parse(r.body), { error: 'rsp_binding_missing', binding: 'RSP' });
		assert.equal(r.assets.length, 0);
	}
});

test('stub tier, a site with no shop: the same completion page in the root shell, its way back pointing at /', async () => {
	const none = await drive(noShop, '/checkout/success', { stub: true });
	assert.equal(none.res.status, 200);
	assert.equal(none.res.headers.get('cache-control'), 'private, no-store');
	assert.deepEqual(none.assets, ['/']);
	assert.match(none.body, /<header>NAV<\/header>/);
	assert.match(none.body, /<footer>FOOT<\/footer>/);
	assert.doesNotMatch(none.body, /rsp_binding_missing|rsp-legacy-page/);
	assert.match(none.body, /We can(&#39;|')t confirm this order here/);
	assert.match(none.body, /<a class="st-runtime-action" href="\/">Back to the shop<\/a>/);
	const keyed = await drive(noShop, '/checkout/success?order_id=ord_1', { stub: true });
	assert.equal(keyed.res.status, 200);
	assert.match(keyed.body, /Confirming your payment/);
	assert.match(keyed.body, /"shopPath":"\/"/);
	assert.equal(keyed.stubCalls.length + none.stubCalls.length, 0);
	const fallback = matchCheckoutResultFallback(new Request(SITE + '/checkout/success'), [], CHECKOUT);
	assert.deepEqual(fallback, { shopPath: '', backPath: '/' });
});

test('a site with no shop and neither binding nor reader: still the binding-missing 503', async () => {
	const r = await drive(noShop, '/checkout/success?order_id=ord_1');
	assert.equal(r.res.status, 503);
	assert.deepEqual(JSON.parse(r.body), { error: 'rsp_binding_missing', binding: 'RSP' });
});

test('the native claim is untouched: an order id on a native site never reaches the fallback', async () => {
	const r = await drive(mixed, '/checkout/success?order_id=ord_1', { stub: true });
	assert.equal(r.res.status, 200);
	assert.ok(r.assets.includes('/shop/'));
	assert.match(r.body, /Confirming your payment/);
});

test('matchCheckoutResultFallback: exact path and method, native shop first, then /shop, then the first', () => {
	const req = (p, m = 'GET') => new Request(SITE + p, { method: m });
	const shops = [{ shopPath: '/a', source: 'provider' }, { shopPath: '/shop', source: 'provider' }];
	assert.equal(matchCheckoutResultFallback(req('/checkout/success'), shops, CHECKOUT).shopPath, '/shop');
	assert.equal(matchCheckoutResultFallback(req('/checkout/success'), [{ shopPath: '/a', source: 'provider' }], CHECKOUT).shopPath, '/a');
	assert.equal(matchCheckoutResultFallback(req('/checkout/success'), [...shops, { shopPath: '/n', source: 'native' }], CHECKOUT).shopPath, '/n');
	assert.equal(matchCheckoutResultFallback(req('/checkout/success', 'HEAD'), shops, CHECKOUT), null);
	assert.equal(matchCheckoutResultFallback(req('/checkout/successx'), shops, CHECKOUT), null);
	assert.equal(matchCheckoutResultFallback(req('/checkout/success'), shops, null), null);
});

// Subscribe: covered by the existing early claim, no new branch.
test('stub tier, /subscribe/success without session_id: Site-composed unknown state, not the 503', async () => {
	const r = await drive(providerOnly, '/subscribe/success', { stub: true });
	assert.doesNotMatch(r.body, /rsp_binding_missing/);
	assert.match(r.body, /data-ejecta-subscribe-state="unknown"/);
	assert.equal(r.stubCalls.length, 0, 'no locator, nothing to ask');
});

test('stub tier, /subscribe/success with a session RSP does not confirm: Site-composed, not the 503', async () => {
	const r = await drive(providerOnly, '/subscribe/success?session_id=cs_x', { stub: true });
	assert.doesNotMatch(r.body, /rsp_binding_missing/);
	assert.match(r.body, /data-ejecta-subscribe-state="unknown"/);
	assert.equal(r.stubCalls.length, 1);
});

test('stub tier, prefixed /xx/subscribe/success not confirmed: composed, or the site\'s own page, never the forward', async () => {
	const none = await drive(providerOnly, '/ja/subscribe/success?session_id=cs_x', { stub: true });
	assert.doesNotMatch(none.body, /rsp_binding_missing/);
	assert.match(none.body, /data-ejecta-subscribe-state="unknown"/);
	const own = await drive(providerOnly, '/ja/subscribe/success?session_id=cs_x', { stub: true, authored: ['/ja/subscribe/success'] });
	assert.equal(own.res.status, 200);
	assert.equal(own.body, 'AUTHORED');
});
