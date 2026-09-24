// HOST MODE boot, run against the REAL generated bundle (serve/edit2-assets.mjs) in a minimal DOM
// stub — no browser. It proves the one thing that went wrong in production: before card:load, the
// sandbox seed ("Sam, family doctor…") must never reach the canvas.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { EDIT2_JS } from '../serve/edit2-assets.mjs';
import { buildSandboxCard } from '../w/sandbox-i18n.mjs';

const HOST = 'https://feelreef.com';
const REAL = ['---', 'card-page: mei', 'title: 小美', '---', '', '## cards', '',
  '- [ ] %% card: profile w=6 %% a real bio',
  '- [ ] %% card: link w=6 %% [Instagram](https://instagram.com/x)'].join('\n') + '\n';

/** an element that accepts anything: properties stick, methods are no-ops */
function stubEl(id) {
  const props = { id, dataset: {}, style: {}, hidden: false, children: [] };
  const fns = {
    addEventListener() {}, removeEventListener() {}, setAttribute(k, v) { props[`@${k}`] = v; }, getAttribute(k) { return props[`@${k}`] ?? null; },
    appendChild(c) { props.children.push(c); return c; }, append() {}, prepend() {}, remove() {}, replaceChildren() {}, focus() {}, blur() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }; }, scrollIntoView() {},
    insertAdjacentHTML() {}, insertBefore(c) { return c; }, cloneNode() { return stubEl(id); }, click() {},
  };
  props.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  return new Proxy(props, {
    get(t, k) { if (k in fns) return fns[k]; if (k in t) return t[k]; if (k === 'contentWindow' || k === 'contentDocument') return null; return undefined; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function bootHost() {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, stubEl(id)); return els.get(id); };
  const listeners = {};
  const posted = [];
  const timers = [];
  const body = stubEl('body');
  const document = {
    documentElement: stubEl('html'), body, head: stubEl('head'),
    getElementById: get, querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => stubEl(t), createTextNode: (t) => ({ t }), createDocumentFragment: () => stubEl('frag'),
    addEventListener() {}, removeEventListener() {},
  };
  const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const window = {
    document, location: new URL('https://card.feelreef.com/edit?host=https%3A%2F%2Ffeelreef.com'),
    navigator: { language: 'en' }, localStorage: storage(), sessionStorage: storage(),
    parent: { postMessage: (msg, origin) => posted.push({ msg, origin }) },
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); }, removeEventListener() {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} }, console, structuredClone, URL, URLSearchParams,
  };
  window.window = window; window.self = window; window.globalThis = window;
  const ctx = vm.createContext({ ...window, window });
  vm.runInContext(EDIT2_JS, ctx);
  ctx.window.__cardtileW2Boot({ host: HOST, sandbox: false, locale: 'en', tableBase: '/try/edit/t/en/' });
  const runTimers = () => { const due = timers.splice(0); for (const t of due) if (t.fn) t.fn(); };
  const message = (data, origin = HOST) => { for (const fn of listeners.message || []) fn({ origin, data }); };
  return { get, body, document, posted, runTimers, message, timers };
}

test('🔴 host mode with no card:load: the canvas never receives the seed, and the page says it is waiting', () => {
  const h = bootHost();
  const src = h.get('canvas').srcdoc;
  assert.ok(!src || !/data-cell/.test(src), 'no [data-cell] before card:load');
  const seedName = /title: (.+)/.exec(buildSandboxCard('en'))[1];
  assert.ok(!src || !src.includes(seedName), 'no seed text');
  assert.equal(h.body.dataset.hostWaiting, '1');
  assert.equal(h.get('host-status').hidden, false);
  assert.equal(h.get('host-status').textContent, 'Waiting for the page…');
  // …and it keeps asking
  assert.deepEqual(h.posted.map((p) => [p.msg.type, p.origin]), [['card:ready', HOST]]);
  h.runTimers(); h.runTimers();
  assert.equal(h.posted.filter((p) => p.msg.type === 'card:ready').length, 3);
});

test('host mode: card:load renders THE card, and the ready announcements stop', () => {
  const h = bootHost();
  h.message({ type: 'card:load', v: 1, md: REAL, handle: 'mei', cardUrl: 'https://card.feelreef.com/mei' });
  const src = h.get('canvas').srcdoc;
  assert.match(src, /data-cell/);
  assert.ok(src.includes('a real bio'));
  assert.equal(h.body.dataset.hostWaiting, undefined);
  const before = h.posted.length;
  h.runTimers(); h.runTimers();
  assert.equal(h.posted.filter((p) => p.msg.type === 'card:ready').length, 1);
  assert.ok(h.posted.length >= before);
});

// 🔴 the bug this pair guards: before card:load lands, `/edit?host=…` used to carry the SANDBOX's
// title ("Try Card · feelreef") even while framed in the owner's dashboard editing a real card —
// see card-worker.mjs's sandboxEditorHtml() and the `hostPageTitle` it now renders instead.
test('host mode: document.title is the bare placeholder before card:load, the card\'s own name after', () => {
  const h = bootHost();
  assert.equal(h.document.title, 'Card · feelreef');
  h.message({ type: 'card:load', v: 1, md: REAL, handle: 'mei', cardUrl: 'https://card.feelreef.com/mei' });
  assert.equal(h.document.title, '小美 · Card · feelreef');
});

test('host mode: document.title falls back to the handle when the loaded card carries no frontmatter title', () => {
  const h = bootHost();
  const noTitle = ['## cards', '', '- [ ] %% card: profile w=6 %% a real bio'].join('\n') + '\n';
  h.message({ type: 'card:load', v: 1, md: noTitle, handle: 'mei', cardUrl: 'https://card.feelreef.com/mei' });
  assert.equal(h.document.title, 'mei · Card · feelreef');
});

test('CONTROL: the stub does record a painted seed (loaded through card:load)', () => {
  // without this, "no srcdoc" above could mean the stub never records a paint at all
  const h = bootHost();
  h.message({ type: 'card:load', v: 1, md: buildSandboxCard('en'), handle: 'try' });
  assert.ok(h.get('canvas').srcdoc.includes(/title: (.+)/.exec(buildSandboxCard('en'))[1]));
});
