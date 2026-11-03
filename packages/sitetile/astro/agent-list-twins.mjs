// reef#2874 — the markdown twins of GENERATED list routes, written AFTER the build, over the files it
// wrote.
//
// The per-route twin endpoint (src/pages/[...agentmd]/index.md.js) covers what has an IR document:
// content pages and posts. Everything the build generates WITHOUT one — the blog index and its
// pages, tag / category / author / date archives and their pages (root and per locale), the
// `/language` chooser — answered `Accept: text/markdown` with HTML while /.well-known/ai-catalog.json
// claimed the whole site negotiates (measured on a customer blog's `/blog/`, 2026-11-03).
//
// 🔴 Why a post-build pass and not a second getStaticPaths. Those routes are each derived by their
// own route file (slug maps, page sizes, locale editions, root-mount guards, collisions Astro
// resolves); a twin route that re-derived "which list pages exist and what each shows" would be a
// model of the build, and noindex-pass.mjs's header is the record of how a model of the build
// drifts from the build. So the views that RENDER a list say what they rendered, and this pass
// keeps only the records whose page is really on disk — the noindex thanks-manifest mechanism:
//   • the view calls recordListTwin({ heading, items, prev, next }) and gets back an HTML comment
//     carrying a random id, which it puts in its own markup;
//   • at build:done every emitted *.html is read; a record counts only when its id is IN a file (a
//     displaced route, whose render lost the file to another, counts for nothing), and the twin is
//     written beside THAT file, at the HTML shape the content twins use (`/blog/` → `/blog/index.md`);
//   • the mark is removed, so a page's bytes are what they were before this existed;
//   • reef-agent-markdown.json — the route map the site worker emitter bakes — gains one entry per
//     twin written, so the worker negotiates exactly the twins that exist.
// Outside a gated build (no SITETILE_AGENT_ARTIFACTS=1, `astro dev`, a test render) there is no
// manifest: recordListTwin returns '' and the page is byte-identical to before.
//
// WHY a global for the manifest: the views run inside Astro's bundled SSR build and this hook inside
// the config's own module graph — two copies of this file, one process (same as noindex-pass.mjs).
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlFiles } from './noindex-pass.mjs';
import { agentGate, documentMarkdown, listMarkdownBody, markdownAsset } from './src/lib/agent-markdown.mjs';

const MANIFEST = Symbol.for('sitetile.agent.list-twins');
const MAPPING = 'reef-agent-markdown.json';
const markOf = (id) => `<!--sitetile:md-twin:${id}-->`;
const MARK_RE = /<!--sitetile:md-twin:([0-9a-f-]{36})-->/g;

/** A list view: record what this render lists and return the mark to put in its markup ('' when
 *  this is not a gated build). `heading` is the page's own <h1> (or its title when it shows none),
 *  `items` `{ title, href, date }` in the page's order, `prev`/`next` the neighbouring page hrefs. */
export function recordListTwin(list) {
  const manifest = globalThis[MANIFEST];
  if (!manifest) return '';
  const id = randomUUID();
  manifest.set(id, list || {});
  return markOf(id);
}

/** An emitted file (relative, `/`-separated) → the site path it serves: `blog/index.html` → `/blog/`,
 *  `index.html` → `/`, `foo.html` → `/foo`. */
export function routeOfFile(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  return '/' + rel.replace(/\.html$/, '');
}

/** The pass itself, over an output dir and the build's manifest. Returns what it wrote. Fails the
 *  build when a twin it would write is already a file there (the owner's asset, or another twin):
 *  two writers on one path is not a state a deployed site can be honest about — the same rule
 *  assertNoAssetCollision applies to the content twins. */
export function applyListTwins(dir, manifest, { origin = '' } = {}) {
  const written = [];
  if (!manifest || !manifest.size) return { written };
  const mappingFile = join(dir, MAPPING);
  // No route map ⇒ no worker negotiates anything, and a twin nobody serves is a file that lies
  // about the site. Marks are still removed so the HTML stays byte-identical.
  const mapping = existsSync(mappingFile) ? JSON.parse(readFileSync(mappingFile, 'utf8')) : null;
  const mapped = new Set(((mapping && mapping.routes) || []).map((r) => r.path));
  for (const rel of htmlFiles(dir)) {
    const file = join(dir, rel);
    const bytes = readFileSync(file);
    // Byte-level search and removal: the marks are ASCII and a page saved in another encoding by
    // its author can never carry one, so nothing here decodes a file it did not render.
    if (!bytes.includes('<!--sitetile:md-twin:')) continue;
    const text = bytes.toString('utf8');
    const ids = [...text.matchAll(MARK_RE)].map((m) => m[1]).filter((id) => manifest.has(id));
    if (!ids.length) continue;
    let out = text;
    for (const id of ids) out = out.split(markOf(id)).join('');
    writeFileSync(file, out);
    if (!mapping) continue;
    const path = routeOfFile(rel);
    const asset = markdownAsset(path);
    if (mapped.has(path)) continue; // an IR document already owns this route's twin
    const target = join(dir, asset.replace(/^\//, ''));
    if (existsSync(target)) {
      throw new Error(`${asset} is already in this build's output, and the generated list page ${path} would write its markdown twin there — remove or rename the existing file: a generated artifact must never silently clobber another one.`);
    }
    const list = manifest.get(ids[0]);
    const body = listMarkdownBody(list);
    writeFileSync(target, documentMarkdown({ title: String(list.heading || '').trim(), path, body }, origin));
    mapping.routes.push({ path, asset });
    mapped.add(path);
    written.push({ path, asset });
  }
  if (mapping && written.length) writeFileSync(mappingFile, JSON.stringify(mapping));
  return { written };
}

export function agentListTwins() {
  let origin = '';
  return {
    name: 'sitetile-agent-list-twins',
    hooks: {
      'astro:config:done': ({ config }) => { origin = config.site ? String(config.site).replace(/\/$/, '') : ''; },
      'astro:build:start': () => {
        if (agentGate(process.env).generate) globalThis[MANIFEST] = new Map();
        else delete globalThis[MANIFEST];
      },
      'astro:build:done': ({ dir }) => {
        const manifest = globalThis[MANIFEST];
        delete globalThis[MANIFEST];
        applyListTwins(fileURLToPath(dir), manifest, { origin });
      },
    },
  };
}
