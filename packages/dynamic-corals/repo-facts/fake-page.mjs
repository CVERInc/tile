// 🔴 A TEST FIXTURE. Nothing here ships — it is not imported by repo-facts-client.mjs and must
// never be. It exists so the repo-facts tests can run the real coral against a REAL saved page in
// plain node, with no browser and no DOM library (this repo installs neither in CI).
//
// sponsor/fake-dom.mjs gets away with no HTML parser because sponsor builds everything it touches.
// This coral is the opposite: its whole job is to read a page somebody else rendered and change as
// little of it as possible. So the fixture has to hold a real page, and the claim under test —
// "on any failure the page is byte-identical" — needs a page that can be written back out.
//
// 🔴 HOW IT STAYS HONEST. Every parsed node keeps the exact source text it came from, and
// serialising an untouched tree is the concatenation of those slices. So `serialize(parse(html))
// === html` is not a property of a clever printer — it holds because nothing was re-printed, and
// repo-facts-page.test.mjs asserts it on the real page before trusting anything else. Only nodes
// the coral CREATES are printed from their fields, and text is escaped on the way out, which is
// what lets a test see the difference between "written as text" and "written as markup".
//
// 🔴 WHAT IT REFUSES. There is no innerHTML, outerHTML or insertAdjacentHTML — setting one THROWS.
// A coral that builds markup from an answer it did not write does not get a fixture that helps it.
// The selector engine is as small as the coral's own selectors and throws on anything it does not
// understand, rather than matching nothing and letting a test pass on an empty list.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);

const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|#x27);/g,
  (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[e]);
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');

class FakeText {
  constructor(text, raw) {
    this.nodeType = 3;
    this.parentNode = null;
    this._text = text;
    this._raw = raw === undefined ? null : raw;
  }

  get textContent() { return this._text; }

  serialize() { return this._raw !== null ? this._raw : escapeText(this._text); }
}

class FakeElement {
  constructor(tagName, doc) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.localName = String(tagName).toLowerCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
    this.attributes = new Map();
    this._rawOpen = null;
    this._rawClose = null;
  }

  // ── attributes ────────────────────────────────────────────────────────────────────────────
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    this._rawOpen = null;   // a changed element is printed from its fields from now on
  }

  get className() { return this.getAttribute('class') || ''; }

  set className(v) { this.setAttribute('class', v); }

  get lang() { return this.getAttribute('lang') || ''; }

  get dateTime() { return this.getAttribute('datetime') || ''; }

  set dateTime(v) { this.setAttribute('datetime', v); }

  /** Like a browser's `a.href`: the attribute resolved against the page's address. */
  get href() {
    try { return new URL(this.getAttribute('href') || '', this.ownerDocument.baseURI).href; } catch { return ''; }
  }

  // ── the ways markup could be built from a string, all refused ────────────────────────────────
  set innerHTML(_) { throw new Error('fake-page: innerHTML is not available — write text, not markup'); }

  set outerHTML(_) { throw new Error('fake-page: outerHTML is not available — write text, not markup'); }

  insertAdjacentHTML() { throw new Error('fake-page: insertAdjacentHTML is not available — write text, not markup'); }

  // ── tree ──────────────────────────────────────────────────────────────────────────────────
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }

  get firstChild() { return this.childNodes[0] || null; }

  _adopt(node) {
    const n = typeof node === 'string' ? new FakeText(node) : node;
    if (n.parentNode) n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n), 1);
    n.parentNode = this;
    return n;
  }

  appendChild(node) {
    this.childNodes.push(this._adopt(node));
    return node;
  }

  append(...nodes) { for (const n of nodes) this.appendChild(n); }

  insertBefore(node, ref) {
    const n = this._adopt(node);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (ref && at < 0) throw new Error('fake-page: insertBefore reference is not a child of this node');
    if (at < 0) this.childNodes.push(n); else this.childNodes.splice(at, 0, n);
    return node;
  }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }

  set textContent(v) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = [];
    const text = v === null || v === undefined ? '' : String(v);
    if (text) this.appendChild(new FakeText(text));
  }

  // ── selectors ─────────────────────────────────────────────────────────────────────────────
  matches(selector) { return parseSelector(selector).some((chain) => matchesChain(this, chain)); }

  closest(selector) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n;
    return null;
  }

  querySelectorAll(selector) {
    const chains = parseSelector(selector), out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        if (chains.some((chain) => matchesChain(child, chain))) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  serialize() {
    const inner = this.childNodes.map((n) => n.serialize()).join('');
    if (this._rawOpen !== null) return this._rawOpen + inner + this._rawClose;
    const attrs = [...this.attributes].map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    return `<${this.localName}${attrs}>${inner}</${this.localName}>`;
  }
}

// A selector list of descendant chains of compound selectors: `a[href]`, `.st-item .st-item-gh`,
// `[data-x="y"]`, `tag.class#id`. Anything else (>, +, ~, :pseudo) throws.
function parseSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim()) throw new SyntaxError(`fake-page: empty selector`);
  return selector.split(',').map((part) => part.trim().split(/\s+/).map((compound) => {
    const m = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/.exec(compound);
    if (!m || !compound) throw new SyntaxError(`fake-page: unsupported selector "${selector}"`);
    const tests = [];
    if (m[1] && m[1] !== '*') tests.push((el) => el.localName === m[1].toLowerCase());
    for (const t of m[2].match(/[.#][\w-]+|\[[\w-]+(?:="[^"]*")?\]/g) || []) {
      if (t[0] === '.') tests.push((el) => el.className.split(/\s+/).includes(t.slice(1)));
      else if (t[0] === '#') tests.push((el) => el.getAttribute('id') === t.slice(1));
      else {
        const [, name, , value] = /^\[([\w-]+)(="([^"]*)")?\]$/.exec(t);
        tests.push((el) => (value === undefined ? el.getAttribute(name) !== null : el.getAttribute(name) === value));
      }
    }
    return (el) => tests.every((test) => test(el));
  }));
}

function matchesChain(el, chain) {
  if (!chain[chain.length - 1](el)) return false;
  let i = chain.length - 2;
  for (let n = el.parentNode; i >= 0 && n && n.nodeType === 1; n = n.parentNode) if (chain[i](n)) i--;
  return i < 0;
}

class FakeDocument extends FakeElement {
  constructor(baseURI) {
    super('#document', null);
    this.nodeType = 9;
    this.ownerDocument = this;
    this.baseURI = baseURI;
    this.readyState = 'complete';
  }

  get documentElement() { return this.children.find((n) => n.localName === 'html') || null; }

  createElement(tag) { return new FakeElement(tag, this); }

  serialize() { return this.childNodes.map((n) => n.serialize()).join(''); }
}

/**
 * Parse a page. Strict on purpose: a close tag that does not match the open element THROWS, since
 * guessing at broken markup is exactly where a hand-rolled parser starts to disagree with a browser.
 */
export function parsePage(html, baseURI = 'https://site.example/') {
  const doc = new FakeDocument(baseURI);
  const stack = [doc];
  const top = () => stack[stack.length - 1];
  const raw = (text, markup) => { const n = new FakeText(markup ? '' : decode(text), text); n.parentNode = top(); top().childNodes.push(n); };
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') {
      const end = html.indexOf('<', i);
      raw(html.slice(i, end < 0 ? html.length : end));
      i = end < 0 ? html.length : end;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i);
      if (end < 0) throw new Error('fake-page: unterminated comment');
      raw(html.slice(i, end + 3), true);
      i = end + 3;
      continue;
    }
    if (html[i + 1] === '!') {
      const end = html.indexOf('>', i);
      raw(html.slice(i, end + 1), true);
      i = end + 1;
      continue;
    }
    if (html[i + 1] === '/') {
      const end = html.indexOf('>', i);
      const name = html.slice(i + 2, end).trim().toLowerCase();
      const open = stack.pop();
      if (stack.length === 0 || open.localName !== name) {
        throw new Error(`fake-page: </${name}> closes <${open.localName}> near offset ${i}`);
      }
      open._rawClose = html.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    // an open tag: read to the `>` that is not inside a quoted attribute value
    let end = i + 1, quote = '';
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break;
    }
    const source = html.slice(i, end + 1);
    const m = /^<([a-zA-Z][\w:-]*)/.exec(source);
    if (!m) {            // a bare `<` in text
      raw('<');
      i += 1;
      continue;
    }
    const el = new FakeElement(m[1], doc);
    const attrRe = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const attrText = source.slice(m[0].length, source.endsWith('/>') ? -2 : -1);
    for (let a; (a = attrRe.exec(attrText));) el.attributes.set(a[1].toLowerCase(), decode(a[2] ?? a[3] ?? a[4] ?? ''));
    el._rawOpen = source;
    el._rawClose = '';
    el.parentNode = top();
    top().childNodes.push(el);
    i = end + 1;
    if (VOID.has(el.localName) || source.endsWith('/>')) continue;
    if (RAW_TEXT.has(el.localName)) {
      const close = html.toLowerCase().indexOf(`</${el.localName}`, i);
      if (close < 0) throw new Error(`fake-page: unterminated <${el.localName}>`);
      const text = html.slice(i, close);
      if (text) { const n = new FakeText(text, text); n.parentNode = el; el.childNodes.push(n); }
      const closeEnd = html.indexOf('>', close);
      el._rawClose = html.slice(close, closeEnd + 1);
      i = closeEnd + 1;
      continue;
    }
    stack.push(el);
  }
  if (stack.length !== 1) throw new Error(`fake-page: <${top().localName}> was never closed`);
  return doc;
}

/** A fetch stand-in that records what was asked for, honours the abort signal, and answers as told. */
export function fakeFetch(answer) {
  const calls = [];
  const fetch = (url, init = {}) => {
    calls.push({ url, init });
    const a = typeof answer === 'function' ? answer(url, init) : answer;
    return new Promise((resolve, reject) => {
      // node's AbortSignal.timeout() does not keep the process alive on its own, so a fetch that
      // is still waiting holds the event loop open the way a real pending request would.
      const waiting = setInterval(() => {}, 1000);
      const settle = (fn) => (v) => { clearInterval(waiting); fn(v); };
      resolve = settle(resolve);
      reject = settle(reject);
      const abort = () => reject(init.signal.reason || new Error('aborted'));
      if (init.signal) {
        if (init.signal.aborted) return abort();
        init.signal.addEventListener('abort', abort);
      }
      if (a === 'hang') return;     // never answers — only the caller's own timeout ends this
      if (a instanceof Error) return reject(a);
      resolve({
        ok: a.status === undefined || (a.status >= 200 && a.status < 300),
        status: a.status || 200,
        json: () => (a.text !== undefined ? Promise.resolve().then(() => JSON.parse(a.text)) : Promise.resolve(a.json)),
      });
    });
  };
  fetch.calls = calls;
  return fetch;
}

export { FakeElement, FakeText };
