// Every committed bundle:true coral artifact (<coral>/<coral>.js) is what its CURRENT sources
// produce — the rebuild half of the freshness gate for generated Corals.
//   run: node packages/dynamic-corals/generated-bundles.test.mjs
//
// Part A (packages/cardtile/serve/card-worker.test.mjs) proves the SERVING copy two of these
// corals are embedded into (card-assets.mjs's QR_JS/DRAWER_JS) matches the committed bundle. This
// file proves the earlier half: that the committed bundle itself still matches its own sources.
// Together they cover "source → bundle → serving aggregate" with no gap.
//
// 🩸 THE HOLE THIS CLOSES. build.mjs is the only producer of these files, and nothing ran it as a
// check — only as a publish action a human remembers to invoke. A source edit with no rebuild is
// invisible: the coral renders using whatever bytes are on disk, the tests that exercise its own
// -core.mjs pass (they import the SOURCE, not the artifact), and the stale artifact looks exactly
// like a fresh one until someone diffs it by hand.
//
// 🔴 Which corals this covers is DERIVED from corals.mjs, not hand-listed here — a new bundle:true
// coral is covered the day it is added, and square-shop/inbox-bubble (bundle:false, hand-written,
// stamp-only) stay out without this file needing to know their names.
//
// 🔴 Build into a SANDBOX under out/ (gitignored, and deliberately INSIDE the repo — build.mjs runs
// `git rev-parse` from its own directory to stamp the commit, which has no answer from a scratch
// dir outside a git checkout), with --registry pointed explicitly INTO that sandbox and
// CORAL_REGISTRY deleted from the child environment. See build-stamp.test.mjs's own comment on the
// measured incident this belt-and-suspenders exists for: a probe once published a fake version into
// a live registry because it trusted a derived default instead of being told, twice, where to go.
//
// 🔴 The comparison normalises ONLY build.mjs's own provenance — the first line's `+<commit>` and
// the version-registration trailer — using the SAME ruler build.mjs's own immutability check uses
// (normalize-generated-code.mjs, factored out of build.mjs so there is exactly one copy of it).
// Three of the four bundle:true corals compared here — events, qr and drawer — still carry the
// pre-2026-08-29 UNGUARDED trailer spelling; sponsor is the only one built since and carries the
// guarded form. A byte-exact comparison would be red on those three for a reason that is not
// source drift: it is build.mjs's own stamp format changing. The normalisation matches BOTH
// spellings, pinned to each coral's own name and version, so a trailer naming some OTHER version
// still falls through as a real defect (see the controls below).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORALS } from './corals.mjs';
import { normalizeGeneratedCode } from './normalize-generated-code.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

// ── esbuild gating: resolved EXACTLY the way build.mjs resolves it — same candidates, same order,
// ESBUILD env first. Duplicated rather than imported: this has to run BEFORE it is safe to import a
// sandboxed copy of build.mjs at all, because build.mjs throws at import time when it finds none, as
// a side effect of a module-level IIFE that also derives its candidates from ITS OWN directory (not
// this file's — identical here, since both live in packages/dynamic-corals, but not something a
// shared helper could assume in general without becoming build.mjs's problem to keep general). If
// build.mjs's candidate list ever changes, this one has to change with it; nothing enforces that
// automatically, which is the cost of the duplication.
//
// 🔴 SKIPS BY NAME rather than passing, and never passes quietly: "I could not look" and "I looked
// and it is fine" must never print the same thing (see sponsor-registry.test.mjs, which states this
// rule first).
const esbuildCandidates = [
  process.env.ESBUILD,
  join(HERE, '../sitetile/astro/node_modules/.bin/esbuild'),   // this repo, after `npm i` there
  join(HERE, '../../node_modules/.bin/esbuild'),                // this repo's own root install
  join(HERE, '../../../node_modules/.bin/esbuild'),             // the parent checkout's, when this repo is a submodule
].filter(Boolean);
const ESBUILD_BIN = esbuildCandidates.find((p) => existsSync(p));
if (!ESBUILD_BIN) {
  console.log('SKIP - no esbuild found. Tried:');
  for (const c of esbuildCandidates) console.log(`       ${c}`);
  console.log('       Set ESBUILD=<path> to a known esbuild, the same way build.mjs itself requires.');
  console.log('       This run did NOT prove that any committed bundle:true coral artifact matches a');
  console.log('       fresh build of its current sources. Nothing here failed; nothing here looked.');
  process.exit(0);
}

// ── which corals this gate covers — derived from corals.mjs, not hand-listed ─────────────────────
const BUNDLED = Object.entries(CORALS).filter(([, cfg]) => cfg.bundle).map(([name]) => name);
ok('at least one coral is bundle:true (this gate would be vacuous otherwise)', BUNDLED.length > 0, `found ${BUNDLED.length}`);
ok('square-shop is not covered (bundle:false — hand-written, stamp only, not a generated-file drift pair)',
  !BUNDLED.includes('square-shop'));
ok('inbox-bubble is not covered (bundle:false — hand-written, stamp only, not a generated-file drift pair)',
  !BUNDLED.includes('inbox-bubble'));

mkdirSync(join(REPO, 'out'), { recursive: true });
const sandbox = mkdtempSync(join(REPO, 'out', 'generated-bundles-'));
const sandboxResolved = resolve(sandbox) + sep;

try {
  // Copy the whole dynamic-corals tree in, EXCEPT registry/ (private/live distribution data — never
  // copied in, so nothing here can write to it even by accident) and any node_modules, so each
  // bundled coral's real imports (its own -core.mjs, shared/*) resolve exactly as they do for a real
  // build — esbuild bundles the IMPORTED files, not a name.
  for (const entry of readdirSync(HERE, { withFileTypes: true })) {
    if (entry.name === 'registry' || entry.name === 'node_modules' || entry.name === 'out') continue;
    cpSync(join(HERE, entry.name), join(sandbox, entry.name), { recursive: true });
  }

  // 🩸 --registry EXPLICITLY per build, and CORAL_REGISTRY stripped from the child's environment —
  // the same belt-and-suspenders build-stamp.test.mjs uses, for the same reason: a derived default
  // is a default, and a default is the thing an inherited environment variable overrides. See that
  // file's comment for the measured incident (2026-09-07) this guards against.
  const BUILD_ENV = { ...process.env, ESBUILD: ESBUILD_BIN, CORAL_REGISTRY: '' };
  delete BUILD_ENV.CORAL_REGISTRY;

  function build(name, registryDir) {
    return execFileSync('node', [join(sandbox, 'build.mjs'), name, '--registry', registryDir],
      { stdio: 'pipe', env: BUILD_ENV });
  }

  // ── the main gate: each bundled coral's committed artifact vs. a fresh build of its current
  // sources, one dedicated registry directory per coral so a registry participant's OWN immutability
  // check (build.mjs comparing this run against a PRIOR write to the same --registry) never fires —
  // that is a different question — whether the registry's published versions and channels agree —
  // and registry-contract.test.mjs asks it.
  let n = 0;
  for (const name of BUNDLED) {
    n++;
    const { version } = JSON.parse(readFileSync(join(HERE, name, 'package.json'), 'utf8'));
    const outName = `${name}.js`;
    const registryDir = join(sandbox, `registry-${n}`);
    try {
      build(name, registryDir);
    } catch (e) {
      ok(`${name}@${version}: build.mjs ran to completion in the sandbox`, false,
        String(e.stderr || e.message));
      continue;
    }

    const builtPath = join(sandbox, name, outName);
    // Sandbox control: assert the path the build actually wrote is under THIS temp directory before
    // reading it — do not discover an escape as an ENOENT three lines later.
    const resolvedBuilt = existsSync(builtPath) ? resolve(builtPath) : '';
    ok(`${name}: the rebuilt artifact landed inside the sandbox`,
      resolvedBuilt !== '' && resolvedBuilt.startsWith(sandboxResolved), resolvedBuilt || builtPath);
    if (!resolvedBuilt) continue;

    const committed = readFileSync(join(HERE, name, outName), 'utf8');
    const built = readFileSync(builtPath, 'utf8');
    ok(`${name}@${version}: the committed ${outName} is what its current sources produce`,
      normalizeGeneratedCode(committed, name, version) === normalizeGeneratedCode(built, name, version),
      `run: node packages/dynamic-corals/build.mjs ${name}`);
  }

  // ── CONTROL: mutate a coral's source INSIDE THE SANDBOX (never the repo), rebuild, and show the
  // comparison goes red — proving the ruler measures code, not the stamp. `events` is chosen because
  // it is also a registry participant, so this exercises the same manifest/validation path a real
  // build takes, not only the local-artifact shortcut qr/drawer would give it.
  {
    const target = 'events';
    if (!BUNDLED.includes(target)) {
      ok('CONTROL (mutation): the coral this control targets is still bundle:true', false, target);
    } else {
      const { version } = JSON.parse(readFileSync(join(HERE, target, 'package.json'), 'utf8'));
      const srcPath = join(sandbox, target, CORALS[target].src);
      const original = readFileSync(srcPath, 'utf8');
      const beforeBuilt = readFileSync(join(sandbox, target, `${target}.js`), 'utf8');
      writeFileSync(srcPath, original + '\nconsole.log("generated-bundles.test.mjs mutation control");\n');
      try {
        build(target, join(sandbox, 'registry-control-mutation'));
        const afterBuilt = readFileSync(join(sandbox, target, `${target}.js`), 'utf8');
        ok('CONTROL: mutating the sandbox source changes the rebuilt code',
          normalizeGeneratedCode(beforeBuilt, target, version) !== normalizeGeneratedCode(afterBuilt, target, version));
        const committed = readFileSync(join(HERE, target, `${target}.js`), 'utf8');
        ok('CONTROL: …and the comparison against the COMMITTED artifact goes red for it — the ruler measures code, not the stamp',
          normalizeGeneratedCode(committed, target, version) !== normalizeGeneratedCode(afterBuilt, target, version));
      } catch (e) {
        ok('CONTROL: the mutated coral still rebuilds (this control needs a successful rebuild to prove anything)',
          false, String(e.stderr || e.message));
      } finally {
        writeFileSync(srcPath, original);
      }
    }
  }

  // ── CONTROL: the normalisation tolerates ONLY build.mjs-owned provenance — both directions, and
  // a trailer naming a different version is a real defect and must not be swallowed by the
  // guard-spelling tolerance.
  {
    const name = 'sample-coral', version = '1.2.3';
    const body = 'console.log("body");';
    const stampA = `/*! coral ${name}@${version} +aaaaaaa — generated by dynamic-corals/build.mjs, do not edit */\n`;
    const stampB = `/*! coral ${name}@${version} +bbbbbbb — generated by dynamic-corals/build.mjs, do not edit */\n`;
    const trailerUnguarded = `\n(window.__coralVersions=window.__coralVersions||{})['${name}']='${version}';\n`;
    const trailerGuarded = `\nif (typeof window !== 'undefined') (window.__coralVersions=window.__coralVersions||{})['${name}']='${version}';\n`;
    const trailerWrongVersion = `\nif (typeof window !== 'undefined') (window.__coralVersions=window.__coralVersions||{})['${name}']='9.9.9';\n`;

    const a = stampA + body + trailerUnguarded;
    const b = stampB + body + trailerGuarded;
    ok('a pair differing ONLY in commit stamp and trailer spelling is tolerated',
      normalizeGeneratedCode(a, name, version) === normalizeGeneratedCode(b, name, version));

    const c = stampA + body + ' ' + trailerUnguarded;   // one added space — a real body change
    ok('CONTROL: and a one-character difference confined to the body is NOT tolerated',
      normalizeGeneratedCode(a, name, version) !== normalizeGeneratedCode(c, name, version));

    const d = stampA + body + trailerWrongVersion;
    ok('a trailer naming a DIFFERENT version is NOT tolerated — it falls through as a real defect',
      normalizeGeneratedCode(a, name, version) !== normalizeGeneratedCode(d, name, version));
  }
} finally {
  // Unconditional, matching build-stamp.test.mjs's own pattern: `ok()` records failures without
  // throwing, so this always runs. An actual thrown exception (an unexpected build.mjs crash this
  // file did not anticipate) still reaches here and still cleans up — see that file for the same
  // shape.
  //
  // 🩸 process.exit() below is deliberately OUTSIDE this try/finally, not after the last assertion
  // inside it: process.exit() does not unwind the stack the way a thrown exception does, so a call
  // to it from inside the try would skip this finally entirely and leave the sandbox on disk even
  // on a fully green run. Measured while writing this file.
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
