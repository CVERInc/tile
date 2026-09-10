import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatMoney } from './product-page-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
// The shop API base the emitter now REQUIRES once a storefront is declared. A synthetic origin:
// the emitter stopped carrying a baked hostname when this package moved to the public engine, and
// what these tests are about is the routing, not whose backend it is. See emit-shop-function.mjs.
//
// 🔴 Appended AFTER ...args so an explicit --api in a call still wins — arg() takes the first match.
const SHOP_API_BASE = 'https://api.example';
const temp = mkdtempSync(path.join(os.tmpdir(), 'storefront-source-routing-'));
const contract = path.join(temp, 'site-api-transport.contract.json');
writeFileSync(contract, JSON.stringify({
  bindingName: 'RSP',
  checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
  forward: [
    { match: 'prefix', value: '/api/', methods: ['GET', 'POST'] },
    { match: 'exact', value: '/checkout/success', methods: ['GET'] },
  ],
  verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
  onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));

function emit(name, args) {
  const out = path.join(temp, `${name}.mjs`);
  execFileSync('node', [emitter, '--api-contract', contract, ...args, '--api', SHOP_API_BASE, '--out', out], { stdio: 'pipe' });
  return { out, load: () => import(`${pathToFileURL(out).href}?${Date.now()}-${Math.random()}`) };
}

// 🔴 No `--api` here, and SQUARE_SHOP_API_BASE is stripped from the child's environment rather
// than inherited. One of the failures below is precisely "no shop API base was given" — and the
// emitter reads that variable as a fallback, so a developer who happens to have it exported would
// run a test that measures the opposite of what it claims. A negative test has to be immune to
// the shell that launched it.
function emitFailure(name, args) {
  const out = path.join(temp, `${name}.mjs`);
  const env = { ...process.env };
  delete env.SQUARE_SHOP_API_BASE;
  const result = spawnSync('node', [emitter, '--api-contract', contract, ...args, '--out', out], { encoding: 'utf8', env });
  return { out, result };
}

const shell = '<!doctype html><html data-theme="reef"><head><title>Donor</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>';
const product = {
  slug: 'reef-tee',
  copy: { name: 'Reef Tee', description_html: '<p>Repo-backed copy</p>', image_ref: '/tee.jpg', media: [{ url: '/tee.jpg' }], requires_shipping: true },
  commerce: { sku: 'tee-sku', product_id: 'p1', variant_id: 'catalog-variant', currency: 'USD', unit_price: 1900, tracked: true, available: 2, reserved: 0, status: 'IN_STOCK' },
};

test('site and guild locators without a descriptor leave /shop to ASSETS', async () => {
  const { load } = emit('source-less', ['--site-id', 'site-a', '--guild', 'guild-a', '--shops', JSON.stringify([{ shopPath: '/shop' }])]);
  const mod = await load();
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls++; throw new Error('provider must not run'); };
  try {
    const response = await mod.default.fetch(new Request('https://site.example/shop'), {
      ASSETS: { fetch: async () => new Response('STATIC-SHOP') },
      RSP: { fetch: async () => { throw new Error('native must not run'); } },
    });
    assert.equal(await response.text(), 'STATIC-SHOP');
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a derived provider:square descriptor renders product detail', async () => {
  const { load } = emit('derived-product', ['--site-id', 'site-legacy', '--guild', 'guild-legacy', '--shops', JSON.stringify([{ shopPath: '/shop' }]), '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square', derived: 'raw-square-shop' }])]);
  const mod = await load();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json({ item: { variation_id: 'sq-tee', slug: 'reef-tee', name: 'Reef Tee', display_price: 19, currency: 'USD' } });
  };
  try {
    const env = { ASSETS: { fetch: async () => new Response(shell) } };
    const response = await mod.default.fetch(new Request('https://site.example/shop/reef-tee'), env);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Reef Tee/);
    assert.match(html, /NAV/);
    assert.match(html, /FOOT/);
    assert.equal(calls[0].pathname, '/api/v2/shop/catalog/item');
    assert.equal(calls[0].searchParams.get('guild_id'), 'guild-legacy');
    // The derived marker is provenance only; source/provider select the rail.
    assert.equal(calls[0].searchParams.get('payment_rail'), 'square');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a derived provider:square descriptor renders provider grid SSR', async () => {
  const { load } = emit('derived-grid', ['--site-id', 'site-legacy', '--guild', 'guild-legacy', '--shops', JSON.stringify([{ shopPath: '/shop' }]), '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square', derived: 'raw-square-shop' }])]);
  const mod = await load();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json({ items: [{ variation_id: 'sq-tee', slug: 'reef-tee', name: 'Reef Tee', display_price: 19, currency: 'USD' }] });
  };
  try {
    const env = { ASSETS: { fetch: async () => new Response(shell) } };
    const response = await mod.default.fetch(new Request('https://site.example/shop'), env);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /square-shop\/0\.11\.7\/square-shop\.js/);
    assert.match(html, /data-payment-rail="square"/);
    assert.equal(calls[0].searchParams.get('payment_rail'), 'square');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a declared native storefront still routes native alongside a derived provider shop', async () => {
  const { load } = emit('mixed-native-and-derived', ['--site-id', 'site-mixed', '--shops', JSON.stringify([{ shopPath: '/shop' }, { shopPath: '/native-shop' }]), '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square', derived: 'raw-square-shop' }, { path: '/native-shop', source: 'native' }])]);
  const mod = await load();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('native must not use provider fetch'); };
  try {
    const env = {
      ASSETS: { fetch: async () => new Response(shell) },
      RSP: { fetch: async (request) => {
        const url = new URL(request.url);
        assert.equal(url.pathname, '/api/v2/storefront/native');
        return Response.json({ ok: true, source: 'native', item: product });
      } },
    };
    const nativeResponse = await mod.default.fetch(new Request('https://site.example/native-shop/reef-tee'), env);
    assert.equal(nativeResponse.status, 200);
    assert.match(await nativeResponse.text(), /data-storefront-source="native"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('native checkout success wins before transport and uses the native shell in a mixed site', async () => {
  const { load } = emit('mixed-native-checkout-result', ['--site-id', 'site-mixed', '--shops', JSON.stringify([{ shopPath: '/shop' }, { shopPath: '/native-shop' }]), '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'stripe' }, { path: '/native-shop', source: 'native' }])]);
  const mod = await load();
  const assetPaths = [];
  let transportCalls = 0;
  const nativeShell = '<!doctype html><html lang="zh-TW" data-theme="reef"><head><title>商店</title></head><body><header>NATIVE NAV</header><main>GRID</main><footer>NATIVE FOOT</footer></body></html>';
  const response = await mod.default.fetch(new Request('https://site.example/checkout/success?order_id=order-1', { headers: { cookie: 'rsp_session=buyer-1' } }), {
    ASSETS: { fetch: async request => { assetPaths.push(new URL(request.url).pathname); return new Response(nativeShell); } },
    RSP: { fetch: async () => { transportCalls++; return new Response('PLATFORM FALLBACK'); } },
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(transportCalls, 0, 'the native site owns composition before the contract forward');
  assert.deepEqual(assetPaths, ['/native-shop/'], 'a provider /shop is never used as the native result donor');
  assert.match(html, /NATIVE NAV/);
  assert.match(html, /NATIVE FOOT/);
  assert.match(html, /正在確認您的付款/);
  assert.match(html, /ref=order-1/);
  assert.doesNotMatch(html, /order_id=order-1/);
});

test('provider-only and missing-order checkout success retain the transport fallback', async () => {
  for (const [name, storefronts, path] of [
    ['provider-only', [{ path: '/shop', source: 'provider', provider: 'stripe' }], '/checkout/success?order_id=order-1'],
    ['missing order id', [{ path: '/shop', source: 'native' }], '/checkout/success'],
  ]) {
    const { load } = emit('checkout-fallback-' + name.replaceAll(' ', '-'), ['--site-id', 'site-fallback', '--storefronts', JSON.stringify(storefronts)]);
    const mod = await load();
    let assetCalls = 0;
    const response = await mod.default.fetch(new Request('https://site.example' + path), {
      ASSETS: { fetch: async () => { assetCalls++; return new Response('STATIC'); } },
      RSP: { fetch: async request => new Response('FORWARDED:' + new URL(request.url).pathname) },
    });
    assert.equal(await response.text(), 'FORWARDED:/checkout/success', name);
    assert.equal(assetCalls, 0, name);
  }
});

test('a source-less descriptor is rejected before writing a worker artifact', () => {
  const { out, result } = emitFailure('source-less-descriptor', ['--site-id', 'site-stale', '--storefronts', JSON.stringify([{ path: '/shop', compatibility: 'raw-square-shop' }])]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /emit-shop-function: --storefronts\[0\] source is required/);
  assert.equal(existsSync(out), false);
});

test('a provider descriptor requires a supported provider', () => {
  const { out, result } = emitFailure('unsupported-provider', ['--site-id', 'site-stale', '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'paypal' }])]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /emit-shop-function: --storefronts\[0\] provider must be stripe or square/);
  assert.equal(existsSync(out), false);
});

// ── the --api fatal: a gate nobody had watched fail ────────────────────────────────────────
// 🔴 Every other test in this package passes `--api`, so until these three the emitter's loudest
// rule had never been seen red. That rule is the whole basis for "loud, not a silent downgrade":
// an empty base makes a Worker's relative fetch() THROW at request time, which is a shop that
// builds green and has no product pages. The next refactor of arg()'s defaulting would return it
// silently to '' — the exact outcome it exists to prevent — and nothing would have said so.
test('a configured storefront with no --api is fatal, not an empty base', () => {
  const { out, result } = emitFailure('storefront-without-api', ['--site-id', 'site-no-api', '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }])]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no shop API base was given/);
  assert.equal(existsSync(out), false, 'no half-built worker is left on disk');
});

// CONTROL, both directions — without these the test above is satisfied by an emitter that simply
// always dies.
test('CONTROL: the same storefront WITH --api emits', () => {
  const { out } = emit('storefront-with-api', ['--site-id', 'site-with-api', '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }])]);
  assert.equal(existsSync(out), true);
});

test('CONTROL: a site with no storefront at all still emits without --api', () => {
  const { out, result } = emitFailure('shopless-without-api', ['--site-id', 'site-shopless', '--storefronts', '[]']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(out), true, 'apiBase is unreachable for a shopless site — it must not be required');
});

test('native grid and detail use an ASSETS shell plus the JSON-only RSP projection', async () => {
  const { load } = emit('native', ['--site-id', 'site-native', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
  const mod = await load();
  const requests = [];
  const assetPaths = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('native must not use provider fetch'); };
  const env = {
    ASSETS: { fetch: async (request) => { assetPaths.push(new URL(request.url).pathname); return new Response(shell); } },
    RSP: { fetch: async (request) => {
      const url = new URL(request.url);
      requests.push(url);
      assert.equal(url.pathname, '/api/v2/storefront/native');
      assert.equal(url.searchParams.get('site_id'), 'site-native');
      return Response.json(url.searchParams.has('slug') ? { ok: true, source: 'native', item: product } : { ok: true, source: 'native', items: [product] });
    } },
  };
  try {
    const listing = await mod.default.fetch(new Request('https://site.example/shop'), env);
    const listingHtml = await listing.text();
    assert.equal(listing.status, 200);
    assert.match(listingHtml, /data-storefront-source="native"/);
    assert.match(listingHtml, /Reef Tee/);
    assert.match(listingHtml, /NAV/);
    assert.match(listingHtml, /FOOT/);
    assert.match(listingHtml, /data-theme="reef"/);

    const detail = await mod.default.fetch(new Request('https://site.example/shop/reef-tee'), env);
    const detailHtml = await detail.text();
    assert.equal(detail.status, 200);
    assert.match(detailHtml, /Repo-backed copy/);
    assert.equal(requests[1].searchParams.get('slug'), 'reef-tee');
    assert.deepEqual(assetPaths, ['/shop/', '/shop/']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an emitted native Buy now control posts only the projected SKU before the native checkout contract', async () => {
  const { load } = emit('native-buy', ['--site-id', 'site-native', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
  const mod = await load();
  const response = await mod.default.fetch(new Request('https://site.example/shop/reef-tee'), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', item: product }) },
  });
  const html = await response.text();
  assert.match(html, /class="dc-native-buy" data-native-sku="tee-sku"/);
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  assert.ok(script, 'the actual emitted native page must carry its checkout behavior');

  let click;
  const document = { documentElement: { lang: '' }, addEventListener(type, handler) { if (type === 'click') click = handler; } };
  const status = { textContent: '' };
  const button = {
    disabled: false,
    getAttribute(name) { return name === 'data-native-sku' ? 'tee-sku' : null; },
    parentElement: { querySelector(selector) { return selector === '[data-native-status]' ? status : null; } },
  };
  const calls = [];
  const browserFetch = async (url, init) => {
    calls.push({ url, init });
    return url === '/api/cart/items' ? Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] }) : Response.json({ redirect_url: 'https://pay.example/session' });
  };
  const redirects = [];
  new Function('document', 'fetch', 'window', script[1])(document, browserFetch, { location: { assign(url) { redirects.push(url); } } });
  await click({ target: { closest(selector) { return selector === '[data-native-sku]' ? button : null; } } });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/cart/items');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].init.body), { sku: 'tee-sku', qty: 1 });
  assert.doesNotMatch(calls[0].init.body, /price|guild|site_id|variation_id/);
  assert.equal(calls[1].url, '/api/checkout');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.body, undefined, 'native checkout identifies the site by same-origin host/session, not a client locator');
  assert.deepEqual(redirects, ['https://pay.example/session']);
});

test('a declared page language rides the native checkout POST as a lang hint', async () => {
  const { load } = emit('native-buy-lang', ['--site-id', 'site-native', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
  const mod = await load();
  const response = await mod.default.fetch(new Request('https://site.example/shop/reef-tee'), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', item: product }) },
  });
  const html = await response.text();
  assert.match(html, /document\.documentElement/, 'the native checkout script reads the page declared language');
  assert.match(html, /JSON\.stringify\(\{lang:lang\}\)/, 'the native checkout script can post a lang field');
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  assert.ok(script);

  let click;
  const document = { documentElement: { lang: 'zh-Hant' }, addEventListener(type, handler) { if (type === 'click') click = handler; } };
  const button = {
    disabled: false,
    getAttribute(name) { return name === 'data-native-sku' ? 'tee-sku' : null; },
    parentElement: { querySelector() { return null; } },
  };
  const calls = [];
  const browserFetch = async (url, init) => {
    calls.push({ url, init });
    return url === '/api/cart/items' ? Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] }) : Response.json({ redirect_url: 'https://pay.example/session' });
  };
  const redirects = [];
  new Function('document', 'fetch', 'window', script[1])(document, browserFetch, { location: { assign(url) { redirects.push(url); } } });
  await click({ target: { closest(selector) { return selector === '[data-native-sku]' ? button : null; } } });

  assert.equal(calls[1].url, '/api/checkout');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].init.body), { lang: 'zh-Hant' });
  assert.deepEqual(redirects, ['https://pay.example/session']);
});

test('an OUT_OF_STOCK native projection disables Buy now and its emitted handler makes no request', async () => {
  const { load } = emit('native-out-of-stock', ['--site-id', 'site-native', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
  const mod = await load();
  const outOfStock = { ...product, commerce: { ...product.commerce, available: 0, reserved: 2, status: 'OUT_OF_STOCK' } };
  const response = await mod.default.fetch(new Request('https://site.example/shop/reef-tee'), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', item: outOfStock }) },
  });
  const html = await response.text();
  assert.match(html, /class="dc-native-buy" disabled>Unavailable/);
  assert.doesNotMatch(html, /data-native-sku="tee-sku"/);
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  let click;
  const document = { addEventListener(type, handler) { if (type === 'click') click = handler; } };
  let calls = 0;
  const disabled = { disabled: true, getAttribute() { return 'tee-sku'; }, parentElement: null };
  new Function('document', 'fetch', 'window', script[1])(document, async () => { calls++; throw new Error('disabled control must not fetch'); }, { location: { assign() {} } });
  await click({ target: { closest(selector) { return selector === '[data-native-sku]' ? disabled : null; } } });
  assert.equal(calls, 0);
});

test('an unavailable native projection stays a truthful native state and never falls into provider B', async () => {
  const { load } = emit('native-unavailable', ['--site-id', 'site-native', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
  const mod = await load();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider fallback is forbidden'); };
  try {
    const response = await mod.default.fetch(new Request('https://site.example/shop'), {
      ASSETS: { fetch: async () => new Response(shell) },
      RSP: { fetch: async () => Response.json({ ok: false, error: 'native_storefront_unavailable' }, { status: 503 }) },
    });
    const html = await response.text();
    assert.equal(response.status, 503);
    assert.match(html, /data-storefront-state="unavailable"/);
    assert.match(html, /NAV/);
    assert.match(html, /FOOT/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider source pins its rail in emitted SSR and browser bytes, while completion remains first', async () => {
  const emitted = emit('provider', ['--site-id', 'site-provider', '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'stripe' }])]);
  const bytes = await import('node:fs').then(({ readFileSync }) => readFileSync(emitted.out, 'utf8'));
  assert.match(bytes, /\/corals\/square-shop\/0\.11\.7\/square-shop\.js/);
  assert.match(bytes, /data-cart="1"/);
  assert.match(bytes, /data-payment-rail/);
  // The template source now ALSO carries the registry v0 channel string — it's the module src
  // renderGridPage adds next to an author's own coral div when the donor shell doesn't already
  // load square-shop (see the coral-preserving-mount tests below). That's a second, conditional
  // code path in the file, not a live reference for THIS shop: the shell this test's shop is
  // served against (`shell`, top of file) has no coral div at all, so its own served bytes never
  // reach that branch — checked on `html`, the actual served response, below.
  const mod = await emitted.load();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return Response.json({ items: [{ variation_id: 'stripe-tee', slug: 'reef-tee', name: 'Stripe Tee', display_price: 19, currency: 'USD' }] });
  };
  try {
    const env = { ASSETS: { fetch: async () => new Response(shell) } };
    const listing = await mod.default.fetch(new Request('https://site.example/shop'), env);
    const html = await listing.text();
    assert.match(html, /square-shop\/0\.11\.7\/square-shop\.js/);
    assert.match(html, /data-payment-rail="stripe"/);
    assert.doesNotMatch(html, /\/square-shop\/v0\//, 'this shop\'s shell has no coral div, so the SERVED page stays on the old compat pin, not the new v0 channel');
    assert.equal(calls[0].searchParams.get('payment_rail'), 'stripe');

    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      return Response.json({ items: [] });
    };
    const unavailable = await mod.default.fetch(new Request('https://site.example/shop'), env);
    const unavailableHtml = await unavailable.text();
    assert.match(unavailableHtml, /square-shop\/0\.11\.7\/square-shop\.js/);
    assert.match(unavailableHtml, /data-payment-rail="stripe"/);
    assert.equal(calls[1].searchParams.get('payment_rail'), 'stripe');

    const complete = await mod.default.fetch(new Request('https://site.example/shop/complete?ref=receipt'), env);
    assert.equal(complete.status, 200);
    assert.match(await complete.text(), /Confirming your payment/);
    assert.equal(calls.length, 2, 'completion wins before a provider catalog request');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── the owner's rule: the platform mounts INTO the author's page, never replaces it ────────
// Regression coverage for the 2026-09-03 production incident: renderGridPage used to
// `replaceMain()` unconditionally, discarding the entire author-built <main> (intro copy,
// category buttons, nav) the moment a provider shop rendered — live on a customer's /shop/.
// These shells carry BOTH an author intro section outside the coral AND the author's own
// [data-dynamic-coral="square-shop"] div with real localized attributes, mirroring the
// SHAPE of the evidence from that incident (an author-namespaced intro <section> and
// category <nav>, a CJK shop title, data-buy-label="購入" etc.).
//
// 🔴 The names here are a stand-in, and the shape is the part that has to be faithful: the
// customer's own class prefix and their Japanese brand name are what the incident actually
// carried, and neither belongs in a public repo. What the assertions below measure is that
// markup the PLATFORM did not author survives a coral mount — that is a property of the
// markup being foreign, not of whose it is. See scripts/publish-safety.sh in tile-lab.
const AUTHORED_SHELL = '<!doctype html><html lang="ja"><head><title>Shop</title></head><body>' +
  '<header>NAV</header><main class="rf-main">' +
  '<section class="nw-shop-intro"><h1>NORTHWIND ショップ</h1><p>作品紹介文</p></section>' +
  '<nav class="nw-shop-categories"><a href="#a">カテゴリA</a></nav>' +
  '<div data-dynamic-coral="square-shop" data-guild-id="g1" data-cart="header" data-detail-base="/shop" ' +
  'data-add-label="カートに追加" data-buy-label="購入" data-locale="ja-JP"></div>' +
  '</main><footer>FOOT</footer></body></html>';

test('coral-preserving mount: author main survives, author attrs ride through, exactly one module script', async () => {
  const { load } = emit('coral-preserve', ['--site-id', 'site-coral1', '--guild', 'g1', '--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }]), '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }])]);
  const mod = await load();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    return url.pathname === '/api/v2/shop/catalog'
      ? Response.json({ items: [{ variation_id: 'sq-tee', slug: 'reef-tee', name: 'Reef Tee', display_price: 19, currency: 'JPY' }] })
      : Response.json({ items: [] });
  };
  try {
    const env = { ASSETS: { fetch: async () => new Response(AUTHORED_SHELL) } };
    const response = await mod.default.fetch(new Request('https://site.example/shop'), env);
    const html = await response.text();
    assert.equal(response.status, 200);

    // The author's own <main> content — never touched by a whole-<main> replaceMain — survives.
    assert.match(html, /nw-shop-intro/, 'author intro section must survive');
    assert.match(html, /NORTHWIND ショップ/, 'author intro copy must survive');
    assert.match(html, /nw-shop-categories/, 'author category nav must survive');
    assert.match(html, /NAV/);
    assert.match(html, /FOOT/);

    // The author's own coral attributes ride through unmodified.
    assert.match(html, /data-buy-label="購入"/);
    assert.match(html, /data-add-label="カートに追加"/);
    assert.match(html, /data-detail-base="\/shop"/);
    assert.match(html, /data-cart="header"/);
    assert.match(html, /data-locale="ja-JP"/);

    // The rail is pinned onto that SAME div — one payment-rail attribute, one div.
    assert.match(html, /data-payment-rail="square"/);
    assert.equal((html.match(/data-dynamic-coral="square-shop"/g) || []).length, 1, 'exactly one coral div, not a second mounted alongside it');

    // The donor shell never loaded square-shop.js, so exactly one module script is added, on the
    // registry's OTA channel — never a version pin.
    const scriptMatches = html.match(/<script[^>]*\bsrc=["'][^"']*\/corals\/square-shop\/[^"']*["'][^>]*><\/script>/g) || [];
    assert.equal(scriptMatches.length, 1, 'exactly one square-shop module script');
    assert.match(scriptMatches[0], /\/corals\/square-shop\/v0\/square-shop\.js/);
    assert.doesNotMatch(html, /square-shop\/0\.11\.7\/square-shop\.js/, 'no hardcoded version pin when preserving an author coral');

    // The SSR grid landed INSIDE the coral div (so square-shop.js hydrates it), not as a
    // second mount and not dropped on the floor.
    assert.match(html, /data-dynamic-coral="square-shop"[^>]*>[\s\S]*?Reef Tee[\s\S]*?<\/div>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('coral-preserving mount: an already-loaded square-shop module is not duplicated', async () => {
  const { load } = emit('coral-preserve-existing-script', ['--site-id', 'site-coral2', '--guild', 'g1', '--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }]), '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }])]);
  const mod = await load();
  const shellWithScript = AUTHORED_SHELL.replace('</main>', '<script type="module" src="/corals/square-shop/0.11.10/square-shop.js"></script></main>');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: [{ variation_id: 'sq-tee', slug: 'reef-tee', name: 'Reef Tee', display_price: 19, currency: 'JPY' }] });
  try {
    const env = { ASSETS: { fetch: async () => new Response(shellWithScript) } };
    const response = await mod.default.fetch(new Request('https://site.example/shop'), env);
    const html = await response.text();
    const scriptMatches = html.match(/<script[^>]*\bsrc=["'][^"']*\/corals\/square-shop\/[^"']*["'][^>]*><\/script>/g) || [];
    assert.equal(scriptMatches.length, 1, 'the donor already loaded square-shop.js — no second script added');
    assert.match(scriptMatches[0], /0\.11\.10/, 'the author\'s own pinned version is left exactly as they authored it');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('coral-preserving mount: identity is added only when the author markup lacks it, never overridden', async () => {
  const { load } = emit('coral-preserve-identity', ['--site-id', 'site-coral3', '--guild', 'g-baked', '--shops', JSON.stringify([{ shopPath: '/shop', labels: {} }]), '--storefronts', JSON.stringify([{ path: '/shop', source: 'provider', provider: 'square' }])]);
  const mod = await load();
  // The author's own div already names a DIFFERENT guild — an authored fact, not the platform's
  // to overwrite.
  const shellOwnGuild = '<!doctype html><html><head></head><body><main>' +
    '<div data-dynamic-coral="square-shop" data-guild-id="author-own-guild" data-cart="1"></div>' +
    '</main></body></html>';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ items: [] });
  try {
    const env = { ASSETS: { fetch: async () => new Response(shellOwnGuild) } };
    const response = await mod.default.fetch(new Request('https://site.example/shop'), env);
    const html = await response.text();
    assert.match(html, /data-guild-id="author-own-guild"/);
    assert.equal((html.match(/data-guild-id=/g) || []).length, 1, 'the author\'s own guild id is never overridden or duplicated');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── native: unchanged today, and flagged rather than silently declared "done" ──────────────
// 🔴 Native has no author-authored coral div anywhere in sitetile (see shop-function-template.js
// nativeUnavailable()'s note), so it has nothing to key a coral-preserving mount off of — this
// documents that it is UNCHANGED by this fix, not that it was addressed by it.
test('native path analogue: still replaces the whole <main>, even with extra author content (known gap, see 🔴)', async () => {
  const { load } = emit('native-analogue', ['--site-id', 'site-native-analogue', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }])]);
  const mod = await load();
  const nativeShellWithIntro = '<!doctype html><html><head></head><body><header>NAV</header><main>' +
    '<section class="nw-shop-intro"><h1>Intro that native still drops today</h1></section>' +
    '</main><footer>FOOT</footer></body></html>';
  const response = await mod.default.fetch(new Request('https://site.example/shop'), {
    ASSETS: { fetch: async () => new Response(nativeShellWithIntro) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', items: [product] }) },
  });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /NAV/);
  assert.match(html, /FOOT/);
  assert.doesNotMatch(html, /Intro that native still drops today/, 'known gap — native still replaces the whole <main>, unlike the provider path above');
});

// ── native storefront locale: the site's own donor shell declares the language ─────────────
// The platform-authored native strings used to be English literals inside the render helpers and
// native money used to fall back to `shop.locale || 'en-US'`. Both are resolved from the donor
// shell now, through the SAME localeFromHint/shellLang pair the site-owned buyer pages use.
//
// 🔴 `--shops` locale below is deliberately the WRONG answer ('en-US' against a zh-Hant shell).
// Without that, a green run could still be explained by the old build-metadata fallback.
const ZH_SHELL = '<!doctype html><html lang="zh-Hant" data-theme="reef"><head><title>商店</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>';
const JA_SHELL = '<!doctype html><html lang="ja-JP" data-theme="jade"><head><title>ショップ</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>';
const MISLEADING_BUILD_LOCALE = JSON.stringify([{ shopPath: '/shop', locale: 'en-US' }]);
const jpyProduct = { ...product, commerce: { ...product.commerce, currency: 'JPY', unit_price: 1900 } };

// One place that emits a native shop, serves a chosen shell and answers the projection however a
// case needs it — the existing per-test inline env, factored only for the cases added below.
async function serveNative(name, { shell: donor, path = '/shop', projection, shops }) {
  const { load } = emit(name, [
    '--site-id', 'site-native-locale',
    ...(shops ? ['--shops', shops] : []),
    '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]),
  ]);
  const mod = await load();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('a native failure must never reach provider B'); };
  try {
    const response = await mod.default.fetch(new Request('https://site.example' + path), {
      ASSETS: { fetch: async () => (donor === null ? new Response('missing', { status: 404 }) : new Response(donor)) },
      RSP: { fetch: async (request) => projection(new URL(request.url)) },
    });
    return { status: response.status, html: await response.text() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const nativeOk = (body) => async (url) => Response.json(url.searchParams.has('slug') ? { ok: true, source: 'native', item: body } : { ok: true, source: 'native', items: [body] });

test('a zh-Hant donor shell renders every native platform string in zh-TW, inside the site shell', async () => {
  const grid = await serveNative('native-zh-grid', { shell: ZH_SHELL, projection: nativeOk(product), shops: MISLEADING_BUILD_LOCALE });
  assert.equal(grid.status, 200);
  assert.match(grid.html, /立即購買/, 'the Buy control is the site language, not the platform default');
  assert.doesNotMatch(grid.html, /Buy now/);
  // The owner's shell survives the composition exactly as before.
  assert.match(grid.html, /NAV/);
  assert.match(grid.html, /FOOT/);
  assert.match(grid.html, /data-theme="reef"/);
  assert.match(grid.html, /lang="zh-Hant"/);
  // Product copy is the SITE's bytes and is not translated, localized or otherwise touched.
  assert.match(grid.html, /Reef Tee/);

  const detail = await serveNative('native-zh-detail', { shell: ZH_SHELL, path: '/shop/reef-tee', projection: nativeOk(product), shops: MISLEADING_BUILD_LOCALE });
  assert.equal(detail.status, 200);
  assert.match(detail.html, />商店<\/a>/, 'the back link label is platform copy and follows the shell');
  assert.match(detail.html, /立即購買/);
  assert.match(detail.html, /Reef Tee/);
  assert.match(detail.html, /Repo-backed copy/, 'owner description rides through untouched');

  const empty = await serveNative('native-zh-empty', { shell: ZH_SHELL, projection: async () => Response.json({ ok: true, source: 'native', items: [] }), shops: MISLEADING_BUILD_LOCALE });
  assert.equal(empty.status, 200);
  assert.match(empty.html, /目前沒有可購買的商品。/);
  assert.doesNotMatch(empty.html, /No products are available/);

  const soldOut = await serveNative('native-zh-sold-out', {
    shell: ZH_SHELL, path: '/shop/reef-tee', shops: MISLEADING_BUILD_LOCALE,
    projection: nativeOk({ ...product, commerce: { ...product.commerce, available: 0, status: 'OUT_OF_STOCK' } }),
  });
  assert.match(soldOut.html, /class="dc-native-buy" disabled>無法購買/);
  assert.doesNotMatch(soldOut.html, />Unavailable</);

  const notFound = await serveNative('native-zh-not-found', {
    shell: ZH_SHELL, path: '/shop/nope', shops: MISLEADING_BUILD_LOCALE,
    projection: async () => Response.json({ ok: false, error: 'not_found' }, { status: 404 }),
  });
  assert.equal(notFound.status, 404);
  assert.match(notFound.html, /data-storefront-state="not-found"/);
  assert.match(notFound.html, /找不到這個商品/);
  assert.doesNotMatch(notFound.html, /Product not found/);
  assert.match(notFound.html, /NAV/);

  const unavailable = await serveNative('native-zh-unavailable', {
    shell: ZH_SHELL, shops: MISLEADING_BUILD_LOCALE,
    projection: async () => Response.json({ ok: false, error: 'native_storefront_unavailable' }, { status: 503 }),
  });
  assert.equal(unavailable.status, 503, 'an unavailable projection stays non-success');
  assert.match(unavailable.html, /data-storefront-state="unavailable"/);
  assert.match(unavailable.html, /無法顯示商店/);
  assert.match(unavailable.html, /請稍後再試。/);
  assert.doesNotMatch(unavailable.html, /Storefront unavailable/);
  assert.match(unavailable.html, /NAV/, 'the localized unavailable state stays INSIDE the site shell');
  assert.match(unavailable.html, /FOOT/);
});

// CONTROL — without this the test above is satisfied by a worker that simply hard-codes zh-TW.
test('CONTROL: a ja-JP donor shell renders the same native strings in Japanese', async () => {
  const grid = await serveNative('native-ja-grid', { shell: JA_SHELL, projection: nativeOk(product) });
  assert.match(grid.html, /今すぐ購入/);
  assert.doesNotMatch(grid.html, /立即購買/);
  assert.doesNotMatch(grid.html, /Buy now/);

  const unavailable = await serveNative('native-ja-unavailable', {
    shell: JA_SHELL,
    projection: async () => Response.json({ ok: false }, { status: 503 }),
  });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.html, /ショップを表示できません/);
  assert.match(unavailable.html, /data-theme="jade"/);
});

// CONTROL — the shell with no lang at all is the one every pre-existing test above uses, so this
// pins that the default did not move while the resolver was added.
test('CONTROL: a shell that declares no language keeps the English native copy', async () => {
  const grid = await serveNative('native-nolang-grid', { shell, projection: nativeOk(product) });
  assert.match(grid.html, />Buy now</);
  const unavailable = await serveNative('native-nolang-unavailable', { shell, projection: async () => Response.json({ ok: false }, { status: 503 }) });
  assert.match(unavailable.html, /<h1>Storefront unavailable<\/h1><p>Please try again later\.<\/p>/);
});

// No donor shell at all: there is no site-declared language to read AND nothing of the site's to
// compose into, so this stays the bare honest 503 it already was rather than becoming a
// platform-authored page that looks like the site.
test('a missing donor shell keeps the bare non-success document, not a fabricated site page', async () => {
  for (const [name, path] of [['grid', '/shop'], ['detail', '/shop/reef-tee']]) {
    const page = await serveNative('native-no-shell-' + name, { shell: null, path, projection: nativeOk(product) });
    assert.equal(page.status, 503, name);
    assert.equal(page.html, '<!doctype html><main><section data-storefront-source="native" data-storefront-state="unavailable"><h1>Storefront unavailable</h1><p>Please try again later.</p></section></main>', name);
    assert.doesNotMatch(page.html, /<header|<nav|<footer|data-theme/, name + ': nothing here may pretend to be the site');
  }
});

test('native prices format in the shell locale while the minor amount and currency are unchanged', async () => {
  const zh = await serveNative('native-price-zh', { shell: ZH_SHELL, path: '/shop/reef-tee', projection: nativeOk(jpyProduct), shops: MISLEADING_BUILD_LOCALE });
  const ja = await serveNative('native-price-ja', { shell: JA_SHELL, path: '/shop/reef-tee', projection: nativeOk(jpyProduct) });
  const zhPrice = formatMoney({ minor: 1900, currency: 'JPY', locale: 'zh-TW' });
  const jaPrice = formatMoney({ minor: 1900, currency: 'JPY', locale: 'ja-JP' });
  assert.notEqual(zhPrice, jaPrice, 'the chosen currency must actually discriminate the two locales');
  assert.ok(zh.html.includes('<p>' + zhPrice + '</p>'), 'zh-TW shell renders the zh-TW form, got: ' + zh.html.match(/<p>[^<]*1,?900[^<]*<\/p>/));
  assert.ok(ja.html.includes('<p>' + jaPrice + '</p>'), 'ja-JP shell renders the ja-JP form');
  // Same underlying RSP facts on both pages — presentation moved, the money did not.
  for (const page of [zh, ja]) assert.match(page.html, /1,900/);
});

// ── native checkout: a deterministic conflict is not a retryable transport failure ─────────
// RSP refuses a second concurrent attempt with 409 {error:"checkout_attempt_conflict"} and hands
// back no recovery locator, so this is the one failure the page can name — and the one whose
// control must not invite an immediately futile repeat.
function driveNativeCheckout(html, respond, { lang = '' } = {}) {
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  assert.ok(script, 'the emitted native page must carry its checkout behavior');
  let click;
  const document = { documentElement: { lang }, addEventListener(type, handler) { if (type === 'click') click = handler; } };
  const status = { textContent: '' };
  const button = {
    disabled: false,
    getAttribute(name) { return name === 'data-native-sku' ? 'tee-sku' : null; },
    parentElement: { querySelector(selector) { return selector === '[data-native-status]' ? status : null; } },
  };
  const calls = [];
  const redirects = [];
  new Function('document', 'fetch', 'window', script[1])(
    document,
    async (url, init) => { calls.push({ url, init }); return respond(url, init); },
    { location: { assign(url) { redirects.push(url); } } },
  );
  return {
    button, status, calls, redirects,
    click: () => click({ target: { closest: (selector) => (selector === '[data-native-sku]' ? button : null) } }),
    countOf: (path) => calls.filter((call) => call.url === path).length,
  };
}

const conflictResponder = async (url) => (url === '/api/cart/items'
  ? Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] })
  : Response.json({ error: 'checkout_attempt_conflict' }, { status: 409 }));

test('an exact checkout_attempt_conflict says a checkout is already running, in the shell language', async () => {
  const { html } = await serveNative('native-conflict-zh', { shell: ZH_SHELL, path: '/shop/reef-tee', projection: nativeOk(product), shops: MISLEADING_BUILD_LOCALE });
  const ui = driveNativeCheckout(html, conflictResponder, { lang: 'zh-Hant' });
  await ui.click();

  assert.equal(ui.status.textContent, '已經有一筆結帳正在進行中，現在無法再開始新的結帳。');
  assert.doesNotMatch(ui.status.textContent, /再試/, 'a deterministic conflict must not promise that trying again works');
  assert.equal(ui.redirects.length, 0);
  // The request pair itself is untouched — this change is interpretation, not checkout semantics.
  assert.deepEqual(ui.calls.map((call) => call.url), ['/api/cart/items', '/api/checkout']);
});

test('CONTROL: the same conflict on an English shell says it in English', async () => {
  const { html } = await serveNative('native-conflict-en', { shell, path: '/shop/reef-tee', projection: nativeOk(product) });
  const ui = driveNativeCheckout(html, conflictResponder);
  await ui.click();
  assert.equal(ui.status.textContent, 'A checkout is already in progress. Another one cannot be started right now.');
  assert.doesNotMatch(ui.status.textContent, /try again/i);
});

test('after a checkout_attempt_conflict the visible control makes ZERO new cart or checkout calls', async () => {
  const { html } = await serveNative('native-conflict-second-interaction', { shell: ZH_SHELL, path: '/shop/reef-tee', projection: nativeOk(product), shops: MISLEADING_BUILD_LOCALE });
  const ui = driveNativeCheckout(html, conflictResponder, { lang: 'zh-Hant' });
  await ui.click();
  assert.equal(ui.countOf('/api/cart/items'), 1);
  assert.equal(ui.countOf('/api/checkout'), 1);
  assert.equal(ui.button.disabled, true, 'the control that can only repeat the refused operation stays disabled');

  // Drive the page a second time exactly as a buyer would against the control still on screen.
  await ui.click();
  assert.equal(ui.countOf('/api/cart/items'), 1, 'zero NEW /api/cart/items calls after the conflict');
  assert.equal(ui.countOf('/api/checkout'), 1, 'zero NEW /api/checkout calls after the conflict');
  assert.equal(ui.calls.length, 2, 'and no other request was invented as a recovery attempt');
});

test('everything that is not the exact conflict stays the generic localized failure', async () => {
  const { html } = await serveNative('native-generic-failures', { shell: ZH_SHELL, path: '/shop/reef-tee', projection: nativeOk(product), shops: MISLEADING_BUILD_LOCALE });
  const cartOk = async () => Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] });
  const cases = {
    'a different 409': async (url) => (url === '/api/cart/items' ? cartOk() : Response.json({ error: 'cart_empty' }, { status: 409 })),
    'a 5xx': async (url) => (url === '/api/cart/items' ? cartOk() : Response.json({ error: 'internal' }, { status: 500 })),
    'a malformed body': async (url) => (url === '/api/cart/items' ? cartOk() : new Response('not json', { status: 409, headers: { 'content-type': 'text/plain' } })),
    'a dead network': async (url) => { if (url === '/api/cart/items') return cartOk(); throw new TypeError('network down'); },
    'a failed cart add': async () => Response.json({ error: 'nope' }, { status: 400 }),
  };
  for (const [name, respond] of Object.entries(cases)) {
    const ui = driveNativeCheckout(html, respond, { lang: 'zh-Hant' });
    await ui.click();
    assert.equal(ui.status.textContent, '無法開始結帳，請再試一次。', name);
    assert.doesNotMatch(ui.status.textContent, /結帳正在進行中/, name + ' must not invent the conflict cause');
    assert.equal(ui.button.disabled, false, name + ': an unknown failure may still be retried');
    assert.equal(ui.redirects.length, 0, name);
  }
});
