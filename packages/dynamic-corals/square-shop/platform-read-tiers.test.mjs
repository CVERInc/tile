// The three-tier platform read in the EMITTED _worker.js (shop-function-template.js#platformReader):
// RSP service binding → request-scoped capability stub in ctx.props.CONNECTOR → baked per-Site
// read token. Each test drives a real emitted worker and spies on all three tiers at once, so
// "the selected tier was used" and "the others were untouched" are asserted together.
//
// The emitter never bakes `readToken` (nothing issues one), so the token arm splices it into the
// emitted config text — the shape the template reads: readToken: { origin, token }.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { platformReader } from './shop-function-template.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'platform-read-tiers-'));
const SITE = 'https://site.example.test';
const SITE_HOST = 'site.example.test';
const API_BASE = 'https://api.example.test';
const TOKEN_ORIGIN = 'https://rsp.example.test';
const TOKEN = 'fake-read-token';

const contract = path.join(temp, 'contract.json');
writeFileSync(contract, JSON.stringify({
	bindingName: 'RSP',
	forward: [
		{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: '/membership', methods: ['GET'] },
	],
	siteOwnedBuyerPages: [{ path: '/membership', method: 'GET', kind: 'membership', factsPath: '/api/membership/plans' }],
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));
const gated = path.join(temp, 'gated.json');
writeFileSync(gated, JSON.stringify({ paths: ['/post/private'] }));

function emit(name, { token = false } = {}) {
	const out = path.join(temp, name + '.mjs');
	execFileSync('node', [emitter, '--api-contract', contract, '--gated-manifest', gated,
		'--site-id', 'site-1', '--name', 'Fixture',
		'--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }, { path: '/store', source: 'provider', provider: 'stripe' }]),
		'--api', API_BASE, '--out', out], { stdio: 'pipe' });
	if (token) {
		const text = readFileSync(out, 'utf8');
		assert.equal(text.split('const CFG = {').length, 2, 'one config literal to splice into');
		writeFileSync(out, text.replace('const CFG = {',
			'const CFG = {"readToken":' + JSON.stringify({ origin: TOKEN_ORIGIN, token: TOKEN }) + ','));
	}
	return import(pathToFileURL(out).href + '?' + Math.random());
}

const plain = await emit('plain');
const tokened = await emit('tokened', { token: true });

const SHELL = '<!doctype html><html lang="en"><head><title>Donor</title></head><body><header>NAV</header><main>BODY</main></body></html>';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// A platform answer good enough for every read route the fixture exercises.
function answer(url) {
	const u = new URL(url);
	if (u.pathname === '/seam/site-verdict-v2') return json({ path: u.searchParams.get('path'), allow: true, reason: 'member' });
	if (u.pathname === '/api/membership/plans') return json({ plans: [] });
	if (u.pathname === '/api/v2/storefront/native') return json({ ok: true, source: 'native', items: [] });
	if (u.pathname === '/api/v2/shop/catalog/item') return json({ item: { slug: 'tee', name: 'Tee', display_price: 5, currency: 'USD' } });
	if (u.pathname === '/api/v2/shop/catalog') return json({ items: [] });
	return json({ error: 'unexpected' }, 500);
}

function spy(respond = answer) {
	const calls = [];
	return { calls, fetch: async (req) => { calls.push(req); return respond(req.url, req); } };
}

// All three tiers, each spied. `binding`/`stub` false → absent. Global fetch is the token tier
// AND the apiBase fallback; both are recorded by URL.
async function drive(mod, url, { binding = false, stub = false, props, init } = {}) {
	const rsp = spy();
	const connector = spy();
	const globalCalls = [];
	const assetCalls = [];
	const env = {
		ASSETS: { fetch: async (req) => { assetCalls.push(String(req.url || req)); return new Response(SHELL, { headers: { 'content-type': 'text/html' } }); } },
		...(binding ? { RSP: rsp } : {}),
	};
	const ctx = { waitUntil() {}, ...(props ? { props } : stub ? { props: { CONNECTOR: connector, generation: 1 } } : {}) };
	const real = globalThis.fetch;
	globalThis.fetch = async (input, i) => {
		const req = input instanceof Request ? input : new Request(input, i);
		globalCalls.push(req);
		return answer(req.url);
	};
	try {
		const res = await mod.default.fetch(new Request(SITE + url, init), env, ctx);
		return { res, body: await res.text(), rsp: rsp.calls, connector: connector.calls, global: globalCalls, assets: assetCalls };
	} finally { globalThis.fetch = real; }
}

const READ_PATHS = [
	['/membership', '/api/membership/plans'],
	['/post/private', '/seam/site-verdict-v2'],
	['/shop', '/api/v2/storefront/native'],
	['/shop/tee', '/api/v2/storefront/native'],
];

for (const [page, read] of READ_PATHS) {
	test(`binding tier: ${page} reads ${read} through env.RSP; stub and token untouched`, async () => {
		const r = await drive(tokened, page, { binding: true, stub: true });
		assert.equal(r.rsp.length, 1);
		assert.equal(new URL(r.rsp[0].url).pathname, read);
		assert.equal(new URL(r.rsp[0].url).host, SITE_HOST, 'the binding read keeps the site host');
		assert.equal(r.connector.length, 0, 'stub untouched');
		assert.equal(r.global.length, 0, 'no global fetch: no token read, no own-host read, no apiBase');
	});

	test(`stub tier: ${page} reads ${read} through ctx.props.CONNECTOR; token untouched`, async () => {
		const r = await drive(tokened, page, { stub: true });
		assert.equal(r.connector.length, 1);
		assert.equal(new URL(r.connector[0].url).pathname, read);
		assert.equal(r.connector[0].method, 'GET');
		assert.equal(r.global.length, 0, 'no token read and no own-host read');
		assert.notEqual(r.res.status, 503);
	});

	test(`token tier: ${page} reads ${read} from the token origin; the token rides only on token routes`, async () => {
		const r = await drive(tokened, page);
		const tokenCalls = r.global.filter((q) => new URL(q.url).origin === TOKEN_ORIGIN);
		assert.equal(tokenCalls.length, 1);
		assert.equal(new URL(tokenCalls[0].url).pathname, read);
		assert.equal(tokenCalls[0].headers.get('x-site-read-token'), TOKEN, 'a token route carries the Site token');
		if (read === '/api/v2/storefront/native') assert.equal(new URL(tokenCalls[0].url).searchParams.get('site_id'), 'site-1');
		assert.equal(tokenCalls[0].method, 'GET');
		assert.ok(r.global.every((q) => new URL(q.url).host !== SITE_HOST), 'never the worker\'s own host');
		assert.ok(r.global.every((q) => new URL(q.url).origin !== API_BASE), 'a selected tier is not followed by the apiBase');
	});
}

test('no tier: buyer page, verdict path and native pages answer honest non-200 errors, never a shell', async () => {
	for (const page of ['/membership', '/post/private', '/shop', '/shop/tee']) {
		const r = await drive(plain, page);
		assert.equal(r.res.status, 503, page);
		if (page === '/membership' || page === '/post/private') assert.match(r.res.headers.get('cache-control'), /no-store/, page);
		assert.equal(r.global.length, 0, page + ': nothing was fetched');
	}
	const verdict = await drive(plain, '/post/private');
	assert.ok(!verdict.assets.some((u) => u.endsWith('/post/private')), 'the gated file is never served');
});

// The catalog routes are rate-limited per visitor, so no server-side tier may carry them (the
// serving-topology owner excludes such routes: a server-side hop has no visitor address). On every
// tier the read is the fa57bab own-host fetch and never goes through the binding, stub or token.
test('catalog reads are the own-host fetch on every tier and never use the binding, stub or token', async () => {
	const cases = [[plain, {}], [plain, { binding: true }], [plain, { stub: true }], [tokened, { binding: true }], [tokened, { stub: true }], [tokened, {}]];
	for (const [mod, opts] of cases) {
		for (const [page, read] of [['/store', '/api/v2/shop/catalog'], ['/store/tee', '/api/v2/shop/catalog/item']]) {
			const r = await drive(mod, page, opts);
			const tag = JSON.stringify(opts) + page;
			assert.equal(r.rsp.length, 0, tag + ': binding untouched');
			assert.equal(r.connector.length, 0, tag + ': stub untouched');
			assert.ok(r.global.every((q) => new URL(q.url).origin !== TOKEN_ORIGIN), tag + ': token origin untouched');
			assert.ok(r.global.every((q) => q.headers.get('x-site-read-token') === null), tag + ': no token header');
			assert.equal(r.global.length, 1, tag);
			assert.equal(new URL(r.global[0].url).host, SITE_HOST, tag + ': the own host');
			assert.equal(new URL(r.global[0].url).pathname, read, tag);
		}
	}
});

test('no fallthrough: a selected stub that fails is the read failing; the token is not tried', async () => {
	const failing = { fetch: async () => json({ error: 'boom' }, 500) };
	for (const page of ['/membership', '/post/private', '/shop']) {
		const r = await drive(tokened, page, { props: { CONNECTOR: failing } });
		assert.notEqual(r.res.status, 200, page);
		assert.equal(r.global.length, 0, page + ': token tier untouched');
	}
	const throwing = { fetch: async () => { throw new Error('cross-request I/O'); } };
	const r = await drive(tokened, '/membership', { props: { CONNECTOR: throwing } });
	assert.equal(r.res.status, 502);
	assert.equal(r.global.length, 0);
});

test('browser-facing /api/* keeps the binding forward verbatim and never rides the stub or token', async () => {
	const viaBinding = await drive(tokened, '/api/cart', { binding: true, stub: true, init: { method: 'POST', body: 'x', headers: { cookie: 's=1' } } });
	assert.equal(viaBinding.rsp.length, 1);
	assert.equal(viaBinding.rsp[0].method, 'POST');
	assert.equal(viaBinding.rsp[0].headers.get('cookie'), 's=1');
	assert.equal(viaBinding.connector.length, 0);
	for (const opts of [{ stub: true }, {}]) {
		const r = await drive(tokened, '/api/cart', opts);
		assert.equal(r.res.status, 503, JSON.stringify(opts));
		assert.equal(JSON.parse(r.body).error, 'rsp_binding_missing');
		assert.equal(r.connector.length, 0);
		assert.equal(r.global.length, 0);
	}
});

test('/apix is not /api/: no forward, no read, no honest failure — the static site answers', async () => {
	for (const opts of [{ binding: true, stub: true }, { stub: true }, {}]) {
		const r = await drive(tokened, '/apix/membership/plans', opts);
		assert.equal(r.res.status, 200, JSON.stringify(opts));
		assert.equal(r.rsp.length + r.connector.length + r.global.length, 0, JSON.stringify(opts));
		assert.deepEqual(r.assets, [SITE + '/apix/membership/plans']);
	}
});

test('the stub is request-scoped: each request uses only its own ctx.props, nothing is remembered', async () => {
	const first = spy();
	const second = spy();
	await drive(plain, '/membership', { props: { CONNECTOR: first } });
	const r2 = await drive(plain, '/membership', { props: { CONNECTOR: second } });
	assert.equal(first.calls.length, 1);
	assert.equal(second.calls.length, 1);
	const r3 = await drive(plain, '/membership');
	assert.equal(r3.res.status, 503, 'a later request without props has no stub');
	assert.equal(first.calls.length + second.calls.length, 2);
	assert.equal(r2.res.status !== 503, true);
});

test('binding tier read is the same Request today\'s worker sends: GET, site URL, the visitor\'s own headers', async () => {
	const r = await drive(plain, '/membership', { binding: true, init: { headers: { cookie: 'sess=abc', accept: 'text/html' } } });
	assert.equal(r.rsp.length, 1);
	assert.equal(r.rsp[0].url, SITE + '/api/membership/plans');
	assert.equal(r.rsp[0].method, 'GET');
	assert.equal(r.rsp[0].headers.get('cookie'), 'sess=abc');
});

test('token tier drops the site host, replaces a visitor-sent token header, and keeps the visitor cookie', async () => {
	const r = await drive(tokened, '/membership', { init: { headers: { 'x-site-read-token': 'forged', cookie: 'sess=abc' } } });
	const call = r.global.find((q) => new URL(q.url).origin === TOKEN_ORIGIN);
	assert.equal(call.headers.get('x-site-read-token'), TOKEN);
	assert.equal(call.headers.get('cookie'), 'sess=abc');
	assert.equal(call.headers.get('host'), null);
	const catalog = await drive(tokened, '/store', { init: { headers: { 'x-site-read-token': 'forged', cookie: 'sess=abc' } } });
	const cat = catalog.global.find((q) => new URL(q.url).pathname === '/api/v2/shop/catalog');
	assert.equal(new URL(cat.url).host, SITE_HOST, 'the catalog read is the own-host fetch, not a token-origin read');
	assert.equal(cat.headers.get('x-site-read-token'), null, 'a forged token never rides a catalog read either');
	assert.equal(cat.headers.get('cookie'), null, 'catalog reads are public and never carried the visitor\'s headers, on any tier');
});

test('platformReader order, in isolation', () => {
	const cfg = { apiTransport: { bindingName: 'RSP' } };
	const binding = { fetch() {} };
	const stub = { fetch() {} };
	assert.equal(platformReader({ RSP: binding }, { props: { CONNECTOR: stub } }, { ...cfg, readToken: { origin: TOKEN_ORIGIN, token: TOKEN } }), binding);
	assert.equal(platformReader({}, { props: { CONNECTOR: stub } }, { ...cfg, readToken: { origin: TOKEN_ORIGIN, token: TOKEN } }), stub);
	const t = platformReader({}, {}, { ...cfg, readToken: { origin: TOKEN_ORIGIN, token: TOKEN } });
	assert.equal(typeof t.fetch, 'function');
	assert.notEqual(t, stub);
	assert.equal(platformReader({}, {}, cfg), null);
	assert.equal(platformReader({}, undefined, cfg), null, 'no ctx at all (Pages tests, old callers)');
	assert.equal(platformReader({}, { props: { CONNECTOR: {} } }, cfg), null, 'a props entry without fetch is not a stub');
	assert.equal(platformReader({}, { props: { CONNECTOR: stub } }, {}), null, 'no contract → no binding name → no stub tier');
	assert.equal(platformReader({}, {}, { ...cfg, readToken: { origin: TOKEN_ORIGIN } }), null, 'a token needs both fields');
});
