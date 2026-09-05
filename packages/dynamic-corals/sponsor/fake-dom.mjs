// 🔴 A TEST FIXTURE. Nothing here ships — it is not imported by sponsor-client.mjs, it is not in
// build.mjs's coral table, and it must never be. It exists so the sponsor tests can press the
// button a visitor presses, in plain node, with no browser and no DOM library (this repo installs
// neither in CI — see scripts/test-clean.sh).
//
// 🔴 IT IS DELIBERATELY THE SMALLEST DOM THAT RUNS THE REAL CORAL, and the coral is written so
// that this is small: every node is built with createElement, the interesting nodes are kept as
// references rather than looked up by selector, and the parts are handed back from mountSponsor.
// So there is no HTML parser here and no selector engine — the two places a hand-rolled DOM starts
// lying about what a browser does.
//
// The honesty check on the fixture itself is in sponsor-mount.test.mjs: a CONTROL mount that
// deliberately does the wrong thing is run through this same fixture and must be CAUGHT. A harness
// that cannot fail is not evidence.

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.className = '';
    // A browser input has BOTH: the `value` attribute is the default, the `value` property is what
    // is on screen and what typing replaces. Keeping them separate here is what lets the test
    // simulate a visitor editing the field.
    this.value = '';
    this.disabled = false;
    this._text = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  }

  /** Returns whatever the handlers returned, so a test can await an async one. */
  dispatchEvent(type) {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    return (this.listeners[type] || []).map((h) => h(event));
  }

  click() {
    return this.dispatchEvent('click');
  }

  focus() {
    this.focused = true;
  }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }

  set textContent(value) {
    this.children = [];
    this._text = value === null || value === undefined ? '' : String(value);
  }

  /** Fixture-only convenience: depth-first search, so a test can name a node it did not keep. */
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const deeper = child.find(predicate);
      if (deeper) return deeper;
    }
    return null;
  }
}

export function fakeDocument() {
  const head = new FakeNode('head');
  return {
    head,
    readyState: 'complete',
    createElement: (tag) => new FakeNode(tag),
  };
}

export function fakeWindow(location) {
  const loc = Object.assign(
    { search: '', origin: 'https://site.example', pathname: '/support' },
    location || {},
  );
  const navigations = [];
  return {
    navigations,
    location: {
      search: loc.search,
      origin: loc.origin,
      pathname: loc.pathname,
      get href() {
        return loc.origin + loc.pathname + loc.search;
      },
      set href(value) {
        navigations.push(value);
      },
    },
  };
}

/** A fetch stand-in that records what was asked for and answers with what you tell it to. */
export function fakeFetch(response) {
  const calls = [];
  const fetch = (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const answer = typeof response === 'function' ? response(calls.length) : response;
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({
      ok: answer.ok !== false,
      status: answer.status || 200,
      json: () => Promise.resolve(answer.json === undefined ? {} : answer.json),
    });
  };
  fetch.calls = calls;
  return fetch;
}

export { FakeNode };
