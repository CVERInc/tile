#!/usr/bin/env node
/* PARITY GATE — highlightLineParts must stay BYTE-IDENTICAL across the cssmd refactor.
 *
 * marktile + tugtile are LIVE on the Obsidian community store. The "Phase 2" refactor made the
 * core's inline marks (**bold** / *italic* / `code`) DELEGATE to the shared cssmd primitive
 * (packages/cssmd → markBoldItalic / markCode) instead of inline `.replace()` arrows. That is a
 * pure internal cleanup ONLY if the rendered DOM does not change one byte. This test proves it:
 * it loads the CURRENT highlightLineParts (with cssmd's passes inlined exactly as the builds do),
 * runs a representative corpus, and asserts every result equals the captured golden baseline
 * (test/golden/highlightLineParts.golden.json — snapshot of the PRE-refactor output).
 *
 * If any byte differs → this fails → STOP, the refactor is NOT safe to ship. Regenerate the golden
 * ONLY when a deliberate, reviewed behaviour change to the renderer is intended.
 *
 * 🩸 Regenerated once, 2026-08-04, when markBoldItalic's regex was replaced by the CommonMark
 * delimiter-run tokeniser (markEmphasis). TWO of the 68 entries moved and 66 stayed byte-identical,
 * which is the evidence that the swap was a drop-in:
 *   • `**a****b**`   two adjacent bolds → ONE bold whose content is `a****b`
 *   • `***triple***` a stranded `*`, bold, a stranded `*` → em wrapping strong
 * Both new values were checked against the reference `commonmark` package before the golden was
 * touched. That order matters: regenerating first and reading the diff afterwards would have made
 * this file agree with whatever the renderer now does, which is not a test.
 *
 * 🩸 Regenerated a second time, same day, when the inline `code` and <autolink> passes moved AHEAD
 * of emphasis (the spec's precedence). ONE entry moved:
 *   • `` `a *b* c` ``  an italic inside the code span → the asterisks are literal, as `<code>` means
 * Reference-checked first, again.
 *
 * Run: node test/parity-highlightLineParts.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');

// ── Load highlightLineParts the same way the build assembles it: editor-core's escHtml +
//    highlightLineParts, with cssmd's pass functions (markBoldItalic/markCode/mk) inlined. ──
const coreSrc = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'editor-core.js'), 'utf8');
const cssmdSrc = fs.readFileSync(path.join(ROOT, 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '')                       // drop ESM export footer
  .replace(/^function escHtml\(s\)[\s\S]*?\n\}\n/m, '');            // drop cssmd's dup escHtml (core has it)

const coreLines = coreSrc.split('\n');
const escLine = coreLines.find((l) => l.startsWith('function escHtml'));
const hlpStart = coreLines.findIndex((l) => l.startsWith('function highlightLineParts'));
let hlpEnd = hlpStart;
for (let i = hlpStart + 1; i < coreLines.length; i++) { if (coreLines[i] === '}') { hlpEnd = i; break; } }
const hlp = coreLines.slice(hlpStart, hlpEnd + 1).join('\n');

const bundle = escLine + '\n' + cssmdSrc + '\n' + hlp +
  '\nreturn { highlightLineParts };';
const { highlightLineParts } = new Function(bundle)();
assert.strictEqual(typeof highlightLineParts, 'function', 'highlightLineParts not loaded');

// ── Corpus + golden baseline ──
const corpus = require('./golden/corpus.cjs');
const golden = require('./golden/highlightLineParts.golden.json');
assert.strictEqual(corpus.length, golden.length, 'corpus length != golden length (regenerate golden)');

let pass = 0, fail = 0;
golden.forEach((g, i) => {
  assert.strictEqual(corpus[i], g.line, `corpus drifted from golden at #${i}`);
  const got = highlightLineParts(g.line);
  const a = JSON.stringify(got);
  const b = JSON.stringify(g.result);
  if (a === b) { pass++; } else {
    fail++;
    console.error('PARITY FAIL #' + i + '  input: ' + JSON.stringify(g.line));
    console.error('  golden : ' + b);
    console.error('  current: ' + a);
  }
});

console.log((fail ? '✗' : '✓') + ' highlightLineParts parity: ' + pass + ' byte-identical, ' + fail + ' diverged (of ' + golden.length + ')');
process.exit(fail ? 1 : 0);
