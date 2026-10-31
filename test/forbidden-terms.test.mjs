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

// ── review of #230 ───────────────────────────────────────────────────────────────────────────────

const cli = (root, hashes, env) => spawnSync(process.execPath, [GATE, '--root', root, '--hashes', hashes], { encoding: 'utf8', env: { ...process.env, ...env } });

test('P2: a forbidden term in a FILE NAME is never printed — the path is withheld, every tier, content hits too', () => {
  const { hashes, priv } = lists();
  const repoLinkDir = ['CVERInc', 'reef'].join('/');
  const root = repo({
    ...filler(),
    [`docs/${PLANTED_PRIVATE}.md`]: `clean\nby ${PLANTED_HANDLE}\n`,
    [`notes/${PLANTED_HANDLE}-log.md`]: 'clean\n',
    [`${repoLinkDir}/notes.md`]: 'clean\n',
  });
  const res = cli(root, hashes, { CVER_FORBIDDEN_TERMS: priv });
  const out = res.stdout + res.stderr;
  assert.equal(res.status, 1, out);
  for (const secret of [PLANTED_PRIVATE, PLANTED_HANDLE, repoLinkDir]) assert.ok(!out.includes(secret), `the refusal printed ${secret}`);
  assert.match(out, /path withheld/);
  assert.match(out, /\(in the path\) private list entry #1/);
  assert.match(out, /\(in the path\) person handle #2/);
  assert.match(out, /\(in the path\) link to a private repo/);
  assert.match(out, /: person handle #2$/m, 'the content hit inside the withheld file is still reported');
});

test('P3: the private-repo pattern applies to paths, with clean controls', () => {
  const { hashes, priv } = lists();
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const r = scan({ root: repo({ [`${['CVERInc', 'reef'].join('/')}/notes.md`]: 'clean\n', 'reef/notes.md': 'clean\n', 'docs/reef-notes.md': 'clean\n' }), hashesFile: hashes });
  assert.equal(r.hits.length, 1, r.hits.join('\n'));
  assert.match(r.hits[0], /\(in the path\) link to a private repo/);
});

// The push-time content guard reads the same list as ONE extended regex: comments stripped, entries
// joined with `|`, `grep -niE`. That pipeline, run here verbatim, is the oracle.
function contentGuardOracle(listFile, line) {
  const pat = execFileSync('bash', ['-c', `grep -vE '^\\s*(#|$)' "$1" | paste -sd'|' -`, '_', listFile], { encoding: 'utf8' }).trim();
  return spawnSync('grep', ['-niE', pat], { input: `+${line}\n` }).status === 0;
}

test('P2: the private list keeps grep -E semantics — POSIX classes agree with the push guard on every sample', () => {
  const { hashes } = lists();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-ere-'));
  made.push(dir);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, `# synthetic, ERE with POSIX classes\n(^|[^[:alnum:]_])${PLANTED_PRIVATE}([^[:alnum:]_]|$)\n[[:digit:]]{3}-zzsynthcode\n`);
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const samples = [
    `example: ${PLANTED_PRIVATE}.`, `${PLANTED_PRIVATE.toUpperCase()}`, `x${PLANTED_PRIVATE}`, `${PLANTED_PRIVATE}_y`,
    'ref 123-zzsynthcode', 'ref 12-zzsynthcode', 'ref abc-zzsynthcode', 'nothing here',
  ];
  let agreedRed = 0;
  for (const s of samples) {
    const expected = contentGuardOracle(priv, s);
    const got = scan({ root: repo({ 'a.md': `${s}\n` }), hashesFile: hashes }).hits.length > 0;
    assert.equal(got, expected, `gate and content guard disagree on ${JSON.stringify(s)}: gate ${got}, guard ${expected}`);
    if (expected) agreedRed++;
  }
  assert.ok(agreedRed >= 3 && agreedRed < samples.length, 'the oracle samples must include both hits and misses');
});

test('P2: a private entry grep -E cannot compile is refused, not skipped', () => {
  const { hashes } = lists();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-bad-'));
  made.push(dir);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, 'ok-term\n[[:nosuchclass:]]x\n');
  process.env.CVER_FORBIDDEN_TERMS = priv;
  assert.throws(() => scan({ root: repo({ 'a.md': 'clean\n' }), hashesFile: hashes }), /private list entry #2/);
});

test('P3: an existing but EMPTY private list counts as missing — fatal when required', () => {
  const { hashes } = lists();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-empty-'));
  made.push(dir);
  const priv = path.join(dir, 'private');
  fs.writeFileSync(priv, '# comments only\n\n');
  process.env.CVER_FORBIDDEN_TERMS = priv;
  const root = repo({ 'a.md': 'clean\n' });
  assert.ok(scan({ root, hashesFile: hashes, required: true }).notes.some((n) => n.fatal), 'an empty required list passed');
  assert.ok(scan({ root, hashesFile: hashes, required: false }).notes.some((n) => !n.fatal && /NOT checked/.test(n.text)));
});
