// The site-wide inbox bubble's LOADER (reef#1921): what a page carries instead of the 159 KB coral.
//
// 🩸 WHY IT EXISTS. The layout mounts the bubble on every page of every site, and a build cannot know
// whether the owner ever opened the Inbox (that is a live platform setting — see the coral's claim
// gate). So every page of a site without one downloaded the whole coral, asked the platform, heard
// no, and drew nothing: 159 KB per page view to learn that there was nothing to show.
//
// 🔴 IT ASKS THE SAME QUESTION THE CORAL ASKS, AND ONLY WHEN THE CORAL WOULD ASK IT — and imports the
// coral only when the coral would draw. That is the whole design, and it is why behaviour is
// unchanged for every site that has a bubble — given a coral at or above `CORAL_FLOOR` (below):
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
// 🔴 WHAT IT LEARNED REACHES THE CORAL IN MEMORY, NOT THROUGH STORAGE OR A REBROADCAST (codex review
// of tile#151, round 2). Before the import it puts `window.__reefInboxLoader = { v: 1, claims, open,
// taken }` on the page; the coral (0.7.12+, `takeLoaderHandoff` in inbox-bubble.js — the contract is
// written there) takes it in the same turn that installs its own listeners:
//   • `claims['<kind>:<id>']` — the gate's whole outcome for a tenant asked about here, so the coral
//     does not ask again. 🩸 Round 1 sent the yes through `localStorage` alone: where storage refuses
//     the write or the read, the coral asked again and a second no / throttled / 4xx took away the
//     bubble the first yes had earned.
//   • `open` — a `reef-inbox:open` nobody was listening for yet. The coral's own rule is that an open
//     dispatched by a site's DOMContentLoaded handler must not be lost, and behind an import the coral
//     may not be listening yet; so the loader listens from its first line and the coral honours what
//     it held. 🩸 Round 1 rebroadcast it after the import resolved — but the coral listens from its
//     own evaluation, before that, so an open in between was delivered twice. Once `taken` is set the
//     loader's listener records nothing and the loader replays nothing.
//
// 🔴 THIS LOADER NEEDS inbox-bubble ≥ `CORAL_FLOOR` ON THE `v0` CHANNEL. CORAL FIRST IS MANDATORY.
// The page imports the `v0` channel, and with a coral older than the floor (the engine shipped first,
// or the channel was rolled back) behaviour is NOT guaranteed to match the old <script src> (codex
// review of tile#151, round 2). Such a coral never takes the handoff, so the yes can reach it only
// through storage, and two fallbacks narrow — they do not close — that gap:
//   • `carries` — one throwaway write and read of a short key before the first question. Where storage
//     is uniformly broken (no storage, a throwing getter, every write or every read refused) the coral
//     is imported at once and asks its own one question, as the <script src> did. What it does NOT
//     prove: that the claim written LATER succeeds. A quota with room for the probe and not for the
//     claim, a script that clears storage between the write and the coral's read, or storage that
//     changes while the question is in flight all leave an older coral asking again — and a second
//     no / throttled / 4xx takes away the bubble the first yes earned. With the floor coral the
//     handed answer makes the probe redundant; it stays because on healthy storage it costs one
//     short write (two `storage` events in other same-origin tabs) and it keeps uniformly broken
//     storage on the eager path.
//   • the held open is replayed — but only what arrived before the coral evaluated: the registry's
//     stamp (`window.__coralVersions['inbox-bubble']`, the last statement of every published
//     artifact) marks the moment the coral's own listeners exist, and the loader stops recording then.
//     (While the document is still parsing the coral mounts later, on DOMContentLoaded, so until then
//     the loader keeps recording.) On a no, a held open is dropped — the coral would have dropped it.
//     An open dispatched synchronously from inside an older coral's own mount precedes the stamp and
//     is delivered twice.
// So: the coral reaches the floor before any page carries this loader, and never drops below it while
// one does — the checked procedure is the coral README's "Publishing". The emitted script names the
// floor (`/*inbox-bubble>=x.y.z*/`), so built pages can be searched for before a coral rollback.
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
//     leave it alone when nobody answered — still written, for the next page and for an older coral.
//   • `carries` — can storage take a short write and give it back right now? Its own key, removed at
//     once. Not a promise about any later write (see above).
//   • `ask` / `gate` — `askInboxClaim` + `probeOnce` + `awaitInboxClaim` with no fallback.
//   • `drawsAnyway` — the cases where the coral draws without asking first; missing kind/id counts,
//     because the coral names that broken install on the page and that is for it to do.
//   • `release` — the loader's listener and its handoff leave the page (an untaken handoff included).
//   • `load` — runs at most once per page (one call site). The coral mounts on DOMContentLoaded if it
//     arrives before it; its listener is registered first, so `settle` still runs after the mount.
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
	var handoff = { v: 1, claims: {}, open: false, taken: false };
	win.__reefInboxLoader = handoff;
	var hold = function () {
		var v = win.__coralVersions;
		if (!handoff.taken && !(doc.readyState !== 'loading' && v && v['inbox-bubble'])) handoff.open = true;
	};
	win.addEventListener('reef-inbox:open', hold);
	function release() {
		win.removeEventListener('reef-inbox:open', hold);
		if (win.__reefInboxLoader === handoff) {
			try { delete win.__reefInboxLoader; } catch (e) { win.__reefInboxLoader = undefined; }
		}
	}

	function key(t) { return 'reef-inbox:claim:' + t; }
	function remembered(t) {
		if (!store) return false;
		try {
			var raw = JSON.parse(store.getItem(key(t)));
			var now = Date.now();
			return !!raw && raw.claim === true && Number.isFinite(raw.at) && raw.at <= now && now - raw.at < STALE;
		} catch (e) { return false; }
	}
	function carries() {
		if (!store) return false;
		try {
			store.setItem('reef-inbox:loader', '1');
			var back = store.getItem('reef-inbox:loader');
			store.removeItem('reef-inbox:loader');
			return back === '1';
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
			handoff.claims[x.t] = answer;
			return answer === true;
		});
	}
	function load() {
		return Promise.resolve().then(function () { return importer ? importer(src) : import(src); })
			.then(function () {
				var settle = function () {
					release();
					if (!handoff.taken && handoff.open) win.dispatchEvent(new win.CustomEvent('reef-inbox:open'));
				};
				if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', settle);
				else settle();
				return 'loaded';
			});
	}
	if (els.some(drawsAnyway) || !carries()) return load();
	return Promise.all(els.map(claimed)).then(function (answers) {
		if (answers.indexOf(true) >= 0) return load();
		release();
		return 'skipped';
	});
}

/**
 * The oldest inbox-bubble the `v0` channel may serve to a page carrying this loader: the first one
 * that takes `window.__reefInboxLoader` (inbox-bubble.js `LOADER_HANDOFF_SINCE`). The loader test
 * fails if the two drift apart, or if the coral's own version falls below it.
 */
export const CORAL_FLOOR = '0.7.12';

/** The inline module the layout emits in place of `<script type="module" src="<coral>">`. */
// Leading indentation is dropped (no string literal in the body spans a line, so that is all it
// touches); the tests run this exact string, not only the function. The leading comment names the
// coral floor on every built page — what to search a site's HTML for before rolling the coral back.
// A page that needs a newer coral than the loader does names that one instead (`floor`: the
// installed-app bar's pages need the inbox that joins it, lib/appbar.mjs APPBAR_CORAL_FLOOR).
export function bubbleLoaderScript(src, floor = CORAL_FLOOR) {
	const body = bubbleLoader.toString().replace(/\n\t+/g, '\n');
	return `/*inbox-bubble>=${floor}*/(${body})(${JSON.stringify(String(src)).replace(/</g, '\\u003c')},window);`;
}
