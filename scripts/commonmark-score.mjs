// Score the editor against CommonMark's own 650-example spec.
//
//   node scripts/commonmark-score.mjs            # score, by section
//   node scripts/commonmark-score.mjs --misses   # also list what it got wrong
//
// NOT part of scripts/test.sh, on purpose, for two reasons. It downloads the spec (CI should not need
// the network to tell you whether your code works), and the spec is CC-BY-SA while this repo is MIT —
// vendoring it is a licensing decision for the owner, not a thing a test should quietly do. The
// committed gate is test/commonmark.test.cjs; this is the number that tells you where you stand.
//
// What is measured, and what is NOT: this editor is not a renderer. It emits your source text with
// spans around the syntax, so there is no <strong> to diff against the spec's <strong>. So each
// example is reduced to the set of CONSTRUCTS the spec's expected HTML contains, and the engine is
// asked whether it recognised the same ones. An example is a hit when the engine finds every
// construct the spec found and invents none the spec did not.
//
// That is a weaker test than conformance and it should be read as one: it can tell you the engine
// missed a code block, not that it got the code block's contents subtly wrong.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CACHE = path.join(ROOT, '.cache', 'commonmark-spec.json');
const SPEC_URL = 'https://spec.commonmark.org/0.31.2/spec.json';

async function spec() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { /* fetch below */ }
  process.stderr.write(`downloading ${SPEC_URL}\n`);
  const res = await fetch(SPEC_URL);
  if (!res.ok) throw new Error(`spec download failed: ${res.status}`);
  const json = await res.json();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(json));
  return json;
}

// ── the engine, lifted the same way the tests lift it ───────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, 'packages', 'core', 'editor-core.js'), 'utf8');
const grab = (name) => { const i = src.indexOf('function ' + name); return src.slice(i, src.indexOf('\n}', i) + 2); };
const cssmdSrc = fs.readFileSync(path.join(ROOT, 'packages', 'cssmd', 'cssmd.js'), 'utf8')
  .replace(/export\s*\{[\s\S]*?\};?\s*$/, '')
  .replace(/^function escHtml\(s\)[\s\S]*?\n\}\n/m, '');
const highlightMarkdown = new Function(`
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  ${cssmdSrc}
  ${/const FENCE = \/.*?\/;/s.exec(src)[0]}
  ${grab('blockScan')}
  ${grab('highlightLineParts')}
  ${grab('highlightMarkdown')}
  return highlightMarkdown;`)();

// ── the translation table: a spec construct ↔ the class this engine emits for it ────────────────
// Only constructs the engine CLAIMS. Leaving one out would flatter the score; each is listed with
// the HTML the spec produces for it, so the mapping can be argued with.
const MAP = [
  { name: 'heading',    html: /<h[1-6][ >]/,          cls: /\btg-h[1-6]\b/ },
  { name: 'strong',     html: /<strong>/,             cls: /\btg-b\b/ },
  { name: 'emphasis',   html: /<em>/,                 cls: /\btg-i\b/ },
  { name: 'inline code',html: /<code>(?!.*<\/pre>)/s, cls: /\btg-code\b/ },
  { name: 'code block', html: /<pre><code/,           cls: /\btg-cblock\b/ },
  { name: 'list item',  html: /<li>/,                 cls: /\btg-(li|ol)\b/ },
  { name: 'blockquote', html: /<blockquote>/,         cls: /\btg-quote\b/ },
  { name: 'link',       html: /<a href=/,             cls: /\btg-link\b/ },
  { name: 'image',      html: /<img /,                cls: /\btg-img\b/ },
  { name: 'rule',       html: /<hr \/>/,              cls: /\btg-hr\b/ },
];

const s = await spec();
const bySection = new Map();
const misses = [];
for (const ex of s) {
  const html = highlightMarkdown(ex.markdown.replace(/\n$/, ''));
  const wantSet = MAP.filter((m) => m.html.test(ex.html)).map((m) => m.name);
  const gotSet = MAP.filter((m) => m.cls.test(html)).map((m) => m.name);
  const missing = wantSet.filter((n) => !gotSet.includes(n));
  const invented = gotSet.filter((n) => !wantSet.includes(n));
  const hit = !missing.length && !invented.length;
  const b = bySection.get(ex.section) || { hit: 0, n: 0 };
  b.n++; if (hit) b.hit++;
  bySection.set(ex.section, b);
  if (!hit) misses.push({ ex, missing, invented });
}

let hit = 0, n = 0;
const rows = [...bySection.entries()].sort((a, b) => (a[1].hit / a[1].n) - (b[1].hit / b[1].n));
for (const [name, b] of rows) {
  hit += b.hit; n += b.n;
  const pct = Math.round((b.hit / b.n) * 100);
  const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '·');
  console.log(`${String(pct).padStart(3)}%  ${bar}  ${String(b.hit).padStart(3)}/${String(b.n).padEnd(3)}  ${name}`);
}
console.log(`\n${hit}/${n} examples (${Math.round((hit / n) * 100)}%) — construct recognition, not conformance.`);

if (process.argv.includes('--misses')) {
  console.log('\n— misses —');
  for (const m of misses.slice(0, 60)) {
    console.log(`\n[${m.ex.section} #${m.ex.example}] missing:${m.missing.join(',') || '-'} invented:${m.invented.join(',') || '-'}`);
    console.log(JSON.stringify(m.ex.markdown).slice(0, 120));
  }
  if (misses.length > 60) console.log(`\n…and ${misses.length - 60} more`);
}
