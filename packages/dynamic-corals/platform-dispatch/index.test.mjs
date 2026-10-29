import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	handleRequest, capabilityFetch, bypassResponse, matchesWorkerFirst,
	PUBLIC_CATALOG_PATHS, STUB_READ_PATHS, SITE_SHELL_PATH
} from './index.mjs';

const HOST = 'shop.example.com';

function harness({ mapping, rspCalls = [], dispatchCalls = [], dispatcherGet, noRsp, noDispatcher, exportsStub = true } = {}) {
	const kvCalls = [];
	const map = mapping ?? { [HOST]: { worker: 'site-a', generation: 7 } };
	const env = {
		HOST_ROUTES: { async get(k, t) { kvCalls.push([k, t]); return k in map ? map[k] : null; } }
	};
	if (!noRsp) env.RSP = { async fetch(req) { rspCalls.push(req); return new Response('rsp-body', { status: 201, headers: { 'x-from': 'rsp' } }); } };
	if (!noDispatcher) {
		env.DISPATCHER = {
			get(name, opts) {
				dispatchCalls.push({ name, opts });
				if (dispatcherGet) return dispatcherGet(name, opts);
				return { async fetch(req) { return new Response('site:' + name); } };
			}
		};
	}
	const stubs = [];
	const ctx = exportsStub ? { exports: { Connector(o) { const s = { __stub: true, props: o.props }; stubs.push(s); return s; } } } : {};
	return { env, ctx, rspCalls, dispatchCalls, kvCalls, stubs };
}

const req = (path, init = {}, host = HOST) => new Request(`https://${host}${path}`, init);

test('/api/* reaches RSP verbatim with the customer Host, Origin, method, body and headers', async () => {
	const h = harness();
	const body = '{"a":1}';
	const r = req('/api/cart/items?x=1', {
		method: 'POST', body,
		headers: { origin: `https://${HOST}`, cookie: 'sid=abc', 'content-type': 'application/json', 'x-custom': 'k' }
	});
	const res = await handleRequest(r, h.env, h.ctx);
	assert.equal(res.status, 201);
	assert.equal(h.rspCalls.length, 1);
	const seen = h.rspCalls[0];
	assert.equal(seen, r, 'the very same Request object is handed over');
	assert.equal(new URL(seen.url).host, HOST);
	assert.equal(seen.method, 'POST');
	assert.equal(seen.headers.get('origin'), `https://${HOST}`);
	assert.equal(seen.headers.get('cookie'), 'sid=abc');
	assert.equal(await seen.text(), body);
	assert.equal(seen.headers.has('x-forwarded-host'), false);
	assert.equal(h.dispatchCalls.length, 0);
});

test('X-Forwarded-Host is never set (and a client-supplied one is not rewritten)', async () => {
	const h = harness();
	await handleRequest(req('/api/x'), h.env, h.ctx);
	await handleRequest(req('/page'), h.env, h.ctx);
	assert.equal(h.rspCalls[0].headers.has('x-forwarded-host'), false);
	const r = req('/api/x', { headers: { 'x-forwarded-host': 'other.example.net' } });
	await handleRequest(r, h.env, h.ctx);
	assert.equal(h.rspCalls[1].headers.get('x-forwarded-host'), 'other.example.net');
});

test('unknown host: 404 and RSP/dispatcher untouched', async () => {
	const h = harness();
	for (const p of ['/api/anything', '/page']) {
		const res = await handleRequest(req(p, {}, 'nope.example.org'), h.env, h.ctx);
		assert.equal(res.status, 404);
	}
	assert.equal(h.rspCalls.length, 0);
	assert.equal(h.dispatchCalls.length, 0);
});

test('host lookup is case-insensitive and ignores a trailing dot', async () => {
	const h = harness();
	const res = await handleRequest(new Request('https://SHOP.Example.com./page'), h.env, h.ctx);
	assert.equal(res.status, 200);
	assert.equal(h.kvCalls[0][0], HOST);
});

test('/apix is not forwarded to RSP; it goes to the Site Worker', async () => {
	const h = harness();
	for (const p of ['/apix', '/apix/foo', '/api']) {
		const res = await handleRequest(req(p), h.env, h.ctx);
		assert.equal(await res.text(), 'site:site-a');
	}
	assert.equal(h.rspCalls.length, 0);
});

test('non-/api paths dispatch to the mapped worker with an unmodified request', async () => {
	const h = harness();
	const r = req('/membership');
	const res = await handleRequest(r, h.env, h.ctx);
	assert.equal(await res.text(), 'site:site-a');
	assert.equal(h.dispatchCalls[0].name, 'site-a');
	assert.equal(h.rspCalls.length, 0);
});

test('cf-worker rule: only GET on public catalog paths pass; everything else 403', async () => {
	const h = harness();
	const w = { 'cf-worker': 'example.com' };
	for (const p of PUBLIC_CATALOG_PATHS) {
		const res = await handleRequest(req(p + '?slug=a', { headers: w }), h.env, h.ctx);
		assert.equal(res.status, 201, p);
	}
	assert.equal(h.rspCalls.length, PUBLIC_CATALOG_PATHS.length);
	const denied = [
		['GET', '/membership'],
		['GET', '/api/cart'],
		['GET', '/api/v2/shop/catalog/other'],
		['GET', '/api/v2/storefront/native'],
		['POST', '/api/v2/shop/catalog'],
		['HEAD', '/api/v2/shop/catalog'],
		['GET', '/apix']
	];
	for (const [method, p] of denied) {
		const res = await handleRequest(req(p, { method, headers: w }), h.env, h.ctx);
		assert.equal(res.status, 403, `${method} ${p}`);
	}
	assert.equal(h.rspCalls.length, PUBLIC_CATALOG_PATHS.length);
	assert.equal(h.dispatchCalls.length, 0);
	// Without the header the same paths are not subject to the rule.
	assert.equal((await handleRequest(req('/api/cart'), h.env, h.ctx)).status, 201);
});

test('cf-worker rule: GET on the Site shell (/) reaches the Site Worker, so a server-side <html lang> read gets the page', async () => {
	const h = harness();
	const w = { 'cf-worker': 'example.com', accept: 'text/html' };
	assert.equal(SITE_SHELL_PATH, '/');
	const res = await handleRequest(req('/', { headers: w, redirect: 'manual' }), h.env, h.ctx);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), 'site:site-a');
	assert.equal(h.dispatchCalls.length, 1);
	assert.equal(h.rspCalls.length, 0);
	// Only GET on exactly the shell path: other methods and other pages stay 403.
	for (const [method, p] of [['HEAD', '/'], ['POST', '/'], ['GET', '/index.html'], ['GET', '/account']]) {
		const denied = await handleRequest(req(p, { method, headers: w }), h.env, h.ctx);
		assert.equal(denied.status, 403, `${method} ${p}`);
	}
	assert.equal(h.dispatchCalls.length, 1);
	// An unknown host stays 404 with the header too.
	assert.equal((await handleRequest(req('/', { headers: w }, 'nope.example.com'), h.env, h.ctx)).status, 404);
});

test('stub is built per request from ctx.exports and passed in props', async () => {
	const h = harness();
	await handleRequest(req('/a'), h.env, h.ctx);
	await handleRequest(req('/b'), h.env, h.ctx);
	assert.equal(h.stubs.length, 2);
	assert.notEqual(h.dispatchCalls[0].opts.props.CONNECTOR, h.dispatchCalls[1].opts.props.CONNECTOR);
	assert.deepEqual(h.stubs[0].props, { host: HOST, worker: 'site-a', generation: 7 });
	assert.equal(h.dispatchCalls[0].opts.props.generation, 7);
});

test('no ctx.exports: no stub prop, request still dispatched', async () => {
	const h = harness({ exportsStub: false });
	const res = await handleRequest(req('/a'), h.env, h.ctx);
	assert.equal(await res.text(), 'site:site-a');
	assert.equal('CONNECTOR' in h.dispatchCalls[0].opts.props, false);
});

test('user-Worker-first list: stub only for matching paths, negation wins', async () => {
	const mapping = { [HOST]: { worker: 'site-a', generation: 1, runWorkerFirst: ['/membership', '/account/*', '/*', '!/assets/*'] } };
	const h = harness({ mapping });
	await handleRequest(req('/membership'), h.env, h.ctx);
	await handleRequest(req('/assets/app.css'), h.env, h.ctx);
	assert.equal('CONNECTOR' in h.dispatchCalls[0].opts.props, true);
	assert.equal('CONNECTOR' in h.dispatchCalls[1].opts.props, false);
	assert.equal(h.dispatchCalls.length, 2, 'excluded path still reaches the worker (assets live there)');
	assert.equal(matchesWorkerFirst(['/a/*'], '/a/b'), true);
	assert.equal(matchesWorkerFirst(['/a/*'], '/ab'), false);
	assert.equal(matchesWorkerFirst(['/a.b'], '/axb'), false);
});

test('/api/ is answered by dispatch even when the worker-first list matches it', async () => {
	const mapping = { [HOST]: { worker: 'site-a', runWorkerFirst: ['/*'] } };
	const h = harness({ mapping });
	await handleRequest(req('/api/x'), h.env, h.ctx);
	assert.equal(h.rspCalls.length, 1);
	assert.equal(h.dispatchCalls.length, 0);
});

test('bypass switch serves the missing-binding 503 and touches nothing', async () => {
	for (const v of ['1', 'true', 'on', ' TRUE ']) {
		const h = harness();
		h.env.DISPATCH_BYPASS = v;
		for (const p of ['/api/x', '/page']) {
			const res = await handleRequest(req(p), h.env, h.ctx);
			assert.equal(res.status, 503);
		}
		assert.equal(h.kvCalls.length + h.rspCalls.length + h.dispatchCalls.length, 0);
	}
	const h = harness();
	h.env.DISPATCH_BYPASS = '';
	assert.equal((await handleRequest(req('/page'), h.env, h.ctx)).status, 200);
});

// The generated Worker's response is built by bindingMissingResponse() in the
// template; evaluate the template's own source so any drift fails here.
test('bypass response equals the template missing-binding response byte for byte', async () => {
	const src = readFileSync(new URL('../square-shop/shop-function-template.js', import.meta.url), 'utf8');
	const from = src.indexOf('function transportJsonResponse(');
	const endMarker = src.indexOf('function bindingMissingResponse(');
	const to = src.indexOf('\n}\n', endMarker) + 3;
	assert.ok(from > 0 && endMarker > from && to > endMarker, 'template functions located');
	const templateFn = new Function(src.slice(from, to) + '\nreturn bindingMissingResponse;')();
	// Values of site-api-transport.contract.json: bindingName, onBindingMissing.
	const transport = { bindingName: 'RSP', onBindingMissing: { status: 503, cacheControl: 'private, no-store' } };
	const expected = templateFn(transport);
	const actual = bypassResponse();
	assert.equal(actual.status, expected.status);
	assert.deepEqual([...actual.headers].sort(), [...expected.headers].sort());
	assert.equal(await actual.text(), await expected.text());
});

test('missing RSP binding on /api/ serves the same 503', async () => {
	const h = harness({ noRsp: true });
	const res = await handleRequest(req('/api/x'), h.env, h.ctx);
	assert.equal(res.status, 503);
	assert.equal(await res.text(), await bypassResponse().text());
});

test('Worker not found (at get or at fetch) gets a defined 502, not a crash', async () => {
	const atGet = harness({ dispatcherGet() { throw new Error('Worker not found.'); } });
	const r1 = await handleRequest(req('/p'), atGet.env, atGet.ctx);
	assert.equal(r1.status, 502);
	assert.deepEqual(await r1.json(), { error: 'site_worker_not_found' });
	assert.equal(r1.headers.get('cache-control'), 'private, no-store');

	const atFetch = harness({ dispatcherGet: () => ({ fetch: async () => { throw new Error('Worker not found.'); } }) });
	assert.deepEqual(await (await handleRequest(req('/p'), atFetch.env, atFetch.ctx)).json(), { error: 'site_worker_not_found' });

	const other = harness({ dispatcherGet: () => ({ fetch: async () => { throw new Error('boom'); } }) });
	const r3 = await handleRequest(req('/p'), other.env, other.ctx);
	assert.equal(r3.status, 502);
	assert.deepEqual(await r3.json(), { error: 'site_worker_error' });
});

test('malformed mapping and KV failures are answered, never forwarded', async () => {
	for (const bad of [{ worker: '' }, { worker: '../x' }, { generation: 1 }, 'str']) {
		const h = harness({ mapping: { [HOST]: bad } });
		assert.equal((await handleRequest(req('/api/x'), h.env, h.ctx)).status, 502);
		assert.equal(h.rspCalls.length + h.dispatchCalls.length, 0);
	}
	const h = harness();
	h.env.HOST_ROUTES = { get: async () => { throw new Error('kv down'); } };
	assert.equal((await handleRequest(req('/api/x'), h.env, h.ctx)).status, 503);
	delete h.env.HOST_ROUTES;
	assert.equal((await handleRequest(req('/api/x'), h.env, h.ctx)).status, 503);
	assert.equal(h.rspCalls.length, 0);
});

test('missing DISPATCHER binding: 503 (RSP untouched)', async () => {
	const h = harness({ noDispatcher: true });
	assert.equal((await handleRequest(req('/page'), h.env, h.ctx)).status, 503);
	assert.equal(h.rspCalls.length, 0);
});

test('capability stub refuses the catalog paths (rate-limited per visitor; they travel the cf-worker rule)', async () => {
	const h = harness();
	for (const p of PUBLIC_CATALOG_PATHS) {
		assert.ok(!STUB_READ_PATHS.includes(p), p);
		assert.equal((await capabilityFetch(new Request('https://x.example.net' + p), h.env, { host: HOST })).status, 403, p);
	}
	assert.equal(h.rspCalls.length, 0);
});

test('capability stub: GET allowlist only, host fixed by props, headers carried', async () => {
	const h = harness();
	const props = { host: HOST };
	const ok = new Request('https://evil.example.net/api/membership/plans?x=1', { headers: { cookie: 'sid=1' } });
	const res = await capabilityFetch(ok, h.env, props);
	assert.equal(res.status, 201);
	assert.equal(new URL(h.rspCalls[0].url).host, HOST);
	assert.equal(new URL(h.rspCalls[0].url).search, '?x=1');
	assert.equal(h.rspCalls[0].headers.get('cookie'), 'sid=1');
	for (const p of STUB_READ_PATHS) {
		assert.equal((await capabilityFetch(new Request('https://x.example.net' + p), h.env, props)).status, 201, p);
	}
	const before = h.rspCalls.length;
	for (const [m, p] of [['POST', '/api/membership/plans'], ['GET', '/api/auth/logout'], ['GET', '/api/cart'], ['GET', '/billing/x']]) {
		const init = m === 'POST' ? { method: m, body: 'x' } : {};
		assert.equal((await capabilityFetch(new Request('https://x.example.net' + p, init), h.env, props)).status, 403, p);
	}
	assert.equal(h.rspCalls.length, before);
	assert.equal((await capabilityFetch(ok, h.env, undefined)).status, 403);
});
