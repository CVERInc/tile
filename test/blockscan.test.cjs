// blockScan — which lines are NOT markdown.
//
// This exists because the round-trip test cannot see this bug. `**not bold**` inside a ``` fence
// round-trips perfectly while being rendered bold: the TEXT is right and the MEANING is wrong, which
// is exactly the class of defect an idempotence check is blind to. So the assertion here is on the
// per-line verdict, not on the text.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
// blockScan and its FENCE regex are pure; lift them out rather than booting a DOM.
const fence = /const FENCE = \/.*?\/;/s.exec(src);
const fn = /function blockScan\(lines\) \{[\s\S]*?\n\}/.exec(src);
assert.ok(fence && fn, 'blockScan or FENCE not found — did the core move?');
const blockScan = new Function(fence[0] + '\n' + fn[0] + '\nreturn blockScan;')();

let pass = 0;
const eq = (name, text, want) => {
  const got = blockScan(text.split('\n'));
  assert.deepStrictEqual(got, want, `${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  console.log('PASS ' + name);
  pass++;
};

eq('plain lines are markdown', 'a\nb', [null, null]);

eq('fenced block: the fences and everything between',
   '```js\ncode\n```\nafter',
   ['cfence', 'cblock', 'cfence', null]);

eq('tilde fences work too',
   '~~~\ncode\n~~~',
   ['cfence', 'cblock', 'cfence']);

// CommonMark: a fence closes only with the same character.
eq('a ~~~ does not close a ``` block',
   '```\n~~~\n```',
   ['cfence', 'cblock', 'cfence']);

// CommonMark: the closing fence must be at least as long as the opening one.
eq('a shorter run does not close a longer fence',
   '````\n```\n````',
   ['cfence', 'cblock', 'cfence']);

// CommonMark: a closing fence carries no info string.
eq('a fence with an info string opens, never closes',
   '```js\na\n```js\nb\n```',
   ['cfence', 'cblock', 'cblock', 'cblock', 'cfence']);

eq('an unclosed fence runs to the end of the document',
   '```\na\nb',
   ['cfence', 'cblock', 'cblock']);

eq('frontmatter is the block at the very top',
   '---\nname: x\n---\nbody',
   ['fmfence', 'fm', 'fmfence', null]);

eq('... closes frontmatter, as YAML allows',
   '---\nname: x\n...\nbody',
   ['fmfence', 'fm', 'fmfence', null]);

// The one that matters: a --- further down is a thematic break, and mistaking it for frontmatter
// would swallow every line after it.
eq('a --- below the first line is NOT frontmatter',
   'intro\n---\nname: x\n---\nbody',
   [null, null, null, null, null]);

eq('an unterminated leading --- is a thematic break, not frontmatter',
   '---\njust text\nmore',
   [null, null, null]);

eq('a fence inside frontmatter belongs to the frontmatter',
   '---\nname: x\n---\n```\ncode\n```',
   ['fmfence', 'fm', 'fmfence', 'cfence', 'cblock', 'cfence']);

eq('indented fences (up to 3 spaces) still open a block',
   '   ```\ncode\n   ```',
   ['cfence', 'cblock', 'cfence']);

eq('a single line document', 'hello', [null]);

console.log(`\n✅ blockscan all pass (${pass})`);
