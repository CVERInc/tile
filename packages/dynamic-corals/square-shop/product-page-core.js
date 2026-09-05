// @ts-nocheck — plain untyped JS (checker pragma only).
// @tile/dynamic-corals — square-shop / product-page-core.
//
// PORTABLE render core for a single product's page. Pure: `renderProductPage
// (product, config)` takes the normalized Product (the same shape square_catalog
// and stripe_catalog emit) plus per-site config, and returns { title, headMeta,
// bodyHtml } — NO I/O, NO host/framework assumptions. It runs in two places
// unchanged:
//   • the CF Pages Function (edge, per request) — for live data + per-product OG
//     that social scrapers see server-side;
//   • Node (tests) — so gallery / variant / schema markup is verified.
// The Function injects `headMeta` into the site shell's <head> and `bodyHtml`
// into its <main>, so the page IS a page of the seller's own site.
//
// The buy interaction (variant select, add-to-cart) is a small inline script
// that writes the SAME localStorage cart key as the grid widget (square-shop.js
// `CART_STORE_PREFIX`), so a product page and the /shop grid share ONE cart;
// checkout itself lives on /shop (this page links there).

const CART_STORE_PREFIX = 'dc-square-shop-cart:'; // MUST match square-shop.js

function escHtml(s) {
	return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
	);
}
function escAttr(s) {
	return escHtml(s).replace(/'/g, '&#39;');
}
// Safe JSON for a <script type="application/ld+json"> block.
function jsonLd(obj) {
	return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
export function formatMoney({ minor, currency, locale }) {
	const code = String(currency || 'USD').toUpperCase();
	const pageLocale = locale || 'en-US';
	try {
		const probe = new Intl.NumberFormat(pageLocale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' });
		const symbol = (probe.formatToParts(0).find((part) => part.type === 'currency') || {}).value;
		const language = String(pageLocale).toLowerCase().split('-')[0];
		const ownYen = (language === 'ja' && code === 'JPY') || (language === 'zh' && code === 'CNY');
		const currencyDisplay = symbol === '$' || ((symbol === '¥' || symbol === '￥') && !ownYen) ? 'code' : 'symbol';
		const digits = probe.resolvedOptions().maximumFractionDigits;
		return new Intl.NumberFormat(pageLocale, { style: 'currency', currency: code, currencyDisplay }).format(Number(minor) / (10 ** digits)).replace(/￥/g, '¥');
	} catch {
		return `${minor} ${code}`.trim();
	}
}
function fmtPrice(displayAmount, currency, locale) {
	if (displayAmount == null) return '';
	try {
		const code = String(currency || 'USD').toUpperCase();
		const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
		return formatMoney({ minor: Number(displayAmount) * (10 ** digits), currency: code, locale });
	} catch { return `${displayAmount} ${currency || ''}`.trim(); }
}
// JP sellers show ONE tax-inclusive price — no per-site setting, WHETHER it shows follows the
// merchant's currency (RUNBOOK-square-seller-connection-to-rsp-2026-08-27.md, 「稅的定案」). A small
// muted label appended AFTER the already-escaped price text, never inside fmtPrice's own return
// value, so fmtPrice keeps returning plain text and every other caller/test of it is untouched.
//
// 🩸 0.11.10 (finding #15, 2026-09-03 cold-read): the WORD used to be the literal '税込' regardless
// of the page it rendered on — the same defect square-shop.js's client half had (fixed there the
// same release; see its own note on taxInclusiveSuffix). WHETHER the label shows still follows the
// CURRENCY (a JPY item is JPY-priced everywhere); WHAT WORD it uses follows the PAGE's own locale —
// this is the worker's SSR half of that fix, so a zh-TW/en-US/zh-CN shop's edge-rendered grid
// agrees with its own hydrated client instead of only agreeing with a Japanese one.
function taxWord(locale) {
	const l = String(locale || '').toLowerCase();
	if (l.startsWith('ja')) return '税込';
	if (l.startsWith('zh')) return (l.includes('hans') || /-(cn|sg)(-|$)/.test(l)) ? '含税' : '含稅';
	return 'incl. tax';
}
function taxInclusiveSuffix(currency, locale) {
	return String(currency || '').toUpperCase() === 'JPY' ? `<small class="dc-tax-inclusive">${escHtml(taxWord(locale))}</small>` : '';
}

// ── the item-detail shape, and the older one underneath it ───────────────
// mixfairy and RSP (reef PR #107) both answer the RICH shape: `title`, `images[]`
// and `variants[]`. An RSP older than that PR answered only the FLAT fields —
// `name`, `variation_id`, `price_minor`, `display_price`, `currency`,
// `image_url` — and read literally, that shape has NO variants, which is what
// renders a blank title, an empty gallery and a disabled "Sold out" button on a
// page every grid card links to (RUNBOOK-square-seller-connection-to-rsp-
// 2026-08-27.md §7 #2).
//
// So the flat fields are read as a ONE-VARIANT product: a floor, never an
// override. A backend that sends `variants[]` is believed about every one of
// them, and this normalisation is invisible to it.
const ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF'];
function isZeroDecimal(currency) {
	return ZERO_DECIMAL.indexOf(String(currency || '').toUpperCase()) >= 0;
}

// The two money fields are each other's fallback, so one missing field never
// reaches the page as an empty price or a NaN. Neither is computed when the
// backend sent it — this only fills a hole.
function variantDisplayPrice(v) {
	if (!v) return null;
	if (v.display_price != null && !isNaN(Number(v.display_price))) return Number(v.display_price);
	if (v.price_minor == null || isNaN(Number(v.price_minor))) return null;
	return Number(centsToDecimalString(Number(v.price_minor), v.currency));
}
function variantPriceMinor(v) {
	if (!v) return null;
	if (v.price_minor != null && !isNaN(Number(v.price_minor))) return Number(v.price_minor);
	if (v.display_price == null || isNaN(Number(v.display_price))) return null;
	const major = Number(v.display_price);
	return Math.round(isZeroDecimal(v.currency) ? major : major * 100);
}

export function normalizeProduct(product) {
	const p = product || {};
	const title = p.title || p.name || '';
	let images = (Array.isArray(p.images) ? p.images : []).filter(Boolean);
	if (images.length === 0 && p.image_url) images = [p.image_url];
	let variants = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && v.id);
	if (variants.length === 0 && p.variation_id) {
		variants = [{
			id: p.variation_id,
			title: title,
			price_minor: p.price_minor,
			currency: p.currency,
			display_price: p.display_price,
			image_url: p.image_url || ''
		}];
	}
	variants = variants.map((v) => ({
		...v,
		// ABSENT must mean buyable. `available` is not in the flat shape at all, and
		// reading a missing field as false is how an entire catalog renders sold
		// out. An explicit `false` is still honoured — that one the backend meant.
		available: v.available !== false,
		display_price: variantDisplayPrice(v),
		price_minor: variantPriceMinor(v)
	}));
	return { ...p, title, images, variants };
}

function defaultLabels(l) {
	l = l || {};
	return {
		add: l.add || 'Add to cart',
		added: l.added || 'Added ✓',
		soldOut: l.soldOut || 'Sold out',
		viewCart: l.viewCart || 'View cart',
		inCart: l.inCart || 'in cart',
		shop: l.shop || 'Shop',
		chooseOption: l.chooseOption || 'Option'
	};
}

/**
 * @param product normalized Product { processor, id, slug, title, description, images[], variants[] }
 * @param config  { guildId, siteId, apiBase, shopPath='/shop', canonical, siteName, labels }
 * @returns { title, headMeta, bodyHtml }
 */
export function renderProductPage(product, config) {
	config = config || {};
	const labels = defaultLabels(config.labels);
	const shopPath = config.shopPath || '/shop';
	// Both item-detail shapes enter here as one — see normalizeProduct above.
	const p = normalizeProduct(product);
	const images = p.images;
	const variants = p.variants;
	const first = variants[0] || {};
	const currency = first.currency || 'USD';
	const locale = config.locale || 'en-US';
	const heroImg = images[0] || '';
	const desc = (p.description || '').trim();

	// ── head: title + OG/Twitter + canonical + Product JSON-LD ──
	const title = `${p.title || 'Product'}${config.siteName ? ' — ' + config.siteName : ''}`;
	const ogDesc = desc || `${p.title || ''}`.trim();
	const schema = {
		'@context': 'https://schema.org',
		'@type': 'Product',
		name: p.title || '',
		description: ogDesc,
		image: images,
		offers: variants.map((v) => ({
			'@type': 'Offer',
			price: (v.price_minor != null && v.currency) ? centsToDecimalString(v.price_minor, v.currency) : undefined,
			priceCurrency: v.currency,
			availability: v.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
		}))
	};
	const headMeta = [
		`<title>${escHtml(title)}</title>`,
		ogDesc ? `<meta name="description" content="${escAttr(ogDesc)}">` : '',
		`<meta property="og:type" content="product">`,
		`<meta property="og:title" content="${escAttr(p.title || '')}">`,
		ogDesc ? `<meta property="og:description" content="${escAttr(ogDesc)}">` : '',
		heroImg ? `<meta property="og:image" content="${escAttr(heroImg)}">` : '',
		config.canonical ? `<meta property="og:url" content="${escAttr(config.canonical)}">` : '',
		`<meta name="twitter:card" content="${heroImg ? 'summary_large_image' : 'summary'}">`,
		`<meta name="twitter:title" content="${escAttr(p.title || '')}">`,
		ogDesc ? `<meta name="twitter:description" content="${escAttr(ogDesc)}">` : '',
		heroImg ? `<meta name="twitter:image" content="${escAttr(heroImg)}">` : '',
		config.canonical ? `<link rel="canonical" href="${escAttr(config.canonical)}">` : '',
		`<script type="application/ld+json">${jsonLd(schema)}</script>`
	].filter(Boolean).join('\n');

	// ── body ──
	const gallery = renderGallery(images, p.title || '');
	const variantControl = variants.length > 1 ? renderVariantSelector(variants, labels) : '';
	const buyDisabled = variants.length === 0;
	// The storefront's second locator, as a SIBLING of data-guild-id and never a replacement:
	// data-guild-id keeps exactly the characters it had, and this attribute is omitted ENTIRELY
	// when there is no site id — so a page built before site identity reached this file emits the
	// same bytes it always did. Which one the client USES is the guild-preferred rule in
	// shop-function-template.js#shopLocatorParam, applied below and in square-shop.js.
	const siteIdAttr = config.siteId ? `\n\tdata-site-id="${escAttr(config.siteId)}"` : '';
	const bodyHtml = `
<div class="dc-pp-wrap">
<nav class="dc-pp-crumb" aria-label="Breadcrumb"><a href="${escAttr(shopPath)}">${escHtml(labels.shop)}</a> <span>/</span> <span>${escHtml(p.title || '')}</span></nav>
<div class="dc-pp" data-dc-product
	data-guild-id="${escAttr(config.guildId || '')}"${siteIdAttr}
	data-shop-path="${escAttr(shopPath)}"
	data-variants="${escAttr(JSON.stringify(variants.map((v) => ({ id: v.id, price_minor: v.price_minor, currency: v.currency, available: !!v.available, image: v.image_url || '' }))))}">
	<div class="dc-pp-media">${gallery}</div>
	<div class="dc-pp-info">
		<h1 class="dc-pp-title">${escHtml(p.title || '')}</h1>
		<p class="dc-pp-price" data-dc-price>${escHtml(fmtPrice(first.display_price, currency, locale))}${taxInclusiveSuffix(currency, locale)}</p>
		${variantControl}
		<button type="button" class="dc-pp-add" data-dc-add ${buyDisabled ? 'disabled' : ''}>${escHtml(buyDisabled ? labels.soldOut : labels.add)}</button>
		<a class="dc-pp-cart" href="${escAttr(shopPath)}" data-dc-cartlink hidden></a>
		${desc ? `<div class="dc-pp-desc">${paragraphs(desc)}</div>` : ''}
	</div>
</div>
</div>
${renderStyles()}
${renderClientScript(labels, locale)}`.trim();

	return { title, headMeta, bodyHtml };
}

// The square-shop grid/card/cart CSS — so a server-rendered grid is styled on first paint (no FOUC);
// renderShopGrid returns it as `gridCss` for the worker to inject into the shell. Every value falls
// back so it looks right on a host that defines no --gd-* tokens. NOT exported: this file is
// concatenated into the CF Pages _worker.js, and a module worker rejects a non-function named export
// (the client widget square-shop.js keeps its own identical copy).
const SHOP_GRID_CSS = `
.dc-square-shop { font-family: inherit; }
/* CSS Grid, not flex-wrap: auto-fill + minmax(_,1fr) ALWAYS fills the row edge-to-edge (the column
   count it lands on gets stretched to consume 100% of the width) — no dead trailing gap, at ANY
   container width. flex-wrap + a fixed card width only looked even by coincidence: whichever width
   the host page happens to cap the grid at, the moment N cards' fixed width doesn't divide it
   exactly, the (N+1)th wraps and the row is left with unclaimed space (measured live: a 964px
   column fits 3 cards at a fixed 240px + gaps with 204px left over, empty, on the right). */
.dc-square-shop-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
.dc-square-shop-card { border-radius: var(--gd-radius, 16px); overflow: hidden; background: var(--gd-card-bg, #fff); border: 1px solid var(--gd-border, rgba(0,0,0,0.1)); box-shadow: 0 6px 18px var(--gd-card-shadow, rgba(0,0,0,0.08)); display: flex; flex-direction: column; transition: transform .15s, box-shadow .15s, border-color .15s; }
.dc-square-shop-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px var(--gd-card-shadow, rgba(0,0,0,0.14)); border-color: var(--gd-accent, currentColor); }
.dc-square-shop-img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: var(--gd-border, rgba(0,0,0,0.06)); }
.dc-square-shop-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.dc-square-shop-link { text-decoration: none; color: inherit; display: block; }
.dc-square-shop-link:hover .dc-square-shop-name { color: var(--gd-accent-text, var(--gd-accent-deep, var(--gd-accent, currentColor))); }
.dc-square-shop-card--link { text-decoration: none; color: inherit; }
.dc-square-shop-card--link:hover .dc-square-shop-name { color: var(--gd-accent-text, var(--gd-accent-deep, var(--gd-accent, currentColor))); }
.dc-square-shop-name { font-size: 14.5px; font-weight: 700; line-height: 1.3; margin: 0; color: var(--gd-text, inherit); }
/* margin-top:auto lives HERE (not on buy/stepper) so price + whatever follows it (the buy button, a
   stepper, or the "Choose options" chip) sit as ONE group pinned to the card's bottom edge — stable
   across cards whose name wraps to a different number of lines. */
.dc-square-shop-price { margin: 0; margin-top: auto; font-size: 13px; color: var(--gd-muted, rgba(0,0,0,0.6)); }
/* JPY tax-inclusive label (税込): smaller/muted vs the price it follows, regardless of what color
   the surrounding price text is already using (relative em size + its own muted token). */
.dc-tax-inclusive { color: var(--gd-muted, rgba(0,0,0,0.6)); font-size: 0.75em; font-weight: normal; margin-left: 0.35em; }
/* font: inherit (not just font-family) on every control below — form elements don't inherit ANY
   font property by default, including line-height (UA stylesheets set button/select to their own
   font AND "line-height: normal"), so without this every one of these silently rendered off-theme
   AND a few px shorter than a themed element of the same padding. Caught by comparing a real
   <button> against a plain <span> made to look like one (the multi-variant "Choose options" chip)
   — same class, visibly different height. font-size/font-weight below still win (later in the
   same rule), so this only backfills family + line-height. */
.dc-square-shop-buy { font: inherit; text-align: center; border: none; border-radius: var(--gd-pill, 999px); padding: 10px 16px; font-size: 13.5px; font-weight: 700; cursor: pointer; background: var(--gd-accent-deep, var(--gd-accent, #0b5f6b)); color: var(--gd-accent-ink, #fff); transition: background .15s, transform .15s; }
.dc-square-shop-buy:hover:not(:disabled) { background: var(--gd-accent, #0d7280); transform: translateY(-1px); }
.dc-square-shop-buy:disabled { opacity: 0.55; cursor: not-allowed; }
.dc-square-shop-empty, .dc-square-shop-error { font-size: 13.5px; color: var(--gd-muted, rgba(0,0,0,0.6)); padding: 8px 0; }
.dc-square-shop-layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.dc-square-shop-layout > .dc-square-shop-grid { flex: 1 1 360px; justify-content: flex-start; }
.dc-square-shop-layout--hosted-cart > .dc-square-shop-grid { flex-basis: 100%; }
.dc-square-shop-layout--hosted-cart > .dc-square-shop-cart { display: none; }
.dc-square-shop-stepper { display: flex; align-items: center; gap: 8px; }
.dc-square-shop-card .dc-square-shop-stepper { padding-top: 10px; justify-content: center; }
.dc-square-shop-step { font: inherit; width: 28px; height: 28px; flex: 0 0 auto; border-radius: var(--gd-pill, 999px); border: 1px solid var(--gd-border, rgba(0,0,0,0.14)); background: var(--gd-soft, rgba(0,0,0,0.03)); color: var(--gd-text, inherit); font-size: 15px; line-height: 1; font-weight: 700; cursor: pointer; transition: border-color .15s, background .15s; }
.dc-square-shop-step:hover { border-color: var(--gd-accent, currentColor); }
.dc-square-shop-qty { min-width: 1.5em; text-align: center; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--gd-text, inherit); }
.dc-square-shop-cart { flex: 1 1 260px; max-width: 340px; align-self: flex-start; position: sticky; top: 16px; border-radius: var(--gd-radius, 16px); background: var(--gd-card-bg, #fff); border: 1px solid var(--gd-border, rgba(0,0,0,0.1)); box-shadow: 0 6px 18px var(--gd-card-shadow, rgba(0,0,0,0.08)); padding: 20px 20px 22px; }`;

/**
 * Server-render the /shop product GRID — the SAME structure square-shop.js builds on the client, so
 * the widget can HYDRATE it (wire buttons + apply the localStorage cart) instead of rebuilding from
 * scratch. Pure: runs in the CF Pages Function (edge, per request → instant first paint + SEO) and in
 * Node tests. Renders the empty-cart state (every card shows Add/Buy); on hydration the client swaps
 * Add→stepper for items already in the shopper's localStorage cart. `data-ssr="1"` on the grid is the
 * hydration marker; `data-variation-id` on each card lets the client wire without a re-fetch.
 * @param items  catalog list items { variation_id, name, slug, image_url, display_price, currency, buy_label, add_label }
 * @param config { detailBase='', cart=false, labels:{ add, buy } }
 * @returns { gridHtml, gridCss }  — inject into the coral root; gridCss into the shell so first paint is styled
 */
export function renderShopGrid(items, config) {
	config = config || {};
	const detailBase = config.detailBase || '';
	const L = config.labels || {};
	const locale = config.locale || 'en-US';
	const cartMode = !!config.cart;
	const noSidebar = !!config.noSidebar;   // data-cart="header": full-width grid, panel hosted in header drawer
	const list = (Array.isArray(items) ? items : []).filter((it) => it && it.variation_id);

	const card = (it) => {
		const href = detailBase && it.slug ? `${detailBase}/${encodeURIComponent(it.slug)}` : '';
		// `name` is the flat field every backend has always sent; `title` is the richer one RSP
		// added beside it. Reading both is what keeps a card from rendering blank against either.
		const label = it.name || it.title || '';
		const img = it.image_url
			? `<img class="dc-square-shop-img" src="${escHtml(it.image_url)}" alt="${escHtml(label)}" loading="lazy">`
			: '';
		const nameInner = `<p class="dc-square-shop-name">${escHtml(label)}</p>`;
		const variants = Array.isArray(it.variants) ? it.variants : [];
		const variantCount = variants.length || 1;
		const vid = it.variation_id || (variants[0] && variants[0].id) || '';
		const curAttr = it.currency ? ` data-currency="${escAttr(it.currency)}"` : '';
		const slugAttr = it.slug ? ` data-slug="${escAttr(it.slug)}"` : '';

		// Multiple variants (e.g. postcard sets with a per-design pick): adding the DEFAULT variant
		// straight from the grid would silently cart something the shopper never chose. Route to the
		// product page instead — whole card is one link (real, keyboard-reachable, no nested buttons),
		// price shows the variant range so "$5~$12" isn't mistaken for one fixed price.
		if (variantCount > 1 && href) {
			const prices = variants.map(variantDisplayPrice).filter((n) => n != null && !isNaN(n));
			const min = prices.length ? Math.min(...prices) : it.display_price;
			const max = prices.length ? Math.max(...prices) : it.display_price;
			const priceText = min == null ? '' : (max === min ? fmtPrice(min, it.currency, locale) : `${fmtPrice(min, it.currency, locale)}~${fmtPrice(max, it.currency, locale)}`);
			const priceAttr = min == null ? '' : ` data-price="${escAttr(String(min))}" data-price-min="${escAttr(String(min))}"` + (max != null ? ` data-price-max="${escAttr(String(max))}"` : '');
			return `<a class="dc-square-shop-card dc-square-shop-card--link" data-variation-id="${escAttr(vid)}" data-variant-count="${variantCount}"${priceAttr}${curAttr}${slugAttr} href="${escHtml(href)}">`
				+ img
				+ `<div class="dc-square-shop-body">`
				+ nameInner
				+ `<p class="dc-square-shop-price">${escHtml(priceText)}${taxInclusiveSuffix(it.currency, locale)}</p>`
				+ `<span class="dc-square-shop-buy">${escHtml(L.chooseOptions || 'Choose options')}</span>`
				+ `</div></a>`;
		}

		const btn = escHtml((cartMode ? (it.add_label || L.add || 'Add to cart') : (it.buy_label || L.buy || 'Buy')));
		// Embed the data the client needs to hydrate WITHOUT a re-fetch: price/currency for the cart
		// panel + checkout, slug for detail links. Name comes from the card's own text.
		const priceAttr = it.display_price == null ? '' : ` data-price="${escAttr(String(it.display_price))}"`;
		return `<div class="dc-square-shop-card" data-variation-id="${escAttr(vid)}"${priceAttr}${curAttr}${slugAttr}>`
			+ (href ? `<a class="dc-square-shop-link" href="${escHtml(href)}">${img}</a>` : img)
			+ `<div class="dc-square-shop-body">`
			+ (href ? `<a class="dc-square-shop-link" href="${escHtml(href)}">${nameInner}</a>` : nameInner)
			+ `<p class="dc-square-shop-price">${escHtml(fmtPrice(it.display_price, it.currency, locale))}${taxInclusiveSuffix(it.currency, locale)}</p>`
			+ `<button type="button" class="dc-square-shop-buy">${btn}</button>`
			+ `</div></div>`;
	};

	const grid = `<div class="dc-square-shop-grid" data-ssr="1">${list.map(card).join('')}</div>`;
	// cart mode = grid + an empty cart panel inside the layout (the client fills the panel from
	// localStorage; the header-actions-cart island relocates .dc-square-shop-cart into the header
	// drawer). instant mode = grid alone.
	const gridHtml = cartMode
		? `<div class="dc-square-shop-layout${noSidebar ? ' dc-square-shop-layout--hosted-cart' : ''}">${grid}<div class="dc-square-shop-cart"></div></div>`
		: grid;
	return { gridHtml, gridCss: SHOP_GRID_CSS };
}

function centsToDecimalString(minor, currency) {
	// zero-decimal currencies keep integer; others /100. (display only — schema)
	if (isZeroDecimal(currency)) return String(minor);
	return (minor / 100).toFixed(2);
}

function renderGallery(images, alt) {
	if (images.length === 0) return `<div class="dc-pp-img dc-pp-img--empty"></div>`;
	const main = `<img class="dc-pp-img" data-dc-main src="${escAttr(images[0])}" alt="${escAttr(alt)}">`;
	if (images.length === 1) return main;
	const thumbs = images
		.map((u, i) => `<button type="button" class="dc-pp-thumb${i === 0 ? ' is-active' : ''}" data-dc-thumb data-src="${escAttr(u)}"><img src="${escAttr(u)}" alt="" loading="lazy"></button>`)
		.join('');
	return `${main}<div class="dc-pp-thumbs">${thumbs}</div>`;
}

function renderVariantSelector(variants, labels) {
	const opts = variants
		.map((v, i) => `<option value="${escAttr(v.id)}"${i === 0 ? ' selected' : ''}${v.available ? '' : ' disabled'}>${escHtml(v.title || labels.chooseOption)}</option>`)
		.join('');
	return `<label class="dc-pp-variant"><span>${escHtml(labels.chooseOption)}</span><span class="dc-pp-variant-field"><select data-dc-variant>${opts}</select></span></label>`;
}

function paragraphs(text) {
	return String(text)
		.split(/\n{2,}/)
		.map((para) => `<p>${escHtml(para).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

function renderStyles() {
	return `<style>
/* contain the product page to the site's content rhythm — the Function injects this into the
   shell's full-bleed <main>, so without a wrapper the content glues to the viewport edges while
   the site header/footer stay padded. max-width + auto margins + matching side padding = a proper
   page of the seller's site (mirrors sitetile's .st-embed gutters). */
.dc-pp-wrap { max-width: 60rem; margin-inline: auto; padding: 2rem clamp(1rem, 4vw, 3rem); box-sizing: border-box; }
.dc-pp-crumb { font-size: 13px; color: var(--gd-muted, rgba(0,0,0,.55)); margin: 0 0 18px; }
.dc-pp-crumb a { color: inherit; }
.dc-pp { display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; }
.dc-pp-media { flex: 1 1 320px; max-width: 480px; }
.dc-pp-img { width: 100%; aspect-ratio: 1/1; object-fit: contain; border-radius: var(--gd-radius, 16px); background: var(--gd-soft, rgba(0,0,0,.05)); }
/* loading skeleton: shimmer over the placeholder until the photo paints (.is-loaded set by the
   client script on load). The opaque photo covers it once ready. */
.dc-pp-img:not(.is-loaded) { background-image: linear-gradient(100deg, transparent 20%, rgba(128,128,128,.22) 50%, transparent 80%); background-size: 220% 100%; animation: dc-pp-shimmer 1.15s linear infinite; }
@keyframes dc-pp-shimmer { from { background-position: 220% 0; } to { background-position: -220% 0; } }
@media (prefers-reduced-motion: reduce) { .dc-pp-img:not(.is-loaded) { animation: none; } }
.dc-pp-img--empty { display: block; }
.dc-pp-thumbs { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.dc-pp-thumb { width: 64px; height: 64px; padding: 0; border: 2px solid transparent; border-radius: var(--gd-radius, 10px); cursor: pointer; background: none; }
.dc-pp-thumb.is-active { border-color: var(--gd-accent, currentColor); }
.dc-pp-thumb img { width: 100%; height: 100%; object-fit: contain; background: var(--gd-soft, rgba(0,0,0,.05)); }
.dc-pp-info { flex: 1 1 280px; }
.dc-pp-title { font-size: 26px; font-weight: 800; line-height: 1.2; margin: 0 0 8px; color: var(--gd-text, inherit); }
.dc-pp-price { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 0 0 18px; color: var(--gd-text, inherit); }
/* JPY tax-inclusive label (税込): smaller/muted vs the price it follows, regardless of what color
   the surrounding price text is already using (relative em size + its own muted token). */
.dc-tax-inclusive { color: var(--gd-muted, rgba(0,0,0,.6)); font-size: 0.75em; font-weight: normal; margin-left: 0.35em; }
.dc-pp-variant { position: relative; display: flex; flex-direction: column; gap: 6px; margin: 0 0 18px; font-size: 13px; font-weight: 600; color: var(--gd-muted, rgba(0,0,0,.6)); }
/* styled native select: strip the OS chrome (appearance:none) and draw our own chevron so it matches
   the site instead of the grey system dropdown. The chevron is a currentColor border-triangle on the
   wrapper, so it follows --gd-muted (theme + dark mode) with no per-scheme icon. */
.dc-pp-variant select { font: inherit; appearance: none; -webkit-appearance: none; width: 100%; padding: 11px 38px 11px 13px; border-radius: var(--gd-radius, 10px); border: 1px solid var(--gd-border, rgba(0,0,0,.15)); background: var(--gd-card-bg, #fff); color: var(--gd-text, inherit); cursor: pointer; transition: border-color .15s; }
.dc-pp-variant select:hover { border-color: var(--gd-accent, currentColor); }
.dc-pp-variant select:focus-visible { outline: 2px solid var(--gd-accent, currentColor); outline-offset: 1px; }
/* chevron: a lucide chevron-down as a MASK (not a border-triangle) so it's a real, correctly-
   proportioned glyph that centres on the select by geometry — no magic offset that drifts with
   control size. Colour still rides var(--gd-muted) via background-color + mask, so it follows theme
   + dark mode exactly like the old border did. On a wrapper around ONLY the select, so top:50% is
   the select's middle (not the label+select stack's). */
.dc-pp-variant-field { position: relative; display: block; }
.dc-pp-variant-field::after {
	content: ''; position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
	width: 16px; height: 16px; pointer-events: none; background-color: var(--gd-muted, currentColor);
	-webkit-mask: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='m6%209%206%206%206-6'/%3E%3C/svg%3E") center / contain no-repeat;
	mask: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20fill='none'%20stroke='%23000'%20stroke-width='2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='m6%209%206%206%206-6'/%3E%3C/svg%3E") center / contain no-repeat;
}
.dc-pp-add { font: inherit; border: none; border-radius: var(--gd-pill, 999px); padding: 13px 22px; font-size: 14px; font-weight: 800; cursor: pointer; background: var(--gd-accent-deep, var(--gd-accent, #0b5f6b)); color: var(--gd-accent-ink, #fff); transition: background .15s, transform .15s; }
.dc-pp-add:hover:not(:disabled) { transform: translateY(-1px); }
.dc-pp-add:disabled { opacity: .5; cursor: not-allowed; }
.dc-pp-cart { display: inline-block; margin-left: 14px; font-size: 13.5px; font-weight: 700; color: var(--gd-accent-deep, var(--gd-accent, currentColor)); }
.dc-pp-desc { margin-top: 22px; font-size: 14.5px; line-height: 1.6; color: var(--gd-text, inherit); }
.dc-pp-desc p { margin: 0 0 12px; }
@media (max-width: 640px) {
  .dc-pp-add, .dc-pp-variant select { min-height: 44px; }
}
</style>`;
}

function renderClientScript(labels, locale) {
	// Self-contained; shares the grid widget's localStorage cart key so a product
	// page and /shop are ONE cart. Checkout stays on /shop.
	return `<script type="module">
const PREFIX = ${JSON.stringify(CART_STORE_PREFIX)};
const L = ${JSON.stringify({ inCart: labels.inCart, viewCart: labels.viewCart, added: labels.added })};
const LOCALE = ${JSON.stringify(locale)};
const root = document.querySelector('[data-dc-product]');
if (root) {
	const guildId = root.getAttribute('data-guild-id') || '';
	const siteId = root.getAttribute('data-site-id') || '';
	const shopPath = root.getAttribute('data-shop-path') || '/shop';
	let variants = [];
	try { variants = JSON.parse(root.getAttribute('data-variants') || '[]'); } catch {}
	const byId = new Map(variants.map((v) => [v.id, v]));
	const sel = root.querySelector('[data-dc-variant]');
	const priceEl = root.querySelector('[data-dc-price]');
	const addBtn = root.querySelector('[data-dc-add]');
	const cartLink = root.querySelector('[data-dc-cartlink]');
	// The cart key. WITH a guild it is byte-for-byte the key it has always been — moving it would
	// empty every existing shopper's basket the next time they opened the shop. The site id is the
	// key only for a site that has no guild, which had no basket to lose.
	const key = PREFIX + (guildId || siteId);
	function fmt(minor, cur) { const code=String(cur||'USD').toUpperCase(); try { const p=new Intl.NumberFormat(LOCALE,{style:'currency',currency:code,currencyDisplay:'narrowSymbol'}); const s=(p.formatToParts(0).find(x=>x.type==='currency')||{}).value; const lang=String(LOCALE).toLowerCase().split('-')[0]; const own=(lang==='ja'&&code==='JPY')||(lang==='zh'&&code==='CNY'); return new Intl.NumberFormat(LOCALE,{style:'currency',currency:code,currencyDisplay:s==='$'||((s==='¥'||s==='￥')&&!own)?'code':'symbol'}).format(zero(code)?minor:minor/100).replace(/￥/g,'¥'); } catch { return (minor) + ' ' + code; } }
	function zero(c) { return ['JPY','KRW','VND','CLP','ISK','HUF'].indexOf(String(c).toUpperCase()) >= 0; }
	// JP sellers show ONE tax-inclusive price — currency is only ever compared to the literal
	// 'JPY', never interpolated, so no catalog-controlled string reaches innerHTML. The WORD
	// itself (0.11.10, finding #15) follows LOCALE — the same bucketing taxWord() in this file's
	// own module scope uses for the SSR half, kept in sync by hand since this copy has to be a
	// self-contained string of JS (it ships AS TEXT inside the page, not as a function call).
	function taxWord(loc) { const l=String(loc||'').toLowerCase(); if (l.indexOf('ja')===0) return '税込'; if (l.indexOf('zh')===0) return (l.indexOf('hans')>=0||/-(cn|sg)(-|$)/.test(l))?'含税':'含稅'; return 'incl. tax'; }
	function taxSuffix(cur) { return String(cur).toUpperCase() === 'JPY' ? '<small class="dc-tax-inclusive">' + taxWord(LOCALE) + '</small>' : ''; }
	function current() { return sel ? byId.get(sel.value) : variants[0]; }
	function loadCart() { try { const r = localStorage.getItem(key); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; } catch { return []; } }
	function cartCount() { return loadCart().reduce((n, e) => n + (Array.isArray(e) ? (parseInt(e[1], 10) || 0) : 0), 0); }
	// A site with the header cart wired (badge + drawer/redirect, site-wide) already gives this page
	// a cart entry point — this inline link would just be a second, redundant one. Sites WITHOUT the
	// header cart toggle have no other way off this page to their cart, so keep it working for them.
	var hasHeaderCart = !!document.querySelector('.rf-header-actions[data-cart-guild]');
	function refreshCartLink() {
		if (hasHeaderCart) { cartLink.hidden = true; return; }
		const n = cartCount(); if (n > 0) { cartLink.textContent = n + ' ' + L.inCart + ' · ' + L.viewCart + ' →'; cartLink.setAttribute('href', shopPath); cartLink.hidden = false; } else { cartLink.hidden = true; }
	}
	function updatePrice() { const v = current(); if (v && priceEl) priceEl.innerHTML = fmt(v.price_minor, v.currency) + taxSuffix(v.currency); }
	// image loading skeleton: drop the shimmer once the photo is painted (and on every swap)
	const mainImg = root.querySelector('[data-dc-main]');
	function onLoaded(img) { if (img) img.classList.add('is-loaded'); }
	function trackLoad(img) { if (!img) return; if (img.complete && img.naturalWidth > 0) onLoaded(img); else img.addEventListener('load', () => onLoaded(img), { once: true }); }
	trackLoad(mainImg);
	// Single source of truth for the shown image: 'committed' is where the page rests (last thumb
	// click or variant pick); hover-scrub previews transiently and snaps back here on mouse-leave.
	let committed = mainImg ? (mainImg.getAttribute('src') || '') : '';
	const allThumbs = [].slice.call(root.querySelectorAll('[data-dc-thumb]'));
	function swapMain(src) { if (mainImg && src && mainImg.getAttribute('src') !== src) { mainImg.classList.remove('is-loaded'); mainImg.setAttribute('src', src); trackLoad(mainImg); } }
	function syncThumbActive(src) { allThumbs.forEach((x) => x.classList.toggle('is-active', x.getAttribute('data-src') === src)); }
	function commitImage(src) { if (!src) return; committed = src; swapMain(src); syncThumbActive(src); }
	allThumbs.forEach((t) => t.addEventListener('click', () => commitImage(t.getAttribute('data-src'))));
	// variant pick → show that variation's image (Square per-variation image_ids); no image ⇒ keep current.
	if (sel) sel.addEventListener('change', () => { updatePrice(); const v = current(); if (v && v.image) commitImage(v.image); });
	// hover-scrub preview: moving across the MAIN IMAGE ITSELF previews each gallery image by
	// x-position — a desktop nicety gated on hover-capable pointers (touch keeps the thumbnails,
	// the accessible path). Bound to mainImg, not the wrapping .dc-pp-media (which also contains the
	// thumbs strip below) — binding to the wrapper made the thumbs' own hover fight this handler and
	// miscalculated the index once the cursor left the image's rect. Also gated on .is-loaded so
	// scrubbing can't kick in over the loading shimmer. Reverts to the committed image on mouse-leave.
	(function () {
		if (!mainImg || allThumbs.length < 2 || !(window.matchMedia && window.matchMedia('(hover: hover)').matches)) return;
		function markActive(i) { allThumbs.forEach(function (x) { x.classList.remove('is-active'); }); if (allThumbs[i]) allThumbs[i].classList.add('is-active'); }
		mainImg.addEventListener('mousemove', function (e) {
			if (!mainImg.classList.contains('is-loaded')) return;
			var r = mainImg.getBoundingClientRect(); if (!r.width) return;
			var i = Math.floor(((e.clientX - r.left) / r.width) * allThumbs.length);
			i = Math.max(0, Math.min(allThumbs.length - 1, i));
			swapMain(allThumbs[i].getAttribute('data-src')); markActive(i);
		});
		mainImg.addEventListener('mouseleave', function () { swapMain(committed); syncThumbActive(committed); });
	})();
	if (addBtn) addBtn.addEventListener('click', () => {
		const v = current(); if (!v) return;
		const cart = loadCart(); const found = cart.find((e) => Array.isArray(e) && e[0] === v.id);
		if (found) found[1] = Math.min(99, (parseInt(found[1], 10) || 0) + 1); else cart.push([v.id, 1]);
		try { localStorage.setItem(key, JSON.stringify(cart)); } catch {}
		// Same-tab localStorage writes don't fire the 'storage' event on THIS window (only other
		// tabs get that) — this custom event is what lets the header cart badge react on this same
		// page load. header-actions-cart.js listens for it.
		try { window.dispatchEvent(new CustomEvent('dc-cart-changed')); } catch {}
		refreshCartLink();
		// transient feedback so an add registers even for a shopper who never opens the cart
		const original = addBtn.textContent;
		addBtn.textContent = L.added;
		addBtn.disabled = true;
		clearTimeout(addBtn._dcResetTimer);
		addBtn._dcResetTimer = setTimeout(() => { addBtn.textContent = original; addBtn.disabled = false; }, 1200);
	});
	refreshCartLink();
}
</script>`;
}
