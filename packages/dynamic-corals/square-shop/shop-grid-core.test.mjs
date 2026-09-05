import { renderShopGrid } from './product-page-core.js';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

const items = [
  { variation_id: 'V1', name: 'Apron Set', slug: 'apron-set', image_url: 'https://x/a.jpg', display_price: 40, currency: 'USD', add_label: null, buy_label: null },
  { variation_id: 'V2', name: 'Pins <b>&', slug: null, image_url: null, display_price: 10, currency: 'USD', add_label: null, buy_label: null },
  { variation_id: 'V3', name: 'x', slug: 's', display_price: null, currency: 'USD' }, // no image, null price
];

// ── cart mode ──
const c = renderShopGrid(items, { cart: true, detailBase: '/shop', labels: {} });
ok('cart: layout wrapper', c.gridHtml.includes('class="dc-square-shop-layout"'));
ok('cart: grid has SSR marker', c.gridHtml.includes('class="dc-square-shop-grid" data-ssr="1"'));
ok('cart: empty cart panel present', c.gridHtml.includes('<div class="dc-square-shop-cart"></div>'));
ok('cart: 3 cards', (c.gridHtml.match(/dc-square-shop-card/g) || []).length === 3);
ok('cart: card carries data-variation-id', c.gridHtml.includes('data-variation-id="V1"'));
ok('cart: Add to cart button (not Buy)', c.gridHtml.includes('>Add to cart</button>') && !c.gridHtml.includes('>Buy<'));
ok('cart: V1 links to /shop/apron-set', c.gridHtml.includes('href="/shop/apron-set"'));
ok('cart: V1 has img', c.gridHtml.includes('class="dc-square-shop-img" src="https://x/a.jpg"'));
ok('cart: V1 price formatted and unambiguous', c.gridHtml.includes('USD') && c.gridHtml.includes('40.00'));
ok('cart: V2 no slug → no link anchor for it', !c.gridHtml.includes('href="/shop/null"'));
ok('cart: V2 no image → no img tag between its markers', c.gridHtml.split('data-variation-id="V2"')[1].split('data-variation-id')[0].indexOf('<img') === -1);
ok('cart: V2 name escaped (<b> → &lt;b&gt;)', c.gridHtml.includes('Pins &lt;b&gt;&amp;'));
ok('cart: V3 null price → empty price cell (no NaN/$)', /class="dc-square-shop-price"><\/p>/.test(c.gridHtml.replace(/\s+/g,' ')) || c.gridHtml.includes('class="dc-square-shop-price"></p>'));

ok('cart: card embeds data-price for hydration', c.gridHtml.includes('data-price="40"'));
ok('cart: card embeds data-currency', c.gridHtml.includes('data-currency="USD"'));
ok('cart: card embeds data-slug when present', c.gridHtml.includes('data-slug="apron-set"'));
ok('cart: V3 null price → no data-price attr', c.gridHtml.split('data-variation-id="V3"')[1].split('>')[0].indexOf('data-price')===-1);

// ── instant mode ──
const i = renderShopGrid(items, { cart: false, detailBase: '/shop', labels: {} });
ok('instant: NO layout wrapper', !i.gridHtml.includes('dc-square-shop-layout'));
ok('instant: NO cart panel', !i.gridHtml.includes('dc-square-shop-cart"'));
ok('instant: Buy button (not Add)', i.gridHtml.includes('>Buy</button>') && !i.gridHtml.includes('>Add<'));

// ── header mode (data-cart="header"): cart mode, sidebar suppressed, panel still present ──
const h = renderShopGrid(items, { cart: true, noSidebar: true, detailBase: '/shop', labels: {} });
ok('header: hosted-cart layout class', h.gridHtml.includes('dc-square-shop-layout--hosted-cart'));
ok('header: cart panel still rendered (for drawer relocation)', h.gridHtml.includes('dc-square-shop-cart"'));
ok('header: Add button (cart mode, not Buy)', h.gridHtml.includes('>Add to cart</button>') && !h.gridHtml.includes('>Buy<'));
ok('header: css hides inline panel', h.gridCss.includes('dc-square-shop-layout--hosted-cart > .dc-square-shop-cart'));
ok('cart(1): NO hosted-cart class (back-compat)', !c.gridHtml.includes('hosted-cart'));

// ── label overrides + no detailBase ──
const p = renderShopGrid([items[0]], { cart: true, labels: { add: '加入' } });
ok('label override + no detailBase → plain (no link)', p.gridHtml.includes('>加入</button>') && !p.gridHtml.includes('dc-square-shop-link'));

// ── css ──
ok('gridCss carries the grid styles', c.gridCss.includes('.dc-square-shop-grid') && c.gridCss.includes('.dc-square-shop-buy'));
ok('empty items → empty grid, no crash', renderShopGrid([], { cart: true }).gridHtml.includes('dc-square-shop-grid'));
ok('null items → no crash', renderShopGrid(null, {}).gridHtml.includes('dc-square-shop-grid'));

// ── JPY tax-inclusive price (税込) — RUNBOOK-square-seller-connection-to-rsp-2026-08-27.md,
// 「稅的定案」: no per-site setting, the rule follows the merchant's currency. USD (`items`, above)
// must render byte-for-byte as before; a JPY item gets the label once, right after the price. ──
ok('USD grid (existing fixture): NO tax-inclusive label anywhere in the grid', !c.gridHtml.includes('dc-tax-inclusive'));

const jpyItems = [
	{ variation_id: 'JV1', name: 'Doodle Book #1', slug: 'doodle-book-1', image_url: 'https://x/doodle.jpg', display_price: 1400, currency: 'JPY' },
	{
		variation_id: 'JV2', name: 'Postcard Set', slug: 'postcard-set', image_url: 'https://x/pc.jpg', currency: 'JPY',
		variants: [
			{ id: 'a', display_price: 500, currency: 'JPY' },
			{ id: 'b', display_price: 900, currency: 'JPY' }
		]
	}
];
const j = renderShopGrid(jpyItems, { cart: true, detailBase: '/shop', labels: {}, locale: 'ja-JP' });
ok('JPY single price: tax-inclusive label right after the price, in the SAME <p>',
	j.gridHtml.includes('<p class="dc-square-shop-price">¥1,400<small class="dc-tax-inclusive">税込</small></p>'),
	(j.gridHtml.match(/data-variation-id="JV1"[\s\S]*?<p class="dc-square-shop-price">[\s\S]*?<\/p>/) || [])[0]);
ok('JPY multi-variant range: label appears ONCE at the end (never duplicated on both min and max)',
	j.gridHtml.includes('<p class="dc-square-shop-price">¥500~¥900<small class="dc-tax-inclusive">税込</small></p>')
	&& !j.gridHtml.includes('税込~')
	&& (j.gridHtml.match(/税込/g) || []).length === 2, // exactly one per JPY card (2 cards)
	j.gridHtml.match(/<p class="dc-square-shop-price">[\s\S]*?<\/p>/g) + '');

// 0.11.10 (finding #15, 2026-09-03 cold-read): the SSR half of "the tax word follows the PAGE's own
// locale, not always Japanese". WHETHER it shows still follows the currency (JPY-priced items on
// every one of these); WHAT WORD is the only thing that changes below. Price PREFIX is a separate,
// pre-existing rule (fmtPrice's own "¥ is only a JPY locale's own glyph" — ja gets ¥, everyone else
// (including zh, whose "own" yen glyph is reserved for CNY, not JPY) gets the ISO code, and Intl
// puts a NO-BREAK SPACE — not U+0020 — between a currencyDisplay:'code' code and the amount) — not
// touched here, just not fought either.
const jpySingle = [jpyItems[0]];
const NBSP = ' ';
const localeWords = { 'zh-TW': ['含稅', `JPY${NBSP}1,400`], 'zh-Hant': ['含稅', `JPY${NBSP}1,400`], 'zh-CN': ['含税', `JPY${NBSP}1,400`], 'zh-Hans': ['含税', `JPY${NBSP}1,400`], 'en-US': ['incl. tax', `JPY${NBSP}1,400`] };
for (const [locale, [word, price]] of Object.entries(localeWords)) {
	const g = renderShopGrid(jpySingle, { cart: true, detailBase: '/shop', labels: {}, locale });
	ok(`SSR grid, locale=${locale}: tax-inclusive label reads "${word}", not 税込`,
		g.gridHtml.includes(`<p class="dc-square-shop-price">${price}<small class="dc-tax-inclusive">${word}</small></p>`)
		&& !g.gridHtml.includes('税込'),
		(g.gridHtml.match(/<p class="dc-square-shop-price">[\s\S]*?<\/p>/) || [])[0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
