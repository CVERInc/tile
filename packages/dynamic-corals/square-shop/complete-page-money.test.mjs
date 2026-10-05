import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCompletion } from './shop-function-template.js';
import { formatMoney } from './product-page-core.js';

// The emitted worker has the render core prepended; stand in for that here.
globalThis.formatMoney = formatMoney;

// Runs the emitted completion script against one paid outcome and returns the buyer-visible body.
async function paidBody(lang, outcome) {
	const env = { ASSETS: { fetch: async () => new Response(`<!doctype html><html lang="${lang}"><head><title>Shop</title></head><body><main>GRID</main></body></html>`) } };
	const html = await (await renderCompletion(new Request('https://shop.example/shop/complete?ref=ref-9'), env, { siteId: 'site-key' }, { shopPath: '/shop', lang })).text();
	const script = html.match(/<script>(\(function\(\)\{const C=[\s\S]*?)<\/script>/)[1];
	const nodes = { 'dc-shop-outcome': { innerHTML: '' }, 'dc-shop-heading': { textContent: '' } };
	const doc = { title: '', getElementById: (id) => nodes[id], createElement: () => ({ set textContent(v) { this._t = v; }, get innerHTML() { return String(this._t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }) };
	const store = {};
	const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
	const fetchFn = async () => ({ ok: true, json: async () => ({ ok: true, state: 'paid', order_ref: 'ord-1', ...outcome }) });
	new Function('document', 'fetch', 'localStorage', 'window', 'CustomEvent', 'setTimeout', script)(doc, fetchFn, localStorage, { dispatchEvent() {} }, class { }, () => {});
	await new Promise((r) => setImmediate(r));
	return nodes['dc-shop-outcome'].innerHTML;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

test('a TWD order on a zh-TW page names the currency like the product page', async () => {
	const body = decode(await paidBody('zh-TW', { total_minor: 30000, currency: 'TWD', lines: [{ name: 'Tee', qty: 1, amount_minor: 30000 }] }));
	const expected = formatMoney({ minor: 30000, currency: 'TWD', locale: 'zh-TW' });
	assert.match(expected, /TWD|NT\$/);
	assert.ok(body.includes(`: ${expected}</p>`), body);
	assert.ok(body.includes(`— ${expected}</li>`), body);
	assert.doesNotMatch(body, /(^|[^A-Za-z$])\$300\.00/);
});

test('a JPY order on a ja-JP page is not divided by 100', async () => {
	const body = decode(await paidBody('ja-JP', { total_minor: 1200, currency: 'JPY', lines: [] }));
	const expected = formatMoney({ minor: 1200, currency: 'JPY', locale: 'ja-JP' });
	assert.match(expected, /¥1,200/);
	assert.ok(body.includes(expected), body);
	assert.doesNotMatch(body, /¥12(?![,\d])/);
});

test('a USD order on an en-US page matches the product page formatting', async () => {
	const body = decode(await paidBody('en-US', { total_minor: 3800, currency: 'USD', lines: [] }));
	assert.ok(body.includes(formatMoney({ minor: 3800, currency: 'USD', locale: 'en-US' })), body);
});

test('an invalid currency code falls back instead of breaking the page', async () => {
	const body = decode(await paidBody('en-US', { total_minor: 500, currency: 'not-a-code', lines: [] }));
	assert.ok(body.includes('500 NOT-A-CODE'), body);
});
