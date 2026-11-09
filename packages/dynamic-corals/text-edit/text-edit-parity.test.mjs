// The coral's anchors, measured against the renderer's REAL output.
//   run: node packages/dynamic-corals/text-edit/text-edit-parity.test.mjs
//
// 🔴 Why rendered HTML and not hand-made elements: the anchor is only worth anything if the element
// the owner taps and the source line the edit lands on are the same words. A fixture of
// hand-written elements would agree with whatever the test author believed the renderer emits. So
// this renders pages with sitetile's own renderSiteToHtml, builds a small element tree from that
// HTML, lets the coral address EVERY element it offers, applies an edit through
// text-edit-source.mjs, renders again, and asserts that exactly that element's words changed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSite, renderSiteToHtml } from '../../sitetile/site-core.js';
import { editableAt, anchorFor, createEditor, cleanText, EDIT_MESSAGE, RESULT_MESSAGE } from './text-edit-core.mjs';
import { applyTextEdit, textFragments, htmlTree as tree, sourceRevision } from './text-edit-source.mjs';

const REV = (md) => sourceRevision(md);

// The element tree comes from the applier's own tokenizer (htmlTree), the one it counts with.
const render = (md) => tree(renderSiteToHtml(parseSite(md)));
const offered = (root) => [...root.all()].map(editableAt).filter((f, i, arr) => f && arr.findIndex((g) => g && g.el === f.el) === i);

const PAGE = `---
title: Home
---

## About us

We make tables by hand.

We make tables by hand.

A paragraph with **bold** words and a [link](/x).

- Oak
- Walnut
- Oak

> A quote paragraph is not body text.

[Shop](/shop) [Visit](/visit)

![a chair](chair.jpg)

1. First step
2. Second step

## Services
%% sitetile: grid %%

### Chairs
Hand made.

## Notes

Soft wrapped
paragraph over two lines.

\`\`\`
- not a list item
\`\`\`

Last words here.
`;

test('every plain element the coral offers round-trips to exactly its own source line', () => {
  const root = render(PAGE);
  const found = offered(root).filter((f) => f.plain);
  const kinds = found.map((f) => f.kind + ':' + cleanText(f.el.textContent));
  assert.deepEqual(kinds, [
    'title:About us', 'p:We make tables by hand.', 'p:We make tables by hand.',
    'li:Oak', 'li:Walnut', 'li:Oak', 'li:First step', 'li:Second step',
    'title:Notes', 'p:Soft wrapped paragraph over two lines.', 'p:Last words here.',
  ]);
  let changed = 0;
  for (const f of found) {
    const anchor = anchorFor(f.el, f.section, f.kind);
    const res = applyTextEdit(PAGE, { anchor, before: anchor.before, after: 'Changed words', revision: REV(PAGE) });
    if (f.kind === 'p' && anchor.before.startsWith('Soft wrapped')) { assert.deepEqual(res, { ok: false, reason: 'not-plain' }); continue; }
    assert.equal(res.ok, true, JSON.stringify(anchor) + ' → ' + JSON.stringify(res));
    // Re-render: the same element (by the same walk) now reads the new words; nothing else moved.
    const again = offered(render(res.markdown)).filter((g) => g.plain);
    const beforeTexts = found.map((g) => cleanText(g.el.textContent));
    const afterTexts = again.map((g) => cleanText(g.el.textContent));
    const idx = found.indexOf(f);
    const expected = beforeTexts.slice(); expected[idx] = 'Changed words';
    assert.deepEqual(afterTexts, expected, 'edit of ' + JSON.stringify(anchor));
    changed++;
  }
  assert.equal(changed, 10);
});

test('the second of two identical paragraphs edits the second source line, not the first', () => {
  const root = render(PAGE);
  const twins = offered(root).filter((f) => f.kind === 'p' && cleanText(f.el.textContent) === 'We make tables by hand.');
  assert.equal(twins.length, 2);
  const anchor = anchorFor(twins[1].el, twins[1].section, 'p');
  assert.equal(anchor.occurrence, 1);
  const res = applyTextEdit(PAGE, { anchor, before: anchor.before, after: 'Second one', revision: REV(PAGE) });
  assert.match(res.markdown, /We make tables by hand\.\n\nSecond one\n/);
});

test('formatted text, quotes, button rows, figures and component sections are not offered as plain', () => {
  const root = render(PAGE);
  const all = offered(root);
  // (the renderer keeps the `**` as hidden `.st-mk` spans, so they are part of textContent)
  const mixed = all.find((f) => cleanText(f.el.textContent).startsWith('A paragraph with'));
  assert.ok(mixed && mixed.plain === false, 'a paragraph with bold and a link is offered only as "use the editor"');
  assert.equal(cleanText(mixed.el.textContent), 'A paragraph with **bold** words and a link.', 'the words the applier test below sends');
  const texts = all.map((f) => cleanText(f.el.textContent));
  assert.ok(!texts.includes('A quote paragraph is not body text.'));
  assert.ok(!texts.some((t) => t.includes('Shop')), 'a links-only row is a link row, not words');
  assert.ok(!texts.includes('Services') && !texts.includes('Chairs') && !texts.includes('Hand made.'), 'grid text is component text');
});

test('the source applier refuses what is not a plain, current, prose fragment', () => {
  const a = (section, kind, occurrence = 0) => ({ section, kind, occurrence });
  const sid = textFragments(PAGE).sections.map((s) => s.id);
  assert.deepEqual(sid, ['s1-about-us', 's2-services', 's3-notes']);
  const r = (anchor, before, after) => applyTextEdit(PAGE, { anchor, before, after, revision: REV(PAGE) }).reason;
  assert.equal(r(a('s1-about-us', 'p'), 'Somebody changed this since the build.', 'x'), 'not-found');
  assert.equal(r(a('s1-about-us', 'p', 2), 'We make tables by hand.', 'x'), 'not-found');
  assert.equal(r(a('s9-gone', 'p'), 'We make tables by hand.', 'x'), 'not-found');
  assert.equal(r(a('s2-services', 'title'), 'Services', 'x'), 'unsupported-section');
  assert.equal(r(a('s1-about-us', 'p'), 'A paragraph with bold words and a link.', 'x'), 'not-found');
  // the words the frame shows for it (the `**` stay as hidden markers, a link shows its label) are
  // found and refused as formatted; its raw source is not what any frame sends
  assert.equal(r(a('s1-about-us', 'p'), 'A paragraph with **bold** words and a link.', 'x'), 'not-plain');
  assert.equal(r(a('s1-about-us', 'p'), 'A paragraph with **bold** words and a [link](/x).', 'x'), 'not-found');
  assert.equal(applyTextEdit(PAGE.replace('Last words', 'Lost words'), { anchor: a('s1-about-us', 'p'), before: 'We make tables by hand.', after: 'x', revision: REV(PAGE) }).reason, 'changed');
  for (const bad of ['now **bold**', 'a [link](/x)', '<b>x</b>', '# heading', '- item', '> quote', 'see https://x.test', '   ', 'a `code`'])
    assert.equal(r(a('s1-about-us', 'p'), 'We make tables by hand.', bad), 'after-not-plain', bad);
  assert.equal(applyTextEdit(PAGE, { anchor: { section: 's1-about-us', kind: 'div', occurrence: 0 }, before: 'x', after: 'y', revision: REV(PAGE) }).reason, 'malformed');
  assert.equal(applyTextEdit(PAGE, null).reason, 'malformed');
});

test('a list item keeps its marker and indent; a title keeps `## `', () => {
  const li = applyTextEdit(PAGE, { anchor: { section: 's1-about-us', kind: 'li', occurrence: 1 }, before: 'Oak', after: 'Cherry', revision: REV(PAGE) });
  assert.match(li.markdown, /- Oak\n- Walnut\n- Cherry\n/);
  const ol = applyTextEdit(PAGE, { anchor: { section: 's1-about-us', kind: 'li', occurrence: 0 }, before: 'Second step', after: 'Then sand it', revision: REV(PAGE) });
  assert.match(ol.markdown, /\n2\. Then sand it\n/);
  const t = applyTextEdit(PAGE, { anchor: { section: 's3-notes', kind: 'title', occurrence: 0 }, before: 'Notes', after: 'Workshop notes', revision: REV(PAGE) });
  assert.match(t.markdown, /\n## Workshop notes\n/);
  assert.equal(t.markdown.split('\n').length, PAGE.split('\n').length);
});

test('the editor posts one text-only edit, and a refusal puts the old words back with the host hint', () => {
  const root = render(PAGE);
  const posted = [], hints = [];
  const ed = createEditor({ page: '/', revision: REV(PAGE), post: (m) => posted.push(m), hint: (t) => hints.push(t) });
  const f = offered(root).find((g) => g.kind === 'li' && g.el.textContent === 'Walnut');
  assert.equal(ed.begin(f), true);
  f.el.textContent = '  Black\nwalnut ';
  const m = ed.commit();
  assert.deepEqual(m, { type: EDIT_MESSAGE, id: 'e1', page: '/', revision: REV(PAGE), anchor: { section: 's1-about-us', kind: 'li', occurrence: 0 }, before: 'Walnut', after: 'Black walnut' });
  assert.equal(f.el.textContent, 'Black walnut');
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, id: 'e1', ok: false, hint: 'Changed elsewhere — open the editor.' }), true);
  assert.equal(f.el.textContent, 'Walnut');
  assert.deepEqual(hints, ['Changed elsewhere — open the editor.']);
  assert.equal(ed.onResult({ type: RESULT_MESSAGE, id: 'e1', ok: true }), false, 'an answer is used once');

  // unchanged and emptied text posts nothing; Escape restores
  assert.equal(ed.begin(f), true); assert.equal(ed.commit(), null);
  ed.begin(f); f.el.textContent = ''; assert.equal(ed.commit(), null); assert.equal(f.el.textContent, 'Walnut');
  ed.begin(f); f.el.textContent = 'oops'; ed.cancel(); assert.equal(f.el.textContent, 'Walnut');
  assert.equal(posted.length, 1);

  // a formatted paragraph is never made editable: the hint instead
  const mixed = offered(root).find((g) => !g.plain && g.kind === 'p');
  assert.equal(ed.begin(mixed), false);
  assert.equal(hints.at(-1), 'This text has formatting or structure. Change it in the editor.');
});
