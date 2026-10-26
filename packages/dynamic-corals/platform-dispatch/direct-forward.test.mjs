// The transport contract's rsp "direct" paths outside /api/ (seam scripts and styles, the
// checkout-unavailable page, the billing returns, the uploaded-asset proxy). A Site Worker under
// Workers for Platforms has no RSP binding, so the dispatch Worker answers them with the same
// verbatim forward it gives /api/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	handleRequest, bypassResponse, isDirectForward,
	DIRECT_FORWARD_RULES, DIRECT_FORWARD_METHODS, STUB_READ_PATHS
} from './index.mjs';

const HOST = 'shop.example.com';

function harness({ mapping, noRsp } = {}) {
	const rspCalls = [];
	const dispatchCalls = [];
	const kvCalls = [];
	const map = mapping ?? { [HOST]: { worker: 'site-a', generation: 7 } };
	const env = {
		HOST_ROUTES: { async get(k, t) { kvCalls.push([k, t]); return k in map ? map[k] : null; } },
		DISPATCHER: {
			get(name, opts) {
				dispatchCalls.push({ name, opts });
				return { async fetch() { return new Response('site:' + name); } };
			}
		}
	};
	if (!noRsp) env.RSP = { async fetch(r) { rspCalls.push(r); return new Response('rsp-body', { status: 200, headers: { 'x-from': 'rsp' } }); } };
	const ctx = { exports: { Connector(o) { return { __stub: true, props: o.props }; } } };
	return { env, ctx, rspCalls, dispatchCalls, kvCalls };
}

const req = (path, init = {}, host = HOST) => new Request(`https://${host}${path}`, init);
const samplePath = (rule) => (rule.match === 'prefix' ? rule.value + 'g1/a1' : rule.value);

test('the direct set is the contract vocabulary: exact or prefix rules, GET and HEAD', () => {
	assert.deepEqual([...DIRECT_FORWARD_METHODS], ['GET', 'HEAD']);
	assert.ok(DIRECT_FORWARD_RULES.length > 0);
	for (const rule of DIRECT_FORWARD_RULES) {
		assert.ok(rule.match === 'exact' || rule.match === 'prefix', JSON.stringify(rule));
		assert.ok(rule.value.startsWith('/') && !rule.value.startsWith('/api/'), rule.value);
		if (rule.match === 'prefix') assert.ok(rule.value.endsWith('/'), rule.value);
	}
});

test('every direct path, GET and HEAD, reaches RSP verbatim and never enters the Site Worker', async () => {
	for (const rule of DIRECT_FORWARD_RULES) {
		for (const method of DIRECT_FORWARD_METHODS) {
			const h = harness();
			const r = req(samplePath(rule) + '?v=1', { method, headers: { cookie: 'sid=abc', origin: `https://${HOST}` } });
			const res = await handleRequest(r, h.env, h.ctx);
			assert.equal(res.headers.get('x-from'), 'rsp', `${method} ${rule.value}`);
			assert.equal(h.rspCalls.length, 1);
			assert.equal(h.rspCalls[0], r, 'the very same Request object is handed over');
			assert.equal(new URL(h.rspCalls[0].url).host, HOST);
			assert.equal(new URL(h.rspCalls[0].url).search, '?v=1');
			assert.equal(h.rspCalls[0].headers.get('cookie'), 'sid=abc');
			assert.equal(h.rspCalls[0].headers.has('x-forwarded-host'), false);
			assert.equal(h.dispatchCalls.length, 0);
		}
	}
});

// The island script the generated Site Worker injects into its composed buyer pages, read from the
// template source so the two cannot drift. The verdict path is a server-side read (stub), not a
// browser path, and stays out of the direct set.
test('every /seam/ path the generated Site Worker references is either a direct forward or a stub read', async () => {
	const src = readFileSync(new URL('../square-shop/shop-function-template.js', import.meta.url), 'utf8');
	const seams = [...new Set([...src.matchAll(/["'`](\/seam\/[A-Za-z0-9._-]+)/g)].map((m) => m[1]))];
	assert.ok(seams.includes('/seam/island.js'), 'template injects the island script');
	for (const p of seams) {
		if (STUB_READ_PATHS.includes(p)) {
			assert.equal(isDirectForward('GET', p), false, p);
			continue;
		}
		assert.equal(isDirectForward('GET', p), true, p);
		const h = harness();
		await handleRequest(req(p), h.env, h.ctx);
		assert.equal(h.rspCalls.length, 1, p);
		assert.equal(h.dispatchCalls.length, 0, p);
	}
});

test('other methods on a direct path go to the Site Worker, as on Pages', async () => {
	for (const rule of DIRECT_FORWARD_RULES) {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
			const h = harness();
			const init = ['POST', 'PUT', 'PATCH'].includes(method) ? { method, body: 'x' } : { method };
			const res = await handleRequest(req(samplePath(rule), init), h.env, h.ctx);
			assert.equal(await res.text(), 'site:site-a', `${method} ${rule.value}`);
			assert.equal(h.rspCalls.length, 0);
		}
	}
});

test('near misses and the Site-composed pages go to the Site Worker', async () => {
	const paths = [
		'/seam/island.jsx', '/seam/island.js/', '/seam/other.js', '/seam/site-verdict-v2', '/seam/', '/seam',
		'/asset', '/assetx/a/b', '/billing', '/billing/successx', '/billing/success/',
		'/membership', '/account', '/checkout/success', '/subscribe/success', '/'
	];
	for (const p of paths) {
		const h = harness();
		const res = await handleRequest(req(p), h.env, h.ctx);
		assert.equal(await res.text(), 'site:site-a', p);
		assert.equal(h.rspCalls.length, 0, p);
	}
});

test('direct paths keep the /api/ order: unknown host 404, cf-worker 403, missing RSP the bypass 503', async () => {
	for (const rule of DIRECT_FORWARD_RULES) {
		const p = samplePath(rule);
		const unknown = harness();
		assert.equal((await handleRequest(req(p, {}, 'nope.example.org'), unknown.env, unknown.ctx)).status, 404, p);
		assert.equal(unknown.rspCalls.length + unknown.dispatchCalls.length, 0);

		const worker = harness();
		assert.equal((await handleRequest(req(p, { headers: { 'cf-worker': 'example.com' } }), worker.env, worker.ctx)).status, 403, p);
		assert.equal(worker.rspCalls.length + worker.dispatchCalls.length + worker.kvCalls.length, 0);

		const noRsp = harness({ noRsp: true });
		const res = await handleRequest(req(p), noRsp.env, noRsp.ctx);
		const expected = bypassResponse();
		assert.equal(res.status, expected.status, p);
		assert.equal(res.headers.get('cache-control'), expected.headers.get('cache-control'));
		assert.equal(await res.text(), await expected.text());
		assert.equal(noRsp.dispatchCalls.length, 0);
	}
});

test('a direct path is answered by dispatch even when the worker-first list matches it', async () => {
	const h = harness({ mapping: { [HOST]: { worker: 'site-a', runWorkerFirst: ['/*', '/seam/*'] } } });
	await handleRequest(req('/seam/island.js'), h.env, h.ctx);
	assert.equal(h.rspCalls.length, 1);
	assert.equal(h.dispatchCalls.length, 0);
});
