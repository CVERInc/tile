// Unit test for the inline-mark toggle. Pure logic, no DOM.
// The defect: wrap() only ever inserted. Selecting **bold** and pressing B gave ****bold****; selecting
// *italic* and pressing I gave **italic** — the italic button silently produced BOLD.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found: ' + name);
  let depth = 0, started = false;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
let pass = 0, fail = 0;
eval(grab('wrapState'));
eval(grab('toggleWrap'));

// wrapState is what a menu asks so it can say "取消粗體" instead of "粗體". Assert it directly, not only
// through toggleWrap — a caller that only ever reads the toggled TEXT cannot tell 'outer' from 'inner'.
{
  const cases = [
    ['**bold**', 2, 6, ['**', '**'], 'outer'],
    ['**bold**', 0, 8, ['**', '**'], 'inner'],
    ['**bold**', 2, 6, ['*', '*'], null],      // the star guard: this is bold, not italic
    ['*x*', 1, 2, ['*', '*'], 'outer'],
    ['plain', 0, 5, ['**', '**'], null],
    ['[[Page]]', 2, 6, ['[[', ']]'], 'outer'],
  ];
  for (const [v, s, e, [pre, post], want] of cases) {
    const got = wrapState(v, s, e, pre, post);
    if (got === want) pass++;
    else { fail++; console.log(`FAIL wrapState(${JSON.stringify(v)}, ${s}, ${e}, '${pre}') → ${got}, want ${want}`); }
  }
}

// The selection is marked by a │…│ pair in both input and expected (a bare caret is one │).
function t(label, mark, input, expected) {
  const a = input.indexOf('│'), b = input.indexOf('│', a + 1);
  const v = input.replace(/│/g, '');
  const s = a, e = (b === -1 ? a : b - 1);
  const [pre, post] = mark;
  const r = toggleWrap(v, s, e, pre, post);
  const got = r.start === r.end
    ? r.text.slice(0, r.start) + '│' + r.text.slice(r.start)
    : r.text.slice(0, r.start) + '│' + r.text.slice(r.start, r.end) + '│' + r.text.slice(r.end);
  if (got === expected) pass++;
  else { fail++; console.log(`FAIL ${label}\n  in : ${JSON.stringify(input)}\n  exp: ${JSON.stringify(expected)}\n  got: ${JSON.stringify(got)}`); }
}
const B = ['**', '**'], I = ['*', '*'], S = ['~~', '~~'], C = ['`', '`'], L = ['[[', ']]'];

// ── adding, which is all it used to do ─────────────────────────────────────────────────────────────
t('bold a plain selection', B, 'a │word│ b', 'a **│word│** b');
t('bold a bare caret still inserts the pair', B, 'a │ b', 'a **│** b');
t('CJK selection', B, '這是│重點│喔', '這是**│重點│**喔');

// ── the defect: removing ──────────────────────────────────────────────────────────────────────────
// Double-clicking a word inside **word** selects the bare word — the markers sit just OUTSIDE it.
t('un-bold from outside (the double-click case)', B, '**│bold│**', '│bold│');
t('un-bold from inside (markers dragged over too)', B, '│**bold**│', '│bold│');
t('un-italic from outside', I, '*│x│*', '│x│');
t('un-italic from inside', I, '│*x*│', '│x│');
t('un-strike', S, '~~│x│~~', '│x│');
t('un-code', C, '`│x│`', '│x│');
t('un-link', L, '[[│Page│]]', '│Page│');
t('a collapsed caret between an empty pair removes it', B, '**│**', '│');

// ── the star overlap: bold and italic are spelled with the same character ──────────────────────────
// Pressing I on bold text must ADD italic, not steal one of bold's stars.
t('italic inside bold adds, not steals', I, '**│bold│**', '***│bold│***');
t('italic over the whole bold run adds', I, '│**bold**│', '*│**bold**│*');
t('bold over a bold run still removes', B, '│**bold**│', '│bold│');
t('bold inside italic adds', B, '*│x│*', '***│x│***');
t('un-italic when the neighbour star belongs to a DIFFERENT run', I, 'a*b* *│c│* d', 'a*b* │c│ d');
t('bold-italic: pressing B on ***x*** removes only the bold pair', B, '***│x│***', '*│x│*');
// ASYMMETRIC on purpose: a symmetric fixture cannot tell "checks both sides" from "checks one side", and a
// mutation that dropped half the guard sailed through the tests above.
t('one solo star, one in a run — left', I, '*│x│**', '**│x│***');
t('one solo star, one in a run — right', I, '**│x│*', '***│x│**');

// ── things that must not be mistaken for a mark ────────────────────────────────────────────────────
t('a lone star on one side is not a pair', I, 'a *│b│ c', 'a **│b│* c');
t('mismatched marks are not a pair', B, '**│x│~~', '****│x│**~~');
t('a selection shorter than the two marks cannot be an inside-match', B, '│**│', '**│**│**');

console.log(`toggle-wrap: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
