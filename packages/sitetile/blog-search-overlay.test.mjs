import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// reef#2161 — the search overlay and the nav-mobile drawer are two overlays with one rule:
// only one of them is open. The drawer is a CSS checkbox (`#rf-nav-toggle`, body:has(:checked));
// search is `html[data-search-open]`. tile#156 made `open()` uncheck the drawer; this file proves
// BOTH directions against the real island, mounted on the smallest DOM that lets it run, in the
// shape of inbox-bubble/mount.test.mjs.
//
// 🔴 WHAT THIS IS NOT. No layout, no stacking contexts, no real events — "on top" here means the
// state the CSS keys off, and the z-index test below reads the stylesheet's own tokens. The visible
// outcome at phone width is real-render/search-drawer.smoke.mjs's subject (Playwright-gated).

const HERE = dirname(fileURLToPath(import.meta.url));
const ISLAND = join(HERE, 'astro/src/packages/blog-search/blog-search.js');
const HA_ISLAND = join(HERE, 'astro/src/packages/header-actions/header-actions.js');

class El {
	constructor(attrs = {}) {
		this.attrs = { ...attrs };
		this.listeners = {};
		this.children = [];
		this.value = '';
		this.hidden = false;
		this.dataset = {};
		this.textContent = '';
		this.checked = false;
		this.tagName = attrs.tagName || 'DIV';
		this.parentNode = null;
		this.focused = 0;
	}
	getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
	setAttribute(name, value) { this.attrs[name] = String(value); }
	removeAttribute(name) { delete this.attrs[name]; }
	hasAttribute(name) { return name in this.attrs; }
	addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
	appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
	focus() { this.focused += 1; }
	/** Bubbles up the parent chain, like a browser event with `bubbles: true`. */
	dispatchEvent(ev) {
		// A real `Event` (header-actions.js dispatches one) has a read-only `target`; a plain-object
		// event from a test below has none. Neither listener here reads it, so set it only when it can be set.
		if (!(ev instanceof Event)) ev.target ??= this;
		let node = this;
		while (node) {
			for (const fn of node.listeners[ev.type] || []) fn.call(node, ev);
			node = ev.bubbles ? node.parentNode : null;
		}
		return true;
	}
	/** A user click on the element: listeners run, and a checkbox flips + fires `change` first. */
	click() {
		if (this.attrs.type === 'checkbox') {
			this.checked = !this.checked;
			this.dispatchEvent({ type: 'change', bubbles: true });
		}
		this.dispatchEvent({ type: 'click', bubbles: true });
	}
}

/**
 * A page with the header-overlay search wired, and — unless `desktop` — the nav-mobile drawer
 * checkbox. Returns the live nodes so a test drives them the way a visitor would.
 */
async function mount({ desktop = false } = {}) {
	const root = new El({ tagName: 'HTML' });
	const body = root.appendChild(new El({ tagName: 'BODY' }));
	const byId = new Map();
	const bySelector = new Map();
	const add = (sel, el) => { bySelector.set(sel, el); body.appendChild(el); return el; };
	const toggle = add('[data-search-toggle]', new El({ tagName: 'BUTTON' }));
	const input = add('[data-search-input]', new El({ tagName: 'INPUT', type: 'search' }));
	add('[data-search-results]', new El({ tagName: 'UL' }));
	add('[data-search-count]', new El({ tagName: 'P' }));
	add('[data-search-empty]', new El({ tagName: 'P' }));
	const closeBtn = add('[data-search-close]', new El({ tagName: 'BUTTON' }));
	let drawer = null;
	let hamburger = null;
	if (!desktop) {
		drawer = body.appendChild(new El({ tagName: 'INPUT', type: 'checkbox', id: 'rf-nav-toggle', 'data-ha-toggle': '' }));
		byId.set('rf-nav-toggle', drawer);
		hamburger = body.appendChild(new El({ tagName: 'LABEL', for: 'rf-nav-toggle', 'data-ha-key': '' }));
	}
	const document = {
		documentElement: root,
		body,
		listeners: {},
		querySelector: (sel) => bySelector.get(sel) || null,
		querySelectorAll: (sel) => {
			if (sel === '[data-search-close]') return [closeBtn];
			if (sel === '[data-ha-toggle]') return drawer ? [drawer] : [];
			if (sel === 'label[data-ha-key]') return hamburger ? [hamburger] : [];
			return [];
		},
		getElementById: (id) => byId.get(id) || null,
		createElement: (tag) => new El({ tagName: tag.toUpperCase() }),
		addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
	};
	root.parentNode = document; // events bubble from the drawer up to the document
	globalThis.document = document;
	globalThis.window = { location: { search: '', href: '' }, history: { replaceState() {} } };
	globalThis.requestAnimationFrame = (fn) => fn();
	globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
	// A fresh module instance per mount: the island is an IIFE that reads the document on import.
	await import(`${ISLAND}?mount=${Date.now()}-${Math.random()}`);
	if (!desktop) await import(`${HA_ISLAND}?mount=${Date.now()}-${Math.random()}`);
	const searchOpen = () => root.hasAttribute('data-search-open');
	return { root, toggle, input, drawer, hamburger, searchOpen };
}

test('reef#2161: with the menu open, opening search closes the menu (tile#156)', async () => {
	const { toggle, drawer, searchOpen } = await mount();
	drawer.click();
	assert.equal(drawer.checked, true, 'precondition: the drawer is open');
	toggle.click();
	assert.equal(searchOpen(), true, 'search is open');
	assert.equal(drawer.checked, false, 'opening search closes the nav drawer');
});

test('reef#2161: with search open, opening the menu closes search', async () => {
	const { toggle, drawer, searchOpen } = await mount();
	toggle.click();
	assert.equal(searchOpen(), true, 'precondition: search is open');
	drawer.click();
	assert.equal(drawer.checked, true, 'the drawer is open');
	assert.equal(searchOpen(), false, 'opening the nav drawer closes search');
});

test('reef#2161: the keyboard shim (Enter on the hamburger label) is the same open as a tap', async () => {
	const { toggle, drawer, hamburger, searchOpen } = await mount();
	toggle.click();
	assert.equal(searchOpen(), true, 'precondition: search is open');
	hamburger.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
	assert.equal(drawer.checked, true, 'Enter opened the drawer');
	assert.equal(searchOpen(), false, 'a keyboard-opened drawer closes search too');
});

test('reef#2161: closing the menu does not touch search', async () => {
	const { drawer, searchOpen } = await mount();
	drawer.click();
	drawer.click();
	assert.equal(drawer.checked, false);
	assert.equal(searchOpen(), false, 'search stays closed; only an OPENING drawer acts');
});

test('reef#2161: desktop (no nav-mobile drawer) — search opens and closes, nothing throws', async () => {
	const { toggle, input, searchOpen, drawer } = await mount({ desktop: true });
	assert.equal(drawer, null);
	toggle.click();
	assert.equal(searchOpen(), true);
	assert.equal(input.focused, 1, 'the input took focus');
	document.listeners.keydown.forEach((fn) => fn({ key: 'Escape', target: input }));
	assert.equal(searchOpen(), false, 'Escape closes it');
});

// ── negative control: the stacking relation is a token relation, not two magic numbers ────────
// Reads the stylesheet the way the browser would resolve it: `--rf-z-*` custom properties on
// :root, with `calc(var(--x) + n)` folded. Asserts the ORDER (search < open nav header), never
// the literal values.
test('reef#2161: search layer and open-nav header z-index come from one token scale, nav on top', () => {
	const css = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8');
	const tokens = {};
	for (const m of css.matchAll(/--rf-z-[\w-]+:\s*([^;]+);/g)) tokens[m[0].split(':')[0].trim()] = m[1].trim();
	// Folds the three shapes the scale uses: an integer, `var(--rf-z-*)`, and `calc(A ± B)` where
	// A and B are either of those (the floor is `calc(<int> + <int>)` — see the 🩸 beside it).
	const resolve = (expr, depth = 0) => {
		assert.ok(depth < 10, `token cycle in ${expr}`);
		expr = expr.trim();
		const v = expr.match(/^var\((--rf-z-[\w-]+)\)$/);
		if (v) { assert.ok(tokens[v[1]], `${v[1]} is not defined on :root`); return resolve(tokens[v[1]], depth + 1); }
		const c = expr.match(/^calc\((.+?)\s*([+-])\s*(\S+)\)$/);
		if (c) return resolve(c[1], depth + 1) + (c[2] === '-' ? -1 : 1) * resolve(c[3], depth + 1);
		assert.match(expr, /^\d+$/, `z-index expression "${expr}" is neither a token nor an integer`);
		return Number(expr);
	};
	const zOf = (selectorRe, label) => {
		const rule = css.match(new RegExp(selectorRe.source + String.raw`[^{]*\{[^}]*?z-index:\s*([^;!]+?)\s*(?:!important)?;`));
		assert.ok(rule, `${label}: rule with a z-index not found`);
		assert.match(rule[1], /var\(--rf-z-/, `${label}: z-index is a literal (${rule[1]}), not a --rf-z-* token`);
		return resolve(rule[1]);
	};
	const search = zOf(/\.st-search\s/, 'search overlay');
	const navOpen = zOf(/body\[data-nav-mobile\]:has\(#rf-nav-toggle:checked\) \.rf-header\s/, 'open-nav header lift');
	assert.ok(search < navOpen, `the open-nav header (${navOpen}) must outrank the search layer (${search}) — same scale, nav above`);
	assert.ok(Number.isInteger(search) && Number.isInteger(navOpen), 'z-index resolves to integers');
});
