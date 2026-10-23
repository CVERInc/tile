// The emitter's split output (--split-out) and the byte identity of `_worker.js`.
//
// 🔴 GOLDEN. The expected `_worker.js` is not a file checked in beside this test and not the output
// of the code under test: it is produced, at test time, by the FROZEN pre-split emitter
// (fixtures/emit-shop-function.reference.mjs — CVERInc/tile 97f7595, see its header) run over the
// SAME current core/template/query-redirects sources. So it stays meaningful while the template
// itself changes, and it fails the moment the split emitter writes one byte differently from the
// unsplit one for identical inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { assembleWorkerFromSiteConfig, SITE_CONFIG_KIND } from './worker-assembly.mjs';
import { pagesRoutesInvokeWorker, runWorkerFirstInvokesWorker, probePaths } from './route-table.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'worker-split-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');

// The reference emitter resolves its sources relative to itself, so it runs from a mirror of the
// package layout holding the CURRENT shared sources.
const mirror = join(workDir, 'mirror');
mkdirSync(join(mirror, 'packages', 'dynamic-corals', 'square-shop'), { recursive: true });
mkdirSync(join(mirror, 'packages', 'sitetile'), { recursive: true });
const mirrorShop = join(mirror, 'packages', 'dynamic-corals', 'square-shop');
copyFileSync(join(here, 'fixtures', 'emit-shop-function.reference.mjs'), join(mirrorShop, 'emit-shop-function.mjs'));
copyFileSync(join(here, 'product-page-core.js'), join(mirrorShop, 'product-page-core.js'));
copyFileSync(join(here, 'shop-function-template.js'), join(mirrorShop, 'shop-function-template.js'));
copyFileSync(join(here, '..', '..', 'sitetile', 'query-redirects.mjs'), join(mirror, 'packages', 'sitetile', 'query-redirects.mjs'));
const REFERENCE = join(mirrorShop, 'emit-shop-function.mjs');
const CURRENT = join(here, 'emit-shop-function.mjs');

// ── fixture Site: every input the emitter reads, so every baked branch is exercised ──
const fx = join(workDir, 'fixture');
mkdirSync(fx);
const CONTRACT = join(fx, 'contract.json');
writeFileSync(CONTRACT, JSON.stringify({
	schemaVersion: 2,
	bindingName: 'SEAMLINK',
	checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
	siteOwnedBuyerPages: [
		{ path: '/membership', method: 'GET', kind: 'membership', factsPath: '/api/membership/plans' },
		{ path: '/account', method: 'GET', kind: 'account', factsPath: '/api/account/surface' }
	],
	subscribeResult: { path: '/subscribe/success', method: 'GET', sessionParam: 'session_id', factsPath: '/api/subscribe/result' },
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 599, cacheControl: 'private, no-store, fixture-marker' },
	forward: [
		{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: '/billing/portal', methods: ['GET'] }
	]
}, null, 2));
const GATED = join(fx, 'gated.json');
writeFileSync(GATED, JSON.stringify({ schemaVersion: 1, paths: ['/blog/private-post', '/vault/post-1/'] }));
const MARKDOWN = join(fx, 'markdown.json');
writeFileSync(MARKDOWN, JSON.stringify({ schemaVersion: 1, routes: [
	{ path: '/', asset: '/index.md' }, { path: '/about/', asset: '/about.md' }, { path: '/shop', asset: '/shop.md' }
] }));
const QR = join(fx, '_query-redirects.md');
writeFileSync(QR, '/product.php?cid=12        /products/widget     301\n/?p=123                    /blog/hello          301\n');
const STOREFRONTS = JSON.stringify([{ path: '/shop', source: 'native' }, { path: '/fr/shop', source: 'provider', provider: 'stripe' }]);
const SHOPS = JSON.stringify([{ shopPath: '/fr/shop', locale: 'fr', labels: { buy: 'Acheter' } }]);

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const FULL = ['--site-id', 'site_fixture', '--guild', 'g1', '--name', 'Fixture $& Site', '--shops', SHOPS,
	'--storefronts', STOREFRONTS, '--api', 'https://api.example', '--api-contract', CONTRACT,
	'--gated-manifest', GATED, '--markdown-manifest', MARKDOWN, '--query-redirects', QR,
	'--platform-origin', 'https://platform.example', '--canonical-host', 'shop.example.com',
	'--dynamic-coral-css', 'layered', '--emitter-commit', COMMIT];
// Today's runner call for a shopless Site: contract + platform origin + commit, nothing else.
const MINIMAL = ['--api-contract', CONTRACT, '--platform-origin', 'https://platform.example', '--emitter-commit', COMMIT];
const BARE = ['--platform-origin', 'https://platform.example', '--emitter-commit', COMMIT];

let n = 0;
function run(emitter, args, env = {}) {
	const dist = join(workDir, 'dist-' + (++n));
	const r = spawnSync('node', [emitter, ...args, '--out', join(dist, '_worker.js')],
		{ encoding: 'utf8', env: { ...process.env, INBOX_FORWARD_SITE_KEY: '', ...env } });
	return { ...r, dist, worker: r.status === 0 ? readFileSync(join(dist, '_worker.js'), 'utf8') : null };
}
function ok(emitter, args, env) {
	const r = run(emitter, args, env);
	assert.equal(r.status, 0, 'emitter failed: ' + r.stderr);
	return r;
}

test('golden: _worker.js is byte-identical to the pre-split emitter for identical inputs', () => {
	for (const [name, args] of [['full', FULL], ['minimal', MINIMAL], ['bare', BARE]]) {
		const golden = ok(REFERENCE, args).worker;
		const now = ok(CURRENT, args).worker;
		assert.equal(sha(now), sha(golden), name + ': _worker.js bytes moved');
		assert.equal(now, golden);
	}
	// With a (fake) inbox key baked, too — it is part of the config the split carries.
	const env = { INBOX_FORWARD_SITE_KEY: 'test-only-not-a-secret' };
	assert.equal(ok(CURRENT, FULL, env).worker, ok(REFERENCE, FULL, env).worker);
	// stdout mode (no --out) as well.
	const stdout = (emitter) => execFileSync('node', [emitter, ...FULL], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, INBOX_FORWARD_SITE_KEY: '' } });
	assert.equal(stdout(CURRENT), stdout(REFERENCE));
});

test('golden holds with --split-out too, and the default call writes nothing but _worker.js', () => {
	const golden = ok(REFERENCE, FULL).worker;
	const split = join(workDir, 'split-golden');
	const r = ok(CURRENT, [...FULL, '--split-out', split]);
	assert.equal(r.worker, golden, '--split-out changed _worker.js');
	assert.deepEqual(readdirSync(r.dist), ['_worker.js'], '--split-out wrote into the Pages upload directory');
	const flagless = ok(CURRENT, FULL);
	assert.deepEqual(readdirSync(flagless.dist), ['_worker.js'], 'a default call must not write _routes.json or anything else');
});

test('split output: shared sources unchanged, config module reassembles the exact _worker.js', () => {
	const split = join(workDir, 'split-a');
	const r = ok(CURRENT, [...FULL, '--split-out', split], { INBOX_FORWARD_SITE_KEY: 'test-only-not-a-secret' });
	assert.deepEqual(readdirSync(split).sort(), ['_routes.json', 'run-worker-first.json', 'shared', 'site-config.json']);
	const shared = {
		core: readFileSync(join(split, 'shared', 'product-page-core.js'), 'utf8'),
		template: readFileSync(join(split, 'shared', 'shop-function-template.js'), 'utf8'),
		queryRedirectsRuntime: readFileSync(join(split, 'shared', 'query-redirects.mjs'), 'utf8')
	};
	assert.equal(shared.core, readFileSync(join(here, 'product-page-core.js'), 'utf8'));
	assert.equal(shared.template, readFileSync(join(here, 'shop-function-template.js'), 'utf8'));
	assert.equal(shared.queryRedirectsRuntime, readFileSync(join(here, '..', '..', 'sitetile', 'query-redirects.mjs'), 'utf8'));

	const mod = JSON.parse(readFileSync(join(split, 'site-config.json'), 'utf8'));
	assert.equal(mod.kind, SITE_CONFIG_KIND);
	assert.equal(mod.schemaVersion, 1);
	assert.equal(assembleWorkerFromSiteConfig(mod, shared), r.worker);
	assert.equal(mod.workerDigest, sha(r.worker));
	assert.equal(mod.shared['shop-function-template.js'], sha(shared.template));
	assert.equal(mod.provenance.emitterCommit, COMMIT);
	assert.equal(mod.provenance.apiContract.sha256, sha(readFileSync(CONTRACT)));
	// Manifests and storefront declarations stay inputs: their digests are recorded, as received.
	assert.deepEqual(mod.inputs, {
		apiContract: sha(readFileSync(CONTRACT)),
		gatedManifest: sha(readFileSync(GATED)),
		markdownManifest: sha(readFileSync(MARKDOWN)),
		queryRedirects: sha(readFileSync(QR)),
		storefronts: sha(STOREFRONTS),
		shops: sha(SHOPS)
	});
	const { configDigest, ...rest } = mod;
	assert.equal(configDigest, sha(JSON.stringify(rest)));
});

test('config digest is stable across runs and moves with an input', () => {
	const a = join(workDir, 'stable-a');
	const b = join(workDir, 'stable-b');
	ok(CURRENT, [...FULL, '--split-out', a]);
	ok(CURRENT, [...FULL, '--split-out', b]);
	const ma = readFileSync(join(a, 'site-config.json'), 'utf8');
	assert.equal(ma, readFileSync(join(b, 'site-config.json'), 'utf8'));
	for (const f of ['_routes.json', 'run-worker-first.json']) assert.equal(readFileSync(join(a, f), 'utf8'), readFileSync(join(b, f), 'utf8'));

	const gated2 = join(fx, 'gated-2.json');
	writeFileSync(gated2, JSON.stringify({ schemaVersion: 1, paths: ['/blog/private-post', '/vault/post-1/', '/vault/post-2'] }));
	const c = join(workDir, 'stable-c');
	ok(CURRENT, [...FULL.map((x) => x === GATED ? gated2 : x), '--split-out', c]);
	const mc = JSON.parse(readFileSync(join(c, 'site-config.json'), 'utf8'));
	assert.notEqual(mc.configDigest, JSON.parse(ma).configDigest);
	assert.equal(mc.inputs.gatedManifest, sha(readFileSync(gated2)));
});

test('emitted _routes.json and run_worker_first agree in both directions, and cover every worker path', () => {
	const split = join(workDir, 'split-routes');
	ok(CURRENT, [...FULL, '--split-out', split]);
	const routes = JSON.parse(readFileSync(join(split, '_routes.json'), 'utf8'));
	const list = JSON.parse(readFileSync(join(split, 'run-worker-first.json'), 'utf8'));
	const mod = JSON.parse(readFileSync(join(split, 'site-config.json'), 'utf8'));
	assert.deepEqual(routes, { version: 1, include: ['/*'], exclude: ['/_astro/*'] });
	assert.deepEqual(list, ['/*', '!/_astro/*']);
	const claimed = ['/__reef/inbox', '/_yt/AAAAAAAAAAA.jpg', '/api/x', '/billing/portal', '/checkout/success', '/membership',
		'/account', '/subscribe/success', '/blog/private-post', '/vault/post-1', '/shop', '/shop/widget', '/fr/shop',
		'/', '/about', '/product.php'];
	for (const p of probePaths(mod.routes, claimed)) {
		assert.equal(pagesRoutesInvokeWorker(routes, p), runWorkerFirstInvokesWorker(list, p), p);
	}
	for (const p of claimed) assert.equal(runWorkerFirstInvokesWorker(list, p), true, p + ' must reach the worker');
	assert.equal(runWorkerFirstInvokesWorker(list, '/_astro/index.abc123.js'), false);
});

test('a static exclusion that hides a worker path is refused, before anything is written', () => {
	for (const ex of ['["/vault/*"]', '["/api/*"]', '["/membership"]', '["/shop/*"]', '["/__reef/*"]', '["/about"]']) {
		const r = run(CURRENT, [...FULL, '--split-out', join(workDir, 'refused-' + n), '--static-exclusions', ex]);
		assert.equal(r.status, 2, ex + ' must be refused');
		assert.match(r.stderr, /static exclusion hides/);
		assert.equal(existsSync(join(r.dist, '_worker.js')), false, 'a refused split must not leave a _worker.js');
	}
	const custom = join(workDir, 'custom-ex');
	ok(CURRENT, [...FULL, '--split-out', custom, '--static-exclusions', '["/_astro/*","/fonts/*"]']);
	assert.deepEqual(JSON.parse(readFileSync(join(custom, 'run-worker-first.json'), 'utf8')), ['/*', '!/_astro/*', '!/fonts/*']);
	const bad = run(CURRENT, [...FULL, '--split-out', join(workDir, 'bad-ex'), '--static-exclusions', '["/a*b"]']);
	assert.equal(bad.status, 2);
	assert.match(bad.stderr, /route table/);
});

test('--split-out is refused inside the Pages upload directory and without --out', () => {
	const dist = join(workDir, 'dist-inside');
	for (const target of [dist, join(dist, 'wfp')]) {
		const r = spawnSync('node', [CURRENT, ...FULL, '--split-out', target, '--out', join(dist, '_worker.js')], { encoding: 'utf8' });
		assert.equal(r.status, 2, target);
		assert.match(r.stderr, /inside the --out directory/);
	}
	assert.equal(existsSync(join(dist, '_worker.js')), false);
	const noOut = spawnSync('node', [CURRENT, ...FULL, '--split-out', join(workDir, 'no-out')], { encoding: 'utf8' });
	assert.equal(noOut.status, 2);
	assert.match(noOut.stderr, /requires --out/);
});
