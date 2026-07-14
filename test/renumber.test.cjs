// Unit test for renumberLists — re-sequence ordered-list blocks (pure logic, no DOM).
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) { const i = src.indexOf('function ' + name); const end = src.indexOf('\n}', i); return src.slice(i, end + 2); }
eval(grab('renumberLists'));

let pass = 0, fail = 0;
function t(label, input, expected) {
  const got = renumberLists(input);
  if (got === expected) { pass++; }
  else { fail++; console.log(`FAIL ${label}\n  in : ${JSON.stringify(input)}\n  exp: ${JSON.stringify(expected)}\n  got: ${JSON.stringify(got)}`); }
}

// The reported case: delete an item, the rest re-sequence
t('gap closes', '1. a\n3. c', '1. a\n2. c');
// Already sequential → returns the SAME string (identity no-op so callers can skip)
const ok = '1. a\n2. b\n3. c'; if (renumberLists(ok) === ok) pass++; else { fail++; console.log('FAIL identity no-op'); }
// All "1." → 1,2,3
t('all ones', '1. a\n1. b\n1. c', '1. a\n2. b\n3. c');
// Paren delimiter preserved
t('paren', '1) a\n3) c', '1) a\n2) c');
// Blank line ends a block → next run restarts at 1
t('blank resets', '1. a\n2. b\n\n5. x\n9. y', '1. a\n2. b\n\n1. x\n2. y');
// Non-ordered line ends a block too
t('text resets', '1. a\nfoo\n5. b', '1. a\nfoo\n1. b');
// Indented / nested ordered lists are left alone
t('nested untouched', '  1. a\n  3. b', '  1. a\n  3. b');
// A nested ordered item between two top-level items must NOT reset the top-level sequence.
// (Markdown renderers count top-level items independently of nested ones.)
t('nested does not break top-level seq (tab)',
  '1. first\n\t1. nested\n2. second\n3. third',
  '1. first\n\t1. nested\n2. second\n3. third');
t('nested renumbers top-level after gap, nested left alone',
  '1. a\n   5. nested\n5. b\n9. c',
  '1. a\n   5. nested\n2. b\n3. c');
// An indented (non-list) continuation line is part of the item → does not reset the counter either.
t('indented continuation keeps seq',
  '1. a\n   wrapped text\n5. b',
  '1. a\n   wrapped text\n2. b');
// Content after the marker is preserved verbatim
t('content kept', '7. apple pie\n9. banana split', '1. apple pie\n2. banana split');
// CJK content
t('cjk', '3. 待辦\n7. 完成', '1. 待辦\n2. 完成');
// Double-digit renumber (width change is fine for the pure fn; caret drift is the caller's edge case)
t('two digit down', Array.from({length: 11}, (_, i) => (i + 2) + '. item').join('\n'),
  Array.from({length: 11}, (_, i) => (i + 1) + '. item').join('\n'));
// Empty input
t('empty', '', '');

console.log(fail ? `\n${fail} failed, ${pass} passed` : `all ${pass} renumber cases pass`);
process.exit(fail ? 1 : 0);
