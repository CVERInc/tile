// End-to-end test of the EMITTED _worker.js: emit it, load it, mock the product
// API (global fetch) + the static assets (env.ASSETS.fetch = shell donor + fall-
// through), run its default.fetch, verify a full shell page with the product's
// OG injected and the donor's OG stripped — and that non-shop paths fall through.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(tmpdir(), 'emitted-shop-worker-' + process.pid + '.mjs');

execFileSync('node', [
	join(here, 'emit-shop-function.mjs'),
	'--guild', 'site_g1', '--name', 'NORTHWIND',
	'--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }]),
	'--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }]),
	// REQUIRED once a storefront is declared — the emitter carries no baked hostname any more.
	// A synthetic origin: this test is about the product page, not about whose backend answers.
	'--api', 'https://api.example',
	'--out', out
], { stdio: 'inherit' });

const PRODUCT = {
	processor: 'square', id: 'ITM', slug: 'riso-poster', title: 'RISO poster',
	description: 'A poster.', images: ['https://x/riso.jpg'],
	variants: [{ id: 'v1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5.0, available: true }]
};
const SHELL = `<!doctype html><html><head><title>Shop — Northwind</title>` +
	`<meta property="og:image" content="/old-og.jpg"><link rel="canonical" href="https://example.com/shop"></head>` +
	`<body><header class="rf-header">NAV</header><main class="rf-main"><section>GRID</section></main><footer class="rf-foot">FOOT</footer></body></html>`;

// product API is external → global fetch
globalThis.fetch = async (url) => {
	url = String(url);
	if (url.includes('/api/v2/shop/catalog/item') && url.includes('slug=riso-poster')) {
		return { ok: true, json: async () => ({ item: PRODUCT }) };
	}
	return { ok: true, json: async () => ({ item: null }) };
};
// static assets (shell donor + fallthrough) → env.ASSETS.fetch
let fellThrough = null;
const env = {
	ASSETS: {
		fetch: async (req) => {
			const u = String(req.url || req);
			if (u.endsWith('/shop/')) return { ok: true, text: async () => SHELL };
			fellThrough = u;
			return new Response('STATIC:' + u, { status: 200 });
		}
	}
};

const mod = await import(pathToFileURL(out).href);
let pass = 0, fail = 0;
const ok = (n, c) => { (c ? pass++ : fail++); console.log((c ? 'PASS' : 'FAIL'), '-', n); };

// Canonical-host behavior is opt-in; the default worker above contains no new code/config.
const defaultBytes = await import('node:fs').then(({ readFileSync }) => readFileSync(out, 'utf8'));
ok('without --canonical-host output has no canonical redirect bytes',
	!defaultBytes.includes('canonicalRedirect') && !defaultBytes.includes('canonicalHost'));
const defaultWww = await mod.default.fetch(new Request('https://www.example.com/faq?x=1'), { ASSETS: { fetch: async () => new Response('STATIC') } });
ok('without --canonical-host never redirects', defaultWww.status === 200);

const outCanonical = join(tmpdir(), 'emitted-shop-worker-canonical-' + process.pid + '.mjs');
execFileSync('node', [join(here, 'emit-shop-function.mjs'), '--canonical-host', 'northwind.example', '--out', outCanonical], { stdio: 'inherit' });
const canonicalMod = await import(pathToFileURL(outCanonical).href);
const canonicalEnv = { ASSETS: { fetch: async () => new Response('STATIC', { status: 200 }) } };
const redirected = await canonicalMod.default.fetch(new Request('https://www.northwind.example/faq/?x=1'), canonicalEnv);
ok('www alias GET → canonical 301 with path/query', redirected.status === 301 && redirected.headers.get('location') === 'https://northwind.example/faq/?x=1');
ok('canonical GET is not redirected', (await canonicalMod.default.fetch(new Request('https://northwind.example/faq/'), canonicalEnv)).status === 200);
ok('pages.dev preview GET is not redirected', (await canonicalMod.default.fetch(new Request('https://abc.northwind-preview.pages.dev/faq/'), canonicalEnv)).status === 200);
ok('www POST is not redirected', (await canonicalMod.default.fetch(new Request('https://www.northwind.example/faq/', { method: 'POST' }), canonicalEnv)).status === 200);

// product slug → rendered product page in the shell
const res = await mod.default.fetch(new Request('https://example.com/shop/riso-poster'), env);
const html = await res.text();
ok('200 OK', res.status === 200);
ok('product <title> injected', html.includes('<title>RISO poster — NORTHWIND</title>'));
ok('product og:image injected', html.includes('og:image" content="https://x/riso.jpg"'));
ok('canonical is product URL', html.includes('rel="canonical" href="https://example.com/shop/riso-poster"'));
ok('donor og stripped', !html.includes('/old-og.jpg'));
ok('donor title stripped', !html.includes('Shop — Northwind'));
ok('product body in shell', html.includes('class="dc-pp"') && html.includes('RISO poster'));
ok('shell chrome preserved', html.includes('rf-header') && html.includes('rf-foot'));
ok('grid content replaced', !html.includes('>GRID<'));
ok('JSON-LD Product schema', html.includes('"@type":"Product"'));

// unknown slug → redirect to /shop
const r404 = await mod.default.fetch(new Request('https://example.com/shop/nope'), env);
ok('unknown product → 302 to /shop', r404.status === 302 && (r404.headers.get('location') || '').includes('/shop/'));

// non-shop path → falls through to static assets untouched
const rFall = await mod.default.fetch(new Request('https://example.com/faq'), env);
const fallBody = await rFall.text();
ok('non-shop path falls through to ASSETS', fallBody.startsWith('STATIC:') && fellThrough.includes('/faq'));

// shop index itself (/shop/) is NOT intercepted as a product → served plain
const rIndex = await mod.default.fetch(new Request('https://example.com/shop/'), env);
const idxBody = await rIndex.text();
ok('shop index /shop/ not product-rendered', !idxBody.includes('class="dc-pp"'));

// ── /__reef/inbox — the form coral's `action=inbox` same-origin forwarder ────
// A fresh worker per platform-origin variant so the earlier product/shop mocks
// (globalThis.fetch, env.ASSETS above) never bleed into these.
const outDefault = join(tmpdir(), 'emitted-shop-worker-inbox-default-' + process.pid + '.mjs');
execFileSync('node', [
	join(here, 'emit-shop-function.mjs'),
	'--guild', 'site_g1', '--name', 'NORTHWIND',
	'--out', outDefault
], { stdio: 'inherit' });
const outFlag = join(tmpdir(), 'emitted-shop-worker-inbox-flag-' + process.pid + '.mjs');
execFileSync('node', [
	join(here, 'emit-shop-function.mjs'),
	'--site-id', 'stg-site-1', '--name', 'NORTHWIND',
	'--platform-origin', 'https://platform.example',
	'--out', outFlag
], { stdio: 'inherit' });

const modDefault = await import(pathToFileURL(outDefault).href);
const modFlag = await import(pathToFileURL(outFlag).href);
const inboxEnv = { ASSETS: { fetch: async () => new Response('STATIC', { status: 200 }) } };

// no --platform-origin at all → still serves the route, defaulting to feelreef.com
{
	let seen = null;
	globalThis.fetch = async (url, opts) => { seen = { url: String(url), opts }; return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('Name', 'Ada');
	const res = await modDefault.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('no --platform-origin → still 303s, not 404', res.status === 303);
	ok('no --platform-origin → defaults the relay target to feelreef.com', seen && seen.url === 'https://feelreef.com/api/inbox');
}

// GET → 405
{
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox'), inboxEnv);
	ok('GET /__reef/inbox → 405', res.status === 405);
}

// honeypot filled → behaves exactly as sent, without ever calling the platform
{
	let called = false;
	globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('_hp', 'i-am-a-bot');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('honeypot: 303', res.status === 303);
	ok('honeypot: ?inbox=sent', (res.headers.get('location') || '') === '/contact?inbox=sent');
	ok('honeypot: never forwarded', called === false);
}

// JSON shape: kind/id/fields/visitor_email/page_url/_hp, reserved names excluded, no cookies
{
	let seen = null;
	globalThis.fetch = async (url, opts) => { seen = { url: String(url), opts }; return new Response('{}', { status: 200 }); };
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('_hp', '');
	fd.set('Name', 'Ada Lovelace');
	fd.set('visitor_email', 'ada@example.com');
	// an author field colliding with a reserved name, wire-prefixed by the coral itself:
	fd.set('field_kind', 'General enquiry');
	// a raw reserved name, as if something posted here directly rather than via the coral —
	// must never leak into `fields`:
	fd.set('conversation_id', 'sneaky');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact', cookie: 'session=abc123' }
	}), inboxEnv);
	const payload = JSON.parse(seen.opts.body);
	ok('relays to <platform origin>/api/inbox', seen.url === 'https://platform.example/api/inbox');
	ok('content-type: application/json', seen.opts.headers['content-type'] === 'application/json');
	ok('no cookie/credentials forwarded', !('cookie' in seen.opts.headers) && seen.opts.credentials === 'omit');
	ok('kind: site', payload.kind === 'site');
	ok('id: the baked --site-id', payload.id === 'stg-site-1');
	ok('fields carries the ordinary field', payload.fields.Name === 'Ada Lovelace');
	ok('fields carries the wire-prefixed collision field', payload.fields.field_kind === 'General enquiry');
	ok('reserved name never lands in fields', !('conversation_id' in payload.fields));
	ok('visitor_email lifted to the top level', payload.visitor_email === 'ada@example.com');
	ok('visitor_email not duplicated into fields', !('visitor_email' in payload.fields));
	ok('page_url is the same-origin Referer', payload.page_url === 'https://site.example/contact');
	ok('_hp rides along empty', payload._hp === '');
	ok('303 on 2xx', res.status === 303);
	ok('?inbox=sent on 2xx', (res.headers.get('location') || '') === '/contact?inbox=sent');
}

// visitor_email via the email_field alias, when visitor_email itself is absent
{
	let seen = null;
	globalThis.fetch = async (url, opts) => { seen = { url: String(url), opts }; return new Response('{}', { status: 200 }); };
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('email_field', 'bob@example.com');
	await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	const payload = JSON.parse(seen.opts.body);
	ok('visitor_email via email_field alias', payload.visitor_email === 'bob@example.com');
	ok('email_field itself never lands in fields', !('email_field' in payload.fields));
}

// return_to honoured when same-origin; a foreign return_to falls back to the Referer's path
{
	globalThis.fetch = async () => new Response('{}', { status: 200 });
	const fdOk = new FormData(); fdOk.set('return_to', '/zh-tw/contact');
	const okRes = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fdOk, headers: { referer: 'https://site.example/zh-tw/contact' }
	}), inboxEnv);
	ok('same-origin return_to honoured', (okRes.headers.get('location') || '') === '/zh-tw/contact?inbox=sent');

	const fdBad = new FormData(); fdBad.set('return_to', 'https://evil.example/steal');
	const badRes = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fdBad, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('foreign return_to rejected, falls back to the Referer path', (badRes.headers.get('location') || '') === '/contact?inbox=sent');

	const fdNone = new FormData(); fdNone.set('return_to', '//evil.example/steal');
	const noneRes = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fdNone, headers: { referer: 'https://evil.example/also-foreign' }
	}), inboxEnv);
	ok('foreign return_to + foreign referer falls back to /', (noneRes.headers.get('location') || '') === '/?inbox=sent');
}

// non-2xx: the platform's own `reason` field, when present, becomes ?inbox=<reason>
{
	globalThis.fetch = async () => new Response(JSON.stringify({ reason: 'rate_limited' }), { status: 429 });
	const fd = new FormData(); fd.set('return_to', '/contact');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('non-2xx with reason → ?inbox=<reason>', (res.headers.get('location') || '') === '/contact?inbox=rate_limited');
}
{
	globalThis.fetch = async () => new Response('not json', { status: 500 });
	const fd = new FormData(); fd.set('return_to', '/contact');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('non-2xx with no reason → ?inbox=error', (res.headers.get('location') || '') === '/contact?inbox=error');
}

// fetch failure and the 8s AbortController timeout both land on ?inbox=unavailable
{
	globalThis.fetch = async () => { throw new Error('network down'); };
	const fd = new FormData(); fd.set('return_to', '/contact');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('fetch failure → ?inbox=unavailable', (res.headers.get('location') || '') === '/contact?inbox=unavailable');
}
{
	// Prove the 8-second contract WITHOUT spending 8 real seconds on it: capture the
	// delay the code actually hands setTimeout, then let a shortened real timer fire
	// so the abort path runs for real (a stub abort() would test nothing but itself).
	const realSetTimeout = globalThis.setTimeout;
	let capturedDelayMs = null;
	globalThis.setTimeout = (fn, ms, ...rest) => { capturedDelayMs = ms; return realSetTimeout(fn, 10, ...rest); };
	globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
		opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); // never resolves on its own
	});
	const fd = new FormData(); fd.set('return_to', '/contact');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	globalThis.setTimeout = realSetTimeout;
	ok('the abort fires an 8000ms timer, per the spec', capturedDelayMs === 8000);
	ok('timeout aborts the relay and answers ?inbox=unavailable', (res.headers.get('location') || '') === '/contact?inbox=unavailable');
}

// ── `thanks_to`: the form coral's opt-in `thanks=`, re-validated here rather ─────
// than trusted, since a hidden field is still something a visitor's own browser tooling can
// edit before the request leaves it (see shop-function-template.js's own note).

// isSiteRelativePath itself — a table of the exact hostile shapes the coral's build-time
// validator (site-core.js's safeInternalPath) also refuses, as DATA rather than as test names.
{
	const cases = [
		['/thanks', true],
		['/thanks?ref=fb', true],
		['//evil.example', false],
		['/\\evil.example', false],     // a backslash resolves like a slash, so this would leave the site
		['https://evil.example', false],
		['javascript:void(0)', false],
		['../x', false],
		['/a/../b', false],
		['/a/..', false],
		['..', false],
		['', false],
	];
	for (const [value, expected] of cases) {
		ok(`isSiteRelativePath(${JSON.stringify(value)}) === ${expected}`, modFlag.isSiteRelativePath(value) === expected);
	}
}

// R1-P3-1 (adversarial review, round 1): this gate does NOT run `decodeEntitiesOnce` the way
// site-core.js's `isSafeInternalPath` does, so an HTML-entity spelling of a slash or backslash is
// ADMITTED here but rejected there — the opposite direction of every other pinned case in this
// file. Pinned because it is the review's own finding, not because this side is wrong: the
// forwarder never actually receives HTML-entity-encoded text on the wire (a hidden field's value
// is whatever `safeInternalPath` already decoded once at build time), and taken at face value
// (no entity decoding) none of these three literal strings contain `//` or a `..` segment, so
// admitting them is consistent with this gate's own contract on the RAW string it was handed.
{
	const inconsistent = ['/&#47;&#47;evil.example', '/&#x2F;&#x2F;evil.example', '/&#92;&#92;evil.example'];
	for (const value of inconsistent) {
		ok(`isSiteRelativePath(${JSON.stringify(value)}) === true (site-core.js's isSafeInternalPath rejects the same string — pinned divergence, safe direction)`,
			modFlag.isSiteRelativePath(value) === true);
	}
}

// inboxRedirectResponse — the function that computes the Location: an internal path plus the
// `?inbox=` query merge, unit-tested directly rather than only through a full request.
{
	const r1 = modFlag.inboxRedirectResponse('/thanks', 'sent');
	ok('inboxRedirectResponse: plain path + outcome', r1.headers.get('location') === '/thanks?inbox=sent');
	const r2 = modFlag.inboxRedirectResponse('/thanks?ref=fb', 'sent');
	ok('inboxRedirectResponse: an existing query string is preserved, not replaced', r2.headers.get('location') === '/thanks?ref=fb&inbox=sent');
	const r3 = modFlag.inboxRedirectResponse('/thanks?inbox=stale', 'sent');
	ok('inboxRedirectResponse: re-submitting never stacks the param', r3.headers.get('location') === '/thanks?inbox=sent');
	// R1-P1-1 (adversarial review, round 1): the Location built above must resolve on the SITE's
	// own origin, not merely look site-relative in the raw string that fed it — an absolute URL
	// smuggled past the leading-slash check resolves to some OTHER origin.
	const r4 = modFlag.inboxRedirectResponse('https://evil.example/collect', 'sent');
	ok('inboxRedirectResponse: an absolute URL never becomes the Location — falls back to site root', r4.headers.get('location') === '/?inbox=sent');
	const r5 = modFlag.inboxRedirectResponse('http://[::1', 'sent');
	ok('inboxRedirectResponse: a value `new URL` cannot parse at all falls back to site root, not a thrown error', r5.status === 303 && r5.headers.get('location') === '/?inbox=sent');
}

// R1-P1-1 / R1-P2-1 (adversarial review, round 1) — the property, not a hand-picked list:
// whatever `isSiteRelativePath` admits, the Location `inboxRedirectResponse` builds from it must
// still resolve on the site's own origin, with a resulting pathname that does not begin with `//`
// (a network-path reference a browser reads as a host). A URL parser removes a leading
// single-dot path segment (including percent-encoded spellings) and ASCII tab/LF/CR from
// anywhere in the input BEFORE it resolves — either can turn one literal leading slash into a
// RESOLVED path that begins with two, and neither leaves a literal `//` or `..` in the raw
// string for an input-side gate to see. `isSiteRelativePath` strips the control characters
// (closing that half at the gate too), but the leading-dot-segment class is closed only by this
// result-side check — reconstructed here as a corpus, per the review's own description of its
// harness (single-dot segments and their percent-encoded spellings, control characters,
// backslashes, percent-encoded slashes, and combinations of the above), not as a list of
// examples: a fix that only closes one member of a class must not look like it closed the class.
function hostileRedirectCorpus() {
	const dotSpellings = ['.', '%2e', '%2E', '%2e%2e', '.%2e', '%2e.', './.'];
	const slashSpellings = ['//', '///', '/\\', '\\/', '\\\\', '%2f%2f', '%2F%2F'];
	const controlChars = ['\t', '\n', '\r', '\t\r', '\r\n'];
	const controlSlashSpellings = ['//', '\\\\'];
	const suffixes = ['dest.example', 'dest.example/path?q=1', 'dest.example#f', 'dest.example?x=1#y'];
	const inputs = new Set();
	// Class 2 — a leading single-dot path segment a URL parser removes before it resolves.
	for (const dot of dotSpellings) {
		for (const slashes of slashSpellings) {
			for (const suffix of suffixes) inputs.add(`/${dot}${slashes}${suffix}`);
		}
	}
	// Class 1 — an ASCII control character a URL parser drops from anywhere in the input.
	for (const ctrl of controlChars) {
		for (const slashes of controlSlashSpellings) {
			for (const suffix of suffixes) {
				inputs.add(`/${ctrl}/anything${slashes}${suffix}`);
				inputs.add(`/${ctrl}${ctrl}/anything${slashes}${suffix}`);
			}
		}
	}
	// Combined — both mechanisms on the same value.
	for (const dot of dotSpellings) {
		for (const ctrl of controlChars) {
			for (const suffix of suffixes) inputs.add(`/${ctrl}${dot}//${suffix}`);
		}
	}
	return [...inputs];
}

{
	const SITE = 'https://site.example';
	const corpus = hostileRedirectCorpus();
	ok('hostileRedirectCorpus actually generates shapes (else the property below never runs)', corpus.length > 0);
	console.log(`  … corpus size: ${corpus.length}`);
	let accepted = 0, offSite = 0;
	const offSiteExamples = [];
	for (const value of corpus) {
		if (!modFlag.isSiteRelativePath(value)) continue;
		accepted++;
		const location = modFlag.inboxRedirectResponse(value, 'sent').headers.get('location') || '';
		let resolved;
		try { resolved = new URL(location, SITE); } catch (e) { offSite++; offSiteExamples.push(value); continue; }
		if (resolved.origin !== SITE || resolved.pathname.startsWith('//')) {
			offSite++;
			if (offSiteExamples.length < 5) offSiteExamples.push(value);
		}
	}
	console.log(`  … accepted by isSiteRelativePath: ${accepted}/${corpus.length}; off-site after inboxRedirectResponse: ${offSite}`);
	if (offSiteExamples.length) console.log('  … off-site examples: ' + JSON.stringify(offSiteExamples));
	ok('the gate actually admits some of the corpus (else "0 off-site" would be vacuous)', accepted > 0);
	ok(`every corpus input the gate admits resolves ON this site, with no // pathname prefix (0/${accepted} off-site)`, offSite === 0);
}

// The same property, as a small explicit/pinned set rather than the generated corpus — the
// reviewer's own shape for proving the assertion actually fires on a value the gate admits
// (⚠️ per the review: this only means anything if at least one entry below makes
// isSiteRelativePath return true and the assertion inside the loop actually executes).
{
	const SITE = 'https://site.example';
	const shapes = [
		'/thanks', '/thanks?ref=fb', '/thanks#top', '/zh-tw/thanks', '/a/./b', '/',
		'/.//example.test', '/%2e//example.test', '/%2e%2e//example.test', '/.///example.test',
		'/' + String.fromCharCode(10) + '/x//example.test',
		'/' + String.fromCharCode(9) + '/x//example.test',
		'/' + String.fromCharCode(13) + '/x//example.test',
	];
	let admitted = 0;
	for (const value of shapes) {
		if (modFlag.isSiteRelativePath(value) !== true) continue;
		admitted++;
		const location = modFlag.inboxRedirectResponse(value, 'sent').headers.get('location');
		ok(`the Location for ${JSON.stringify(value)} resolves on this site`,
			new URL(location, SITE).origin === SITE && !new URL(location, SITE).pathname.startsWith('//'));
	}
	ok('at least one pinned shape was admitted by the gate, so the assertions above actually ran', admitted > 0);
}

// benign shapes: the repair above must not change behaviour for anything ordinary — the same
// 15 shapes the review measured, Location compared literally, not just "still same-origin"
{
	const benign = [
		['/thanks', 'sent', '/thanks?inbox=sent'],
		['/zh-tw/thanks', 'sent', '/zh-tw/thanks?inbox=sent'],
		['/thanks?ref=fb', 'sent', '/thanks?ref=fb&inbox=sent'],
		['/thanks#top', 'sent', '/thanks?inbox=sent#top'],
		['/a/./b', 'sent', '/a/b?inbox=sent'],
		['/', 'sent', '/?inbox=sent'],
		['/日本語', 'sent', '/%E6%97%A5%E6%9C%AC%E8%AA%9E?inbox=sent'],
		['/contact', 'rate_limited', '/contact?inbox=rate_limited'],
	];
	for (const [value, outcome, expected] of benign) {
		const location = modFlag.inboxRedirectResponse(value, outcome).headers.get('location');
		ok(`benign shape ${JSON.stringify(value)} is unchanged by the result-side check`, location === expected);
	}
}

// end-to-end: a successful submit with a valid thanks_to redirects THERE, not to return_to
{
	globalThis.fetch = async () => new Response('{}', { status: 200 });
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('thanks_to', '/thank-you');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('valid thanks_to: success redirects to the thanks page, not return_to', (res.headers.get('location') || '') === '/thank-you?inbox=sent');
}

// an off-site thanks_to is never trusted, even though the coral is supposed to have already
// dropped it at build time — the forwarder re-validates independently
{
	globalThis.fetch = async () => new Response('{}', { status: 200 });
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('thanks_to', 'https://evil.example/collect');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('invalid thanks_to: success falls back to return_to, never the foreign value', (res.headers.get('location') || '') === '/contact?inbox=sent');
}

// a FAILED submit stays on return_to even with a perfectly valid thanks_to — thanks= names a
// landing page for a message that went somewhere, not a retry
{
	globalThis.fetch = async () => new Response(JSON.stringify({ reason: 'rate_limited' }), { status: 429 });
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('thanks_to', '/thank-you');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('failure ignores thanks_to and returns to return_to with the reason', (res.headers.get('location') || '') === '/contact?inbox=rate_limited');
}

// the honeypot short-circuit "behaves EXACTLY as sent" — including landing on thanks_to
{
	let called = false;
	globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('thanks_to', '/thank-you');
	fd.set('_hp', 'i-am-a-bot');
	const res = await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	ok('honeypot + thanks_to: still redirects to the thanks page', (res.headers.get('location') || '') === '/thank-you?inbox=sent');
	ok('honeypot: never forwarded', called === false);
}

// thanks_to is a reserved wire name — it must never leak into the message `fields`, the same
// contract return_to/_hp/visitor_email already have
{
	let seen = null;
	globalThis.fetch = async (url, opts) => { seen = { url: String(url), opts }; return new Response('{}', { status: 200 }); };
	const fd = new FormData();
	fd.set('return_to', '/contact');
	fd.set('thanks_to', '/thank-you');
	fd.set('Name', 'Ada');
	await modFlag.default.fetch(new Request('https://site.example/__reef/inbox', {
		method: 'POST', body: fd, headers: { referer: 'https://site.example/contact' }
	}), inboxEnv);
	const payload = JSON.parse(seen.opts.body);
	ok('thanks_to never lands in fields', !('thanks_to' in payload.fields));
	ok('an ordinary field still does', payload.fields.Name === 'Ada');
}

console.log(`\n=== ${pass}/${pass + fail} PASS ===`);
process.exit(fail ? 1 : 0);
