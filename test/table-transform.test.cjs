// Unit tests for the whole-block table transforms (sort / move column / move row). Pure logic, no DOM.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
// Brace-counting, not indexOf('\n}') — charWidth/dispWidth are ONE-LINERS, and the naive grabber swallowed
// everything down to the next line that happens to start with '}', dragging half the file in with it.
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
function grabConst(name) { const m = new RegExp('^const ' + name + ' = (.*);$', 'm').exec(src); if (!m) throw new Error('not found: ' + name); return 'globalThis.' + name + ' = ' + m[1] + ';'; }
// eval() must run at THIS scope, not inside a forEach callback — a function declared inside the callback is
// scoped to the callback and vanishes. So: assemble one program, eval it once, here.
function grabArray(n) { const i = src.indexOf('const ' + n + ' = ['); const end = src.indexOf('\n];', i); return 'globalThis.' + n + ' = ' + src.slice(i + ('const ' + n + ' = ').length, end + 2) + ';'; }
eval([
  grabArray('WIDE'),
  ...['splitRow', 'isSepRow', 'isTableLine'].map(grabConst),
  ...['charWidth', 'dispWidth', 'formatBlock', 'tableCells', 'renderCells', 'tableCollator', 'cmpCells', 'sortTableBlock', 'moveTableColumn', 'moveTableRow'].map(grab),
].join('\n'));

let pass = 0, fail = 0;
const T = (lines) => lines.join('\n');
function t(label, got, expected) {
  const g = Array.isArray(got) ? T(got) : (got === null ? '<null>' : T(got.lines) + '  @' + got.index);
  const e = Array.isArray(expected) ? T(expected) : expected;
  if (g === e) pass++;
  else { fail++; console.log(`FAIL ${label}\n  exp:\n${e}\n  got:\n${g}`); }
}

// A deliberately ragged source, because that is what a hand-typed table looks like before anything aligns it.
const RAGGED = ['|name|qty|', '|---|---:|', '|pear|10|', '|apple|9|', '|fig|2|'];

// ── sort: numeric column sorts numerically, which is the whole point ───────────────────────────────
t('sort by number ascending', sortTableBlock(RAGGED, 1, false), [
  '| name  | qty |',
  '| ----- | --: |',
  '| fig   |   2 |',
  '| apple |   9 |',
  '| pear  |  10 |',
]);
t('sort by number descending', sortTableBlock(RAGGED, 1, true), [
  '| name  | qty |',
  '| ----- | --: |',
  '| pear  |  10 |',
  '| apple |   9 |',
  '| fig   |   2 |',
]);
t('sort by text', sortTableBlock(RAGGED, 0, false), [
  '| name  | qty |',
  '| ----- | --: |',
  '| apple |   9 |',
  '| fig   |   2 |',
  '| pear  |  10 |',
]);
// The separator keeps its alignment marker through every transform.
t('right-alignment survives the sort', [sortTableBlock(RAGGED, 0, false)[1]], ['| ----- | --: |']);

// ── sort: the properties that stop it being a footgun ──────────────────────────────────────────────
{
  const EMPTY = ['| a | b |', '| --- | --- |', '| x | 2 |', '| y |  |', '| z | 1 |'];
  const asc = sortTableBlock(EMPTY, 1, false), desc = sortTableBlock(EMPTY, 1, true);
  t('empty cells sink (ascending)', [asc[4]], ['| y   |     |']);
  t('empty cells sink (descending too)', [desc[4]], ['| y   |     |']);
}
{
  const once = sortTableBlock(RAGGED, 1, false);
  t('sorting an already-sorted column is a no-op', sortTableBlock(once, 1, false), once);
}
{
  // Stability: two rows with the same key keep their original order, so a second sort can't shuffle them.
  const TIE = ['| a | b |', '| --- | --- |', '| first | 1 |', '| second | 1 |'];
  const r = sortTableBlock(TIE, 1, false);
  t('ties keep their original order', [r[2], r[3]], ['| first  | 1   |', '| second | 1   |']);
}
{
  // The numeric branch has to justify its own existence. Intl.Collator's {numeric:true} already sorts bare
  // "9" before "10", so a fixture of bare integers CANNOT tell the two paths apart — the mutation that deleted
  // the numeric branch survived against exactly such a fixture. Thousands separators and a percent sign are
  // where the collator gives up and parseFloat does not: it reads "1,200" as 1-then-200 and files it under 1.
  const MONEY = ['| item | cost |', '| --- | --- |', '| a | 1,200 |', '| b | 900 |', '| c | 85 |'];
  t('numbers with separators sort by VALUE, not by their first digit', sortTableBlock(MONEY, 1, false), [
    '| item | cost  |',
    '| ---- | ----- |',
    '| c    | 85    |',
    '| b    | 900   |',
    '| a    | 1,200 |',
  ]);
  const PCT = ['| item | rate |', '| --- | --- |', '| a | 9% |', '| b | 10% |'];
  t('percentages too', sortTableBlock(PCT, 1, false), ['| item | rate |', '| ---- | ---- |', '| a    | 9%   |', '| b    | 10%  |']);
}
t('sort refuses a column that is not there', sortTableBlock(RAGGED, 9, false), '<null>');
t('sort refuses a non-table', sortTableBlock(['| a | b |', '| c | d |'], 0, false), '<null>');

// ── move column: the alignment marker travels with the column ──────────────────────────────────────
t('move column right', moveTableColumn(RAGGED, 0, +1), T([
  '| qty | name  |',
  '| --: | ----- |',
  '|  10 | pear  |',
  '|   9 | apple |',
  '|   2 | fig   |',
]) + '  @1');
t('move column left', moveTableColumn(RAGGED, 1, -1), T([
  '| qty | name  |',
  '| --: | ----- |',
  '|  10 | pear  |',
  '|   9 | apple |',
  '|   2 | fig   |',
]) + '  @0');
t('cannot move the first column further left', moveTableColumn(RAGGED, 0, -1), '<null>');
t('cannot move the last column further right', moveTableColumn(RAGGED, 1, +1), '<null>');

// ── move row: the header and the separator are not movable ─────────────────────────────────────────
t('move row down', moveTableRow(RAGGED, 2, +1), T([
  '| name  | qty |',
  '| ----- | --: |',
  '| apple |   9 |',
  '| pear  |  10 |',
  '| fig   |   2 |',
]) + '  @3');
t('move row up', moveTableRow(RAGGED, 4, -1), T([
  '| name  | qty |',
  '| ----- | --: |',
  '| pear  |  10 |',
  '| fig   |   2 |',
  '| apple |   9 |',
]) + '  @3');
t('the header does not move', moveTableRow(RAGGED, 0, +1), '<null>');
t('the separator does not move', moveTableRow(RAGGED, 1, +1), '<null>');
t('the first body row cannot go above the separator', moveTableRow(RAGGED, 2, -1), '<null>');
t('the last body row cannot go below the table', moveTableRow(RAGGED, 4, +1), '<null>');

// ── ragged input is repaired, not refused ──────────────────────────────────────────────────────────
{
  const SHORT = ['| a | b | c |', '| --- | --- |', '| 1 |', '| 2 | 3 | 4 |'];
  t('missing cells are filled, including in the separator', moveTableRow(SHORT, 3, -1).lines, [
    '| a   | b   | c   |',
    '| --- | --- | --- |',
    '| 2   | 3   | 4   |',
    '| 1   |     |     |',
  ]);
}

// ── CJK: the columns line up by DISPLAY width, so a mixed table stays a grid ───────────────────────
{
  const CJK = ['| 名稱 | 數量 |', '| --- | --- |', '| 蘋果 | 9 |', '| a | 10 |'];
  const out = moveTableRow(CJK, 3, -1).lines;
  const widths = out.map((l) => dispWidth(l));
  const same = widths.every((w) => w === widths[0]);
  if (same) pass++;
  else { fail++; console.log(`FAIL CJK rows are not the same display width: ${widths.join(',')}\n${T(out)}`); }
  // A code-point-length ruler would call these rows equal-length; a display-width ruler does not.
  const cpSame = out.every((l) => l.length === out[0].length);
  if (!cpSame) pass++;
  else { fail++; console.log('FAIL the CJK fixture cannot tell the two rulers apart — pick a different fixture'); }
}

// ── the no-Intl fallback, executed for real by passing a null collator ─────────────────────────────
{
  const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
  const cases = [
    ['apple', 'banana', -1, 'plain ascending'],
    ['banana', 'apple', 1, 'plain descending'],
    ['apple', 'apple', 0, 'equal'],
    ['Zebra', 'apple', 1, 'case-insensitive first, so Z does not beat a on its code point alone'],
    ['Apple', 'apple', -1, 'and only then the code point, so the order is still total'],
  ];
  for (const [x, y, want, why] of cases) {
    const got = sign(cmpCells(x, y, null));
    if (got === want) pass++;
    else { fail++; console.log(`FAIL fallback compare (${why}): cmpCells(${JSON.stringify(x)}, ${JSON.stringify(y)}, null) → ${got}, want ${want}`); }
  }
  // And the collator path must EARN its place: deleting it has to break something. Embedded digits are where
  // the two implementations genuinely disagree — the collator reads "item9" / "item10" as text-then-number,
  // the fallback compares them character by character and puts "item10" first.
  const coll = tableCollator();
  if (!coll) { fail++; console.log('FAIL this runtime has no Intl.Collator — the collator path went untested'); }
  else if (sign(cmpCells('item9', 'item10', coll)) === -1 && sign(cmpCells('item9', 'item10', null)) === 1) pass++;
  else { fail++; console.log(`FAIL the collator path is indistinguishable from the fallback here — it is not being tested (coll: ${cmpCells('item9', 'item10', coll)}, fallback: ${cmpCells('item9', 'item10', null)})`); }
}

console.log(`table-transform: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
