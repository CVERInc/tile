#!/usr/bin/env node
/* tile-cssmd highlightCode Unit Tests (pure Node, no npm) — same loader approach as
 * cssmd.test.cjs: read the ES module, strip its `export {…}` footer, eval in a CommonJS
 * sandbox, assert.
 *
 * The failure that matters here is a WRONG paint, not a missing one: a reader cannot tell a
 * mis-tokenized keyword from a real one, and a highlighter that guesses is worse than one that
 * declines. So most of what follows is negative — an unknown language paints nothing, an
 * identifier that ends in a digit is not a number, a quote in markup text is not an attribute,
 * an unterminated quote does not swallow the rest of the block, and markdown marks inside a
 * fence stay literal.
 *
 * Run: node test/highlight.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'packages', 'cssmd', f), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '')    // drop the ESM export footer; functions become module-local
  .replace(/^import\s[\s\S]*?;\s*$/m, '');       // …and the import, since both files are evaluated together
const sandbox = {};
new Function('module', 'exports', read('cssmd.js') + read('highlight.js')
  + '\nObject.assign(module.exports, { highlightCode, knowsLanguage });')({ exports: sandbox }, sandbox);
const { highlightCode, knowsLanguage } = sandbox;

let pass = 0, fail = 0;
const eq = (a, b, msg) => { try { assert.strictEqual(a, b); pass++; } catch (_) { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); } };
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error('FAIL:', msg); } };

// ── the four token classes ──
eq(highlightCode('const x = 1;', 'js'),
  '<span class="tg-kw">const</span> x = <span class="tg-num">1</span>;', 'js: keyword + number');
ok(highlightCode('// a note\nx', 'js').startsWith('<span class="tg-com">// a note</span>'), 'js: line comment');
ok(highlightCode('/* a */ x', 'js').includes('<span class="tg-com">/* a */</span>'), 'js: block comment');
ok(highlightCode("s = 'hi'", 'js').includes('<span class="tg-str">\'hi\'</span>'), 'js: string');
ok(highlightCode('if [ -d x ]; then done', 'bash').includes('<span class="tg-kw">if</span>'), 'bash: keyword');
ok(highlightCode('# comment\nls', 'bash').includes('<span class="tg-com"># comment</span>'), 'bash: # comment');
ok(highlightCode('{"a": true}', 'json').includes('<span class="tg-kw">true</span>'), 'json: literal is a keyword');

// ── declining is a feature ──
eq(highlightCode('nothing here', 'nosuchlang'), 'nothing here', 'unknown language paints nothing');
eq(highlightCode('nothing here', ''), 'nothing here', 'absent language paints nothing');
eq(highlightCode('nothing here', null), 'nothing here', 'null language paints nothing');
ok(!knowsLanguage('brainfuck') && knowsLanguage('bash'), 'knowsLanguage answers before the wrapper is built');

// ── the ways a tokenizer paints the wrong word ──
eq(highlightCode('foo2 + 3', 'js'), 'foo2 + <span class="tg-num">3</span>',
  'an identifier ending in a digit is not a number');
eq(highlightCode('constant = 1', 'js'), 'constant = <span class="tg-num">1</span>',
  '`constant` is not the keyword `const`');
ok(highlightCode("echo don't\nls -la", 'bash').includes('ls -la'),
  'an unterminated quote stops at the end of its line, not the end of the block');
eq(highlightCode('he said "hi"', 'html'), 'he said "hi"',
  'a quote in markup TEXT is text, not an attribute value');
ok(!highlightCode('**bold** in a fence', 'js').includes('-b"'),
  'markdown marks inside a fence stay literal (the editor core leaves fences alone; this is the other side)');

// ── escaping (same contract as renderInlineMd: raw input is safe) ──
eq(highlightCode('<a href="x">', 'js'), '&lt;a href=<span class="tg-str">"x"</span>&gt;',
  'HTML-significant chars are escaped inside spans and out');
ok(highlightCode('<!-- <script> -->', 'html').includes('&lt;script&gt;'), 'markup comment body is escaped');

// ── diff ──
const d = highlightCode('@@ -1 +1 @@\n-old\n+new\n ctx', 'diff');
ok(d.includes('<span class="tg-hunk">@@ -1 +1 @@</span>'), 'diff: hunk header');
ok(d.includes('<span class="tg-del">-old</span>'), 'diff: deletion');
ok(d.includes('<span class="tg-ins">+new</span>'), 'diff: insertion');
ok(d.includes('\n ctx'), 'diff: a context line is left unwrapped');
ok(highlightCode('--- a/f\n+++ b/f', 'diff').includes('<span class="tg-hunk">--- a/f</span>'),
  'diff: `---` is a FILE HEADER, tested before the single-char `-`, or every diff opens deleted');

// ── markup ──
const h = highlightCode('<p class="x">hi</p><!-- c -->', 'html');
ok(h.includes('<span class="tg-kw">p</span>'), 'markup: tag name');
ok(h.includes('<span class="tg-str">"x"</span>'), 'markup: attribute value');
ok(h.includes('<span class="tg-com">&lt;!-- c --&gt;</span>'), 'markup: comment');

// ── namespace-neutral, like the rest of this module ──
ok(highlightCode('const x', 'js', { prefix: 'gd' }).includes('class="gd-kw"'), 'prefix is host-chosen');

// ── the info string is a fence info string, not a bare name ──
ok(highlightCode('const x', 'js title="a.js"').includes('tg-kw'), 'only the first token of the info string names the language');
ok(highlightCode('const x', 'JS').includes('tg-kw'), 'language match is case-insensitive');

console.log(fail ? `\n✗ highlightCode: ${fail} failed, ${pass} passed` : `\n✓ highlightCode: ${pass} passed`);
process.exitCode = fail ? 1 : 0;
