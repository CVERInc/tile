// Behavioural test of SITE IDENTITY as the storefront's locator. Emits real workers, loads them,
// and drives `default.fetch` — so what is asserted is the QUERY STRING THAT LEAVES THE WORKER, not
// that the emitter exited 0. An emitter that accepts --site-id and bakes it nowhere passes an
// "it did not error" test and fails every assertion below.
//
// Four sites, because the interesting thing is the boundary between them:
//   site id, no guild  → no declaration means no storefront
//   guild, no site id  → an explicit provider surface stays guild-keyed
//   both               → that same explicit provider surface keeps guild precedence
//   neither            → still NO shop paths at all                             (the fail-closed)
//
// canonical plan/canonical/site/platform.md: 「Locator, capability and catalog
// source are separate facts. ... None of those facts declares whether a given
// storefront surface is C/native catalog or B/provider catalog. Generated-site
// code must not infer catalog source by asking only whether Checkout is enabled,
// whether a guild exists, or whether a provider is connected.」
//
// 🔴 The guild-only control here is a SECOND control, not the primary one. The primary one is that
// emit-shop-function.test.mjs and emit-api-transport.test.mjs still pass with their `--guild site_g1`
// fixtures untouched. A control that was edited in the same change proves nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), 'emit-site-identity-'));

const SITE_ID = 'stg-lantern-bay';
const GUILD_ID = 'site_g1';
const SHOPS = JSON.stringify([{ shopPath: '/shop', labels: {} }]);
const PROVIDER_STOREFRONTS = JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }]);

// The shop API base the emitter now REQUIRES once a storefront is declared. A synthetic origin:
// the emitter stopped carrying a baked hostname when this package moved to the public engine, and
// what these tests are about is the routing, not whose backend it is. See emit-shop-function.mjs.
//
// 🔴 Appended AFTER ...args so an explicit --api in a call still wins — arg() takes the first match.
const SHOP_API_BASE = 'https://api.example';
let emitted = 0;
async function emitWorker(args) {
	const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
	execFileSync('node', [join(here, 'emit-shop-function.mjs'), ...args, '--api', SHOP_API_BASE, '--out', out],
		{ stdio: ['ignore', 'ignore', 'pipe'] });
	return { path: out, source: readFileSync(out, 'utf8'), mod: await import(pathToFileURL(out).href) };
}

const siteOnly = await emitWorker(['--site-id', SITE_ID, '--name', 'Lantern Bay', '--shops', SHOPS]);
const guildOnly = await emitWorker(['--guild', GUILD_ID, '--name', 'NORTHWIND', '--shops', SHOPS, '--storefronts', PROVIDER_STOREFRONTS]);
const bothLocators = await emitWorker(['--guild', GUILD_ID, '--site-id', SITE_ID, '--name', 'NORTHWIND', '--shops', SHOPS, '--storefronts', PROVIDER_STOREFRONTS]);
const neither = await emitWorker(['--name', 'Plain Site']);

const PRODUCT = {
	processor: 'stripe', id: 'ITM', slug: 'riso-poster', title: 'RISO poster',
	description: 'A poster.', images: ['https://x/riso.jpg'],
	variants: [{ id: 'v1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5.0, available: true }]
};
const SHELL = '<!doctype html><html><head><title>Shop</title></head><body>' +
	'<main class="rf-main"><div data-dynamic-coral="square-shop" data-cart="1" data-detail-base="/shop"></div></main>' +
	'</body></html>';

// Every outbound URL the worker asks for, in order. `seenApi` is the whole point of this file.
function drive() {
	const seenApi = [];
	globalThis.fetch = async (url) => {
		const u = String(url);
		seenApi.push(u);
		if (u.includes('/api/v2/shop/catalog/item')) {
			return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ item: PRODUCT }) };
		}
		if (u.includes('/api/v2/shop/catalog')) {
			return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ items: [PRODUCT] }) };
		}
		return { ok: false, headers: { get: () => '' }, json: async () => null };
	};
	const seenAssets = [];
	const env = {
		ASSETS: {
			fetch: async (req) => {
				const u = String(req.url || req);
				seenAssets.push(u);
				if (u.endsWith('/shop/')) return { ok: true, text: async () => SHELL };
				return new Response('STATIC:' + u, { status: 200 });
			}
		}
	};
	return { seenApi, seenAssets, env };
}

// The query the worker actually built, isolated from the origin it was sent to (it tries
// same-origin first and the configured apiBase second — both carry the same query).
const queryOf = (url) => new URL(url).search;

// ── a locator without a structured source leaves static content alone ──────────

test('site id, no descriptor → the product detail remains static and makes no catalog call', async () => {
	const { seenApi, seenAssets, env } = drive();
	const res = await siteOnly.mod.default.fetch(new Request('https://s.example/shop/riso-poster'), env);
	assert.equal(await res.text(), 'STATIC:https://s.example/shop/riso-poster');
	assert.equal(seenApi.length, 0);
	assert.ok(seenAssets.some((u) => u.includes('/shop/riso-poster')));
});

test('site id, no descriptor → the shop index remains static and makes no catalog call', async () => {
	const { seenApi, seenAssets, env } = drive();
	const res = await siteOnly.mod.default.fetch(new Request('https://s.example/shop'), env);
	assert.equal(await res.text(), 'STATIC:https://s.example/shop');
	assert.equal(seenApi.length, 0);
	assert.ok(seenAssets.some((u) => u.endsWith('/shop')));
});

test('site id, no descriptor → the locator is baked but the shop table is empty', () => {
	assert.ok(siteOnly.source.includes('"shops":[]'), 'a locator must not manufacture a shop path');
	assert.ok(siteOnly.source.includes(`"siteId":"${SITE_ID}"`), 'the site id was not baked into the config');
});

// ── the control: the guild path is untouched ─────────────────────────────────

test('guild, explicit provider descriptor → still asks by guild_id and carries no site_id', async () => {
	const { seenApi, env } = drive();
	await guildOnly.mod.default.fetch(new Request('https://s.example/shop/riso-poster'), env);
	const item = seenApi.find((u) => u.includes('/api/v2/shop/catalog/item'));
	assert.equal(queryOf(item), `?guild_id=${GUILD_ID}&slug=riso-poster&payment_rail=square`);

	const list = drive();
	await guildOnly.mod.default.fetch(new Request('https://s.example/shop'), list.env);
	const catalog = list.seenApi.find((u) => u.includes('/api/v2/shop/catalog?'));
	assert.equal(queryOf(catalog), `?guild_id=${GUILD_ID}&payment_rail=square`);
});

test('guild, no site id → the baked config gains no siteId key', () => {
	assert.ok(!guildOnly.source.includes('"siteId"'),
		'a guild-only site\'s config must be what it was before site identity existed here');
	assert.ok(guildOnly.source.includes(`"guildId":"${GUILD_ID}"`));
});

// ── both locators: the shape every existing shop rebuilds into ────────────

// This is the case the reef build script actually produces for a site that HAS a guild: it passes
// --guild and --site-id together. If the wire moved to site_id here, every shop selling today would
// change which locator it resolves through on its next rebuild — including through cfg.apiBase, the
// legacy backend that has no site_id at all.
test('both locators, explicit provider descriptor → the wire stays guild-keyed', async () => {
	const { seenApi, env } = drive();
	await bothLocators.mod.default.fetch(new Request('https://s.example/shop/riso-poster'), env);
	const item = seenApi.find((u) => u.includes('/api/v2/shop/catalog/item'));
	assert.equal(queryOf(item), `?guild_id=${GUILD_ID}&slug=riso-poster&payment_rail=square`);
	assert.ok(!item.includes('site_id='), 'the guild-keyed query must carry no second locator');

	const list = drive();
	await bothLocators.mod.default.fetch(new Request('https://s.example/shop'), list.env);
	const catalog = list.seenApi.find((u) => u.includes('/api/v2/shop/catalog?'));
	assert.equal(queryOf(catalog), `?guild_id=${GUILD_ID}&payment_rail=square`);
});

test('both locators → the site id is still baked, so the wire can be moved without a new flag', () => {
	assert.ok(bothLocators.source.includes(`"siteId":"${SITE_ID}"`));
	assert.ok(bothLocators.source.includes(`"guildId":"${GUILD_ID}"`));
});

// ── the fail-closed: absence stays absence ───────────────────────────────────

test('neither site id nor guild → no shop paths, and /shop/<slug> stays the static page', async () => {
	assert.ok(neither.source.includes('"shops":[]'), 'a shopless site must claim no shop path');
	const { seenApi, seenAssets, env } = drive();
	const res = await neither.mod.default.fetch(new Request('https://s.example/shop/lookbook'), env);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), 'STATIC:https://s.example/shop/lookbook',
		'a shopless site must not intercept its own /shop/<page>');
	assert.equal(seenApi.length, 0, 'a shopless site must not call the catalog at all');
	assert.ok(seenAssets.some((u) => u.includes('/shop/lookbook')));
});
