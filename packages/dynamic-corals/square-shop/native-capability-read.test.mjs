// The native catalog read prefers a Site's RSP_CAPABILITY binding over env.RSP
// (shop-function-template.js#fetchNativeProjection). Only that read moves: browser /api/*
// forwards, buyer-page facts and the private-path verdict keep env.RSP, and the stub tier
// ignores the capability binding entirely.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLATFORM_CAPABILITY_READ_BINDING } from './shop-function-template.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-capability-read-'));
const SITE = 'https://site.example.test';

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
const out = path.join(temp, 'worker.mjs');
execFileSync('node', [emitter, '--api-contract', contract, '--site-id', 'site-1', '--name', 'Fixture',
	'--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]),
	'--api', 'https://api.example.test', '--out', out], { stdio: 'pipe' });
const mod = await import(pathToFileURL(out).href + '?' + Math.random());

const SHELL = '<!doctype html><html lang="en"><head><title>Donor</title></head><body><header>NAV</header><main>BODY</main></body></html>';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NATIVE_OK = () => json({ ok: true, source: 'native', items: [] });
function answer(url) {
	const u = new URL(url);
	if (u.pathname === '/seam/site-verdict-v2') return json({ path: u.searchParams.get('path'), allow: true, reason: 'member' });
	if (u.pathname === '/api/membership/plans') return json({ plans: [] });
	if (u.pathname === '/api/v2/storefront/native') return NATIVE_OK();
	return json({ error: 'unexpected' }, 500);
}
function spy(respond = (req) => answer(req.url)) {
	const calls = [];
	return { calls, fetch: async (req) => { calls.push(req); return respond(req); } };
}

async function drive(url, { rsp = spy(), cap = null, stub = null, method = 'GET' } = {}) {
	const env = {
		ASSETS: { fetch: async () => new Response(SHELL, { headers: { 'content-type': 'text/html' } }) },
		RSP: rsp,
		...(cap ? { RSP_CAPABILITY: cap } : {}),
	};
	const ctx = { waitUntil() {}, ...(stub ? { props: { CONNECTOR: stub, generation: 1 } } : {}) };
	const res = await mod.default.fetch(new Request(SITE + url, { method }), env, ctx);
	return { res, body: await res.text(), rsp: rsp.calls, cap: cap ? cap.calls : [] };
}
const paths = (calls) => calls.map((q) => new URL(q.url).pathname);

test('the capability binding name is pinned', () => {
	assert.equal(PLATFORM_CAPABILITY_READ_BINDING, 'RSP_CAPABILITY');
});

test('capability present: the native read goes to RSP_CAPABILITY and not env.RSP', async () => {
	const r = await drive('/shop', { cap: spy() });
	assert.deepEqual(paths(r.cap), ['/api/v2/storefront/native']);
	assert.equal(new URL(r.cap[0].url).host, 'site.example.test');
	assert.equal(new URL(r.cap[0].url).searchParams.get('site_id'), 'site-1');
	assert.equal(r.rsp.length, 0);
});

test('capability throws: exactly one retry on env.RSP', async () => {
	const cap = spy(() => { throw new Error('capability down'); });
	const r = await drive('/shop', { cap });
	assert.equal(r.cap.length, 1);
	assert.deepEqual(paths(r.rsp), ['/api/v2/storefront/native']);
	assert.equal(r.res.status, 200);
});

test('capability throws and env.RSP throws: unavailable, one call each', async () => {
	const cap = spy(() => { throw new Error('capability down'); });
	const rsp = spy(() => { throw new Error('rsp down'); });
	const r = await drive('/shop', { cap, rsp });
	assert.equal(r.cap.length, 1);
	assert.equal(r.rsp.length, 1);
	assert.notEqual(r.res.status, 200);
});

test('capability answers non-ok: used as-is, no retry', async () => {
	const cap = spy(() => json({ error: 'rate_limited' }, 429));
	const r = await drive('/shop', { cap });
	assert.equal(r.cap.length, 1);
	assert.equal(r.rsp.length, 0, 'a returned response is never retried');
	assert.notEqual(r.res.status, 200);
});

test('capability absent: env.RSP serves the native read as before', async () => {
	const r = await drive('/shop');
	assert.deepEqual(paths(r.rsp), ['/api/v2/storefront/native']);
	assert.equal(r.res.status, 200);
});

test('browser /api/* forward never touches RSP_CAPABILITY', async () => {
	const r = await drive('/api/membership/plans', { cap: spy() });
	assert.equal(r.cap.length, 0);
	assert.deepEqual(paths(r.rsp), ['/api/membership/plans']);
});

test('buyer-page facts never touch RSP_CAPABILITY', async () => {
	const facts = await drive('/membership', { cap: spy() });
	assert.equal(facts.cap.length, 0);
	assert.deepEqual(paths(facts.rsp), ['/api/membership/plans']);
});

test('stub tier: RSP_CAPABILITY is ignored when env.RSP is absent from the selection', async () => {
	// Tier 1 (env.RSP) is absent here, so the stub is the selected reader.
	const stub = spy();
	const cap = spy();
	const env = {
		ASSETS: { fetch: async () => new Response(SHELL, { headers: { 'content-type': 'text/html' } }) },
		RSP_CAPABILITY: cap,
	};
	const res = await mod.default.fetch(new Request(SITE + '/shop'), env, { waitUntil() {}, props: { CONNECTOR: stub, generation: 1 } });
	assert.equal(res.status, 200);
	assert.deepEqual(paths(stub.calls), ['/api/v2/storefront/native']);
	assert.equal(cap.calls.length, 0);
});
