// The ONE function that turns shared code + one Site's baked config into the `_worker.js` bytes.
//
// emit-shop-function.mjs used to build those bytes inline. They are built here now so that two
// callers produce them from the same code: the emitter, writing `<dist>/_worker.js` exactly as it
// always has, and anything that holds a Site's split output (`--split-out`: the shared sources,
// unchanged, plus `site-config.json`) and needs the same artifact again without a new Site build.
// worker-split.test.mjs proves the emitter's bytes did not move when this was extracted, by running
// the frozen pre-split emitter (fixtures/emit-shop-function.reference.mjs) beside it.
//
// Pure and import-free on purpose: no fs, no clock, no environment. The per-Site code fragments
// (canonical-host 301, query-string 301s) are a function of the baked config alone, so the config
// module plus the shared sources is the whole input.
//
// 🔴 Every fragment below is the emitter's previous inline text, byte for byte. Changing one changes
// every Site's `_worker.js`.

export const SITE_CONFIG_SCHEMA_VERSION = 1;
export const SITE_CONFIG_KIND = 'tile.square-shop.site-config';

// Keep flagless output byte-for-byte unchanged: both placeholders disappear.
// The redirect implementation only enters workers explicitly emitted with the flag.
const CANONICAL_HELPERS = `function canonicalRedirect(request, canonicalHost) {
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

`;
const CANONICAL_FETCH = `\t\tconst canonicalResponse = canonicalRedirect(request, CFG.canonicalHost);
\t\tif (canonicalResponse) return canonicalResponse;
`;

// Query-string 301s (reef#1882) — see the emitter's comment above its loader for the placement
// argument. Present only when the Site baked at least one rule.
const QUERY_REDIRECT_HELPERS = `function matchQueryRedirect(request, byPath) {
\tif (request.method !== 'GET' && request.method !== 'HEAD') return null;
\tconst q = request.url.indexOf('?');
\tif (q === -1 || q === request.url.length - 1) return null;
\ttry {
\t\tconst url = new URL(request.url);
\t\tconst to = lookupQueryRedirect(url.pathname, url.search, byPath);
\t\treturn to === null ? null : new Response(null, { status: 301, headers: { location: to } });
\t} catch (e) { return null; }
}

`;
const QUERY_REDIRECT_FETCH = `\t\tconst queryRedirectResponse = complete ? null : matchQueryRedirect(request, CFG.queryRedirects.byPath);
\t\tif (queryRedirectResponse) return queryRedirectResponse;
`;

function provenanceHeader(provenance) {
	const contract = provenance && provenance.apiContract;
	return '// GENERATED — do not edit. Source: tile/packages/dynamic-corals/square-shop/{product-page-core,shop-function-template}.js\n' +
		'// emitter commit: ' + provenance.emitterCommit + '\n' +
		'// api contract: ' + (contract ? contract.path + ' sha256=' + contract.sha256 : 'none (no --api-contract given; this site forwards nothing to RSP)') + '\n';
}

/**
 * Assemble `_worker.js`.
 * @param {object} parts
 * @param {string} parts.core                  product-page-core.js source, unchanged
 * @param {string} parts.template              shop-function-template.js source, unchanged
 * @param {string} [parts.queryRedirectsRuntime] sitetile/query-redirects.mjs source, unchanged;
 *                                              required only when the config bakes queryRedirects
 * @param {{ emitterCommit: string, apiContract: ({ path: string, sha256: string } | null) }} parts.provenance
 * @param {object} parts.config                the baked per-Site config (the worker's CFG)
 * @returns {string} the `_worker.js` text
 */
export function assembleWorker({ core, template, queryRedirectsRuntime, provenance, config }) {
	if (typeof core !== 'string' || typeof template !== 'string') throw new TypeError('assembleWorker: core and template sources are required');
	if (!provenance || typeof provenance.emitterCommit !== 'string') throw new TypeError('assembleWorker: provenance.emitterCommit is required');
	if (!config || typeof config !== 'object') throw new TypeError('assembleWorker: config is required');
	const canonical = Boolean(config.canonicalHost);
	const queryRedirects = Boolean(config.queryRedirects);
	if (queryRedirects && typeof queryRedirectsRuntime !== 'string') {
		throw new TypeError('assembleWorker: the config bakes queryRedirects but no query-redirects runtime source was given');
	}
	// A function replacement, so a `$&` / `$'` / `$$` inside a baked value (a site
	// name, a label, a contract path) is inserted literally instead of being read as
	// a replacement pattern.
	const body = template
		.replace('/*__CANONICAL_HELPERS__*/', () => canonical ? CANONICAL_HELPERS : '')
		.replace('/*__QUERY_REDIRECT_HELPERS__*/', () => queryRedirects ? QUERY_REDIRECT_HELPERS : '')
		.replace('/*__CANONICAL_FETCH__*/', () => canonical ? CANONICAL_FETCH : '')
		.replace('/*__QUERY_REDIRECT_FETCH__*/', () => queryRedirects ? QUERY_REDIRECT_FETCH : '')
		.replaceAll('__SHOP_CONFIG__', () => JSON.stringify(config));
	const runtime = queryRedirects ? queryRedirectsRuntime + '\n' : '';
	return provenanceHeader(provenance) + core + '\n' + runtime + body;
}

/**
 * Assemble `_worker.js` from a parsed `site-config.json` module and the shared sources.
 * @param {object} siteConfig  the parsed module the emitter wrote with --split-out
 * @param {{ core: string, template: string, queryRedirectsRuntime?: string }} shared
 */
export function assembleWorkerFromSiteConfig(siteConfig, shared) {
	if (!siteConfig || siteConfig.kind !== SITE_CONFIG_KIND || siteConfig.schemaVersion !== SITE_CONFIG_SCHEMA_VERSION) {
		throw new TypeError('assembleWorkerFromSiteConfig: not a ' + SITE_CONFIG_KIND + ' v' + SITE_CONFIG_SCHEMA_VERSION + ' module');
	}
	return assembleWorker({ ...shared, provenance: siteConfig.provenance, config: siteConfig.config });
}
