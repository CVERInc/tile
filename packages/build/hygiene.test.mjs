// What this package says about where it came from, checked for what it must not say.
//
// 🩸 Two comments here named a PRIVATE repository and the path of a file inside it — the repo it
// belongs to, the file's location in that repo, and the fact that a runner swaps it in by path.
// None of that is a credential, a customer or a hostname, so the repo's publish-safety scan is
// structurally incapable of seeing it: that scan looks for names, hosts and secret prefixes.
// Measured 2026-09-07 by reading, which is the only thing that had ever looked.
//
// The provenance those comments carry is real and worth keeping — "a private checkout" says all of
// it. The name adds nothing to a reader here and takes something away from the person who owns it.
//
// 🔴 THIS FILE DELIBERATELY DOES NOT SPELL THE NAME IT FORBIDS. A gate written as
// `assert(!src.includes('<the-private-repo>'))` publishes the thing it exists to keep unpublished.
// So the rule is shaped instead: under this organisation, the only repository that may be named
// here is the public one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_REPO = 'tile';   // github.com/CVERInc/tile — the one this file is in

const TEXT = new Set(['.mjs', '.js', '.json', '.md', '.css', '.sh', '']);
function textFiles(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) textFiles(full, acc);
    else if (TEXT.has(extname(e.name))) acc.push(full);
  }
  return acc;
}
const sources = textFiles(HERE).map((f) => [f.slice(HERE.length), readFileSync(f, 'utf8')]);

test('the files here exist and are being read', () => {
  assert.ok(sources.length >= 10, `only ${sources.length} files scanned — this gate is not looking`);
  assert.ok(sources.some(([f]) => f === 'mkpages.mjs'));
});

test('no repository under this organisation is named here except the public one', () => {
  for (const [file, src] of sources) {
    for (const [, repo] of src.matchAll(/CVERInc\/([A-Za-z0-9_.-]+)/g)) {
      assert.equal(repo.replace(/\.git$/, ''), PUBLIC_REPO,
        `${file} names a repository other than the public one — provenance is "a private checkout"`);
    }
  }
});

// The patterns are ASSEMBLED rather than written out for the same reason the repo name above is
// not spelled: this file is one of the files it scans, and a gate that trips on itself is a gate
// somebody switches off.
const HOME_PATHS = [
  new RegExp(['', 'Users', '[A-Za-z0-9._-]+'].join('/')),
  new RegExp('\\$' + 'HOME\\b'),
];

test('no path out of somebody\'s machine is quoted here', () => {
  for (const [file, src] of sources) {
    for (const re of HOME_PATHS) {
      assert.equal(re.test(src), false, `${file} quotes a path off somebody's own machine (${re})`);
    }
  }
});
