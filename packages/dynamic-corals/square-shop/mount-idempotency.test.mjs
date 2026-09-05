// square-shop — the MOUNT contract, driven through the real exported `mount` / `mountAll`.
//
// Why this file exists. The exports have shipped since 0.11.0 and until now **nothing in
// this repo drove either of them** (`grep mountAll *.test.mjs` → 0 hits). They are not
// decoration: feelreef's SPA wrapper (`apps/feelreef/src/lib/corals/square_shop/Render.svelte`)
// calls `mountAll()` on EVERY client-navigation `onMount`, because a side-effect import is
// cached by the module system and the self-mount tail therefore runs exactly once per page
// load. So on a SvelteKit client navigation to a second square-shop card, that explicit
// `mountAll()` is the only thing that mounts it — and it necessarily also re-scans the card
// that is already mounted. Both halves of that are contract:
//
//   idempotent  — an already-mounted host is NOT mounted a second time (a second mount
//                 re-fetches the catalog and re-renders under the first render's nodes);
//   not inert   — a host that appeared since the last scan IS mounted.
//
// A guard that got either half wrong looks fine on a static page and only misbehaves on the
// one substrate that has client navigation, which is exactly the substrate with no test here.
//
// 🔴 The import comes FIRST, with no `document` installed yet, on purpose — twice over:
//   1. the tail's `typeof document !== 'undefined'` guard is the only reason this module can
//      be imported under node at all, so a regression there fails this file at load; and
//   2. it keeps the tail's own self-mount out of the counts below. Every mount this file
//      measures is one it asked for. A stub installed before the import would blend the two
//      and a broken `mountAll` could be masked by the tail having already run.
import { mount, mountAll } from './square-shop.js';

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

// ── the smallest DOM mount()/mountAll() actually touch ───────────────────
// mount(): injectStyles() → document.createElement + document.head.appendChild; then
// classList.add, getAttribute×N, and (on the path taken here) one innerHTML write.
// mountAll(): document.querySelectorAll(SELECTOR).forEach + get/setAttribute on each host.
function fakeElement(tag) {
	const el = {
		tagName: tag,
		className: '',
		textContent: '',
		innerHTML: '',
		children: [],
		attrs: {},
		setAttribute(k, v) { this.attrs[k] = String(v); },
		getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
		removeAttribute(k) { delete this.attrs[k]; },
		appendChild(child) { this.children.push(child); return child; },
		// mount() asks for `.dc-square-shop-grid[data-ssr]` — the edge worker's pre-rendered
		// grid — before it decides to fetch. Answered by actually looking, not by a hardcoded
		// null: a shim that always says "no SSR" would report the same thing whether or not
		// the SSR fast path still exists. Nothing here builds one, so it is legitimately null.
		querySelector(sel) {
			const m = /^\.([\w-]+)(?:\[([\w-]+)\])?$/.exec(sel);
			if (!m) throw new Error(`fake querySelector cannot parse: ${sel}`);
			for (const c of this.children) {
				const hasClass = String(c.className).split(/\s+/).indexOf(m[1]) >= 0;
				if (hasClass && (!m[2] || c.getAttribute(m[2]) !== null)) return c;
			}
			return null;
		}
	};
	// className and classList are two views of ONE string in a real DOM; backing the shim
	// with el.className keeps a divergence from passing here and failing in a browser.
	el.classList = {
		add(c) {
			const s = String(el.className).split(/\s+/).filter(Boolean);
			if (s.indexOf(c) < 0) s.push(c);
			el.className = s.join(' ');
		},
		contains(c) { return String(el.className).split(/\s+/).indexOf(c) >= 0; }
	};
	return el;
}

// The document's hosts, i.e. what querySelectorAll(SELECTOR) can find. Only elements put
// in here are visible to mountAll — adding one models a client navigation bringing a
// second card onto the page.
let hosts = [];
function newHost(guildId) {
	const el = fakeElement('div');
	el.setAttribute('data-dynamic-coral', 'square-shop');
	el.setAttribute('data-guild-id', guildId);
	el.setAttribute('data-api-base', 'https://rsp.test');
	return el;
}

globalThis.document = {
	createElement: fakeElement,
	head: fakeElement('head'),
	// The real selector is '[data-dynamic-coral="square-shop"]'. Rather than parse it, this
	// answers from the attribute the selector names — so a host that did not set it is not
	// found, the same way a real querySelectorAll would not find it.
	querySelectorAll(sel) {
		ok.lastSelector = sel;
		return hosts.filter((h) => h.getAttribute('data-dynamic-coral') === 'square-shop');
	}
};
globalThis.window = { location: { href: '', origin: 'https://shop.test', pathname: '/shop' } };

// ── the ruler ────────────────────────────────────────────────────────────
// 🔴 "Did a mount happen?" is counted at the CATALOG FETCH, not at a DOM side effect.
// Every real mount calls fetchCatalog exactly once, and a second mount of the same host
// would write the same nodes over the first — indistinguishable by inspecting the host.
// A counter that cannot tell one mount from two is the whole defect this file guards.
let catalogFetches = [];
globalThis.fetch = async (url) => {
	catalogFetches.push(String(url));
	// An empty-but-connected shop: mount() renders its "nothing here" line and returns,
	// so no cart, localStorage or stepper is dragged into a test about mounting.
	return {
		ok: true,
		status: 200,
		json: async () => ({ connected: true, items: [] })
	};
};

/** mountAll() fires mount() without awaiting it; let the microtasks it queued settle. */
async function settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

const GUARD = 'data-dynamic-coral-mounted';

// ── 1 · it mounts what is there ──────────────────────────────────────────
{
	hosts = [newHost('g-1')];
	catalogFetches = [];
	mountAll();
	await settle();

	ok('mountAll() mounts a host that is on the page', catalogFetches.length === 1,
		`fetches=${catalogFetches.length}`);
	ok('…and it is the catalog for that host', catalogFetches[0] === 'https://rsp.test/api/v2/shop/catalog?guild_id=g-1',
		catalogFetches[0]);
	ok('…and mount() ran on it (the widget class is on the host)', hosts[0].classList.contains('dc-square-shop'));
	ok(`…and the host is stamped ${GUARD}="1"`, hosts[0].getAttribute(GUARD) === '1',
		String(hosts[0].getAttribute(GUARD)));
}

// ── 2 · calling it again does not mount it again ─────────────────────────
// This is the assertion feelreef's Render.svelte leans on: it re-runs mountAll() on every
// client navigation, so every already-visible card is re-scanned every time.
{
	catalogFetches = [];
	mountAll();
	await settle();
	mountAll();
	await settle();

	ok('mountAll() twice more over an already-mounted host re-mounts nothing',
		catalogFetches.length === 0, `fetches=${catalogFetches.length}`);
}

// ── 3 · idempotent must not mean inert ───────────────────────────────────
// The failure mode on the other side of the guard, and the one a naive "return early if
// we have run before" would introduce: the second card on a client-navigated page never
// mounts. Asserted in the same arm as "the first one is left alone", because a test that
// only ever checks one of the two passes on either bug.
{
	const second = newHost('g-2');
	hosts.push(second);
	catalogFetches = [];
	mountAll();
	await settle();

	ok('a host added since the last scan IS mounted', catalogFetches.length === 1,
		`fetches=${catalogFetches.length}`);
	ok('…and it is the NEW host, not the old one',
		catalogFetches[0] === 'https://rsp.test/api/v2/shop/catalog?guild_id=g-2', catalogFetches[0]);
	ok('…and the already-mounted host was still skipped in that same pass',
		catalogFetches.length === 1 && !catalogFetches.some((u) => u.includes('g-1')));
	ok('…and the new host is stamped too', second.getAttribute(GUARD) === '1');
}

// ── 4 · the control: the stamp is what does it ───────────────────────────
// Without this arm, arms 2 and 3 are also green if mountAll skipped hosts for some other
// reason entirely (a cached node list, a module-level "already ran" flag). Clearing the
// attribute must bring the host back — that is what proves the guard is the mechanism.
{
	hosts[0].removeAttribute(GUARD);
	catalogFetches = [];
	mountAll();
	await settle();

	ok(`clearing ${GUARD} makes the host mountable again (the stamp is the guard)`,
		catalogFetches.length === 1 && catalogFetches[0].includes('g-1'),
		`fetches=${catalogFetches.length} ${catalogFetches[0] || ''}`);
}

// ── 5 · mount() itself carries no guard, deliberately ────────────────────
// 🔴 Recorded because it is the opposite of what "idempotent mount" invites you to assume,
// and `mount` is exported: the guard lives in mountAll, NOT in mount. mount(el) is the
// imperative entry point — it re-fetches and re-renders whatever you hand it, which is
// what makes it usable for driving one specific host (checkout-ref.test.mjs and feelreef's
// cart-client-request-ref.svelte.test.ts both rely on that) and for a deliberate refresh.
// feelreef's wrapper calls mountAll(), which is the guarded one, so this is safe there.
// If this ever DOES become a no-op, that is a contract change and this assertion is the
// place it gets noticed rather than a card silently failing to redraw.
{
	catalogFetches = [];
	await mount(hosts[0]);

	ok('mount() on an already-mounted host DOES re-mount (no guard in mount, by design)',
		catalogFetches.length === 1, `fetches=${catalogFetches.length}`);
}

// ── 6 · the tail is still there, and still guarded ───────────────────────
// Behavioural, not a source grep: this file imported the module at the top with no
// `document`, and that import neither threw nor mounted anything. Both facts are only
// true if the `typeof document !== 'undefined'` wrapper is intact — a browser embed with
// no caller still gets its auto-mount, and node can still import the module.
{
	ok('importing with no document neither threw nor self-mounted (the tail stays guarded)',
		typeof mountAll === 'function' && typeof mount === 'function');
	ok('mountAll queried the documented selector', ok.lastSelector === '[data-dynamic-coral="square-shop"]',
		String(ok.lastSelector));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
