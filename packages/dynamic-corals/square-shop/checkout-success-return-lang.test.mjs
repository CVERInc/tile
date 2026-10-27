// The checkout return URL may carry `?lang=<tag>` (the journey's locale). renderCompletion prefers it
// when it names a locale Tile has copy for, and otherwise reads the shell's language exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCompletion } from './shop-function-template.js';

const shell = '<!doctype html><html lang="zh-Hant"><head><title>Shop</title></head><body><main>GRID</main></body></html>';
const env = { ASSETS: { fetch: async () => new Response(shell) } };
const shop = { shopPath: '/shop', source: 'native' };
const route = { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' };

async function page(qs, pathname = '/checkout/success') {
	const req = new Request(`https://shop.example.test${pathname}?order_id=ord-1${qs}`);
	return (await renderCompletion(req, env, { siteId: 'site-key' }, shop, route)).text();
}
const langOf = (html) => (html.match(/<div class="st-runtime" lang="([^"]+)"/) || [])[1];

test('a known ?lang= wins over the shell language', async () => {
	assert.equal(langOf(await page('&lang=zh-CN')), 'zh-CN');
	assert.equal(langOf(await page('&lang=ja-JP')), 'ja-JP');
	assert.equal(langOf(await page('&lang=en-US')), 'en-US');
});

test('no ?lang= keeps the shell language (unchanged behavior)', async () => {
	assert.equal(langOf(await page('')), 'zh-TW');
});

test('an unknown, malformed or oversized ?lang= falls back to the shell language', async () => {
	for (const bad of ['fr-FR', 'xx', '', '<script>', 'zh-CN%22%3E', 'zh-CN-aaaaaaaaaaaaaaaaaaaa', 'zh%20CN']) {
		assert.equal(langOf(await page(`&lang=${bad}`)), 'zh-TW', bad);
	}
});

test('a locale path keeps its own locale over ?lang=', async () => {
	const req = new Request('https://shop.example.test/ja/shop/complete?ref=r1&lang=zh-CN');
	const html = await (await renderCompletion(req, env, { siteId: 'site-key' }, { shopPath: '/shop' })).text();
	assert.equal(langOf(html), 'ja-JP');
});
