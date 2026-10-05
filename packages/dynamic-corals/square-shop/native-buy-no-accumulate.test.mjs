import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Native "Buy now" ensures the product's line exists in the cart and never increments a line that is
// already there, so pressing it again retries the same pending order instead of growing the quantity.

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-buy-no-accumulate-'));
const contract = path.join(temp, 'site-api-transport.contract.json');
writeFileSync(contract, JSON.stringify({
  bindingName: 'RSP',
  checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
  forward: [{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] }, { match: 'exact', value: '/checkout/success', methods: ['GET'] }],
  verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
  onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));

const SHELLS = {
  'en-US': '<!doctype html><html data-theme="reef"><head><title>Donor</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>',
  'zh-TW': '<!doctype html><html lang="zh-Hant"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'ja-JP': '<!doctype html><html lang="ja-JP"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'zh-CN': '<!doctype html><html lang="zh-Hans"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
};
const product = {
  slug: 'reef-tee',
  copy: { name: 'Reef Tee', description_html: '<p>Copy</p>', image_ref: '/tee.jpg', media: [{ url: '/tee.jpg' }], requires_shipping: true },
  commerce: { sku: 'tee-sku', product_id: 'p1', variant_id: 'v1', currency: 'USD', unit_price: 1900, tracked: true, available: 2, reserved: 0, status: 'IN_STOCK' },
};

async function nativeHtml(name, shell) {
  const out = path.join(temp, `${name}.mjs`);
  execFileSync('node', [emitter, '--api-contract', contract, '--site-id', 'site-email', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]), '--api', 'https://api.example', '--out', out], { stdio: 'pipe' });
  const mod = await import(`${pathToFileURL(out).href}?${Date.now()}`);
  const response = await mod.default.fetch(new Request('https://site.example/shop/reef-tee'), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', item: product }) },
  });
  return response.text();
}

// A just-enough DOM: attributes, a parent that can hold the inserted email field, and a document
// that can create elements.
function makeElement(tag) {
  return {
    tag, attrs: {}, children: [], value: '', disabled: false, textContent: '', parentElement: null,
    setAttribute(n, v) { this.attrs[n] = String(v); },
    removeAttribute(n) { delete this.attrs[n]; },
    getAttribute(n) { return this.attrs[n] ?? null; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    addEventListener() {},
    focus() {},
  };
}

// A stateful same-origin cart: GET /api/cart lists lines, POST /api/cart/items adds qty to a line (the
// real server behaviour that made repeated presses accumulate), POST /api/checkout returns a redirect.
function drive(html, { lines = [], cartRead = null, checkout = null } = {}) {
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  assert.ok(script);
  let click;
  const document = { documentElement: { lang: '' }, createElement: makeElement, addEventListener(t, h) { if (t === 'click') click = h; } };
  const status = makeElement('p');
  const parent = makeElement('div');
  const findField = (n) => { for (const c of n.children) { if ('data-native-email-field' in c.attrs) return c; const d = findField(c); if (d) return d; } return null; };
  parent.querySelector = (sel) => (sel === '[data-native-status]' ? status : sel === '[data-native-email-field]' ? findField(parent) : null);
  parent.insertBefore = (node, ref) => { node.parentElement = parent; parent.children.splice(parent.children.indexOf(ref), 0, node); };
  const button = makeElement('button');
  button.textContent = 'Buy now';
  button.ownerDocument = document;
  button.getAttribute = (n) => (n === 'data-native-sku' ? 'tee-sku' : button.attrs[n] ?? null);
  button.parentElement = parent;
  parent.children.push(button);
  const cart = lines.map((l) => ({ ...l }));
  const calls = [];
  const redirects = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET' });
    if (url === '/api/cart') return cartRead ? cartRead() : Response.json({ lines: cart.map((l) => ({ ...l })) });
    if (url === '/api/cart/items') {
      const { sku, qty } = JSON.parse(init.body);
      const line = cart.find((l) => l.sku === sku);
      if (line) line.qty += qty; else cart.push({ sku, qty });
      return Response.json({ lines: cart });
    }
    if (url === '/api/checkout' && checkout) return checkout(init);
    if (url === '/api/checkout') return Response.json({ redirect_url: 'https://pay.example/session' });
    throw new Error('unexpected ' + url);
  };
  new Function('document', 'fetch', 'window', script[1])(document, fetchFn, { location: { assign(u) { redirects.push(u); } } });
  return {
    button, status, cart, calls, field: () => findField(parent), redirects,
    click: () => click({ target: { closest: (s) => (s === '[data-native-sku]' ? button : null) } }),
    adds: () => calls.filter((c) => c.url === '/api/cart/items').length,
    checkouts: () => calls.filter((c) => c.url === '/api/checkout').length,
  };
}

test('first Buy on an empty cart adds the product once at qty 1, then checks out', async () => {
  const ui = drive(await nativeHtml('empty', SHELLS['en-US']));
  await ui.click();
  assert.deepEqual(ui.calls.map((c) => `${c.method} ${c.url}`), ['GET /api/cart', 'POST /api/cart/items', 'POST /api/checkout']);
  assert.deepEqual(ui.cart, [{ sku: 'tee-sku', qty: 1 }]);
  assert.deepEqual(ui.redirects, ['https://pay.example/session']);
});

test('a second Buy with the line already in the cart sends no cart add, keeps qty 1 and checks out again', async () => {
  const html = await nativeHtml('again', SHELLS['en-US']);
  const ui = drive(html);
  await ui.click();
  ui.button.disabled = false;
  await ui.click();
  assert.equal(ui.adds(), 1, 'only the first press adds');
  assert.equal(ui.checkouts(), 2, 'both presses post checkout so the server can relaunch the pending order');
  assert.deepEqual(ui.cart, [{ sku: 'tee-sku', qty: 1 }]);
  const third = drive(html, { lines: [{ sku: 'tee-sku', qty: 1 }] });
  await third.click();
  assert.equal(third.adds(), 0);
  assert.equal(third.checkouts(), 1);
  assert.deepEqual(third.cart, [{ sku: 'tee-sku', qty: 1 }]);
});

test('a cart holding a different SKU still gets this SKU added once and leaves the other line untouched', async () => {
  const ui = drive(await nativeHtml('other', SHELLS['en-US']), { lines: [{ sku: 'cap-sku', qty: 3 }] });
  await ui.click();
  assert.equal(ui.adds(), 1);
  assert.deepEqual(ui.cart, [{ sku: 'cap-sku', qty: 3 }, { sku: 'tee-sku', qty: 1 }]);
  assert.equal(ui.checkouts(), 1);
});

test('a failed cart read shows the generic failure, adds nothing, skips checkout and re-enables Buy', async () => {
  for (const cartRead of [() => new Response('nope', { status: 500 }), () => new Response('not json', { status: 200 }), () => Response.json({})]) {
    const ui = drive(await nativeHtml('readfail', SHELLS['en-US']), { cartRead });
    await ui.click();
    assert.equal(ui.adds(), 0);
    assert.equal(ui.checkouts(), 0);
    assert.equal(ui.status.textContent, 'Unable to start checkout. Please try again.');
    assert.equal(ui.status.attrs['data-ejecta-status-tone'], 'error');
    assert.equal(ui.button.disabled, false);
  }
});

test('after an email refusal the retry posts only the checkout, with no cart read and no add', async () => {
  let refuse = true;
  const ui = drive(await nativeHtml('email-retry', SHELLS['en-US']), {
    checkout: () => (refuse ? Response.json({ error: 'customer_email_required' }, { status: 422 }) : Response.json({ redirect_url: 'https://pay.example/session' })),
  });
  await ui.click();
  assert.ok(ui.field(), 'the email field is asked for');
  assert.equal(ui.cart.length, 1);
  ui.calls.length = 0;
  refuse = false;
  ui.field().value = 'buyer@example.com';
  await ui.click();
  assert.deepEqual(ui.calls.map((c) => `${c.method} ${c.url}`), ['POST /api/checkout']);
  assert.deepEqual(ui.cart, [{ sku: 'tee-sku', qty: 1 }]);
});

test('a non-email checkout failure followed by a second press adds once, checks out twice and keeps qty 1', async () => {
  let fail = true;
  const ui = drive(await nativeHtml('server-error', SHELLS['en-US']), {
    checkout: () => (fail ? Response.json({ error: 'internal' }, { status: 500 }) : Response.json({ redirect_url: 'https://pay.example/session' })),
  });
  await ui.click();
  fail = false;
  await ui.click();
  assert.equal(ui.adds(), 1);
  assert.equal(ui.checkouts(), 2);
  assert.deepEqual(ui.cart, [{ sku: 'tee-sku', qty: 1 }]);
});
