// The Card's inline markdown must stay a SUPERSET of tile's, never a fork.
//
// Two renderers exist on purpose. tile's `renderInlineMd` (packages/cssmd, vendored from
// CVERInc/tile) is the EDITOR dialect: markers stay in the DOM inside hidden spans so getText()
// round-trips, and content is wrapped in `<prefix>-b` / `<prefix>-i`. The Card renders a PUBLISHED
// page, where a reader's screen reader needs <strong>/<em> and nobody round-trips the DOM.
//
// What must never differ is the GRAMMAR — which spans of text are bold, italic, code. If tile
// changes that (or if someone "improves" the Card's regexes), these tests fail here instead of the
// two dialects drifting apart the way `esc`/`mdInline` already had. That drift is the debt this
// file exists to stop recurring, so the check is about agreement, not about identical output.
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderInlineMd, escHtml } from '../cssmd/cssmd.js';
import { __mdInline as mdInline, __esc as esc } from './card-render.mjs';

/** Which substrings a renderer marked as bold / italic / code, whichever markup it used.
 *  🔴 Drop cssmd's hidden marker spans FIRST. Leaving them in makes the effect span's content
 *  nested, so a lazy `([\s\S]*?)</span>` stops at the inner `</span>` and yields `bold**` — which
 *  reads exactly like the two renderers disagreeing when they agree perfectly. The first run of
 *  this test "failed"; the renderers were fine and the ruler was not. */
function marks(html) {
  const flat = html.replace(/<span class="[a-z]+-mk">[^<]*<\/span>/g, '');
  const grab = (re) => Array.from(flat.matchAll(re)).map((m) => m[1].replace(/<[^>]+>/g, ''));
  return {
    bold: [...grab(/<strong>([\s\S]*?)<\/strong>/g), ...grab(/<span class="\w+-b">([\s\S]*?)<\/span>/g)],
    italic: [...grab(/<em>([\s\S]*?)<\/em>/g), ...grab(/<span class="\w+-i">([\s\S]*?)<\/span>/g)],
    code: [...grab(/<code>([\s\S]*?)<\/code>/g), ...grab(/<span class="\w+-code">([\s\S]*?)<\/span>/g)],
  };
}

const SAMPLES = [
  'plain words',
  '**bold** in the middle',
  'an *italic* word',
  '**two** bold **runs**',
  'mixed **bold** and *italic* together',
  'nothing *unclosed here',
];

test('grammar agrees with tile: the same spans are bold and italic in both dialects', () => {
  for (const src of SAMPLES) {
    const ours = marks(mdInline(src));
    const theirs = marks(renderInlineMd(src, { prefix: 'ct' }));
    assert.deepEqual(ours.bold, theirs.bold, `bold disagrees on: ${src}`);
    assert.deepEqual(ours.italic, theirs.italic, `italic disagrees on: ${src}`);
  }
});

test('the Card publishes semantics, not classes — <strong>/<em>, no marker spans', () => {
  const html = mdInline('**b** and *i*');
  assert.match(html, /<strong>b<\/strong>/);
  assert.match(html, /<em>i<\/em>/);
  assert.ok(!html.includes('-mk'), 'raw markers must not reach a published card');
});

test('links are the Card\'s documented superset — cssmd has none yet (upstream ask)', () => {
  const src = 'see [my shop](https://example.com/x)';
  assert.match(mdInline(src), /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer">my shop<\/a>/);
  assert.ok(!renderInlineMd(src, { prefix: 'ct' }).includes('<a '), 'cssmd gained links — adopt it and delete the superset');
});

test('escaping is tile\'s escHtml plus the quote an attribute needs', () => {
  const nasty = '<img src=x onerror=alert(1)> & "quoted"';
  assert.equal(esc(nasty), escHtml(nasty).replace(/"/g, '&quot;'));
  assert.ok(!esc(nasty).includes('<'), 'angle brackets escaped');
  assert.ok(!esc(nasty).includes('"'), 'quotes escaped — this is what makes it safe in an attribute');
});

// CONTROL: the agreement test must be able to disagree. A grammar check that passes on renderers
// which genuinely differ would be measuring nothing.
test('CONTROL: the grammar check fires when the dialects really do differ', () => {
  const bent = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<em>$1</em>');   // bold read as italic
  const src = '**bold**';
  assert.notDeepEqual(marks(bent(src)).bold, marks(renderInlineMd(src, { prefix: 'ct' })).bold);
});
