// ✕ on a tile just added by 「＋加一張牌」 and never saved discards it — the card goes back to
// exactly the markdown it had before the pick. Done keeps it, as today; an EXISTING tile's ✕ also
// keeps it, as today. See edit2.mjs's `S.newTile` / `newTileCancelTarget` / `closeModal`.
//
// Two layers: `newTileCancelTarget` is pure (no DOM, imported straight from source) — the actual
// decision of what a cancel restores. The rest is end-to-end against the REAL generated bundle
// (serve/edit2-assets.mjs), the same host-boot.test.mjs style, because the bug was only ever
// visible through addCell → openCell → closeModal wired together.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { newTileCancelTarget } from './edit2.mjs';
import { EDIT2_JS } from '../serve/edit2-assets.mjs';

// ── pure ─────────────────────────────────────────────────────────────────────────────────────────

test('newTileCancelTarget: no tracked tile → not a cancel-worthy close', () => {
  assert.equal(newTileCancelTarget(null, 3), null);
});

test('newTileCancelTarget: tracked tile, but a DIFFERENT slot is closing (an existing tile) → null', () => {
  assert.equal(newTileCancelTarget({ slot: 2, preMd: 'A', undoFloor: 0 }, 5), null);
});

test('newTileCancelTarget: tracked tile IS the one closing → the pre-add markdown', () => {
  assert.equal(newTileCancelTarget({ slot: 2, preMd: 'A', undoFloor: 0 }, 2), 'A');
});

// ── end-to-end, against the real bundle ─────────────────────────────────────────────────────────

/** minimal DOM stub — a value on every field defaults to '', so an unrelated field a test never
 * touches (composeCell reads every PARAM row unconditionally) never crashes on `undefined.trim()`. */
function stubEl(id) {
  const props = { id, dataset: {}, style: {}, hidden: false, children: [], value: '' };
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

function bootSandbox() {
  const els = new Map();
  const get = (id) => { if (!els.has(id)) els.set(id, stubEl(id)); return els.get(id); };
  const body = stubEl('body');
  const document = {
    documentElement: stubEl('html'), body, head: stubEl('head'),
    getElementById: get, querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => stubEl(t), createTextNode: (t) => ({ t }), createDocumentFragment: () => stubEl('frag'),
    addEventListener() {}, removeEventListener() {},
  };
  const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const window = {
    document, location: new URL('https://card.feelreef.com/try/edit'),
    navigator: { language: 'en' }, localStorage: storage(), sessionStorage: storage(),
    parent: { postMessage() {} },
    addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), ResizeObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} }, console, structuredClone, URL, URLSearchParams,
  };
  window.window = window; window.self = window; window.globalThis = window;
  const ctx = vm.createContext({ ...window, window });
  vm.runInContext(EDIT2_JS, ctx);
  ctx.window.__cardtileW2Boot({ sandbox: true, locale: 'en', tableBase: '/try/edit/t/en/' });
  return { get, api: ctx.window.__cardtileW2 };
}

test('add a tile → ✕ before Done → markdown identical to before the add', () => {
  const { api } = bootSandbox();
  const before = api.md;
  const faceLane = api.lanes.find((l) => l.kind !== 'drawer').key;
  api.addCell('video', faceLane);
  assert.notEqual(api.md, before, 'the add really did change the card first');
  assert.ok(api.newTile, 'the new tile is tracked while its sheet is open');
  api.closeModal();
  assert.equal(api.md, before, '✕ put the card back to the exact bytes it had before the pick');
  assert.equal(api.newTile, null);
});

test('add a tile → Done → the tile is present, and a LATER ✕ (a re-open) no longer discards it', () => {
  const { api } = bootSandbox();
  const before = api.md;
  const faceLane = api.lanes.find((l) => l.kind !== 'drawer').key;
  api.addCell('text', faceLane);
  assert.ok(api.newTile);
  api.saveCell();
  assert.notEqual(api.md, before, 'Done keeps it');
  const savedMd = api.md;
  assert.equal(api.newTile, null, 'no longer "just added, never saved" once Done fired');
  // reopening the same tile and pressing ✕ now is an EXISTING tile's ✕ — close, keep
  const slot = api.slots.length - 1;
  api.openCell(slot);
  api.closeModal();
  assert.equal(api.md, savedMd, 'existing tile ✕ keeps today\'s behaviour: close, keep');
});

test('✕ on an EXISTING tile (never added this session) keeps it — unchanged from today', () => {
  const { api } = bootSandbox();
  const before = api.md;
  api.openCell(0);
  api.closeModal();
  assert.equal(api.md, before);
});
