// The route table and its two spellings (route-table.mjs): Pages `_routes.json` and the Workers
// Static Assets `run_worker_first` array must send exactly the same requests to the Site Worker.
// Asserted in both directions over every path the table names plus a set of worker-claimed paths, so
// neither spelling can grow a path the other lacks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildRouteTable, toPagesRoutes, toRunWorkerFirst, pagesRoutesInvokeWorker, runWorkerFirstInvokesWorker,
	tableInvokesWorker, probePaths, RouteTableError, DEFAULT_STATIC_EXCLUSIONS, PAGES_ROUTES_MAX_RULES
} from './route-table.mjs';

const CLAIMED = ['/__reef/inbox', '/_yt/AAAAAAAAAAA.jpg', '/api/probe', '/membership', '/account', '/checkout/success',
	'/subscribe/success', '/shop', '/shop/widget', '/shop/complete', '/blog/private-post', '/fr/shop'];

function assertAgree(table, extra) {
	const routes = toPagesRoutes(table);
	const list = toRunWorkerFirst(table);
	const paths = probePaths(table, extra);
	for (const p of paths) {
		const pages = pagesRoutesInvokeWorker(routes, p);
		const wfp = runWorkerFirstInvokesWorker(list, p);
		const own = tableInvokesWorker(table, p);
		// Both directions: Pages ⇒ WfP and WfP ⇒ Pages, and both equal the table's own answer.
		assert.equal(pages, wfp, p + ': _routes.json says ' + pages + ', run_worker_first says ' + wfp);
		assert.equal(pages, own, p + ': spellings disagree with the table');
	}
	return paths;
}

test('default table: every request is worker-first except the content-hashed build output', () => {
	const table = buildRouteTable();
	assert.deepEqual(table, { workerFirst: ['/*'], staticExclusions: [...DEFAULT_STATIC_EXCLUSIONS] });
	assert.deepEqual(toPagesRoutes(table), { version: 1, include: ['/*'], exclude: ['/_astro/*'] });
	assert.deepEqual(toRunWorkerFirst(table), ['/*', '!/_astro/*']);
	const paths = assertAgree(table, CLAIMED);
	for (const p of CLAIMED) assert.equal(tableInvokesWorker(table, p), true, p + ' must reach the worker');
	assert.equal(tableInvokesWorker(table, '/_astro/probe.js'), false);
	// `/_astro` itself is not under `/_astro/`: it still enters the worker on both platforms.
	assert.equal(tableInvokesWorker(table, '/_astro'), true);
	assert.ok(paths.length > CLAIMED.length);
});

test('a custom table agrees in both directions too, including exact globs and nested prefixes', () => {
	const table = buildRouteTable({ workerFirst: ['/*'], staticExclusions: ['/_astro/*', '/fonts/*', '/robots.txt'] });
	assertAgree(table, [...CLAIMED, '/fonts/a.woff2', '/fontsx', '/robots.txt', '/robots.txt/x']);
	const narrow = buildRouteTable({ workerFirst: ['/api/*', '/membership'], staticExclusions: ['/api/static/*'] });
	assertAgree(narrow, ['/api/x', '/api/static/x', '/membership', '/membership/', '/other']);
	assert.equal(tableInvokesWorker(narrow, '/api/static/x'), false);
	assert.equal(tableInvokesWorker(narrow, '/other'), false);
});

test('the boolean run_worker_first forms keep their documented meaning', () => {
	assert.equal(runWorkerFirstInvokesWorker(true, '/anything'), true);
	assert.equal(runWorkerFirstInvokesWorker(false, '/anything'), false);
});

test('globs only one meaning can be read into are refused', () => {
	for (const bad of ['relative/*', '//x', '/a*b', '/*/x', '!/x/*', '/x?y', '/x#y', 7]) {
		assert.throws(() => buildRouteTable({ staticExclusions: [bad] }), RouteTableError, JSON.stringify(bad));
	}
	assert.throws(() => buildRouteTable({ workerFirst: [] }), RouteTableError);
	const many = Array.from({ length: PAGES_ROUTES_MAX_RULES }, (_, i) => '/s' + i + '/*');
	assert.throws(() => buildRouteTable({ staticExclusions: many }), /allows 100/);
});
