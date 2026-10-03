// cssmd emphasis run cost — a line of closers that can never match must cost one walk, not one walk
// per closer.
//   run: node test/emphasis-run-cost.test.mjs
//
// 🩸 Why this file exists. markEmphasis's "process emphasis" pass looks left from each closer for an
// opener. When it found none it had walked to the start of the line, and the next closer of the same
// kind walked the same way again: `a* a* a* …`, `a_ a_ …`, `a** …` cost one walk per closer, quadratic,
// on every prose paragraph of every site that renders through cssmd. The pass now keeps the spec's
// openers_bottom — per kind of closer, the point below which no opener can serve it.
//
// The same two rulers as packages/sitetile/*-run-cost.test.mjs:
//   1. SAME ANSWER — the replaced pass is kept below, verbatim, and put back into a copy of the module
//      as it is now. The scanner and the serializer are shared, so the copy and the module differ in
//      exactly the pass this change touched. An uneven random corpus is rendered by both; any
//      difference is a failure.
//   2. LINEAR COST — each path is timed in CPU time at n and at 8n. Linear work grows 8× and quadratic
//      work 64×; the limit is 22×, the geometric middle (√(8·64) ≈ 22.6), with about 2.8× of room on
//      each side. The control beside each reading (the same path carrying letters) does not move the
//      limit. Sizes keep the replaced pass's slowest reading under a second, so putting it back is a
//      red line, not a run that never ends.
// Each ruler is shown to fire: the controls at the bottom time the replaced pass itself, and hand the
// same-answer ruler near-miss rewrites; both must go red.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cssmd from '../packages/cssmd/cssmd.js';
import { inlineHtml } from '../packages/sitetile/site-core.js';

let passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log('  ✓ ' + name); },
    (e) => { console.error('  ✗ ' + name + '\n    ' + String(e && e.message ? e.message : e).slice(0, 600)); process.exitCode = 1; });
}

// ── the pass that was replaced, verbatim ────────────────────────────────────────────────────────
function processEmphasis(nodes) {
  let ci = 0;
  while (ci < nodes.length) {
    const closer = nodes[ci];
    if (closer.t !== 'd' || !closer.canClose || closer.n === 0) { ci++; continue; }
    let oi = -1;
    for (let k = ci - 1; k >= 0; k--) {
      const o = nodes[k];
      if (o.t !== 'd' || o.n === 0 || o.ch !== closer.ch || !o.canOpen) continue;
      // The spec's "rule of 3": when either side of the pair could play both parts, a match whose
      // combined ORIGINAL run lengths is a multiple of 3 is refused — unless both lengths are. It
      // reads like numerology and is not: it is what makes `*a**b**c*` an italic containing a bold
      // rather than the other way round.
      if ((closer.canOpen || o.canClose) && (closer.orig + o.orig) % 3 === 0 &&
          !(closer.orig % 3 === 0 && o.orig % 3 === 0)) continue;
      oi = k; break;
    }
    if (oi < 0) { ci++; continue; }
    const opener = nodes[oi];
    const use = (closer.n >= 2 && opener.n >= 2) ? 2 : 1;   // two delimiters is strong, one is em
    const kids = nodes.slice(oi + 1, ci);
    opener.n -= use; closer.n -= use;
    nodes.splice(oi + 1, ci - oi - 1, { t: 'e', use: use, mark: closer.ch.repeat(use), kids: kids });
    ci = oi + 2;                                  // the closer moved here; it may still have length
  }
}

// The module's source with its processEmphasis swapped for `pass`, loaded as a module of its own.
const SOURCE = readFileSync(new URL('../packages/cssmd/cssmd.js', import.meta.url), 'utf8');
async function withPass(pass) {
  const start = SOURCE.indexOf('\nfunction processEmphasis(nodes) {');
  const end = SOURCE.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('cssmd.js has no top-level `function processEmphasis(nodes) {…}` to swap');
  const text = SOURCE.slice(0, start + 1) + pass + SOURCE.slice(end + 2);
  return import('data:text/javascript,' + encodeURIComponent(text));
}
// A copy of the module as it is now, edited: each [find, replace] must be found, or this throws.
async function edited(...edits) {
  let text = SOURCE;
  for (const [find, replace] of edits) {
    if (!text.includes(find)) throw new Error('cssmd.js no longer contains ' + JSON.stringify(find));
    text = text.replace(find, replace);
  }
  return import('data:text/javascript,' + encodeURIComponent(text));
}
const ref = await withPass(processEmphasis.toString());

// ── inputs: emphasis-shaped text, uneven on purpose ─────────────────────────────────────────────
const SAMPLES = Number(process.env.CSSMD_EMPHASIS_SAMPLES || 20000);
let seed = 314159265;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = (alphabet, max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += pick(alphabet); return s; };
const ch = (...cps) => String.fromCharCode(...cps);
// Delimiter runs of every length and both characters, and what decides how they flank: letters,
// digits, `\s` in and out of ASCII, punctuation and symbols (ASCII and not), CJK, an emoji and a lone
// surrogate, escapes, code spans (opaque to this pass) and the markup a caller injects before it.
const DELIM = ['*', '*', '**', '***', '****', '_', '_', '__', '___'];
const TEXT = ['a', 'b', 'x y', 'foo', '9', 'é', '中文', '漢字', '😀', ch(0xd83d), ' ', ' ', '\t', ch(0xa0), ch(0x3000), ch(0x2003),
  '.', ',', '!', '(', ')', '"', "'", '-', '«', '€', '\\*', '\\_', '\\\\', '`', '`*`', '`a_b`', 'snake_case', 'a_b_c', '&', '<', '>',
  '[x](y)'];
function sample() {
  const r = rnd();
  if (r < 0.01) return '';
  if (r < 0.06) return pick(['', 'x', ' ']) + (pick(['a* ', 'a_ ', 'a** ', '*a ', '_a ', 'a*a', '*a* ', '**a* ', 'a*** ', ' * '])).repeat(1 + Math.floor(rnd() * 100));
  if (r < 0.75) {
    let s = '';
    for (let n = 1 + Math.floor(rnd() * 8); n > 0; n--) s += rnd() < 0.5 ? pick(DELIM) : words(TEXT, 3);
    return s;
  }
  return words([...DELIM, ...TEXT], rnd() < 0.9 ? 20 : 200);
}
const corpus = Array.from({ length: SAMPLES }, sample);
// markup a caller wraps around block markers before this pass runs (an editor's bullet, a code span)
const injected = (s) => pick(['', '<span class="tg-mk">* </span>', '<span class="tg-mk">_</span>', '<b>*</b>']) + cssmd.escHtml(s) +
  pick(['', '<span class="tg-code">*</span>', '<i>_a</i>', '<span>']);

// ── ruler 1: same answer ───────────────────────────────────────────────────────────────────────
await test('markEmphasis renders every sample exactly as the replaced pass did', () => {
  let em = 0, strong = 0, literal = 0;
  for (const s of corpus) {
    const want = ref.renderInlineMd(s);
    assert.equal(cssmd.renderInlineMd(s), want, JSON.stringify(s));
    const html = injected(s);
    assert.equal(cssmd.markEmphasis(html, 'gd'), ref.markEmphasis(html, 'gd'), JSON.stringify(html));
    if (want.includes('-i"')) em++;
    if (want.includes('-b"')) strong++;
    if (/[*_]/.test(want.replace(/<[^>]*>[*_]+<\/span>/g, ''))) literal++;
  }
  // 🔴 A differential test over inputs that never take a branch proves nothing about it.
  for (const [k, v] of Object.entries({ em, strong, literal })) assert.ok(v > SAMPLES / 20 && v < SAMPLES * 0.95, 'the samples exercise "' + k + '" both ways (' + v + ')');
});

// ── ruler 2: linear cost ───────────────────────────────────────────────────────────────────────
// CPU milliseconds this process has used, not the wall clock: on a busy machine a wall-clock reading
// counts the time spent waiting for a core.
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
// CPU milliseconds per call: calls repeated until 20 ms have been spent, so a fast one is not read off
// the clock's resolution, and the best of three such readings, so a garbage collection landing in one
// of them does not count. A call slow enough to fill 100 ms alone is read once.
function perCall(fn) {
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = cpuMs();
    let reps = 0, ms;
    do { fn(); reps++; ms = cpuMs() - t; } while (ms < 20);
    best = Math.min(best, ms / reps);
    if (ms > 100) break;
  }
  return best;
}
const LIMIT = 22;
const show = (a) => a.map((v) => v.toFixed(3)).join(' / ');
// How much a path's time grows from n to 8n: the best reading per size over two rounds, and up to three
// more while it is over the limit. Load only ever slows a reading down, so more rounds can only bring
// a linear path back under; a quadratic one stays over however many.
function growth(run, unit, n) {
  const subject = [unit.repeat(n), unit.repeat(8 * n)];
  const control = [subject[0].replace(/[^ ]/g, 'x'), subject[1].replace(/[^ ]/g, 'x')];
  const s = [Infinity, Infinity], c = [Infinity, Infinity];
  let grew = Infinity, rounds = 0;
  while (rounds < 2 || (rounds < 5 && grew > LIMIT)) {
    for (let i = 0; i < 2; i++) {
      c[i] = Math.min(c[i], perCall(() => run(control[i])));
      s[i] = Math.min(s[i], perCall(() => run(subject[i])));
    }
    rounds++;
    grew = s[1] / s[0];
  }
  const said = 'grew ' + grew.toFixed(1) + '× from n to 8n (limit ' + LIMIT + '×) after ' + rounds + ' rounds; CPU ms per call at n / 8n: ' +
    show(s) + ', the same path carrying letters ' + show(c) + ' (' + (c[1] / c[0]).toFixed(1) + '×)';
  if (process.env.CSSMD_EMPHASIS_VERBOSE) console.log('    ' + said);
  return { grew, said };
}
const PATHS = [
  // [repeated unit, n, what consumes it]
  ['a* ', 1000, cssmd.renderInlineMd],          // closers only: `*` after a letter, before a space
  ['a_ ', 1000, cssmd.renderInlineMd],
  ['a** ', 1000, cssmd.renderInlineMd],
  ['a*** ', 1000, cssmd.renderInlineMd],
  ['a*a', 1000, cssmd.renderInlineMd],           // intraword: each `*` can open and close
  ['a* ', 1000, inlineHtml],                     // the site renderer's inline path
  ['*a* ', 1000, cssmd.renderInlineMd],          // pairs, which already folded as they went
];
for (const [unit, n, run] of PATHS) {
  await test('`' + unit + '` repeated, through ' + run.name + ', grows linearly (n = ' + n.toLocaleString('en-US') + ')', () => {
    const { grew, said } = growth(run, unit, n);
    assert.ok(grew <= LIMIT, said);
  });
}

// ── controls: both rulers fire ─────────────────────────────────────────────────────────────────
await test('control: the cost ruler goes red on the pass it replaced', () => {
  const { grew, said } = growth(ref.renderInlineMd, 'a* ', 1000);
  assert.ok(grew > LIMIT, 'the replaced pass ' + said);
});
await test('control: the same-answer ruler goes red on a near-miss rewrite', async () => {
  // A floor shared by closers that differ in the rule of 3 (length mod 3), and one shared by closers
  // that differ in whether they can also open: each lets one closer's failure hide an opener another
  // could have used.
  const kind = "const kind = closer.ch + (closer.canOpen ? '1' : '0') + (closer.orig % 3);";
  const noMod3 = await edited([kind, "const kind = closer.ch + (closer.canOpen ? '1' : '0');"]);
  const noOpen = await edited([kind, 'const kind = closer.ch + (closer.orig % 3);']);
  // …and floors left where they were when a fold moved the nodes above them left.
  const unmoved = await edited(['for (const k in floor) if', 'if (false) for (const k in floor) if']);
  let mod3 = 0, open = 0, moved = 0;
  for (const s of corpus) {
    const want = ref.renderInlineMd(s);
    if (noMod3.renderInlineMd(s) !== want) mod3++;
    if (noOpen.renderInlineMd(s) !== want) open++;
    if (unmoved.renderInlineMd(s) !== want) moved++;
  }
  if (process.env.CSSMD_EMPHASIS_VERBOSE) console.log('    near-misses differ on ' + [mod3, open, moved].join(' / ') + ' of ' + SAMPLES + ' samples');
  assert.ok(mod3 && open && moved, 'each near-miss is caught (' + [mod3, open, moved] + ')');
});

console.log('\ncssmd emphasis run cost: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
