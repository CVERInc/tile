import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A native Buy press whose checkout the server refuses for want of a guest email: the buyer is asked
// for one beside the control, and the next press retries ONLY the checkout, now carrying it.

const here = path.dirname(fileURLToPath(import.meta.url));
const emitter = path.join(here, 'emit-shop-function.mjs');
const temp = mkdtempSync(path.join(os.tmpdir(), 'native-checkout-email-'));
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
  const el = {
    tag, attrs: {}, children: [], value: '', disabled: false, textContent: '', parentElement: null, listeners: {},
    setAttribute(n, v) { this.attrs[n] = String(v); },
    removeAttribute(n) { delete this.attrs[n]; },
    getAttribute(n) { return this.attrs[n] ?? null; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    addEventListener(t, h) { this.listeners[t] = h; },
    focus() { this.focused = true; },
  };
  return el;
}
function findField(node) {
  for (const c of node.children) {
    if ('data-native-email-field' in c.attrs) return c;
    const deep = findField(c);
    if (deep) return deep;
  }
  return null;
}

function drive(html, respond, { lang = '' } = {}) {
  const script = html.match(/<script>([\s\S]*data-native-sku[\s\S]*?)<\/script>/);
  assert.ok(script);
  let click;
  const document = { documentElement: { lang }, createElement: makeElement, addEventListener(t, h) { if (t === 'click') click = h; } };
  const status = makeElement('p');
  const parent = makeElement('div');
  parent.querySelector = (sel) => (sel === '[data-native-status]' ? status : sel === '[data-native-email-field]' ? findField(parent) : null);
  parent.insertBefore = (node, ref) => { node.parentElement = parent; parent.children.splice(parent.children.indexOf(ref), 0, node); };
  const button = makeElement('button');
  button.textContent = 'Buy now';
  button.ownerDocument = document;
  button.clicks = 0;
  button.click = () => { button.clicks += 1; };
  button.getAttribute = (n) => (n === 'data-native-sku' ? 'tee-sku' : button.attrs[n] ?? null);
  parent.children.push(button);
  button.parentElement = parent;
  const calls = [];
  const redirects = [];
  const body = makeElement('body');
  document.body = body;
  document.forms = [];
  document.createElement = (tag) => {
    const el = makeElement(tag);
    if (tag === 'form') { el.submit = function submit() { document.forms.push({ method: this.method, action: this.action, fields: Object.fromEntries(this.children.map((c) => [c.name, c.value])), types: this.children.map((c) => c.type), attached: body.children.includes(this) }); }; el.remove = function remove() { body.children.splice(body.children.indexOf(this), 1); }; }
    return el;
  };
  new Function('document', 'fetch', 'window', script[1])(
    document,
    async (url, init) => { if (url === '/api/cart') return Response.json({ lines: [] }); calls.push({ url, init }); return respond(url, init, calls); },
    { location: { assign(u) { redirects.push(u); } } },
  );
  return {
    button, status, calls, redirects, document, body, field: () => findField(parent),
    click: () => click({ target: { closest: (s) => (s === '[data-native-sku]' ? button : null) } }),
    count: (p) => calls.filter((c) => c.url === p).length,
    lastCheckoutBody: () => JSON.parse(calls.filter((c) => c.url === '/api/checkout').at(-1).init.body),
  };
}

const cartOk = () => Response.json({ lines: [{ sku: 'tee-sku', qty: 1 }] });
const refuse = (code, status = 422) => async (url) => (url === '/api/cart/items' ? cartOk() : Response.json({ error: code }, { status }));

test('customer_email_required asks for an email, and the retry skips the cart add and carries the email', async () => {
  const html = await nativeHtml('required', SHELLS['en-US']);
  let accept = false;
  const ui = drive(html, async (url, init) => {
    if (url === '/api/cart/items') return cartOk();
    return accept ? Response.json({ redirect_url: 'https://pay.example/session' }) : Response.json({ error: 'customer_email_required' }, { status: 422 });
  }, { lang: 'en-US' });

  await ui.click();
  const field = ui.field();
  assert.ok(field, 'an email field appears where the buyer pressed Buy');
  assert.equal(field.attrs.type, 'email');
  assert.equal(field.attrs.autocomplete, 'email');
  assert.ok('required' in field.attrs);
  assert.equal(field.attrs['aria-invalid'], 'true');
  assert.ok(field.attrs['aria-label']);
  assert.equal(ui.status.textContent, 'Enter your email address to continue to payment.');
  assert.equal(ui.status.attrs['data-ejecta-status-tone'], 'error');
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.button.textContent, 'Buy now');
  assert.deepEqual(ui.calls.map((c) => c.url), ['/api/cart/items', '/api/checkout']);

  field.value = '  buyer@example.test ';
  accept = true;
  await ui.click();
  assert.equal(ui.count('/api/cart/items'), 1, 'the item is not added a second time');
  assert.equal(ui.count('/api/checkout'), 2);
  assert.deepEqual(ui.lastCheckoutBody(), { lang: 'en-US', customer_email: 'buyer@example.test' });
  assert.deepEqual(ui.redirects, ['https://pay.example/session']);
});

test('customer_email_invalid and customer_email_conflict show their own messages and keep retrying checkout only', async () => {
  const html = await nativeHtml('invalid-conflict', SHELLS['en-US']);
  const cases = {
    customer_email_invalid: 'Please enter a valid email address.',
    customer_email_conflict: 'This order is already linked to a different email address. Please enter the same address as before.',
  };
  for (const [code, message] of Object.entries(cases)) {
    const ui = drive(html, refuse(code), { lang: 'en-US' });
    await ui.click();
    assert.equal(ui.status.textContent, message, code);
    assert.ok(ui.field(), code);
    assert.equal(ui.field().attrs['aria-invalid'], 'true', code);
    ui.field().value = 'buyer@example.test';
    await ui.click();
    assert.equal(ui.count('/api/cart/items'), 1, code + ': no second add');
    assert.equal(ui.count('/api/checkout'), 2, code);
    assert.equal(ui.status.textContent, message, code);
    assert.equal(ui.lastCheckoutBody().customer_email, 'buyer@example.test', code);
  }
});

test('the email messages follow the shell language', async () => {
  const expected = {
    'zh-TW': '請輸入電子郵件地址以繼續付款。',
    'ja-JP': 'お支払いに進むには、メールアドレスを入力してください。',
    'zh-CN': '请输入电子邮箱地址以继续付款。',
  };
  for (const [locale, message] of Object.entries(expected)) {
    const ui = drive(await nativeHtml('loc-' + locale, SHELLS[locale]), refuse('customer_email_required'));
    await ui.click();
    assert.equal(ui.status.textContent, message, locale);
  }
});

test('any other refusal keeps the generic failure, shows no email field and re-adds as before', async () => {
  const html = await nativeHtml('other', SHELLS['en-US']);
  const ui = drive(html, refuse('cart_empty', 409), { lang: 'en-US' });
  await ui.click();
  assert.equal(ui.status.textContent, 'Unable to start checkout. Please try again.');
  assert.equal(ui.field(), null);
  await ui.click();
  assert.equal(ui.count('/api/cart/items'), 2, 'without an email refusal every press behaves as it did');
  assert.deepEqual(ui.lastCheckoutBody(), { lang: 'en-US' });
});

test('a checkout that needs no email posts exactly the body it always posted', async () => {
  const html = await nativeHtml('success', SHELLS['en-US']);
  const ok = async (url) => (url === '/api/cart/items' ? cartOk() : Response.json({ redirect_url: 'https://pay.example/ok' }));
  const withLang = drive(html, ok, { lang: 'en-US' });
  await withLang.click();
  assert.equal(withLang.calls[1].init.body, JSON.stringify({ lang: 'en-US' }));
  assert.equal(withLang.field(), null);
  assert.deepEqual(withLang.redirects, ['https://pay.example/ok']);

  const noLang = drive(html, ok);
  await noLang.click();
  assert.equal(noLang.calls[1].init.body, undefined);
});

const cashier = { action: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5', fields: { MerchantID: '3002607', MerchantTradeNo: 'T123', CheckMacValue: 'ABC' } };
const withCheckout = (payload, status = 200) => async (url) => (url === '/api/cart/items' ? cartOk() : Response.json(payload, { status }));

test('a form_post checkout response submits a one-time POST form with exactly those fields', async () => {
  const html = await nativeHtml('form-post', SHELLS['en-US']);
  const ui = drive(html, withCheckout({ attempt_id: 'a', form_post: cashier }), { lang: 'en-US' });
  await ui.click();
  assert.equal(ui.document.forms.length, 1);
  const [sent] = ui.document.forms;
  assert.equal(sent.method, 'POST');
  assert.equal(sent.action, cashier.action);
  assert.deepEqual(sent.fields, cashier.fields);
  assert.deepEqual(sent.types, ['hidden', 'hidden', 'hidden']);
  assert.equal(sent.attached, true, 'the form is in the page while it submits');
  assert.equal(ui.body.children.length, 0, 'and removed right after');
  assert.deepEqual(ui.redirects, []);
  assert.equal(ui.status.textContent, '');
});

test('form_post wins when a response carries both shapes', async () => {
  const html = await nativeHtml('form-post-wins', SHELLS['en-US']);
  const ui = drive(html, withCheckout({ redirect_url: 'https://pay.example/x', form_post: cashier }));
  await ui.click();
  assert.equal(ui.document.forms.length, 1);
  assert.deepEqual(ui.redirects, []);
});

test('a redirect_url response still navigates with location.assign', async () => {
  const html = await nativeHtml('redirect-only', SHELLS['en-US']);
  const ui = drive(html, withCheckout({ redirect_url: 'https://pay.example/session' }));
  await ui.click();
  assert.deepEqual(ui.redirects, ['https://pay.example/session']);
  assert.equal(ui.document.forms.length, 0);
});

test('neither shape, or an invalid form_post, is the generic failure and submits nothing', async () => {
  const html = await nativeHtml('no-launch', SHELLS['en-US']);
  const bad = {
    'neither shape': { ok: true },
    'http action': { form_post: { ...cashier, action: 'http://payment-stage.ecpay.com.tw/x' } },
    'non-allowlisted https host': { form_post: { ...cashier, action: 'https://cashier.example.com/Cashier/AioCheckOut/V5' } },
    'lookalike host': { form_post: { ...cashier, action: 'https://payment.ecpay.com.tw.example.com/x' } },
    'javascript action': { form_post: { ...cashier, action: 'javascript:alert(1)' } },
    'relative action': { form_post: { ...cashier, action: '/Cashier' } },
    'non-string field': { form_post: { ...cashier, fields: { A: 1 } } },
    'nested field': { form_post: { ...cashier, fields: { A: { b: 'c' } } } },
    'no fields': { form_post: { ...cashier, fields: {} } },
    'shadowing field name': { form_post: { ...cashier, fields: { submit: 'x' } } },
  };
  for (const [name, payload] of Object.entries(bad)) {
    const ui = drive(html, withCheckout(payload));
    await ui.click();
    assert.equal(ui.status.textContent, 'Unable to start checkout. Please try again.', name);
    assert.equal(ui.document.forms.length, 0, name);
    assert.deepEqual(ui.redirects, [], name);
    assert.equal(ui.button.disabled, false, name);
  }
});

test('the production cashier host is accepted as well as the stage host', async () => {
  const html = await nativeHtml('prod-host', SHELLS['en-US']);
  const ui = drive(html, withCheckout({ form_post: { ...cashier, action: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5' } }));
  await ui.click();
  assert.equal(ui.document.forms.length, 1);
});

test('Enter in the email field presses Buy', async () => {
  const ui = drive(await nativeHtml('enter-key', SHELLS['en-US']), refuse('customer_email_required'));
  await ui.click();
  let prevented = 0;
  ui.field().listeners.keydown({ key: 'a', preventDefault() { prevented += 1; } });
  assert.equal(ui.button.clicks, 0, 'other keys do nothing');
  ui.field().listeners.keydown({ key: 'Enter', preventDefault() { prevented += 1; } });
  assert.equal(ui.button.clicks, 1);
  assert.equal(prevented, 1);
});

test('a retry that fails with a non-email error keeps the field and still skips the cart add', async () => {
  const html = await nativeHtml('retry-other-error', SHELLS['en-US']);
  let mode = 'email';
  const ui = drive(html, async (url) => {
    if (url === '/api/cart/items') return cartOk();
    return mode === 'email' ? Response.json({ error: 'customer_email_required' }, { status: 422 }) : Response.json({ error: 'internal' }, { status: 500 });
  }, { lang: 'en-US' });
  await ui.click();
  const field = ui.field();
  field.value = 'buyer@example.test';
  mode = 'other';
  await ui.click();
  assert.equal(ui.status.textContent, 'Unable to start checkout. Please try again.');
  assert.equal(ui.field(), field, 'the field stays');
  assert.equal(field.disabled, false);
  assert.equal(ui.button.disabled, false);
  await ui.click();
  assert.equal(ui.count('/api/cart/items'), 1, 'the item is still never re-added');
  assert.equal(ui.count('/api/checkout'), 3);
  assert.equal(ui.lastCheckoutBody().customer_email, 'buyer@example.test');
});
