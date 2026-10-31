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
//   2. THE PRIVATE LIST (the other public identity, customer handles used as examples). NEVER hashed
//      into this repo: those names are guessable, so a hash would be a confirmation oracle — hash a
//      suspected name, find it in the file, and the link the list exists to protect is made. This tier
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
// publish it in the act of refusing it.
//
// Usage: node scripts/forbidden-terms.mjs [--root DIR] [--hashes FILE]
import { execFileSync } from 'node:child_process';
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

function readPrivateList(file) {
  if (!file || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((src, i) => {
      try { return { n: i + 1, re: new RegExp(src, 'i') }; } catch { throw new Error(`forbidden-terms: private list entry #${i + 1} is not a valid pattern`); }
    });
}

function trackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

export function scan({ root = ROOT, hashesFile = HASHES, required = process.env.CVER_FORBIDDEN_TERMS_REQUIRED === '1' } = {}) {
  const hashes = readHashes(hashesFile);
  const hashIndex = new Map(hashes.map((h, i) => [h, i + 1]));
  const listFile = privateListPath();
  const privateList = readPrivateList(listFile);
  const notes = [];
  if (!privateList) {
    if (required) notes.push({ fatal: true, text: 'the private term list is REQUIRED here (CVER_FORBIDDEN_TERMS_REQUIRED=1) and none was found' });
    else notes.push({ fatal: false, text: 'private term list not on this machine — tier 2 (the other identity, customer handles) NOT checked' });
  }
  const seen = new Map(); // token → handle # or 0
  const handleOf = (tok) => {
    const k = tok.toLowerCase();
    let v = seen.get(k);
    if (v === undefined) { v = hashIndex.get(handleHash(k)) || 0; seen.set(k, v); }
    return v;
  };
  const hits = [];
  const files = trackedFiles(root);
  for (const rel of files) {
    // the path itself is published too
    for (const tok of rel.match(/[A-Za-z0-9]+/g) || []) {
      const k = handleOf(tok);
      if (k) hits.push(`${rel}: (in the path) person handle #${k}`);
    }
    if (privateList) for (const { n, re } of privateList) if (re.test(rel)) hits.push(`${rel}: (in the path) private list entry #${n}`);
    const abs = path.join(root, rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; } // deleted in the work tree, or a submodule
    if (buf.subarray(0, 8192).includes(0)) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const tok of line.match(/[A-Za-z0-9]+/g) || []) {
        const k = handleOf(tok);
        if (k) hits.push(`${rel}:${i + 1}: person handle #${k}`);
      }
      if (PRIVATE_REPO_LINK.test(line)) hits.push(`${rel}:${i + 1}: link to a private repo (write \`repo#123\`, no org, no URL)`);
      if (privateList) for (const { n, re } of privateList) if (re.test(line)) hits.push(`${rel}:${i + 1}: private list entry #${n}`);
    }
  }
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
