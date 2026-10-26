// Dispatch Worker core (Workers for Platforms). Pure ESM, no dependencies, no
// `cloudflare:*` imports, so it runs under node's test runner. The deployable
// entry that adds the WorkerEntrypoint stub class is ./entry.mjs.
//
// Bindings (env):
//   HOST_ROUTES      KV-shaped binding. get(host, 'json') -> mapping entry or null.
//   DISPATCHER       dispatch namespace binding. get(name, { props }) -> Fetcher.
//   RSP              service binding to the RSP Worker (same name as the Pages
//                    transport contract's bindingName). Carries /api/ and
//                    DIRECT_FORWARD_RULES verbatim, and the stub's reads.
//   DISPATCH_BYPASS  optional var. "1" | "true" | "on" serves the generated
//                    Worker's missing-binding 503 for every request.
//
// Mapping entry (value stored under the lowercase hostname):
//   { worker: string, generation: number|string, runWorkerFirst?: string[] }
//
// This module never sets X-Forwarded-Host and never rewrites a forwarded request.

export const HOST_ROUTES_BINDING = 'HOST_ROUTES';
export const DISPATCHER_BINDING = 'DISPATCHER';
export const RSP_BINDING = 'RSP';
export const BYPASS_VAR = 'DISPATCH_BYPASS';

// ctx.exports class name and the props key the user Worker reads it under.
export const STUB_EXPORT = 'Connector';
export const STUB_PROP = 'CONNECTOR';

// Browser-facing prefix answered here and never entered into a Site Worker.
// Compared WITH the trailing slash so /apix is not matched.
export const API_PREFIX = '/api/';

// The other browser-facing RSP paths a Site Worker hands verbatim to its RSP binding on Pages:
// the transport contract's forward rules with rsp "direct" (RSP's own seam scripts and styles,
// its checkout-unavailable page, the billing returns and the uploaded-asset proxy). A Site
// Worker here has no RSP binding, so these are answered here, with the same verbatim forward as
// API_PREFIX. Same vocabulary and methods as the contract: `exact` or `prefix` (whole prefix,
// trailing slash included), GET and HEAD only; any other method still goes to the Site Worker,
// as on Pages. The contract's rsp "site" pages (/membership, /account, /checkout/success,
// /subscribe/success) are deliberately absent: the Site Worker composes them itself.
export const DIRECT_FORWARD_METHODS = Object.freeze(['GET', 'HEAD']);
export const DIRECT_FORWARD_RULES = Object.freeze([
	{ match: 'exact', value: '/billing/success' },
	{ match: 'exact', value: '/billing/cancel' },
	{ match: 'exact', value: '/seam/island.js' },
	{ match: 'exact', value: '/seam/checkout-unavailable' },
	{ match: 'exact', value: '/seam/listing-filter.js' },
	{ match: 'exact', value: '/seam/wix-sidecart.css' },
	{ match: 'prefix', value: '/asset/' }
].map((rule) => Object.freeze(rule)));

export function isDirectForward(method, pathname) {
	if (!DIRECT_FORWARD_METHODS.includes(method)) return false;
	return DIRECT_FORWARD_RULES.some((rule) =>
		rule.match === 'exact' ? pathname === rule.value : pathname.startsWith(rule.value));
}

// Public catalog reads a Site Worker may make over its own host (these arrive
// here carrying cf-worker). Derived from the template's self-origin reads:
// fetchProductJson -> /api/v2/shop/catalog/item, fetchCatalogList ->
// /api/v2/shop/catalog. Exact paths, GET only. Cookie-bearing reads (native
// projection, buyer facts, verdict) are not public and are not listed.
export const PUBLIC_CATALOG_PATHS = Object.freeze([
	'/api/v2/shop/catalog',
	'/api/v2/shop/catalog/item'
]);

// What the capability stub lets a Site Worker read, GET only, exact paths.
// The catalog paths are deliberately absent: they are rate-limited per visitor, and a
// server-side hop does not carry the visitor's address, so a Site Worker reads them over its
// own host (the cf-worker rule above).
export const STUB_READ_PATHS = Object.freeze([
	'/api/v2/storefront/native',
	'/api/membership/plans',
	'/api/account/surface',
	'/api/subscribe/result',
	'/seam/site-verdict-v2'
]);

const WORKER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function json(payload, status, cacheControl = 'private, no-store') {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl }
	});
}

// Byte-for-byte the generated Worker's bindingMissingResponse (status,
// cache-control and body come from the Pages transport contract's
// onBindingMissing; a test compares this against the template source).
export function bypassResponse(bindingName = RSP_BINDING) {
	return json({ error: 'rsp_binding_missing', binding: bindingName }, 503, 'private, no-store');
}

function isOn(v) {
	return typeof v === 'string' && ['1', 'true', 'on'].includes(v.trim().toLowerCase());
}

export function normalizeHost(host) {
	return String(host || '').toLowerCase().replace(/\.$/, '');
}

// Wrangler run_worker_first semantics: glob with `*`, `!` prefix excludes and
// wins over any include.
export function matchesWorkerFirst(patterns, pathname) {
	const re = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
	let included = false;
	for (const p of patterns) {
		if (typeof p !== 'string') continue;
		if (p.startsWith('!')) { if (re(p.slice(1)).test(pathname)) return false; }
		else if (re(p).test(pathname)) included = true;
	}
	return included;
}

async function lookup(env, host) {
	const kv = env[HOST_ROUTES_BINDING];
	if (!kv) return { error: json({ error: 'host_routes_binding_missing' }, 503) };
	let entry;
	try { entry = await kv.get(host, 'json'); }
	catch (e) { return { error: json({ error: 'host_routes_unavailable' }, 503) }; }
	if (entry === null || entry === undefined) return { error: json({ error: 'unknown_host' }, 404) };
	if (!entry || typeof entry !== 'object' || typeof entry.worker !== 'string' || !WORKER_NAME.test(entry.worker)) {
		return { error: json({ error: 'host_mapping_invalid' }, 502) };
	}
	return { entry };
}

function buildStub(ctx, host, entry) {
	const make = ctx && ctx.exports && ctx.exports[STUB_EXPORT];
	if (typeof make !== 'function') return null;
	try { return make({ props: { host, worker: entry.worker, generation: entry.generation } }); }
	catch (e) { return null; }
}

export async function handleRequest(request, env, ctx) {
	if (isOn(env[BYPASS_VAR])) return bypassResponse();

	const url = new URL(request.url);
	const host = normalizeHost(url.hostname);

	// cf-worker marks a request made by a Worker over a public hostname. Only
	// the public catalog reads may come in that way.
	if (request.headers.has('cf-worker')) {
		if (request.method !== 'GET' || !PUBLIC_CATALOG_PATHS.includes(url.pathname)) {
			return json({ error: 'worker_origin_forbidden' }, 403);
		}
	}

	const found = await lookup(env, host);
	if (found.error) return found.error;
	const entry = found.entry;

	if (url.pathname.startsWith(API_PREFIX) || isDirectForward(request.method, url.pathname)) {
		const rsp = env[RSP_BINDING];
		if (!rsp) return bypassResponse();
		return rsp.fetch(request); // verbatim: method, URL, Host, Origin, headers, body
	}

	const dispatcher = env[DISPATCHER_BINDING];
	if (!dispatcher) return json({ error: 'dispatcher_binding_missing' }, 503);

	// The stub is only useful to paths the Site Worker runs; with a
	// run_worker_first list, other paths are static assets and get none.
	const list = Array.isArray(entry.runWorkerFirst) ? entry.runWorkerFirst : null;
	const wantsStub = !list || matchesWorkerFirst(list, url.pathname);
	const props = {};
	if (wantsStub) {
		const stub = buildStub(ctx, host, entry); // request-scoped: never cached
		if (stub) props[STUB_PROP] = stub;
	}
	if (entry.generation !== undefined) props.generation = entry.generation;

	try {
		const worker = dispatcher.get(entry.worker, { props });
		return await worker.fetch(request);
	} catch (e) {
		const msg = e && e.message ? String(e.message) : '';
		if (/not found/i.test(msg)) return json({ error: 'site_worker_not_found' }, 502);
		return json({ error: 'site_worker_error' }, 502);
	}
}

// Logic of the capability stub (the WorkerEntrypoint in ./entry.mjs calls this).
// The Site is fixed by the props the dispatcher built from the host mapping;
// the user Worker cannot choose another host.
export async function capabilityFetch(request, env, props) {
	const rsp = env[RSP_BINDING];
	if (!rsp) return bypassResponse();
	const url = new URL(request.url);
	if (request.method !== 'GET' || !STUB_READ_PATHS.includes(url.pathname) || !props || !props.host) {
		return json({ error: 'capability_forbidden' }, 403);
	}
	const target = new URL(url.pathname + url.search, 'https://' + props.host);
	return rsp.fetch(new Request(target.toString(), { method: 'GET', headers: request.headers }));
}
