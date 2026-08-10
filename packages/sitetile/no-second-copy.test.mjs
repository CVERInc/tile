// Guard: sitetile must not keep its own copy of anything @cvernet/signet ships.
//   run: node packages/sitetile/no-second-copy.test.mjs   (wired into scripts/test.sh)
//
// WHY THIS EXISTS. On 2026-07-01 a recast snapshot copied signet's locale banner
// into src/packages/lingo/. Every fix after that — host-theme colours, a 2.60:1
// contrast bug, a banner-height var literally named --signet-* — landed only on
// the copy and never went home, for four weeks. Both files still opened with
// `@cvernet/signet`, so anyone debugging went to the package and read a file four
// fixes behind. Nobody decided to fork; a copy just drifted. A seal with two
// impressions is not a seal, so this fails the build instead.
//
// Two detectors, because the copy had both tells:
//   1. a file here whose name matches something signet ships
//   2. a file here whose header claims to BE signet (catches a renamed copy)
// Import from the package instead — that is the whole fix.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, 'astro', 'src');
const SIGNET = join(HERE, 'astro', 'node_modules', '@cvernet', 'signet');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

/** Every file under dir, recursively. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The names signet publishes, from its own package exports (not a hardcoded list). */
function signetFileNames() {
  const pkg = JSON.parse(readFileSync(join(SIGNET, 'package.json'), 'utf8'));
  const names = new Set();
  for (const target of Object.values(pkg.exports || {})) {
    for (const v of typeof target === 'string' ? [target] : Object.values(target)) {
      if (typeof v === 'string' && v.endsWith('.d.ts') === false) names.add(basename(v));
    }
  }
  return names;
}

// The detectors, as pure functions over (path, firstLines) so the control below
// can run them on a planted file without touching the disk.
const nameCollides = (path, shipped) => shipped.has(basename(path));
// Precise on purpose: the file must OPEN by signing itself as signet, the way
// both 2026-07-01 copies did (`/* @cvernet/signet — …`). Merely mentioning the
// package — `import '@cvernet/signet/arrow.css'; // …` on line 3 of Cta.astro —
// is correct usage and must not trip anything. A check that fires on the right
// answer teaches people to ignore it.
const claimsToBeSignet = (_path, head) => {
  const first = head.split('\n').find((l) => l.trim() !== '') || '';
  return /^\s*(\/\*+|\/\/)\s*@cvernet\/signet\b/.test(first);
};

test('no file here shares a name with something signet ships', () => {
  if (!existsSync(SIGNET)) { console.log('    (skipped: @cvernet/signet not installed)'); return; }
  const shipped = signetFileNames();
  const hits = walk(ROOT).filter((p) => nameCollides(p, shipped));
  assert.deepEqual(hits.map((p) => p.slice(ROOT.length + 1)), [],
    'these duplicate a signet export — delete them and import from @cvernet/signet instead');
});

test('no file here has a signet header (a renamed copy)', () => {
  const hits = walk(ROOT)
    .filter((p) => /\.(css|js|mjs|astro|svelte)$/.test(p))
    .filter((p) => claimsToBeSignet(p, readFileSync(p, 'utf8').split('\n').slice(0, 4).join('\n')));
  assert.deepEqual(hits.map((p) => p.slice(ROOT.length + 1)), [],
    'these open by claiming to be @cvernet/signet — if it IS signet, import it; if not, fix the header');
});

// CONTROL. A guard nobody has watched fail only proves it is quiet on clean
// input. Plant the exact 2026-07-01 copy and require BOTH detectors to fire.
test('control: the guard catches a planted copy', () => {
  const shipped = existsSync(SIGNET) ? signetFileNames() : new Set(['locale-banner.css']);
  const planted = join(ROOT, 'packages', 'lingo', 'locale-banner.css');
  assert.equal(nameCollides(planted, shipped), true, 'name detector went blind');
  assert.equal(claimsToBeSignet(planted, '/* @cvernet/signet — locale-suggestion banner.\n *\n * A top strip…'), true,
    'header detector went blind');
});

console.log(`\n${passed} passed`);
