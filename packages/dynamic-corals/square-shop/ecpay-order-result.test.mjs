import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCompletion } from './shop-function-template.js';
import { formatMoney } from './product-page-core.js';

// The result page's ECPay views: a paid order with its e-invoice or receipt and its parcel, a
// cash-on-delivery order just placed, and an order opened by its link — which shows payment,
// document number and parcel state only. Any outcome without those facts keeps today's views.

globalThis.formatMoney = formatMoney;

async function resultPage(url, outcome, { lang = 'zh-Hant-TW', session = {} } = {}) {
	const env = { ASSETS: { fetch: async () => new Response(`<!doctype html><html lang="${lang}"><head><title>Shop</title></head><body><main>GRID</main></body></html>`) } };
	const html = await (await renderCompletion(new Request(url), env, { siteId: 'site-tea' }, { shopPath: '/shop' })).text();
	const script = html.match(/<script>(\(function\(\)\{const C=[\s\S]*?)<\/script>/)[1];
	const nodes = { 'dc-shop-outcome': { innerHTML: '' }, 'dc-shop-heading': { textContent: '' } };
	const doc = { title: '', getElementById: (id) => nodes[id], createElement: () => ({ set textContent(v) { this._t = v; }, get innerHTML() { return String(this._t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }) };
	const store = {};
	const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
	const tab = { ...session };
	const sessionStorage = { getItem: (k) => (k in tab ? tab[k] : null), setItem: (k, v) => { tab[k] = v; }, removeItem: (k) => { delete tab[k]; } };
	const asked = [];
	const timers = [];
	const fetchFn = async (u) => { asked.push(u); return { ok: true, json: async () => ({ ok: true, ...outcome }) }; };
	new Function('document', 'fetch', 'localStorage', 'window', 'CustomEvent', 'setTimeout', script)(doc, fetchFn, localStorage, { dispatchEvent() {}, sessionStorage }, class { }, (f) => timers.push(f));
	await new Promise((r) => setImmediate(r));
	return { heading: nodes['dc-shop-heading'].textContent, body: nodes['dc-shop-outcome'].innerHTML, asked, timers, title: doc.title, nodes };
}
const money = (minor) => formatMoney({ minor, currency: 'TWD', locale: 'zh-TW' });
const paid = {
	state: 'paid', order_ref: 'order-1', currency: 'TWD', total_minor: 156000,
	lines: [{ name: 'Tea bowl', qty: 1, amount_minor: 120000 }, { name: 'Tea scoop', qty: 1, amount_minor: 30000 }],
	invoice: { state: 'issued', invoice_no: 'AB12345678', allowance_total: 0 },
};

test('just paid (ECPay\'s return): lines, total, order number, invoice number', async () => {
	const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', paid);
	assert.equal(r.heading, '付款完成');
	assert.ok(r.body.includes(`<ul class="st-list st-lines"><li><span>Tea bowl<span class="st-q">× 1</span></span><span>${money(120000)}</span></li>`), r.body);
	assert.ok(r.body.includes(`<div class="st-sum-tot"><span>合計</span><span>${money(156000)}</span></div>`), r.body);
	assert.ok(r.body.includes('<p>訂單編號 <strong>order-1</strong></p>'), r.body);
	assert.ok(r.body.includes('<div class="st-status st-status-ok"><span class="st-status-ico" aria-hidden="true"></span><div><strong>電子發票 AB12345678</strong><p class="st-note">已開立。</p></div></div>'), r.body);
	assert.ok(r.body.includes('確認信會寄到你填的電子郵件。'));
	assert.ok(r.body.includes('href="/shop">返回商店</a>'));
});

test('just paid (this tab\'s in-page checkout): the order id is asked for, the fee row names the method', async () => {
	const ref = 'tile-1';
	const session = { [`dc-native-ecpay:${ref}`]: JSON.stringify({ order_id: 'order-1', sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, currency: 'TWD', invoice: true }) };
	const r = await resultPage(`https://site.example/shop/complete?ref=${ref}&merchant_trade_no=T1`, paid, { session });
	assert.match(r.asked[0], /[?&]ref=order-1(&|$)/);
	assert.doesNotMatch(r.asked[0], /ref=tile-1/);
	assert.equal(r.heading, '付款完成');
	assert.ok(r.body.includes(`<div><span>運費 · 7-ELEVEN 取貨</span><span>${money(6000)}</span></div>`), r.body);
	assert.ok(r.body.includes('<strong>準備出貨</strong><p class="st-note">7-ELEVEN 取貨 · 到店後會寄信通知。</p>'), r.body);
});

test('a receipt instead of an invoice, and a parcel RSP reports', async () => {
	const outcome = { ...paid, invoice: undefined, receipt: { state: 'issued', receipt_no: 'R-778' }, shipment: { state: 'booked', sub_type: 'FAMIC2C', tracking_number: 'F123456' } };
	const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', outcome);
	assert.ok(r.body.includes('<strong>收據 R-778</strong><p class="st-note">已開立。</p>'), r.body);
	assert.ok(r.body.includes('<strong>已交給物流</strong><p class="st-note">全家取貨 · 物流單號 F123456</p>'), r.body);
});

test('cash on delivery placed: 「訂單成立，取貨時付款」, the amount due on pickup, invoice after collection, no polling', async () => {
	const ref = 'tile-2';
	const session = { [`dc-native-ecpay:${ref}`]: JSON.stringify({ order_id: 'order-2', sub_type: 'FAMIC2C', logistics_type: 'CVS', fee_minor: 6000, currency: 'TWD', invoice: true, cod: true, total_minor: 126000, lines: [{ name: 'Tea bowl', qty: 1, amount_minor: 120000 }] }) };
	const r = await resultPage(`https://site.example/shop/complete?ref=${ref}`, { state: 'pending' }, { session });
	assert.equal(r.heading, '訂單成立，取貨時付款');
	assert.equal(r.title, '訂單成立，取貨時付款');
	assert.ok(r.body.includes(`<div class="st-sum"><div><span>運費 · 全家取貨</span><span>${money(6000)}</span></div><div class="st-sum-tot"><span>取貨時付</span><span>${money(126000)}</span></div></div>`), r.body);
	assert.ok(r.body.includes('<p>訂單編號 <strong>order-2</strong></p>'));
	assert.ok(r.body.includes('<div class="st-status st-status-wait"><span class="st-status-ico" aria-hidden="true"></span><div><strong>等待出貨</strong><p class="st-note">全家取貨 · 到店後請在期限內取貨付款，逾期退回、訂單取消。</p></div></div>'), r.body);
	assert.ok(r.body.includes('<strong>電子發票</strong><p class="st-note">取貨付款後開立。</p>'), r.body);
	assert.equal(r.timers.length, 0, 'a placed cash-on-delivery order is not polled as a pending payment');
});

test('by link: payment, invoice number and parcel only — no address, phone or carrier', async () => {
	const outcome = { ...paid, shipment: { state: 'booked', sub_type: 'UNIMARTC2C', tracking_number: '20261020A1' } };
	const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567', outcome);
	assert.equal(r.heading, '訂單 order-1');
	assert.ok(r.body.startsWith('<p class="st-note">用確認信裡的連結查看。</p>'), r.body);
	assert.ok(r.body.includes(`<strong>已付款 · ${money(156000)}</strong>`), r.body);
	assert.ok(r.body.includes('<strong>電子發票 AB12345678</strong>'));
	assert.ok(r.body.includes('<strong>已交給物流</strong><p class="st-note">7-ELEVEN 取貨 · 物流單號 20261020A1</p>'));
	assert.ok(r.body.includes('<div class="st-cell st-guest-note"><p class="st-note">收件人與聯絡資料只在確認信和登入後的帳號頁。</p></div>'), r.body);
	assert.doesNotMatch(r.body, /我們|<h2>/);
	assert.doesNotMatch(r.body, /Tea bowl/, 'the link view lists no lines');
});

test('invoice states the buyer may see', async () => {
	const cases = [
		[{ state: 'pending', invoice_no: null, allowance_total: 0 }, 'st-status-pend', '<strong>電子發票</strong><p class="st-note">開立中。</p>'],
		[{ state: 'intended', invoice_no: null, allowance_total: 0 }, 'st-status-pend', '<strong>電子發票</strong><p class="st-note">付款後開立。</p>'],
		[{ state: 'failed', invoice_no: null, allowance_total: 0 }, 'st-status-wait', '<strong>電子發票</strong><p class="st-note">尚未開立，商店處理中。</p>'],
		[{ state: 'voided', invoice_no: 'AB12345678', allowance_total: 0 }, 'st-status-bad', '<strong>電子發票 AB12345678</strong><p class="st-note">已作廢。</p>'],
		[{ state: 'issued', invoice_no: 'AB12345678', allowance_total: 30000 }, 'st-status-ok', `<strong>電子發票 AB12345678</strong><p class="st-note">已開立。 已折讓 ${money(30000)}。</p>`],
	];
	for (const [invoice, tone, text] of cases) {
		const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', { ...paid, invoice });
		assert.ok(r.body.includes(`<div class="st-status ${tone}">`), `${invoice.state}: ${r.body}`);
		assert.ok(r.body.includes(text), `${invoice.state}: ${r.body}`);
	}
});

test('an outcome with no ECPay facts keeps the existing paid and pending views', async () => {
	const plain = { state: 'paid', order_ref: 'ord-9', currency: 'TWD', total_minor: 30000, lines: [{ name: 'Tee', qty: 1, amount_minor: 30000 }] };
	const r = await resultPage('https://site.example/shop/complete?ref=ref-9&merchant_trade_no=T1', plain);
	assert.equal(r.heading, '感謝您的訂購');
	assert.ok(r.body.includes('<p>訂單確認信已寄到您的電子郵件。</p>'), r.body);
	assert.doesNotMatch(r.body, /st-status/);
	const p = await resultPage('https://site.example/shop/complete?ref=ref-9', { state: 'pending' });
	assert.equal(p.heading, '正在確認您的付款');
	assert.equal(p.timers.length, 1, 'a pending payment is still polled');
});

test('the views follow the shell language', async () => {
	const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567', paid, { lang: 'en' });
	assert.equal(r.heading, 'Order order-1');
	assert.ok(r.body.includes('<strong>E-invoice AB12345678</strong>'));
});

// Fields RSP is adding. Each is read only when present; without it the views above are unchanged.
test('RSP\'s awaiting_collection state: the placed view in this tab, a link view elsewhere, never polled', async () => {
	const outcome = { state: 'awaiting_collection', order_ref: 'order-5', currency: 'TWD', total_minor: 126000, lines: [{ name: 'Tea bowl', qty: 1, amount_minor: 120000 }], invoice: { state: 'intended', invoice_no: null, allowance_total: 0 } };
	const byLink = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567', outcome);
	assert.equal(byLink.heading, '訂單 order-5');
	assert.ok(byLink.body.includes(`<strong>取貨時付 · ${money(126000)}</strong>`), byLink.body);
	assert.ok(byLink.body.includes('<strong>電子發票</strong><p class="st-note">取貨付款後開立。</p>'), byLink.body);
	assert.doesNotMatch(byLink.body, /Tea bowl/);
	assert.equal(byLink.timers.length, 0);
	const ref = 'tile-5';
	const session = { [`dc-native-ecpay:${ref}`]: JSON.stringify({ order_id: 'order-5', sub_type: 'FAMIC2C', logistics_type: 'CVS', fee_minor: 6000, currency: 'TWD', invoice: true, cod: true, total_minor: 126000, lines: [] }) };
	const here = await resultPage(`https://site.example/shop/complete?ref=${ref}`, outcome, { session });
	assert.equal(here.heading, '訂單成立，取貨時付款');
	assert.ok(here.body.includes(`<div class="st-sum-tot"><span>取貨時付</span><span>${money(126000)}</span></div>`), here.body);
	assert.ok(here.body.includes('<strong>等待出貨</strong>'));
	assert.equal(here.timers.length, 0);
});

test('parcel states at the store, picked up, delivered and returned', async () => {
	const cases = [['arrived', 'st-status-ok', '已到店'], ['picked_up', 'st-status-ok', '已取貨'], ['delivered', 'st-status-ok', '已送達'], ['returned', 'st-status-bad', '已退回']];
	for (const [state, tone, title] of cases) {
		const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567', { ...paid, shipment: { state, sub_type: 'UNIMARTC2C', tracking_number: 'Z1' } });
		assert.ok(r.body.includes(`<div class="st-status ${tone}"><span class="st-status-ico" aria-hidden="true"></span><div><strong>${title}</strong><p class="st-note">7-ELEVEN 取貨 · 物流單號 Z1</p></div></div>`), `${state}: ${r.body}`);
	}
});

test('fee and discount lines go to the total block; lines without a kind stay goods', async () => {
	const outcome = { ...paid, total_minor: 146000, lines: [{ name: 'Tea bowl', qty: 1, amount_minor: 120000 }, { name: 'Tea scoop', qty: 1, amount_minor: 30000 }, { kind: 'fee', name: '', qty: 1, amount_minor: 6000 }, { kind: 'discount', name: 'Autumn', qty: 1, amount_minor: -10000 }], shipment: { state: 'pending', sub_type: 'UNIMARTC2C', tracking_number: null } };
	const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', outcome);
	assert.ok(r.body.includes(`<ul class="st-list st-lines"><li><span>Tea bowl<span class="st-q">× 1</span></span><span>${money(120000)}</span></li><li><span>Tea scoop<span class="st-q">× 1</span></span><span>${money(30000)}</span></li></ul>`), r.body);
	assert.ok(r.body.includes(`<div class="st-sum"><div><span>運費 · 7-ELEVEN 取貨</span><span>${money(6000)}</span></div><div><span>Autumn</span><span>−${money(10000)}</span></div><div class="st-sum-tot"><span>合計</span><span>${money(146000)}</span></div></div>`), r.body);
});

test('a payment still unconfirmed when the page stops asking promises no email', async () => {
	const words = /email|メール|郵件|邮件|寄信|通知/i;
	for (const lang of ['zh-Hant-TW', 'en', 'ja-JP', 'zh-Hans']) {
		const r = await resultPage('https://site.example/shop/complete?ref=ref-9', { state: 'pending' }, { lang });
		let asked = 1;
		while (r.timers.length) { r.timers.shift()(); asked += 1; await new Promise((done) => setImmediate(done)); }
		assert.equal(asked, 40, lang);
		assert.doesNotMatch(r.nodes['dc-shop-outcome'].innerHTML, words, lang);
		assert.ok(r.nodes['dc-shop-outcome'].innerHTML.length > 0, lang);
	}
});

test('the outcome is asked for with the extended states and the full lines', async () => {
	const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', paid);
	assert.match(r.asked[0], /[?&]states=extended(&|$)/);
	assert.match(r.asked[0], /[?&]lines=full(&|$)/);
});

test('RSP\'s own fee line names the method when the parcel says it; its discount keeps RSP\'s name', async () => {
	const outcome = { ...paid, total_minor: 151000, lines: [...paid.lines, { kind: 'discount', name: '折扣', qty: 1, amount_minor: -5000 }, { kind: 'fee', name: '運費', qty: 1, amount_minor: 6000 }], shipment: { state: 'picked_up', sub_type: 'UNIMARTC2C', tracking_number: 'F1' } };
	const r = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', outcome);
	assert.ok(r.body.includes(`<div class="st-sum"><div><span>運費 · 7-ELEVEN 取貨</span><span>${money(6000)}</span></div><div><span>折扣</span><span>−${money(5000)}</span></div><div class="st-sum-tot"><span>合計</span><span>${money(151000)}</span></div></div>`), r.body);
	const noParcel = await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', { ...outcome, shipment: undefined });
	assert.ok(noParcel.body.includes(`<div><span>運費</span><span>${money(6000)}</span></div>`), noParcel.body);
});

test('the summary view for an order without ECPay facts leaves fee and discount lines out, as before', async () => {
	const plain = { state: 'paid', order_ref: 'ord-9', currency: 'TWD', total_minor: 31000, lines: [{ name: 'Tee', qty: 1, amount_minor: 30000 }, { kind: 'fee', name: '運費', qty: 1, amount_minor: 6000 }, { kind: 'discount', name: '折扣', qty: 1, amount_minor: -5000 }] };
	const withKinds = await resultPage('https://site.example/shop/complete?ref=ref-9&merchant_trade_no=T1', plain);
	const without = await resultPage('https://site.example/shop/complete?ref=ref-9&merchant_trade_no=T1', { ...plain, lines: plain.lines.slice(0, 1) });
	assert.equal(withKinds.body, without.body);
	assert.doesNotMatch(withKinds.body, /運費|折扣/);
});

test('no ECPay result view speaks as 「我們」 or "we"', async () => {
	for (const lang of ['zh-Hant-TW', 'en', 'ja-JP', 'zh-Hans']) {
		const ref = 'tile-9';
		const session = { [`dc-native-ecpay:${ref}`]: JSON.stringify({ order_id: 'order-9', sub_type: 'UNIMARTC2C', logistics_type: 'CVS', fee_minor: 6000, currency: 'TWD', invoice: true }) };
		for (const r of [
			await resultPage(`https://site.example/shop/complete?ref=${ref}&merchant_trade_no=T1`, paid, { lang, session }),
			await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567', paid, { lang }),
		]) assert.doesNotMatch(r.body, /我們|我们|\bwe\b/i, `${lang}: ${r.body}`);
	}
});

test('a paid order with an e-invoice never says a receipt was emailed', async () => {
  const states = [
    { state: 'issued', invoice_no: 'AB12345678', allowance_total: 0 },
    { state: 'pending', invoice_no: null, allowance_total: 0 },
    { state: 'intended', invoice_no: null, allowance_total: 0 },
    { state: 'failed', invoice_no: null, allowance_total: 0 },
  ];
  const ref = 'tile-10';
  const session = { [`dc-native-ecpay:${ref}`]: JSON.stringify({ order_id: 'order-10', sub_type: 'TCAT', logistics_type: 'HOME', fee_minor: 12000, currency: 'TWD', invoice: true }) };
  for (const invoice of states) {
    for (const lang of ['zh-Hant-TW', 'zh-Hans']) {
      for (const r of [
        await resultPage('https://site.example/shop/complete?ref=ecp-0123456789abcdef01234567&merchant_trade_no=T1', { ...paid, invoice }, { lang }),
        await resultPage(`https://site.example/shop/complete?ref=${ref}&merchant_trade_no=T1`, { ...paid, invoice }, { lang, session }),
      ]) {
        assert.ok(r.body.includes(lang === 'zh-Hans' ? '电子发票' : '電子發票'), `${invoice.state} ${lang}: ${r.body}`);
        assert.doesNotMatch(r.body, /收據已寄到|收据已寄到/, `${invoice.state} ${lang}: ${r.body}`);
      }
    }
  }
});
