// Differential proof that today's Pages path behaves exactly as it did at tile fa57bab, the base the
// three-tier platform read was built on. The SAME fixture Site is emitted twice — by the frozen
// fa57bab emitter + template (frozen under fixtures/pages-identity-base-fa57bab/, see its README) and
// by the current ones — with today's inputs: the RSP binding present, no ctx.props stub, no readToken.
// Both are driven with one request set through one mock binding and one mock ASSETS, and every
// response must match in status, headers and body.
//
// There are NO intentional differences: provider catalog reads stay the own-host fetch (which on
// Pages re-enters the worker and is forwarded to the binding), exactly as at fa57bab, so the served
// page, the global fetches and the binding calls are all identical for every case.
//
// A missing fixture file is a FAILURE, never a skip: this proof must run wherever the suite runs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = 'fa57bab';
const here = path.dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'pages-behaviour-identity-'));
const FROZEN = ['packages/dynamic-corals/square-shop/emit-shop-function.mjs', 'packages/dynamic-corals/square-shop/product-page-core.js',
	'packages/dynamic-corals/square-shop/shop-function-template.js', 'packages/sitetile/query-redirects.mjs'];
const baseRoot = path.join(here, 'fixtures', `pages-identity-base-${BASE}`);
const missing = FROZEN.filter((rel) => !existsSync(path.join(baseRoot, rel)));
if (missing.length) throw new Error(`frozen ${BASE} fixture missing: ${missing.join(', ')}`);

const SITE = 'https://site.example.test';
const contract = path.join(temp, 'contract.json');
writeFileSync(contract, JSON.stringify({
	bindingName: 'RSP',
	forward: [
		{ match: 'prefix', value: '/api/', methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'] },
		{ match: 'exact', value: '/membership', methods: ['GET'] },
	],
	siteOwnedBuyerPages: [{ path: '/membership', method: 'GET', kind: 'membership', factsPath: '/api/membership/plans' }],
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));
const gated = path.join(temp, 'gated.json');
writeFileSync(gated, JSON.stringify({ paths: ['/post/private'] }));
const markdown = path.join(temp, 'markdown.json');
writeFileSync(markdown, JSON.stringify({ schemaVersion: 1, routes: [{ path: '/about', asset: '/about.md' }] }));

function emit(root, name) {
	const out = path.join(temp, name + '.mjs');
	execFileSync('node', [path.join(root, 'packages/dynamic-corals/square-shop/emit-shop-function.mjs'),
		'--api-contract', contract, '--gated-manifest', gated, '--markdown-manifest', markdown,
		'--site-id', 'site-1', '--guild', 'g1', '--name', 'Fixture',
		'--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }, { path: '/store', source: 'provider', provider: 'stripe' }]),
		'--api', 'https://api.example.test', '--platform-origin', 'https://platform.example',
		'--emitter-commit', 'fixed', '--out', out], { stdio: 'pipe' });
	return out;
}

const SHELL = '<!doctype html><html lang="en"><head><title>Donor</title></head><body><header>NAV</header><main>BODY</main><footer>FOOT</footer></body></html>';
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
const ITEM = { variation_id: 'V1', slug: 'tee', name: 'Tee', title: 'Tee', display_price: 5, currency: 'USD', variants: [{ id: 'V1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5, available: true }] };
const NATIVE_ITEM = { slug: 'tee', copy: { name: 'Native Tee', description_html: '<p>Copy</p>', image_ref: '/tee.jpg', media: [{ url: '/tee.jpg' }], requires_shipping: true },
	commerce: { sku: 'tee-sku', product_id: 'p1', variant_id: 'v1', currency: 'USD', unit_price: 1900, tracked: true, available: 2, reserved: 0, status: 'IN_STOCK' } };

// RSP as the binding sees it. Deterministic, and it answers by path the way the real routes do.
function rspAnswer(req) {
	const u = new URL(req.url);
	const member = (req.headers.get('cookie') || '').includes('member=1');
	switch (u.pathname) {
		case '/seam/site-verdict-v2': return json({ path: u.searchParams.get('path'), allow: member, reason: member ? 'member' : 'members_only' });
		case '/api/membership/plans': return json({ state: 'available', plans: [{ plan_id: 'p1', display_name: 'Friends', price_minor: 500, currency: 'USD', interval: 'month' }] });
		case '/api/v2/storefront/native': return u.searchParams.get('slug')
			? json({ ok: true, source: 'native', item: NATIVE_ITEM }) : json({ ok: true, source: 'native', items: [NATIVE_ITEM] });
		case '/api/v2/shop/catalog/item': return json({ item: ITEM });
		case '/api/v2/shop/catalog': return json({ connected: true, processor: 'stripe', items: [ITEM] });
		case '/api/cart': return json({ ok: true, method: req.method }, 201, { 'set-cookie': 'cart=1; Path=/; HttpOnly' });
		default: return json({ error: 'not_found' }, 404);
	}
}

async function drive(file, url, init, { binding = true } = {}) {
	const mod = await import(pathToFileURL(file).href + '?' + Math.random());
	const bindingCalls = [];
	const globalCalls = [];
	const RSP = { fetch: async (req) => { bindingCalls.push(new URL(req.url).pathname); return rspAnswer(req); } };
	const env = {
		ASSETS: { fetch: async (req) => {
			const u = new URL(req.url || req);
			const accept = (req.headers && req.headers.get && req.headers.get('accept')) || '';
			if (u.pathname === '/about.md') return new Response('# About\n', { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
			if (u.pathname.endsWith('/') || u.pathname === '/post/private' || u.pathname === '/about') return new Response(SHELL, { headers: { 'content-type': 'text/html; charset=utf-8', etag: '"s1"' } });
			return new Response('STATIC:' + u.pathname + ':' + accept, { headers: { 'content-type': 'text/plain' } });
		} },
		...(binding ? { RSP } : {}),
	};
	const real = globalThis.fetch;
	// A global fetch to the Site's own host is, on Pages, a fresh request into this same worker,
	// which forwards /api/* to the binding — so that is what it is here. Anything else is the apiBase.
	globalThis.fetch = async (input, i) => {
		const req = input instanceof Request ? input : new Request(input, i);
		const u = new URL(req.url);
		globalCalls.push(u.href);
		if (u.origin === SITE) return binding ? RSP.fetch(req) : json({ error: 'rsp_binding_missing', binding: 'RSP' }, 503, { 'cache-control': 'private, no-store' });
		return rspAnswer(req);
	};
	try {
		const res = await mod.default.fetch(new Request(SITE + url, init), env, { waitUntil() {} });
		const headers = [...res.headers].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()).toString('base64'), bindingCalls, globalCalls };
	} finally { globalThis.fetch = real; }
}

const CASES = [
	['native catalog page', '/shop'],
	['native product page', '/shop/tee'],
	['provider catalog page', '/store'],
	['provider product page', '/store/tee'],
	['/membership', '/membership', { headers: { cookie: 'sess=a' } }],
	['verdict-gated path, member', '/post/private', { headers: { cookie: 'member=1', accept: 'text/html' } }],
	['verdict-gated path, refused (html)', '/post/private', { headers: { accept: 'text/html' } }],
	['verdict-gated path, refused (json)', '/post/private'],
	['markdown route', '/about', { headers: { accept: 'text/markdown' } }],
	['markdown route, html', '/about', { headers: { accept: 'text/html' } }],
	['/api/* forward', '/api/cart', { method: 'POST', body: '{"sku":"x"}', headers: { cookie: 'sess=a', 'content-type': 'application/json' } }],
	['/apix is not forwarded', '/apix/cart'],
	['static page', '/faq'],
];
const MISSING = [
	['missing binding: /api/* forward', '/api/cart', { method: 'POST', body: 'x' }],
	['missing binding: /membership', '/membership'],
	['missing binding: verdict-gated path', '/post/private', { headers: { accept: 'text/html' } }],
	['missing binding: native catalog page', '/shop'],
];

const baseFile = emit(baseRoot, 'base');
const newFile = emit(path.resolve(here, '../../..'), 'new');

for (const [name, url, init, opts] of [...CASES.map(([n, u, i]) => [n, u, i, {}]), ...MISSING.map(([n, u, i]) => [n, u, i, { binding: false }])]) {
	test(`Pages behaviour identical to ${BASE}: ${name}`, async (t) => {
		const before = await drive(baseFile, url, init, opts);
		const after = await drive(newFile, url, init, opts);
		t.diagnostic(`status=${after.status} body=${Buffer.from(after.body, 'base64').length}B binding=${after.bindingCalls.join(',') || '-'} global=${after.globalCalls.join(',') || '-'}`);
		assert.equal(after.status, before.status, 'status');
		assert.deepEqual(after.headers, before.headers, 'headers');
		assert.equal(after.body, before.body, 'body');
		assert.deepEqual(after.globalCalls, before.globalCalls, 'the same global fetches, catalog reads included');
		assert.deepEqual(after.bindingCalls, before.bindingCalls, 'the same binding calls');
	});
}
