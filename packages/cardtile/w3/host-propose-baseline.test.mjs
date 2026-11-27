// A draft that arrives from outside the editor (an agent's suggestion, a preview opened from its bar) is a
// PROPOSAL against the saved Cards, never the saved Cards themselves. The parent loads what is stored
// (`card:load`) and hands the draft over with `card:propose`; the editor then shows the draft as unsaved,
// Save and Cmd/Ctrl+S work at once, and Discard goes back to what is stored.
//
// The other way round, the draft sent as `card:load`, is pinned too: the editor takes it AS the saved Cards
// (nothing to save, and Discard comes back to the draft) — which is why a parent must never do that.
//
// Like open-panel-draft.test.mjs, this runs the editor AS SHIPPED (serve/edit3-assets.mjs) in the stand-in DOM.
//
//   node --test packages/cardtile/w3/host-propose-baseline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDIT3_JS, EDIT3_BODY_HTML } from '../serve/edit3-assets.mjs';
import { makeWindow, Event } from './mini-dom.mjs';

const HOST = 'https://feelreef.com';
const card = (words) => ['---', 'card-page: specimen', 'title: Specimen', '---', '', '## cards', '',
  `- [ ] %% card: text w=6 %% ${words}`, '- [ ] %% card: link w=3 %% [One](https://example.com/1)', ''].join('\n');
const HOST_KEY = 'cardtile:w3:host-draft:specimen';
const SAVED = card('What is stored.');
const DRAFT = card('What the preview proposed.');

/** the shipped editor in host mode, framed by HOST, with nothing loaded yet */
async function boot({ storage = {} } = {}) {
  const url = `https://card.example/edit?host=${encodeURIComponent(HOST)}`;
  const win = makeWindow(`<!doctype html><html><head><title>t</title></head><body>${EDIT3_BODY_HTML}</body></html>`, { url, storage });
  const posted = [];
  Object.assign(win, {
    URLSearchParams, structuredClone, navigator: { language: 'en', userAgent: '' },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    __CARDTILE_W3_OPTS__: { host: HOST, sandbox: false, locale: 'en', assets: { 'obsidian-shim.js': 'shim', 'editor-core.js': 'core', 'web-host.js': 'host' } },
    parent: { postMessage: (msg, origin) => posted.push({ ...msg, origin }) },
    __import: async (name) => ({
      shim: {},
      host: { makeWebHost: () => ({ plugin: { settings: { editorTools: {} } } }) },
      // the open sheet's text editor: type() puts words in it (what Done then keeps)
      core: { mountEditor: (box, o) => { let raw = o.text; return (win.prose = { rawValue: () => raw, type: (t) => { raw = t; } }); } },
    }[name]),
  });
  win.location.search = new URL(url).search;
  await win.run(`(async () => {${EDIT3_JS.replace(/await import\(ASSET\[/g, 'await __import(ASSET[')}\n})()`, 'edit3.js');
  const doc = win.document, $ = (id) => doc.getElementById(id);
  const from = (data) => win.dispatchEvent(Object.assign(new Event('message'), { origin: HOST, data: { v: 1, ...data } }));
  return {
    win, doc, $, posted, from,
    get w3() { return win.__cardtileW3; },
    load(md) { from({ type: 'card:load', md, handle: 'specimen', cardUrl: 'https://card.example/specimen' }); win.tick(1000); posted.length = 0; },
    /** the main button, in edit mode (where it is Save) */
    saveButton() { if (!$('editbtn').classList.contains('is-save')) $('editbtn').click(); return $('editbtn'); },
    ctrlS() { doc.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true }), { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 's', preventDefault() {} })); },
    view(v) { [...doc.querySelectorAll('.modes button')].find((b) => b.dataset.view === v).click(); },
    sent: (type) => posted.filter((p) => p.type === type),
    /** what this browser keeps for the Card (the host-draft key), parsed */
    kept: () => JSON.parse(win.localStorage.getItem(HOST_KEY) || 'null'),
    /** every key this browser holds, as a later visit would find them */
    storage: () => Object.fromEntries([HOST_KEY].filter((k) => win.localStorage.getItem(k) != null).map((k) => [k, win.localStorage.getItem(k)])),
    /** the owner changes the first tile's words with its sheet and Done */
    type(words) {
      if (!doc.querySelectorAll('#row .pen').length) $('editbtn').click();
      doc.querySelectorAll('#row .pen')[0].click();
      win.prose.type(words); $('modal-save').click();
    },
  };
}

test('🔴 the saved Cards loaded, the draft proposed: unsaved at once, measured against what is stored', async () => {
  const e = await boot();
  e.load(SAVED);
  e.from({ type: 'card:propose', md: DRAFT });
  assert.equal(e.w3.savedMd, SAVED, 'the baseline is the stored Cards');
  assert.equal(e.w3.md, DRAFT, 'the draft is what is shown');
  assert.equal(e.w3.dirty, true, 'and it is unsaved, before anything is typed');
  assert.equal(e.sent('card:save').length, 0, 'a proposal never saves by itself');
  e.win.tick(1000);
  assert.deepEqual(e.sent('card:change').map((c) => c.dirty), [true], 'the parent is told it is unsaved');
  const save = e.saveButton();
  assert.equal(save.disabled, false, 'Save can be pressed at once');
  assert.ok(save.querySelector('.hd-dot'), 'and the unsaved dot is drawn');
});

test('🔴 Cmd/Ctrl+S saves the proposal at once — the draft, to the parent', async () => {
  const e = await boot();
  e.load(SAVED);
  e.from({ type: 'card:propose', md: DRAFT });
  e.ctrlS();
  assert.deepEqual(e.sent('card:save').map((m) => m.md), [DRAFT]);
});

test('🔴 Discard goes back to the stored Cards, not to the draft', async () => {
  const e = await boot();
  e.load(SAVED);
  e.from({ type: 'card:propose', md: DRAFT });
  e.saveButton();                    // edit mode
  e.view('stack');                   // leaving it with something unsaved asks
  assert.equal(e.$('leavemodal').hidden, false, 'the leave question is asked');
  e.$('leave-discard').click();
  assert.equal(e.w3.md, SAVED);
  assert.equal(e.w3.dirty, false);
  e.win.tick(1000);
  assert.equal(e.sent('card:change').at(-1).dirty, false, 'the parent is told nothing is unsaved');
  assert.equal(e.sent('card:save').length, 0);
});

test('CONTROL: the draft sent as card:load is taken as the saved Cards — nothing to save, and Discard keeps the draft', async () => {
  const e = await boot();
  e.load(DRAFT);
  assert.equal(e.w3.savedMd, DRAFT);
  assert.equal(e.w3.dirty, false);
  assert.equal(e.saveButton().disabled, true, 'Save cannot be pressed');
  e.ctrlS();
  assert.equal(e.sent('card:save').length, 0, 'Cmd/Ctrl+S does nothing');
});

// ── a proposal is not the owner's work (security review r2) ──────────────────────────────────────────
// It is never written to this browser's draft just by arriving: closing the tab, or Discard, leaves no trace
// of it, and a later plain visit opens the stored Cards. Once the owner changes something it is their edit and
// is kept like any other. And a proposal never replaces a draft they have not saved: it is refused, said so.

test('🔴 a proposal arriving writes nothing to this browser: a later plain visit opens the stored Cards', async () => {
  const e = await boot();
  e.load(SAVED);
  e.from({ type: 'card:propose', md: DRAFT });
  e.win.dispatchEvent(new Event("pagehide"));   // the tab is closed
  assert.equal(e.kept(), null, 'no draft is kept for the Card');
  const later = await boot({ storage: e.storage() });
  later.load(SAVED);
  assert.equal(later.w3.md, SAVED, 'the later visit shows what is stored, never the proposal');
  assert.equal(later.w3.dirty, false);
});

test('🔴 a proposal discarded leaves no trace', async () => {
  const e = await boot();
  e.load(SAVED);
  e.from({ type: 'card:propose', md: DRAFT });
  e.saveButton();                    // edit mode
  e.view('stack');                   // leaving it with something unsaved asks
  assert.equal(e.$('leavemodal').hidden, false, 'the leave question is asked');
  e.$('leave-discard').click();
  assert.equal(e.w3.md, SAVED);
  assert.equal(e.kept(), null);
  const later = await boot({ storage: e.storage() });
  later.load(SAVED);
  assert.equal(later.w3.md, SAVED);
});

test('🔴 once the owner changes the proposal it is their edit, and kept like any other', async () => {
  const e = await boot();
  e.load(SAVED);
  e.from({ type: 'card:propose', md: DRAFT });
  e.type('Their own words.');
  const kept = e.kept();
  assert.ok(kept, 'their edit is kept');
  assert.equal(kept.base, SAVED);
  assert.equal(kept.md, DRAFT.replace('What the preview proposed.', 'Their own words.'));
  const later = await boot({ storage: e.storage() });
  later.load(SAVED);
  assert.equal(later.w3.md, kept.md, 'and comes back on a later visit, as their drafts do');
});

test('🔴 an unsaved draft of the owner\'s own is never replaced by a proposal: refused, with the reason', async () => {
  const first = await boot();
  first.load(SAVED);
  first.type('Theirs, not saved.');
  const theirs = first.kept().md;
  const e = await boot({ storage: first.storage() });
  e.load(SAVED);
  assert.equal(e.w3.md, theirs, 'their draft opens, as it does today');
  e.from({ type: 'card:propose', md: DRAFT });
  assert.equal(e.w3.md, theirs, 'the proposal is not applied');
  assert.equal(e.kept().md, theirs, 'and their kept draft is untouched');
  const failed = e.sent('card:propose-failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason, 'unsaved', 'the parent is told why, in a field it can read');
  assert.equal(failed[0].origin, HOST);
  assert.notEqual(e.$('notice-bottom')?.dataset.kind, 'proposed', 'no 「proposed」 confirmation is shown');
});

test('🔴 a proposal applied to a Card that opens as a row puts the editor in edit mode: the main button is Save', async () => {
  const e = await boot();
  e.load(SAVED);
  assert.equal(e.$('editbtn').classList.contains('is-save'), false, 'control: loaded, the button is Edit');
  e.from({ type: 'card:propose', md: DRAFT });
  const b = e.$('editbtn');
  assert.equal(b.classList.contains('is-save'), true, 'the main button reads Save at once');
  assert.equal(b.disabled, false);
  assert.ok(b.textContent.includes('Save'));
});
