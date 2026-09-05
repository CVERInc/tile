// square-shop 0.11.3 — every surface that prints a price must print the SAME price: the SSR grid
// card, the client grid card, and (new in 0.11.3) the cart panel's own line prices and total.
//
// 🩸 Why this file exists. 0.11.1 added the JPY tax-inclusive label (税込) to product-page-core.js
// and nowhere else, and tile-lab PR #10 measured the consequence: the published registry artifact
// was byte-identical to 0.11.0, because square-shop is a `bundle: false` coral and build.mjs only
// STAMPS square-shop.js. The rule shipped in a file the registry does not serve.
//
// Worse than "the pin doesn't carry it": every render path in square-shop.js opens with
// `root.innerHTML = ''` and rebuilds the grid from the SSR card's data-* attributes. So even on a
// page where the edge worker DID render 税込, hydration wiped it a moment later. A shop pointed
// straight at RSP via data-api-base never saw it at all.
//
// 🔴 So this is a PARITY test, not an existence test. It runs the two renderers over one fixture
// and compares their price paragraphs byte-for-byte. A string-existence check would have passed
// on a client that emitted the label with a different class, a different tag, or in a different
// place — and a shopper would still have seen two different prices depending on how fast the
// script loaded. Control: reverting either side's suffix reddens this, which is more than could be
// said for the suite that was green throughout 0.11.1.
//
// 🔴 The square-shop.js import comes FIRST — it self-mounts when a `document` exists at load time,
// so the stub is installed after the module has already been evaluated. (Same reason, same order,
// as checkout-ref.test.mjs.)
import {
	itemCard,
	withVariantSummary,
	readLabels,
	taxInclusiveSuffix,
	renderCart,
	cartLinePriceHtml,
	subtotalLabel
} from './square-shop.js';
import { renderShopGrid } from './product-page-core.js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

// ── the smallest DOM itemCard() and renderCart() actually touch ──────────
// They only ever createElement()s, assign className/href/innerHTML/textContent, wire listeners we
// never fire, and read a child back with querySelector. Comparing card.innerHTML against the SSR
// string is the whole point, so nothing here parses HTML — that would introduce a second,
// differently-lenient reader of the very bytes under test.
function fakeElement(tag) {
	return {
		tagName: tag, className: '', href: '', type: '', innerHTML: '', textContent: '',
		hidden: false, disabled: false, parentElement: null,
		attrs: {}, children: [],
		setAttribute(k, v) { this.attrs[k] = String(v); },
		getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
		addEventListener() {},
		appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
		append(...kids) { for (const k of kids) this.appendChild(k); },
		querySelector(sel) {
			const cls = sel.replace(/^\./, '');
			for (const c of this.children) if (String(c.className).split(/\s+/).indexOf(cls) >= 0) return c;
			// itemCard() builds a card's subtree by assigning an innerHTML STRING, which a real DOM
			// parses into children and this object does not. Rather than give this file a second HTML
			// reader, hand back a sink when the markup says the node is there: renderGrid's only use
			// of it is appending a Buy/Add control, and nothing below asserts about that control. A
			// selector that is in NEITHER the children nor the markup still returns null.
			return String(this.innerHTML).includes(`class="${cls}"`) ? fakeElement('div') : null;
		}
	};
}
globalThis.document = { createElement: fakeElement };

// renderCart() reads the persisted cart, and consumeCheckoutReturn() reads the URL. Both are
// wrapped in try/catch in the source, so a missing window would look like "empty cart" rather than
// like a broken test — which is exactly the silence this file exists to refuse.
const localStore = new Map();
globalThis.window = {
	location: { href: 'https://shop.test/shop', origin: 'https://shop.test', pathname: '/shop' },
	history: { replaceState() {} },
	dispatchEvent() {},
	localStorage: {
		getItem: (k) => (localStore.has(k) ? localStore.get(k) : null),
		setItem: (k, v) => { localStore.set(k, String(v)); },
		removeItem: (k) => { localStore.delete(k); }
	}
};

const localeElement = fakeElement('div');
localeElement.setAttribute('data-locale', 'ja-JP');
const LABELS = readLabels(localeElement);
const DETAIL_BASE = '/shop';
const PRICE_P = /<p class="dc-square-shop-price">[\s\S]*?<\/p>/g;

// The client renders card-by-card; the SSR renders the whole grid. Pull the price paragraphs out of
// each in document order and line them up.
function ssrPrices(items) {
	const { gridHtml } = renderShopGrid(items, { cart: false, detailBase: DETAIL_BASE, labels: {}, locale: LABELS.locale });
	return gridHtml.match(PRICE_P) || [];
}
function clientPrices(items) {
	return items.map((raw) => {
		const html = itemCard(withVariantSummary(raw), LABELS, DETAIL_BASE).innerHTML;
		return (html.match(PRICE_P) || [])[0] || '(no price paragraph)';
	});
}

// ── the fixture ──────────────────────────────────────────────────────────
// Same shapes shop-grid-core.test.mjs uses, so the two files cannot drift into describing
// different catalogs: a JPY single price, a JPY multi-variant range, and a USD control.
const JPY_SINGLE = { variation_id: 'JV1', name: 'Doodle Book #1', slug: 'doodle-book-1', image_url: 'https://x/doodle.jpg', display_price: 1400, currency: 'JPY' };
const JPY_RANGE = {
	variation_id: 'JV2', name: 'Postcard Set', slug: 'postcard-set', image_url: 'https://x/pc.jpg', currency: 'JPY',
	variants: [{ id: 'a', display_price: 500, currency: 'JPY' }, { id: 'b', display_price: 900, currency: 'JPY' }]
};
const USD_SINGLE = { variation_id: 'V1', name: 'Apron Set', slug: 'apron-set', image_url: 'https://x/a.jpg', display_price: 40, currency: 'USD' };

const items = [JPY_SINGLE, JPY_RANGE, USD_SINGLE];
const ssr = ssrPrices(items);
const client = clientPrices(items);

ok('both renderers produced one price paragraph per item', ssr.length === 3 && client.length === 3,
	`ssr=${ssr.length} client=${client.length}`);

const NAMES = ['JPY single', 'JPY multi-variant range', 'USD control'];
for (let i = 0; i < NAMES.length; i++) {
	ok(`${NAMES[i]}: client price paragraph is BYTE-IDENTICAL to the SSR one`,
		client[i] === ssr[i], `\n      ssr:    ${ssr[i]}\n      client: ${client[i]}`);
}

// The parity assertions above are satisfied by BOTH sides being wrong together, so pin what the
// answer actually is. These literals are the ones shop-grid-core.test.mjs already pins for the SSR
// side — repeated here so a client that agrees with a broken SSR is still red.
ok('JPY single: label sits right after the price, inside the same <p>',
	client[0] === '<p class="dc-square-shop-price">¥1,400<small class="dc-tax-inclusive">税込</small></p>', client[0]);
ok('JPY range: label appears ONCE at the end, never after both bounds',
	client[1] === '<p class="dc-square-shop-price">¥500~¥900<small class="dc-tax-inclusive">税込</small></p>'
	&& !client[1].includes('税込~'), client[1]);
ok('USD control: no Japanese label and the ambiguous currency is named',
	client[2].includes('USD') && !client[2].includes('税込'), client[2]);

// A currency the helper has never been told about must be treated as "not JPY", not as "unknown, so
// guess" — and the comparison is case-insensitive because a catalog may send `jpy`.
//
// 0.11.10 (finding #15, 2026-09-03 cold-read): `taxInclusiveSuffix` no longer hard-codes the word —
// it prints whatever `taxWord` it is handed (the caller's `labels.taxIncluded`), so the WORD is
// exercised through the locale table below, and this is only "does the WRAPPING/currency-gate still
// hold" — non-JPY still empty regardless of what taxWord would have been.
ok('taxInclusiveSuffix: JPY yes, jpy yes, everything else no',
	taxInclusiveSuffix('JPY', '税込').includes('税込') && taxInclusiveSuffix('jpy', '税込').includes('税込')
	&& taxInclusiveSuffix('USD', '税込') === '' && taxInclusiveSuffix('', '税込') === '' && taxInclusiveSuffix(null, '税込') === '');

// ── the cart panel (0.11.3) ──────────────────────────────────────────────
// 🩸 0.11.2 shipped the label on both grid surfaces and left the basket out, and PROVENANCE says
// why it was left: the SSR core renders an EMPTY cart panel, so there was no server markup for the
// cart to disagree with. That is also why "extend the parity test" cannot mean "render the cart on
// both sides". The parity that exists here is between the cart LINE and the CARD: a shopper sees
// ¥1,400税込 on the card and must not see a bare ¥2,800 for two of them in the basket beside it.
// So the cart line is held against what the SSR grid prints for the same amount — three surfaces,
// one price display.
//
// 🔴 And it is driven through the REAL renderCart, not through cartLinePriceHtml alone. A helper
// that is exported, correct and tested while renderPanel keeps assigning textContent is a green
// light over an unchanged bug — which is the precise shape of the 0.11.1 defect this file was born
// from. Control: putting `price.textContent = formatPrice(...)` back reddens the two line-price
// assertions below and nothing else.
const JPY_SINGLE_2 = { variation_id: 'JV3', name: 'Sticker Sheet', slug: 'sticker-sheet', image_url: 'https://x/st.jpg', display_price: 660, currency: 'JPY' };
const GUILD = 'G1';

function cartPanel(rawItems, entries) {
	localStore.set(`dc-square-shop-cart:${GUILD}`, JSON.stringify(entries));
	const root = fakeElement('div');
	renderCart(root, rawItems.map(withVariantSummary), 'https://api.test', GUILD, LABELS, false, DETAIL_BASE, new Map());
	return root.children[0].children[1]; // layout → [grid, panel]
}
function childByClass(node, cls) {
	return node.children.find((c) => String(c.className).split(/\s+/).indexOf(cls) >= 0) || null;
}
function linePrices(panel) {
	const lines = childByClass(panel, 'dc-square-shop-cart-lines');
	return lines ? lines.children.map((l) => childByClass(l, 'dc-square-shop-line-price')) : [];
}
function classesOf(panel) {
	return panel.children.map((c) => c.className);
}

const jpyPanel = cartPanel([JPY_SINGLE, JPY_SINGLE_2], [['JV1', 2], ['JV3', 1]]);
const jpyLines = linePrices(jpyPanel);
const jpyTotal = childByClass(jpyPanel, 'dc-square-shop-cart-total');
const jpySub = childByClass(jpyPanel, 'dc-square-shop-cart-subtotal');

ok('cart rendered one line per basket entry', jpyLines.length === 2 && jpyLines.every(Boolean),
	`got ${jpyLines.length}`);

// The parity assertion. ¥2,800 is 2 × the ¥1,400 card above it; the SSR grid is asked to print that
// same amount, and the two must be the same bytes inside the price element.
const ssrForLineAmount = ssrPrices([{ ...JPY_SINGLE, variation_id: 'JV9', display_price: 2800 }])[0];
ok('JPY cart line: price markup is BYTE-IDENTICAL to what the SSR grid prints for the same amount',
	`<p class="dc-square-shop-price">${jpyLines[0].innerHTML}</p>` === ssrForLineAmount,
	`\n      ssr:  ${ssrForLineAmount}\n      cart: ${jpyLines[0].innerHTML}`);

// Both sides agreeing is satisfied by both sides being wrong, so pin the answer too.
ok('JPY cart line: ¥2,800 followed by the card\'s own 税込 markup',
	jpyLines[0].innerHTML === '¥2,800<small class="dc-tax-inclusive">税込</small>', jpyLines[0].innerHTML);
ok('JPY cart line: the second line is labelled too, not just the first',
	jpyLines[1].innerHTML === '¥660<small class="dc-tax-inclusive">税込</small>', jpyLines[1].innerHTML);

// 🔴 The total states its tax status in the LABEL. If it ALSO carried the suffix the row would say
// 税込 twice, which is why this asserts both halves — the label is there AND the amount is bare.
ok('JPY total: the label row says 合計（税込）', jpySub && jpySub.textContent === '合計（税込）',
	jpySub ? jpySub.textContent : '(no label node)');
ok('JPY total: the amount itself is the plain sum, with no second 税込 hanging off it',
	jpyTotal.textContent === '¥3,460', jpyTotal.textContent);
ok('JPY panel: label sits immediately above the amount it labels',
	classesOf(jpyPanel).indexOf('dc-square-shop-cart-subtotal') >= 0
	&& classesOf(jpyPanel).indexOf('dc-square-shop-cart-subtotal') + 1 === classesOf(jpyPanel).indexOf('dc-square-shop-cart-total'),
	classesOf(jpyPanel).join(' · '));

// An empty JPY basket still shows a total (¥0) — so it still has to say what that total includes.
const jpyEmpty = cartPanel([JPY_SINGLE], []);
ok('JPY empty cart: still labelled 合計（税込）, and the hint still follows the total',
	(childByClass(jpyEmpty, 'dc-square-shop-cart-subtotal') || {}).textContent === '合計（税込）'
	// 0.11.10 (finding #12): the panel grew one more trailing node, the localized Square-hosted-page
	// note — present here because LABELS (locale ja-JP) carries a non-empty default checkoutNote.
	&& classesOf(jpyEmpty).join(' ') === 'dc-square-shop-cart-h dc-square-shop-cart-subtotal dc-square-shop-cart-total dc-square-shop-cart-hint dc-square-shop-checkout dc-square-shop-checkout-note',
	classesOf(jpyEmpty).join(' · '));

// ── the non-JPY control ──────────────────────────────────────────────────
// Not "no 税込" — the whole node list, in order. This is the assertion that says a USD panel is the
// panel it was before 0.11.3 (plus the 0.11.10 checkout-note, LABELS default being non-empty) and
// not merely one that happens to carry no Japanese in it.
const usdPanel = cartPanel([USD_SINGLE], [['V1', 2]]);
ok('USD control: the panel is node-for-node what it was before this version',
	classesOf(usdPanel).join(' ') === 'dc-square-shop-cart-h dc-square-shop-cart-total dc-square-shop-cart-lines dc-square-shop-checkout dc-square-shop-checkout-note',
	classesOf(usdPanel).join(' · '));
ok('USD control: the line price is plain text markup, no <small> anywhere',
	linePrices(usdPanel)[0].innerHTML.includes('USD') && !linePrices(usdPanel)[0].innerHTML.includes('<small>'), linePrices(usdPanel)[0].innerHTML);
ok('USD control: no label row exists at all',
	childByClass(usdPanel, 'dc-square-shop-cart-subtotal') === null);

// The two pure helpers, on the same currency inputs taxInclusiveSuffix is held to. 0.11.10: both
// now take a `labels`-shaped object (locale + the two words), not a bare locale string — LABELS
// itself (ja-JP) for the labelled case; a minimal literal for the others, to prove the function
// reads ONLY what it needs and does not implicitly reach for the module-level LABELS.
const EN_LABELS = { locale: 'en-US', subtotal: 'Total', taxIncluded: 'incl. tax' };
ok('cartLinePriceHtml: JPY labelled, USD untouched, and it escapes what it interpolates',
	cartLinePriceHtml(1400, 'JPY', LABELS) === '¥1,400<small class="dc-tax-inclusive">税込</small>'
	&& cartLinePriceHtml(40, 'USD', EN_LABELS).includes('USD')
	// A currency Intl refuses sends formatPrice down its fallback, which interpolates the catalog's
	// own string — the one input where textContent → innerHTML could have become an injection.
	&& cartLinePriceHtml(5, '<img src=x>', EN_LABELS) === '5 &lt;img src=x&gt;',
	cartLinePriceHtml(5, '<img src=x>', EN_LABELS));
ok('subtotalLabel: JPY yes, jpy yes, everything else empty (currency gates it; wording follows labels)',
	subtotalLabel('JPY', LABELS) === '合計（税込）' && subtotalLabel('jpy', LABELS) === '合計（税込）'
	&& subtotalLabel('USD', LABELS) === '' && subtotalLabel('', LABELS) === '' && subtotalLabel(null, LABELS) === '');
ok('subtotalLabel: Latin locale gets the Latin parenthetical convention, not the CJK one',
	subtotalLabel('JPY', EN_LABELS) === 'Total (incl. tax)', subtotalLabel('JPY', EN_LABELS));

// ── what actually gets published ─────────────────────────────────────────
// 🔴 The parity above is about behaviour; this is about DISTRIBUTION, which is the half PR #10
// found missing. square-shop is `bundle: false`, so the registry artifact is square-shop.js
// verbatim plus a stamp — meaning the label reaches a pinned site only if it is in THIS file.
const source = readFileSync(join(HERE, 'square-shop.js'), 'utf8');
const mobileCss = (source.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/) || [''])[0];
for (const control of [
	'.${PREFIX}-buy', '.soda-shop-cart-slot', '.${PREFIX}-step', '.${PREFIX}-rm',
	'.${PREFIX}-checkout', '.soda-shop-cart-close'
]) ok(`mobile CSS gives ${control} a 44px-tall tap target`, mobileCss.includes(control) && mobileCss.includes('min-height: 44px'));
for (const iconButton of ['.${PREFIX}-step', '.${PREFIX}-rm', '.soda-shop-cart-close']) {
	ok(`mobile CSS gives ${iconButton} a 44px-wide tap target`, mobileCss.includes(iconButton) && mobileCss.includes('min-width: 44px'));
}
ok('the client source — what build.mjs stamps into the registry artifact — carries 税込',
	source.includes('税込'));
ok('the client source ships the .dc-tax-inclusive CSS rule too (an unstyled label is not the label)',
	source.includes('.dc-tax-inclusive {') && source.includes('font-size: 0.75em'));
// 🔴 These two say NOTHING about behaviour and are not meant to: this file's own comments contain
// both strings, so they would stay green against a fully reverted renderPanel. They exist because a
// `bundle: false` coral reaches a pinned site as these exact bytes — the driven assertions above are
// what says the bytes are wired to anything.
//
// 0.11.10: '合計（税込）' stopped being a literal in the source — it is now COMPOSED at runtime from
// `labels.subtotal` + `labels.taxIncluded` (finding #15: so an en-US/zh-TW/zh-CN shop gets its own
// words in that same slot, not the JPY shop's Japanese). So this checks for the pieces that compose
// it — both dictionary words for ja-JP, and the styling rule — rather than the combined literal.
ok('the client source carries 合計 + 税込 (composed into the label) and the cart-subtotal rule that styles it',
	source.includes("subtotal:'合計'") && source.includes("taxIncluded:'税込'") && source.includes('-cart-subtotal {'));

// And if the artifact for the version in package.json has already been built, hold it to the same
// bar. Absent is honest — a bump is allowed to precede its build; silent would not be.
const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
// The registry is a deployment's (see sponsor/sponsor-registry.test.mjs for the full note).
// This one already treated an unbuilt artifact as honest-absent, which is the same shape.
const REGISTRY = process.env.CORAL_REGISTRY || join(HERE, '../registry');
const artifact = join(REGISTRY, 'versions/square-shop', version, 'square-shop.js');
if (existsSync(artifact)) {
	const built = readFileSync(artifact, 'utf8');
	ok(`published artifact ${version}/square-shop.js contains 税込`, built.includes('税込'));
	ok(`published artifact ${version}/square-shop.js contains the .dc-tax-inclusive rule`,
		built.includes('.dc-tax-inclusive {'));
	ok(`published artifact ${version}/square-shop.js contains 合計 + 税込 and the cart-subtotal rule`,
		built.includes("subtotal:'合計'") && built.includes("taxIncluded:'税込'") && built.includes('-cart-subtotal {'));
} else {
	console.log(`SKIP - no registry artifact for ${version} under ${REGISTRY} (set CORAL_REGISTRY, or run build.mjs square-shop)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
