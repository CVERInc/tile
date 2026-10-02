// sitetile render-path run cost — a long run must cost what its length costs, not its square (or cube).
//   run: node render-run-cost.test.mjs
//
// 🩸 Why this file exists. Three places on the render path re-read a run of characters once for each
// character in it: the blank-line trim in `firstImage` (cubic — 2,000 blank lines after a gallery
// image cost seconds), the table-separator regex (`|-` + a long run of spaces), and the ATX heading
// regex (`#` + a long run of spaces). Each was replaced by code that reads the run once.
//
// The same two rulers as whitespace-run-cost.test.mjs, for the same reasons:
//   1. SAME ANSWER — the replaced regexes are kept below as the reference and compared against on
//      generated lines where both verdicts are common.
//   2. LINEAR COST — each shape is rendered next to the same page carrying letters instead, and held
//      to max(FLOOR_MS, 10 × control). The sizes are chosen so the replaced code misses that budget
//      many times over, and so that a regression is a red line, not a run that never finishes.

import assert from 'node:assert/strict';
import { parseSite, renderSiteToHtml, firstImage, bodyHtml, inlineHtml } from './site-core.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const SAMPLES = Number(process.env.SITETILE_RENDER_SAMPLES || 20000);
let seed = 577215664;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = (alphabet, max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += pick(alphabet); return s; };

const FM = '---\nsitetile-page: home\ntitle: T\n---\n\n';
const render = (md) => renderSiteToHtml(parseSite(md));
const prose = (body) => FM + '## T\n\n' + body + '\n';

// ── the regexes that were replaced, verbatim ────────────────────────────────────────────────────
const REF_SEP = /^\s*\|\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const REF_HEADING = /^(#{1,6})\s+(.*\S)\s*$/;
const refRest = (text, matchStr) => text.replace(matchStr, '').replace(/^\s*\n/, '').replace(/\n\s*\n\s*$/, '\n').trim();

// `\s` that a line can still hold, plus look-alikes it does not match (U+200B, U+0085).
const WS = [' ', ' ', '\t', '\r', ' ', '　', '﻿', ' ', '\v', '\f', '​', '\u0085'];

// ── ruler 1: same answer ───────────────────────────────────────────────────────────────────────
test('a table separator is recognized exactly as the regex it replaced did', () => {
  const cell = () => words(WS, 2) + pick(['', ':']) + pick(['-', '--', '---', '---', '']) + pick(['', ':']) + words(WS, 2);
  let yes = 0;
  for (let n = 0; n < SAMPLES; n++) {
    let sep = words(WS, 2) + pick(['|', '|', '|', '|', '', '-']) + cell();
    for (let c = Math.floor(rnd() * 3); c > 0; c--) sep += '|' + cell();
    sep += pick(['', '', '', '|', '|', '||', 'x']) + words(WS, 2);
    if (/\n/.test(sep)) continue;
    const want = REF_SEP.test(sep);
    if (want) yes++;
    // Through the renderer: the separator decides whether `| a | b |` above it starts a table.
    const html = bodyHtml('| a | b |\n' + sep + '\n| c | d |');
    const table = html.includes('<thead>');
    assert.equal(table, want, JSON.stringify(sep));
  }
  assert.ok(yes > SAMPLES / 10 && yes < SAMPLES * 0.9, 'both verdicts are common (' + yes + ' of ' + SAMPLES + ' are separators)');
});

test('an ATX heading is read exactly as the regex it replaced did', () => {
  let yes = 0;
  for (let n = 0; n < SAMPLES; n++) {
    const line = pick(['#', '##', '###', '####', '######', '#######', '', ' #']) + words(WS, 3) + words(['a', 'b c', '#', ...WS], 4);
    if (/\n/.test(line)) continue;
    const m = REF_HEADING.exec(line);
    const html = bodyHtml(line);
    if (m) {
      yes++;
      const lv = m[1].length;
      const inner = inlineHtml(m[2]);
      assert.equal(html, inner.trim() ? '<h' + lv + '>' + inner + '</h' + lv + '>' : '', JSON.stringify(line));
    } else {
      assert.ok(!/<h[1-6]>/.test(html), JSON.stringify(line) + ' is not a heading');
    }
  }
  assert.ok(yes > SAMPLES / 10 && yes < SAMPLES * 0.9, 'both verdicts are common (' + yes + ' of ' + SAMPLES + ' are headings)');
});

test('a gallery image leaves the same caption the trim chain it replaced left', () => {
  const A = ['x', 'y z', '\n', '\n', '\n\n', ' ', '\t', '　', '\r', ' '];   // one image per sample: firstImage takes the first one
  let trimmed = 0;
  for (let n = 0; n < SAMPLES; n++) {
    const img = pick(['![a](/i.jpg)', '![[p/q.png]]']);
    const text = words(A, 4) + img + words(A, 6);
    const got = firstImage(text);
    assert.equal(got.rest, refRest(text, img), JSON.stringify(text));
    if (refRest(text, img) !== text.replace(img, '')) trimmed++;
  }
  assert.ok(trimmed > SAMPLES / 5, 'the samples have whitespace at their ends to trim (' + trimmed + ')');
});

// ── ruler 2: linear cost ───────────────────────────────────────────────────────────────────────
const FLOOR_MS = 2000;
const spent = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
function within(make, n) {
  const control = Math.min(spent(() => render(make('x'.repeat(n)))), spent(() => render(make('x'.repeat(n)))));
  const budget = Math.max(FLOOR_MS, control * 10);
  const subject = make(null);
  let ms = spent(() => render(subject));
  if (ms > budget && ms < budget * 4) ms = Math.min(ms, spent(() => render(subject)));
  return { ms, budget, control };
}
const SHAPES = [
  // Cubic before: kept small so a regression is seconds of red, not a render that never ends.
  ['blank lines after a gallery image', 3000, (f, n) => FM + '## G\n%% sitetile: gallery %%\n### A\n![a](/i.jpg)\nx' + (f || '\n'.repeat(n)) + ' y\n'],
  ['spaces in a table separator', 100000, (f, n) => prose('| a | b |\n|-' + (f || ' '.repeat(n)) + 'x\n| c | d |')],
  ['spaces after a heading marker', 200000, (f, n) => prose('#' + (f || ' '.repeat(n)) + '\nafter')],
  ['spaces and a carriage return after a heading marker', 200000, (f, n) => prose('#' + (f || ' '.repeat(n / 2) + '\r' + ' '.repeat(n / 2)) + '\nafter')],
];
for (const [name, n, make] of SHAPES) {
  const count = n.toLocaleString('en-US');
  test(count + ' ' + name + ' cost no more than ' + count + ' letters would', () => {
    const { ms, budget, control } = within((f) => make(f, n), n);
    assert.ok(ms <= budget, ms.toFixed(0) + ' ms against a budget of ' + budget.toFixed(0) + ' ms (control ' + control.toFixed(0) + ' ms)');
  });
}

// ── controls: both rulers fire ─────────────────────────────────────────────────────────────────
test('control: the cost ruler goes red on the shape it was written for', () => {
  // The replaced separator regex, on a quarter of the size: quadratic, so held to a sixteenth.
  const line = '|-' + ' '.repeat(25000) + 'x';
  const ms = spent(() => REF_SEP.test(line));
  assert.ok(ms > FLOOR_MS / 16 / 10, 'the replaced regex is slow even at a quarter of the size (' + ms.toFixed(0) + ' ms)');
});
test('control: the same-answer ruler goes red on a near-miss rewrite', () => {
  const noClosingPipe = (s) => /^\s*\|\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*$/.test(s);
  const sevenHashes = (s) => /^(#{1,7})\s+(.*\S)\s*$/.exec(s);
  const endOnly = (t, m) => t.replace(m, '').trimEnd();
  let sep = 0, heading = 0, rest = 0;
  for (const s of ['| --- |', '|-|', ' |:-:| ']) if (noClosingPipe(s) !== REF_SEP.test(s)) sep++;
  for (const s of ['####### a', '# a', '#a']) if (!!sevenHashes(s) !== !!REF_HEADING.exec(s)) heading++;
  for (const t of ['\n\n![a](/i.jpg)\nx', '  ![a](/i.jpg)']) if (endOnly(t, '![a](/i.jpg)') !== refRest(t, '![a](/i.jpg)')) rest++;
  assert.ok(sep && heading && rest, 'each near-miss is caught (' + [sep, heading, rest] + ')');
});

console.log('\nsitetile render-path run cost: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
