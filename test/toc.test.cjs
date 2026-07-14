// Unit test for the table-of-contents model (pure logic, no DOM).
// tocHeadings(text) → [{ level, text, line }] for H1–H3 OUTSIDE fenced code.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) { const i = src.indexOf('function ' + name); const end = src.indexOf('\n}', i); return src.slice(i, end + 2); }
eval(grab('tocHeadings'));
eval(grab('moveSection'));

let fail = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log('  ✗', msg, '\n     got ', JSON.stringify(got), '\n     want', JSON.stringify(want)); } };

// H1–H3 with level + trimmed text + 0-based line index
eq(tocHeadings('# A\n## B\n### C'),
   [{ level: 1, text: 'A', line: 0 }, { level: 2, text: 'B', line: 1 }, { level: 3, text: 'C', line: 2 }],
   'H1/H2/H3 with level + line index');

// H4–H6 are ignored (TOC is H1–H3 only)
eq(tocHeadings('# A\n#### D\n##### E'), [{ level: 1, text: 'A', line: 0 }], 'H4+ ignored');

// body text, list markers, empty lines → not headings
eq(tocHeadings('intro\n- item\n\n## Real'), [{ level: 2, text: 'Real', line: 3 }], 'only real headings, line index counts blanks');

// '#' needs a space (so a bare '#tag' line is not a heading)
eq(tocHeadings('#tag not a heading\n# Yes'), [{ level: 1, text: 'Yes', line: 1 }], 'hash without space is not a heading');

// fenced code: '#' inside ``` / ~~~ is NOT a heading
eq(tocHeadings('# Real\n```\n# fake in code\n```\n## After'),
   [{ level: 1, text: 'Real', line: 0 }, { level: 2, text: 'After', line: 4 }],
   'headings inside a ``` fence are excluded');
eq(tocHeadings('~~~\n### nope\n~~~\n# ok'), [{ level: 1, text: 'ok', line: 3 }], '~~~ fence also excludes');

// trailing markers / extra spaces trimmed
eq(tocHeadings('##   Spaced  '), [{ level: 2, text: 'Spaced', line: 0 }], 'leading marker stripped, text trimmed');

// CJK heading text
eq(tocHeadings('# 標題\n## 子標題'), [{ level: 1, text: '標題', line: 0 }, { level: 2, text: '子標題', line: 1 }], 'CJK headings');

// ── moveSection: drag-reorder a section (oldIndex/newIndex = SortableJS semantics; levels never change) ──
eq(moveSection('# A\n# B\n# C\n# D', 0, 2), '# B\n# C\n# A\n# D', 'flat: move down lands after the target');
eq(moveSection('# A\n# B\n# C\n# D', 3, 1), '# A\n# D\n# B\n# C', 'flat: move up lands before the target');
eq(moveSection('# A\nbody a\n# B\nbody b', 1, 0), '# B\nbody b\n# A\nbody a', 'section carries its body lines');
eq(moveSection('# A\n## A1\n# B', 0, 2), '# B\n# A\n## A1', 'dragging an H1 carries its H2 child');
eq(moveSection('# A\n## A1\n## A2\n# B', 1, 3), '# A\n## A2\n# B\n## A1', 'dragging an H2 child out keeps it H2 (level unchanged)');
eq(moveSection('# A\n```\n# fake\n```\n# B', 0, 1), '# B\n# A\n```\n# fake\n```', 'a fenced block travels with its section, intact');
eq(moveSection('# A\n# B', 1, 1), '# A\n# B', 'no-op when oldIndex === newIndex');

console.log(fail ? (fail + ' failed') : 'all toc assertions pass');
process.exit(fail ? 1 : 0);
