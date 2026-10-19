// Behavioural test of the EMITTED _worker.js's QUERY-STRING 301s (reef#1882): emit a real worker
// from the fixture site's `_query-redirects.md`, load it, drive `default.fetch` with a mock ASSETS,
// and assert what a browser would see. Same harness shape as emit-markdown-negotiation.test.mjs.
//
// 🔴 BYTE IDENTITY IS THE FIRST ASSERTION. Every site gets this worker, with or without the flag,
// so "no --query-redirects ⇒ the same bytes as before the flag existed" is what keeps a feature
// built for a few migrating sites from touching every other site's deploy. It is asserted three
// ways: a flagless worker carries none of the new identifiers, a file with no rules bakes the same
// bytes as no file, and the template's two placeholders are the only thing that differs.
//
// 🔴 THE ORDER IS THE POINT, as it was for markdown negotiation: the hop must land on the canonical
// host, and the key must be read off the ORIGINAL request before any other branch touches it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const emitter = join(here, 'emit-shop-function.mjs');
const templateSource = readFileSync(join(here, 'shop-function-template.js'), 'utf8');
const workDir = mkdtempSync(join(tmpdir(), 'emit-query-redirects-'));

// The fixture SITE's own file — the same IR tree packages/build collects pages from, so what is
// proven here is "the file the build leaves out of site_pages.json is the file the worker bakes".
const FIXTURE_RULES = join(here, '..', '..', 'build', 'fixtures', 'ir', '_query-redirects.md');

let emitted = 0;
function emitFile(args) {
	const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
	execFileSync('node', [emitter, ...args, '--emitter-commit', 'test', '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
	return out;
}
async function emitWorker(args) {
	const out = emitFile(args);
	return { path: out, bytes: readFileSync(out), mod: await import(pathToFileURL(out).href) };
}
// The emitter's exit code and stderr on a refusal, so the refusal itself can be asserted.
function emitRefusal(args) {
	const r = spawnSync('node', [emitter, ...args, '--emitter-commit', 'test', '--out', join(workDir, 'never.mjs')], { encoding: 'utf8' });
	return { status: r.status, stderr: String(r.stderr || '') };
}
function rulesFile(name, text) {
	const p = join(workDir, name);
	writeFileSync(p, text);
	return p;
}

// A mock ASSETS that records exactly what reached it. `STATIC:<url>` in the body, so a pass-through
// is distinguishable from a redirect AND the request it was given is readable.
function assetsEnv() {
	const seen = [];
	return {
		seen,
		env: { ASSETS: { fetch: async (req) => { seen.push({ url: String(req.url || req), method: req.method }); return new Response('STATIC:' + String(req.url || req), { status: 200, headers: { 'x-existing': '1' } }); } } }
	};
}

const BASE_ARGS = ['--guild', 'site_g1', '--name', 'NORTHWIND'];

// ── byte identity ───────────────────────────────────────────────────────────────────────────────

test('the template carries both placeholders exactly once, adjacent to the canonical-host ones', () => {
	for (const marker of ['/*__QUERY_REDIRECT_HELPERS__*/', '/*__QUERY_REDIRECT_FETCH__*/']) {
		assert.equal(templateSource.split(marker).length - 1, 1, marker + ' once');
	}
	assert.ok(templateSource.includes('/*__CANONICAL_HELPERS__*//*__QUERY_REDIRECT_HELPERS__*/'));
	assert.ok(templateSource.includes('/*__CANONICAL_FETCH__*//*__QUERY_REDIRECT_FETCH__*/'));
});

test('without --query-redirects the worker carries none of the new bytes', async () => {
	const plain = await emitWorker(BASE_ARGS);
	const text = plain.bytes.toString('utf8');
	for (const needle of ['queryRedirects', 'lookupQueryRedirect', 'matchQueryRedirect', 'canonQuery', '__QUERY_REDIRECT']) {
		assert.ok(!text.includes(needle), 'flagless worker must not contain ' + needle);
	}
	// …and behaves as before: a query on any path is just a static request.
	const { env, seen } = assetsEnv();
	const res = await plain.mod.default.fetch(new Request('https://site.example/product.php?cid=12'), env);
	assert.equal(res.status, 200);
	assert.deepEqual(seen.map((s) => s.url), ['https://site.example/product.php?cid=12']);
});

test('a file with no rules bakes exactly the bytes a flagless emit does', async () => {
	const plain = await emitWorker(BASE_ARGS);
	const empty = await emitWorker([...BASE_ARGS, '--query-redirects', rulesFile('empty.md', '')]);
	const comments = await emitWorker([...BASE_ARGS, '--query-redirects', rulesFile('comments.md', '# nothing yet\n\n# still nothing\n')]);
	assert.ok(plain.bytes.equals(empty.bytes), 'empty file ⇒ identical bytes');
	assert.ok(plain.bytes.equals(comments.bytes), 'comment-only file ⇒ identical bytes');
	// The same flagless emit twice is the same bytes (the diff below is about the flag, not noise).
	const again = await emitWorker(BASE_ARGS);
	assert.ok(plain.bytes.equals(again.bytes));
});

test('with rules, the only differences are the module, the glue and the baked key', async () => {
	const plain = (await emitWorker(BASE_ARGS)).bytes.toString('utf8');
	const withRules = (await emitWorker([...BASE_ARGS, '--query-redirects', FIXTURE_RULES])).bytes.toString('utf8');
	assert.notEqual(plain, withRules);
	// Strip the three additions from the rules worker and the plain one is what remains.
	const moduleSource = readFileSync(join(here, '..', '..', 'sitetile', 'query-redirects.mjs'), 'utf8');
	assert.ok(withRules.includes(moduleSource), 'the shared module is concatenated in, byte for byte');
	let stripped = withRules.replace(moduleSource + '\n', '');
	const helpersAt = stripped.indexOf('function matchQueryRedirect(request, byPath) {');
	const helpersEnd = stripped.indexOf('}\n\n', helpersAt) + 3;
	stripped = stripped.slice(0, helpersAt) + stripped.slice(helpersEnd);
	stripped = stripped.replace(/\t\tconst queryRedirectResponse = matchQueryRedirect\(request, CFG\.queryRedirects\.byPath\);\n\t\tif \(queryRedirectResponse\) return queryRedirectResponse;\n/, '');
	// Global: the template bakes `__SHOP_CONFIG__` twice (once in its header comment), so the key
	// appears twice too.
	stripped = stripped.replace(/,"queryRedirects":\{"v":1,"byPath":\{.*?\}\}\}\}/g, '}');
	assert.equal(stripped, plain);
});

// ── the fixture site's worker ───────────────────────────────────────────────────────────────────

const worker = await emitWorker([...BASE_ARGS, '--query-redirects', FIXTURE_RULES]);

test('the branch sits after the canonical-host hop and before everything else in fetch', () => {
	const src = worker.bytes.toString('utf8');
	const fetchStart = src.indexOf('async fetch(request, env, ctx)');
	const cfgAt = src.indexOf('const CFG = ', fetchStart);
	const queryAt = src.indexOf('matchQueryRedirect(request, CFG.queryRedirects.byPath)', fetchStart);
	const shopsAt = src.indexOf('const shopDescriptors =', fetchStart);
	const inboxAt = src.indexOf("pathname === '/__reef/inbox'", fetchStart);
	assert.ok(fetchStart >= 0 && cfgAt > fetchStart && queryAt > cfgAt && queryAt < shopsAt && shopsAt < inboxAt);
});

test('/product.php?cid=12 → 301 /products/widget, with no query re-appended and nothing fetched', async () => {
	const { env, seen } = assetsEnv();
	const res = await worker.mod.default.fetch(new Request('https://site.example/product.php?cid=12'), env);
	assert.equal(res.status, 301);
	assert.equal(res.headers.get('location'), '/products/widget');
	assert.equal(await res.text(), '');
	assert.deepEqual(seen, [], 'a hit never reaches ASSETS');
});

test('/product.php?cid=13 and /product.php pass through to ASSETS with the ORIGINAL request', async () => {
	const { env, seen } = assetsEnv();
	for (const url of ['https://site.example/product.php?cid=13', 'https://site.example/product.php', 'https://site.example/product.php?']) {
		const res = await worker.mod.default.fetch(new Request(url), env);
		assert.equal(res.status, 200, url);
		assert.equal(await res.text(), 'STATIC:' + url, url);
		assert.equal(res.headers.get('x-existing'), '1', 'the asset response is handed back untouched');
	}
	assert.deepEqual(seen.map((s) => s.url), ['https://site.example/product.php?cid=13', 'https://site.example/product.php', 'https://site.example/product.php?']);
});

test('every spelling of the key is one key; an extra parameter is not a hit (exact multiset)', async () => {
	const { env } = assetsEnv();
	const hit = async (url) => (await worker.mod.default.fetch(new Request(url), env)).headers.get('location');
	for (const url of [
		'https://site.example/product.php/?cid=12',
		'https://site.example/product.php/index.html?cid=12',
		'https://site.example/product.php?cid=%31%32',
		'https://site.example/product.php?%63id=12',
		'https://site.example/a/../product.php?cid=12',
	]) assert.equal(await hit(url), '/products/widget', url);
	for (const url of [
		'https://site.example/product.php?cid=12&utm_source=x',
		'https://site.example/product.php?cid=12&cid=12',
		'https://site.example/product.php?CID=12',
		'https://site.example/product.php?cid=%zz',
		'https://site.example/other.php?cid=12',
	]) assert.equal(await hit(url), null, url);
});

test('the WordPress case: /?p=123 on the home page 301s; the home page itself is untouched', async () => {
	const { env, seen } = assetsEnv();
	const hit = await worker.mod.default.fetch(new Request('https://site.example/?p=123'), env);
	assert.equal(hit.status, 301);
	assert.equal(hit.headers.get('location'), '/blog/hello');
	const home = await worker.mod.default.fetch(new Request('https://site.example/'), env);
	assert.equal(home.status, 200);
	const other = await worker.mod.default.fetch(new Request('https://site.example/?s=hello'), env);
	assert.equal(other.status, 200);
	assert.deepEqual(seen.map((s) => s.url), ['https://site.example/', 'https://site.example/?s=hello']);
});

test('🔴 Big5 bytes in the query match raw, in either hex case', async () => {
	const { env } = assetsEnv();
	for (const url of ['https://site.example/big5.php?name=%B7%7B', 'https://site.example/big5.php?name=%b7%7b']) {
		const res = await worker.mod.default.fetch(new Request(url), env);
		assert.equal(res.status, 301, url);
		assert.equal(res.headers.get('location'), '/people/lin', url);
	}
	const miss = await worker.mod.default.fetch(new Request('https://site.example/big5.php?name=%B7%7C'), env);
	assert.equal(miss.status, 200);
});

test('GET and HEAD redirect; any other method passes through', async () => {
	const { env, seen } = assetsEnv();
	const head = await worker.mod.default.fetch(new Request('https://site.example/product.php?cid=12', { method: 'HEAD' }), env);
	assert.equal(head.status, 301);
	for (const method of ['POST', 'PUT', 'OPTIONS']) {
		const res = await worker.mod.default.fetch(new Request('https://site.example/product.php?cid=12', { method }), env);
		assert.equal(res.status, 200, method);
	}
	assert.deepEqual(seen.map((s) => s.method), ['POST', 'PUT', 'OPTIONS']);
});

test('with --canonical-host the host hop comes first, so the 301 lands on the canonical host', async () => {
	const w = await emitWorker([...BASE_ARGS, '--canonical-host', 'northwind.example', '--query-redirects', FIXTURE_RULES]);
	const { env } = assetsEnv();
	const www = await w.mod.default.fetch(new Request('https://www.northwind.example/product.php?cid=12'), env);
	assert.equal(www.status, 301);
	assert.equal(www.headers.get('location'), 'https://northwind.example/product.php?cid=12', 'hop one: host, query carried');
	const canonical = await w.mod.default.fetch(new Request('https://northwind.example/product.php?cid=12'), env);
	assert.equal(canonical.status, 301);
	assert.equal(canonical.headers.get('location'), '/products/widget', 'hop two: the rule');
});

test('the worker-owned routes still answer first-hand on a site with rules', async () => {
	const { env } = assetsEnv();
	const inbox = await worker.mod.default.fetch(new Request('https://site.example/__reef/inbox'), env);
	assert.equal(inbox.status, 405, 'GET /__reef/inbox is still the inbox route');
});

// ── refusals at emit time ───────────────────────────────────────────────────────────────────────

test('a refused file is FATAL (exit 2) and names the refusal and its line', () => {
	const r = emitRefusal([...BASE_ARGS, '--query-redirects', rulesFile('bad.md', '/a?x=1 /b 301\n/a?x=1 /c 301\n')]);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /--query-redirects .*bad\.md: line 2: conflicting_rule: /);
	const malformed = emitRefusal([...BASE_ARGS, '--query-redirects', rulesFile('malformed.md', '/a?x=1 /b\n')]);
	assert.equal(malformed.status, 2);
	assert.match(malformed.stderr, /line 1: bad_line: /);
	const offsite = emitRefusal([...BASE_ARGS, '--query-redirects', rulesFile('offsite.md', '/a?x=1 https://evil.example/ 301\n')]);
	assert.equal(offsite.status, 2);
	assert.match(offsite.stderr, /line 1: to_not_site_relative: /);
	const missing = emitRefusal([...BASE_ARGS, '--query-redirects', join(workDir, 'does-not-exist.md')]);
	assert.equal(missing.status, 2);
	assert.match(missing.stderr, /--query-redirects not readable/);
});

test('a rule on a path this worker answers itself is refused by path: storefront, forwarded API, buyer page', () => {
	const shop = emitRefusal([...BASE_ARGS,
		'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }]), '--api', 'https://api.example',
		'--query-redirects', rulesFile('shop.md', '/shop/item?x=1 /b 301\n')]);
	assert.equal(shop.status, 2);
	assert.match(shop.stderr, /reserved_path: from: \/shop\/item is answered by the worker itself/);

	const contract = rulesFile('contract.json', JSON.stringify({
		schemaVersion: 2, bindingName: 'SEAMLINK',
		verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
		onBindingMissing: { status: 599, cacheControl: 'private, no-store' },
		forward: [{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] }, { match: 'exact', value: '/account/', methods: ['GET'] }],
		siteOwnedBuyerPages: [{ path: '/membership', method: 'GET', kind: 'membership', factsPath: '/zapi/membership' }]
	}));
	const forwarded = emitRefusal([...BASE_ARGS, '--api-contract', contract, '--query-redirects', rulesFile('fwd.md', '/zapi/thing?x=1 /b 301\n')]);
	assert.equal(forwarded.status, 2);
	assert.match(forwarded.stderr, /reserved_path: from: \/zapi\/thing/);
	const exact = emitRefusal([...BASE_ARGS, '--api-contract', contract, '--query-redirects', rulesFile('exact.md', '/account?x=1 /b 301\n')]);
	assert.equal(exact.status, 2);
	assert.match(exact.stderr, /reserved_path: from: \/account /);
	const buyer = emitRefusal([...BASE_ARGS, '--api-contract', contract, '--query-redirects', rulesFile('buyer.md', '/membership/?x=1 /b 301\n')]);
	assert.equal(buyer.status, 2);
	assert.match(buyer.stderr, /reserved_path: from: \/membership /);
	// A sibling is not reserved, and a rule beside the storefront still compiles.
	emitFile([...BASE_ARGS, '--api-contract', contract,
		'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }]), '--api', 'https://api.example',
		'--query-redirects', rulesFile('ok.md', '/shopping?x=1 /b 301\n/zapi-docs?x=1 /c 301\n/account/history?x=1 /d 301\n')]);
});

// ── tile#158 r2 (Codex review), each through the emitted worker ─────────────────────────────────

test('P1 a raw CJK target answers 301 with the percent-encoded Location (it used to throw)', async () => {
	const w = await emitWorker([...BASE_ARGS, '--query-redirects', rulesFile('cjk.md', '/a?x=1 /產品 301\n')]);
	const { env, seen } = assetsEnv();
	const res = await w.mod.default.fetch(new Request('https://site.example/a?x=1'), env);
	assert.equal(res.status, 301);
	assert.equal(res.headers.get('location'), '/%E7%94%A2%E5%93%81');
	assert.deepEqual(seen, []);
});

test('P1 belt-and-braces: a baked target no Response can carry falls through to ASSETS, never throws', async () => {
	// Hand-corrupt an emitted worker's baked map back to the raw spelling compile() now refuses to
	// bake — the shape a stale or hand-edited worker would have.
	const good = emitFile([...BASE_ARGS, '--query-redirects', rulesFile('cjk2.md', '/a?x=1 /產品 301\n')]);
	const text = readFileSync(good, 'utf8');
	assert.ok(text.includes('"/%E7%94%A2%E5%93%81"'), 'the emitted map carries the encoded target');
	const bad = join(workDir, 'corrupt.mjs');
	writeFileSync(bad, text.replaceAll('"/%E7%94%A2%E5%93%81"', '"/產品"'));
	const mod = await import(pathToFileURL(bad).href);
	const { env, seen } = assetsEnv();
	const res = await mod.default.fetch(new Request('https://site.example/a?x=1'), env);
	assert.equal(res.status, 200);
	assert.deepEqual(seen.map((s) => s.url), ['https://site.example/a?x=1']);
});

test('P2 a ~1 MB query on a mapped path falls through fast and does not 301', async () => {
	const { env, seen } = assetsEnv();
	// The key itself, padded with a megabyte of empty pairs — before the cap this canonicalised
	// straight back onto the key and answered 301.
	const padded = 'https://site.example/product.php?cid=12' + '&'.repeat(1 << 20);
	const r1 = await worker.mod.default.fetch(new Request(padded), env);
	assert.equal(r1.status, 200);
	assert.equal(r1.headers.get('location'), null);
	// A megabyte of real pairs on the home page (the /?p=123 rule's path).
	const pairs = 'https://site.example/?' + 'a=1&'.repeat(1 << 18);
	const t0 = performance.now();
	const r2 = await worker.mod.default.fetch(new Request(pairs), env);
	const ms = performance.now() - t0;
	assert.equal(r2.status, 200);
	assert.equal(seen.length, 2, 'both reached ASSETS');
	assert.ok(ms < 100, 'a 1 MB query is refused by length, not parsed: took ' + ms.toFixed(1) + ' ms');
});

test('P2 a control byte inside a Big5 pair is FATAL at emit, by name', () => {
	for (const [name, rule] of [['nul.md', '/a?name=%B7%7B%00 /b 301\n'], ['lf.md', '/a?name=%B7%7B%0A /b 301\n']]) {
		const r = emitRefusal([...BASE_ARGS, '--query-redirects', rulesFile(name, rule)]);
		assert.equal(r.status, 2, name);
		assert.match(r.stderr, /line 1: control_char: /, name);
	}
});

test('P3 a request with no query constructs no URL in the redirect branch', async () => {
	// Differential: for a query-less request the rules worker constructs exactly as many URLs as
	// the flagless one — the branch returns before `new URL`.
	const plain = await emitWorker(BASE_ARGS);
	const count = async (mod, url) => {
		const Real = globalThis.URL;
		let n = 0;
		globalThis.URL = class extends Real { constructor(...a) { super(...a); n++; } };
		try { await mod.default.fetch(new Request(url), assetsEnv().env); } finally { globalThis.URL = Real; }
		return n;
	};
	for (const url of ['https://site.example/a', 'https://site.example/product.php', 'https://site.example/product.php?']) {
		assert.equal(await count(worker.mod, url), await count(plain.mod, url), url);
	}
});

// ── tile#158 r3 (Codex review r2): every source the compiler ACCEPTS must match the URL a visitor's
// browser actually sends for it — each case is Codex's repro, driven through the emitted worker ──

async function sourceAnswers(rule, url) {
	const w = await emitWorker([...BASE_ARGS, '--query-redirects', rulesFile('r3-' + (++emitted) + '.md', rule)]);
	const { env } = assetsEnv();
	return w.mod.default.fetch(new Request(url), env);
}

test('r3 P2 a KELVIN SIGN source answers 301 in its browser spelling (?q=%E2%84%AA%E2%84%AA, 21 chars for a 4-char key)', async () => {
	const res = await sourceAnswers('/old?q=KK /new 301\n', 'https://site.example/old?q=KK');
	assert.equal(res.status, 301);
	assert.equal(res.headers.get('location'), '/new');
});

test('r3 P2 a source with empty pairs answers 301 in its exact spelling (/old?a&&&&&&&&)', async () => {
	const res = await sourceAnswers('/old?a&&&&&&&& /new 301\n', 'https://site.example/old?a&&&&&&&&');
	assert.equal(res.status, 301);
	assert.equal(res.headers.get('location'), '/new');
});

test('r3 P2 raw Unicode inside a non-UTF-8 pair answers 301 (/old?name=中%B7%7B → ?name=%E4%B8%AD%B7%7B)', async () => {
	const res = await sourceAnswers('/old?name=中%B7%7B /new 301\n', 'https://site.example/old?name=中%B7%7B');
	assert.equal(res.status, 301);
	assert.equal(res.headers.get('location'), '/new');
	// The ASCII characters a special-scheme query serialiser escapes, inside a raw pair: same rule.
	const quote = await sourceAnswers('/old?name=%B7%7B"\'<> /new 301\n', 'https://site.example/old?name=%B7%7B"\'<>');
	assert.equal(quote.status, 301);
});

// One test per reserved list: a non-ASCII worker-owned path is reserved exactly like an ASCII one.
// Forward values are compared by the worker against `url.pathname` as written, so a contract that
// forwards a non-ASCII path spells it encoded: /接口/ and /帳戶/.
const R3_CONTRACT = () => rulesFile('r3-contract.json', JSON.stringify({
	schemaVersion: 2, bindingName: 'SEAMLINK',
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 599, cacheControl: 'private, no-store' },
	forward: [
		{ match: 'prefix', value: '/%E6%8E%A5%E5%8F%A3/', methods: ['GET', 'POST'] },
		{ match: 'exact', value: '/%E5%B8%B3%E6%88%B6/', methods: ['GET'] }
	],
	siteOwnedBuyerPages: [{ path: '/會員', method: 'GET', kind: 'membership', factsPath: '/接口/membership' }],
	checkoutResult: { path: '/結帳/結果', method: 'GET', orderParam: 'order', outcomePath: '/接口/outcome' },
	subscribeResult: { path: '/訂閱/結果', method: 'GET', sessionParam: 'session', factsPath: '/接口/facts' }
}));

test('r3 P2 reserved: a non-ASCII storefront (/商店) refuses /商店?x=1 at emit', () => {
	const shop = ['--storefronts', JSON.stringify([{ path: '/商店', source: 'provider', provider: 'square' }]), '--api', 'https://api.example'];
	const r = emitRefusal([...BASE_ARGS, ...shop, '--query-redirects', rulesFile('r3-shop.md', '/商店?x=1 /gone 301\n')]);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /reserved_path: from: \/商店 is answered by the worker itself/);
	const under = emitRefusal([...BASE_ARGS, ...shop, '--query-redirects', rulesFile('r3-shop2.md', '/%E5%95%86%E5%BA%97/item?x=1 /gone 301\n')]);
	assert.equal(under.status, 2);
	assert.match(under.stderr, /reserved_path: from: \/商店\/item /);
});

test('r3 P2 reserved: a non-ASCII site-owned buyer page (/會員) is refused', () => {
	const r = emitRefusal([...BASE_ARGS, '--api-contract', R3_CONTRACT(), '--query-redirects', rulesFile('r3-buyer.md', '/會員?x=1 /b 301\n')]);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /reserved_path: from: \/會員 /);
});

test('r3 P2 reserved: non-ASCII checkout and subscribe result paths are refused', () => {
	for (const from of ['/結帳/結果', '/訂閱/結果']) {
		const r = emitRefusal([...BASE_ARGS, '--api-contract', R3_CONTRACT(), '--query-redirects', rulesFile('r3-result.md', from + '?x=1 /b 301\n')]);
		assert.equal(r.status, 2, from);
		assert.match(r.stderr, new RegExp('reserved_path: from: ' + from + ' '), from);
	}
});

test('r3 P2 reserved: a non-ASCII forwarded prefix (/接口/) is refused at and under it', () => {
	for (const [from, shown] of [['/接口?x=1', '/接口'], ['/接口/thing?x=1', '/接口/thing']]) {
		const r = emitRefusal([...BASE_ARGS, '--api-contract', R3_CONTRACT(), '--query-redirects', rulesFile('r3-fwd.md', from + ' /b 301\n')]);
		assert.equal(r.status, 2, from);
		assert.match(r.stderr, new RegExp('reserved_path: from: ' + shown + ' '), from);
	}
	// A sibling is not under the prefix.
	emitFile([...BASE_ARGS, '--api-contract', R3_CONTRACT(), '--query-redirects', rulesFile('r3-fwd-ok.md', '/接口文件?x=1 /b 301\n')]);
});

test('r3 P2 reserved: a non-ASCII exact forward (/帳戶/) is refused', () => {
	const r = emitRefusal([...BASE_ARGS, '--api-contract', R3_CONTRACT(), '--query-redirects', rulesFile('r3-exact.md', '/帳戶?x=1 /b 301\n')]);
	assert.equal(r.status, 2);
	assert.match(r.stderr, /reserved_path: from: \/帳戶 /);
});
