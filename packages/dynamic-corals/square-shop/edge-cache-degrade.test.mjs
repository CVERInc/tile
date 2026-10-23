// caches.default degrades to a MISS in the emitted _worker.js (shop-function-template.js#edgeCache*):
// absent, a lookup that throws (synchronously or as a rejection — a Workers-for-Platforms namespace
// answers "not permitted"), or a put that throws never changes what the visitor is served, and a
// lookup that threw is never followed by a put. A working cache keeps its hit/put behaviour (CONTROL).
// Covers every caches.default use in the template: provider product page, provider grid, YouTube poster.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(path.join(os.tmpdir(), 'edge-cache-degrade-'));
const out = path.join(temp, 'worker.mjs');
execFileSync('node', [path.join(here, 'emit-shop-function.mjs'),
	'--guild', 'g1', '--name', 'Fixture',
	'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'stripe' }]),
	'--api', 'https://api.example.test', '--out', out], { stdio: 'pipe' });
const mod = await import(pathToFileURL(out).href);

const SITE = 'https://site.example.test';
const SHELL = '<!doctype html><html><head><title>Shop</title></head><body><main>' +
	'<div data-dynamic-coral="square-shop" data-guild-id="g1" data-cart="1" data-detail-base="/shop"></div></main></body></html>';
const ITEM = { processor: 'stripe', id: 'I', slug: 'tee', title: 'Tee', description: 'A tee.', images: [],
	variants: [{ id: 'v1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5, available: true }] };
const json = (b) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function upstream(u) {
	if (u.includes('i.ytimg.com')) return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
	if (u.includes('/api/v2/shop/catalog/item')) return json({ item: ITEM });
	if (u.includes('/api/v2/shop/catalog')) return json({ connected: true, processor: 'stripe', items: [{ variation_id: 'V1', name: 'Tee', display_price: 5, currency: 'USD', variants: [{ id: 'V1', display_price: 5 }] }] });
	return new Response('no', { status: 404 });
}

const env = { ASSETS: { fetch: async (req) => {
	const u = String(req.url || req);
	return u.endsWith('/shop/') ? new Response(SHELL, { headers: { 'content-type': 'text/html' } }) : new Response('STATIC:' + u);
} } };

// cacheMode: 'absent' | 'match-throws' | 'match-rejects' | 'put-throws' | 'put-rejects' | 'works' | 'getter-throws'
async function serve(url, cacheMode) {
	const record = { match: 0, put: 0, waited: [] };
	const store = new Map();
	const cache = {
		match(key) {
			record.match++;
			if (cacheMode === 'match-throws') throw new Error('not permitted');
			if (cacheMode === 'match-rejects') return Promise.reject(new Error('not permitted'));
			return Promise.resolve(store.get(key.url));
		},
		put(key, res) {
			record.put++;
			if (cacheMode === 'put-throws') throw new Error('not permitted');
			if (cacheMode === 'put-rejects') return Promise.reject(new Error('not permitted'));
			store.set(key.url, res);
			return Promise.resolve();
		}
	};
	const realFetch = globalThis.fetch;
	const hadCaches = 'caches' in globalThis;
	const realCaches = globalThis.caches;
	globalThis.fetch = async (u) => upstream(String(u && u.url ? u.url : u));
	if (cacheMode === 'absent') delete globalThis.caches;
	else if (cacheMode === 'getter-throws') Object.defineProperty(globalThis, 'caches', { configurable: true, get() { return { get default() { throw new Error('not permitted'); } }; } });
	else Object.defineProperty(globalThis, 'caches', { configurable: true, writable: true, value: { default: cache } });
	const ctx = { waitUntil: (p) => record.waited.push(p) };
	try {
		const res = await mod.default.fetch(new Request(SITE + url), env, ctx);
		const body = new Uint8Array(await res.arrayBuffer());
		await Promise.all(record.waited);   // a rejected put must not surface here either
		const again = cacheMode === 'works' ? await mod.default.fetch(new Request(SITE + url), env, ctx) : null;
		return { res, body, record, again };
	} finally {
		globalThis.fetch = realFetch;
		if (hadCaches) Object.defineProperty(globalThis, 'caches', { configurable: true, writable: true, value: realCaches });
		else delete globalThis.caches;
	}
}

const PAGES = [
	['provider product page', '/shop/tee', (r) => r.res.status === 200 && new TextDecoder().decode(r.body).includes('Tee')],
	['provider grid', '/shop', (r) => r.res.status === 200 && new TextDecoder().decode(r.body).includes('Tee')],
	['YouTube poster', '/_yt/K9j8H7g6F5d.jpg', (r) => r.res.status === 200 && r.body.length === JPEG.length],
];

for (const [name, url, served] of PAGES) {
	test(`${name}: no caches global → served, a miss`, async () => {
		const r = await serve(url, 'absent');
		assert.ok(served(r), r.res.status);
	});
	test(`${name}: caches.default getter throws → served, nothing cached`, async () => {
		const r = await serve(url, 'getter-throws');
		assert.ok(served(r), r.res.status);
	});
	for (const mode of ['match-throws', 'match-rejects']) {
		test(`${name}: cache.match ${mode} → served as a miss, and no put follows`, async () => {
			const r = await serve(url, mode);
			assert.ok(served(r), r.res.status);
			assert.equal(r.record.match, 1);
			assert.equal(r.record.put, 0);
		});
	}
	for (const mode of ['put-throws', 'put-rejects']) {
		test(`${name}: cache.put ${mode} → the response is still served`, async () => {
			const r = await serve(url, mode);
			assert.ok(served(r), r.res.status);
			assert.equal(r.record.put, 1);
		});
	}
	test(`CONTROL · ${name}: a working cache is asked, filled, and answers the next request`, async () => {
		const r = await serve(url, 'works');
		assert.ok(served(r), r.res.status);
		assert.equal(r.record.put, 1);
		assert.equal(r.record.match, 2);
		assert.equal(r.again.status, 200);
	});
}
