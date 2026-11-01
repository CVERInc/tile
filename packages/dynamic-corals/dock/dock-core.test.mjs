// dock-core.mjs — the parts of an item that are rules rather than layout: which links are allowed,
// which names a hash may open, and that the built bundle carries the shared base. Opening, closing,
// stacking, retiring and the installed-app bar are measured in a browser by dock.smoke.mjs.
//   run: node --test packages/dynamic-corals/dock/dock-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeItemHref, itemName, autoKey, closeLabel, mountItem, _resetAutoOpen } from './dock-core.mjs';

test('a link item goes to http(s), mailto, tel, a fragment or a same-site path — nothing else', () => {
  for (const ok of ['https://line.me/R/ti/p/@x', 'http://a.test/', 'mailto:a@b.test', 'tel:+81312345678', '#top', '/contact', './a', '../b']) {
    assert.equal(safeItemHref(ok), ok, ok);
  }
  for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'java\nscript:x', 'data:text/html,x', '//evil.test/x', 'vbscript:x', '']) {
    assert.equal(safeItemHref(bad), null, JSON.stringify(bad));
  }
});

test('#name: a short token opens a panel; anything else names nothing', () => {
  const el = (v) => ({ getAttribute: () => v });
  assert.equal(itemName(el('cohort6')), 'cohort6');
  assert.equal(itemName(el(' sale-2026 ')), 'sale-2026');
  for (const bad of [null, '', '1 2', 'a"b', 'x'.repeat(65), '#sale']) assert.equal(itemName(el(bad)), '', String(bad));
});

test('the built bundle carries the shared base, one copy, bundled in', () => {
  const bundle = readFileSync(new URL('./dock.js', import.meta.url), 'utf8');
  assert.match(bundle, /dc-dock:open/);
  assert.match(bundle, /function dockJoin\(/);
  assert.equal((bundle.match(/function dockJoin\(/g) || []).length, 1);
});

test('once per visit: the key is the item\'s name, else its corner and its label — never empty', () => {
  const el = (attrs) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null), querySelector: () => null });
  assert.equal(autoKey(el({ 'data-open-on-hash': 'cohort6', 'data-label': 'X' })), 'dc-dock:cohort6');
  assert.equal(autoKey(el({ 'data-label': 'Sale ends soon' })), 'dc-dock:right:Sale ends soon');
  assert.equal(autoKey(el({ 'data-label': 'Sale ends soon', 'data-dock': 'left' })), 'dc-dock:left:Sale ends soon');
  // Two unnamed items in different corners, or with different labels, are remembered apart.
  assert.notEqual(autoKey(el({ 'data-label': 'A' })), autoKey(el({ 'data-label': 'B' })));
});

test('the open bubble is called "Close <label>" in the page\'s language (the inbox\'s nine; cold review N2)', () => {
  for (const [lang, word] of [['en', 'Close'], ['en-US', 'Close'], ['zh-TW', '關閉'], ['zh-Hant-HK', '關閉'], ['zh', '關閉'],
    ['zh-CN', '关闭'], ['zh-Hans', '关闭'], ['ja', '閉じる'], ['ko-KR', '닫기'], ['de', 'Schließen'], ['fr-CA', 'Fermer'],
    ['es', 'Cerrar'], ['pt-BR', 'Fechar'], ['nl', 'Close'], [null, 'Close']]) {
    assert.equal(closeLabel(lang), word, String(lang));
  }
  for (const [lang, named] of [['en', 'Close Sale'], ['zh-TW', '關閉「Sale」'], ['zh-CN', '关闭「Sale」'], ['ja', '「Sale」を閉じる'],
    ['ko', 'Sale 닫기'], ['de', 'Sale schließen'], ['fr', 'Fermer Sale'], ['es', 'Cerrar Sale'], ['pt-BR', 'Fechar Sale']]) {
    assert.equal(closeLabel(lang, 'Sale'), named, lang);
  }
});

// ── mounting, against a small tree that knows document order ───────────────────────────────────
// Just the DOM mountItem and the shared base touch (no MutationObserver, no layout); anything else
// it asks for is undefined and fails loudly.
class El {
  constructor(doc, tag) {
    Object.assign(this, { ownerDocument: doc, tagName: tag, children: [], parentNode: null, attrs: {}, hidden: false, shadowRoot: null, listeners: {}, className: '', id: '' });
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { add: (c) => { this.className = `${this.className} ${c}`.trim(); } };
  }
  set innerHTML(_) { /* icons: not modelled */ }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  hasAttribute(n) { return n in this.attrs; }
  removeAttribute(n) { delete this.attrs[n]; }
  addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
  focus() { this.ownerDocument.activeElement = this; }
  appendChild(c) { return this.insertBefore(c, null); }
  append(...cs) { cs.forEach((c) => this.appendChild(c)); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument.body) return true; return false; }
  get previousElementSibling() { const s = this.parentNode ? this.parentNode.children.filter((c) => c.tagName !== '#comment') : []; return s[s.indexOf(this) - 1] || null; }
  get nextElementSibling() { const s = this.parentNode ? this.parentNode.children.filter((c) => c.tagName !== '#comment') : []; return s[s.indexOf(this) + 1] || null; }
  compareDocumentPosition(o) { const all = this.ownerDocument.order(); const a = all.indexOf(this), b = all.indexOf(o); return b > a ? 4 : b < a ? 2 : 0; }
  attachShadow() { this.shadowRoot = new El(this.ownerDocument, '#shadow'); return this.shadowRoot; }
  *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
  querySelector(sel) {
    if (sel === '[aria-expanded="true"]') return [...this.walk()].find((n) => n.getAttribute('aria-expanded') === 'true') || null;
    if (sel === 'details[open]' || sel.startsWith('h1,')) return null;
    throw new Error(`unsupported selector ${sel}`);
  }
}
function fakePage() {
  const doc = new EventTarget();
  const win = new EventTarget();
  win.location = { hash: '' };
  Object.assign(doc, { defaultView: win, createElement: (t) => new El(doc, t), createComment: () => new El(doc, '#comment') });
  doc.documentElement = new El(doc, 'html');
  doc.documentElement.setAttribute('lang', 'en');
  doc.body = new El(doc, 'body');
  doc.order = () => [doc.body, ...doc.body.walk()];
  doc.querySelector = (sel) => {
    const m = /^dc-dock\[name="([^"]+)"\]$/.exec(sel);
    if (!m) throw new Error(`unsupported selector ${sel}`);
    return doc.order().find((n) => n.tagName === 'dc-dock' && n.getAttribute('name') === m[1]) || null;
  };
  doc.querySelectorAll = (sel) => { if (sel !== 'dc-dock') throw new Error(`unsupported selector ${sel}`); return doc.order().filter((n) => n.tagName === 'dc-dock'); };
  const kept = new Map();
  globalThis.sessionStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)) };
  return { doc, win, kept };
}
/** An owner's item, written at `parent`, with one element of panel content. */
function authored(doc, parent, attrs) {
  const el = parent.appendChild(new El(doc, 'div'));
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.hidden = true;
  el.appendChild(new El(doc, 'p'));
  return el;
}

test('auto-open: an item already shown this visit leaves the turn to the next one (cold review N7)', () => {
  _resetAutoOpen();
  const { doc, kept } = fakePage();
  const a = authored(doc, doc.body, { 'data-label': 'A', 'data-auto-open': '1' });
  const b = authored(doc, doc.body, { 'data-label': 'B', 'data-auto-open': '1', 'data-dock': 'left' });
  kept.set(autoKey(a), 'opened');   // A auto-opened on an earlier page of this visit
  const ma = mountItem(a);
  const mb = mountItem(b);
  assert.equal(ma.isOpen(), false, 'A opened twice in one visit');
  assert.equal(mb.isOpen(), true, 'B never got its turn: A, already shown, still took it');
  assert.equal(kept.get(autoKey(b)), 'opened');
  // And on a fresh visit the first in the document still wins.
  _resetAutoOpen();
  const fresh = fakePage();
  const fa = mountItem(authored(fresh.doc, fresh.doc.body, { 'data-label': 'A', 'data-auto-open': '1' }));
  const fb = mountItem(authored(fresh.doc, fresh.doc.body, { 'data-label': 'B', 'data-auto-open': '1', 'data-dock': 'left' }));
  assert.deepEqual([fa.isOpen(), fb.isOpen()], [true, false]);
});

test('a retired item ignores #name and announces nothing; the open bubble and the More × say what they close (N3, N2, S2)', () => {
  _resetAutoOpen();
  const { doc, win } = fakePage();
  const section = doc.body.appendChild(new El(doc, 'section'));
  const gone = authored(doc, section, { 'data-label': 'Gone', 'data-open-on-hash': 'gone' });
  const other = authored(doc, doc.body, { 'data-label': 'Other', 'data-dock': 'left' });
  mountItem(gone);
  const mo = mountItem(other);
  const bubble = (el) => el.shadowRoot.children.find((c) => c.className === 'b');
  const px = (el) => el.shadowRoot.children.find((c) => c.className === 'p').children.find((c) => c.className === 'px');
  mo.open();
  assert.equal(bubble(other).getAttribute('aria-label'), 'Close Other');
  assert.equal(px(other).getAttribute('aria-label'), 'Close Other', 'the More sheet\'s × names what it closes');
  px(other).listeners.click[0]();
  assert.equal(mo.isOpen(), false, 'the panel\'s × did not close it');
  assert.equal(bubble(other).getAttribute('aria-label'), 'Other');
  mo.open();
  // The dock's page watcher retires `gone` when its section leaves (contract ③).
  section.remove();
  gone.remove();
  win.location.hash = '#gone';
  win.dispatchEvent(new Event('hashchange'));
  assert.equal(mo.isOpen(), true, 'a retired item\'s #name closed the panel on screen');
  assert.equal(bubble(gone).getAttribute('aria-expanded'), 'false', 'a retired item opened');
});
