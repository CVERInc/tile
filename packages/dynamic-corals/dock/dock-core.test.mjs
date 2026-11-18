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
    if (sel === 'details[open]') return null;
    if (sel.startsWith('h1,')) return [...this.walk()].find((n) => /^h[1-6]$/.test(n.tagName)) || null;
    throw new Error(`unsupported selector ${sel}`);
  }
  // Classes only, comma-separated (`.when,.title`) — what the auto-open-by tests pass. Anything
  // else throws, like a browser handed something that is not a selector.
  querySelectorAll(sel) {
    const parts = sel.split(',').map((x) => x.trim());
    if (!parts.every((x) => /^\.[\w-]+$/.test(x))) throw new Error(`unsupported selector ${sel}`);
    return [...this.walk()].filter((n) => parts.some((x) => n.className.split(/\s+/).includes(x.slice(1))));
  }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : (this.text || ''); }
  set textContent(v) { this.text = String(v); }
}
/**
 * The content observer, by hand: mountItem registers one per item, and a test calls `changed()` where
 * a browser would deliver the mutation. Returns a function that restores "no MutationObserver".
 */
function observing() {
  const watchers = [];
  globalThis.MutationObserver = class { constructor(fn) { watchers.push(fn); } observe() {} };
  return { changed: () => watchers.forEach((fn) => fn([])), done: () => { delete globalThis.MutationObserver; } };
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

const bubble = (el) => el.shadowRoot.children.find((c) => c.className === 'b');
const panelOf = (el) => el.shadowRoot.children.find((c) => c.className === 'p');
const px = (el) => panelOf(el).children.find((c) => c.className === 'px');

test('the bubble is named by what its panel says, whenever that arrives — not only at mount', () => {
  _resetAutoOpen();
  const { doc } = fakePage();
  const watch = observing();
  try {
    // A panel whose heading a script fills later (a countdown naming the calendar it reads).
    const el = authored(doc, doc.body, {});
    const heading = el.appendChild(new El(doc, 'h2'));
    el.hidden = false;
    const m = mountItem(el);
    assert.equal(bubble(el).getAttribute('aria-label'), null, 'no name yet');
    heading.text = 'Studio events';
    watch.changed();
    assert.equal(bubble(el).getAttribute('aria-label'), 'Studio events');
    assert.equal(panelOf(el).getAttribute('aria-label'), 'Studio events', 'the dialog is named the same');
    m.open();
    assert.equal(bubble(el).getAttribute('aria-label'), 'Close Studio events', 'open, it says what it closes');
    assert.equal(px(el).getAttribute('aria-label'), 'Close Studio events');
    heading.text = 'Workshops';
    watch.changed();
    assert.equal(bubble(el).getAttribute('aria-label'), 'Close Workshops', 'renamed while open: still the close control');
    m.close();
    assert.equal(bubble(el).getAttribute('aria-label'), 'Workshops');
    heading.text = '';
    watch.changed();
    assert.equal(bubble(el).getAttribute('aria-label'), null, 'a name that goes away is not left behind');
    assert.equal(panelOf(el).getAttribute('aria-label'), null);
    // data-label, when the owner writes one, still wins over the heading
    heading.text = 'Studio events';
    el.setAttribute('data-label', 'Events');
    watch.changed();
    assert.equal(bubble(el).getAttribute('aria-label'), 'Events');
  } finally { watch.done(); }
});

test('data-auto-open-by: once per CONTENT — it waits for the content, and opens again when it is about something else', () => {
  const setup = (kept) => {
    _resetAutoOpen();
    const page = fakePage();
    if (kept) for (const [k, v] of kept) page.kept.set(k, v);
    const el = authored(page.doc, page.doc.body, { 'data-label': 'Events', 'data-open-on-hash': 'events', 'data-auto-open': '1', 'data-auto-open-by': '.when,.title' });
    const when = el.appendChild(new El(page.doc, 'span')); when.className = 'when';
    const title = el.appendChild(new El(page.doc, 'span')); title.className = 'title';
    return { ...page, el, when, title };
  };
  const watch = observing();
  try {
    // First visit: nothing to key on until the content is there.
    const a = setup();
    a.el.hidden = false;
    const ma = mountItem(a.el);
    assert.equal(ma.isOpen(), false, 'no content yet: it waits rather than opening on an empty key');
    assert.equal(a.kept.size, 0);
    a.when.text = 'Oct 12 – Dec 1'; a.title.text = 'Applications open';
    watch.changed();
    assert.equal(ma.isOpen(), true, 'the content arrived: it opens');
    assert.deepEqual([...a.kept.keys()], ['dc-dock:events|Oct 12 – Dec 1 | Applications open']);
    ma.close();
    watch.changed();
    assert.equal(ma.isOpen(), false, 'closed by the visitor, it stays closed on this page');

    // Next page of the same visit, same event: already shown.
    const b = setup(a.kept);
    b.el.hidden = false;
    const mb = mountItem(b.el);
    b.when.text = 'Oct 12 – Dec 1'; b.title.text = 'Applications open';
    watch.changed();
    assert.equal(mb.isOpen(), false, 'the same content does not open twice in a visit');

    // Same visit, the calendar has moved on to the next event: once more.
    const c = setup(a.kept);
    c.el.hidden = false;
    const mc = mountItem(c.el);
    c.when.text = 'Feb 1 – Mar 15'; c.title.text = 'Applications open';
    watch.changed();
    assert.equal(mc.isOpen(), true, 'a different event opens once more');
    assert.equal(c.kept.size, 2);

    // Not a selector at all (a browser throws a SyntaxError on it, as this tree does): it never has
    // content to key on, so it never opens by itself — and never throws.
    _resetAutoOpen();
    const d = fakePage();
    const del = authored(d.doc, d.doc.body, { 'data-label': 'X', 'data-auto-open': '1', 'data-auto-open-by': '[[' });
    del.hidden = false;
    const md = mountItem(del);
    watch.changed();
    assert.equal(md.isOpen(), false);
  } finally { watch.done(); }
});

// One keyed item (its content comes later) in the left corner, as `setup` in the test above builds.
function keyed(page, extra = {}) {
  const el = authored(page.doc, page.doc.body, { 'data-label': 'Events', 'data-open-on-hash': 'events', 'data-auto-open': '1', 'data-auto-open-by': '.when', 'data-dock': 'left', ...extra });
  const when = el.appendChild(new El(page.doc, 'span')); when.className = 'when';
  el.hidden = false;
  return { el, when };
}

test('a keyed item that waits holds no turn: an item after it is not starved (N7, again)', () => {
  const watch = observing();
  try {
    // A's event was already shown this visit; B, a plain item after it, has not been.
    _resetAutoOpen();
    const page = fakePage();
    page.kept.set('dc-dock:events|Oct 12', 'opened');
    const a = keyed(page);
    const b = authored(page.doc, page.doc.body, { 'data-label': 'B', 'data-auto-open': '1' });
    b.hidden = false;
    const ma = mountItem(a.el), mb = mountItem(b);
    assert.equal(mb.isOpen(), true, 'B opens at mount: A, still waiting, took nothing');
    a.when.text = 'Oct 12';
    watch.changed();
    assert.equal(ma.isOpen(), false, 'A’s content was already shown');
    assert.equal(mb.isOpen(), true);

    // A's content never arrives, or its selector is not one: B still gets its turn.
    for (const by of ['.when', '[[']) {
      _resetAutoOpen();
      const p2 = fakePage();
      const a2 = keyed(p2, { 'data-auto-open-by': by });
      const b2 = authored(p2.doc, p2.doc.body, { 'data-label': 'B', 'data-auto-open': '1' });
      b2.hidden = false;
      const ma2 = mountItem(a2.el), mb2 = mountItem(b2);
      watch.changed();
      assert.deepEqual([ma2.isOpen(), mb2.isOpen()], [false, true], by);
    }

    // And the other way round: something already opened by itself on this page, so A, arriving
    // late, does not open over it — and is NOT remembered as shown, so it opens on the next page.
    _resetAutoOpen();
    const p3 = fakePage();
    const a3 = keyed(p3);
    const b3 = authored(p3.doc, p3.doc.body, { 'data-label': 'B', 'data-auto-open': '1' });
    b3.hidden = false;
    const ma3 = mountItem(a3.el), mb3 = mountItem(b3);
    mb3.close();
    a3.when.text = 'Oct 12';
    watch.changed();
    assert.equal(ma3.isOpen(), false, 'one auto-open per page');
    assert.equal(p3.kept.has('dc-dock:events|Oct 12'), false, 'not shown, so not remembered');
  } finally { watch.done(); }
});

test('the visitor outranks the wait: once they open or close a keyed item it does not move by itself', () => {
  const watch = observing();
  try {
    // Opened and closed by the visitor before its content could be named.
    _resetAutoOpen();
    const page = fakePage();
    const a = keyed(page);
    const m = mountItem(a.el);
    m.open(); m.close();
    a.when.text = 'Oct 12';
    watch.changed();
    assert.equal(m.isOpen(), false, 'it does not open again by itself');
    assert.equal(page.kept.get('dc-dock:events|Oct 12'), 'opened', 'they saw it: remembered as shown once it can be named');

    // Open (by the visitor) when the content arrives: left open, and remembered.
    _resetAutoOpen();
    const p2 = fakePage();
    const a2 = keyed(p2);
    const m2 = mountItem(a2.el);
    m2.open();
    a2.when.text = 'Oct 12';
    watch.changed();
    assert.equal(m2.isOpen(), true);
    assert.equal(p2.kept.get('dc-dock:events|Oct 12'), 'opened', 'so the next page does not open it again');

    // Only closed (never opened) while waiting: stays closed, and nothing is remembered.
    _resetAutoOpen();
    const p3 = fakePage();
    const a3 = keyed(p3);
    const m3 = mountItem(a3.el);
    m3.close();                                  // already closed: not a visitor action that changes anything
    a3.when.text = 'Oct 12';
    watch.changed();
    assert.equal(m3.isOpen(), true, 'a close that closed nothing is not the visitor taking it in hand');
  } finally { watch.done(); }
});

test('a keyed item that left the page before its content came shows nothing and remembers nothing', () => {
  const watch = observing();
  try {
    _resetAutoOpen();
    const page = fakePage();
    const section = page.doc.body.appendChild(new El(page.doc, 'section'));
    const el = authored(page.doc, section, { 'data-label': 'Events', 'data-open-on-hash': 'events', 'data-auto-open': '1', 'data-auto-open-by': '.when' });
    const when = el.appendChild(new El(page.doc, 'span')); when.className = 'when';
    el.hidden = false;
    const m = mountItem(el);
    el.remove();                                 // its dock let it go (the place it was written left the page)
    when.text = 'Oct 12';
    watch.changed();
    assert.equal(m.isOpen(), false);
    assert.equal(page.kept.size, 0, 'what was never shown is not marked as shown');
  } finally { watch.done(); }
});

test('a keyed item with no name and no data-label is keyed by the label it has when it decides', () => {
  const watch = observing();
  try {
    _resetAutoOpen();
    const page = fakePage();
    const el = authored(page.doc, page.doc.body, { 'data-auto-open': '1', 'data-auto-open-by': '.when' });
    const heading = el.appendChild(new El(page.doc, 'h2'));
    const when = el.appendChild(new El(page.doc, 'span')); when.className = 'when';
    el.hidden = false;
    const m = mountItem(el);
    heading.text = 'Studio events'; when.text = 'Oct 12';
    watch.changed();
    assert.equal(m.isOpen(), true);
    assert.deepEqual([...page.kept.keys()], ['dc-dock:right:Studio events|Oct 12'], 'not `dc-dock:right:`, which every unnamed item in the corner would share');
  } finally { watch.done(); }
});

test('without data-auto-open-by, auto-open is what it was: once per item per visit, decided at mount', () => {
  _resetAutoOpen();
  const { doc, kept } = fakePage();
  const el = authored(doc, doc.body, { 'data-label': 'Events', 'data-open-on-hash': 'events', 'data-auto-open': '1' });
  el.hidden = false;
  const m = mountItem(el);
  assert.equal(m.isOpen(), true);
  assert.deepEqual([...kept.keys()], ['dc-dock:events']);
});
