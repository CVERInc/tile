// @ts-nocheck
// @tile/dynamic-corals — square-shop / CF Pages advanced-mode _worker.js TEMPLATE.
//
// The build pipeline (build-deploy-sitetile.sh) emits a per-site copy of this to
// `dist/_worker.js` for EVERY site, with the render core (product-page-core.js)
// prepended and `__SHOP_CONFIG__` replaced by the site's baked JSON config.
// `wrangler pages deploy <dir>` reliably picks up a root `_worker.js` (unlike a
// `<dir>/functions/` folder, which it ignores — verified live 2026-07-10).
//
// It does two things. (1) TRANSPORT: the paths the API contract assigns to RSP
// go to the RSP service binding on this site's own origin, and the paths whose
// bytes are the site's but whose paywall is RSP's are served here after RSP
// answers a yes/no. This half is present on every site, shop or not. (2) SHOP:
// where the site has one, it renders /shop/<slug> (and any other configured shop
// path, e.g. /zh-tw/shop) at the edge — live data + per-product OG wrapped in
// the site's OWN shell (the already-built /shop page is the shell donor).
// EVERYTHING ELSE falls straight through to the static assets via env.ASSETS.
//
// stripDonorHead / injectHead / replaceMain / matchShop are pure and unit-tested.

/*__CANONICAL_HELPERS__*//*__QUERY_REDIRECT_HELPERS__*/function stripDonorHead(html) {
	return html
		.replace(/<title>[\s\S]*?<\/title>/i, '')
		.replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
		.replace(/<meta\s+property=["']og:[^"']*["'][^>]*>/gi, '')
		.replace(/<meta\s+name=["']twitter:[^"']*["'][^>]*>/gi, '')
		.replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '');
}
function injectHead(html, headMeta) {
	return html.replace(/<\/head>/i, headMeta + '\n</head>');
}
function replaceMain(html, innerHtml) {
	return html.replace(/(<main\b[^>]*>)[\s\S]*?(<\/main>)/i, function (_m, open, close) {
		return open + '\n' + innerHtml + '\n' + close;
	});
}

// Which configured shop does this path belong to, and what's the product slug?
// Returns { shop, slug } or null. `shops` is sorted longest-path-first so
// /zh-tw/shop wins over /shop (they don't overlap, but be safe).
function matchShop(path, shops) {
	for (const shop of shops) {
		const prefix = shop.shopPath + '/';
		if (path.startsWith(prefix)) {
			const rest = path.slice(prefix.length);
			if (rest && rest.indexOf('/') === -1) {
				return { shop: shop, slug: decodeURIComponent(rest) };
			}
		}
	}
	return null;
}

function htmlResponse(body, status) {
	return new Response(body, {
		status: status || 200,
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60, must-revalidate' }
	});
}

// Provider B keeps its existing compatibility locator. Source selection happened in the baked
// descriptor before this code ran; this function cannot create a storefront.
function shopLocatorParam(cfg) {
	return cfg.guildId
		? `guild_id=${encodeURIComponent(cfg.guildId)}`
		: `site_id=${encodeURIComponent(cfg.siteId || '')}`;
}

// ─── PLATFORM READS ───────────────────────────────────────────────────────────
// Every SERVER-SIDE read this worker makes of the platform while composing a page
// (buyer-page facts, the private-path verdict, the native catalog projection) goes
// through ONE reader, chosen per request, in order. The provider catalog reads are
// not among them: they stay the own-host fetch (see fetchProductJson).
//
//   1. the RSP service binding, env[bindingName] — today's Pages path. The reader IS
//      the binding object itself, so that path makes exactly the calls it always did.
//   2. a request-scoped capability stub the dispatcher handed this request in
//      ctx.props.CONNECTOR (Workers for Platforms; GET-only, read routes only).
//      Selected only on a worker baked with a transport contract, like tier 1.
//      🔴 Read off THIS request's ctx every time and never kept anywhere else: a
//      stub used outside the request that carried it throws a cross-request I/O error.
//   3. a per-Site read token baked into the config as readToken: { origin, token }:
//      a public GET to that origin, carrying the token in PLATFORM_READ_TOKEN_HEADER
//      only on the routes RSP accepts it for (PLATFORM_READ_TOKEN_PATHS); RSP refuses
//      the token on any other route. Absent by default; nothing in this file issues or
//      rotates one.
//
// The first tier present is THE tier: a selected tier that fails is that read
// failing, never a cue to try the next one. None present → null, and each caller
// answers its own honest unavailability exactly as it does today when the binding
// is missing — never a 200.
//
// 🔴 Browser-facing forwards (the contract's `forward` set) are NOT reads and never
// come here: they keep the binding and nothing else (see fetch below), because the
// visitor's own request — cookies, body, Origin — must not ride a read capability.
const PLATFORM_READ_STUB_PROP = 'CONNECTOR';
const PLATFORM_READ_TOKEN_HEADER = 'x-site-read-token';
const PLATFORM_READ_TOKEN_PATHS = ['/api/membership/plans', '/api/account/surface', '/api/subscribe/result', '/seam/site-verdict-v2', '/api/v2/storefront/native'];
function platformReader(env, ctx, cfg) {
	const transport = cfg && cfg.apiTransport;
	const name = transport && transport.bindingName;
	const binding = name && env ? env[name] : null;
	if (binding) return binding;
	const props = ctx && ctx.props;
	const stub = name && props ? props[PLATFORM_READ_STUB_PROP] : null;
	if (stub && typeof stub.fetch === 'function') return stub;
	const rt = cfg && cfg.readToken;
	if (rt && typeof rt.origin === 'string' && rt.origin && typeof rt.token === 'string' && rt.token) {
		return platformTokenReader(rt.origin, rt.token);
	}
	return null;
}

// Tier 3: the same Request a binding would have been handed, re-addressed to the
// token's origin. The path and query travel as the caller built them, and the
// visitor's own headers (cookie included) ride along as on the other tiers; `host` is
// the Worker's own and is dropped so the fetch addresses the token's origin. Whatever
// token header the visitor sent is always dropped; the Site's token is added only on a
// route RSP accepts it for. (An outbound REQUEST's headers, built as a fresh object; no
// response header is touched.)
function platformTokenReader(origin, token) {
	return {
		fetch(req) {
			const url = new URL(req.url);
			const outbound = {};
			for (const [k, v] of req.headers) if (k !== 'host' && k !== PLATFORM_READ_TOKEN_HEADER) outbound[k] = v;
			if (PLATFORM_READ_TOKEN_PATHS.includes(url.pathname)) outbound[PLATFORM_READ_TOKEN_HEADER] = token;
			return fetch(new Request(origin + url.pathname + url.search, { method: 'GET', headers: outbound }));
		}
	};
}

// ─── EDGE CACHE ───────────────────────────────────────────────────────────────
// caches.default is an optimisation, never a dependency. Where it is absent, or where the
// runtime refuses it (a Workers-for-Platforms namespace answers "not permitted"), every use
// below degrades to a cache MISS and the response is never put — the page is still served.
// Where it works, the calls are the same ones the worker always made.
function edgeCache() {
	try { return (typeof caches !== 'undefined' && caches.default) ? caches.default : null; } catch (e) { return null; }
}
// A lookup that threw marks the cache unusable for this request (cache: null), so no put follows.
async function edgeCacheLookup(cache, key) {
	if (!cache) return { cache: null, hit: null };
	try { return { cache, hit: await cache.match(key) }; } catch (e) { return { cache: null, hit: null }; }
}
// A put that throws, synchronously or later, is dropped; it never decides the response.
function edgeCachePut(cache, key, res) {
	try { return Promise.resolve(cache.put(key, res)).catch(() => {}); } catch (e) { return Promise.resolve(); }
}

// Resolve the product JSON. Prefer SAME-ORIGIN /api (proxied through CF's backbone, ~0.08s) over
// the raw backend origin (cross-region public internet + dyno wake, ~1s+ — verified live). Validate
// it's actually JSON: CF Pages serves a 200 HTML SPA-fallback for unknown paths, so `ok` isn't
// enough. Fall back to the configured apiBase so a site that doesn't proxy /api still works.
//
// The catalog reads (this one and fetchCatalogList) stay the own-host fetch on EVERY tier and
// never use the platform reader, binding, stub or token: the serving-topology owner
// (plan/canonical/site/platform.md) limits server-side read routes to buyer-page facts, the
// private-path verdict and the native catalog projection, and excludes any route rate-limited
// per visitor, because a server-side hop does not carry the visitor's address. Under a
// platform namespace the own-host GET reaches the dispatch Worker, which forwards it to RSP.
async function fetchProductJson(origin, apiBase, locator, slug, rail) {
	const path = `/api/v2/shop/catalog/item?${locator}&slug=${encodeURIComponent(slug)}&payment_rail=${encodeURIComponent(rail)}`;
	try {
		const r = await fetch(origin + path, { headers: { Accept: 'application/json' } });
		const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
		if (r.ok && !/html/i.test(ct)) { const d = await r.json().catch(() => null); if (d) return d; }
	} catch (e) { /* fall through to the configured backend */ }
	try {
		const r = await fetch(apiBase + path, { headers: { Accept: 'application/json' } });
		if (r.ok) return await r.json().catch(() => null);
	} catch (e) { /* give up → caller redirects to /shop */ }
	return null;
}

async function renderProduct(request, env, ctx, cfg, match) {
	const url = new URL(request.url);
	const origin = url.origin;
	const shopPath = match.shop.shopPath;
	const shopUrl = origin + shopPath;

	// Edge-cache the rendered product HTML (public, max-age 60). Key on path only so query strings
	// don't fragment it; a warm hit skips the API + shell round-trips entirely.
	let cache = edgeCache();
	const cacheKey = cache ? new Request(origin + url.pathname) : null;
	if (cache) { const looked = await edgeCacheLookup(cache, cacheKey); cache = looked.cache; if (looked.hit) return looked.hit; }

	try {
		// product data + shell donor are independent → fetch them IN PARALLEL
		const [data, shellRes] = await Promise.all([
			fetchProductJson(origin, cfg.apiBase, shopLocatorParam(cfg), match.slug, match.shop.provider),
			env.ASSETS.fetch(new Request(shopUrl + '/', request)),   // shell donor = the built /shop page
		]);
		const product = data && data.item;
		if (!product) return Response.redirect(shopUrl + '/', 302); // unknown product → back to shop

		const canonical = `${shopUrl}/${match.slug}`;
		const rendered = renderProductPage(product, {
			guildId: cfg.guildId, siteId: cfg.siteId, apiBase: cfg.apiBase, siteName: cfg.siteName,
			shopPath: shopPath, labels: match.shop.labels || {}, canonical: canonical, locale: match.shop.locale || 'en-US',
			dynamicCoralCss: cfg.dynamicCoralCss
		});

		let body;
		if (!shellRes.ok) {
			body = `<!doctype html><html><head>${rendered.headMeta}</head><body>${rendered.bodyHtml}</body></html>`;
		} else {
			let shell = await shellRes.text();
			shell = stripDonorHead(shell);
			shell = injectHead(shell, rendered.headMeta + providerRailScopeScript(match.shop.provider));
			shell = replaceMain(shell, rendered.bodyHtml);
			body = shell;
		}
		const res = htmlResponse(body);
		if (cache && ctx && ctx.waitUntil) ctx.waitUntil(edgeCachePut(cache, cacheKey, res.clone()));
		return res;
	} catch (e) {
		return Response.redirect(shopUrl + '/', 302);
	}
}

// Which configured shop INDEX page is this (exact `/shop` or `/shop/`, NOT a `/shop/<slug>` detail)?
function matchShopIndex(path, shops) {
	for (const shop of shops) {
		if (path === shop.shopPath || path === shop.shopPath + '/') return shop;
	}
	return null;
}

function matchShopComplete(path, shops) {
	for (const shop of shops) {
		if (path === shop.shopPath + '/complete' || path === shop.shopPath + '/complete/') return shop;
	}
	const locale = path.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\/shop\/complete\/?$/);
	if (locale) {
		const fallback = shops.find(shop => shop.shopPath === '/shop') || shops[0];
		if (fallback) return { ...fallback, completionShopPath: `/${locale[1]}/shop` };
	}
	return null;
}

function matchNativeCheckoutSuccess(request, shops, route) {
	if (!route || request.method !== route.method) return null;
	let url;
	try { url = new URL(request.url); } catch (e) { return null; }
	if (url.pathname !== route.path || !(url.searchParams.get(route.orderParam) || '').trim()) return null;
	const native = shops.filter(shop => shop.source === 'native');
	return native.find(shop => shop.shopPath === '/shop') || native[0] || null;
}

// The checkout return a Site Worker WITHOUT the RSP binding answers itself (Workers for Platforms:
// the platform read arrives as the dispatcher's stub or the baked token, never as a binding). On
// Pages these requests are the generic forward to RSP's whole-page fallback; here there is no
// binding to forward to, so the same completion page the native return gets is composed in the
// site's shell instead: no order id → its "can't confirm this order here" state, an order id on a
// site whose shops are all provider shops → its pending state, settled by the outcome read the page
// itself makes over /api/. A site with no shop at all gets the same page in its root document's
// shell, its "Back to the shop" link pointing at / (where RSP's whole-page fallback sends it on Pages).
function matchCheckoutResultFallback(request, shops, route) {
	if (!route || request.method !== route.method) return null;
	let url;
	try { url = new URL(request.url); } catch (e) { return null; }
	if (url.pathname !== route.path) return null;
	const native = shops.filter(shop => shop.source === 'native');
	return native.find(shop => shop.shopPath === '/shop') || native[0] ||
		shops.find(shop => shop.shopPath === '/shop') || shops[0] || { shopPath: '', backPath: '/' };
}

const COMPLETE_COPY = {
	'en-US': { paid: 'Thank you for your order', receipt: 'An order confirmation was emailed to you.', pending: 'Confirming your payment', pendingBody: 'Payment processing', waiting: 'Still confirming. Check this page again later or look for the order in your account.', canceled: 'Payment not completed', canceledBody: 'Your cart is unchanged.', refunded: 'This order was refunded', refundedBody: 'The payment for this order has been returned to you.', unknown: "We can't confirm this order here", unknownBody: 'This page appears after you complete a payment. If you paid, sign in to your account or check your confirmation email for the order, or return to the shop.', back: 'Back to the shop', order: 'Order reference', total: 'Total', tax: 'incl. tax' },
	'ja-JP': { paid: 'ご注文ありがとうございます', receipt: 'ご注文確認メールをお送りしました。', pending: 'お支払いを確認しています', pendingBody: 'お支払いを処理中です', waiting: 'まだ確認中です。しばらくしてからこのページを開き直すか、アカウントでご注文をご確認ください。', canceled: 'お支払いは完了していません', canceledBody: 'カートの内容はそのままです。', refunded: 'このご注文は返金されました', refundedBody: 'このご注文のお支払いは返金されています。', unknown: 'ご注文を確認できません', unknownBody: 'このページはお支払いの後に表示されます。お支払い済みの場合は、アカウントにログインするか、確認メールでご注文をご確認いただくか、ショップにお戻りください。', back: 'ショップに戻る', order: '注文番号', total: '合計', tax: '税込' },
	'zh-TW': { paid: '感謝您的訂購', receipt: '訂單確認信已寄到您的電子郵件。', pending: '正在確認您的付款', pendingBody: '款項處理中', waiting: '仍在確認中。請稍後重新開啟這一頁，或到帳戶查看訂單。', canceled: '付款未完成', canceledBody: '購物車內容仍保留。', refunded: '這筆訂單已退款', refundedBody: '這筆訂單的款項已退還給您。', unknown: '在這裡無法確認這筆訂單', unknownBody: '這一頁會在付款完成後顯示。若您已付款，請登入帳戶或查看確認信來確認訂單，或返回商店。', back: '返回商店', order: '訂單編號', total: '合計', tax: '含稅' },
	// 0.11.10 (finding #15, 2026-09-03 cold-read): added alongside zh-TW, not derived from it — see
	// square-shop.js's own zh-CN row for why (wording, not just glyphs, differs).
	'zh-CN': { paid: '感谢您的订购', receipt: '订单确认信已寄到您的电子邮件。', pending: '正在确认您的付款', pendingBody: '款项处理中', waiting: '仍在确认中。请稍后重新打开这一页，或到账户查看订单。', canceled: '付款未完成', canceledBody: '购物车内容仍保留。', refunded: '这笔订单已退款', refundedBody: '这笔订单的款项已退还给您。', unknown: '在这里无法确认这笔订单', unknownBody: '这一页会在付款完成后显示。若您已付款，请登录账户或查看确认信来确认订单，或返回商店。', back: '返回商店', order: '订单编号', total: '合计', tax: '含税' }
};

// What the donor shell DECLARES its language to be — the site's own build-owned
// answer, not a guess made out here.
function shellLang(shell) {
	return ((shell || '').match(/<html\b[^>]*\blang=["']([^"']+)/i) || [])[1] || '';
}

// Make the document declare `lang` on its <html> element — replacing the donor's
// declaration, or adding one when the donor had none. Used only when the copy
// composed into the shell is known to be in a language the donor did not declare.
function withShellLang(shell, lang) {
	const safe = String(lang).replace(/[^A-Za-z0-9-]/g, '');
	return shell.replace(/<html\b[^>]*>/i, function (open) {
		return /\blang=["'][^"']*["']/i.test(open)
			? open.replace(/\blang=["'][^"']*["']/i, 'lang="' + safe + '"')
			: open.replace(/^<html\b/i, '<html lang="' + safe + '"');
	});
}

// The path's locale segment as a language tag: `zh-tw` → `zh-TW`, `ja` → `ja`.
function pathLocaleTag(pathLocale) {
	return String(pathLocale || '').replace(/-([a-z]{2})$/, function (_m, region) { return '-' + region.toUpperCase(); });
}

// Resolve a free-form hint (a shop path, a document's lang, or both) against the
// locale set COMPLETE_COPY carries. Lifted out of completionLocale unchanged so a
// site-owned buyer page can resolve ITS locale from the site's own shell instead
// of picking a platform default.
function localeFromHint(value) {
	const hint = String(value || '').toLowerCase();
	if (/zh(?:-|_)hans|zh-cn/.test(hint)) return 'zh-CN';
	if (/zh(?:-|_)tw|zh-tw|zh(?:-|_)hant/.test(hint)) return 'zh-TW';
	if (/(?:^|[\s/_-])ja(?:[\s/_-]|$)|ja-jp/.test(hint)) return 'ja-JP';
	return 'en-US';
}

// One language tag against the copy table, WITHOUT localeFromHint's English default:
// the table locale the tag names, or '' when the table has no copy for it (`fr`,
// `fr-CA`, a bare `zh`, no tag at all). The same script/region sets localeFromHint
// recognises, so a tag both of them read resolves the same way.
function copyLocaleOf(tag) {
	const t = String(tag || '').trim().toLowerCase().replace(/_/g, '-');
	if (/^zh-(?:hans|cn)(?:-|$)/.test(t)) return 'zh-CN';
	if (/^zh-(?:hant|tw)(?:-|$)/.test(t)) return 'zh-TW';
	if (/^ja(?:-|$)/.test(t)) return 'ja-JP';
	if (/^en(?:-|$)/.test(t)) return 'en-US';
	return '';
}

// The journey locale the checkout return URL may carry as `?lang=`. Untrusted input: only a short
// language tag that names a locale in the copy table counts; anything else (long, malformed, an
// unsupported language) is no hint at all and the caller falls back to the shell's own language.
function returnLangLocale(value) {
	const raw = String(value == null ? '' : value);
	if (!raw || raw.length > 16 || !/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2}$/.test(raw)) return '';
	return copyLocaleOf(raw);
}

function completionLocale(shop, shell, pathLocale, returnLang) {
	if (!pathLocale) {
		const fromReturn = returnLangLocale(returnLang);
		if (fromReturn) return fromReturn;
	}
	if (pathLocale) {
		if (pathLocale === 'zh-tw' || pathLocale === 'zh-hant') return 'zh-TW';
		if (pathLocale === 'zh-cn' || pathLocale === 'zh-hans') return 'zh-CN';
		if (pathLocale === 'ja' || pathLocale === 'ja-jp') return 'ja-JP';
		return 'en-US';
	}
	return localeFromHint((shop && shop.shopPath || '') + ' ' + shellLang(shell));
}

// The result page's money text is the product page's own rule: the emitted worker has
// product-page-core.js prepended, so its formatMoney source is inlined into the page script as
// text. Loaded on its own (unit tests that import this file alone) there is no formatMoney in
// scope, so a plain "<minor> <code>" stand-in keeps rendering working.
function completionFormatMoneySource() {
	return typeof formatMoney === 'function'
		? formatMoney.toString()
		: "function(o){return o.minor+' '+String(o.currency||'USD').toUpperCase()}";
}

function shouldClearCartForOutcome(state) {
	return state === 'paid';
}

// What is LEFT of the basket once an order is confirmed paid.
//
// 🔴 Until 0.11.16 this page answered `localStorage.removeItem(<the whole key>)`, and the comment
// square-shop.js writes over its own storage — "Only the shopper deletes a row" — was false on
// exactly this path. It did not matter while a basket could only hold rows that had just been
// sold. It started mattering when a basket could deliberately KEEP a row the checkout left behind
// (a variation the catalog in hand could not confirm): a paid order then deleted, from the
// shopper's own machine, rows that were never in it.
//
// The outcome payload cannot settle it — its `lines` carry name/qty/amount and no variation id
// (reef apps/rsp/src/commerce/provider-orders.ts#shopCheckoutOutcomeFromProjection). So the coral
// writes down what it sent, under the ref that names the attempt (`dc-square-shop-sold:<ref>`),
// and this reads it back.
//
// Returns the rows to keep, or NULL meaning "remove the whole key" — which is the answer whenever
// there is no record to read: an OLDER coral writes none, and its shopper must not be left with a
// basket that is never cleared. ⚠️ This file ships in the SITE's _worker.js, not with the coral, so
// the two halves arrive on two different deploys; both orders of arrival degrade to exactly the
// behaviour that was there before.
function cartAfterOrder(rawCart, rawSold) {
	let sold;
	try { sold = JSON.parse(rawSold || 'null'); } catch (e) { sold = null; }
	if (!sold || !Array.isArray(sold.ids)) return null;
	let rows;
	try { rows = JSON.parse(rawCart || 'null'); } catch (e) { return null; }
	if (!Array.isArray(rows)) return null;
	// 0.11.19 (tile#40): a record that says HOW MANY of each line went to the till takes that many
	// off the row as it stands NOW, instead of deleting the row. The row may have grown since the
	// checkout left — another tab added one more of the same variation while the shopper was on the
	// hosted payment page — and deleting the row deleted that later add with it. `lines` is
	// [[variationId, qty], ...], written by square-shop.js#recordSoldLines beside `ids`.
	// Quantity is read exactly as square-shop.js#cartRowQty reads it (mirrored inline: this
	// function ships as its own source text inside the completion page).
	const rowQty = function (e) { const a = parseInt(e[1], 10) || 0, b = e.length > 2 ? (parseInt(e[2], 10) || 0) : 0, q = a > b ? a : b; return q < 1 ? 1 : (q > 99 ? 99 : q); };
	let owed = null;
	if (Array.isArray(sold.lines)) {
		owed = {};
		for (const l of sold.lines) {
			if (!Array.isArray(l) || !String(l[0] || '')) { owed = null; break; }
			const n = parseInt(l[1], 10);
			if (!(n >= 1)) { owed = null; break; }
			owed[String(l[0])] = (owed[String(l[0])] || 0) + n;
		}
	}
	if (owed) {
		const out = [];
		for (const e of rows) {
			const vid = Array.isArray(e) ? String(e[0] || '') : '';
			if (!vid || !owed[vid]) { out.push(e); continue; }
			const q = rowQty(e), take = q < owed[vid] ? q : owed[vid];
			owed[vid] -= take;
			if (q - take >= 1) out.push([e[0], q - take]);
		}
		return out;
	}
	// A record from 0.11.16–0.11.18 carries ids only: the row goes, as it did then.
	const ids = sold.ids.map(String);
	return rows.filter(function (e) { return !(Array.isArray(e) && ids.indexOf(String(e[0] || '')) >= 0); });
}

// Apply cartAfterOrder to the basket as it is at the moment of writing, not as it was when the
// page read it.
//
// 🔴 tile#40. The completion page used to `getItem` the basket, work out what to keep, and
// `setItem` that answer over the whole key. localStorage has no compare-and-swap, so anything
// another tab wrote to the key after that read — an add-to-cart in a second tab — was overwritten
// by an answer computed without it. This re-reads the key immediately before writing and, if it
// moved, recomputes against the new value (bounded, so a key that never settles still ends in a
// write rather than a spin). It shrinks the window to two adjacent synchronous calls; closing it
// completely would need a lock every writer of the key takes, and the writers of this key ship on
// three different deploys.
//
// No record (an older coral, or storage that refused the write) still removes the whole key —
// the pre-0.11.16 behaviour, kept so that shopper is never left with a basket that never clears.
function settleCartAfterOrder(ls, cartKey, soldKey) {
	const rawSold = soldKey ? ls.getItem(soldKey) : null;
	let kept = null;
	for (let i = 0; i < 8; i++) {
		const before = ls.getItem(cartKey);
		kept = cartAfterOrder(before, rawSold);
		if (ls.getItem(cartKey) === before) break;
	}
	if (kept && kept.length) ls.setItem(cartKey, JSON.stringify(kept));
	else ls.removeItem(cartKey);
	if (soldKey) ls.removeItem(soldKey);
}

// ─── ECPAY ORDER RESULT ───────────────────────────────────────────────────────
// What the result page adds for an ECPay order. RSP's outcome answer for such an order carries,
// beside the summary, the buyer's view of its documents — `invoice: {state, invoice_no,
// allowance_total}` or `receipt: {state, receipt_no}` — and, where RSP sends one, a parcel as
// `shipment: {state, sub_type, tracking_number}` (the buyer order list's own shape). Nothing else:
// no address, phone, carrier, tax id or donation code exists in that answer, so none can show.
//
// Three views, chosen from facts only:
//  · just paid — a paid ECPay order whose page was reached from ECPay's return (`merchant_trade_no`
//    on the URL) or from this tab's own in-page checkout (the sessionStorage note it left);
//  · cash on delivery placed — RSP's `awaiting_collection` state, or, where RSP still answers
//    `pending`, the in-page checkout's own note (order id, method, the total it showed);
//  · by link — a paid ECPay order opened any other way, typically the confirmation email's link.
// An outcome with none of these facts renders exactly as before.

const ECPAY_RESULT_COPY = {
	'en-US': { shipArrived: 'At the store', shipPickedUp: 'Picked up', shipDelivered: 'Delivered', shipReturned: 'Returned to the shop', discount: 'Discount', codDue: 'Due on pickup · {total}', paid: 'Payment complete', cod: 'Order placed — pay on pickup', guest: 'Order {ref}', guestNote: 'Viewed from the link in your confirmation email.', fee: 'Shipping', feeVia: 'Shipping · {method}', free: 'Free', codTotal: 'Due on pickup', paidAmount: 'Paid · {total}', invoiceNo: 'E-invoice {no}', invoice: 'E-invoice', receiptNo: 'Receipt {no}', receipt: 'Receipt', issued: 'Issued.', issuing: 'Being issued.', later: 'Issued after payment.', codLater: 'Issued once you pay on pickup.', held: 'Not issued yet; the shop is handling it.', voided: 'Voided.', allowance: '{amount} credited.', shipPreparing: 'Preparing your order', shipAwaiting: 'Waiting to ship', shipBooked: 'Handed to the carrier', shipCancelled: 'Shipment cancelled', shipNote: '{method} · You get an email when it ships.', shipNoteCvs: '{method} · You get an email when it reaches the store.', codNoteCvs: '{method} · Collect and pay at the store before the pickup deadline, or the parcel goes back and the order is cancelled.', codNoteHome: '{method} · Pay when it is delivered.', tracking: 'Tracking number {no}', mailSent: 'A confirmation email is on its way.', guestCardBody: 'Recipient and contact details are only in your confirmation email and your signed-in account.' },
	'ja-JP': { shipArrived: '店舗に到着', shipPickedUp: '受け取り済み', shipDelivered: '配達済み', shipReturned: 'ショップに返送', discount: '割引', codDue: '受け取り時のお支払い · {total}', paid: 'お支払いが完了しました', cod: 'ご注文を承りました（受け取り時払い）', guest: 'ご注文 {ref}', guestNote: '確認メールのリンクから表示しています。', fee: '送料', feeVia: '送料 · {method}', free: '無料', codTotal: '受け取り時のお支払い', paidAmount: 'お支払い済み · {total}', invoiceNo: '電子発票 {no}', invoice: '電子発票', receiptNo: '領収書 {no}', receipt: '領収書', issued: '発行済みです。', issuing: '発行手続き中です。', later: 'お支払い後に発行されます。', codLater: '受け取り時のお支払い後に発行されます。', held: 'まだ発行されていません。ショップが対応しています。', voided: '取り消されました。', allowance: '{amount} を返金処理しました。', shipPreparing: '出荷準備中', shipAwaiting: '出荷待ち', shipBooked: '配送業者に引き渡し済み', shipCancelled: '配送は取り消されました', shipNote: '{method} · 出荷したらメールでお知らせします。', shipNoteCvs: '{method} · 店舗に届いたらメールでお知らせします。', codNoteCvs: '{method} · 受け取り期限までに店舗でお支払いのうえお受け取りください。期限を過ぎると返送され、ご注文は取り消されます。', codNoteHome: '{method} · 配達時にお支払いください。', tracking: '追跡番号 {no}', mailSent: '確認メールをお送りします。', guestCardBody: '受取人と連絡先は、確認メールとログイン後のアカウントページでのみご確認いただけます。' },
	'zh-TW': { shipArrived: '已到店', shipPickedUp: '已取貨', shipDelivered: '已送達', shipReturned: '已退回', discount: '折扣', codDue: '取貨時付 · {total}', paid: '付款完成', cod: '訂單成立，取貨時付款', guest: '訂單 {ref}', guestNote: '用確認信裡的連結查看。', fee: '運費', feeVia: '運費 · {method}', free: '免運費', codTotal: '取貨時付', paidAmount: '已付款 · {total}', invoiceNo: '電子發票 {no}', invoice: '電子發票', receiptNo: '收據 {no}', receipt: '收據', issued: '已開立。', issuing: '開立中。', later: '付款後開立。', codLater: '取貨付款後開立。', held: '尚未開立，商店處理中。', voided: '已作廢。', allowance: '已折讓 {amount}。', shipPreparing: '準備出貨', shipAwaiting: '等待出貨', shipBooked: '已交給物流', shipCancelled: '出貨已取消', shipNote: '{method} · 出貨後會寄信通知。', shipNoteCvs: '{method} · 到店後會寄信通知。', codNoteCvs: '{method} · 到店後請在期限內取貨付款，逾期退回、訂單取消。', codNoteHome: '{method} · 送達時付款。', tracking: '物流單號 {no}', mailSent: '確認信會寄到你填的電子郵件。', guestCardBody: '收件人與聯絡資料只在確認信和登入後的帳號頁。' },
	'zh-CN': { shipArrived: '已到店', shipPickedUp: '已取货', shipDelivered: '已送达', shipReturned: '已退回', discount: '折扣', codDue: '取货时付 · {total}', paid: '付款完成', cod: '订单已提交，取货时付款', guest: '订单 {ref}', guestNote: '通过确认信里的链接查看。', fee: '运费', feeVia: '运费 · {method}', free: '免运费', codTotal: '取货时付', paidAmount: '已付款 · {total}', invoiceNo: '电子发票 {no}', invoice: '电子发票', receiptNo: '收据 {no}', receipt: '收据', issued: '已开具。', issuing: '开具中。', later: '付款后开具。', codLater: '取货付款后开具。', held: '尚未开具，商店处理中。', voided: '已作废。', allowance: '已折让 {amount}。', shipPreparing: '准备发货', shipAwaiting: '等待发货', shipBooked: '已交给物流', shipCancelled: '发货已取消', shipNote: '{method} · 发货后会发邮件通知。', shipNoteCvs: '{method} · 到店后会发邮件通知。', codNoteCvs: '{method} · 到店后请在期限内取货付款，逾期退回、订单取消。', codNoteHome: '{method} · 送达时付款。', tracking: '物流单号 {no}', mailSent: '确认信会发到你填写的电子邮箱。', guestCardBody: '收件人与联系信息只在确认信和登录后的账户页。' }
};

// The browser half, serialised into the completion script. `B` is this tab's in-page checkout
// note for the ref (or null); the rest are the completion script's own helpers. Returns true when
// it rendered, false to leave the outcome to the existing views.
function ecpayResultView(C, d, B, esc, money, setHeading, root) {
	const E = C.e;
	if (!E || !d) return false;
	const fill = (t, k, v) => String(t).split('{' + k + '}').join(v);
	const method = (sub) => (C.subtypes && sub && C.subtypes[sub]) || '';
	const status = (tone, title, note) => '<div class="st-status st-status-' + tone + '"><span class="st-status-ico" aria-hidden="true"></span><div><strong>' + esc(title) + '</strong>' + (note ? '<p class="st-note">' + note + '</p>' : '') + '</div></div>';
	// A line may name its kind: 'fee' (shipping) and 'discount' lines go to the total block, the rest
	// are the goods. Lines without a kind are goods, as before.
	const allLines = Array.isArray(d.lines) ? d.lines.filter((x) => x && typeof x === 'object') : (B && Array.isArray(B.lines) ? B.lines : []);
	const kindOf = (x) => (x && (x.kind === 'fee' || x.kind === 'discount') ? x.kind : 'item');
	const lines = (cur) => {
		const list = allLines.filter((x) => kindOf(x) === 'item');
		return list.length ? '<ul class="st-list st-lines">' + list.map((x) => '<li><span>' + esc(x.name) + '<span class="st-q">× ' + esc(x.qty) + '</span></span><span>' + esc(money(x.amount_minor, cur)) + '</span></li>').join('') + '</ul>' : '';
	};
	const discountRows = (cur) => allLines.filter((x) => kindOf(x) === 'discount').map((x) => '<div><span>' + esc(x.name || E.discount) + '</span><span>−' + esc(money(Math.abs(Number(x.amount_minor) || 0), cur)) + '</span></div>').join('');
	const feeRow = (cur) => {
		const fees = allLines.filter((x) => kindOf(x) === 'fee');
		if (fees.length) {
			const via = method((d.shipment && d.shipment.sub_type) || (B && B.sub_type));
			return fees.map((x) => { const f = Number(x.amount_minor) || 0; return '<div><span>' + esc(via ? fill(E.feeVia, 'method', via) : (x.name || E.fee)) + '</span><span>' + esc(f ? money(f, cur) : E.free) + '</span></div>'; }).join('') + discountRows(cur);
		}
		if (!B || !Number.isFinite(Number(B.fee_minor))) return discountRows(cur);
		const via = method(B.sub_type);
		const f = Number(B.fee_minor);
		return '<div><span>' + esc(via ? fill(E.feeVia, 'method', via) : E.fee) + '</span><span>' + esc(f ? money(f, cur) : E.free) + '</span></div>' + discountRows(cur);
	};
	const order = () => (d.order_ref || (B && B.order_id)) ? '<p>' + esc(C.copy.order) + ' <strong>' + esc(d.order_ref || B.order_id) + '</strong></p>' : '';
	function documentStatus(cod) {
		const inv = d.invoice && typeof d.invoice === 'object' ? d.invoice : null;
		const rec = d.receipt && typeof d.receipt === 'object' ? d.receipt : null;
		if (inv) {
			const no = typeof inv.invoice_no === 'string' && inv.invoice_no ? inv.invoice_no : '';
			const credited = Number(inv.allowance_total) > 0 ? ' ' + esc(fill(E.allowance, 'amount', money(inv.allowance_total, d.currency))) : '';
			if (inv.state === 'issued') return status('ok', no ? fill(E.invoiceNo, 'no', no) : E.invoice, esc(E.issued) + credited);
			if (inv.state === 'voided') return status('bad', no ? fill(E.invoiceNo, 'no', no) : E.invoice, esc(E.voided));
			if (inv.state === 'intended' || inv.state === 'pending') return status('pend', E.invoice, esc(inv.state === 'pending' ? E.issuing : (cod ? E.codLater : E.later)));
			if (inv.state === 'failed') return status('wait', E.invoice, esc(E.held));
			return '';
		}
		if (rec) {
			const no = typeof rec.receipt_no === 'string' && rec.receipt_no ? rec.receipt_no : '';
			if (rec.state === 'issued') return status('ok', no ? fill(E.receiptNo, 'no', no) : E.receipt, esc(E.issued));
			if (rec.state === 'voided') return status('bad', no ? fill(E.receiptNo, 'no', no) : E.receipt, esc(E.voided));
			if (rec.state === 'pending') return status('pend', E.receipt, esc(E.issuing));
			if (rec.state === 'failed') return status('wait', E.receipt, esc(E.held));
			return '';
		}
		if (cod && B && B.invoice) return status('pend', E.invoice, esc(E.codLater));
		return '';
	}
	function shipmentStatus() {
		const s = d.shipment && typeof d.shipment === 'object' ? d.shipment : null;
		const sub = (s && s.sub_type) || (B && B.sub_type) || '';
		const via = method(sub);
		const cvs = (B && B.logistics_type === 'CVS') || /^(UNIMART|FAMI|HILIFE|OKMART)/.test(sub);
		const note = via ? esc(fill(cvs ? E.shipNoteCvs : E.shipNote, 'method', via)) : '';
		if (s) {
			const track = typeof s.tracking_number === 'string' && s.tracking_number ? esc(fill(E.tracking, 'no', s.tracking_number)) : '';
			const both = [via ? esc(via) : '', track].filter(Boolean).join(' · ');
			if (s.state === 'booked') return status('ok', E.shipBooked, both);
			if (s.state === 'arrived') return status('ok', E.shipArrived, both);
			if (s.state === 'picked_up') return status('ok', E.shipPickedUp, both);
			if (s.state === 'delivered') return status('ok', E.shipDelivered, both);
			if (s.state === 'returned') return status('bad', E.shipReturned, both);
			if (s.state === 'cancelled') return status('bad', E.shipCancelled, both);
			return status('wait', E.shipPreparing, note);
		}
		return B ? status('wait', E.shipPreparing, note) : '';
	}
	const list = (parts) => { const html = parts.filter(Boolean).join(''); return html ? '<div class="st-status-list">' + html + '</div>' : ''; };
	const back = '<p><a class="st-runtime-action" href="' + esc(C.shopPath) + '">' + esc(C.copy.back) + '</a></p>';

	// Cash on delivery: RSP's own `awaiting_collection` state, or this tab's note on a `pending` one.
	const codServer = d.state === 'awaiting_collection';
	if (codServer || (d.state === 'pending' && B && B.cod === true)) {
		const cur = d.currency || (B && B.currency);
		const due = Number.isFinite(Number(d.total_minor)) && d.total_minor != null ? d.total_minor : (B ? B.total_minor : 0);
		const sub = (d.shipment && d.shipment.sub_type) || (B && B.sub_type) || '';
		const via = method(sub);
		const home = (B && B.logistics_type === 'HOME') || /^(TCAT|POST)$/.test(sub);
		const note = via ? esc(fill(home ? E.codNoteHome : E.codNoteCvs, 'method', via)) : '';
		const parcel = d.shipment && typeof d.shipment === 'object' && d.shipment.state !== 'pending' ? shipmentStatus() : status('wait', E.shipAwaiting, note);
		if (!B && codServer) {
			setHeading(fill(E.guest, 'ref', d.order_ref || ''));
			root.innerHTML = '<p class="st-note">' + esc(E.guestNote) + '</p>' + list([status('wait', fill(E.codDue, 'total', money(due, cur)), ''), documentStatus(true), parcel]) + '<div class="st-cell st-guest-note"><p class="st-note">' + esc(E.guestCardBody) + '</p></div>';
			return true;
		}
		setHeading(E.cod);
		root.innerHTML = lines(cur) + '<div class="st-sum">' + feeRow(cur) + '<div class="st-sum-tot"><span>' + esc(E.codTotal) + '</span><span>' + esc(money(due, cur)) + '</span></div></div>' + order() + list([parcel, documentStatus(true)]) + '<p class="st-note">' + esc(E.mailSent) + '</p>' + back;
		return true;
	}
	const docs = !!(d.invoice || d.receipt || d.shipment);
	if (d.state !== 'paid' || !(B || docs)) return false;
	if (B || C.returned) {
		setHeading(E.paid);
		root.innerHTML = lines(d.currency) + '<div class="st-sum">' + feeRow(d.currency) + '<div class="st-sum-tot"><span>' + esc(C.copy.total) + '</span><span>' + esc(money(d.total_minor, d.currency)) + '</span></div></div>' + order() + list([documentStatus(false), shipmentStatus()]) + '<p class="st-note">' + esc(E.mailSent) + '</p>' + back;
		return true;
	}
	setHeading(fill(E.guest, 'ref', d.order_ref || ''));
	root.innerHTML = '<p class="st-note">' + esc(E.guestNote) + '</p>' + list([status('ok', fill(E.paidAmount, 'total', money(d.total_minor, d.currency)), ''), documentStatus(false), shipmentStatus()]) + '<div class="st-cell st-guest-note"><p class="st-note">' + esc(E.guestCardBody) + '</p></div>';
	return true;
}

function completionBody(copy, locale, outcomeUrl, shopPath, storeId, hasRef, ref, ecpay) {
	const data = JSON.stringify(Object.assign({ copy, locale, outcomeUrl, shopPath, storeId, ref: ref || '' }, ecpay || {})).replace(/</g, '\\u003c');
	const initial = hasRef ? { heading: copy.pending, body: copy.pendingBody } : { heading: copy.unknown, body: copy.unknownBody };
	const backLink = hasRef ? '' : `<p><a class="st-runtime-action" href="${shopPath}">${copy.back}</a></p>`;
	// 🔴 This page's presentation now lives in site.css's `@layer reef.base` ("runtime:
	// results" sub-block) instead of this unlayered <style> — unlayered CSS always outranked
	// the site's layered theme. `<h1>` and `<section class="dc-shop-complete">` stay pinned
	// exact strings (shop-complete.test.mjs), so the inset comes from wrapping both in a
	// `.st-runtime` div FROM OUTSIDE rather than adding a class to either pinned element.
	return `<div class="st-runtime" lang="${locale}">
<h1 id="dc-shop-heading">${initial.heading}</h1>
<section class="dc-shop-complete" aria-live="polite"><div id="dc-shop-outcome"><p>${initial.body}</p>${backLink}</div></section>
</div>
${hasRef ? `<script>(function(){const C=${data},root=document.getElementById('dc-shop-outcome'),heading=document.getElementById('dc-shop-heading');let tries=0;const shouldClearCartForOutcome=${shouldClearCartForOutcome.toString()};const cartAfterOrder=${cartAfterOrder.toString()};const settleCartAfterOrder=${settleCartAfterOrder.toString()};const ecpayResultView=${ecpayResultView.toString()};let B=null;try{const ss=window.sessionStorage;B=ss&&C.ref?JSON.parse(ss.getItem('dc-native-ecpay:'+C.ref)||'null'):null}catch(e){B=null}if(!B||typeof B!=='object'||typeof B.order_id!=='string'||!B.order_id)B=null;const outcomeUrl=B?C.outcomeUrl.replace(/([?&]ref=)[^&]*/,'$1'+encodeURIComponent(B.order_id)):C.outcomeUrl;const esc=s=>{const n=document.createElement('span');n.textContent=String(s==null?'':s);return n.innerHTML};const formatMoney=${completionFormatMoneySource()};const money=(n,c)=>formatMoney({minor:Number(n)||0,currency:c,locale:C.locale});const setHeading=s=>{heading.textContent=s;document.title=s};const back=(state)=>{setHeading(C.copy[state]);root.innerHTML='<p>'+esc(C.copy[state+'Body'])+'</p><p><a class="st-runtime-action" href="'+esc(C.shopPath)+'">'+esc(C.copy.back)+'</a></p>'};async function check(){let d;try{const r=await fetch(outcomeUrl,{headers:{Accept:'application/json'},credentials:'same-origin'});d=await r.json();if(!r.ok||!d||d.ok!==true)throw 0}catch(e){back('unknown');return}if(ecpayResultView(C,d,B,esc,money,setHeading,root)){if(shouldClearCartForOutcome(d.state)){try{settleCartAfterOrder(localStorage,'dc-square-shop-cart:'+C.storeId,C.ref?'dc-square-shop-sold:'+C.ref:'');window.dispatchEvent(new CustomEvent('dc-cart-changed'))}catch(e){}}return}const summary=()=>{const lines=Array.isArray(d.lines)?d.lines.filter(x=>!(x&&(x.kind==='fee'||x.kind==='discount'))):[];return(lines.length?'<ul class="st-list">'+lines.map(x=>'<li>'+esc(x.name)+' × '+esc(x.qty)+' — '+esc(money(x.amount_minor,d.currency))+'</li>').join('')+'</ul>':'')+'<p class="dc-shop-total">'+esc(C.copy.total)+': '+esc(money(d.total_minor,d.currency))+(d.currency==='JPY'?' <small>'+esc(C.copy.tax)+'</small>':'')+'</p>'+(d.order_ref?'<p>'+esc(C.copy.order)+': <strong>'+esc(d.order_ref)+'</strong></p>':'')};if(shouldClearCartForOutcome(d.state)){setHeading(C.copy.paid);try{settleCartAfterOrder(localStorage,'dc-square-shop-cart:'+C.storeId,C.ref?'dc-square-shop-sold:'+C.ref:'');window.dispatchEvent(new CustomEvent('dc-cart-changed'))}catch(e){}root.innerHTML=summary()+'<p>'+esc(C.copy.receipt)+'</p>';return}if(d.state==='refunded'){setHeading(C.copy.refunded);root.innerHTML='<p>'+esc(C.copy.refundedBody)+'</p>'+summary()+'<p><a class="st-runtime-action" href="'+esc(C.shopPath)+'">'+esc(C.copy.back)+'</a></p>';return}if(d.state==='pending'){setHeading(C.copy.pending);tries++;if(tries<40){root.innerHTML='<p>'+esc(C.copy.pendingBody)+'</p>';setTimeout(check,3000)}else root.innerHTML='<p>'+esc(C.copy.waiting)+'</p>';return}if(d.state==='canceled'){back('canceled');return}back('unknown')}check()})();</script>` : ''}`;
}

async function renderCompletion(request, env, cfg, shop, checkoutResult) {
	const url = new URL(request.url);
	const ref = url.searchParams.get('ref') || '';
	const orderId = checkoutResult ? url.searchParams.get(checkoutResult.orderParam) || '' : '';
	const hasOutcomeKey = Boolean(ref || orderId);
	const shopPath = shop.completionShopPath || shop.shopPath;
	let shellShopPath = shop.backPath || shopPath;
	const pathLocale = (url.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\/shop\/complete\/?$/) || [])[1] || '';
	let shellRes = await env.ASSETS.fetch(new Request(url.origin + shopPath + '/', request));
	// A locale path (e.g. /ja/shop/complete) can name a shop page that was never built —
	// the default locale is often served bare at shop.shopPath (e.g. /shop) with no
	// locale-prefixed twin. Retry against the base/default shop's own path before giving
	// up on site chrome entirely.
	if (!shellRes.ok && shopPath !== shop.shopPath) {
		shellRes = await env.ASSETS.fetch(new Request(url.origin + shop.shopPath + '/', request));
		// A fallback-shell back link must not return buyers to the missing locale page.
		if (shellRes.ok) shellShopPath = shop.shopPath;
	}
	if (!shellRes.ok && checkoutResult) {
		return new Response('Checkout result unavailable', {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' }
		});
	}
	const shell = shellRes.ok ? await shellRes.text() : '<!doctype html><html><head></head><body><main></main></body></html>';
	const locale = completionLocale(shop, shell, pathLocale, url.searchParams.get('lang'));
	// The copy below is in `locale`; when the shell declares a different language (or none), the
	// document must say so. A shell whose declared language already maps to `locale` is left alone.
	const renderedShell = copyLocaleOf(shellLang(shell)) === locale ? shell : withShellLang(shell, locale);
	const copy = { ...COMPLETE_COPY[locale] };
	const coral = parseCoralDiv(shell);
	if (coral) for (const key of Object.keys(copy)) if (coral.completionLabels[key]) copy[key] = coral.completionLabels[key];
	const siteKey = cfg.siteId || cfg.guildId || '';
	const outcome = new URL(checkoutResult ? checkoutResult.outcomePath : '/api/v2/shop/checkout/outcome', url.origin);
	outcome.searchParams.set('site', siteKey);
	outcome.searchParams.set('ref', orderId || ref);
	// Opt in to the extended state set (`refunded`). An RSP that predates it ignores the marker and
	// answers the legacy set, which this client still renders.
	outcome.searchParams.set('states', 'extended');
	// Ask for a native order's discount and delivery fee as `kind` lines on the paid and refunded
	// answers too (the ECPay views put them in the total block). An RSP that predates it ignores
	// the parameter; the summary view below leaves `kind` lines out, so it reads as before.
	outcome.searchParams.set('lines', 'full');
	let body = stripDonorHead(renderedShell);
	const initialHeading = hasOutcomeKey ? copy.pending : copy.unknown;
	body = injectHead(body, `<title>${initialHeading}</title><meta name="robots" content="noindex">`);
	// 🔴 `ref` and NOT `orderId`: the sold-lines record the coral writes is keyed by the
	// client_request_ref it minted, so a native-checkout return (which names a PROVIDER order id
	// instead) finds no record and clears the whole basket, as it always has.
	// The ECPay views (ecpayResultView above) read their copy from here and whether ECPay's own
	// return brought the buyer: its order-result hop adds `merchant_trade_no` to the back URL.
	body = replaceMain(body, completionBody(copy, locale, outcome.pathname + outcome.search, shellShopPath, cfg.guildId || cfg.siteId || '', hasOutcomeKey, ref, { e: ECPAY_RESULT_COPY[locale], subtypes: NATIVE_ECPAY_SUBTYPES[locale], returned: url.searchParams.has('merchant_trade_no') }));
	return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
}

// ─── SITE-OWNED BUYER PAGES ───────────────────────────────────────────────────
// The site's own member-facing pages (/membership, /account today) rendered in
// the site's OWN repository-built shell: its theme, nav, footer and declared
// language stay, and RSP supplies only the scoped facts over the same-origin
// binding. Which paths those are, which facts endpoint each reads and which body
// renderer each selects all come from the contract (CFG.apiTransport
// .siteOwnedBuyerPages). Nothing below names a page path or a facts path — `kind`
// is the renderer selector, so this worker never recognises them by path literal.
//
// The DONOR SHELL is the site root, deliberately: these pages exist on sites with
// no shop at all, so the shop-page donor renderCompletion uses is not available
// here. Every built site has a root document.

const BUYER_PAGE_COPY = {
	'en-US': { gatePendingTitle: 'Your access is on its way', gatePendingBody: 'We received your payment. Reload this page in a moment.', gateReload: 'Reload', gateRetryTitle: "We can't check your access right now", gateRetryBody: 'Please try again.', gateRetry: 'Try again', gateMembersTitle: 'Members only', gateMembersBody: 'Sign in or join to view this page.', gateMembersSignedInBody: "Your account doesn't have access to this page yet. If you've already paid, it opens once the site confirms your membership; if not, join to view it.", membership: 'Membership', membershipEmpty: 'No membership plans are available right now.', unavailable: 'This page is unavailable right now. Please try again later.', notFound: 'Not found', subscribe: 'Join', authState: 'Checking…', account: 'Account', signIn: 'Sign in', signInIntro: 'Enter your email address and we will send you a sign-in link.', email: 'Email address', sendLink: 'Send sign-in link', newEmail: 'New email address', sendVerification: 'Send verification email', signOut: 'Sign out', signOutError: "We couldn't sign you out. Please try again.", subscribeResultTitle: 'Subscription', subscribeThanks: 'Thank you for subscribing', subscribeActive: 'Your subscription is active.', subscribeConfirming: 'We are confirming your payment. This can take a moment, and we will email you when it is done.', subscribeUnknown: "We can't confirm this subscription here", subscribeUnknownBody: 'This page appears after you complete a subscription. If you subscribed, sign in to your account or check your subscription confirmation email, or go back home.', backHome: 'Back to home', interval: { day: 'day', week: 'week', month: 'month', year: 'year' } },
	'ja-JP': { gatePendingTitle: 'アクセスの準備中です', gatePendingBody: 'お支払いを確認しました。しばらくしてからページを再読み込みしてください。', gateReload: '再読み込み', gateRetryTitle: '現在アクセス権を確認できません', gateRetryBody: 'もう一度お試しください。', gateRetry: '再試行', gateMembersTitle: 'メンバー限定', gateMembersBody: 'このページを見るには、ログインまたは加入してください。', gateMembersSignedInBody: '現在ログインしているアカウントにはまだこのページを見る権限がありません。お支払い済みの場合は、サイトが会員資格を確認すると閲覧できます。まだの場合は、加入すると閲覧できます。', membership: 'メンバーシップ', membershipEmpty: '現在ご利用いただけるメンバーシッププランはありません。', unavailable: '現在このページを表示できません。しばらくしてから再度お試しください。', notFound: 'ページが見つかりません', subscribe: '加入する', authState: '確認中...', account: 'アカウント', signIn: 'ログイン', signInIntro: 'メールアドレスを入力すると、ログイン用のリンクをお送りします。', email: 'メールアドレス', sendLink: 'ログインリンクを送る', newEmail: '新しいメールアドレス', sendVerification: '確認メールを送信', signOut: 'ログアウト', signOutError: 'ログアウトできませんでした。もう一度お試しください。', subscribeResultTitle: 'サブスクリプション', subscribeThanks: 'ご登録ありがとうございます', subscribeActive: 'サブスクリプションは有効です。', subscribeConfirming: 'お支払いを確認しています。少しお時間がかかる場合があり、完了しましたらメールでお知らせします。', subscribeUnknown: 'このサブスクリプションを確認できません', subscribeUnknownBody: 'このページはご登録の完了後に表示されます。ご登録済みの場合は、アカウントにログインするか、確認メールでサブスクリプションをご確認いただくか、ホームにお戻りください。', backHome: 'ホームに戻る', interval: { day: '日額', week: '週額', month: '月額', year: '年額' } },
	'zh-TW': { gatePendingTitle: '存取權限準備中', gatePendingBody: '我們已收到你的付款。請稍後重新整理這個頁面。', gateReload: '重新整理', gateRetryTitle: '目前無法確認你的存取權限', gateRetryBody: '請再試一次。', gateRetry: '再試一次', gateMembersTitle: '會員專屬', gateMembersBody: '登入或加入後即可查看這個頁面。', gateMembersSignedInBody: '目前登入的帳號還沒有這個頁面的存取權。如果你已經付款，網站確認你的會員資格後就能查看；還沒加入的話，加入後即可查看。', membership: '會員方案', membershipEmpty: '目前沒有可加入的會員方案。', unavailable: '目前無法顯示這個頁面，請稍後再試。', notFound: '找不到這個頁面', subscribe: '加入', authState: '確認中…', account: '帳戶', signIn: '登入', signInIntro: '輸入你的電子郵件，我們會寄一封登入連結給你。', email: '電子郵件', sendLink: '寄送登入連結', newEmail: '新的電子郵件', sendVerification: '寄送驗證信', signOut: '登出', signOutError: '無法登出，請再試一次。', subscribeResultTitle: '訂閱', subscribeThanks: '感謝您的訂閱', subscribeActive: '您的訂閱已生效。', subscribeConfirming: '正在確認您的付款，可能需要一點時間，完成後我們會以 email 通知您。', subscribeUnknown: '在這裡無法確認這筆訂閱', subscribeUnknownBody: '這一頁會在訂閱完成後顯示。若您已訂閱，請登入帳戶或查看訂閱確認信來確認，或返回首頁。', backHome: '返回首頁', interval: { day: '每日', week: '每週', month: '每月', year: '每年' } },
	'zh-CN': { gatePendingTitle: '访问权限准备中', gatePendingBody: '我们已收到你的付款。请稍后刷新这个页面。', gateReload: '刷新', gateRetryTitle: '目前无法确认你的访问权限', gateRetryBody: '请再试一次。', gateRetry: '再试一次', gateMembersTitle: '会员专属', gateMembersBody: '登录或加入后即可查看这个页面。', gateMembersSignedInBody: '当前登录的账号还没有这个页面的访问权限。如果你已经付款，网站确认你的会员资格后就能查看；还没加入的话，加入后即可查看。', membership: '会员方案', membershipEmpty: '目前没有可加入的会员方案。', unavailable: '目前无法显示这个页面，请稍后再试。', notFound: '找不到这个页面', subscribe: '加入', authState: '确认中…', account: '账户', signIn: '登录', signInIntro: '输入你的电子邮件，我们会寄一封登录链接给你。', email: '电子邮件', sendLink: '寄送登录链接', newEmail: '新的电子邮件', sendVerification: '寄送验证信', signOut: '退出登录', signOutError: '无法退出登录，请再试一次。', subscribeResultTitle: '订阅', subscribeThanks: '感谢您的订阅', subscribeActive: '您的订阅已生效。', subscribeConfirming: '正在确认您的付款，可能需要一点时间，完成后我们会以 email 通知您。', subscribeUnknown: '在这里无法确认这笔订阅', subscribeUnknownBody: '这一页会在订阅完成后显示。若您已订阅，请登录账户或查看订阅确认信来确认，或返回首页。', backHome: '返回首页', interval: { day: '每日', week: '每周', month: '每月', year: '每年' } }
};

// Exact path AND method, from the contract entry — the same posture the forward
// rules take, so a verb the contract did not declare is not claimed here either.
function matchSiteOwnedBuyerPage(request, routes) {
	if (!Array.isArray(routes) || routes.length === 0) return null;
	let pathname;
	try { pathname = new URL(request.url).pathname; } catch (e) { return null; }
	for (const route of routes) {
		if (route.path === pathname && route.method === request.method) return route;
	}
	return null;
}

// `amount` is the plan's price in the currency's SMALLEST unit (minor units) —
// the same integer the RSP `/api/membership/plans` contract returns and the same
// one that goes verbatim into Stripe's `unit_amount` (reef apps/rsp
// src/currency-units.ts + routes/membership.ts#formatPlanPrice, the reference
// this rendering must not disagree with). It must be converted to major units
// before display, and a zero-decimal currency's whole unit IS its smallest unit
// (JPY 1200 is still ¥1,200, not ¥12.00). Reuses this package's own formatMoney
// helper (product-page-core.js), the same one already used for product prices
// below, instead of a second currency table.
function planPriceText(plan, copy, locale) {
	const label = copy.interval[plan.interval] || plan.interval;
	const currency = String(plan.currency || '');
	try {
		// Probe the currency code before trusting formatMoney's own path — an
		// unrecognized code must not fall through to formatMoney's fallback, which
		// echoes its `minor` argument literally rather than converting it.
		new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0);
	} catch (e) {
		// Unrecognized currency code (Intl throws on non-ISO-4217 strings) — still
		// honest and plain, and still MAJOR units (there is no fraction-digit count
		// Intl can give us for a code it does not recognize, so the common 2-decimal
		// case is assumed rather than showing the buyer a hundred times the price).
		return currency + ' ' + (Number(plan.amount) / 100).toFixed(2) + ' / ' + label;
	}
	return formatMoney({ minor: Number(plan.amount), currency, locale }) + ' / ' + label;
}

// Bodies are composed INTO the donor's <main>, so none of them opens one of its
// own — same shape completionBody uses. The data-ejecta-* markers ride on the
// element that replaces the main's contents.
function buyerPageUnavailableBody(kind, copy) {
	const marker = kind === 'account' ? 'account' : 'membership';
	return `<section class="st-runtime" data-ejecta-${marker}="" data-ejecta-${marker}-state="unavailable">
<h1>${escHtml(marker === 'account' ? copy.account : copy.membership)}</h1>
<p class="st-runtime-status" data-ejecta-${marker}-unavailable="" role="status">${escHtml(copy.unavailable)}</p>
</section>`;
}

// The ROUTE-level refusal — this page does not exist on this site — which RSP
// answers with its own distinct marker rather than the state-level "could not
// read plan state right now". The distinction is kept because the two say
// different things: a permanent refusal must not promise a later retry.
function buyerPageNotFoundBody(kind, copy) {
	const marker = kind === 'account' ? 'account' : 'membership';
	return `<section class="st-runtime" data-ejecta-${marker}="" data-ejecta-${marker}-route="unavailable">
<h1>${escHtml(copy.notFound)}</h1>
</section>`;
}

// The subscribe control keeps the island's existing slot contract
// (data-ejecta-slot="subscribe" + data-ejecta-plan), so the site page reaches the
// same subscribe path the RSP page does — no second checkout wiring.
// Returns null when the facts, whatever status they arrived on, do not say
// anything this page can render. The caller answers that honestly instead of
// dressing it as a working page.
function membershipPageBody(facts, copy, locale) {
	const state = facts && facts.state;
	if (state === 'empty') {
		return `<section class="st-runtime" data-ejecta-membership="" data-ejecta-membership-state="empty">
<h1>${escHtml(copy.membership)}</h1>
<p class="st-runtime-status" data-ejecta-membership-empty="" role="status">${escHtml(copy.membershipEmpty)}</p>
</section>`;
	}
	const plans = state === 'available' && Array.isArray(facts.plans) ? facts.plans : [];
	if (plans.length === 0) return null;
	const cards = plans.map((plan) => `<li class="st-cell ejecta-membership-plan">
<h2>${escHtml(plan.display_name)}</h2>
<p class="price">${escHtml(planPriceText(plan, copy, locale))}</p>
<button type="button" class="st-runtime-action" data-ejecta-slot="subscribe" data-ejecta-plan="${escHtml(plan.plan_id)}">${escHtml(copy.subscribe)}</button>
</li>`).join('\n');
	return `<section class="st-runtime" data-ejecta-membership="" data-ejecta-membership-state="available">
<h1>${escHtml(copy.membership)}</h1>
<p class="st-runtime-status" data-ejecta-slot="auth-state" data-ejecta-membership-auth-state="">${escHtml(copy.authState)}</p>
<ul class="st-cells st-runtime-list ejecta-membership-plans">
${cards}
</ul>
</section>`;
}

// Signed out gets the island's auth-request form; signed in gets EXACTLY the
// section markers the server already gated. The section set is never computed
// here — this side has no membership/entitlement truth to compute it from.
function accountPageBody(facts, copy) {
	if (!facts || typeof facts.signed_in !== 'boolean') return null;
	if (!facts.signed_in) {
		return `<section class="st-runtime" data-ejecta-account="" data-ejecta-account-state="logged-out">
<div class="st-form-head">
<h1>${escHtml(copy.signIn)}</h1>
<p>${escHtml(copy.signInIntro)}</p>
</div>
<form class="st-form" data-ejecta-slot="auth-request" data-ejecta-account-login-form="">
<div class="st-form-field">
<label class="st-form-label" for="ejecta-account-email">${escHtml(copy.email)}</label>
<input class="st-form-input" id="ejecta-account-email" name="email" type="email" required autocomplete="email">
</div>
<button type="submit" class="st-runtime-action">${escHtml(copy.sendLink)}</button>
<p class="st-runtime-status" data-ejecta-auth-status="" aria-live="polite" role="status"></p>
</form>
</section>`;
	}
	const sections = (Array.isArray(facts.sections) ? facts.sections : [])
		.map((section) => `<div data-ejecta-account-section="${escHtml(section)}"></div>`).join('\n');
	// The change-email entry is NOT one of the gated read sections — it is a submit
	// slot, unconditional for a signed-in member, exactly as the RSP page emits it.
	// That is why no facts field declares it and none is asked for.
	return `<section class="st-runtime" data-ejecta-account="" data-ejecta-account-state="logged-in">
<h1>${escHtml(copy.account)}</h1>
<div class="st-account-sections" data-ejecta-account-sections="">
${sections}
</div>
<form class="st-form" data-ejecta-slot="email-change" data-ejecta-account-email-change-form="">
<div class="st-form-field">
<label class="st-form-label" for="ejecta-account-new-email">${escHtml(copy.newEmail)}</label>
<input class="st-form-input" id="ejecta-account-new-email" name="email" type="email" required autocomplete="email">
</div>
<button type="submit" class="st-runtime-action">${escHtml(copy.sendVerification)}</button>
<p class="st-runtime-status" data-ejecta-email-change-status="" aria-live="polite" role="status"></p>
</form>
<div class="st-form" data-ejecta-account-sign-out-box="">
<button type="button" class="st-runtime-action" data-ejecta-account-sign-out="">${escHtml(copy.signOut)}</button>
<p class="st-runtime-status" data-ejecta-account-sign-out-status="" aria-live="polite" role="status"></p>
</div>
${accountSignOutScript(copy)}
</section>`;
}

// The signed-in view's sign-out. POSTs the contract's existing logout route
// same-origin (the browser attaches Origin, which is all its CSRF check reads).
// On success the page is re-requested, so the signed-out form comes from the
// server's own facts rather than from state invented here; on failure the buyer
// stays signed in and sees a short error.
function accountSignOutScript(copy) {
	const err = JSON.stringify(copy.signOutError).replace(/</g, '\\u003c');
	return `<script>(function(){var b=document.querySelector('[data-ejecta-account-sign-out]'),s=document.querySelector('[data-ejecta-account-sign-out-status]');if(!b)return;b.addEventListener('click',async function(){if(b.disabled)return;b.disabled=true;if(s)s.textContent='';try{var r=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{accept:'application/json'}});if(!r.ok)throw 0;window.location.reload()}catch(e){b.disabled=false;if(s){s.textContent=${err};s.setAttribute('data-ejecta-status-tone','error')}}})})()</script>`;
}

function siteOwnedBuyerPageBody(route, facts, copy, locale) {
	if (route.kind === 'membership') return membershipPageBody(facts, copy, locale);
	if (route.kind === 'account') return accountPageBody(facts, copy);
	return null; // the emitter refuses an unknown kind, so this is unreachable
}

// An honest, deliberately NON-HTML failure. A platform-authored HTML document
// here would be the fabricated fallback these pages exist to stop, so when the
// site's own shell cannot be composed into, the buyer gets an error, not a page.
function buyerPageErrorResponse(status) {
	return new Response('Page unavailable', {
		status: status,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' }
	});
}

// The caller's own headers ride along — that is how RSP sees the real viewer's
// session on an account read. A non-2xx answer keeps ITS status (the module-absent
// refusal stays a refusal); could-not-ask is 502, the same code the verdict gate
// uses for the same condition.
async function readBuyerPageFacts(request, binding, transport, factsUrl) {
	if (!binding) return { ok: false, status: transport.onBindingMissing.status };
	let res;
	try {
		res = await binding.fetch(new Request(factsUrl, { method: 'GET', headers: request.headers }));
	} catch (e) {
		return { ok: false, status: 502 };
	}
	if (!res || !res.ok) return { ok: false, status: (res && res.status) || 502 };
	const data = await res.json().catch(() => null);
	if (!data || typeof data !== 'object') return { ok: false, status: 502 };
	return { ok: true, status: 200, data };
}

async function renderSiteOwnedBuyerPage(request, env, cfg, route, ctx) {
	const transport = cfg.apiTransport;
	let origin;
	try { origin = new URL(request.url).origin; } catch (e) { return buyerPageErrorResponse(503); }
	try {
		const [facts, shellRes] = await Promise.all([
			readBuyerPageFacts(request, platformReader(env, ctx, cfg), transport, origin + route.factsPath),
			env.ASSETS.fetch(new Request(origin + '/', request))
		]);
		if (!shellRes || !shellRes.ok) return buyerPageErrorResponse(503);
		const shell = await shellRes.text();
		const locale = localeFromHint(shellLang(shell));
		const copy = BUYER_PAGE_COPY[locale];
		const rendered = facts.ok ? siteOwnedBuyerPageBody(route, facts.data, copy, locale) : null;
		// A 404 from the facts seam is the ROUTE refusal — this page is not on this
		// site — and that is permanent, so it must not be dressed as the transient
		// "we could not read state right now".
		const routeRefused = !facts.ok && facts.status === 404;
		const bodyHtml = rendered ||
			(routeRefused ? buyerPageNotFoundBody(route.kind, copy) : buyerPageUnavailableBody(route.kind, copy));
		// A 2xx answer this page cannot render is still not a working page: the
		// unavailable body never rides on a 200. 502 is the same "no usable answer"
		// code the verdict gate already uses for the same condition.
		const status = rendered ? 200 : (facts.ok ? 502 : facts.status);
		const title = routeRefused ? copy.notFound : (route.kind === 'account' ? copy.account : copy.membership);
		const head = injectHead(stripDonorHead(shell),
			`<title>${escHtml(title)}</title>` +
			'<script type="module" src="/seam/island.js"></script>');
		const composed = replaceMain(head, bodyHtml);
		// The donor had no <main> to compose into. Returning it unchanged would be a
		// 200 showing the site's ROOT page under this URL — a fabricated success.
		if (composed === head) return buyerPageErrorResponse(503);
		return new Response(composed, {
			status: status,
			headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' }
		});
	} catch (e) {
		return buyerPageErrorResponse(503);
	}
}

// ─── SUBSCRIBE RESULT ─────────────────────────────────────────────────────────
// The landing a buyer returns to after subscribing, in the SAME site-owned
// presentation class as the buyer pages above: the site's own shell, and RSP
// supplies only the scoped facts (state + plan) over the same-origin binding.
// Which path, which query parameter carries the locator and which facts endpoint
// answers all come from the contract (CFG.apiTransport.subscribeResult), so
// nothing below names any of them.
//
// The route is claimed whenever the capability is baked — with or without a
// usable locator. A missing locator is exactly the case this page answers "we
// can't confirm this subscription here" for; handing it back to the generic forward
// would show the legacy whole-page fallback under a path this worker owns.
//
// reef#1910: the locale the buyer came from rides on the path. The caller
// contract is that whatever emits the result URL puts the shop's locale prefix
// in front of the contract path — /zh-tw/subscribe/success for the zh-tw shop —
// exactly the shape /zh-tw/shop/complete already has (matchShopComplete). The
// bare contract path is the default locale, served bare at `/` like every other
// default-locale page, and is answered as it always was.
//
// The prefixed shape is only a CANDIDATE here, and only when the request carries
// the checkout locator the contract names. The bare path is reserved — the
// markdown mapping drops it, the contract forwards it — but `/zh-tw/<path>` is
// not: the site can have AUTHORED a page there, and `/en/…` can be an ordinary
// content directory that spells like a locale. Without a locator the prefixed URL
// is left to the site's own content (or its 404). With one, the key alone still
// does not tell a buyer from a reader (`session_id` is an ordinary query name), so
// renderSubscribeResult makes the claim only once RSP confirms the locator names a
// real checkout — see there.
function matchSubscribeResult(request, route) {
	if (!route || request.method !== route.method) return null;
	let url;
	try { url = new URL(request.url); } catch (e) { return null; }
	if (url.pathname === route.path) return route;
	const prefixed = url.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(\/.*)$/);
	if (!prefixed || prefixed[2] !== route.path) return null;
	if (!(url.searchParams.get(route.sessionParam) || '').trim()) return null;
	return { ...route, pathLocale: prefixed[1] };
}

// `active` and `confirming` are both "the payment happened"; they differ only in
// whether the plan state has settled yet, so the heading is shared and only the
// state line moves. `confirming` promises nothing about the outcome.
function subscribeResultBody(state, plan, copy, locale) {
	const hasName = plan && typeof plan.display_name === 'string' && plan.display_name;
	// Price needs all three of the fields planPriceText reads; a partial plan gets
	// its name and no invented number.
	const hasPrice = hasName && plan.currency && plan.interval && Number.isFinite(Number(plan.amount));
	const planLine = hasName
		? '<p class="ejecta-subscribe-plan" data-ejecta-subscribe-plan="' + escHtml(plan.plan_id || '') + '">' +
			'<strong>' + escHtml(plan.display_name) + '</strong>' +
			(hasPrice ? ' — ' + escHtml(planPriceText(plan, copy, locale)) : '') + '</p>\n'
		: '';
	return '<section class="st-runtime" data-ejecta-subscribe-result="" data-ejecta-subscribe-state="' + escHtml(state) + '">\n' +
		'<h1>' + escHtml(copy.subscribeThanks) + '</h1>\n' + planLine +
		'<p class="st-runtime-status" data-ejecta-subscribe-message="" role="status">' +
		escHtml(state === 'active' ? copy.subscribeActive : copy.subscribeConfirming) + '</p>\n</section>';
}

// No locator, or a locator RSP does not recognise. It is NOT dressed as a
// success and NOT dressed as a transient failure: RSP's `unknown` covers a
// missing session, a blank locator and a non-matching one alike, so the page
// claims neither that the subscription exists nor that it does not. The buyer
// is told it cannot be confirmed here and given the next steps and the way back —
// to the home of the locale this page was composed from (reef#1910), never a
// fixed `/`, which on a localized shop is the OTHER language's home.
function subscribeResultUnknownBody(copy, homePath) {
	return '<section class="st-runtime" data-ejecta-subscribe-result="" data-ejecta-subscribe-state="unknown">\n' +
		'<h1>' + escHtml(copy.subscribeUnknown) + '</h1>\n' +
		'<p>' + escHtml(copy.subscribeUnknownBody) + '</p>\n' +
		'<p><a class="st-runtime-action" href="' + escHtml(homePath || '/') + '">' + escHtml(copy.backHome) + '</a></p>\n</section>';
}

// The facts could not be read at all. The heading must not claim a subscription
// that was never confirmed here, so it is the neutral page title.
function subscribeResultUnavailableBody(copy) {
	return '<section class="st-runtime" data-ejecta-subscribe-result="" data-ejecta-subscribe-state="unavailable">\n' +
		'<h1>' + escHtml(copy.subscribeResultTitle) + '</h1>\n' +
		'<p class="st-runtime-status" data-ejecta-subscribe-unavailable="" role="status">' + escHtml(copy.unavailable) + '</p>\n</section>';
}

async function renderSubscribeResult(request, env, cfg, route, ctx) {
	const transport = cfg.apiTransport;
	let url;
	try { url = new URL(request.url); } catch (e) { return buyerPageErrorResponse(503); }
	const locator = (url.searchParams.get(route.sessionParam) || '').trim();
	// The shell is the home of the locale the path carries, and that home is also
	// the way back. Whether this site HAS a home for that locale is the same
	// question localeHomePath() asks the content tree at build time; out here the
	// only one who can answer it is ASSETS, so it is asked, and a locale with no
	// home falls back to the root — shell, copy and way back together — as the
	// 404 page and the breadcrumb do, rather than sending the buyer to a 404.
	// "No home" is ONE answer: a 404. A 5xx or a rejected fetch is ASSETS failing
	// to serve a home the site may well have, and takes the same unavailable path
	// the bare route takes when its own shell cannot be read — never the root's
	// language and the root's way back dressed as the site's decision.
	const pathLocale = route.pathLocale || '';
	let homePath = pathLocale ? '/' + pathLocale + '/' : '/';
	try {
		const factsUrl = new URL(url.origin + route.factsPath);
		factsUrl.searchParams.set(route.sessionParam, locator);
		// No locator means there is nothing to ask about — the answer is already
		// "we couldn't find this subscription" — so the seam is not called at all.
		// Only the locator is sent: the plan is RSP's to name, never the query's.
		const readFacts = () => locator ? readBuyerPageFacts(request, platformReader(env, ctx, cfg), transport, factsUrl.toString()) : null;
		const readHome = () => env.ASSETS.fetch(new Request(url.origin + homePath, request));
		let facts;
		let shellRes;
		if (!pathLocale) {
			// The bare path is reserved: it is always ours, so the shell is read
			// alongside the facts, as every already-emitted worker does.
			[facts, shellRes] = await Promise.all([readFacts(), readHome()]);
		} else {
			// The prefixed path is ours only for a buyer, and that is settled BEFORE
			// the locale home is read: the home is only the shell to compose into, and
			// a home read that fails must not answer for a path the site authored.
			// RSP confirming the locator (active / confirming) is the buyer; any other
			// answer — unknown, a refusal, the seam unreachable — confirms nothing, so
			// the site's own page at this path wins if it has one, and this worker
			// hands the request back (null) to the dispatcher exactly as if it had
			// never matched. Only where the site has nothing there (a 404) does the
			// page below answer for the path. Once it is ours, a home that cannot be
			// read is the same 503 as any shell failure. Reads per request:
			// confirmed — facts, home; unconfirmed and authored — facts, page;
			// unconfirmed and nothing authored — facts, page, home.
			facts = await readFacts();
			const confirmed = !!(facts && facts.ok && (facts.data.state === 'active' || facts.data.state === 'confirming'));
			if (!confirmed) {
				const own = await env.ASSETS.fetch(new Request(url.toString(), request));
				if (!own || own.status !== 404) return null;
			}
			shellRes = await readHome();
		}
		if (pathLocale && shellRes && shellRes.status === 404) {
			homePath = '/';
			shellRes = await env.ASSETS.fetch(new Request(url.origin + homePath, request));
		}
		if (!shellRes || !shellRes.ok) return buyerPageErrorResponse(503);
		let shell = await shellRes.text();
		// Whose language the page is in. When the locale home WAS served, the path
		// is the authority: the buyer came from /ja-jp/, the copy is Japanese, and
		// the document must say so — a donor declaring some other lang would put
		// Japanese copy inside <html lang="en-US">, or Simplified copy under a
		// /zh-tw/ path because the donor said zh-Hans. A donor that agrees keeps
		// its own spelling (zh-Hant stays zh-Hant). On a fallback to the root, the
		// root shell is what the buyer is now looking at, so its declared lang
		// stands and the copy follows it.
		//
		// The matcher accepts any `xx` / `xx-yy`; the copy table does not. A path
		// locale with no copy decides nothing: its served home's own declaration
		// decides if the table has it (`/jp/` declaring `ja`), and otherwise the page
		// is the root's — shell, copy and way back — the same answer as a locale with
		// no home. Whatever shell is left, English copy is never left under a
		// declaration the table lacks: that shell is re-declared `en`.
		const pathCopy = copyLocaleOf(pathLocale);
		if (homePath !== '/' && !pathCopy && !copyLocaleOf(shellLang(shell))) {
			homePath = '/';
			shellRes = await env.ASSETS.fetch(new Request(url.origin + homePath, request));
			if (!shellRes || !shellRes.ok) return buyerPageErrorResponse(503);
			shell = await shellRes.text();
		}
		let locale;
		if (homePath === '/' || !pathCopy) {
			const declared = shellLang(shell);
			locale = copyLocaleOf(declared) || 'en-US';
			if (declared && !copyLocaleOf(declared)) shell = withShellLang(shell, 'en');
		} else {
			locale = pathCopy;
			if (copyLocaleOf(shellLang(shell)) !== locale) shell = withShellLang(shell, pathLocaleTag(pathLocale));
		}
		const copy = BUYER_PAGE_COPY[locale];
		const state = facts ? (facts.ok ? facts.data.state : '') : 'unknown';
		let status;
		let bodyHtml;
		let title;
		if (state === 'active' || state === 'confirming') {
			status = 200;
			bodyHtml = subscribeResultBody(state, facts.data.plan, copy, locale);
			title = copy.subscribeThanks;
		} else if (state === 'unknown') {
			// Truthful, and a 404 rather than a 200: nothing was found under this URL.
			status = 404;
			bodyHtml = subscribeResultUnknownBody(copy, homePath);
			title = copy.subscribeUnknown;
		} else {
			// A 2xx carrying a state this page cannot read is no more usable than a
			// refusal — 502, the same "no usable answer" code the buyer pages use.
			status = facts.ok ? 502 : facts.status;
			bodyHtml = subscribeResultUnavailableBody(copy);
			title = copy.subscribeResultTitle;
		}
		// noindex for the same reason renderCompletion sets it: this is one buyer's
		// per-session payment result, not a page of the site. (/membership and
		// /account are ordinary site pages, which is why they carry none.) There is
		// no island slot on this page, so no island script is loaded either.
		const head = injectHead(stripDonorHead(shell),
			'<title>' + escHtml(title) + '</title><meta name="robots" content="noindex">');
		const composed = replaceMain(head, bodyHtml);
		// The donor had no <main>: returning it unchanged would serve the site's ROOT
		// page under this URL as a success.
		if (composed === head) return buyerPageErrorResponse(503);
		return new Response(composed, {
			status: status,
			headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' }
		});
	} catch (e) {
		return buyerPageErrorResponse(503);
	}
}

// The built /shop page carries the coral's own config on its `[data-dynamic-coral="square-shop"]`
// div (data-cart / data-detail-base / data-*-label). That div IS the source of truth, so the worker
// reads the SSR params straight off it — no second config to bake or drift.
function parseCoralDiv(html) {
	const m = html.match(/<div\b[^>]*\bdata-dynamic-coral=["']square-shop["'][^>]*><\/div>/i);
	if (!m) return null;
	const tag = m[0];
	// Astro emits the embed's raw HTML verbatim with double-quoted attributes.
	const attr = (n) => { const mm = tag.match(new RegExp('data-' + n + '="([^"]*)"', 'i')); return mm ? mm[1] : ''; };
	const completionLabels = {};
	for (const key of Object.keys(COMPLETE_COPY['en-US'])) completionLabels[key] = attr('complete-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
	return {
		tag,
		cart: attr('cart') === '1' || attr('cart') === 'header',
		noSidebar: attr('cart') === 'header',
		detailBase: attr('detail-base'),
		labels: { add: attr('add-label'), buy: attr('buy-label') }, completionLabels,
		locale: attr('locale') || attr('shop-locale') || 'en-US'
	};
}
// Put the server-rendered grid INSIDE the (empty) coral div, so square-shop.js hydrates it.
function injectCoralGrid(html, coralTag, gridHtml) {
	return html.replace(coralTag, coralTag.replace(/><\/div>$/i, '>') + gridHtml + '</div>');
}

// The published 0.11.7 coral understands the site locator and cart mount but
// predates the selected-rail query. Keep that compatibility asset immutable and
// scope only this generated provider surface's same-origin catalog calls.
function providerRailScopeScript(rail) {
	const selected = JSON.stringify(rail);
	return `<script>(function(){const rail=${selected},raw=window.fetch;if(!raw)return;window.fetch=function(input,init){let u;try{u=new URL(typeof input==='string'?input:input.url,window.location.href)}catch(e){return raw.apply(this,arguments)}if(u.origin!==window.location.origin||!/^\\/api\\/v2\\/(?:shop|square)\\//.test(u.pathname))return raw.apply(this,arguments);u.searchParams.set('payment_rail',rail);const next=Object.assign({},init||{});const headers=new Headers(next.headers||{});const method=(next.method||(input&&input.method)||'GET').toUpperCase();if(method!=='GET'&&method!=='HEAD'&&typeof next.body==='string'&&/application\\/json/i.test(headers.get('content-type')||'')){try{next.body=JSON.stringify(Object.assign({},JSON.parse(next.body),{payment_rail:rail}))}catch(e){}}return raw.call(this,u.toString(),next)}})();</script>`;
}

// USED ONLY when the built shell has no author coral div at all (a raw
// compatibility /shop page with no [data-dynamic-coral="square-shop"] mount) —
// the one case where there is nothing of the owner's to preserve. Deliberately
// pinned to the 0.11.7 compatibility asset: this is the OLD behaviour, kept
// byte-for-byte for that page shape (storefront-source-routing.test.mjs pins
// it). The owner's actual coral div, when one exists, is pinned by
// pinCoralRail() below onto the registry v0 channel instead — see
// renderGridPage.
function providerMount(cfg, shop) {
	const site = cfg.siteId ? ` data-site-id="${escHtml(cfg.siteId)}"` : '';
	const guild = cfg.guildId ? ` data-guild-id="${escHtml(cfg.guildId)}"` : '';
	return `<div data-dynamic-coral="square-shop"${site}${guild} data-payment-rail="${escHtml(shop.provider)}" data-cart="1"></div>${providerRailScopeScript(shop.provider)}<script type="module" src="/corals/square-shop/0.11.7/square-shop.js"></script>`;
}

// Set (or add) one data-* attribute on an EMPTY coral div tag (`<div …></div>`,
// parseCoralDiv's `.tag` shape) without touching any other attribute on it.
function setCoralAttr(divTag, name, value) {
	const re = new RegExp('(\\sdata-' + name + '=")[^"]*(")', 'i');
	if (re.test(divTag)) return divTag.replace(re, `$1${escHtml(value)}$2`);
	return divTag.replace(/><\/div>$/i, ` data-${name}="${escHtml(value)}"></div>`);
}

// The owner's rule: the platform mounts INTO the author's page, it never
// replaces it. This pins the selected payment rail (and identity, if the
// author's own markup doesn't already carry it) onto the author's OWN coral
// div — every other author attribute (labels, cart mode, detail-base, locale,
// no-sidebar) rides through completely unmodified, because nothing here
// touches them.
function pinCoralRail(divTag, cfg, shop) {
	let tag = setCoralAttr(divTag, 'payment-rail', shop.provider);
	if (cfg.siteId && !/\sdata-site-id="/i.test(tag)) tag = setCoralAttr(tag, 'site-id', cfg.siteId);
	if (cfg.guildId && !/\sdata-guild-id="/i.test(tag)) tag = setCoralAttr(tag, 'guild-id', cfg.guildId);
	return tag;
}

// True when the shell already loads a square-shop module (any version/channel)
// — an author-built /shop page normally does, since it's what makes the coral
// div hydrate in the first place. Only when this is false do we add one, and
// always on the registry's OTA channel (v0), never a version pin.
function hasSquareShopModule(html) {
	return /<script\b[^>]*\bsrc=["'][^"']*\/corals\/square-shop\/[^"']*["'][^>]*>/i.test(html);
}

function nativeCatalogItem(item) {
	const commerce = item && item.commerce;
	if (!commerce || !commerce.sku) return null;
	const copy = item.copy || {};
	const images = Array.isArray(copy.media) ? copy.media.map((entry) => entry && entry.url).filter(Boolean) : [];
	const image = images[0] || copy.image_ref || '';
	// The native projection carries Site DO inventory status, whose vocabulary is
	// IN_STOCK | OUT_OF_STOCK. `available` is already net of active reservations,
	// so tracked inventory must have both IN_STOCK and a positive available count;
	// do not subtract `reserved` again.
	const available = commerce.status === 'IN_STOCK' && (!commerce.tracked || Number(commerce.available) > 0);
	const display = commerce.unit_price == null ? null : Number(commerce.unit_price) / (String(commerce.currency || '').toUpperCase() === 'JPY' ? 1 : 100);
	return {
		slug: item.slug,
		name: copy.name || '',
		title: copy.name || '',
		image_url: image,
		// `/api/cart/items` accepts the native inventory SKU. A variant id is
		// carried by the server's inventory row, not supplied as a provider-style
		// catalog reference from this generated surface.
		sku: commerce.sku,
		price_minor: commerce.unit_price,
		display_price: display,
		currency: commerce.currency,
		available,
		// Truthful runtime state: a sold-out product says so. Driven only by the
		// RSP inventory status; every other cause of !available keeps the generic copy.
		outOfStock: commerce.status === 'OUT_OF_STOCK',
		// Additive producer fields, read and never inferred: `rail_refused` is only ever the exact
		// string "currency"; `checkout_rail` is any non-empty string naming the payment rail to press with.
		railRefused: commerce.rail_refused === 'currency',
		checkoutRail: typeof commerce.checkout_rail === 'string' && commerce.checkout_rail ? commerce.checkout_rail : '',
		// `checkout_rails` is the Owner-ordered list of rails that can charge this currency, present only
		// when there are two or more: anything else (missing, one entry, a non-string entry) reads as none.
		checkoutRails: Array.isArray(commerce.checkout_rails) && commerce.checkout_rails.length >= 2 && commerce.checkout_rails.every((id) => typeof id === 'string' && id) ? commerce.checkout_rails.slice() : []
	};
}

async function fetchNativeProjection(request, env, cfg, slug, ctx) {
	const binding = platformReader(env, ctx, cfg);
	if (!binding || !cfg.siteId) return { kind: 'unavailable' };
	const url = new URL('/api/v2/storefront/native', new URL(request.url).origin);
	url.searchParams.set('site_id', cfg.siteId);
	if (slug) url.searchParams.set('slug', slug);
	try {
		const response = await binding.fetch(new Request(url.toString(), { method: 'GET', headers: request.headers }));
		const body = await response.json().catch(() => null);
		if (response.ok && body && body.ok === true && body.source === 'native') return { kind: 'ok', body };
		return { kind: response.status === 404 ? 'not_found' : 'unavailable' };
	} catch (e) {
		return { kind: 'unavailable' };
	}
}

// Every PLATFORM-authored string the native storefront renders, in the same supported-locale
// vocabulary COMPLETE_COPY and BUYER_PAGE_COPY already carry. Product names, descriptions,
// images and the owner's own shell content are deliberately absent: those are the site's bytes
// and ride through untouched.
//
// `checkoutConflict` makes no retry promise on purpose. RSP answers a second concurrent attempt
// with 409 {error:"checkout_attempt_conflict"} and exposes NO recovery action with it (there is
// no pending-checkout locator in that body), so the honest sentence is that one is already
// running — and nativeCheckoutScript leaves the control disabled to match it.
const NATIVE_COPY = {
	'en-US': { shop: 'Shop', buy: 'Buy now', soldOut: 'Unavailable', outOfStock: 'Sold out', checkoutBusy: 'Processing…', unavailable: 'Storefront unavailable', unavailableBody: 'Please try again later.', notFound: 'Product not found', empty: 'No products are available.', checkoutError: 'Unable to start checkout. Please try again.', checkoutConflict: 'A checkout is already in progress. Another one cannot be started right now.', currencyRefused: 'This item can\'t be paid for with this site\'s payment method.', previewLiveRefused: 'This is a preview. It can\'t take real payments, so purchases open when the site goes live.', emailLabel: 'Email for your order confirmation', emailRequired: 'Enter your email address to continue to payment.', emailInvalid: 'Please enter a valid email address.', emailConflict: 'This order is already linked to a different email address. Please enter the same address as before.', paymentMethod: 'Payment method', railEcpay: 'ECPay', previewTest: 'Preview — checkout runs in test mode; no real money moves.' },
	'ja-JP': { shop: 'ショップ', buy: '今すぐ購入', soldOut: 'ご購入いただけません', outOfStock: '売り切れ', checkoutBusy: '処理中…', unavailable: 'ショップを表示できません', unavailableBody: 'しばらくしてから再度お試しください。', notFound: '商品が見つかりません', empty: '現在ご購入いただける商品はありません。', checkoutError: 'お支払い手続きを開始できませんでした。もう一度お試しください。', checkoutConflict: 'すでにお支払い手続きが進行中のため、新しい手続きは開始できません。', currencyRefused: 'この商品は、このサイトの支払い方法では購入できません。', previewLiveRefused: 'これはプレビューです。実際のお支払いは受け付けられないため、サイトの公開後にご購入いただけます。', emailLabel: 'メールアドレス（注文確認の送付先）', emailRequired: 'お支払いに進むには、メールアドレスを入力してください。', emailInvalid: '有効なメールアドレスを入力してください。', emailConflict: 'この注文には別のメールアドレスが登録されています。前回と同じアドレスを入力してください。', paymentMethod: '支払い方法', railEcpay: 'ECPay', previewTest: 'プレビュー：決済はテストモードで動作し、実際に請求されることはありません。' },
	'zh-TW': { shop: '商店', buy: '立即購買', soldOut: '無法購買', outOfStock: '已售完', checkoutBusy: '處理中…', unavailable: '無法顯示商店', unavailableBody: '請稍後再試。', notFound: '找不到這個商品', empty: '目前沒有可購買的商品。', checkoutError: '無法開始結帳，請再試一次。', checkoutConflict: '已經有一筆結帳正在進行中，現在無法再開始新的結帳。', currencyRefused: '這個商品目前無法用本站的付款方式結帳。', previewLiveRefused: '這是預覽，無法收取真實款項；網站上線後才能購買。', emailLabel: '電子郵件（寄送訂單確認）', emailRequired: '請輸入電子郵件地址以繼續付款。', emailInvalid: '請輸入有效的電子郵件地址。', emailConflict: '此訂單已綁定其他電子郵件地址，請輸入先前填寫的地址。', paymentMethod: '付款方式', railEcpay: '綠界', previewTest: '預覽：結帳為測試模式，不會實際扣款。' },
	'zh-CN': { shop: '商店', buy: '立即购买', soldOut: '无法购买', outOfStock: '已售罄', checkoutBusy: '处理中…', unavailable: '无法显示商店', unavailableBody: '请稍后再试。', notFound: '找不到这个商品', empty: '目前没有可购买的商品。', checkoutError: '无法开始结账，请再试一次。', checkoutConflict: '已经有一笔结账正在进行中，现在无法再开始新的结账。', currencyRefused: '这个商品目前无法使用本站的付款方式结账。', previewLiveRefused: '这是预览，无法收取真实款项；网站上线后才能购买。', emailLabel: '电子邮箱（接收订单确认）', emailRequired: '请输入电子邮箱地址以继续付款。', emailInvalid: '请输入有效的电子邮箱地址。', emailConflict: '此订单已绑定其他电子邮箱地址，请输入之前填写的地址。', paymentMethod: '付款方式', railEcpay: '绿界', previewTest: '预览：结账为测试模式，不会实际扣款。' }
};

// ONE resolver, the same one the site-owned buyer pages use: the donor shell the site itself
// built is what declares the language, so a native render reads the site's own answer instead of
// falling back to a platform default (or to `--shops` build metadata, which is not the page).
function nativeLocale(shell) {
	return localeFromHint(shellLang(shell));
}

// 🔴 Native still replaces the WHOLE <main>, unlike renderGridPage's coral-preserving mount
// (above). That is not an oversight carried over from the same bug — it's the ceiling of what's
// possible today: native has no client-side coral markup at all (no square-shop-shaped div, no
// other marker) anywhere in sitetile's authoring, so there is nothing on the page for a native
// render to key off and preserve. Closing this the same way the provider path was closed would
// need a real authored mount point for native shops first — a sitetile/authoring change, out of
// this fix's scope. Flagging rather than silently declaring native "done" alongside provider.
function nativeUnavailable(shell, copy) {
	// nativeUnavailableBody() itself stays byte-for-byte (it is also nativeUnavailableDocument()'s
	// pinned exact output, storefront-source-routing.test.mjs) — the runtime inset is added at this
	// in-shell call site instead, with a non-section DIV wrapper around the pinned body.
	return replaceMain(shell, `<div class="st-runtime">${nativeUnavailableBody(copy)}</div>`);
}
function nativeUnavailableBody(copy) {
	return `<section data-storefront-source="native" data-storefront-state="unavailable"><h1>${escHtml(copy.unavailable)}</h1><p>${escHtml(copy.unavailableBody)}</p></section>`;
}

// No donor shell means no site-declared language to resolve AND nothing of the site's to compose
// into. This stays the honest non-success document rather than a styled page pretending to be
// the site; 'en-US' is the last resort here precisely BECAUSE the donor that would have answered
// the language question is the thing that is missing.
function nativeUnavailableDocument() {
	return '<!doctype html><main>' + nativeUnavailableBody(NATIVE_COPY['en-US']) + '</main>';
}

// Native C uses its own cart + checkout contract. The browser submits only the
// projected inventory SKU and quantity; checkout re-reads cart/inventory and
// derives the charge server-side, so no displayed price crosses this boundary.
function nativeBuyControl(item, copy, refused) {
	if (!item.available || !item.sku) return `<button type="button" class="dc-native-buy" disabled>${escHtml(item.outOfStock && item.sku ? copy.outOfStock : copy.soldOut)}</button>`;
	if (refused) return `<button type="button" class="dc-native-buy" disabled>${escHtml(copy.buy)}</button>`;
	const first = item.checkoutRails.length ? item.checkoutRails[0] : item.checkoutRail;
	const rail = first ? ` data-native-rail="${escHtml(first)}"` : '';
	return `<button type="button" class="dc-native-buy" data-native-sku="${escHtml(item.sku)}"${rail}>${escHtml(copy.buy)}</button>`;
}

// The buyer's own choice among the eligible rails, shown only where Buy can actually be pressed. The
// first listed rail starts checked (it is also the Buy button's data-native-rail), and the radio name
// is scoped to the item's SKU so grid cards never share one group.
function nativeRailChoice(item, copy, refused) {
	if (!item.checkoutRails.length || !item.available || !item.sku || refused) return '';
	const names = { stripe: 'Stripe', square: 'Square', ecpay: copy.railEcpay };
	const radios = item.checkoutRails.map((id, i) => `<label><input type="radio" name="${escHtml('native-rail-' + item.sku)}" value="${escHtml(id)}" data-native-rail-choice${i === 0 ? ' checked' : ''}> ${escHtml(Object.prototype.hasOwnProperty.call(names, id) ? names[id] : id)}</label>`).join('');
	return `<fieldset data-native-rails><legend>${escHtml(copy.paymentMethod)}</legend>${radios}</fieldset>`;
}

// RSP adds a top-level `preview_checkout` to the native projection only when the request is for the
// Site's own preview host: "test" (the routed rail charges in test mode) or "live_refused" (it
// would charge real money, so RSP refuses every checkout there). Any other value, or no field at
// all, is today's storefront — the field is read, never inferred.
function nativePreviewCheckout(body) {
	const mode = body && body.preview_checkout;
	return mode === 'test' || mode === 'live_refused' ? mode : null;
}
// A purchasable item on a live_refused preview renders its Buy control disabled and says why on the
// status node, with the same error tone the checkout script stamps; every other case is the empty
// status node as before.
// Returns the copy key of the sentence to show, or null. Precedence: stock state (handled by the
// available/sku guard) > preview refusal > currency refusal.
function nativeItemRefused(item, preview) {
	if (!item.available || !item.sku) return null;
	if (preview === 'live_refused') return 'previewLiveRefused';
	if (item.railRefused) return 'currencyRefused';
	return null;
}
function nativeStatusNode(copy, refused) {
	return refused
		? `<p data-native-status role="status" class="st-runtime-status" data-ejecta-status-tone="error">${escHtml(copy[refused])}</p>`
		: '<p data-native-status role="status" class="st-runtime-status"></p>';
}
function nativePreviewNotice(copy, preview) {
	return preview === 'test' ? `<p class="st-runtime-status">${escHtml(copy.previewTest)}</p>` : '';
}

// The form-post launcher both native checkout scripts share, as source text: the ECPay origin
// allowlist `T` must be in scope where it is interpolated. Lifted verbatim out of
// nativeCheckoutScript, so that script's emitted bytes are unchanged.
const NATIVE_FORM_POST_SOURCE = `function post(fp){const a=fp.action,f=fp.fields;if(typeof a!=='string'||!a||/[\\u0000-\\u001f\\u007f-\\u009f]/.test(a))return false;let u;try{u=new URL(a)}catch(e){return false}if(u.protocol!=='https:'||u.username||u.password||T.indexOf(u.origin)<0)return false;if(!f||typeof f!=='object'||Array.isArray(f))return false;const names=Object.keys(f);if(!names.length||names.length>64)return false;let total=0;for(let i=0;i<names.length;i++){const n=names[i],v=f[n];if(n.length>64||!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(n)||typeof v!=='string'||v.length>8192||/[\\u0000-\\u001f\\u007f-\\u009f]/.test(v))return false;total+=n.length+v.length;if(total>32768)return false}if(!document.createElement)return false;const host=document.body||document.documentElement;if(!host||!host.appendChild)return false;const form=document.createElement('form');const submit=form.submit,add=form.appendChild,drop=form.remove;if(typeof submit!=='function'||typeof add!=='function')return false;for(let i=0;i<names.length;i++){if(names[i] in form||names[i].toLowerCase() in form)return false}form.method='POST';form.action=a;if(form.setAttribute)form.setAttribute('hidden','');for(let i=0;i<names.length;i++){const input=document.createElement('input');input.type='hidden';input.name=names[i];input.value=f[names[i]];add.call(form,input)}host.appendChild(form);let sent=false;try{submit.call(form);sent=true}catch(e){sent=false}finally{if(typeof drop==='function')drop.call(form);else if(host.removeChild)host.removeChild(form)}return sent}`;

// The non-2xx BODY is read BEFORE the failure is classified, because only one exact pair earns
// the conflict sentence: 409 with {error:"checkout_attempt_conflict"}, the stable code RSP
// returns when a checkout attempt is already open for this cart. Anything else — a different
// 409, a 5xx, an unparsable body, a dead network, a failed cart add — stays the generic failure,
// since inventing a cause the server did not give is the same lie in the other direction.
//
// After the exact conflict the control is LEFT disabled. There is no recovery action to hand the
// buyer (that 409 carries no pending-checkout locator), so re-enabling it would invite a click
// whose only possible effect is to repeat the operation the server just refused. Nothing else
// about the request pair changes: same paths, same bodies, no automatic retry.
//
// On a preview page (`preview` set) one more exact pair is named: 409 with
// {error:"preview_checkout_live_mode"}, RSP's refusal when the preview's rail would take real
// money — for instance a page rendered before the rail changed. It gets the preview line with the
// error tone, the control stays disabled, and nothing promises that trying again helps.
//
// Every failure line the script writes — the generic one, the exact conflict, the currency
// refusal and the preview refusal — carries data-ejecta-status-tone="error", the value the renderer
// base layer's .st-runtime-status rule matches, so a failure reads as a failure and not as neutral muted text.
// A new attempt clears the previous line and its tone before the control goes busy; success
// navigates away and sets no tone.
function nativeCheckoutScript(copy, preview, rail, choice) {
	const strings = JSON.stringify(Object.assign({ error: copy.checkoutError, conflict: copy.checkoutConflict, currencyRefused: copy.currencyRefused, busy: copy.checkoutBusy, emailLabel: copy.emailLabel, emailRequired: copy.emailRequired, emailInvalid: copy.emailInvalid, emailConflict: copy.emailConflict }, preview ? { refused: copy.previewLiveRefused } : {})).replace(/</g, '\\u003c');
	const pv = preview
		? { decl: 'let refused=false;', detect: "refused=checkout.status===409&&!!result&&result.error==='preview_checkout_live_mode';", keep: '&&!refused', text: 'refused?C.refused:' }
		: { decl: '', detect: '', keep: '', text: '' };
	// A page with at least one item carrying `checkout_rail` gets a body builder that adds
	// `payment_rail` from the pressed button; every other page keeps the original builder bytes.
	const bodyDefault = "const body=email?JSON.stringify(lang?{lang:lang,customer_email:email}:{customer_email:email}):lang?JSON.stringify({lang:lang}):null;";
	const bodyRail = "const pr=button.getAttribute('data-native-rail');const base=email?(lang?{lang:lang,customer_email:email}:{customer_email:email}):lang?{lang:lang}:null;const body=pr?JSON.stringify(Object.assign(base||{},{payment_rail:pr})):base?JSON.stringify(base):null;";
	// A page with a payment-method group sends the checked radio (found beside the pressed button, like the
	// email field) and falls back to the button's data-native-rail; the radios lock while a checkout is in
	// flight and unlock wherever the button does.
	const bodyChoice = bodyRail.replace("const pr=button.getAttribute('data-native-rail');", "const picked=parent&&parent.querySelector?parent.querySelector('[data-native-rail-choice]:checked'):null;const pr=picked&&typeof picked.value==='string'&&picked.value?picked.value:button.getAttribute('data-native-rail');");
	const bodyBuilder = choice ? bodyChoice : rail ? bodyRail : bodyDefault;
	const lock = choice ? "const radios=parent&&parent.querySelectorAll?parent.querySelectorAll('[data-native-rail-choice]'):[];for(let i=0;i<radios.length;i++)radios[i].disabled=true;" : '';
	const unlockOpen = choice ? '{' : '';
	const unlockClose = choice ? 'for(let i=0;i<radios.length;i++)radios[i].disabled=false;}' : '';
	return `<script>(function(){const C=${strings};const E=['customer_email_required','customer_email_invalid','customer_email_conflict'];const W=new WeakSet();const T=['https://payment-stage.ecpay.com.tw','https://payment.ecpay.com.tw'];function ask(button,code){const parent=button.parentElement;let field=parent&&parent.querySelector?parent.querySelector('[data-native-email-field]'):null;const doc=button.ownerDocument;if(!field&&parent&&doc&&doc.createElement&&parent.insertBefore){const wrap=doc.createElement('div');wrap.setAttribute('data-native-email','');const label=doc.createElement('label');const caption=doc.createElement('span');caption.textContent=C.emailLabel;field=doc.createElement('input');field.setAttribute('type','email');field.setAttribute('autocomplete','email');field.setAttribute('required','');field.setAttribute('aria-label',C.emailLabel);field.setAttribute('data-native-email-field','');if(field.addEventListener)field.addEventListener('keydown',function(e){if(e&&e.key==='Enter'){if(e.preventDefault)e.preventDefault();if(button.click)button.click()}});label.appendChild(caption);label.appendChild(field);wrap.appendChild(label);parent.insertBefore(wrap,button)}if(field){field.disabled=false;field.setAttribute('aria-invalid','true');if(field.focus)field.focus()}return code==='customer_email_invalid'?C.emailInvalid:code==='customer_email_conflict'?C.emailConflict:C.emailRequired}${NATIVE_FORM_POST_SOURCE}function launch(r){if(!r||typeof r!=='object')return false;if(r.form_post&&typeof r.form_post==='object')return post(r.form_post);if(typeof r.redirect_url!=='string')return false;window.location.assign(r.redirect_url);return true}document.addEventListener('click',async function(event){const button=event.target&&event.target.closest&&event.target.closest('[data-native-sku]');if(!button||button.disabled)return;const sku=button.getAttribute('data-native-sku');if(!sku)return;const idle=button.textContent;const status=button.parentElement&&button.parentElement.querySelector('[data-native-status]');if(status){status.textContent='';status.removeAttribute('data-ejecta-status-tone')}button.disabled=true;button.setAttribute('aria-busy','true');if(C.busy)button.textContent=C.busy;const parent=button.parentElement;const field=parent&&parent.querySelector?parent.querySelector('[data-native-email-field]'):null;const email=field&&typeof field.value==='string'?field.value.trim():'';if(field)field.disabled=true;${lock}let conflict=false;let currencyRefused=false;let emailCode='';${pv.decl}try{if(!W.has(button)){const cart=await fetch('/api/cart',{method:'GET',credentials:'same-origin'});if(!cart.ok)throw new Error('cart failed');const held=await cart.json().catch(function(){return null});if(!held||!Array.isArray(held.lines))throw new Error('cart failed');let has=false;for(let i=0;i<held.lines.length;i++){const l=held.lines[i];if(l&&l.sku===sku&&Number(l.qty)>=1)has=true}if(!has){const added=await fetch('/api/cart/items',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({sku:sku,qty:1})});if(!added.ok)throw new Error('add failed')}}const lang=(document.documentElement&&document.documentElement.lang||'').trim();${bodyBuilder}const checkout=await fetch('/api/checkout',body?{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:body}:{method:'POST',credentials:'same-origin'});const result=await checkout.json().catch(function(){return null});if(!checkout.ok){if(result&&typeof result.error==='string'&&E.indexOf(result.error)>=0)emailCode=result.error;conflict=checkout.status===409&&!!result&&result.error==='checkout_attempt_conflict';currencyRefused=checkout.status===409&&!!result&&result.code==='rail_currency_unsupported';${pv.detect}throw new Error('checkout failed')}if(!launch(result))throw new Error('checkout failed')}catch(error){button.removeAttribute('aria-busy');button.textContent=idle;let emailMsg='';if(emailCode){W.add(button);emailMsg=ask(button,emailCode)}else if(field)field.disabled=false;if(!conflict&&!currencyRefused${pv.keep})${unlockOpen}button.disabled=false;${unlockClose}if(status){status.textContent=emailMsg?emailMsg:${pv.text}currencyRefused?C.currencyRefused:conflict?C.conflict:C.error;status.setAttribute('data-ejecta-status-tone','error')}}})})()</script>`;
}

// ─── NATIVE ECPAY CHECKOUT (in-page) ──────────────────────────────────────────
// A product that ships, priced in TWD, on a Site whose ECPay logistics answer with at least one
// delivery method gets its checkout expanded IN the page when the buyer presses Buy: delivery
// method with its fee, the convenience-store map round trip, recipient, invoice choice, payment
// (cash on delivery where the method allows it) and the total, then RSP's dedicated ECPay door
// (POST /api/v2/ecpay/checkout). Field names are RSP's own:
//   GET  /api/v2/ecpay/logistics/delivery-options?site_id=&items_minor=
//        → {ok, currency, options:[{sub_type, logistics_type, fee_minor, free_threshold_minor, cod_available}]}
//   POST /api/v2/ecpay/logistics/store-map {site_id, sub_type, client_back_url, device, cash_on_delivery?}
//        → {ok, form_post}; ECPay's answer returns to client_back_url with `?store_ref=`
//   POST /api/v2/ecpay/checkout {site_id, items, client_request_ref, client_back_url, logistics,
//        customer_email, invoice?, payment?} → {order_id, form_post} | {order_id, cash_on_delivery:true}
//
// Everything else keeps today's flow byte for byte: any other product renders exactly as before,
// and a Site whose delivery-options read answers no method hands the very same click to the
// existing native checkout script (the control is re-marked `data-native-sku` and clicked again).
//
// The server mints this door's order id, so the result page cannot be named by it in advance.
// The script keeps the order id (and, for cash on delivery, the figures it showed) in
// sessionStorage under the client_request_ref the back URL carries; the completion page reads it
// back for this tab only. The draft kept across the store-map round trip holds the delivery
// method, recipient name and phone, email and the invoice CHOICE — never a carrier number,
// donation code or tax id — stays in this tab's sessionStorage and is removed when the order is sent.

const NATIVE_ECPAY_SUBTYPES = {
	'en-US': { UNIMART: '7-Eleven pickup', UNIMARTC2C: '7-Eleven pickup', UNIMARTFREEZE: '7-Eleven frozen pickup', FAMI: 'FamilyMart pickup', FAMIC2C: 'FamilyMart pickup', HILIFE: 'Hi-Life pickup', HILIFEC2C: 'Hi-Life pickup', OKMARTC2C: 'OK Mart pickup', TCAT: 'T-Cat home delivery', POST: 'Chunghwa Post home delivery' },
	'ja-JP': { UNIMART: 'セブン-イレブン受け取り', UNIMARTC2C: 'セブン-イレブン受け取り', UNIMARTFREEZE: 'セブン-イレブン冷凍受け取り', FAMI: 'ファミリーマート受け取り', FAMIC2C: 'ファミリーマート受け取り', HILIFE: 'ハイライフ受け取り', HILIFEC2C: 'ハイライフ受け取り', OKMARTC2C: 'OKマート受け取り', TCAT: 'ヤマト宅配便', POST: '中華郵政宅配' },
	'zh-TW': { UNIMART: '7-ELEVEN 取貨', UNIMARTC2C: '7-ELEVEN 取貨', UNIMARTFREEZE: '7-ELEVEN 冷凍取貨', FAMI: '全家取貨', FAMIC2C: '全家取貨', HILIFE: '萊爾富取貨', HILIFEC2C: '萊爾富取貨', OKMARTC2C: 'OK 超商取貨', TCAT: '黑貓宅配', POST: '中華郵政宅配' },
	'zh-CN': { UNIMART: '7-ELEVEN 取货', UNIMARTC2C: '7-ELEVEN 取货', UNIMARTFREEZE: '7-ELEVEN 冷冻取货', FAMI: '全家取货', FAMIC2C: '全家取货', HILIFE: '莱尔富取货', HILIFEC2C: '莱尔富取货', OKMARTC2C: 'OK 超商取货', TCAT: '黑猫宅配', POST: '中华邮政宅配' }
};

const NATIVE_ECPAY_COPY = {
	'en-US': { ship: 'Delivery', recipient: 'Recipient', name: 'Name', phone: 'Mobile phone', address: 'Address', postal: 'Postal code (optional)', pay: 'Payment', card: 'Credit card (ECPay)', cod: 'Pay on pickup', codCvs: 'Pay {total} when you collect it at the store.', codHome: 'Pay {total} on delivery.', invoice: 'E-invoice', invEcpay: 'Keep in my ECPay member carrier', invMobile: 'Mobile barcode', invDonate: 'Donate', invTaxId: 'Company tax ID', invCitizen: 'Citizen digital certificate', citizenCode: 'Certificate number', invPaper: 'Paper invoice', invPaperNote: 'Sent with the parcel.', mobileCode: 'Mobile barcode (starts with /, 8 characters)', loveCode: 'Donation code', taxId: 'Tax ID number', company: 'Company name', companyAddress: 'Company address', subtotal: 'Subtotal', fee: 'Shipping', total: 'Total', free: 'Free', threshold: 'Free over {amount}', storePick: 'Choose a store', storePickNote: 'On the ECPay store map', storeChosen: 'Store selected', storeChosenNote: 'Your confirmation email names the store.', storeChange: 'Change store', submitCard: 'Continue to payment', submitCod: 'Place order', noteCard: 'You will pay on the ECPay payment page.', noteCod: 'Nothing is charged now; you pay on pickup.', errName: 'Enter the recipient’s name.', errPhone: 'Enter the recipient’s mobile phone.', errPhoneBad: 'This phone number does not look right.', errStore: 'Choose a store first.', errStoreStale: 'That store selection has expired. Please choose the store again.', errAddress: 'Enter the delivery address.', errPostal: 'This postal code does not look right.', errMobile: 'Enter the mobile barcode (/ followed by 7 characters).', errLove: 'Enter a donation code of 3 to 7 digits.', errLoveUnknown: 'This donation code was not found.', errLoveUnverifiable: 'The donation code cannot be checked right now. Please choose another option.', errTaxId: 'Enter the 8-digit tax ID number.', errCompany: 'Enter the company name.', errCompanyAddress: 'Enter the company address.', errCitizen: 'Enter the certificate number (2 letters followed by 14 digits).', errPaperName: 'Enter the name for the invoice.', errPaperAddress: 'Enter the address for the invoice.', errMethod: 'This delivery method is not available right now. Please choose another.', errCod: 'This order cannot be paid on pickup. Please pay by card.', invNotOffered: 'This shop does not issue e-invoices, so that choice was skipped.', storeMapError: 'The store map could not be opened. Please try again.' },
	'ja-JP': { ship: '配送方法', recipient: '受取人', name: '氏名', phone: '携帯電話', address: '住所', postal: '郵便番号（任意）', pay: 'お支払い方法', card: 'クレジットカード（ECPay）', cod: '受け取り時払い', codCvs: '店舗での受け取り時に {total} をお支払いください。', codHome: '配達時に {total} をお支払いください。', invoice: '電子発票', invEcpay: 'ECPay 会員キャリアに保存', invMobile: 'モバイルバーコード', invDonate: '寄付', invTaxId: '統一編号（法人）', invCitizen: '自然人証明書', citizenCode: '証明書番号', invPaper: '紙の発票', invPaperNote: '商品に同梱します。', mobileCode: 'モバイルバーコード（/ から始まる 8 文字）', loveCode: '寄付コード', taxId: '統一編号', company: '会社名', companyAddress: '会社住所', subtotal: '小計', fee: '送料', total: '合計', free: '送料無料', threshold: '{amount} 以上で送料無料', storePick: '店舗を選ぶ', storePickNote: 'ECPay の店舗マップで選択', storeChosen: '店舗を選択済み', storeChosenNote: '確認メールに店舗が記載されます。', storeChange: '店舗を変更', submitCard: 'お支払いへ進む', submitCod: '注文を確定する', noteCard: 'ECPay のお支払いページに移動します。', noteCod: '今は請求されません。受け取り時にお支払いください。', errName: '受取人の氏名を入力してください。', errPhone: '受取人の携帯電話を入力してください。', errPhoneBad: '電話番号の形式が正しくありません。', errStore: '先に店舗を選んでください。', errStoreStale: '店舗の選択が無効になりました。もう一度選んでください。', errAddress: '住所を入力してください。', errPostal: '郵便番号の形式が正しくありません。', errMobile: 'モバイルバーコード（/ に続く 7 文字）を入力してください。', errLove: '3〜7 桁の寄付コードを入力してください。', errLoveUnknown: 'この寄付コードは見つかりません。', errLoveUnverifiable: '寄付コードを確認できません。別の方法を選んでください。', errTaxId: '8 桁の統一編号を入力してください。', errCompany: '会社名を入力してください。', errCompanyAddress: '会社住所を入力してください。', errCitizen: '証明書番号（英字 2 文字と数字 14 桁）を入力してください。', errPaperName: '発票の宛名を入力してください。', errPaperAddress: '発票の住所を入力してください。', errMethod: 'この配送方法は現在ご利用いただけません。別の方法を選んでください。', errCod: 'このご注文は受け取り時払いにできません。カードでお支払いください。', invNotOffered: 'このショップは電子発票を発行しないため、この項目は省略しました。', storeMapError: '店舗マップを開けませんでした。もう一度お試しください。' },
	'zh-TW': { ship: '配送方式', recipient: '收件人', name: '姓名', phone: '手機', address: '地址', postal: '郵遞區號（選填）', pay: '付款方式', card: '信用卡（綠界）', cod: '取貨付款', codCvs: '到店取貨時付 {total}。', codHome: '送達時付 {total}。', invoice: '電子發票', invEcpay: '存在綠界會員載具', invMobile: '手機條碼', invDonate: '捐贈', invTaxId: '公司統編', invCitizen: '自然人憑證', citizenCode: '憑證號碼', invPaper: '紙本發票', invPaperNote: '隨商品寄出。', mobileCode: '手機條碼（/ 開頭共 8 碼）', loveCode: '捐贈碼', taxId: '統一編號', company: '公司抬頭', companyAddress: '公司地址', subtotal: '小計', fee: '運費', total: '合計', free: '免運費', threshold: '滿 {amount} 免運', storePick: '選門市', storePickNote: '到綠界地圖選', storeChosen: '已選門市', storeChosenNote: '確認信會寫明取貨門市。', storeChange: '換門市', submitCard: '前往付款', submitCod: '送出訂單', noteCard: '會到綠界付款頁。', noteCod: '不會先扣款；取貨時付。', errName: '請輸入收件人姓名。', errPhone: '請輸入收件人手機。', errPhoneBad: '手機號碼格式不對。', errStore: '請先選門市。', errStoreStale: '門市選擇已失效，請重新選門市。', errAddress: '請輸入地址。', errPostal: '郵遞區號格式不對。', errMobile: '請輸入手機條碼（/ 開頭共 8 碼）。', errLove: '請輸入 3 到 7 位數的捐贈碼。', errLoveUnknown: '查無這個捐贈碼。', errLoveUnverifiable: '現在無法確認捐贈碼，請改選其他方式。', errTaxId: '請輸入 8 位數的統一編號。', errCompany: '請輸入公司抬頭。', errCompanyAddress: '請輸入公司地址。', errCitizen: '請輸入憑證號碼（2 個英文字母加 14 位數字）。', errPaperName: '請輸入發票上的姓名。', errPaperAddress: '請輸入發票上的地址。', errMethod: '這個配送方式目前無法使用，請改選其他方式。', errCod: '這筆訂單無法取貨付款，請改用信用卡。', invNotOffered: '這家商店不開立電子發票，已略過這一欄。', storeMapError: '無法開啟門市地圖，請再試一次。' },
	'zh-CN': { ship: '配送方式', recipient: '收件人', name: '姓名', phone: '手机', address: '地址', postal: '邮政编码（选填）', pay: '付款方式', card: '信用卡（绿界）', cod: '取货付款', codCvs: '到店取货时付 {total}。', codHome: '送达时付 {total}。', invoice: '电子发票', invEcpay: '存在绿界会员载具', invMobile: '手机条码', invDonate: '捐赠', invTaxId: '公司统编', invCitizen: '自然人凭证', citizenCode: '凭证号码', invPaper: '纸本发票', invPaperNote: '随商品寄出。', mobileCode: '手机条码（/ 开头共 8 码）', loveCode: '捐赠码', taxId: '统一编号', company: '公司抬头', companyAddress: '公司地址', subtotal: '小计', fee: '运费', total: '合计', free: '免运费', threshold: '满 {amount} 免运', storePick: '选门店', storePickNote: '到绿界地图选', storeChosen: '已选门店', storeChosenNote: '确认信会写明取货门店。', storeChange: '换门店', submitCard: '前往付款', submitCod: '提交订单', noteCard: '会跳转到绿界付款页。', noteCod: '不会先扣款；取货时付。', errName: '请输入收件人姓名。', errPhone: '请输入收件人手机。', errPhoneBad: '手机号码格式不对。', errStore: '请先选门店。', errStoreStale: '门店选择已失效，请重新选门店。', errAddress: '请输入地址。', errPostal: '邮政编码格式不对。', errMobile: '请输入手机条码（/ 开头共 8 码）。', errLove: '请输入 3 到 7 位数的捐赠码。', errLoveUnknown: '查无这个捐赠码。', errLoveUnverifiable: '现在无法确认捐赠码，请改选其他方式。', errTaxId: '请输入 8 位数的统一编号。', errCompany: '请输入公司抬头。', errCompanyAddress: '请输入公司地址。', errCitizen: '请输入凭证号码（2 个英文字母加 14 位数字）。', errPaperName: '请输入发票上的姓名。', errPaperAddress: '请输入发票上的地址。', errMethod: '这个配送方式目前无法使用，请改选其他方式。', errCod: '这笔订单无法取货付款，请改用信用卡。', invNotOffered: '这家商店不开具电子发票，已略过这一栏。', storeMapError: '无法打开门店地图，请再试一次。' }
};

// Which ECPay pages a launched form may go to: the cashier for a payment, the store map for a
// store choice. Both lists are exact origins, checked by the shared NATIVE_FORM_POST_SOURCE.
const NATIVE_ECPAY_PAY_ORIGINS = ['https://payment-stage.ecpay.com.tw', 'https://payment.ecpay.com.tw'];
const NATIVE_ECPAY_MAP_ORIGINS = ['https://logistics-stage.ecpay.com.tw', 'https://logistics.ecpay.com.tw'];

// Only a purchasable, shipping, TWD product is offered the in-page checkout; the delivery-options
// read decides the rest in the browser.
function nativeEcpayEligible(item, mapped, refused) {
	const copy = (item && item.copy) || {};
	return !!mapped && !refused && !!mapped.available && !!mapped.sku && copy.requires_shipping === true &&
		String(mapped.currency || '').toUpperCase() === 'TWD' && Number.isSafeInteger(Number(mapped.price_minor)) && Number(mapped.price_minor) > 0;
}

function nativeEcpayBuyControl(item, copy) {
	return `<button type="button" class="dc-native-buy" data-native-ecpay-sku="${escHtml(item.sku)}">${escHtml(copy.buy)}</button>`;
}

// The browser half, serialised with toString() into the page. It may use only its arguments and
// browser globals: C (the page's data), the two launchers and formatMoney's own source.
function nativeEcpayCheckoutClient(C, postPay, postMap, formatMoney) {
	const button = document.querySelector('[data-native-ecpay-sku]');
	const panel = document.querySelector('[data-native-ecpay-checkout]');
	if (!button || !panel) return;
	const L = C.labels;
	const status = button.parentElement && button.parentElement.querySelector('[data-native-status]');
	const money = (n) => formatMoney({ minor: Number(n) || 0, currency: C.currency, locale: C.locale });
	const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const fill = (t, k, v) => String(t).split('{' + k + '}').join(v);
	const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;
	const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const DRAFT = 'dc-native-ecpay-draft:' + C.sku;
	const KEEP = ['name', 'phone', 'address', 'postal', 'email'];
	let ss = null;
	try { ss = window.sessionStorage || null; } catch (e) { ss = null; }
	const S = { ship: '', storeRef: '', pay: 'card', inv: 'carrier_ecpay', invOff: false, v: {}, err: {}, form: '', notice: '' };
	let options = null, busy = false, fallen = false, opening = false;
	const current = () => (options || []).find((o) => o.sub_type === S.ship) || null;
	const fee = () => { const o = current(); return o ? Number(o.fee_minor) || 0 : 0; };
	const total = () => C.price + fee();
	const codAllowed = () => { const o = current(); return !!(o && o.cod_available === true); };
	const val = (k) => String(S.v[k] == null ? '' : S.v[k]).trim();
	const uuid = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));
	function saveDraft() {
		if (!ss) return;
		const v = {};
		for (const k of KEEP) if (S.v[k]) v[k] = S.v[k];
		try { ss.setItem(DRAFT, JSON.stringify({ ship: S.ship, pay: S.pay, inv: S.inv, v })); } catch (e) { /* the buyer re-types */ }
	}
	function readDraft() {
		if (!ss) return;
		let d = null;
		try { d = JSON.parse(ss.getItem(DRAFT) || 'null'); } catch (e) { d = null; }
		if (!d || typeof d !== 'object') return;
		if (typeof d.ship === 'string') S.ship = d.ship;
		if (d.pay === 'cod' || d.pay === 'card') S.pay = d.pay;
		if (['carrier_ecpay', 'mobile', 'citizen', 'donate', 'tax_id', 'paper'].indexOf(d.inv) >= 0) S.inv = d.inv;
		if (d.v && typeof d.v === 'object') for (const k of KEEP) if (typeof d.v[k] === 'string') S.v[k] = d.v[k];
	}
	function dropDraft() { if (ss) try { ss.removeItem(DRAFT); } catch (e) { /* nothing kept */ } }
	function radio(name, value, on, inner) {
		return '<label class="st-opt' + (on ? ' st-opt-on' : '') + '"><input type="radio" name="dc-ecpay-' + name + '" value="' + esc(value) + '"' + (on ? ' checked' : '') + '>' + inner + '</label>';
	}
	function errLine(key) { return S.err[key] ? '<p class="st-err" id="dc-ecpay-' + key + '-err">' + esc(S.err[key]) + '</p>' : ''; }
	function field(key, label, type, attrs) {
		const id = 'dc-ecpay-' + key;
		return '<div class="st-field"><label class="st-field-label" for="' + id + '">' + esc(label) + '</label><input id="' + id + '" type="' + type + '" data-ecpay-field="' + key + '" value="' + esc(S.v[key] || '') + '"' + (attrs || '') + (S.err[key] ? ' aria-invalid="true" aria-describedby="' + id + '-err"' : '') + '>' + errLine(key) + '</div>';
	}
	function shipOption(o) {
		const on = o.sub_type === S.ship;
		const name = (C.subtypes && C.subtypes[o.sub_type]) || o.sub_type;
		const f = Number(o.fee_minor) || 0;
		let inner = '<span class="st-opt-t">' + esc(name) + '</span>';
		if (o.free_threshold_minor != null) inner += '<span class="st-opt-d">' + esc(fill(L.threshold, 'amount', money(o.free_threshold_minor))) + '</span>';
		inner += '<span class="st-opt-fee">' + esc(f ? money(f) : L.free) + '</span>';
		if (on && o.logistics_type === 'CVS') {
			const chosen = !!S.storeRef;
			inner += '<div class="st-opt-sub"><div class="st-store"><div><strong>' + esc(chosen ? L.storeChosen : L.storePick) + '</strong><span class="st-note">' + esc(chosen ? L.storeChosenNote : L.storePickNote) + '</span></div><button class="st-runtime-action st-secondary" type="button" data-ecpay-store' + (busy ? ' disabled' : '') + '>' + esc(chosen ? L.storeChange : L.storePick) + '</button></div>' + errLine('store') + '</div>';
		} else if (on) {
			inner += '<div class="st-opt-sub">' + field('address', L.address, 'text', ' autocomplete="street-address"') + field('postal', L.postal, 'text', ' autocomplete="postal-code" inputmode="numeric"') + '</div>';
		}
		return radio('ship', o.sub_type, on, inner);
	}
	function render() {
		const cod = S.pay === 'cod' && codAllowed();
		const o = current();
		let h = '<fieldset class="st-choices"><legend>' + esc(L.ship) + '</legend>' + (options || []).map(shipOption).join('') + errLine('ship') + '</fieldset>';
		h += '<fieldset class="st-choices"><legend>' + esc(L.recipient) + '</legend>' + field('name', L.name, 'text', ' autocomplete="name"') + field('phone', L.phone, 'tel', ' autocomplete="tel"') + '</fieldset>';
		if (codAllowed()) {
			const due = fill(o && o.logistics_type === 'HOME' ? L.codHome : L.codCvs, 'total', money(total()));
			h += '<fieldset class="st-choices"><legend>' + esc(L.pay) + '</legend>' + radio('pay', 'card', !cod, '<span class="st-opt-t">' + esc(L.card) + '</span>') + radio('pay', 'cod', cod, '<span class="st-opt-t">' + esc(L.cod) + '</span><span class="st-opt-d">' + esc(due) + '</span>') + errLine('pay') + '</fieldset>';
		}
		if (!S.invOff) {
			const sub = (kind) => {
				if (S.inv !== kind) return '';
				if (kind === 'mobile') return '<div class="st-opt-sub">' + field('mobile', L.mobileCode, 'text', ' autocapitalize="characters"') + '</div>';
				if (kind === 'citizen') return '<div class="st-opt-sub">' + field('citizen', L.citizenCode, 'text', ' autocapitalize="characters"') + '</div>';
				if (kind === 'donate') return '<div class="st-opt-sub">' + field('love', L.loveCode, 'text', ' inputmode="numeric"') + '</div>';
				if (kind === 'tax_id') return '<div class="st-opt-sub">' + field('taxid', L.taxId, 'text', ' inputmode="numeric"') + field('company', L.company, 'text', ' autocomplete="organization"') + field('companyAddress', L.companyAddress, 'text') + '</div>';
				if (kind === 'paper') return '<div class="st-opt-sub">' + field('paperName', L.name, 'text', ' autocomplete="name"') + field('paperAddress', L.address, 'text', ' autocomplete="street-address"') + '</div>';
				return '';
			};
			const inv = (kind, label, note) => radio('inv', kind, S.inv === kind, '<span class="st-opt-t">' + esc(label) + '</span>' + (note ? '<span class="st-opt-d">' + esc(note) + '</span>' : '') + sub(kind));
			// Every standard buyer choice; the paper invoice travels in the parcel, and this checkout only exists for goods that ship.
			h += '<fieldset class="st-choices"><legend>' + esc(L.invoice) + '</legend>' + inv('carrier_ecpay', L.invEcpay) + inv('mobile', L.invMobile) + inv('citizen', L.invCitizen) + inv('donate', L.invDonate) + inv('tax_id', L.invTaxId) + inv('paper', L.invPaper, L.invPaperNote) + '</fieldset>';
		}
		h += field('email', C.emailLabel, 'email', ' autocomplete="email"');
		if (S.notice) h += '<p class="st-note">' + esc(S.notice) + '</p>';
		h += '<div class="st-sum">' + (cod ? '' : '<div><span>' + esc(L.subtotal) + '</span><span>' + esc(money(C.price)) + '</span></div><div><span>' + esc(L.fee) + '</span><span>' + esc(money(fee())) + '</span></div>') + '<div class="st-sum-tot"><span>' + esc(L.total) + '</span><span>' + esc(money(total())) + '</span></div></div>';
		h += '<button class="st-runtime-action st-wide" type="button" data-ecpay-submit' + (busy ? ' disabled aria-busy="true"' : '') + '>' + esc(busy ? C.busy : (cod ? L.submitCod : L.submitCard)) + '</button>';
		h += '<p class="st-note">' + esc(cod ? L.noteCod : L.noteCard) + '</p>';
		h += '<p data-ecpay-status role="status" class="st-runtime-status"' + (S.form ? ' data-ejecta-status-tone="error"' : '') + '>' + esc(S.form) + '</p>';
		panel.innerHTML = h;
	}
	function focusFirstError() {
		const order = ['ship', 'store', 'address', 'postal', 'name', 'phone', 'pay', 'mobile', 'citizen', 'love', 'taxid', 'company', 'companyAddress', 'paperName', 'paperAddress', 'email'];
		for (const k of order) {
			if (!S.err[k]) continue;
			const el = panel.querySelector('[data-ecpay-field="' + k + '"]') || (k === 'store' ? panel.querySelector('[data-ecpay-store]') : null);
			if (el && el.focus) el.focus();
			return;
		}
	}
	function validate() {
		const err = {};
		const o = current();
		if (!o) err.ship = L.errMethod;
		else if (o.logistics_type === 'CVS') { if (!S.storeRef) err.store = L.errStore; }
		else {
			if (!val('address')) err.address = L.errAddress;
			if (val('postal') && !/^[0-9A-Za-z][0-9A-Za-z -]{1,9}$/.test(val('postal'))) err.postal = L.errPostal;
		}
		if (!val('name')) err.name = L.errName;
		if (!val('phone')) err.phone = L.errPhone;
		else if (!PHONE.test(val('phone'))) err.phone = L.errPhoneBad;
		if (!S.invOff) {
			if (S.inv === 'mobile' && !/^\/[0-9A-Z+\-.]{7}$/.test(val('mobile').toUpperCase())) err.mobile = L.errMobile;
			if (S.inv === 'citizen' && !/^[A-Z]{2}[0-9]{14}$/.test(val('citizen').toUpperCase())) err.citizen = L.errCitizen;
			if (S.inv === 'donate' && !/^[0-9]{3,7}$/.test(val('love'))) err.love = L.errLove;
			if (S.inv === 'tax_id') {
				if (!/^[0-9]{8}$/.test(val('taxid'))) err.taxid = L.errTaxId;
				if (!val('company')) err.company = L.errCompany;
				if (!val('companyAddress')) err.companyAddress = L.errCompanyAddress;
			}
			if (S.inv === 'paper') {
				if (!val('paperName') || val('paperName').length > 60) err.paperName = L.errPaperName;
				if (!val('paperAddress') || val('paperAddress').length > 100) err.paperAddress = L.errPaperAddress;
			}
		}
		if (!val('email')) err.email = C.emailRequired;
		else if (!EMAIL.test(val('email'))) err.email = C.emailInvalid;
		return err;
	}
	function invoiceBody() {
		if (S.invOff) return null;
		const email = val('email');
		if (S.inv === 'mobile') return { carrier_type: '3', carrier_number: val('mobile').toUpperCase(), email };
		if (S.inv === 'citizen') return { carrier_type: '2', carrier_number: val('citizen').toUpperCase(), email };
		if (S.inv === 'donate') return { love_code: val('love'), email };
		if (S.inv === 'tax_id') return { tax_id: val('taxid'), buyer_name: val('company'), buyer_address: val('companyAddress'), email };
		if (S.inv === 'paper') return { print: true, buyer_name: val('paperName'), buyer_address: val('paperAddress'), email };
		return { carrier_type: '1', email };
	}
	// One refusal → where it shows. Returns true when the same order should be sent again as is.
	function refusal(code, r) {
		const e = r && typeof r.error === 'string' ? r.error : '';
		const f = r && typeof r.field === 'string' ? r.field : '';
		const reason = r && typeof r.reason === 'string' ? r.reason : '';
		const err = {};
		if ((e === 'invoice_not_offered' || e === 'ecpay invoice not available') && !S.invOff) {
			S.invOff = true;
			S.notice = L.invNotOffered;
			return true;
		}
		if (e === 'invoice_love_code_unknown') err.love = L.errLoveUnknown;
		else if (e === 'invoice_love_code_unverifiable') err.love = L.errLoveUnverifiable;
		else if (f.indexOf('invoice.') === 0) {
			const paper = S.inv === 'paper';
			const k = { carrier_number: S.inv === 'citizen' ? 'citizen' : 'mobile', love_code: 'love', tax_id: 'taxid', buyer_name: paper ? 'paperName' : 'company', buyer_address: paper ? 'paperAddress' : 'companyAddress', email: 'email' }[f.slice(8)];
			const m = { mobile: L.errMobile, citizen: L.errCitizen, love: L.errLove, taxid: L.errTaxId, company: L.errCompany, companyAddress: L.errCompanyAddress, paperName: L.errPaperName, paperAddress: L.errPaperAddress, email: C.emailInvalid };
			if (k) err[k] = m[k];
		} else if (e === 'logistics_invalid') {
			if (f === 'logistics.store_ref') err.store = reason === 'store_ref_required' ? L.errStore : L.errStoreStale;
			else if (/^recipient_name/.test(reason)) err.name = L.errName;
			else if (/^recipient_phone/.test(reason)) err.phone = reason === 'recipient_phone_missing' ? L.errPhone : L.errPhoneBad;
			else if (/^recipient_address/.test(reason)) err.address = L.errAddress;
			else if (reason === 'postal_code_malformed') err.postal = L.errPostal;
			else err.ship = L.errMethod;
			if (f === 'logistics.store_ref') S.storeRef = '';
		} else if (e === 'logistics_not_opened') err.ship = L.errMethod;
		else if (/^cod_/.test(e)) err.pay = L.errCod;
		else if (e === 'customer_email_required') err.email = C.emailRequired;
		else if (e === 'customer_email_invalid') err.email = C.emailInvalid;
		else if (e === 'customer_email_conflict') err.email = C.emailConflict;
		S.err = err;
		if (!Object.keys(err).length) {
			S.form = code === 409 && r && r.code === 'rail_currency_unsupported' ? C.currencyRefused
				: code === 409 && e === 'preview_checkout_live_mode' && C.refused ? C.refused
				: code === 409 && e === 'unavailable' ? C.outOfStock
				: C.error;
		}
		return false;
	}
	async function submit(again) {
		if (busy) return;
		S.err = validate();
		S.form = '';
		if (Object.keys(S.err).length) { render(); focusFirstError(); return; }
		busy = true;
		render();
		const o = current();
		const ref = 'tile-' + uuid();
		const back = location.origin + C.completePath + '?ref=' + encodeURIComponent(ref);
		const logistics = { sub_type: o.sub_type, recipient_name: val('name'), recipient_phone: val('phone') };
		if (o.logistics_type === 'CVS') logistics.store_ref = S.storeRef;
		else { logistics.address = val('address'); if (val('postal')) logistics.postal_code = val('postal'); }
		const cod = S.pay === 'cod' && codAllowed();
		const body = { site_id: C.site, items: [{ sku: C.sku, qty: 1 }], client_request_ref: ref, client_back_url: back, logistics, customer_email: val('email') };
		const invoice = invoiceBody();
		if (invoice) body.invoice = invoice;
		if (cod) body.payment = { method: 'cod' };
		let res = null, r = null;
		try {
			res = await fetch('/api/v2/ecpay/checkout', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			r = await res.json().catch(() => null);
		} catch (e) { res = null; }
		busy = false;
		if (res && res.ok && r && typeof r.order_id === 'string' && r.order_id) {
			const kept = { order_id: r.order_id, sub_type: o.sub_type, logistics_type: o.logistics_type, fee_minor: fee(), currency: C.currency, invoice: !S.invOff };
			if (cod && r.cash_on_delivery === true) {
				Object.assign(kept, { cod: true, total_minor: total(), lines: [{ name: C.name, qty: 1, amount_minor: C.price }] });
				if (ss) try { ss.setItem('dc-native-ecpay:' + ref, JSON.stringify(kept)); } catch (e) { /* the result page falls back to the server's answer */ }
				dropDraft();
				location.assign(back);
				return;
			}
			if (r.form_post) {
				if (ss) try { ss.setItem('dc-native-ecpay:' + ref, JSON.stringify(kept)); } catch (e) { /* idem */ }
				dropDraft();
				if (postPay(r.form_post)) return;
			}
			S.form = C.error;
			render();
			return;
		}
		if (refusal(res ? res.status : 0, r) && !again) { busy = false; return submit(true); }
		render();
		focusFirstError();
	}
	async function chooseStore() {
		if (busy) return;
		const o = current();
		if (!o) return;
		saveDraft();
		busy = true;
		render();
		const device = window.matchMedia && window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'pc';
		const body = { site_id: C.site, sub_type: o.sub_type, client_back_url: location.origin + location.pathname, device };
		if (S.pay === 'cod' && codAllowed()) body.cash_on_delivery = true;
		let r = null;
		try {
			const res = await fetch('/api/v2/ecpay/logistics/store-map', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			r = res.ok ? await res.json().catch(() => null) : null;
		} catch (e) { r = null; }
		busy = false;
		if (r && r.form_post && postMap(r.form_post)) return;
		S.err = { store: L.storeMapError };
		render();
	}
	function fallBack() {
		fallen = true;
		button.removeAttribute('data-native-ecpay-sku');
		button.setAttribute('data-native-sku', C.sku);
		button.disabled = false;
		button.removeAttribute('aria-busy');
		button.textContent = C.buy;
		button.click();
	}
	async function open(fromStoreMap) {
		if (opening) return;
		opening = true;
		if (!fromStoreMap) {
			button.disabled = true;
			button.setAttribute('aria-busy', 'true');
			button.textContent = C.busy;
		}
		if (status) { status.textContent = ''; status.removeAttribute('data-ejecta-status-tone'); }
		let d = null;
		try {
			const res = await fetch('/api/v2/ecpay/logistics/delivery-options?site_id=' + encodeURIComponent(C.site) + '&items_minor=' + encodeURIComponent(String(C.price)), { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } });
			d = res.ok ? await res.json().catch(() => null) : null;
		} catch (e) { d = null; }
		opening = false;
		const list = d && d.ok === true && Array.isArray(d.options) ? d.options.filter((x) => x && typeof x.sub_type === 'string' && (x.logistics_type === 'CVS' || x.logistics_type === 'HOME')) : [];
		if (!list.length) { if (!fromStoreMap) fallBack(); return; }
		options = list;
		if (!current()) { S.ship = list[0].sub_type; S.storeRef = ''; }
		if (!codAllowed()) S.pay = 'card';
		button.hidden = true;
		button.removeAttribute('aria-busy');
		button.disabled = false;
		button.textContent = C.buy;
		const collapse = document.querySelectorAll('[data-native-ecpay-collapse]');
		for (let i = 0; i < collapse.length; i++) collapse[i].hidden = true;
		panel.hidden = false;
		render();
	}
	// Where the Site offers a payment-method choice, only the ECPay choice opens this checkout; any
	// other rail goes through the existing native checkout for one press and the control stays ours.
	const otherRail = () => {
		const holder = button.parentElement;
		const picked = holder && holder.querySelector ? holder.querySelector('[data-native-rail-choice]:checked') : null;
		return picked && typeof picked.value === 'string' && picked.value && picked.value !== 'ecpay';
	};
	// The replayed click reaches this listener again before it bubbles to the native checkout script.
	let replaying = false;
	function viaRail() {
		replaying = true;
		button.removeAttribute('data-native-ecpay-sku');
		button.setAttribute('data-native-sku', C.sku);
		try { button.click(); } finally {
			replaying = false;
			button.removeAttribute('data-native-sku');
			button.setAttribute('data-native-ecpay-sku', C.sku);
		}
	}
	button.addEventListener('click', function () { if (!replaying && !fallen && !button.disabled) { if (otherRail()) viaRail(); else open(false); } });
	panel.addEventListener('input', function (event) {
		const t = event.target;
		const k = t && t.getAttribute && t.getAttribute('data-ecpay-field');
		if (k) S.v[k] = t.value;
	});
	panel.addEventListener('change', function (event) {
		const t = event.target;
		if (!t || t.type !== 'radio') return;
		if (t.name === 'dc-ecpay-ship' && t.value !== S.ship) { S.ship = t.value; S.storeRef = ''; if (!codAllowed()) S.pay = 'card'; }
		else if (t.name === 'dc-ecpay-pay') S.pay = t.value === 'cod' ? 'cod' : 'card';
		else if (t.name === 'dc-ecpay-inv') S.inv = t.value;
		else return;
		S.err = {};
		S.form = '';
		render();
		const again = panel.querySelector('input[name="' + t.name + '"][value="' + t.value + '"]');
		if (again && again.focus) again.focus();
	});
	panel.addEventListener('click', function (event) {
		const t = event.target && event.target.closest ? event.target : null;
		if (!t) return;
		if (t.closest('[data-ecpay-store]')) { event.preventDefault(); chooseStore(); }
		else if (t.closest('[data-ecpay-submit]')) { event.preventDefault(); submit(false); }
	});
	// Back from the store map: ECPay's answer arrived as `?store_ref=`. The draft restores what the
	// buyer had typed and the store is now part of the order; the query is dropped from the address
	// bar so a reload or a shared link does not carry it.
	let returned = '';
	try { returned = new URL(location.href).searchParams.get('store_ref') || ''; } catch (e) { returned = ''; }
	if (returned) {
		readDraft();
		S.storeRef = returned;
		try { const u = new URL(location.href); u.searchParams.delete('store_ref'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* the query stays */ }
		open(true);
	}
}

function nativeEcpayCheckoutScript(cfg, shop, item, mapped, copy, locale, preview) {
	const data = {
		site: cfg.siteId || '',
		sku: mapped.sku,
		name: mapped.name,
		price: Number(mapped.price_minor),
		currency: String(mapped.currency).toUpperCase(),
		locale,
		completePath: shop.shopPath + '/complete',
		labels: NATIVE_ECPAY_COPY[locale],
		subtypes: NATIVE_ECPAY_SUBTYPES[locale],
		buy: copy.buy,
		busy: copy.checkoutBusy,
		error: copy.checkoutError,
		outOfStock: copy.outOfStock,
		currencyRefused: copy.currencyRefused,
		emailLabel: copy.emailLabel,
		emailRequired: copy.emailRequired,
		emailInvalid: copy.emailInvalid,
		emailConflict: copy.emailConflict,
		refused: preview ? copy.previewLiveRefused : ''
	};
	const json = JSON.stringify(data).replace(/</g, '\\u003c');
	const launcher = (origins) => `(function(){const T=${JSON.stringify(origins)};${NATIVE_FORM_POST_SOURCE}return post})()`;
	return `<script>(${nativeEcpayCheckoutClient.toString()})(${json},${launcher(NATIVE_ECPAY_PAY_ORIGINS)},${launcher(NATIVE_ECPAY_MAP_ORIGINS)},${completionFormatMoneySource()});</script>`;
}

function nativeProductBody(item, shop, copy, locale, preview, cfg) {
	const mapped = nativeCatalogItem(item);
	// Same wrap as nativeUnavailable() above — nativeUnavailableBody() itself is untouched.
	if (!mapped) return `<div class="st-runtime">${nativeUnavailableBody(copy)}</div>`;
	const itemCopy = item.copy || {};
	const description = String(itemCopy.description_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	// Neither `dc-native-product`'s class attribute nor the price `<p>` is pinned by an exact string
	// anywhere in the suite (storefront-source-routing.test.mjs only pins the Buy control, the
	// unavailable/not-found bodies and the price paragraph's OWN bytes, not this article's class or
	// its siblings), so `st-runtime`/`st-native-detail` ride straight on the existing root instead
	// of an extra wrapper element. The Buy button + status stay each other's siblings inside the new
	// `.st-native-actions` div, which is what nativeCheckoutScript's
	// `button.parentElement.querySelector('[data-native-status]')` requires — it does not require
	// that parent to be the `<article>` itself.
	const refused = nativeItemRefused(mapped, preview);
	// The in-page ECPay checkout (above) changes this product's markup only: the Buy control's
	// marker, a collapse marker on the image and description, an empty panel and its script. Every
	// other product's bytes are exactly the line below the branch. A product that names a single payment rail
	// (`checkout_rail`) keeps the rail-aware flow; one offering a rail choice takes this branch only when
	// ECPay is among the rails, and then the radios sit beside the control and only the ECPay choice opens it.
	if (cfg && cfg.siteId && !mapped.checkoutRail && (!mapped.checkoutRails.length || mapped.checkoutRails.includes('ecpay')) && nativeEcpayEligible(item, mapped, refused)) {
		return `<article data-storefront-source="native" class="dc-native-product st-runtime st-native-detail"><p data-native-ecpay-collapse><a href="${escHtml(shop.shopPath)}">${escHtml(copy.shop)}</a></p>${nativePreviewNotice(copy, preview)}<h1>${escHtml(mapped.name)}</h1>${mapped.image_url ? `<img class="st-img" src="${escHtml(mapped.image_url)}" alt="${escHtml(mapped.name)}" data-native-ecpay-collapse>` : ''}<p class="st-native-price">${escHtml(formatMoney({ minor: mapped.price_minor, currency: mapped.currency, locale }))}</p>${description ? `<p data-native-ecpay-collapse>${escHtml(description)}</p>` : ''}<div class="st-native-actions">${nativeRailChoice(mapped, copy, false)}${nativeEcpayBuyControl(mapped, copy)}${nativeStatusNode(copy, false)}</div><section class="st-native-checkout" data-native-ecpay-checkout aria-label="${escHtml(copy.buy)}" hidden></section></article>${nativeCheckoutScript(copy, preview, mapped.checkoutRails.length > 0, mapped.checkoutRails.length > 0)}${nativeEcpayCheckoutScript(cfg, shop, item, mapped, copy, locale, preview)}`;
	}
	return `<article data-storefront-source="native" class="dc-native-product st-runtime st-native-detail"><p><a href="${escHtml(shop.shopPath)}">${escHtml(copy.shop)}</a></p>${nativePreviewNotice(copy, preview)}<h1>${escHtml(mapped.name)}</h1>${mapped.image_url ? `<img class="st-img" src="${escHtml(mapped.image_url)}" alt="${escHtml(mapped.name)}">` : ''}<p>${escHtml(formatMoney({ minor: mapped.price_minor, currency: mapped.currency, locale }))}</p>${description ? `<p>${escHtml(description)}</p>` : ''}<div class="st-native-actions">${nativeRailChoice(mapped, copy, refused)}${nativeBuyControl(mapped, copy, refused)}${nativeStatusNode(copy, refused)}</div></article>${nativeCheckoutScript(copy, preview, !!mapped.checkoutRail || mapped.checkoutRails.length > 0, mapped.checkoutRails.length > 0)}`;
}

// 🔴 whole-<main> replacement — see nativeUnavailable()'s note just above: native has no author
// coral div to preserve today.
async function renderNativeGridPage(request, env, cfg, shop, ctx) {
	const origin = new URL(request.url).origin;
	const [projection, shellRes] = await Promise.all([
		fetchNativeProjection(request, env, cfg, undefined, ctx),
		env.ASSETS.fetch(new Request(origin + shop.shopPath + '/', request))
	]);
	if (!shellRes.ok) return htmlResponse(nativeUnavailableDocument(), 503);
	const shell = await shellRes.text();
	const locale = nativeLocale(shell);
	const copy = NATIVE_COPY[locale];
	if (projection.kind !== 'ok') return htmlResponse(nativeUnavailable(shell, copy), 503);
	const items = Array.isArray(projection.body.items) ? projection.body.items.map(nativeCatalogItem).filter(Boolean) : null;
	if (!items) return htmlResponse(nativeUnavailable(shell, copy), 503);
	// `dc-native-grid`'s class attribute, the card `<article>` and `[data-native-status]`'s own class
	// are not pinned anywhere in the suite (only `data-storefront-source`, the Buy control and the
	// unavailable/not-found bodies are), so presentation classes ride straight onto the existing
	// markup instead of a new wrapper.
	const preview = nativePreviewCheckout(projection.body);
	const cards = items.map((item) => `<article class="st-cell st-native-card"><a href="${escHtml(shop.shopPath + '/' + encodeURIComponent(item.slug || ''))}">${item.image_url ? `<img class="st-img" src="${escHtml(item.image_url)}" alt="${escHtml(item.name)}">` : ''}<h2>${escHtml(item.name)}</h2><p>${escHtml(formatMoney({ minor: item.price_minor, currency: item.currency, locale }))}</p></a>${nativeRailChoice(item, copy, nativeItemRefused(item, preview))}${nativeBuyControl(item, copy, nativeItemRefused(item, preview))}${nativeStatusNode(copy, nativeItemRefused(item, preview))}</article>`).join('');
	return htmlResponse(replaceMain(shell, `<section data-storefront-source="native" class="dc-native-grid st-runtime">${nativePreviewNotice(copy, preview)}${cards ? `<div class="st-cells">${cards}</div>` : `<p class="st-runtime-status">${escHtml(copy.empty)}</p>`}</section>${nativeCheckoutScript(copy, preview, items.some((item) => !!item.checkoutRail || item.checkoutRails.length > 0), items.some((item) => item.checkoutRails.length > 0))}`));
}

// 🔴 whole-<main> replacement — see nativeUnavailable()'s note above: native has no author
// coral div to preserve today.
async function renderNativeProduct(request, env, cfg, match, ctx) {
	const origin = new URL(request.url).origin;
	const [projection, shellRes] = await Promise.all([
		fetchNativeProjection(request, env, cfg, match.slug, ctx),
		env.ASSETS.fetch(new Request(origin + match.shop.shopPath + '/', request))
	]);
	if (!shellRes.ok) return htmlResponse(nativeUnavailableDocument(), 503);
	const shell = await shellRes.text();
	const locale = nativeLocale(shell);
	const copy = NATIVE_COPY[locale];
	// This body's own bytes are not pinned, but the wrapper stays a DIV per the same convention as
	// nativeUnavailable() above rather than promoting the section to `st-…`, since the generic
	// section floor keys off a LEADING `st-` class token this section deliberately keeps clear of.
	if (projection.kind === 'not_found') return htmlResponse(replaceMain(shell, `<div class="st-runtime"><section data-storefront-source="native" data-storefront-state="not-found"><h1>${escHtml(copy.notFound)}</h1></section></div>`), 404);
	if (projection.kind !== 'ok') return htmlResponse(nativeUnavailable(shell, copy), 503);
	return htmlResponse(replaceMain(shell, nativeProductBody(projection.body.item, match.shop, copy, locale, nativePreviewCheckout(projection.body), cfg)));
}

// Resolve the selected provider's catalog list — same same-origin-first,
// apiBase-fallback strategy as fetchProductJson, and the same HTML guard.
async function fetchCatalogList(origin, apiBase, locator, rail) {
	// The rail is explicit: a selected provider's empty or failed catalog must
	// not consult another provider.
	const path = `/api/v2/shop/catalog?${locator}&payment_rail=${encodeURIComponent(rail)}`;
	try {
		const r = await fetch(origin + path, { headers: { Accept: 'application/json' } });
		const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
		if (r.ok && !/html/i.test(ct)) { const d = await r.json().catch(() => null); if (d) return d; }
	} catch (e) { /* fall through */ }
	try {
		const r = await fetch(apiBase + path, { headers: { Accept: 'application/json' } });
		if (r.ok) return await r.json().catch(() => null);
	} catch (e) { /* give up → caller serves static */ }
	return null;
}

// Edge-SSR the selected provider's /shop grid into the built shell. The site
// is the OWNER'S — this mounts INTO their built page, it never replaces it.
// When the author's own [data-dynamic-coral="square-shop"] div is on the
// page, only THAT div is touched (rail pinned, grid injected); everything
// else the author built — intro copy, category buttons, nav — rides through
// untouched. Only a shell with NO coral div at all (a bare compatibility page
// that never had one) falls back to the old whole-<main> replacement, because
// there is nothing of the owner's there to preserve.
async function renderGridPage(request, env, ctx, cfg, shop) {
	const url = new URL(request.url);
	const origin = url.origin;
	let cache = edgeCache();
	const cacheKey = cache ? new Request(origin + url.pathname) : null;
	if (cache) { const looked = await edgeCacheLookup(cache, cacheKey); cache = looked.cache; if (looked.hit) return looked.hit; }

	let shellRes;
	try {
		shellRes = await env.ASSETS.fetch(new Request(origin + shop.shopPath + '/', request));
		if (!shellRes.ok) throw new Error('shell unavailable');
		const donorShell = await shellRes.text();
		const authorCoral = parseCoralDiv(donorShell);
		let shell;
		if (authorCoral) {
			const pinnedTag = pinCoralRail(authorCoral.tag, cfg, shop);
			const mountScripts = providerRailScopeScript(shop.provider) +
				(hasSquareShopModule(donorShell) ? '' : '<script type="module" src="/corals/square-shop/v0/square-shop.js"></script>');
			shell = donorShell.replace(authorCoral.tag, pinnedTag + mountScripts);
		} else {
			shell = replaceMain(donorShell, providerMount(cfg, shop));
		}
		const data = await fetchCatalogList(origin, cfg.apiBase, shopLocatorParam(cfg), shop.provider);
		const coral = parseCoralDiv(shell);
		const items = data && (Array.isArray(data) ? data : (data.items || data.catalog));
		// An unavailable selected provider keeps its own mounted, rail-scoped state.
		// It never resurrects the donor's raw/v0 coral and never asks another rail.
		if (!coral || !Array.isArray(items) || items.length === 0) return htmlResponse(shell);

		const { gridHtml, gridCss } = renderShopGrid(items, {
			cart: coral.cart, noSidebar: coral.noSidebar, detailBase: coral.detailBase, labels: coral.labels, locale: coral.locale,
			dynamicCoralCss: cfg.dynamicCoralCss
		});
		let body = injectHead(shell, `<style>${gridCss}</style>`);
		body = injectCoralGrid(body, coral.tag, gridHtml);
		const res = htmlResponse(body);
		if (cache && ctx && ctx.waitUntil) ctx.waitUntil(edgeCachePut(cache, cacheKey, res.clone()));
		return res;
	} catch (e) {
		return htmlResponse('<!doctype html><main><section data-storefront-source="provider" data-storefront-state="unavailable"><h1>Storefront unavailable</h1><p>Please try again later.</p></section></main>', 503);
	}
}

// ─── SAME-ORIGIN INBOX FORWARDER ──────────────────────────────────────────────
// `POST /__reef/inbox` — where sitetile's `form` coral posts when authored with
// `action=inbox` (see Form.astro). A plain `<form>` cannot POST straight to the
// platform: feelreef is a SvelteKit app and SvelteKit refuses any cross-origin
// POST carrying a form content type, app-wide, before routing — measured live
// 2026-08-15. This worker is the same-origin stand-in: the browser posts here,
// this relays it server-to-server (no browser same-origin policy applies to a
// Worker's own outbound fetch), and redirects the browser back to the page.
//
// Baked into EVERY emitted worker — not gated on any shop/contract flag — so
// the route exists on a plain site too. `CFG.platformOrigin` is always present
// (emit-shop-function.mjs defaults it to https://feelreef.com when
// --platform-origin is not given), so a build that has not started passing the
// flag yet still serves a working route instead of a 404.

const INBOX_RESERVED_FIELDS = new Set([
	'kind', 'id', 'text', 'conversation_id', 'page_url', 'return_to', 'thanks_to', '_hp',
	'visitor_email', 'email_field', 'return_fragment'
]);

// Trusted as a redirect target only when it is unambiguously a path on THIS site: a leading
// slash, not a network-path reference, and no `..` segment. Shared by `return_to` (posted on
// every inbox submission) and `thanks_to` (opt-in, the form coral's `thanks=`)
// — same rule, same function, so hardening it once protects both.
//
// This is a DIAGNOSTIC gate on the raw, as-posted string — the actual boundary is the
// result-side check in `inboxRedirectResponse` below, which looks at what a URL parser
// resolves the value TO, not at how the value is spelled. Two things this gate strips or
// rejects up front so it stays roughly in step with that resolved value (same technique as
// `isSafeImageSrc` in site-core.js):
//
// * ASCII tab/LF/CR, wherever they sit — a URL parser drops these before it resolves anything,
//   so their presence in the raw string tells this gate nothing about the resolved path.
// * A browser resolves `\` exactly like `/`, so `/\evil.example` is a network-path reference
//   wearing one slash, not two — normalise backslashes to slashes so a plain `startsWith('//')`
//   test cannot be dodged by spelling the second slash as a backslash.
//
// What this gate CANNOT see: a leading single-dot path segment (`.`, or a percent-encoded
// spelling of one) is also removed by a URL parser before it resolves, and can turn one literal
// leading slash into a resolved path that begins with two — this gate has no literal `//` at
// position 0 to catch, and no `..` in the raw string to reject. That class is why the result-side
// check exists; it does not depend on this gate anticipating every parser normalisation rule.
//
// A `..` segment is rejected on the raw path (before `?`/`#`), not left to a resolver to quietly
// walk away.
const RE_DOTDOT_SEGMENT = /(^|\/)\.\.(?:\/|$)/;
function isSiteRelativePath(value) {
	if (typeof value !== 'string' || value === '') return false;
	const v = value.replace(/[\u0009\u000a\u000d]/g, '').replace(/\\/g, '/');
	if (!v.startsWith('/') || v.startsWith('//')) return false;
	return !RE_DOTDOT_SEGMENT.test(v.split(/[?#]/, 1)[0]);
}

// Parses `value` against `origin` and returns the URL only if it resolved to
// the SAME origin — used for both the Referer check and the return_to check
// (return_to is additionally required to look site-relative by the caller, so
// a scheme smuggled past the leading slash can't parse into this origin).
function sameOriginUrl(value, origin) {
	if (!value) return null;
	try {
		const u = new URL(value, origin);
		return u.origin === origin ? u : null;
	} catch (e) {
		return null;
	}
}

// return_to (posted, must be site-relative) → the Referer's own path (only if
// same-origin) → '/'. Same order for every outcome — sent, refused, or
// unavailable — so the honeypot short-circuit lands the visitor exactly where a
// real send would have.
function resolveInboxReturnPath(returnTo, referer, origin) {
	if (isSiteRelativePath(returnTo)) return returnTo;
	const ref = sameOriginUrl(referer, origin);
	if (ref) return ref.pathname + ref.search + ref.hash;
	return '/';
}

// 303 back to the site with `?inbox=<outcome>` appended (replacing any the page
// already carried, so re-submitting never stacks the param).
//
// `returnPath` reaches here already passed by `isSiteRelativePath` (directly, or via
// `resolveInboxReturnPath`) — but that gate reads the RAW string, and a URL parser can resolve a
// raw string it admitted into a Location that leaves the site. Two ways that happens even with
// the control-character stripping `isSiteRelativePath` now also does: a leading single-dot path
// segment (`.`, or a percent-encoded spelling of one) is removed by the parser before it
// resolves, and any control character the gate's stripping missed would be too — either can turn
// one literal leading slash into a RESOLVED path that begins with two, and a `Location` beginning
// with `//` is a network-path reference: a browser reads it as a host, not a path. So this
// function checks the one thing that actually matters — the RESOLVED value the header will
// carry — rather than trying to keep pace with every normalisation rule a URL parser has: the
// origin must still be this placeholder site origin (an absolute URL smuggled past the leading
// slash resolves to some OTHER origin, caught the same way), and the resolved pathname must not
// start with `//`. Either failing falls back to the site root, never to the untrusted value.
const REDIRECT_BASE = 'http://site.invalid';

// Match reef's inbox boundary exactly: only the renderer's bounded, ordered table
// can select a refusal paragraph. Never use the posted string itself as a hash.
function inboxReturnFragment(raw, outcome) {
	if (outcome !== 'inbox_storage_full' && outcome !== 'not_claimed') return '';
	if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > 128) return '';
	const match = /^\{"inbox_storage_full":"(inbox-storage-full-(?:0|[1-9][0-9]{0,3}))","not_claimed":"(inbox-not-claimed-(?:0|[1-9][0-9]{0,3}))"\}$/.exec(raw);
	if (!match) return '';
	const id = match[outcome === 'inbox_storage_full' ? 1 : 2];
	return /^inbox-(storage-full|not-claimed)-(0|[1-9][0-9]{0,3})$/.test(id) ? id : '';
}

function inboxRedirectResponse(returnPath, outcome, returnFragment) {
	let url;
	try {
		url = new URL(returnPath, REDIRECT_BASE);
	} catch (e) {
		url = new URL('/', REDIRECT_BASE);
	}
	if (url.origin !== REDIRECT_BASE || url.pathname.startsWith('//')) {
		url = new URL('/', REDIRECT_BASE);
	}
	url.searchParams.set('inbox', outcome);
	const fragment = inboxReturnFragment(returnFragment, outcome);
	if (fragment) url.hash = fragment;
	return new Response(null, { status: 303, headers: { location: url.pathname + url.search + url.hash } });
}

// ── /_yt/<id>.jpg — a YouTube line's poster, relayed (tile#148) ─────────────────────────
// sitetile renders a paragraph that is only a YouTube link as a click-to-play block whose poster is
// THIS path (cardtile/yt.mjs posterPath), never i.ytimg.com: a Google-hosted poster in the markup
// would have every visitor's browser report to Google on page load — the exact thing click-to-play
// exists to prevent. The same relay as the Card Worker's /_yt/ (cardtile/serve/card-worker.mjs):
//   · the id is held to the 11-character video shape (cardtile's VIDEO_RE) BY THE ROUTE PATTERN,
//     before it is ever part of a URL — without that this is an open proxy;
//   · only an image type is relayed (never SVG, never a transient text/html);
//   · only a response that passed that check is cached (caches.default, keyed on this request's
//     origin + path — NOT its query: the route reads the path only, so `?1`, `?2`, … would each be
//     a miss, an upstream fetch and a cache entry for one and the same poster — tile#150 L3), so a
//     bad upstream moment is never kept;
//   · a miss is a 404 with no-store — the block is designed to look like an unopened video
//     without its poster, so a missing poster costs a picture and nothing else.
const YT_POSTER_PATH = /^\/_yt\/([A-Za-z0-9_-]{11})\.jpg$/;
const YT_POSTER_TYPES = ['image/jpeg', 'image/webp', 'image/png'];
const ytPosterMiss = () => new Response('', { status: 404, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
async function relayYoutubePoster(request, ctx, id) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' } });
	}
	let cache = edgeCache();
	const at = new URL(request.url);
	const key = new Request(at.origin + at.pathname, { method: 'GET' });
	if (cache) {
		const looked = await edgeCacheLookup(cache, key);
		cache = looked.cache;
		if (looked.hit) return looked.hit;
	}
	const up = await fetch('https://i.ytimg.com/vi/' + id + '/hqdefault.jpg').catch(() => null);
	if (!up || !up.ok) return ytPosterMiss();
	const type = String(up.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	if (!YT_POSTER_TYPES.includes(type)) return ytPosterMiss();
	const resp = new Response(up.body, {
		headers: { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=86400' }
	});
	if (cache) {
		const put = edgeCachePut(cache, key, resp.clone());
		if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put); else await put;
	}
	return resp;
}

async function handleInboxForward(request, CFG) {
	if (request.method !== 'POST') {
		return new Response('Method Not Allowed', {
			status: 405,
			headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const origin = new URL(request.url).origin;
	const referer = request.headers.get('referer') || '';

	// Both content types the coral (and any hand-authored form) can send —
	// application/x-www-form-urlencoded and multipart/form-data — parse through
	// the same Workers Request.formData(). Anything else fails to parse; treated
	// as an empty submission rather than a crash, same as a bot that sends
	// nothing usable.
	let form = null;
	try { form = await request.formData(); } catch (e) { form = null; }
	const raw = {};
	if (form) {
		for (const [key, value] of form.entries()) {
			if (typeof value === 'string') raw[key] = value; // a File entry is never a field's text value
		}
	}

	const returnPath = resolveInboxReturnPath(raw.return_to, referer, origin);
	// `thanks_to` (opt-in): posted by the coral, already validated once at
	// build time (site-core.js's `safeInternalPath`, when the author wrote `thanks=`) — but a
	// hidden field is still something a visitor's own browser tooling can edit before the
	// request leaves it, so that build-time check buys nothing at THIS boundary on its own.
	// Re-validated here with the same internal-path rule (`isSiteRelativePath`, shared with
	// `return_to` above) before it is ever allowed to become a redirect target. Absent or
	// invalid → `null`, and every SUCCESS path below falls back to `returnPath` — the exact
	// behaviour with no `thanks=` at all.
	const thanksPath = isSiteRelativePath(raw.thanks_to) ? raw.thanks_to : null;

	// Honeypot: a real visitor never sees or tabs to this field, so it stays
	// empty; a bot's autofill still finds and fills it. Behave EXACTLY as a
	// normal successful send — no signal that tells the bot it was caught — and
	// never spend the platform's inbox call on it.
	if (raw._hp) return inboxRedirectResponse(thanksPath || returnPath, 'sent');

	const fields = {};
	for (const key of Object.keys(raw)) {
		if (INBOX_RESERVED_FIELDS.has(key)) continue;
		fields[key] = raw[key];
	}
	// The coral wires its `{email}` field to `visitor_email`; `email_field` is
	// the same slot under the other reserved name, for anything that posts here
	// without going through the coral. Either lifts into the top-level field —
	// neither is ever also forwarded as a plain message field (both are reserved
	// names, excluded above).
	const visitorEmail = raw.visitor_email || raw.email_field || undefined;

	const refUrl = sameOriginUrl(referer, origin);
	const pageUrl = refUrl ? referer : origin + (typeof raw.return_to === 'string' ? raw.return_to : '');

	const payload = {
		kind: 'site',
		id: CFG.siteId || CFG.guildId || '',
		fields,
		...(visitorEmail ? { visitor_email: visitorEmail } : {}),
		page_url: pageUrl,
		_hp: ''
	};

	const platformOrigin = CFG.platformOrigin || 'https://feelreef.com';
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8000);
	try {
		// Start fresh: visitor-supplied forwarding headers and cookies are untrusted.
		const headers = { 'content-type': 'application/json' };
		if (CFG.inboxForwardKey) {
			const ts = String(Math.floor(Date.now() / 1000));
			const ip = (request.headers.get('cf-connecting-ip') || '').trim();
			const encoder = new TextEncoder();
			// The hexadecimal per-site key is UTF-8 text, not decoded key bytes.
			const key = await crypto.subtle.importKey('raw', encoder.encode(CFG.inboxForwardKey),
				{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
			const signature = await crypto.subtle.sign('HMAC', key,
				encoder.encode('site:' + payload.id + '\n' + ip + '\n' + ts));
			headers['x-reef-forward-ts'] = ts;
			headers['x-reef-forward-sig'] = Array.from(new Uint8Array(signature),
				(byte) => byte.toString(16).padStart(2, '0')).join('');
			if (ip) headers['x-reef-visitor-ip'] = ip;
		}
		const res = await fetch(platformOrigin + '/api/inbox', {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			credentials: 'omit',
			signal: controller.signal
		});
		if (res.ok) return inboxRedirectResponse(thanksPath || returnPath, 'sent');
		// Every FAILURE outcome — a non-2xx reason, a network error, the timeout below — stays on
		// `returnPath`, never `thanksPath`: `thanks=` names a page that makes sense as the landing
		// spot for a message that WENT somewhere, not for a retry. This is also what keeps the
		// inline retry error above the submit button working unchanged with `thanks=` set — it
		// reads `?inbox=<outcome>` off THIS page, which a failure still returns to.
		let reason = 'error';
		try {
			const body = await res.json();
			if (body && typeof body.reason === 'string' && body.reason) reason = body.reason;
		} catch (e) { /* non-JSON error body → the generic reason stands */ }
		return inboxRedirectResponse(returnPath, reason, raw.return_fragment);
	} catch (e) {
		// network failure OR the 8s AbortController timeout above — indistinguishable
		// to the visitor, and both mean the platform could not be reached in time.
		return inboxRedirectResponse(returnPath, 'unavailable');
	} finally {
		clearTimeout(timeout);
	}
}

// ─── SAME-ORIGIN API TRANSPORT ────────────────────────────────────────────────
// The site is static; every dynamic buyer capability (member sign-in,
// /membership, /account, the post-payment return addresses, the island script,
// the whole /api/* surface) lives in RSP. The island calls them on RELATIVE
// paths, so they must be answered on the site's own origin — which this worker
// does by handing the request, untouched, to the RSP service binding.
//
// The path set, the binding's name and what to answer when the binding is
// absent all come from site-api-transport.contract.json, baked in at emit time
// (CFG.apiTransport). Nothing below restates any of those values: a rule the
// contract adds or removes changes this worker's behaviour with no code change,
// and there is no second place for the two to drift apart.

function pathMatchesRule(rule, pathname) {
	return rule.match === 'exact' ? pathname === rule.value : pathname.startsWith(rule.value);
}

// A forward rule matches on path AND method. `prefix` compares the whole prefix
// INCLUDING its trailing slash, so /apix can never enter the binding on the
// strength of /api/ — the two differ at the character the prefix ends on.
function matchForwardRule(rules, pathname, method) {
	for (const rule of rules || []) {
		if (!pathMatchesRule(rule, pathname)) continue;
		if ((rule.methods || []).indexOf(method) === -1) continue;
		return rule;
	}
	return null;
}

// The verdict bucket matches on PATH ALONE — deliberately unlike forward. The
// gate exists to stop paid content leaving this origin, so a verb the contract
// did not enumerate must still be judged rather than waved through to ASSETS.
function matchVerdictRule(rules, pathname) {
	const normalized = normalizeVerdictPath(pathname);
	for (const rule of rules || []) {
		if (pathMatchesRule(rule, normalized)) return rule;
	}
	return null;
}

// The renderer emits one canonical path, while Pages may hand the worker an equivalent spelling:
// an encoded separator, the directory spelling, or the explicit index file. Decode only encoded
// separators before consulting the generated set; the original request still goes to ASSETS after
// an allow, so static serving keeps its normal alias behavior. Malformed and unrelated escapes
// remain unmatched site paths.
function normalizeVerdictPath(pathname) {
	let normalized = pathname.replace(/%2f/gi, '/');
	if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
	if (normalized.endsWith('/index.html')) normalized = normalized.slice(0, -'/index.html'.length) || '/';
	return normalized;
}

function transportJsonResponse(payload, status, cacheControl) {
	return new Response(JSON.stringify(payload), {
		status: status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cacheControl }
	});
}

// The Pages project exists but its service binding was never set. Status and
// cache-control are the contract's own onBindingMissing values — never a literal
// here, so the site and the contract cannot answer differently.
function bindingMissingResponse(transport) {
	return transportJsonResponse({ error: 'rsp_binding_missing', binding: transport.bindingName },
		transport.onBindingMissing.status, transport.onBindingMissing.cacheControl);
}

// Could not ASK. The binding is wired but the verdict call threw, answered
// non-2xx, or answered something unparseable. Distinct from both the
// binding-missing status above and the refusal below, so a single response tells
// you which of the three gates you are looking at.
function verdictUnavailableResponse() {
	return transportJsonResponse({ error: 'site_verdict_unavailable' }, 502, 'private, no-store');
}

// A generated gated path cannot safely fall through when the binding was never wired. This is
// distinct from a wired binding that failed to answer, and from a membership refusal.
function verdictBindingMissingResponse() {
	return transportJsonResponse({ error: 'site_verdict_binding_missing' }, 503, 'private, no-store');
}

// The answer was NO. Nothing of the gated file, and no part of RSP's override,
// travels with a refusal.
function verdictBlockedResponse() {
	return transportJsonResponse({ error: 'blocked' }, 404, 'private, no-store');
}

// ─── GONE PAGES: CF PAGES' PRESERVED COPY ─────────────────────────────────────
// Pages' asset server keeps every asset it has served in a cache keyed by request URL
// alone (no deployment), and when a later deployment no longer has the file it answers
// that URL with the preserved copy: a 200 carrying exactly this cache-control (and
// `x-robots-tag: noindex`). A page the owner took off therefore kept answering 200 with
// the old body for up to 7 days. A real miss is a 404 with `no-store`, never this value,
// and no page of the site is ever built with it, so seeing it means "gone".
const PAGES_PRESERVED_COPY_CACHE_CONTROL = 'public, s-maxage=604800';

// The one place a visitor's answer is checked, whichever branch produced it (the static
// fall-through, the markdown-negotiated page, a verdict-allowed file). Anything else is
// returned untouched (the same Response object); a preserved copy is answered as the
// not-found it is, uncacheable like Pages' own 404. Shell-donor fetches are not visitor
// answers (their bytes are only the chrome of a page this worker renders) and stay as they are.
function withoutPreservedCopy(request, res) {
	if (res && res.status === 200 && res.headers.get('cache-control') === PAGES_PRESERVED_COPY_CACHE_CONTROL) {
		return new Response(request.method === 'HEAD' ? null : 'Not found', {
			status: 404,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
		});
	}
	return res;
}

// A renderer-generated private-post path: the BYTES are this site's own build output,
// the PAYWALL is RSP's. The path is not inferred here; it entered this branch only because
// the renderer put its exact canonical URL in the generated manifest.
//
// 🔴 FAIL-CLOSED at every step. Anything that is not an explicit `allow: true`
// blocks — a paywall that opens when it cannot reach its authority is not a
// paywall.
async function serveVerdictGatedPath(request, env, binding, transport, pathname) {
	let verdict = null;
	try {
		const verdictUrl = new URL(transport.verdictEndpoint.path, new URL(request.url).origin);
		verdictUrl.searchParams.set(transport.verdictEndpoint.param, pathname);
		// The caller's own headers ride along (that is how RSP sees the real
		// viewer's session); nothing is added to them.
		const res = await binding.fetch(new Request(verdictUrl.toString(), { method: 'GET', headers: request.headers }));
		if (res && res.ok) verdict = await res.json();
	} catch (e) {
		verdict = null;
	}
	if (!verdict || typeof verdict !== 'object') return verdictRefusal(request, env, transport, 'retry', verdictUnavailableResponse());
	if (verdict.allow !== true) {
		const state = verdict.reason === 'membership_pending' ? 'pending'
			: verdict.reason === 'undecidable' ? 'retry' : 'members-only';
		return verdictRefusal(request, env, transport, state, verdictBlockedResponse(), binding);
	}
	return env.ASSETS.fetch(request);
}

// ─── GATED-PATH REFUSAL PAGE ──────────────────────────────────────────────────
// A browser that is refused a gated path sees the site's own page, not JSON. Only a
// request whose Accept names text/html is offered it; every other caller, and every
// case where the site's shell cannot be composed into, gets exactly the JSON
// refusal passed in (status and cache-control are that response's, never new ones).
// The gated file is never fetched: only the root shell is.
function acceptsHtml(request) {
	for (const part of (request.headers.get('accept') || '').split(',')) {
		const [type, ...params] = part.split(';');
		if (type.trim().toLowerCase() !== 'text/html') continue;
		const q = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith('q='));
		const weight = q === undefined ? 1 : Number(q.slice(2));
		if (Number.isFinite(weight) && weight > 0) return true;
	}
	return false;
}

// Sign-in and join links come from the contract's site-owned buyer pages by kind;
// a contract without that entry simply has no such link.
function buyerPageLinkPath(transport, kind) {
	const routes = Array.isArray(transport.siteOwnedBuyerPages) ? transport.siteOwnedBuyerPages : [];
	const route = routes.find((r) => r && r.kind === kind && r.method === 'GET' && typeof r.path === 'string');
	return route ? route.path : '';
}

function verdictRefusalBody(state, copy, transport, selfHref, signedIn) {
	const link = (href, label) => `<a class="st-runtime-action" href="${escHtml(href)}">${escHtml(label)}</a>`;
	let title, text, links;
	if (state === 'pending') {
		title = copy.gatePendingTitle; text = copy.gatePendingBody; links = [link(selfHref, copy.gateReload)];
	} else if (state === 'retry') {
		title = copy.gateRetryTitle; text = copy.gateRetryBody; links = [link(selfHref, copy.gateRetry)];
	} else {
		title = copy.gateMembersTitle; text = signedIn ? copy.gateMembersSignedInBody : copy.gateMembersBody; links = [];
		const account = buyerPageLinkPath(transport, 'account');
		const membership = buyerPageLinkPath(transport, 'membership');
		if (account && !signedIn) links.push(link(account, copy.signIn));
		if (membership) links.push(link(membership, copy.subscribe));
	}
	return `<section class="st-runtime" data-ejecta-gate="" data-ejecta-gate-state="${state}">
<h1>${escHtml(title)}</h1>
<p class="st-runtime-status" role="status">${escHtml(text)}</p>
${links.length ? '<p>' + links.join(' ') + '</p>\n' : ''}</section>`;
}

// Whether the refused reader already has a session, asked of the account page's own
// facts (same binding, same visitor headers). Fail-safe: anything but an explicit
// boolean true — no binding, no account page, a failed or slow read — is "not signed in",
// which keeps the sign-in copy.
async function readerIsSignedIn(request, binding, transport) {
	if (!binding) return false;
	const routes = Array.isArray(transport.siteOwnedBuyerPages) ? transport.siteOwnedBuyerPages : [];
	const route = routes.find((r) => r && r.kind === 'account' && r.method === 'GET' && typeof r.factsPath === 'string');
	if (!route) return false;
	let timer;
	try {
		const origin = new URL(request.url).origin;
		const facts = await Promise.race([
			readBuyerPageFacts(request, binding, transport, origin + route.factsPath),
			new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2000); })
		]);
		return !!(facts && facts.ok && facts.data && facts.data.signed_in === true);
	} catch (e) {
		return false;
	} finally {
		clearTimeout(timer);
	}
}

async function verdictRefusal(request, env, transport, state, jsonResponse, binding) {
	if (!acceptsHtml(request)) return jsonResponse;
	try {
		const url = new URL(request.url);
		// A root that is itself gated is not a shell to borrow.
		if (matchVerdictRule(transport.verdict, '/')) return jsonResponse;
		const shellRes = await env.ASSETS.fetch(new Request(url.origin + '/'));
		if (!shellRes || !shellRes.ok) return jsonResponse;
		const shell = await shellRes.text();
		const copy = BUYER_PAGE_COPY[localeFromHint(shellLang(shell))];
		const title = state === 'members-only' ? copy.gateMembersTitle : state === 'pending' ? copy.gatePendingTitle : copy.gateRetryTitle;
		const head = injectHead(stripDonorHead(shell), `<title>${escHtml(title)}</title><meta name="robots" content="noindex">`);
		const signedIn = state === 'members-only' ? await readerIsSignedIn(request, binding, transport) : false;
		const composed = replaceMain(head, verdictRefusalBody(state, copy, transport, url.pathname + url.search, signedIn));
		if (composed === head) return jsonResponse;
		return new Response(composed, {
			status: jsonResponse.status,
			headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': jsonResponse.headers.get('cache-control') }
		});
	} catch (e) {
		return jsonResponse;
	}
}

// ─── PUBLIC MARKDOWN NEGOTIATION ──────────────────────────────────────────────
// The same public page, as markdown, on its own URL's terms: an agent asks for
// `Accept: text/markdown` and gets the build's markdown twin of that page.
//
// 🔴 LAST, and only last. Every branch above this one — inbox, checkout return,
// site-owned buyer page, forward, verdict, shop — runs on the ORIGINAL request
// before anything here reads Accept, so a private URL is judged by RSP whatever
// its Accept header says. The map itself is built from the resolved PUBLIC static
// routes and the emitter refuses a build where one of them is also gated.
//
// 🔴 `Vary: Accept` on BOTH variants, not only the markdown one. One URL now
// answers with two bodies; HTML is the one a shared cache stores first, because
// that is what people request. Vary only on markdown is the version that looks
// right and still serves markdown to a browser.

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

// Only an EXPLICIT `text/markdown` with a non-zero q selects it. `*/*` and
// `text/*` do not: a browser sends `text/html,…,*/*;q=0.8` and must keep getting
// the page, and a wildcard is "I'll take what you have", not "send me markdown".
function wantsMarkdown(request) {
	for (const part of (request.headers.get('accept') || '').split(',')) {
		const [type, ...params] = part.split(';');
		if (type.trim().toLowerCase() !== 'text/markdown') continue;
		const q = params.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith('q='));
		const weight = q === undefined ? 1 : Number(q.slice(2));
		if (Number.isFinite(weight) && weight > 0) return true;
	}
	return false;
}

// Adds Accept to whatever Vary the response already had and keeps every other
// header. A fetched Response's headers are immutable, so this rebuilds it; HEAD
// passes a null body rather than the asset server's, so nothing is manufactured.
function withVaryAccept(response, request, contentType) {
	const headers = new Headers(response.headers);
	const vary = (headers.get('vary') || '').split(',').map((v) => v.trim()).filter(Boolean);
	if (!vary.some((v) => v === '*' || v.toLowerCase() === 'accept')) vary.push('Accept');
	headers.set('vary', vary.join(', '));
	if (contentType) headers.set('content-type', contentType);
	return new Response(request.method === 'HEAD' ? null : response.body, {
		status: response.status, statusText: response.statusText, headers
	});
}

// Returns null for everything this branch does not own, so the caller falls
// through to the EXACT static behaviour it had before: no config, a method other
// than GET/HEAD, an unmapped path, or a mapped twin the asset server does not
// serve — a missing .md must never 404 a public page that exists.
//
// 🔴 That fall-through answers HTML WITHOUT `Vary: Accept`, deliberately: a URL
// whose twin the build never wrote has exactly ONE variant, so there is nothing
// for a shared cache to get wrong. Vary belongs on the URLs that really do answer
// two ways, and only the mapped-and-served ones do.
async function negotiateMarkdown(request, env, markdown) {
	const routes = markdown && markdown.routes;
	if (!routes) return null;
	if (request.method !== 'GET' && request.method !== 'HEAD') return null;
	let url;
	try { url = new URL(request.url); } catch (e) { return null; }
	// The same normalization the generated set was written in, so /about and
	// /about/ are one route here exactly as they are one route to the verdict gate.
	const asset = routes[normalizeVerdictPath(url.pathname)];
	if (asset === undefined) return null;
	if (!wantsMarkdown(request)) return withVaryAccept(await env.ASSETS.fetch(request), request);
	const res = await env.ASSETS.fetch(new Request(url.origin + asset, request));
	// 🔴 304 IS AN ANSWER, not a missing twin. The twin fetch carries the caller's
	// own headers, so a revalidation of the cached markdown arrives with the twin's
	// `If-None-Match` and the asset server answers 304 — which is not `ok`. Reading
	// that as "no twin" would fall through and hand a caller who asked for markdown
	// an HTML 200 with no `Vary: Accept`: the exact cache crossover this branch
	// exists to prevent, on the one request that revalidates a cached variant.
	if (!res || (!res.ok && res.status !== 304)) return null;
	return withVaryAccept(res, request, MARKDOWN_CONTENT_TYPE);
}

const siteWorker = {
	async fetch(request, env, ctx) {
		const CFG = __SHOP_CONFIG__;
/*__CANONICAL_FETCH__*/		const shopDescriptors = CFG.shops || [];
		const shops = shopDescriptors.slice().sort((a, b) => b.shopPath.length - a.shopPath.length);
		let pathname = '';
		try { pathname = new URL(request.url).pathname; } catch (e) { pathname = ''; }

		// A fixed, site-owned path, checked BEFORE the contract-driven branches
		// below — it exists on every site regardless of --api-contract, --shop or
		// --platform-origin, so it never depends on any of them being present.
		if (pathname === '/__reef/inbox') return handleInboxForward(request, CFG);
		// Same terms (fixed, site-owned, on every site): a YouTube line's poster (tile#148).
		const ytPoster = YT_POSTER_PATH.exec(pathname);
		if (ytPoster) return relayYoutubePoster(request, ctx, ytPoster[1]);

		// Native checkout returns to the contract-declared shared platform path. A
		// resolved native storefront claims it before the generic forward so the
		// result keeps this site's shell; old contracts, provider-only sites and
		// malformed returns retain the existing RSP fallback.
		const transport = CFG.apiTransport;
		const nativeCheckoutSuccess = matchNativeCheckoutSuccess(request, shopDescriptors, transport && transport.checkoutResult);
		if (nativeCheckoutSuccess) return renderCompletion(request, env, CFG, nativeCheckoutSuccess, transport.checkoutResult);

		// The site's OWN buyer pages, claimed BEFORE the generic forward below.
		// The contract deliberately keeps those same paths in `forward` for the
		// workers already emitted, so claiming them early is the only thing that
		// moves who renders them; a contract without siteOwnedBuyerPages forwards
		// them exactly as before.
		const siteOwnedBuyerPage = matchSiteOwnedBuyerPage(request, transport && transport.siteOwnedBuyerPages);
		if (siteOwnedBuyerPage) return renderSiteOwnedBuyerPage(request, env, CFG, siteOwnedBuyerPage, ctx);

		// The subscribe result landing, claimed BEFORE the generic forward for the
		// same reason and on the same terms: the contract keeps its path in `forward`
		// so already-emitted workers keep the whole-page fallback, and a contract
		// without subscribeResult forwards it exactly as before.
		const subscribeResult = matchSubscribeResult(request, transport && transport.subscribeResult);
		if (subscribeResult) {
			// null: a prefixed candidate RSP did not confirm, on a path the site has its
			// own page for — fall through as if unmatched (see renderSubscribeResult).
			const rendered = await renderSubscribeResult(request, env, CFG, subscribeResult, ctx);
			if (rendered) return rendered;
		}

		// The branches are MUTUALLY EXCLUSIVE and the transport is first:
		// contract hit → the binding, verdict-required hit → ask then serve
		// (or, with no binding to ask, fall through as before — see below),
		// shop hit → the edge-rendered shop, otherwise → the static site.
		if (transport) {
			const forwarded = matchForwardRule(transport.forward, pathname, request.method);
			const gated = forwarded ? null : matchVerdictRule(transport.verdict, pathname);
			// The forward takes the binding and only the binding; the verdict is a READ
			// and takes the platform reader (see platformReader).
			const binding = forwarded ? env[transport.bindingName] : null;
			const reader = gated ? platformReader(env, ctx, CFG) : null;
			if (forwarded) {
				// No binding on a FORWARDED path: those paths have no file behind them,
				// so today they reach ASSETS and 404. Both answers are "unusable", and
				// the honest error takes nothing working away. Never ASSETS, never 200.
				if (!binding) {
					// Behind the dispatcher (a platform reader and no binding) the checkout return the
					// native claim above declined is composed here, never the binding-missing error.
					const checkoutFallback = platformReader(env, ctx, CFG)
						? matchCheckoutResultFallback(request, shopDescriptors, transport.checkoutResult) : null;
					if (checkoutFallback) return renderCompletion(request, env, CFG, checkoutFallback, transport.checkoutResult);
					return bindingMissingResponse(transport);
				}
				return binding.fetch(request);   // verbatim: method, path, query, headers, body
			}
			if (gated && !reader) return verdictRefusal(request, env, transport, 'retry', verdictBindingMissingResponse());
			if (gated && reader) return serveVerdictGatedPath(request, env, reader, transport, normalizeVerdictPath(pathname));
		}

		let match = null;
		try { match = matchShop(pathname, shops); } catch (e) { match = null; }
		const complete = matchShopComplete(pathname, shops);
		if (complete && request.method === 'GET') return renderCompletion(request, env, CFG, complete);
		if (match && match.shop.source === 'native') return renderNativeProduct(request, env, CFG, match, ctx);
		if (match && match.shop.source === 'provider') return renderProduct(request, env, ctx, CFG, match);
		const idx = matchShopIndex(pathname, shops);
		if (idx && idx.source === 'native') return renderNativeGridPage(request, env, CFG, idx, ctx);
		if (idx && idx.source === 'provider') return renderGridPage(request, env, ctx, CFG, idx);
/*__QUERY_REDIRECT_FETCH__*/		// Last, and only for a route the build itself mapped: same page, markdown.
		const negotiated = await negotiateMarkdown(request, env, CFG.markdown);
		if (negotiated) return negotiated;
		return env.ASSETS.fetch(request); // everything else: the static site, untouched
	}
};

export default {
	async fetch(request, env, ctx) {
		return withoutPreservedCopy(request, await siteWorker.fetch(request, env, ctx));
	}
};

// Exported for Node unit tests (the deployed bundle just uses the default).
export {
	stripDonorHead, injectHead, replaceMain, matchShop, matchShopIndex, matchShopComplete, matchNativeCheckoutSuccess, matchCheckoutResultFallback, COMPLETE_COPY, completionLocale, shouldClearCartForOutcome, cartAfterOrder, settleCartAfterOrder, completionBody, renderCompletion, parseCoralDiv, injectCoralGrid,
	matchSiteOwnedBuyerPage, renderSiteOwnedBuyerPage,
	matchSubscribeResult, renderSubscribeResult,
	pathMatchesRule, matchForwardRule, matchVerdictRule, normalizeVerdictPath,
	handleInboxForward, isSiteRelativePath, resolveInboxReturnPath, inboxRedirectResponse,
	YT_POSTER_PATH, relayYoutubePoster,
	platformReader
};
