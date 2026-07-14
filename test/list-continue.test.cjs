// Unit test for smart-Enter list continuation (pure logic, no DOM).
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) { const i = src.indexOf('function ' + name); const end = src.indexOf('\n}', i); return src.slice(i, end + 2); }
eval(grab('listContinuation'));

let pass = 0, fail = 0;
// caret marked by │ in the input; expected output marked the same way
function t(label, input, expected) {
  const s = input.indexOf('│');
  const v = input.replace('│', '');
  const res = listContinuation(v, s);
  let got;
  if (res === null) got = '<null>';
  else got = res.text.slice(0, res.caret) + '│' + res.text.slice(res.caret);
  if (got === expected) { pass++; }
  else { fail++; console.log(`FAIL ${label}\n  in : ${JSON.stringify(input)}\n  exp: ${JSON.stringify(expected)}\n  got: ${JSON.stringify(got)}`); }
}

// Unordered: continue with same marker
t('dash continue', '- apple│', '- apple\n- │');
t('star continue', '* apple│', '* apple\n* │');
// Ordered: increment
t('ordered continue', '1. first│', '1. first\n2. │');
t('ordered paren', '3) third│', '3) third\n4) │');
// Checkbox: continue UNCHECKED regardless of current state
t('task continue from unchecked', '- [ ] todo│', '- [ ] todo\n- [ ] │');
t('task continue from checked', '- [x] done│', '- [x] done\n- [ ] │');
// Indented list keeps indent
t('indented continue', '  - nested│', '  - nested\n  - │');
// Empty item exits the list (marker removed, blank line)
t('empty dash exits', '- │', '│');
t('empty task exits', '- [ ] │', '│');
t('empty ordered exits', '1. │', '│');
// Non-list line → null (native newline)
t('plain line null', 'hello│', '<null>');
t('heading null', '## title│', '<null>');
// Mid-line Enter splits and continues
t('split mid item', '- one│two', '- one\n- │two');
// CJK content
t('cjk task', '- [ ] 待辦│', '- [ ] 待辦\n- [ ] │');
// Empty item preceded by other text on prior lines, exit keeps prior lines
t('exit keeps prior', 'a\n- │', 'a\n│');

console.log(fail ? `\n${fail} failed, ${pass} passed` : `all ${pass} list-continue cases pass`);
process.exit(fail ? 1 : 0);
