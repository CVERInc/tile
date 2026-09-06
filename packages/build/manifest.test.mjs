// The manifest, checked for the one field that can turn this package's own gate green while it
// reads nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 🩸 Measured 2026-09-06, on this package's first day. `node --test packages/build/` — the command
// the README and scripts/test.sh both stand behind — resolved the DIRECTORY through `main` to
// index.mjs, ran that single file as the entire suite, found no tests in it and printed
// `# tests 1 / # pass 1 / # fail 0`. A green gate that had read none of the four test files beside
// it. `exports` resolves `import '@tile/build'` exactly the same way and leaves the directory
// searchable, so the fix is the absence of a field — which is precisely the kind of fix that comes
// back the next time somebody makes a manifest look conventional.
test('the manifest declares no `main` — it would make `node --test packages/build/` read nothing', () => {
  assert.equal('main' in manifest, false,
    'package.json grew a `main` field: `node --test packages/build/` now runs that ONE file as the '
    + 'whole suite and passes without reading any test in this package. Use `exports` instead.');
});

test('the manifest still resolves the package and its two named entrypoints', () => {
  assert.deepEqual(Object.keys(manifest.exports), ['.', './mkpages.mjs', './stage.mjs']);
  assert.equal(manifest.exports['.'], './index.mjs');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.license, 'MIT');
});
