// shared/dock.mjs — the contract's two sentences, driven against a small tree that knows document
// order, plus the pure helpers (ink by luminance, the shadow budget). The browser half — real
// layout, safe areas, the shadow's computed reach, two separately built bundles on one page, the
// installed-app bar — is dock.smoke.mjs (../dock/), which needs Playwright.
//   run: node --test packages/dynamic-corals/shared/dock.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCK_OPEN, DOCK_SHADOW, DOCK_CSS, dockJoin, dockClaim, dockBelow, dockAnnounce, dockListen, dockInk, dockRgb,
} from './dock.mjs';

// ── a tree with document order ──────────────────────────────────────────────────────────────────
class N {
  constructor(doc, tag, comment = false) {
    this.ownerDocument = doc;
    this.tagName = tag;
    this.isComment = comment;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.hidden = false;
    this.shadowRoot = null;
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
  }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; }
  hasAttribute(n) { return n in this.attrs; }
  toggleAttribute(n, on) { if (on) this.attrs[n] = ''; else delete this.attrs[n]; }
  addEventListener(type, fn) { (this.listeners ??= {})[type] = fn; }
  focus() { this.ownerDocument.focused = this; }
  closest(sel) {
    const m = /^\[slot="([^"]+)"\]$/.exec(sel);
    for (let n = this; n && n.getAttribute; n = n.parentNode) if (m && n.getAttribute('slot') === m[1]) return n;
    return null;
  }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument.body) return true; return false; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  get elementSiblings() { return this.parentNode ? this.parentNode.children.filter((c) => !c.isComment) : [this]; }
  get previousElementSibling() { const s = this.elementSiblings; return s[s.indexOf(this) - 1] || null; }
  get nextElementSibling() { const s = this.elementSiblings; return s[s.indexOf(this) + 1] || null; }
  attachShadow() {
    if (this.shadowRoot) throw new Error('already');
    this.shadowRoot = { children: [], append(...k) { this.children.push(...k); }, addEventListener() {},
      querySelector(sel) { return sel === '.more' ? this.children.find((c) => c.className === 'more') || null : null; } };
    return this.shadowRoot;
  }
  compareDocumentPosition(other) {
    const order = this.ownerDocument.order();
    const a = order.indexOf(this), b = order.indexOf(other);
    return b > a ? 4 : b < a ? 2 : 0;
  }
}
// The dock's own children, as the browser exposes them: elements only.
Object.defineProperty(N.prototype, 'kids', { get() { return this.children.filter((c) => !c.isComment); } });

function makeDoc() {
  const doc = new EventTarget();
  doc.createElement = (tag) => new N(doc, tag);
  doc.createComment = () => new N(doc, '#comment', true);
  doc.body = new N(doc, 'body');
  doc.documentElement = new N(doc, 'html');
  doc.order = () => { const out = []; const walk = (n) => { out.push(n); n.children.forEach(walk); }; walk(doc.body); return out; };
  doc.querySelector = (sel) => {
    const m = /^dc-dock\[name="([^"]+)"\]$/.exec(sel);
    if (!m) throw new Error(`unsupported selector ${sel}`);
    return doc.order().find((n) => n.tagName === 'dc-dock' && n.getAttribute('name') === m[1]) || null;
  };
  doc.querySelectorAll = (sel) => {
    if (sel !== 'dc-dock') throw new Error(`unsupported selector ${sel}`);
    return doc.order().filter((n) => n.tagName === 'dc-dock');
  };
  return doc;
}

/** An item written at `parent`, joined the way inbox-bubble joins (the coral element stays as anchor). */
function writeAndJoin(doc, parent, name, label, { before = null } = {}) {
  const el = new N(doc, 'div');
  el.label = label;
  parent.insertBefore(el, before);
  const host = doc.createElement('div');
  host.label = label;
  dockJoin(host, el, name);
  return host;
}

// The dock's children are given `children` through the slot in a browser; here, read the tree.
const labels = (dock) => dock.children.map((c) => c.label);
const dockOf = (doc, name) => doc.querySelector(`dc-dock[name="${name}"]`);

test('① document order: earlier in the page is nearer the corner, whatever order the items mount in', () => {
  const doc = makeDoc();
  const footer = doc.body.appendChild(new N(doc, 'footer'));
  const slot = doc.body.appendChild(new N(doc, 'div'));
  // The site's own item (in the embed slot, AFTER the platform's inbox) mounts first…
  writeAndJoin(doc, slot, 'right', 'site-item');
  // …the inbox (written right after the footer, i.e. earlier) mounts later, after its network gate.
  writeAndJoin(doc, doc.body, 'right', 'inbox', { before: slot });
  writeAndJoin(doc, slot, 'right', 'second-site-item');
  assert.deepEqual(labels(dockOf(doc, 'right')), ['inbox', 'site-item', 'second-site-item']);
  assert.ok(footer);
});

test('① a missing dock is created once, at the end of <body>, and given its look exactly once', () => {
  const doc = makeDoc();
  writeAndJoin(doc, doc.body, 'left', 'a');
  writeAndJoin(doc, doc.body, 'left', 'b');
  const docks = doc.order().filter((n) => n.tagName === 'dc-dock');
  assert.equal(docks.length, 1);
  // Created by the first join, so it is the body's last child at that moment: after the first item's
  // anchor (index 0) and before the second, written later (index 2).
  assert.equal(doc.body.children.indexOf(docks[0]), 1);
  assert.equal(docks[0].shadowRoot.children.length, 2, 'style + slot');
  assert.equal(docks[0].shadowRoot.children[0].textContent, DOCK_CSS);
});

test('① a dock another copy already claimed is joined, never re-styled (version skew)', () => {
  const doc = makeDoc();
  const dock = doc.body.appendChild(doc.createElement('dc-dock'));
  dock.setAttribute('name', 'right');
  const foreign = dock.attachShadow({ mode: 'open' });
  foreign.append({ textContent: 'an older copy\'s stylesheet' });
  writeAndJoin(doc, doc.body, 'right', 'x');
  assert.equal(dock.shadowRoot, foreign);
  assert.equal(foreign.children.length, 1, 'this copy added to a shadow root it did not create');
  assert.deepEqual(labels(dock), ['x']);
});

test('① children without a dockAnchor (a renderer\'s own nav tabs) keep their written place', () => {
  const doc = makeDoc();
  const bar = doc.body.appendChild(doc.createElement('dc-dock'));
  bar.setAttribute('name', 'right');
  for (const t of ['nav1', 'nav2']) bar.appendChild(Object.assign(doc.createElement('a'), { label: t }));
  // An item written BEFORE the dock goes before the tabs; one written after goes after them.
  const early = new N(doc, 'div');
  doc.body.insertBefore(early, bar);
  const later = doc.body.appendChild(new N(doc, 'div'));
  const h1 = doc.createElement('div'); h1.label = 'after';
  dockJoin(h1, later, 'right');
  const h0 = doc.createElement('div'); h0.label = 'before';
  dockJoin(h0, early, 'right');
  assert.deepEqual(labels(bar), ['before', 'nav1', 'nav2', 'after']);
});

test('① an unknown or unsafe position name falls back to right rather than into a selector', () => {
  const doc = makeDoc();
  writeAndJoin(doc, doc.body, 'x"] , body [y', 'odd');
  assert.ok(dockOf(doc, 'right'));
  assert.deepEqual(labels(dockOf(doc, 'right')), ['odd']);
});

test('removal backfills: an item that leaves or hides is simply not counted by the one above it', () => {
  const doc = makeDoc();
  const a = writeAndJoin(doc, doc.body, 'right', 'a');
  const b = writeAndJoin(doc, doc.body, 'right', 'b');
  const c = writeAndJoin(doc, doc.body, 'right', 'c');
  assert.equal(dockBelow(c), 2);
  b.hidden = true;
  assert.equal(dockBelow(c), 1, 'a hidden item still reserved room');
  a.remove();
  assert.equal(dockBelow(c), 0);
  assert.deepEqual(labels(dockOf(doc, 'right')), ['b', 'c']);
});

test('② one open at a time: an announce closes every other listener, never the announcer', () => {
  const doc = makeDoc();
  const a = writeAndJoin(doc, doc.body, 'right', 'a');
  const b = writeAndJoin(doc, doc.body, 'left', 'b');
  const closed = [];
  const offA = dockListen(a, () => closed.push('a'));
  dockListen(b, () => closed.push('b'));
  dockAnnounce(a);
  assert.deepEqual(closed, ['b']);
  dockAnnounce(b);
  assert.deepEqual(closed, ['b', 'a']);
  offA();
  dockAnnounce(b);
  assert.deepEqual(closed, ['b', 'a'], 'a removed listener still heard the announce');
  // The event's name and detail ARE the contract: an older copy listening with its own code hears it.
  let heard = null;
  doc.addEventListener('dc-dock:open', (e) => { heard = e.detail; });
  dockAnnounce(a);
  assert.equal(DOCK_OPEN, 'dc-dock:open');
  assert.equal(heard, a);
});

test('ink: black on light colours, white on dark ones, by relative luminance', () => {
  for (const [bg, ink] of [['#fff', '#000'], ['#ffffff', '#000'], ['#ff5d61', '#000'], ['#ffd400', '#000'],
    ['#111', '#fff'], ['#000000', '#fff'], ['#1a4fd6', '#fff'], ['rgb(0, 128, 0)', '#fff'], ['rgba(250,240,230,.5)', '#000']]) {
    assert.equal(dockInk(bg), ink, bg);
  }
  assert.equal(dockInk('not a colour'), '#fff', 'unreadable counts as dark, like the default bubble');
  assert.deepEqual(dockRgb('#abc'), [0xaa, 0xbb, 0xcc]);
  assert.equal(dockRgb('oklch(70% 0.1 30)'), null);
});

test('the shadow budget reaches no further than the 16px edge margin', () => {
  // Reach of one layer = |offset| + blur (+ spread); the budget's widest layer is the bound.
  const layers = DOCK_SHADOW.split(/,(?![^(]*\))/).map((l) => l.trim().match(/^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?\s+([\d.]+)(?:px)?(?:\s+(-?[\d.]+)px)?/));
  assert.ok(layers.every(Boolean), DOCK_SHADOW);
  for (const [, x, y, blur, spread = '0'] of layers) {
    assert.ok(Math.abs(+y) + +blur + +spread <= 16, `down reach of ${x} ${y} ${blur}`);
    assert.ok(Math.abs(+x) + +blur + +spread <= 16, `side reach of ${x} ${y} ${blur}`);
  }
  assert.match(DOCK_CSS, /--dc-dock-margin:max\(1rem,16px\)/, 'the margin can shrink under the reach');
});

// ── the installed-app bar: the renderer's, switched on by the renderer ─────────────────────────────

/** A renderer's bar: written into the page with its own tabs, hidden, as sitetile writes it. */
function rendererBar(doc, tabs = [], attrs = {}) {
  const bar = doc.body.appendChild(doc.createElement('dc-dock'));
  bar.setAttribute('name', 'bar');
  bar.hidden = true;
  for (const [k, v] of Object.entries(attrs)) bar.setAttribute(k, v);
  for (const t of tabs) bar.appendChild(Object.assign(doc.createElement('a'), { label: t }));
  return bar;
}

/**
 * MutationObserver, as far as the dock uses it: the callbacks are collected, and `flush()` runs every
 * one of them up to `limit` rounds while any of them is still being re-triggered — a browser's
 * microtask loop, made countable. `hiddenWrites` counts writes to a dock's `hidden`, which is what a
 * browser queues an attribute record for (whether or not the value changes).
 */
function withObserver(fn) {
  const observers = [];
  const saved = globalThis.MutationObserver;
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe(target, opts) { this.target = target; this.opts = opts; } };
  try { return fn(observers); } finally { globalThis.MutationObserver = saved; }
}
function countHiddenWrites(el) {
  let v = el.hidden;
  el.hiddenWrites = 0;
  Object.defineProperty(el, 'hidden', { get: () => v, set: (x) => { v = x; el.hiddenWrites++; }, configurable: true });
}

test('① a coral never creates the bar: in an app without the renderer\'s bar, it takes a corner', () => {
  const doc = makeDoc();
  doc.documentElement.setAttribute('data-dc-dock-bar', '');
  writeAndJoin(doc, doc.body, 'left', 'a');
  writeAndJoin(doc, doc.body, 'bar', 'asked-for-bar-by-name');
  assert.equal(dockOf(doc, 'bar'), null, 'a coral made up a bar');
  assert.deepEqual(labels(dockOf(doc, 'left')), ['a']);
  assert.deepEqual(labels(dockOf(doc, 'right')), ['asked-for-bar-by-name']);
});

test('① the renderer\'s bar is joined only when the renderer switched it on (<html data-dc-dock-bar>)', () => {
  const off = makeDoc();
  const barOff = rendererBar(off, ['nav1']);
  writeAndJoin(off, off.body, 'left', 'a');
  assert.deepEqual(labels(barOff), ['nav1'], 'joined a bar that is not on (a browser, a wide installed window)');
  assert.deepEqual(labels(dockOf(off, 'left')), ['a']);

  const on = makeDoc();
  on.documentElement.setAttribute('data-dc-dock-bar', '');
  const bar = rendererBar(on, ['nav1', 'nav2']);
  writeAndJoin(on, on.body, 'left', 'a');
  writeAndJoin(on, on.body, 'right', 'b');
  assert.deepEqual(labels(bar), ['nav1', 'nav2', 'a', 'b']);
  assert.equal(dockOf(on, 'left'), null);
  assert.equal(dockOf(on, 'right'), null);
});

test('🔴 an empty bar does not re-trigger itself (review of tile#233, finding 1: the page froze)', () => {
  withObserver((observers) => {
    const doc = makeDoc();
    const bar = rendererBar(doc, []);
    countHiddenWrites(bar);
    dockClaim(bar);
    const own = observers.find((o) => o.target === bar);
    assert.ok(own && own.opts.attributeFilter.includes('hidden'), 'the bar no longer watches its own hidden');
    const before = bar.hiddenWrites;
    // Each write to `hidden` queues a record in a browser, i.e. another round of the observer.
    let rounds = 0;
    while (rounds < 50) {
      const w = bar.hiddenWrites;
      own.cb([]);
      rounds++;
      if (bar.hiddenWrites === w) break;
    }
    assert.equal(bar.hidden, true);
    assert.equal(bar.hiddenWrites, before, `an already-hidden empty bar wrote hidden again (${bar.hiddenWrites - before} times in ${rounds} rounds)`);
  });
});

test('bar: entries the renderer reserves (data-reserve) count from the first paint, until they arrive', () => {
  withObserver((observers) => {
    const doc = makeDoc();
    doc.documentElement.setAttribute('data-dc-dock-bar', '');
    const bar = rendererBar(doc, ['n1', 'n2', 'n3', 'n4', 'n5'], { 'data-reserve': '1' });
    dockClaim(bar);
    const slots = () => bar.kids.map((k) => k.getAttribute('slot') || 'tab');
    assert.deepEqual(slots(), ['tab', 'tab', 'tab', 'tab', 'more'], 'five tabs at first paint; the fifth jumps into More when the inbox arrives');
    writeAndJoin(doc, doc.body, 'right', 'inbox');
    observers.find((o) => o.target === bar).cb([]);
    assert.deepEqual(slots(), ['tab', 'tab', 'tab', 'tab', 'more', 'more'], 'the arrival moved an entry');
    // Without a reserve, five entries are five tabs (the rule itself is unchanged).
    const plain = makeDoc();
    const b2 = rendererBar(plain, ['n1', 'n2', 'n3', 'n4', 'n5']);
    dockClaim(b2);
    assert.deepEqual(b2.kids.map((k) => k.getAttribute('slot') || 'tab'), ['tab', 'tab', 'tab', 'tab', 'tab']);
  });
});

test('bar: a list opening inside a More entry keeps the sheet; an entry\'s own panel closes it (finding 4)', () => {
  withObserver(() => {
    const doc = makeDoc();
    const bar = rendererBar(doc, ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    dockClaim(bar);
    const sheet = bar.shadowRoot.children.find((c) => c.className === 'sheet');
    const more = bar.shadowRoot.children.find((c) => c.className === 'more');
    const group = bar.kids[5];
    assert.equal(group.getAttribute('slot'), 'more');
    const details = group.appendChild(doc.createElement('details'));
    more.listeners.click();
    assert.ok(sheet.hasAttribute('data-open'));
    doc.dispatchEvent(new CustomEvent(DOCK_OPEN, { detail: details }));
    assert.ok(sheet.hasAttribute('data-open'), 'a group in More closed the sheet it opens in');
    doc.dispatchEvent(new CustomEvent(DOCK_OPEN, { detail: group }));
    assert.equal(sheet.hasAttribute('data-open'), false, 'an entry\'s own panel left the sheet open under it');
  });
});

test('③ an item whose anchor left the document leaves its dock — one watcher per page, any copy\'s items', () => {
  withObserver((observers) => {
    const doc = makeDoc();
    const section = doc.body.appendChild(new N(doc, 'section'));
    const a = writeAndJoin(doc, section, 'right', 'a');
    const b = writeAndJoin(doc, doc.body, 'right', 'b');
    writeAndJoin(doc, doc.body, 'left', 'c');
    const watchers = observers.filter((o) => o.target === doc);
    assert.equal(watchers.length, 1, 'not exactly one page watcher for two docks');
    assert.ok(watchers[0].opts.childList && watchers[0].opts.subtree);
    assert.equal(doc.dcDockWatch, true);
    // A record without removals costs nothing and changes nothing.
    watchers[0].cb([{ removedNodes: [] }]);
    assert.deepEqual(labels(dockOf(doc, 'right')), ['a', 'b']);
    section.remove();
    watchers[0].cb([{ removedNodes: [section] }]);
    assert.deepEqual(labels(dockOf(doc, 'right')), ['b'], 'the item stayed after its anchor left');
    assert.equal(a.parentNode, null);
    assert.ok(b.parentNode);
    // A second copy's dock claim does not start a second watcher.
    const other = doc.body.appendChild(doc.createElement('dc-dock'));
    other.setAttribute('name', 'x');
    dockClaim(other);
    assert.equal(observers.filter((o) => o.target === doc).length, 1);
  });
});
