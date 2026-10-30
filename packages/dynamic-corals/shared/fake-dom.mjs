// A test double for the slice of the DOM that shared/flip.mjs and countdown/countdown-core.mjs use,
// and nothing more: elements with className/classList, attributes, children, textContent, and
// querySelector(All) for `.class`, `[attr]` and `[attr="v"]` — one simple selector each, which is
// every selector those two modules pass. A selector this does not understand THROWS rather than
// matching nothing, so a source change that starts relying on more DOM fails loudly here instead of
// passing against a thinner double. Never shipped.

function parse(sel) {
  let m;
  if ((m = /^\.([\w-]+)$/.exec(sel))) return (el) => el.classList.contains(m[1]);
  if ((m = /^\[([\w-]+)\]$/.exec(sel))) return (el) => el.getAttribute(m[1]) !== null;
  if ((m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel))) return (el) => el.getAttribute(m[1]) === m[2];
  throw new Error(`fake-dom: unsupported selector ${sel}`);
}

class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.className = '';
    this._text = '';
    this.hidden = false;
    this.offsetWidth = 0;
    const self = this;
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (c) => { if (!self.classList.contains(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
    };
  }
  get firstChild() { return this.children[0] || null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); if (n === 'hidden') this.hidden = true; }
  getAttribute(n) { if (n === 'class') return this.className || null; return this.attrs.has(n) ? this.attrs.get(n) : null; }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; }
  set textContent(v) { for (const c of [...this.children]) this.removeChild(c); this._text = String(v); }
  *descendants() { for (const c of this.children) { yield c; yield* c.descendants(); } }
  querySelectorAll(sel) { const test = parse(sel); return [...this.descendants()].filter(test); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

export function createDocument() {
  const doc = { createElement: (tag) => new FakeElement(tag, doc) };
  doc.documentElement = new FakeElement('html', doc);
  doc.head = new FakeElement('head', doc);
  doc.body = new FakeElement('body', doc);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
  return doc;
}

/** A clock the test advances by hand; setTimeout/setInterval fire only inside `advance`. */
export function createClock(start) {
  let now = start, seq = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: 0 }); return id; },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },
  };
  return clock;
}
