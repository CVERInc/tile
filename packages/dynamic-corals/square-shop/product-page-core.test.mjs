import { formatMoney, renderProductPage } from './product-page-core.js';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

ok('JPY on ja keeps the local yen symbol', formatMoney({ minor: 1200, currency: 'JPY', locale: 'ja-JP' }) === '¥1,200');
ok('USD on zh-TW names the currency', formatMoney({ minor: 1900, currency: 'USD', locale: 'zh-TW' }).includes('USD'));
ok('TWD on en-US names the currency', formatMoney({ minor: 60000, currency: 'TWD', locale: 'en-US' }).includes('TWD'));
ok('EUR keeps its unambiguous symbol', formatMoney({ minor: 1900, currency: 'EUR', locale: 'en-US' }).includes('€'));

// RICH (stripe-like): 2 images, 3 variants
const rich = {
	processor: 'stripe', id: 'prod_MOCK', slug: 'mock-hoodie', title: 'Mock Hoodie',
	description: 'Cozy.\n\nSecond paragraph & <b>bold</b> danger.',
	images: ['https://x/front.png', 'https://x/back.png'],
	variants: [
		{ id: 'price_S', title: 'Small', price_minor: 4000, currency: 'USD', display_price: 40.0, available: true },
		{ id: 'price_M', title: 'Medium', price_minor: 4000, currency: 'USD', display_price: 40.0, available: true },
		{ id: 'price_L', title: 'Large', price_minor: 4500, currency: 'USD', display_price: 45.0, available: true }
	]
};
const cfg = { guildId: 'g1', apiBase: 'https://api', shopPath: '/shop', canonical: 'https://example.com/shop/mock-hoodie', siteName: 'Example', labels: {} };
const r = renderProductPage(rich, cfg);

ok('title composed', r.title === 'Mock Hoodie — Example', r.title);
ok('og:title in head', r.headMeta.includes('property="og:title" content="Mock Hoodie"'));
ok('og:image = hero', r.headMeta.includes('og:image" content="https://x/front.png"'));
ok('og:type product', r.headMeta.includes('og:type" content="product"'));
ok('canonical present', r.headMeta.includes('rel="canonical" href="https://example.com/shop/mock-hoodie"'));
ok('JSON-LD Product schema', r.headMeta.includes('"@type":"Product"') && r.headMeta.includes('"price":"40.00"') && r.headMeta.includes('"price":"45.00"'));
ok('JSON-LD escapes </script', !r.headMeta.includes('</script></script>'));
ok('gallery has thumbnails (multi-image)', (r.bodyHtml.match(/data-dc-thumb data-src/g) || []).length === 2);
ok('variant selector rendered (multi-variant)', r.bodyHtml.includes('<select data-dc-variant') && (r.bodyHtml.match(/<option /g) || []).length === 3);
ok('add-to-cart button', r.bodyHtml.includes('data-dc-add') && r.bodyHtml.includes('Add to cart'));
ok('breadcrumb links to shop', r.bodyHtml.includes(`href="/shop"`) && r.bodyHtml.includes('Shop'));
ok('description escaped (no raw <b>)', r.bodyHtml.includes('&lt;b&gt;bold&lt;/b&gt;') && !r.bodyHtml.includes('<b>bold'));
ok('description split into paragraphs', (r.bodyHtml.match(/<p>/g) || []).length >= 2);
ok('client script shares cart key', r.bodyHtml.includes('dc-square-shop-cart:'));
ok('theme tokens used', r.bodyHtml.includes('var(--gd-accent'));
const mobileCss = (r.bodyHtml.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/) || [''])[0];
ok('mobile CSS gives add-to-cart and option select 44px tap targets',
	mobileCss.includes('.dc-pp-add, .dc-pp-variant select { min-height: 44px; }'));
// 🔴 Checked against the price PARAGRAPH specifically, not bodyHtml as a whole — the client
// script's `taxSuffix()` helper carries the literal string `<small class="dc-tax-inclusive">`
// in its OWN source as a template for the JPY case, and that helper ships on every page
// regardless of currency, so a whole-body substring check false-positives on every fixture.
ok('rich (USD): price paragraph has NO tax-inclusive label — unchanged behavior for non-JPY currencies',
	!(r.bodyHtml.match(/<p class="dc-pp-price"[\s\S]*?<\/p>/) || [''])[0].includes('dc-tax-inclusive'));

// SPARSE (square-like): 1 image, 1 variant
const sparse = {
	processor: 'square', id: 'ITM', slug: 'riso-poster', title: 'RISO poster', description: 'A poster.',
	images: ['https://x/poster.jpg'],
	variants: [{ id: 'v1', title: 'Regular', price_minor: 500, currency: 'USD', display_price: 5.0, available: true }]
};
const s = renderProductPage(sparse, { guildId: 'g1', shopPath: '/shop', siteName: 'Example', labels: {} });
ok('sparse: no thumbnails (single image)', !s.bodyHtml.includes('data-dc-thumb data-src'));
ok('sparse: no variant selector (single variant)', !s.bodyHtml.includes('<select data-dc-variant'));
ok('sparse: still has add + price', s.bodyHtml.includes('data-dc-add') && s.bodyHtml.includes('USD') && s.bodyHtml.includes('5.00'));
ok('sparse (USD): price paragraph has NO tax-inclusive label — unchanged behavior for non-JPY currencies',
	!(s.bodyHtml.match(/<p class="dc-pp-price"[\s\S]*?<\/p>/) || [''])[0].includes('dc-tax-inclusive'));

// EMPTY variants -> sold out, disabled
const dead = renderProductPage({ title: 'Gone', images: [], variants: [] }, {});
ok('no variants -> sold out disabled', dead.bodyHtml.includes('Sold out') && dead.bodyHtml.includes('disabled'));

// ── the two item-detail shapes (0.11.0) ──────────────────────────────────
// FLAT — what an RSP older than reef PR #107 answers: no title, no images[], no
// variants[], only the flat fields. Read literally that is a product with zero
// variants, which is the blank-title / empty-gallery / "Sold out" regression
// RUNBOOK §7 #2 predicted on a page every grid card links to.
const flat = {
	id: 'ITM_DOODLE', slug: 'doodle-book-1',
	name: 'Doodle Book #1',
	description: 'A hand-bound sketchbook, JPY priced.',
	variation_id: 'HGMA66X7IHP4FMUBZLNOGA45',
	price_minor: 1400, display_price: '1400', currency: 'JPY',
	image_url: 'https://x/doodle.jpg'
};
const f = renderProductPage(flat, { guildId: 'g1', shopPath: '/shop', siteName: 'northwind', labels: {}, locale: 'ja-JP' });
ok('flat: title falls back to `name`', f.title === 'Doodle Book #1 — northwind', f.title);
ok('flat: <h1> is not blank', f.bodyHtml.includes('>Doodle Book #1</h1>'));
ok('flat: og:title carries the name', f.headMeta.includes('og:title" content="Doodle Book #1"'));
// 🔴 Asserted on the ELEMENT, not on the class name: bodyHtml carries its own
// <style> and <script>, and `.dc-pp-img--empty` / `[data-dc-thumb]` appear in both
// of those whatever the gallery rendered. A bare `!includes('dc-pp-img--empty')`
// was red against a correct gallery — the guard was reading its own stylesheet.
ok('flat: gallery shows image_url, not the empty placeholder',
	f.bodyHtml.includes('<img class="dc-pp-img" data-dc-main src="https://x/doodle.jpg"')
	&& !f.bodyHtml.includes('<div class="dc-pp-img dc-pp-img--empty">'));
ok('flat: og:image is the image_url', f.headMeta.includes('og:image" content="https://x/doodle.jpg"'));
ok('flat: BUY IS ENABLED (not "Sold out")',
	f.bodyHtml.includes('data-dc-add >Add to cart</button>') || (f.bodyHtml.includes('Add to cart') && !f.bodyHtml.includes('Sold out')),
	f.bodyHtml.slice(f.bodyHtml.indexOf('dc-pp-add'), f.bodyHtml.indexOf('dc-pp-add') + 120));
ok('flat: price rendered from the flat fields', /1[,.]?400/.test(f.bodyHtml));
// JPY tax-inclusive price (税込) — RUNBOOK-square-seller-connection-to-rsp-2026-08-27.md,
// 「稅的定案」: no per-site setting, the rule follows the merchant's currency. A JPY single price
// gets the formatted amount immediately followed by the small muted label, once, inside the SAME
// <p class="dc-pp-price"> the price itself renders in.
ok('flat: JPY price paragraph carries the tax-inclusive label, once',
	f.bodyHtml.includes('<p class="dc-pp-price" data-dc-price>¥1,400<small class="dc-tax-inclusive">税込</small></p>'),
	(f.bodyHtml.match(/<p class="dc-pp-price"[\s\S]*?<\/p>/) || [])[0]);
ok('flat: the one variant carries the variation_id for add-to-cart',
	f.bodyHtml.includes('HGMA66X7IHP4FMUBZLNOGA45'));
ok('flat: single synthesized variant → no selector', !f.bodyHtml.includes('<select data-dc-variant'));
ok('flat: JSON-LD offer priced in JPY as an integer',
	f.headMeta.includes('"price":"1400"') && f.headMeta.includes('"priceCurrency":"JPY"'));
ok('flat: JSON-LD says InStock (absent `available` must mean buyable)',
	f.headMeta.includes('schema.org/InStock') && !f.headMeta.includes('OutOfStock'));

// RICH — PR #107's own sample: title + variants[] + images[] alongside the flat
// fields it kept for back-compat. The flat fields are a FLOOR, so none of them
// may override or add to what the backend actually said.
const rspRich = {
	id: 'item_doodle_book_1', slug: 'doodle-book-1', title: 'Doodle Book #1',
	description: 'A hand-bound sketchbook, JPY priced.',
	variants: [
		{ id: 'HGMA66X7IHP4FMUBZLNOGA45', title: 'A5', price_minor: 1400, currency: 'JPY', display_price: '1400', available: true, image_url: 'https://x/a5.jpg', images: ['https://x/a5.jpg'] },
		{ id: 'VAR_DOODLE_A4', title: 'A4', price_minor: 1800, currency: 'JPY', display_price: '1800', available: true, image_url: 'https://x/a4.jpg', images: ['https://x/a4.jpg'] }
	],
	images: ['https://x/cover.jpg'],
	variation_id: 'HGMA66X7IHP4FMUBZLNOGA45', name: 'Doodle Book #1',
	price_minor: 1400, display_price: '1400', currency: 'JPY', image_url: 'https://x/cover.jpg'
};
const rr = renderProductPage(rspRich, { guildId: 'g1', shopPath: '/shop', siteName: 'northwind', labels: {}, locale: 'ja-JP' });
ok('rich: `title` wins over `name`', rr.title === 'Doodle Book #1 — northwind');
ok('rich: BOTH variants rendered — the flat fields added no third',
	(rr.bodyHtml.match(/<option /g) || []).length === 2, rr.bodyHtml.match(/<option /g) + '');
ok('rich: variant selector present', rr.bodyHtml.includes('<select data-dc-variant'));
ok('rich: gallery uses images[] (one image → no thumbnail strip)',
	rr.bodyHtml.includes('<img class="dc-pp-img" data-dc-main src="https://x/cover.jpg"')
	&& (rr.bodyHtml.match(/<button type="button" class="dc-pp-thumb/g) || []).length === 0);
ok('rich: both prices reach the JSON-LD offers',
	rr.headMeta.includes('"price":"1400"') && rr.headMeta.includes('"price":"1800"'));
ok('rich: per-variant image travels to the client script',
	rr.bodyHtml.includes('https://x/a4.jpg'));
ok('rich: JPY — first-variant price paragraph ALSO carries the tax-inclusive label',
	rr.bodyHtml.includes('<p class="dc-pp-price" data-dc-price>¥1,400<small class="dc-tax-inclusive">税込</small></p>'));

// display_price missing, price_minor present — one field's absence must not
// render an empty price span.
const minorOnly = renderProductPage({
	title: 'Minor only', images: ['https://x/m.jpg'],
	variants: [{ id: 'v1', title: 'One', price_minor: 4500, currency: 'USD' }]
}, { labels: {} });
ok('price_minor alone still renders a price', minorOnly.bodyHtml.includes('USD') && minorOnly.bodyHtml.includes('45.00'), minorOnly.bodyHtml.match(/dc-pp-price[^<]*<\/p>/) + '');
ok('price_minor alone is still buyable', !minorOnly.bodyHtml.includes('Sold out'));

// An EXPLICIT false is the backend meaning it — that one is honoured.
const soldOut = renderProductPage({
	title: 'Gone', images: [], variants: [{ id: 'v1', title: 'One', price_minor: 100, currency: 'USD', available: false }]
}, { labels: {} });
ok('explicit available:false → OutOfStock in JSON-LD', soldOut.headMeta.includes('OutOfStock'));

console.log(`\n=== ${pass}/${pass + fail} PASS ===`);
process.exit(fail ? 1 : 0);
