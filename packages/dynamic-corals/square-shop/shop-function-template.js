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

/*__CANONICAL_HELPERS__*/function stripDonorHead(html) {
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

// Resolve the product JSON. Prefer SAME-ORIGIN /api (proxied through CF's backbone, ~0.08s) over
// the raw backend origin (cross-region public internet + dyno wake, ~1s+ — verified live). Validate
// it's actually JSON: CF Pages serves a 200 HTML SPA-fallback for unknown paths, so `ok` isn't
// enough. Fall back to the configured apiBase so a site that doesn't proxy /api still works.
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
	const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
	const cacheKey = cache ? new Request(origin + url.pathname) : null;
	if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }

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
			shopPath: shopPath, labels: match.shop.labels || {}, canonical: canonical, locale: match.shop.locale || 'en-US'
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
		if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
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

const COMPLETE_COPY = {
	'en-US': { paid: 'Thank you for your order', receipt: 'A receipt was emailed to you.', pending: 'Confirming your payment', pendingBody: 'Payment processing', waiting: "Still confirming — we'll email you the result.", canceled: 'Payment not completed', canceledBody: 'Your cart is unchanged.', unknown: "We couldn't find this order", unknownBody: 'This page appears after you complete a payment.', back: 'Back to the shop', order: 'Order reference', total: 'Total', tax: 'incl. tax' },
	'ja-JP': { paid: 'ご注文ありがとうございます', receipt: '領収書をメールでお送りしました。', pending: 'お支払いを確認しています', pendingBody: 'お支払いを処理中です', waiting: 'まだ確認中です。結果はメールでお知らせします。', canceled: 'お支払いは完了していません', canceledBody: 'カートの内容はそのままです。', unknown: 'ご注文を確認できません', unknownBody: 'このページはお支払いの後に表示されます。', back: 'ショップに戻る', order: '注文番号', total: '合計', tax: '税込' },
	'zh-TW': { paid: '感謝您的訂購', receipt: '收據已寄到您的電子郵件。', pending: '正在確認您的付款', pendingBody: '款項處理中', waiting: '仍在確認中，結果會以 email 通知。', canceled: '付款未完成', canceledBody: '購物車內容仍保留。', unknown: '找不到這筆訂單', unknownBody: '這一頁會在付款完成後顯示。', back: '返回商店', order: '訂單編號', total: '合計', tax: '含稅' },
	// 0.11.10 (finding #15, 2026-09-03 cold-read): added alongside zh-TW, not derived from it — see
	// square-shop.js's own zh-CN row for why (wording, not just glyphs, differs).
	'zh-CN': { paid: '感谢您的订购', receipt: '收据已寄到您的电子邮件。', pending: '正在确认您的付款', pendingBody: '款项处理中', waiting: '仍在确认中，结果会以 email 通知。', canceled: '付款未完成', canceledBody: '购物车内容仍保留。', unknown: '找不到这笔订单', unknownBody: '这一页会在付款完成后显示。', back: '返回商店', order: '订单编号', total: '合计', tax: '含税' }
};

function completionLocale(shop, shell, pathLocale) {
	if (pathLocale) {
		if (pathLocale === 'zh-tw' || pathLocale === 'zh-hant') return 'zh-TW';
		if (pathLocale === 'zh-cn' || pathLocale === 'zh-hans') return 'zh-CN';
		if (pathLocale === 'ja' || pathLocale === 'ja-jp') return 'ja-JP';
		return 'en-US';
	}
	const path = (shop && shop.shopPath || '').toLowerCase();
	const lang = ((shell || '').match(/<html\b[^>]*\blang=["']([^"']+)/i) || [])[1] || '';
	const value = (path + ' ' + lang).toLowerCase();
	if (/zh(?:-|_)hans|zh-cn/.test(value)) return 'zh-CN';
	if (/zh(?:-|_)tw|zh-tw|zh(?:-|_)hant/.test(value)) return 'zh-TW';
	if (/(?:^|[\s/_-])ja(?:[\s/_-]|$)|ja-jp/.test(value)) return 'ja-JP';
	return 'en-US';
}

function shouldClearCartForOutcome(state) {
	return state === 'paid';
}

function completionBody(copy, locale, outcomeUrl, shopPath, storeId, hasRef) {
	const data = JSON.stringify({ copy, locale, outcomeUrl, shopPath, storeId }).replace(/</g, '\\u003c');
	const initial = hasRef ? { heading: copy.pending, body: copy.pendingBody } : { heading: copy.unknown, body: copy.unknownBody };
	const backLink = hasRef ? '' : `<p><a href="${shopPath}">${copy.back}</a></p>`;
	return `<h1 id="dc-shop-heading">${initial.heading}</h1>
<section class="dc-shop-complete" aria-live="polite"><div id="dc-shop-outcome"><p>${initial.body}</p>${backLink}</div></section>
<style>.dc-shop-complete{max-width:42rem;margin:3rem auto;padding:1.5rem}.dc-shop-complete ul{padding-left:1.25rem}.dc-shop-complete .dc-shop-total{font-weight:700}</style>
${hasRef ? `<script>(function(){const C=${data},root=document.getElementById('dc-shop-outcome'),heading=document.getElementById('dc-shop-heading');let tries=0;const shouldClearCartForOutcome=${shouldClearCartForOutcome.toString()};const esc=s=>{const n=document.createElement('span');n.textContent=String(s==null?'':s);return n.innerHTML};const money=(n,c)=>new Intl.NumberFormat(C.locale,{style:'currency',currency:c||'USD'}).format((Number(n)||0)/100);const setHeading=s=>{heading.textContent=s;document.title=s};const back=(state)=>{setHeading(C.copy[state]);root.innerHTML='<p>'+esc(C.copy[state+'Body'])+'</p><p><a href="'+esc(C.shopPath)+'">'+esc(C.copy.back)+'</a></p>'};async function check(){let d;try{const r=await fetch(C.outcomeUrl,{headers:{Accept:'application/json'},credentials:'same-origin'});d=await r.json();if(!r.ok||!d||d.ok!==true)throw 0}catch(e){back('unknown');return}if(shouldClearCartForOutcome(d.state)){setHeading(C.copy.paid);try{localStorage.removeItem('dc-square-shop-cart:'+C.storeId);window.dispatchEvent(new CustomEvent('dc-cart-changed'))}catch(e){}const lines=Array.isArray(d.lines)?d.lines:[];root.innerHTML=(lines.length?'<ul>'+lines.map(x=>'<li>'+esc(x.name)+' × '+esc(x.qty)+' — '+esc(money(x.amount_minor,d.currency))+'</li>').join('')+'</ul>':'')+'<p class="dc-shop-total">'+esc(C.copy.total)+': '+esc(money(d.total_minor,d.currency))+(d.currency==='JPY'?' <small>'+esc(C.copy.tax)+'</small>':'')+'</p>'+(d.order_ref?'<p>'+esc(C.copy.order)+': <strong>'+esc(d.order_ref)+'</strong></p>':'')+'<p>'+esc(C.copy.receipt)+'</p>';return}if(d.state==='pending'){setHeading(C.copy.pending);tries++;if(tries<40){root.innerHTML='<p>'+esc(C.copy.pendingBody)+'</p>';setTimeout(check,3000)}else root.innerHTML='<p>'+esc(C.copy.waiting)+'</p>';return}if(d.state==='canceled'){back('canceled');return}back('unknown')}check()})();</script>` : ''}`;
}

async function renderCompletion(request, env, cfg, shop, checkoutResult) {
	const url = new URL(request.url);
	const ref = url.searchParams.get('ref') || '';
	const orderId = checkoutResult ? url.searchParams.get(checkoutResult.orderParam) || '' : '';
	const hasOutcomeKey = Boolean(ref || orderId);
	const shopPath = shop.completionShopPath || shop.shopPath;
	const pathLocale = (url.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\/shop\/complete\/?$/) || [])[1] || '';
	let shellRes = await env.ASSETS.fetch(new Request(url.origin + shopPath + '/', request));
	// A locale path (e.g. /ja/shop/complete) can name a shop page that was never built —
	// the default locale is often served bare at shop.shopPath (e.g. /shop) with no
	// locale-prefixed twin. Retry against the base/default shop's own path before giving
	// up on site chrome entirely.
	if (!shellRes.ok && shopPath !== shop.shopPath) {
		shellRes = await env.ASSETS.fetch(new Request(url.origin + shop.shopPath + '/', request));
	}
	if (!shellRes.ok && checkoutResult) {
		return new Response('Checkout result unavailable', {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' }
		});
	}
	const shell = shellRes.ok ? await shellRes.text() : '<!doctype html><html><head></head><body><main></main></body></html>';
	const locale = completionLocale(shop, shell, pathLocale);
	const copy = { ...COMPLETE_COPY[locale] };
	const coral = parseCoralDiv(shell);
	if (coral) for (const key of Object.keys(copy)) if (coral.completionLabels[key]) copy[key] = coral.completionLabels[key];
	const siteKey = cfg.siteId || cfg.guildId || '';
	const outcome = new URL(checkoutResult ? checkoutResult.outcomePath : '/api/v2/shop/checkout/outcome', url.origin);
	outcome.searchParams.set('site', siteKey);
	outcome.searchParams.set('ref', orderId || ref);
	let body = stripDonorHead(shell);
	const initialHeading = hasOutcomeKey ? copy.pending : copy.unknown;
	body = injectHead(body, `<title>${initialHeading}</title><meta name="robots" content="noindex">`);
	body = replaceMain(body, completionBody(copy, locale, outcome.pathname + outcome.search, shopPath, cfg.guildId || cfg.siteId || '', hasOutcomeKey));
	return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' } });
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
		available
	};
}

async function fetchNativeProjection(request, env, cfg, slug) {
	const transport = cfg.apiTransport;
	const binding = transport && env[transport.bindingName];
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

// 🔴 Native still replaces the WHOLE <main>, unlike renderGridPage's coral-preserving mount
// (above). That is not an oversight carried over from the same bug — it's the ceiling of what's
// possible today: native has no client-side coral markup at all (no square-shop-shaped div, no
// other marker) anywhere in sitetile's authoring, so there is nothing on the page for a native
// render to key off and preserve. Closing this the same way the provider path was closed would
// need a real authored mount point for native shops first — a sitetile/authoring change, out of
// this fix's scope. Flagging rather than silently declaring native "done" alongside provider.
function nativeUnavailable(shell) {
	return replaceMain(shell, '<section data-storefront-source="native" data-storefront-state="unavailable"><h1>Storefront unavailable</h1><p>Please try again later.</p></section>');
}

// Native C uses its own cart + checkout contract. The browser submits only the
// projected inventory SKU and quantity; checkout re-reads cart/inventory and
// derives the charge server-side, so no displayed price crosses this boundary.
function nativeBuyControl(item) {
	if (!item.available || !item.sku) return '<button type="button" class="dc-native-buy" disabled>Unavailable</button>';
	return `<button type="button" class="dc-native-buy" data-native-sku="${escHtml(item.sku)}">Buy now</button>`;
}

function nativeCheckoutScript() {
	return `<script>(function(){document.addEventListener('click',async function(event){const button=event.target&&event.target.closest&&event.target.closest('[data-native-sku]');if(!button||button.disabled)return;const sku=button.getAttribute('data-native-sku');if(!sku)return;button.disabled=true;try{const added=await fetch('/api/cart/items',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({sku:sku,qty:1})});if(!added.ok)throw new Error('add failed');const checkout=await fetch('/api/checkout',{method:'POST',credentials:'same-origin'});const result=await checkout.json().catch(function(){return null});if(!checkout.ok||!result||typeof result.redirect_url!=='string')throw new Error('checkout failed');window.location.assign(result.redirect_url)}catch(error){button.disabled=false;const status=button.parentElement&&button.parentElement.querySelector('[data-native-status]');if(status)status.textContent='Unable to start checkout. Please try again.'}})})()</script>`;
}

function nativeProductBody(item, shop) {
	const mapped = nativeCatalogItem(item);
	if (!mapped) return '<section data-storefront-source="native" data-storefront-state="unavailable"><h1>Storefront unavailable</h1><p>Please try again later.</p></section>';
	const copy = item.copy || {};
	const description = String(copy.description_html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
	return `<article data-storefront-source="native" class="dc-native-product"><p><a href="${escHtml(shop.shopPath)}">Shop</a></p><h1>${escHtml(mapped.name)}</h1>${mapped.image_url ? `<img src="${escHtml(mapped.image_url)}" alt="${escHtml(mapped.name)}">` : ''}<p>${escHtml(formatMoney({ minor: mapped.price_minor, currency: mapped.currency, locale: shop.locale || 'en-US' }))}</p>${description ? `<p>${escHtml(description)}</p>` : ''}${nativeBuyControl(mapped)}<p data-native-status role="status"></p></article>${nativeCheckoutScript()}`;
}

// 🔴 whole-<main> replacement — see nativeUnavailable()'s note just above: native has no author
// coral div to preserve today.
async function renderNativeGridPage(request, env, cfg, shop) {
	const origin = new URL(request.url).origin;
	const [projection, shellRes] = await Promise.all([
		fetchNativeProjection(request, env, cfg),
		env.ASSETS.fetch(new Request(origin + shop.shopPath + '/', request))
	]);
	if (!shellRes.ok) return htmlResponse('<!doctype html><main><section data-storefront-source="native" data-storefront-state="unavailable"><h1>Storefront unavailable</h1><p>Please try again later.</p></section></main>', 503);
	const shell = await shellRes.text();
	if (projection.kind !== 'ok') return htmlResponse(nativeUnavailable(shell), 503);
	const items = Array.isArray(projection.body.items) ? projection.body.items.map(nativeCatalogItem).filter(Boolean) : null;
	if (!items) return htmlResponse(nativeUnavailable(shell), 503);
	const cards = items.map((item) => `<article><a href="${escHtml(shop.shopPath + '/' + encodeURIComponent(item.slug || ''))}">${item.image_url ? `<img src="${escHtml(item.image_url)}" alt="${escHtml(item.name)}">` : ''}<h2>${escHtml(item.name)}</h2><p>${escHtml(formatMoney({ minor: item.price_minor, currency: item.currency, locale: shop.locale || 'en-US' }))}</p></a>${nativeBuyControl(item)}<p data-native-status role="status"></p></article>`).join('');
	return htmlResponse(replaceMain(shell, `<section data-storefront-source="native" class="dc-native-grid">${cards || '<p>No products are available.</p>'}</section>${nativeCheckoutScript()}`));
}

// 🔴 whole-<main> replacement — see nativeUnavailable()'s note above: native has no author
// coral div to preserve today.
async function renderNativeProduct(request, env, cfg, match) {
	const origin = new URL(request.url).origin;
	const [projection, shellRes] = await Promise.all([
		fetchNativeProjection(request, env, cfg, match.slug),
		env.ASSETS.fetch(new Request(origin + match.shop.shopPath + '/', request))
	]);
	if (!shellRes.ok) return htmlResponse('<!doctype html><main><section data-storefront-source="native" data-storefront-state="unavailable"><h1>Storefront unavailable</h1><p>Please try again later.</p></section></main>', 503);
	const shell = await shellRes.text();
	if (projection.kind === 'not_found') return htmlResponse(replaceMain(shell, '<section data-storefront-source="native" data-storefront-state="not-found"><h1>Product not found</h1></section>'), 404);
	if (projection.kind !== 'ok') return htmlResponse(nativeUnavailable(shell), 503);
	return htmlResponse(replaceMain(shell, nativeProductBody(projection.body.item, match.shop)));
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
	const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
	const cacheKey = cache ? new Request(origin + url.pathname) : null;
	if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit; }

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
			cart: coral.cart, noSidebar: coral.noSidebar, detailBase: coral.detailBase, labels: coral.labels, locale: coral.locale
		});
		let body = injectHead(shell, `<style>${gridCss}</style>`);
		body = injectCoralGrid(body, coral.tag, gridHtml);
		const res = htmlResponse(body);
		if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
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
	'kind', 'id', 'text', 'conversation_id', 'page_url', 'return_to', '_hp',
	'visitor_email', 'email_field'
]);

// Trusted as a redirect target only when it is unambiguously a path on THIS
// site: a leading slash, and not a network-path reference (`//host`, which a
// browser resolves against its own scheme — the one thing `startsWith('/')`
// alone would let through).
function isSiteRelativePath(value) {
	return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
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
function inboxRedirectResponse(returnPath, outcome) {
	const url = new URL(returnPath, 'http://site.invalid');
	url.searchParams.set('inbox', outcome);
	return new Response(null, { status: 303, headers: { location: url.pathname + url.search + url.hash } });
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

	// Honeypot: a real visitor never sees or tabs to this field, so it stays
	// empty; a bot's autofill still finds and fills it. Behave EXACTLY as a
	// normal successful send — no signal that tells the bot it was caught — and
	// never spend the platform's inbox call on it.
	if (raw._hp) return inboxRedirectResponse(returnPath, 'sent');

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
		const res = await fetch(platformOrigin + '/api/inbox', {
			method: 'POST',
			// A fresh header set, deliberately: nothing from the visitor's request
			// (cookie included) rides along, and credentials: 'omit' means this
			// fetch sends none of its own either.
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
			credentials: 'omit',
			signal: controller.signal
		});
		if (res.ok) return inboxRedirectResponse(returnPath, 'sent');
		let reason = 'error';
		try {
			const body = await res.json();
			if (body && typeof body.reason === 'string' && body.reason) reason = body.reason;
		} catch (e) { /* non-JSON error body → the generic reason stands */ }
		return inboxRedirectResponse(returnPath, reason);
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
	if (!verdict || typeof verdict !== 'object') return verdictUnavailableResponse();
	if (verdict.allow !== true) return verdictBlockedResponse();
	return env.ASSETS.fetch(request);
}

export default {
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

		// Native checkout returns to the contract-declared shared platform path. A
		// resolved native storefront claims it before the generic forward so the
		// result keeps this site's shell; old contracts, provider-only sites and
		// malformed returns retain the existing RSP fallback.
		const transport = CFG.apiTransport;
		const nativeCheckoutSuccess = matchNativeCheckoutSuccess(request, shopDescriptors, transport && transport.checkoutResult);
		if (nativeCheckoutSuccess) return renderCompletion(request, env, CFG, nativeCheckoutSuccess, transport.checkoutResult);

		// The branches are MUTUALLY EXCLUSIVE and the transport is first:
		// contract hit → the binding, verdict-required hit → ask then serve
		// (or, with no binding to ask, fall through as before — see below),
		// shop hit → the edge-rendered shop, otherwise → the static site.
		if (transport) {
			const forwarded = matchForwardRule(transport.forward, pathname, request.method);
			const gated = forwarded ? null : matchVerdictRule(transport.verdict, pathname);
			const binding = (forwarded || gated) ? env[transport.bindingName] : null;
			if (forwarded) {
				// No binding on a FORWARDED path: those paths have no file behind them,
				// so today they reach ASSETS and 404. Both answers are "unusable", and
				// the honest error takes nothing working away. Never ASSETS, never 200.
				if (!binding) return bindingMissingResponse(transport);
				return binding.fetch(request);   // verbatim: method, path, query, headers, body
			}
			if (gated && !binding) return verdictBindingMissingResponse();
			if (gated && binding) return serveVerdictGatedPath(request, env, binding, transport, normalizeVerdictPath(pathname));
		}

		let match = null;
		try { match = matchShop(pathname, shops); } catch (e) { match = null; }
		const complete = matchShopComplete(pathname, shops);
		if (complete && request.method === 'GET') return renderCompletion(request, env, CFG, complete);
		if (match && match.shop.source === 'native') return renderNativeProduct(request, env, CFG, match);
		if (match && match.shop.source === 'provider') return renderProduct(request, env, ctx, CFG, match);
		const idx = matchShopIndex(pathname, shops);
		if (idx && idx.source === 'native') return renderNativeGridPage(request, env, CFG, idx);
		if (idx && idx.source === 'provider') return renderGridPage(request, env, ctx, CFG, idx);
		return env.ASSETS.fetch(request); // everything else: the static site, untouched
	}
};

// Exported for Node unit tests (the deployed bundle just uses the default).
export {
	stripDonorHead, injectHead, replaceMain, matchShop, matchShopIndex, matchShopComplete, matchNativeCheckoutSuccess, COMPLETE_COPY, completionLocale, shouldClearCartForOutcome, completionBody, renderCompletion, parseCoralDiv, injectCoralGrid,
	pathMatchesRule, matchForwardRule, matchVerdictRule, normalizeVerdictPath,
	handleInboxForward, isSiteRelativePath, resolveInboxReturnPath
};
