// tile-lab#52 題② ruler — feed ONE input set to every inline/block markdown renderer in the family
// and write the outputs side by side. Facts only; this file takes no position on which is right.
//
//   node --import ./LANE-tl52-ruler/register.mjs LANE-tl52-ruler/measure.mjs > LANE-tl52-ruler/output.md
//   (run from the worktree root)
//
// Renderers measured (all imported from the repo, never re-implemented here):
//   CT-i  packages/cardtile/card-render.mjs  mdInline  (exported as __mdInline)
//   CT-b  packages/cardtile/card-render.mjs  mdBlock   (private; exposed in memory by expose-mdblock.mjs)
//   CM    packages/cssmd/cssmd.js            renderInlineMd(s)            — default prefix 'tg'
//   ST-i  packages/sitetile/site-core.js     inlineHtml(s)                — what every section .astro calls
//   ST-b  packages/sitetile/site-core.js     bodyHtml(s)                  — section bodies
// The brief names CT-i/CT-b vs CM. ST-i/ST-b are added because the 16 sections never call
// renderInlineMd directly (grep: 0 call sites under sections/); they call inlineHtml/bodyHtml, which
// splice cssmd's passes with prefix 'st' and add links/images on top.
import assert from 'node:assert/strict';
import * as card from '../packages/cardtile/card-render.mjs';
import { renderInlineMd } from '../packages/cssmd/cssmd.js';
import { inlineHtml, bodyHtml } from '../packages/sitetile/site-core.js';

const mdInline = card.__mdInline;
const mdBlock = card.__mdBlockProbe;
assert.equal(typeof mdInline, 'function', '__mdInline export missing');
assert.equal(typeof mdBlock, 'function', 'load hook did not expose mdBlock — run with --import ./LANE-tl52-ruler/register.mjs');

// A card whose own address is a handle path: relFor() then answers ugc for every external link,
// which is what a canonical card does (a vanity host would turn same-host links into REL_OWN).
const CTX = { cardUrl: 'https://card.example/handle' };
const destinations = [];
const CTX_D = { ...CTX, onDestination: (u) => destinations.push(u) };

// [id, input, what the row probes]
const INPUTS = [
  ['01', '<b>粗</b>', 'raw HTML tag'],
  ['02', '<script>alert(1)</script>', 'raw script'],
  ['03', '[a](http://x)', 'link, http'],
  ['04', '[a](javascript:)', 'link, javascript: (bare, as in the brief)'],
  ['05', '[a](javascript:alert(1))', 'link, javascript: with payload'],
  ['06', '[a](https://x.com/?q=1&r=2)', 'link with & in query'],
  ['07', '[a](/relative)', 'link, relative path'],
  ['08', '[a](mailto:me@x.com)', 'link, mailto:'],
  ['09', '[a](http://x "t")', 'link with title'],
  ['10', '**粗**', 'strong, **'],
  ['11', '*斜*', 'em, *'],
  ['12', '__粗__ _斜_', 'strong/em, underscore'],
  ['13', 'snake_case_name', 'intraword underscore'],
  ['14', '***both***', 'strong+em run of 3'],
  ['15', '**bold *it* inside**', 'nested emphasis'],
  ['16', 'a * b * c', 'spaced asterisks'],
  ['17', '`code`', 'code span'],
  ['18', '`**not bold**`', 'emphasis inside code'],
  ['19', '\\*not italic\\*', 'backslash escape'],
  ['20', 'a  \nb', 'two trailing spaces + newline'],
  ['21', 'a\nb', 'single newline'],
  ['22', 'a\n\nb', 'blank line (\\n\\n)'],
  ['23', '你好，世界！「引號」（括號）。', 'CJK full-width punctuation'],
  ['24', '中文**粗體**緊貼', 'CJK emphasis without spaces'],
  ['25', '日本語\n改行', 'CJK across a single newline'],
  ['26', 'https://example.com', 'bare URL (autolink candidate)'],
  ['27', '<https://example.com>', 'angle autolink'],
  ['28', '&amp;', 'pre-escaped entity'],
  ['29', 'a & b', 'bare ampersand'],
  ['30', '1 < 2', 'lone <'],
  ['31', 'a > b', 'lone >'],
  ['32', '"q" & \'a\'', 'quotes'],
  ['33', 'x<br>y <small>z</small>', 'allowlisted-in-sitetile tags'],
  ['34', '<!-- note -->x', 'HTML comment'],
  ['35', '~~strike~~', 'strikethrough'],
  ['36', '![alt](https://x.example/i.png)', 'image'],
  ['37', 'emoji 🎉 **🎉**', 'emoji, emphasised emoji'],
  ['38', '  lead and trail  ', 'outer whitespace'],
  ['39', 'a    b', 'inner run of spaces'],
  ['40', '- one\n- two', 'list'],
  ['41', '## Heading', 'ATX heading'],
  ['42', '---', 'thematic break'],
  ['43', '[**b**](http://x)', 'emphasis inside link label'],
  ['44', '[x_y_z](https://x.example/_a_b_)', 'underscores in label and URL'],
];
assert.ok(INPUTS.length >= 20);

const RENDERERS = [
  ['CT-i', (s) => mdInline(s, CTX)],
  ['CT-b', (s) => mdBlock(s, CTX)],
  ['CM', (s) => renderInlineMd(s)],
  ['ST-i', (s) => inlineHtml(s)],
  ['ST-b', (s) => bodyHtml(s)],
];

// Cross-check the load-hook probe against cardtile's PUBLIC path: a `text` cell in renderGrid is
// `mdBlock((cell.body||'').trim())`, so on inputs with no outer whitespace the two must agree.
let crossChecked = 0;
for (const [, s] of INPUTS) {
  if (s !== s.trim()) continue;
  const html = card.renderGrid({ cols: 6, cells: [{ type: 'text', body: s, params: {} }] }, CTX);
  const open = 'data-coral-type="text">';
  const i = html.indexOf(open);
  const inner = html.slice(i + open.length, html.lastIndexOf('</div></div></div>'));
  assert.equal(inner, mdBlock(s, CTX), 'probe ≠ public path for ' + JSON.stringify(s));
  crossChecked++;
}

// Mechanical feature extraction — the "差在哪" column is derived from these, not typed by hand.
function features(html) {
  const f = [];
  const tags = [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)].map((m) => {
    const cls = /class="([^"]*)"/.exec(m[2]);
    return m[1] + (cls ? '.' + cls[1].split(/\s+/).join('.') : '');
  });
  const uniq = [...new Set(tags)];
  f.push('tags=' + (uniq.length ? uniq.join(',') : '∅'));
  for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
    const href = /href="([^"]*)"/.exec(m[1]);
    const tgt = /target="([^"]*)"/.exec(m[1]);
    const rel = /rel="([^"]*)"/.exec(m[1]);
    f.push(`a[href=${href ? href[1] : '∅'} target=${tgt ? tgt[1] : '∅'} rel=${rel ? rel[1] : '∅'}]`);
  }
  if (/<script/i.test(html)) f.push('LIVE <script>');
  if (/&lt;/.test(html)) f.push('&lt;');
  if (/&amp;amp;/.test(html)) f.push('double-escaped &');
  if (/<br>/.test(html)) f.push('<br>');
  return f;
}

const cell = (s) => '`' + s.replace(/`/g, 'ˋ').replace(/\n/g, '⏎').replace(/\|/g, '\\|') + '`';
const code = (s) => s === '' ? '_(empty)_' : cell(s);

const lines = [];
lines.push('# tile-lab#52 題② — same input, five renderers (raw output)');
lines.push('');
lines.push(`Generated by \`LANE-tl52-ruler/measure.mjs\` on node ${process.version}. ${INPUTS.length} inputs × ${RENDERERS.length} renderers.`);
lines.push('In cells: `⏎` = a newline character in the string, `ˋ` = a backtick (substituted so the markdown table survives). Everything else is byte-for-byte.');
lines.push('');
lines.push('- **CT-i** cardtile `mdInline(s, ctx)` (ctx.cardUrl = `https://card.example/handle`)');
lines.push('- **CT-b** cardtile `mdBlock(s, ctx)` (private fn, exposed in memory by `expose-mdblock.mjs`)');
lines.push('- **CM** cssmd `renderInlineMd(s)` (default prefix `tg`)');
lines.push('- **ST-i** sitetile `inlineHtml(s)`: what the 16 section components call for titles/labels');
lines.push('- **ST-b** sitetile `bodyHtml(s)`: what the section components call for bodies');
lines.push('');
lines.push(`Probe integrity: \`mdBlock\` via the load hook == \`renderGrid\` text-cell output on ${crossChecked} trimmed inputs (assert.equal, all passed).`);
lines.push('');

const diffRows = [];
for (const [id, s, what] of INPUTS) {
  const outs = RENDERERS.map(([name, fn]) => {
    try { return [name, fn(s)]; } catch (e) { return [name, 'THROWS ' + e.constructor.name + ': ' + e.message]; }
  });
  lines.push(`## ${id} — ${what}`);
  lines.push('');
  lines.push('input: ' + code(s));
  lines.push('');
  lines.push('| renderer | output | features |');
  lines.push('|---|---|---|');
  for (const [name, out] of outs) lines.push(`| ${name} | ${code(out)} | ${features(out).join(' · ').replace(/\|/g, '\\|')} |`);
  const byOut = new Map();
  for (const [name, out] of outs) byOut.set(out, [...(byOut.get(out) || []), name]);
  lines.push('');
  lines.push('identical groups: ' + [...byOut.values()].map((g) => g.join('=')).join(' / '));
  lines.push('');
  diffRows.push([id, s, what, outs]);
}

// Destination registry — cardtile's Web Risk hook: which inputs made mdInline report a URL.
lines.push('## cardtile destination registry (ctx.onDestination) per input');
lines.push('');
lines.push('| id | registered |');
lines.push('|---|---|');
for (const [id, s] of INPUTS) {
  destinations.length = 0;
  mdInline(s, CTX_D);
  lines.push(`| ${id} | ${destinations.length ? destinations.map(code).join(', ') : '—'} |`);
}
lines.push('');

process.stdout.write(lines.join('\n') + '\n');
