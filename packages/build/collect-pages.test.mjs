// collectPages parity — the bytes and the CLI, held to what the original produced.
//
// 🔴 WHY A COMMITTED FIXTURE AND NOT AN IMPORT. This collector arrived from a private checkout
// (CVERInc/ejecta tools/fidelity/mkpages.mjs) and a private runner will swap THIS file in for that
// one, by path, inside a container. The contract is therefore the output, not the source — so the
// expected JSON below was generated ONCE by the pre-move original against fixtures/ir/ and
// committed. Nothing here reaches across a repo boundary at test time: a test that imported the
// original would pass on the one machine that has it and be unrunnable everywhere else, which is
// the same as not having a parity test at all.
//
// To regenerate after a deliberate change to the fixture tree, run the CLI in this package and
// commit the result — but understand that doing so replaces the witness with the accused.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const IR = fileURLToPath(new URL('./fixtures/ir', import.meta.url));
const MKPAGES = fileURLToPath(new URL('./mkpages.mjs', import.meta.url));
const expected = readFileSync(new URL('./fixtures/expected-site-pages.json', import.meta.url));
const expectedWithPosts = readFileSync(new URL('./fixtures/expected-site-pages-include-posts.json', import.meta.url));

const { collectPages } = await import('./mkpages.mjs');
const serialise = (pages) => Buffer.from(JSON.stringify(pages, null, 2));

test('collectPages() serialises byte-identically to the original', () => {
  assert.deepEqual(serialise(collectPages(IR)), expected);
});

test('collectPages({includePosts}) serialises byte-identically to the original', () => {
  assert.deepEqual(serialise(collectPages(IR, { includePosts: true })), expectedWithPosts);
});

test('the CLI writes the same bytes to stdout', () => {
  const stdout = execFileSync(process.execPath, [MKPAGES, IR], { cwd: HERE });
  assert.deepEqual(stdout, expected);
});

test('the CLI writes the same bytes to an out.json, and says so on stderr', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'tile-build-mkpages-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'site_pages.json');
  const r = spawnSync(process.execPath, [MKPAGES, IR, out], { cwd: HERE });
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout, Buffer.alloc(0), 'nothing on stdout when an out.json is given');
  assert.deepEqual(readFileSync(out), expected);
  // The stderr line is part of the contract too — a caller reads it back to the operator.
  assert.equal(String(r.stderr), `▸ wrote 7 page(s) → ${out}\n`);
});

test('the CLI exits 2 with the original usage line when given no ir-dir', () => {
  const r = (() => {
    try {
      execFileSync(process.execPath, [MKPAGES], { stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stderr: '' };
    } catch (e) { return { status: e.status, stderr: String(e.stderr) }; }
  })();
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'usage: node mkpages.mjs <ir-dir> [out.json] [--include-posts]\n');
});

test('a trailing --include-posts is a flag, never an out.json', () => {
  const stdout = execFileSync(process.execPath, [MKPAGES, IR, '--include-posts']);
  assert.deepEqual(stdout, expectedWithPosts);
});

// ── the rules the bytes encode, said out loud, so a regeneration cannot quietly bless a change ──
const paths = collectPages(IR).map((p) => p.path);

test('_theme.md is not a page and _site.md is', () => {
  assert.equal(paths.includes('_theme'), false);
  assert.ok(paths.includes('_site'));
});

test('a locale home collapses and a nested page stays nested', () => {
  assert.ok(paths.includes('zh-tw'), 'zh-tw/home.md → "zh-tw", not "zh-tw/home"');
  assert.ok(paths.includes('ja-jp'));
  assert.ok(paths.includes('legal/terms'));
  assert.ok(paths.includes('home'), 'the base home keeps the literal path "home"');
});

test('a CJK page path survives collection unchanged', () => {
  assert.ok(paths.includes('zh-tw/關於'));
});

test('a path is emitted verbatim — this half sanitises nothing', () => {
  assert.ok(paths.includes('our team & friends'),
    'spaces and & belong to stage.mjs to resolve, not to the collector');
});

test('posts/ is the blog corpus, not the page corpus', () => {
  assert.equal(paths.some((p) => p.startsWith('posts/')), false);
  assert.ok(collectPages(IR, { includePosts: true }).some((p) => p.path === 'posts/a-first-flight'));
});

test('pages are sorted by path and carry their markdown verbatim', () => {
  const pages = collectPages(IR);
  assert.deepEqual(paths, [...paths].sort((a, b) => a.localeCompare(b)));
  const home = pages.find((p) => p.path === 'home');
  assert.equal(home.markdown, readFileSync(new URL('./fixtures/ir/home.md', import.meta.url), 'utf8'));
});
