// REEF with Site — read a file the site ships in public/, at build time.
//
// icon-core.mjs and pwa-core.mjs are zero-I/O, so the icon and manifest routes hand them this
// reader. The directory follows the rule SiteLayout's icon check and Astro itself use:
// publicDir defaults to <root>/public, and root defaults to cwd.
//
// 🩸 tile#203 review r1: icon-core's publicFilePath refuses a literal `..`, but readFileSync follows
// a symlink, so public/brand/mark.png → a PNG anywhere on the build host was served at
// /apple-touch-icon.png and listed in the manifest. A path counts only when its REAL path is a
// regular file inside public/'s real path.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export const PUBLIC_DIR = join(typeof process !== 'undefined' ? process.cwd() : '.', 'public');

/** The real path of `rel` when it is a regular file inside public/, else null. */
function shippedFile(rel) {
  try {
    const root = realpathSync(PUBLIC_DIR);
    const real = realpathSync(join(PUBLIC_DIR, rel));
    if (!real.startsWith(root + sep) || !statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

/** `rel` is a path under public/ (icon-core's publicFilePath has already refused `..`). */
export function readPublic(rel) {
  const real = shippedFile(rel);
  try { return real ? readFileSync(real) : null; } catch { return null; }
}

export function publicHas(rel) {
  return shippedFile(rel) !== null;
}
