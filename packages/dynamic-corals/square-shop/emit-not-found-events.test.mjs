// Behavioural test of the EMITTED _worker.js's not-found sensor (shop-function-template.js,
// NOT-FOUND EVENTS): emit real workers, drive `default.fetch` with a mock ASSETS and a fake
// Analytics Engine binding that records every `writeDataPoint` call, and assert what was written
// and that the visitor's answer is untouched.
//
// 🔴 Two halves, and the second is the one that keeps sites safe: a page miss a person could fix
// writes exactly one point; everything else writes nothing; and NOTHING about the response moves —
// not with the binding, not without it, not when the binding throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { NOT_FOUND_EVENTS_BINDING } from './shop-function-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const emitter = join(here, 'emit-shop-function.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'emit-not-found-events-'));

const SITE_KEY = 'lantern-bay';
const mappingPath = join(workDir, 'fixture.markdown.json');
writeFileSync(mappingPath, JSON.stringify({ schemaVersion: 1, routes: [{ path: '/about/', asset: '/about/index.md' }] }, null, 2));

let emitted = 0;
function emit(args) {
	const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
	const run = spawnSync('node', [emitter, '--guild', 'site_g1', '--markdown-manifest', mappingPath, ...args, '--out', out],
		{ stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
	if (run.status !== 0) throw new Error('emit failed: ' + run.stderr);
	return { out, source: readFileSync(out, 'utf8'), stderr: run.stderr };
}
const withKey = emit(['--site-key', SITE_KEY]);
const noKey = emit([]);
const badKey = emit(['--site-key', 'Lantern_Bay']);
// JavaScript's `$` without the m flag matches only at the end of input, so a trailing newline is
// outside the grammar too; pinned so the next reader does not re-raise it.
const newlineKey = emit(['--site-key', 'my-site\n']);
const worker = (await import(pathToFileURL(withKey.out).href)).default;
const workerNoKey = (await import(pathToFileURL(noKey.out).href)).default;
const workerBadKey = (await import(pathToFileURL(badKey.out).href)).default;
const workerNewlineKey = (await import(pathToFileURL(newlineKey.out).href)).default;

const PRESERVED = 'public, s-maxage=604800';
const HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// ASSETS: '/gone-page/' is a preserved copy, '/live/' a page, anything else the site's own 404 page.
function envFor({ binding = 'record', throws = false } = {}) {
	const points = [];
	const env = {
		ASSETS: { fetch: async (req) => {
			const path = new URL(req.url).pathname;
			if (path === '/gone-page/') return new Response('OLD-PAGE-BODY', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': PRESERVED } });
			if (path === '/live/' || path === '/about/index.md') return new Response('LIVE', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
			return new Response('SITE-404-PAGE', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-site': '1' } });
		} }
	};
	if (binding === 'record') {
		env[NOT_FOUND_EVENTS_BINDING] = { writeDataPoint(point) { points.push(point); if (throws) throw new Error('dataset down'); } };
	}
	return { env, points };
}
function get(path, { method = 'GET', accept = HTML, ua = BROWSER_UA, referer, host = 'shop.example.com' } = {}) {
	const headers = {};
	if (accept !== null) headers.accept = accept;
	if (ua !== null) headers['user-agent'] = ua;
	if (referer) headers.referer = referer;
	return new Request('https://' + host + path, { method, headers });
}

test('the binding name is the one documented constant', () => {
	assert.equal(NOT_FOUND_EVENTS_BINDING, 'NOT_FOUND_EVENTS');
});

test('a 404 GET for an HTML page writes exactly one point with the expected index and blobs', async () => {
	const { env, points } = envFor();
	const res = await worker.fetch(get('/old/2019/05/hello-world/?utm_source=x&p=1'), env, {});
	assert.equal(res.status, 404);
	assert.deepEqual(points, [{ indexes: [SITE_KEY], blobs: ['/old/2019/05/hello-world/', 'shop.example.com', '', 'browser'] }]);
});

test('ref is "self" for a same-host referrer, "external" for any other host, never the host itself', async () => {
	const cases = [
		['https://shop.example.com/blog/?q=secret', 'self'],
		['https://www.google.com/search?q=lantern+bay', 'external'],
		['https://attacker-chosen-1234.example.net/', 'external'],
		['not a url', '']
	];
	for (const [referer, want] of cases) {
		const { env, points } = envFor();
		await worker.fetch(get('/missing/', { referer }), env, {});
		assert.equal(points.length, 1, referer);
		assert.equal(points[0].blobs[2], want, referer);
	}
});

test('ua is "crawler" for a documented crawler token or an empty User-Agent, "browser" otherwise', async () => {
	const cases = [
		['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'crawler'],
		['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36', 'crawler'],
		['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)', 'crawler'],
		[null, 'crawler'],
		[BROWSER_UA, 'browser']
	];
	for (const [ua, want] of cases) {
		const { env, points } = envFor();
		await worker.fetch(get('/missing/', { ua }), env, {});
		assert.equal(points.length, 1, String(ua));
		assert.equal(points[0].blobs[3], want, String(ua));
	}
});

test('Accept: text/html listed with q > 0 records; q=0, a bare wildcard or an unparsable q does not', async () => {
	const cases = [
		['text/html', 1],
		['text/html;q=0.5,application/json', 1],
		['application/json, TEXT/HTML;level=1;q=0.001', 1],
		[HTML, 1],
		['text/html;q=0,application/json', 0],
		['text/html; q=0.0, */*', 0],
		['application/json, text/html;q=0', 0],
		['*/*', 0],
		['text/*', 0],
		['text/html;q=abc', 0],
		['text/htmlx', 0]
	];
	for (const [accept, want] of cases) {
		const { env, points } = envFor();
		await worker.fetch(get('/missing/', { accept }), env, {});
		assert.equal(points.length, want, accept);
	}
});

test('only page-like paths record: no extension, a trailing slash, or an old page extension', async () => {
	const cases = [
		['/2019/05/slug/', 1],
		['/old/page.php', 1],
		['/index.html', 1],
		['/legacy/DEFAULT.ASPX', 1],
		['/about-us', 1],
		['/v1.2/notes/', 1],
		['/manual.pdf', 0],
		['/photo.jpg', 0],
		['/archive.zip', 0],
		['/sitemap.xml', 0],
		['/robots-old.txt', 0],
		['/.env', 0],
		['/manual%2Epdf', 0],
		['/manual%2epdf', 0],
		['/old/page%2Ephp', 1],
		['/bad%E0%A4%A.pdf', 0],
		['/bad%E0%A4%A', 1]
	];
	for (const [path, want] of cases) {
		const { env, points } = envFor();
		await worker.fetch(get(path), env, {});
		assert.equal(points.length, want, path);
		if (want) assert.equal(points[0].blobs[0], path);
	}
});

test('the path blob is cut to 512 characters', async () => {
	const { env, points } = envFor();
	const long = '/' + Array.from({ length: 700 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
	await worker.fetch(get(long), env, {});
	assert.equal(points.length, 1);
	assert.equal(points[0].blobs[0], long.slice(0, 512));
	assert.equal(points[0].blobs[0].length, 512);
});

test('a preserved copy turned into a 404 writes one point', async () => {
	const { env, points } = envFor();
	const res = await worker.fetch(get('/gone-page/'), env, {});
	assert.equal(res.status, 404);
	assert.equal(points.length, 1);
	assert.equal(points[0].blobs[0], '/gone-page/');
});

const ZERO = [
	['a 200 page', () => get('/live/'), worker, {}],
	['a HEAD miss', () => get('/missing/', { method: 'HEAD' }), worker, {}],
	['a POST miss', () => new Request('https://shop.example.com/missing/', { method: 'POST', headers: { accept: HTML }, body: 'x' }), worker, {}],
	['an image miss (Accept: image/*)', () => get('/missing.png', { accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }), worker, {}],
	['a miss with no Accept', () => get('/missing/', { accept: null }), worker, {}],
	['a miss under /_astro/', () => get('/_astro/index.abc123.css'), worker, {}],
	['a miss under /__reef/', () => get('/__reef/nothing-here'), worker, {}],
	['no --site-key', () => get('/missing/'), workerNoKey, {}],
	['a --site-key outside the grammar', () => get('/missing/'), workerBadKey, {}],
	['a --site-key with a trailing newline', () => get('/missing/'), workerNewlineKey, {}],
	['no binding', () => get('/missing/'), worker, { binding: 'none' }]
];
for (const [name, req, w, opts] of ZERO) {
	test('writes zero points: ' + name, async () => {
		const { env, points } = envFor(opts);
		await w.fetch(req(), env, {});
		assert.deepEqual(points, []);
	});
}

async function snapshot(res) {
	return { status: res.status, statusText: res.statusText, headers: [...res.headers], body: Buffer.from(await res.arrayBuffer()).toString('hex') };
}

test('a throwing writeDataPoint does not change the response', async () => {
	for (const path of ['/missing/', '/gone-page/']) {
		const throwing = envFor({ throws: true });
		const plain = envFor({ binding: 'none' });
		const a = await worker.fetch(get(path), throwing.env, {});
		assert.equal(throwing.points.length, 1, 'the write was attempted');
		assert.deepEqual(await snapshot(a), await snapshot(await worker.fetch(get(path), plain.env, {})), path);
	}
});

test('a writeDataPoint that never settles does not hold a streaming 404 back', { timeout: 5000 }, async () => {
	const chunks = ['<!doctype html>', '<title>Not found</title>', '<p>gone</p>'];
	let calls = 0;
	const env = {
		ASSETS: { fetch: async () => {
			let i = 0;
			const body = new ReadableStream({
				async pull(controller) {
					await new Promise((r) => setTimeout(r, 5));
					if (i < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[i++]));
					else controller.close();
				}
			});
			return new Response(body, { status: 404, headers: { 'content-type': 'text/html' } });
		} },
		[NOT_FOUND_EVENTS_BINDING]: { writeDataPoint() { calls++; return new Promise(() => {}); } }
	};
	const res = await worker.fetch(get('/missing/'), env, {});
	assert.equal(calls, 1, 'the write was attempted');
	assert.equal(res.status, 404);
	assert.equal(await res.text(), chunks.join(''));
});

test('response bytes and headers are identical with and without the binding, and the ASSETS response is passed on as the same object', async () => {
	for (const path of ['/missing/', '/gone-page/', '/live/', '/about/']) {
		for (const accept of [HTML, 'text/markdown', 'image/*']) {
			const bound = envFor();
			const unbound = envFor({ binding: 'none' });
			const a = await worker.fetch(get(path, { accept }), bound.env, {});
			const b = await worker.fetch(get(path, { accept }), unbound.env, {});
			assert.deepEqual(await snapshot(a), await snapshot(b), path + ' ' + accept);
		}
	}
	// A real ASSETS 404 stays the very Response ASSETS returned (no copy, no rewrap).
	let answered = null;
	const env = { ASSETS: { fetch: async () => (answered = new Response('SITE-404-PAGE', { status: 404, headers: { 'content-type': 'text/html' } })) } };
	const points = [];
	env[NOT_FOUND_EVENTS_BINDING] = { writeDataPoint: (p) => points.push(p) };
	const res = await worker.fetch(get('/missing/'), env, {});
	assert.equal(res, answered);
	assert.equal(points.length, 1);
});

test('the key is baked into the config beside siteId only when given and valid; an invalid one warns', () => {
	const cfg = (source) => JSON.parse(/const CFG = (\{.*\});/.exec(source)[1]);
	assert.equal(cfg(withKey.source).siteKey, SITE_KEY);
	assert.equal('siteKey' in cfg(noKey.source), false);
	assert.equal('siteKey' in cfg(badKey.source), false);
	assert.match(badKey.stderr, /--site-key "Lantern_Bay" is not a site key/);
	assert.equal('siteKey' in cfg(newlineKey.source), false);
	assert.match(newlineKey.stderr, /--site-key "my-site\\n" is not a site key/);
});

test('apart from the key, the worker emitted with --site-key is the worker emitted without it', () => {
	assert.equal(
		// replaceAll: the template's own header comment also carries the baked config.
		withKey.source.replaceAll(',"siteKey":"' + SITE_KEY + '"', ''),
		noKey.source
	);
});
