// Unit test for "clear formatting → plain text". Pure logic, no DOM.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) { const i = src.indexOf('function ' + name); const end = src.indexOf('\n}', i); return src.slice(i, end + 2); }
// A `const` inside an eval is block-scoped to that eval, so the separately-eval'd stripFormatting could not see
// it. Rebind onto globalThis instead — the eval'd function bodies resolve it there.
function grabConst(name) { const re = new RegExp('^const ' + name + ' = (.*);$', 'm'); const m = re.exec(src); if (!m) throw new Error('not found: ' + name); return 'globalThis.' + name + ' = ' + m[1] + ';'; }
eval(grabConst('isTableLine'));
eval(grab('listMarker'));
eval(grab('stripFormatting'));

let pass = 0, fail = 0;
function t(label, input, expected) {
  const got = stripFormatting(input);
  if (got === expected) pass++;
  else { fail++; console.log(`FAIL ${label}\n  in : ${JSON.stringify(input)}\n  exp: ${JSON.stringify(expected)}\n  got: ${JSON.stringify(got)}`); }
}

// ── inline marks ───────────────────────────────────────────────────────────────────────────────────
t('bold', 'a **b** c', 'a b c');
t('italic', 'a *b* c', 'a b c');
t('bold+italic nested', '***b***', 'b');
t('underscore bold', 'a __b__ c', 'a b c');
t('underscore italic', 'a _b_ c', 'a b c');
t('strike', 'a ~~b~~ c', 'a b c');
t('highlight', 'a ==b== c', 'a b c');
t('inline code', 'run `npm test` now', 'run npm test now');
t('CJK bold', '這是**重點**喔', '這是重點喔');

// ── the intraword underscore must survive: this is why the rule is not a bare /_(.+?)_/ ────────────
t('snake_case survives', 'call snake_case_name here', 'call snake_case_name here');
t('a filename survives', 'see my_file_v2.md', 'see my_file_v2.md');

// ── links flatten to their text; images do NOT flatten at all ──────────────────────────────────────
t('inline link', 'see [the docs](https://x.dev) now', 'see the docs now');
t('wikilink', 'see [[Some Page]] now', 'see Some Page now');
t('wikilink with alias keeps the alias', 'see [[Some Page|the docs]] now', 'see the docs now');
t('image is content, not formatting', 'before ![alt](pic.png) after', 'before ![alt](pic.png) after');
t('embed is content too', 'before ![[pic.png]] after', 'before ![[pic.png]] after');
t('an image next to a link', '[a](u) ![[p.png]] **b**', 'a ![[p.png]] b');
t('two images keep their own identity', '![[a.png]] and ![[b.png]]', '![[a.png]] and ![[b.png]]');

// ── block prefixes ─────────────────────────────────────────────────────────────────────────────────
t('heading', '## Title', 'Title');
t('quote', '> quoted', 'quoted');
t('nested quote', '>> deep', 'deep');
t('quoted heading', '> ## Title', 'Title');
t('bullet', '- item', 'item');
t('numbered', '3. item', 'item');
t('task', '- [x] done', 'done');
t('indented item loses its indent too', '\t\t- deep item', 'deep item');
t('a bullet with bold inside', '- **bold** item', 'bold item');

// ── things that must NOT be touched ────────────────────────────────────────────────────────────────
t('fenced code keeps its contents verbatim', '```js\nconst a = b * c * d;\n```', 'const a = b * c * d;');
t('fenced code keeps indentation', '```\n  indented\n```', '  indented');
t('a table is left whole', '| a | **b** |\n| --- | --- |', '| a | **b** |\n| --- | --- |');
t('a horizontal rule survives', 'a\n---\nb', 'a\n---\nb');   // also: --- is the frontmatter delimiter
t('plain text is unchanged', 'nothing to do here', 'nothing to do here');
t('blank lines are preserved', 'a\n\n**b**', 'a\n\nb');

// ── idempotence: running it twice changes nothing the second time ──────────────────────────────────
const CORPUS = '# T\n\n> a **b** [c](u) ![[d.png]]\n\n- [ ] e `f`\n\n```\ng * h\n```\n\n| x | y |\n| --- | --- |\n';
{
  const once = stripFormatting(CORPUS), twice = stripFormatting(once);
  if (once === twice) pass++;
  else { fail++; console.log(`FAIL idempotent\n  1st: ${JSON.stringify(once)}\n  2nd: ${JSON.stringify(twice)}`); }
}

console.log(`strip-formatting: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
