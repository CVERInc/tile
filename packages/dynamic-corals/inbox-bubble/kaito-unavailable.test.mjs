import test from 'node:test';
import assert from 'node:assert/strict';

// An unavailable KAITO (503) says the AI cannot answer instead of asking for a retry that will not
// work. Everything else that goes wrong keeps the existing error line. The DOM/network stand-ins
// below are the smallest ones that let the real `mount()` run, in the shape mount.test.mjs uses.

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
globalThis.fetch = async (url, init = {}) => {
	requests.push({ url, init });
	if (String(url).includes('/api/kaito')) return kaito();
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

const { mount, COPY } = await import('./inbox-bubble.js');

const panelOf = (el) => el.children[0].shadowRoot.children.find((c) => c.className === 'dc-inbox-root');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let seq = 0;
/** One visit: mount, open, ask one question while KAITO behaves as `respond`. `off-` ids have no Inbox. */
async function ask(respond, { askOnly = false } = {}) {
	kaito = respond;
	const el = new El({ 'data-kind': 'site', 'data-id': `${askOnly ? 'off-' : 't'}u${++seq}`, 'data-kaito': '1' });
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

const unavailable = () => ({ ok: false, status: 503, json: async () => ({ reason: 'kaito_unavailable' }) });
const status500 = () => ({ ok: false, status: 500, json: async () => ({}) });
const offline = () => { throw new TypeError('Failed to fetch'); };
const unreadable = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });

test('503 with the person door drawn: the AI-cannot-answer sentence names the person, and the button stays', async () => {
	const { shown } = await ask(unavailable);
	assert.ok(shown.includes(esc(COPY.en.kaitoUnavailableToHuman)), shown);
	assert.ok(shown.includes('dc-inbox-tohuman'), 'the person button is gone');
	assert.ok(shown.includes(esc(COPY.en.toHumanAfterRefusal)));
	assert.equal(shown.includes(esc(COPY.en.error)), false, 'the retry sentence is still shown');
});

test('503 on an ask-only bubble: the plain sentence and no person button', async () => {
	const { shown } = await ask(unavailable, { askOnly: true });
	assert.ok(shown.includes(esc(COPY.en.kaitoUnavailable)), shown);
	assert.equal(shown.includes(esc(COPY.en.kaitoUnavailableToHuman)), false);
	assert.equal(shown.includes('dc-inbox-tohuman'), false);
	assert.equal(shown.includes(esc(COPY.en.error)), false);
});

test('other failures keep the existing error line, with and without the person door', async () => {
	for (const [name, fail] of [['500', status500], ['thrown fetch', offline], ['unreadable body', unreadable]]) {
		for (const askOnly of [false, true]) {
			const { shown } = await ask(fail, { askOnly });
			assert.ok(shown.includes(esc(COPY.en.error)), `${name}/${askOnly}: ${shown}`);
			assert.equal(shown.includes('AI can&#39;t answer'), false, `${name}/${askOnly}: unavailable sentence leaked`);
			assert.equal(shown.includes('dc-inbox-tohuman'), !askOnly, `${name}/${askOnly}: person button`);
		}
	}
});

test('the person button after a 503 does what it did after a network failure', async () => {
	const handoffAfter = async (fail) => {
		const { log } = await ask(fail);
		const button = log.querySelector('.dc-inbox-tohuman');
		await button.emit('click');
		return button.html;
	};
	const after503 = await handoffAfter(unavailable);
	const afterOffline = await handoffAfter(offline);
	assert.match(after503, /dc-inbox-handoff/, 'the hand-off form was not drawn');
	assert.equal(after503, afterOffline);
});

test('every locale carries both new sentences, and the "to a person" one extends the plain one', () => {
	assert.deepEqual(Object.keys(COPY).sort(), ['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt-br', 'zh-cn', 'zh-tw']);
	for (const [locale, copy] of Object.entries(COPY)) {
		for (const key of ['kaitoUnavailable', 'kaitoUnavailableToHuman']) {
			assert.equal(typeof copy[key], 'string', `${locale}.${key}`);
			assert.ok(copy[key].trim().length > 0, `${locale}.${key} is empty`);
		}
		assert.notEqual(copy.kaitoUnavailable, copy.kaitoUnavailableToHuman, locale);
	}
});
