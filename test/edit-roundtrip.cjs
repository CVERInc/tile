// Integrity check for the contenteditable editor's text<->DOM model.
// highlightMarkdown() builds per-line <div> blocks; the editor reads text back as
// children textContent join('\n'). This asserts that round-trip is byte-exact.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');

// Extract a top-level function by name, using a column-0 '}' as the closing boundary
// (brace-counting is fooled by the \{ \} inside the date regex).
function grab(name) {
  const i = src.indexOf('function ' + name);
  const end = src.indexOf('\n}', i);
  return src.slice(i, end + 2);
}
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// highlightLineParts now DELEGATES its inline marks to the shared cssmd primitive (markBoldItalic/
// markCode/mk). Inline cssmd's body the same way the builds do — minus its ESM export + dup escHtml.
const cssmdSrc = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '')
  .replace(/^function escHtml\(s\)[\s\S]*?\n\}\n/m, '');
eval(cssmdSrc);
// `var`, not `const`: a const declared inside eval() is scoped to that eval and blockScan (eval'd
// separately) would not see it.
eval(/const FENCE = \/.*?\/;/s.exec(src)[0].replace('const ', 'var '));
eval(grab('blockScan'));                        // highlightMarkdown asks it which lines are not markdown
eval(grab('highlightLineParts'));
eval(grab('highlightMarkdown'));

function decode(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function domTextLines(html) {
  const lines = [];
  const re = /<div class="[^"]*">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    let inner = m[1];
    if (inner === '<br>') { lines.push(''); continue; }
    inner = inner.replace(/<\/?span[^>]*>/g, '');   // spans don't change textContent
    lines.push(decode(inner));
  }
  return lines.join('\n');
}

const cases = [
  '# H1\n## h2\nbody text',
  '',
  'plain',
  'a\n\nb',
  '## 標題中文\n內文 **粗** `code`',
  '- [ ] task\n> quote\n#tag here',
  'line with <html> & "amp" chars',
  '### h3 @{2026-06-08} done',
  'trailing empty\n',
  '**bold start** mid #t end',
  '- [ ] todo\n- [x] done\n* [X] also done',
  '~~struck~~ and **bold** and `code`',
  '- [ ] 待辦中文 #標籤',
  '*italic* and **bold** mixed',
  'a * b * c not italic',
  '*斜體* 中文 *test*',
  '\tindented once',                  // leading tab → wrapped in a tg-tab span, must round-trip to a bare \t
  '\t\tnested twice\nno tab here',
  '- [ ]\ttab after marker',          // tab mid-line alongside a check box
  // Block-scanned lines take a different path through highlightLineParts (raw escaping, no inline
  // marks), so they need their own round-trip evidence — the old cases would never have entered it.
  '```js\nconst a = **not bold**;\n```',
  '```\n<div>&amp; "quoted"\n```',    // HTML + entities inside a fence, where nothing is re-escaped twice
  '---\nname: x\ntype: memory\n---\n\nbody **bold**',
  '```\nunclosed to the end',
  '~~~\n| a | b |\n~~~',              // a table line inside a fence stays text
];
let fail = 0;
for (const t of cases) {
  const back = domTextLines(highlightMarkdown(t));
  if (back !== t) { fail++; console.log('MISMATCH in:', JSON.stringify(t), '-> out:', JSON.stringify(back)); }
}
console.log(fail ? (fail + ' failed') : ('all ' + cases.length + ' round-trips exact'));
process.exit(fail ? 1 : 0);
