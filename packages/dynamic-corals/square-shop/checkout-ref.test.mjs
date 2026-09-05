// square-shop 0.11.0 — the checkout contract with RSP, driven through the REAL
// startCheckout / startCartCheckout rather than asserted about source text.
//
// Three things are pinned here, and each of them is a way the shop can take a
// buyer's money twice or say nothing when it fails:
//   1. `client_request_ref` is sent, under that exact key, on BOTH paths. RSP
//      refuses without it (400 client_request_ref_required) and deliberately
//      will not mint one server-side.
//   2. It is STABLE per buy-intent and DISTINCT between intents — a double-click
//      must replay one payment link, an edited cart must mint a new one.
//   3. A refusal reaches the buyer as plain language, and RSP's own `error`
//      sentence never does.
//   4. (0.11.4) While the request is in flight the button SAYS SO. It used to go to
//      a bare '…' for the length of the request, which is the button vanishing, not
//      a loading state — on a payment button, at the moment the buyer is most likely
//      to press it a second time.
//
// 🔴 The import comes FIRST on purpose. square-shop.js self-mounts when there is
// a `document` at load time, so the stub below is installed after the module is
// already loaded — otherwise this test would drive a mount nobody asked for.
import {
	startCheckout,
	startCartCheckout,
	newClientRequestRef,
	cartRefKey,
	checkoutErrorMessage,
	errorResponseToLineStates,
	localeDictionary,
	storageAvailabilityNotice,
	readLabels,
	beginPending
} from './square-shop.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

// ── the smallest DOM these two functions actually touch ──────────────────
function fakeElement(tag) {
	const el = {
		tagName: tag,
		className: '',
		textContent: '',
		hidden: false,
		disabled: false,
		parentElement: null,
		children: [],
		attrs: {},
		setAttribute(k, v) { this.attrs[k] = String(v); },
		getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
		removeAttribute(k) { delete this.attrs[k]; },
		appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
		querySelector(sel) {
			const cls = sel.replace(/^\./, '');
			for (const c of this.children) if (String(c.className).split(/\s+/).indexOf(cls) >= 0) return c;
			return null;
		}
	};
	// 🔴 className and classList are two VIEWS OF ONE STRING in a real DOM. This shim is
	// backed by el.className for that reason: with a separate Set behind classList, a
	// test asserting on either one would pass while a browser showed the other — a stub
	// thinner than the thing it stands for, green on the divergence it should catch.
	el.classList = {
		add(c) {
			const s = String(el.className).split(/\s+/).filter(Boolean);
			if (s.indexOf(c) < 0) s.push(c);
			el.className = s.join(' ');
		},
		remove(c) {
			el.className = String(el.className).split(/\s+/).filter(Boolean).filter((x) => x !== c).join(' ');
		},
		contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; }
	};
	return el;
}
globalThis.document = { createElement: fakeElement };
globalThis.window = { location: { href: '', origin: 'https://shop.test', pathname: '/shop' } };

const LABELS = readLabels(fakeElement('div'));

// Buyer-facing locale fallbacks and memory-cart notice are pure decisions.
{
	const en = localeDictionary('en-US');
	const ja = localeDictionary('ja-JP');
	const zh = localeDictionary('zh-TW');
	const zhCN = localeDictionary('zh-CN');
	const required = ['add','soldOut','viewCart','inCart','shop','chooseOptions','checkout','subtotal','taxIncluded','remove','quantity','soldOutMessage','priceChangedMessage','storageNotice','checkoutNote'];
	ok('all four locale dictionaries cover every widget label', [en, ja, zh, zhCN].every((d) => required.every((key) => d[key])));
	ok('locale selection is language-aware', ja.add === 'カートに追加' && zh.add === '加入購物車' && zhCN.add === '加入购物车' && en.add === 'Add to cart');
	ok('unavailable storage produces the localized notice once rendered', storageAvailabilityNotice(false, zh) === zh.storageNotice && storageAvailabilityNotice(true, zh) === '');
	// 0.11.10 (finding #15, 2026-09-03 cold-read): only zh-tw/zh-hant(-*) were recognised — every
	// other zh tag (a genuine zh-Hans/zh-CN, or the bare `zh` a plain <html lang> carries) fell
	// through to English, same shape as inbox-bubble's own finding #5 fix.
	ok('localeDictionary resolves zh-CN/zh-Hans distinctly from zh-TW/zh-Hant, not as English',
		localeDictionary('zh-CN').taxIncluded === '含税' && localeDictionary('zh-Hans').taxIncluded === '含税'
		&& localeDictionary('zh-hans-cn').taxIncluded === '含税'
		&& localeDictionary('zh-TW').taxIncluded === '含稅' && localeDictionary('zh-Hant').taxIncluded === '含稅');
	ok('localeDictionary bare `zh` defaults Traditional (this coral\'s existing zh-TW-first convention)',
		localeDictionary('zh').taxIncluded === '含稅');
	// 0.11.10 (finding #12, 2026-09-03 cold-read): checkoutNote — localized default, and an EMPTY
	// data-checkout-note explicitly suppresses it (distinct from the attribute being absent, which
	// takes the default). This is the same "empty string is a real choice" contract as every other
	// `|| default` label EXCEPT this one, documented at its readLabels call site.
	{
		const withoutAttr = readLabels(fakeElement('div'));
		ok('checkoutNote defaults to the localized note when the attribute is absent',
			withoutAttr.checkoutNote === 'Payment page is provided by Square (Japanese interface)');
		const suppressed = fakeElement('div');
		suppressed.setAttribute('data-checkout-note', '');
		ok('an explicit empty data-checkout-note suppresses the note (not the default)',
			readLabels(suppressed).checkoutNote === '');
		const overridden = fakeElement('div');
		overridden.setAttribute('data-checkout-note', 'Custom note');
		ok('a non-empty data-checkout-note overrides the localized default',
			readLabels(overridden).checkoutNote === 'Custom note');
	}
}

// RSP 409 contract becomes exact per-line state; unrelated lines are absent.
{
	const sold = errorResponseToLineStates(409, { ok:false, reason:'sold_out', items:[{ variation_id:'A', reason:'sold_out' }] });
	const repriced = errorResponseToLineStates(409, { ok:false, reason:'price_changed', items:[{ variation_id:'B', reason:'price_changed', price_minor:1250, currency:'TWD' }] });
	ok('sold_out 409 marks exactly the named variation', sold.size === 1 && sold.get('A').reason === 'sold_out' && !sold.has('B'));
	ok('price_changed 409 carries the authoritative new minor price', repriced.size === 1 && repriced.get('B').price_minor === 1250 && repriced.get('B').currency === 'TWD');
	ok('unavailable and 5xx do not invent line state', errorResponseToLineStates(409, { ok:false, reason:'unavailable', items:[] }).size === 0 && errorResponseToLineStates(502, {}).size === 0);
}

// A button already sitting in a surface, the way renderInstant/renderPanel build it.
function buttonInSurface(text) {
	const surface = fakeElement('div');
	const btn = fakeElement('button');
	btn.textContent = text;
	surface.appendChild(btn);
	return { surface, btn };
}

// fetch stub: answers from a queue, records every request body it was given.
let sent = [];
function serve(responses) {
	const queue = responses.slice();
	sent = [];
	globalThis.fetch = async (url, init) => {
		sent.push({ url, body: JSON.parse(init.body) });
		const r = queue.shift() || { status: 500, payload: { error: 'no stubbed response left' } };
		return {
			ok: r.status >= 200 && r.status < 300,
			status: r.status,
			json: async () => r.payload
		};
	};
}
const FAIL_502 = { status: 502, payload: { error: 'square checkout failed' } };
const OK_LINK = { status: 200, payload: { attempt_id: 'A1', url: 'https://square.link/x' } };

const API = 'https://rsp.feelreef.com';
const GUILD = 'site_01KWEZWMSVJ9VHYK46KHVPVFD2';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// 🔴 Every same/different-ref assertion goes through these, never through a bare
// `a === b`. Two requests that both OMIT the field compare equal, so a bare `===`
// is green on the exact bug this file exists to stop — a re-click reusing nothing
// looks identical to a re-click reusing one ref. Measured: dropping the field
// from the cart body left "a DOUBLE-CLICK replays the SAME ref" green.
function sameRef(a, b) { return UUID_RE.test(a) && a === b; }
function differentRef(a, b) { return UUID_RE.test(a) && UUID_RE.test(b) && a !== b; }

// ── 1. minting ───────────────────────────────────────────────────────────
ok('newClientRequestRef is a v4 UUID', UUID_RE.test(newClientRequestRef()), newClientRequestRef());
ok('two mints differ', newClientRequestRef() !== newClientRequestRef());

// ── 2. instant path ──────────────────────────────────────────────────────
{
	const refs = new Map();
	const { surface, btn } = buttonInSurface('Buy');
	serve([FAIL_502, FAIL_502]);
	await startCheckout(API, GUILD, 'VAR_A', btn, refs, LABELS);
	await startCheckout(API, GUILD, 'VAR_A', btn, refs, LABELS);

	ok('instant: POSTs the square checkout route', sent[0].url === `${API}/api/v2/square/catalog/checkout`, sent[0].url);
	ok('instant: body carries the exact key `client_request_ref`',
		Object.prototype.hasOwnProperty.call(sent[0].body, 'client_request_ref'), JSON.stringify(sent[0].body));
	ok('instant: ref is a v4 UUID', UUID_RE.test(sent[0].body.client_request_ref), sent[0].body.client_request_ref);
	ok('instant: body still carries guild_id + variation_id',
		sent[0].body.guild_id === GUILD && sent[0].body.variation_id === 'VAR_A');
	ok('instant: a RE-CLICK replays the SAME ref (one link, not two)',
		sameRef(sent[0].body.client_request_ref, sent[1].body.client_request_ref),
		`${sent[0].body.client_request_ref} vs ${sent[1].body.client_request_ref}`);
	ok('instant: button label restored, not left as "…"', btn.textContent === 'Buy' && btn.disabled === false);
	ok('instant: the buyer is told something', (surface.querySelector('.dc-square-shop-msg') || {}).textContent);
}

{
	const refs = new Map();
	const a = buttonInSurface('Buy');
	const b = buttonInSurface('Buy');
	serve([FAIL_502, FAIL_502]);
	await startCheckout(API, GUILD, 'VAR_A', a.btn, refs, LABELS);
	await startCheckout(API, GUILD, 'VAR_B', b.btn, refs, LABELS);
	ok('instant: a DIFFERENT variation gets a DIFFERENT ref (no 409 collision)',
		differentRef(sent[0].body.client_request_ref, sent[1].body.client_request_ref));
}

{
	const refs = new Map();
	const { btn } = buttonInSurface('Buy');
	serve([OK_LINK]);
	globalThis.window.location.href = '';
	await startCheckout(API, GUILD, 'VAR_A', btn, refs, LABELS);
	ok('instant: success sends the buyer to the payment link', globalThis.window.location.href === 'https://square.link/x');
}

{
	// 409 = this ref is bound to a DIFFERENT purchase, so replaying it can only
	// fail again. It must be dropped, or the button is dead for the rest of the visit.
	const refs = new Map();
	const { btn } = buttonInSurface('Buy');
	serve([{ status: 409, payload: { error: 'client_request_ref already in use' } }, FAIL_502]);
	await startCheckout(API, GUILD, 'VAR_A', btn, refs, LABELS);
	await startCheckout(API, GUILD, 'VAR_A', btn, refs, LABELS);
	ok('instant: after a 409 the next attempt mints a FRESH ref',
		differentRef(sent[0].body.client_request_ref, sent[1].body.client_request_ref));
}

// ── 3. cart path (the one the fork never fixed, and the one a live shop runs) ──
{
	const refs = new Map();
	const { surface, btn } = buttonInSurface('Checkout');
	const cart = new Map([['VAR_A', 2], ['VAR_B', 1]]);
	serve([FAIL_502, FAIL_502]);
	await startCartCheckout(API, GUILD, cart, true, btn, LABELS, refs);
	await startCartCheckout(API, GUILD, cart, true, btn, LABELS, refs);

	ok('cart: POSTs the processor-neutral cart route', sent[0].url === `${API}/api/v2/shop/cart`, sent[0].url);
	ok('cart: body carries the exact key `client_request_ref`',
		Object.prototype.hasOwnProperty.call(sent[0].body, 'client_request_ref'), JSON.stringify(sent[0].body));
	ok('cart: ref is a v4 UUID', UUID_RE.test(sent[0].body.client_request_ref), sent[0].body.client_request_ref);
	ok('cart: still sends `items` (never both `items` and `lines` — RSP refuses that)',
		Array.isArray(sent[0].body.items) && sent[0].body.lines === undefined);
	ok('cart: collect_shipping stays a literal boolean', sent[0].body.collect_shipping === true);
	ok('cart: a DOUBLE-CLICK replays the SAME ref (one link, not two)',
		sameRef(sent[0].body.client_request_ref, sent[1].body.client_request_ref),
		`${sent[0].body.client_request_ref} vs ${sent[1].body.client_request_ref}`);
	ok('cart: button label restored', btn.textContent === 'Checkout' && btn.disabled === false);
	ok('cart: the buyer is told something', (surface.querySelector('.dc-square-shop-msg') || {}).textContent);
}

{
	const refs = new Map();
	const { btn } = buttonInSurface('Checkout');
	serve([FAIL_502, FAIL_502, FAIL_502]);
	await startCartCheckout(API, GUILD, new Map([['VAR_A', 1]]), false, btn, LABELS, refs);
	await startCartCheckout(API, GUILD, new Map([['VAR_A', 2]]), false, btn, LABELS, refs);
	ok('cart: EDITING the basket mints a fresh ref',
		differentRef(sent[0].body.client_request_ref, sent[1].body.client_request_ref));

	await startCartCheckout(API, GUILD, new Map([['VAR_A', 2]]), false, btn, LABELS, refs);
	ok('cart: the same basket again reuses the edited basket\'s ref',
		sameRef(sent[1].body.client_request_ref, sent[2].body.client_request_ref));
}

ok('cartRefKey: insertion order does not change the cart\'s identity',
	cartRefKey(new Map([['A', 1], ['B', 2]])) === cartRefKey(new Map([['B', 2], ['A', 1]])));
ok('cartRefKey: quantity is part of the identity',
	cartRefKey(new Map([['A', 1]])) !== cartRefKey(new Map([['A', 2]])));
ok('cartRefKey: an added line changes the identity',
	cartRefKey(new Map([['A', 1]])) !== cartRefKey(new Map([['A', 1], ['B', 1]])));

// 0.11.5 — the separators became \u0000/\u0001 ESCAPES instead of the literal control
// bytes. That is a change to the FILE, not to the value, and this is the pair that says so.
//
// 🔴 The value assertion is written with explicit escapes rather than by calling the
// function twice: comparing cartRefKey to itself would be green whatever it emits, which
// is exactly the check that would have let a silent separator change through.
ok('cartRefKey: the separator bytes are unchanged (escape ≡ literal, same key)',
	cartRefKey(new Map([['A', 1], ['B', 2]])) === 'A\u0000' + '1' + '\u0001' + 'B\u0000' + '2');

// The distribution half: the file that SHIPS must be readable as text. A source file
// holding a literal U+0000 stops being text to file(1) and to grep, which then answers
// "no matches" for a file that plainly contains the thing — silently, and for as long as
// the byte is there. Asserted on the raw bytes of both the source and the published
// artifact, because it is the artifact that gets vendored and grepped downstream.
// (This test file states the escapes, never the bytes, so it cannot satisfy its own check.)
{
	const srcBytes = readFileSync(new URL('./square-shop.js', import.meta.url));
	ok('square-shop.js carries no raw U+0000/U+0001 (it stays grep-able text)',
		!srcBytes.includes(0) && !srcBytes.includes(1),
		`NUL=${srcBytes.filter((b) => b === 0).length} SOH=${srcBytes.filter((b) => b === 1).length}`);
}

// ── 4. the 400 codes, said to a person ───────────────────────────────────
const REF_400 = { error: 'client_request_ref is required', code: 'client_request_ref_required' };
ok('400 client_request_ref_required → the generic try-again, in plain words',
	checkoutErrorMessage(400, REF_400, LABELS) === LABELS.checkoutError,
	checkoutErrorMessage(400, REF_400, LABELS));
ok('429 → "too many tries"', checkoutErrorMessage(429, { error: 'rate limited' }, LABELS) === LABELS.checkoutBusy);
ok('404 → "not taking orders"', checkoutErrorMessage(404, { error: 'square not connected' }, LABELS) === LABELS.checkoutClosed);
ok('409 → "already started"', checkoutErrorMessage(409, { error: 'client_request_ref already in use' }, LABELS) === LABELS.checkoutAgain);
ok('409 unavailable → the existing shop-unavailable message', checkoutErrorMessage(409, { ok:false, reason:'unavailable', items:[] }, LABELS) === LABELS.checkoutUnavailable);
ok('502 → "not responding"', checkoutErrorMessage(502, { error: 'square checkout unavailable' }, LABELS) === LABELS.checkoutUnavailable);
ok('a thrown fetch (status 0, no payload) still says something',
	checkoutErrorMessage(0, null, LABELS) === LABELS.checkoutError);
ok('an unknown 400 falls to the generic message, it does not guess',
	checkoutErrorMessage(400, { error: 'too many cart lines' }, LABELS) === LABELS.checkoutError);

// 🔴 The point of the whole mapping: RSP's OWN sentence must never reach a shopper.
const ENGINEERING = ['client_request_ref', 'square', 'guild_id', 'variation_id', 'site_id', '400', '502', 'rate limited', 'null', 'undefined'];
const shown = [
	checkoutErrorMessage(400, REF_400, LABELS),
	checkoutErrorMessage(429, { error: 'rate limited' }, LABELS),
	checkoutErrorMessage(404, { error: 'square not connected' }, LABELS),
	checkoutErrorMessage(409, { error: 'client_request_ref already in use' }, LABELS),
	checkoutErrorMessage(502, { error: 'square checkout unavailable' }, LABELS)
];
ok('no engineering word reaches the buyer',
	shown.every((m) => m && ENGINEERING.every((w) => m.toLowerCase().indexOf(w) === -1)),
	shown.join(' | '));
ok('every mapped status produces a DISTINCT message (the mapping is not decorative)',
	new Set(shown).size === shown.length, shown.join(' | '));

// A site's own strings win — a zh-TW page must not be answered in English.
{
	const el = fakeElement('div');
	el.setAttribute('data-checkout-busy-label', '太多人在結帳，請稍候再試。');
	const zh = readLabels(el);
	ok('data-checkout-busy-label overrides the default',
		checkoutErrorMessage(429, { error: 'rate limited' }, zh) === '太多人在結帳，請稍候再試。');
}

// ── 5. the no-randomUUID fallback ────────────────────────────────────────
{
	const real = globalThis.crypto;
	let installed = false;
	try {
		Object.defineProperty(globalThis, 'crypto', {
			value: { getRandomValues: (b) => { for (let i = 0; i < b.length; i++) b[i] = (i * 37 + 11) & 0xff; return b; } },
			configurable: true, writable: true
		});
		installed = true;
	} catch { /* reported by name below, never silently skipped */ }
	if (installed) {
		const ref = newClientRequestRef();
		ok('fallback (no crypto.randomUUID) still yields a v4 UUID', UUID_RE.test(ref), ref);
		Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true, writable: true });
	} else {
		console.log('SKIP - fallback (no crypto.randomUUID): globalThis.crypto is not redefinable here');
	}
}

// ── 6. what the button SAYS while it waits (0.11.4, feelreef sweep #22) ──
//
// 🔴 Every arm above stubs an INSTANT response, which is precisely the shape that
// cannot see this: the pending state exists and is over before anything can look at
// it. That is why `serve()` left the old bare '…' unmeasured through five versions —
// the suite only ever read the button after settle. These arms hold the response open
// and look while the request is genuinely in flight (the fetch is recorded first, so
// "pending" here means "the POST is out", not "we got there before it started").
function serveHeld() {
	sent = [];
	let release = () => {};
	const held = new Promise((resolve) => { release = resolve; });
	globalThis.fetch = async (url, init) => {
		sent.push({ url, body: JSON.parse(init.body) });
		const r = await held;
		return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.payload };
	};
	return (r) => release(r);
}
const PENDING = 'Taking you to payment…';

{
	const { surface, btn } = buttonInSurface('Buy');
	const release = serveHeld();
	const running = startCheckout(API, GUILD, 'VAR_A', btn, new Map(), LABELS);
	await null; // let the fetch call be made, so the assertions below are mid-flight

	ok('instant/pending: the POST is actually in flight while we look', sent.length === 1);
	ok('instant/pending: the button says where it is taking you', btn.textContent === PENDING, btn.textContent);
	ok('instant/pending: NOT the bare "…" it used to collapse to', btn.textContent !== '…', btn.textContent);
	ok('instant/pending: still disabled', btn.disabled === true);
	ok('instant/pending: aria-busy is set, so a screen reader hears the wait',
		btn.getAttribute('aria-busy') === 'true', String(btn.getAttribute('aria-busy')));
	ok('instant/pending: carries the -pending class that keeps it one clipped line',
		btn.classList.contains('dc-square-shop-pending'), btn.className);

	release(FAIL_502);
	await running;
	ok('instant/settled: the original label is back', btn.textContent === 'Buy', btn.textContent);
	ok('instant/settled: re-enabled', btn.disabled === false);
	ok('instant/settled: aria-busy removed, not left true forever',
		btn.getAttribute('aria-busy') === null, String(btn.getAttribute('aria-busy')));
	ok('instant/settled: the -pending class is gone', !btn.classList.contains('dc-square-shop-pending'), btn.className);
	// The failure surface this file already pinned is UNCHANGED by the pending state:
	// the refusal is still a -msg node, and it is not written into the button.
	ok('instant/settled: the refusal still reaches the buyer in the -msg node',
		(surface.querySelector('.dc-square-shop-msg') || {}).textContent === LABELS.checkoutUnavailable);
}

{
	// The whole-cart Checkout button — the one a real buyer actually pressed.
	const { surface, btn } = buttonInSurface('Checkout');
	const release = serveHeld();
	const running = startCartCheckout(API, GUILD, new Map([['VAR_A', 2]]), false, btn, LABELS, new Map());
	await null;

	ok('cart/pending: the POST is actually in flight while we look', sent.length === 1);
	ok('cart/pending: the button says where it is taking you', btn.textContent === PENDING, btn.textContent);
	ok('cart/pending: NOT the bare "…"', btn.textContent !== '…', btn.textContent);
	ok('cart/pending: still disabled', btn.disabled === true);
	ok('cart/pending: aria-busy is set', btn.getAttribute('aria-busy') === 'true');
	ok('cart/pending: carries the -pending class', btn.classList.contains('dc-square-shop-pending'), btn.className);

	release(FAIL_502);
	await running;
	ok('cart/settled: the original label is back', btn.textContent === 'Checkout', btn.textContent);
	ok('cart/settled: re-enabled', btn.disabled === false);
	ok('cart/settled: aria-busy removed', btn.getAttribute('aria-busy') === null);
	ok('cart/settled: the -pending class is gone', !btn.classList.contains('dc-square-shop-pending'), btn.className);
	ok('cart/settled: the refusal still reaches the buyer in the -msg node',
		(surface.querySelector('.dc-square-shop-msg') || {}).textContent === LABELS.checkoutUnavailable);
}

{
	// A zh-TW page must not be told "Taking you to payment…" on the one screen where it
	// is waiting. Same data-* contract as data-checkout-busy-label above.
	const el = fakeElement('div');
	el.setAttribute('data-checkout-pending-label', '正在前往付款…');
	const zh = readLabels(el);
	ok('data-checkout-pending-label overrides the default', zh.checkoutPending === '正在前往付款…', zh.checkoutPending);

	const { btn } = buttonInSurface('結帳');
	const release = serveHeld();
	const running = startCartCheckout(API, GUILD, new Map([['VAR_A', 1]]), false, btn, zh, new Map());
	await null;
	ok('cart/pending: the HOST\'s string is what the button shows, not the default',
		btn.textContent === '正在前往付款…', btn.textContent);
	release(FAIL_502);
	await running;
	ok('cart/settled: the host\'s original label is restored', btn.textContent === '結帳', btn.textContent);
}

{
	// The widget's own default, with NO attribute passed — the string a bare sitetile
	// embed gets until it passes one. Asserted on readLabels so it is pinned as a
	// contract, not read back out of the button it was just written into.
	ok('the self-contained default is the English sentence', LABELS.checkoutPending === PENDING, LABELS.checkoutPending);
}

{
	// settle()'s optional override. NEITHER call site in square-shop.js passes one —
	// this file's paths answer a refusal in the -msg node — so it is asserted directly
	// on the exported helper rather than left as an untested parameter. It exists so the
	// helper stays byte-identical to the feelreef fork's copy, whose cart path DOES
	// write the failure label into the button (see PROVENANCE.md).
	const btn = fakeElement('button');
	btn.textContent = 'Checkout';
	const settle = beginPending(btn, PENDING);
	ok('beginPending: the override replaces the original label', (settle("Couldn't start checkout — try again."),
		btn.textContent === "Couldn't start checkout — try again."), btn.textContent);
	ok('beginPending: the override still clears disabled/aria-busy/-pending',
		btn.disabled === false && btn.getAttribute('aria-busy') === null && !btn.classList.contains('dc-square-shop-pending'));
}

{
	// 🔴 DISTRIBUTION check, and labelled so: this proves the CSS rule SHIPS in the
	// stylesheet the coral injects, nothing more. It says nothing about layout — there
	// is no layout engine in this file, so an assertion here that the button "keeps its
	// size" would be a measurement of nothing. The size guarantee lives in the rule; the
	// behavioural half (the class reaching the button) is the arms above.
	const src = readFileSync(new URL('./square-shop.js', import.meta.url), 'utf8');
	ok('the -pending CSS rule is in the injected stylesheet',
		src.includes('.${PREFIX}-pending { white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'));
	// 0.11.10 (finding #16, 2026-09-03 cold-read): the pending state also grew a small CSS-only
	// spinner (::after + @keyframes), reduced-motion-respecting like the skeleton shimmer above it.
	ok('the -pending state carries a reduced-motion-respecting spinner',
		src.includes('${PREFIX}-pending::after') && src.includes('@keyframes ${PREFIX}-spin')
		&& src.includes('.${PREFIX}-pending::after { animation: none;'));
	ok('data-checkout-pending-label is documented in the header comment',
		src.includes('data-checkout-pending-label (optional)'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
