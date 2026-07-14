// Unit test for Tab / Shift+Tab in the editor (pure logic, no DOM).
// Tab inserts a literal tab at the caret; Shift+Tab removes one tab right before a collapsed caret.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) { const i = src.indexOf('function ' + name); const end = src.indexOf('\n}', i); return src.slice(i, end + 2); }
eval(grab('tabEdit'));

let pass = 0, fail = 0;
// caret(s) marked by │ in input/expected; selection = two │ markers. \t shown literally in the strings.
function t(label, input, outdent, expected) {
  const first = input.indexOf('│');
  const last = input.lastIndexOf('│');
  const s = first;
  const e = last === first ? first : last - 1;   // second marker sits one char right after removal of the first
  const v = input.replace(/│/g, '');
  const res = tabEdit(v, s, e, outdent);
  let got;
  if (res === null) got = '<null>';
  else got = res.text.slice(0, res.caret) + '│' + res.text.slice(res.caret);
  if (got === expected) pass++;
  else { fail++; console.log('  ✗', label, '— got', JSON.stringify(got), 'want', JSON.stringify(expected)); }
}

// --- Tab: insert a literal tab at the caret ---
t('insert at start', '│abc', false, '\t│abc');
t('insert mid-line', 'ab│c', false, 'ab\t│c');
t('insert replaces selection', 'a│bc│d', false, 'a\t│d');   // 'bc' selected → replaced by a tab
t('insert at end', 'abc│', false, 'abc\t│');

// --- Shift+Tab: remove one tab immediately before the caret ---
t('outdent removes preceding tab', '\t│abc', true, '│abc');
t('outdent only one level', '\t\t│x', true, '\t│x');
t('outdent no tab before caret → null', 'ab│c', true, '<null>');
t('outdent with a selection → null (collapsed only)', 'a│b│c', true, '<null>');
t('outdent at start of text → null', '│abc', true, '<null>');

console.log(fail ? (fail + ' failed') : 'all tab-edit assertions pass (' + pass + ')');
process.exit(fail ? 1 : 0);
