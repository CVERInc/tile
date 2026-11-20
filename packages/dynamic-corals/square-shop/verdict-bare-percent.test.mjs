// A post slug may hold a bare `%` — one not followed by two hex digits (`100%`, `50%off`), from
// its file name, its frontmatter, or a category in its permalink. The renderer keeps that `%`
// unencoded in the page's URL and writes the page to a file of that literal name, and the Pages
// asset server reaches the file from the `%25` spelling, which decodes to the name. So a
// members-only page with such a slug must be gated under every spelling that reaches its file:
// `%25` with and without the trailing slash and the explicit index.html, and the raw `%` the
// renderer's own links send. A public page with a `%` must stay public, and the page's URL is
// not respelled anywhere but in the gated set.
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

// The members-only manifest as the renderer writes it: the post URLs, `%` left bare.
const MANIFEST_PATHS = ['/devlog/100%', '/devlog/50%off/', '/devlog/sale%/members-post/', '/devlog/members-only/'];
// The verdict rule each one must be baked as, and the file the asset server serves for it.
const BAKED = ['/devlog/100%25', '/devlog/50%25off', '/devlog/sale%25/members-post', '/devlog/members-only'];
const FILES = ['/devlog/100%', '/devlog/50%off', '/devlog/sale%/members-post', '/devlog/members-only'];

// Every spelling of each members-only page that reaches its file, with the rule it must meet.
function spellings(file, baked) {
	const escaped = file.replace(/%/g, '%25');
	return [escaped, escaped + '/', escaped + '/index.html', file, file + '/', file + '/index.html']
		.map((path) => [path, baked]);
}
const GATED_REQUESTS = FILES.flatMap((file, i) => spellings(file, BAKED[i]));
const PUBLIC_ESCAPED = ['/devlog/7%25public', '/devlog/7%25public/', '/devlog/100%25x', '/devlog/100%2525', '/devlog/50%25of/'];

test('matchVerdictRule: a rule baked with %25 meets every spelling of the page, raw % included', () => {
	const rules = BAKED.map((value) => ({ match: 'exact', value }));
	for (const [path, baked] of GATED_REQUESTS) assert.equal(matchVerdictRule(rules, path)?.value, baked, path);
});

test('matchVerdictRule: a rule still written with a bare % (not respelled by the emitter) is keyed as the file', () => {
	const rules = FILES.map((value) => ({ match: 'exact', value }));
	for (const [path, file] of FILES.flatMap((f) => spellings(f, f))) assert.equal(matchVerdictRule(rules, path)?.value, file, path);
});

test('matchVerdictRule: public pages with a % stay public; the strict key and the unreadable refusal are unchanged', () => {
	const rules = BAKED.map((value) => ({ match: 'exact', value }));
	for (const path of PUBLIC_ESCAPED) {
		assert.equal(matchVerdictRule(rules, path), null, path);
		assert.equal(verdictPathUnreadable(rules, path), false, path);
	}
	// A raw bare % that meets no rule still cannot be compared strictly, so a gated site refuses it.
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
writeFileSync(gatedManifest, JSON.stringify({ paths: MANIFEST_PATHS }));

function emitArgs(args, out) {
	return [join(here, 'emit-shop-function.mjs'), '--api-contract', contract, ...args, '--api', 'https://api.example', '--out', out];
}
function emitFile(args, name) {
	const out = join(workDir, name + '.mjs');
	execFileSync('node', emitArgs(args, out), { stdio: ['ignore', 'ignore', 'pipe'] });
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

function makeEnv(verdict) {
	const seenByRsp = [];
	const seenByAssets = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				seenByAssets.push(req);
				return new Response('STATIC', { status: 200 });
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

test('emitter: a members-only path with a bare % is baked with %25, every other path as before', () => {
	assert.deepEqual(bakedVerdictValues(gatedOut), BAKED);
});

test('worker: every spelling of a members-only page with a bare % is judged and refused on deny', async () => {
	for (const [path, baked] of GATED_REQUESTS) {
		const request = new Request('https://s.example' + path);
		const { env, seenByRsp, seenByAssets } = makeEnv(DENY);
		const res = await gatedSite.default.fetch(request, env);
		assert.equal(res.status, 404, path);
		assert.equal(seenByRsp.length, 1, path + ' must ask for a verdict');
		assert.equal(seenByRsp[0].searchParams.get('path'), baked, path);
		assert.deepEqual(seenByAssets, [], path + ' must not reach ASSETS');
	}
});

test('worker: a member is served the page from its raw and its escaped spelling', async () => {
	for (const path of ['/devlog/100%', '/devlog/100%25/']) {
		const request = new Request('https://s.example' + path);
		const { env, seenByRsp, seenByAssets } = makeEnv(ALLOW);
		const res = await gatedSite.default.fetch(request, env);
		assert.equal(res.status, 200, path);
		assert.equal(seenByRsp.length, 1, path);
		assert.equal(seenByAssets.length, 1, path);
		assert.equal(seenByAssets[0], request, path + ' serves the original request');
	}
});

test('worker: a public page with a % is served without a verdict (control)', async () => {
	for (const path of PUBLIC_ESCAPED) {
		const request = new Request('https://s.example' + path);
		const { env, seenByRsp, seenByAssets } = makeEnv(DENY);
		const res = await gatedSite.default.fetch(request, env);
		assert.equal(res.status, 200, path);
		assert.deepEqual(seenByRsp, [], path);
		assert.equal(seenByAssets[0], request, path);
	}
});

test('emitter: a markdown twin of a members-only page with a bare % is refused', () => {
	for (const [i, path] of ['/devlog/100%', '/devlog/100%25/', '/devlog/50%off'].entries()) {
		const mapping = join(workDir, 'collide-' + i + '.json');
		writeFileSync(mapping, JSON.stringify({ schemaVersion: 1, routes: [{ path, asset: '/devlog/x.md' }] }));
		assert.throws(() => emitFile(['--gated-manifest', gatedManifest, '--markdown-manifest', mapping], 'collide-' + i),
			(e) => String(e.stderr).includes('maps the gated path'), path);
	}
	// A public page with a bare % keeps its markdown twin, in its own spelling.
	const publicMapping = join(workDir, 'public.json');
	writeFileSync(publicMapping, JSON.stringify({ schemaVersion: 1, routes: [{ path: '/devlog/7%public', asset: '/devlog/7%public.md' }] }));
	const out = readFileSync(emitFile(['--gated-manifest', gatedManifest, '--markdown-manifest', publicMapping], 'public'), 'utf8');
	assert.ok(out.includes('"/devlog/7%public"'), 'the public route is baked in its own spelling');
});
