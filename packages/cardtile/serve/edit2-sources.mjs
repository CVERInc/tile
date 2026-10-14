// What `/try/edit` (the tugtile-table sandbox; `/try/edit2` is now just a 301 to it) is BUILT
// FROM — the one list, so the generator and the drift gate cannot
// disagree about it.
//
// 🩸 WHY THIS EXISTS. `edit2-assets.mjs` is a committed build artifact (Workers deploy from source,
// not from a build step), so an edit to `w2/edit2.mjs` does nothing at all until somebody runs the
// generator. On 2026-09-06 a fix to the board's phone header failed to build — a stray pair of
// backticks inside the CSS template literal — and the generator exited 1 inside a `&&` chain whose
// output was being tailed. The browser harness then ran against the PREVIOUS bundle and reported
// 315/315. A green harness measuring a stale artifact is worse than a red one.
//
// So: the generator stamps what it read, and a node test recomputes the stamp from disk. Same shape
// as this repo's existing "the bundled stylesheet is the one on disk" gate.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

// 🔴 #1929: there is NO hand-kept list here any more. It used to be one, and it was exactly as
// complete as the last person's memory: vendor/editor-core.js, icons.js, obsidian-shim.js, host.js,
// Sortable.min.js, i18n/*.json (all copied verbatim into the bundle) were never on it, so editing
// them left a stale artifact and a green gate. gen-edit2-assets.mjs now RECORDS every file it opens
// (its own reads, plus the inputs esbuild reports for the JS it bundles) and writes that list into
// edit2-assets.mjs as SOURCE_FILES; the stamp is over that list. A file the generator reads is, by
// construction, a file the stamp watches. (card-worker.test.mjs walks the import graph on its own,
// without esbuild, to check the recorded list against a second opinion.)
//
// The one input outside the repo is @cvernet/signet's corners.css, which is resolved from
// node_modules (and `latest`). Its path differs by checkout, so it is NOT in the path-hashed list: it
// gets its own stamp (signetCornersStamp), which the test compares only where signet is installed.

/**
 * A stamp over those files' bytes. NOT a hash of the generated bundle — that would only ever say
 * "the file I just wrote is the file I just wrote". This is a hash of the INPUTS, which is the
 * question a drift gate has: is the committed artifact still the one these sources produce?
 *
 * 🔴 The path is part of the hash. A file that moves is a file the generator would stop reading, and
 * hashing only contents would go on being green while a whole module quietly left the bundle.
 */
export function sourceStamp(files, dir = DIR, readFile = fs.readFileSync) {
  if (!Array.isArray(files) || !files.length) throw new Error('edit2 sources: no file list — the stamp would hash an empty set');
  const h = createHash('sha256');
  for (const rel of files) {
    const p = join(dir, rel);
    if (!fs.existsSync(p)) throw new Error(`edit2 sources: ${rel} is missing — the bundle would be built without it`);
    h.update(rel, 'utf8');
    h.update(readFile(p));
  }
  return h.digest('hex').slice(0, 16);
}

/** signet's corners.css, found the way Node would (node_modules walked up from packages/cardtile), or null */
export function signetCornersPath(dir = DIR) {
  for (let d = join(dir, '..'); ; d = dirname(d)) {
    const p = join(d, 'node_modules/@cvernet/signet/src/corners.css');
    if (fs.existsSync(p)) return p;
    if (dirname(d) === d) return null;
  }
}
export const signetCornersStamp = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);

/**
 * Is `absPath` THIS generator's own output (edit2-assets.mjs next to it)? An exact resolved-path
 * comparison — 🔴 not a basename suffix: `endsWith('edit2-assets.mjs')` would also exempt `other-
 * edit2-assets.mjs` and any future module that happens to share the tail (tile#133 review).
 */
export const isOwnOutput = (absPath, dir = DIR) => resolve(absPath) === resolve(dir, 'edit2-assets.mjs');

// ── signet: bound to the LOCKFILE, not to whatever is installed ───────────────────────────────────
/** the version packages/cardtile/package-lock.json resolves @cvernet/signet to */
export function signetLockVersion(dir = DIR) {
  const lock = JSON.parse(fs.readFileSync(join(dir, '../package-lock.json'), 'utf8'));
  const v = lock.packages?.['node_modules/@cvernet/signet']?.version;
  if (!v) throw new Error('edit2 sources: package-lock.json names no @cvernet/signet version');
  return v;
}
/** { version, stamp } of the installed corners.css, or null when signet is not installed */
export function signetInstalled(dir = DIR) {
  const p = signetCornersPath(dir);
  if (!p) return null;
  const version = JSON.parse(fs.readFileSync(join(dirname(p), '../package.json'), 'utf8')).version;
  return { version, stamp: signetCornersStamp(p) };
}
/**
 * What to say about signet's corners.css. Bytes are compared ONLY when the installed version is the
 * one the lockfile pins and the bundle was generated against; a different installed version is an
 * environment difference, reported as such — never as "the bundle is stale".
 */
export function signetVerdict({ recordedVersion, lockVersion, recordedStamp, installed }) {
  if (recordedVersion !== lockVersion) {
    return { status: 'lock-moved', message: `package-lock.json now pins signet ${lockVersion}, the bundle was generated against ${recordedVersion} — regenerate: node packages/cardtile/serve/gen-edit2-assets.mjs` };
  }
  if (!installed) return { status: 'skipped', message: 'signet is not installed' };
  if (installed.version !== lockVersion) {
    return { status: 'version-differs', message: `signet 版本不同（${installed.version} vs ${lockVersion}）：安裝的版本不是 lockfile 鎖的那個` };
  }
  if (installed.stamp !== recordedStamp) {
    return { status: 'bytes-differ', message: `signet ${lockVersion} corners.css differs from the bytes the bundle was built from — regenerate: node packages/cardtile/serve/gen-edit2-assets.mjs` };
  }
  return { status: 'ok', message: '' };
}
