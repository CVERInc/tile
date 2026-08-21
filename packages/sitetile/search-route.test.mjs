// A capability that is off must not have a URL.
//   run: node packages/sitetile/search-route.test.mjs
//
// 🩸 2026-08-06. /search was a STATIC route, so it was emitted on every build. Its `{on && …}` guard
// only removed the form, which meant a site with the blog package but no `blog-search` published a
// real, crawlable page whose entire content was <h1>Search</h1>. A live site had one, orphaned —
// nothing on the site linked to it. The original comment even claimed the win: "Absent → a plain
// heading, no working-looking box … honouring the no-phantom-features rule". It removed the phantom
// FEATURE and left a phantom PAGE.
//
// A static .astro file cannot decline to exist. A catch-all can: getStaticPaths returns [] when the
// feature is off, and `{ rest: undefined }` emits exactly /search when it is on.

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEARCH_DIR = join(HERE, 'astro/src/pages/search');
const ROUTE = join(SEARCH_DIR, '[...rest].astro');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

test('🔴 /search is a conditional route, not a static page', () => {
  assert.ok(existsSync(ROUTE), 'expected pages/search/[...rest].astro');
  assert.ok(!existsSync(join(SEARCH_DIR, 'index.astro')),
    'a static index.astro is emitted unconditionally — that is the whole defect');
});

const src = readFileSync(ROUTE, 'utf8');

test('🔴 it returns NOTHING when the feature is off', () => {
  assert.match(src, /export function getStaticPaths\(\)/);
  assert.match(src, /if \(!blogSearchOn\(meta\) \|\| !hasBlog\) return \[\];/,
    'both conditions, and an empty array — not a stub page, not a redirect');
});

test('it emits exactly /search when the feature is on', () => {
  assert.match(src, /params: \{ rest: undefined \}/, 'undefined → the bare /search path, no extra segment');
});

test('🔴 no dead guard survives inside the page', () => {
  // Leaving `{on && …}` after the route became conditional would be a check that can never fail —
  // indistinguishable, on inspection, from one that protects something.
  assert.doesNotMatch(src, /\{on &&/, 'the route existing IS the condition now');
  assert.doesNotMatch(src, /const on = true/, 'and a constant-true flag is worse than none');
});

test('🔴 the deeper /search/label routes still exist and are more specific', () => {
  // The catch-all sits at pages/search/. Astro ranks the nested, named segments above it, so
  // /search/label/<tag> keeps its own route — but "keeps" is a claim about the build, so what this
  // asserts is only that the files are still there to win. The build is the real gate (task 6).
  const label = join(SEARCH_DIR, 'label/[tag]');
  assert.ok(existsSync(join(label, 'index.astro')), '/search/label/<tag>');
  assert.ok(existsSync(join(label, 'page/[n].astro')), '/search/label/<tag>/page/<n>');
});

test('the search index endpoint stays, and stays honest', () => {
  // It always exists and serves [] when off — a tiny inert file, which is fine. The page was the
  // problem, not the endpoint: an empty JSON file is not a URL anybody lands on from a search engine.
  const idx = readFileSync(join(HERE, 'astro/src/pages/search-index.json.js'), 'utf8');
  assert.match(idx, /buildSearchIndexBody\(posts, meta\)/);
});

test('no other route under search/ is unconditionally static', () => {
  const stray = readdirSync(SEARCH_DIR).filter((n) => n.endsWith('.astro') && !n.startsWith('['));
  assert.deepEqual(stray, [], `these would be emitted whatever the site asked for: ${stray.join(', ')}`);
});

console.log(`\n${passed} passed`);
