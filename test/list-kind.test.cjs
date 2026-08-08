// Unit test for the list-marker family (bullet / number / check are ONE axis, not three prefixes).
// Pure logic, no DOM. The defect this locks down: the old togglePre() only recognised its own prefix, so
// 編號 on "- foo" produced "1. - foo" and 列點 on "- [ ] foo" produced "[ ] foo".
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) { const i = src.indexOf('function ' + name); const end = src.indexOf('\n}', i); return src.slice(i, end + 2); }
eval(grab('listMarker'));
eval(grab('setListKind'));

let pass = 0, fail = 0;
// Caret marked by │ in both input and expected. A SELECTION is marked by a second │.
function t(label, kind, input, expected) {
  const a = input.indexOf('│');
  const b = input.indexOf('│', a + 1);
  const v = input.replace(/│/g, '');
  const s = a, e = (b === -1 ? a : b - 1);
  const r = setListKind(v, s, e, kind);
  const got = (r.start === r.end)
    ? r.text.slice(0, r.start) + '│' + r.text.slice(r.start)
    : r.text.slice(0, r.start) + '│' + r.text.slice(r.start, r.end) + '│' + r.text.slice(r.end);
  if (got === expected) pass++;
  else { fail++; console.log(`FAIL ${label}\n  in : ${JSON.stringify(input)}\n  exp: ${JSON.stringify(expected)}\n  got: ${JSON.stringify(got)}`); }
}

// ── the four defects, each stated as the behaviour it should have had ──────────────────────────────
t('number over bullet REPLACES', 'number', '- foo│', '1. foo│');
t('bullet over number REPLACES', 'bullet', '1. foo│', '- foo│');
t('check over bullet REPLACES', 'check', '- foo│', '- [ ] foo│');
t('bullet over check REPLACES', 'bullet', '- [ ] foo│', '- foo│');

// ── toggling off: same kind pressed twice removes the marker ───────────────────────────────────────
t('bullet off', 'bullet', '- foo│', 'foo│');
t('number off', 'number', '1. foo│', 'foo│');
// …including when the digits are out of sequence — it is still an ordered list, so the button still means
// "off". Sequence is not this button's job: renumberLists() fixes 7/9 → 1/2 on idle, without being asked.
t('number off even when misnumbered', 'number', '│7. a\n9. b│', '│a\nb│');
t('check off (unchecked)', 'check', '- [ ] foo│', 'foo│');
t('check off (checked)', 'check', '- [x] foo│', 'foo│');
t('plain line gets a marker', 'bullet', 'foo│', '- foo│');

// ── indentation survives, in both directions ───────────────────────────────────────────────────────
t('indented switch keeps indent', 'number', '  - foo│', '  1. foo│');
t('indented toggle-off keeps indent', 'bullet', '\t- foo│', '\tfoo│');
t('indented plain line', 'bullet', '  foo│', '  - foo│');

// ── the author's bullet character is preserved across bullet ↔ check ───────────────────────────────
t('star list stays a star list', 'check', '* foo│', '* [ ] foo│');
t('plus list stays a plus list', 'bullet', '+ [ ] foo│', '+ foo│');
t('ordered with ) delimiter is recognised', 'bullet', '3) foo│', '- foo│');

// ── multi-line selections ──────────────────────────────────────────────────────────────────────────
t('mixed block all become numbered', 'number', '│- a\n1. b\nc│', '│1. a\n2. b\n3. c│');
t('uniform block toggles off', 'bullet', '│- a\n- b│', '│a\nb│');
t('mixed block does NOT toggle off', 'bullet', '│- a\nb│', '│- a\n- b│');
t('blank lines are left alone', 'bullet', '│a\n\nb│', '│- a\n\n- b│');
t('converting INTO numbers renumbers 1..N', 'number', '│7. a\nb│', '│1. a\n2. b│');

// ── caret arithmetic on the collapsed path ─────────────────────────────────────────────────────────
t('caret rides a widening marker', 'check', '- fo│o', '- [ ] fo│o');
t('caret rides a shrinking marker', 'bullet', '- [ ] fo│o', '- fo│o');
t('caret clamps at the line start', 'bullet', '│- foo', '│foo');

// ── listMarker itself ──────────────────────────────────────────────────────────────────────────────
function m(label, line, expect) {
  const got = JSON.stringify(listMarker(line));
  if (got === JSON.stringify(expect)) pass++;
  else { fail++; console.log(`FAIL ${label}\n  exp: ${JSON.stringify(expect)}\n  got: ${got}`); }
}
m('no marker', 'foo', null);
m('a lone dash is not a list', '-foo', null);                       // markdown needs the space
m('setext/hr is not a list', '---', null);
m('bullet', '- a', { indent: '', kind: 'bullet', bullet: '-', len: 2 });
m('check', '- [x] a', { indent: '', kind: 'check', bullet: '-', len: 6 });
m('number', '12) a', { indent: '', kind: 'number', bullet: '-', len: 4 });
m('indent captured', '\t\t* a', { indent: '\t\t', kind: 'bullet', bullet: '*', len: 4 });

console.log(`list-kind: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
