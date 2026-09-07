// Behavioural test of the EMITTED _worker.js's PUBLIC MARKDOWN NEGOTIATION: emit a
// real worker from a real markdown manifest, load it, and drive `default.fetch`
// with a mock ASSETS and a mock RSP binding. Same harness shape as
// emit-api-transport.test.mjs — the routing matrix is asserted about behaviour,
// never about source text.
//
// 🔴 THE ORDER IS THE POINT. A markdown Accept header must not become a second way
// to reach a gated path, and it must not change anything for a route the build did
// not map. Both are asserted here against the SAME worker, because a negotiation
// that only behaves on its own fixtures proves nothing about the dispatch it was
// inserted into.
//
// 🔴 The mock serves the markdown twin as `text/plain` and puts `x-existing: 1` on
// every asset, so "the worker sets text/markdown" and "the worker kept the asset's
// own headers" are both falsifiable rather than incidentally true.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const emitter = join(here, 'emit-shop-function.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'emit-markdown-negotiation-'));

// The transport fixture deliberately disagrees with the real contract (see
// emit-api-transport.test.mjs); this one only has to be a valid contract so the
// verdict branch exists and can be shown to still run first.
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

const GATED_PATH = '/devlog/secret/';
const gatedPath = join(workDir, 'fixture.verdict.json');
writeFileSync(gatedPath, JSON.stringify({ schemaVersion: 1, paths: [GATED_PATH] }, null, 2));

// Exactly what the renderer writes (dist/reef-agent-markdown.json): canonical
// trailing-slash routes, `/` included, public routes only.
const MAPPING = {
	schemaVersion: 1,
	routes: [
		{ path: '/', asset: '/index.md' },
		{ path: '/about/', asset: '/about/index.md' }
	]
};
const mappingPath = join(workDir, 'fixture.markdown.json');
writeFileSync(mappingPath, JSON.stringify(MAPPING, null, 2));

let emitted = 0;
function emitFile(args) {
	const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
	execFileSync('node', [emitter, ...args, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
	return out;
}
async function emitWorker(args) {
	const out = emitFile(args);
	return { path: out, mod: await import(pathToFileURL(out).href) };
}
// The emitter's stderr on a refusal, so the message itself can be asserted.
function emitStderr(args) {
	try {
		execFileSync('node', [emitter, ...args, '--out', join(workDir, 'never.mjs')],
			{ stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
	} catch (e) {
		return String(e.stderr || '');
	}
	return null;
}

const BASE_ARGS = ['--guild', 'site_g1', '--api-contract', contractPath, '--gated-manifest', gatedPath];
const worker = await emitWorker([...BASE_ARGS, '--markdown-manifest', mappingPath]);
// The same site with no mapping at all: every assertion below that says "exactly
// as before" is measured against THIS worker, not against a memory of one.
const noMapping = await emitWorker(BASE_ARGS);

// ── harness ──────────────────────────────────────────────────────────────────
// The asset server has exactly the files this build wrote: two markdown twins and
// the pages. A guessed twin (`/devlog/secret/index.md`) is 404 because nothing
// generated it.
const MD_ASSETS = new Set(['/index.md', '/about/index.md']);
function makeEnv({ rsp = null } = {}) {
	const seenByAssets = [];
	const seenByRsp = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				const url = new URL(req.url);
				seenByAssets.push({ method: req.method, path: url.pathname, accept: req.headers.get('accept') || '' });
				if (url.pathname.endsWith('.md')) {
					if (!MD_ASSETS.has(url.pathname)) return new Response('NOT FOUND', { status: 404 });
					return new Response('MD:' + url.pathname, {
						status: 200,
						headers: { 'content-type': 'text/plain; charset=utf-8', 'x-existing': '1' }
					});
				}
				return new Response('HTML:' + url.pathname, {
					status: 200,
					headers: { 'content-type': 'text/html; charset=utf-8', 'x-existing': '1' }
				});
			}
		}
	};
	if (rsp) {
		env[BINDING] = {
			fetch: async (req) => {
				const url = new URL(req.url);
				seenByRsp.push({ method: req.method, path: url.pathname, query: url.searchParams.get('path') });
				return rsp(url);
			}
		};
	}
	return { env, seenByAssets, seenByRsp };
}
const verdictRsp = (allow) => (url) => {
	assert.equal(url.pathname, '/seam/site-verdict-v2');
	return new Response(JSON.stringify({ path: url.searchParams.get('path'), allow, reason: allow ? 'members_ok' : 'members_only' }),
		{ status: 200, headers: { 'content-type': 'application/json' } });
};

const MD = 'text/markdown';
const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const get = (path, accept, init) => new Request('https://s.example' + path,
	{ ...(init || {}), headers: accept ? { accept } : {} });
const varyList = (res) => (res.headers.get('vary') || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);

// ── the markdown variant ─────────────────────────────────────────────────────

test('a mapped route with Accept: text/markdown serves the markdown twin the build wrote', async () => {
	const { env, seenByAssets } = makeEnv();
	const res = await worker.mod.default.fetch(get('/about/', MD), env);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), 'MD:/about/index.md');
	assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
	assert.equal(varyList(res).includes('accept'), true);
	assert.deepEqual(seenByAssets.map((a) => a.path), ['/about/index.md']);
});

test('the twin is reached by either spelling of the route, and by the home route', async () => {
	for (const [path, asset] of [['/about', '/about/index.md'], ['/about/', '/about/index.md'], ['/', '/index.md']]) {
		const { env, seenByAssets } = makeEnv();
		const res = await worker.mod.default.fetch(get(path, MD), env);
		assert.equal(await res.text(), 'MD:' + asset, path + ' must resolve to ' + asset);
		assert.deepEqual(seenByAssets.map((a) => a.path), [asset], path);
	}
});

test('headers the asset server set survive onto the markdown variant', async () => {
	const { env } = makeEnv();
	const res = await worker.mod.default.fetch(get('/about/', MD), env);
	assert.equal(res.headers.get('x-existing'), '1');
});

test('HEAD negotiates: markdown status and headers, no body', async () => {
	const { env, seenByAssets } = makeEnv();
	const res = await worker.mod.default.fetch(get('/about/', MD, { method: 'HEAD' }), env);
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
	assert.equal(varyList(res).includes('accept'), true);
	assert.equal(await res.text(), '');
	assert.deepEqual(seenByAssets.map((a) => a.method + ' ' + a.path), ['HEAD /about/index.md']);
});

// ── the HTML side of the same URL ────────────────────────────────────────────

test('a browser Accept keeps the HTML page, and both variants carry Vary: Accept', async () => {
	const { env, seenByAssets } = makeEnv();
	const res = await worker.mod.default.fetch(get('/about/', BROWSER), env);
	assert.equal(await res.text(), 'HTML:/about/');
	assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
	assert.equal(res.headers.get('x-existing'), '1');
	assert.equal(varyList(res).includes('accept'), true, 'the HTML variant is the one a shared cache stores first');
	assert.deepEqual(seenByAssets.map((a) => a.path), ['/about/'], 'ASSETS gets the ORIGINAL request');
});

test('a wildcard Accept is not a request for markdown', async () => {
	for (const accept of ['*/*', 'text/*', 'text/html', '', 'text/markdown;q=0']) {
		const { env, seenByAssets } = makeEnv();
		const res = await worker.mod.default.fetch(get('/about/', accept), env);
		assert.equal(await res.text(), 'HTML:/about/', JSON.stringify(accept) + ' must not select markdown');
		assert.deepEqual(seenByAssets.map((a) => a.path), ['/about/'], JSON.stringify(accept));
	}
});

test('a weighted markdown Accept still selects markdown', async () => {
	const { env } = makeEnv();
	const res = await worker.mod.default.fetch(get('/about/', 'text/html;q=0.2, text/markdown;q=0.9'), env);
	assert.equal(await res.text(), 'MD:/about/index.md');
});

// ── everything this branch does not own ──────────────────────────────────────

test('Vary control: present on a mapped route, absent on an unmapped one', async () => {
	const mapped = makeEnv();
	const mappedRes = await worker.mod.default.fetch(get('/about/', BROWSER), mapped.env);
	assert.equal(varyList(mappedRes).includes('accept'), true);

	const unmapped = makeEnv();
	const unmappedRes = await worker.mod.default.fetch(get('/nope/', MD), unmapped.env);
	assert.equal(unmappedRes.headers.get('vary'), null, 'an unmapped route must be answered exactly as before');
	assert.equal(await unmappedRes.text(), 'HTML:/nope/');
	assert.deepEqual(unmapped.seenByAssets.map((a) => a.path), ['/nope/']);
});

test('a method other than GET/HEAD is never rewritten and never gains Vary', async () => {
	const { env, seenByAssets } = makeEnv();
	const res = await worker.mod.default.fetch(get('/about/', MD, { method: 'POST' }), env);
	assert.equal(await res.text(), 'HTML:/about/');
	assert.equal(res.headers.get('vary'), null);
	assert.deepEqual(seenByAssets.map((a) => a.method + ' ' + a.path), ['POST /about/']);
});

test('a mapped route whose twin the asset server does not serve falls straight through', async () => {
	// The mapping names a twin this build did not write — the page must still be
	// served, not 404'd, and the fall-through must be the plain existing one.
	const brokenMapping = join(workDir, 'broken.markdown.json');
	writeFileSync(brokenMapping, JSON.stringify({ schemaVersion: 1, routes: [{ path: '/about/', asset: '/about/missing.md' }] }));
	const broken = await emitWorker([...BASE_ARGS, '--markdown-manifest', brokenMapping]);
	const { env, seenByAssets } = makeEnv();
	const res = await broken.mod.default.fetch(get('/about/', MD), env);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), 'HTML:/about/');
	assert.equal(res.headers.get('vary'), null);
	assert.deepEqual(seenByAssets.map((a) => a.path), ['/about/missing.md', '/about/']);
});

// ── the gate is still the gate ───────────────────────────────────────────────

test('a gated path with a markdown Accept is judged by RSP, exactly as without it', async () => {
	for (const accept of [MD, null]) {
		const allow = makeEnv({ rsp: verdictRsp(true) });
		const allowed = await worker.mod.default.fetch(get(GATED_PATH, accept), allow.env);
		assert.equal(await allowed.text(), 'HTML:' + GATED_PATH, 'allow serves the site own bytes');
		assert.equal(allow.seenByRsp.length, 1, 'the verdict endpoint was asked');
		assert.equal(allow.seenByRsp[0].query, '/devlog/secret');
		assert.equal(allowed.headers.get('vary'), null, 'the gated response is not a negotiated variant');
		assert.equal(allow.seenByAssets.some((a) => a.path.endsWith('.md')), false, 'no markdown twin is ever fetched for a gated path');

		const deny = makeEnv({ rsp: verdictRsp(false) });
		const denied = await worker.mod.default.fetch(get(GATED_PATH, accept), deny.env);
		assert.equal(denied.status, 404);
		assert.deepEqual(await denied.json(), { error: 'blocked' });
		assert.deepEqual(deny.seenByAssets, [], 'a refusal fetches nothing');
	}
});

test('a guessed private markdown path is not rewritten anywhere, and does not exist', async () => {
	const { env, seenByAssets } = makeEnv({ rsp: verdictRsp(true) });
	const res = await worker.mod.default.fetch(get('/devlog/secret/index.md', MD), env);
	assert.equal(res.status, 404);
	assert.deepEqual(seenByAssets.map((a) => a.path), ['/devlog/secret/index.md'], 'it reaches ASSETS as itself');
});

// ── the flagless build ───────────────────────────────────────────────────────

test('without --markdown-manifest the worker has no markdown config and no new behaviour', async () => {
	assert.equal(/"markdown":/.test(readFileSync(noMapping.path, 'utf8')), false);
	const { env, seenByAssets } = makeEnv();
	const res = await noMapping.mod.default.fetch(get('/about/', MD), env);
	assert.equal(await res.text(), 'HTML:/about/');
	assert.equal(res.headers.get('vary'), null);
	assert.deepEqual(seenByAssets.map((a) => a.path), ['/about/']);
});

test('an empty routes array bakes nothing', async () => {
	const emptyMapping = join(workDir, 'empty.markdown.json');
	writeFileSync(emptyMapping, JSON.stringify({ schemaVersion: 1, routes: [] }));
	const out = emitFile([...BASE_ARGS, '--markdown-manifest', emptyMapping]);
	assert.equal(/"markdown":/.test(readFileSync(out, 'utf8')), false);
});

// ── emitter refusal ──────────────────────────────────────────────────────────

test('a markdown route that is also gated is fatal, and the message names the path', async () => {
	const collide = join(workDir, 'collide.markdown.json');
	writeFileSync(collide, JSON.stringify({
		schemaVersion: 1,
		routes: [{ path: '/about/', asset: '/about/index.md' }, { path: GATED_PATH, asset: '/devlog/secret/index.md' }]
	}));
	const stderr = emitStderr([...BASE_ARGS, '--markdown-manifest', collide]);
	assert.notEqual(stderr, null, 'a gated path in the markdown map must refuse');
	assert.equal(stderr.includes('/devlog/secret'), true, stderr);

	// the spelling must not matter: the two sets are compared normalized
	const collideNoSlash = join(workDir, 'collide-no-slash.markdown.json');
	writeFileSync(collideNoSlash, JSON.stringify({ schemaVersion: 1, routes: [{ path: '/devlog/secret', asset: '/devlog/secret/index.md' }] }));
	assert.throws(() => emitFile([...BASE_ARGS, '--markdown-manifest', collideNoSlash]));
});

test('a malformed markdown manifest is fatal, never silently unmapped', async () => {
	const cases = [
		['not json', 'not json at all'],
		['not an object', JSON.stringify(['/about/'])],
		['no schemaVersion', JSON.stringify({ routes: [] })],
		['wrong schemaVersion', JSON.stringify({ schemaVersion: 2, routes: [] })],
		['no routes array', JSON.stringify({ schemaVersion: 1 })],
		['entry not an object', JSON.stringify({ schemaVersion: 1, routes: ['/about/'] })],
		['relative path', JSON.stringify({ schemaVersion: 1, routes: [{ path: 'about/', asset: '/about/index.md' }] })],
		['network-path reference', JSON.stringify({ schemaVersion: 1, routes: [{ path: '//evil.example/about/', asset: '/about/index.md' }] })],
		['relative asset', JSON.stringify({ schemaVersion: 1, routes: [{ path: '/about/', asset: 'about/index.md' }] })],
		['missing asset', JSON.stringify({ schemaVersion: 1, routes: [{ path: '/about/' }] })],
		['two assets for one route', JSON.stringify({ schemaVersion: 1, routes: [{ path: '/about/', asset: '/about/index.md' }, { path: '/about', asset: '/other.md' }] })]
	];
	for (const [name, body] of cases) {
		const bad = join(workDir, 'bad-' + name.replace(/\W+/g, '-') + '.json');
		writeFileSync(bad, body);
		assert.throws(() => emitFile([...BASE_ARGS, '--markdown-manifest', bad]), undefined, name + ' must refuse');
	}
	assert.throws(() => emitFile([...BASE_ARGS, '--markdown-manifest', join(workDir, 'no-such-file.json')]),
		undefined, 'a missing manifest must refuse');
});

test('the flag name is greppable in the emitter, which is how the build detects it', async () => {
	// build-deploy-sitetile.sh decides whether the staged emitter can consume the
	// mapping with `grep -qF -- '--markdown-manifest' "$EMITTER"`, exactly as it
	// already does for --gated-manifest. A rename that skipped this file would make
	// the build silently emit a worker with no negotiation.
	assert.equal(readFileSync(emitter, 'utf8').includes('--markdown-manifest'), true);
	const stderr = emitStderr([...BASE_ARGS, '--markdown-manifest', join(workDir, 'no-such-file.json')]);
	assert.equal(String(stderr).includes('--markdown-manifest'), true, stderr);
});
