// The engine's plain-node modules import from a checkout with NO node_modules anywhere.
//   run: node packages/sitetile/clean-import.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 A consumer of this engine imports lib/blog.mjs for routing, dates and feeds from a pristine
// checkout — no `npm install`, because none of that work needs a package. When the excerpt became
// the visible text of the page's own parse, blog.mjs grew a top-level `import … from 'parse5'`,
// and every importer of it — whatever it wanted from the file — died with
// `Cannot find package 'parse5'`. Every test here stayed green, because every machine that runs them
// has packages/sitetile/astro/node_modules. A test that runs WITH the package cannot see this.
//
// So this one takes the package away for real: it copies the engine (minus every node_modules) to
// a temp dir and imports the modules in a fresh node whose resolver refuses anything that lands in
// a node_modules directory. The refusal matters as much as the copy — a temp dir's ancestors can
// hold a node_modules of their own (a home directory, a shared lanes dir), and node walks up into it.
// Only the astro build itself (astro.config.mjs, smoke-build.mjs) is allowed to need packages.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));

// The modules the clean contract covers, relative to the engine root. blog.mjs is the one a
// consumer imports; the rest are its siblings in the same no-package lane, plus noindex-pass.mjs,
// whose file walkers (htmlFiles, fileForPath) agent-list-twins.mjs imports without any HTML parse.
const MODULES = [
  'packages/sitetile/astro/src/lib/blog.mjs',
  'packages/sitetile/astro/src/lib/chrome-copy.mjs',
  'packages/sitetile/astro/src/lib/sitemap.mjs',
  'packages/sitetile/astro/src/lib/agent-markdown.mjs',
  'packages/sitetile/astro/src/lib/agent-artifacts.mjs',
  'packages/sitetile/astro/src/lib/agent-corpus.mjs',
  'packages/sitetile/astro/noindex-pass.mjs',
  'packages/sitetile/astro/agent-list-twins.mjs',
];

const root = mkdtempSync(join(tmpdir(), 'clean-import-'));
try {
  const copy = join(root, 'engine');
  cpSync(ENGINE, copy, { recursive: true, filter: (src) => !['node_modules', '.git'].includes(basename(src)) });

  // The build aliases @sitetile to site-core.js (astro.config.mjs); a plain-node consumer maps it
  // the same way. Everything else bare must resolve OUTSIDE any node_modules, i.e. be a builtin.
  const hooks = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const SITE_CORE = ${JSON.stringify(pathToFileURL(join(copy, 'packages/sitetile/site-core.js')).href)};
    registerHooks({
      resolve(spec, ctx, next) {
        if (spec === '@sitetile') return { url: SITE_CORE, shortCircuit: true };
        const r = next(spec, ctx);
        if (r.url.includes('/node_modules/')) {
          const e = new Error("Cannot find package '" + spec + "' (resolved into a node_modules: " + r.url + ")");
          e.code = 'ERR_MODULE_NOT_FOUND';
          throw e;
        }
        return r;
      },
    });`;
  const urls = MODULES.map((m) => pathToFileURL(join(copy, m)).href);
  const probe = `
    const failed = [];
    for (const u of ${JSON.stringify(urls)}) {
      try { await import(u); } catch (e) { failed.push(u.slice(u.indexOf('/packages/') + 1) + ' → ' + (e.code || '') + ' ' + e.message.split('\\n')[0]); }
    }
    if (failed.length) { console.error(failed.join('\\n')); process.exit(1); }
    // Routing and dates — the work the consumer imports blog.mjs for — run with no parser present.
    const blog = await import(${JSON.stringify(urls[0])});
    if (typeof blog.fmtDate !== 'function' || typeof blog.postUrl !== 'function') { console.error('blog.mjs lost fmtDate/postUrl'); process.exit(1); }
    console.log(blog.fmtDate('2026-01-02'));
  `;
  const env = { ...process.env };
  delete env.NODE_PATH;
  const r = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(hooks)}`, '--input-type=module', '-e', probe],
    { cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `importing the engine with no node_modules failed:\n${r.stderr}`);
  assert.ok(r.stdout.trim(), 'fmtDate printed nothing');
  console.log(`clean-import: ${MODULES.length} modules import with no node_modules (fmtDate → ${r.stdout.trim()})`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
