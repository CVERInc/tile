import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A native item the producer lists with two or more eligible rails gets a payment-method radio group
// beside its Buy button; the press sends the checked rail. Absent the field, nothing changes.

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-rail-choice-'));
const contract = path.join(temp, 'site-api-transport.contract.json');
writeFileSync(contract, JSON.stringify({
  bindingName: 'RSP',
  checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
  forward: [{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] }, { match: 'exact', value: '/checkout/success', methods: ['GET'] }],
  verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
  onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));

const SHELLS = {
  'en-US': '<!doctype html><html><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'zh-TW': '<!doctype html><html lang="zh-Hant"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'ja-JP': '<!doctype html><html lang="ja-JP"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'zh-CN': '<!doctype html><html lang="zh-Hans"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
};
function product(slug, sku, commerce = {}) {
  return {
    slug,
    copy: { name: `Item ${slug}`, description_html: '<p>Copy</p>', media: [], requires_shipping: false },
    commerce: { sku, product_id: `p-${sku}`, variant_id: `v-${sku}`, currency: 'JPY', unit_price: 1900, tracked: false, status: 'IN_STOCK', ...commerce },
  };
}

let built = 0;
async function render(pathname, body, shell = SHELLS['en-US']) {
  const out = path.join(temp, `shop-${built++}.mjs`);
  execFileSync('node', [emitter, '--api-contract', contract, '--site-id', 'site-rails', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]), '--api', 'https://api.example', '--out', out], { stdio: 'pipe' });
  const mod = await import(`${pathToFileURL(out).href}?${Date.now()}`);
  const response = await mod.default.fetch(new Request(`https://site.example${pathname}`), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', ...body }) },
  });
  return response.text();
}
const page = (commerce, extra = {}, shell) => render('/shop/tee', { item: product('tee', 'tee-sku', commerce), ...extra }, shell);
const grid = (items, extra = {}) => render('/shop', { items, ...extra });

const groupCount = (html) => (html.match(/<fieldset data-native-rails>/g) || []).length;

test('a product page with 2+ rails renders the group before Buy with the first rail checked', async () => {
  const html = await page({ checkout_rails: ['stripe', 'ecpay'] });
  assert.equal(groupCount(html), 1);
  assert.match(html, /<div class="st-native-actions"><fieldset data-native-rails><legend>Payment method<\/legend><label><input type="radio" name="native-rail-tee-sku" value="stripe" data-native-rail-choice checked> Stripe<\/label><label><input type="radio" name="native-rail-tee-sku" value="ecpay" data-native-rail-choice> ECPay<\/label><\/fieldset><button type="button" class="dc-native-buy" data-native-sku="tee-sku" data-native-rail="stripe">Buy now<\/button>/);
});

test('provider names and legend are localized, and an unknown id shows as itself', async () => {
  const tw = await page({ checkout_rails: ['square', 'ecpay', 'x<y'] }, {}, SHELLS['zh-TW']);
  assert.match(tw, /<legend>付款方式<\/legend>/);
  assert.match(tw, /value="square" data-native-rail-choice checked> Square<\/label>/);
  assert.match(tw, /value="ecpay" data-native-rail-choice> 綠界<\/label>/);
  assert.match(tw, /value="x&lt;y" data-native-rail-choice> x&lt;y<\/label>/);
  assert.match(await page({ checkout_rails: ['stripe', 'ecpay'] }, {}, SHELLS['zh-CN']), /<legend>付款方式<\/legend>[\s\S]*> 绿界<\/label>/);
  const ja = await page({ checkout_rails: ['stripe', 'ecpay'] }, {}, SHELLS['ja-JP']);
  assert.match(ja, /<legend>支払い方法<\/legend>[\s\S]*> ECPay<\/label>/);
});

test('each grid card carries its own group with a per-item radio name', async () => {
  const html = await grid([
    product('a', 'sku-a', { checkout_rails: ['stripe', 'square'] }),
    product('b', 'sku-b', { checkout_rails: ['square', 'stripe'] }),
    product('c', 'sku-c'),
  ]);
  assert.equal(groupCount(html), 2);
  assert.match(html, /name="native-rail-sku-a" value="stripe" data-native-rail-choice checked/);
  assert.match(html, /name="native-rail-sku-b" value="square" data-native-rail-choice checked/);
  assert.match(html, /<\/fieldset><button type="button" class="dc-native-buy" data-native-sku="sku-a" data-native-rail="stripe">/);
  assert.match(html, /<\/fieldset><button type="button" class="dc-native-buy" data-native-sku="sku-b" data-native-rail="square">/);
});

test('the group is absent for a missing, one-entry or malformed field', async () => {
  for (const checkout_rails of [undefined, [], ['stripe'], 'stripe', { 0: 'stripe', 1: 'square' }, ['stripe', ''], ['stripe', 2], ['stripe', null]]) {
    const html = await page({ checkout_rails });
    assert.equal(groupCount(html), 0, JSON.stringify(checkout_rails));
    assert.doesNotMatch(html, /data-native-rail-choice/);
  }
});

test('the group is absent on out-of-stock, currency-refused and preview live_refused items', async () => {
  const rails = ['stripe', 'ecpay'];
  assert.equal(groupCount(await page({ checkout_rails: rails, status: 'OUT_OF_STOCK' })), 0);
  assert.equal(groupCount(await page({ checkout_rails: rails, tracked: true, available: 0 })), 0);
  assert.equal(groupCount(await page({ checkout_rails: rails, rail_refused: 'currency' })), 0);
  assert.equal(groupCount(await page({ checkout_rails: rails }, { preview_checkout: 'live_refused' })), 0);
  assert.equal(groupCount(await page({ checkout_rails: rails }, { preview_checkout: 'test' })), 1);
  const html = await grid([product('a', 'sku-a', { checkout_rails: rails, rail_refused: 'currency' }), product('b', 'sku-b', { checkout_rails: rails, status: 'OUT_OF_STOCK' })]);
  assert.equal(groupCount(html), 0);
});

test('a page without the field keeps the original script and markup bytes', async () => {
  const plain = await page({});
  const withRail = await page({ checkout_rail: 'ecpay' });
  assert.doesNotMatch(plain, /data-native-rail|picked/);
  assert.match(plain, /const body=email\?JSON\.stringify\(lang\?\{lang:lang,customer_email:email\}:\{customer_email:email\}\):lang\?JSON\.stringify\(\{lang:lang\}\):null;/);
  assert.doesNotMatch(plain, /radios/);
  assert.match(withRail, /data-native-rail="ecpay"/);
  assert.doesNotMatch(withRail, /data-native-rail-choice|radios/);
  assert.match(withRail, /const pr=button\.getAttribute\('data-native-rail'\);/);
});

function drive(html, respond) {
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  assert.ok(script);
  let click;
  const document = { documentElement: { lang: '' }, addEventListener(t, h) { if (t === 'click') click = h; } };
  const radios = ['stripe', 'ecpay'].map((value, i) => ({ value, checked: i === 0, disabled: false }));
  const status = { textContent: '', setAttribute() {}, removeAttribute() {} };
  const parent = {
    querySelector: (sel) => (sel === '[data-native-status]' ? status : sel === '[data-native-rail-choice]:checked' ? radios.find((r) => r.checked) || null : null),
    querySelectorAll: (sel) => (sel === '[data-native-rail-choice]' ? radios : []),
  };
  const button = { disabled: false, textContent: 'Buy now', parentElement: parent, setAttribute() {}, removeAttribute() {}, getAttribute: (n) => (n === 'data-native-sku' ? 'tee-sku' : n === 'data-native-rail' ? 'stripe' : null) };
  const calls = [];
  new Function('document', 'fetch', 'window', script[1])(
    document,
    async (url, init) => { if (url === '/api/cart') return Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] }); calls.push({ url, init, locked: radios.map((r) => r.disabled) }); return respond(url); },
    { location: { assign() {} } },
  );
  return { radios, button, calls, click: () => click({ target: { closest: () => button } }) };
}

test('the press posts the chosen rail, locks the radios in flight and unlocks them on failure', async () => {
  const html = await page({ checkout_rails: ['stripe', 'ecpay'] });
  const ui = drive(html, async () => Response.json({ error: 'nope' }, { status: 500 }));
  ui.radios[0].checked = false;
  ui.radios[1].checked = true;
  await ui.click();
  const sent = JSON.parse(ui.calls.find((c) => c.url === '/api/checkout').init.body);
  assert.equal(sent.payment_rail, 'ecpay');
  assert.deepEqual(ui.calls.find((c) => c.url === '/api/checkout').locked, [true, true]);
  assert.equal(ui.button.disabled, false);
  assert.deepEqual(ui.radios.map((r) => r.disabled), [false, false]);
});

test('the default rail is sent when the first radio stays checked, and radios stay locked after a checkout conflict', async () => {
  const html = await page({ checkout_rails: ['stripe', 'ecpay'] });
  const ui = drive(html, async () => Response.json({ error: 'checkout_attempt_conflict' }, { status: 409 }));
  await ui.click();
  assert.equal(JSON.parse(ui.calls.find((c) => c.url === '/api/checkout').init.body).payment_rail, 'stripe');
  assert.equal(ui.button.disabled, true);
  assert.deepEqual(ui.radios.map((r) => r.disabled), [true, true]);
});
