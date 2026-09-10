// Behavioural test of the EMITTED _worker.js's same-origin API transport: emit a
// real worker, load it, and drive `default.fetch` with a mock service binding and
// mock ASSETS. Same shape as emit-shop-function.test.mjs — nothing is asserted
// about source text that could be asserted about behaviour.
//
// 🔴 THE FIXTURE CONTRACT DELIBERATELY DISAGREES WITH THE REAL ONE. Its binding
// is SEAMLINK, not RSP; its binding-missing status is 599, not 503; its
// cache-control carries a marker no product value has; it forwards /zapi/ and
// gates /vault/. An emitter that hard-coded ANY value from the real contract
// passes a test written against the real contract and fails every one of these.
// That is the whole reason the fixture is not a copy.
//
// The real contract lives in a different repo of ours (reef,
// apps/mixfairy/scripts/site-api-transport.contract.json), so it cannot be a
// checked-in dependency of this suite. Point SITE_API_TRANSPORT_CONTRACT at it
// and the last block also runs against the real path set; without it that block
// says by name that it was skipped, because silence is what lets a check rot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'emit-api-transport-'));

const BINDING = 'SEAMLINK';
const MISSING_STATUS = 599;
const MISSING_CC = 'private, max-age=0, no-store, fixture-marker';
const FIXTURE_CONTRACT = {
	schemaVersion: 2,
	bindingName: BINDING,
	checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: MISSING_STATUS, cacheControl: MISSING_CC },
	forward: [
		{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST', 'DELETE'] },
		{ match: 'prefix', value: '/api/', methods: ['GET'] },
		{ match: 'exact', value: '/checkout/success', methods: ['GET'] },
		{ match: 'exact', value: '/tickets', methods: ['GET', 'HEAD'] }
	],
	excluded: [
		{ match: 'exact', value: '/vault', disposition: 'verdict-required' },
		{ match: 'prefix', value: '/vault/', disposition: 'verdict-required' },
		{ match: 'exact', value: '/frozen', disposition: 'static-complete' }
	]
};

const fixturePath = join(workDir, 'fixture.contract.json');
writeFileSync(fixturePath, JSON.stringify(FIXTURE_CONTRACT, null, 2));
const oldFixturePath = join(workDir, 'old-fixture.contract.json');
const { checkoutResult: _newCheckoutResult, ...fixtureWithoutCheckoutResult } = FIXTURE_CONTRACT;
const OLD_FIXTURE_CONTRACT = { ...fixtureWithoutCheckoutResult, schemaVersion: 1 };
writeFileSync(oldFixturePath, JSON.stringify(OLD_FIXTURE_CONTRACT, null, 2));
const fixtureManifestPath = join(workDir, 'fixture.verdict.json');
writeFileSync(fixtureManifestPath, JSON.stringify({
	schemaVersion: 1,
	paths: ['/vault', '/vault/post-1', '/vault/post-1/', '/vault/post-1/index.html', '/custom/2026/member-post']
}, null, 2));

// The shop API base the emitter now REQUIRES once a storefront is declared. A synthetic origin:
// the emitter stopped carrying a baked hostname when this package moved to the public engine, and
// what these tests are about is the routing, not whose backend it is. See emit-shop-function.mjs.
//
// 🔴 Appended AFTER ...args so an explicit --api in a call still wins — arg() takes the first match.
const SHOP_API_BASE = 'https://api.example';
let emitted = 0;
function emitFile(args) {
	const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
	execFileSync('node', [join(here, 'emit-shop-function.mjs'), ...args, '--api', SHOP_API_BASE, '--out', out],
		{ stdio: ['ignore', 'ignore', 'pipe'] });
	return out;
}
async function emitWorker(args) {
	const out = emitFile(args);
	return { path: out, mod: await import(pathToFileURL(out).href) };
}

const SHOP_ARGS = ['--guild', 'site_g1', '--name', 'NORTHWIND',
	'--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }])];

// with contract + shop
const withContract = await emitWorker([...SHOP_ARGS, '--api-contract', fixturePath, '--gated-manifest', fixtureManifestPath]);
// the same contract with no renderer-generated private paths: old contract exclusions
// must not create a gate or verdict endpoint in the emitted transport.
const withContractNoGates = await emitWorker([...SHOP_ARGS, '--api-contract', fixturePath]);
// with contract, NO shop flags at all — the site that could not be built before
const noShop = await emitWorker(['--api-contract', fixturePath]);
// no contract at all — the pre-transport behaviour must be untouched
const noContract = await emitWorker(SHOP_ARGS);
const oldContractNative = await emitWorker([
	'--site-id', 'site-native',
	'--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]),
	'--api-contract', oldFixturePath
]);

// ── harness ──────────────────────────────────────────────────────────────────
// `seenByRsp` / `seenByAssets` record what each side was ACTUALLY handed, so a
// dropped body or a lost header is visible rather than assumed.
function makeEnv({ rsp = null, assets = null, bindingName = BINDING } = {}) {
	const seenByRsp = [];
	const seenByAssets = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				const url = new URL(typeof req === 'string' ? req : req.url);
				seenByAssets.push({ method: req.method || 'GET', url, request: req });
				return assets ? assets(req, url) : new Response('STATIC:' + url.pathname, { status: 200 });
			}
		}
	};
	if (rsp) {
		env[bindingName] = {
			fetch: async (req) => {
				const url = new URL(req.url);
				const record = {
					method: req.method, url, path: url.pathname, search: url.search,
					headers: req.headers, body: await req.text().catch(() => '')
				};
				seenByRsp.push(record);
				return rsp(record, req);
			}
		};
	}
	return { env, seenByRsp, seenByAssets };
}
const echoRsp = () => new Response('RSP-OK', { status: 200 });

// ── forwarding ───────────────────────────────────────────────────────────────

test('a contract path enters the binding and never touches ASSETS', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp });
	const res = await withContract.mod.default.fetch(new Request('https://s.example/zapi/v2/thing'), env);
	assert.equal(await res.text(), 'RSP-OK');
	assert.equal(seenByRsp.length, 1);
	assert.equal(seenByRsp[0].path, '/zapi/v2/thing');
	assert.deepEqual(seenByAssets, []);
});

test('a NEAR-MISS prefix stays on the site: /apix, /zapix, /ticketsx, /vaultx', async () => {
	for (const path of ['/apix', '/zapix', '/api', '/zapi', '/ticketsx', '/vaultx', '/frozen', '/faq']) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp });
		const res = await withContract.mod.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(await res.text(), 'STATIC:' + path, path + ' should be served by the site');
		assert.deepEqual(seenByRsp, [], path + ' must not reach the binding');
		assert.equal(seenByAssets.length, 1, path + ' must reach ASSETS');
	}
});

test('an exact rule forwards only its own path', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/tickets'), env);
	assert.equal(seenByRsp.length, 1);
	const second = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/tickets/2'), second.env);
	assert.deepEqual(second.seenByRsp, [], '/tickets/2 is not the exact path /tickets');
});

test("a verb the contract does not list is not forwarded", async () => {
	// /api/ is GET-only in the fixture; /zapi/ takes POST.
	const a = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/api/x', { method: 'POST', body: 'b' }), a.env);
	assert.deepEqual(a.seenByRsp, [], 'POST /api/x is outside the contract methods');
	assert.equal(a.seenByAssets.length, 1);

	const b = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/zapi/x', { method: 'POST', body: 'b' }), b.env);
	assert.equal(b.seenByRsp.length, 1, 'POST /zapi/x is inside the contract methods');
});

// ── forwarding fidelity, one property per test ───────────────────────────────

test('fidelity: the METHOD survives', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/zapi/x', { method: 'DELETE' }), env);
	assert.equal(seenByRsp[0].method, 'DELETE');
});

test('fidelity: the PATH and QUERY survive', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/zapi/a/b?q=1&r=two%20words'), env);
	assert.equal(seenByRsp[0].path, '/zapi/a/b');
	assert.equal(seenByRsp[0].search, '?q=1&r=two%20words');
});

test('fidelity: REQUEST HEADERS survive', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/zapi/x', {
		headers: { 'accept': 'application/json', 'x-caller-trace': 'trace-42' }
	}), env);
	assert.equal(seenByRsp[0].headers.get('x-caller-trace'), 'trace-42');
	assert.equal(seenByRsp[0].headers.get('accept'), 'application/json');
});

test('fidelity: the COOKIE survives (the member session rides on it)', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/zapi/x', {
		headers: { cookie: 'rsp_session=abc123; other=1' }
	}), env);
	assert.equal(seenByRsp[0].headers.get('cookie'), 'rsp_session=abc123; other=1');
});

test('fidelity: the BODY survives', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp });
	await withContract.mod.default.fetch(new Request('https://s.example/zapi/x', {
		method: 'POST', body: '{"amount":1200}', headers: { 'content-type': 'application/json' }
	}), env);
	assert.equal(seenByRsp[0].body, '{"amount":1200}');
});

test('fidelity: the response SET-COOKIE comes back untouched', async () => {
	const { env } = makeEnv({
		rsp: () => new Response('ok', {
			status: 201,
			headers: { 'set-cookie': 'rsp_session=zzz; Path=/; HttpOnly', 'x-rsp': 'yes' }
		})
	});
	const res = await withContract.mod.default.fetch(new Request('https://s.example/zapi/x'), env);
	assert.equal(res.status, 201);
	assert.equal(res.headers.get('set-cookie'), 'rsp_session=zzz; Path=/; HttpOnly');
	assert.equal(res.headers.get('x-rsp'), 'yes');
});

test('the emitted worker injects no headers of its own, outside one NAMED exception', async () => {
	const text = readFileSync(withContract.path, 'utf8');
	// 🔴 The exception is public markdown negotiation, and it is the owner's ruling,
	// not a loophole: both variants of a negotiated URL must carry `Vary: Accept` or a
	// shared cache serves markdown to a browser (site-agent-readability, T2). Merging
	// that into the ASSETS response is the only way to do it, and it is proven — with
	// its own header assertions — in emit-markdown-negotiation.test.mjs.
	//
	// Cut by NAME and fail if the name is gone, so this never quietly stops covering
	// the file. Everything else — transport, verdict, shop, static — is still held to
	// the original claim.
	const at = text.indexOf('function withVaryAccept(');
	assert.notEqual(at, -1, 'the exception must still be findable, or this test covers nothing');
	const end = text.indexOf('\n}\n', at);
	const rest = text.slice(0, at) + text.slice(end);
	assert.equal(/headers\.(set|append)\s*\(/.test(rest), false);
});

// The claim the grep above stands for, asserted where it actually matters: a
// response this worker PASSES THROUGH comes back with the header set it was given
// and nothing else. Behavioural, so a header added by any means — a rebuilt
// Headers, a new Response, a helper written next year — fails it too.
test('a passed-through response keeps EXACTLY the headers it was handed', async () => {
	const given = { 'x-rsp': 'yes', 'set-cookie': 'a=b; Path=/', 'content-type': 'application/json' };
	const expected = Object.keys(given).sort();
	const names = (res) => [...res.headers].map(([name]) => name).sort();
	const body = () => new Response('BYTES', { status: 200, headers: given });

	const forwarded = makeEnv({ rsp: body });
	assert.deepEqual(names(await withContract.mod.default.fetch(new Request('https://s.example/zapi/x'), forwarded.env)),
		expected, 'a forwarded response');

	const allowed = makeEnv({ rsp: verdictRsp({ path: '/vault/post-1', allow: true, reason: 'members_ok' }), assets: body });
	assert.deepEqual(names(await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), allowed.env)),
		expected, 'a verdict-allowed file');

	const statically = makeEnv({ assets: body });
	assert.deepEqual(names(await withContract.mod.default.fetch(new Request('https://s.example/faq'), statically.env)),
		expected, 'the static fall-through');
});

// ── binding absent: a FORWARDED path ──────────────────────────────────────

// Two separate obligations, so two separate tests: "never pretend it worked"
// and "answer exactly what the contract says". A worker that falls through to
// ASSETS breaks the first; a worker that invents its own status code breaks only
// the second — one test asserting both cannot tell you which happened.
test('binding absent on a forwarded path never reaches ASSETS and never answers 200', async () => {
	const { env, seenByAssets } = makeEnv({ rsp: null });
	const res = await withContract.mod.default.fetch(new Request('https://s.example/zapi/x'), env);
	assert.notEqual(res.status, 200);
	assert.deepEqual(seenByAssets, [], 'a missing binding must never fall through to the site');
});

test('binding absent: status and cache-control are read from the CONTRACT, field by field', async () => {
	const contract = JSON.parse(readFileSync(fixturePath, 'utf8'));
	const { env } = makeEnv({ rsp: null });
	const res = await withContract.mod.default.fetch(new Request('https://s.example/zapi/x'), env);
	assert.equal(res.status, contract.onBindingMissing.status);
	assert.equal(res.headers.get('cache-control'), contract.onBindingMissing.cacheControl);
});

// ── binding absent: a GENERATED gated path ───────────────────────────

const GATED_PATHS = ['/vault', '/vault/post-1', '/vault/post-1/', '/vault/post-1/index.html'];

test('binding absent on a generated gated path: fail closed with a distinct refusal', async () => {
	for (const path of GATED_PATHS) {
		const { env, seenByAssets } = makeEnv({ rsp: null });
		const res = await withContract.mod.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(res.status, 503, path + ' must not serve a private file without the binding');
		assert.deepEqual(await res.json(), { error: 'site_verdict_binding_missing' });
		assert.deepEqual(seenByAssets, [], path + ' must not reach ASSETS');
	}
});

test('binding PRESENT: the gate still runs, and its three answers stay three answers', async () => {
	const allow = makeEnv({ rsp: verdictRsp({ path: '/vault/post-1', allow: true, reason: 'members_ok' }) });
	const deny = makeEnv({ rsp: verdictRsp({ path: '/vault/post-1', allow: false, reason: 'members_only' }) });
	const mute = makeEnv({ rsp: () => { throw new Error('binding down'); } });

	const a = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), allow.env);
	const d = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), deny.env);
	const m = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), mute.env);

	assert.equal(allow.seenByRsp.length, 1, 'allow: the gate was asked');
	assert.equal(deny.seenByRsp.length, 1, 'deny: the gate was asked');
	assert.equal(mute.seenByRsp.length, 1, 'unobtainable: the gate was asked');

	assert.equal(a.status, 200);
	assert.equal(await a.text(), 'STATIC:/vault/post-1', 'allow serves the file');
	assert.equal(d.status, 404, 'deny blocks');
	assert.equal(m.status, 502, 'unobtainable blocks, distinctly');
	assert.deepEqual(deny.seenByAssets, [], 'a refusal must not fetch the file');
	assert.deepEqual(mute.seenByAssets, [], 'an unobtainable verdict must not fetch the file');
	assert.equal(new Set([a.status, d.status, m.status]).size, 3, 'the three answers must not collapse into one');
});

test('a NEAR MISS beside a rule is the site\'s, binding wired or not', async () => {
	for (const path of ['/vaultx', '/vaults/1', '/apix', '/zapix', '/ticketsx']) {
		for (const [name, rsp] of [['binding wired', echoRsp], ['no binding', null]]) {
			const { env, seenByRsp, seenByAssets } = makeEnv({ rsp });
			const res = await withContract.mod.default.fetch(new Request('https://s.example' + path), env);
			assert.equal(res.status, 200, path + ' (' + name + ') must be served');
			assert.equal(await res.text(), 'STATIC:' + path, path + ' (' + name + ')');
			assert.deepEqual(seenByRsp, [], path + ' (' + name + ') must not reach the binding');
			assert.equal(seenByAssets.length, 1, path + ' (' + name + ')');
		}
	}
});

// ── verdict-required paths, binding WIRED ─────────────────────────────────

function verdictRsp(verdict, { status = 200 } = {}) {
	return (record) => {
		assert.equal(record.path, '/seam/site-verdict-v2');
		return new Response(JSON.stringify(verdict), { status, headers: { 'content-type': 'application/json' } });
	};
}

test('verdict allow: the SITE serves its own file', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({
		rsp: verdictRsp({ path: '/vault/post-1', allow: true, reason: 'members_ok' })
	});
	const res = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), env);
	assert.equal(await res.text(), 'STATIC:/vault/post-1');
	assert.equal(seenByRsp.length, 1);
	assert.equal(seenByRsp[0].url.searchParams.get('path'), '/vault/post-1',
		'the judged path travels as the query parameter');
	assert.equal(seenByAssets.length, 1);
	assert.equal(seenByAssets[0].url.pathname, '/vault/post-1');
});

test('directory and index aliases use the same generated verdict path', async () => {
	for (const alias of ['/vault/post-1', '/vault/post-1/', '/vault/post-1/index.html']) {
		const { env, seenByRsp } = makeEnv({
			rsp: verdictRsp({ path: '/vault/post-1', allow: true, reason: 'members_ok' })
		});
		const res = await withContract.mod.default.fetch(new Request('https://s.example' + alias), env);
		assert.equal(res.status, 200, alias);
		assert.equal(seenByRsp[0].url.searchParams.get('path'), '/vault/post-1', alias);
	}
});

test('encoded separators use the same generated gate, including upper/lower hex forms', async () => {
	for (const alias of [
		'/custom%2F2026%2Fmember-post',
		'/custom%2f2026%2fmember-post',
		'/custom%2F2026%2Fmember-post%2F',
		'/custom%2f2026%2fmember-post%2findex.html',
	]) {
		const { env, seenByRsp, seenByAssets } = makeEnv({
			rsp: verdictRsp({ path: '/custom/2026/member-post', allow: true, reason: 'members_ok' })
		});
		const request = new Request('https://s.example' + alias);
		const res = await withContract.mod.default.fetch(request, env);
		assert.equal(res.status, 200, alias);
		assert.equal(seenByRsp[0].url.searchParams.get('path'), '/custom/2026/member-post', alias);
		assert.equal(seenByAssets.length, 1, alias + ' must serve after allow');
		assert.equal(seenByAssets[0].request, request, alias + ' must pass the original request to ASSETS');
		assert.equal(seenByAssets[0].url.pathname, new URL(request.url).pathname, alias);
	}
});

test('encoded separator deny and missing-binding controls fail closed before ASSETS', async () => {
	const denied = makeEnv({
		rsp: verdictRsp({ path: '/custom/2026/member-post', allow: false, reason: 'members_only' })
	});
	const deny = await withContract.mod.default.fetch(new Request('https://s.example/custom%2f2026%2fmember-post'), denied.env);
	assert.equal(deny.status, 404);
	assert.equal(denied.seenByRsp[0].url.searchParams.get('path'), '/custom/2026/member-post');
	assert.deepEqual(denied.seenByAssets, []);

	const missing = makeEnv({ rsp: null });
	const noBinding = await withContract.mod.default.fetch(new Request('https://s.example/custom%2F2026%2Fmember-post%2Findex.html'), missing.env);
	assert.equal(noBinding.status, 503);
	assert.deepEqual(missing.seenByAssets, []);
});

test('malformed encoded separator remains ordinary static behavior', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp });
	const res = await withContract.mod.default.fetch(new Request('https://s.example/vault%2'), env);
	assert.equal(await res.text(), 'STATIC:/vault%2');
	assert.deepEqual(seenByRsp, []);
	assert.equal(seenByAssets.length, 1);
});

test('HEAD follows the same generated gate as GET and preserves HEAD for ASSETS', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({
		rsp: verdictRsp({ path: '/vault/post-1', allow: true, reason: 'members_ok' })
	});
	const res = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1', { method: 'HEAD' }), env);
	assert.equal(res.status, 200);
	assert.equal(seenByRsp.length, 1);
	assert.equal(seenByRsp[0].method, 'GET', 'the verdict endpoint is GET-only');
	assert.equal(seenByAssets.length, 1);
	assert.equal(seenByAssets[0].method, 'HEAD', 'the allowed asset request keeps HEAD');
});

test('the verdict call carries the caller\'s cookie, so RSP judges the real viewer', async () => {
	const { env, seenByRsp } = makeEnv({
		rsp: verdictRsp({ path: '/vault/post-1', allow: true, reason: 'members_ok' })
	});
	await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1', {
		headers: { cookie: 'rsp_session=member-1' }
	}), env);
	assert.equal(seenByRsp[0].headers.get('cookie'), 'rsp_session=member-1');
	assert.equal(seenByRsp[0].method, 'GET');
});

test('verdict remains membership-only: unexpected payload does not replace site bytes', async () => {
	const { env, seenByAssets } = makeEnv({
		rsp: verdictRsp({ path: '/vault/post-1', allow: true, reason: 'members_ok', override: { body_html: 'must-not-escape' } })
	});
	const res = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), env);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), 'STATIC:/vault/post-1');
	assert.equal(seenByAssets.length, 1);
});

test('verdict DENY blocks, and ASSETS is never asked for the gated file', async () => {
	const { env, seenByAssets } = makeEnv({
		rsp: verdictRsp({ path: '/vault/post-1', allow: false, reason: 'members_only' })
	});
	const res = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), env);
	assert.equal(res.status, 404);
	assert.notEqual(res.status, 200);
	assert.equal(res.headers.get('cache-control'), 'private, no-store');
	assert.deepEqual(seenByAssets, [], 'a refused viewer must not receive the file from the site either');
	assert.equal((await res.text()).includes('paid'), false);
});

test('the exact verdict rule is gated too, not only the prefix one', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({
		rsp: verdictRsp({ path: '/vault', allow: false, reason: 'members_only' })
	});
	const res = await withContract.mod.default.fetch(new Request('https://s.example/vault'), env);
	assert.equal(seenByRsp.length, 1);
	assert.equal(res.status, 404);
	assert.deepEqual(seenByAssets, []);
});

test('only renderer-generated paths are judged; contract families and near misses stay static', async () => {
	for (const path of ['/blog/private', '/devlog/private', '/vaultx', '/vaults/private', '/vault/post-2']) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp });
		const res = await withContract.mod.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(await res.text(), 'STATIC:' + path, path + ' must remain site-owned');
		assert.deepEqual(seenByRsp, [], path + ' must not be guessed into the verdict set');
		assert.equal(seenByAssets.length, 1);
	}
});

test('zero generated private paths emit no verdict behavior even when the contract has old exclusions', async () => {
	for (const path of ['/blog/private', '/devlog/private', '/vault', '/vault/post-1']) {
		const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp });
		const res = await withContractNoGates.mod.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(await res.text(), 'STATIC:' + path, path + ' must remain site-owned');
		assert.deepEqual(seenByRsp, [], path + ' must not call RSP');
		assert.equal(seenByAssets.length, 1);
	}
});

test('a verb the contract never listed is still judged, never waved through', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({
		rsp: verdictRsp({ path: '/vault/post-1', allow: false, reason: 'members_only' })
	});
	await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1', { method: 'POST', body: 'x' }), env);
	assert.equal(seenByRsp.length, 1, 'POST on a gated path must still be judged');
	assert.deepEqual(seenByAssets, []);
});

test('FAIL-CLOSED: every way the verdict can be unobtainable blocks, and says so distinctly', async () => {
	const cases = [
		['throws', () => { throw new Error('binding down'); }],
		['non-2xx', () => new Response('nope', { status: 500 })],
		['unparseable body', () => new Response('<html>not json</html>', { status: 200 })],
		['null body', () => new Response('null', { status: 200 })]
	];
	const contract = JSON.parse(readFileSync(fixturePath, 'utf8'));
	for (const [name, rsp] of cases) {
		const { env, seenByAssets } = makeEnv({ rsp });
		const res = await withContract.mod.default.fetch(new Request('https://s.example/vault/post-1'), env);
		assert.notEqual(res.status, 200, name + ' must not serve');
		assert.deepEqual(seenByAssets, [], name + ' must not fall through to the site');
		assert.equal(res.status, 502, name + ' is "could not ask", a different gate from "the answer was no"');
		assert.notEqual(res.status, contract.onBindingMissing.status,
			name + ' is also distinct from "the binding was never wired"');
		assert.equal(res.headers.get('cache-control'), 'private, no-store');
	}
});

// ── the site that has no shop, and the site that has no contract ─────────────

test('a site with NO shop flags emits, and owns none of the shop paths', async () => {
	const { env, seenByAssets } = makeEnv({ rsp: echoRsp });
	for (const path of ['/shop', '/shop/', '/shop/riso-poster']) {
		const res = await noShop.mod.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(await res.text(), 'STATIC:' + path, path + ' belongs to the static site here');
	}
	assert.equal(seenByAssets.length, 3);
});

test('a site with no shop still forwards the contract paths', async () => {
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp });
	const res = await noShop.mod.default.fetch(new Request('https://s.example/zapi/v2/thing'), env);
	assert.equal(await res.text(), 'RSP-OK');
	assert.equal(seenByRsp.length, 1);
});

test('an old contract without checkoutResult keeps its baked RSP checkout fallback', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp });
	const res = await oldContractNative.mod.default.fetch(new Request('https://s.example/checkout/success?order_id=order-1'), env);
	assert.equal(await res.text(), 'RSP-OK');
	assert.equal(seenByRsp.length, 1);
	assert.deepEqual(seenByAssets, []);
});

test('generated Worker config carries the exact-v2 semantic marker', async () => {
	const worker = readFileSync(withContract.path, 'utf8');
	assert.match(worker, /"verdictTransport":"exact-v2"/);
	assert.match(worker, /"verdictEndpoint":\{"version":2,"path":"\/seam\/site-verdict-v2","param":"path"\}/);
	assert.match(worker, /"checkoutResult":\{"path":"\/checkout\/success","method":"GET","orderParam":"order_id","outcomePath":"\/api\/v2\/shop\/checkout\/outcome"\}/);
});

test('without --api-contract nothing is forwarded and nothing is gated', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp });
	for (const path of ['/zapi/x', '/api/x', '/vault/post-1', '/tickets']) {
		const res = await noContract.mod.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(await res.text(), 'STATIC:' + path);
	}
	assert.deepEqual(seenByRsp, []);
	assert.equal(seenByAssets.length, 4);
});

// ── provenance and refusal ───────────────────────────────────────────────────

test('the emitted file names the emitter commit and the contract sha256', async () => {
	const head = readFileSync(withContract.path, 'utf8').split('\n').slice(0, 4).join('\n');
	const sha = createHash('sha256').update(readFileSync(fixturePath)).digest('hex');
	assert.match(head, /^\/\/ GENERATED/);
	assert.match(head, /\/\/ emitter commit: \S+/);
	assert.equal(head.includes('sha256=' + sha), true, 'the sha must be OF THE CONTRACT FILE');
	assert.equal(head.includes(fixturePath), true);
});

test('the emitter commit is a real commit when git can answer', async () => {
	let expected = null;
	try {
		expected = execFileSync('git', ['-C', here, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch { expected = null; }
	if (!expected) {
		console.log('  (skipped: no git checkout here — provenance would read "unknown")');
		return;
	}
	assert.equal(readFileSync(withContract.path, 'utf8').includes('// emitter commit: ' + expected), true);
});

test('a malformed contract is fatal, never silently transport-less', async () => {
	const { verdictEndpoint: _ignored, ...PUBLIC_ONLY_CONTRACT } = FIXTURE_CONTRACT;
	const cases = [
		['not json', 'not json at all'],
		['no bindingName', JSON.stringify({ forward: [{ match: 'prefix', value: '/a/', methods: ['GET'] }], onBindingMissing: { status: 503, cacheControl: 'x' } })],
		['no forward', JSON.stringify({ bindingName: 'X', onBindingMissing: { status: 503, cacheControl: 'x' } })],
		['no onBindingMissing', JSON.stringify({ bindingName: 'X', forward: [{ match: 'prefix', value: '/a/', methods: ['GET'] }] })],
		['bad match verb', JSON.stringify({ bindingName: 'X', forward: [{ match: 'regex', value: '/a/', methods: ['GET'] }], onBindingMissing: { status: 503, cacheControl: 'x' } })],
		['methods missing', JSON.stringify({ bindingName: 'X', forward: [{ match: 'prefix', value: '/a/' }], onBindingMissing: { status: 503, cacheControl: 'x' } })],
		['endpoint absent', JSON.stringify(PUBLIC_ONLY_CONTRACT)],
		['endpoint version missing', JSON.stringify({ ...FIXTURE_CONTRACT, verdictEndpoint: { path: '/seam/site-verdict-v2', param: 'path' } })],
		['endpoint version v1', JSON.stringify({ ...FIXTURE_CONTRACT, verdictEndpoint: { version: 1, path: '/seam/site-verdict', param: 'path' } })],
		['endpoint version unknown', JSON.stringify({ ...FIXTURE_CONTRACT, verdictEndpoint: { version: 9, path: '/seam/site-verdict-v9', param: 'path' } })],
		['endpoint legacy path', JSON.stringify({ ...FIXTURE_CONTRACT, verdictEndpoint: { version: 2, path: '/seam/site-verdict', param: 'path' } })],
		['endpoint wrong param', JSON.stringify({ ...FIXTURE_CONTRACT, verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'verdictPath' } })],
		['checkout result wrong method', JSON.stringify({ ...FIXTURE_CONTRACT, checkoutResult: { ...FIXTURE_CONTRACT.checkoutResult, method: 'POST' } })],
		['checkout result bad param', JSON.stringify({ ...FIXTURE_CONTRACT, checkoutResult: { ...FIXTURE_CONTRACT.checkoutResult, orderParam: 'order id' } })]
	];
	for (const [name, body] of cases) {
		const bad = join(workDir, 'bad-' + name.replace(/\W+/g, '-') + '.json');
		writeFileSync(bad, body);
		const args = name.startsWith('endpoint')
			? ['--api-contract', bad, '--gated-manifest', fixtureManifestPath]
			: ['--api-contract', bad];
		assert.throws(() => emitFile(args), undefined, name + ' must refuse');
	}
	assert.throws(() => emitFile(['--api-contract', join(workDir, 'no-such-file.json')]), undefined, 'a missing contract must refuse');
	const publicOnly = join(workDir, 'public-only-no-endpoint.json');
	writeFileSync(publicOnly, JSON.stringify(PUBLIC_ONLY_CONTRACT));
	assert.throws(() => emitFile(['--api-contract', publicOnly]), undefined,
		'public-only builds must still require the canonical verdict endpoint tuple');
});

// ── the REAL contract, when this machine has it ──────────────────────────────

const realPath = process.env.SITE_API_TRANSPORT_CONTRACT || '';
test('the real contract: forwarding follows the contract, verdict follows a generated manifest', async (t) => {
	if (!realPath || !existsSync(realPath)) {
		console.log('  (skipped: set SITE_API_TRANSPORT_CONTRACT to reef apps/mixfairy/scripts/site-api-transport.contract.json)');
		return;
	}
	const real = JSON.parse(readFileSync(realPath, 'utf8'));
	const realManifestPath = join(workDir, 'real.verdict.json');
	writeFileSync(realManifestPath, JSON.stringify({ paths: ['/custom/2026/member-post'] }));
	const worker = await emitWorker([...SHOP_ARGS, '--api-contract', realPath, '--gated-manifest', realManifestPath]);
	const bindingName = real.bindingName;

	// every forward rule reaches the binding on its own first method — EXCEPT the
	// paths this same contract declares site-owned, which a newly emitted worker
	// composes into the site's own shell (site.platform: "Checkout result、
	// /membership and /account are all in this site-owned presentation class").
	// Their forward entries stay for already-emitted workers; the exemption is read
	// off the contract under test, never a path list written here — which is also why
	// an optional capability the contract does not carry yet exempts nothing.
	const siteOwnedPaths = new Set([
		...(real.siteOwnedBuyerPages || []).map((entry) => entry.path),
		...(real.subscribeResult ? [real.subscribeResult.path] : [])
	]);
	for (const rule of real.forward) {
		if (rule.match === 'exact' && siteOwnedPaths.has(rule.value)) continue;
		const path = rule.match === 'exact' ? rule.value : rule.value + 'probe';
		const { env, seenByRsp, seenByAssets } = makeEnv({ rsp: echoRsp, bindingName });
		await worker.mod.default.fetch(new Request('https://s.example' + path, { method: rule.methods[0] }), env);
		assert.equal(seenByRsp.length, 1, path + ' (' + rule.methods[0] + ') must forward');
		assert.deepEqual(seenByAssets, [], path + ' must not touch ASSETS');
	}

	// Contract exclusions are not a URL matcher. Every excluded family remains static
	// unless the renderer's generated set names the exact path.
	for (const rule of real.excluded) {
		const path = rule.match === 'exact' ? rule.value : rule.value + 'probe';
		const { env, seenByRsp, seenByAssets } = makeEnv({
			rsp: verdictRsp({ path, allow: true, reason: 'members_ok' }), bindingName
		});
		await worker.mod.default.fetch(new Request('https://s.example' + path), env);
		assert.deepEqual(seenByRsp, [], path + ' must not reach RSP without generated membership need');
		assert.equal(seenByAssets.length, 1, path + ' is the site\'s own answer');
	}
	const generated = makeEnv({
		rsp: verdictRsp({ path: '/custom/2026/member-post', allow: true, reason: 'members_ok' }), bindingName
	});
	const generatedRes = await worker.mod.default.fetch(new Request('https://s.example/custom/2026/member-post'), generated.env);
	assert.equal(generatedRes.status, 200);
	assert.equal(generated.seenByRsp.length, 1);

	// the near miss the plan names by hand
	const { env, seenByRsp } = makeEnv({ rsp: echoRsp, bindingName });
	const res = await worker.mod.default.fetch(new Request('https://s.example/apix'), env);
	assert.equal(await res.text(), 'STATIC:/apix');
	assert.deepEqual(seenByRsp, []);

	// and the binding-missing answer is the real contract's, read from the file
	const missing = makeEnv({ rsp: null, bindingName });
	const mres = await worker.mod.default.fetch(new Request('https://s.example/api/x'), missing.env);
	assert.equal(mres.status, real.onBindingMissing.status);
	assert.equal(mres.headers.get('cache-control'), real.onBindingMissing.cacheControl);
	assert.deepEqual(missing.seenByAssets, []);

	const un = makeEnv({ rsp: null, bindingName });
	const ures = await worker.mod.default.fetch(new Request('https://s.example/custom/2026/member-post'), un.env);
	assert.equal(ures.status, 503, 'a generated private path fails closed without RSP');
	assert.deepEqual(un.seenByAssets, []);
});
