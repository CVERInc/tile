// The site-wide inbox bubble's LOADER (reef#1921): what a page carries instead of the 159 KB coral.
//
// 🩸 WHY IT EXISTS. The layout mounts the bubble on every page of every site, and a build cannot know
// whether the owner ever opened the Inbox (that is a live platform setting — see the coral's claim
// gate). So every page of a site without one downloaded the whole coral, asked the platform, heard
// no, and drew nothing: 159 KB per page view to learn that there was nothing to show.
//
// 🔴 IT ASKS THE SAME QUESTION THE CORAL ASKS, AND ONLY WHEN THE CORAL WOULD ASK IT — and imports the
// coral only when the coral would draw. That is the whole design, and it is why behaviour is
// unchanged for every site that has a bubble:
//   • `data-kaito="1"` — the coral always draws (the full bubble or the ask-only one), so it is
//     imported at once and runs its own gate exactly as before. The loader sends nothing.
//   • a yes this browser heard within the coral's 30-day fallback window — the coral either trusts
//     it outright (six hours) or draws on it when nobody can answer, so again it is imported at once
//     and the loader sends nothing. That is every page after the first on a site with an Inbox.
//   • otherwise the coral's own gate would ask with no fallback, and its only outcomes are: yes ⇒
//     draw; no ⇒ nothing; could not ask ⇒ nothing (after its 2/8/30 s retries). The loader asks that
//     question on the same schedule, writes the yes down the way the coral does (so the coral, once
//     imported, finds it and sends no second request), and imports only on a yes.
// A site with no Inbox and no KAITO therefore pays this script and the one question it always paid —
// never the coral.
//
// 🔴 NOT A NEW BUBBLE. It draws nothing, adds no attribute and no node, and talks to no host the page
// did not already talk to: the coral's URL is the one the layout used to put in a <script src>.
//
// 🔴 A `reef-inbox:open` THAT ARRIVES BEFORE THE CORAL IS LISTENING IS HELD AND REPLAYED. The coral's
// own rule is that an open dispatched by a site's DOMContentLoaded handler must not be lost; with a
// <script src> the coral was listening before DOMContentLoaded, behind an import it may not be. So the
// loader listens from its first line, and once the coral has mounted (its listeners are installed
// synchronously at module evaluation) dispatches the one open it held. On a no, it is dropped — the
// coral would have dropped it too.
//
// `bubbleLoader` is the shipped code: the layout inlines `bubbleLoader.toString()`, and the tests
// call the same function with a stand-in window. So it may reference nothing outside its own body —
// no import, no module constant. (Not byte for byte in a real build: Vite re-prints the function —
// quotes, spacing — before `toString()` sees it; the astro smoke checks the built text separately.)
//
// 🔗 THE GATE BELOW MIRRORS THE CORAL'S (packages/dynamic-corals/inbox-bubble/inbox-bubble.js:
// `askInboxClaim`, `probeOnce`, `awaitInboxClaim`, `rememberedClaim`, `rememberClaim`, and the
// CLAIM_GATE_* constants). inbox-bubble-loader.test.mjs runs both against the same answers and fails
// on any difference in what is asked, how often, or what is drawn — that test, not this comment, is
// what keeps them in step.

// Reading guide for the body, whose comments are kept out of it because they would ship:
//   • `remembered` / `remember` — the coral's `rememberedClaim` (asked here with the 30-day fallback
//     window, which also covers the six-hour one) and `rememberClaim`: write a yes, forget on a no,
//     leave it alone when nobody answered. A store that refuses the write costs one more probe.
//   • `ask` / `gate` — `askInboxClaim` + `probeOnce` + `awaitInboxClaim` with no fallback.
//   • `drawsAnyway` — the cases where the coral draws without asking first; missing kind/id counts,
//     because the coral names that broken install on the page and that is for it to do.
//   • `load` — runs at most once per page (one call site). The coral mounts on DOMContentLoaded if it
//     arrives before it; its listener is registered first, so the replay still lands after the mount.
//   • `importer` exists for the tests; the inlined call passes only (src, window).
/* eslint-disable no-var */
export function bubbleLoader(src, win, importer) {
	var doc = win.document;
	var els = Array.prototype.slice.call(doc.querySelectorAll('[data-dynamic-coral="inbox-bubble"]'));
	if (!els.length) return Promise.resolve('none');
	var STALE = 30 * 24 * 60 * 60 * 1000;
	var RETRY = [2000, 8000, 30000];
	var TIMEOUT = 15000;
	var store = null;
	try { store = win.localStorage; } catch (e) { store = null; }
	var held = false;
	var hold = function () { held = true; };
	win.addEventListener('reef-inbox:open', hold);

	function key(t) { return 'reef-inbox:claim:' + t; }
	function remembered(t) {
		if (!store) return false;
		try {
			var raw = JSON.parse(store.getItem(key(t)));
			var now = Date.now();
			return !!raw && raw.claim === true && Number.isFinite(raw.at) && raw.at <= now && now - raw.at < STALE;
		} catch (e) { return false; }
	}
	function remember(t, claimed) {
		if (!store || typeof claimed !== 'boolean') return;
		try {
			if (claimed) store.setItem(key(t), JSON.stringify({ claim: true, at: Date.now() }));
			else store.removeItem(key(t));
		} catch (e) {}
	}
	function ask(base, kind, id) {
		var ctl = typeof win.AbortController === 'function' ? new win.AbortController() : null;
		var timer;
		var timeout = new Promise(function (resolve) {
			timer = win.setTimeout(function () { if (ctl) ctl.abort(); resolve({ answer: null, retry: true }); }, TIMEOUT);
		});
		var url = base + '/api/inbox/session?kind=' + encodeURIComponent(kind) + '&id=' + encodeURIComponent(id);
		var opts = { headers: { accept: 'application/json' } };
		if (ctl) opts.signal = ctl.signal;
		var req = Promise.resolve().then(function () { return win.fetch(url, opts); }).then(function (res) {
			if (!res.ok) return { answer: null, retry: !(res.status >= 400 && res.status < 500) };
			return res.json().then(function (body) {
				if (body && body.throttled === true) return { answer: null, retry: false };
				return typeof (body && body.claimed) === 'boolean' ? { answer: body.claimed, retry: false } : { answer: null, retry: true };
			});
		}).catch(function () { return { answer: null, retry: true }; });
		return Promise.race([req, timeout]).finally(function () { win.clearTimeout(timer); });
	}
	function gate(base, kind, id, attempt) {
		return ask(base, kind, id).then(function (r) {
			if (typeof r.answer === 'boolean') return r.answer;
			if (!r.retry || attempt >= RETRY.length) return null;
			return new Promise(function (resolve) { win.setTimeout(resolve, RETRY[attempt]); })
				.then(function () { return gate(base, kind, id, attempt + 1); });
		});
	}
	function tenant(el) {
		var kind = el.getAttribute('data-kind') || '';
		var id = el.getAttribute('data-id') || '';
		return { kind: kind, id: id, t: kind + ':' + id };
	}
	function drawsAnyway(el) {
		var x = tenant(el);
		return !x.kind || !x.id || el.getAttribute('data-kaito') === '1' || remembered(x.t);
	}
	function claimed(el) {
		var x = tenant(el);
		var base = (el.getAttribute('data-api-base') || 'https://feelreef.com').replace(/\/$/, '');
		return gate(base, x.kind, x.id, 0).then(function (answer) {
			remember(x.t, answer);
			return answer === true;
		});
	}
	function load() {
		return Promise.resolve().then(function () { return importer ? importer(src) : import(src); })
			.then(function () {
				var replay = function () {
					win.removeEventListener('reef-inbox:open', hold);
					if (held) win.dispatchEvent(new win.CustomEvent('reef-inbox:open'));
				};
				if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', replay);
				else replay();
				return 'loaded';
			});
	}
	if (els.some(drawsAnyway)) return load();
	return Promise.all(els.map(claimed)).then(function (answers) {
		if (answers.indexOf(true) >= 0) return load();
		win.removeEventListener('reef-inbox:open', hold);
		return 'skipped';
	});
}

/** The inline module the layout emits in place of `<script type="module" src="<coral>">`. */
// Leading indentation is dropped (no string literal in the body spans a line, so that is all it
// touches); the tests run this exact string, not only the function.
export function bubbleLoaderScript(src) {
	const body = bubbleLoader.toString().replace(/\n\t+/g, '\n');
	return `(${body})(${JSON.stringify(String(src)).replace(/</g, '\\u003c')},window);`;
}
