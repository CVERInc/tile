// Find sharp for the dev-time image tools (embed.mjs, backfill-raster.mjs). Nothing here ships to
// the edge — sharp is a native library, and the Worker never touches an image.
//
// 🔴 TRIED in order, not hardcoded to one absolute path. The single hardcoded path is what turned
// embed.mjs from a tool into a thing only one Mac could run — the same defect ingest-full.mjs had.
// 🩸 2026-09-25: every candidate below pointed at `sharp/lib/index.js`, which sharp 0.35 no longer
// has (it ships `dist/index.mjs`), so on a current install nothing was found and embed.mjs threw at
// import. Both layouts are tried now.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function loadSharp() {
  const roots = [join(HERE, '../../../node_modules/sharp'), `${process.env.HOME}/Developer/reef/apps/feelreef/node_modules/sharp`];
  const candidates = [
    'sharp',
    process.env.SHARP_PATH,
    ...roots.flatMap((r) => [join(r, 'dist/index.mjs'), join(r, 'lib/index.js')]),
  ].filter(Boolean);
  for (const c of candidates) {
    try { return (await import(c)).default; } catch { /* try the next */ }
  }
  throw new Error('sharp not found. Tried: ' + candidates.join(', ') + ' — or set SHARP_PATH.');
}
