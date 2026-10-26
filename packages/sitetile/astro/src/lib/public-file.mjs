// REEF with Site — read a file the site ships in public/, at build time.
//
// icon-core.mjs and pwa-core.mjs are zero-I/O, so the icon and manifest routes hand them this
// reader. The directory follows the rule SiteLayout's icon check and Astro itself use:
// publicDir defaults to <root>/public, and root defaults to cwd.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const PUBLIC_DIR = join(typeof process !== 'undefined' ? process.cwd() : '.', 'public');

/** `rel` is a path under public/ (icon-core's publicFilePath has already refused `..`). */
export function readPublic(rel) {
  try { return readFileSync(join(PUBLIC_DIR, rel)); } catch { return null; }
}

export function publicHas(rel) {
  try { return existsSync(join(PUBLIC_DIR, rel)); } catch { return false; }
}
