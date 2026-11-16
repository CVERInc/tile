// A members-only refusal whose verdict says the site has no members: no sign-in or join prompt.
// Same worker harness as gated-refusal-page.test.mjs.
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
const ask = (worker, env, headers = HTML) =>
	worker.fetch(new Request('https://s.example/vault/post-1?x=1', { headers }), env);
const mainOf = (html) => html.match(/<section class="st-runtime"[\s\S]*?<\/section>/)[0];

const MEMBERS = { allow: false, reason: 'members_only' };
const ABSENT = { allow: false, reason: 'members_only', site_members: 'absent' };

const SENTENCE = {
	'en-US': 'This post is for members of this site.',
	'ja-JP': 'この投稿は、このサイトのメンバー向けです。',
	'zh-TW': '這篇文章是給這個網站的會員看的。',
	'zh-CN': '这篇文章是给这个网站的会员看的。'
};

test('site_members absent: members-only title, status and headers kept, no links, one sentence per language', async () => {
	for (const [lang, sentence] of Object.entries(SENTENCE)) {
		const res = await ask(withPages, makeEnv({ verdict: ABSENT, shell: shellOf(lang) }).env);
		const html = await res.text();
		assert.equal(res.status, 404, lang);
		assert.equal(res.headers.get('cache-control'), 'private, no-store', lang);
		assert.match(res.headers.get('content-type'), /^text\/html/, lang);
		assert.match(html, /data-ejecta-gate-state="members-only"/, lang);
		assert.ok(html.includes('<p class="st-runtime-status" role="status">' + sentence + '</p>'), lang);
		assert.doesNotMatch(mainOf(html), /<a /, lang);
		assert.doesNotMatch(html, /href="\/hub"|href="\/tiers"/, lang);
	}
	const en = await (await ask(withPages, makeEnv({ verdict: ABSENT }).env)).text();
	assert.match(en, /<title>Members only<\/title>/);
	assert.match(en, /<h1>Members only<\/h1>/);
});

test('site_members absent: no account-facts read, even with a session cookie', async () => {
	const { env, factsSeen, seenByAssets } = makeEnv({ verdict: ABSENT, facts: { signed_in: true } });
	const res = await withPages.fetch(new Request('https://s.example/vault/post-1', { headers: { ...HTML, cookie: 'sid=1' } }), env);
	const html = await res.text();
	assert.match(html, /This post is for members of this site\./);
	assert.deepEqual(factsSeen, []);
	assert.deepEqual(seenByAssets, ['/']);
});

test('only the exact value "absent" changes the page', async () => {
	const { env: baseEnv } = makeEnv({ verdict: MEMBERS });
	const base = mainOf(await (await ask(withPages, baseEnv)).text());
	for (const value of ['present', 'Absent', '', true, null, 1, ['absent']]) {
		const { env } = makeEnv({ verdict: { ...MEMBERS, site_members: value } });
		assert.equal(mainOf(await (await ask(withPages, env)).text()), base, JSON.stringify(value));
	}
});

test('without the field the members-only page is exactly the previous output, signed out and signed in', async () => {
	const signedOut = `<section class="st-runtime" data-ejecta-gate="" data-ejecta-gate-state="members-only">
<h1>Members only</h1>
<p class="st-runtime-status" role="status">Sign in or join to view this page.</p>
<p><a class="st-runtime-action" href="/hub">Sign in</a> <a class="st-runtime-action" href="/tiers">Join</a></p>
</section>`;
	const signedIn = `<section class="st-runtime" data-ejecta-gate="" data-ejecta-gate-state="members-only">
<h1>Members only</h1>
<p class="st-runtime-status" role="status">Your account doesn't have access to this page yet. If you've already paid, it opens once the site confirms your membership; if not, join to view it.</p>
<p><a class="st-runtime-action" href="/tiers">Join</a></p>
</section>`;
	const out = mainOf(await (await ask(withPages, makeEnv({ verdict: MEMBERS }).env)).text());
	assert.equal(out.replace(/&#39;/g, "'"), signedOut);
	const inn = await withPages.fetch(new Request('https://s.example/vault/post-1', { headers: { ...HTML, cookie: 'sid=1' } }), makeEnv({ verdict: MEMBERS, facts: { signed_in: true } }).env);
	assert.equal(mainOf(await inn.text()).replace(/&#39;/g, "'"), signedIn);
});

test('site_members absent does not touch pending, retry or JSON answers', async () => {
	for (const [verdict, state] of [[{ allow: false, reason: 'membership_pending', site_members: 'absent' }, 'pending'], [{ allow: false, reason: 'undecidable', site_members: 'absent' }, 'retry']]) {
		const html = await (await ask(withPages, makeEnv({ verdict }).env)).text();
		assert.match(html, new RegExp('data-ejecta-gate-state="' + state + '"'));
		assert.match(html, /<a class="st-runtime-action" href="\/vault\/post-1\?x=1">/);
		assert.doesNotMatch(html, /members of this site/);
	}
	const res = await ask(withPages, makeEnv({ verdict: ABSENT }).env, { accept: 'application/json' });
	assert.equal(res.status, 404);
	assert.equal(await res.text(), '{"error":"blocked"}');
});
