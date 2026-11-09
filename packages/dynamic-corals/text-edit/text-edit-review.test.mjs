// Review cases for the text-edit coral (rounds 1–7), each one a reproduction that used to pass
// silently.   run: node --test packages/dynamic-corals/text-edit/text-edit-review.test.mjs
//
// Every case here once wrote words onto a line other than the one the owner tapped, or showed words
// the saved page did not have, or trusted a message it should not have. Pages are rendered with
// sitetile's own renderer in its editing-preview mode (`parseSite(md, { sourceLines: true })`,
// which stamps `data-src` source spans), and edits go through the reference applier, so
// "preview == saved" is measured against the real output.
//
// The element tree is the applier's htmlTree, which follows the HTML parser on the characters it
// changes (U+0000 dropped, CR/CRLF → LF); `htmlTree follows the HTML parser` below pins that, and
// the round-3 report holds the Chromium run that measured the same cases in a real parser.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSite, renderSiteToHtml } from '../../sitetile/site-core.js';
import { editableAt, anchorFor, createEditor, cleanText, mountAll, mintDoc, RESULT_MESSAGE, READBACK_MESSAGE, READBACK_RESULT_MESSAGE, READY_MESSAGE, EDIT_MESSAGE, DOC_SHAPE, PENDING_TIMEOUT_MS } from './text-edit-core.mjs';
import * as source from './text-edit-source.mjs';

const { applyTextEdit, sourceRevision, readTextAt } = source;

// ── The applier's own element tree, plus the few DOM calls mountAll makes ──────────────────────
class DomEl extends source.El {
  constructor(tag, attrs, parent) {
    super(tag, attrs, parent);
    const cls = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = { contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (c) => cls.delete(c) };
    this.contentEditable = 'inherit';
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  removeAttribute(n) { delete this.attrs[n]; if (n === 'contenteditable') this.contentEditable = 'inherit'; }
  contains(n) { for (; n; n = n.parentElement) if (n === this) return true; return false; }
  focus() {} blur() {}
  appendChild(c) { this.nodes.push(c); c.parentElement = this; return c; }
  querySelectorAll(sel) {
    if (sel === 'section.st-prose[id]') return [...this.all()].filter((e) => e.tagName === 'SECTION' && e.classList.contains('st-prose') && e.id);
    const tags = sel.split(',').map((t) => t.trim().toUpperCase());
    return [...this.all()].filter((e) => tags.includes(e.tagName));
  }
}
const tree = (html) => source.htmlTree(html, DomEl);
const render = (md) => tree(renderSiteToHtml(parseSite(md, { sourceLines: true })));
const offered = (root) => [...root.all()].map(editableAt).filter((f, i, arr) => f && arr.findIndex((g) => g && g.el === f.el) === i);
const shown = (root, kind) => offered(root).filter((f) => !kind || f.kind === kind).map((f) => cleanText(f.el.textContent));
const editOf = (f, after, md) => {
  const a = anchorFor(f.el, f.section);
  assert.ok(a, 'the element has a source span');
  return { anchor: { section: a.section, start: a.start, end: a.end }, before: a.before, after, revision: sourceRevision(md) };
};
const find = (md, kind, text, nth = 0) => offered(render(md)).filter((f) => f.kind === kind && cleanText(f.el.textContent) === text)[nth];

// A fake clock for the coral's bounded wait: tick(ms) runs every timer that falls due.
function makeClock() {
  let now = 0, n = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => { timers.set(++n, { at: now + ms, fn }); return n; },
    clearTimer: (id) => { timers.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    },
    get pending() { return timers.size; },
  };
}

// A host that applies what the coral posts to its own copy of the page, the way a real host does,
// and answers only when told to (replies are asynchronous in a browser). A readback request is
// answered with readTextAt, the reference for what a host reads back.
function makeHost(md) {
  const host = { md, inbox: [], refuse: new Set(), results: [], clock: makeClock() };
  host.post = (m) => host.inbox.push(m);
  host.answer = (ed, pick = 'first') => {
    const m = pick === 'last' ? host.inbox.pop() : host.inbox.shift();
    if (m.type === READBACK_MESSAGE) {
      const r = readTextAt(host.md, m);
      host.results.push({ id: m.id, ok: r.ok, readback: true });
      ed.onResult({ type: READBACK_RESULT_MESSAGE, doc: m.doc, id: m.id, ok: r.ok, words: r.words, revision: r.revision, section: r.section });
      return;
    }
    const res = host.refuse.has(m.id) ? { ok: false, reason: 'refused-by-test' } : applyTextEdit(host.md, m);
    if (res.ok) host.md = res.markdown;
    host.results.push({ id: m.id, ok: res.ok, reason: res.reason });
    ed.onResult(res.ok
      ? { type: RESULT_MESSAGE, doc: m.doc, id: m.id, ok: true, revision: res.revision, section: res.section }
      : { type: RESULT_MESSAGE, doc: m.doc, id: m.id, ok: false });
  };
  host.drain = (ed, pick) => { while (host.inbox.length) host.answer(ed, pick); };
  return host;
}
const editor = (host, extra = {}) => createEditor({ page: '/', revision: sourceRevision(host.md), post: host.post, hint: () => {},
  setTimer: host.clock.setTimer, clearTimer: host.clock.clearTimer, ...extra });
// The host applies an edit but its answer never arrives (a dropped message, a closed tab).
const applySilently = (host) => { const m = host.inbox.shift(); const res = applyTextEdit(host.md, m); assert.ok(res.ok, JSON.stringify(res)); host.md = res.markdown; return m; };

// ── The anchor is the renderer's own source span ──────────────────────────────────────────────────
test('a production render carries no spans, and nothing in it is offered', () => {
  const md = '## About\n\nWords\n';
  const html = renderSiteToHtml(parseSite(md));
  assert.doesNotMatch(html, /data-src/);
  assert.equal(offered(tree(html)).length, 0);
});

// ── Round 2, P1: nesting and fence context ────────────────────────────────────────────────────────
test('nested list: the standalone item is edited on its own line, never the parent with a child', () => {
  const md = '## About\n\n- Same\n  - Extra\n- Same\n- Sa\n  - me\n';
  const parent = offered(render(md)).find((f) => f.kind === 'li' && cleanText(f.el.textContent) === 'SameExtra');
  assert.equal(parent.plain, false, 'an item holding a list is not plain words');
  const res = applyTextEdit(md, editOf(find(md, 'li', 'Same'), 'Changed', md));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.line, 4);
  assert.equal(res.markdown, '## About\n\n- Same\n  - Extra\n- Changed\n- Sa\n  - me\n');
});

test('comment tail + mixed fence: the visible words are refused, the code is never touched', () => {
  const md = '## About\n\n<!-- a --> Same\n\n```\n~~~\nSame\n```\n';
  const ps = offered(render(md)).filter((f) => f.kind === 'p');
  assert.deepEqual(ps.map((f) => cleanText(f.el.textContent)), ['Same'], 'code is not offered');
  assert.deepEqual(applyTextEdit(md, editOf(ps[0], 'Changed', md)), { ok: false, reason: 'not-plain' });
});

test('comment tail + quote: the paragraph after the quote is edited on its own line', () => {
  const md = '## About\n\n<!-- a --> Same\n\n> quote\nSame\n';
  const ps = offered(render(md)).filter((f) => f.kind === 'p');
  assert.deepEqual(applyTextEdit(md, editOf(ps[0], 'x', md)), { ok: false, reason: 'not-plain' });
  const res = applyTextEdit(md, editOf(ps[1], 'Changed', md));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.markdown, '## About\n\n<!-- a --> Same\n\n> quote\nChanged\n');
});

test('nested list followed by a joined twin: each item lands on its own line', () => {
  const md = '## About\n\n- Same\n  - Other\n\n- SameOther\n';
  const [parent, twin] = offered(render(md)).filter((f) => f.kind === 'li' && cleanText(f.el.textContent) === 'SameOther');
  assert.equal(parent.plain, false, 'the parent reads "SameOther" too, but holds a list');
  assert.deepEqual(applyTextEdit(md, editOf(parent, 'Changed', md)), { ok: false, reason: 'not-plain' });
  const res = applyTextEdit(md, editOf(twin, 'Changed', md));
  assert.equal(res.markdown, '## About\n\n- Same\n  - Other\n\n- Changed\n');
  const child = applyTextEdit(md, editOf(find(md, 'li', 'Other'), 'Kid', md));
  assert.equal(child.markdown, '## About\n\n- Same\n  - Kid\n\n- SameOther\n', 'a child item keeps its indent');
});

// ── Round 1 cases, on spans ───────────────────────────────────────────────────────────────────────
test('a fragment whose comment vanishes in rendering is refused, and its twins land on their own lines', () => {
  const md = '## About\n\nSame<!-- note -->\n\nSame\n\nSame\n';
  const ps = offered(render(md)).filter((f) => f.kind === 'p');
  assert.deepEqual(applyTextEdit(md, editOf(ps[0], 'Changed first', md)), { ok: false, reason: 'not-plain' });
  const second = applyTextEdit(md, editOf(ps[1], 'Changed second', md));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(shown(render(second.markdown), 'p'), ['Same', 'Changed second', 'Same']);
});

test('a soft-wrapped paragraph is offered as "use the editor", and refused if sent anyway', () => {
  const md = '## About\n\n制作は、\nあなた\n\n制作は、あなた\n';
  const ps = offered(render(md)).filter((f) => f.kind === 'p');
  assert.equal(ps[0].plain, false);
  assert.deepEqual(applyTextEdit(md, editOf(ps[0], 'x', md)), { ok: false, reason: 'not-plain' });
  assert.equal(applyTextEdit(md, editOf(ps[1], 'y', md)).markdown, '## About\n\n制作は、\nあなた\n\ny\n');
});

test('an edit made against an older revision is refused, never written to a surviving duplicate', () => {
  const preview = '## About\n\nSame\n\nSame\n';
  const edit = editOf(find(preview, 'p', 'Same'), 'My change', preview);
  assert.deepEqual(applyTextEdit(preview.replace('Same', 'Changed elsewhere'), edit), { ok: false, reason: 'changed' });
  assert.equal(applyTextEdit(preview, edit).ok, true);
  const { revision, ...unversioned } = edit;
  assert.deepEqual(applyTextEdit(preview, unversioned), { ok: false, reason: 'malformed' });
});

test('a span that does not show `before` in that section is refused, never rewritten', () => {
  const md = '## About\n\nOne\n\nTwo\n\n## Next\n\nThree\n';
  const e = editOf(find(md, 'p', 'Two'), 'x', md);
  assert.deepEqual(applyTextEdit(md, { ...e, before: 'One' }), { ok: false, reason: 'changed' });
  assert.deepEqual(applyTextEdit(md, { ...e, anchor: { ...e.anchor, start: 3, end: 3 } }), { ok: false, reason: 'not-found' });
  assert.deepEqual(applyTextEdit(md, { ...e, anchor: { ...e.anchor, section: 's2-next' } }), { ok: false, reason: 'not-found' });
  assert.deepEqual(applyTextEdit(md, { ...e, anchor: { ...e.anchor, start: 5, end: 4 } }), { ok: false, reason: 'malformed' });
});

test('structure is kept: list marker and indent, `## ` and an in-body `# ` heading', () => {
  const md = '## About\n\n  1. First step\n\n# Big\n';
  assert.equal(applyTextEdit(md, editOf(find(md, 'li', 'First step'), 'Sand it', md)).markdown, '## About\n\n  1. Sand it\n\n# Big\n');
  assert.equal(applyTextEdit(md, editOf(find(md, 'title', 'Big'), 'Bigger', md)).markdown, '## About\n\n  1. First step\n\n# Bigger\n');
  const t = applyTextEdit(md, editOf(find(md, 'title', 'About'), 'Contact', md));
  assert.equal(t.markdown, '## Contact\n\n  1. First step\n\n# Big\n');
  assert.equal(t.section, 's1-contact');
});

// ── Round 2, P2: characters the HTML parser drops or rewrites ─────────────────────────────────────
test('htmlTree follows the HTML parser: U+0000 is dropped, CR and CRLF become LF', () => {
  assert.equal(source.htmlTree('<p>a\u0000b</p>').textContent, 'ab');
  assert.equal(source.htmlTree('<p>a\r\nb\rc</p>').textContent, 'a\nb\nc');
});

test('NUL and other parser-rewritten characters in `after` are refused; the page stays editable', () => {
  const md = '## About\n\nOriginal\n';
  for (const after of ['a\u0000b', 'a\u000bb', 'a\rb', 'a\u0001b', 'a\u007fb', 'a\u0085b', 'a\ud800b', 'a\udc00b', 'a￾b'])
    assert.deepEqual(applyTextEdit(md, editOf(find(md, 'p', 'Original'), after, md)), { ok: false, reason: 'after-not-plain' }, JSON.stringify(after));
  assert.equal(applyTextEdit(md, editOf(find(md, 'p', 'Original'), 'astral 𝄞 ok', md)).ok, true, 'a valid surrogate pair is words');
  // reload and edit again: the saved words are what the next frame shows, and they edit cleanly
  const first = applyTextEdit(md, editOf(find(md, 'p', 'Original'), 'Fresh words', md));
  assert.equal(first.ok, true);
  const reloaded = first.markdown;
  assert.equal(first.revision, sourceRevision(reloaded));
  const second = applyTextEdit(reloaded, editOf(find(reloaded, 'p', 'Fresh words'), 'Again', reloaded));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.markdown, '## About\n\nAgain\n');
});

test('a source line holding NUL shows different words than it stores, so it is not plain', () => {
  const md = '## About\n\na\u0000b\n';
  const f = find(md, 'p', 'ab');
  assert.ok(f, 'the frame shows "ab"');
  assert.deepEqual(applyTextEdit(md, editOf(f, 'x', md)), { ok: false, reason: 'not-plain' });
});

test('the coral does not post words the HTML parser would change', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const hints = [];
  const ed = createEditor({ page: '/', revision: sourceRevision(host.md), post: host.post, hint: (t) => hints.push(t) });
  const f = offered(render(host.md)).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'a\u0000b'; ed.commit();
  assert.equal(host.inbox.length, 0);
  assert.equal(f.el.textContent, 'Original');
  assert.equal(hints.length, 1);
});

test('words the renderer would not show as written are not plain words', () => {
  const md = '## About\n\nOriginal\n';
  assert.deepEqual(applyTextEdit(md, editOf(find(md, 'p', 'Original'), 'ST-BR-TOKEN', md)), { ok: false, reason: 'after-not-plain' });
});

// ── Serialized edits ──────────────────────────────────────────────────────────────────────────────
test('a pending refused edit does not move the next edit', () => {
  const host = makeHost('## About\n\nSame\n\nSame\n');
  const root = render(host.md);
  const ed = editor(host);
  const ps = offered(root).filter((f) => f.kind === 'p');
  ed.begin(ps[0]); ps[0].el.textContent = '**bold**'; ed.commit();
  ed.begin(ps[1]); ps[1].el.textContent = 'Second'; ed.commit();
  host.drain(ed);
  assert.deepEqual(shown(root, 'p'), ['Same', 'Second']);
  assert.deepEqual(shown(render(host.md), 'p'), shown(root, 'p'), 'preview and saved page agree');
});

test('a late refusal does not overwrite newer words typed into the same element', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Second'; ed.commit();
  host.refuse.add('e1');
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, doc: ed.doc, id: 'e2', ok: true }), false, 'a reply to an id not sent yet is nobody\'s answer');
  host.drain(ed, 'last');
  assert.equal(cleanText(f.el.textContent), 'Second');
  assert.deepEqual(shown(render(host.md), 'p'), ['Second']);
});

test('three identical paragraphs edited third, second, first before any reply all land where they were made', () => {
  const host = makeHost('## About\n\nSame\n\nSame\n\nSame\n');
  const root = render(host.md);
  const ed = editor(host);
  const ps = offered(root).filter((f) => f.kind === 'p');
  for (const [i, after] of [[2, 'Three'], [1, 'Two'], [0, 'One']]) { ed.begin(ps[i]); ps[i].el.textContent = after; ed.commit(); }
  host.drain(ed);
  assert.deepEqual(host.results.map((r) => r.ok), [true, true, true]);
  assert.equal(host.md, '## About\n\nOne\n\nTwo\n\nThree\n');
  assert.deepEqual(shown(root, 'p'), ['One', 'Two', 'Three']);
});

test('after a title is saved, the same frame can edit its paragraph and the title again', () => {
  const host = makeHost('## About\n\nBody words\n');
  const root = render(host.md);
  const ed = editor(host);
  const title = offered(root).find((f) => f.kind === 'title');
  const body = offered(root).find((f) => f.kind === 'p');
  ed.begin(title); title.el.textContent = 'Contact'; ed.commit(); host.drain(ed);
  ed.begin(body); body.el.textContent = 'Changed body'; ed.commit(); host.drain(ed);
  ed.begin(title); title.el.textContent = 'Contact us'; ed.commit(); host.drain(ed);
  assert.deepEqual(host.results.map((r) => r.ok), [true, true, true], JSON.stringify(host.results));
  assert.equal(host.md, '## Contact us\n\nChanged body\n');
});

// ── Round 4: a refusal that arrives while the same element is focused again ──────────────────────
// The owner presses Enter (e1 is sent), clicks the same paragraph again without typing, and only
// then does the host refuse e1. The refused words must go, focused or not, and leaving the field
// must not send them again: only a new keystroke makes a new edit.
function refocused() {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f);
  host.refuse.add('e1');
  return { host, ed, f, root };
}

test('a refusal rolls a refocused, untouched element back, and an unchanged blur sends nothing', () => {
  const { host, ed, f } = refocused();
  assert.equal(ed.stateOf(f.el), 'pending', 'focusing it does not leave pending (round 5)');
  host.answer(ed);
  assert.equal(f.el.textContent, 'Original', 'rolled back although the element is focused');
  assert.equal(ed.stateOf(f.el), 'editing');
  assert.equal(ed.commit(), null);
  assert.equal(host.inbox.length, 0, 'the refused change is not retried');
  assert.equal(ed.stateOf(f.el), 'idle');
  assert.equal(host.md, '## About\n\nOriginal\n');
});

test('a refusal keeps newer words typed into the refocused element, and they are sent against the saved words', () => {
  const { host, ed, f } = refocused();
  f.el.textContent = 'Second';
  host.answer(ed);
  assert.equal(f.el.textContent, 'Second');
  const m = ed.commit();
  assert.ok(m, 'the newer words are a new edit');
  assert.deepEqual([m.before, m.after], ['Original', 'Second']);
  host.drain(ed);
  assert.equal(host.md, '## About\n\nSecond\n');
  assert.equal(ed.stateOf(f.el), 'idle');
});

test('Escape after a refusal while typing puts back the saved words, never the refused ones', () => {
  const { host, ed, f } = refocused();
  f.el.textContent = 'Second';
  host.answer(ed);
  ed.cancel();
  assert.equal(f.el.textContent, 'Original');
  assert.equal(ed.stateOf(f.el), 'idle');
  assert.equal(host.inbox.length, 0);
});

test('a refusal keeps newer words already committed, and sends them next', () => {
  const { host, ed, f } = refocused();
  f.el.textContent = 'Second'; ed.commit();
  assert.equal(ed.stateOf(f.el), 'pending');
  host.answer(ed);
  assert.equal(f.el.textContent, 'Second');
  assert.equal(host.inbox.length, 1);
  assert.deepEqual([host.inbox[0].before, host.inbox[0].after], ['Original', 'Second']);
  host.drain(ed);
  assert.equal(host.md, '## About\n\nSecond\n');
});

test('refocusing a refused element and leaving it untouched sends nothing; a new keystroke does', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  host.refuse.add('e1'); host.answer(ed);
  assert.equal(ed.stateOf(f.el), 'refused');
  assert.equal(f.el.textContent, 'Original');
  for (let i = 0; i < 3; i++) { ed.begin(f); assert.equal(ed.commit(), null); }
  assert.equal(host.inbox.length, 0);
  ed.begin(f); f.el.textContent = 'First'; const m = ed.commit();
  assert.ok(m, 'typed again, so it is a new edit');
  assert.equal(m.id, 'e2');
  host.drain(ed);
  assert.equal(host.md, '## About\n\nFirst\n');
});

test('a success while the element is focused again keeps it editing, with the saved words acknowledged', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); host.answer(ed);
  assert.equal(ed.stateOf(f.el), 'editing');
  assert.equal(f.el.textContent, 'First');
  assert.equal(ed.commit(), null);
  assert.equal(ed.stateOf(f.el), 'idle');
  ed.begin(f); f.el.textContent = 'Original'; const m = ed.commit();
  assert.deepEqual([m.before, m.after], ['First', 'Original'], 'changing back is a real edit once First is saved');
});

test('words typed back to the saved ones while an edit is pending are not sent after its refusal', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Original'; ed.commit();
  host.refuse.add('e1'); host.answer(ed);
  assert.equal(host.inbox.length, 0);
  assert.equal(f.el.textContent, 'Original');
  assert.equal(ed.stateOf(f.el), 'refused', 'its outstanding edit was refused');
});

// ── Round 5: `pending` is left only by the host's reply ───────────────────────────────────────────
// Commit `First` (e1 in flight), click the same element, type the saved words back and leave before
// e1 succeeds. The host stores `First`; the frame must not show `Original` as saved — the reversal
// is a draft, sent against the new revision once e1 is answered.
test('typing the saved words back while a save is pending is sent after that save succeeds', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Original'; ed.commit();
  assert.equal(ed.stateOf(f.el), 'pending', 'a user event does not leave pending');
  assert.equal(host.inbox.length, 1);
  host.answer(ed);
  assert.equal(host.md, '## About\n\nFirst\n');
  assert.equal(host.inbox.length, 1, 'the reversal is sent once e1 is saved');
  assert.deepEqual([host.inbox[0].id, host.inbox[0].before, host.inbox[0].after], ['e2', 'First', 'Original']);
  assert.notEqual(host.inbox[0].revision, sourceRevision('## About\n\nOriginal\n'), 'against the new revision');
  host.drain(ed);
  assert.equal(host.md, '## About\n\nOriginal\n');
  assert.equal(f.el.textContent, 'Original');
  assert.equal(ed.stateOf(f.el), 'idle');
});

test('clicking a pending element and leaving it untouched, then a refusal: rolled back, never resent', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); ed.commit();
  host.refuse.add('e1'); host.answer(ed);
  assert.equal(f.el.textContent, 'Original');
  assert.equal(ed.stateOf(f.el), 'refused');
  assert.equal(host.inbox.length, 0, 'the refused words are not sent again');
});

test('no user event leaves pending: click, blur, Enter, Escape and typing all keep the save outstanding', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); assert.equal(ed.stateOf(f.el), 'pending');
  f.el.textContent = 'Draft'; ed.cancel();
  assert.equal(ed.stateOf(f.el), 'pending');
  assert.equal(f.el.textContent, 'First', 'Escape discards the draft only; the pending words stay');
  ed.begin(f); ed.commit(); assert.equal(ed.stateOf(f.el), 'pending');
  ed.begin(f); f.el.textContent = ''; ed.commit();
  assert.equal(ed.stateOf(f.el), 'pending');
  assert.equal(f.el.textContent, 'First');
  assert.equal(host.inbox.length, 1);
  host.drain(ed);
  assert.equal(ed.stateOf(f.el), 'idle');
  assert.equal(host.md, '## About\n\nFirst\n');
  assert.equal(host.inbox.length, 0, 'nothing was drafted, so nothing more is sent');
});

// ── Round 6: an unanswered edit never looks saved ───────────────────────────────────────────────
// Change `Original` to `First`, press Enter, and the host never answers. The words were not
// confirmed, so they are marked as pending while they wait, and after PENDING_TIMEOUT_MS the
// element shows the saved words, is marked `unknown`, and asks the host to read the span back.
const mark = (f) => f.el.getAttribute('data-text-edit');

test('an unanswered edit is marked pending, then unknown with the saved words, and a readback is sent', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  assert.equal(mark(f), null, 'idle shows nothing');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  assert.equal(ed.stateOf(f.el), 'pending');
  assert.equal(mark(f), 'pending', 'words the host has not confirmed are marked');
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, doc: ed.doc, id: 'e999', ok: true, revision: 'bogus' }), false, 'a wrong id is nobody\'s answer');
  assert.equal(mark(f), 'pending');
  host.clock.tick(PENDING_TIMEOUT_MS - 1);
  assert.equal(ed.stateOf(f.el), 'pending');
  host.clock.tick(1);
  assert.equal(ed.stateOf(f.el), 'unknown');
  assert.equal(mark(f), 'unknown');
  assert.equal(f.el.textContent, 'Original', 'unconfirmed words are not shown as the page');
  assert.equal(host.inbox.length, 2);
  const rb = host.inbox[1];
  assert.equal(rb.type, READBACK_MESSAGE);
  assert.deepEqual(rb.anchor, { section: 's1-about', start: 2, end: 2 });
  assert.equal(rb.revision, sourceRevision('## About\n\nOriginal\n'));
  host.inbox.shift(); // e1 is lost: never applied, never answered
  host.answer(ed);    // the readback: the page still says Original
  assert.equal(ed.stateOf(f.el), 'refused');
  assert.equal(f.el.textContent, 'Original');
  assert.notEqual(mark(f), 'pending'); assert.notEqual(mark(f), 'unknown');
  ed.begin(f); f.el.textContent = 'Second'; const m = ed.commit();
  assert.deepEqual([m.before, m.after, m.revision], ['Original', 'Second', sourceRevision(host.md)]);
  host.drain(ed);
  assert.equal(host.md, '## About\n\nSecond\n');
  assert.equal(mark(f), null);
});

test('an edit the host saved but whose answer was lost: the readback cannot vouch for the frame, so it is `changed`', () => {
  // Round 6 adopted the revision read back here. That revision certifies the whole page, and the
  // frame cannot tell its own saved edit from somebody else's change (round 7), so it is not adopted.
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  applySilently(host);
  host.clock.tick(PENDING_TIMEOUT_MS);
  assert.equal(f.el.textContent, 'Original');
  host.answer(ed);
  assert.equal(ed.stateOf(f.el), 'changed');
  assert.equal(mark(f), 'changed', 'not presented as saved: the host may hold First');
  assert.equal(f.el.textContent, 'Original');
  assert.equal(ed.begin(f), false, 'reload the preview to edit it');
});

// ── Round 7: a readback after somebody else changed the page ────────────────────────────────────
// A readback answers what the span holds NOW, with the page's revision NOW. It settles the lost
// edit only when that revision is the one the edit was sent against: then nothing has changed and
// the edit did not land. Any other revision means the page moved (by this edit, or by anyone), the
// frame's spans can no longer be trusted, and nothing read there may become this element's words.
const insertAt = (host, line, text) => { const ls = host.md.split('\n'); ls.splice(line, 0, text, ''); host.md = ls.join('\n'); };

test('reviewer round 6: a paragraph inserted above the lost edit — the readback is never adopted, no edit re-targets', () => {
  const host = makeHost('## About\n\nOriginal\n\nOther\n');
  const root = render(host.md);
  const ed = editor(host);
  const [f, other] = offered(root).filter((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  host.inbox.shift();                 // e1 never reaches the host
  insertAt(host, 2, 'Inserted');      // another editor, meanwhile
  host.clock.tick(PENDING_TIMEOUT_MS);
  host.answer(ed);                    // the readback: line 2 is `Inserted`, at a new revision
  assert.equal(ed.stateOf(f.el), 'changed');
  assert.equal(f.el.textContent, 'Original', 'rolled back; `Inserted` is never shown as this element\'s words');
  assert.equal(mark(f), 'changed');
  assert.equal(ed.begin(f), false);
  ed.begin(other); other.el.textContent = 'Else'; const m = ed.commit();
  assert.equal(m.revision, sourceRevision('## About\n\nOriginal\n\nOther\n'), 'still the revision the frame was rendered from');
  host.drain(ed);
  assert.equal(host.md, '## About\n\nInserted\n\nOriginal\n\nOther\n', 'nothing was written: the stale frame is refused');
  assert.equal(ed.stateOf(other.el), 'refused');
});

test('the words at the span equal `before` but the revision moved: still `changed` (the edit may have landed, and then been shifted)', () => {
  // e1 is saved (its answer lost), then another editor inserts a paragraph that happens to read
  // `Original` above it. Line 2 shows `before` again, yet the owner's paragraph holds `First`.
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  applySilently(host);
  insertAt(host, 2, 'Original');
  assert.equal(host.md, '## About\n\nOriginal\n\nFirst\n');
  host.clock.tick(PENDING_TIMEOUT_MS);
  host.answer(ed);
  assert.equal(ed.stateOf(f.el), 'changed', 'not `refused`: that would show Original as saved');
  assert.equal(mark(f), 'changed');
});

test('the readback reports the revision the edit was sent against: nothing moved, the edit did not land, and the draft goes next', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Second';
  host.clock.tick(PENDING_TIMEOUT_MS);
  host.inbox.shift(); host.answer(ed);
  assert.equal(ed.stateOf(f.el), 'pending', 'the kept draft is the next edit');
  assert.deepEqual([host.inbox[0].before, host.inbox[0].after, host.inbox[0].revision], ['Original', 'Second', sourceRevision('## About\n\nOriginal\n')]);
  host.drain(ed);
  assert.equal(host.md, '## About\n\nSecond\n');
});

test('a page changed and changed back reads back the same revision, so the span is the same element again', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  host.inbox.shift();
  const before = host.md;
  insertAt(host, 2, 'Inserted'); host.md = before; // the revision is a hash of the content
  host.clock.tick(PENDING_TIMEOUT_MS);
  host.answer(ed);
  assert.equal(ed.stateOf(f.el), 'refused');
  assert.equal(f.el.textContent, 'Original');
});

test('readback words that differ from `before` at the same revision are a host fault: `changed`, never adopted', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  host.clock.tick(PENDING_TIMEOUT_MS);
  const rb = host.inbox[1];
  assert.equal(ed.onResult({ type: READBACK_RESULT_MESSAGE, doc: ed.doc, id: rb.id, ok: true, words: 'Elsewhere', revision: sourceRevision(host.md), section: 's1-about' }), true);
  assert.equal(ed.stateOf(f.el), 'changed');
  assert.equal(f.el.textContent, 'Original');
});

test('a late answer to the lost edit is honoured before the readback, and the readback answer is then ignored', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  host.clock.tick(PENDING_TIMEOUT_MS);
  assert.equal(ed.stateOf(f.el), 'unknown');
  host.answer(ed); // e1, late
  assert.equal(ed.stateOf(f.el), 'idle');
  assert.equal(f.el.textContent, 'First');
  assert.equal(host.md, '## About\n\nFirst\n');
  host.answer(ed); // the readback answer, no longer awaited
  assert.equal(ed.stateOf(f.el), 'idle');
  assert.equal(f.el.textContent, 'First');
});

test('once the readback has answered, a late answer to the lost edit is ignored', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = editor(host);
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  host.clock.tick(PENDING_TIMEOUT_MS);
  const lost = host.inbox.shift();
  host.answer(ed); // readback: Original
  assert.equal(ed.stateOf(f.el), 'refused');
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, doc: ed.doc, id: lost.id, ok: true, revision: 'r-late' }), false);
  assert.equal(f.el.textContent, 'Original');
  assert.equal(ed.stateOf(f.el), 'refused');
});

test('a readback that is never answered: the element stays unknown and untouchable, and queued edits roll back', () => {
  const host = makeHost('## About\n\nOne\n\nTwo\n');
  const root = render(host.md);
  const hints = [];
  const ed = editor(host, { hint: (t) => hints.push(t) });
  const [a, b] = offered(root).filter((g) => g.kind === 'p');
  ed.begin(a); a.el.textContent = 'Uno'; ed.commit();
  ed.begin(b); b.el.textContent = 'Dos'; ed.commit();
  assert.equal(mark(b), 'pending', 'queued words are pending too');
  host.clock.tick(PENDING_TIMEOUT_MS);
  assert.equal(ed.stateOf(a.el), 'unknown');
  assert.equal(ed.stateOf(b.el), 'pending', 'it waits for the readback');
  host.clock.tick(PENDING_TIMEOUT_MS); // the readback is not answered either
  assert.equal(ed.stateOf(a.el), 'unknown');
  assert.equal(a.el.textContent, 'One');
  assert.equal(ed.stateOf(b.el), 'refused');
  assert.equal(b.el.textContent, 'Two');
  assert.equal(host.clock.pending, 0, 'nothing is left waiting');
  assert.equal(ed.begin(a), false, 'an element whose fate is unknown cannot be edited');
  assert.equal(host.inbox.length, 2, 'e1 and the readback; nothing else was sent');
});

test('while a readback is outstanding nothing else is sent; it goes once the readback is answered', () => {
  const host = makeHost('## About\n\nOne\n\nTwo\n');
  const root = render(host.md);
  const ed = editor(host);
  const [a, b] = offered(root).filter((g) => g.kind === 'p');
  ed.begin(a); a.el.textContent = 'Uno'; ed.commit();
  host.clock.tick(PENDING_TIMEOUT_MS);
  ed.begin(b); b.el.textContent = 'Dos'; assert.equal(ed.commit(), null, 'it waits its turn');
  assert.equal(ed.stateOf(b.el), 'pending');
  assert.deepEqual(host.inbox.map((m) => m.type), ['reef-text-edit', READBACK_MESSAGE]);
  host.inbox.shift(); host.answer(ed); // e1 lost; the readback says One
  assert.equal(host.inbox.length, 1);
  assert.deepEqual([host.inbox[0].before, host.inbox[0].after], ['Two', 'Dos']);
  host.drain(ed);
  assert.equal(host.md, '## About\n\nOne\n\nDos\n');
});

test('words being typed when the wait runs out are kept aside, and sent once the readback says the edit did not land', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const stopped = [];
  const ed = editor(host, { stop: (el) => stopped.push(el) });
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Second';
  host.clock.tick(PENDING_TIMEOUT_MS);
  assert.deepEqual(stopped, [f.el], 'typing is ended');
  assert.equal(ed.active, null);
  assert.equal(f.el.textContent, 'Original');
  host.inbox.shift(); // e1 lost
  host.answer(ed);    // readback: Original
  assert.equal(host.inbox.length, 1);
  assert.deepEqual([host.inbox[0].before, host.inbox[0].after], ['Original', 'Second']);
  host.drain(ed);
  assert.equal(host.md, '## About\n\nSecond\n');
  assert.equal(f.el.textContent, 'Second');
  assert.equal(ed.stateOf(f.el), 'idle');
});

// ── Mounting: a double of the frame, its parent and a sibling ─────────────────────────────────────
function frame(attrs, md = '## About\n\nOld\n') {
  const root = render(md);
  const box = new DomEl('div', { 'data-dynamic-coral': 'text-edit', ...attrs }, root);
  root.appendChild(box);
  const docListeners = {}, winListeners = {}, sent = [], readies = [];
  const parent = { postMessage: (m, targetOrigin) => { if (targetOrigin === 'null') throw new SyntaxError("Invalid target origin 'null'"); (m && m.type === READY_MESSAGE ? readies : sent).push({ m, targetOrigin }); } };
  const win = { parent, top: {}, location: { pathname: '/' }, addEventListener: (n, f) => { winListeners[n] = f; }, clearTimeout() {}, setTimeout() { return 1; } };
  const head = new DomEl('head', {}, null);
  const doc = {
    defaultView: win, head, body: root,
    querySelector: (sel) => (sel === '[data-dynamic-coral="text-edit"]' ? box : null),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    getElementById: () => null,
    createElement: (t) => new DomEl(t, {}, null),
    addEventListener: (n, f) => { docListeners[n] = f; },
    execCommand() {},
  };
  const ed = mountAll(doc);
  const p = offered(root).find((f) => f.kind === 'p').el;
  const key = (init) => { const e = { target: p, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init }; docListeners.keydown(e); return e; };
  const click = () => docListeners.click({ target: p });
  const focusout = () => docListeners.focusout({ target: p });
  // A host's answer echoes this document's `doc` unless the test says otherwise (tile#283).
  const reply = (data, from) => winListeners.message({ data: { doc: ed && ed.doc, ...data }, origin: from.origin, source: from.source });
  const css = () => head.nodes.map((n) => n.textContent).join('');
  return { editor: ed, sent, readies, p, parent, key, click, focusout, reply, css };
}
const REV = 'r-test';

test('the parent origin must be one explicit http(s) origin; wildcard, null and non-origins do not mount', () => {
  for (const origin of ['', '*', 'null', 'https://editor.example/path', 'https://editor.example?x', 'https://editor.example#x',
    'https://user@editor.example', 'ftp://editor.example', 'javascript:alert(1)', 'file:///x', ' https://editor.example',
    'https://EDITOR.example', 'https://editor.example:443'])
    assert.equal(frame({ 'data-parent-origin': origin, 'data-revision': REV }).editor, null, JSON.stringify(origin));
  assert.equal(frame({ 'data-parent-origin': 'https://editor.example' }).editor, null, 'no revision, no editing');
  assert.ok(frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV }).editor);
});

test('a trailing slash is the same origin: posts go to the origin and its replies are accepted', () => {
  const f = frame({ 'data-parent-origin': 'https://editor.example/', 'data-revision': REV });
  f.click(); f.p.textContent = 'New'; f.key({ key: 'Enter' });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].targetOrigin, 'https://editor.example');
  assert.deepEqual(f.sent[0].m.anchor, { section: 's1-about', start: 2, end: 2 });
  assert.equal(f.sent[0].m.revision, REV);
  f.reply({ type: RESULT_MESSAGE, id: 'e1', ok: false, hint: 'Refused' }, { origin: 'https://editor.example', source: f.parent });
  assert.equal(f.p.textContent, 'Old');
});

test('a reply must come from the parent window itself, not a sibling at the same origin', () => {
  const f = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  f.click(); f.p.textContent = 'New'; f.key({ key: 'Enter' });
  const forged = { type: RESULT_MESSAGE, id: 'e1', ok: false, hint: 'Sibling forgery' };
  f.reply(forged, { origin: 'https://editor.example', source: {} });
  f.reply(forged, { origin: 'https://evil.example', source: f.parent });
  f.reply(forged, { origin: 'null', source: {} });
  assert.equal(f.p.textContent, 'New');
  f.reply({ type: RESULT_MESSAGE, id: 'e1', ok: false }, { origin: 'https://editor.example', source: f.parent });
  assert.equal(f.p.textContent, 'Old');
});

test('Enter and Escape during IME composition are left to the IME', () => {
  const f = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  f.click();
  f.p.textContent = '拼音';
  for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Escape', isComposing: true }]) {
    const e = f.key(init);
    assert.equal(e.defaultPrevented, false, JSON.stringify(init));
    assert.equal(f.sent.length, 0, JSON.stringify(init));
    assert.equal(f.editor.active && f.editor.active.el, f.p, 'still editing after ' + JSON.stringify(init));
  }
  f.p.textContent = '拼音輸入';
  assert.equal(f.key({ key: 'Enter', isComposing: false }).defaultPrevented, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].m.after, '拼音輸入');
});

test('in the frame: Enter, click again, refusal, leave — the old words are back and only one edit was posted', () => {
  const f = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  f.click(); f.p.textContent = 'New'; f.key({ key: 'Enter' });
  assert.equal(f.sent.length, 1);
  f.click();
  assert.equal(f.editor.active && f.editor.active.el, f.p);
  f.reply({ type: RESULT_MESSAGE, id: 'e1', ok: false }, { origin: 'https://editor.example', source: f.parent });
  assert.equal(f.p.textContent, 'Old', 'rolled back while focused');
  f.focusout();
  assert.equal(f.sent.length, 1, 'leaving the field does not retry the refused edit');
  f.click(); f.key({ key: 'Enter' });
  assert.equal(f.sent.length, 1, 'neither does Enter without typing');
});

test('in the frame: pending words are marked, and the stylesheet marks pending and unknown without moving anything', () => {
  const f = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  f.click(); f.p.textContent = 'New'; f.key({ key: 'Enter' });
  assert.equal(f.p.getAttribute('data-text-edit'), 'pending');
  assert.match(f.css(), /\[data-text-edit="pending"\]\{[^}]*text-decoration[^}]*\}/);
  assert.match(f.css(), /\[data-text-edit="unknown"\][^{]*\{[^}]*text-decoration[^}]*\}/);
  assert.match(f.css(), /\[data-text-edit="changed"\][^{]*\{[^}]*text-decoration[^}]*\}/);
  assert.doesNotMatch(f.css().match(/\[data-text-edit[^{]*\{[^}]*\}/g).join(''), /margin|padding|border|font-size|display|position/, 'no layout shift');
  f.reply({ type: RESULT_MESSAGE, id: 'e1', ok: true, revision: 'r2' }, { origin: 'https://editor.example', source: f.parent });
  assert.equal(f.p.getAttribute('data-text-edit'), null);
});

// ── tile#283: a per-document nonce on every message, a ready, and answers addressed by it ─────────
// Ids restart at e1/b1 in every document and the frame's window is the same object across a
// navigation, so a host can only address an answer to the document that asked by `doc`.

test('tile#283: mintDoc is 128 random bits as 32 lowercase hex digits, different every time', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const d = mintDoc();
    assert.match(d, DOC_SHAPE);
    seen.add(d);
  }
  assert.equal(seen.size, 200);
  const fixed = mintDoc({ getRandomValues: (b) => b.fill(0xab) });
  assert.equal(fixed, 'ab'.repeat(16));
});

test('tile#283: every message the editor posts carries its doc — the edit and the readback — and ready() names it', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const ed = editor(host, { doc: 'd'.repeat(32) });
  assert.equal(ed.doc, 'd'.repeat(32));
  assert.deepEqual(ed.ready(), { type: READY_MESSAGE, doc: 'd'.repeat(32) });
  const f = offered(render(host.md)).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  assert.deepEqual(Object.keys(host.inbox[0]).sort(), ['after', 'anchor', 'before', 'doc', 'id', 'page', 'revision', 'type']);
  assert.equal(host.inbox[0].type, EDIT_MESSAGE);
  assert.equal(host.inbox[0].doc, ed.doc);
  host.inbox.length = 0; // the answer is lost
  host.clock.tick(PENDING_TIMEOUT_MS);
  assert.equal(host.inbox.length, 1);
  assert.deepEqual(Object.keys(host.inbox[0]).sort(), ['anchor', 'doc', 'id', 'page', 'revision', 'type']);
  assert.equal(host.inbox[0].type, READBACK_MESSAGE);
  assert.equal(host.inbox[0].doc, ed.doc);
  assert.match(editor(host).doc, DOC_SHAPE, 'without a doc given, one is minted');
});

test('tile#283: an answer whose doc is not its own — another document\'s, or none — is ignored, for edits and readbacks', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const ed = editor(host, { doc: 'a'.repeat(32) });
  const f = offered(render(host.md)).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  const m = host.inbox[0];
  for (const doc of ['b'.repeat(32), undefined, '', null, 'A'.repeat(32)]) {
    assert.equal(ed.onResult({ type: RESULT_MESSAGE, doc, id: m.id, ok: false, hint: 'Not yours' }), false, String(doc));
    assert.equal(f.el.textContent, 'First');
    assert.equal(ed.stateOf(f.el), 'pending');
  }
  host.clock.tick(PENDING_TIMEOUT_MS); // unanswered: unknown, and a readback goes out
  const rb = host.inbox.at(-1);
  assert.equal(rb.type, READBACK_MESSAGE);
  for (const doc of ['b'.repeat(32), undefined])
    assert.equal(ed.onResult({ type: READBACK_RESULT_MESSAGE, doc, id: rb.id, ok: true, words: 'Original', revision: m.revision, section: 's1-about' }), false);
  assert.equal(ed.stateOf(f.el), 'unknown');
  assert.equal(ed.onResult({ type: READBACK_RESULT_MESSAGE, doc: ed.doc, id: rb.id, ok: true, words: 'Original', revision: m.revision, section: 's1-about' }), true, 'its own doc is taken');
});

test('tile#283: in the frame, the coral posts exactly one ready with its doc at mount, before any edit, and only when mounted', () => {
  const f = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  assert.equal(f.readies.length, 1);
  assert.deepEqual(f.readies[0], { m: { type: READY_MESSAGE, doc: f.editor.doc }, targetOrigin: 'https://editor.example' });
  assert.equal(f.sent.length, 0, 'nothing else at mount');
  f.click(); f.p.textContent = 'New'; f.key({ key: 'Enter' });
  assert.equal(f.sent[0].m.doc, f.editor.doc);
  assert.equal(f.readies.length, 1, 'an edit does not repeat the ready');
  for (const attrs of [{ 'data-parent-origin': '*', 'data-revision': REV }, { 'data-parent-origin': 'https://editor.example' }])
    assert.deepEqual(frame(attrs).readies, [], 'not mounted: no ready');
});

test('tile#283: two documents in the same frame have different docs; an answer to A\'s e1 is not B\'s e1', () => {
  const a = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  const b = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  assert.notEqual(a.editor.doc, b.editor.doc);
  a.click(); a.p.textContent = 'A words'; a.key({ key: 'Enter' });
  b.click(); b.p.textContent = 'B words'; b.key({ key: 'Enter' });
  assert.equal(a.sent[0].m.id, 'e1');
  assert.equal(b.sent[0].m.id, 'e1', 'the same id in both documents');
  // A's answer, posted into B's window (the frame navigated): ignored.
  b.reply({ type: RESULT_MESSAGE, doc: a.editor.doc, id: 'e1', ok: false, hint: 'A refused' }, { origin: 'https://editor.example', source: b.parent });
  assert.equal(b.p.textContent, 'B words');
  assert.equal(b.p.getAttribute('data-text-edit'), 'pending');
  b.reply({ type: RESULT_MESSAGE, id: 'e1', ok: false }, { origin: 'https://editor.example', source: b.parent });
  assert.equal(b.p.textContent, 'Old', 'its own doc is taken');
});
