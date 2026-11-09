// Review cases for the text-edit coral (rounds 1–3), each one a reproduction that used to pass
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
import { editableAt, anchorFor, createEditor, cleanText, mountAll, RESULT_MESSAGE } from './text-edit-core.mjs';
import * as source from './text-edit-source.mjs';

const { applyTextEdit, sourceRevision } = source;

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
const editor = (host) => createEditor({ page: '/', revision: sourceRevision(host.md), post: host.post, hint: () => {} });

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
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, id: 'e2', ok: true }), false, 'a reply to an id not sent yet is nobody\'s answer');
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

// ── Mounting: a double of the frame, its parent and a sibling ─────────────────────────────────────
function frame(attrs, md = '## About\n\nOld\n') {
  const root = render(md);
  const box = new DomEl('div', { 'data-dynamic-coral': 'text-edit', ...attrs }, root);
  root.appendChild(box);
  const docListeners = {}, winListeners = {}, sent = [];
  const parent = { postMessage: (m, targetOrigin) => { if (targetOrigin === 'null') throw new SyntaxError("Invalid target origin 'null'"); sent.push({ m, targetOrigin }); } };
  const win = { parent, top: {}, location: { pathname: '/' }, addEventListener: (n, f) => { winListeners[n] = f; }, clearTimeout() {}, setTimeout() { return 1; } };
  const doc = {
    defaultView: win, head: new DomEl('head', {}, null), body: root,
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
  const reply = (data, from) => winListeners.message({ data, origin: from.origin, source: from.source });
  return { editor: ed, sent, p, parent, key, click, reply };
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
