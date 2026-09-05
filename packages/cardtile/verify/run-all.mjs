// Run every harness in this directory, and separate "could not run" from "ran and found something".
//
//   node packages/cardtile/verify/run-all.mjs            report everything
//   node packages/cardtile/verify/run-all.mjs --check    exit 1 if any harness CANNOT RUN
//   node packages/cardtile/verify/run-all.mjs --only qr  substring filter
//
// 🩸 WHY THIS EXISTS. On 2026-08-12 eight of these harnesses turned out to be dead — a selector
// naming a card that had left the package, an ENOENT on a specimen that no longer existed, a
// control gated on a departed creator's handle, a `git show HEAD` counterexample that expired the
// moment its fix landed, a shadow measurement that had never once executed. Every one of them was
// found by RUNNING it. Nothing runs them: scripts/test.sh covers the unit tests and stops, because
// these need a browser. Thirty harnesses, zero in the suite.
//
// So the rot was not carelessness. It was structural: a gate nobody runs is indistinguishable from
// a gate that passes, and this directory had been in that state for weeks.
//
// 🔴 THE CLASSIFICATION IS THE POINT, and it is not "pass/fail".
//
//   BROKEN   the harness could not run at all — it threw, timed out, or died on a missing file.
//            This is ALWAYS a defect, and it is the signature of silent rot: the subject moved and
//            the ruler still names the old one. `--check` fails on these and only these.
//   RED      it ran, measured, and reported problems. That is a harness doing its job; whether the
//            finding is real is a separate question that a human answers.
//   GREEN    it ran and was satisfied.
//   SKIPPED  it needs something this run cannot give it (a live URL, a browser).
//
// A run of "12 RED" is healthy. A run of "1 BROKEN" is not, however green the rest are.
import { readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
// 🩸 Was `args[args.indexOf('--only') + 1]`. With no `--only`, indexOf returns -1 and that reads
// args[0] — so `run-all.mjs --check`, the CI mode, set the filter to "check", matched no filename,
// and reported `0 green · 0 red · 0 BROKEN · 0 skipped (of 0)` with exit 0.
//
// 🔴 The tool built to catch gates that pass by never running had that exact defect, in the one mode
// nobody watches. Its first real CI run went green on ZERO harnesses. Found by reading the log
// instead of the conclusion — "success" and "there was nothing to do" print the same colour.
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? (args[onlyAt + 1] || '') : '';
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS || 90_000);

// Helpers, not harnesses: they export, they do not measure.
const NOT_A_HARNESS = new Set(['paths.mjs', 'run-all.mjs']);

const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.mjs') && !NOT_A_HARNESS.has(f))
  .filter((f) => !only || f.includes(only))
  .sort();

/**
 * Did it run, or did it fall over?
 *
 * 🔴 An uncaught exception is not a verdict. A harness that ends in a Node stack trace never
 * reached its own conclusion, so its exit code says nothing about the thing it was pointed at —
 * and reading that exit code as "failed" is exactly how a dead ruler passes for a strict one.
 */
function classify(code, out, signal) {
  const stack = /^\s+at .+\(.*:\d+:\d+\)$/m.test(out) || /^\w*Error:/m.test(out)
    || /Cannot read properties|is not a function|ENOENT|TimeoutError/.test(out);
  // 🩸 Was /🔴\s*\d+\s*problem/ — no words allowed between the count and the noun. cell-layer.mjs
  // ends with "🔴 1 correctness problem(s)" and was reported BROKEN: it had reached its conclusion,
  // printed it, and exited 1, and this classifier could not read it. A ruler that mis-sorts a red as
  // a breakage is worse than a coarse one — it sends you to look for a crash that never happened.
  const ownVerdict = /(🔴\s*\d+\s*[\w-]*\s*problem|✅|❌|=== \d+\/\d+ PASS|\bSMOKE (PASS|FAIL)\b)/.test(out);

  if (signal) return { kind: 'BROKEN', why: `killed by ${signal} (>${TIMEOUT_MS / 1000}s)` };
  // 🔴 NO BROWSER IS NOT A BROKEN HARNESS. Checked before the stack-trace rule below, because a
  // missing module arrives AS a stack trace. Deliberately narrow — it must name playwright, or this
  // rule would start swallowing the real breakages it sits in front of.
  if (/Cannot find (?:package|module) '?playwright|ERR_MODULE_NOT_FOUND[\s\S]{0,400}playwright/.test(out)) {
    return { kind: 'SKIPPED', why: 'no browser here — set PLAYWRIGHT or install one' };
  }
  if (/usage:|needs a live|Pass a URL|no url|<url/i.test(out) && !ownVerdict) {
    // 🔴 Quote the harness, do not paraphrase it. "needs an argument this run cannot supply" was
    // wrong for grid-growth.mjs, which needs no argument at all — it is waiting for a CSS rule to be
    // shipped. A skip reason invented by the runner sends the reader to fix the wrong thing.
    const said = (/^.*(?:usage:|needs a live).*$/im.exec(out)?.[0] || '').replace(/^\s*usage:\s*/i, '').trim();
    return { kind: 'SKIPPED', why: said.slice(0, 96) || 'said it could not run, without saying why' };
  }
  // A stack trace WITH a verdict means it printed its findings and then threw on the way out —
  // still broken, because whatever came after the throw did not happen.
  if (stack) return { kind: 'BROKEN', why: (/^(\w*Error:.*)$/m.exec(out)?.[1] || 'threw').slice(0, 72) };
  // 🔴 SILENCE IS NOT A PASS. A harness that exits 0 having printed nothing reached no conclusion —
  // notation.mjs did exactly this with no arguments and was counted GREEN, which is the same false
  // reassurance as a dead gate. Anything with fewer than a couple of lines to say gets asked again.
  if (out.trim().length < 40) return { kind: 'SKIPPED', why: 'exited 0 without printing a verdict' };
  if (code === 0) return { kind: 'GREEN', why: '' };
  if (ownVerdict) return { kind: 'RED', why: (/🔴\s*\d+\s*problem\(s\)/.exec(out)?.[0] || `exit ${code}`) };
  // Non-zero, no stack, no verdict: it stopped without saying why. Treat as broken — an exit code
  // with nothing to explain it is not a measurement.
  return { kind: 'BROKEN', why: `exit ${code} with no verdict printed` };
}

/**
 * Does this harness carry a CONTROL — something that must go red on purpose?
 *
 * 🔴 A second signal, and a weaker one than BROKEN: this is a grep, and a grep can be satisfied by
 * the word alone. It is here because of what 2026-08-12 actually showed — every harness that
 * eventually told the truth had a control, and the two that misled longest were the ones whose
 * control had quietly stopped running (gated on a departed card) or expired (fetched from
 * `git show HEAD`, which stops reproducing the bug the moment the fix lands).
 *
 * So read a missing control as "nothing here has ever been shown to fail", which is a different
 * and quieter problem than "this is red".
 */
const hasControl = (file) => /CONTROL|control:|控制組|must FAIL|deliberately break/i
  .test(readFileSync(join(HERE, file), 'utf8'));

const run = (file) => new Promise((resolve) => {
  const p = spawn(process.execPath, [join(HERE, file)], { cwd: HERE, env: process.env });
  let out = '';
  const cap = (b) => { out += b.toString(); if (out.length > 400_000) out = out.slice(-200_000); };
  p.stdout.on('data', cap); p.stderr.on('data', cap);
  const t = setTimeout(() => p.kill('SIGKILL'), TIMEOUT_MS);
  p.on('close', (code, signal) => { clearTimeout(t); resolve({ file, ...classify(code, out, signal), out }); });
});

const ICON = { GREEN: '✓', RED: '🔴', BROKEN: '💥', SKIPPED: '·' };
const results = [];
// 🔴 Printed as each one lands, not collected and printed at the end. Thirty harnesses that each
// launch a browser is minutes of silence otherwise — and a tool that says nothing until it is
// finished is one you stop running, which is how this directory got into the state it was in.
// 🔴 A FLOOR. An empty run is not a clean run — it is a broken invocation, and on 2026-08-13 it was
// mine. Nothing downstream can tell the two apart, so the difference is made here, loudly.
if (!files.length) {
  console.error(only
    ? `✗ no harness matches --only ${only} — nothing ran`
    : `✗ no harnesses found in ${HERE} — nothing ran`);
  process.exit(1);
}
console.log(`  running ${files.length} harness(es), ${TIMEOUT_MS / 1000}s each at most\n`);
for (const f of files) {
  // 🔴 SERIAL, and not only because several of these bind ports and launch browsers. Two of them
  // WRITE to the live card store under a fixed scratch handle, so two runs of this file at once —
  // or one run while somebody runs a harness by hand — collide and report BROKEN for a reason that
  // is about the runner, not the subject. Measured on 2026-08-12: editor-save.mjs came back
  // "exit 1 with no verdict printed" while a second invocation was still going, and passed on its
  // own moments later. Parallelising this would be buying minutes with false alarms.
  const r = await run(f);
  const ctl = hasControl(f) ? '  ' : ' ⚠';                // ⚠ = no control anywhere in the file
  console.log(`  ${ICON[r.kind]} ${r.kind.padEnd(8)}${ctl} ${r.file.padEnd(26)} ${r.why}`);
  results.push({ ...r, control: hasControl(f) });
}

const by = (k) => results.filter((r) => r.kind === k);
console.log(`\n  ${by('GREEN').length} green · ${by('RED').length} red · ${by('BROKEN').length} BROKEN · ${by('SKIPPED').length} skipped   (of ${results.length})`);

// 🩸 THE OUTPUT WAS THROWN AWAY. Until 2026-08-13 this printed only the classification, so the
// first CI run that actually worked reported "💥 verify-drawer.mjs — threw" and "🔴 header-shape.mjs
// — 1 problem(s)" with nothing to act on: no stack, no measured number, no line. Whoever reads a
// scheduled run is not sitting at the machine that produced it, and telling them something is wrong
// without telling them what is a check nobody can act on.
const tail = (out, n) => out.trimEnd().split('\n').slice(-n).map((l) => '        ' + l.slice(0, 160)).join('\n');

if (by('BROKEN').length) {
  console.log('\n🔴 A HARNESS THAT CANNOT RUN IS NOT A STRICT HARNESS, IT IS AN ABSENT ONE.');
  console.log('   These reached no conclusion, so nothing they were pointed at is being watched:');
  for (const r of by('BROKEN')) {
    console.log(`     💥 ${r.file} — ${r.why}`);
    console.log(tail(r.out, 14));
  }
  console.log('   Most often the subject moved and the ruler still names the old one: a specimen that');
  console.log('   was renamed, a card that left the package, a selector for markup that changed.');
}

// RED gets its say too — a number without the line that produced it is a rumour.
if (by('RED').length) {
  console.log('\n🔴 These RAN and found something. Whether it is real is a human call:');
  for (const r of by('RED')) {
    console.log(`     🔴 ${r.file} — ${r.why}`);
    console.log(tail(r.out, 10));
  }
}

// 🩸 REPORTED-NOT-GATED LINES FROM *GREEN* HARNESSES, because otherwise they are not reported at
// all. header-shape prints "⚠️ heights differ (not gated — could be a wrap)" precisely so a human
// can see something this probe cannot attribute — and that line went into the captured output of a
// GREEN harness, which nothing printed. A signal nobody can see is not a signal; it is a comment.
//
// 🔴 Same defect as the one fixed for BROKEN and RED an hour earlier, one square along. The fix
// there was "carry the evidence"; this is the half of the evidence that belongs to a run that
// PASSED, and it is the easier one to forget for exactly that reason.
const warned = results.flatMap((r) => (r.out.match(/^.*⚠️.*$/gm) || []).map((l) => [r.file, l.trim()]));
if (warned.length) {
  console.log(`\n⚠️  ${warned.length} line(s) a harness reported without failing on — nobody has attributed these:`);
  for (const [file, line] of warned.slice(0, 20)) console.log(`     ${file.replace('.mjs', '')}: ${line.slice(0, 150)}`);
}

const noCtl = results.filter((r) => !r.control);
if (noCtl.length) {
  console.log(`\n⚠️  ${noCtl.length} harness(es) carry no control — nothing in them has ever been shown to fail:`);
  console.log(`     ${noCtl.map((r) => r.file.replace('.mjs', '')).join(' · ')}`);
  console.log('   Not a failure. But a green from one of these means "it did not complain", which is');
  console.log('   not the same claim as "it looked and was satisfied".');
}

// 🔴 --check fails on BROKEN only. RED is a harness working; a missing control is a gap, not a
// breakage; and failing the build on either would train people to stop running this.
process.exit(CHECK && by('BROKEN').length ? 1 : 0);
