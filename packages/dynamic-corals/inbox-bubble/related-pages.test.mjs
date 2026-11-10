import test from 'node:test';
import assert from 'node:assert/strict';

// A KAITO refusal may carry `related`: page URLs the visitor might want, shown as plain search
// results under the unchanged refusal sentence. The label is the page's title from the site's own
// search index, or its decoded path. Never passage text. Only same-origin http(s) links survive.
// The DOM/network stand-ins are kaito-unavailable.test.mjs's, plus a search index.

class El {
	constructor(attrs = {}) {
		this.attrs = attrs;
		this.listeners = {};
		this.nodes = new Map();
		this.children = [];
		this.value = '';
		this.style = {};
		this.html = '';
	}
	#parent = { insertBefore() {} };
	get parentNode() { return this.#parent; }
	set parentNode(node) { this.#parent = node; }
	getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
	setAttribute(name, value) { this.attrs[name] = value; }
	removeAttribute(name) { delete this.attrs[name]; }
	addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
	appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
	attachShadow() { this.shadowRoot = new El(); return this.shadowRoot; }
	insertAdjacentHTML(_where, value) { this.html += value; }
	remove() {}
	set innerHTML(value) { this.html = value; this.nodes.clear(); }
	get innerHTML() { return this.html; }
	querySelector(selector) {
		if (!this.nodes.has(selector)) this.nodes.set(selector, new El());
		return this.nodes.get(selector);
	}
	focus() {}
	async emit(type) {
		for (const fn of this.listeners[type] ?? []) await fn({ preventDefault() {} });
	}
}

const storage = new Map();
globalThis.window = {
	localStorage: {
		getItem: (k) => (storage.has(k) ? storage.get(k) : null),
		setItem: (k, v) => storage.set(k, v),
		removeItem: (k) => storage.delete(k)
	},
	addEventListener() {},
	removeEventListener() {}
};
globalThis.document = {
	readyState: 'loading',
	addEventListener() {},
	documentElement: new El({ lang: 'en' }),
	head: new El(),
	createElement: () => new El(),
	querySelector: () => null,
	querySelectorAll: () => []
};
globalThis.location = { hash: '', hostname: 'example.test', href: 'https://example.test/' };
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
Object.defineProperty(globalThis, 'navigator', {
	value: { sendBeacon: () => true }, configurable: true, writable: true
});

const requests = [];
let kaito = null; // what POST /api/kaito does: returns a response or throws
const INDEX = [
	{ t: 'Shipping FAQ', u: '/faq/', g: [], d: '', i: '', e: '' },
	{ t: 'Prices <b>2026</b>', u: 'https://example.test/prices', g: [], d: '', i: '', e: '' },
	{ t: 'Elsewhere', u: 'https://other.test/faq/', g: [], d: '', i: '', e: '' }
];
globalThis.fetch = async (url, init = {}) => {
	requests.push({ url, init });
	if (String(url).includes('/api/kaito')) return kaito();
	if (String(url).includes('/search-index.json')) return { ok: true, status: 200, json: async () => INDEX };
	if (String(url).includes('/api/inbox/session') && init.method !== 'POST') {
		const id = new URL(url).searchParams.get('id');
		return { ok: true, status: 200, json: async () => ({ ok: true, claimed: !id.startsWith('off-') }) };
	}
	return { ok: false, status: 500, json: async () => ({}) };
};

const settle = () => new Promise((r) => setTimeout(r, 0));
async function drain() {
	for (let i = 0; i < 40; i++) await settle();
	await new Promise((r) => setTimeout(r, 30));
}

const { mount, COPY, relatedLinks, relatedListHtml, RELATED_MAX } = await import('./inbox-bubble.js');

const panelOf = (el) => el.children[0].shadowRoot.children.find((c) => c.className === 'dc-inbox-root');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let seq = 0;
/** One visit: mount, open, ask one question while KAITO behaves as `respond`. `off-` ids have no Inbox. */
async function ask(respond, { askOnly = false, index = false } = {}) {
	kaito = respond;
	const attrs = { 'data-kind': 'site', 'data-id': `${askOnly ? 'off-' : 't'}u${++seq}`, 'data-kaito': '1' };
	if (index) attrs['data-search-index'] = 'https://example.test/search-index.json';
	const el = new El(attrs);
	await mount(el);
	await drain();
	const root = panelOf(el);
	await root.querySelector('.dc-inbox-open').emit('click');
	root.querySelector('.dc-inbox-form').querySelector('textarea').value = 'do you ship to Japan?';
	root.nodes.set('textarea', root.querySelector('.dc-inbox-form').querySelector('textarea'));
	await root.querySelector('.dc-inbox-form').emit('submit');
	await drain();
	const log = root.querySelector('.dc-inbox-log');
	return { root, log, shown: log.innerHTML };
}


const PAGE = 'https://example.test/somewhere/';
const refusal = (related) => () => ({
	ok: true,
	status: 200,
	json: async () => ({ kind: 'refused', text: 'server refusal', ...(related ? { related } : {}) })
});
const PASSAGE = 'We ship to Japan within five days.';
const grounded = () => ({
	ok: true,
	status: 200,
	json: async () => ({ kind: 'grounded', text: PASSAGE, source_url: 'https://example.test/faq/#ship', related: [{ url: 'https://example.test/faq/' }] })
});

test('relatedLinks: index titles by path; the decoded path when the index does not list it', () => {
	const links = relatedLinks(
		['https://example.test/faq/#a', 'https://example.test/prices/', 'https://example.test/%E9%97%9C%E6%96%BC/'],
		INDEX,
		PAGE
	);
	assert.deepEqual(links, [
		{ href: 'https://example.test/faq/', label: 'Shipping FAQ' },
		{ href: 'https://example.test/prices/', label: 'Prices <b>2026</b>' },
		{ href: 'https://example.test/%E9%97%9C%E6%96%BC/', label: '/關於/' }
	]);
	// No index at all: every label is the path.
	assert.deepEqual(relatedLinks(['https://example.test/faq/'], [], PAGE), [{ href: 'https://example.test/faq/', label: '/faq/' }]);
});

test('relatedLinks: only same-origin http(s) URLs survive, without fragments, deduplicated, capped', () => {
	const links = relatedLinks(
		[
			'javascript:alert(1)',
			' java\nscript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'https://other.test/faq/',
			'//other.test/faq/',
			'/faq/',
			'http://example.test/faq/',
			'https://example.test/faq/#x',
			'https://example.test/faq/#y',
			{ url: 'https://example.test/a/' },
			'https://example.test/b/',
			'https://example.test/c/'
		],
		INDEX,
		PAGE
	);
	assert.deepEqual(
		links.map((l) => l.href),
		['https://example.test/faq/', 'https://example.test/a/', 'https://example.test/b/']
	);
	assert.equal(links.length, RELATED_MAX);
	assert.deepEqual(relatedLinks('not an array', INDEX, PAGE), []);
	// An index row on another origin lends no title to a same-path page here.
	assert.equal(relatedLinks(['https://example.test/elsewhere/'], INDEX, PAGE)[0].label, '/elsewhere/');
});

test('relatedListHtml: a hostile title or URL is escaped; an empty list draws nothing', () => {
	const html = relatedListHtml(
		[{ href: 'https://example.test/"><img src=x onerror=alert(1)>/', label: '<script>alert(1)</script>' }],
		'Heading & <i>more</i>'
	);
	assert.equal(html.includes('<script>'), false, html);
	assert.equal(html.includes('<img'), false, html);
	assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), html);
	assert.ok(html.includes('&quot;&gt;&lt;img'), html);
	assert.ok(html.includes('Heading &amp; &lt;i&gt;more&lt;/i&gt;'), html);
	assert.equal(relatedListHtml([], 'x'), '');
	assert.equal(relatedListHtml(undefined, 'x'), '');
});

test('a refusal with related: the refusal sentence first, then the heading and the titled links', async () => {
	const { shown } = await ask(refusal([{ url: 'https://example.test/faq/#a' }, { url: 'https://example.test/nowhere/' }]), { index: true });
	const sentence = shown.indexOf(esc(COPY.en.refused));
	const heading = shown.indexOf(esc(COPY.en.relatedHeading));
	assert.ok(sentence > -1 && heading > sentence, shown);
	assert.ok(shown.includes('<a href="https://example.test/faq/">Shipping FAQ</a>'), shown);
	assert.ok(shown.includes('<a href="https://example.test/nowhere/">/nowhere/</a>'), shown);
	assert.ok(shown.indexOf('dc-inbox-tohuman') > heading, 'the person button is no longer after the list');
});

test('without a search index the links fall back to their paths', async () => {
	const { shown } = await ask(refusal([{ url: 'https://example.test/faq/' }]));
	assert.ok(shown.includes('<a href="https://example.test/faq/">/faq/</a>'), shown);
});

test('no list on a refusal without related, on one whose links are all unsafe, or on a grounded answer', async () => {
	for (const [name, respond] of [
		['no related', refusal(null)],
		['empty related', refusal([])],
		['unsafe only', refusal([{ url: 'javascript:alert(1)' }, { url: 'https://other.test/x/' }])],
		['grounded', grounded]
	]) {
		const { shown } = await ask(respond, { index: true });
		assert.equal(shown.includes('dc-inbox-related'), false, `${name}: ${shown}`);
		assert.equal(shown.includes(esc(COPY.en.relatedHeading)), false, name);
	}
	const { shown } = await ask(grounded, { index: true });
	assert.ok(shown.includes(esc(PASSAGE)), 'the grounded passage itself still shows');
});

test('the refusal sentence is the coral\'s own copy, unchanged by related', async () => {
	const plain = (await ask(refusal(null))).shown;
	const withLinks = (await ask(refusal([{ url: 'https://example.test/faq/' }]))).shown;
	assert.ok(plain.includes(esc(COPY.en.refused)));
	assert.ok(withLinks.includes(`<div class="dc-inbox-msg dc-inbox-msg-owner">${esc(COPY.en.refused)}</div>`), withLinks);
	assert.equal(withLinks.includes('server refusal'), false);
});

test('every COPY table carries relatedHeading; zh-tw and ja are their own, the rest are English for now', () => {
	for (const [locale, copy] of Object.entries(COPY)) {
		assert.equal(typeof copy.relatedHeading, 'string', locale);
		assert.ok(copy.relatedHeading.trim().length > 0, locale);
	}
	assert.equal(COPY.en.relatedHeading, 'Possibly related pages');
	assert.notEqual(COPY['zh-tw'].relatedHeading, COPY.en.relatedHeading);
	assert.notEqual(COPY.ja.relatedHeading, COPY.en.relatedHeading);
	for (const locale of ['zh-cn', 'de', 'fr', 'es', 'pt-br', 'ko']) assert.equal(COPY[locale].relatedHeading, COPY.en.relatedHeading, locale);
});
