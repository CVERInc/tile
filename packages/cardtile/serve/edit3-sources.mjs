// What the Card editor (`/try/edit`, `/edit?host=`) and the deck every Card page carries are BUILT
// FROM — the one rule, so the generator and the drift gate cannot disagree about it.
//
// 🩸 WHY THIS EXISTS. `edit3-assets.mjs` and `deck-assets.mjs` are committed build artifacts (Workers
// deploy from source, not from a build step), so an edit to `w3/edit3.mjs` does nothing at all until
// somebody runs the generator. An earlier editor's fix once failed to build inside a `&&` chain whose
// output was being tailed, and the browser harness then ran against the PREVIOUS bundle and reported
// green. A green harness measuring a stale artifact is worse than a red one.
//
// So: the generator stamps what it read, and a node test recomputes the stamp from disk.
//
// 🔴 There is NO hand-kept list here. gen-edit3-assets.mjs RECORDS every file it opens (its own
// reads, plus the inputs esbuild reports for the JS it bundles) and writes that list into
// edit3-assets.mjs as SOURCE_FILES; the stamp is over that list. A file the generator reads is, by
// construction, a file the stamp watches. (card-worker.test.mjs walks the import graph on its own,
// without esbuild, to check the recorded list against a second opinion.)
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

/**
 * A stamp over those files' bytes. NOT a hash of the generated bundle — that would only ever say
 * "the file I just wrote is the file I just wrote". This is a hash of the INPUTS, which is the
 * question a drift gate has: is the committed artifact still the one these sources produce?
 *
 * 🔴 The path is part of the hash. A file that moves is a file the generator would stop reading, and
 * hashing only contents would go on being green while a whole module quietly left the bundle.
 */
export function sourceStamp(files, dir = DIR, readFile = fs.readFileSync) {
  if (!Array.isArray(files) || !files.length) throw new Error('edit3 sources: no file list — the stamp would hash an empty set');
  const h = createHash('sha256');
  for (const rel of files) {
    const p = join(dir, rel);
    if (!fs.existsSync(p)) throw new Error(`edit3 sources: ${rel} is missing — the bundle would be built without it`);
    h.update(rel, 'utf8');
    h.update(readFile(p));
  }
  return h.digest('hex').slice(0, 16);
}

/** a short content hash — the version segment of an immutable URL */
export const contentHash = (bytes, n = 12) => createHash('sha256').update(bytes).digest('hex').slice(0, n);

/**
 * Is `absPath` one of THIS generator's own outputs (edit3-assets.mjs next to it)? An exact
 * resolved-path comparison — 🔴 not a basename suffix: `endsWith('edit3-assets.mjs')` would also exempt
 * `other-edit3-assets.mjs` and any future module that happens to share the tail.
 *
 * deck-assets.mjs is NOT one: the generator writes it FIRST, and the editor bundle then reads it like
 * any other source (the editor's preview needs the deck's version), so it is stamped like one.
 */
export const isOwnOutput = (absPath, dir = DIR) => resolve(absPath) === resolve(dir, 'edit3-assets.mjs');

/**
 * Modules the editor bundle must NOT carry, although the bundle's entry reaches the file that loads
 * them (paths relative to serve/).
 *
 * 🩸 w3/edit3.mjs imports card-worker.mjs for the renderer, so everything card-worker.mjs can reach is
 * a candidate for the sandbox's inline script — on every host, whatever a setting says. The home deck
 * (home-deck.mjs) is behind a switch whose OFF must be the Worker as it was, byte for byte; its words
 * once rode into `/try/edit` this way (+5 KB with the switch off). card-worker.mjs therefore loads it
 * with `import()` inside the one route that needs it, and the generator marks it external: the
 * bundle has no copy, the stamp does not watch it, and the generator fails if either stops being true.
 */
export const NOT_IN_EDITOR = Object.freeze(['home-deck.mjs']);
/** is `absPath` one of them? An exact resolved-path comparison, like isOwnOutput. */
export const isKeptOut = (absPath, dir = DIR) => NOT_IN_EDITOR.some((f) => resolve(absPath) === resolve(dir, f));
