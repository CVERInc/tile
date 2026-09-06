// Emit a self-contained CF Pages advanced-mode _worker.js by concatenating the
// render core + the worker template with baked config. Both source files are ES
// modules with no imports, so concatenation yields one valid module; CF uses its
// `export default { fetch }`, the named exports are inert.
//
// Usage:
//   node emit-shop-function.mjs \
//     [--site-id <siteId> --guild <guildId> --api <apiBase> --name <siteName> --shops '[…]'] \
//     [--storefronts '[…]']  ← --api is REQUIRED once any storefront is declared \
//     [--api-contract <path to site-api-transport.contract.json>] \
//     [--gated-manifest <path to renderer-generated private URL manifest>] \
//     [--platform-origin <origin>] \
//     [--canonical-host <host>] \
//     [--emitter-commit <sha>] \
//     --out <dist>/_worker.js
//
// 🔴 EVERY site gets one of these now, not only shops. The shop flags are the
// OPTIONAL half: a site with no shop passes none of them and still needs this
// file, because /api/* and the buyer face reach RSP only through it (see
// build-deploy-sitetile.sh's "emit the site's dist/_worker.js — EVERY site").
// That is why --guild no longer exits 2 when absent.
//
// 🔴 --api-contract is the ONLY source of the RSP binding name, the forwarded
// path set and the binding-missing response. The verdict path set comes from
// the renderer-generated gated manifest, because only the build knows the
// source-faithful URL actually emitted for each private post.
// Nothing here restates any of those values; a contract that is passed but
// malformed is fatal rather than silently degraded, because degrading means
// shipping a site whose buyer face is missing while the build stays green.
//
// 🔴 --platform-origin also has nothing conditional about it: EVERY emitted
// worker serves `POST /__reef/inbox` (the form coral's `action=inbox` same-
// origin forwarder — see sitetile's Form.astro), on every site, shop or not.
// The flag only tells that route which platform origin to relay to; omitted,
// it defaults to https://feelreef.com — the same default the route falls back
// to when the flag is absent, so a build invoked by a stale caller (build-
// deploy-sitetile.sh before it started passing this flag) still serves a
// working route instead of a 404.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name, def = '') {
	const i = process.argv.indexOf('--' + name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function die(msg) {
	console.error('emit-shop-function: ' + msg);
	process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const core = readFileSync(join(here, 'product-page-core.js'), 'utf8');
const tmpl = readFileSync(join(here, 'shop-function-template.js'), 'utf8');

function readRule(rule, where, wantMethods) {
	if (!rule || typeof rule !== 'object') die(where + ': entry is not an object');
	if (rule.match !== 'exact' && rule.match !== 'prefix') {
		die(where + ': match must be "exact" or "prefix", got ' + JSON.stringify(rule.match));
	}
	if (typeof rule.value !== 'string' || !rule.value.startsWith('/')) {
		die(where + ': value must be a site-absolute path, got ' + JSON.stringify(rule.value));
	}
	const out = { match: rule.match, value: rule.value };
	if (wantMethods) {
		if (!Array.isArray(rule.methods) || rule.methods.length === 0 ||
			rule.methods.some((m) => typeof m !== 'string' || !m)) {
			die(where + ' (' + rule.value + '): methods must be a non-empty array of strings');
		}
		out.methods = rule.methods.slice();
	}
	return out;
}

function normalizeSitePath(value, where) {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
		die(where + ': path must be site-absolute, got ' + JSON.stringify(value));
	}
	let pathname;
	try { pathname = new URL(value, 'http://site.invalid').pathname; } catch { die(where + ': invalid path'); }
	if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
	if (pathname.endsWith('/index.html')) pathname = pathname.slice(0, -'/index.html'.length) || '/';
	return pathname;
}

function loadGatedManifest(path) {
	if (!path) return [];
	let raw;
	try { raw = readFileSync(path); } catch { die('--gated-manifest not readable: ' + path); }
	let manifest;
	try { manifest = JSON.parse(raw.toString('utf8')); } catch { die('--gated-manifest is not valid JSON: ' + path); }
	const paths = Array.isArray(manifest) ? manifest : manifest && manifest.paths;
	if (!Array.isArray(paths)) die('--gated-manifest needs a paths array');
	return [...new Set(paths.map((value, i) => normalizeSitePath(value, 'gated-manifest.paths[' + i + ']')))]
		.map((value) => ({ match: 'exact', value }));
}

// Reduce the contract to exactly the fields the worker executes. The prose
// (reason/ruling/notes) stays in the contract file and out of the bundle; the
// sha256 below is over the WHOLE file, so the bundle still names the exact
// contract it was baked from.
function loadApiTransport(path) {
	let raw;
	try { raw = readFileSync(path); } catch (e) { die('--api-contract not readable: ' + path); }
	let contract;
	try { contract = JSON.parse(raw.toString('utf8')); } catch (e) { die('--api-contract is not valid JSON: ' + path); }
	if (!contract || typeof contract !== 'object') die('--api-contract is not an object: ' + path);

	if (typeof contract.bindingName !== 'string' || !contract.bindingName) {
		die('--api-contract has no bindingName');
	}
	if (!Array.isArray(contract.forward) || contract.forward.length === 0) {
		die('--api-contract has no forward rules');
	}
	const obm = contract.onBindingMissing;
	if (!obm || typeof obm !== 'object') die('--api-contract has no onBindingMissing');
	if (typeof obm.status !== 'number' || !Number.isInteger(obm.status)) {
		die('--api-contract onBindingMissing.status must be an integer');
	}
	if (typeof obm.cacheControl !== 'string' || !obm.cacheControl) {
		die('--api-contract onBindingMissing.cacheControl must be a non-empty string');
	}

	const forward = contract.forward.map((r, i) => readRule(r, 'forward[' + i + ']', true));
	const verdict = loadGatedManifest(arg('gated-manifest'));

	const ve = contract.verdictEndpoint;
	if (!ve || typeof ve !== 'object') {
		die('--api-contract has no verdictEndpoint');
	}
	if (ve.version !== 2) {
		die('--api-contract verdictEndpoint.version must be supported v2 (2), got ' + JSON.stringify(ve.version));
	}
	if (ve.path !== '/seam/site-verdict-v2') {
		die('--api-contract verdictEndpoint.path must be /seam/site-verdict-v2, got ' + JSON.stringify(ve.path));
	}
	if (ve.param !== 'path') {
		die('--api-contract verdictEndpoint.param must be path, got ' + JSON.stringify(ve.param));
	}
	const verdictEndpoint = { version: ve.version, path: ve.path, param: ve.param };
	let checkoutResult = null;
	if (contract.checkoutResult != null) {
		const cr = contract.checkoutResult;
		if (!cr || typeof cr !== 'object') die('--api-contract checkoutResult is not an object');
		const path = normalizeSitePath(cr.path, 'checkoutResult.path');
		const outcomePath = normalizeSitePath(cr.outcomePath, 'checkoutResult.outcomePath');
		if (cr.method !== 'GET') die('--api-contract checkoutResult.method must be GET');
		if (typeof cr.orderParam !== 'string' || !/^[A-Za-z0-9_]+$/.test(cr.orderParam)) {
			die('--api-contract checkoutResult.orderParam must be a non-empty query parameter name');
		}
		checkoutResult = { path, method: cr.method, orderParam: cr.orderParam, outcomePath };
	}

	// The pages the contract assigns to the SITE's own presentation: which path,
	// which facts endpoint behind the binding, and which body renderer serves it.
	// Absent (an older contract) bakes nothing, so those paths keep the generic
	// forward behaviour already-emitted workers have.
	let siteOwnedBuyerPages = [];
	if (contract.siteOwnedBuyerPages != null) {
		if (!Array.isArray(contract.siteOwnedBuyerPages)) die('--api-contract siteOwnedBuyerPages must be an array');
		siteOwnedBuyerPages = contract.siteOwnedBuyerPages.map((entry, i) => {
			const where = 'siteOwnedBuyerPages[' + i + ']';
			if (!entry || typeof entry !== 'object') die(where + ': entry is not an object');
			if (entry.method !== 'GET') die(where + ': method must be GET, got ' + JSON.stringify(entry.method));
			// `kind` names the body renderer this emitter HAS. An unknown one would
			// ship a page with nothing in it while the build stayed green, so it is
			// fatal here — a new kind arrives with the renderer that serves it.
			if (entry.kind !== 'membership' && entry.kind !== 'account') {
				die(where + ': kind must be a renderer this emitter has (membership|account), got ' + JSON.stringify(entry.kind));
			}
			return {
				path: normalizeSitePath(entry.path, where + '.path'),
				method: entry.method,
				kind: entry.kind,
				factsPath: normalizeSitePath(entry.factsPath, where + '.factsPath')
			};
		});
	}

	return {
		transport: {
			bindingName: contract.bindingName,
			forward,
			verdictEndpoint,
			...(checkoutResult ? { checkoutResult } : {}),
			...(siteOwnedBuyerPages.length > 0 ? { siteOwnedBuyerPages } : {}),
			...(verdict.length > 0 ? { verdict } : {}),
			onBindingMissing: { status: obm.status, cacheControl: obm.cacheControl }
		},
		verdictTransport: 'exact-v2',
		sha256: createHash('sha256').update(raw).digest('hex'),
		path
	};
}

function emitterCommit() {
	const given = arg('emitter-commit');
	if (given) return given;
	try {
		return execFileSync('git', ['-C', here, 'rev-parse', 'HEAD'], {
			encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
		}).trim() || 'unknown';
	} catch (e) {
		// git archive / a runner image has no .git — say so instead of guessing.
		return 'unknown';
	}
}

const contractPath = arg('api-contract');
const loaded = contractPath ? loadApiTransport(contractPath) : null;

const guildId = arg('guild');
const siteId = arg('site-id');
let legacyShops = [];
try { legacyShops = JSON.parse(arg('shops', '[]')); } catch { legacyShops = []; }
if (!Array.isArray(legacyShops)) legacyShops = [];

// A locator names a site; it does not declare a buyer surface. Structured page
// descriptors are the only input that can put a path in this dispatch table.
// `--shops` supplies locale/label metadata only after a descriptor selected it.
let storefronts = [];
try { storefronts = JSON.parse(arg('storefronts', '[]')); } catch { die('--storefronts must be valid JSON'); }
if (!Array.isArray(storefronts)) die('--storefronts must be an array');
const shops = storefronts.flatMap((entry, index) => {
	if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') die(`--storefronts[${index}] needs a path`);
	const shopPath = normalizeSitePath(entry.path, `--storefronts[${index}]`);
	const legacy = legacyShops.find((shop) => shop && typeof shop.shopPath === 'string' && normalizeSitePath(shop.shopPath, '--shops') === shopPath) || {};
	if (entry.source !== 'native' && entry.source !== 'provider') {
		if (entry.source == null) die(`--storefronts[${index}] source is required`);
		die(`--storefronts[${index}] source must be native or provider, got ${JSON.stringify(entry.source)}`);
	}
	if (entry.source === 'provider' && (entry.provider !== 'stripe' && entry.provider !== 'square')) {
		die(`--storefronts[${index}] provider must be stripe or square`);
	}
	const descriptor = {
		shopPath,
		source: entry.source,
		...(entry.source === 'provider' ? { provider: entry.provider } : {}),
		labels: legacy.labels || {},
		...(legacy.locale ? { locale: legacy.locale } : {})
	};
	return [descriptor];
});

// 🔴 The site's OWN inbox forwarder route (`POST /__reef/inbox`) is baked into
// EVERY emitted worker regardless of any flag — see shop-function-template.js.
// `--platform-origin` only names where that route relays to; it always defaults
// to https://feelreef.com so a stale invocation (no flag at all) still serves
// the route correctly instead of 404ing the form. Never omitted from config: an
// absent flag must bake the SAME default the route falls back to on its own, so
// the two can never read differently.
// The origin the SHOP branch falls back to when a site does not proxy /api itself
// (shop-function-template.js#fetchProductJson tries same-origin first, then this).
//
// 🔴 It used to be a baked default naming one deployment's legacy backend. That literal cannot
// live in this repo: this is public and MIT, and which backend a particular deployment runs is a
// fact about somebody's infrastructure, not about this emitter. It comes from the caller now —
// `--api`, or `SQUARE_SHOP_API_BASE` for a caller that would rather configure than pass a flag.
//
// 🔴 FATAL when a storefront is configured and no base was given, rather than emitting an empty
// one. An empty base is not "no fallback": in a Worker, `fetch('/api/…')` with a relative URL
// THROWS, so a shop whose same-origin proxy is absent would lose its product pages while the
// build stayed green. This file's own rule (see --api-contract above) is that a missing input is
// fatal rather than silently degraded, because degrading ships a site with no buyer face. A
// shopless site never reads apiBase — that branch is unreachable for it — so it still builds
// with the empty value, exactly as inert as the baked hostname was.
const apiBase = arg('api', process.env.SQUARE_SHOP_API_BASE || '');
if (!apiBase && shops.length) {
	die('a storefront is configured but no shop API base was given — pass --api <origin> '
		+ '(or set SQUARE_SHOP_API_BASE). Emitting an empty one would lose the product-detail '
		+ 'fallback on any site that does not proxy /api itself.');
}

const platformOrigin = arg('platform-origin', 'https://feelreef.com');
const canonicalHostArg = arg('canonical-host');
let canonicalHost = '';
if (canonicalHostArg) {
	canonicalHost = canonicalHostArg.trim().toLowerCase();
	if (canonicalHost !== canonicalHostArg || canonicalHost.includes('://') || canonicalHost.includes('/') ||
		canonicalHost.includes(':') || !canonicalHost.includes('.')) {
		die('--canonical-host must be a lowercase bare host, got ' + JSON.stringify(canonicalHostArg));
	}
}

const config = {
	guildId,
	// Omitted entirely when absent, so a guild-only site's baked config is the
	// same bytes it was before site identity reached this emitter.
	...(siteId ? { siteId } : {}),
	// 🔴 A **SITE** coral — no Card can embed it. See ./README.md before concluding otherwise.
	// 🔴 Belongs to the SHOP branch only. The forward/verdict branches never read
	// it: they go over the service binding, whose target is the contract's
	// bindingName and nothing else.
	//
	// 🔴 NO HOSTNAME LIVES HERE, and the empty string is not a fallback — it is the
	// absence of one. See `apiBase` above the config for why a shop that names none
	// is fatal rather than degraded.
	apiBase,
	siteName: arg('name', ''),
	shops,
	verdictTransport: loaded ? loaded.verdictTransport : null,
	apiTransport: loaded ? loaded.transport : null,
	platformOrigin,
	...(canonicalHost ? { canonicalHost } : {})
};

// Keep flagless output byte-for-byte unchanged: both placeholders disappear.
// The redirect implementation only enters workers explicitly emitted with the flag.
const canonicalHelpers = canonicalHost ? `function canonicalRedirect(request, canonicalHost) {
\tif (request.method !== 'GET' && request.method !== 'HEAD') return null;
\tconst url = new URL(request.url);
\tconst normalize = (value) => String(value || '').trim().toLowerCase().split(':')[0];
\tconst host = normalize(request.headers.get('host') || url.hostname);
\tconst canonical = normalize(canonicalHost);
\tconst preview = (value) => value.endsWith('.pages.dev') || value.endsWith('.workers.dev') || value.includes('-preview.') || value.endsWith('-preview');
\tif (!host || !canonical || preview(host) || preview(canonical) || host === 'localhost' || host === '127.0.0.1') return null;
\tif (host === canonical) return null;
\tif (host !== 'www.' + canonical && !host.endsWith('.' + canonical)) return null;
\treturn new Response(null, { status: 301, headers: { location: 'https://' + canonical + url.pathname + url.search } });
}

` : '';
const canonicalFetch = canonicalHost ? `\t\tconst canonicalResponse = canonicalRedirect(request, CFG.canonicalHost);
\t\tif (canonicalResponse) return canonicalResponse;
` : '';

// A function replacement, so a `$&` / `$'` / `$$` inside a baked value (a site
// name, a label, a contract path) is inserted literally instead of being read as
// a replacement pattern.
const body = tmpl
	.replace('/*__CANONICAL_HELPERS__*/', () => canonicalHelpers)
	.replace('/*__CANONICAL_FETCH__*/', () => canonicalFetch)
	.replaceAll('__SHOP_CONFIG__', () => JSON.stringify(config));
const provenance =
	'// GENERATED — do not edit. Source: tile/packages/dynamic-corals/square-shop/{product-page-core,shop-function-template}.js\n' +
	'// emitter commit: ' + emitterCommit() + '\n' +
	'// api contract: ' + (loaded ? loaded.path + ' sha256=' + loaded.sha256 : 'none (no --api-contract given; this site forwards nothing to RSP)') + '\n';
const out = provenance + core + '\n' + body;

const outFile = arg('out');
if (!outFile) {
	process.stdout.write(out);
} else {
	mkdirSync(dirname(outFile), { recursive: true });
	writeFileSync(outFile, out);
	console.error('emit-shop-function: wrote ' + outFile +
		' (site=' + (siteId || 'none') + ', guild=' + (guildId || 'none') +
		', shops=' + (shops.map((s) => s.shopPath).join(',') || 'none') +
		', transport=' + (loaded ? loaded.transport.bindingName + ' ' + loaded.transport.forward.length + ' forward/' + (loaded.transport.verdict || []).length + ' verdict' : 'none') + ')');
}
