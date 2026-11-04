// Unit test for the two tools a markdown-rendering host needs and the rule that decides which tools show.
// Pure logic, no DOM.
// - markdownLink: the link tool on a host with linkSyntax 'markdown'. The default writes Obsidian's [[ ]],
//   which a renderer that reads [text](url) prints as literal brackets.
// - insertRule: the divider. `---` directly under a line of text is a setext heading underline, not a rule,
//   so the paragraph above would silently turn into a heading.
// - toolOn: one rule for the toolbar, the selection menu and the settings pickers. An optIn tool is off
//   until a host asks for it, so the toolbars that never had it keep the row they have.
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
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error('✗ ' + msg + '\n    got  ' + g + '\n    want ' + w); }
};
eval(grab('markdownLink'));
eval(grab('insertRule'));
eval(grab('toolOn'));

// markdownLink: the selection becomes the words, the caret waits in the parentheses for the address
eq(markdownLink('see my shop', 7, 11), { text: 'see my [shop]()', start: 14, end: 14 }, 'selection → [words]() with caret in ()');
// nothing selected: an empty pair, the caret between the brackets for the words
eq(markdownLink('hi ', 3, 3), { text: 'hi []()', start: 4, end: 4 }, 'no selection → []() with caret in []');
eq(markdownLink('中文連結', 2, 4), { text: '中文[連結]()', start: 7, end: 7 }, 'CJK selection');

// insertRule: always its own block, after the caret's line, caret on the line after it
eq(insertRule('one\ntwo', 1), { text: 'one\n\n---\n\ntwo', start: 10, end: 10 }, 'mid-text: blank line before (not a setext underline) and after');
eq(insertRule('para', 4), { text: 'para\n\n---\n\n', start: 11, end: 11 }, 'end of text: rule then an empty block to keep writing in');
eq(insertRule('', 0), { text: '---\n\n', start: 5, end: 5 }, 'empty document: no leading blank lines');
eq(insertRule('a\n\n\nb', 0), { text: 'a\n\n---\n\nb', start: 8, end: 8 }, 'existing blank lines are not doubled');
// the rule is never directly under text: every --- is preceded by a blank line or the start
for (const [v, s] of [['one\ntwo', 1], ['para', 4], ['x\ny\nz', 3]]) {
  const t = insertRule(v, s).text, i = t.indexOf('---');
  eq(i === 0 || t.slice(i - 2, i) === '\n\n', true, `--- is not a setext underline in ${JSON.stringify(t)}`);
}

// toolOn
const plain = { key: 'bold' }, opt = { key: 'rule', optIn: true };
eq(toolOn(plain, {}), true, 'a missing key means on');
eq(toolOn(plain, undefined), true, 'no settings at all means on');
eq(toolOn(plain, { bold: false }), false, 'false turns a tool off');
eq(toolOn(opt, {}), false, 'an optIn tool is off until asked for');
eq(toolOn(opt, { rule: true }), true, 'an optIn tool shows when the host says true');
eq(toolOn(opt, { rule: false }), false, 'an optIn tool stays off on false');

// the rule tool is in EDITOR_TOOLS as optIn, so no existing toolbar grows a button
const toolsSrc = src.slice(src.indexOf('const EDITOR_TOOLS = ['), src.indexOf('];', src.indexOf('const EDITOR_TOOLS = [')));
eq(/\{ key: 'rule'[^}]*optIn: true[^}]*\}/.test(toolsSrc), true, "EDITOR_TOOLS carries { key: 'rule', …, optIn: true }");

console.log(fail ? `✗ link/rule tools: ${fail} failed, ${pass} passed` : `✅ link/rule tools: ${pass} passed`);
if (fail) process.exit(1);
