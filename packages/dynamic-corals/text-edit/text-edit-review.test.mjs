// Round-1 review cases for the text-edit coral, each one a reproduction that used to pass silently.
//   run: node --test packages/dynamic-corals/text-edit/text-edit-review.test.mjs
//
// Every case here once wrote words onto a line other than the one the owner tapped, or showed words
// the saved page did not have, or trusted a message it should not have. The pages are rendered with
// sitetile's own renderer and the edits go through the reference applier, so "preview == saved" is
// measured against the real output, never against what the test author believes it is.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSite, renderSiteToHtml } from '../../sitetile/site-core.js';
import { editableAt, anchorFor, createEditor, cleanText, mountAll, RESULT_MESSAGE } from './text-edit-core.mjs';
import * as source from './text-edit-source.mjs';

const { applyTextEdit } = source;
const revisionOf = (md) => (typeof source.sourceRevision === 'function' ? source.sourceRevision(md) : undefined);

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
const render = (md) => tree(renderSiteToHtml(parseSite(md)));
const offered = (root) => [...root.all()].map(editableAt).filter((f, i, arr) => f && arr.findIndex((g) => g && g.el === f.el) === i);
const words = (root, kind) => offered(root).filter((f) => !kind || f.kind === kind).map((f) => cleanText(f.el.textContent));
const editOf = (f, after, md) => {
  const a = anchorFor(f.el, f.section, f.kind);
  return { anchor: { section: a.section, kind: a.kind, occurrence: a.occurrence }, before: a.before, after, revision: revisionOf(md) };
};

// A host that applies what the coral posts to its own copy of the page, the way a real host does,
// and answers only when told to (replies are asynchronous in a browser).
function makeHost(md) {
  const host = { md, inbox: [], refuse: new Set(), results: [] };
  host.post = (m) => host.inbox.push(m);
  host.answer = (ed, pick = 'first') => {
    const m = pick === 'last' ? host.inbox.pop() : host.inbox.shift();
    const res = host.refuse.has(m.id) ? { ok: false, reason: 'refused-by-test' } : applyTextEdit(host.md, m);
    if (res.ok) host.md = res.markdown;
    host.results.push({ id: m.id, ok: res.ok, reason: res.reason });
    ed.onResult(res.ok
      ? { type: RESULT_MESSAGE, id: m.id, ok: true, revision: res.revision, section: res.section }
      : { type: RESULT_MESSAGE, id: m.id, ok: false });
  };
  host.drain = (ed, pick) => { while (host.inbox.length) host.answer(ed, pick); };
  return host;
}

// ── P1-1: DOM and source occurrences must come from the same rendered population ─────────────────
test('a fragment whose comment vanishes in rendering is refused, and its twins still land on their own lines', () => {
  const md = '## About\n\nSame<!-- note -->\n\nSame\n\nSame\n';
  const ps = offered(render(md)).filter((f) => f.kind === 'p');
  assert.deepEqual(ps.map((f) => cleanText(f.el.textContent)), ['Same', 'Same', 'Same']);
  assert.deepEqual(applyTextEdit(md, editOf(ps[0], 'Changed first', md)), { ok: false, reason: 'not-plain' });
  const second = applyTextEdit(md, editOf(ps[1], 'Changed second', md));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(words(render(second.markdown), 'p'), ['Same', 'Changed second', 'Same']);
});

test('a soft-wrapped CJK paragraph that renders as the same words as a plain one is refused, not swapped', () => {
  const md = '## About\n\n制作は、\nあなた\n\n制作は、あなた\n';
  const ps = offered(render(md)).filter((f) => f.kind === 'p');
  assert.deepEqual(ps.map((f) => cleanText(f.el.textContent)), ['制作は、あなた', '制作は、あなた']);
  assert.deepEqual(applyTextEdit(md, editOf(ps[0], 'x', md)), { ok: false, reason: 'not-plain' });
  const second = applyTextEdit(md, editOf(ps[1], 'y', md));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(words(render(second.markdown), 'p'), ['制作は、あなた', 'y']);
});

test('when source and render still disagree about a population, the edit is refused rather than guessed', () => {
  // `<!-- a --> Same` renders a paragraph the source split does not see as one.
  const md = '## About\n\n<!-- a --> Same\n\nSame\n';
  const ps = offered(render(md)).filter((f) => f.kind === 'p');
  assert.equal(ps.length, 2);
  for (const f of ps) {
    const res = applyTextEdit(md, editOf(f, 'Changed', md));
    assert.equal(res.ok, false, JSON.stringify(res));
  }
});

// ── P1-2: a stale preview is refused even when duplicates renumber ───────────────────────────────
test('an edit made against an older revision is refused, never written to a surviving duplicate', () => {
  const preview = '## About\n\nSame\n\nSame\n';
  const ps = offered(render(preview)).filter((f) => f.kind === 'p');
  const edit = editOf(ps[0], 'My change', preview);
  const current = preview.replace('Same', 'Changed elsewhere');
  assert.deepEqual(applyTextEdit(current, edit), { ok: false, reason: 'changed' });
  assert.equal(applyTextEdit(preview, edit).ok, true, 'the same edit against its own revision applies');
  const { revision, ...unversioned } = edit;
  assert.deepEqual(applyTextEdit(preview, unversioned), { ok: false, reason: 'malformed' }, 'an edit with no revision proves nothing');
});

// ── P1-3: pending optimistic edits must not redefine occurrence identity ──────────────────────────
test('a pending refused edit does not shift the next duplicate onto another line', () => {
  const host = makeHost('## About\n\nSame\n\nSame\n');
  const root = render(host.md);
  const ed = createEditor({ page: '/', revision: revisionOf(host.md), post: host.post, hint: () => {} });
  const ps = offered(root).filter((f) => f.kind === 'p');
  ed.begin(ps[0]); ps[0].el.textContent = '**bold**'; ed.commit();
  ed.begin(ps[1]); ps[1].el.textContent = 'Second'; ed.commit();
  host.drain(ed);
  assert.deepEqual(words(root, 'p'), ['Same', 'Second']);
  assert.deepEqual(words(render(host.md), 'p'), words(root, 'p'), 'preview and saved page agree');
});

test('a late refusal does not overwrite newer words typed into the same element', () => {
  const host = makeHost('## About\n\nOriginal\n');
  const root = render(host.md);
  const ed = createEditor({ page: '/', revision: revisionOf(host.md), post: host.post, hint: () => {} });
  const f = offered(root).find((g) => g.kind === 'p');
  ed.begin(f); f.el.textContent = 'First'; ed.commit();
  ed.begin(f); f.el.textContent = 'Second'; ed.commit();
  host.refuse.add('e1');
  // a reply to an id the coral has not sent yet is nobody's answer
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, id: 'e2', ok: true }), host.inbox.some((m) => m.id === 'e2'));
  host.drain(ed, 'last');
  assert.equal(cleanText(f.el.textContent), 'Second');
  assert.deepEqual(words(render(host.md), 'p'), ['Second']);
});

test('successive edits to neighbouring duplicates all land where they were made', () => {
  const host = makeHost('## About\n\nSame\n\nSame\n\nSame\n');
  const root = render(host.md);
  const ed = createEditor({ page: '/', revision: revisionOf(host.md), post: host.post, hint: () => {} });
  const ps = offered(root).filter((f) => f.kind === 'p');
  ed.begin(ps[2]); ps[2].el.textContent = 'Three'; ed.commit();
  ed.begin(ps[0]); ps[0].el.textContent = 'One'; ed.commit();
  ed.begin(ps[1]); ps[1].el.textContent = 'Two'; ed.commit();
  host.drain(ed);
  assert.deepEqual(host.results.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(words(render(host.md), 'p'), ['One', 'Two', 'Three']);
  assert.deepEqual(words(root, 'p'), ['One', 'Two', 'Three']);
});

// ── P2-6: a saved title keeps the section editable ────────────────────────────────────────────────
test('after a title is saved, the same frame can edit its paragraph and the title again', () => {
  const host = makeHost('## About\n\nBody words\n');
  const root = render(host.md);
  const ed = createEditor({ page: '/', revision: revisionOf(host.md), post: host.post, hint: () => {} });
  const title = offered(root).find((f) => f.kind === 'title');
  const body = offered(root).find((f) => f.kind === 'p');
  ed.begin(title); title.el.textContent = 'Contact'; ed.commit(); host.drain(ed);
  ed.begin(body); body.el.textContent = 'Changed body'; ed.commit(); host.drain(ed);
  ed.begin(title); title.el.textContent = 'Contact us'; ed.commit(); host.drain(ed);
  assert.deepEqual(host.results.map((r) => r.ok), [true, true, true], JSON.stringify(host.results));
  assert.equal(host.md, '## Contact us\n\nChanged body\n');
});

// ── Mounting: a double of the frame, its parent and a sibling ─────────────────────────────────────
function frame(attrs, md = '## About\n\nOld\n') {
  const root = render(md);
  const box = new DomEl('div', { 'data-dynamic-coral': 'text-edit', ...attrs }, root);
  root.appendChild(box);
  const docListeners = {}, winListeners = {}, sent = [];
  const parent = { postMessage: (m, targetOrigin) => { if (targetOrigin === 'null') throw new SyntaxError("Invalid target origin 'null'"); sent.push({ m, targetOrigin }); } };
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
  const editor = mountAll(doc);
  const p = offered(root).find((f) => f.kind === 'p').el;
  const key = (init) => { const e = { target: p, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init }; docListeners.keydown(e); return e; };
  const click = () => docListeners.click({ target: p });
  const reply = (data, from) => winListeners.message({ data, origin: from.origin, source: from.source });
  return { editor, sent, p, parent, key, click, reply, docListeners };
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
  assert.ok(f.editor);
  f.click(); f.p.textContent = 'New'; f.key({ key: 'Enter' });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].targetOrigin, 'https://editor.example');
  assert.equal(f.sent[0].m.revision, REV);
  f.reply({ type: RESULT_MESSAGE, id: 'e1', ok: false, hint: 'Refused' }, { origin: 'https://editor.example', source: f.parent });
  assert.equal(f.p.textContent, 'Old', 'the parent\'s refusal was heard');
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

// ── P2-7: keys belong to the IME while it composes ───────────────────────────────────────────────
test('Enter and Escape during IME composition are left to the IME', () => {
  const f = frame({ 'data-parent-origin': 'https://editor.example', 'data-revision': REV });
  f.click();
  assert.ok(f.p.getAttribute('contenteditable') || f.p.contentEditable !== 'inherit', 'editing started');
  f.p.textContent = '拼音';
  for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Enter', keyCode: 229 }, { key: 'Escape', isComposing: true }]) {
    const e = f.key(init);
    assert.equal(e.defaultPrevented, false, JSON.stringify(init));
    assert.equal(f.sent.length, 0, JSON.stringify(init));
    assert.equal(f.editor.active && f.editor.active.el, f.p, 'still editing after ' + JSON.stringify(init));
  }
  f.p.textContent = '拼音輸入';
  const done = f.key({ key: 'Enter', isComposing: false });
  assert.equal(done.defaultPrevented, true);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].m.after, '拼音輸入');
});

// ── Not a round-1 finding, seen in its probes: a renderer placeholder must not be accepted as words ──
test('words the renderer would not show as written are not plain words', () => {
  const md = '## About\n\nOriginal\n';
  const f = offered(render(md)).find((g) => g.kind === 'p');
  assert.deepEqual(applyTextEdit(md, editOf(f, 'ST-BR-TOKEN', md)), { ok: false, reason: 'after-not-plain' });
});
