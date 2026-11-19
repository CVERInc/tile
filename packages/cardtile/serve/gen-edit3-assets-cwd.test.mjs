// gen-edit3-assets.mjs must write the same bytes wherever it is run from (tile#322).
//   run: node --test packages/cardtile/serve/gen-edit3-assets-cwd.test.mjs
//
// The generator is run for real, three times, in a throwaway copy of the tracked tree: from the
// repository root, from a subdirectory of it, and from the folder that contains it. The copy keeps the
// committed bundles untouched while the generator rewrites them. Every run must produce byte-identical
// edit3-assets.mjs and deck-assets.mjs.
//
// esbuild is not a dependency of this repository (CI has none), so without it this test names itself
// skipped instead of passing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const GEN = 'packages/cardtile/serve/gen-edit3-assets.mjs';
const OUTPUTS = ['packages/cardtile/serve/edit3-assets.mjs', 'packages/cardtile/serve/deck-assets.mjs'];

let esbuildDir = null;
try {
  const main = fileURLToPath(import.meta.resolve('esbuild', new URL(`file://${join(ROOT, GEN)}`)));
  const at = main.lastIndexOf(`${sep}node_modules${sep}esbuild${sep}`);
  if (at >= 0) esbuildDir = main.slice(0, at + `${sep}node_modules${sep}esbuild`.length);
} catch { /* not installed: skipped below */ }

test('gen-edit3-assets writes the same bundle from the root, a subdirectory and a parent folder',
  { skip: esbuildDir ? false : 'esbuild is not resolvable from the generator' }, () => {
    const box = fs.mkdtempSync(join(os.tmpdir(), 'gen-edit3-cwd-'));
    try {
      const copy = join(box, 'repo');
      const files = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { timeout: 30_000, maxBuffer: 64 << 20 })
        .toString('utf8').split('\0').filter(Boolean);
      for (const f of files) {
        const from = join(ROOT, f);
        if (!fs.existsSync(from)) continue;   // deleted in the working tree
        fs.mkdirSync(dirname(join(copy, f)), { recursive: true });
        fs.copyFileSync(from, join(copy, f));
      }
      fs.mkdirSync(join(copy, 'node_modules'), { recursive: true });
      fs.symlinkSync(esbuildDir, join(copy, 'node_modules', 'esbuild'), 'dir');

      const runFrom = (cwd) => {
        execFileSync(process.execPath, [join(copy, GEN)], { cwd, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
        return Object.fromEntries(OUTPUTS.map((o) => [o, fs.readFileSync(join(copy, o), 'utf8')]));
      };
      const fromRoot = runFrom(copy);
      // the bundle names the modules it carries; from the root those names are repository paths
      assert.match(fromRoot[OUTPUTS[0]], /\\n\/\/ packages\/cardtile\/w3\/edit3\.mjs\\n/);
      const diffs = [];
      for (const cwd of [join(copy, 'packages', 'cardtile'), box]) {
        const got = runFrom(cwd);
        for (const o of OUTPUTS) {
          if (got[o] === fromRoot[o]) continue;
          let i = 0; while (got[o][i] === fromRoot[o][i]) i++;
          diffs.push(`${o} differs when generated from ${cwd.slice(box.length) || '(parent folder)'}, first at byte ${i}:\n` +
            `  root: ${JSON.stringify(fromRoot[o].slice(i - 20, i + 60))}\n  here: ${JSON.stringify(got[o].slice(i - 20, i + 60))}`);
        }
      }
      assert.deepEqual(diffs, []);
    } finally {
      fs.rmSync(box, { recursive: true, force: true });
    }
  });
