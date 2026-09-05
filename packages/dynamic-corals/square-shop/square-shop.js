// @ts-nocheck — plain untyped JS (checker pragma only, no logic change); a
// consumer with strict `checkJs` (e.g. feelreef) needs this to vendor the
// file unmodified rather than fork a typed copy.
// @tile/dynamic-corals — square-shop.
//
// The first dynamic coral (see ../README.md for the mount contract this file
// implements). Renders a seller's OWN live catalog — feelreef never stores or
// caches the product data; every view re-fetches fresh from the feelreef
// backend, which itself proxies the seller's own connected payment account
// (non-custodial, "REEF with Checkout" — 0% cut, feelreef is never in the funds
// path). Visibility of what shows here is controlled ENTIRELY by the seller on
// their own processor (on Square, item `ecom_visibility`); feelreef is never the
// source of truth for the catalog.
//
// The name is historical: the catalog read and the cart checkout go to the
// backend's PROCESSOR-NEUTRAL `/api/v2/shop/*` surface, which serves a seller on
// Square and a seller on Stripe alike. The instant Buy below is the one call
// still on the Square-specific surface — see the note above `startCheckout`.
//
// Two buy modes:
//   • instant (default) — each card has a Buy button that jumps straight to a
//     one-item hosted checkout. SQUARE SELLERS ONLY (see `startCheckout`).
//   • cart (data-cart="1") — add/adjust quantities, one Checkout for the whole
//     cart (a single multi-line order). Opt-in, so existing embeds keep the
//     instant behavior untouched. Works on either processor.
//
// Config (data-* attributes on the container):
//   data-guild-id        (optional*) — the Discord community this shop belongs to.
//   data-site-id         (optional*) — the site this shop belongs to.
//                        *EXACTLY ONE of the two is required, and the guild wins when both are
//                        present (see shopLocator — one rule, used for the catalog query AND
//                        for the checkout body). A host that supplies NEITHER is a
//                        misconfigured embed and still gets the error line below.
//   data-api-base        (optional) — override the feelreef backend origin.
//   data-cart            (optional) — "1" enables cart mode.
//   data-collect-shipping (optional) — "1" makes the hosted checkout collect a
//                          shipping address (physical merch; cart mode). Fees
//                          stay the seller's own concern (baked into prices) —
//                          this widget never runs a shipping-rate engine.
//   data-buy-label       (optional) — instant buy-button text (default "Buy").
//   data-add-label       (optional) — cart add-button text (default "Add").
//   data-checkout-label  (optional) — cart checkout text (default "Checkout").
//   data-subtotal-label  (optional) — read into labels.subtotal, but NOTHING renders
//                          it: the panel's own heading is data-cart-heading, and the
//                          total row is unlabelled except on a JPY shop, where it
//                          carries the fixed 「合計（税込）」 (see subtotalLabel below —
//                          a tax statement follows the merchant's currency, so it is
//                          deliberately not something a site can overwrite).
//   data-checkout-pending-label (optional) — what a buy/checkout button says while
//                          its request is in flight (default "Taking you to
//                          payment…"). A host that passes localized labels should
//                          pass this one too, or its buyers get the English default
//                          on the one screen where they are waiting.
//   data-empty-label     (optional) — connected-but-no-items text.
//   data-unconnected-label (optional) — seller hasn't linked Square text.
//   data-error-label     (optional) — network/API failure text.
//   data-checkout-error-label      (optional) — generic "couldn't start checkout".
//   data-checkout-busy-label       (optional) — too many attempts (429).
//   data-checkout-closed-label     (optional) — shop not taking orders (404).
//   data-checkout-again-label      (optional) — that attempt was already started (409).
//   data-checkout-unavailable-label (optional) — backend not answering (5xx).
//   data-checkout-note   (optional) — small localized line under the CART checkout button, saying
//                          the payment page itself is Square's own and (today) always Japanese —
//                          finding #12, 2026-09-03 cold-read: a zh-TW/en-US shopper reached the
//                          hosted Square page with zero warning that it would suddenly be in
//                          Japanese. Defaults per shop locale (see LABEL_DICTIONARIES); pass an
//                          EMPTY STRING to suppress it entirely (a seller who has since localized
//                          their own Square page, or just wants it gone) — that is different from
//                          leaving the attribute off, which takes the localized default.
//   (the *-label attrs let a zh-TW page pass native strings.)
//
// Usage:
//   <div data-dynamic-coral="square-shop" data-guild-id="123" data-cart="1"></div>
//   <script type="module" src=".../square-shop.js"></script>

// 🔴 A **SITE** coral — no Card can embed it. If you got here wondering which backend it talks to,
// read ./README.md: the answer is "the one the page names", and the line below is only the
// fallback for a page that names none.
//
// 🔴 NO HOSTNAME LIVES HERE. This repo is public and generic; which origin a particular
// deployment's embeds fall back to is that deployment's business, and a hostname committed here
// would be a fact about somebody's infrastructure published under an MIT licence. The neutral
// value is EMPTY; a deployment supplies its own at build time via `build.mjs --defaults <file>`,
// which rewrites exactly this line by the marker on it.
//
// 🔴 The guard for "the substitution did not happen" is at BUILD time, not here: build.mjs
// refuses to write a registry artifact that still carries an unsubstituted marker. A runtime
// refusal was considered and rejected — it would have to fire before the SSR fast path, so a
// mis-built artifact would BLANK a grid the edge had already rendered correctly, and the existing
// failure path (an empty base fetches an origin that does not serve the route → the honest error
// line below) is already loud enough. A safety device on the hot path has to be free.
const DEFAULT_API_BASE = ''; /*coral-default:apiBase*/
const SELECTOR = '[data-dynamic-coral="square-shop"]';
const PREFIX = 'dc-square-shop';
const CART_STORE_PREFIX = 'dc-square-shop-cart:';
const RETURN_PARAM = 'dc_shop'; // legacy Square return marker; never proves payment

let stylesInjected = false;

// ── persistent cart ──────────────────────────────────────────────────────
// The cart lives in localStorage (keyed by the storefront) so it survives reloads AND
// navigation to a product's own page — a per-page-load cart would evaporate
// the moment a shopper clicked through to a detail page.
//
// 🔴 The key is the GUILD wherever there is one, character for character, forever. It is
// persisted on the shopper's own machine, so a key that moved would not migrate a basket —
// it would silently empty it on the next visit. A site with no guild is keyed by its site id,
// which is the case that had no basket to lose. Same guild-preferred rule as the wire
// locator, for the same compatibility reason.
function cartStore(storeId) {
	return CART_STORE_PREFIX + storeId;
}

function storageAvailabilityNotice(available, labels) {
	return available ? '' : ((labels && labels.storageNotice) || '');
}

function loadPersistedCart(storeId, itemsById) {
	const cart = new Map();
	cart.storageAvailable = true;
	let raw;
	try {
		raw = window.localStorage.getItem(cartStore(storeId));
	} catch {
		cart.storageAvailable = false;
		return cart; // storage disabled — start empty, cart still works in-memory
	}
	if (!raw) return cart;
	let entries;
	try {
		entries = JSON.parse(raw);
	} catch {
		cart.storageAvailable = false;
		return cart;
	}
	if (!Array.isArray(entries)) { cart.storageAvailable = false; return cart; }
	for (const e of entries) {
		if (!Array.isArray(e)) continue;
		const vid = String(e[0] || '');
		const qty = Math.max(1, Math.min(99, parseInt(e[1], 10) || 0));
		// reconcile: drop anything the seller has since removed/hidden in Square
		// (it's not in the live catalog), so a stale cart never checks out ghosts.
		if (vid && itemsById.has(vid)) cart.set(vid, qty);
	}
	return cart;
}

function persistCart(storeId, cart) {
	try {
		window.localStorage.setItem(cartStore(storeId), JSON.stringify([...cart.entries()]));
	} catch {
		cart.storageAvailable = false;
		// storage disabled/full — cart still works in-memory this session
	}
	// Same-tab localStorage writes don't fire the 'storage' event on THIS window (only other tabs
	// get that) — this is what lets the header cart badge react on this same page. Single choke
	// point: every cart mutation in this file (add/±qty/remove) goes through setQty → here.
	try { window.dispatchEvent(new CustomEvent('dc-cart-changed')); } catch {}
}

function clearPersistedCart(storeId) {
	try {
		window.localStorage.removeItem(cartStore(storeId));
	} catch {
		// nothing to clear
	}
}

// Old checkout links return to ?dc_shop=done. The marker is not proof of payment:
// only carry a known bearer ref to the verified completion route, and never clear here.
function consumeCheckoutReturn() {
	try {
		const url = new URL(window.location.href);
		if (url.searchParams.get(RETURN_PARAM) === 'done') {
			const ref = url.searchParams.get('ref');
			if (!ref) return;
			const base = url.pathname.replace(/\/$/, '');
			window.location.replace(`${base}/complete?ref=${encodeURIComponent(ref)}`);
		}
	} catch {
		// non-browser / bad URL — nothing to consume
	}
}

function checkoutCompletionUrl(clientRequestRef, shopPath) {
	try {
		const path = (shopPath || window.location.pathname).replace(/\/$/, '');
		return `${window.location.origin}${path}/complete?ref=${encodeURIComponent(clientRequestRef)}`;
	} catch {
		return undefined;
	}
}

function injectStyles() {
	if (stylesInjected) return;
	stylesInjected = true;
	const style = document.createElement('style');
	// Theme-fit: consume the host's design tokens (sitetile exposes --gd-*;
	// every value falls back so the widget still looks right on a host that
	// defines none, e.g. feelreef). This is why the buy button turns purple on
	// a themed host squares it / teal on a bare host — one widget, fits in.
	style.textContent = `
.${PREFIX} { font-family: inherit; }
/* CSS Grid, not flex-wrap: auto-fill + minmax(_,1fr) ALWAYS fills the row edge-to-edge (the column
   count it lands on gets stretched to consume 100% of the width) — no dead trailing gap, at ANY
   container width. flex-wrap + a fixed card width only looked even by coincidence: whichever width
   the host page happens to cap the grid at, the moment N cards' fixed width doesn't divide it
   exactly, the (N+1)th wraps and the row is left with unclaimed space (measured live: a 964px
   column fits 3 cards at a fixed 240px + gaps with 204px left over, empty, on the right). */
.${PREFIX}-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
.${PREFIX}-card { border-radius: var(--gd-radius, 16px); overflow: hidden; background: var(--gd-card-bg, #fff); border: 1px solid var(--gd-border, rgba(0,0,0,0.1)); box-shadow: 0 6px 18px var(--gd-card-shadow, rgba(0,0,0,0.08)); display: flex; flex-direction: column; transition: transform .15s, box-shadow .15s, border-color .15s; }
.${PREFIX}-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px var(--gd-card-shadow, rgba(0,0,0,0.14)); border-color: var(--gd-accent, currentColor); }
.${PREFIX}-img { display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: cover; background: var(--gd-border, rgba(0,0,0,0.06)); }
.${PREFIX}-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.${PREFIX}-link { text-decoration: none; color: inherit; display: block; }
.${PREFIX}-link:hover .${PREFIX}-name { color: var(--gd-accent-text, var(--gd-accent-deep, var(--gd-accent, currentColor))); }
.${PREFIX}-card--link { text-decoration: none; color: inherit; }
.${PREFIX}-card--link:hover .${PREFIX}-name { color: var(--gd-accent-text, var(--gd-accent-deep, var(--gd-accent, currentColor))); }
.${PREFIX}-name { font-size: 14.5px; font-weight: 700; line-height: 1.3; margin: 0; color: var(--gd-text, inherit); }
/* margin-top:auto lives HERE (not on buy/stepper) so price + whatever follows it (buy button,
   stepper, or "Choose options" chip) sit as ONE group pinned to the card's bottom edge — stable
   across cards whose name wraps to a different number of lines. */
.${PREFIX}-price { margin: 0; margin-top: auto; font-size: 13px; color: var(--gd-muted, rgba(0,0,0,0.6)); }
/* JPY tax-inclusive label (税込): smaller/muted vs the price it follows, regardless of what color
   that price is. 🔴 NOT prefixed — dc-tax-inclusive is the same literal class product-page-core.js
   emits and styles, because the SSR grid and the hydrated grid are the same pixels a moment apart.
   Prefixing it would give the same label two different looks depending on which one you were
   looking at. Byte-identical to that rule on purpose; if one moves, move both. */
.dc-tax-inclusive { color: var(--gd-muted, rgba(0,0,0,0.6)); font-size: 0.75em; font-weight: normal; margin-left: 0.35em; }
/* font: inherit (not just font-family) on every control below — form elements don't inherit ANY
   font property by default, including line-height (UA stylesheets set button/select to their own
   font AND "line-height: normal"), so without this every one of these silently rendered off-theme
   AND a few px shorter than a themed element of the same padding. Caught by comparing a real
   <button> against a plain <span> made to look like one (the multi-variant "Choose options" chip)
   — same class, visibly different height. font-size/font-weight below still win (later in the
   same rule), so this only backfills family + line-height. */
.${PREFIX}-buy { font: inherit; text-align: center; border: none; border-radius: var(--gd-pill, 999px); padding: 10px 16px; font-size: 13.5px; font-weight: 700; cursor: pointer; background: var(--gd-accent-deep, var(--gd-accent, #0b5f6b)); color: var(--gd-accent-ink, #fff); transition: background .15s, transform .15s; }
.${PREFIX}-buy:hover:not(:disabled) { background: var(--gd-accent, #0d7280); transform: translateY(-1px); }
.${PREFIX}-buy:disabled { opacity: 0.55; cursor: not-allowed; }
/* Pending: both buttons are stretched by their container, so a longer label cannot
   change their WIDTH — only wrapping to a second line could change the height. One
   clipped line keeps the button exactly the size it was, and hiding the overflow
   also stops the longer text raising the card's min-content width.
   🩸 0.11.10 (finding #16, 2026-09-03 cold-read): beginPending() already flips the button to
   aria-busy + disabled + relabelled while a checkout session is minted server-side — a real wait
   measured at ~5s, with NO motion of any kind saying so. A shopper reading that as a possible hang
   is the exact failure "never claims a backend it lacks" exists to avoid on the OTHER end of a
   request; here the request is real and just slow, and the button owed it a pulse. A CSS ::after
   spinner needs no extra markup and nothing new to gate on JS-off (the button already required a
   click to reach this state). Respects prefers-reduced-motion like the skeleton shimmer above. */
.${PREFIX}-pending { white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  position: relative; padding-right: 2.1em; }
.${PREFIX}-pending::after {
  content: ''; position: absolute; top: 50%; right: 0.85em; width: 0.9em; height: 0.9em;
  margin-top: -0.45em; box-sizing: border-box; border: 2px solid currentColor;
  border-top-color: transparent; border-radius: 50%; animation: ${PREFIX}-spin 0.7s linear infinite;
}
@keyframes ${PREFIX}-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .${PREFIX}-pending::after { animation: none; opacity: 0.6; } }
.${PREFIX}-empty, .${PREFIX}-error { font-size: 13.5px; color: var(--gd-muted, rgba(0,0,0,0.6)); padding: 8px 0; }
/* A refused checkout, said to the shopper. Reads as a notice, not as chrome — full width of whatever
   surface it lands in (a card body or the cart panel), so it can't be mistaken for another control. */
.${PREFIX}-msg { font-size: 12.5px; line-height: 1.45; margin: 10px 0 0; color: var(--gd-muted, rgba(0,0,0,0.6)); }
.${PREFIX}-msg[hidden] { display: none; }
.${PREFIX}-storage-notice { font-size: 11.5px; line-height: 1.4; margin: 10px 0 0; color: var(--gd-muted, rgba(0,0,0,0.55)); }
/* "the payment page is Square's, and it's Japanese" (finding #12) — same quiet register as the
   storage notice beside it, not a warning: it is a fact about what happens next, not a problem. */
.${PREFIX}-checkout-note { font-size: 11.5px; line-height: 1.4; margin: 8px 0 0; color: var(--gd-muted, rgba(0,0,0,0.55)); }
/* cart mode — products on the LEFT, a sticky cart summary floating on the
   RIGHT (mirrors feelreef's module picker). Stacks to one column on narrow. */
.${PREFIX}-layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.${PREFIX}-layout > .${PREFIX}-grid { flex: 1 1 360px; justify-content: flex-start; }
/* data-cart="header": suppress the inline sidebar (grid full-width), but keep the panel rendered so
   a header drawer can relocate it. Hide is scoped to a DIRECT child of the hosted layout, so once the
   drawer moves the panel out it shows normally — and there is no inline-sidebar flash before the move. */
.${PREFIX}-layout--hosted-cart > .${PREFIX}-grid { flex-basis: 100%; }
.${PREFIX}-layout--hosted-cart > .${PREFIX}-cart { display: none; }
.${PREFIX}-stepper { display: flex; align-items: center; gap: 8px; }
.${PREFIX}-card .${PREFIX}-stepper { padding-top: 10px; justify-content: center; }
.${PREFIX}-step { font: inherit; width: 28px; height: 28px; flex: 0 0 auto; border-radius: var(--gd-pill, 999px); border: 1px solid var(--gd-border, rgba(0,0,0,0.14)); background: var(--gd-soft, rgba(0,0,0,0.03)); color: var(--gd-text, inherit); font-size: 15px; line-height: 1; font-weight: 700; cursor: pointer; transition: border-color .15s, background .15s; }
.${PREFIX}-step:hover { border-color: var(--gd-accent, currentColor); }
.${PREFIX}-qty { min-width: 1.5em; text-align: center; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--gd-text, inherit); }
.${PREFIX}-cart { flex: 1 1 260px; max-width: 340px; align-self: flex-start; position: sticky; top: 16px; border-radius: var(--gd-radius, 16px); background: var(--gd-card-bg, #fff); border: 1px solid var(--gd-border, rgba(0,0,0,0.1)); box-shadow: 0 6px 18px var(--gd-card-shadow, rgba(0,0,0,0.08)); padding: 20px 20px 22px; }
.${PREFIX}-cart-h { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; margin: 0; color: var(--gd-accent-text, var(--gd-accent-deep, var(--gd-accent, rgba(0,0,0,0.55)))); }
/* The JPY total's label 「合計（税込）」 — the row above the amount, not a suffix on it. Rendered ONLY
   on a JPY shop (subtotalLabel returns '' otherwise), so a non-JPY panel has no such node and this
   rule never matches anything there. No letter-spacing/uppercase: this is CJK, and the cart heading's
   tracking is for a Latin all-caps eyebrow. */
.${PREFIX}-cart-subtotal { font-size: 12px; font-weight: 600; margin: 8px 0 0; color: var(--gd-muted, rgba(0,0,0,0.6)); }
.${PREFIX}-cart-total { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 4px 0 0; color: var(--gd-text, inherit); }
.${PREFIX}-cart-lines { margin-top: 14px; border-top: 1px solid var(--gd-border, rgba(0,0,0,0.1)); }
.${PREFIX}-line { display: flex; align-items: flex-start; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--gd-border, rgba(0,0,0,0.08)); }
.${PREFIX}-line--sold-out { opacity: 0.55; }
.${PREFIX}-line-badge { font-size: 11px; font-weight: 700; color: var(--gd-muted, rgba(0,0,0,0.65)); }
.${PREFIX}-line-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.${PREFIX}-line-name { font-size: 13px; font-weight: 600; color: var(--gd-text, inherit); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${PREFIX}-line-price { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--gd-muted, rgba(0,0,0,0.6)); white-space: nowrap; padding-top: 2px; }
.${PREFIX}-rm { border: none; background: none; cursor: pointer; font-size: 16px; line-height: 1; color: var(--gd-muted, rgba(0,0,0,0.4)); padding: 0 2px; }
.${PREFIX}-rm:hover { color: var(--gd-accent, currentColor); }
.${PREFIX}-cart-hint { font-size: 13px; line-height: 1.5; color: var(--gd-muted, rgba(0,0,0,0.55)); margin: 14px 0 0; }
.${PREFIX}-checkout { font: inherit; width: 100%; margin-top: 16px; border: none; border-radius: var(--gd-pill, 999px); padding: 12px 16px; font-size: 14px; font-weight: 800; cursor: pointer; background: var(--gd-accent-deep, var(--gd-accent, #0b5f6b)); color: var(--gd-accent-ink, #fff); transition: background .15s, transform .15s; }
.${PREFIX}-checkout:hover:not(:disabled) { background: var(--gd-accent, #0d7280); transform: translateY(-1px); }
.${PREFIX}-checkout:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 640px) {
  .${PREFIX}-cart { max-width: none; flex-basis: 100%; position: static; }
  .${PREFIX}-buy, .soda-shop-cart-slot, .${PREFIX}-step, .${PREFIX}-rm, .${PREFIX}-checkout, .soda-shop-cart-close { min-height: 44px; }
  .${PREFIX}-step, .${PREFIX}-rm, .soda-shop-cart-close { min-width: 44px; }
}
/* loading skeleton (non-SSR path only): shimmer placeholders that hold the grid's shape. */
.${PREFIX}-skel { pointer-events: none; }
.${PREFIX}-skel-box, .${PREFIX}-skel-line { background: var(--gd-border, rgba(0,0,0,0.08)); background-image: linear-gradient(100deg, transparent 20%, rgba(128,128,128,.18) 50%, transparent 80%); background-size: 220% 100%; animation: ${PREFIX}-shimmer 1.15s linear infinite; }
.${PREFIX}-skel-line { height: 12px; border-radius: 6px; margin-top: 8px; }
.${PREFIX}-skel-line--sm { width: 55%; }
@keyframes ${PREFIX}-shimmer { from { background-position: 220% 0; } to { background-position: -220% 0; } }
@media (prefers-reduced-motion: reduce) { .${PREFIX}-skel-box, .${PREFIX}-skel-line { animation: none; } }
`;
	document.head.appendChild(style);
}

function escHtml(s) {
	return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
	);
}

// Currency is already resolved to a display-ready major-unit number by the
// backend (it owns the zero-decimal-currency math — see minor_units() in
// apps/mixfairy/services/payments/byo/currency.py); this widget only formats
// the label, it never does money math itself. (Cart subtotals below are a
// display convenience computed from those major-unit numbers; Square itself
// remains the authority on the real order total at checkout.)
function formatMoney({ minor, currency, locale }) {
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

function formatPrice(displayAmount, currency, locale) {
	if (displayAmount == null) return '';
	try {
		const code = String(currency || 'USD').toUpperCase();
		const digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
		return formatMoney({ minor: Number(displayAmount) * (10 ** digits), currency: code, locale });
	} catch { return `${displayAmount} ${currency || ''}`.trim(); }
}

// A multi-variant item's card shows the SPAN of its variants' prices, not one variant's price
// picked arbitrarily — "$5.00~$12.00" is honest about what picking a different option can cost.
function formatPriceRange(min, max, currency, locale) {
	if (min == null) return '';
	if (max == null || max === min) return formatPrice(min, currency, locale);
	return `${formatPrice(min, currency, locale)}~${formatPrice(max, currency, locale)}`;
}

// JP sellers show ONE tax-inclusive price (税込) — no per-site setting, the rule follows the
// merchant's currency (RUNBOOK-square-seller-connection-to-rsp-2026-08-27.md, 「稅的定案」).
//
// 🩸 0.11.1 put this rule ONLY in product-page-core.js (the SSR/shop-worker core). But every render
// path in THIS file starts with `root.innerHTML = ''` — the client rebuilds the grid from the SSR
// card's own data-* attributes and throws the server's markup away. So on a JPY shop the label was
// painted by the edge and then wiped by hydration a moment later, and a client-only mount (a static
// build, or `data-api-base` pointed straight at RSP — which is what a JP seller ran) never had it
// at all.
// The rule has to live on BOTH sides or it lives on neither.
//
// Appended AFTER the already-escaped price text, never inside formatPrice's own return value, so
// formatPrice keeps returning plain text and every other caller of it (the cart panel below, which
// assigns to textContent) is untouched. `currency` is only ever COMPARED to the literal 'JPY'.
//
// 🩸 0.11.10 (finding #15, 2026-09-03 cold-read): `taxWord` used to be the LITERAL '税込', so a
// zh-TW or en-US shopper — every word of the page around it already in their own language — hit
// one hard-coded Japanese word on every single price. `taxWord` is `labels.taxIncluded`
// (LABEL_DICTIONARIES already carried the right string per locale — 'incl. tax' / 含稅 / 含税 —
// nothing here had ever read it). Still escHtml'd: formatPrice's Intl-throws fallback interpolates
// `currency` — a catalog-controlled string — into its return value, so the moment this is
// assigned to innerHTML instead of textContent that string is markup, and taxWord itself, while it
// only ever comes from our own fixed dictionary today, costs nothing to hold to the same rule.
function taxInclusiveSuffix(currency, taxWord) {
	return String(currency || '').toUpperCase() === 'JPY' ? `<small class="dc-tax-inclusive">${escHtml(taxWord)}</small>` : '';
}

// A cart LINE's price, as markup rather than plain text — the same pair itemCard() builds for a
// catalog card: the escaped amount, then taxInclusiveSuffix(). One price display per shop, so a
// ¥1,540 line in the basket says the SAME localized tax word in the very same
// `<small class="dc-tax-inclusive">` the card beside it and the edge-SSR'd grid above it use
// (0.11.2 left the basket as the one surface that still showed a JPY amount with no tax statement).
//
// 🔴 escHtml is not decoration here. formatPrice's Intl-throws fallback interpolates `currency` —
// a catalog-controlled string — into its return value, so the moment this is assigned to innerHTML
// instead of textContent that string is markup. Escaping is what keeps the two assignments
// equivalent for every input, not just the ones Intl happens to understand.
function cartLinePriceHtml(amount, currency, labels) {
	return `${escHtml(formatPrice(amount, currency, labels.locale))}${taxInclusiveSuffix(currency, labels.taxIncluded)}`;
}

// The cart total's label. Japanese EC states a total's tax status IN THE LABEL —「合計（税込）」—
// rather than by hanging 税込 off the amount, which is why the total is the one JPY price in this
// widget that does NOT take taxInclusiveSuffix(): the row would otherwise say it twice.
//
// The TAX FACT is not overridable by `data-subtotal-label` (unlike `labels.subtotal`, the "Total"
// word itself, which already was): whether a price is tax-inclusive follows the merchant's
// currency (「稅的定案」), it is not a per-site wording preference, and an override is a way for a
// site to quietly un-say it. Non-JPY returns '' and renderPanel then creates no label node at all —
// those panels render exactly as they did before this existed.
//
// 🩸 0.11.10 (finding #15): the WHOLE label was the literal '合計（税込）' — so an English cart's
// subtotal line read that exact Japanese even though `labels.subtotal`/`labels.taxIncluded` already
// carried 'Total'/'incl. tax'. CJK writes the tax fact in full-width parens with no space
// (「總計（含稅）」/「总计（含税）」, matching the Japanese shape); everything else gets the Latin
// convention, a space then half-width parens ("Total (incl. tax)") — bucketed off `labels.locale`,
// not off `currency` (a JPY-priced item on a zh-TW or en-US shop still reads in that shop's own
// language; only WHETHER the fact is stated follows the currency).
function subtotalLabel(currency, labels) {
	if (String(currency || '').toUpperCase() !== 'JPY') return '';
	const locale = String((labels && labels.locale) || '').toLowerCase();
	const cjk = locale.startsWith('ja') || locale.startsWith('zh');
	const sub = (labels && labels.subtotal) || '';
	const tax = (labels && labels.taxIncluded) || '';
	return cjk ? `${sub}（${tax}）` : `${sub} (${tax})`;
}

// ZERO-DECIMAL currencies keep their minor unit as the display amount (¥1400 is 1400, not 14.00).
// Same list product-page-core.js carries; both are display-only — the backend still owns the money.
const ZERO_DECIMAL = ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF'];

// A variant's display amount, from whichever field the backend actually sent. `display_price` is
// what both mixfairy and RSP emit today; `price_minor` is the fallback for a backend that sends
// only the minor-unit integer, so a price never renders as an empty span or a NaN.
function variantDisplayPrice(v) {
	if (!v) return null;
	if (v.display_price != null && !isNaN(Number(v.display_price))) return Number(v.display_price);
	if (v.price_minor == null || isNaN(Number(v.price_minor))) return null;
	const minor = Number(v.price_minor);
	return ZERO_DECIMAL.indexOf(String(v.currency || '').toUpperCase()) >= 0 ? minor : minor / 100;
}

// What to call this item. `name` is the flat field every backend has always sent; `title` is the
// richer item-detail field RSP added alongside it (reef PR #107). Reading both means one grid works
// against a backend that sends either — and never renders a blank card.
function itemName(it) {
	return (it && (it.name || it.title)) || '';
}

// Normalize a raw catalog item (which carries its full `variants` array) into the summary fields
// itemCard() needs: how many variants, and the price span across them. Only items.variants (the
// direct-fetch path) has this array — itemsFromSsr embeds the equivalent as data-* attrs instead,
// since the SSR-hydrate path rebuilds from the DOM, not a fresh fetch.
function withVariantSummary(it) {
	const variants = Array.isArray(it.variants) ? it.variants : [];
	if (variants.length <= 1) return { ...it, variant_count: variants.length || 1 };
	const prices = variants.map(variantDisplayPrice).filter((n) => n != null && !isNaN(n));
	return {
		...it,
		variant_count: variants.length,
		price_min: prices.length ? Math.min(...prices) : it.display_price,
		price_max: prices.length ? Math.max(...prices) : it.display_price
	};
}

// The catalog read goes to the PROCESSOR-NEUTRAL shop surface, not the Square-specific one.
// The backend resolves which processor the seller actually connected and answers the same
// `{connected, items}` shape either way (it adds a `processor` field this widget has no reason
// to read — what a card shows is the same whoever takes the money). The Square-only path made a
// seller on Stripe unable to list their own catalog on a built site at all, no matter what the
// backend supported; the product DETAIL page has been on this surface since it was written
// (./shop-function-template.js#fetchProductJson).
// WHICH LOCATOR NAMES THIS STOREFRONT ON THE WIRE — the client half of
// shop-function-template.js#shopLocatorParam, and it must stay the SAME rule: exactly one is
// sent, and the guild wins when there is one. That is a compatibility choice, not a ranking —
// `data-api-base` can still point at the legacy backend, which has no `site_id` vocabulary at
// all, so sending a site key there would answer nothing for a shop that works today. A site
// with NO guild is the case that had no storefront to lose, and its own id is what names it.
//
// 🔴 ONE function, because the rule has to hold on BOTH wires. Reading the catalog is a query
// string and starting a checkout is a POST body, and while those were two separate expressions
// they disagreed: the reads went guild-preferred and the writes stayed hard-wired to
// `guild_id`, so a guildless site could list its products and fill a basket and then hand the
// backend an empty locator at the till — a shop you can browse and cannot buy from. The query
// form below is now DERIVED from this object, so the two cannot drift again without one of
// them failing to compile.
//
// The key ORDER matters as much as the choice: spread this first into a body literal and a
// guild shop's request is byte-for-byte the one it has always sent.
function shopLocator(guildId, siteId) {
	return guildId ? { guild_id: guildId } : { site_id: siteId || '' };
}

function shopLocatorParam(guildId, siteId) {
	const [key, value] = Object.entries(shopLocator(guildId, siteId))[0];
	return `${key}=${encodeURIComponent(value)}`;
}

async function fetchCatalog(apiBase, locator) {
	const res = await fetch(`${apiBase}/api/v2/shop/catalog?${locator}`, {
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`catalog ${res.status}`);
	return res.json();
}

// ── client_request_ref ───────────────────────────────────────────────────
// RSP's durable checkout REQUIRES a non-empty `client_request_ref` on BOTH the
// instant and the cart path (reef site-durable-object.ts — the 400 carries
// `code: "client_request_ref_required"`), and it deliberately does NOT mint one
// server-side: a double-click is two separate HTTP requests with no shared
// server-side state, so a server-minted ref would give each of them its own and
// create TWO payment links. Minting it here is what makes the money boundary
// idempotent, so the rule is:
//   • stable   — the same buy-intent reuses ONE ref, so a re-click or a
//     lost-response retry replays RSP's SAME link instead of minting a second.
//   • distinct — a different intent (another variation, an edited cart) gets a
//     different ref, so genuinely separate purchases never collide into RSP's
//     409 "client_request_ref already in use".
//   • fresh-after-return — the map is per-mount, so a reload (e.g. coming back
//     from a completed hosted checkout) starts clean and the same item can be
//     bought again.
// mixfairy ignores the field entirely, so sending it is safe on both backends.
function newClientRequestRef() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// A context without randomUUID still gets cryptographic entropy in UUIDv4
	// shape — never Math.random, which is not unguessable and not unique enough
	// to key a payment link on.
	const b = new Uint8Array(16);
	crypto.getRandomValues(b);
	b[6] = (b[6] & 0x0f) | 0x40;
	b[8] = (b[8] & 0x3f) | 0x80;
	const h = [];
	for (let i = 0; i < 16; i++) h.push(b[i].toString(16).padStart(2, '0'));
	return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

// The LOCAL identity of a cart, used only as a Map key in this file — never sent
// anywhere. A sorted `variation×qty` join, not a hash: a hash of this would buy
// nothing (the value never leaves the page) and would introduce the one failure
// mode that matters here, two different carts colliding onto one ref and paying
// for the wrong basket. Sorted so the same cart built in a different order is
// the same cart; quantity is in the key so editing the basket mints a fresh ref.
//
// 🔴 The separators are written as ESCAPES (\u0000, \u0001), not as the literal
// control bytes they used to be. Same value at runtime — and the difference is
// that the file stays TEXT. With the raw bytes in it, file(1) called this JS
// `data` and grep treated it as binary, which on this machine's grep means
// reporting NO MATCHES rather than an error: `grep mountAll square-shop.js`
// answered "Binary file matches" (or, with ugrep, silently nothing) for a file
// that exports it. Every grep-shaped question about the largest file in this
// package came back confidently wrong, including the ones used to decide that
// something is not there. Two bytes bought that. (feelreef's qa-lint carries the
// same rule, `raw-nul-byte`, from its own 2026-08-20 version of this bruise; it
// is what caught these two when the file was vendored back.)
function cartRefKey(cart) {
	return [...cart.entries()]
		.map(([variationId, qty]) => `${variationId}\u0000${qty}`)
		.sort()
		.join('\u0001');
}

function checkoutRefFor(refs, key) {
	let ref = refs.get(key);
	if (!ref) {
		ref = newClientRequestRef();
		refs.set(key, ref);
	}
	return ref;
}

// ── buyer-facing failures ────────────────────────────────────────────────
// RSP answers a refused checkout with `{error, code?}`. `error` is an engineer's
// sentence ("client_request_ref is required", "square not connected") and must
// never reach a shopper. This maps what came back to something a person can act
// on, keyed on the machine-readable `code` first and the HTTP status second, so
// no message string is ever parsed. Anything unrecognised falls to the generic
// try-again — an unfamiliar failure is still a failure, and guessing at its
// meaning would be worse than saying nothing specific.
const CHECKOUT_ERROR_BY_CODE = {
	// The buyer cannot do anything about a missing ref — this is ours to fix, and
	// the honest thing to say is that it was us.
	client_request_ref_required: 'checkoutError'
};

function checkoutErrorLabelKey(status, payload) {
	const code = payload && typeof payload.code === 'string' ? payload.code : '';
	if (code && CHECKOUT_ERROR_BY_CODE[code]) return CHECKOUT_ERROR_BY_CODE[code];
	if (status === 409 && payload && payload.reason === 'unavailable') return 'checkoutUnavailable';
	if (status === 429) return 'checkoutBusy';
	if (status === 409) return 'checkoutAgain';
	if (status === 404) return 'checkoutClosed';
	if (status >= 500) return 'checkoutUnavailable';
	return 'checkoutError';
}

function checkoutErrorMessage(status, payload, labels) {
	const key = checkoutErrorLabelKey(status, payload);
	return (labels && labels[key]) || (labels && labels.checkoutError) || '';
}

function errorResponseToLineStates(status, payload) {
	const states = new Map();
	if (status !== 409 || !payload || !['sold_out', 'price_changed'].includes(payload.reason)) return states;
	for (const item of Array.isArray(payload.items) ? payload.items : []) {
		const variationId = String(item && item.variation_id || '');
		const reason = item && ['sold_out', 'price_changed'].includes(item.reason) ? item.reason : payload.reason;
		if (variationId && reason === payload.reason) states.set(variationId, {
			reason,
			price_minor: Number.isFinite(item.price_minor) ? item.price_minor : undefined,
			currency: item.currency || undefined
		});
	}
	return states;
}

// One message node per surface (the card body in instant mode, the cart panel in
// cart mode), created on first failure and reused after. role="alert" so a
// shopper on a screen reader hears the refusal instead of watching a button that
// simply went back to how it was.
function showCheckoutMessage(container, text) {
	if (!container) return;
	let node = container.querySelector(`.${PREFIX}-msg`);
	if (!node) {
		node = document.createElement('p');
		node.className = `${PREFIX}-msg`;
		node.setAttribute('role', 'alert');
		container.appendChild(node);
	}
	node.textContent = text;
	node.hidden = !text;
}

function clearCheckoutMessage(container) {
	const node = container && container.querySelector(`.${PREFIX}-msg`);
	if (node) {
		node.textContent = '';
		node.hidden = true;
	}
}

/**
 * Put a button into its pending state and hand back the undo.
 *
 * 🩸 feelreef gap sweep 2026-08-28 #22. Both checkout paths used to set
 * `textContent = '…'`, which is not a loading state — it is the button VANISHING.
 * On a live shop the Checkout button collapsed to three dots and stayed there while
 * the request ran (measured at up to 36s), so the buyer's honest reading was "it
 * broke, do I press it again?" — on a payment button. The recheck behind that item
 * ALSO overturned the assumed cause: the backend answered in <1.1s on three
 * measurements, so this is not a cold start and nothing here tries to make the
 * request faster. What is fixed is a button that said nothing for as long as it took.
 *
 * `pendingLabel` falls back to the button's own current label: every real path gets
 * a non-empty string from readLabels(), so the fallback only fires for a caller that
 * passed no labels at all. A button that keeps its words is a poor pending state but
 * an honest one — printing "undefined" on a payment button is not.
 *
 * `settle(label)` takes the same optional override the feelreef fork's copy does,
 * and for the same contract, even though NEITHER call site here passes one: this
 * file answers a refusal in the `-msg` node (showCheckoutMessage) rather than by
 * writing the failure into the button, so the two files' call sites differ for a
 * real reason while the helper itself stays one unit to reconcile. Exercised
 * directly in checkout-ref.test.mjs so it is a pinned contract, not dead weight.
 */
function beginPending(btn, pendingLabel) {
	const original = btn.textContent;
	btn.disabled = true;
	btn.setAttribute('aria-busy', 'true');
	btn.classList.add(`${PREFIX}-pending`);
	btn.textContent = pendingLabel || original;
	return (label) => {
		btn.classList.remove(`${PREFIX}-pending`);
		btn.removeAttribute('aria-busy');
		btn.disabled = false;
		btn.textContent = label || original;
	};
}

// 🔴 STILL ON THE SQUARE-SPECIFIC SURFACE, and not by oversight. The neutral
// `/api/v2/shop/*` surface registers exactly three routes — catalog, catalog/item and
// cart — and the gap is not a missing alias: RSP's site Durable Object routes
// `square/catalog-checkout`, `square/catalog-cart-checkout` and
// `stripe/catalog-cart-checkout`, so single-item cardinality exists for Square and for
// nothing else (`createStripeCatalogCartSaleCheckout` has no single-item twin). Pointing
// this call at a neutral path would name a route that answers 404, and folding it into
// the cart would turn one buy-intent into a cart-cardinality projection with a different
// idempotency key — a different sale, not the same one over a different wire.
//
// What that costs today: instant mode (the default, `data-cart` absent) does not work for
// a seller on Stripe — the Buy button reaches the honest-failure path below. Such a seller
// has to run the coral in cart mode, which is on the neutral surface. Closing it properly
// is a backend change (a `/api/v2/shop/catalog/checkout` route plus the Stripe single-item
// sale behind it), not a change here.
//
// `siteId` is LAST and optional on purpose. The locator pair is conceptually one argument, but
// this function is exported and driven positionally by three suites here plus feelreef's fork,
// so folding the pair into one parameter would rewrite call sites that have nothing to do with
// this change. Appended, a guild caller that never passes it is unaffected: shopLocator never
// looks at it when there is a guild.
async function startCheckout(apiBase, guildId, variationId, btn, refs, labels, siteId, shopPath) {
	const surface = btn.parentElement;
	clearCheckoutMessage(surface);
	const settle = beginPending(btn, labels && labels.checkoutPending);
	// Mint-or-reuse BEFORE the request, so a retry after a thrown or lost response
	// carries the SAME ref (idempotent replay) and never a second link.
	const clientRequestRef = checkoutRefFor(refs, variationId);
	const redirect_url = checkoutCompletionUrl(clientRequestRef, shopPath);
	let status = 0;
	let payload = null;
	try {
		const res = await fetch(`${apiBase}/api/v2/square/catalog/checkout`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			// Spread FIRST, so with a guild this literal is `{guild_id, variation_id,
			// client_request_ref}` in that order — the exact bytes this endpoint has always
			// received. Without one it carries `site_id` instead, and never an empty twin:
			// `{"guild_id":""}` is not "unspecified" to the backend, it is a locator that
			// resolves to nothing, which is the 400 a guildless shopper used to hit at the till.
			body: JSON.stringify({
				...shopLocator(guildId, siteId),
				variation_id: variationId,
				redirect_url,
				client_request_ref: clientRequestRef
			})
		});
		status = res.status;
		payload = await res.json().catch(() => null);
		if (res.ok && payload && payload.url) {
			window.location.href = payload.url;
			return;
		}
	} catch {
		// fall through to honest failure below
	}
	// A 409 means this ref is already bound to a DIFFERENT purchase, so replaying
	// it can only ever fail again. Drop it: the next click mints a fresh one, and
	// because the conflicting attempt was for other contents, that cannot
	// duplicate anything the buyer already paid for.
	if (status === 409) refs.delete(variationId);
	settle();
	const states = errorResponseToLineStates(status, payload);
	if (states.size) {
		const message = payload.reason === 'sold_out' ? labels.soldOutMessage : labels.priceChangedMessage;
		showCheckoutMessage(surface, message.replace('{items}', variationId));
		return;
	}
	showCheckoutMessage(surface, checkoutErrorMessage(status, payload, labels));
}

// `siteId` appended last for the same reason it is in startCheckout above.
async function startCartCheckout(apiBase, guildId, cart, collectShipping, btn, labels, refs, siteId, onConflict) {
	const items = [...cart.entries()].map(([variation_id, quantity]) => ({ variation_id, quantity }));
	if (items.length === 0) return;
	const surface = btn.parentElement;
	clearCheckoutMessage(surface);
	const settle = beginPending(btn, labels && labels.checkoutPending);
	// Keyed on the cart's contents, so a double-click on Checkout replays one link
	// while a basket the shopper edited in between is a new intent with a new ref.
	const refKey = cartRefKey(cart);
	const clientRequestRef = checkoutRefFor(refs, refKey);
	const redirect_url = checkoutCompletionUrl(clientRequestRef, window.location.pathname);
	let status = 0;
	let payload = null;
	try {
		// Processor-neutral cart, same reason as the catalog read above. The surface takes the
		// lines under either `items` or `lines` (one or the other, never both) and routes them to
		// whichever processor the seller connected, so the wire shape below is unchanged.
		const res = await fetch(`${apiBase}/api/v2/shop/cart`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			// Same guild-preferred locator as the catalog read and the instant checkout, spread
			// first so a guild cart's body keeps its original key order byte for byte.
			body: JSON.stringify({
				...shopLocator(guildId, siteId),
				items,
				collect_shipping: !!collectShipping,
				redirect_url,
				client_request_ref: clientRequestRef
			})
		});
		status = res.status;
		payload = await res.json().catch(() => null);
		if (res.ok && payload && payload.url) {
			window.location.href = payload.url;
			return;
		}
	} catch {
		// fall through to honest failure below
	}
	if (status === 409) refs.delete(refKey);
	settle();
	const states = errorResponseToLineStates(status, payload);
	if (states.size && onConflict) { onConflict(states, payload.reason); return; }
	showCheckoutMessage(surface, checkoutErrorMessage(status, payload, labels));
}

// Locale-aware labels — read from data-* attributes so a zh-TW page can pass
// native strings (data-buy-label="購買" etc.). English defaults keep the widget
// self-contained for en pages. Per-item `buy_label` from the API (if any) still
// wins over the page-level default.
const LABEL_DICTIONARIES = {
	'en-US': { buy:'Buy', add:'Add to cart', soldOut:'Sold out', viewCart:'View cart', inCart:'In cart', cart:'Your cart', shop:'Shop', chooseOptions:'Choose options', checkout:'Checkout', confirmPrice:'Confirm new price', subtotal:'Total', taxIncluded:'incl. tax', remove:'Remove', quantity:'Quantity', decreaseQuantity:'Decrease quantity', increaseQuantity:'Increase quantity', emptyCart:'Add something on the left to get started.', soldOutMessage:'Remove the sold-out item(s): {items}.', priceChangedMessage:'The price changed for {items}; review the new price and confirm checkout.', storageNotice:'Your cart will not be kept when you leave this page.', checkoutError:"Couldn't start checkout — try again.", checkoutBusy:'Too many tries just now — wait a moment and try again.', checkoutClosed:"This shop isn't taking orders right now.", checkoutAgain:'That order was already started — please try again.', checkoutUnavailable:"The shop isn't responding — please try again shortly.", checkoutPending:'Taking you to payment…', checkoutNote:'Payment page is provided by Square (Japanese interface)', empty:'Nothing in the shop right now — check back soon.', unconnected:'No shop connected yet.', error:"Couldn't load the shop right now." },
	'ja-JP': { buy:'購入', add:'カートに追加', soldOut:'売り切れ', viewCart:'カートを見る', inCart:'カート内', cart:'カート', shop:'ショップ', chooseOptions:'オプションを選択', checkout:'お会計へ', confirmPrice:'新価格を確認して進む', subtotal:'合計', taxIncluded:'税込', remove:'削除', quantity:'数量', decreaseQuantity:'数量を減らす', increaseQuantity:'数量を増やす', emptyCart:'左の商品をカートに追加してください。', soldOutMessage:'売り切れの商品を削除してください：{items}。', priceChangedMessage:'{items}の価格が変更されました。新価格を確認してからお会計へ進んでください。', storageNotice:'このページを離れるとカートの内容は保存されません。', checkoutError:'お会計を開始できませんでした。もう一度お試しください。', checkoutBusy:'アクセスが集中しています。少し待ってからお試しください。', checkoutClosed:'現在このショップでは注文を受け付けていません。', checkoutAgain:'この注文はすでに開始されています。もう一度お試しください。', checkoutUnavailable:'ショップが応答していません。しばらくしてからお試しください。', checkoutPending:'お支払い画面へ移動しています…', checkoutNote:'お支払いページは Square が提供します', empty:'現在商品はありません。', unconnected:'ショップはまだ接続されていません。', error:'ショップを読み込めませんでした。' },
	'zh-TW': { buy:'購買', add:'加入購物車', soldOut:'已售完', viewCart:'查看購物車', inCart:'購物車內', cart:'購物車', shop:'商店', chooseOptions:'選擇規格', checkout:'前往結帳', confirmPrice:'確認新價格並結帳', subtotal:'總計', taxIncluded:'含稅', remove:'移除', quantity:'數量', decreaseQuantity:'減少數量', increaseQuantity:'增加數量', emptyCart:'請從左側加入商品。', soldOutMessage:'請移除已售完的商品：{items}。', priceChangedMessage:'{items}的價格已變更；請確認新價格後再結帳。', storageNotice:'離開此頁面後，購物車內容將不會保留。', checkoutError:'無法開始結帳，請再試一次。', checkoutBusy:'目前嘗試次數過多，請稍候再試。', checkoutClosed:'此商店目前不接受訂單。', checkoutAgain:'此訂單已開始，請再試一次。', checkoutUnavailable:'商店目前沒有回應，請稍後再試。', checkoutPending:'正在前往付款頁面…', checkoutNote:'付款頁由 Square 提供（日文介面）', empty:'商店目前沒有商品，請稍後再來。', unconnected:'尚未連接商店。', error:'目前無法載入商店。' },
	// 0.11.10 (finding #15, 2026-09-03 cold-read): Simplified, added alongside zh-TW rather than
	// derived from it at runtime — the two diverge in wording, not just glyphs (結帳→结算, not a
	// character-for-character conversion of 結帳's simplified glyphs).
	'zh-CN': { buy:'购买', add:'加入购物车', soldOut:'已售罄', viewCart:'查看购物车', inCart:'购物车内', cart:'购物车', shop:'商店', chooseOptions:'选择规格', checkout:'去结算', confirmPrice:'确认新价格并结算', subtotal:'总计', taxIncluded:'含税', remove:'移除', quantity:'数量', decreaseQuantity:'减少数量', increaseQuantity:'增加数量', emptyCart:'请从左侧加入商品。', soldOutMessage:'请移除已售罄的商品：{items}。', priceChangedMessage:'{items}的价格已变更；请确认新价格后再结算。', storageNotice:'离开此页面后，购物车内容将不会保留。', checkoutError:'无法开始结算，请再试一次。', checkoutBusy:'目前尝试次数过多，请稍候再试。', checkoutClosed:'此商店目前不接受订单。', checkoutAgain:'此订单已开始，请再试一次。', checkoutUnavailable:'商店目前没有响应，请稍后再试。', checkoutPending:'正在前往支付页面…', checkoutNote:'付款页由 Square 提供（日文界面）', empty:'商店目前没有商品，请稍后再来。', unconnected:'尚未连接商店。', error:'目前无法加载商店。' }
};

// 🩸 0.11.10: only recognised `zh-tw`/`zh-hant(-*)` — every OTHER zh tag (a genuine `zh-Hans`/
// `zh-CN`, or the bare `zh` a site's plain `<html lang>` carries) fell through to the English row,
// same shape as inbox-bubble's finding #5 fix. Same resolution order: an explicit Simplified signal
// (`hans`, or a `-CN`/`-SG` region with no script subtag) wins Simplified; a bare `zh` defaults
// Traditional, this coral's (and REEF's) existing zh-TW-first convention.
function localeDictionary(locale) {
	const normalized = String(locale || '').toLowerCase();
	if (normalized.startsWith('ja')) return { ...LABEL_DICTIONARIES['ja-JP'] };
	if (normalized.startsWith('zh')) {
		const simplified = normalized.includes('hans') || /-(cn|sg)(-|$)/.test(normalized);
		return { ...LABEL_DICTIONARIES[simplified ? 'zh-CN' : 'zh-TW'] };
	}
	return { ...LABEL_DICTIONARIES['en-US'] };
}

function readLabels(el) {
	const locale = el.getAttribute('data-locale') || el.getAttribute('data-shop-locale') || (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en-US';
	const defaults = localeDictionary(locale);
	return {
		...defaults,
		locale,
		buy: el.getAttribute('data-buy-label') || defaults.buy,
		add: el.getAttribute('data-add-label') || defaults.add,
		chooseOptions: el.getAttribute('data-choose-options-label') || defaults.chooseOptions,
		checkout: el.getAttribute('data-checkout-label') || defaults.checkout,
		subtotal: el.getAttribute('data-subtotal-label') || defaults.subtotal,
		cart: el.getAttribute('data-cart-heading') || defaults.cart,
		emptyCart: el.getAttribute('data-empty-cart-label') || defaults.emptyCart,
		soldOut: el.getAttribute('data-sold-out-label') || defaults.soldOut,
		viewCart: el.getAttribute('data-view-cart-label') || defaults.viewCart,
		inCart: el.getAttribute('data-in-cart-label') || defaults.inCart,
		shop: el.getAttribute('data-shop-label') || defaults.shop,
		confirmPrice: el.getAttribute('data-confirm-price-label') || defaults.confirmPrice,
		remove: el.getAttribute('data-remove-label') || defaults.remove,
		quantity: el.getAttribute('data-quantity-label') || defaults.quantity,
		soldOutMessage: el.getAttribute('data-sold-out-message') || defaults.soldOutMessage,
		priceChangedMessage: el.getAttribute('data-price-changed-message') || defaults.priceChangedMessage,
		storageNotice: el.getAttribute('data-storage-notice') || defaults.storageNotice,
		// Buyer-facing checkout failures. Plain language on purpose: a shopper can
		// act on "try again in a moment", never on "client_request_ref is required".
		checkoutError: el.getAttribute('data-checkout-error-label') || defaults.checkoutError,
		checkoutBusy: el.getAttribute('data-checkout-busy-label') || defaults.checkoutBusy,
		checkoutClosed: el.getAttribute('data-checkout-closed-label') || defaults.checkoutClosed,
		checkoutAgain: el.getAttribute('data-checkout-again-label') || defaults.checkoutAgain,
		checkoutUnavailable: el.getAttribute('data-checkout-unavailable-label') || defaults.checkoutUnavailable,
		// What the button SAYS while the checkout request is in flight (sweep #22).
		// Same data-* contract as every other label, so a zh-TW host passes its own.
		checkoutPending: el.getAttribute('data-checkout-pending-label') || defaults.checkoutPending,
		// 🔴 NOT `|| defaults.checkoutNote` — that would make `data-checkout-note=""` indistinguishable
		// from the attribute being absent, and "hide the note entirely" has to be an option a site can
		// reach (see the file-header doc comment). `getAttribute` (unlike a `||` short-circuit) already
		// tells the two apart on its own: `null` only when the attribute was never set at all — that is
		// the one case that falls back to the localized default; an explicit empty string wins as empty.
		checkoutNote: (() => { const v = el.getAttribute('data-checkout-note'); return v !== null ? v : defaults.checkoutNote; })(),
		empty: el.getAttribute('data-empty-label') || defaults.empty,
		unconnected: el.getAttribute('data-unconnected-label') || defaults.unconnected,
		error: el.getAttribute('data-error-label') || defaults.error
	};
}

function itemCard(it, labels, detailBase) {
	// When a detail base is set (e.g. data-detail-base="/shop") AND the item has a
	// slug, the image + name link to the product's own page; otherwise plain.
	const href = detailBase && it.slug ? `${detailBase}/${encodeURIComponent(it.slug)}` : '';
	const label = itemName(it);
	const img = it.image_url
		? `<img class="${PREFIX}-img" src="${escHtml(it.image_url)}" alt="${escHtml(label)}" loading="lazy">`
		: '';
	const nameInner = `<p class="${PREFIX}-name">${escHtml(label)}</p>`;
	const variantCount = it.variant_count || 1;

	// Multiple variants: adding the DEFAULT one straight from the grid would silently cart something
	// the shopper never chose. Route to the product page instead — the WHOLE card is one link (real,
	// keyboard-reachable, no nested interactive elements), price shows the variant range.
	if (variantCount > 1 && href) {
		const card = document.createElement('a');
		card.className = `${PREFIX}-card ${PREFIX}-card--link`;
		card.href = href;
		card.innerHTML = `
			${img}
			<div class="${PREFIX}-body">
				${nameInner}
				<p class="${PREFIX}-price">${escHtml(formatPriceRange(it.price_min, it.price_max, it.currency, labels.locale))}${taxInclusiveSuffix(it.currency, labels.taxIncluded)}</p>
				<span class="${PREFIX}-buy">${escHtml(labels.chooseOptions)}</span>
			</div>
		`;
		return card;
	}

	const card = document.createElement('div');
	card.className = `${PREFIX}-card`;
	card.innerHTML = `
		${href ? `<a class="${PREFIX}-link" href="${escHtml(href)}">${img}</a>` : img}
		<div class="${PREFIX}-body">
			${href ? `<a class="${PREFIX}-link" href="${escHtml(href)}">${nameInner}</a>` : nameInner}
			<p class="${PREFIX}-price">${escHtml(formatPrice(it.display_price, it.currency, labels.locale))}${taxInclusiveSuffix(it.currency, labels.taxIncluded)}</p>
		</div>
	`;
	return card;
}

// instant mode (default) — one Buy button per card, straight to checkout.
function renderInstant(root, items, apiBase, guildId, labels, detailBase, checkoutRefs) {
	// The sibling locator, read off the host rather than added to this signature — same choice
	// renderCart makes below, and for the same reason: mount() is not the only caller shape this
	// file has to keep working. With a guild it is never consulted (see shopLocator).
	const siteId = root.getAttribute('data-site-id') || '';
	const grid = document.createElement('div');
	grid.className = `${PREFIX}-grid`;
	for (const it of items) {
		const card = itemCard(it, labels, detailBase);
		if ((it.variant_count || 1) <= 1) {
			const buy = document.createElement('button');
			buy.type = 'button';
			buy.className = `${PREFIX}-buy`;
			buy.textContent = it.buy_label || labels.buy;
			buy.addEventListener('click', () =>
				startCheckout(apiBase, guildId, it.variation_id, buy, checkoutRefs, labels, siteId, detailBase)
			);
			card.querySelector(`.${PREFIX}-body`).appendChild(buy);
		}
		grid.appendChild(card);
	}
	root.innerHTML = '';
	root.appendChild(grid);
}

// cart mode (data-cart="1") — add/adjust quantities, one Checkout for the whole
// cart. State is a per-mount Map(variation_id -> qty); the grid and the summary
// panel both re-render off it.
function renderCart(root, items, apiBase, guildId, labels, collectShipping, detailBase, checkoutRefs) {
	const itemsById = new Map(items.map((it) => [it.variation_id, it]));
	const lineStates = new Map();
	// clear the cart if we've just returned from a completed checkout, then
	// hydrate from localStorage (reconciled against the live catalog).
	// The site locator, read off the host the same way data-cart below is, so the exported
	// signature — which feelreef's SPA wrapper and two tests here drive — does not move.
	//
	// One read, two uses, spelled separately because they are two decisions that happen to agree:
	// `siteId` is what names a guildless storefront on the WIRE (shopLocator, at the checkout
	// below), while `storeId` is the BASKET's localStorage key. With a guild, storeId is the
	// guild — character for character the key a live shop already wrote, which is the whole
	// point: that key lives on the shopper's machine, so moving it would empty the basket rather
	// than migrate it.
	const siteId = root.getAttribute('data-site-id') || '';
	const storeId = guildId || siteId;
	consumeCheckoutReturn();
	const cart = loadPersistedCart(storeId, itemsById);

	// products on the left, sticky cart on the right (feelreef picker layout). With data-cart="header"
	// the sidebar is suppressed (grid full-width) but the panel is STILL rendered — a header drawer
	// relocates it out. The hide is scoped to `--hosted-cart > .cart`, so once relocated (no longer a
	// child of the hosted layout) the panel shows normally in the drawer; and there's no inline flash.
	const noSidebar = root.getAttribute('data-cart') === 'header';
	root.innerHTML = '';
	const layout = document.createElement('div');
	layout.className = `${PREFIX}-layout` + (noSidebar ? ` ${PREFIX}-layout--hosted-cart` : '');
	const grid = document.createElement('div');
	grid.className = `${PREFIX}-grid`;
	const panel = document.createElement('div');
	panel.className = `${PREFIX}-cart`;
	layout.append(grid, panel);
	root.appendChild(layout);

	function setQty(vid, qty) {
		const q = Math.max(0, Math.min(99, qty | 0));
		if (q <= 0) { cart.delete(vid); lineStates.delete(vid); }
		else cart.set(vid, q);
		persistCart(storeId, cart);
		render();
	}

	function stepper(vid, disabled = false) {
		const wrap = document.createElement('div');
		wrap.className = `${PREFIX}-stepper`;
		const qty = cart.get(vid) || 0;
		const minus = document.createElement('button');
		minus.type = 'button';
		minus.className = `${PREFIX}-step`;
		minus.textContent = '−'; // minus sign
		minus.setAttribute('aria-label', labels.decreaseQuantity);
		minus.disabled = disabled;
		minus.addEventListener('click', () => setQty(vid, (cart.get(vid) || 0) - 1));
		const count = document.createElement('span');
		count.className = `${PREFIX}-qty`;
		count.textContent = String(qty);
		const plus = document.createElement('button');
		plus.type = 'button';
		plus.className = `${PREFIX}-step`;
		plus.textContent = '+';
		plus.setAttribute('aria-label', labels.increaseQuantity);
		plus.disabled = disabled;
		plus.addEventListener('click', () => setQty(vid, (cart.get(vid) || 0) + 1));
		wrap.append(minus, count, plus);
		return wrap;
	}

	function renderGrid() {
		grid.innerHTML = '';
		for (const it of items) {
			const card = itemCard(it, labels, detailBase);
			if ((it.variant_count || 1) <= 1) {
				const body = card.querySelector(`.${PREFIX}-body`);
				if (cart.get(it.variation_id)) {
					body.appendChild(stepper(it.variation_id));
				} else {
					const add = document.createElement('button');
					add.type = 'button';
					add.className = `${PREFIX}-buy`;
					add.textContent = it.add_label || labels.add;
					add.addEventListener('click', () => setQty(it.variation_id, 1));
					body.appendChild(add);
				}
			}
			grid.appendChild(card);
		}
	}

	// The cart is ALWAYS visible in cart mode (like feelreef's "$0/yr" panel):
	// running total up top, then either a hint (empty) or the editable lines.
	function renderPanel() {
		let subtotal = 0;
		// Seed from the seller's OWN catalog, not a hardcoded 'USD'. The lines
		// below overwrite this per item once the cart has contents, but an EMPTY
		// cart never reaches them — so a JPY seller's resting panel rendered
		// "$0.00" next to a wall of ¥ prices (caught live on soda, the first
		// non-USD BYO seller). 'USD' stays the last-resort fallback for a
		// catalog that carries no currency at all.
		let currency = (items.find((it) => it.currency) || {}).currency || 'USD';
		panel.innerHTML = '';

		const heading = document.createElement('p');
		heading.className = `${PREFIX}-cart-h`;
		heading.textContent = labels.cart;
		const total = document.createElement('p');
		total.className = `${PREFIX}-cart-total`;
		panel.appendChild(heading);

		// 🔴 The tail — the hint or the lines — is BUILT here and appended below, one step later than
		// it used to be. The lines loop is what settles which currency this cart is actually in, and
		// the total's label is a function of that currency, so the label cannot be written before the
		// loop has run. Nothing moves on the page: the order stays heading · [total label] · total ·
		// hint-or-lines · checkout, and a non-JPY panel emits the same nodes it always did.
		let tail;
		if (cart.size === 0) {
			const hint = document.createElement('p');
			hint.className = `${PREFIX}-cart-hint`;
			hint.textContent = labels.emptyCart;
			total.textContent = formatPrice(0, currency, labels.locale);
			tail = hint;
		} else {
			const lines = document.createElement('div');
			lines.className = `${PREFIX}-cart-lines`;
			for (const [vid, qty] of cart) {
				const it = itemsById.get(vid);
				if (!it) continue;
				const state = lineStates.get(vid);
				currency = it.currency || currency;
				const lineAmt = (Number(it.display_price) || 0) * qty;
				subtotal += lineAmt;

				const line = document.createElement('div');
				line.className = `${PREFIX}-line` + (state && state.reason === 'sold_out' ? ` ${PREFIX}-line--sold-out` : '');
				const main = document.createElement('div');
				main.className = `${PREFIX}-line-main`;
				const name = document.createElement('span');
				name.className = `${PREFIX}-line-name`;
				name.textContent = itemName(it);
				main.append(name);
				if (state && state.reason === 'sold_out') {
					const badge = document.createElement('span');
					badge.className = `${PREFIX}-line-badge`;
					badge.textContent = labels.soldOut;
					main.appendChild(badge);
				}
				main.appendChild(stepper(vid, !!(state && state.reason === 'sold_out')));
				const price = document.createElement('span');
				price.className = `${PREFIX}-line-price`;
				price.innerHTML = cartLinePriceHtml(lineAmt, it.currency, labels);
				const rm = document.createElement('button');
				rm.type = 'button';
				rm.className = `${PREFIX}-rm`;
				rm.textContent = '×'; // multiplication sign as remove glyph
				rm.setAttribute('aria-label', `${labels.remove} ${itemName(it)}`);
				rm.addEventListener('click', () => setQty(vid, 0));
				line.append(main, price, rm);
				lines.appendChild(line);
			}
			total.textContent = formatPrice(subtotal, currency, labels.locale);
			tail = lines;
		}

		// One tax statement per row: the lines carry 税込 after the amount (same markup as the card),
		// the total carries it inside its label —「合計（税込）」— which is how a Japanese shop writes
		// a total. subtotalLabel() is '' for every other currency, so no node is created and those
		// panels keep exactly the two-element head they have always had.
		const totalLabel = subtotalLabel(currency, labels);
		if (totalLabel) {
			const sub = document.createElement('p');
			sub.className = `${PREFIX}-cart-subtotal`;
			sub.textContent = totalLabel;
			panel.appendChild(sub);
		}
		panel.append(total, tail);

		const checkout = document.createElement('button');
		checkout.type = 'button';
		checkout.className = `${PREFIX}-checkout`;
		const confirmsPrice = [...lineStates.values()].some((state) => state.reason === 'price_changed');
		const hasSoldOut = [...lineStates.values()].some((state) => state.reason === 'sold_out');
		checkout.textContent = confirmsPrice ? labels.confirmPrice : labels.checkout;
		checkout.disabled = cart.size === 0 || hasSoldOut;
		checkout.addEventListener('click', () => {
			if (confirmsPrice) lineStates.clear();
			return startCartCheckout(apiBase, guildId, cart, collectShipping, checkout, labels, checkoutRefs, siteId, handleConflict);
		});
		panel.appendChild(checkout);
		// Finding #12 (2026-09-03 cold-read): the Square-hosted page a shopper lands on after
		// this button is Square's own surface, and today it is ALWAYS Japanese — a zh-TW/en-US
		// shopper who has read this shop's own language the whole way through got dropped into
		// that with no warning. `checkoutNote` is '' (falsy) when a site explicitly suppressed it
		// via `data-checkout-note=""`, so no empty node is created either way.
		if (labels.checkoutNote) {
			const note = document.createElement('p');
			note.className = `${PREFIX}-checkout-note`;
			note.textContent = labels.checkoutNote;
			panel.appendChild(note);
		}
		const storageText = storageAvailabilityNotice(cart.storageAvailable, labels);
		if (storageText) {
			const notice = document.createElement('p');
			notice.className = `${PREFIX}-storage-notice`;
			notice.textContent = storageText;
			panel.appendChild(notice);
		}
	}

	async function handleConflict(states, reason) {
		lineStates.clear();
		for (const [vid, state] of states) {
			lineStates.set(vid, state);
			if (state.reason === 'price_changed' && state.price_minor !== undefined) {
				const it = itemsById.get(vid);
				if (it) {
					const currency = state.currency || it.currency || 'USD';
					const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
					it.display_price = state.price_minor / (10 ** digits);
					it.currency = currency;
				}
			}
		}
		render();
		const names = [...states.keys()].map((vid) => itemName(itemsById.get(vid) || { name: vid })).join(', ');
		showCheckoutMessage(panel, (reason === 'sold_out' ? labels.soldOutMessage : labels.priceChangedMessage).replace('{items}', names));
		try {
			const data = await fetchCatalog(apiBase, shopLocatorParam(guildId, siteId));
			for (const fresh of (Array.isArray(data && data.items) ? data.items : []).map(withVariantSummary)) {
				const current = itemsById.get(fresh.variation_id);
				if (current) Object.assign(current, fresh);
			}
			renderGrid();
		} catch { /* conflict remains actionable even if refresh fails */ }
	}

	function render() {
		renderGrid();
		renderPanel();
	}

	render();
}

// Read the item list back off the edge-SSR'd cards, so the client can rebuild the grid with NO
// network call (variation_id/price/currency/slug from data-attrs, name from the card text). The
// edge worker keeps the SSR ≤60s fresh, so this needs no reconcile.
function itemsFromSsr(grid) {
	const out = [];
	grid.querySelectorAll(`.${PREFIX}-card`).forEach((c) => {
		const vid = c.getAttribute('data-variation-id');
		if (!vid) return;
		const nameEl = c.querySelector(`.${PREFIX}-name`);
		const imgEl = c.querySelector(`.${PREFIX}-img`);
		const priceRaw = c.getAttribute('data-price');
		const price = (priceRaw == null || priceRaw === '') ? null : Number(priceRaw);
		const countRaw = c.getAttribute('data-variant-count');
		const minRaw = c.getAttribute('data-price-min');
		const maxRaw = c.getAttribute('data-price-max');
		out.push({
			variation_id: vid,
			name: nameEl ? nameEl.textContent : '',
			image_url: imgEl ? (imgEl.getAttribute('src') || '') : '',
			display_price: (price != null && !isNaN(price)) ? price : null,
			currency: c.getAttribute('data-currency') || 'USD',
			slug: c.getAttribute('data-slug') || '',
			variant_count: countRaw ? (parseInt(countRaw, 10) || 1) : 1,
			price_min: (minRaw == null || minRaw === '') ? null : Number(minRaw),
			price_max: (maxRaw == null || maxRaw === '') ? null : Number(maxRaw)
		});
	});
	return out;
}

// Placeholder cards holding the grid's shape while the catalog loads — reserves space (no layout
// shift). Only the NON-SSR path uses this (a static build, or a host whose edge worker isn't
// rendering the grid); an edge-SSR'd page never blanks in the first place.
function skeletonHtml(cartMode) {
	const cards = Array.from({ length: 6 }, () =>
		`<div class="${PREFIX}-card ${PREFIX}-skel"><div class="${PREFIX}-img ${PREFIX}-skel-box"></div><div class="${PREFIX}-body"><div class="${PREFIX}-skel-line"></div><div class="${PREFIX}-skel-line ${PREFIX}-skel-line--sm"></div></div></div>`
	).join('');
	const grid = `<div class="${PREFIX}-grid" aria-hidden="true">${cards}</div>`;
	return cartMode ? `<div class="${PREFIX}-layout">${grid}</div>` : grid;
}

async function mount(el) {
	injectStyles();
	el.classList.add(PREFIX);
	const guildId = el.getAttribute('data-guild-id') || '';
	const siteId = el.getAttribute('data-site-id') || '';
	const apiBase = el.getAttribute('data-api-base') || DEFAULT_API_BASE;
	// data-cart: "0"/absent = instant per-item checkout · "1" = cart mode with the inline sticky
	// sidebar · "header" = cart mode WITHOUT the inline sidebar (grid goes full-width; the cart
	// panel is still rendered so a header-hosted drawer — sitetile's header-actions-cart island —
	// can relocate & show it). Making the sidebar a first-class switch keeps the coral general:
	// a site picks its cart surface at the coral, not via a platform-only relocation side effect.
	const cartRaw = el.getAttribute('data-cart') || '';
	const cartMode = cartRaw === '1' || cartRaw === 'header';
	const collectShipping = el.getAttribute('data-collect-shipping') === '1';
	const detailBase = el.getAttribute('data-detail-base') || '';
	const labels = readLabels(el);
	// One ref map per mount — see newClientRequestRef above for why its lifetime
	// (this page load) is exactly the lifetime of a buy-intent.
	const checkoutRefs = new Map();
	// 🔴 BOTH missing, not just the guild. This runs BEFORE the SSR fast path below, so while it
	// read `!guildId` it did not merely fail to hydrate a guildless site — it replaced the grid the
	// edge worker had already rendered with this error line. Still fail-closed on a host that names
	// no storefront at all: an empty locator asks the catalog for everyone's shop.
	if (!guildId && !siteId) {
		el.innerHTML = `<p class="${PREFIX}-error">square-shop: missing data-site-id / data-guild-id</p>`;
		return;
	}

	// Fast path: the edge worker already SSR'd the grid into this root (data-ssr marker). Rebuild
	// from the cards' embedded data — no network — so the visible grid never blanks and add-to-cart
	// is live immediately. renderCart wipes+rebuilds synchronously, so replacing the identical SSR
	// grid never paints an empty frame (seamless). If the SSR data can't be parsed, fall through.
	const ssrGrid = el.querySelector(`.${PREFIX}-grid[data-ssr]`);
	if (ssrGrid) {
		const ssrItems = itemsFromSsr(ssrGrid);
		if (ssrItems.length) {
			if (cartMode) renderCart(el, ssrItems, apiBase, guildId, labels, collectShipping, detailBase, checkoutRefs);
			else renderInstant(el, ssrItems, apiBase, guildId, labels, detailBase, checkoutRefs);
			return;
		}
	}

	// No SSR: reserve the grid's shape with a skeleton (no layout shift), then fetch + render.
	el.innerHTML = skeletonHtml(cartMode);
	try {
		const data = await fetchCatalog(apiBase, shopLocatorParam(guildId, siteId));
		const items = (Array.isArray(data && data.items) ? data.items : []).map(withVariantSummary);
		if (!data || data.connected !== true) {
			el.innerHTML = `<p class="${PREFIX}-empty">${escHtml(labels.unconnected)}</p>`;
			return;
		}
		if (items.length === 0) {
			el.innerHTML = `<p class="${PREFIX}-empty">${escHtml(labels.empty)}</p>`;
			return;
		}
		if (cartMode) renderCart(el, items, apiBase, guildId, labels, collectShipping, detailBase, checkoutRefs);
		else renderInstant(el, items, apiBase, guildId, labels, detailBase, checkoutRefs);
	} catch {
		// Honest failure — never fabricate products on a network/API error.
		el.innerHTML = `<p class="${PREFIX}-error">${escHtml(labels.error)}</p>`;
	}
}

function mountAll() {
	document.querySelectorAll(SELECTOR).forEach((el) => {
		if (el.getAttribute('data-dynamic-coral-mounted') === '1') return;
		el.setAttribute('data-dynamic-coral-mounted', '1');
		mount(el);
	});
}

// The self-mount tail, unchanged for a browser — a sitetile `<script type="module" src>` embed still
// auto-mounts with no caller. The `document` guard is what lets Node IMPORT this file (there is no
// document there, and the line below used to throw at load), so the ref/price/message logic can be
// unit-tested instead of only being reachable through a real page.
if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', mountAll);
	} else {
		mountAll();
	}
}

// Additive named exports. `mount`/`mountAll` repay the back-port debt recorded in
// ./PROVENANCE.md (feelreef's SPA wrapper re-mounts on client navigation); the rest are the pure
// helpers the tests drive. Nothing here changes how the embed behaves — the tail above still runs.
export {
	mount,
	mountAll,
	newClientRequestRef,
	cartRefKey,
	checkoutRefFor,
	checkoutCompletionUrl,
	consumeCheckoutReturn,
	checkoutErrorMessage,
	errorResponseToLineStates,
	localeDictionary,
	storageAvailabilityNotice,
	startCheckout,
	startCartCheckout,
	// Exported for the ONE assertion the real paths cannot make: settle()'s optional
	// failure-label override, which neither call site here uses (this file answers a
	// refusal in the -msg node instead). Kept identical to the feelreef fork's copy so
	// the helper stays one unit to reconcile — see its doc comment. The pending state
	// itself is still tested through startCheckout/startCartCheckout, never through this.
	beginPending,
	itemName,
	variantDisplayPrice,
	withVariantSummary,
	readLabels,
	// itemCard is what every render path here builds a card with, so it is the only place the
	// client's price markup exists. Exported so shop-grid-client-parity.test.mjs can hold it
	// against renderShopGrid's output instead of asserting about this file's source text.
	itemCard,
	// renderCart is exported for the same reason itemCard is, one level up: the cart panel is the
	// only place the basket's price markup exists, and a helper that is exported and tested while
	// renderPanel quietly keeps assigning textContent is a green light over an unchanged bug. The
	// parity test drives this function and reads the nodes it actually built.
	renderCart,
	formatMoney,
	formatPrice,
	formatPriceRange,
	taxInclusiveSuffix,
	cartLinePriceHtml,
	subtotalLabel
};
