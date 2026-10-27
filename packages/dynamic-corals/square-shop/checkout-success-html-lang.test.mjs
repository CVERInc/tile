// The completion page's <html lang> declares the language of the copy it rendered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCompletion } from './shop-function-template.js';

const shop = { shopPath: '/shop', source: 'native' };
const route = { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' };

async function page(shell, qs) {
	const env = { ASSETS: { fetch: async () => new Response(shell) } };
	const req = new Request(`https://shop.example.test/checkout/success?order_id=ord-1${qs}`);
	return (await renderCompletion(req, env, { siteId: 'site-key' }, shop, route)).text();
}
const htmlLang = (html) => (html.match(/<html\b[^>]*\blang="([^"]*)"/i) || [])[1];
const runtimeLang = (html) => (html.match(/<div class="st-runtime" lang="([^"]+)"/) || [])[1];
const hant = '<!doctype html><html lang="zh-Hant" data-x="1"><head><title>Shop</title></head><body><main>GRID</main></body></html>';

test('?lang=zh-CN rewrites the shell <html lang> to the rendered locale', async () => {
	const html = await page(hant, '&lang=zh-CN');
	assert.equal(runtimeLang(html), 'zh-CN');
	assert.equal(htmlLang(html), 'zh-CN');
	assert.match(html, /<html lang="zh-CN" data-x="1">/);
});

test('no hint: the shell language already maps to the rendered locale and is untouched', async () => {
	const html = await page(hant, '');
	assert.equal(runtimeLang(html), 'zh-TW');
	assert.equal(htmlLang(html), 'zh-Hant');
});

test('a shell with no lang attribute gets one for the rendered locale', async () => {
	const bare = '<!doctype html><html><head><title>Shop</title></head><body><main>GRID</main></body></html>';
	assert.equal(htmlLang(await page(bare, '&lang=ja-JP')), 'ja-JP');
});
