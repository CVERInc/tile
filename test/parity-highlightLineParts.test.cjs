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
