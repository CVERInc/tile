// The three-line rebuild, held to the only IR this repo actually ships.
//
// 🩸 THE README'S HEADLINE COMMAND DID NOT RUN. Copied verbatim onto a clean clone and pointed at
// packages/build/fixtures/ir it exited 2 — `declares 'theme: paperkite' but no themeFile was
// given` — because the recipe named no `--theme`. Measured 2026-09-07. The one paragraph this
// package exists to make true was the one paragraph nothing executed, and prose has no CI.
//
// So the recipe is PARSED OUT OF THE README here and run against the fixture. Edit that line and
// this file is what tells you the new spelling does not work.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { collectPages } from './mkpages.mjs';
import { stageSite } from './stage.mjs';

const README = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
const CLI = readFileSync(new URL('./cli.mjs', import.meta.url), 'utf8');
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

// A renderer-shaped empty directory, not the real one: `node --test <glob>` runs these files in
// PARALLEL, and build-site.test.mjs is already borrowing packages/sitetile/astro. Two runs staging
// into one renderer is the very thing stage.mjs now refuses.
function stubRenderer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tile-build-recipe-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), '{ "name": "@tile/sitetile-astro-stub", "type": "module" }\n');
  return dir;
}

// The third line of the fenced block under "## The three-line rebuild" — the actual subject.
const recipe = (() => {
  const block = README.split('## The three-line rebuild')[1]?.split('```')[1] ?? '';
  const lines = block.trim().split('\n');
  assert.equal(lines.length, 3, 'the three-line rebuild is no longer three lines');
  return lines[2].trim();
})();

// The recipe's own argv, read the way cli.mjs reads it: `--name value`, positionals otherwise.
const argv = recipe.split(/\s+/).slice(3);              // drop `node engine/packages/build/cli.mjs`
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : argv[i + 1]; };

test('the recipe names ./ir and ./dist, and every flag it uses is one the CLI documents', () => {
  assert.match(recipe, /^node engine\/packages\/build\/cli\.mjs \.\/ir \.\/dist /);
  for (const f of argv.filter((a) => a.startsWith('--'))) {
    assert.ok(CLI.includes(`  ${f} `), `the recipe passes ${f}, which the CLI's usage does not list`);
  }
});

test('the recipe and the copy of it at the top of cli.mjs have not drifted apart', () => {
  assert.ok(CLI.includes(recipe), 'cli.mjs still carries the OLD recipe in its header comment');
});

// 🔴 The export's shape, asserted where somebody reading the recipe would look for it: the compiled
// theme.css sits BESIDE ir/, because the platform compiles it and ships it with the export. Nothing
// in this repo compiles `_theme.md`; fixtures/theme.css is a hand-written stand-in for the one a
// real export carries, and its position on disk is the part that has to be true.
test('the fixture is laid out like an export: theme.css beside ir/', () => {
  assert.equal(flag('theme'), './theme.css', 'the recipe no longer passes the exported stylesheet');
  assert.ok(existsSync(`${FIXTURES}/ir/home.md`));
  assert.ok(existsSync(`${FIXTURES}/theme.css`));
});

test('the recipe, run verbatim on the fixture, stages — and without --theme it is the exit 2', async (t) => {
  const astroDir = stubRenderer(t);
  const pages = collectPages(`${FIXTURES}/ir`);
  const themeFile = `${FIXTURES}/${flag('theme').replace(/^\.\//, '')}`;

  const { restore, pageCount } = await stageSite({ astroDir, pages, themeFile });
  try { assert.equal(pageCount, 7); } finally { await restore(); }

  // …and the defect itself, pinned: drop the flag the recipe now carries and this is what happens.
  await assert.rejects(() => stageSite({ astroDir, pages }), (err) => {
    assert.match(err.message, /declares 'theme: paperkite' but no themeFile/);
    assert.match(err.message, /travels with the export, beside ir\//,
      'the refusal must say where theme.css comes from, or it reads like a missing feature');
    return true;
  });
});
