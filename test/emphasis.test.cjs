// Emphasis nesting — the construct that rendered WRONG rather than plain, until 2026-08-04.
//
// The round-trip suite cannot see this class of defect: `**bold with *it* inside**` round-tripped
// perfectly while rendering entirely italic, because the TEXT was right and the MEANING was wrong.
// So the assertions here are on the STRUCTURE — which spans nest inside which — and the round trip
// is checked alongside rather than instead.
//
// Where these cases come from: scripts/emphasis-conformance.mjs runs the spec's own 132 Emphasis
// examples and reports 108 passing. That script needs the spec (network on a cold cache, CC-BY-SA
// against this repo's MIT), so it cannot be the gate. This file is the gate: the cases below were
// CHOSEN by running it, and the expected values for anything not literally in the spec were checked
// against the reference `commonmark` package, never against this implementation's own output.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '');
const { renderInlineMd, markEmphasis, escHtml } =
  new Function(src + '\nreturn { renderInlineMd, markEmphasis, escHtml };')();

let pass = 0, fail = 0;

// Collapse the rendered HTML to just its emphasis skeleton: <B>/<I> for the effect spans, markers
// dropped. What survives is exactly the question this file asks — what nests inside what.
function shape(html) {
  return html
    .replace(/<span class="tg-mk">.*?<\/span>/g, '')
    .replace(/<span class="tg-b">/g, '<B>')
    .replace(/<span class="tg-i">/g, '<I>')
    .replace(/<span class="[^"]*">/g, '<?>')
    .replace(/<\/span>/g, '>');
}
const textOf = (html) => html.replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Every case asserts BOTH: not one character was spent, and the structure is right. The round trip
// is checked FIRST because it is the load-bearing guarantee — if the characters are gone, what the
// spans say about them does not matter.
//
// Note what `shape` does to an escape: `markEscapes` hides the backslash in a marker span, so `\*`
// shapes to a bare `*`. That is the rendered truth (the reader sees an asterisk, not a backslash);
// the backslash is still in the text, which is what the round-trip line proves.
function eq(input, want, why) {
  const html = renderInlineMd(input);
  const got = shape(html);
  try {
    assert.strictEqual(textOf(html), input, `${why} — ROUND TRIP BROKEN\n  in  ${JSON.stringify(input)}\n  out ${JSON.stringify(textOf(html))}`);
    assert.strictEqual(got, want, `${why}\n  in   ${JSON.stringify(input)}\n  got  ${got}\n  want ${want}`);
    console.log('PASS ' + why);
    pass++;
  } catch (e) { fail++; console.error('FAIL ' + e.message); }
}

// ── the four rows of the defect table in packages/core/MARKDOWN.md ──────────────────────────────
// Each of these had a WRONG rendering, not a missing one, on every surface including the two
// published Obsidian plugins.
eq('**bold with *it* inside**', '<B>bold with <I>it> inside>', 'italic nested inside bold (was: all italic, bold lost)');
eq('*it with **bold** inside*', '<I>it with <B>bold> inside>', 'bold nested inside italic (was: two separate italics)');
eq('***both***', '<I><B>both>>', 'three delimiters are em wrapping strong (was: bold only)');
eq('*a**b**c*', '<I>a<B>b>c>', 'italic containing bold (was: three italics)');

// ── the spec's own answers for runs that do NOT nest the obvious way ────────────────────────────
eq('**a****b**', '<B>a****b>', 'the rule of 3 refuses the middle run — one bold, four literal asterisks');
eq('**foo **bar****', '<B>foo <B>bar>>', 'spec example 427 — strong inside strong');
eq('****foo****', '<B><B>foo>>', 'spec example 464');
eq('****foo*', '***<I>foo>', 'spec example 445 — the leftovers stay literal');
eq('*foo****', '<I>foo>***', 'spec example 447');
eq('**** is not an empty strong emphasis', '**** is not an empty strong emphasis', 'spec example 421 — a run cannot match itself');
eq('foo *****', 'foo *****', 'spec example 439');

// ── underscores, and the intraword rule that a live page once lost ──────────────────────────────
eq('_italic_ and __bold__', '<I>italic> and <B>bold>', 'underscore emphasis still works');
eq('snake_case_name', 'snake_case_name', 'INTRAWORD: an identifier is not emphasis');
eq('a_b_c and file_name_here', 'a_b_c and file_name_here', 'INTRAWORD: still literal in running prose');
eq('foo_bar_ baz', 'foo_bar_ baz', 'INTRAWORD: an opener that cannot open leaves the closer stranded');
eq('*intra*word works with asterisks', '<I>intra>word works with asterisks', 'asterisks DO work intraword — the asymmetry is deliberate');

// ── escapes: the delimiters an author asked to be left alone ────────────────────────────────────
eq('\\*not italic\\*', '*not italic*', 'an escaped delimiter never opens');
eq('\\**bold*', '*<I>bold>', 'the first asterisk is escaped; the rest is real emphasis');
// 🩸 The old regex declined this one and said so in a comment: its lookbehind could not tell an
// escaped BACKSLASH from an escaped delimiter. The tokeniser counts backslashes instead of peering
// behind one, so the limit is gone. `\\` renders as one backslash and the emphasis is real —
// verified against the reference `commonmark` package, which gives `\<em>a</em>`.
eq('\\\\*a*', '\\<I>a>', 'an escaped BACKSLASH, then real emphasis');
eq('C:\\path\\to and \\n stay literal', 'C:\\path\\to and \\n stay literal', 'a backslash before a non-escapable char is just a backslash');

// ── what must NOT become emphasis ───────────────────────────────────────────────────────────────
eq('a * b * c', 'a * b * c', 'delimiters surrounded by space open nothing');
eq('2 * 3 * 4 = 24', '2 * 3 * 4 = 24', 'arithmetic is not emphasis');
eq('*unclosed and on we go', '*unclosed and on we go', 'an opener with no closer is literal text');
eq('closing only*', 'closing only*', 'a closer with no opener is literal text');

// ── CJK, which has neither the whitespace nor the punctuation the flanking rules lean on ────────
eq('*斜體*和**粗體**', '<I>斜體>和<B>粗體>', 'CJK emphasis with no spaces around it');
eq('**這句話變得*更強*，不是更弱**', '<B>這句話變得<I>更強>，不是更弱>',
   'the sentence from his own corpus that rendered entirely italic');

// ── the opaque-element rule: markEmphasis runs AFTER the block markers are wrapped ───────────────
// editor-core.js hands this pass text that already contains spans. An asterisk bullet's own `*` sits
// inside one of them, and if it were treated as a delimiter it could pair with real emphasis further
// along — emitting a span that opens inside the marker and closes outside it. That is not a styling
// bug, it is malformed nesting, so it is asserted here rather than left to the eye.
// Asserted on the RAW html, not the shape: `shape` drops marker spans whole, which would throw away
// the very evidence this case is about — whether the bullet's marker span came through untouched.
{
  const bullet = '<span class="tg-mk">* </span>' + escHtml('*italic* here');
  const got = markEmphasis(bullet, 'tg');
  const why = 'a bullet asterisk cannot pair with emphasis later on the line';
  try {
    assert.strictEqual(got,
      '<span class="tg-mk">* </span><span class="tg-i"><span class="tg-mk">*</span>italic<span class="tg-mk">*</span></span> here',
      why + '\n  got  ' + got);
    console.log('PASS ' + why); pass++;
  } catch (e) { fail++; console.error('FAIL ' + e.message); }
}
{
  const hr = markEmphasis('<span class="tg-mk">***</span>', 'tg');
  const why = 'a thematic break already wrapped as a marker is left alone';
  try {
    assert.strictEqual(hr, '<span class="tg-mk">***</span>', why + '\n  got  ' + hr);
    console.log('PASS ' + why); pass++;
  } catch (e) { fail++; console.error('FAIL ' + e.message); }
}

// ── precedence: constructs that bind tighter than emphasis ──────────────────────────────────────
// A code span's content is literal by definition, so a delimiter inside one is a character. This
// only works because `markCode` runs BEFORE `markEmphasis` and the tokeniser treats the finished
// span as opaque — the reorder IS the mechanism, so these cases guard the order, not just the output.
eq('*a `*` b*', '<I>a <?>*> b>', 'an asterisk inside a code span is not a delimiter');
// Escapes are literal in there too — CommonMark does not run them inside a code span. The shape to
// watch is that `shape()` DROPS marker spans, so a hidden backslash vanishes from the expectation
// while a literal one stays: that asymmetry is exactly what these two lines measure.
eq('`/^- \\[(.)\\]/`', '<?>/^- \\[(.)\\]/>', 'backslashes inside a code span stay visible');
eq('a \\[b\\] c', 'a [b] c', 'control — outside a code span the backslash still hides');
eq('`**a**`', '<?>**a**>', 'a code span holds the syntax it documents, unrendered');
eq('*a `b` c*', '<I>a <?>b> c>', 'emphasis still spans ACROSS a code span');

// The autolink pass lives in editor-core, not cssmd, so this one case is asserted against the real
// highlightLineParts. Without it the `**` in a URL query string would find a partner and the line
// would render bold from the `**` to the end.
{
  const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
  const inlined = fs.readFileSync(path.join(__dirname, '..', 'packages', 'cssmd', 'cssmd.js'), 'utf8')
    .replace(/export\s*\{[\s\S]*?\};?\s*$/, '').replace(/^function escHtml\(s\)[\s\S]*?\n\}\n/m, '');
  const L = coreSrc.split('\n');
  const s0 = L.findIndex((l) => l.startsWith('function highlightLineParts'));
  let e0 = s0; for (let i = s0 + 1; i < L.length; i++) if (L[i] === '}') { e0 = i; break; }
  const hlp = new Function(L.find((l) => l.startsWith('function escHtml')) + '\n' + inlined + '\n' +
    L.slice(s0, e0 + 1).join('\n') + '\nreturn highlightLineParts;')();
  const why = 'a `**` inside an <autolink> URL finds no partner';
  const html = hlp('**a<https://foo.bar/?q=**>').inner;
  try {
    assert.ok(!/class="tg-b"/.test(html), why + '\n  got  ' + html);
    assert.strictEqual(textOf(html), '**a<https://foo.bar/?q=**>', why + ' — ROUND TRIP BROKEN\n  out ' + textOf(html));
    console.log('PASS ' + why); pass++;
  } catch (e) { fail++; console.error('FAIL ' + e.message); }
}

console.log(fail ? `\n✗ emphasis: ${pass} passed, ${fail} failed` : `\n✅ emphasis all pass (${pass})`);
process.exit(fail ? 1 : 0);
