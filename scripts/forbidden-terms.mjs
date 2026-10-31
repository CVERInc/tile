#!/usr/bin/env node
// forbidden-terms — fail when a tracked file in this PUBLIC repo carries a term that must not be
// published here. Run by scripts/test.sh, so the pre-push hook and CI ask the same question.
//
// Three kinds of term, and where each one's list lives is the whole design:
//
//   1. PERSON HANDLES (who wrote or ruled something). Listed below only as salted hashes of a
//      lowercased token, in scripts/forbidden-terms.hashes. A handle is a public login, so a hash is
//      not a secret against someone who already knows the handle — it only keeps the list from being
//      readable, greppable text in this repo. That is enough for this kind: confirming "this repo
//      refuses X" tells nobody anything X's owner has not already published.
//
//   2. THE PRIVATE LIST (names kept off this repo entirely, e.g. customer handles used as examples). NEVER hashed
//      into this repo: those names are guessable, so a hash would be a confirmation oracle — hash a
//      suspected name, find it in the file, and what the list keeps private is confirmed. This tier
//      reads the SAME private list the push-time content-guard reads, from outside the repo:
//        $CVER_FORBIDDEN_TERMS  →  `git config cver.forbiddenTerms`  →  ~/.config/git/forbidden-terms
//      One extended-regex per line, `#` comments. With no list on the machine this tier says so out
//      loud and is skipped — unless CVER_FORBIDDEN_TERMS_REQUIRED=1 (CI on this repo sets it), where a
//      missing list is a failure: a check that is absent must not print the same thing as a pass.
//
//   3. LINKS TO PRIVATE REPOS (`<org>/<private repo>` and their github.com URLs). Dead links for every
//      reader of a public repo. Not secret — the repo names are in the plain list below. Bare
//      `repo#123` stays allowed: it names an issue without pretending to be a link.
//
// 🔴 Hits are reported as `path:line` plus WHICH entry matched (handle #k / private #n / private
// repo), never the matched text: CI logs on a public repo are public, and printing the term would
// publish it in the act of refusing it. A path that itself matches is withheld wherever it would be
// printed and named by its position in `git ls-files` instead. All three tiers apply to paths too.
//
// Usage: node scripts/forbidden-terms.mjs [--root DIR] [--hashes FILE]
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const ROOT = path.resolve(arg('--root', path.join(HERE, '..')));
const HASHES = arg('--hashes', path.join(HERE, 'forbidden-terms.hashes'));

export const SALT = 'cver-forbidden-handle-v1:';
export const handleHash = (token) => createHash('sha256').update(SALT + token.toLowerCase()).digest('hex').slice(0, 24);

// Tier 3. The org and the repo names are kept apart so this file does not match its own pattern.
const ORG = 'CVERInc';
const PRIVATE_REPOS = ['reef', 'tile-lab'];
const PRIVATE_REPO_LINK = new RegExp(`${ORG}/(?:${PRIVATE_REPOS.map((r) => r.replace(/-/g, '\\-')).join('|')})(?![\\w-])`, 'i');

function readHashes(file) {
  if (!fs.existsSync(file)) throw new Error(`forbidden-terms: hash list missing at ${file}`);
  const list = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const h of list) if (!/^[0-9a-f]{24}$/.test(h)) throw new Error(`forbidden-terms: malformed hash line in ${file}`);
  if (list.length === 0) throw new Error(`forbidden-terms: ${file} lists no hashes — a gate with nothing to look for passes everything`);
  return list;
}

function privateListPath() {
  if (process.env.CVER_FORBIDDEN_TERMS) return process.env.CVER_FORBIDDEN_TERMS;
  try {
    const p = execFileSync('git', ['config', '--global', '--get', 'cver.forbiddenTerms'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* unset */ }
  return path.join(os.homedir(), '.config', 'git', 'forbidden-terms');
}

// 🩸 review of #230: this tier used to compile each entry as a JavaScript RegExp, so a list written for
// `grep -iE` (the push-time content guard's engine) meant something else here — `[[:alnum:]]` is a
// bracket of letters in JS, and an entry that blocks a push matched nothing in this scan. It now runs
// grep itself, -i -E, entry by entry, so one list has one meaning. An entry grep cannot compile is a
// refusal, not a skip.
function grep(args, opts = {}) {
  return spawnSync('grep', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}
function readPrivateList(file) {
  if (!file || !fs.existsSync(file)) return null;
  const entries = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((src, i) => ({ n: i + 1, src }));
  for (const { n, src } of entries) {
    const r = grep(['-E', '-e', src], { input: '' });
    if (r.error || r.status > 1) throw new Error(`forbidden-terms: private list entry #${n} is not a valid extended regex (grep -E refused it)`);
  }
  return entries.length ? entries : null; // a list with no usable entry is no list (review of #230)
}
/** Which of `lines` (0-based) match the ERE `src`, case-insensitively — answered by grep. */
function grepLineSet(src, lines) {
  const r = grep(['-a', '-n', '-i', '-E', '-e', src], { input: lines.join('\n') + '\n' });
  if (r.status === 1) return new Set();
  if (r.status !== 0) throw new Error('forbidden-terms: grep failed on the private list');
  return new Set(r.stdout.split('\n').filter(Boolean).map((l) => Number(l.slice(0, l.indexOf(':'))) - 1));
}
/** { rel → Set(1-based line) } for every text file matching the ERE `src` — answered by grep. */
function grepFiles(root, src, rels) {
  const out = new Map();
  for (let i = 0; i < rels.length; i += 200) {
    const r = grep(['-a', '-n', '-i', '-E', '-H', '-Z', '-e', src, '--', ...rels.slice(i, i + 200)], { cwd: root });
    if (r.status === 1) continue;
    if (r.status !== 0) throw new Error('forbidden-terms: grep failed on the private list');
    for (const rec of r.stdout.split('\n')) {
      const z = rec.indexOf('\0');
      if (z < 0) continue;
      const rel = rec.slice(0, z);
      const line = Number(rec.slice(z + 1, rec.indexOf(':', z + 1)));
      if (!out.has(rel)) out.set(rel, new Set());
      out.get(rel).add(line);
    }
  }
  return out;
}

function trackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

const REPO_LINK_MSG = 'link to a private repo (write `repo#123`, no org, no URL)';

export function scan({ root = ROOT, hashesFile = HASHES, required = process.env.CVER_FORBIDDEN_TERMS_REQUIRED === '1' } = {}) {
  const hashes = readHashes(hashesFile);
  const hashIndex = new Map(hashes.map((h, i) => [h, i + 1]));
  const listFile = privateListPath();
  const privateList = readPrivateList(listFile);
  const notes = [];
  if (!privateList) {
    if (required) notes.push({ fatal: true, text: 'the private term list is REQUIRED here (CVER_FORBIDDEN_TERMS_REQUIRED=1) and none with a usable entry was found' });
    else notes.push({ fatal: false, text: 'private term list not on this machine — tier 2 (the private list) NOT checked' });
  }
  const seen = new Map(); // token → handle # or 0
  const handleOf = (tok) => {
    const k = tok.toLowerCase();
    let v = seen.get(k);
    if (v === undefined) { v = hashIndex.get(handleHash(k)) || 0; seen.set(k, v); }
    return v;
  };
  const found = []; // { i: file index, line: 0 for the path, what }
  const files = trackedFiles(root);
  const unsafePath = new Set();
  // ── paths: the path itself is published too ──
  files.forEach((rel, i) => {
    if (rel.includes('\n')) unsafePath.add(i);
    for (const tok of rel.match(/[A-Za-z0-9]+/g) || []) {
      const k = handleOf(tok);
      if (k) { found.push({ i, line: 0, what: `person handle #${k}` }); unsafePath.add(i); }
    }
    if (PRIVATE_REPO_LINK.test(rel)) { found.push({ i, line: 0, what: REPO_LINK_MSG }); unsafePath.add(i); }
  });
  if (privateList) for (const { n, src } of privateList) {
    for (const i of grepLineSet(src, files.map((f) => f.replace(/\n/g, ' ')))) { found.push({ i, line: 0, what: `private list entry #${n}` }); unsafePath.add(i); }
  }
  // ── contents (text files) ──
  const text = [];
  files.forEach((rel, i) => {
    let buf;
    try {
      if (!fs.statSync(path.join(root, rel)).isFile()) return; // a submodule
      buf = fs.readFileSync(path.join(root, rel));
    } catch { return; } // deleted in the work tree
    if (buf.subarray(0, 8192).includes(0)) return; // binary
    text.push(rel);
    const lines = buf.toString('utf8').split('\n');
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l];
      for (const tok of line.match(/[A-Za-z0-9]+/g) || []) {
        const k = handleOf(tok);
        if (k) found.push({ i, line: l + 1, what: `person handle #${k}` });
      }
      if (PRIVATE_REPO_LINK.test(line)) found.push({ i, line: l + 1, what: REPO_LINK_MSG });
    }
  });
  if (privateList && text.length) {
    const index = new Map(files.map((f, i) => [f, i]));
    for (const { n, src } of privateList) {
      for (const [rel, lines] of grepFiles(root, src, text)) for (const line of lines) found.push({ i: index.get(rel), line, what: `private list entry #${n}` });
    }
  }
  // 🩸 review of #230: a hit used to be reported as `<path>: …`, and when the PATH was the hit the
  // refusal printed the name it was refusing. Any path that matches anything is withheld everywhere it
  // would be printed, and named by its position in `git ls-files` instead.
  const shown = (i) => unsafePath.has(i) ? `[path withheld — it carries a forbidden term; it is \`git ls-files | sed -n ${i + 1}p\`]` : files[i];
  found.sort((a, b) => a.i - b.i || a.line - b.line);
  const hits = found.map((h) => h.line ? `${shown(h.i)}:${h.line}: ${h.what}` : `${shown(h.i)}: (in the path) ${h.what}`);
  return { files: files.length, hashes: hashes.length, privateEntries: privateList ? privateList.length : 0, listFile, hits, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let r;
  try { r = scan(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  for (const n of r.notes) console.log(`${n.fatal ? '✗' : '⚠️ '} forbidden-terms: ${n.text}`);
  if (r.files < 50) { console.error(`✗ forbidden-terms: only ${r.files} tracked files seen — this is not the repo it is meant to scan`); process.exit(1); }
  if (r.hits.length) {
    console.error(`✗ forbidden-terms: ${r.hits.length} hit(s) in tracked files. The matched text is not printed (CI logs are public).`);
    for (const h of r.hits.slice(0, 50)) console.error(`    ${h}`);
    if (r.hits.length > 50) console.error(`    … and ${r.hits.length - 50} more`);
    console.error('  fix: replace a person with their role, and a private-repo link with a bare `repo#123`.');
    process.exit(1);
  }
  if (r.notes.some((n) => n.fatal)) process.exit(1);
  console.log(`  ✓ forbidden-terms: ${r.files} tracked files, ${r.hashes} handle hashes, ${r.privateEntries ? `${r.privateEntries} private entries` : 'private list skipped'}, 0 hits`);
}
