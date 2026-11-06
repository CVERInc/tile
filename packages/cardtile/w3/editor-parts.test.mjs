// The editor's pure parts (w3/edit3.mjs imports each of these): the one notice, the leave-edit
// dialog's rules, the pairing toggle, Cards settings applied at once, and the social-icons form.
//
//   node --test packages/cardtile/w3/editor-parts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, serializeCard } from '../card-core.js';
import { noticeEdge, noticeLife, noticeTone, bottomSlot, createNotices } from './notice.mjs';
import { leaveStep, resolveLeave, LEAVE_CHOICES } from './leave-edit.mjs';
import { pair, unpair, canPair, canUnpair, backOf } from './pairing.mjs';
import { applySetting, fmRead, fmWrite, readViews, toggleView } from './card-settings.mjs';
import { parseSocial, composeSocial, addressFor, networkOf } from './social-rows.mjs';

// ── the notice ──────────────────────────────────────────────────────────────────────────────────
test('notice: status and errors go to the top and stay; confirmations go to the bottom and leave', () => {
  for (const k of ['waiting', 'saving', 'failed', 'loadFailed']) { assert.equal(noticeEdge(k), 'top', k); assert.equal(noticeLife(k), 0, k); }
  for (const k of ['deleted', 'saved', 'replaced', 'proposed']) { assert.equal(noticeEdge(k), 'bottom', k); assert.ok(noticeLife(k) >= 4000, k); }
  assert.equal(noticeTone('failed'), 'error');
  assert.equal(noticeTone('loadFailed'), 'error');
  assert.equal(noticeTone('saved'), 'info');
  assert.equal(bottomSlot({ sheetOpen: true }), 'sheet');
  assert.equal(bottomSlot({ sheetOpen: false }), 'page');
});

// a just-big-enough element: the notice touches parentNode, nextSibling, prepend, appendChild, insertBefore,
// querySelector('.notice-text' | '.notice-act' | '.ctw-modal-foot'), hidden, dataset, classList, attributes
function el(name) {
  const n = {
    name, children: [], parentNode: null, hidden: true, dataset: {}, attrs: {}, textContent: '', onclick: null,
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    get firstChild() { return this.children[0] || null; },
    get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; },
    detach() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; },
    appendChild(c) { c.detach(); c.parentNode = this; this.children.push(c); return c; },
    prepend(c) { c.detach(); c.parentNode = this; this.children.unshift(c); },
    insertBefore(c, ref) { c.detach(); c.parentNode = this; const at = ref ? this.children.indexOf(ref) : -1; if (at < 0) this.children.push(c); else this.children.splice(at, 0, c); return c; },
    querySelector(sel) {
      const want = sel.replace(/^\./, '');
      for (const c of this.children) { if (c.name === want) return c; const d = c.querySelector(sel); if (d) return d; }
      return null;
    },
  };
  return n;
}
const bar = (name) => { const b = el(name); b.appendChild(el('notice-text')); b.appendChild(el('notice-act')); return b; };

test('notice component: one bar per edge, Undo runs once and closes, and the bottom bar moves above an open sheet\'s buttons', () => {
  const body = el('body'), top = bar('top'), main = el('main'), bottom = bar('bottom'), after = el('after');
  for (const n of [top, main, bottom, after]) body.appendChild(n);
  const panel = el('panel'), foot = el('ctw-modal-foot'), save = el('save'); panel.appendChild(el('fields')); panel.appendChild(foot); foot.appendChild(save);
  let sheet = null, timers = [], undone = 0;
  const N = createNotices({ top, bottom, openSheet: () => sheet, setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimer: () => {} });

  N.show('failed', 'Not saved: the page said no, in a sentence long enough to wrap');
  assert.equal(N.top, 'failed');
  assert.equal(top.attrs.role, 'alert', 'a failure is announced as an alert');
  assert.equal(top.dataset.tone, 'error');
  assert.equal(top.querySelector('.notice-text').textContent, 'Not saved: the page said no, in a sentence long enough to wrap', 'the words are never shortened');
  assert.equal(timers.length, 0, 'a top notice stays until its state ends');

  N.show('deleted', 'Deleted', { label: 'Undo', run: () => undone++ });
  assert.equal(N.bottom, 'deleted');
  assert.equal(bottom.parentNode, body, 'no sheet open: the bar sits at the page edge');
  assert.equal(bottom.nextSibling, after, '…in its own place in the page, pushing the content');
  assert.equal(timers.at(-1).ms, 6000);
  bottom.querySelector('.notice-act').onclick();
  assert.equal(undone, 1);
  assert.equal(N.bottom, null, 'Undo closes the bar');

  sheet = panel;
  N.show('replaced', 'Replaced');
  assert.equal(bottom.parentNode, foot, 'a sheet is open: the bar moves into its button row…');
  assert.equal(foot.firstChild, bottom, '…ABOVE the buttons, never over them');
  assert.ok(bottom.classList.contains('in-sheet'));
  sheet = null; N.place();
  assert.equal(bottom.parentNode, body, 'the sheet closes: the bar goes home');
  assert.equal(bottom.nextSibling, after);
  N.clear(); assert.equal(N.top, null); assert.equal(N.bottom, null);
});

// ── leaving edit mode ───────────────────────────────────────────────────────────────────────────
test('leave-edit: asks only when an unsaved draft leaves edit mode', () => {
  assert.deepEqual(LEAVE_CHOICES, ['save', 'keep', 'discard']);
  assert.equal(leaveStep({ dirty: true, editing: true, toEditing: false }), 'ask');
  assert.equal(leaveStep({ dirty: false, editing: true, toEditing: false }), 'go', 'nothing unsaved: just go');
  assert.equal(leaveStep({ dirty: true, editing: true, toEditing: true }), 'go', 'row ⇄ wall is not leaving');
  assert.equal(leaveStep({ dirty: true, editing: false, toEditing: false }), 'go', 'already looking: nothing to leave');
  const s = { md: 'draft', savedMd: 'saved' };
  assert.deepEqual(resolveLeave('save', s), { save: true, leave: true, md: 'draft' });
  assert.deepEqual(resolveLeave('keep', s), { save: false, leave: false, md: 'draft' });
  assert.deepEqual(resolveLeave('discard', s), { save: false, leave: true, md: 'saved' }, 'Discard puts back what was saved');
});

// ── pairing ─────────────────────────────────────────────────────────────────────────────────────
const CARD = ['---', 'title: P', '---', '', '## cards', '', '- [ ] %% card: text w=6 %% one', '- [ ] %% card: text w=6 %% two', '- [ ] %% card: text w=6 %% three', ''].join('\n');
test('pairing: the toggle pairs two neighbours and unpairs them back to the same file', () => {
  const x = parseCard(CARD);
  assert.equal(canPair(x, 0), true);
  assert.equal(canPair(x, 2), false, 'the last tile has no neighbour to pair with');
  pair(x, 0);
  assert.equal(x.cells.length, 2, 'the second tile left the face…');
  const d = backOf(x, x.cells[0]);
  assert.ok(d, '…and became the first tile\'s back');
  assert.equal(d.cells[0].body.trim(), 'two');
  assert.match(serializeCard(x), /back=#b1/);
  assert.equal(canPair(x, 0), false, 'a pair cannot take a second back');
  assert.equal(canPair(x, 1), false, 'the last tile has nothing after it');
  assert.equal(canUnpair(x, 0), true);
  unpair(x, 0);
  assert.equal(serializeCard(x), serializeCard(parseCard(CARD)), 'pair → unpair is the identity on the file');
  assert.equal(canUnpair(x, 0), false);
});

// ── settings apply at once ──────────────────────────────────────────────────────────────────────
test('settings: every control writes its key into the draft as it changes; the default writes nothing', () => {
  let pre = '---\ntitle: A\n---\n';
  pre = applySetting(pre, 'title', '  Bea  '); assert.equal(fmRead(pre).title, 'Bea');
  pre = applySetting(pre, 'header', 'left'); assert.equal(fmRead(pre).header, 'left');
  pre = applySetting(pre, 'header', 'centre'); assert.equal('header' in fmRead(pre), false, 'the default is no line');
  pre = applySetting(pre, 'icons', 'mono'); assert.equal(fmRead(pre).icons, 'mono');
  pre = applySetting(pre, 'accent', '#AB12CD'); assert.equal(fmRead(pre).accent, '#ab12cd');
  pre = applySetting(pre, 'accent', null); assert.equal('accent' in fmRead(pre), false);
  pre = applySetting(pre, 'theme', 'dark'); assert.equal(fmRead(pre).theme, 'dark');
  pre = applySetting(pre, 'theme', 'auto'); assert.equal('theme' in fmRead(pre), false);
  pre = applySetting(pre, 'backdrop-dim', '45'); assert.equal(fmRead(pre)['backdrop-dim'], '45');
  pre = applySetting(pre, 'views', { on: ['stack', 'wall'], open: 'wall' });
  assert.equal(fmRead(pre).views, 'stack wall'); assert.equal(fmRead(pre).view, 'wall');
  pre = applySetting(pre, 'views', { on: ['stack', 'list', 'wall'], open: 'stack' });
  assert.equal('views' in fmRead(pre), false, 'all three on says nothing'); assert.equal('view' in fmRead(pre), false);
  assert.throws(() => applySetting(pre, 'colour', 'x'), /no setting/);
  assert.equal(fmWrite('', 'title', null), '', 'removing from nothing adds no empty fence');
});

test('settings: the views — the last one on stays on, and the opening follows', () => {
  let v = readViews('---\nviews: stack list\nview: list\n---\n');
  assert.deepEqual(v, { on: ['stack', 'list'], open: 'list' });
  v = toggleView(v, 'list', false); assert.deepEqual(v, { on: ['stack'], open: 'stack' });
  v = toggleView(v, 'stack', false); assert.deepEqual(v, { on: ['stack'], open: 'stack' }, 'the last one on cannot go');
  v = toggleView(v, 'wall', true); assert.deepEqual(v, { on: ['stack', 'wall'], open: 'stack' });
});

// ── social icons as a form ──────────────────────────────────────────────────────────────────────
test('social form: a handle or a link becomes the line the renderer reads; overrides and odd lines survive', () => {
  assert.equal(addressFor('instagram', '@sam.doc'), 'https://instagram.com/sam.doc');
  assert.equal(addressFor('threads', 'sam'), 'https://www.threads.net/@sam');
  assert.equal(addressFor('email', 'sam@example.com'), 'mailto:sam@example.com');
  assert.equal(addressFor('web', 'example.com/my page'), 'https://example.com/my%20page', 'a space is encoded, nobody writes %20');
  assert.equal(addressFor('youtube', 'https://youtube.com/@sam'), 'https://youtube.com/@sam');
  assert.equal(addressFor('instagram', ''), '');
  assert.equal(networkOf('https://www.instagram.com/x'), 'instagram');
  assert.equal(networkOf('mailto:a@b.c'), 'email');
  assert.equal(networkOf('https://example.com'), 'web');
  const body = '[Instagram](https://instagram.com/a)\n[Shop](https://bit.ly/x) iconhost=shop.example\nnot a link line';
  const rows = parseSocial(body);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].extra, 'iconhost=shop.example');
  assert.equal(composeSocial(rows), body, 'what the form cannot show is kept exactly as written');
  assert.equal(composeSocial([{ net: 'x', url: 'sam' }, { net: 'threads', url: '' }]), '[X](https://x.com/sam)', 'an empty row is dropped');
});
