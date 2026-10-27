// A gated-path refusal answers a browser (Accept includes text/html) with the site's own page
// composed into its root shell; every other caller, and every case with no usable shell, keeps the
// JSON refusal byte for byte. Emits a real worker and drives default.fetch with a mock RSP binding
// and mock ASSETS, same shape as emit-api-transport.test.mjs.
//
// The fixture contract deliberately uses paths and a binding name no product contract uses
// (/hub, /tiers, SEAMLINK): the worker must take the sign-in and join links from the contract's
// site-owned buyer pages by `kind`, never from a path literal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'gated-refusal-page-'));
const BINDING = 'SEAMLINK';
const BASE_CONTRACT = {
	schemaVersion: 2,
	bindingName: BINDING,
	verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
	onBindingMissing: { status: 599, cacheControl: 'private, no-store, fixture-marker' },
	forward: [{ match: 'prefix', value: '/zapi/', methods: ['GET', 'POST'] }],
	excluded: [{ match: 'prefix', value: '/vault/', disposition: 'verdict-required' }]
};
const PAGES = [
	{ path: '/tiers', method: 'GET', kind: 'membership', factsPath: '/zapi/tier-facts' },
	{ path: '/hub', method: 'GET', kind: 'account', factsPath: '/zapi/hub-facts' }
];
const manifestPath = join(workDir, 'gated.json');
writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, paths: ['/vault/post-1'] }));

let emitted = 0;
async function emitWorker(contract, gatedManifest = manifestPath) {
	const contractPath = join(workDir, 'contract-' + (++emitted) + '.json');
	writeFileSync(contractPath, JSON.stringify(contract));
	const out = join(workDir, 'worker-' + emitted + '.mjs');
	execFileSync('node', [join(here, 'emit-shop-function.mjs'), '--site-id', 'site-1', '--api-contract', contractPath,
		'--gated-manifest', gatedManifest, '--api', 'https://api.example', '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
	return (await import(pathToFileURL(out).href)).default;
}
const withPages = await emitWorker({ ...BASE_CONTRACT, siteOwnedBuyerPages: PAGES });
const withoutPages = await emitWorker(BASE_CONTRACT);
// The generated gated set itself contains the site root.
const rootManifestPath = join(workDir, 'gated-root.json');
writeFileSync(rootManifestPath, JSON.stringify({ schemaVersion: 1, paths: ['/', '/vault/post-1'] }));
const rootGated = await emitWorker(BASE_CONTRACT, rootManifestPath);

const shellOf = (lang) => '<!doctype html><html' + (lang ? ' lang="' + lang + '"' : '') + '><head><title>Donor</title>' +
	'<meta name="description" content="donor"></head><body><header>NAV</header><main><p>HOME</p></main><footer>FOOT</footer></body></html>';

function makeEnv({ verdict, shell = shellOf('en-US'), shellStatus = 200, binding = true, facts } = {}) {
	const factsSeen = [];
	const seenByAssets = [];
	const env = {
		ASSETS: { fetch: async (req) => {
			const url = new URL(typeof req === 'string' ? req : req.url);
			seenByAssets.push(url.pathname);
			if (url.pathname === '/') return new Response(shell, { status: shellStatus, headers: { 'content-type': 'text/html' } });
			return new Response('GATED-FILE-BYTES', { status: 200 });
		} }
	};
	if (binding) env[BINDING] = { fetch: async (req) => {
		if (new URL(req.url).pathname === '/zapi/hub-facts') {
			factsSeen.push(req.headers.get('cookie'));
			if (facts === 'throw') throw new Error('facts down');
			if (facts === undefined) return new Response('{}', { status: 404 });
			return new Response(JSON.stringify(facts), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (verdict === 'throw') throw new Error('down');
		return new Response(JSON.stringify(verdict), { status: 200, headers: { 'content-type': 'application/json' } });
	} };
	return { env, seenByAssets, factsSeen };
}
const HTML = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };
const ask = (worker, env, headers = HTML, path = '/vault/post-1') =>
	worker.fetch(new Request('https://s.example' + path + '?x=1', { headers }), env);

const PENDING = { allow: false, reason: 'membership_pending' };
const UNDECIDABLE = { allow: false, reason: 'undecidable' };
const MEMBERS = { allow: false, reason: 'members_only' };

test('membership_pending: payment-received page, 404, no-store, reload link to the same path', async () => {
	const { env, seenByAssets } = makeEnv({ verdict: PENDING });
	const res = await ask(withPages, env);
	const html = await res.text();
	assert.equal(res.status, 404);
	assert.equal(res.headers.get('cache-control'), 'private, no-store');
	assert.match(res.headers.get('content-type'), /^text\/html/);
	assert.match(html, /data-ejecta-gate-state="pending"/);
	assert.match(html, /We received your payment\. Reload this page in a moment\./);
	assert.match(html, /<a class="st-runtime-action" href="\/vault\/post-1\?x=1">Reload<\/a>/);
	assert.match(html, /<title>Your access is on its way<\/title>/);
	assert.match(html, /<meta name="robots" content="noindex">/);
	assert.match(html, /<header>NAV<\/header>/, 'the site shell is kept');
	assert.doesNotMatch(html, /HOME|Donor|donor/, 'the donor main and head metadata are replaced');
	assert.deepEqual(seenByAssets, ['/'], 'only the root shell is fetched, never the gated file');
});

test('undecidable, unavailable verdict and missing binding: try-again page with their own status', async () => {
	for (const [name, args, status] of [
		['undecidable', { verdict: UNDECIDABLE }, 404],
		['unavailable', { verdict: 'throw' }, 502],
		['binding missing', { verdict: null, binding: false }, 503]
	]) {
		const { env, seenByAssets } = makeEnv(args);
		const res = await ask(withPages, env);
		const html = await res.text();
		assert.equal(res.status, status, name);
		assert.equal(res.headers.get('cache-control'), 'private, no-store', name);
		assert.match(html, /data-ejecta-gate-state="retry"/, name);
		assert.match(html, /Please try again\./, name);
		assert.match(html, /href="\/vault\/post-1\?x=1">Try again<\/a>/, name);
		assert.doesNotMatch(html, /Members only|not a member/i, name + ': an outage is never phrased as a refusal');
		assert.deepEqual(seenByAssets, ['/'], name);
	}
});

test('members_only and an unrecognised reason: members-only page with links taken from the contract', async () => {
	for (const verdict of [MEMBERS, { allow: false, reason: 'something_new' }, { allow: false }]) {
		const { env, seenByAssets } = makeEnv({ verdict });
		const res = await ask(withPages, env);
		const html = await res.text();
		assert.equal(res.status, 404);
		assert.match(html, /data-ejecta-gate-state="members-only"/);
		assert.match(html, /<title>Members only<\/title>/);
		assert.match(html, /<a class="st-runtime-action" href="\/hub">Sign in<\/a>/);
		assert.match(html, /<a class="st-runtime-action" href="\/tiers">Join<\/a>/);
		assert.deepEqual(seenByAssets, ['/']);
	}
});

test('members_only for a signed-in reader: no sign-in prompt, join link kept', async () => {
	const { env, seenByAssets, factsSeen } = makeEnv({ verdict: MEMBERS, facts: { signed_in: true } });
	const res = await withPages.fetch(new Request('https://s.example/vault/post-1', { headers: { ...HTML, cookie: 'sid=1' } }), env);
	const html = await res.text();
	assert.equal(res.status, 404);
	assert.match(html, /data-ejecta-gate-state="members-only"/);
	assert.match(html, /<title>Members only<\/title>/);
	assert.match(html, /Your account doesn't have access to this page yet\. If you've already paid, it opens once the site confirms your membership; if not, join to view it\./);
	assert.doesNotMatch(html, /Sign in/);
	assert.match(html, /<a class="st-runtime-action" href="\/tiers">Join<\/a>/);
	assert.deepEqual(factsSeen, ['sid=1'], 'the visitor headers ride along on the facts read');
	assert.deepEqual(seenByAssets, ['/']);
});

test('members_only signed-in copy follows the site language', async () => {
	const { env } = makeEnv({ verdict: MEMBERS, facts: { signed_in: true }, shell: shellOf('zh-TW') });
	const html = await (await ask(withPages, env)).text();
	assert.match(html, /目前登入的帳號還沒有這個頁面的存取權。如果你已經付款，網站確認你的會員資格後就能查看；還沒加入的話，加入後即可查看。/);
	assert.doesNotMatch(html, /登入<\/a>/);
});

test('members_only: unreadable, malformed or signed-out facts keep the sign-in copy', async () => {
	for (const [name, facts] of [['throws', 'throw'], ['non-2xx', undefined], ['signed_in false', { signed_in: false }], ['signed_in not boolean', { signed_in: 'true' }], ['missing', {}]]) {
		const { env } = makeEnv({ verdict: MEMBERS, facts });
		const html = await (await ask(withPages, env)).text();
		assert.match(html, /Sign in or join to view this page\./, name);
		assert.match(html, /href="\/hub">Sign in<\/a>/, name);
		assert.doesNotMatch(html, /doesn't have access/, name);
	}
});

test('facts are read only for a members-only refusal', async () => {
	for (const verdict of [PENDING, UNDECIDABLE]) {
		const { env, factsSeen } = makeEnv({ verdict, facts: { signed_in: true } });
		await (await ask(withPages, env)).text();
		assert.deepEqual(factsSeen, []);
	}
	const { env, factsSeen } = makeEnv({ verdict: MEMBERS, facts: { signed_in: true } });
	await ask(withPages, env, { accept: 'application/json' });
	assert.deepEqual(factsSeen, []);
});

test('a contract without the buyer pages omits the sign-in and join links', async () => {
	const { env } = makeEnv({ verdict: MEMBERS });
	const html = await (await ask(withoutPages, env)).text();
	assert.match(html, /data-ejecta-gate-state="members-only"/);
	assert.doesNotMatch(html, /<a /);
});

test('only one page kind in the contract: only that link', async () => {
	const worker = await emitWorker({ ...BASE_CONTRACT, siteOwnedBuyerPages: [PAGES[1]] });
	const html = await (await ask(worker, makeEnv({ verdict: MEMBERS }).env)).text();
	assert.match(html, /href="\/hub">Sign in</);
	assert.doesNotMatch(html, />Join</);
});

test('locale comes from the shell lang, per state, in all four locales', async () => {
	const expected = {
		'en-US': ['Your access is on its way', "We can't check your access right now", 'Members only'],
		'ja-JP': ['アクセスの準備中です', '現在アクセス権を確認できません', 'メンバー限定'],
		'zh-TW': ['存取權限準備中', '目前無法確認你的存取權限', '會員專屬'],
		'zh-CN': ['访问权限准备中', '目前无法确认你的访问权限', '会员专属']
	};
	for (const [lang, titles] of Object.entries(expected)) {
		for (const [i, verdict] of [PENDING, UNDECIDABLE, MEMBERS].entries()) {
			const html = await (await ask(withPages, makeEnv({ verdict, shell: shellOf(lang) }).env)).text();
			assert.ok(html.includes('<h1>' + titles[i].replace("'", "&#39;") + '</h1>') || html.includes('<h1>' + titles[i] + '</h1>'), lang + ' ' + i);
		}
	}
	const zhCN = await (await ask(withPages, makeEnv({ verdict: MEMBERS, shell: shellOf('zh-CN') }).env)).text();
	assert.match(zhCN, />登录</, 'Simplified Chinese uses its own forms');
	const unknownLang = await (await ask(withPages, makeEnv({ verdict: MEMBERS, shell: shellOf('') }).env)).text();
	assert.match(unknownLang, /<h1>Members only<\/h1>/, 'no declared language reads as the table default');
});

test('JSON refusals stay byte for byte when Accept lacks text/html', async () => {
	for (const headers of [{}, { accept: 'application/json' }, { accept: '*/*' }, { accept: 'text/markdown' }, { accept: 'text/html;q=0' }]) {
		for (const [args, status, body] of [
			[{ verdict: MEMBERS }, 404, '{"error":"blocked"}'],
			[{ verdict: PENDING }, 404, '{"error":"blocked"}'],
			[{ verdict: 'throw' }, 502, '{"error":"site_verdict_unavailable"}'],
			[{ verdict: null, binding: false }, 503, '{"error":"site_verdict_binding_missing"}']
		]) {
			const { env, seenByAssets } = makeEnv(args);
			const res = await ask(withPages, env, headers);
			assert.equal(res.status, status);
			assert.equal(await res.text(), body);
			assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
			assert.equal(res.headers.get('cache-control'), 'private, no-store');
			assert.deepEqual(seenByAssets, []);
		}
	}
});

test('no usable shell: today\'s exact JSON answer (not ok, no <main>, root itself gated)', async () => {
	const cases = [
		['shell 404', withPages, { verdict: MEMBERS, shellStatus: 404 }],
		['shell without main', withPages, { verdict: MEMBERS, shell: '<html lang="en-US"><head></head><body>x</body></html>' }],
		['root is gated', rootGated, { verdict: MEMBERS }]
	];
	for (const [name, worker, args] of cases) {
		const { env, seenByAssets } = makeEnv(args);
		const res = await ask(worker, env);
		assert.equal(res.status, 404, name);
		assert.equal(await res.text(), '{"error":"blocked"}', name);
		assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8', name);
		assert.equal(res.headers.get('cache-control'), 'private, no-store', name);
		assert.ok(!seenByAssets.includes('/vault/post-1'), name + ': the gated file is never fetched');
	}
});

test('an allowed verdict still serves the gated file, HTML Accept or not', async () => {
	const { env } = makeEnv({ verdict: { allow: true, reason: 'members_ok' } });
	const res = await ask(withPages, env);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), 'GATED-FILE-BYTES');
});
