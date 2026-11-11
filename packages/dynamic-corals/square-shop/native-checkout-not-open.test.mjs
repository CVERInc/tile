import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A shop whose payment rail is not connected answers the checkout with 409 and
// {checkout_available:false}. The buyer reads one plain sentence (checkoutNotOpen) with the error
// tone; the preview refusal keeps its own sentence because it is checked first. Buy stays off
// unless a payment-method choice is shown. Any other failure stays the generic one.

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-checkout-not-open-'));
const contract = path.join(temp, 'site-api-transport.contract.json');
writeFileSync(contract, JSON.stringify({
  bindingName: 'RSP',
  checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
  forward: [{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] }, { match: 'exact', value: '/checkout/success', methods: ['GET'] }],
  verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
  onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));

const SHELLS = {
  'en-US': '<!doctype html><html lang="en"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'ja-JP': '<!doctype html><html lang="ja-JP"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'zh-TW': '<!doctype html><html lang="zh-Hant"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'zh-CN': '<!doctype html><html lang="zh-Hans"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
};
const SENTENCE = {
  'en-US': 'This shop is not taking payments yet.',
  'ja-JP': 'このショップはまだ支払いを受け付けていないため、現在ご購入いただけません。',
  'zh-TW': '這家店還在準備收款，目前無法購買。',
  'zh-CN': '这家店还在准备收款，目前无法购买。',
};
const item = (commerce = {}, shipping = false) => ({
  slug: 'tee',
  copy: { name: 'Tee', description_html: '<p>Copy</p>', media: [], requires_shipping: shipping },
  commerce: { sku: 'tee-sku', product_id: 'p1', variant_id: 'v1', currency: 'JPY', unit_price: 1900, tracked: false, status: 'IN_STOCK', ...commerce },
});

let built = 0;
async function emit(body, shell, item2 = item()) {
  const out = path.join(temp, `shop-${built++}.mjs`);
  execFileSync('node', [emitter, '--api-contract', contract, '--site-id', 'site-open', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]), '--api', 'https://api.example', '--out', out], { stdio: 'pipe' });
  const mod = await import(`${pathToFileURL(out).href}?${Date.now()}`);
  const response = await mod.default.fetch(new Request(`https://site.example/shop/${item2.slug}`), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', item: item2, ...body }) },
  });
  return response.text();
}

function drive(html, answer, withRadios = false) {
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  assert.ok(script);
  let click;
  const document = { documentElement: { lang: '' }, addEventListener(t, h) { if (t === 'click') click = h; } };
  const radios = withRadios ? ['stripe', 'ecpay'].map((value, i) => ({ value, checked: i === 0, disabled: false })) : [];
  const status = { textContent: '', attrs: {}, setAttribute(n, v) { this.attrs[n] = v; }, removeAttribute(n) { delete this.attrs[n]; } };
  const parent = {
    querySelector: (sel) => (sel === '[data-native-status]' ? status : sel === '[data-native-rail-choice]:checked' ? radios.find((r) => r.checked) || null : null),
    querySelectorAll: (sel) => (sel === '[data-native-rail-choice]' ? radios : []),
  };
  const button = { disabled: false, textContent: 'Buy', parentElement: parent, setAttribute() {}, removeAttribute() {}, getAttribute: (n) => (n === 'data-native-sku' ? 'tee-sku' : null) };
  let checkouts = 0;
  new Function('document', 'fetch', 'window', script[1])(
    document,
    async (url) => {
      if (url === '/api/cart') return Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] });
      checkouts += 1;
      return answer;
    },
    { location: { assign() {} } },
  );
  return { radios, button, status, checkouts: () => checkouts, click: () => click({ target: { closest: () => button } }) };
}

const NOT_OPEN = () => Response.json({ error: 'checkout_unavailable', checkout_available: false }, { status: 409 });

for (const [locale, sentence] of Object.entries(SENTENCE)) {
  test(`a 409 checkout_available:false shows the not-open sentence with error tone and leaves Buy disabled in ${locale}`, async () => {
    const html = await emit({}, SHELLS[locale]);
    const ui = drive(html, NOT_OPEN());
    await ui.click();
    assert.equal(ui.status.textContent, sentence);
    assert.equal(ui.status.attrs['data-ejecta-status-tone'], 'error');
    assert.equal(ui.button.disabled, true);
    await ui.click();
    assert.equal(ui.checkouts(), 1, 'no repeat call after the refusal');
  });
}

test('with a payment-method choice shown, the radios and Buy stay enabled after the not-open sentence', async () => {
  const html = await emit({}, SHELLS['en-US'], item({ checkout_rails: ['stripe', 'ecpay'] }));
  const ui = drive(html, NOT_OPEN(), true);
  await ui.click();
  assert.equal(ui.status.textContent, SENTENCE['en-US']);
  assert.equal(ui.status.attrs['data-ejecta-status-tone'], 'error');
  assert.equal(ui.button.disabled, false);
  assert.deepEqual(ui.radios.map((r) => r.disabled), [false, false]);
});

test('on a preview page the preview refusal is checked first and keeps the preview sentence', async () => {
  const html = await emit({ preview_checkout: 'test' }, SHELLS['en-US']);
  const ui = drive(html, Response.json({ error: 'preview_checkout_live_mode', checkout_available: false }, { status: 409 }));
  await ui.click();
  assert.match(ui.status.textContent, /This is a preview/);
  assert.equal(ui.status.attrs['data-ejecta-status-tone'], 'error');
  assert.equal(ui.button.disabled, true);
});

test('a 409 without checkout_available:false, and other failures, stay the generic failure', async () => {
  for (const answer of [
    Response.json({ error: 'other' }, { status: 409 }),
    Response.json({ error: 'x', checkout_available: true }, { status: 409 }),
    Response.json({ error: 'x', checkout_available: false }, { status: 500 }),
    new Response('nope', { status: 502 }),
  ]) {
    const ui = drive(await emit({}, SHELLS['en-US']), answer);
    await ui.click();
    assert.equal(ui.status.textContent, 'Unable to start checkout. Please try again.');
    assert.equal(ui.button.disabled, false);
  }
});

// ── the ECPay sheet ───────────────────────────────────────────────────────────────────────────
const bowl = item({ currency: 'TWD', unit_price: 120000, tracked: true, available: 3, reserved: 0 }, true);
const CVS = { sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, free_threshold_minor: null, cod_available: true };

function sheet(html, checkoutAnswer, withRadios = false) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const code = scripts.find((s) => s.startsWith('(function nativeEcpayCheckoutClient('));
  assert.ok(code);
  const listen = () => ({ listeners: {}, addEventListener(t, h) { this.listeners[t] = h; } });
  const status = { textContent: '', removeAttribute() {}, setAttribute() {} };
  const attrs = { 'data-native-ecpay-sku': 'tee-sku' };
  const button = Object.assign(listen(), {
    disabled: false, hidden: false, textContent: 'Buy',
    parentElement: { querySelector: (sel) => (sel === '[data-native-status]' ? status : sel === '[data-native-rail-choice]' && withRadios ? {} : null) },
    getAttribute: (n) => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { attrs[n] = String(v); }, removeAttribute: (n) => { delete attrs[n]; },
  });
  const panel = Object.assign(listen(), { innerHTML: '', hidden: true, querySelector: () => null });
  const document = {
    querySelector: (sel) => (sel === '[data-native-ecpay-sku]' ? button : sel === '[data-native-ecpay-checkout]' ? panel : null),
    querySelectorAll: () => [],
    documentElement: { lang: '' },
  };
  const draft = JSON.stringify({ ship: CVS.sub_type, pay: 'card', inv: 'carrier_ecpay', v: { name: 'Lin', phone: '0912345678', email: 'buyer@example.com' } });
  const store = { 'dc-native-ecpay-draft:tee-sku': draft };
  const window = { sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, matchMedia: () => ({ matches: false }), crypto: { randomUUID: () => '0f0e0d0c-0b0a-4908-8706-050403020100' } };
  const location = { origin: 'https://site.example', pathname: '/shop/tee', href: 'https://site.example/shop/tee?store_ref=store-1', assign() {} };
  const fetch = async (u) => {
    if (u.startsWith('/api/v2/ecpay/logistics/delivery-options')) return { ok: true, status: 200, json: async () => ({ ok: true, currency: 'TWD', options: [CVS] }) };
    return { ok: false, status: checkoutAnswer.status, json: async () => checkoutAnswer.body };
  };
  new Function('document', 'window', 'fetch', 'location', 'history', code)(document, window, fetch, location, { state: null, replaceState() {} });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    panel,
    async ready() { button.listeners.click(); await settle(); await settle(); },
    async submit() {
      panel.listeners.click({ target: { closest: (sel) => (sel === '[data-ecpay-submit]' ? {} : null) }, preventDefault() {} });
      for (let i = 0; i < 4; i++) await settle();
    },
  };
}
const submitTag = (ui) => ui.panel.innerHTML.match(/<button[^>]*data-ecpay-submit[^>]*>/)[0];

test('the ECPay sheet shows the not-open sentence with error tone and disables submit when no rail choice is shown', async () => {
  const html = await emit({}, SHELLS['zh-TW'], bowl);
  const ui = sheet(html, { status: 409, body: { error: 'checkout_unavailable', checkout_available: false } });
  await ui.ready();
  assert.doesNotMatch(submitTag(ui), / disabled/);
  await ui.submit();
  assert.match(ui.panel.innerHTML, new RegExp(`data-ecpay-status role="status" class="st-runtime-status" data-ejecta-status-tone="error">${SENTENCE['zh-TW']}`));
  assert.match(submitTag(ui), / disabled/);
});

test('the ECPay sheet keeps submit enabled when a payment-method choice is shown', async () => {
  const html = await emit({}, SHELLS['en-US'], bowl);
  const ui = sheet(html, { status: 409, body: { error: 'checkout_unavailable', checkout_available: false } }, true);
  await ui.ready();
  await ui.submit();
  assert.match(ui.panel.innerHTML, /data-ejecta-status-tone="error">This shop is not taking payments yet\./);
  assert.doesNotMatch(submitTag(ui), / disabled/);
});

test('the ECPay sheet keeps the preview sentence first and the generic failure unchanged', async () => {
  const preview = sheet(await emit({ preview_checkout: 'test' }, SHELLS['en-US'], bowl), { status: 409, body: { error: 'preview_checkout_live_mode', checkout_available: false } });
  await preview.ready();
  await preview.submit();
  assert.match(preview.panel.innerHTML, /This is a preview/);
  assert.doesNotMatch(preview.panel.innerHTML, /not taking payments/);
  const generic = sheet(await emit({}, SHELLS['en-US'], bowl), { status: 502, body: { error: 'ecpay checkout unavailable' } });
  await generic.ready();
  await generic.submit();
  assert.match(generic.panel.innerHTML, /Unable to start checkout\. Please try again\./);
  assert.doesNotMatch(submitTag(generic), / disabled/);
});
