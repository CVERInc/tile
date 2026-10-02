// sitetile whitespace-run cost — a long run of whitespace must cost what its length costs, not its square.
//   run: node whitespace-run-cost.test.mjs
//
// 🩸 Why this file exists. Six places in the parse → serialize path re-walked a run of whitespace
// once for every character in it. One line holding 40,000 spaces made a single save take seconds;
// the same line holding 40,000 letters took milliseconds. Five were regexes whose leading or lazy
// part could start anywhere inside the run (`\s+$`, `\n+$`, `(.*?)\s*%%`, `(.*?)\s*→`, `\s*\[`); one
// was a loop that re-scanned an entry's blank lines on every line.
//
// Two rulers, because either alone can be satisfied by a wrong fix:
//   1. SAME ANSWER — each rewritten piece is compared against the regex it replaced, kept below as
//      the reference, over generated inputs where both verdicts occur. A fast parser that reads
//      headings differently is not a fix.
//   2. LINEAR COST — a 200,000-character run is timed against the same page carrying 200,000
//      letters. The clock is unavoidable here (a native regex exposes no step count), so the budget
//      is a ratio to that control with a floor, and the replaced versions miss it by 10× or more.
// Each ruler is shown to fire: the controls at the bottom put the old shapes back and must go red.

import assert from 'node:assert/strict';
import { parseSite, serializeSite } from './site-core.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const SAMPLES = Number(process.env.SITETILE_WS_SAMPLES || 20000);
let seed = 271828183;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const words = (alphabet, max) => { let s = ''; for (let n = Math.floor(rnd() * max); n > 0; n--) s += pick(alphabet); return s; };

const FM = '---\nsitetile-page: home\ntitle: T\n---\n\n';

// ── the regexes that were replaced, verbatim — the reference each rewrite must agree with ─────
const REF_TYPELINE = /^%%\s*sitetile:\s*(.*?)\s*%%\s*$/;
function refCellHeading(raw) {
  let s = String(raw || '').trim();
  let icon = '';
  const ic = /^:([a-z0-9-]+):\s+/.exec(s);
  if (ic) { icon = ic[1]; s = s.slice(ic[0].length).trim(); }
  let emoji = '';
  const em = /^(\p{Extended_Pictographic}️?)\s+/u.exec(s);
  if (em) { emoji = em[1]; s = s.slice(em[0].length).trim(); }
  let badge = '', badgeHref = '';
  const bm = /\s*\[([^\]]+)\]\s*$/.exec(s);
  if (bm) {
    const b = bm[1].trim();
    const bh = /^(.*?)\s*→\s*(\S+)\s*$/.exec(b);
    if (bh) { badge = bh[1].trim(); badgeHref = bh[2]; } else { badge = b; }
    s = s.slice(0, bm.index).trim();
  }
  const m = /^(.*?)\s*→\s*(\S+?)(?:\s+"([^"]*)")?\s*$/.exec(s);
  return m ? { icon, emoji, title: m[1].trim(), href: m[2], cta: m[3] || '', badge, badgeHref }
           : { icon, emoji, title: s, href: '', cta: '', badge, badgeHref };
}
const refBlock = (lines) => lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
const refTail = (s) => s.replace(/\s+$/, '');

// Everything `\s` matches that a `split('\n')` line can still hold, plus look-alikes it does NOT
// match (U+200B, U+0085, U+180E) — the characters a hand-rolled "is this a space" gets wrong.
const WS = [' ', ' ', '  ', '\t', '\r', ' ', '　', '﻿', ' ', ' ', '\v', '\f', '​', '\u0085', '᠎'];

// ── ruler 1: same answer ───────────────────────────────────────────────────────────────────────
function headingSample() {
  const A = ['a', 'b', '→', '→', '"', '"', '[', ']', '[', ']', ':', 'x-y', '/p', '📖', ':book:', ...WS];
  const shaped = () => pick(['', ':ok: ', '📖 ', ' ']) + words(A, 4) + pick(['', ' →/x', '→', ' → /x "Go"', ' →/x  "G o" ', '→a→b "c"']) +
    pick(['', ' [Soon]', '[New →/n]', ' [a] [b]', ' [ → x ]', '[]', ' [x', 'x]']) + words(A, 3);
  return rnd() < 0.5 ? shaped() : words(A, 12);
}
function cellOf(raw) {
  const site = parseSite(FM + '## S\n%% sitetile: grid %%\n### k ' + raw + '\nbody\n');
  return site.sections[0].cells[0];
}
test('a cell heading splits exactly as the regexes it replaced did', () => {
  const seen = { href: 0, cta: 0, badge: 0, badgeHref: 0, plain: 0 };
  for (let n = 0; n < SAMPLES; n++) {
    const raw = headingSample();
    if (/[\n\r\u2028\u2029]/.test(raw)) continue;   // a heading is one line: `###` never captures these
    const want = refCellHeading('k ' + raw);
    const c = cellOf(raw);
    const got = { icon: c.icon, emoji: c.emoji, title: c.title, href: c.href, cta: c.cta, badge: c.badge, badgeHref: c.badgeHref };
    assert.deepEqual(got, want, JSON.stringify(raw));
    for (const k of ['href', 'cta', 'badge', 'badgeHref']) if (want[k]) seen[k]++;
    if (!want.href && !want.badge) seen.plain++;
  }
  // 🔴 A differential test over inputs that never split proves nothing. Every branch must occur.
  for (const [k, v] of Object.entries(seen)) assert.ok(v > SAMPLES / 200, 'the samples exercise "' + k + '" (' + v + ')');
});

test('a type line is recognized exactly as the regex it replaced did', () => {
  const A = ['%', '%%', '%% ', 'sitetile:', 'sitetile', 'grid', 'cols=3', 'a', ...WS];
  let yes = 0, no = 0;
  for (let n = 0; n < SAMPLES; n++) {
    const line = rnd() < 0.6
      ? '%%' + pick(['', ' ', '\t ', '　']) + pick(['sitetile:', 'sitetile:', 'sitetile', 'Sitetile:']) + words(WS, 2) + words(A, 5) + pick(['%%', ' %%', '%% ', '%', '', '%%%', '%% x'])
      : words(A, 9);
    if (/\n/.test(line)) continue;
    const m = REF_TYPELINE.exec(line);
    const s = parseSite(FM + '## S\n' + line + '\nbody\n').sections[0];
    assert.equal(s.hasTypeLine, !!m, JSON.stringify(line));
    if (m) {
      yes++;
      const st = /^(\S+)\s*([\s\S]*)$/.exec(m[1].trim());
      assert.equal(s.type + '|' + s.params, st ? st[1] + '|' + st[2].trim() : 'prose|', JSON.stringify(line));
    } else no++;
  }
  assert.ok(yes > SAMPLES / 10 && no > SAMPLES / 10, 'both verdicts occur (' + yes + ' yes, ' + no + ' no)');
});

test('a body keeps exactly the blank lines the regex kept, and the page tail is trimmed the same', () => {
  const A = ['x', '', '', ' ', '\t', 'y z', '\r', '　'];
  let trimmed = 0;
  for (let n = 0; n < SAMPLES; n++) {
    const lines = Array.from({ length: Math.floor(rnd() * 7) }, () => pick(A));
    const site = parseSite(FM + '## S\n%% sitetile: prose %%\n' + lines.join('\n'));
    assert.equal(site.sections[0].body, refBlock(lines), JSON.stringify(lines));
    if (refBlock(lines) !== lines.join('\n')) trimmed++;
    // The tail: whatever the body ends with, the page ends the way `\s+$` left it.
    const tail = words(WS.concat(['\n', '\n']), 4);
    const one = { title: '', meta: { 'sitetile-page': 'home' }, sections: [{ title: 'S', type: 'prose', params: '', hasTypeLine: false, body: 'b' + tail }] };
    assert.equal(serializeSite(one), refTail('---\nsitetile-page: home\n---\n\n## S\nb' + tail.replace(/\n{3,}/g, '\n\n')) + '\n', JSON.stringify(tail));
  }
  assert.ok(trimmed > SAMPLES / 10, 'the samples include bodies with blank edges (' + trimmed + ')');
});

test('a timeline entry title is taken only while the entry has no content — blank lines do not count', () => {
  const tl = (lines) => parseSite(FM + '## S\n%% sitetile: timeline %%\n' + lines.join('\n') + '\n').sections[0].entries;
  assert.deepEqual(tl(['### 2021', '', ' ', '#### Founded', 'In a garage.']), [{ year: '2021', title: 'Founded', body: ' \nIn a garage.' }]);
  assert.deepEqual(tl(['### 2021', 'x', '#### Not a title']), [{ year: '2021', title: '', body: 'x\n#### Not a title' }]);
  assert.deepEqual(tl(['### 2021', '```', '```', '#### After a fence']), [{ year: '2021', title: '', body: '```\n```\n#### After a fence' }]);
  assert.deepEqual(tl(['### 2021', '#### One', '#### Two']), [{ year: '2021', title: 'One', body: '#### Two' }]);
});

// ── ruler 2: linear cost ───────────────────────────────────────────────────────────────────────
const N = 200000;
// The floor under the budget. A loaded machine reads under 100 ms on the heaviest linear shape; the
// quadratic versions read tens of seconds. 2,000 sits far from both.
const FLOOR_MS = 2000;
const spent = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
// Best of two: a busy machine can only make a run slower, never faster, so the smaller reading is
// the closer one. The second run is skipped when the first already fits — or misses by so much
// (4×) that no amount of load explains it, so a red run does not cost twice.
function within(make, run, n) {
  const control = Math.min(spent(() => run(make('x'.repeat(n), n))), spent(() => run(make('x'.repeat(n), n))));
  const budget = Math.max(FLOOR_MS, control * 20);
  const subject = make(null, n);
  let ms = spent(() => run(subject));
  if (ms > budget && ms < budget * 4) ms = Math.min(ms, spent(() => run(subject)));
  return { ms, budget };
}
const roundTrip = (md) => serializeSite(parseSite(md));
const grid = (list) => FM + '## Cards\n%% sitetile: grid %%\n### Card\n' + list + '\n';
// 🔴 The unclosed type line was worse than quadratic under the old regex (three parts competing for
// one run): at 200,000 it would not finish, and a test that hangs is not a red line. So that one
// shape runs at 4,000 — tens of seconds under the old regex, under a millisecond now.
const UNCLOSED_N = 4000;
const SHAPES = {
  'spaces inside a body line': (f) => grid('- x' + (f || ' '.repeat(N)) + 'y'),
  'full-width spaces inside a body line': (f) => grid('- x' + (f || '　'.repeat(N)) + 'y'),
  'tabs at the end of a body line': (f) => grid('- x' + (f || '\t'.repeat(N)) + '\n- y'),
  'blank lines inside a body': (f) => grid('- x' + (f || '\n'.repeat(N)) + '- y'),
  'spaces inside a cell heading': (f) => FM + '## Cards\n%% sitetile: grid %%\n### Ca' + (f || ' '.repeat(N)) + 'rd\nbody\n',
  'spaces inside a cell heading before a badge': (f) => FM + '## Cards\n%% sitetile: grid %%\n### Ca' + (f || ' '.repeat(N)) + 'rd →/x "Go" [Soon →/s]\nbody\n',
  'spaces inside a type line': (f) => FM + '## Cards\n%% sitetile: grid' + (f || ' '.repeat(N)) + 'cols=2 %%\n### Card\nbody\n',
  'spaces after an unclosed type line': (f, n) => FM + '## Cards\n%% sitetile:' + (f || ' '.repeat(n)) + 'grid\n### Card\nbody\n',
  'blank lines after a timeline entry': (f) => FM + '## Story\n%% sitetile: timeline %%\n### 2021' + (f || '\n'.repeat(N)) + '#### Founded\nIn a garage.\n',
};
for (const [name, make] of Object.entries(SHAPES)) {
  const n = name === 'spaces after an unclosed type line' ? UNCLOSED_N : N;
  const count = n.toLocaleString('en-US');
  test(count + ' ' + name + ' cost no more than ' + count + ' letters would', () => {
    const { ms, budget } = within(make, roundTrip, n);
    assert.ok(ms <= budget, ms.toFixed(0) + ' ms against a budget of ' + budget.toFixed(0) + ' ms');
  });
}

// ── controls: both rulers fire ─────────────────────────────────────────────────────────────────
test('control: the cost ruler goes red on the quadratic shape it was written for', () => {
  // The old tail trim, on an eighth of the size so this control itself stays quick. Quadratic cost
  // at an eighth of the size is a sixty-fourth of the reading, so that is what it is held to.
  const n = N / 8;
  const md = grid('- x' + ' '.repeat(n) + 'y');
  const control = spent(() => roundTrip(grid('- x' + 'x'.repeat(n) + 'y')));
  const ms = spent(() => refTail(roundTrip(md).slice(0, -1)));
  assert.ok(ms > Math.max(FLOOR_MS, control * 20) / 64, 'the replaced regex is over budget even at N/8, scaled (' + ms.toFixed(0) + ' ms)');
});
test('control: the same-answer ruler goes red on a near-miss rewrite', () => {
  // Three plausible wrong rewrites — each must disagree with the reference on SOME generated input.
  const asciiTail = (s) => s.replace(/[ \t\r\n]+$/, '');
  const firstArrow = (s) => { const i = s.indexOf('→'); return i === -1 ? '' : s.slice(i + 1).trim(); };
  const lastBracket = (s) => { const i = s.lastIndexOf('['); return i === -1 || !s.endsWith(']') ? '' : s.slice(i + 1, -1).trim(); };
  let tail = 0, href = 0, badge = 0;
  for (let n = 0; n < SAMPLES; n++) {
    const t = 'b' + words(WS, 4);
    if (asciiTail(t) !== refTail(t)) tail++;
    const raw = 'k ' + headingSample();
    const want = refCellHeading(raw);
    if (firstArrow(raw) !== want.href) href++;
    if (lastBracket(raw.trim()) !== (want.badgeHref ? '' : want.badge) && !want.badgeHref) badge++;
  }
  assert.ok(tail > 0 && href > 0 && badge > 0, 'each near-miss is caught (' + [tail, href, badge] + ')');
});

console.log('\nsitetile whitespace-run cost: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
