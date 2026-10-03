// sitetile author-text run cost — text a page's author writes must cost one read on the render path,
// not one read per word or per opener, and must never make a page fail to render.
//   run: node packages/sitetile/author-text-run-cost.test.mjs
//
// 🩸 Why this file exists. The link and image parsers in site-core.js were made linear in an earlier
// change (bracket-run-cost.test.mjs). The same shape — a regex that re-reads the rest of the text from
// every candidate start — was still on the render path in the places below, each reachable from text
// any page author can type:
//   - parseParams, a section's `%% sitetile: <type> … %%` line: one `new RegExp` built per bare word,
//     each run over the whole line, and `(\w+)=` re-read every long word from each of its letters.
//     A bare word of about 33,000 letters made the built pattern too large for the engine: a
//     SyntaxError, and the whole page failed to render.
//
// The same two rulers as the other *-run-cost tests:
//   1. SAME ANSWER — each replaced implementation is kept below, verbatim, as the reference, and an
//      uneven random corpus is read by both. Any difference is a failure.
//   2. LINEAR COST — each path is timed in CPU time at n and at 8n. From n to 8n linear work grows 8×
//      and quadratic work 64×. The limit is 22×, the geometric middle (√(8·64) ≈ 22.6): a linear path
//      has to be slowed 2.8× more at 8n than at n to cross it, and a quadratic one sped up 2.9× to
//      pass. The earlier files allowed max(8, 2 × the control's growth) from n to 4n, where a
//      quadratic path reads 15–21× — only about twice the limit, and a noisy control could raise the
//      limit to meet it. Here the control (the same path on text it has nothing to re-read in) is shown beside the
//      reading but does not move the limit. Sizes keep the replaced code's slowest reading near a
//      second, so putting it back is a red line, not a run that never ends.
// Each ruler is shown to fire: the controls at the bottom time a replaced implementation itself, and
// hand the same-answer ruler near-miss rewrites; both must go red.

import assert from 'node:assert/strict';
import * as core from './site-core.js';

const { parseParams } = core;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + String(e && e.message ? e.message : e).slice(0, 600)); process.exitCode = 1; }
}

const SAMPLES = Number(process.env.SITETILE_AUTHOR_TEXT_SAMPLES || 20000);
let seed = 271828183;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = (alphabet, max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += pick(alphabet); return s; };

// Characters that must pass through a run untouched: `\s` inside and outside ASCII, next to look-alikes
// `\s` does not match (U+200B, U+0085, U+180E); CJK; a surrogate pair and a lone surrogate.
const SPACE = [' ', ' ', ' ', '\t', '\n', '\r', '\u3000', '\u00a0', '\u2028', '\ufeff', '\u2003', '\v', '\f', '\u200b', '\u0085', '\u180e'];

// ── the code that was replaced, verbatim ────────────────────────────────────────────────────────
function refParseParams(raw) {
  const map = {};
  if (!raw) return map;
  const re = /(\w+)=("[^"]*"(?:→\S+)?|\S+)/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1]; const val = m[2];
    if (val.charAt(0) === '"') {
      const lm = /^"([^"]*)"(?:→(\S+))?$/.exec(val);
      if (lm) map[key] = lm[2] !== undefined ? { label: lm[1], href: lm[2] } : lm[1];
      else map[key] = val;
    } else map[key] = val;
  }
  const bare = raw.replace(/"[^"]*"(?:→\S+)?/g, (q) => ' '.repeat(q.length));
  let bm; const bre = /(?:^|\s)([a-zA-Z]\w*)(?=\s|$)/g;
  while ((bm = bre.exec(bare))) {
    const w = bm[1];
    if (!(w in map) && !new RegExp('\\b' + w + '\\s*=').test(bare)) map[w] = true;
  }
  return map;
}

// ── inputs ──────────────────────────────────────────────────────────────────────────────────────
// A param line: keys, values, quoted labels with and without `→href`, bare flags, and everything that
// can break a word or a value. The prototype's own names are here because the map is a plain object:
// `x in map` is true for `constructor` before anyone sets it, and `__proto__=` writes the prototype.
const PARAM_WORD = ['cols', 'wide', 'ordered', 'layout', 'a', 'A1', '_x', 'x_y', '9', '9a', 'w0', 'cta', 'button',
  'constructor', 'toString', '__proto__', 'hasOwnProperty', '中文', 'é', 'wide2', 'Wide'];
const PARAM_TOKEN = [...PARAM_WORD, '=', '=', '=', '"', '"', '→', '-', ',', '.', '/x', '#y', 'https://e.com/a?b=c', '"Go wide now"',
  '"a b"→/x', '""', '"→', '\\"', '==', '=3', '"x"y'];
function paramLine() {
  const r = rnd();
  if (r < 0.01) return '';
  if (r < 0.03) return pick(SPACE).repeat(1 + Math.floor(rnd() * 4));
  if (r < 0.06) return pick(PARAM_WORD).repeat(1 + Math.floor(rnd() * 300)) + pick(['', '=', '=1', ' ', ' = 2']);   // a long word
  if (r < 0.45) {                                                       // what a section line looks like
    let s = pick(['', ' ', 'layout=split ']);
    for (let n = Math.floor(rnd() * 6); n > 0; n--) {
      const k = pick(PARAM_WORD);
      s += pick([
        () => k + '=' + pick(['3', 'split', 'a=b', '"' + words(['x', ' ', 'wide', '中', '=', 'a b'], 4) + '"', '"Go"→/a', '"x"→', '']),
        () => k + pick(['', ' ', '  ', '\t']) + '=' + pick([' 1', '1']),
        () => k,
      ])() + pick([' ', ' ', '  ', '\t', '\u3000', '\u00a0', '', ',']);
    }
    return s;
  }
  return words([...PARAM_TOKEN, ...SPACE], rnd() < 0.9 ? 16 : 120);
}
// A map's own entries and, when `__proto__=` replaced it, its prototype's: deepEqual alone would
// compare the two prototypes by identity.
const snapshot = (m) => {
  const proto = Object.getPrototypeOf(m);
  return JSON.stringify([Object.entries(m), proto === Object.prototype ? 'Object.prototype' : proto && Object.entries(proto), Object.keys(m).map((k) => typeof m[k])]);
};

// ── ruler 1: same answer ───────────────────────────────────────────────────────────────────────
const params = Array.from({ length: SAMPLES }, paramLine);

test('parseParams reads a param line exactly as before', () => {
  let flags = 0, keys = 0;
  for (const raw of params) {
    assert.equal(snapshot(parseParams(raw)), snapshot(refParseParams(raw)), JSON.stringify(raw));
    const want = refParseParams(raw);
    if (Object.values(want).includes(true)) flags++;
    if (Object.values(want).some((v) => v !== true)) keys++;
  }
  // 🔴 A differential test over inputs that never take a branch proves nothing about it.
  assert.ok(flags > SAMPLES / 10 && keys > SAMPLES / 10, 'the samples carry both flags (' + flags + ') and keys (' + keys + ')');
});

test('a bare word too long to fit in a pattern is a flag, and the page still renders', () => {
  for (const n of [33000, 40000, 100000]) {
    const w = 'w'.repeat(n);
    assert.deepEqual({ ...parseParams('layout=split ' + w + ' wide') }, { layout: 'split', [w]: true, wide: true }, n + ' letters');
    assert.deepEqual({ ...parseParams(w + '=3 ' + w) }, { [w]: '3' }, n + ' letters, also a key');
  }
  // the same reading as a short word, so length is the only thing that changed
  assert.deepEqual({ ...parseParams('layout=split www wide') }, { layout: 'split', www: true, wide: true });
  const md = '---\nsitetile-page: home\ntitle: T\n---\n\n## G\n%% sitetile: grid cols=2 ' + 'w'.repeat(40000) + ' %%\n### A\nx\n';
  const html = core.renderSiteToHtml(core.parseSite(md));
  assert.ok(/<section/.test(html), 'renderSiteToHtml returned a page');
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
function growth(run, make, n, control) {
  const subject = [make(n), make(8 * n)];
  const ctl = control ? [control(n), control(8 * n)] : null;
  const s = [Infinity, Infinity], c = [Infinity, Infinity];
  let grew = Infinity, rounds = 0;
  while (rounds < 2 || (rounds < 5 && grew > LIMIT)) {
    for (let i = 0; i < 2; i++) {
      if (ctl) c[i] = Math.min(c[i], perCall(() => run(ctl[i])));
      s[i] = Math.min(s[i], perCall(() => run(subject[i])));
    }
    rounds++;
    grew = s[1] / s[0];
  }
  const said = 'grew ' + grew.toFixed(1) + '× from n to 8n (limit ' + LIMIT + '×) after ' + rounds + ' rounds; CPU ms per call at n / 8n: ' +
    show(s) + (ctl ? ', its control ' + show(c) + ' (' + (c[1] / c[0]).toFixed(1) + '×)' : '');
  if (process.env.SITETILE_AUTHOR_TEXT_VERBOSE) console.log('    ' + said);
  return { grew, said };
}

const keyedLater = (k, tail) => Array.from({ length: k }, (_, i) => 'w' + (i % 50) + tail).join(' ') + ' ' + Array.from({ length: 50 }, (_, i) => 'w' + i + ' =').join(' ');
const PATHS = [
  // [name, n, (n) → input, what consumes it, (n) → its control: the same path on text it has nothing to re-read in]
  ['parseParams: one long bare word', 2000, (k) => 'cols=2 ' + 'w'.repeat(k), parseParams, (k) => 'cols=2 ' + 'w x'.repeat(k / 3)],
  ['parseParams: one long word with no `=`, among keys', 2000, (k) => 'cols=2 ' + 'w'.repeat(k) + '-x', parseParams, (k) => 'cols=2 ' + 'w-'.repeat(k / 2)],
  // Bare words, each written again at the end of the line as a `key =` (with the space, so it is not a
  // value): none is a flag, the map stays empty, and the replaced code built and ran a pattern for
  // every one of them, each reading the line up to that word's last appearance. Fifty names in turn,
  // so the reading is the scan rather than a set of thousands of different strings outgrowing a cache.
  ['parseParams: many bare words, each a key later on the line', 1000, (k) => keyedLater(k, ''), parseParams, (k) => keyedLater(k, '-')],
];
for (const [name, n, make, run, control] of PATHS) {
  test(name + ' grows linearly (n = ' + n.toLocaleString('en-US') + ')', () => {
    const { grew, said } = growth(run, make, n, control);
    assert.ok(grew <= LIMIT, said);
  });
}

// ── controls: both rulers fire ─────────────────────────────────────────────────────────────────
test('control: the cost ruler goes red on the code it replaced', () => {
  // The replaced parseParams itself, on the inputs above (a long word stays under the size that throws).
  const { grew, said } = growth(refParseParams, (k) => 'cols=2 ' + 'w'.repeat(k), 1500);
  assert.ok(grew > LIMIT, 'the replaced parseParams ' + said);
});
test('control: the same-answer ruler goes red on a near-miss rewrite', () => {
  // A flag scan that forgets a key may have space before its `=` (`cols =2` is not a flag `cols`).
  const tight = (raw) => {
    const m = refParseParams(raw);
    const bare = raw.replace(/"[^"]*"(?:→\S+)?/g, (q) => ' '.repeat(q.length));
    for (const k of new Set([...bare.matchAll(/\b([a-zA-Z]\w*)\s+=/g)].map((x) => x[1]))) {
      if (!(k in m) && !new RegExp('\\b' + k + '=').test(bare) && new RegExp('(?:^|\\s)' + k + '(?=\\s|$)').test(bare)) m[k] = true;
    }
    return m;
  };
  let missed = 0;
  for (const raw of params) if (snapshot(tight(raw)) !== snapshot(refParseParams(raw))) missed++;
  // and one that reads flags out of the quoted labels again
  let quoted = 0;
  for (const raw of params) {
    const m = refParseParams(raw.replace(/"/g, ' '));
    if (snapshot(m) !== snapshot(refParseParams(raw))) quoted++;
  }
  assert.ok(missed && quoted, 'each near-miss is caught (' + [missed, quoted] + ')');
});

console.log('\nsitetile author-text run cost: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
