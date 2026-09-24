// build.mjs's registry-vs-local-only split for a coral is DATA — read from corals.mjs, not
// hard-coded per coral name inside build.mjs — and the two guards that split enables (a registry
// participant refuses to build with no manifest; a local-only coral never touches the registry)
// really do fire.
//   run: node packages/dynamic-corals/registry-participation.test.mjs
//
// Every registry write below goes to its own mkdtemp directory, and CORAL_REGISTRY is stripped
// from every child's environment (the same belt build-stamp.test.mjs and legacy-api-base-guard
// .test.mjs wear) so a probe here can never land in a real registry even if the ambient
// environment happens to name one.
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORALS, REGISTRY_CORALS, LOCAL_ONLY_CORALS } from './corals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, 'build.mjs');
// A COPY of build.mjs run from a real /tmp path throws on its own `git rev-parse --short HEAD` —
// there is no repo there to answer from (see build-stamp.test.mjs's own note on this). `out/` is
// gitignored but still INSIDE this repo's working tree, which is what a build.mjs COPY needs to
// stamp a commit at all; a throwaway registry passed via --registry has no such requirement and
// can live anywhere.
const REPO = join(HERE, '../..');
const SCRATCH = join(REPO, 'out');
mkdirSync(SCRATCH, { recursive: true });

let pass = 0, fail = 0;
function ok(name, cond, detail = '') { (cond ? pass++ : fail++); console.log((cond ? 'PASS' : 'FAIL'), '-', name, detail && !cond ? '| ' + detail : ''); }

const strippedEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  delete env.CORAL_REGISTRY;
  return env;
};

// ── (1) corals.mjs is the single source of truth for the split ─────────────────────────────────
// REGISTRY_CORALS / LOCAL_ONLY_CORALS are themselves DERIVED from CORALS (see corals.mjs) rather
// than a second hand-kept list, so the per-coral loop below is what actually proves they cannot
// silently diverge from the table an added coral would be entered into.
ok('REGISTRY_CORALS names exactly the four corals that publish through the registry',
  JSON.stringify([...REGISTRY_CORALS].sort()) === JSON.stringify(['events', 'inbox-bubble', 'sponsor', 'square-shop']),
  REGISTRY_CORALS.join(', '));
ok('LOCAL_ONLY_CORALS names exactly the two Cardtile-served, non-registry corals',
  JSON.stringify([...LOCAL_ONLY_CORALS].sort()) === JSON.stringify(['drawer', 'qr']),
  LOCAL_ONLY_CORALS.join(', '));
for (const [name, cfg] of Object.entries(CORALS)) {
  const inRegistry = REGISTRY_CORALS.includes(name);
  const inLocalOnly = LOCAL_ONLY_CORALS.includes(name);
  ok(`${name}: appears in exactly one derived list, and it matches its own registry:${cfg.registry}`,
    inRegistry !== inLocalOnly && inRegistry === cfg.registry);
}

// ── (2) the split is READ, not re-derived from a coral's name — proven on two names build.mjs ──
// has never heard of. If build.mjs ever grew a branch like `name === 'qr'` instead of reading
// cfg.registry from this table, a real coral could still coincidentally pass; a name it has never
// seen before cannot.
{
  const sandbox = mkdtempSync(join(SCRATCH, 'coral-participation-synthetic-'));
  try {
    cpSync(BUILD, join(sandbox, 'build.mjs'));
    cpSync(join(HERE, 'manifest-schema.mjs'), join(sandbox, 'manifest-schema.mjs'));
    cpSync(join(HERE, 'normalize-generated-code.mjs'), join(sandbox, 'normalize-generated-code.mjs'));
    cpSync(join(HERE, 'package.json'), join(sandbox, 'package.json'));
    writeFileSync(join(sandbox, 'corals.mjs'),
      "export const CORALS = {\n"
      + "  'zzyzx-registry-probe': { src: 'zzyzx.mjs', bundle: false, registry: true },\n"
      + "  'zzyzx-local-probe': { src: 'zzyzx.mjs', bundle: true, registry: false },\n"
      + "};\n");
    for (const name of ['zzyzx-registry-probe', 'zzyzx-local-probe']) {
      const dir = join(sandbox, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'),
        JSON.stringify({ name: `@cver/${name}`, version: '0.0.0-probe', private: true, type: 'module' }, null, 2) + '\n');
      writeFileSync(join(dir, 'zzyzx.mjs'), 'export const PROBE = true;\n');
    }
    // ESBUILD points at node itself: the registry-flagged probe is bundle:false, so it is never
    // invoked there (it fails at the manifest check first); the local-only probe is bundle:true, so
    // it IS invoked, and running node on a trivial ES module as its own "bundle" step is enough to
    // prove the local build runs to completion — this test does not care what the bytes are.
    const env = strippedEnv({ ESBUILD: process.execPath });

    // registry:true, no manifest.json → refused, nothing written, for a name build.mjs cannot have
    // special-cased.
    {
      const registry = join(sandbox, 'registry-for-registry-probe');
      let refused = null;
      try {
        execFileSync('node', [join(sandbox, 'build.mjs'), 'zzyzx-registry-probe', '--registry', registry],
          { stdio: 'pipe', env });
      } catch (e) { refused = e; }
      const stderr = String(refused?.stderr ?? '');
      ok('a synthetic registry-flagged coral with no manifest.json is refused',
        refused !== null && refused.status === 1 && /has no manifest\.json/.test(stderr),
        refused === null ? 'the build SUCCEEDED' : stderr.trim());
      ok('and nothing was published for it — the registry dir was never even created', !existsSync(registry));
    }

    // registry:false, no manifest.json → builds its local artifact, registry untouched, for a name
    // build.mjs cannot have special-cased either.
    {
      const registry = join(sandbox, 'registry-for-local-probe');
      execFileSync('node', [join(sandbox, 'build.mjs'), 'zzyzx-local-probe', '--registry', registry],
        { stdio: 'inherit', env });
      ok('a synthetic local-only coral builds its local artifact with no manifest.json',
        existsSync(join(sandbox, 'zzyzx-local-probe', 'zzyzx-local-probe.js')));
      ok('CONTROL: and it created no registry directory at all — not even an empty one',
        !existsSync(registry));
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// ── (3) a REAL registry participant (square-shop) with its manifest removed still fails loudly ─
// A throwaway COPY of the source tree, never the real manifest.json — the real one is never
// touched, let alone deleted.
{
  const sandbox = mkdtempSync(join(SCRATCH, 'coral-participation-manifest-removed-'));
  try {
    cpSync(BUILD, join(sandbox, 'build.mjs'));
    cpSync(join(HERE, 'corals.mjs'), join(sandbox, 'corals.mjs'));
    cpSync(join(HERE, 'manifest-schema.mjs'), join(sandbox, 'manifest-schema.mjs'));
    cpSync(join(HERE, 'normalize-generated-code.mjs'), join(sandbox, 'normalize-generated-code.mjs'));
    cpSync(join(HERE, 'package.json'), join(sandbox, 'package.json'));
    mkdirSync(join(sandbox, 'square-shop'), { recursive: true });
    cpSync(join(HERE, 'square-shop', 'square-shop.js'), join(sandbox, 'square-shop', 'square-shop.js'));
    cpSync(join(HERE, 'square-shop', 'package.json'), join(sandbox, 'square-shop', 'package.json'));
    // deliberately NOT copying square-shop/manifest.json — this is the removal under test.
    ok('the sandbox really has no manifest.json (the fixture, not a claim)',
      !existsSync(join(sandbox, 'square-shop', 'manifest.json')));

    const registry = join(sandbox, 'registry');
    // square-shop is bundle:false, so the ESBUILD binary is never actually invoked — pointing it at
    // node keeps this green without a real bundler installed.
    const env = strippedEnv({ ESBUILD: process.execPath });
    let refused = null;
    try {
      execFileSync('node', [join(sandbox, 'build.mjs'), 'square-shop', '--registry', registry], { stdio: 'pipe', env });
    } catch (e) { refused = e; }
    const stderr = String(refused?.stderr ?? '');
    ok('a real registry participant (square-shop) with its manifest.json removed is refused',
      refused !== null && refused.status === 1 && /square-shop@[\d.]+ has no manifest\.json/.test(stderr),
      refused === null ? 'the build SUCCEEDED' : stderr.trim());
    ok('and nothing was published for it', !existsSync(registry));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// ── (4) an unknown positional coral name fails loudly and names the input; CONTROL: a known ────
// name exits 0 — the same throwaway registry proves the control wrote only under it.
{
  const registry = mkdtempSync(join(tmpdir(), 'coral-participation-unknown-name-'));
  try {
    const env = strippedEnv({ ESBUILD: process.execPath }); // never invoked: the control below is bundle:false
    let refused = null;
    try {
      execFileSync('node', [BUILD, 'no-such-coral', '--registry', registry], { stdio: 'pipe', env });
    } catch (e) { refused = e; }
    const stderr = String(refused?.stderr ?? '');
    ok('an unknown positional coral name exits non-zero and names the bad input',
      refused !== null && refused.status === 1 && /unknown coral "no-such-coral"/.test(stderr),
      refused === null ? 'the build SUCCEEDED' : stderr.trim());
    ok('and it attempted no registry write at all', !existsSync(join(registry, 'versions')));

    // CONTROL: inbox-bubble is bundle:false (no bundler needed) and has no coral-default markers
    // (no --defaults needed), so it is the cheapest real, known, registry-participant name to prove
    // the check above is about the NAME being unrecognised, not "any invocation fails".
    execFileSync('node', [BUILD, 'inbox-bubble', '--registry', registry], { stdio: 'inherit', env });
    const written = join(registry, 'versions', 'inbox-bubble');
    ok('CONTROL: a known coral name exits 0 and actually publishes', existsSync(written));
    ok('and everything it wrote landed under the throwaway registry this test gave it, not elsewhere',
      written.startsWith(registry + sep));
  } finally {
    rmSync(registry, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
