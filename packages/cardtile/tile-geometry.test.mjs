// Tile geometry parity — a tile type's EMPTY (edit-only) state has the same geometry as its FILLED
// state, and a run of links is a grouped list whose outer corners are rounded.
//
// THE RULE
//  1. A run is a grouped list, like an inset-grouped list on iOS: the run's OUTER corners take the
//     card's tile radius (18px), inner seams are square, dividers as before. A single tile alone in
//     a run is therefore fully rounded. (`.st-run` is a flex COLUMN: first row rounds its top two
//     corners, last row its bottom two.) The corner half is CSS and is measured in a browser by
//     verify/tile-geometry.mjs; this file pins that the rules exist and the markup they select on.
//  2. A tile type's empty (edit-only) state shares its filled state's SKELETON: same wrapper classes
//     (minus `st-cell-unset`), same inner skeleton, same label position — and it is placed in a run
//     exactly as the filled one would be. Its HEIGHT is the filled state's too, EXCEPT where the
//     filled state's height comes from the picture itself: an empty picture has no picture to be
//     tall with, so it is one row (dashed outline, small picture glyph, the words) rather than the
//     blank square the picture will fill (ruler #6, 2026-09-24: empty is never blank). A link's
//     height comes from its text, so an empty link keeps the filled height.
//  3. A link's head (icon + arrow) with nothing to show (no children, or only a favicon its onerror
//     hid) collapses, so the title is not pinned to the bottom under a blank band.
//
// 🩸 Counterexample pinned below: the unset link used to be `.st-cell-body` straight inside the cell
// — no `.st-cell-link`, no `.st-cell-head` — so it rendered rounded with its title at the top while
// the filled link beside it was square with its title at the bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCardHTML } from './serve/card-worker.mjs';

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'line', 'polyline', 'use']);

/** Minimal tag walker: returns the subtree of the element whose opening tag matches `pick`, as
 *  nested {tag, cls:[...], kids:[...]}. Enough for renderer output (no comments/CDATA in cells). */
function subtree(html, pick) {
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m, root = null; const stack = [];
  while ((m = re.exec(html))) {
    const [, close, tag0, attrs, selfClose] = m; const tag = tag0.toLowerCase();
    if (!root) {
      if (close || !pick(attrs)) continue;
      root = { tag, cls: classesOf(attrs), kids: [] }; stack.push(root);
      if (VOID.has(tag) || selfClose) return root;
      continue;
    }
    if (close) { stack.pop(); if (!stack.length) return root; continue; }
    const node = { tag, cls: classesOf(attrs), kids: [] };
    stack[stack.length - 1].kids.push(node);
    if (!VOID.has(tag) && !selfClose) stack.push(node);
  }
  throw new Error('element not found / unclosed');
}
function classesOf(attrs) { const c = /\bclass="([^"]*)"/.exec(attrs); return c ? c[1].split(/\s+/).filter(Boolean).sort() : []; }

/** Skeleton = tag.class sequence of the descendants. Two documented substitutions, both forced by
 *  the empty state having nothing to point at: the link's `<a>` is an inert `<div>`, and the
 *  picture's `<img>` is an empty `<span>` slot. A head's CONTENTS (icon/arrow) are not skeleton —
 *  an unset link has no address to derive an icon from — the head itself is. */
function skeleton(n, depth = 0) {
  const tag = n.tag === 'a' ? 'div' : n.tag === 'img' ? 'span' : n.tag;
  const self = depth === 0 ? '' : `${tag}.${n.cls.join('.')}`;
  const kids = n.cls.includes('st-cell-head') ? [] : n.kids.map((k) => skeleton(k, depth + 1));
  return depth === 0 ? kids : { [self]: kids };
}
const cellAt = (html, i) => subtree(html, (a) => new RegExp(`\\bdata-cell="${i}"`).test(a));
const wrapper = (n) => n.cls.filter((c) => c !== 'st-cell-unset');

// One card: per type, a filled cell then an empty one. Order = data-cell index.
const MD = [
  '---', 'card-page: t', 'title: T', '---', '',
  '## cards', '',
  '- [ ] %% card: link w=6 sub=hello %% [filled](https://example.com/a)',   // 0
  '- [ ] %% card: link w=6 %% [empty]()',                                    // 1
  '- [ ] %% card: link w=6 %% [filled2](https://example.com/b)',            // 2
  '- [ ] %% card: text w=6 %% a break',                                      // 3
  '- [ ] %% card: feature w=2 img=https://example.com/p.png alt=Pic label=on %%', // 4
  '- [ ] %% card: feature w=2 %%',                                           // 5
  '',
].join('\n');
const html = renderCardHTML(MD, { handle: 't', cardUrl: '', editIndex: true });

test('link: empty state has the filled wrapper classes and skeleton', () => {
  const f = cellAt(html, 0), e = cellAt(html, 1);
  assert.ok(e.cls.includes('st-cell-unset'), 'cell 1 is the unset link');
  assert.deepEqual(wrapper(e), wrapper(f));
  assert.deepEqual(skeleton(e), skeleton(f));
  assert.deepEqual(skeleton(f), [{ 'div.st-cell-link': [{ 'div.st-cell-head': [] }, { 'div.st-cell-body': [{ 'div.st-cell-title': [] }, { 'div.st-cell-sub': [] }] }] }]);
});

test('picture: empty state has the filled (labelled) wrapper classes and skeleton', () => {
  const f = cellAt(html, 4), e = cellAt(html, 5);
  assert.ok(e.cls.includes('st-cell-unset'), 'cell 5 is the unset picture');
  assert.deepEqual(wrapper(e), wrapper(f));
  assert.deepEqual(skeleton(e), skeleton(f));
});

test('picture: the empty state is ONE ROW, not the square — its height is the one thing that may differ', () => {
  // the filled picture's height comes from the picture (`aspect-ratio` on the link); the empty one
  // has no picture, so the edit-only CSS undoes that ratio and lays the glyph + words out in a row.
  const edit = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((c) => c.includes('.st-cell-unset{'));
  assert.ok(edit, 'the edit-only stylesheet is in an editIndex render');
  assert.match(edit, /\.st-gal-labelled\.st-cell-unset \.st-gal-link\{[^}]*flex-direction:row[^}]*aspect-ratio:auto[^}]*min-height:44px/);
  assert.match(edit, /\.st-gal-labelled\.st-cell-unset\{min-height:var\(--cp-unit\);border:1px dashed/, 'one grid row tall, dashed');
  assert.match(edit, /\.st-cell-unset\{border-style:dashed/, 'same dashed edit outline as the empty link');
  assert.match(edit, /\.st-cell-unset \.st-gal-img\{[^}]*width:20px;height:20px[^}]*mask:/, 'the slot is a small picture glyph');
  // …and the glyph is painted, not a child: the skeleton test above stays the filled picture's
  assert.deepEqual(cellAt(html, 5).kids[0].kids.map((k) => k.kids.length), [0, 0]);
  // a live card never carries it (it renders no unset tile at all)
  const live = renderCardHTML(MD, { handle: 't', cardUrl: '' });
  assert.ok(!live.includes('st-cell-unset'));
});

test('an unset link is grouped into the run exactly like a filled one', () => {
  const runs = [...html.matchAll(/<div class="st-run">/g)];
  assert.equal(runs.length, 1, 'links 0-2 form one run; nothing else runs');
  const run = subtree(html, (a) => /class="st-run"/.test(a));
  assert.deepEqual(run.kids.map((k) => k.cls.includes('st-cell-unset')), [false, true, false]);
});

test('a lone link is alone in its own run (so the corner rule makes it fully rounded)', () => {
  const lone = renderCardHTML(['---', 'card-page: t', 'title: T', '---', '', '## c', '', '- [ ] %% card: link w=6 %% [only](https://example.com)', ''].join('\n'), { handle: 't', cardUrl: '' });
  const run = subtree(lone, (a) => /class="st-run"/.test(a));
  assert.equal(run.kids.length, 1);
});

test('the run-corner and empty-head rules ship in the card stylesheet', () => {
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((c) => c.includes('.st-run{'));
  assert.ok(css, 'the stylesheet carrying .st-run is in the page');
  assert.match(css, /\.st-card \.st-run > \.st-cell-tile:first-child\{border-top-left-radius:18px;border-top-right-radius:18px\}/);
  assert.match(css, /\.st-card \.st-run > \.st-cell-tile:last-child\{border-bottom-left-radius:18px;border-bottom-right-radius:18px\}/);
  assert.ok(css.includes('.st-cell-head:not(:has(> :not([style*="display: none"]))){display:none}'), 'empty/hidden-icon head collapses');
});

test('control: the pre-fix placeholder (no .st-cell-link / .st-cell-head) is caught', () => {
  // the exact markup the renderer emitted before this fix — reintroducing it must go red
  const OLD = '<div class="st-cell st-cell-tile st-cell-unset" data-w="6" data-cell="1" data-coral-type="linktile"><div class="st-cell-body"><div class="st-cell-title">empty</div><div class="st-cell-sub">No address yet</div></div></div>';
  const OLD_IMG = '<div class="st-cell st-gal-cell st-gal-cell-bare st-cell-unset" data-cell="5" data-coral-type="feature"><span class="st-gal-label">+ Add a picture</span></div>';
  assert.notDeepEqual(skeleton(cellAt(OLD, 1)), skeleton(cellAt(html, 0)));
  assert.notDeepEqual(wrapper(cellAt(OLD_IMG, 5)), wrapper(cellAt(html, 4)));
  // and the renderer is not emitting it
  assert.ok(!/st-cell-unset"[^>]*><div class="st-cell-body"/.test(html));
});
