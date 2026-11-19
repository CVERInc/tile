// The verdict gate compares paths the way the Pages asset server reads them. That server decodes
// the WHOLE pathname once (decodeURIComponent) before its lookup and answers a trailing slash with
// the directory's index.html (workers-sdk pages-shared/asset-server/handler.ts), so every spelling
// that decodes to a gated page must meet that page's rule, and a path that cannot be decoded is
// refused rather than handed to ASSETS. Public pages with escapes must still be served untouched.
//
// Two layers are exercised: matchVerdictRule on raw path strings (the function the emitter also
// uses at build time), and the emitted worker end to end, where the request first passes through
// the WHATWG URL parser exactly as it does at the edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchVerdictRule, verdictPathKey, verdictPathUnreadable } from './shop-function-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'verdict-path-key-'));

const GATED = '/devlog/members-only';
const CJK_SLUG = '會員專屬';
// The renderer's spelling of the CJK page: the emitter writes it through the URL parser, which
// escapes it with upper-case hex.
const CJK_GATED = new URL('/devlog/' + CJK_SLUG, 'http://site.invalid').pathname;
const CJK_UPPER = '/devlog/' + encodeURIComponent(CJK_SLUG) + '/';
const CJK_LOWER = CJK_UPPER.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());

const GATED_SPELLINGS = [
	'/devlog/members%2Donly/',
	'/devlog/%6Dembers-only/',
	'/devlog/members-only%2F',
	'/devlog//members-only/',
	'/devlog/./members-only/',
	'/devlog/x/../members-only/',
	'/devlog/members-only/index%2Ehtml',
	'/devlog/members-only/index.html',
	'/devlog/x%2F..%2Fmembers-only/',
	'/devlog/x/%2E%2E/members-only/',
];
const CJK_SPELLINGS = [CJK_UPPER, CJK_LOWER];
const MALFORMED = ['/devlog/members%2-only/', '/devlog/%E6%9C%83%E5-only/', '/%'];
const PUBLIC_SPELLINGS = [
	'/devlog/public%2Dpost/',
	'/devlog/%E5%85%AC%E9%96%8B/',
	'/devlog/%e5%85%ac%e9%96%8b/',
	'/devlog/members-only-not',
	'/devlog/members-onl%79x/',
	'/devlog/members%252Donly/',
	'/devlog/Members-only/',
];

const RULES = [{ match: 'exact', value: GATED }, { match: 'exact', value: CJK_GATED }];

test('matchVerdictRule: every decoded spelling of a gated page meets its rule', () => {
	for (const path of GATED_SPELLINGS) {
		assert.equal(matchVerdictRule(RULES, path)?.value, GATED, path);
		assert.equal(verdictPathKey(path), GATED, path);
	}
	for (const path of CJK_SPELLINGS) {
		assert.equal(matchVerdictRule(RULES, path)?.value, CJK_GATED, path);
		assert.equal(verdictPathKey(path), '/devlog/' + CJK_SLUG, path);
	}
});

test('matchVerdictRule: a rule written in decoded form meets the escaped request too', () => {
	const decodedRule = [{ match: 'exact', value: '/devlog/' + CJK_SLUG }];
	for (const path of CJK_SPELLINGS) assert.equal(matchVerdictRule(decodedRule, path)?.value, '/devlog/' + CJK_SLUG, path);
});

test('matchVerdictRule: a malformed escape has no key and is reported unreadable', () => {
	for (const path of MALFORMED) {
		assert.equal(verdictPathKey(path), null, path);
		assert.equal(matchVerdictRule(RULES, path), null, path);
		assert.equal(verdictPathUnreadable(RULES, path), true, path);
		assert.equal(verdictPathUnreadable([], path), false, path + ' (nothing gated)');
	}
	for (const path of [...GATED_SPELLINGS, ...PUBLIC_SPELLINGS]) assert.equal(verdictPathUnreadable(RULES, path), false, path);
});

test('matchVerdictRule: public spellings stay public; case is not folded', () => {
	for (const path of PUBLIC_SPELLINGS) assert.equal(matchVerdictRule(RULES, path), null, path);
});

test('matchVerdictRule: dot segments never climb above the root', () => {
	assert.equal(verdictPathKey('/../../devlog/members-only'), GATED);
	assert.equal(verdictPathKey('/%2E%2E/%2e%2e/devlog/members-only/'), GATED);
	assert.equal(verdictPathKey('/'), '/');
	assert.equal(verdictPathKey('/index.html'), '/');
	assert.equal(verdictPathKey('//'), '/');
});

test('matchVerdictRule: a prefix rule keeps its trailing slash boundary', () => {
	const prefix = [{ match: 'prefix', value: '/vault/' }];
	assert.equal(matchVerdictRule(prefix, '/vault/a')?.value, '/vault/');
	assert.equal(matchVerdictRule(prefix, '/vault%2Fa')?.value, '/vault/');
	assert.equal(matchVerdictRule(prefix, '/vaultx/a'), null);
});

// ── the emitted worker ───────────────────────────────────────────────────────

const contract = join(workDir, 'contract.json');
writeFileSync(contract, JSON.stringify({
	schemaVersion: 2,
	bindingName: 'RSP',
	forward: [{ match: 'prefix', value: '/api/', methods: ['GET'] }],
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));
const gatedManifest = join(workDir, 'gated.json');
writeFileSync(gatedManifest, JSON.stringify({ paths: [GATED + '/', '/devlog/' + CJK_SLUG] }));

function emit(args, name) {
	const out = join(workDir, name + '.mjs');
	execFileSync('node', [join(here, 'emit-shop-function.mjs'), '--api-contract', contract, ...args,
		'--api', 'https://api.example', '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
	return import(pathToFileURL(out).href);
}
const gatedSite = await emit(['--gated-manifest', gatedManifest], 'gated');
const ungatedSite = await emit([], 'ungated');

function makeEnv(verdict) {
	const seenByRsp = [];
	const seenByAssets = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				const url = new URL(typeof req === 'string' ? req : req.url);
				seenByAssets.push({ url, request: req });
				return new Response('STATIC:' + url.pathname, { status: 200 });
			}
		},
		RSP: {
			fetch: async (req) => {
				const url = new URL(req.url);
				seenByRsp.push(url);
				return Response.json(verdict);
			}
		}
	};
	return { env, seenByRsp, seenByAssets };
}

const DENY = { allow: false, reason: 'members_only' };
const ALLOW = { allow: true, reason: 'members_ok' };

test('worker: escaped spellings of a gated page are judged under the renderer path and refused on deny', async () => {
	for (const [path, canonical] of [...GATED_SPELLINGS.map((p) => [p, GATED]), ...CJK_SPELLINGS.map((p) => [p, CJK_GATED])]) {
		const { env, seenByRsp, seenByAssets } = makeEnv(DENY);
		const res = await gatedSite.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(res.status, 404, path);
		assert.equal(seenByRsp.length, 1, path + ' must ask for a verdict');
		assert.equal(seenByRsp[0].searchParams.get('path'), canonical, path);
		assert.deepEqual(seenByAssets, [], path + ' must not reach ASSETS');
	}
});

test('worker: an allowed escaped spelling serves the original request', async () => {
	const { env, seenByAssets } = makeEnv(ALLOW);
	const request = new Request('https://s.example/devlog/members%2Donly/');
	const res = await gatedSite.default.fetch(request, env);
	assert.equal(res.status, 200);
	assert.equal(seenByAssets.length, 1);
	assert.equal(seenByAssets[0].request, request);
});

test('worker: a malformed escape is refused without a verdict and never reaches ASSETS', async () => {
	for (const path of MALFORMED) {
		const { env, seenByRsp, seenByAssets } = makeEnv(ALLOW);
		const res = await gatedSite.default.fetch(new Request('https://s.example' + path), env);
		assert.equal(res.status, 404, path);
		assert.deepEqual(await res.json(), { error: 'blocked' }, path);
		assert.deepEqual(seenByRsp, [], path);
		assert.deepEqual(seenByAssets, [], path);
	}
	// A browser gets the site's refusal page: only the root shell is fetched, never the path.
	const { env, seenByAssets } = makeEnv(ALLOW);
	await gatedSite.default.fetch(new Request('https://s.example/devlog/members%2-only/', { headers: { accept: 'text/html' } }), env);
	assert.deepEqual(seenByAssets.map((s) => s.url.pathname), ['/']);
});

test('worker: public pages with escapes are served untouched (control)', async () => {
	for (const path of PUBLIC_SPELLINGS) {
		const { env, seenByRsp, seenByAssets } = makeEnv(DENY);
		const request = new Request('https://s.example' + path);
		const res = await gatedSite.default.fetch(request, env);
		assert.equal(res.status, 200, path);
		assert.deepEqual(seenByRsp, [], path);
		assert.equal(seenByAssets.length, 1, path);
		assert.equal(seenByAssets[0].request, request, path);
	}
});

test('worker: with nothing gated, a malformed escape is still the static site\'s (control)', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv(DENY);
	const request = new Request('https://s.example/devlog/members%2-only/');
	const res = await ungatedSite.default.fetch(request, env);
	assert.equal(res.status, 200);
	assert.deepEqual(seenByRsp, []);
	assert.equal(seenByAssets[0].request, request);
});
