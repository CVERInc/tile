// ONE route table for "which requests enter the Site Worker before the static assets", and the two
// platform spellings generated from it: Pages `_routes.json` and the Workers Static Assets
// `run_worker_first` list (the Workers-for-Platforms Site Worker). Neither is hand-written anywhere;
// both come out of toPagesRoutes / toRunWorkerFirst over the same table, and route-table.test.mjs
// asserts they agree in both directions over every path the table and the Site's config name.
//
// Today a Pages Site uploads no `_routes.json`, so every request enters `_worker.js`. The table keeps
// that as its default (`/*` worker-first) and carves out only paths the worker never claims and that
// are content-hashed build output (Astro's `/_astro/`). The emitter refuses, by name, an exclusion
// that would hide a path the worker answers (see emit-shop-function.mjs --split-out).
//
// Pure and import-free.
//
// Glob grammar accepted here — the intersection both platforms read the same way:
//   · a site-absolute path, no query, no `!`
//   · at most one `*`, and only as the final character (`/x/*` = everything under `/x/`; `/*` = all)
// `*` matches any run of characters including `/` on both platforms.

export const DEFAULT_WORKER_FIRST = Object.freeze(['/*']);
export const DEFAULT_STATIC_EXCLUSIONS = Object.freeze(['/_astro/*']);
// Cloudflare Pages: include + exclude together may hold at most 100 rules.
export const PAGES_ROUTES_MAX_RULES = 100;

export class RouteTableError extends Error {}

function checkGlob(glob, where) {
	if (typeof glob !== 'string' || !glob.startsWith('/') || glob.startsWith('//')) {
		throw new RouteTableError(where + ': a route glob must be a site-absolute path, got ' + JSON.stringify(glob));
	}
	if (glob.includes('!') || glob.includes('?') || glob.includes('#')) {
		throw new RouteTableError(where + ': ' + JSON.stringify(glob) + ' — `!`, `?` and `#` have no single meaning across _routes.json and run_worker_first');
	}
	const star = glob.indexOf('*');
	if (star !== -1 && star !== glob.length - 1) {
		throw new RouteTableError(where + ': ' + JSON.stringify(glob) + ' — `*` is accepted only as the final character');
	}
	return glob;
}

/**
 * @param {{ workerFirst?: string[], staticExclusions?: string[] }} [opts]
 * @returns {{ workerFirst: string[], staticExclusions: string[] }}
 */
export function buildRouteTable(opts = {}) {
	const workerFirst = (opts.workerFirst || DEFAULT_WORKER_FIRST).map((g, i) => checkGlob(g, 'workerFirst[' + i + ']'));
	const staticExclusions = (opts.staticExclusions || DEFAULT_STATIC_EXCLUSIONS).map((g, i) => checkGlob(g, 'staticExclusions[' + i + ']'));
	if (workerFirst.length === 0) throw new RouteTableError('workerFirst needs at least one glob (_routes.json requires a non-empty include)');
	if (workerFirst.length + staticExclusions.length > PAGES_ROUTES_MAX_RULES) {
		throw new RouteTableError('route table has ' + (workerFirst.length + staticExclusions.length) + ' rules; _routes.json allows ' + PAGES_ROUTES_MAX_RULES);
	}
	return { workerFirst: [...new Set(workerFirst)], staticExclusions: [...new Set(staticExclusions)] };
}

export function globMatches(glob, pathname) {
	if (glob.endsWith('*')) return pathname.startsWith(glob.slice(0, -1));
	return pathname === glob;
}

/** Pages `_routes.json` body. */
export function toPagesRoutes(table) {
	return { version: 1, include: table.workerFirst.slice(), exclude: table.staticExclusions.slice() };
}

/** Workers Static Assets `assets.run_worker_first` array (positive globs, then `!` negations). */
export function toRunWorkerFirst(table) {
	return [...table.workerFirst, ...table.staticExclusions.map((g) => '!' + g)];
}

/** Does a Pages deployment with this `_routes.json` invoke the Worker for `pathname`? (exclude wins) */
export function pagesRoutesInvokeWorker(routes, pathname) {
	if (routes.exclude.some((g) => globMatches(g, pathname))) return false;
	return routes.include.some((g) => globMatches(g, pathname));
}

/** Does a Worker with this `run_worker_first` array run before assets for `pathname`? (negation wins) */
export function runWorkerFirstInvokesWorker(list, pathname) {
	if (list === true) return true;
	if (list === false || list == null) return false;
	const negative = list.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
	const positive = list.filter((g) => !g.startsWith('!'));
	if (negative.some((g) => globMatches(g, pathname))) return false;
	return positive.some((g) => globMatches(g, pathname));
}

/** The table's own answer, which both spellings must reproduce. */
export function tableInvokesWorker(table, pathname) {
	if (table.staticExclusions.some((g) => globMatches(g, pathname))) return false;
	return table.workerFirst.some((g) => globMatches(g, pathname));
}

/**
 * Paths worth probing for agreement: each glob's own literal, a child under each prefix glob, and the
 * caller's extra paths (the Site's worker-claimed paths).
 */
export function probePaths(table, extra = []) {
	const out = new Set(['/', '/index.html', '/favicon.ico']);
	for (const g of [...table.workerFirst, ...table.staticExclusions]) {
		if (g.endsWith('*')) {
			const prefix = g.slice(0, -1);
			out.add(prefix || '/');
			out.add(prefix + 'probe.js');
			out.add(prefix + 'deep/probe.css');
			if (prefix.endsWith('/') && prefix.length > 1) out.add(prefix.slice(0, -1));
		} else {
			out.add(g);
			out.add(g + '/');
		}
	}
	for (const p of extra) out.add(p);
	return [...out];
}
