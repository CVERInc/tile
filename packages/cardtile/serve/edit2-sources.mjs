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
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));

/** every file whose bytes end up inside edit2-assets.mjs, relative to serve/ */
export const EDIT2_SOURCES = [
  '../w2/index.html',
  '../w2/edit2.css',
  '../w2/edit2.mjs',
  '../w2/board-bridge.mjs',
  '../w2/board-i18n.mjs',
  '../w2/type-icons.mjs',
  '../w/editor.css',
  '../w/cell-form-core.mjs',
  '../w/cell-i18n.mjs',
  '../w/md-guard.mjs',
  '../w/sandbox-i18n.mjs',
  '../w/sandbox-door.mjs',
  '../ai-ops.mjs',
  '../card-core.js',
  '../card-render.mjs',
  // the two the w2 modules import DIRECTLY as of the P1 fixes: the icon route a tile's favicon uses
  // (marks) and the poster path a video tile shows (yt). Both were already in the bundle through
  // card-render — being in it by accident is not the same as being watched for drift.
  '../marks.mjs',
  '../yt.mjs',
  '../../../hosts/web/tugtile/index.html',
  '../../../hosts/web/tugtile/tugtile.css',
  '../../../packages/tugtile/board-core.js',
];

/**
 * A stamp over those files' bytes. NOT a hash of the generated bundle — that would only ever say
 * "the file I just wrote is the file I just wrote". This is a hash of the INPUTS, which is the
 * question a drift gate has: is the committed artifact still the one these sources produce?
 *
 * 🔴 The path is part of the hash. A file that moves is a file the generator would stop reading, and
 * hashing only contents would go on being green while a whole module quietly left the bundle.
 */
export function sourceStamp(dir = DIR) {
  const h = createHash('sha256');
  for (const rel of EDIT2_SOURCES) {
    const p = join(dir, rel);
    if (!fs.existsSync(p)) throw new Error(`edit2 sources: ${rel} is missing — the bundle would be built without it`);
    h.update(rel, 'utf8');
    h.update(fs.readFileSync(p));
  }
  return h.digest('hex').slice(0, 16);
}
