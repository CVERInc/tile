#!/usr/bin/env node
// The three-line rebuild, line three.
//
//     git clone https://github.com/CVERInc/tile.git engine
//     (cd engine/packages/sitetile/astro && npm install)
//     node engine/packages/build/cli.mjs ./ir ./dist --theme ./theme.css --site-url https://your-domain.example
//
// The result is a directory of plain static HTML. Serve it with anything. `theme.css` is the
// compiled stylesheet that travels with the export, beside `ir/`; drop `--theme` if your IR
// declares no `theme:`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './index.mjs';
import { RESTORE_FAILED } from './stage.mjs';

const USAGE = `usage: node packages/build/cli.mjs <ir-dir> <out-dir> [options]

  --site-url <url>     this site's own origin, for canonical / og:url / hreflang
  --site-id <id>       ONLY if you want the ask-me bubble and have something for it to talk to.
                       Unset (the default) the build emits no call home.
  --theme <file>       this site's compiled theme.css — it travels with the export, beside ir/.
                       Required when the IR declares 'theme:'.
  --assets <dir>       this site's media, overlaid onto the renderer's public/
  --blog <dir>         this site's posts (default: <ir-dir>/posts when it exists)
  --pagetile <dir>     this site's books (*.book.md)
  --engine <dir>       an engine checkout (default: the one this file is in)
  --include-posts      treat posts/ as pages rather than as the blog corpus

exit: 0 built · 2 refused (the message says why) · 3 the renderer could not be put back ·
      129 / 130 / 143 stopped by SIGHUP / SIGINT / SIGTERM, renderer put back · else astro's own code
`;

const VALUED = ['site-url', 'site-id', 'theme', 'assets', 'blog', 'pagetile', 'engine'];
const BARE = ['include-posts'];

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
// 🩸 AN UNKNOWN FLAG IS A TYPO UNTIL PROVEN OTHERWISE. Every `--x` used to be skipped along with
// the word after it, so `--siteurl https://…` built the whole site against the fallback origin —
// every canonical wrong — and said nothing (#16, P3-13). Refuse it by name, and name the one meant.
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const name = a.slice(2);
  if (BARE.includes(name)) continue;
  if (VALUED.includes(name)) { i++; continue; }   // a valued flag and its value
  const squash = (n) => n.replace(/[-_]/g, '').toLowerCase();
  const meant = [...VALUED, ...BARE].find((k) => squash(k) === squash(name.split('=')[0]));
  console.error(`✗ unknown option ${a}${meant ? ` — did you mean --${meant}?` : ''}\n\n${USAGE}`);
  process.exit(2);
}

const [irDir, outDir] = positional;
if (!irDir || !outDir) { console.error(USAGE); process.exit(2); }

// Default engine: the checkout this file is part of. packages/build/cli.mjs → the repo root.
const here = path.dirname(fileURLToPath(import.meta.url));
const engineDir = flag('engine') ?? path.resolve(here, '../..');

// 🩸 THE SIGNALS ARE INSTALLED HERE, IN THE PROGRAM, and nowhere in the library. `stageSite` used
// to put `SIGINT`/`SIGTERM` handlers on `process` itself and end them in `process.exit(130/143)`, so
// `import { stageSite } from '@tile/build'` silently took over the caller's shutdown and then killed
// it — measured 2026-09-07 against a consumer whose own SIGTERM handler asked for exit 0 and got
// 143 without ever finishing its drain. A CLI may own the process's signals because the CLI IS the
// process; a library may not. What crosses the boundary is an AbortSignal, and nothing else.
const stopping = new AbortController();
let signalled = '';
//
// 🩸 SIGHUP IS ONE OF THEM. The build runs in its own process group so one kill reaches all of it —
// which also means closing the terminal no longer does: the hang-up goes to the FOREGROUND group,
// the CLI's, and not astro's. Without a handler the CLI died on the default action, nothing
// aborted, and astro carried on in a group nobody was signalling, writing into the owner's
// --outDir (#16, R3-1). Handled, the hang-up unwinds like Ctrl-C and takes astro with it.
//
// …and the terminal that sent it is gone, so a write to it can fail (EIO). That must not turn the
// unwind into a crash; the exit code is what is left to say anything.
process.stderr.on('error', () => {});
process.stdout.on('error', () => {});
for (const sig of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (signalled) {
      // The teardown is already in flight and cannot be hurried: a copy of a site's media is not
      // interruptible half way. Say what a kill from here would cost rather than doing it silently.
      console.error(`  still putting the renderer back after ${signalled} — killing this now leaves a`);
      console.error('  .tile-build-stash-* and a .tile-build-lock in the renderer to move back by hand.');
      return;
    }
    signalled = sig;
    stopping.abort();
  });
}
// The shell's own spelling for "died on this signal": 128 + the signal number.
const signalExit = () => ({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 })[signalled];

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
    signal: stopping.signal,
  });
} catch (err) {
  // 🩸 A RESTORE THAT FAILED IS ITS OWN EXIT CODE. It used to share the signal's 130/143 when a
  // signal was involved, so "stopped, renderer back" and "stopped, renderer wrecked" read the same
  // to anything checking `$?` (#16, R3-3). The second one needs a person; it gets 3 either way.
  if (err.code === RESTORE_FAILED) {
    console.error(`✗ ${signalled ? `${signalled} during a build, and ` : ''}${err.message}`);
    process.exit(3);
  }
  // A signal is not a failure to report as one: buildSite has already put the renderer back, so say
  // which signal stopped it and leave with the code a shell reads as that signal.
  if (signalled) {
    console.error(err.name === 'AbortError'
      ? `✗ ${signalled} — the build was stopped and the renderer put back.`
      : `✗ ${signalled} during a build: ${err.message}`);
    process.exit(signalExit());
  }
  // Every other throw out of buildSite/stageSite is a sentence about what to do next, not a
  // surprise — print the sentence, not a stack trace whose first useful line is twelve frames down.
  console.error(`✗ ${err.message}`);
  process.exit(2);
}

if (result.code === 0) console.log(`✓ ${result.pageCount} page(s) → ${result.outDir}`);
process.exit(result.code);
