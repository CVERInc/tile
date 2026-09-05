// square-shop — a storefront on a site that has NO Discord community.
//
// 🔴 The defect, in the order the code ran it. `mount()` read `data-guild-id`, and on a host
// without one wrote an error paragraph into the container and returned — BEFORE it looked for
// the grid the edge worker had already rendered there. shop-function-template.js has been
// site-keyed since it grew `shopLocatorParam`, so on a guildless site the server DID render
// that site's products into the container. This was therefore never "the island fails to
// hydrate": the products a shopper could already see were replaced, on load, with the string
// `square-shop: missing data-guild-id`. Nothing threw. It rendered the wrong thing, successfully
// — which is why every assertion below reads the RENDERED DOM or the QUERY STRING THAT LEFT the
// widget, and none of them reads "it did not throw".
//
// Canonical (plan/canonical/commerce/model.md): "S-layer buyer storefront is site-scoped." A
// Discord guild may be a compatibility or contextual locator, but it is not a precondition for
// the storefront existing, for its products being readable, or for a buyer flow to start.
//
// 🔴 Half of this file is a CONTROL, and the controls must stay green when the fix is reverted.
// The compatibility promise has two halves that fail in different places:
//   the WIRE  — a guild shop that started sending `site_id` would be asking `data-api-base`
//               (which can still be the legacy backend) a question it has no vocabulary for;
//   the CART  — the localStorage key. It lives on the shopper's own machine, so a key that
//               moved would not migrate a basket, it would silently empty it on the next visit.
// Neither is observable by reading the source, so both are driven here.
//
// square-shop.js is a browser script; it is run here as a function body with document/window/
// fetch injected, the same way cart-checkout-ref.test.mjs does it. Nothing in the source is
// rewritten (only the trailing `export {…}` block, illegal inside a function body, is dropped)
// and no global is touched.
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderProductPage } from './product-page-core.js';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, 'square-shop.js'), 'utf8').replace(
	/\nexport \{[\s\S]*?\n\};?\s*$/,
	'\n'
);

const SITE_ID = 'stg-lantern-bay';
const GUILD_ID = 'g1';
const API = 'https://api.test';
const CART_PREFIX = 'dc-square-shop-cart:';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }
function eq(name, actual, expected) {
	ok(name, actual === expected, `got ${JSON.stringify(actual)} · want ${JSON.stringify(expected)}`);
}

// ── the smallest DOM these paths actually touch ──────────────────────────
function descendants(el, out = []) { for (const c of el.children) { out.push(c); descendants(c, out); } return out; }

// `.cls`, `[attr]` and `.cls[attr]` — the three shapes mount(), itemsFromSsr() and renderCart()
// ask for. Anything else throws rather than quietly answering null, because a selector this
// shim cannot parse would look exactly like a node that is not there.
function matchAll(el, sel) {
	const m = /^(?:\.([\w-]+))?(?:\[([\w-]+)\])?$/.exec(String(sel).trim());
	if (!m || (!m[1] && !m[2])) throw new Error('fake querySelector cannot parse: ' + sel);
	return descendants(el).filter((c) =>
		(!m[1] || String(c.className).split(/\s+/).indexOf(m[1]) >= 0) &&
		(!m[2] || c.getAttribute(m[2]) !== null));
}

function makeEl(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		className: '', textContent: '', href: '', type: '',
		hidden: false, disabled: false, parentElement: null,
		children: [], _attrs: Object.create(null), _listeners: Object.create(null),
		_qs: new Map(), _html: '',
		setAttribute(k, v) { el._attrs[k] = String(v); },
		getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
		removeAttribute(k) { delete el._attrs[k]; },
		addEventListener(t, fn) { (el._listeners[t] = el._listeners[t] || []).push(fn); },
		appendChild(c) { c.parentElement = el; el.children.push(c); return c; },
		append(...cs) { for (const c of cs) el.appendChild(c); },
		querySelectorAll(sel) { return matchAll(el, sel); },
		querySelector(sel) {
			const found = matchAll(el, sel);
			if (found.length) return found[0];
			// itemCard() builds a card's subtree by assigning an innerHTML STRING, which a real DOM
			// parses into nodes and this object does not. When the markup says the node is there,
			// mint one and keep it, so a Buy button appended into it stays reachable from the tree
			// the assertions walk. A selector in NEITHER the children nor the markup is still null:
			// absence has to stay observable.
			const cls = String(sel).replace(/^\./, '');
			if (!String(el._html).includes('class="' + cls + '"')) return null;
			if (!el._qs.has(sel)) { const c = makeEl('div'); c.className = cls; el.appendChild(c); el._qs.set(sel, c); }
			return el._qs.get(sel);
		}
	};
	el.classList = {
		add(c) { const s = String(el.className).split(/\s+/).filter(Boolean); if (s.indexOf(c) < 0) s.push(c); el.className = s.join(' '); },
		remove(c) { el.className = String(el.className).split(/\s+/).filter((x) => x && x !== c).join(' '); },
		contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; }
	};
	// 🔴 Assigning innerHTML REPLACES the subtree, exactly as a browser does. That is not shim
	// decoration: `el.innerHTML = '<p …>error</p>'` destroying the server-rendered grid IS the
	// defect under test, so a shim that kept the children would report the bug as already fixed.
	Object.defineProperty(el, 'innerHTML', {
		get() { return el._html; },
		set(v) { el._html = String(v); el.children = []; el._qs = new Map(); }
	});
	return el;
}

// What is ACTUALLY on screen under `el`: its own markup plus every descendant's, in tree order.
// (A node whose markup was assigned as a string and then had children appended contributes both
// halves — a real DOM would have parsed the first into the second, so the shell of an
// innerHTML-built wrapper can appear twice. Harmless: nothing below counts occurrences.)
function rendered(el) {
	return String(el._html || '') + String(el.textContent || '') + el.children.map(rendered).join('');
}

function byClass(root, cls) {
	return descendants(root).filter((e) => String(e.className).split(/\s+/).includes(cls));
}

// Add the first product to the basket through the control the widget actually rendered, and hand
// back the localStorage keys that write produced — joined, so one `eq` reads the whole store.
//
// 🔴 A missing control comes back as a DESCRIBED STRING rather than a throw. Under the reverted
// fix the guildless container holds no buttons at all, and a throw here would abort the file
// before the guild-shaped controls below had run — turning "the fix is what makes this pass" into
// "the file crashed", which proves much less.
function addFirstProduct(sb, root) {
	const found = byClass(root, 'dc-square-shop-buy');
	if (found.length !== SSR_CARDS.length) return `no add control rendered (found ${found.length}, want ${SSR_CARDS.length})`;
	for (const fn of found[0]._listeners.click || []) fn();
	return [...sb.store.keys()].join('|');
}

// ── the widget, with its world injected ──────────────────────────────────
function loadSquareShop({ storage = {}, catalog = null } = {}) {
	const store = new Map(Object.entries(storage));
	const fetched = [];
	const document = {
		readyState: 'complete',
		head: makeEl('head'), body: makeEl('body'),
		createElement: (t) => makeEl(t),
		querySelectorAll: () => [],
		addEventListener: () => {}
	};
	const window = {
		location: { href: 'https://shop.example/shop', origin: 'https://shop.example', pathname: '/shop' },
		history: { replaceState() {} },
		localStorage: {
			getItem: (k) => (store.has(k) ? store.get(k) : null),
			setItem: (k, v) => { store.set(k, String(v)); },
			removeItem: (k) => { store.delete(k); }
		},
		dispatchEvent: () => true
	};
	// `fetched` stays a list of URL STRINGS — arms 2-4 read it as one. `requests` is the same
	// calls with their init kept, which is the only place the POST BODY exists: a checkout is
	// decided by what is IN the request, not by which URL it went to.
	const requests = [];
	const fetchImpl = async (url, init) => {
		fetched.push(String(url));
		requests.push({ url: String(url), init: init || null });
		// 🔴 The till answers the way the REAL till does, and that is what separates asserting a
		// wire shape from asserting a sale. Both POST handlers in
		// reef/apps/rsp/src/commerce/shop-endpoints.ts open with
		//   if (!cleanString(body.site_id) && !cleanString(body.guild_id))
		//       return shopJson({ error: "site_id or guild_id is required" }, 400);
		// and `cleanString` trims before testing, so `""` is not a weak locator — it IS the 400.
		// A stub that said yes to anything would let an empty locator look like a completed
		// purchase, which is precisely the false green these arms exist to prevent.
		if (init && init.method === 'POST') {
			let sent = {};
			try { sent = JSON.parse(String(init.body)); } catch {}
			const named = (v) => typeof v === 'string' && v.trim() !== '';
			if (!named(sent.site_id) && !named(sent.guild_id)) {
				return { ok: false, status: 400, json: async () => ({ error: 'site_id or guild_id is required' }) };
			}
			return { ok: true, status: 200, json: async () => ({ url: CHECKOUT_LINK }) };
		}
		if (!catalog) return { ok: false, status: 500, json: async () => null };
		return { ok: true, status: 200, json: async () => catalog };
	};
	const factory = new Function(
		'document', 'window', 'crypto', 'fetch', 'CustomEvent',
		SOURCE + '\nreturn { mount, renderCart, readLabels };'
	);
	const api = factory(document, window, globalThis.crypto, fetchImpl, globalThis.CustomEvent);
	return { ...api, fetched, requests, store, win: window };
}

const CHECKOUT_LINK = 'https://checkout.test/session-1';

const CATALOG = {
	connected: true,
	items: [
		{ variation_id: 'V1', name: 'Riso poster', display_price: 20, currency: 'USD', slug: 'riso-poster' },
		{ variation_id: 'V2', name: 'Ink set', display_price: 35, currency: 'USD', slug: 'ink-set' }
	]
};
// What the edge worker already put in the container. Same two products, so "the grid survived"
// and "the grid was refetched" cannot be confused for each other by their contents — they are
// told apart by `fetched`, which is empty on the SSR fast path.
const SSR_CARDS = [
	{ vid: 'V1', name: 'Riso poster', price: 20, currency: 'USD', slug: 'riso-poster' },
	{ vid: 'V2', name: 'Ink set', price: 35, currency: 'USD', slug: 'ink-set' }
];

function host({ guildId = '', siteId = '', cart = '', ssr = false } = {}) {
	const el = makeEl('div');
	el.setAttribute('data-dynamic-coral', 'square-shop');
	if (guildId) el.setAttribute('data-guild-id', guildId);
	if (siteId) el.setAttribute('data-site-id', siteId);
	if (cart) el.setAttribute('data-cart', cart);
	el.setAttribute('data-api-base', API);
	if (!ssr) return el;
	const grid = makeEl('div');
	grid.className = 'dc-square-shop-grid';
	grid.setAttribute('data-ssr', '1');
	for (const c of SSR_CARDS) {
		const card = makeEl('div');
		card.className = 'dc-square-shop-card';
		card.setAttribute('data-variation-id', c.vid);
		card.setAttribute('data-price', String(c.price));
		card.setAttribute('data-currency', c.currency);
		card.setAttribute('data-slug', c.slug);
		const name = makeEl('p');
		name.className = 'dc-square-shop-name';
		name.textContent = c.name;
		card.appendChild(name);
		grid.appendChild(card);
	}
	el.appendChild(grid);
	return el;
}

const NAME_MARKUP = (n) => `<p class="dc-square-shop-name">${n}</p>`;

// ── 1 · the defect: a guildless site's server-rendered grid must survive ──
{
	const sb = loadSquareShop({ catalog: CATALOG });
	const el = host({ siteId: SITE_ID, ssr: true });
	await sb.mount(el);
	const html = rendered(el);

	ok('a site-keyed host keeps the grid the edge worker rendered — first product',
		html.includes(NAME_MARKUP('Riso poster')), html.slice(0, 200));
	ok('…and the second', html.includes(NAME_MARKUP('Ink set')), html.slice(0, 200));
	ok('…and nothing on screen is the error line',
		!html.includes('dc-square-shop-error') && !html.includes('missing data-'), html.slice(0, 200));
	eq('…and the container holds exactly one grid', el.children.length, 1);
	eq('…which is the product grid', el.children[0] ? el.children[0].className : '(container is empty)', 'dc-square-shop-grid');
	eq('…with one card per SSR card', el.children[0] ? el.children[0].children.length : '(container is empty)', SSR_CARDS.length);
	eq('…and the fast path asked the network for nothing', sb.fetched.length, 0);
}

// ── 2 · the wire: a guildless site is named by its own id ────────────────
{
	const sb = loadSquareShop({ catalog: CATALOG });
	const el = host({ siteId: SITE_ID });
	await sb.mount(el);

	// '(nothing was asked)' rather than an index into an empty array, for the same reason arm 1
	// does not index an empty container: a crash here would abort the controls further down.
	const asked = sb.fetched[0] || '(nothing was asked)';
	eq('a site-keyed host asks the catalog by site_id', asked,
		`${API}/api/v2/shop/catalog?site_id=${SITE_ID}`);
	eq('…the query string, isolated from the origin',
		sb.fetched[0] ? new URL(sb.fetched[0]).search : asked, `?site_id=${SITE_ID}`);
	ok('…and sends no empty guild_id alongside it', !asked.includes('guild_id'), asked);
	ok('…and the products it answered with are on screen',
		rendered(el).includes(NAME_MARKUP('Riso poster')), rendered(el).slice(0, 200));
}

// ── 3 · CONTROL · the guild wire has not moved ───────────────────────────
{
	const sb = loadSquareShop({ catalog: CATALOG });
	await sb.mount(host({ guildId: GUILD_ID }));
	eq('a guild-only host asks by guild_id, exactly as before', sb.fetched[0],
		`${API}/api/v2/shop/catalog?guild_id=${GUILD_ID}`);

	// The shape the reef build script actually produces for a site that HAS a guild: both flags.
	const both = loadSquareShop({ catalog: CATALOG });
	await both.mount(host({ guildId: GUILD_ID, siteId: SITE_ID }));
	eq('both locators present → the guild still wins on the wire', both.fetched[0],
		`${API}/api/v2/shop/catalog?guild_id=${GUILD_ID}`);
	ok('…and exactly one locator goes on the wire', !both.fetched[0].includes('site_id'), both.fetched[0]);
}

// ── 4 · the fail-closed was not widened ──────────────────────────────────
// A host naming NO storefront still gets the error, even with a grid sitting under it: an empty
// locator does not mean "this site's shop", it means "ask the backend for everybody's".
{
	const sb = loadSquareShop({ catalog: CATALOG });
	const el = host({ ssr: true });
	await sb.mount(el);
	const html = rendered(el);

	ok('neither locator → the error line is what renders', html.includes('dc-square-shop-error'), html);
	ok('…and it names both attributes a host could have supplied',
		html.includes('data-site-id') && html.includes('data-guild-id'), html);
	eq('…and the catalog was not asked anything', sb.fetched.length, 0);
	eq('…and no product survived on screen', html.includes('Riso poster'), false);
}

// ── 5 · CONTROL · the cart key ───────────────────────────────────────────
{
	const guild = loadSquareShop({ catalog: CATALOG });
	const gEl = host({ guildId: GUILD_ID, cart: '1', ssr: true });
	await guild.mount(gEl);
	eq('a guild shop writes the basket key it has always written',
		addFirstProduct(guild, gEl), CART_PREFIX + GUILD_ID);

	const site = loadSquareShop({ catalog: CATALOG });
	const sEl = host({ siteId: SITE_ID, cart: '1', ssr: true });
	await site.mount(sEl);
	eq('a guildless shop keys its basket by the site — the case that had no basket to lose',
		addFirstProduct(site, sEl), CART_PREFIX + SITE_ID);

	const both = loadSquareShop({ catalog: CATALOG });
	const bEl = host({ guildId: GUILD_ID, siteId: SITE_ID, cart: '1', ssr: true });
	await both.mount(bEl);
	eq('both locators present → the basket stays on the guild key, so no live shop is emptied',
		addFirstProduct(both, bEl), CART_PREFIX + GUILD_ID);
}

// ── 6 · the product page: the container it emits ─────────────────────────
const PRODUCT = {
	processor: 'stripe', id: 'ITM', slug: 'riso-poster', title: 'RISO poster',
	description: 'A poster.', images: ['https://x/riso.jpg'],
	variants: [{ id: 'v1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5.0, available: true }]
};
const BASE_CFG = { apiBase: API, shopPath: '/shop', canonical: 'https://x/shop/riso-poster', siteName: 'Lantern Bay', labels: {} };
const pageGuildOnly = renderProductPage(PRODUCT, { ...BASE_CFG, guildId: GUILD_ID }).bodyHtml;
const pageBoth = renderProductPage(PRODUCT, { ...BASE_CFG, guildId: GUILD_ID, siteId: SITE_ID }).bodyHtml;
const pageSiteOnly = renderProductPage(PRODUCT, { ...BASE_CFG, siteId: SITE_ID }).bodyHtml;

// 🔴 What "unchanged for a guild site" means here, exactly. The CONTAINER is byte-identical: a
// page rendered without a site id carries the same attributes, in the same order, that it always
// did. The emitted inline script is NOT — it gained one `getAttribute` and one `||` whose right
// side a guild page never evaluates — and it cannot be, since one script is emitted for every
// page and it is the half that has to read the sibling locator. So the guarantee is proven
// BEHAVIOURALLY instead, below and in arm 7: same wire, same basket key, same container bytes.
const containerTag = (html) => /<div class="dc-pp" data-dc-product[\s\S]*?>/.exec(html)[0];
{
	ok('CONTROL · a guild-only product page puts no site locator on its container',
		!containerTag(pageGuildOnly).includes('data-site-id'), containerTag(pageGuildOnly));
	ok('CONTROL · …and that container opens with exactly the bytes it did before',
		/<div class="dc-pp" data-dc-product\n\tdata-guild-id="g1"\n\tdata-shop-path="\/shop"\n/.test(pageGuildOnly));

	// The whole-document form of "sibling, not replacement": remove the one line the site locator
	// adds and the both-locators page is the guild-only page, byte for byte.
	eq('data-site-id is a SIBLING — the both-locators page is the guild-only page plus one line',
		pageBoth.replace(`\n\tdata-site-id="${SITE_ID}"`, ''), pageGuildOnly);

	ok('a guildless product page carries the site locator',
		pageSiteOnly.includes(`\n\tdata-site-id="${SITE_ID}"`));
	ok('…and still emits the empty data-guild-id it always emitted',
		pageSiteOnly.includes('data-guild-id=""'));
}

// ── 7 · the product page's OWN script, executed ──────────────────────────
// Not a source grep. The inline module the renderer emitted is pulled out of the page it just
// produced, its container attributes are read back off that same page (un-escaped exactly as a
// browser would), and the Add button's real listener is fired — so what is asserted is the key
// the shipped script writes to the shipped page's localStorage.
const unesc = (s) => String(s)
	.replace(/&#39;/g, "'").replace(/&quot;/g, '"')
	.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function addToCartOnProductPage(bodyHtml) {
	const tag = /<div class="dc-pp" data-dc-product[\s\S]*?>/.exec(bodyHtml)[0];
	const attr = (n) => { const m = new RegExp('\\sdata-' + n + '="([^"]*)"').exec(tag); return m ? unesc(m[1]) : null; };
	const script = /<script type="module">([\s\S]*?)<\/script>/.exec(bodyHtml)[1];

	const root = makeEl('div');
	for (const n of ['guild-id', 'site-id', 'shop-path', 'variants']) {
		const v = attr(n);
		if (v !== null) root.setAttribute('data-' + n, v);
	}
	const addBtn = makeEl('button');
	const nodes = new Map([
		['[data-dc-variant]', null], ['[data-dc-price]', makeEl('p')],
		['[data-dc-add]', addBtn], ['[data-dc-cartlink]', makeEl('a')], ['[data-dc-main]', null]
	]);
	root.querySelector = (sel) => (nodes.has(sel) ? nodes.get(sel) : null);
	root.querySelectorAll = () => [];

	const store = new Map();
	const localStorage = {
		getItem: (k) => (store.has(k) ? store.get(k) : null),
		setItem: (k, v) => { store.set(k, String(v)); },
		removeItem: (k) => { store.delete(k); }
	};
	const document = { querySelector: (sel) => (sel === '[data-dc-product]' ? root : null) };
	const window = { dispatchEvent: () => true, matchMedia: () => ({ matches: false }) };

	new Function('document', 'window', 'localStorage', 'CustomEvent', script)(
		document, window, localStorage, globalThis.CustomEvent);
	for (const fn of addBtn._listeners.click || []) fn();
	clearTimeout(addBtn._dcResetTimer); // the button's 1.2s label-reset timer, not this test's business
	return [...store.keys()];
}

{
	eq('CONTROL · a guild product page still writes the basket key it always wrote',
		addToCartOnProductPage(pageGuildOnly).join('|'), CART_PREFIX + GUILD_ID);
	eq('CONTROL · with both locators the product page stays on the guild key',
		addToCartOnProductPage(pageBoth).join('|'), CART_PREFIX + GUILD_ID);
	eq('a guildless product page writes a site-keyed basket, so /shop and this page share ONE cart',
		addToCartOnProductPage(pageSiteOnly).join('|'), CART_PREFIX + SITE_ID);
}

// ── 8 · the seam: source declaration reaches the emitted Worker ───────────
// Arms 6 and 7 drive renderProductPage directly, so they are green whatever the caller passes.
// This arm is the emitted-worker boundary where a locator used to manufacture a
// provider storefront. Canonical plan/canonical/site/platform.md: 「Locator,
// capability and catalog source are separate facts. ... None of those facts
// declares whether a given storefront surface is C/native catalog or B/provider
// catalog. Generated-site code must not infer catalog source by asking only
// whether Checkout is enabled, whether a guild exists, or whether a provider is
// connected.」 So it drives real workers: source-less stays ASSETS-only; the
// locator compatibility control supplies an explicit provider descriptor.
{
	const workDir = mkdtempSync(join(tmpdir(), 'site-keyed-storefront-'));
	const SHOPS = JSON.stringify([{ shopPath: '/shop', labels: {} }]);
	const PROVIDER = JSON.stringify([{ path: '/shop', source: 'provider', provider: 'stripe' }]);
// The shop API base the emitter now REQUIRES once a storefront is declared. A synthetic origin:
// the emitter stopped carrying a baked hostname when this package moved to the public engine, and
// what these tests are about is the routing, not whose backend it is. See emit-shop-function.mjs.
//
// 🔴 Appended AFTER ...args so an explicit --api in a call still wins — arg() takes the first match.
const SHOP_API_BASE = 'https://api.example';
	let n = 0;
	async function emit(args) {
		const out = join(workDir, 'worker-' + (++n) + '.mjs');
		execFileSync('node', [join(here, 'emit-shop-function.mjs'), ...args, '--api', SHOP_API_BASE, '--out', out],
			{ stdio: ['ignore', 'ignore', 'pipe'] });
		return (await import(pathToFileURL(out).href)).default;
	}
	const SHELL = '<!doctype html><html><head><title>Shop</title></head><body>' +
		'<main><div data-dynamic-coral="square-shop" data-cart="1" data-detail-base="/shop"></div></main>' +
		'</body></html>';
	const ITEM = {
		processor: 'stripe', id: 'ITM', slug: 'riso-poster', title: 'RISO poster',
		description: 'A poster.', images: ['https://x/riso.jpg'],
		variants: [{ id: 'v1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5.0, available: true }]
	};
	const savedFetch = globalThis.fetch;
	let providerCalls = 0;
	globalThis.fetch = async (url) => {
		providerCalls++;
		return String(url).includes('/api/v2/shop/catalog/item')
			? { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ item: ITEM }) }
			: { ok: false, headers: { get: () => '' }, json: async () => null };
	};
	const assetCalls = [];
	const env = { ASSETS: { fetch: async (request) => {
		const url = String(request.url || request);
		assetCalls.push(url);
		if (url.endsWith('/shop/')) return { ok: true, text: async () => SHELL };
		return new Response('STATIC:' + url);
	} } };

	async function served(worker) {
		const res = await worker.fetch(new Request('https://s.example/shop/riso-poster'), env);
		const html = await res.text();
		const m = /<div class="dc-pp" data-dc-product[\s\S]*?>/.exec(html);
		return { html, tag: m ? m[0] : '' };
	}

	const siteWorker = await emit(['--site-id', SITE_ID, '--name', 'Lantern Bay', '--shops', SHOPS]);
	const sourceLess = await served(siteWorker);
	ok('a guildless source-less site leaves the detail path to ASSETS',
		sourceLess.html === 'STATIC:https://s.example/shop/riso-poster', sourceLess.html.slice(0, 120));
	eq('…and makes no provider catalog request', providerCalls, 0);
	ok('…and ASSETS received the static detail request', assetCalls.includes('https://s.example/shop/riso-poster'));

	const guildWorker = await emit(['--guild', GUILD_ID, '--name', 'NORTHWIND', '--shops', SHOPS, '--storefronts', PROVIDER]);
	const guild = await served(guildWorker);
	globalThis.fetch = savedFetch;

	ok('CONTROL · an explicit guild provider surface serves the existing guild container',
		guild.tag.includes(`data-guild-id="${GUILD_ID}"`) && !guild.tag.includes('data-site-id'), guild.tag || guild.html.slice(0, 120));
}

// ── 9 · the till, instant mode: the body that LEFT the widget ────────────
// Arms 1-3 are about what the widget READS. This is what it WRITES, and the two used to
// disagree: the catalog query went guild-preferred while the checkout body stayed hard-wired to
// `guild_id: guildId`, so a guildless site listed its products, let a shopper fill a basket, and
// then handed the backend `{"guild_id":""}` at the till. An empty locator is not "unspecified"
// there — RSP's shop endpoints refuse when neither key resolves — so the shape delivered was a
// storefront you can browse and cannot buy from. Nothing threw there either.
//
// Every assertion below therefore reads the REQUEST BODY as a string, not a return value, and
// not "it did not throw". The string form is the point: it pins key ORDER as well as key
// presence, which is what "a guild shop's request is unchanged" has to mean when the locator
// stopped being a literal property and became a spread.
const UUID_V4 = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const UUID_V4_GLOBAL = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig;
const INSTANT_URL = `${API}/api/v2/square/catalog/checkout`;
const CART_URL = `${API}/api/v2/shop/cart`;
const CART_LINES = '[{"variation_id":"V1","quantity":1}]';
const REDIRECT = 'https://shop.example/shop/complete?ref=REF';

const posted = (sb) => sb.requests.filter((r) => r.init && r.init.method === 'POST');

// The one body that left, or a DESCRIBED STRING when that is not what happened — same reason
// addFirstProduct describes instead of throwing: under the reverted fix a later control must
// still get to run.
function postedBody(sb) {
	const p = posted(sb);
	if (p.length !== 1) return `(the till was asked ${p.length} times, want exactly 1)`;
	// The minted idempotency ref is random BY DESIGN, so it is the one field a literal cannot
	// name. Swapping it for a fixed token leaves every other byte — and the order of all of
	// them — inside the assertion; that the ref is a real uuid is asserted separately below.
	return String(p[0].init.body).replace(UUID_V4_GLOBAL, 'REF');
}

async function buyFirstProduct(sb, root) {
	const buys = byClass(root, 'dc-square-shop-buy');
	if (buys.length !== SSR_CARDS.length) return `(no Buy control rendered: found ${buys.length}, want ${SSR_CARDS.length})`;
	for (const fn of buys[0]._listeners.click || []) await fn();
	return postedBody(sb);
}

// Cart mode is two clicks, and both have to be the real controls: add the first product through
// the grid's own button, then press the Checkout the panel rendered.
async function checkoutTheCart(sb, root) {
	const adds = byClass(root, 'dc-square-shop-buy');
	if (adds.length !== SSR_CARDS.length) return `(no add control rendered: found ${adds.length}, want ${SSR_CARDS.length})`;
	for (const fn of adds[0]._listeners.click || []) fn();
	const tills = byClass(root, 'dc-square-shop-checkout');
	if (tills.length !== 1) return `(no single Checkout control rendered: found ${tills.length})`;
	if (tills[0].disabled) return '(the Checkout control was disabled after adding a product)';
	for (const fn of tills[0]._listeners.click || []) await fn();
	return postedBody(sb);
}

{
	const sb = loadSquareShop({ catalog: CATALOG });
	const el = host({ siteId: SITE_ID, ssr: true });
	await sb.mount(el);
	const body = await buyFirstProduct(sb, el);

	eq('a guildless instant checkout names the storefront by site_id', body,
		`{"site_id":"${SITE_ID}","variation_id":"V1","redirect_url":"${REDIRECT}","client_request_ref":"REF"}`);
	ok('…and the string that left carries no guild_id at all — not even an empty one',
		!body.includes('guild_id'), body);
	eq('…and it went to the single-item endpoint', posted(sb).length ? posted(sb)[0].url : '(nothing was posted)', INSTANT_URL);
	ok('…and REF above stands in for a real minted idempotency key, not an absent one',
		posted(sb).length ? UUID_V4.test(String(JSON.parse(posted(sb)[0].init.body).client_request_ref)) : false, body);
	eq('…and the shopper was handed the payment link, which is the whole point of the fix',
		sb.win.location.href, CHECKOUT_LINK);
}

// ── 9b · CONTROL · the guild instant body has not moved one byte ─────────
{
	const g = loadSquareShop({ catalog: CATALOG });
	const gEl = host({ guildId: GUILD_ID, ssr: true });
	await g.mount(gEl);
	eq('CONTROL · a guild instant checkout sends byte-for-byte the body it always sent',
		await buyFirstProduct(g, gEl),
		`{"guild_id":"${GUILD_ID}","variation_id":"V1","redirect_url":"${REDIRECT}","client_request_ref":"REF"}`);

	// The shape the reef build script actually produces for a site that HAS a guild: both flags.
	const both = loadSquareShop({ catalog: CATALOG });
	const bEl = host({ guildId: GUILD_ID, siteId: SITE_ID, ssr: true });
	await both.mount(bEl);
	eq('CONTROL · both locators present → the till still hears only the guild',
		await buyFirstProduct(both, bEl),
		`{"guild_id":"${GUILD_ID}","variation_id":"V1","redirect_url":"${REDIRECT}","client_request_ref":"REF"}`);
}

// ── 10 · the till, cart mode ─────────────────────────────────────────────
// The other checkout, and it had the identical defect on a DIFFERENT endpoint and a different
// body shape — so a fix proven only through startCheckout would have left half the storefront
// unbuyable. Cart mode is also the mode a Stripe seller is told to use (see the note above
// startCheckout), which makes this the path a guildless site is most likely to be on.
{
	const sb = loadSquareShop({ catalog: CATALOG });
	const el = host({ siteId: SITE_ID, cart: '1', ssr: true });
	await sb.mount(el);
	const body = await checkoutTheCart(sb, el);

	eq('a guildless cart checkout names the storefront by site_id', body,
		`{"site_id":"${SITE_ID}","items":${CART_LINES},"collect_shipping":false,"redirect_url":"${REDIRECT}","client_request_ref":"REF"}`);
	ok('…and the string that left carries no guild_id at all — not even an empty one',
		!body.includes('guild_id'), body);
	eq('…and it went to the processor-neutral cart endpoint',
		posted(sb).length ? posted(sb)[0].url : '(nothing was posted)', CART_URL);
	eq('…and the shopper was handed the payment link', sb.win.location.href, CHECKOUT_LINK);
}

// ── 10b · CONTROL · the guild cart body has not moved one byte ───────────
{
	const g = loadSquareShop({ catalog: CATALOG });
	const gEl = host({ guildId: GUILD_ID, cart: '1', ssr: true });
	await g.mount(gEl);
	eq('CONTROL · a guild cart checkout sends byte-for-byte the body it always sent',
		await checkoutTheCart(g, gEl),
		`{"guild_id":"${GUILD_ID}","items":${CART_LINES},"collect_shipping":false,"redirect_url":"${REDIRECT}","client_request_ref":"REF"}`);

	const both = loadSquareShop({ catalog: CATALOG });
	const bEl = host({ guildId: GUILD_ID, siteId: SITE_ID, cart: '1', ssr: true });
	await both.mount(bEl);
	eq('CONTROL · both locators present → the cart till still hears only the guild',
		await checkoutTheCart(both, bEl),
		`{"guild_id":"${GUILD_ID}","items":${CART_LINES},"collect_shipping":false,"redirect_url":"${REDIRECT}","client_request_ref":"REF"}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
