import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The optional coupon field: shown only when the native projection says `coupon_entry === true`
// and Buy can go through the cart door (on a shipping product's page it folds away when the in-page
// ECPay sheet opens, which has its own field). At Buy a non-empty code is
// applied (POST /api/cart/coupon), an empty field clears (DELETE); a 422 is named by its `code`,
// stops before checkout and leaves Buy enabled. Without the flag the page is today's.

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-coupon-field-'));
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
const TEXT = {
  'en-US': { label: 'Discount code (optional)', notFound: "We couldn't find that discount code.", unavailable: "This discount code can't be used right now.", expired: 'This discount code has expired.', generic: "This discount code can't be used." },
  'ja-JP': { label: '割引コード（任意）', notFound: 'その割引コードは見つかりません。', unavailable: 'この割引コードは現在ご利用いただけません。', expired: 'この割引コードは有効期限が切れています。', generic: 'この割引コードはご利用いただけません。' },
  'zh-TW': { label: '優惠碼（選填）', notFound: '找不到這個優惠碼。', unavailable: '這個優惠碼目前不能使用。', expired: '這個優惠碼已過期。', generic: '這個優惠碼無法使用。' },
  'zh-CN': { label: '优惠码（选填）', notFound: '找不到这个优惠码。', unavailable: '这个优惠码目前不能使用。', expired: '这个优惠码已过期。', generic: '这个优惠码无法使用。' },
};
const item = (commerce = {}, shipping = false) => ({
  slug: 'tee',
  copy: { name: 'Tee', description_html: '<p>Copy</p>', media: [], requires_shipping: shipping },
  commerce: { sku: 'tee-sku', product_id: 'p1', variant_id: 'v1', currency: 'USD', unit_price: 1900, tracked: false, status: 'IN_STOCK', ...commerce },
});

let built = 0;
async function emit(pathname, body, shell = SHELLS['en-US']) {
  const out = path.join(temp, `shop-${built++}.mjs`);
  execFileSync('node', [emitter, '--api-contract', contract, '--site-id', 'site-coupon', '--storefronts', JSON.stringify([{ path: '/shop', source: 'native' }]), '--api', 'https://api.example', '--out', out], { stdio: 'pipe' });
  const mod = await import(`${pathToFileURL(out).href}?${Date.now()}`);
  const response = await mod.default.fetch(new Request(`https://site.example${pathname}`), {
    ASSETS: { fetch: async () => new Response(shell) },
    RSP: { fetch: async () => Response.json({ ok: true, source: 'native', ...body }) },
  });
  return response.text();
}
const page = (extra = {}, it = item(), shell) => emit('/shop/tee', { item: it, ...extra }, shell);
const hasField = (html) => /data-native-coupon-field/.test(html);

test('the field is absent unless coupon_entry is exactly true', async () => {
  for (const v of [undefined, false, 'true', 1, null]) assert.equal(hasField(await page(v === undefined ? {} : { coupon_entry: v })), false, String(v));
  const html = await page({ coupon_entry: true });
  assert.equal(hasField(html), true);
  assert.match(html, /<div class="st-native-actions"><div data-native-coupon><label><span>Discount code \(optional\)<\/span><input type="text" autocomplete="off" aria-label="Discount code \(optional\)" data-native-coupon-field><\/label><\/div><button type="button" class="dc-native-buy" data-native-sku="tee-sku">/);
});

test('without coupon_entry the page carries no coupon code at all', async () => {
  const html = await page({});
  assert.doesNotMatch(html, /cart\/coupon|couponMsg|cNotFound|data-native-coupon/);
});

test('the field is absent on sold-out items and the grid', async () => {
  assert.equal(hasField(await page({ coupon_entry: true }, item({ status: 'OUT_OF_STOCK' }))), false);
  assert.equal(hasField(await emit('/shop', { items: [item()], coupon_entry: true })), false);
});

// A product that ships (the in-page ECPay branch) also has the cart door: a non-ECPay payment
// method and a Site whose ECPay answers no delivery method both press it. commerce.model offers the
// coupon on every native checkout door, so the field sits above Buy there too, folded away with
// the rest when the ECPay sheet opens (the sheet then has its own field).
const bowl = item({ currency: 'TWD', unit_price: 120000, tracked: true, available: 3, reserved: 0 }, true);
test('a shipping product offers the field above Buy, folded with the sheet, only with coupon_entry', async () => {
  for (const extra of [{}, { checkout_rails: ['stripe', 'ecpay'] }]) {
    const html = await page({ coupon_entry: true, ...extra }, bowl);
    assert.match(html, /data-native-ecpay-sku/);
    assert.match(html, /<div data-native-coupon data-native-ecpay-collapse><label><span>Discount code \(optional\)<\/span><input type="text" autocomplete="off" aria-label="Discount code \(optional\)" data-native-coupon-field><\/label><\/div><button type="button" class="dc-native-buy" data-native-ecpay-sku="tee-sku">/);
    assert.match(html, /cart\/coupon/);
    const without = await page(extra, bowl);
    assert.match(without, /data-native-ecpay-sku/);
    assert.doesNotMatch(without, /<div data-native-coupon|cart\/coupon|couponMsg/);
  }
});

function drive(html, couponAnswer, { value = '', lang = '' } = {}) {
  // The cart door's script: the first one that presses `data-native-sku` (a shipping product's page
  // also carries the ECPay sheet's script after it).
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((m) => m[1].includes('data-native-sku'));
  assert.ok(script);
  let click;
  const document = { documentElement: { lang }, addEventListener(t, h) { if (t === 'click') click = h; } };
  const status = { textContent: '', attrs: {}, setAttribute(n, v) { this.attrs[n] = v; }, removeAttribute(n) { delete this.attrs[n]; } };
  const field = { value };
  const parent = {
    querySelector: (sel) => (sel === '[data-native-status]' ? status : sel === '[data-native-coupon-field]' ? field : null),
    querySelectorAll: () => [],
  };
  const button = { disabled: false, textContent: 'Buy', parentElement: parent, setAttribute() {}, removeAttribute() {}, getAttribute: (n) => (n === 'data-native-sku' ? 'tee-sku' : null) };
  const calls = [];
  const redirects = [];
  new Function('document', 'fetch', 'window', script[1])(
    document,
    async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body });
      if (url === '/api/cart') return Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] });
      if (url === '/api/cart/coupon') return couponAnswer();
      return Response.json({ redirect_url: 'https://pay.example/s' });
    },
    { location: { assign: (u) => redirects.push(u) } },
  );
  return { button, status, calls, redirects, field, click: () => click({ target: { closest: () => button } }) };
}
const order = (ui) => ui.calls.map((c) => `${c.method} ${c.url}`);

test('a non-empty code is applied before checkout', async () => {
  const ui = drive(await page({ coupon_entry: true }), () => Response.json({ ok: true }), { value: '  SAVE10 ' });
  await ui.click();
  assert.deepEqual(order(ui), ['GET /api/cart', 'POST /api/cart/coupon', 'POST /api/checkout']);
  assert.equal(ui.calls[1].body, JSON.stringify({ code: 'SAVE10' }));
  assert.deepEqual(ui.redirects, ['https://pay.example/s']);
});

test('on a shipping product the cart door applies the code before checkout', async () => {
  const ui = drive(await page({ coupon_entry: true, checkout_rails: ['stripe', 'ecpay'] }, bowl), () => Response.json({ ok: true }), { value: 'SAVE10' });
  await ui.click();
  assert.deepEqual(order(ui), ['GET /api/cart', 'POST /api/cart/coupon', 'POST /api/checkout']);
  assert.equal(ui.calls[1].body, JSON.stringify({ code: 'SAVE10' }));
  assert.deepEqual(ui.redirects, ['https://pay.example/s']);
});

test('an empty field clears any earlier code before checkout', async () => {
  const ui = drive(await page({ coupon_entry: true }), () => Response.json({ ok: true }), { value: '   ' });
  await ui.click();
  assert.deepEqual(order(ui), ['GET /api/cart', 'DELETE /api/cart/coupon', 'POST /api/checkout']);
});

for (const locale of Object.keys(TEXT)) {
  test(`each 422 code shows its sentence with error tone, skips checkout and leaves Buy enabled in ${locale}`, async () => {
    const t = TEXT[locale];
    const html = await page({ coupon_entry: true }, item(), SHELLS[locale]);
    assert.ok(html.includes(`data-native-coupon-field`) && html.includes(`<span>${t.label}</span>`));
    for (const [body, sentence] of [
      [{ error: 'x', code: 'coupon_not_found' }, t.notFound],
      [{ error: 'x', code: 'coupon_unavailable' }, t.unavailable],
      [{ error: 'x', code: 'coupon_expired' }, t.expired],
      [{ error: 'x', code: 'code_required' }, t.generic],
      [{ error: 'x', code: 'something_new' }, t.generic],
      [{ error: 'x' }, t.generic],
    ]) {
      const ui = drive(html, () => Response.json(body, { status: 422 }), { value: 'BAD' });
      await ui.click();
      assert.equal(ui.status.textContent, sentence, JSON.stringify(body));
      assert.equal(ui.status.attrs['data-ejecta-status-tone'], 'error');
      assert.equal(ui.button.disabled, false);
      assert.ok(!order(ui).includes('POST /api/checkout'), 'checkout is not reached');
    }
  });
}

test('coupon_min_spend names the amount formatted with the cart currency', async () => {
  const ui = drive(await page({ coupon_entry: true }), () => Response.json({ error: 'x', code: 'coupon_min_spend', min_spend_minor: 5000, currency: 'USD' }, { status: 422 }), { value: 'BIG' });
  await ui.click();
  assert.match(ui.status.textContent, /^This discount code needs a minimum spend of USD\s50\.00\.$/);
  const tw = drive(await page({ coupon_entry: true }, item({ currency: 'TWD' }), SHELLS['zh-TW']), () => Response.json({ error: 'x', code: 'coupon_min_spend', min_spend_minor: 80000, currency: 'TWD' }, { status: 422 }), { value: 'BIG' });
  await tw.click();
  assert.match(tw.status.textContent, /^這個優惠碼需要消費滿 .*800.* 才能使用。$/);
  assert.doesNotMatch(tw.status.textContent, /\{amount\}/);
});

test('a non-422 coupon failure is the generic checkout failure and checkout is not reached', async () => {
  const ui = drive(await page({ coupon_entry: true }), () => new Response('x', { status: 500 }), { value: 'SAVE10' });
  await ui.click();
  assert.equal(ui.status.textContent, 'Unable to start checkout. Please try again.');
  assert.equal(ui.button.disabled, false);
  assert.ok(!order(ui).includes('POST /api/checkout'));
});
