import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The in-page ECPay checkout on a native product page: a shipping TWD product whose Site answers
// delivery methods expands the checkout in place (method + fee, store map round trip, recipient,
// invoice, payment incl. cash on delivery, total) and sends RSP's dedicated ECPay checkout. Any
// other product, and a Site with no delivery method, keeps the existing Buy flow.

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-ecpay-checkout-'));
const contract = path.join(temp, 'site-api-transport.contract.json');
writeFileSync(contract, JSON.stringify({
  bindingName: 'RSP',
  checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
  forward: [{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] }, { match: 'exact', value: '/checkout/success', methods: ['GET'] }],
  verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
  onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));

const ZH_SHELL = '<!doctype html><html lang="zh-Hant-TW"><head><title>Donor</title></head><body><main>GRID</main></body></html>';
const EN_SHELL = '<!doctype html><html lang="en"><head><title>Donor</title></head><body><main>GRID</main></body></html>';
const bowl = {
  slug: 'tea-bowl',
  copy: { name: 'Tea bowl', description_html: '<p>Hand thrown.</p>', image_ref: '/bowl.jpg', media: [{ url: '/bowl.jpg' }], requires_shipping: true },
  commerce: { sku: 'bowl-sku', product_id: 'p1', variant_id: 'v1', currency: 'TWD', unit_price: 120000, tracked: true, available: 3, reserved: 0, status: 'IN_STOCK' },
};
const CVS = { sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, free_threshold_minor: null, cod_available: true };
const HOME = { sub_type: 'TCAT', logistics_type: 'HOME', fee_minor: 12000, free_threshold_minor: 150000, cod_available: false };

let emitted = null;
async function worker() {
  if (emitted) return emitted;
  const out = path.join(temp, 'worker.mjs');
  execFileSync('node', [emitter, '--api-contract', contract, '--site-id', 'site-tea', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]), '--api', 'https://api.example', '--out', out], { stdio: 'pipe' });
  emitted = await import(`${pathToFileURL(out).href}?${Date.now()}`);
  return emitted;
}
async function productHtml(item, shell = ZH_SHELL, query = '') {
  const mod = await worker();
  const response = await mod.default.fetch(new Request(`https://site.example/shop/${item.slug}${query}`), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', item }) },
  });
  assert.equal(response.status, 200);
  return response.text();
}
function ecpayScript(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = scripts.find((s) => s.startsWith('(function nativeEcpayCheckoutClient('));
  assert.ok(found, 'the ECPay checkout script is on the page');
  return found;
}

// A just-enough browser: the panel's innerHTML is the rendered checkout; events are delivered to
// the listeners the script registered, with targets shaped like the inputs it rendered.
function browser(html, respond, { href = 'https://site.example/shop/tea-bowl', session = {} } = {}) {
  const calls = [];
  const forms = [];
  const store = { ...session };
  const sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const listen = () => ({ listeners: {}, addEventListener(t, h) { this.listeners[t] = h; } });
  const status = { textContent: '', removeAttribute() {}, setAttribute() {} };
  const attrs = {};
  const button = Object.assign(listen(), {
    disabled: false, hidden: false, textContent: '立即購買', clicked: 0,
    parentElement: { querySelector: (sel) => (sel === '[data-native-status]' ? status : null) },
    getAttribute: (n) => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { attrs[n] = String(v); }, removeAttribute: (n) => { delete attrs[n]; },
    click() { this.clicked += 1; },
  });
  attrs['data-native-ecpay-sku'] = 'bowl-sku';
  const panel = Object.assign(listen(), { innerHTML: '', hidden: true, querySelector: () => null });
  const collapse = [{ hidden: false }, { hidden: false }];
  const url = new URL(href);
  const location = { origin: url.origin, pathname: url.pathname, href: url.href, assigned: null, assign(u) { this.assigned = u; } };
  const history = { state: null, replaced: null, replaceState(_s, _t, u) { this.replaced = u; } };
  const document = {
    querySelector: (sel) => (sel === '[data-native-ecpay-sku]' ? button : sel === '[data-native-ecpay-checkout]' ? panel : null),
    querySelectorAll: (sel) => (sel === '[data-native-ecpay-collapse]' ? collapse : []),
    body: { appendChild() {}, removeChild() {} },
    createElement: (tag) => {
      if (tag !== 'form') return { tag };
      const form = { inputs: [], method: '', action: '', submit() { forms.push({ action: this.action, fields: Object.fromEntries(this.inputs.map((i) => [i.name, i.value])) }); }, appendChild(i) { this.inputs.push(i); }, remove() {}, setAttribute() {} };
      return form;
    },
  };
  const window = { sessionStorage, matchMedia: () => ({ matches: true }), crypto: { randomUUID: () => '0f0e0d0c-0b0a-4908-8706-050403020100' } };
  const fetch = async (u, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, method: init.method || 'GET', body });
    const answer = await respond(u, body, calls.length);
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  new Function('document', 'window', 'fetch', 'location', 'history', ecpayScript(html))(document, window, fetch, location, history);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const target = (attrs2, extra = {}) => ({ getAttribute: (n) => (n in attrs2 ? attrs2[n] : null), closest: (sel) => (sel.slice(1, -1) in attrs2 ? {} : null), ...extra });
  return {
    calls, forms, store, button, panel, collapse, location, history, status,
    async press() { button.listeners.click(); await settle(); await settle(); },
    type(key, value) { panel.listeners.input({ target: target({ 'data-ecpay-field': key }, { value }) }); },
    async choose(name, value) { panel.listeners.change({ target: { type: 'radio', name: `dc-ecpay-${name}`, value } }); await settle(); },
    async submit() { panel.listeners.click({ target: target({ 'data-ecpay-submit': '' }), preventDefault() {} }); await settle(); await settle(); await settle(); },
    async pickStore() { panel.listeners.click({ target: target({ 'data-ecpay-store': '' }), preventDefault() {} }); await settle(); await settle(); },
    settle,
  };
}
const options = (list) => async (u) => (u.startsWith('/api/v2/ecpay/logistics/delivery-options')
  ? { status: 200, body: { ok: true, currency: 'TWD', options: list } }
  : { status: 500, body: null });

test('a shipping TWD product renders the ECPay Buy control, a hidden panel and both scripts', async () => {
  const html = await productHtml(bowl);
  assert.match(html, /<button type="button" class="dc-native-buy" data-native-ecpay-sku="bowl-sku">立即購買<\/button>/);
  assert.match(html, /<section class="st-native-checkout" data-native-ecpay-checkout aria-label="立即購買" hidden><\/section>/);
  assert.match(html, /data-native-ecpay-collapse>Hand thrown\.<\/p>/);
  assert.doesNotMatch(html, /data-native-sku=/, 'the existing script finds no control until a fallback re-marks it');
  assert.ok(html.includes("const T=['https://payment-stage.ecpay.com.tw','https://payment.ecpay.com.tw']"), 'the existing Buy script is still emitted');
});

test('other products keep the existing Buy control: another currency, no shipping, sold out', async () => {
  for (const item of [
    { ...bowl, commerce: { ...bowl.commerce, currency: 'USD' } },
    { ...bowl, copy: { ...bowl.copy, requires_shipping: false } },
    { ...bowl, commerce: { ...bowl.commerce, status: 'OUT_OF_STOCK', available: 0 } },
  ]) {
    const html = await productHtml(item);
    assert.doesNotMatch(html, /data-native-ecpay/);
    assert.doesNotMatch(html, /nativeEcpayCheckoutClient/);
  }
});

test('pressing Buy reads the delivery methods and expands the checkout in place', async () => {
  const b = browser(await productHtml(bowl), options([CVS, HOME]));
  await b.press();
  assert.deepEqual(b.calls[0], { url: '/api/v2/ecpay/logistics/delivery-options?site_id=site-tea&items_minor=120000', method: 'GET', body: null });
  assert.equal(b.panel.hidden, false);
  assert.equal(b.button.hidden, true);
  assert.ok(b.collapse.every((c) => c.hidden), 'image and description step aside');
  const h = b.panel.innerHTML;
  assert.match(h, /<legend>配送方式<\/legend>/);
  assert.match(h, /<label class="st-opt st-opt-on"><input type="radio" name="dc-ecpay-ship" value="UNIMARTC2C" checked><span class="st-opt-t">7-ELEVEN 取貨<\/span>/);
  assert.match(h, /<span class="st-opt-t">黑貓宅配<\/span><span class="st-opt-d">滿 [^<]*1,500[^<]* 免運<\/span>/);
  assert.match(h, /<strong>選門市<\/strong><span class="st-note">到綠界地圖選<\/span>/);
  assert.match(h, /<legend>收件人<\/legend>/);
  assert.match(h, /<legend>電子發票<\/legend>.*存在綠界會員載具.*手機條碼.*捐贈.*公司統編/);
  assert.match(h, /電子郵件（寄送訂單確認）/);
  assert.match(h, /<span>小計<\/span><span>[^<]*1,200[^<]*<\/span>.*<span>運費<\/span><span>[^<]*60[^<]*<\/span>.*<span>合計<\/span><span>[^<]*1,260[^<]*<\/span>/);
  assert.match(h, />前往付款<\/button><p class="st-note">會到綠界付款頁。<\/p>/);
});

test('choosing another method moves the fee and the total with it', async () => {
  const b = browser(await productHtml(bowl), options([CVS, HOME]));
  await b.press();
  await b.choose('ship', 'TCAT');
  const h = b.panel.innerHTML;
  assert.match(h, /value="TCAT" checked/);
  assert.match(h, /<span>運費<\/span><span>[^<]*120[^<]*<\/span>/);
  assert.match(h, /<span>合計<\/span><span>[^<]*1,320[^<]*<\/span>/);
  assert.match(h, /data-ecpay-field="address"/, 'home delivery asks for the address');
  assert.doesNotMatch(h, /<legend>付款方式<\/legend>/, 'no cash on delivery for this method');
});

test('a Site with no delivery method hands the same click to the existing Buy flow', async () => {
  for (const answer of [{ status: 404, body: { error: 'ecpay not connected' } }, { status: 200, body: { ok: true, currency: 'TWD', options: [] } }]) {
    const b = browser(await productHtml(bowl), async () => answer);
    await b.press();
    assert.equal(b.button.getAttribute('data-native-sku'), 'bowl-sku');
    assert.equal(b.button.getAttribute('data-native-ecpay-sku'), null);
    assert.equal(b.button.clicked, 1, 'the click is replayed for the existing script');
    assert.equal(b.panel.hidden, true);
    assert.equal(b.calls.length, 1, 'nothing but the delivery-options read was sent');
  }
});

test('missing fields are prompted in place and nothing is sent', async () => {
  const b = browser(await productHtml(bowl), options([CVS]));
  await b.press();
  await b.submit();
  const h = b.panel.innerHTML;
  assert.match(h, /<p class="st-err" id="dc-ecpay-store-err">請先選門市。<\/p>/);
  assert.match(h, /aria-invalid="true" aria-describedby="dc-ecpay-name-err"><p class="st-err" id="dc-ecpay-name-err">請輸入收件人姓名。<\/p>/);
  assert.match(h, /<p class="st-err" id="dc-ecpay-phone-err">請輸入收件人手機。<\/p>/);
  assert.match(h, /<p class="st-err" id="dc-ecpay-email-err">請輸入電子郵件地址以繼續付款。<\/p>/);
  assert.equal(b.calls.length, 1, 'only the delivery-options read');
});

test('the store map round trip: form to the ECPay map, draft kept without invoice numbers, back with store_ref', async () => {
  const mapForm = { action: 'https://logistics-stage.ecpay.com.tw/Express/map', fields: { MerchantID: '2000132', LogisticsSubType: 'UNIMARTC2C' } };
  const html = await productHtml(bowl);
  const b = browser(html, async (u) => (u.startsWith('/api/v2/ecpay/logistics/delivery-options')
    ? { status: 200, body: { ok: true, currency: 'TWD', options: [CVS] } }
    : u === '/api/v2/ecpay/logistics/store-map' ? { status: 200, body: { ok: true, form_post: mapForm } } : { status: 500, body: null }));
  await b.press();
  b.type('name', 'Lin');
  b.type('phone', '0912345678');
  b.type('email', 'buyer@example.com');
  await b.choose('inv', 'mobile');
  b.type('mobile', '/ABC1234');
  await b.pickStore();
  assert.deepEqual(b.calls[1], { url: '/api/v2/ecpay/logistics/store-map', method: 'POST', body: { site_id: 'site-tea', sub_type: 'UNIMARTC2C', client_back_url: 'https://site.example/shop/tea-bowl', device: 'mobile' } });
  assert.deepEqual(b.forms, [mapForm]);
  const draft = JSON.parse(b.store['dc-native-ecpay-draft:bowl-sku']);
  assert.deepEqual(draft, { ship: 'UNIMARTC2C', pay: 'card', inv: 'mobile', v: { name: 'Lin', phone: '0912345678', email: 'buyer@example.com' } });

  const back = browser(html, options([CVS]), { href: 'https://site.example/shop/tea-bowl?store_ref=7c1d5b0e-2f43-4d7a-9a51-0e8a3f6b2c11', session: b.store });
  await back.settle(); await back.settle();
  assert.equal(back.history.replaced, '/shop/tea-bowl');
  assert.equal(back.panel.hidden, false);
  assert.match(back.panel.innerHTML, /<strong>已選門市<\/strong>/);
  assert.match(back.panel.innerHTML, />換門市<\/button>/);
  assert.match(back.panel.innerHTML, /data-ecpay-field="name" value="Lin"/);
  assert.match(back.panel.innerHTML, /value="mobile" checked/);
  assert.match(back.panel.innerHTML, /data-ecpay-field="mobile" value=""/, 'the barcode is typed again, never kept');
});

test('a store map form to any other origin is not launched', async () => {
  const b = browser(await productHtml(bowl), async (u) => (u.startsWith('/api/v2/ecpay/logistics/delivery-options')
    ? { status: 200, body: { ok: true, currency: 'TWD', options: [CVS] } }
    : { status: 200, body: { ok: true, form_post: { action: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { A: 'b' } } } }));
  await b.press();
  await b.pickStore();
  assert.deepEqual(b.forms, []);
  assert.match(b.panel.innerHTML, /無法開啟門市地圖，請再試一次。/);
});

async function readyForSubmit(respond, list = [CVS]) {
  const html = await productHtml(bowl);
  const b = browser(html, respond, { href: 'https://site.example/shop/tea-bowl?store_ref=store-1', session: { 'dc-native-ecpay-draft:bowl-sku': JSON.stringify({ ship: list[0].sub_type, pay: 'card', inv: 'carrier_ecpay', v: { name: 'Lin', phone: '0912345678', email: 'buyer@example.com' } }) } });
  await b.settle(); await b.settle();
  void list;
  return b;
}
const deliveryThen = (list, after) => async (u, body, n) => (u.startsWith('/api/v2/ecpay/logistics/delivery-options')
  ? { status: 200, body: { ok: true, currency: 'TWD', options: list } }
  : after(u, body, n));

test('a card order sends the dedicated ECPay checkout with RSP\'s field names and launches the cashier', async () => {
  const cashier = { action: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { MerchantTradeNo: 'T1', CheckMacValue: 'X' } };
  const b = await readyForSubmit(deliveryThen([CVS], () => ({ status: 200, body: { attempt_id: 'a1', order_id: 'order-1', merchant_trade_no: 'T1', form_post: cashier } })));
  await b.submit();
  const sent = b.calls.find((c) => c.url === '/api/v2/ecpay/checkout');
  const ref = 'tile-0f0e0d0c-0b0a-4908-8706-050403020100';
  assert.deepEqual(sent, {
    url: '/api/v2/ecpay/checkout', method: 'POST',
    body: {
      site_id: 'site-tea', items: [{ sku: 'bowl-sku', qty: 1 }], client_request_ref: ref,
      client_back_url: `https://site.example/shop/complete?ref=${ref}`,
      logistics: { sub_type: 'UNIMARTC2C', recipient_name: 'Lin', recipient_phone: '0912345678', store_ref: 'store-1' },
      customer_email: 'buyer@example.com',
      invoice: { carrier_type: '1', email: 'buyer@example.com' },
    },
  });
  assert.deepEqual(b.forms, [cashier]);
  assert.deepEqual(JSON.parse(b.store[`dc-native-ecpay:${ref}`]), { order_id: 'order-1', sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, currency: 'TWD', invoice: true });
  assert.equal(b.store['dc-native-ecpay-draft:bowl-sku'], undefined, 'the draft goes once the order is sent');
});

test('cash on delivery: the payment choice, 「送出訂單」, only the total, and the placed order goes to the result page', async () => {
  const b = await readyForSubmit(deliveryThen([CVS], () => ({ status: 200, body: { order_id: 'order-2', attempt_id: 'a2', cash_on_delivery: true, state: 'awaiting_collection' } })));
  assert.match(b.panel.innerHTML, /<legend>付款方式<\/legend>.*信用卡（綠界）.*取貨付款<\/span><span class="st-opt-d">到店取貨時付 [^<]*1,260[^<]*。<\/span>/);
  await b.choose('pay', 'cod');
  const h = b.panel.innerHTML;
  assert.match(h, />送出訂單<\/button><p class="st-note">不會先扣款；取貨時付。<\/p>/);
  assert.doesNotMatch(h, /<span>小計<\/span>/);
  assert.match(h, /<div class="st-sum"><div class="st-sum-tot"><span>合計<\/span><span>[^<]*1,260[^<]*<\/span><\/div><\/div>/);
  await b.submit();
  const sent = b.calls.find((c) => c.url === '/api/v2/ecpay/checkout');
  assert.deepEqual(sent.body.payment, { method: 'cod' });
  const ref = 'tile-0f0e0d0c-0b0a-4908-8706-050403020100';
  assert.equal(b.location.assigned, `https://site.example/shop/complete?ref=${ref}`);
  assert.deepEqual(JSON.parse(b.store[`dc-native-ecpay:${ref}`]), { order_id: 'order-2', sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, currency: 'TWD', invoice: true, cod: true, total_minor: 126000, lines: [{ name: 'Tea bowl', qty: 1, amount_minor: 120000 }] });
  assert.deepEqual(b.forms, [], 'no cashier for cash on delivery');
});

test('home delivery sends the address and no store', async () => {
  const b = await readyForSubmit(deliveryThen([HOME], () => ({ status: 200, body: { order_id: 'order-3', form_post: { action: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { A: 'b' } } } })), [HOME]);
  await b.submit();
  assert.match(b.panel.innerHTML, /請輸入地址。/);
  b.type('address', 'No. 1, Example Rd.');
  b.type('postal', '106');
  await b.submit();
  const sent = b.calls.find((c) => c.url === '/api/v2/ecpay/checkout');
  assert.deepEqual(sent.body.logistics, { sub_type: 'TCAT', recipient_name: 'Lin', recipient_phone: '0912345678', address: 'No. 1, Example Rd.', postal_code: '106' });
});

test('the server\'s refusals land on the field they name', async () => {
  const cases = [
    [{ status: 422, body: { error: 'logistics_invalid', reason: 'recipient_phone_malformed', field: 'logistics' } }, /id="dc-ecpay-phone-err">手機號碼格式不對。/],
    [{ status: 422, body: { error: 'logistics_invalid', reason: 'store_selection_unverified', field: 'logistics.store_ref' } }, /id="dc-ecpay-store-err">門市選擇已失效，請重新選門市。/],
    [{ status: 400, body: { error: 'invoice_love_code_unknown', field: 'invoice.love_code' } }, /id="dc-ecpay-love-err">查無這個捐贈碼。/],
    [{ status: 409, body: { error: 'cod_amount_unsupported', field: 'cash_on_delivery' } }, /id="dc-ecpay-pay-err">這筆訂單無法取貨付款，請改用信用卡。/],
    [{ status: 422, body: { error: 'customer_email_conflict' } }, /id="dc-ecpay-email-err">此訂單已綁定其他電子郵件地址/],
    [{ status: 502, body: { error: 'ecpay checkout unavailable' } }, /data-ecpay-status role="status" class="st-runtime-status" data-ejecta-status-tone="error">無法開始結帳，請再試一次。/],
  ];
  for (const [answer, shown] of cases) {
    const b = await readyForSubmit(deliveryThen([CVS], () => answer));
    if (answer.body.error === 'invoice_love_code_unknown') { await b.choose('inv', 'donate'); b.type('love', '168'); }
    await b.submit();
    assert.match(b.panel.innerHTML, shown, answer.body.error);
  }
});

test('a Site that issues no e-invoice drops the choice and sends the same order once more without it', async () => {
  const b = await readyForSubmit(deliveryThen([CVS], (u, body, n) => (body && body.invoice ? { status: 400, body: { error: 'invoice_not_offered', field: 'invoice' } } : { status: 200, body: { order_id: 'order-4', form_post: { action: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { A: 'b' } } } })));
  await b.submit();
  const sent = b.calls.filter((c) => c.url === '/api/v2/ecpay/checkout');
  assert.equal(sent.length, 2);
  assert.ok(sent[0].body.invoice);
  assert.equal(sent[1].body.invoice, undefined);
  assert.equal(b.forms.length, 1);
});

test('the checkout copy follows the shell language', async () => {
  const b = browser(await productHtml(bowl, EN_SHELL), options([CVS]));
  await b.press();
  assert.match(b.panel.innerHTML, /<legend>Delivery<\/legend>/);
  assert.match(b.panel.innerHTML, />Continue to payment<\/button>/);
});

test('every standard invoice choice is offered, for store pickup and home delivery alike', async () => {
  for (const list of [[CVS], [HOME]]) {
    const b = browser(await productHtml(bowl), options(list));
    await b.press();
    const h = b.panel.innerHTML;
    const offered = [...h.matchAll(/name="dc-ecpay-inv" value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(offered, ['carrier_ecpay', 'mobile', 'citizen', 'donate', 'tax_id', 'paper'], list[0].sub_type);
    assert.match(h, /<legend>電子發票<\/legend>.*存在綠界會員載具.*手機條碼.*自然人憑證.*捐贈.*公司統編.*紙本發票<\/span><span class="st-opt-d">隨商品寄出。<\/span>/);
    // The four existing choices keep their markup.
    for (const [value, label] of [['mobile', '手機條碼'], ['donate', '捐贈'], ['tax_id', '公司統編']]) {
      assert.ok(h.includes(`<label class="st-opt"><input type="radio" name="dc-ecpay-inv" value="${value}"><span class="st-opt-t">${label}</span></label>`), value);
    }
    assert.ok(h.includes('<label class="st-opt st-opt-on"><input type="radio" name="dc-ecpay-inv" value="carrier_ecpay" checked><span class="st-opt-t">存在綠界會員載具</span></label>'));
  }
});

test('the citizen certificate carrier is checked in place and sent as carrier type 2', async () => {
  const cashier = { action: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { A: 'b' } };
  const b = await readyForSubmit(deliveryThen([CVS], () => ({ status: 200, body: { order_id: 'order-6', form_post: cashier } })));
  await b.choose('inv', 'citizen');
  assert.match(b.panel.innerHTML, /<label class="st-field-label" for="dc-ecpay-citizen">憑證號碼<\/label><input id="dc-ecpay-citizen" type="text" data-ecpay-field="citizen" value="" autocapitalize="characters">/);
  b.type('citizen', 'AB1234');
  await b.submit();
  assert.match(b.panel.innerHTML, /id="dc-ecpay-citizen-err">請輸入憑證號碼（2 個英文字母加 14 位數字）。/);
  assert.equal(b.calls.filter((c) => c.url === '/api/v2/ecpay/checkout').length, 0, 'nothing is sent');
  b.type('citizen', 'ab12345678901234');
  await b.submit();
  const sent = b.calls.find((c) => c.url === '/api/v2/ecpay/checkout');
  assert.deepEqual(sent.body.invoice, { carrier_type: '2', carrier_number: 'AB12345678901234', email: 'buyer@example.com' });
  assert.deepEqual(b.forms, [cashier]);
});

test('the paper invoice asks for a name and an address and is sent as a print request', async () => {
  const cashier = { action: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { A: 'b' } };
  const b = await readyForSubmit(deliveryThen([HOME], () => ({ status: 200, body: { order_id: 'order-7', form_post: cashier } })), [HOME]);
  b.type('address', 'No. 1, Example Rd.');
  await b.choose('inv', 'paper');
  assert.match(b.panel.innerHTML, /for="dc-ecpay-paperName">姓名<\/label>.*for="dc-ecpay-paperAddress">地址<\/label>/);
  await b.submit();
  assert.match(b.panel.innerHTML, /id="dc-ecpay-paperName-err">請輸入發票上的姓名。/);
  assert.match(b.panel.innerHTML, /id="dc-ecpay-paperAddress-err">請輸入發票上的地址。/);
  assert.equal(b.calls.filter((c) => c.url === '/api/v2/ecpay/checkout').length, 0, 'nothing is sent');
  b.type('paperName', 'Lin');
  b.type('paperAddress', 'No. 2, Example Rd.');
  await b.submit();
  const sent = b.calls.find((c) => c.url === '/api/v2/ecpay/checkout');
  assert.deepEqual(sent.body.invoice, { print: true, buyer_name: 'Lin', buyer_address: 'No. 2, Example Rd.', email: 'buyer@example.com' });
});

test('a refusal of a citizen number or a paper address lands on that field', async () => {
  const cases = [
    ['citizen', { citizen: 'AB12345678901234' }, { status: 400, body: { error: 'invalid_field', field: 'invoice.carrier_number' } }, /id="dc-ecpay-citizen-err">請輸入憑證號碼/],
    ['paper', { paperName: 'Lin', paperAddress: 'No. 2' }, { status: 400, body: { error: 'invalid_field', field: 'invoice.buyer_address' } }, /id="dc-ecpay-paperAddress-err">請輸入發票上的地址。/],
  ];
  for (const [inv, typed, answer, shown] of cases) {
    const b = await readyForSubmit(deliveryThen([CVS], () => answer));
    await b.choose('inv', inv);
    for (const [k, v] of Object.entries(typed)) b.type(k, v);
    await b.submit();
    assert.match(b.panel.innerHTML, shown, inv);
  }
});

test('the store map draft keeps the new choices but never their numbers, names or addresses', async () => {
  const mapForm = { action: 'https://logistics-stage.ecpay.com.tw/Express/map', fields: { A: 'b' } };
  for (const [inv, typed] of [['citizen', { citizen: 'AB12345678901234' }], ['paper', { paperName: 'Lin', paperAddress: 'No. 2' }]]) {
    const b = browser(await productHtml(bowl), async (u) => (u.startsWith('/api/v2/ecpay/logistics/delivery-options')
      ? { status: 200, body: { ok: true, currency: 'TWD', options: [CVS] } }
      : { status: 200, body: { ok: true, form_post: mapForm } }));
    await b.press();
    await b.choose('inv', inv);
    for (const [k, v] of Object.entries(typed)) b.type(k, v);
    await b.pickStore();
    const draft = JSON.parse(b.store['dc-native-ecpay-draft:bowl-sku']);
    assert.equal(draft.inv, inv);
    assert.deepEqual(draft.v, {});
  }
});

test('the new invoice choices follow the shell language', async () => {
  const shells = [
    ['en', ['Citizen digital certificate', 'Paper invoice', 'Sent with the parcel.']],
    ['ja-JP', ['自然人証明書', '紙の発票', '商品に同梱します。']],
    ['zh-Hant-TW', ['自然人憑證', '紙本發票', '隨商品寄出。']],
    ['zh-Hans', ['自然人凭证', '纸本发票', '随商品寄出。']],
  ];
  for (const [lang, words] of shells) {
    const shell = ZH_SHELL.replace('lang="zh-Hant-TW"', `lang="${lang}"`);
    const b = browser(await productHtml(bowl, shell), options([CVS]));
    await b.press();
    for (const w of words) assert.ok(b.panel.innerHTML.includes(w), `${lang}: ${w}`);
  }
});
