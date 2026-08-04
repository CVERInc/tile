// Structural whitespace is SPACE and TAB, and nothing else.
//
// CommonMark defines every block marker in terms of spaces and tabs. JS `\s` is far wider, and the
// member that matters is U+00A0 NO-BREAK SPACE — which arrives constantly in text pasted from the
// web, Word or Pages. With `\s`, this engine read `-<NBSP>item` as a bullet, wrapped the marker in a
// `tg-mk` span, and Rendered then HID a character the author had actually typed, while every other
// tool showed that line as a paragraph. An editor that quietly disagrees with the file is worse than
// one that renders plainly.
//
// 🩸 When the fix landed, the whole suite stayed green and not one of the 68 parity goldens moved —
// because the corpus contained no NBSP at all. Green meant "never exercised", not "correct". This
// file is that missing exercise; every expectation below was taken from the reference `commonmark`
// package, not from this engine's output.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'editor-core.js'), 'utf8');
const cssmdSrc = fs.readFileSync(path.join(ROOT, 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '')
  .replace(/^function escHtml\(s\)[\s\S]*?\n\}\n/m, '');
const L = coreSrc.split('\n');
const s0 = L.findIndex((l) => l.startsWith('function highlightLineParts'));
let e0 = s0; for (let i = s0 + 1; i < L.length; i++) if (L[i] === '}') { e0 = i; break; }
const highlightLineParts = new Function(
  L.find((l) => l.startsWith('function escHtml')) + '\n' + cssmdSrc + '\n' +
  L.slice(s0, e0 + 1).join('\n') + '\nreturn highlightLineParts;')();
const blockScan = new Function(/const FENCE = \/.*?\/;/s.exec(coreSrc)[0] + '\n' +
  /function blockScan\(lines\) \{[\s\S]*?\n\}/.exec(coreSrc)[0] + '\nreturn blockScan;')();

const NB = ' ';
let pass = 0, fail = 0;
const check = (why, fn) => {
  try { fn(); console.log('PASS ' + why); pass++; }
  catch (e) { fail++; console.error('FAIL ' + why + '\n  ' + e.message); }
};

// The text must survive whatever the classifier decides — that is true of every line, but it is the
// whole point on a line whose marker turned out not to be a marker.
const textOf = (html) => html.replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// `line` must NOT be read as `cls`, and no part of it may be wrapped as a hidden marker.
function notStructural(line, cls, why) {
  check(why, () => {
    const r = highlightLineParts(line);
    assert.ok(!new RegExp('\\b' + cls + '\\b').test(r.cls), `classified as ${cls}: ${r.cls}`);
    assert.ok(!/class="tg-mk"/.test(r.inner), `a marker was hidden: ${r.inner}`);
    assert.strictEqual(textOf(r.inner), line, 'round trip');
  });
}
// …and the control: the same line with a real space IS that construct.
function isStructural(line, cls, why) {
  check(why, () => {
    const r = highlightLineParts(line);
    assert.ok(new RegExp('\\b' + cls + '\\b').test(r.cls), `NOT classified as ${cls}: ${r.cls}`);
    assert.strictEqual(textOf(r.inner), line, 'round trip');
  });
}

// ── a marker followed by NBSP is not a marker ───────────────────────────────────────────────────
notStructural('-' + NB + 'item', 'tg-li', 'NBSP after a bullet: not a list item');
isStructural('- item', 'tg-li', 'control — a real space after a bullet IS a list item');
isStructural('\t- item', 'tg-li', 'control — a tab indent still works');

notStructural('1.' + NB + 'item', 'tg-ol', 'NBSP after an ordered marker: not a list item');
isStructural('1. item', 'tg-ol', 'control — ordered list');

notStructural('#' + NB + 'heading', 'tg-h', 'NBSP after a hash run: not a heading');
isStructural('# heading', 'tg-h1', 'control — heading');

notStructural('---' + NB, 'tg-hr', 'NBSP after a thematic break: not a break');
isStructural('---', 'tg-hr', 'control — thematic break');

// Leading NBSP is not indentation, so what follows is not indented markdown either.
notStructural(NB + '- item', 'tg-li', 'NBSP indent: not a list item');

// ── U+3000, which a CJK IME produces every time the user is in full-width mode ───────────────────
// This repo is CJK-friendly on purpose, so this is the instance of the rule most likely to be met in
// practice — and it is a VISIBLE change: `-　項目` used to render as a bullet here. It never did in
// Obsidian, GitHub, or any other renderer, and the reference confirms `<p>-　項目</p>`. Showing a
// list where the file does not have one is the editor lying about the document.
const FW = '　';
notStructural('-' + FW + '項目', 'tg-li', 'U+3000 after a bullet: not a list item');
notStructural('#' + FW + '標題', 'tg-h', 'U+3000 after a hash run: not a heading');
isStructural('- 項目', 'tg-li', 'control — a half-width space still makes a list item');

// ── the one exception ───────────────────────────────────────────────────────────────────────────
// `>` IS the blockquote marker; the space after it is optional, so NBSP simply becomes content.
// Confirmed against the reference: `><NBSP>quote` is a blockquote.
check('NBSP after > is still a blockquote — the > is the whole marker', () => {
  const r = highlightLineParts('>' + NB + 'quote');
  assert.ok(/\btg-quote\b/.test(r.cls), 'not classified as a quote: ' + r.cls);
  assert.strictEqual(textOf(r.inner), '>' + NB + 'quote', 'round trip');
});

// ── a list item that is not a task ──────────────────────────────────────────────────────────────
// Reference: `- [ ]<NBSP>task` is a list item whose content is the literal text `[ ] task`.
check('NBSP after a checkbox: a list item, but not a task', () => {
  const r = highlightLineParts('- [ ]' + NB + 'task');
  assert.ok(/\btg-li\b/.test(r.cls), 'should still be a list item: ' + r.cls);
  assert.ok(!/\btg-task\b/.test(r.cls), 'should NOT be a task: ' + r.cls);
  assert.strictEqual(textOf(r.inner), '- [ ]' + NB + 'task', 'round trip');
});

// ── blockScan asks the same question about a sequence ───────────────────────────────────────────
check('an NBSP-indented fence does not open a code block', () => {
  assert.deepStrictEqual(blockScan([NB + '```', 'not code', '```'].map(String)),
    [null, null, 'cfence']);
});
check('control — a space-indented fence still opens one', () => {
  assert.deepStrictEqual(blockScan(['   ```', 'code', '   ```']), ['cfence', 'cblock', 'cfence']);
});
check('NBSP after a frontmatter --- does not close it', () => {
  // The opener is fine; the candidate closer carries an NBSP, so the block runs on to the real one.
  assert.deepStrictEqual(blockScan(['---', 'a: 1', '---' + NB, '---', 'body']),
    ['fmfence', 'fm', 'fm', 'fmfence', null]);
});

console.log(fail ? `\n✗ whitespace: ${pass} passed, ${fail} failed` : `\n✅ whitespace all pass (${pass})`);
process.exit(fail ? 1 : 0);
