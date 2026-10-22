// Behavioural test of the EMITTED _worker.js's answer for a page that is GONE:
// emit a real worker, drive `default.fetch` with a mock ASSETS, and assert what a browser would see.
//
// CF Pages' asset server answers a URL a previous deployment served, and this one no longer has,
// with the preserved copy: a 200 carrying `cache-control: public, s-maxage=604800` (up to 7 days).
// The worker must not hand that on as a page. Same harness shape as emit-markdown-negotiation.test.mjs.
//
// 🔴 THE OTHER HALF IS "UNCHANGED, BYTE FOR BYTE": a live page (`max-age=0, must-revalidate`, or any
// other cache-control, or none) and a real ASSETS 404 reach the visitor as the very same Response.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const emitter = join(here, 'emit-shop-function.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'emit-gone-page-guard-'));

const BINDING = 'SEAMLINK';
const CONTRACT = {
	schemaVersion: 2,
	bindingName: BINDING,
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 599, cacheControl: 'private, no-store, fixture-marker' },
	forward: [{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] }]
};
const contractPath = join(workDir, 'fixture.contract.json');
writeFileSync(contractPath, JSON.stringify(CONTRACT, null, 2));
const gatedPath = join(workDir, 'fixture.verdict.json');
writeFileSync(gatedPath, JSON.stringify({ schemaVersion: 1, paths: ['/members/secret/'] }, null, 2));
const mappingPath = join(workDir, 'fixture.markdown.json');
writeFileSync(mappingPath, JSON.stringify({ schemaVersion: 1, routes: [{ path: '/about/', asset: '/about/index.md' }] }, null, 2));

const out = join(workDir, 'worker.mjs');
execFileSync('node', [emitter, '--guild', 'site_g1', '--api-contract', contractPath, '--gated-manifest', gatedPath, '--markdown-manifest', mappingPath, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
const worker = (await import(pathToFileURL(out).href)).default;

const PRESERVED = 'public, s-maxage=604800';
// ASSETS answers every path with the given cache-control (undefined = none) and body; a real miss is `miss`.
function envFor({ cacheControl, status = 200, body = 'OLD-PAGE-BODY' }) {
	const headers = { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'x-existing': '1' };
	if (cacheControl !== undefined) headers['cache-control'] = cacheControl;
	const answered = [];
	const env = {
		ASSETS: { fetch: async () => { const r = new Response(body, { status, headers }); answered.push(r); return r; } },
		[BINDING]: { fetch: async () => new Response(JSON.stringify({ allow: true }), { status: 200, headers: { 'content-type': 'application/json' } }) }
	};
	return { env, answered };
}
const get = (path, init) => new Request('https://shop.example.com' + path, init);

// ── a preserved copy is a gone page ──────────────────────────────────────────────────────────────

for (const path of ['/shop/', '/some-page/', '/some-page']) {
	test('a preserved copy at ' + path + ' is answered as 404 no-store, not the old page', async () => {
		const { env } = envFor({ cacheControl: PRESERVED });
		const res = await worker.fetch(get(path), env, {});
		assert.equal(res.status, 404);
		assert.equal(res.headers.get('cache-control'), 'no-store');
		const body = await res.text();
		assert.ok(!body.includes('OLD-PAGE-BODY'), 'the preserved body must not reach the visitor');
		assert.equal(res.headers.get('x-existing'), null, 'no header of the preserved copy travels with the 404');
	});
}

test('a preserved copy asked with HEAD is a 404 with no body', async () => {
	const { env } = envFor({ cacheControl: PRESERVED });
	const res = await worker.fetch(get('/some-page/', { method: 'HEAD' }), env, {});
	assert.equal(res.status, 404);
	assert.equal(res.headers.get('cache-control'), 'no-store');
	assert.equal(await res.text(), '');
});

test('the branches that also serve an ASSETS body apply the same answer: a mapped markdown route, a verdict-allowed path', async () => {
	for (const path of ['/about/', '/members/secret/']) {
		const { env } = envFor({ cacheControl: PRESERVED });
		const res = await worker.fetch(get(path), env, {});
		assert.equal(res.status, 404, path);
		assert.equal(res.headers.get('cache-control'), 'no-store', path);
		assert.ok(!(await res.text()).includes('OLD-PAGE-BODY'), path);
	}
});

// ── everything else is the very same response ───────────────────────────────────────────────────

for (const cacheControl of ['public, max-age=0, must-revalidate', 'public, max-age=60', 'public, s-maxage=604800, max-age=60', 'public, s-maxage=60', undefined]) {
	test('a live page with cache-control ' + JSON.stringify(cacheControl) + ' passes through unchanged', async () => {
		const { env, answered } = envFor({ cacheControl });
		const res = await worker.fetch(get('/some-page/'), env, {});
		assert.equal(res, answered[0], 'the same Response object, not a copy');
		assert.equal(res.status, 200);
		assert.equal(res.headers.get('cache-control'), cacheControl === undefined ? null : cacheControl);
		assert.equal(await res.text(), 'OLD-PAGE-BODY');
	});
}

test('the preserved marker on a non-200 is not touched', async () => {
	const { env, answered } = envFor({ cacheControl: PRESERVED, status: 304, body: null });
	const res = await worker.fetch(get('/some-page/'), env, {});
	assert.equal(res, answered[0]);
	assert.equal(res.status, 304);
});

test('a real ASSETS 404 reaches the visitor unchanged', async () => {
	const { env, answered } = envFor({ cacheControl: 'no-store', status: 404, body: 'SITE-404-PAGE' });
	const res = await worker.fetch(get('/some-page/'), env, {});
	assert.equal(res, answered[0]);
	assert.equal(res.status, 404);
	assert.equal(await res.text(), 'SITE-404-PAGE');
});
