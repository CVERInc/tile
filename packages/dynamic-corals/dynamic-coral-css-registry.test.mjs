// Guard: every REGISTRY-SERVED coral with its own package CSS wraps that CSS in
// `@layer reef.corals { … }` when the document root declares `data-dynamic-coral-css="layered"`,
// and injects it completely unchanged — byte for byte — when the attribute is absent.
//   run: node packages/dynamic-corals/dynamic-coral-css-registry.test.mjs
//
// Three widgets, two shapes:
//   · square-shop.js / inbox-bubble.js — `bundle:false`, hand-written, ARE their own registry
//     artifact. They cannot import the shared helper (a widget mounts on any host page, sitetile
//     or not) and hardcode the same two literals locally instead — see the comment beside each.
//   · sponsor-core.mjs — `bundle:true`, esbuild-bundled by build.mjs. It imports
//     ../shared/dynamic-coral-css.mjs, the module this file also drives directly.
//
// Every arm below is driven through the REAL exported mount path (mount()/mountSponsor()), never
// a copy of the CSS text, and the "absent" and "layered" captures are compared to EACH OTHER (a
// differential, the same shape emit-dynamic-coral-css.test.mjs uses) rather than against a stored
// golden string — a regression in the real source is what turns this red, not a drift between two
// hand-maintained fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withDynamicCoralCssLayer, DYNAMIC_CORAL_CSS_ATTR } from './shared/dynamic-coral-css.mjs';
import { mountSponsor, resetStyleInjectionForTests as resetSponsorStyles } from './sponsor/sponsor-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The exact shape every arm must satisfy: legacy carries no `@layer`, and layered is legacy
 *  wrapped byte-for-byte — no reformatting, no re-selection of rules. */
function assertLayeringPair(legacy, layered, label) {
  assert.ok(legacy.length > 0, `${label}: legacy CSS must not be empty`);
  assert.equal(/@layer/.test(legacy), false, `${label}: undeclared CSS must carry no @layer at all`);
  assert.equal(layered, `@layer reef.corals {\n${legacy}\n}`, `${label}: layered CSS must be exactly the legacy text wrapped`);
}

// ── the shared helper itself ─────────────────────────────────────────────────────────────────

test('shared helper: absent/legacy doc → unchanged; layered doc → wrapped; a doc with no documentElement is legacy, not a throw', () => {
  const css = '.x{color:red}';
  assert.equal(withDynamicCoralCssLayer(css, { documentElement: { getAttribute: () => null } }), css);
  assert.equal(withDynamicCoralCssLayer(css, { documentElement: { getAttribute: () => 'layered' } }),
    '@layer reef.corals {\n' + css + '\n}');
  assert.equal(withDynamicCoralCssLayer(css, {}), css, 'no documentElement at all → legacy, no throw');
  assert.equal(withDynamicCoralCssLayer(css, { documentElement: { getAttribute: () => 'LAYERED' } }), css,
    'anything other than the exact token is legacy');
});

// ── sponsor (bundle:true, imports the shared helper, has its own reset seam) ───────────────────

function makeSponsorDoc(layered) {
  const children = [];
  return {
    documentElement: { getAttribute: (name) => (layered && name === DYNAMIC_CORAL_CSS_ATTR ? 'layered' : null) },
    head: { appendChild: (n) => children.push(n) },
    createElement: () => ({ setAttribute() {} }),
    _children: children,
  };
}
function makeSponsorEl() {
  return { getAttribute: () => null, appendChild() {}, setAttribute() {} };
}

test('sponsor: injectStyles wraps SPONSOR_CSS only when the doc declares layered', () => {
  resetSponsorStyles();
  const legacyDoc = makeSponsorDoc(false);
  mountSponsor(makeSponsorEl(), { document: legacyDoc, window: {} });
  assert.equal(legacyDoc._children.length, 1);
  const legacy = legacyDoc._children[0].textContent;

  resetSponsorStyles();
  const layeredDoc = makeSponsorDoc(true);
  mountSponsor(makeSponsorEl(), { document: layeredDoc, window: {} });
  assert.equal(layeredDoc._children.length, 1);
  const layered = layeredDoc._children[0].textContent;

  assertLayeringPair(legacy, layered, 'sponsor');
  assert.match(legacy, /\.dc-sponsor\{/, 'sanity: this is really SPONSOR_CSS, not an empty string');
});

// ── square-shop and inbox-bubble (bundle:false, hardcode the two literals, self-contained) ─────
//
// Both are real ES modules (`export { mount, … }`) that ALSO self-mount at import time when a
// `document` already exists — so each arm below installs its own globalThis.document FIRST, then
// imports a cache-busted copy (`?legacy-<n>` / `?layered-<n>`) so the module's own private
// `stylesInjected` flag starts fresh for that arm; re-importing the same bare specifier would hand
// back the already-evaluated module and its styles would already show as injected.
let cacheBust = 0;

function makeRootDocument(layered, extra) {
  const children = [];
  return Object.assign({
    documentElement: { getAttribute: (name) => (layered && name === DYNAMIC_CORAL_CSS_ATTR ? 'layered' : null) },
    head: { appendChild: (n) => children.push(n) },
    createElement: () => ({ setAttribute() {} }),
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll: () => [], // neutralize each file's own self-mount tail at import time
    _children: children,
  }, extra || {});
}

test('square-shop: client injectStyles() wraps only when the document root declares layered', async () => {
  async function capture(layered) {
    globalThis.document = makeRootDocument(layered);
    globalThis.window = { location: { href: '', origin: 'https://shop.example', pathname: '/shop' } };
    const url = pathToFileURL(join(HERE, 'square-shop', 'square-shop.js')).href + '?css-' + (++cacheBust);
    const mod = await import(url);
    const el = {
      _attrs: {},
      _classes: new Set(),
      classList: { add(c) { el._classes.add(c); } },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null; },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      set innerHTML(v) { el._html = v; },
      get innerHTML() { return el._html; },
    };
    // No data-guild-id / data-site-id: mount() calls injectStyles() then bails immediately —
    // the smallest real call that still exercises the exact source line under test.
    await mod.mount(el).catch(() => {});
    assert.equal(globalThis.document._children.length, 1, 'injectStyles must append exactly one <style>');
    return globalThis.document._children[0].textContent;
  }

  const legacy = await capture(false);
  const layered = await capture(true);
  assertLayeringPair(legacy, layered, 'square-shop');
  assert.match(legacy, /\.dc-square-shop \{/, 'sanity: this is really the widget CSS');
});

test('inbox-bubble: client injectStyles() wraps only when the document root declares layered', async () => {
  async function capture(layered) {
    globalThis.document = makeRootDocument(layered, { readyState: 'loading' });
    globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
    globalThis.location = { hash: '', hostname: 'example.test', href: 'https://example.test/' };
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const url = pathToFileURL(join(HERE, 'inbox-bubble', 'inbox-bubble.js')).href + '?css-' + (++cacheBust);
    const mod = await import(url);
    const el = {
      _attrs: { 'data-kind': 'guild', 'data-id': 'g-1' },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null; },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      set innerHTML(v) { el._html = v; },
      get innerHTML() { return el._html; },
      appendChild() {},
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
    };
    // mount() calls injectStyles() right after the data-kind/data-id check, before anything that
    // needs a fuller DOM — whatever happens afterward (this `el` is deliberately minimal) surfaces
    // only as a rejected promise, which the caller below discards.
    await mod.mount(el).catch(() => {});
    assert.equal(globalThis.document._children.length, 1, 'injectStyles must append exactly one <style>');
    return globalThis.document._children[0].textContent;
  }

  const legacy = await capture(false);
  const layered = await capture(true);
  assertLayeringPair(legacy, layered, 'inbox-bubble');
  assert.match(legacy, /\.dc-inbox-root\{/, 'sanity: this is really the widget CSS');
});
