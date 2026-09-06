#!/usr/bin/env node
// The three-line rebuild, line three.
//
//     git clone https://github.com/CVERInc/tile.git engine
//     (cd engine/packages/sitetile/astro && npm install)
//     node engine/packages/build/cli.mjs ./ir ./dist --site-url https://your-domain.example
//
// The result is a directory of plain static HTML. Serve it with anything.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './index.mjs';

const USAGE = `usage: node packages/build/cli.mjs <ir-dir> <out-dir> [options]

  --site-url <url>     this site's own origin, for canonical / og:url / hreflang
  --site-id <id>       ONLY if you want the ask-me bubble and have something for it to talk to.
                       Unset (the default) the build emits no call home.
  --theme <file>       this site's compiled theme.css. Required when its IR declares 'theme:'.
  --assets <dir>       this site's media, overlaid onto the renderer's public/
  --blog <dir>         this site's posts (default: <ir-dir>/posts when it exists)
  --pagetile <dir>     this site's books (*.book.md)
  --engine <dir>       an engine checkout (default: the one this file is in)
  --include-posts      treat posts/ as pages rather than as the blog corpus
`;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`✗ --${name} needs a value`);
    process.exit(2);
  }
  return v;
};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--include-posts') continue;
  if (a.startsWith('--')) { i++; continue; }   // a valued flag and its value
  positional.push(a);
}

const [irDir, outDir] = positional;
if (!irDir || !outDir) { console.error(USAGE); process.exit(2); }

// Default engine: the checkout this file is part of. packages/build/cli.mjs → the repo root.
const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = flag('engine') ?? path.resolve(here, '../..');

let result;
try {
  result = await buildSite({
    irDir,
    engineDir,
    outDir,
    siteUrl: flag('site-url') ?? '',
    siteId: flag('site-id') ?? '',
    themeFile: flag('theme'),
    assetsDir: flag('assets'),
    blogDir: flag('blog'),
    pagetileDir: flag('pagetile'),
    includePosts: argv.includes('--include-posts'),
  });
} catch (err) {
  // Every throw out of buildSite/stageSite is a sentence about what to do next, not a surprise —
  // print the sentence, not a stack trace whose first useful line is twelve frames down.
  console.error(`✗ ${err.message}`);
  process.exit(2);
}

if (result.code === 0) console.log(`✓ ${result.pageCount} page(s) → ${result.outDir}`);
process.exit(result.code);
