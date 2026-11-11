import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The coupon on the in-page ECPay sheet. Only where the native projection says `coupon_entry === true`:
// a field above the summary, one read-only quote per change (POST /api/v2/ecpay/coupon-quote), the
// discounted summary and delivery methods re-read at the quoted item amount, `coupon_code` on the
// dedicated checkout, refusals named by their `code` under the field, and a discount line in the
// kept cash-on-delivery note. Without the flag the sheet sends and shows exactly what it did before.

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-ecpay-coupon-'));
const contract = path.join(temp, 'site-api-transport.contract.json');
writeFileSync(contract, JSON.stringify({
  bindingName: 'RSP',
  checkoutResult: { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' },
  forward: [{ match: 'prefix', value: '/api/', methods: ['GET', 'POST'] }, { match: 'exact', value: '/checkout/success', methods: ['GET'] }],
  verdictEndpoint: { version: 2, path: '/seam/site-verdict-v2', param: 'path' },
  onBindingMissing: { status: 503, cacheControl: 'private, no-store' },
}));

const SHELLS = {
  'zh-TW': '<!doctype html><html lang="zh-Hant-TW"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'en-US': '<!doctype html><html lang="en"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'ja-JP': '<!doctype html><html lang="ja-JP"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
  'zh-CN': '<!doctype html><html lang="zh-Hans"><head><title>Donor</title></head><body><main>GRID</main></body></html>',
};
const bowl = {
  slug: 'tea-bowl',
  copy: { name: 'Tea bowl', description_html: '<p>Hand thrown.</p>', image_ref: '/bowl.jpg', media: [{ url: '/bowl.jpg' }], requires_shipping: true },
  commerce: { sku: 'bowl-sku', product_id: 'p1', variant_id: 'v1', currency: 'TWD', unit_price: 120000, tracked: true, available: 3, reserved: 0, status: 'IN_STOCK' },
};
// Store pickup: a flat fee, cash on delivery. Home delivery: free from 1,100, so a discount can bring the fee back.
const CVS = { sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, free_threshold_minor: null, cod_available: true };
const home = (items) => ({ sub_type: 'TCAT', logistics_type: 'HOME', fee_minor: items >= 110000 ? 0 : 12000, free_threshold_minor: 110000, cod_available: false });
const QUOTE = { ok: true, currency: 'TWD', subtotal_minor: 120000, discount_minor: 20000, items_minor: 100000 };

let emitted = null;
async function worker() {
  if (emitted) return emitted;
  const out = path.join(temp, 'worker.mjs');
  execFileSync('node', [emitter, '--api-contract', contract, '--site-id', 'site-tea', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]), '--api', 'https://api.example', '--out', out], { stdio: 'pipe' });
  emitted = await import(`${pathToFileURL(out).href}?${Date.now()}`);
  return emitted;
}
async function productHtml(extra = {}, shell = SHELLS['zh-TW']) {
  const mod = await worker();
  const response = await mod.default.fetch(new Request(`https://site.example/shop/${bowl.slug}`), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', item: bowl, ...extra }) },
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

// The same just-enough browser as native-ecpay-checkout.test.mjs, plus the coupon field's events.
function browser(html, respond, { href = 'https://site.example/shop/tea-bowl', session = {}, pageCoupon = null } = {}) {
  const calls = [];
  const forms = [];
  const store = { ...session };
  const sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const listen = () => ({ listeners: {}, addEventListener(t, h) { this.listeners[t] = h; } });
  const status = { textContent: '', removeAttribute() {}, setAttribute() {} };
  const attrs = { 'data-native-ecpay-sku': 'bowl-sku' };
  const button = Object.assign(listen(), {
    disabled: false, hidden: false, textContent: '立即購買',
    parentElement: { querySelector: (sel) => (sel === '[data-native-status]' ? status : null) },
    getAttribute: (n) => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { attrs[n] = String(v); }, removeAttribute: (n) => { delete attrs[n]; },
    click() { if (this.listeners.click) this.listeners.click(); },
  });
  const panel = Object.assign(listen(), { innerHTML: '', hidden: true, querySelector: () => null });
  const url = new URL(href);
  const location = { origin: url.origin, pathname: url.pathname, href: url.href, assigned: null, assign(u) { this.assigned = u; } };
  const history = { state: null, replaced: null, replaceState(_s, _t, u) { this.replaced = u; } };
  const document = {
    querySelector: (sel) => (sel === '[data-native-ecpay-sku]' ? button : sel === '[data-native-ecpay-checkout]' ? panel : sel === '[data-native-coupon-field]' && pageCoupon !== null ? { value: pageCoupon } : null),
    querySelectorAll: () => [],
    body: { appendChild() {}, removeChild() {} },
    createElement: (tag) => {
      if (tag !== 'form') return { tag };
      return { inputs: [], method: '', action: '', submit() { forms.push({ action: this.action, fields: Object.fromEntries(this.inputs.map((i) => [i.name, i.value])) }); }, appendChild(i) { this.inputs.push(i); }, remove() {}, setAttribute() {} };
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
  const couponTarget = (value) => target({ 'data-ecpay-field': 'coupon' }, { type: 'text', value });
  return {
    calls, forms, store, button, panel, location, settle,
    async press() { button.listeners.click(); await settle(); await settle(); },
    type(key, value) { panel.listeners.input({ target: target({ 'data-ecpay-field': key }, { value }) }); },
    // A keystroke is an `input` event; blur or Enter is the `change` event the sheet quotes on.
    typeCoupon(value) { panel.listeners.input({ target: couponTarget(value) }); },
    async coupon(value) { panel.listeners.input({ target: couponTarget(value) }); panel.listeners.change({ target: couponTarget(value) }); await settle(); await settle(); },
    async choose(name, value) { panel.listeners.change({ target: { type: 'radio', name: `dc-ecpay-${name}`, value } }); await settle(); },
    async submit() { panel.listeners.click({ target: target({ 'data-ecpay-submit': '' }), preventDefault() {} }); for (let i = 0; i < 4; i++) await settle(); },
    async pickStore() { panel.listeners.click({ target: target({ 'data-ecpay-store': '' }), preventDefault() {} }); await settle(); await settle(); },
  };
}

// RSP as the sheet sees it: delivery methods priced at the asked item amount, then the quote and the checkout.
function rsp({ methods = (items) => [CVS, home(items)], quote = () => ({ status: 200, body: QUOTE }), checkout = () => ({ status: 200, body: { order_id: 'order-1', form_post: { action: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { A: 'b' } } } }), storeMap } = {}) {
  return async (u, body) => {
    if (u.startsWith('/api/v2/ecpay/logistics/delivery-options')) return { status: 200, body: { ok: true, currency: 'TWD', options: methods(Number(new URL(u, 'https://x').searchParams.get('items_minor'))) } };
    if (u === '/api/v2/ecpay/coupon-quote') return quote(body);
    if (u === '/api/v2/ecpay/checkout') return checkout(body);
    if (u === '/api/v2/ecpay/logistics/store-map' && storeMap) return storeMap(body);
    return { status: 500, body: null };
  };
}
const DRAFT = (extra = {}) => ({ 'dc-native-ecpay-draft:bowl-sku': JSON.stringify({ ship: CVS.sub_type, pay: 'card', inv: 'carrier_ecpay', v: { name: 'Lin', phone: '0912345678', email: 'buyer@example.com', ...extra } }) });
async function ready(html, respond, extra) {
  const b = browser(html, respond, { href: 'https://site.example/shop/tea-bowl?store_ref=store-1', session: DRAFT(extra) });
  await b.settle(); await b.settle();
  return b;
}
const reads = (b) => b.calls.filter((c) => c.url.startsWith('/api/v2/ecpay/logistics/delivery-options')).map((c) => Number(new URL(c.url, 'https://x').searchParams.get('items_minor')));
const quotes = (b) => b.calls.filter((c) => c.url === '/api/v2/ecpay/coupon-quote');
const sent = (b) => b.calls.find((c) => c.url === '/api/v2/ecpay/checkout');
const FIELD = '<div class="st-field"><label class="st-field-label" for="dc-ecpay-coupon">優惠碼（選填）</label><input id="dc-ecpay-coupon" type="text" data-ecpay-field="coupon" value="" autocomplete="off"></div><div class="st-sum">';

test('without coupon_entry (absent or false) the sheet has no field, sends no quote and no code', async () => {
  const shown = [];
  for (const extra of [{}, { coupon_entry: false }, { coupon_entry: 'true' }]) {
    const html = await productHtml(extra);
    const script = ecpayScript(html);
    assert.doesNotMatch(script, /"coupon":true|"cNotFound"|,function\(C,FM\)/, 'no coupon data or mapping in the page');
    const b = browser(html, rsp());
    await b.press();
    assert.doesNotMatch(b.panel.innerHTML, /dc-ecpay-coupon|折扣|優惠碼/);
    shown.push(b.panel.innerHTML);
    // Even an event shaped like the field's change sends nothing.
    await b.coupon('SAVE10');
    assert.equal(quotes(b).length, 0);
    assert.deepEqual(reads(b), [120000], 'only the opening delivery-options read');
    const r = await ready(html, rsp());
    await r.submit();
    assert.equal('coupon_code' in sent(r).body, false);
    assert.deepEqual(r.calls.map((c) => c.url), ['/api/v2/ecpay/logistics/delivery-options?site_id=site-tea&items_minor=120000', '/api/v2/ecpay/checkout']);
  }
  assert.equal(shown[1], shown[0]);
  assert.equal(shown[2], shown[0]);
});

test('with coupon_entry the field sits above the summary, for card and cash on delivery alike', async () => {
  const b = browser(await productHtml({ coupon_entry: true }), rsp());
  await b.press();
  assert.ok(b.panel.innerHTML.includes(FIELD), 'the field right above the summary');
  assert.doesNotMatch(b.panel.innerHTML, /折扣/, 'no discount row before a quote');
  await b.choose('pay', 'cod');
  assert.ok(b.panel.innerHTML.includes(FIELD), 'still there with cash on delivery');
  assert.equal(quotes(b).length, 0, 'opening the sheet asks for no quote');
});

test('a code typed in the page field before Buy carries into the sheet, is quoted once and is sent', async () => {
  const html = await productHtml({ coupon_entry: true });
  const b = browser(html, rsp(), { pageCoupon: ' SAVE10 ' });
  await b.press();
  await b.settle();
  assert.deepEqual(quotes(b).map((c) => c.body.coupon_code), ['SAVE10']);
  assert.match(b.panel.innerHTML, /data-ecpay-field="coupon" value="SAVE10" autocomplete="off">/);
  assert.match(b.panel.innerHTML, /<span>折扣<\/span>/);
  // An empty page field carries nothing and asks for no quote.
  const e = browser(html, rsp(), { pageCoupon: '   ' });
  await e.press();
  assert.equal(quotes(e).length, 0);
  assert.ok(e.panel.innerHTML.includes(FIELD));
});

test('typing does not quote; one change sends one quote with the trimmed code', async () => {
  const b = browser(await productHtml({ coupon_entry: true }), rsp());
  await b.press();
  for (const v of ['S', 'SA', 'SAV', ' SAVE10 ']) b.typeCoupon(v);
  await b.settle();
  assert.equal(quotes(b).length, 0, 'no quote per keystroke');
  await b.coupon(' SAVE10 ');
  assert.deepEqual(quotes(b), [{ url: '/api/v2/ecpay/coupon-quote', method: 'POST', body: { site_id: 'site-tea', items: [{ sku: 'bowl-sku', qty: 1 }], coupon_code: 'SAVE10' } }]);
});

test('a quote shows the 折扣 row and the discounted total, and delivery is re-read at the quoted amount', async () => {
  const b = browser(await productHtml({ coupon_entry: true }), rsp());
  await b.press();
  await b.choose('ship', 'TCAT');
  assert.match(b.panel.innerHTML, /<span>運費<\/span><span>[^<]*0[^<]*<\/span>.*<span>合計<\/span><span>[^<]*1,200[^<]*<\/span>/, 'free over 1,100 at full price');
  await b.coupon('SAVE10');
  assert.deepEqual(reads(b), [120000, 100000]);
  const h = b.panel.innerHTML;
  assert.match(h, /value="TCAT" checked/, 'the chosen method stays');
  assert.match(h, /<div class="st-sum"><div><span>小計<\/span><span>[^<]*1,200[^<]*<\/span><\/div><div><span>折扣<\/span><span>−[^<]*200[^<]*<\/span><\/div><div><span>運費<\/span><span>[^<]*120[^<]*<\/span><\/div><div class="st-sum-tot"><span>合計<\/span><span>[^<]*1,120[^<]*<\/span><\/div><\/div>/);
  assert.match(h, /data-ecpay-field="coupon" value="SAVE10" autocomplete="off">/, 'the code stays in the field');
});

test('cash on delivery follows the discounted amount, as open() sets it', async () => {
  // A store method that allows cash on delivery only from 1,100: the discount takes it away.
  const methods = (items) => [{ ...CVS, cod_available: items >= 110000 }];
  const b = browser(await productHtml({ coupon_entry: true }), rsp({ methods }));
  await b.press();
  await b.choose('pay', 'cod');
  assert.match(b.panel.innerHTML, /<legend>付款方式<\/legend>/);
  await b.coupon('SAVE10');
  assert.doesNotMatch(b.panel.innerHTML, /<legend>付款方式<\/legend>/);
  assert.match(b.panel.innerHTML, />前往付款<\/button>/, 'back to card');
});

test('a refused quote shows its sentence under the field and the figures go back to the full price', async () => {
  let answer = { status: 200, body: QUOTE };
  const b = browser(await productHtml({ coupon_entry: true }), rsp({ quote: () => answer }));
  await b.press();
  await b.coupon('SAVE10');
  assert.match(b.panel.innerHTML, /<span>折扣<\/span>/);
  const cases = [
    [{ error: 'expired', code: 'coupon_expired' }, /這個優惠碼已過期。/],
    [{ error: 'x', code: 'coupon_not_found' }, /找不到這個優惠碼。/],
    [{ error: 'x', code: 'coupon_unavailable' }, /這個優惠碼目前不能使用。/],
    [{ error: 'x', code: 'coupon_min_spend', min_spend_minor: 150000, currency: 'TWD' }, /這個優惠碼需要消費滿 [^<]*1,500[^<]* 才能使用。/],
    [{ error: 'x', code: 'something_new' }, /這個優惠碼無法使用。/],
    [null, /這個優惠碼無法使用。/],
  ];
  for (const [body, shown] of cases) {
    answer = { status: 422, body };
    await b.coupon('BAD');
    const h = b.panel.innerHTML;
    assert.match(h, /data-ecpay-field="coupon" value="BAD" autocomplete="off" aria-invalid="true" aria-describedby="dc-ecpay-coupon-err"><p class="st-err" id="dc-ecpay-coupon-err">/);
    assert.match(h.match(/id="dc-ecpay-coupon-err">([^<]*)</)[1], shown, JSON.stringify(body));
    assert.doesNotMatch(h, /<span>折扣<\/span>/);
    assert.match(h, /<span>小計<\/span><span>[^<]*1,200[^<]*<\/span><\/div><div><span>運費<\/span><span>[^<]*60[^<]*<\/span>.*<span>合計<\/span><span>[^<]*1,260[^<]*<\/span>/);
    assert.equal(reads(b).at(-1), 120000, 're-read at the full price');
  }
});

test('a cleared field sends no quote and re-reads delivery at the full price', async () => {
  const b = browser(await productHtml({ coupon_entry: true }), rsp());
  await b.press();
  await b.coupon('SAVE10');
  assert.deepEqual(reads(b), [120000, 100000]);
  await b.coupon('  ');
  assert.equal(quotes(b).length, 1);
  assert.deepEqual(reads(b), [120000, 100000, 120000]);
  assert.doesNotMatch(b.panel.innerHTML, /<span>折扣<\/span>|dc-ecpay-coupon-err/);
  assert.match(b.panel.innerHTML, /<span>合計<\/span><span>[^<]*1,260[^<]*<\/span>/);
});

test('submit carries coupon_code only when the field is not empty', async () => {
  const html = await productHtml({ coupon_entry: true });
  const withCode = await ready(html, rsp());
  await withCode.coupon(' SAVE10 ');
  await withCode.submit();
  assert.equal(sent(withCode).body.coupon_code, 'SAVE10');
  const empty = await ready(html, rsp());
  await empty.submit();
  assert.equal('coupon_code' in sent(empty).body, false);
  const blank = await ready(html, rsp());
  await blank.coupon('   ');
  await blank.submit();
  assert.equal('coupon_code' in sent(blank).body, false);
});

test('a checkout refusal of the code shows its sentence under the field, re-enables submit and navigates nowhere', async () => {
  const b = await ready(await productHtml({ coupon_entry: true }), rsp({ checkout: () => ({ status: 422, body: { error: 'x', code: 'coupon_unavailable' } }) }));
  await b.coupon('SAVE10');
  await b.submit();
  const h = b.panel.innerHTML;
  assert.match(h, /id="dc-ecpay-coupon-err">這個優惠碼目前不能使用。<\/p>/);
  assert.match(h, /<button class="st-runtime-action st-wide" type="button" data-ecpay-submit>前往付款<\/button>/, 'submit enabled');
  assert.match(h, /data-ecpay-status role="status" class="st-runtime-status"><\/p>/, 'no retry sentence');
  assert.doesNotMatch(h, /<span>折扣<\/span>/, 'figures back to the full price');
  assert.equal(reads(b).at(-1), 120000);
  assert.deepEqual(b.forms, []);
  assert.equal(b.location.assigned, null);
});

test('a discounted cash-on-delivery order: one discounted total row and sentence, and the kept note carries the discount', async () => {
  const b = await ready(await productHtml({ coupon_entry: true }), rsp({ checkout: () => ({ status: 200, body: { order_id: 'order-2', cash_on_delivery: true, state: 'awaiting_collection' } }) }));
  await b.choose('pay', 'cod');
  await b.coupon('SAVE10');
  const h = b.panel.innerHTML;
  assert.match(h, /取貨付款<\/span><span class="st-opt-d">到店取貨時付 [^<]*1,060[^<]*。<\/span>/);
  assert.match(h, /<div class="st-sum"><div class="st-sum-tot"><span>合計<\/span><span>[^<]*1,060[^<]*<\/span><\/div><\/div>/);
  assert.doesNotMatch(h, /<span>小計<\/span>|<span>折扣<\/span>/);
  await b.submit();
  assert.equal(sent(b).body.coupon_code, 'SAVE10');
  const ref = 'tile-0f0e0d0c-0b0a-4908-8706-050403020100';
  assert.deepEqual(JSON.parse(b.store[`dc-native-ecpay:${ref}`]), {
    order_id: 'order-2', sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, currency: 'TWD', invoice: true, cod: true, total_minor: 106000,
    lines: [{ name: 'Tea bowl', qty: 1, amount_minor: 120000 }, { kind: 'discount', qty: 1, amount_minor: -20000 }],
  });
});

test('pressing submit while the quote is in flight sends after it, with the quoted figures kept', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const b = await ready(await productHtml({ coupon_entry: true }), rsp({ quote: async () => { await gate; return { status: 200, body: QUOTE }; }, checkout: () => ({ status: 200, body: { order_id: 'order-5', cash_on_delivery: true } }) }));
  await b.choose('pay', 'cod');
  b.typeCoupon('SAVE10');
  b.panel.listeners.change({ target: { type: 'text', value: 'SAVE10', getAttribute: (n) => (n === 'data-ecpay-field' ? 'coupon' : null) } });
  const pressed = b.submit();
  await b.settle();
  assert.equal(sent(b), undefined, 'the checkout waits for the quote');
  release();
  await pressed; await b.settle(); await b.settle();
  const kept = JSON.parse(b.store['dc-native-ecpay:tile-0f0e0d0c-0b0a-4908-8706-050403020100']);
  assert.equal(kept.total_minor, 106000);
});

test('a quote that fails for another reason shows nothing and does not block submit', async () => {
  const b = await ready(await productHtml({ coupon_entry: true }), rsp({ quote: () => ({ status: 503, body: { error: 'down' } }) }));
  await b.coupon('SAVE10');
  assert.doesNotMatch(b.panel.innerHTML, /dc-ecpay-coupon-err|<span>折扣<\/span>/);
  await b.submit();
  assert.equal(sent(b).body.coupon_code, 'SAVE10');
  assert.equal(b.forms.length, 1, 'the cashier opens');
});

test('a code survives the store-map round trip and is quoted once on return', async () => {
  const mapForm = { action: 'https://logistics-stage.ecpay.com.tw/Express/map', fields: { MerchantID: '2000132' } };
  const html = await productHtml({ coupon_entry: true });
  const b = browser(html, rsp({ storeMap: () => ({ status: 200, body: { ok: true, form_post: mapForm } }) }));
  await b.press();
  b.type('name', 'Lin');
  await b.coupon('SAVE10');
  await b.pickStore();
  assert.deepEqual(b.forms, [mapForm]);
  assert.equal(JSON.parse(b.store['dc-native-ecpay-draft:bowl-sku']).v.coupon, 'SAVE10');

  const back = browser(html, rsp(), { href: 'https://site.example/shop/tea-bowl?store_ref=store-1', session: b.store });
  await back.settle(); await back.settle(); await back.settle();
  assert.equal(quotes(back).length, 1);
  assert.equal(quotes(back)[0].body.coupon_code, 'SAVE10');
  assert.deepEqual(reads(back), [120000, 100000]);
  assert.match(back.panel.innerHTML, /data-ecpay-field="coupon" value="SAVE10"/);
  assert.match(back.panel.innerHTML, /<span>折扣<\/span><span>−[^<]*200[^<]*<\/span>/);
  assert.match(back.panel.innerHTML, /<strong>已選門市<\/strong>/, 'the store stays chosen');
});

test('the field, the 折扣 row and the refusals follow the shell language', async () => {
  const words = {
    'en-US': ['Discount code (optional)', 'Discount', "We couldn't find that discount code."],
    'ja-JP': ['割引コード（任意）', '割引', 'その割引コードは見つかりません。'],
    'zh-TW': ['優惠碼（選填）', '折扣', '找不到這個優惠碼。'],
    'zh-CN': ['优惠码（选填）', '折扣', '找不到这个优惠码。'],
  };
  for (const [locale, [label, row, notFound]] of Object.entries(words)) {
    let answer = { status: 200, body: QUOTE };
    const b = browser(await productHtml({ coupon_entry: true }, SHELLS[locale]), rsp({ quote: () => answer }));
    await b.press();
    assert.ok(b.panel.innerHTML.includes(`for="dc-ecpay-coupon">${label}</label>`), locale);
    await b.coupon('SAVE10');
    assert.ok(b.panel.innerHTML.includes(`<div><span>${row}</span><span>−`), locale);
    answer = { status: 422, body: { error: 'x', code: 'coupon_not_found' } };
    await b.coupon('BAD');
    assert.ok(b.panel.innerHTML.includes(`id="dc-ecpay-coupon-err">${notFound}</p>`), locale);
  }
});

test('a sent code with no quote for it (failed or stale) keeps no figures in the cash-on-delivery note', async () => {
  const html = await productHtml({ coupon_entry: true });
  const placed = () => ({ status: 200, body: { order_id: 'order-6', cash_on_delivery: true, state: 'awaiting_collection' } });
  const ref = 'tile-0f0e0d0c-0b0a-4908-8706-050403020100';
  // The quote failed with a non-422 error.
  const failed = await ready(html, rsp({ quote: () => ({ status: 503, body: null }), checkout: placed }));
  await failed.choose('pay', 'cod');
  await failed.coupon('SAVE10');
  await failed.submit();
  assert.equal(sent(failed).body.coupon_code, 'SAVE10');
  assert.deepEqual(JSON.parse(failed.store[`dc-native-ecpay:${ref}`]), { order_id: 'order-6', sub_type: 'UNIMARTC2C', logistics_type: 'CVS', currency: 'TWD', invoice: true });
  // The quote is for another code than the one sent.
  const stale = await ready(html, rsp({ checkout: placed }));
  await stale.choose('pay', 'cod');
  await stale.coupon('SAVE10');
  stale.typeCoupon('OTHER');
  await stale.submit();
  assert.equal(sent(stale).body.coupon_code, 'OTHER');
  assert.deepEqual(JSON.parse(stale.store[`dc-native-ecpay:${ref}`]), { order_id: 'order-6', sub_type: 'UNIMARTC2C', logistics_type: 'CVS', currency: 'TWD', invoice: true });
});

test('back from the store map with a code, a cash-on-delivery choice the discount allows is kept', async () => {
  // Cash on delivery only up to 1,100: refused at the full price, allowed at the quoted amount.
  const methods = (items) => [{ ...CVS, cod_available: items <= 110000 }];
  const html = await productHtml({ coupon_entry: true });
  const back = browser(html, rsp({ methods }), { href: 'https://site.example/shop/tea-bowl?store_ref=store-1', session: { 'dc-native-ecpay-draft:bowl-sku': JSON.stringify({ ship: CVS.sub_type, pay: 'cod', inv: 'carrier_ecpay', v: { name: 'Lin', phone: '0912345678', email: 'buyer@example.com', coupon: 'SAVE10' } }) } });
  await back.settle(); await back.settle(); await back.settle();
  assert.deepEqual(reads(back), [120000, 100000]);
  assert.match(back.panel.innerHTML, /<input type="radio" name="dc-ecpay-pay" value="cod" checked>/);
  assert.match(back.panel.innerHTML, />送出訂單<\/button>/);
});

test('a quote that throws does not hold the order: submit still sends and the sheet is not left busy', async () => {
  // The delivery re-read after the quote answers a row that throws when read, so the quote rejects.
  const bad = { get sub_type() { throw new Error('unreadable row'); } };
  const methods = (items) => (items === 100000 ? [CVS, bad] : [CVS]);
  const b = await ready(await productHtml({ coupon_entry: true }), rsp({ methods }));
  b.typeCoupon('SAVE10');
  b.panel.listeners.change({ target: { type: 'text', value: 'SAVE10', getAttribute: (n) => (n === 'data-ecpay-field' ? 'coupon' : null) } });
  await b.submit();
  await b.settle(); await b.settle();
  assert.equal(sent(b).body.coupon_code, 'SAVE10', 'the checkout was sent');
  assert.equal(b.forms.length, 1, 'the cashier opens');
});
