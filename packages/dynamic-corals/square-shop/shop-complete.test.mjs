import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPLETE_COPY, completionLocale, matchNativeCheckoutSuccess, matchShopComplete, renderCompletion, shouldClearCartForOutcome } from './shop-function-template.js';
import { consumeCheckoutReturn } from './square-shop.js';

const shops = [
	{ shopPath: '/shop', lang: 'ja-JP', headline: 'ご注文ありがとうございます' },
	{ shopPath: '/zh-tw/shop', lang: 'zh-TW', headline: '感謝您的訂購' },
	{ shopPath: '/en/shop', lang: 'en-US', headline: 'Thank you for your order' }
];

test('completion matcher accepts every locale shop path, with optional slash', () => {
	for (const shop of shops) {
		assert.equal(matchShopComplete(shop.shopPath + '/complete', shops)?.shopPath, shop.shopPath);
		assert.equal(matchShopComplete(shop.shopPath + '/complete/', shops)?.shopPath, shop.shopPath);
	}
	assert.equal(matchShopComplete('/shop/item', shops), null);
	assert.equal(matchShopComplete('/xx-yy-zz/shop/complete', shops), null);
	assert.equal(matchShopComplete('/shopx/complete', shops), null);
});

test('unconfigured locale completion uses the default shop config and path locale', async () => {
	const configured = shops.slice(0, 2);
	const matched = matchShopComplete('/en-us/shop/complete', configured);
	assert.equal(matched.shopPath, '/shop');
	const fetched = [];
	const env = { ASSETS: { fetch: async request => {
		fetched.push(new URL(request.url).pathname);
		return new Response('<!doctype html><html lang="ja-JP"><head><title>Shop</title></head><body><main>GRID</main></body></html>');
	} } };
	const res = await renderCompletion(new Request('https://shop.example/en-us/shop/complete?ref=ref-123'), env, { siteId: 'site-key' }, matched);
	const html = await res.text();
	assert.deepEqual(fetched, ['/en-us/shop/']);
	assert.match(html, /Thank you for your order/);
	assert.match(html, /href=\"'\+esc\(C\.shopPath\)\+'\"/);
	assert.match(html, /"shopPath":"\/en-us\/shop"/);
	assert.ok(html.includes('/api/v2/shop/checkout/outcome?site=site-key&amp;ref=ref-123') || html.includes('/api/v2/shop/checkout/outcome?site=site-key&ref=ref-123'));
});

test('unconfigured locale completion falls back to the default shop path when its own locale shell 404s', async () => {
	const configured = shops.slice(0, 1); // only /shop configured — matches a JP seller, where ja is the default locale served bare at /shop
	const matched = matchShopComplete('/ja/shop/complete', configured);
	assert.equal(matched.shopPath, '/shop');
	assert.equal(matched.completionShopPath, '/ja/shop');
	const fetched = [];
	const env = { ASSETS: { fetch: async request => {
		const pathname = new URL(request.url).pathname;
		fetched.push(pathname);
		if (pathname === '/ja/shop/') return new Response('not found', { status: 404 });
		return new Response('<!doctype html><html lang="ja-JP"><head><title>Shop</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>');
	} } };
	const res = await renderCompletion(new Request('https://shop.example/ja/shop/complete?ref=ref-123'), env, { siteId: 'site-key' }, matched);
	const html = await res.text();
	assert.deepEqual(fetched, ['/ja/shop/', '/shop/']);
	assert.ok(html.includes('NAV') && html.includes('FOOT'), 'falls back to the default shop shell instead of the bare page');
	assert.match(html, /ご注文ありがとうございます|お支払いを確認しています/);
});

test('locale completion with no working shell anywhere still renders the bare fallback', async () => {
	const configured = shops.slice(0, 1);
	const matched = matchShopComplete('/ja/shop/complete', configured);
	const env = { ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
	const res = await renderCompletion(new Request('https://shop.example/ja/shop/complete?ref=ref-123'), env, { siteId: 'site-key' }, matched);
	const html = await res.text();
	assert.match(html, /<h1 id="dc-shop-heading">/);
});

test('configured locale completion keeps its configured shop', () => {
	assert.equal(matchShopComplete('/zh-tw/shop/complete', shops.slice(0, 2)), shops[1]);
});

test('native checkout success selects only a resolved native storefront, preferring /shop', () => {
	const request = new Request('https://shop.example/checkout/success?order_id=ord-1');
	const route = { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' };
	const mixed = [
		{ shopPath: '/provider-shop', source: 'provider' },
		{ shopPath: '/native-shop', source: 'native' },
		{ shopPath: '/shop', source: 'native' }
	];
	assert.equal(matchNativeCheckoutSuccess(request, mixed, route), mixed[2]);
	assert.equal(matchNativeCheckoutSuccess(request, mixed.slice(0, 2), route), mixed[1]);
	assert.equal(matchNativeCheckoutSuccess(request, [
		{ shopPath: '/first-native', source: 'native' },
		{ shopPath: '/much-longer-second-native', source: 'native' }
	], route)?.shopPath, '/first-native');
	assert.equal(matchNativeCheckoutSuccess(request, [mixed[0]], route), null);
	assert.equal(matchNativeCheckoutSuccess(request, mixed, null), null);
	assert.equal(matchNativeCheckoutSuccess(new Request('https://shop.example/checkout/success'), mixed, route), null);
	assert.equal(matchNativeCheckoutSuccess(new Request('https://shop.example/checkout/success?order_id=ord-1', { method: 'POST' }), mixed, route), null);
});

test('native checkout success reuses its localized site shell and maps order_id to the existing outcome ref', async () => {
	const shop = { shopPath: '/native-shop', source: 'native' };
	const fetched = [];
	const shell = '<!doctype html><html lang="zh-TW" data-theme="reef"><head><title>商店</title></head><body><header>站台導覽</header><main><div data-dynamic-coral="square-shop" data-complete-pending="正在核對訂單"></div></main><footer>站台頁尾</footer></body></html>';
	const env = { ASSETS: { fetch: async request => { fetched.push(new URL(request.url).pathname); return new Response(shell); } } };
	const route = { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' };
	const html = await (await renderCompletion(new Request('https://shop.example/checkout/success?order_id=ord%2F1'), env, { siteId: 'site-key' }, shop, route)).text();
	assert.deepEqual(fetched, ['/native-shop/']);
	assert.match(html, /data-theme="reef"/);
	assert.match(html, /站台導覽/);
	assert.match(html, /站台頁尾/);
	assert.match(html, /正在核對訂單/);
	assert.ok(html.includes('/api/v2/shop/checkout/outcome?site=site-key&amp;ref=ord%2F1') || html.includes('/api/v2/shop/checkout/outcome?site=site-key&ref=ord%2F1'));
	assert.doesNotMatch(html, /[?&]order_id=/);
});

test('native checkout success fails closed when its site shell is unavailable', async () => {
	const shop = { shopPath: '/native-shop', source: 'native' };
	const route = { path: '/checkout/success', method: 'GET', orderParam: 'order_id', outcomePath: '/api/v2/shop/checkout/outcome' };
	const fetched = [];
	let providerCalls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { providerCalls++; throw new Error('provider fallback is forbidden'); };
	try {
		const env = { ASSETS: { fetch: async request => {
			fetched.push(new URL(request.url).pathname);
			return new Response('not found', { status: 404 });
		} } };
		const response = await renderCompletion(new Request('https://shop.example/checkout/success?order_id=ord-1'), env, { siteId: 'site-key' }, shop, route);
		const body = await response.text();
		assert.notEqual(response.status, 200);
		assert.equal(response.status, 503);
		assert.equal(response.headers.get('cache-control'), 'private, no-store');
		assert.deepEqual(fetched, ['/native-shop/']);
		assert.equal(providerCalls, 0);
		assert.doesNotMatch(body, /<!doctype|<html|<title>|We couldn't find this order/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('provider completion bytes ignore a native order_id query and keep ref behavior unchanged', async () => {
	const shell = '<!doctype html><html lang="en-US"><head><title>Shop</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>';
	const env = { ASSETS: { fetch: async () => new Response(shell) } };
	const baseline = await (await renderCompletion(new Request('https://shop.example/shop/complete?ref=provider-ref'), env, { siteId: 'site-key' }, shops[0])).text();
	const withOrderId = await (await renderCompletion(new Request('https://shop.example/shop/complete?ref=provider-ref&order_id=native-id'), env, { siteId: 'site-key' }, shops[0])).text();
	assert.equal(withOrderId, baseline);
	assert.match(baseline, /ref=provider-ref/);
	assert.doesNotMatch(baseline, /order_id=/);
});

for (const shop of shops) {
	test(`completion route renders the ${shop.lang} shop shell and verified outcome URL`, async () => {
		const env = { ASSETS: { fetch: async () => new Response(`<!doctype html><html lang="${shop.lang}"><head><title>Shop</title></head><body><header>NAV</header><main>GRID</main><footer>FOOT</footer></body></html>`) } };
		const req = new Request(`https://shop.example${shop.shopPath}/complete?ref=ref-123`);
		const res = await renderCompletion(req, env, { siteId: 'site-key' }, shop);
		const html = await res.text();
		assert.equal(res.headers.get('cache-control'), 'private, no-store');
		assert.match(html, new RegExp(shop.headline));
		assert.ok(html.includes('/api/v2/shop/checkout/outcome?site=site-key&amp;ref=ref-123') || html.includes('/api/v2/shop/checkout/outcome?site=site-key&ref=ref-123'));
		assert.ok(html.includes('NAV') && html.includes('FOOT'), 'site chrome is preserved');
		assert.ok(html.includes('shouldClearCartForOutcome(d.state)') && html.includes("d.state==='pending'"));
	});
}

test('the h1 sits outside the padded section, full-bleed like the donor page\'s own h1', async () => {
	const env = { ASSETS: { fetch: async () => new Response('<!doctype html><html lang="ja-JP"><head><title>Shop</title></head><body><main>GRID</main></body></html>') } };
	const html = await (await renderCompletion(new Request('https://shop.example/shop/complete?ref=ref-123'), env, { siteId: 'site-key' }, shops[0])).text();
	const h1Index = html.indexOf('<h1 id="dc-shop-heading">');
	const sectionIndex = html.indexOf('<section class="dc-shop-complete"');
	assert.ok(h1Index >= 0 && sectionIndex >= 0 && h1Index < sectionIndex, 'h1 comes before (outside) the padded section');
	assert.doesNotMatch(html.slice(0, sectionIndex), /<section/, 'h1 is not itself wrapped in a section before dc-shop-complete');
	const outcomeIndex = html.indexOf('id="dc-shop-outcome"');
	assert.ok(outcomeIndex > sectionIndex, 'the outcome div stays inside the padded section');
});

const stateHeadings = {
	'en-US': { paid: 'Thank you for your order', pending: 'Confirming your payment', canceled: 'Payment not completed', unknown: "We couldn't find this order" },
	'ja-JP': { paid: 'ご注文ありがとうございます', pending: 'お支払いを確認しています', canceled: 'お支払いは完了していません', unknown: 'ご注文を確認できません' },
	'zh-TW': { paid: '感謝您的訂購', pending: '正在確認您的付款', canceled: '付款未完成', unknown: '找不到這筆訂單' },
	// 0.11.10 (finding #15, 2026-09-03 cold-read): Simplified, added alongside zh-TW.
	'zh-CN': { paid: '感谢您的订购', pending: '正在确认您的付款', canceled: '付款未完成', unknown: '找不到这笔订单' }
};

for (const [locale, headings] of Object.entries(stateHeadings)) {
	test(`completion headings follow every outcome state in ${locale}`, () => {
		for (const state of ['paid', 'pending', 'canceled', 'unknown']) assert.equal(COMPLETE_COPY[locale][state], headings[state]);
	});
}

// 0.11.10 (finding #15): the JPY tax word on the completion page's total line follows the SAME
// locale table — ja stays 税込, zh-TW/zh-CN/en-US get their own words instead of borrowing ja's.
test('completion COMPLETE_COPY.tax is localized, not always 税込', () => {
	assert.equal(COMPLETE_COPY['ja-JP'].tax, '税込');
	assert.equal(COMPLETE_COPY['zh-TW'].tax, '含稅');
	assert.equal(COMPLETE_COPY['zh-CN'].tax, '含税');
	assert.equal(COMPLETE_COPY['en-US'].tax, 'incl. tax');
});

// completionLocale's own resolution rules — both the PATH-segment branch (Lingo URL locale) and the
// fallback branch that scans the shop path + shell's <html lang> when no path locale is present.
test('completionLocale resolves zh-CN from a path segment, alongside the existing zh-TW/ja ones', () => {
	assert.equal(completionLocale(shops[0], '', 'zh-cn'), 'zh-CN');
	assert.equal(completionLocale(shops[0], '', 'zh-hans'), 'zh-CN');
	assert.equal(completionLocale(shops[0], '', 'zh-tw'), 'zh-TW');
	assert.equal(completionLocale(shops[0], '', 'zh-hant'), 'zh-TW');
	assert.equal(completionLocale(shops[0], '', 'ja'), 'ja-JP');
	assert.equal(completionLocale(shops[0], '', 'fr'), 'en-US');
});
test('completionLocale falls back to the shell\'s <html lang> for a genuinely Simplified shop', () => {
	const shell = '<html lang="zh-Hans"><head></head><body></body></html>';
	assert.equal(completionLocale({ shopPath: '/shop' }, shell, ''), 'zh-CN');
});

test('a direct completion visit renders unknown immediately and does not poll', async () => {
	const env = { ASSETS: { fetch: async () => new Response('<!doctype html><html lang="ja-JP"><head><title>Shop</title></head><body><main>GRID</main></body></html>') } };
	const html = await (await renderCompletion(new Request('https://shop.example/shop/complete'), env, { siteId: 'site-key' }, shops[0])).text();
	assert.match(html, /<title>ご注文を確認できません<\/title>/);
	assert.match(html, /<h1 id="dc-shop-heading">ご注文を確認できません<\/h1>/);
	assert.match(html, /このページはお支払いの後に表示されます。/);
	assert.doesNotMatch(html, /fetch\(C\.outcomeUrl/);
});

test('completion copy can be overridden by data attributes on the coral mount', async () => {
	const shell = '<!doctype html><html lang="en-US"><head></head><body><main><div data-dynamic-coral="square-shop" data-complete-pending="Checking now"></div></main></body></html>';
	const env = { ASSETS: { fetch: async () => new Response(shell) } };
	const html = await (await renderCompletion(new Request('https://shop.example/en/shop/complete?ref=x'), env, { siteId: 'site-key' }, shops[2])).text();
	assert.match(html, /<title>Checking now<\/title>/);
	assert.match(html, /<h1 id="dc-shop-heading">Checking now<\/h1>/);
});

test('cart clearing decision trusts only a paid outcome', () => {
	assert.equal(shouldClearCartForOutcome('paid'), true);
	for (const state of ['pending', 'canceled', 'unknown', 'error', undefined]) {
		assert.equal(shouldClearCartForOutcome(state), false);
	}
});

test('legacy done marker redirects only when it carries a ref and never clears storage', () => {
	const removed = [];
	globalThis.window = {
		location: { href: 'https://shop.example/shop?dc_shop=done&ref=legacy-ref', replace(value) { this.replaced = value; } },
		localStorage: { removeItem: (key) => removed.push(key) }
	};
	consumeCheckoutReturn();
	assert.equal(window.location.replaced, '/shop/complete?ref=legacy-ref');
	assert.deepEqual(removed, []);
	window.location = { href: 'https://shop.example/shop?dc_shop=done', replace(value) { this.replaced = value; } };
	consumeCheckoutReturn();
	assert.equal(window.location.replaced, undefined);
	delete globalThis.window;
});
