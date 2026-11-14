// A small stand-in DOM, so w3/deck.js (a browser script) can be RUN under node by the tests beside
// it. This repo depends on no DOM library and no browser, and the deck's promises about a view
// switch are about node identity, structure, focus and navigation — things a stand-in can hold.
//
// 🔴 What it is NOT. There is no layout and no CSS here: every box measures as the rectangle a test
// gives it (zero by default), nothing is ever painted, and a selector is matched only as far as the
// grammar below goes. A test that passes here says the script kept its structural promises; it says
// nothing about what a visitor sees. That half belongs to verify/deck-views.mjs, in a real browser.
//
// What it models on purpose, because the deck's promises depend on it:
//   - identity: nodes are plain objects, moved and never copied (cloneNode is the only copy)
//   - connectedness: `isConnected` is computed from the parent chain, and every node that ENDS a
//     mutation outside the document is recorded in `document.left`
//   - focus: an element that leaves the document — or is re-inserted with insertBefore/appendChild,
//     which a browser treats as remove + insert — loses focus to <body>. `moveBefore` keeps it.
//   - navigation: `location.reload()` and assigning `location.href` are counted, never performed
//   - time: timers and animation frames run only when the test calls `window.tick(ms)`
import vm from 'node:vm';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1))
  : (e in ENT ? ENT[e] : m)));
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

// ── selectors: `a, b` lists of compounds joined by descendant / `>` / `+` / `~` ────────────────────
// compound: tag, *, #id, .class, [a], [a=v], [a*=v], [a^=v], [a$=v], :not(list), :is(list),
// :first-child, :last-child. Anything else throws — a selector this cannot read must not match
// quietly as "nothing found".
const selCache = new Map();
function parseSelector(src) {
  if (selCache.has(src)) return selCache.get(src);
  let i = 0;
  const ws = () => { while (/\s/.test(src[i] || '')) i++; };
  const ident = () => { const m = /^[\w-]+/.exec(src.slice(i)); if (!m) throw new Error(`mini-dom: selector "${src}" at ${i}`); i += m[0].length; return m[0]; };
  const compound = () => {
    const tests = [];
    for (;;) {
      const c = src[i];
      if (c === '*') { i++; }
      else if (c === '#') { i++; const v = ident(); tests.push((e) => e.id === v); }
      else if (c === '.') { i++; const v = ident(); tests.push((e) => e.classList.contains(v)); }
      else if (c === '[') {
        const m = /^\[\s*([\w-]+)\s*(?:([*^$]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/.exec(src.slice(i));
        if (!m) throw new Error(`mini-dom: selector "${src}" at ${i}`);
        i += m[0].length;
        const [, name, op] = m; const val = m[3] ?? m[4] ?? m[5];
        tests.push((e) => {
          const a = e.getAttribute(name); if (a == null) return false;
          return !op || (op === '=' ? a === val : op === '*=' ? a.includes(val) : op === '^=' ? a.startsWith(val) : a.endsWith(val));
        });
      } else if (c === ':') {
        i++; const name = ident();
        if (name === 'not' || name === 'is') {
          if (src[i] !== '(') throw new Error(`mini-dom: selector "${src}" at ${i}`);
          let depth = 1, j = i + 1; while (j < src.length && depth) { if (src[j] === '(') depth++; if (src[j] === ')') depth--; j++; }
          const inner = parseSelector(src.slice(i + 1, j - 1)); i = j;
          tests.push(name === 'not' ? (e) => !matchList(e, inner) : (e) => matchList(e, inner));
        } else if (name === 'first-child') tests.push((e) => e.previousElementSibling == null);
        else if (name === 'last-child') tests.push((e) => e.nextElementSibling == null);
        else throw new Error(`mini-dom: selector "${src}" uses :${name}, which this stand-in does not read`);
      } else if (/[\w-]/.test(c || '')) { const v = ident().toLowerCase(); tests.push((e) => e.localName === v); }
      else break;
    }
    return tests;
  };
  const list = [];
  for (;;) {
    ws(); const parts = [{ comb: '', tests: compound() }];
    for (;;) {
      const before = i; ws();
      const c = src[i];
      if (c == null || c === ',') break;
      let comb = ' ';
      if (c === '>' || c === '+' || c === '~') { comb = c; i++; ws(); } else if (i === before) throw new Error(`mini-dom: selector "${src}" at ${i}`);
      parts.push({ comb, tests: compound() });
    }
    if (parts.some((p) => !p.tests.length && parts.length === 1 && src.trim() !== '*')) throw new Error(`mini-dom: empty selector in "${src}"`);
    list.push(parts);
    ws(); if (src[i] === ',') { i++; continue; }
    break;
  }
  if (i < src.length) throw new Error(`mini-dom: selector "${src}" at ${i}`);
  selCache.set(src, list);
  return list;
}
const hit = (e, tests) => tests.every((t) => t(e));
function matchParts(e, parts, k) {
  if (!hit(e, parts[k].tests)) return false;
  if (k === 0) return true;
  const comb = parts[k].comb;
  if (comb === '>') return !!e.parentElement && matchParts(e.parentElement, parts, k - 1);
  if (comb === '+') return !!e.previousElementSibling && matchParts(e.previousElementSibling, parts, k - 1);
  if (comb === '~') { for (let p = e.previousElementSibling; p; p = p.previousElementSibling) if (matchParts(p, parts, k - 1)) return true; return false; }
  for (let p = e.parentElement; p; p = p.parentElement) if (matchParts(p, parts, k - 1)) return true;
  return false;
}
const matchList = (e, list) => list.some((parts) => matchParts(e, parts, parts.length - 1));

// ── nodes ────────────────────────────────────────────────────────────────────────────────────────
class EventTargetLike {
  constructor() { this._l = []; }
  addEventListener(type, fn, o) { if (!fn) return; const capture = o === true || !!(o && o.capture); if (!this._l.some((l) => l.type === type && l.fn === fn && l.capture === capture)) this._l.push({ type, fn, capture, once: !!(o && o.once) }); }
  removeEventListener(type, fn, o) { const capture = o === true || !!(o && o.capture); this._l = this._l.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture)); }
  _fire(ev, phase) {
    for (const l of [...this._l]) {
      if (l.type !== ev.type || ev._stopNow) continue;
      if (phase === 'capture' ? !l.capture : phase === 'bubble' ? l.capture : false) continue;
      if (l.once) this.removeEventListener(l.type, l.fn, l.capture);
      ev.currentTarget = this; l.fn.call(this, ev);
    }
    const on = this['on' + ev.type];
    if (phase !== 'capture' && typeof on === 'function' && !ev._stopNow) { ev.currentTarget = this; on.call(this, ev); }
  }
}
export class Event {
  constructor(type, init = {}) { Object.assign(this, init); this.type = type; this.bubbles = init.bubbles !== false; this.defaultPrevented = false; this.isTrusted = !!init.isTrusted; this.timeStamp = init.timeStamp || 0; }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}

class Node extends EventTargetLike {
  constructor(doc) { super(); this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] || null; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) - 1] || null; }
  get nextElementSibling() { let n = this.nextSibling; while (n && !(n instanceof Element)) n = n.nextSibling; return n; }
  get previousElementSibling() { let n = this.previousSibling; while (n && !(n instanceof Element)) n = n.previousSibling; return n; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  // every structural change goes through these two, so the bookkeeping cannot be bypassed
  _take(n, keepFocus) {
    const p = n.parentNode; if (!p) return;
    p.childNodes.splice(p.childNodes.indexOf(n), 1); n.parentNode = null;
    const d = this.ownerDocument || this;
    if (!keepFocus && d.activeElement && n.contains(d.activeElement)) d.activeElement = d.body || null;
  }
  _put(n, ref, keepFocus) {
    if (n === this || n.contains(this)) throw new Error('mini-dom: a node cannot be put inside itself');
    if (n instanceof Fragment) { for (const c of [...n.childNodes]) this._put(c, ref); return n; }
    if (ref && ref.parentNode !== this) throw new Error('mini-dom: insertBefore — the reference node is not a child of this node');
    if (ref === n) return n;
    const was = n.isConnected;
    this._take(n, keepFocus);
    const at = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(at, 0, n); n.parentNode = this;
    if (was) this._left(n);   // moved into a subtree that is not in the document: it left, as surely as if it were removed
    return n;
  }
  _left(n) { const d = this.ownerDocument || this; if (!n.isConnected) d.left.push(n); }
  appendChild(n) { return this._put(n, null); }
  insertBefore(n, ref) { return this._put(n, ref || null); }
  removeChild(n) { if (n.parentNode !== this) throw new Error('mini-dom: removeChild — not a child'); this._take(n); this._left(n); return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  append(...ns) { for (const n of ns) this._put(typeof n === 'string' ? new Text(this.ownerDocument, n) : n, null); }
  before(...ns) { const p = this.parentNode; if (p) for (const n of ns) p._put(n, this); }
  after(...ns) { const p = this.parentNode; if (!p) return; const ref = this.nextSibling; for (const n of ns) p._put(n, ref); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p._put(n, this); p._take(this); p._left(this); }
  replaceChildren(...ns) { const old = [...this.childNodes]; for (const c of old) this._take(c); for (const n of ns) this._put(n, null); for (const c of old) this._left(c); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v != null) this._put(new Text(this.ownerDocument, String(v)), null); }
}
class Text extends Node { constructor(doc, data) { super(doc); this.data = data; this.nodeType = 3; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } cloneNode() { return new Text(this.ownerDocument, this.data); } }
class Comment extends Node { constructor(doc, data) { super(doc); this.data = data; this.nodeType = 8; } get textContent() { return ''; } set textContent(v) { this.data = String(v); } cloneNode() { return new Comment(this.ownerDocument, this.data); } }
class Fragment extends Node {
  constructor(doc) { super(doc); this.nodeType = 11; }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  get firstElementChild() { return this.children[0] || null; }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
  querySelectorAll(s) { return queryAll(this, s); }
}
function queryAll(root, s) {
  const list = parseSelector(s), out = [];
  const walk = (n) => { for (const c of n.childNodes) if (c instanceof Element) { if (matchList(c, list)) out.push(c); walk(c); } };
  walk(root); return out;
}

class Style {
  constructor() { this._p = new Map(); }
  setProperty(k, v) { if (v == null || v === '') this._p.delete(k); else this._p.set(k, String(v)); }
  getPropertyValue(k) { return this._p.get(k) || ''; }
  removeProperty(k) { this._p.delete(k); }
  get cssText() { return [...this._p].map(([k, v]) => `${k}:${v}`).join(';'); }
  set cssText(t) { this._p.clear(); for (const d of String(t).split(';')) { const c = d.indexOf(':'); if (c > 0) this._p.set(d.slice(0, c).trim(), d.slice(c + 1).trim()); } }
}
// `el.style.transform = '…'` and friends: any other name is a declaration, kept under its CSS name
const styleProxy = () => new Proxy(new Style(), {
  get(t, k) { if (k in t || typeof k === 'symbol') { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } return t.getPropertyValue(kebab(k)); },
  set(t, k, v) { if (k === 'cssText') t.cssText = v; else t.setProperty(kebab(k), v); return true; },
});

export class Element extends Node {
  constructor(doc, tag) {
    super(doc); this.nodeType = 1; this.localName = String(tag).toLowerCase(); this.tagName = this.localName.toUpperCase(); this._a = new Map(); this.style = styleProxy();
    if (this.localName === 'template') this.content = new Fragment(doc);
    const el = this;
    this.classList = {
      contains: (c) => el._classes().includes(c),
      add: (...cs) => { const l = el._classes(); for (const c of cs) if (!l.includes(c)) l.push(c); el._a.set('class', l.join(' ')); },
      remove: (...cs) => { el._a.set('class', el._classes().filter((c) => !cs.includes(c)).join(' ')); },
      toggle: (c, on) => { const has = el._classes().includes(c); const want = on === undefined ? !has : !!on; if (want) el.classList.add(c); else el.classList.remove(c); return want; },
      get length() { return el._classes().length; },
      [Symbol.iterator]: () => el._classes()[Symbol.iterator](),
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? el._a.get('data-' + kebab(k)) : undefined),
      set: (_, k, v) => { el._a.set('data-' + kebab(k), String(v)); return true; },
      has: (_, k) => typeof k === 'string' && el._a.has('data-' + kebab(k)),
      deleteProperty: (_, k) => { el._a.delete('data-' + kebab(k)); return true; },
      ownKeys: () => [...el._a.keys()].filter((k) => k.startsWith('data-')).map((k) => camel(k.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (el._a.has('data-' + kebab(k)) ? { value: el._a.get('data-' + kebab(k)), enumerable: true, configurable: true } : undefined),
    });
  }
  _classes() { return (this._a.get('class') || '').split(/\s+/).filter(Boolean); }
  getAttribute(k) { return this._a.has(k) ? this._a.get(k) : null; }
  setAttribute(k, v) { this._a.set(k, String(v)); }
  hasAttribute(k) { return this._a.has(k); }
  removeAttribute(k) { this._a.delete(k); }
  toggleAttribute(k, on) { const want = on === undefined ? !this._a.has(k) : !!on; if (want) this._a.set(k, ''); else this._a.delete(k); return want; }
  get id() { return this._a.get('id') || ''; } set id(v) { this._a.set('id', String(v)); }
  get className() { return this._a.get('class') || ''; } set className(v) { this._a.set('class', String(v)); }
  get hidden() { return this._a.has('hidden'); } set hidden(v) { this.toggleAttribute('hidden', !!v); }
  get href() { const h = this._a.get('href'); if (h == null) return ''; try { return new URL(h, this.ownerDocument.defaultView.location.href).href; } catch { return h; } }
  set href(v) { this._a.set('href', String(v)); }
  get src() { return this._a.get('src') || ''; } set src(v) { this._a.set('src', String(v)); }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  matches(s) { return matchList(this, parseSelector(s)); }
  closest(s) { const l = parseSelector(s); for (let e = this; e; e = e.parentElement) if (matchList(e, l)) return e; return null; }
  querySelector(s) { return queryAll(this, s)[0] || null; }
  querySelectorAll(s) { return queryAll(this, s); }
  cloneNode(deep) { const c = new Element(this.ownerDocument, this.localName); for (const [k, v] of this._a) c._a.set(k, v); c.style.cssText = this.style.cssText; if (deep) { for (const n of this.childNodes) c._put(n.cloneNode(true), null); if (this.content) for (const n of this.content.childNodes) c.content._put(n.cloneNode(true), null); } return c; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) { this.replaceChildren(); parseInto(this.localName === 'template' ? this.content : this, String(html)); }
  get outerHTML() { return serialize(this); }
  insertAdjacentHTML(where, html) {
    const f = new Fragment(this.ownerDocument); parseInto(f, String(html)); const ns = [...f.childNodes];
    if (where === 'beforeend') for (const n of ns) this._put(n, null);
    else if (where === 'afterbegin') { const ref = this.firstChild; for (const n of ns) this._put(n, ref); }
    else if (where === 'beforebegin') for (const n of ns) this.parentNode._put(n, this);
    else if (where === 'afterend') { const ref = this.nextSibling; for (const n of ns) this.parentNode._put(n, ref); }
    else throw new Error('mini-dom: insertAdjacentHTML ' + where);
  }
  // 🔴 the one move a browser does NOT treat as remove + insert: focus (and a frame's document) survive it
  moveBefore(n, ref) { if (!this.ownerDocument.hasMoveBefore) throw new Error('mini-dom: moveBefore is off in this document'); if (!n.isConnected || !this.isConnected) throw new Error('HierarchyRequestError'); this.ownerDocument.moved++; return this._put(n, ref || null, true); }
  getBoundingClientRect() { const r = this.ownerDocument.rectOf(this) || {}; const left = r.left || 0, top = r.top || 0, width = r.width || 0, height = r.height || 0; return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }; }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  get clientWidth() { return this.getBoundingClientRect().width; }
  get scrollHeight() { return this.ownerDocument.scrollHeightOf(this); }
  get scrollWidth() { return this.getBoundingClientRect().width; }
  focus() { if (this.isConnected) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { this.dispatchEvent(new Event('click', { bubbles: true })); }
  scrollIntoView(o) { this.ownerDocument.scrolledIntoView.push({ el: this, o }); const w = this.ownerDocument.defaultView; const r = this.getBoundingClientRect(); w.scrollTo({ top: Math.max(0, w.scrollY + r.top - (o && o.block === 'center' ? (w.innerHeight - r.height) / 2 : 0)) }); }
  animate() { return { cancel() {}, finished: Promise.resolve() }; }
  setPointerCapture() {}
  dispatchEvent(ev) {
    ev.target = this; const path = []; for (let n = this; n; n = n.parentNode) path.push(n);
    path.push(this.ownerDocument.defaultView);
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) path[i]._fire(ev, 'capture');
    if (!ev._stop) path[0]._fire(ev, 'target');
    if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) path[i]._fire(ev, 'bubble');
    return !ev.defaultPrevented;
  }
}
const serialize = (n) => {
  if (n instanceof Text) return RAW.has(n.parentNode?.localName) ? n.data : escText(n.data);
  if (n instanceof Comment) return `<!--${n.data}-->`;
  const attrs = [...n._a].map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
  return `<${n.localName}${attrs}>${(n.content || n).childNodes.map(serialize).join('')}</${n.localName}>`;
};

// ── the parser: tags, attributes, comments, raw-text elements. No implied end tags — the markup it
// is given is the renderer's, which closes what it opens.
function parseInto(root, html) {
  const doc = root.ownerDocument || root; const stack = [root]; let i = 0;
  const top = () => stack[stack.length - 1];
  const sink = () => { const t = top(); return t.content || t; };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { sink()._put(new Text(doc, decode(html.slice(i))), null); break; }
    if (lt > i) sink()._put(new Text(doc, decode(html.slice(i, lt))), null);
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); sink()._put(new Comment(doc, html.slice(lt + 4, e < 0 ? html.length : e)), null); i = e < 0 ? html.length : e + 3; continue; }
    if (html[lt + 1] === '!') { const e = html.indexOf('>', lt); i = e < 0 ? html.length : e + 1; continue; }   // doctype
    if (html[lt + 1] === '/') {
      const e = html.indexOf('>', lt); const name = html.slice(lt + 2, e).trim().toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].localName === name) { stack.length = k; break; }
      i = e + 1; continue;
    }
    const m = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(lt, lt + 80));
    if (!m) { sink()._put(new Text(doc, '<'), null); i = lt + 1; continue; }
    const el = new Element(doc, m[1]); let j = lt + m[0].length, selfClose = false;
    for (;;) {
      while (/\s/.test(html[j] || '')) j++;
      if (html[j] === '>') { j++; break; }
      if (html[j] === '/' && html[j + 1] === '>') { selfClose = true; j += 2; break; }
      if (j >= html.length) break;
      const a = /^([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/.exec(html.slice(j));
      if (!a) { j++; continue; }
      el._a.set(a[1].toLowerCase() === a[1] ? a[1] : a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      j += a[0].length;
    }
    if (el.localName === 'html' || el.localName === 'head' || el.localName === 'body') {
      // a whole document: these three exist already — take the attributes, parse the rest into them
      const target = el.localName === 'html' ? doc.documentElement : doc[el.localName];
      if (root === doc && target) { for (const [k, v] of el._a) target._a.set(k, v); stack.length = 1; stack.push(target); i = j; continue; }
    }
    sink()._put(el, null);
    if (RAW.has(el.localName)) {
      const close = html.toLowerCase().indexOf('</' + el.localName, j); const end = close < 0 ? html.length : close;
      if (end > j) el._put(new Text(doc, html.slice(j, end)), null);
      const gt = html.indexOf('>', end); i = close < 0 || gt < 0 ? html.length : gt + 1; continue;
    }
    if (!selfClose && !VOID.has(el.localName)) stack.push(el);
    i = j;
  }
}

class Document extends Node {
  constructor() {
    super(null); this.ownerDocument = this; this.nodeType = 9;
    this.left = []; this.moved = 0; this.hasMoveBefore = false; this.scrolledIntoView = [];
    this.rectOf = () => null; this.scrollHeightOf = () => 0;
    this.documentElement = new Element(this, 'html'); this._put(this.documentElement, null);
    this.head = new Element(this, 'head'); this.body = new Element(this, 'body');
    this.documentElement._put(this.head, null); this.documentElement._put(this.body, null);
    this.activeElement = this.body;
  }
  get isConnected() { return true; }
  get scrollingElement() { return this.documentElement; }
  get title() { const t = this.querySelector('title'); return t ? t.textContent : ''; }
  createElement(tag) { return new Element(this, tag); }
  createComment(data) { return new Comment(this, String(data ?? '')); }
  createTextNode(data) { return new Text(this, String(data)); }
  querySelector(s) { return queryAll(this, s)[0] || null; }
  querySelectorAll(s) { return queryAll(this, s); }
  getElementById(id) { return queryAll(this, '*').find((e) => e.id === id) || null; }
  elementFromPoint() { return null; }
}

/**
 * A window around one parsed page. opts: { url, storage: {k: v}, moveBefore: boolean,
 * innerWidth, innerHeight, reducedMotion }. The returned window is a vm context: `win.run(src)` runs a
 * classic script in it, exactly as a <script> would see it.
 *
 * `scripts: true` also runs the page's own INLINE scripts, in document order, once the page is parsed
 * (never an external one — there is no network here). That is how the head script that picks the
 * opening view is exercised as part of the page instead of as a string. 🔴 A real parser runs each
 * script as it reaches it; here they all see the whole document. The head script reads only <html>.
 */
export function makeWindow(html, opts = {}) {
  const doc = new Document(); doc.hasMoveBefore = !!opts.moveBefore;
  const store = new Map(Object.entries(opts.storage || {}));
  const url = new URL(opts.url || 'https://card.example/specimen');
  const timers = []; let now = 0, seq = 0;
  const nav = { reloads: 0, assigns: [] };
  const win = new EventTargetLike();
  Object.assign(win, {
    document: doc, console, URL,
    Event, CustomEvent: Event, Element, Node,
    DOMPoint: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } },
    DOMMatrix: class { transformPoint(p) { return p; } },
    innerWidth: opts.innerWidth || 390, innerHeight: opts.innerHeight || 844, scrollY: 0, scrollX: 0,
    nav, timers,
    localStorage: {
      getItem: (k) => { if (opts.storageThrows) throw new Error('SecurityError'); return store.has(k) ? store.get(k) : null; },
      setItem: (k, v) => { if (opts.storageThrows) throw new Error('SecurityError'); store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    history: { scrollRestoration: 'auto', pushed: 0, pushState() { this.pushed++; }, back() { this.pushed--; } },
    performance: { now: () => now },
    matchMedia: (q) => ({ matches: /reduced-motion/.test(q) ? !!opts.reducedMotion : false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ transform: 'none', overflowX: 'visible', getPropertyValue: () => '' }),
    getSelection: () => ({ toString: () => '' }),
    fetch: () => Promise.reject(new Error('mini-dom: no network')),
    setTimeout: (fn, ms = 0) => { timers.push({ id: ++seq, at: now + Math.max(0, ms), fn }); return seq; },
    clearTimeout: (id) => { const k = timers.findIndex((t) => t.id === id); if (k >= 0) timers.splice(k, 1); },
    requestAnimationFrame: (fn) => { timers.push({ id: ++seq, at: now + 16, fn }); return seq; },
    cancelAnimationFrame: (id) => win.clearTimeout(id),
    scrollTo: (a, b) => { const top = typeof a === 'object' ? a.top : b; if (top == null) return; const max = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight); const y = Math.max(0, Math.min(max, Math.round(top))); if (y === win.scrollY) return; win.scrollY = y; win._fire(new Event('scroll'), 'target'); },
    scrollBy: (a) => win.scrollTo({ top: win.scrollY + (a.top || 0) }),
    /** run everything due within the next `ms` (timers set while running included) */
    tick: (ms = 0) => { const until = now + ms; for (let guard = 0; guard < 1e5; guard++) { timers.sort((a, b) => a.at - b.at || a.id - b.id); if (!timers.length || timers[0].at > until) break; const t = timers.shift(); now = t.at; t.fn(now); } now = until; },
    dispatchEvent: (ev) => { ev.target = win; win._fire(ev, 'target'); return !ev.defaultPrevented; },
  });
  win.location = {
    get href() { return url.href; }, set href(v) { nav.assigns.push(String(v)); },
    get pathname() { return url.pathname; }, get origin() { return url.origin; }, get protocol() { return url.protocol; }, get hostname() { return url.hostname; },
    reload: () => { nav.reloads++; }, assign: (v) => { nav.assigns.push(String(v)); }, replace: (v) => { nav.assigns.push(String(v)); },
  };
  // a page calls these bare (`addEventListener('scroll', …)`), where `this` is not the window
  for (const k of ['addEventListener', 'removeEventListener']) win[k] = EventTargetLike.prototype[k].bind(win);
  win.window = win; win.self = win; win.globalThis = win; doc.defaultView = win;
  vm.createContext(win);
  win.run = (src, name = 'script') => vm.runInContext(src, win, { filename: name });
  parseInto(doc, html);
  if (opts.scripts) for (const s of doc.querySelectorAll('script')) if (!s.hasAttribute('src')) win.run(s.textContent, 'inline');
  return win;
}
