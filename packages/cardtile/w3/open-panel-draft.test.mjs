// What is typed in an open sheet is part of the draft once the page is hidden or unloaded (tile#309).
//
// A sheet's words reach the file only on Done, so a frame that went away with a sheet open lost them
// without a question: the draft key never held them and the parent was never told the Cards were
// dirty. These tests run the editor AS SHIPPED — the bundle in serve/edit3-assets.mjs, the one the
// Worker serves — in the stand-in DOM, open a sheet by its pencil, type, and fire the page's own
// `pagehide` / `visibilitychange`.
//
// 🔴 What this cannot say. The stand-in has no layout and no real text editor: the family editor is a
// stand-in with the two things the sheet uses (mountEditor → rawValue, onChange). Whether a given
// browser fires `pagehide` for a frame its parent drops is a browser's answer, not this file's.
//
//   node --test packages/cardtile/w3/open-panel-draft.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EDIT3_JS, EDIT3_BODY_HTML } from '../serve/edit3-assets.mjs';
import { makeWindow, Event } from './mini-dom.mjs';
import { SAVED_KEY, DRAFT_KEY } from './sandbox-start.mjs';

const HOST = 'https://feelreef.com';
const HOST_KEY = 'cardtile:w3:host-draft:specimen';
const CARD = ['---', 'card-page: specimen', 'title: Specimen', '---', '', '## cards', '',
  '- [ ] %% card: text w=6 %% Some words.', '- [ ] %% card: link w=3 %% [One](https://example.com/1)', ''].join('\n');

/** the shipped editor, booted in a window of its own. host: framed by HOST and handed `card` (CARD). */
async function boot({ host = false, storage = {}, card = CARD } = {}) {
  const url = host ? `https://card.example/edit?host=${encodeURIComponent(HOST)}` : 'https://card.example/try/edit';
  const win = makeWindow(`<!doctype html><html><head><title>t</title></head><body>${EDIT3_BODY_HTML}</body></html>`, { url, storage });
  const posted = [];
  Object.assign(win, {
    URLSearchParams, structuredClone, navigator: { language: 'en', userAgent: '' },
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    __CARDTILE_W3_OPTS__: { ...(host ? { host: HOST, sandbox: false } : { sandbox: true }), locale: 'en', assets: { 'obsidian-shim.js': 'shim', 'editor-core.js': 'core', 'web-host.js': 'host' } },
    parent: { postMessage: (msg, origin) => posted.push({ ...msg, origin }) },
    // the three files the editor borrows at run time; `prose` is the text editor of the open sheet
    __import: async (name) => ({
      shim: {},
      host: { makeWebHost: () => ({ plugin: { settings: { editorTools: {} } } }) },
      core: { mountEditor: (box, o) => {
        const ed = win.document.createElement('div'); ed.setAttribute('contenteditable', 'true'); box.appendChild(ed);
        let raw = o.text;
        // type(): the words are in the editor; it has NOT reported them yet (it reports when typing idles)
        return (win.prose = { rawValue: () => raw, type: (t) => { raw = t; } });
      } },
    }[name]),
  });
  win.location.search = new URL(url).search;
  await win.run(`(async () => {${EDIT3_JS.replace(/await import\(ASSET\[/g, 'await __import(ASSET[')}\n})()`, 'edit3.js');
  if (host) {
    win.dispatchEvent(Object.assign(new Event('message'), { origin: HOST, data: { v: 1, type: 'card:load', md: card, handle: 'specimen', cardUrl: 'https://card.example/specimen' } }));
    win.tick(1000); posted.length = 0;
  }
  const doc = win.document, $ = (id) => doc.getElementById(id);
  return {
    win, doc, $, posted,
    get md() { return win.__cardtileW3.md; },
    stored: (k) => win.localStorage.getItem(k),
    /** the pencil of the n-th tile in the row (edit mode first) */
    pen(n) {
      if (!doc.querySelectorAll('#row .pen').length) $('editbtn').click();
      const pens = doc.querySelectorAll('#row .pen');
      assert.ok(pens[n], `tile ${n} has a pencil`);
      pens[n].click();
      assert.equal($('modal').hidden, false, 'the sheet is open');
    },
    input(id, value) { const f = $(id); f.value = value; f.dispatchEvent(new Event('input', { bubbles: true })); },
    pagehide() { win.dispatchEvent(new Event('pagehide')); },
    visibility(state) { doc.visibilityState = state; doc.dispatchEvent(new Event('visibilitychange')); },
    errors: () => doc.querySelectorAll('#modal-body .ctw-err').map((n) => n.textContent).join(''),
    changes: () => posted.filter((p) => p.type === 'card:change'),
  };
}
const hostDraft = (e) => JSON.parse(e.stored(HOST_KEY) || 'null');

test('host: words typed in an open sheet are in the draft, and the parent is told, when the page is unloaded', async () => {
  const e = await boot({ host: true });
  e.pen(0);
  e.win.prose.type('Typed and never confirmed.');
  assert.equal(e.stored(HOST_KEY), null, 'nothing kept yet: the sheet is still open');
  e.pagehide();
  const kept = hostDraft(e);
  assert.ok(kept, 'the host-draft key holds a draft');
  assert.equal(kept.base, CARD, 'made on top of the Cards the parent loaded');
  assert.equal(kept.md, CARD.replace('Some words.', 'Typed and never confirmed.'), 'the whole file, with the tile as Done would keep it');
  // 🔴 no tick: an unloading page runs no timers, so the announcement cannot wait for its debounce
  const sent = e.changes();
  assert.equal(sent.length, 1, 'one card:change, sent at once');
  assert.deepEqual({ dirty: sent[0].dirty, md: sent[0].md, origin: sent[0].origin }, { dirty: true, md: kept.md, origin: HOST });
  // nothing on screen moved
  assert.equal(e.$('modal').hidden, false, 'the sheet stays open');
  assert.equal(e.errors(), '', 'no error is painted');
  assert.equal(e.md, CARD, 'the file is what it was: Done has not been pressed');
});

test('sandbox: the same, in its own draft key', async () => {
  const e = await boot({ storage: { [SAVED_KEY]: CARD } });
  e.pen(0);
  e.win.prose.type('Typed in the sandbox.');
  e.pagehide();
  assert.equal(e.stored(DRAFT_KEY), CARD.replace('Some words.', 'Typed in the sandbox.'));
  assert.equal(e.stored(SAVED_KEY), CARD, 'what Save kept is not touched');
  assert.equal(e.$('modal').hidden, false);
});

test('hidden parks the sheet; visible writes nothing', async () => {
  const e = await boot({ host: true });
  e.pen(0);
  e.win.prose.type('Seen while visible.');
  e.visibility('visible');
  assert.equal(e.stored(HOST_KEY), null, 'becoming visible writes no draft');
  assert.equal(e.changes().length, 0, 'and tells the parent nothing');
  e.visibility('hidden');
  assert.equal(hostDraft(e).md, CARD.replace('Some words.', 'Seen while visible.'));
  assert.equal(e.changes().at(-1).dirty, true);
  const before = e.stored(HOST_KEY), n = e.posted.length;
  e.visibility('visible');
  assert.equal(e.stored(HOST_KEY), before, 'coming back writes nothing either');
  assert.equal(e.posted.length, n);
});

test('a required field left empty keeps the PRIOR draft: never half a tile', async () => {
  const e = await boot({ host: true });
  // a prior draft: the first tile changed and confirmed with Done
  e.pen(0); e.win.prose.type('Kept by Done.'); e.$('modal-save').click();
  const prior = e.stored(HOST_KEY);
  assert.equal(JSON.parse(prior).md, CARD.replace('Some words.', 'Kept by Done.'));
  e.win.tick(1000); e.posted.length = 0;
  // the link tile, its words changed and its address emptied
  e.pen(1);
  e.input('f-text', 'Half a link');
  e.input('f-url', '');
  assert.equal(e.$('modal-save').disabled, true, 'Done is waiting for the address');
  e.pagehide(); e.visibility('hidden');
  assert.equal(e.stored(HOST_KEY), prior, 'the draft is byte for byte what it was');
  assert.equal(e.posted.length, 0, 'the parent is told nothing');
  assert.equal(e.errors(), '', 'and no error appears in a sheet nobody is looking at');
});

test('a tile the engine refuses to compose keeps the PRIOR draft', async () => {
  const e = await boot({ storage: { [SAVED_KEY]: CARD } });
  e.pen(0); e.win.prose.type('Kept by Done.'); e.$('modal-save').click();
  const prior = e.stored(DRAFT_KEY);
  assert.ok(prior.includes('Kept by Done.'));
  e.pen(1);
  e.input('f-text', 'Half a link');
  // composeCell's own refusal (a link with no address), reached PAST the sheet's required-field gate:
  // the gate skips a row that is not shown, composeCell still reads it. The address row is hidden and
  // emptied with no input event, so the gate sees nothing missing and Done stays enabled.
  e.doc.querySelector('#modal-body [data-field="url"]').hidden = true;
  e.$('f-url').value = '';
  e.pagehide(); e.visibility('hidden');
  assert.equal(e.stored(DRAFT_KEY), prior, 'the draft is byte for byte what it was');
  assert.equal(e.errors(), '', 'no error is painted in a sheet nobody is looking at');
  assert.equal(e.$('modal').hidden, false);
  // proof the refusal above was the engine's, not the gate's: Done itself is refused by composeCell
  e.visibility('visible');
  assert.equal(e.$('modal-save').disabled, false, 'the gate saw nothing missing');
  e.$('modal-save').click();
  assert.notEqual(e.$('e-url').textContent, '', 'Done paints composeCell\'s refusal on the address');
  assert.equal(e.stored(DRAFT_KEY), prior);
});

test('a tile just added (not Done yet): its words are parked; Cancel, if the page comes back, still takes it out', async () => {
  const e = await boot({ host: true });
  e.$('editbtn').click();
  // the "+" between two tiles → the kinds → a text tile: added for real, its sheet open, Cancel in place of Delete
  e.doc.querySelector('#row .ins').click();
  assert.equal(e.$('picker').hidden, false, 'the picker is open');
  e.doc.querySelector('#picker-row .ctw-pick-btn[data-type="text"]').click();
  assert.equal(e.$('modal').hidden, false, 'the new tile\'s sheet is open');
  const added = hostDraft(e).md;   // adding is a change of its own: the blank tile is already in the draft
  assert.notEqual(added, CARD);
  e.win.tick(1000); e.posted.length = 0;
  e.win.prose.type('Words in a tile not kept yet.');
  e.pagehide();
  const parked = hostDraft(e).md;
  assert.ok(parked.includes('Words in a tile not kept yet.'), 'the new tile is parked with its words');
  assert.equal((parked.match(/%% card:/g) || []).length, 3, 'one whole new tile, beside the two that were there');
  assert.equal(e.changes().at(-1).md, parked);
  assert.equal(e.md, added, 'the file still holds the tile as it was added');
  // the page comes back (bfcache, or the tab shown again) and the person cancels the add
  e.visibility('visible');
  e.$('modal-delete').click();
  assert.equal(e.$('modal').hidden, true);
  assert.equal(e.md, CARD, 'the add is taken back');
  assert.equal(e.stored(HOST_KEY), null, 'and so is the parked draft: nothing differs from what is saved');
  e.win.tick(1000);
  assert.deepEqual({ md: e.changes().at(-1).md, dirty: e.changes().at(-1).dirty }, { md: CARD, dirty: false });
});

test('closing the sheet without Done after the page came back puts the draft back to what was kept', async () => {
  const e = await boot({ host: true });
  e.pen(0);
  e.win.prose.type('Typed, parked, then dropped.');
  e.visibility('hidden');
  assert.ok(hostDraft(e).md.includes('Typed, parked, then dropped.'));
  e.visibility('visible');
  e.$('modal-delete').click();   // Delete: the tile goes, as it would have without the parking
  assert.ok(!e.md.includes('Some words.') && !e.md.includes('parked'));
  assert.equal(hostDraft(e).md, e.md, 'the draft is the file again');
});

test('nothing typed: an open sheet parks nothing', async () => {
  const e = await boot({ host: true });
  e.pen(0);
  e.pagehide(); e.visibility('hidden');
  assert.equal(e.stored(HOST_KEY), null);
  assert.equal(e.posted.length, 0);
});

// 🩸 Re-serializing a tile is not the identity: quotes the engine finds unneeded go, and in a hand-spelled
// file the other tiles' spacing and trailing whitespace are tidied. Comparing the candidate with the file
// said "unsaved" for a sheet that was only opened, and the next load showed a dirty editor with no change.
const SPELLED = ['---', 'card-page: specimen', 'title: Specimen', '---', '', '## cards', '',
  '- [ ] %% card: link  w=3   title="A" %%   [One](https://example.com/1)  ',
  '- [ ] %% card: text w=6 %% Trailing  spaces  ',
  '- [ ] %% card: embed kind=slider images="https://i.example/1.png" %%', ''].join('\n');

test('a sheet only opened parks nothing, even where re-serializing the file is not the identity', async () => {
  for (let i = 0; i < 3; i++) {
    const e = await boot({ host: true, card: SPELLED });
    e.pen(i);
    e.visibility('hidden'); e.pagehide();
    assert.equal(e.changes().length, 0, `tile ${i}: no card:change`);
    assert.equal(e.stored(HOST_KEY), null, `tile ${i}: no draft written`);
  }
});

test('one character typed in such a file parks; typed back, the draft is the file again', async () => {
  const e = await boot({ host: true, card: SPELLED });
  e.pen(1);
  e.win.prose.type('Trailing  spaces!');
  e.visibility('hidden');
  assert.ok(hostDraft(e).md.includes('%% card: text w=6 %% Trailing  spaces!'), 'the typed character is parked');
  assert.equal(e.changes().at(-1).dirty, true);
  e.visibility('visible');
  e.win.prose.type('Trailing  spaces  ');
  e.visibility('hidden');
  assert.equal(e.stored(HOST_KEY), null, 'back to what the sheet opened with: no draft');
  assert.deepEqual({ md: e.changes().at(-1).md, dirty: e.changes().at(-1).dirty }, { md: SPELLED, dirty: false });
});

// 🩸 A save that finished while the page was hidden wrote the file over the parked draft: a tab then killed
// in the background lost the words typed in the open sheet.
test('a save that lands while the page is hidden keeps the open sheet parked', async () => {
  const e = await boot({ host: true });
  e.pen(0); e.win.prose.type('Done words.'); e.$('modal-save').click(); e.win.tick(1000);
  e.pen(1); e.input('f-text', 'Typed in open sheet');
  const kd = Object.assign(new Event('keydown', { bubbles: true }), { metaKey: true, key: 's' });
  kd.preventDefault = () => {};
  e.doc.dispatchEvent(kd);
  assert.ok(e.posted.some((p) => p.type === 'card:save'), 'Save went to the parent');
  assert.equal(e.$('modal').hidden, false, 'the sheet is still open');
  e.visibility('hidden');
  assert.ok(hostDraft(e).md.includes('Typed in open sheet'), 'parked on hide');
  e.win.dispatchEvent(Object.assign(new Event('message'), { origin: HOST, data: { v: 1, type: 'card:saved' } }));
  e.win.tick(1000);
  const d = hostDraft(e);
  assert.ok(d, 'the draft is still there');
  assert.ok(d.md.includes('Typed in open sheet'), 'with the open sheet\'s words');
  assert.equal(d.base, CARD.replace('Some words.', 'Done words.'), 'on top of what was just saved');
  const last = e.changes().at(-1);
  assert.deepEqual({ dirty: last.dirty, md: last.md }, { dirty: true, md: d.md });
});

test('no sheet open: hiding the page writes nothing', async () => {
  const e = await boot({ host: true });
  e.pagehide(); e.visibility('hidden');
  assert.equal(e.stored(HOST_KEY), null);
  assert.equal(e.posted.length, 0);
});
