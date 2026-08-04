// Emphasis, scored against CommonMark's own Emphasis section — an A/B between the old regex and the
// new tokeniser, on the same ruler.
//
//   node scripts/emphasis-conformance.mjs           # the two numbers
//   node scripts/emphasis-conformance.mjs --misses  # every example the tokeniser still gets wrong
//   node scripts/emphasis-conformance.mjs --regress # only what the OLD one got right and the new one does not
//
// This is a REAL conformance check, unlike scripts/commonmark-score.mjs: emphasis produces `<em>` and
// `<strong>` in the spec's expected HTML, and this renderer's spans map onto exactly those two, so
// the output can be compared rather than merely counted. That makes it the right ruler for this one
// construct and the wrong one for every other — a code block here has no comparable form.
//
// NOT in scripts/test.sh, same two reasons as the score: it needs the spec (network on a cold cache)
// and the spec is CC-BY-SA while this repo is MIT. The committed gate is test/emphasis.test.cjs,
// whose cases were CHOSEN by running this.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CACHE = path.join(ROOT, '.cache', 'commonmark-spec.json');
const SPEC_URL = 'https://spec.commonmark.org/0.31.2/spec.json';
const SECTION = 'Emphasis and strong emphasis';

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

// Lift the REAL renderer — highlightLineParts with cssmd inlined, exactly as the builds assemble it.
// An earlier version of this script ran the cssmd passes alone, which made it blind to the passes
// that live in the core (autolink, links, tags): a change to their ORDER moved nothing here while
// moving plenty in the product. A ruler that cannot see the change you are making is not a ruler.
//
// TWO copies — the working tree and the last commit — so the comparison is always "what I just
// changed" against "what shipped". Carrying a frozen copy of the old implementation in the source
// would have been the other way to A/B, and it would have rotted into dead code the first time
// nobody updated it.
const CORE = 'packages/core/editor-core.js';
const CSSMD = 'packages/cssmd/cssmd.js';

function lift(coreSrc, cssmdSrc) {
  const inlined = cssmdSrc
    .replace(/export\s*\{[\s\S]*?\};?\s*$/, '')                     // drop the ESM export footer
    .replace(/^function escHtml\(s\)[\s\S]*?\n\}\n/m, '');          // the core has its own escHtml
  const L = coreSrc.split('\n');
  const esc = L.find((l) => l.startsWith('function escHtml'));
  const s = L.findIndex((l) => l.startsWith('function highlightLineParts'));
  let e = s;
  for (let i = s + 1; i < L.length; i++) if (L[i] === '}') { e = i; break; }
  return new Function(esc + '\n' + inlined + '\n' + L.slice(s, e + 1).join('\n') +
    '\nreturn highlightLineParts;')();
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const atHead = (rel) => execFileSync('git', ['-C', ROOT, 'show', `HEAD:${rel}`], { encoding: 'utf8', maxBuffer: 8 << 20 });

const now = lift(read(CORE), read(CSSMD));
let before = null;
try { before = lift(atHead(CORE), atHead(CSSMD)); } catch {
  process.stderr.write('⚠️  cannot read HEAD — reporting the working tree alone, with no baseline\n');
}

// The renderer's spans, turned back into the spec's tags. `-mk` spans hold the raw delimiters, which
// the spec's HTML does not contain at all, so they are dropped whole; the effect spans map 1:1.
// Everything else this engine emits (links, tags, dates) has no spec counterpart and is dropped to
// its text, which is why an example containing one is a miss for reasons that are not emphasis.
function toSpecHtml(html) {
  const MAP = { 'tg-b': 'strong', 'tg-i': 'em', 'tg-code': 'code' };
  const stack = [];
  return html
    // An autolink is the one construct here whose spec form is recoverable exactly — `<url>` becomes
    // `<a href="url">url</a>` with no lookup and no ambiguity — so it is mapped rather than dropped.
    // Without this, examples 480/481 read as emphasis failures when what actually happens is that
    // the emphasis is correctly refused and the harness cannot draw the link. Links proper are still
    // dropped to their text: their spec form needs a destination this pass does not resolve.
    .replace(/<span class="tg-link"><span class="tg-mk">&lt;<\/span>(.*?)<span class="tg-mk">&gt;<\/span><\/span>/g,
      (m, url) => `<a href="${url}">${url}</a>`)
    .replace(/<span class="tg-mk">.*?<\/span>/g, '')
    .replace(/<span class="([^"]*)">|<\/span>/g, (m, cls) => {
      if (cls === undefined) { const t = stack.pop(); return t ? '</' + t + '>' : ''; }
      const t = MAP[cls];
      stack.push(t || '');
      return t ? '<' + t + '>' : '';
    });
}

// One markdown line is one call, because one line is one <div> in this editor. `block` is left
// undefined: every Emphasis example is ordinary paragraph text, and blockScan's verdicts are a
// different construct's question.
const pipeline = (hlp) => (md) => md.split('\n').map((line) => hlp(line).inner).join('\n');

const NEW = pipeline(now);
const OLD = before ? pipeline(before) : null;

// The spec wraps a paragraph; this renderer emits the inline run alone.
const norm = (s) => s.replace(/\s+$/, '');
const wrap = (s) => '<p>' + s + '</p>';

const json = await spec();
const cases = json.filter((e) => e.section === SECTION);
if (!cases.length) throw new Error(`no examples in section "${SECTION}" — did the spec change?`);

const rows = cases.map((e) => {
  const want = norm(e.html);
  const md = e.markdown.replace(/\n$/, '');
  return {
    n: e.example, md, want,
    old: OLD ? wrap(toSpecHtml(OLD(md))) === want : false,
    neu: wrap(toSpecHtml(NEW(md))) === want,
    got: wrap(toSpecHtml(NEW(md))),
  };
});

// The round trip is the load-bearing guarantee, so assert it here too: whatever the tokeniser does
// to the meaning, the characters must come back. A conformance win bought with a lost character
// would be a regression wearing a win's clothes.
// escHtml ran on the way in, so undo exactly the three entities it emits before comparing.
const textOf = (html) => html.replace(/<[^>]*>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const broken = rows.filter((r) => textOf(NEW(r.md)) !== r.md);

const oldN = rows.filter((r) => r.old).length;
const newN = rows.filter((r) => r.neu).length;
const gained = rows.filter((r) => r.neu && !r.old);
const lost = rows.filter((r) => r.old && !r.neu);

if (process.argv.includes('--misses')) {
  for (const r of rows.filter((r) => !r.neu)) {
    console.log(`\n── example ${r.n} ${r.old ? '⚠️ REGRESSED' : ''}\n   md   ${JSON.stringify(r.md)}\n   want ${r.want}\n   got  ${r.got}`);
  }
}
if (process.argv.includes('--regress')) {
  for (const r of lost) console.log(`\n── example ${r.n}\n   md   ${JSON.stringify(r.md)}\n   want ${r.want}\n   got  ${r.got}`);
}

const pct = (n) => ((n / cases.length) * 100).toFixed(1);
console.log(`\n${SECTION} — ${cases.length} examples`);
if (OLD) console.log(`  HEAD           ${oldN}  (${pct(oldN)}%)`);
console.log(`  working tree   ${newN}  (${pct(newN)}%)` + (OLD ? `   +${gained.length} / -${lost.length}` : ''));
if (lost.length) console.log(`  🔴 ${lost.length} regression(s) — run with --regress`);
if (broken.length) console.log(`\n🔴 ${broken.length} example(s) do NOT round-trip: ${broken.map((r) => r.n).join(', ')}`);
else console.log(`  round trip exact on all ${cases.length}`);
