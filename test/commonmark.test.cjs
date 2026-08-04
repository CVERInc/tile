// Does this editor agree with CommonMark about what a line MEANS?
//
// It cannot be checked the usual way. A conformance suite compares a renderer's HTML against the
// spec's, and this is not a renderer — it emits the source text with marker spans around the syntax,
// so the visible text IS the editable text. There is no <strong> to compare.
//
// What can be checked is the claim underneath: where the spec says <strong>, the engine must emit a
// tg-b, and — the half that actually catches bugs — where the spec says NO <strong>, the engine must
// not emit one either. `\*escaped\*` is the whole reason: it round-trips perfectly, satisfies every
// other test in this repo, and renders italic text the author explicitly asked not to be italic.
//
// GAPS below are constructs the engine knowingly does not implement. They are asserted to STILL be
// missing, so the day someone implements one this test goes red and says "update the list" — which
// makes the score a number that can only move on purpose. Run scripts/commonmark-score.mjs to score
// against the real 650-example spec (it downloads; that is why it is not this file).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'packages', 'core', 'editor-core.js'), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name);
  const end = src.indexOf('\n}', i);
  return src.slice(i, end + 2);
}
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const cssmdSrc = fs.readFileSync(path.join(__dirname, '..', 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '')
  .replace(/^function escHtml\(s\)[\s\S]*?\n\}\n/m, '');
eval(cssmdSrc);
eval(/const FENCE = \/.*?\/;/s.exec(src)[0].replace('const ', 'var '));
eval(grab('blockScan'));
eval(grab('highlightLineParts'));
eval(grab('highlightMarkdown'));

const classesIn = (md) => {
  const html = highlightMarkdown(md);
  const found = new Set();
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(html))) m[1].split(/\s+/).forEach((c) => c && found.add(c));
  return found;
};

let pass = 0, fail = 0;
// want: classes that must be present. reject: classes that must be absent.
const claim = (name, md, want, reject) => {
  const got = classesIn(md);
  const missing = (want || []).filter((c) => !got.has(c));
  const wrong = (reject || []).filter((c) => got.has(c));
  if (missing.length || wrong.length) {
    fail++;
    console.log(`FAIL ${name}`);
    if (missing.length) console.log(`       expected but absent: ${missing.join(', ')}`);
    if (wrong.length) console.log(`       present but wrong:   ${wrong.join(', ')}`);
    console.log(`       got: ${[...got].sort().join(' ')}`);
  } else { pass++; console.log(`PASS ${name}`); }
};

// ── Constructs the engine claims ────────────────────────────────────────────────────────────────
claim('ATX heading levels',        '# a\n## b\n###### f', ['tg-h1', 'tg-h2', 'tg-h6']);
claim('7 hashes is not a heading', '####### a', [], ['tg-h', 'tg-h1']);
claim('hash needs a space',        '#hashtag', [], ['tg-h1']);
claim('strong',                    '**a**', ['tg-b']);
claim('emphasis',                  '*a*', ['tg-i']);
claim('intraword _ is literal',    'snake_case_name', [], ['tg-i']);
claim('inline code',               '`a`', ['tg-code']);
claim('bullet list',               '- a', ['tg-li']);
claim('star bullet',               '* a', ['tg-li']);
claim('ordered list',              '1. a', ['tg-ol', 'tg-num']);
claim('ordered with )',            '1) a', ['tg-ol', 'tg-num']);
claim('a number alone is not a list', '1975 was a year', [], ['tg-ol']);
claim('task list',                 '- [ ] a', ['tg-task', 'tg-check']);
claim('checked task',              '- [x] a', ['tg-task-done', 'tg-check-done']);
claim('blockquote',                '> a', ['tg-quote']);
claim('inline link',               '[a](b)', ['tg-link']);
claim('image',                     '![a](b)', ['tg-img'], ['tg-link']);
claim('link with empty label',     '[](b)', ['tg-link']);
claim('link with empty target',    '[a]()', ['tg-link']);
claim('brackets without a target', '[just brackets]', [], ['tg-link']);
claim('thematic break -',          '---\n\nx', ['tg-hr']);
claim('thematic break *',          '***\n\nx', ['tg-hr']);
claim('thematic break _',          '___\n\nx', ['tg-hr']);
claim('two dashes are not a rule', '--\n\nx', [], ['tg-hr']);
claim('fenced code',               '```\na\n```', ['tg-cfence', 'tg-cblock']);
claim('indented code',             'x\n\n    code', ['tg-cblock']);
claim('indent under prose is not code', 'a wrapped\n    sentence', [], ['tg-cblock']);
claim('list continuation is not code',  '- item\n\n    more of it', [], ['tg-cblock']);
claim('code inside a list needs 4 MORE', '- item\n\n        code', ['tg-cblock']);
claim('autolink',                  '<https://x.com>', ['tg-link']);
claim('email autolink',            '<a@b.com>', ['tg-link']);
claim('a bare tag is not a link',  '<div>', [], ['tg-link']);
claim('footnote reference',        'a[^1]', ['tg-ref']);
claim('reference link',            '[a][r]', ['tg-ref']);
claim('reference definition',      '[r]: https://x.com', ['tg-refdef']);
claim('hard line break',           'a  \nb', ['tg-brk']);
claim('one trailing space is not a break', 'a \nb', [], ['tg-brk']);
claim('backslash escape is not emphasis', '\\*a\\*', [], ['tg-i']);
claim('escaped backtick is not code',     '\\`a\\`', [], ['tg-code']);
claim('a real emphasis still emphasises', '\\*lit\\* and *real*', ['tg-i']);
claim('C:\\path is left alone',            'C:\\path\\to', [], ['tg-mk']);
claim('tilde fence',               '~~~\na\n~~~', ['tg-cfence', 'tg-cblock']);
claim('frontmatter',               '---\na: b\n---\nx', ['tg-fmfence', 'tg-fm'], ['tg-hr']);
claim('setext h1',                 'Title\n===', ['tg-h1', 'tg-srule']);
claim('setext h2 beats the rule',  'Title\n---', ['tg-h2', 'tg-srule'], ['tg-hr']);
claim('setext spans the paragraph','two\nline title\n===', ['tg-h1']);
claim('a rule after a blank stays a rule', 'a\n\n---\n\nb', ['tg-hr'], ['tg-srule']);
claim('a list is not setext text', '- item\n---', [], ['tg-srule']);
claim('setext keeps its inline marks', 'a **b** title\n===', ['tg-h1', 'tg-b']);

// ── The negatives: inside a code fence, nothing is markdown ─────────────────────────────────────
claim('no strong inside a fence',   '```\n**a**\n```', ['tg-cblock'], ['tg-b']);
claim('no emphasis inside a fence', '```\n*a*\n```', ['tg-cblock'], ['tg-i']);
claim('no heading inside a fence',  '```\n# a\n```', ['tg-cblock'], ['tg-h1']);
claim('no link inside a fence',     '```\n[a](b)\n```', ['tg-cblock'], ['tg-link']);
claim('no list inside a fence',     '```\n- a\n```', ['tg-cblock'], ['tg-li']);
claim('no rule inside a fence',     '```\n---\n```', ['tg-cblock'], ['tg-hr']);
claim('no markdown in frontmatter', '---\na: **b**\n---\nx', ['tg-fm'], ['tg-b']);

// ── GAPS: not implemented, asserted to stay that way until someone means to change it ───────────
const GAPS = [
  ['html block',           '<div>x</div>',      'tg-html'],
  // Recognised but never RESOLVED: the label is styled, nothing looks up what [r] or [^1] points at.
  // That needs a document-wide map, which is a different job from highlighting a line.
  ['reference link resolution', '[a][r]\n\n[r]: u', 'tg-link'],
];
console.log('\n— known gaps (asserted still missing) —');
for (const [name, md, cls] of GAPS) {
  const got = classesIn(md);
  if (!got.has(cls)) { console.log(`GAP  ${name}`); pass++; }
  else { console.log(`FAIL ${name} — now emits ${cls}. Remove it from GAPS and add a claim().`); fail++; }
}

const claims = 57, gaps = GAPS.length;
console.log(`\n${fail ? '✗' : '✅'} commonmark: ${claims} claims kept, ${gaps} gaps declared, ${fail} broken`);
if (fail) process.exit(1);
