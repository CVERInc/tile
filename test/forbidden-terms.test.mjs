// scripts/forbidden-terms.mjs must go RED on each kind of term it claims to guard, and must not print
// the term while refusing it. Every term here is planted synthetic text — no real handle or private
// name appears in this file, because this file is published too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'forbidden-terms.mjs');
const { scan, handleHash } = await import(GATE);

const PLANTED_HANDLE = 'zzplantedhandlezz';
const PLANTED_PRIVATE = 'zzplantedprivatezz';
const PRIVATE_LINK = ['CVERInc', 'reef'].join('/') + '#1'; // assembled so this file does not match itself

const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-terms-'));
  made.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  return dir;
}
function lists() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-lists-'));
  made.push(dir);
  const hashes = path.join(dir, 'hashes');
  fs.writeFileSync(hashes, `# synthetic\n${handleHash('someoneelse')}\n${handleHash(PLANTED_HANDLE)}\n`);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, `# synthetic\n${PLANTED_PRIVATE}\n`);
  return { hashes, priv };
}
const filler = () => Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f/${i}.txt`, `line ${i}\n`]));

test('control: a clean tree is green, and the scan actually read the files', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': 'the product owner ruled; see reef#1\n', 'b.js': '// webkitTextFillColor is not a handle\n' }), hashesFile: hashes });
  assert.equal(r.files, 2);
  assert.equal(r.privateEntries, 1);
  assert.deepEqual(r.hits, []);
});

test('RED: a hashed person handle, in any case, as a whole token — and not as a substring', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': `x\n(${PLANTED_HANDLE.toUpperCase()} 2026-10-31)\n`, 'b.md': `prefix${PLANTED_HANDLE}suffix\n` }), hashesFile: hashes });
  assert.deepEqual(r.hits, ['a.md:2: person handle #2']);
});

test('RED: a handle in a file PATH', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ [`docs/${PLANTED_HANDLE}-notes.md`]: 'clean\n' }), hashesFile: hashes });
  assert.equal(r.hits.length, 1);
  assert.match(r.hits[0], /\(in the path\) person handle #2$/);
});

test('RED: an entry from the private list read OUTSIDE the repo', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': `a sample: ${PLANTED_PRIVATE}.example\n` }), hashesFile: hashes });
  assert.deepEqual(r.hits, ['a.md:1: private list entry #1']);
});

test('RED: a link to a private repo; a bare repo#N is allowed', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ 'a.md': `ok reef#1\nbad ${PRIVATE_LINK}\nbad https://github.com/${PRIVATE_LINK.replace('#', '/issues/')}\n` }), hashesFile: hashes });
  assert.deepEqual(r.hits.map((h) => h.split(': ')[0]), ['a.md:2', 'a.md:3']);
});

test('no private list: skipped out loud, and a failure when it is required', () => {
  const { hashes } = lists();
  process.env.CVER_FORBIDDEN_TERMS = path.join(os.tmpdir(), 'there-is-no-list-here');
  const root = repo({ 'a.md': 'clean\n' });
  const loose = scan({ root, hashesFile: hashes, required: false });
  assert.equal(loose.privateEntries, 0);
  assert.ok(loose.notes.some((n) => !n.fatal && /NOT checked/.test(n.text)));
  const strict = scan({ root, hashesFile: hashes, required: true });
  assert.ok(strict.notes.some((n) => n.fatal));
});

test('CLI: exits non-zero on a hit and never prints the matched text', () => {
  const { hashes, priv } = lists();
  const root = repo({ ...filler(), 'leak.md': `by ${PLANTED_HANDLE}\nexample ${PLANTED_PRIVATE}\n` });
  const res = spawnSync(process.execPath, [GATE, '--root', root, '--hashes', hashes], { encoding: 'utf8', env: { ...process.env, CVER_FORBIDDEN_TERMS: priv } });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /leak\.md:1: person handle #2/);
  assert.match(res.stderr, /leak\.md:2: private list entry #1/);
  assert.ok(!(res.stdout + res.stderr).includes(PLANTED_HANDLE) && !(res.stdout + res.stderr).includes(PLANTED_PRIVATE), 'the refusal printed the term');
  // control: the same tree without the leak passes
  fs.rmSync(path.join(root, 'leak.md'));
  execFileSync('git', ['-C', root, 'add', '-A']);
  const ok = spawnSync(process.execPath, [GATE, '--root', root, '--hashes', hashes], { encoding: 'utf8', env: { ...process.env, CVER_FORBIDDEN_TERMS: priv } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test('the committed hash list is well-formed and non-empty', () => {
  const r = scan({ root: repo({ 'a.md': 'clean\n' }) });
  assert.ok(r.hashes >= 3, 'the real handle list is suspiciously short');
});
