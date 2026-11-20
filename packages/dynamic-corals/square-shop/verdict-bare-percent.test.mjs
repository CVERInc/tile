// A members-only page is gated under the name of the file the static build writes for it.
//
// The renderer writes each members-only path as the page's route param, and the build names the
// page's file after that param once Astro has sanitised it: Unicode NFC, `#` as `%23`, `?` as
// `%3F`. Every `%` left is a literal character of the name (a `100%` slug is written to
// `100%/index.html`, a `100%-%41` slug to `100%-%41/index.html`, a `c#-tips` slug to
// `c%23-tips/index.html`), and a path whose escapes would decode to a different string fails that
// build. The Pages asset server decodes a request path once and, when that decode fails, looks
// the path up as the literal string it is. So every spelling that reaches a members-only file
// must be judged: the escaped spelling of its name (any `%` as `%25`, any non-ASCII byte, space
// or control character escaped) with and without the trailing slash and the explicit
// index.html, and the renderer's own unencoded link. A public page must stay public, and a
// page's own URL is never respelled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchVerdictRule, verdictPathKey, verdictPathUnreadable } from './shop-function-template.js';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'verdict-bare-percent-'));

// [manifest value as the renderer writes it, the rule it must be baked as, the file's directory].
// `100%41` cannot be built by the renderer today (its route decodes to `100A`); it is here so a
// value with a literal `%XX` and no bare `%` is keyed as its file too.
const GATED = [
	['/devlog/100%', '/devlog/100%25', '/devlog/100%'],
	['/devlog/50%off/', '/devlog/50%25off', '/devlog/50%off'],
	['/devlog/100%-%41', '/devlog/100%25-%2541', '/devlog/100%-%41'],
	['/devlog/100%41/', '/devlog/100%2541', '/devlog/100%41'],
	['/devlog/sale%/members-post/', '/devlog/sale%25/members-post', '/devlog/sale%/members-post'],
	['/devlog/路障', '/devlog/%E8%B7%AF%E9%9A%9C', '/devlog/路障'],
	['/devlog/🎉party', '/devlog/%F0%9F%8E%89party', '/devlog/🎉party'],
	['/devlog/a b/', '/devlog/a%20b', '/devlog/a b'],
	['/devlog/members-only/', '/devlog/members-only', '/devlog/members-only'],
	// Astro's sanitised names: `#` and `?` written as `%23` and `%3F`, NFD written as NFC.
	['/devlog/c#-tips', '/devlog/c%2523-tips', '/devlog/c%23-tips'],
	['/devlog/why?', '/devlog/why%253F', '/devlog/why%3F'],
	['/devlog/q?a#b/', '/devlog/q%253Fa%2523b', '/devlog/q%3Fa%23b'],
	['/devlog/cafe\u0301', '/devlog/caf%C3%A9', '/devlog/caf\u00e9'],
	// A trailing space and a control character stay in the name.
	['/devlog/trail ', '/devlog/trail%20', '/devlog/trail '],
	['/devlog/lead\u0001ctl', '/devlog/lead%01ctl', '/devlog/lead\u0001ctl'],
	['/devlog/a+b:c@d,e;f=g&h$i!', '/devlog/a+b:c@d,e;f=g&h$i!', '/devlog/a+b:c@d,e;f=g&h$i!'],
];
// Public neighbours, including the names the members-only paths above used to be keyed as. (No
// NFD name: the build writes every file name in NFC, and an NFD request for an NFC members-only
// name is judged, below.)
const PUBLIC = ['/devlog/7%public', '/devlog/100%-%42', '/devlog/公開', '/devlog/100A', '/devlog/100%25',
	'/devlog/c', '/devlog/why', '/devlog/q', '/devlog/trail', '/devlog/caf\u00e9-public'];

const escapeName = (file) => file.split('/').map(encodeURIComponent).join('/');
const lowerHex = (path) => path.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
// What the asset server looks a request path up as (decoded once; the literal path when the
// decode fails), with the trailing slash and the explicit index.html folded onto the directory.
function assetLookup(pathname) {
	let p = pathname;
	try { p = decodeURIComponent(pathname); } catch { /* the literal path */ }
	if (p.endsWith('/index.html')) p = p.slice(0, -'/index.html'.length);
	return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}
// The request spellings tried for one file: escaped (both hex cases), the renderer's raw link,
// and escaped twice; each bare, with a trailing slash and with /index.html.
function spellingsOf(file) {
	const escaped = escapeName(file);
	const bases = [escaped, lowerHex(escaped), file, escaped.replace(/%/g, '%25')];
	return [...new Set(bases.flatMap((b) => [b, b + '/', b + '/index.html']))];
}
const pathnameOf = (spelling) => new URL('https://s.example' + spelling).pathname;

test('matchVerdictRule: a baked rule meets every request the asset server resolves to its file', () => {
	const rules = GATED.map(([, value]) => ({ match: 'exact', value }));
	for (const [, baked, file] of GATED) {
		let reaching = 0;
		for (const spelling of spellingsOf(file)) {
			const pathname = pathnameOf(spelling);
			if (assetLookup(pathname) !== file) continue;
			reaching += 1;
			assert.equal(matchVerdictRule(rules, pathname)?.value, baked, spelling);
		}
		assert.ok(reaching >= 3, file + ': the escaped spelling, its slash form and its index.html form reach the file');
	}
});

test('matchVerdictRule: the two spellings that reached a members-only file with a literal %XX are judged', () => {
	const rules = [{ match: 'exact', value: '/devlog/100%25-%2541' }, { match: 'exact', value: '/devlog/100%2541' }];
	assert.equal(matchVerdictRule(rules, '/devlog/100%25-%2541/')?.value, '/devlog/100%25-%2541');
	assert.equal(matchVerdictRule(rules, '/devlog/100%-%41/')?.value, '/devlog/100%25-%2541');
	assert.equal(matchVerdictRule(rules, '/devlog/100%2541/')?.value, '/devlog/100%2541');
	// `/devlog/100%41/` and `/devlog/100%25-%41` decode to other names (`100A`, `100%-A`).
	assert.equal(matchVerdictRule(rules, '/devlog/100%41/'), null);
	assert.equal(matchVerdictRule(rules, '/devlog/100%25-%41'), null);
});

test('matchVerdictRule: the spellings that reached a sanitised name (`#`, `?`, NFD) are judged', () => {
	const rules = [{ match: 'exact', value: '/devlog/c%2523-tips' }, { match: 'exact', value: '/devlog/why%253F' },
		{ match: 'exact', value: '/devlog/caf%C3%A9' }];
	assert.equal(matchVerdictRule(rules, '/devlog/c%2523-tips/')?.value, '/devlog/c%2523-tips');
	assert.equal(matchVerdictRule(rules, '/devlog/why%253F/')?.value, '/devlog/why%253F');
	assert.equal(matchVerdictRule(rules, '/devlog/caf%C3%A9/')?.value, '/devlog/caf%C3%A9');
	// The names these used to be keyed as are other pages.
	for (const path of ['/devlog/c', '/devlog/why']) assert.equal(matchVerdictRule(rules, path), null, path);
});

test('matchVerdictRule: an NFD spelling of a members-only page is judged; one of a public page stays public', () => {
	const rules = [{ match: 'exact', value: '/devlog/caf%C3%A9' }];
	for (const path of ['/devlog/cafe%CC%81/', '/devlog/cafe%cc%81', '/devlog/cafe%CC%81/index.html']) {
		assert.equal(matchVerdictRule(rules, path)?.value, '/devlog/caf%C3%A9', path);
	}
	for (const path of ['/devlog/cafe%CC%81-public/', '/devlog/cafe', '/devlog/cafe%CC%81%CC%81/']) assert.equal(matchVerdictRule(rules, path), null, path);
});

test('matchVerdictRule: a rule still written unescaped is keyed as the literal name', () => {
	const rules = [{ match: 'exact', value: '/devlog/100%' }, { match: 'exact', value: '/devlog/100%-%41' }];
	for (const path of ['/devlog/100%25', '/devlog/100%', '/devlog/100%/index.html']) assert.equal(matchVerdictRule(rules, path)?.value, '/devlog/100%', path);
	for (const path of ['/devlog/100%25-%2541/', '/devlog/100%-%41']) assert.equal(matchVerdictRule(rules, path)?.value, '/devlog/100%-%41', path);
});

test('matchVerdictRule: public pages with a % stay public; the strict key and the unreadable refusal are unchanged', () => {
	const rules = GATED.map(([, value]) => ({ match: 'exact', value }));
	for (const file of PUBLIC) {
		const escaped = escapeName(file);
		for (const path of [escaped, escaped + '/']) {
			assert.equal(matchVerdictRule(rules, path), null, path);
			assert.equal(verdictPathUnreadable(rules, path), false, path);
		}
	}
	// A raw `%` that meets no rule cannot be compared strictly, so a gated site still refuses it.
	assert.equal(verdictPathKey('/devlog/7%public'), null);
	assert.equal(matchVerdictRule(rules, '/devlog/7%public'), null);
	assert.equal(verdictPathUnreadable(rules, '/devlog/7%public'), true);
	assert.equal(verdictPathUnreadable([], '/devlog/7%public'), false);
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
writeFileSync(gatedManifest, JSON.stringify({ paths: GATED.map(([value]) => value) }));

function emitFile(args, name) {
	const out = join(workDir, name + '.mjs');
	execFileSync('node', [join(here, 'emit-shop-function.mjs'), '--api-contract', contract, ...args,
		'--api', 'https://api.example', '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
	return out;
}
const gatedOut = emitFile(['--gated-manifest', gatedManifest], 'gated');
const gatedSite = await import(pathToFileURL(gatedOut).href);

function bakedVerdictValues(file) {
	const line = readFileSync(file, 'utf8').split('\n').find((l) => /^\s*const CFG = /.test(l));
	assert.ok(line, 'the emitted worker bakes a CFG line');
	const cfg = JSON.parse(line.replace(/^\s*const CFG = /, '').replace(/;\s*$/, ''));
	return cfg.apiTransport.verdict.map((rule) => { assert.equal(rule.match, 'exact'); return rule.value; });
}

// ASSETS serves a file by the asset server's lookup; members-only bodies are marked.
const BODIES = new Map([...GATED.map(([, , file]) => [file, 'MEMBERS ' + file]), ...PUBLIC.map((file) => [file, 'PUBLIC ' + file])]);
function makeEnv(verdict) {
	const seenByRsp = [];
	const seenByAssets = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				seenByAssets.push(req);
				const body = BODIES.get(assetLookup(new URL(req.url).pathname));
				return body ? new Response(body, { status: 200 }) : new Response('Not Found', { status: 404 });
			}
		},
		RSP: {
			fetch: async (req) => {
				seenByRsp.push(new URL(req.url));
				return Response.json(verdict);
			}
		}
	};
	return { env, seenByRsp, seenByAssets };
}
const DENY = { allow: false, reason: 'members_only' };
const ALLOW = { allow: true, reason: 'members_ok' };

test('emitter: each members-only path is baked as its file name; a plain path exactly as before', () => {
	assert.deepEqual(bakedVerdictValues(gatedOut), GATED.map(([, baked]) => baked));
});

test('worker: no spelling of a members-only page serves it without a verdict; the ones that reach it are judged', async () => {
	for (const [, baked, file] of GATED) {
		for (const spelling of spellingsOf(file)) {
			const request = new Request('https://s.example' + spelling);
			const { env, seenByRsp } = makeEnv(DENY);
			const res = await gatedSite.default.fetch(request, env);
			assert.equal((await res.text()).startsWith('MEMBERS '), false, spelling + ' served a members-only page');
			if (assetLookup(new URL(request.url).pathname) === file) {
				assert.equal(res.status, 404, spelling);
				assert.equal(seenByRsp.length, 1, spelling + ' must ask for a verdict');
				assert.equal(seenByRsp[0].searchParams.get('path'), baked, spelling);
			}
		}
	}
});

test('worker: a member is served the page from its raw link and its escaped spelling', async () => {
	for (const [, , file] of GATED) {
		for (const spelling of [escapeName(file) + '/', file]) {
			const request = new Request('https://s.example' + spelling);
			if (assetLookup(new URL(request.url).pathname) !== file) continue;
			const { env, seenByRsp, seenByAssets } = makeEnv(ALLOW);
			const res = await gatedSite.default.fetch(request, env);
			assert.equal(res.status, 200, spelling);
			assert.equal(await res.text(), 'MEMBERS ' + file, spelling);
			assert.equal(seenByRsp.length, 1, spelling);
			assert.equal(seenByAssets[0], request, spelling + ' serves the original request');
		}
	}
});

test('worker: an NFD request for an NFC members-only page asks for a verdict', async () => {
	const { env, seenByRsp, seenByAssets } = makeEnv(DENY);
	const res = await gatedSite.default.fetch(new Request('https://s.example/devlog/cafe%CC%81/'), env);
	assert.equal(res.status, 404);
	assert.equal(seenByRsp.length, 1);
	assert.equal(seenByRsp[0].searchParams.get('path'), '/devlog/caf%C3%A9');
	assert.deepEqual(seenByAssets, []);
});

test('worker: a public page with a % is served without a verdict (control)', async () => {
	for (const file of PUBLIC) {
		const escaped = escapeName(file);
		for (const spelling of [escaped, escaped + '/', escaped + '/index.html']) {
			const request = new Request('https://s.example' + spelling);
			const { env, seenByRsp, seenByAssets } = makeEnv(DENY);
			const res = await gatedSite.default.fetch(request, env);
			assert.equal(res.status, 200, spelling);
			assert.equal(await res.text(), 'PUBLIC ' + file, spelling);
			assert.deepEqual(seenByRsp, [], spelling);
			assert.equal(seenByAssets[0], request, spelling);
		}
	}
});

test('emitter: a markdown twin of a members-only page with a % is refused', () => {
	for (const [i, path] of ['/devlog/100%', '/devlog/100%-%41/', '/devlog/50%off', '/devlog/100%41'].entries()) {
		const mapping = join(workDir, 'collide-' + i + '.json');
		writeFileSync(mapping, JSON.stringify({ schemaVersion: 1, routes: [{ path, asset: '/devlog/x.md' }] }));
		assert.throws(() => emitFile(['--gated-manifest', gatedManifest, '--markdown-manifest', mapping], 'collide-' + i),
			(e) => String(e.stderr).includes('maps the gated path'), path);
	}
	// A public page with a % keeps its markdown twin, in its own spelling.
	const publicMapping = join(workDir, 'public.json');
	writeFileSync(publicMapping, JSON.stringify({ schemaVersion: 1, routes: [{ path: '/devlog/7%public', asset: '/devlog/7%public.md' }] }));
	const out = readFileSync(emitFile(['--gated-manifest', gatedManifest, '--markdown-manifest', publicMapping], 'public'), 'utf8');
	assert.ok(out.includes('"/devlog/7%public"'), 'the public route is baked in its own spelling');
});
