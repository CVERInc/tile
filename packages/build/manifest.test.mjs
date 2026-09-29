// The manifest, checked for the one field that can turn this package's own gate green while it
// reads nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

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

// 🩸 `bin` names a file, and npm links that file onto PATH as-is — so a `bin` whose target is
// mode 100644 is a command that installs cleanly and then answers `permission denied`. cli.mjs was
// exactly that (#16, R3-9): it had its shebang and its `bin` entry and no execute bit. Asked of the
// working tree, which is what git's recorded mode becomes on checkout.
test('every `bin` target is executable and starts with a shebang', () => {
  for (const [name, rel] of Object.entries(manifest.bin ?? {})) {
    const file = new URL(rel, import.meta.url);
    assert.notEqual(statSync(file).mode & 0o111, 0,
      `bin "${name}" → ${rel} has no execute bit — run: git update-index --chmod=+x packages/build/${rel.replace(/^\.\//, '')}`);
    assert.match(readFileSync(file, 'utf8'), /^#!\/usr\/bin\/env node\n/, `bin "${name}" → ${rel} has no shebang`);
  }
});
