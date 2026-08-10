// Guard: every blog entry a tenant's CSS can see wears the same named hooks.
//   run: node packages/sitetile/blog-entry-hooks.test.mjs   (wired into scripts/test.sh)
//
// 🩸 From a tenant's own agent: the blog index title and excerpt "are bare text nodes,
// so a theme cannot size them differently". Measured before building: false — the excerpt has been
// `.bl-desc` all along and the title is an `<h2>`, reachable as `.bl-entry-link h2`. So the fix is
// not the one that was asked for.
//
// The real gap is smaller and worse. A theme reaching the title through its TAG is coupled to the
// heading LEVEL: change h2 to h3 for one site's outline, and every theme's rule stops matching with
// no error anywhere. That is a ruler that was right and rotted. The same site's own CSS shows the
// symptom — they wrote `html .bl-list li img`, guessing at structure, because there was no name to
// aim at. So: a stable `.bl-title`, purely additive (an existing `.bl-entry-link h2` rule keeps
// matching), and NO `.bl-excerpt` — a second name for `.bl-desc` would be two names for one thing.
//
// And it is checked in FIVE places, because that is how many emit an entry: three server views, a
// fourth that is a near-copy of one of them, and the client-side archive island that rebuilds the
// list in the browser. A hook that is on four of five is a theme that works until you filter.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro', 'src');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

/** Every file that renders a `.bl-entry`. Server-rendered ones first, then the browser one. */
const SERVER_VIEWS = [
  'components/BlogIndexView.astro',
  'components/ArchiveView.astro',
  'pages/search/label/[tag]/index.astro',
  'pages/search/label/[tag]/page/[n].astro',
];
const ISLAND = 'packages/blog-archive/blog-archive.js';

const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

test('every server view names the title, and none of them was missed', () => {
  for (const rel of SERVER_VIEWS) {
    const s = read(rel);
    assert.ok(/class="bl-entry-link"/.test(s), `${rel}: this file is supposed to render an entry — the list above is stale`);
    assert.ok(/<h2 class="bl-title">/.test(s), `${rel}: the title has no .bl-title, so a theme has to aim at the tag`);
    assert.ok(/class="bl-desc"/.test(s), `${rel}: the excerpt hook went missing`);
  }
});

test('🔴 the CLIENT island wears the same hooks — filtering must not strip a tenant\'s styling', () => {
  // The island rebuilds the whole list in the browser when a tag/month filter is used. Miss it and
  // the title styling survives page load and vanishes the moment somebody clicks a filter pill —
  // which is the kind of bug that only a real visitor finds.
  const s = read(ISLAND);
  assert.ok(/h2\.className\s*=\s*'bl-title'/.test(s), 'the island builds an h2 with no .bl-title');
  assert.ok(/p\.className\s*=\s*'bl-desc'/.test(s), 'the island builds the excerpt with no .bl-desc');
});

test('🔴 CONTROL: the check really can fail — an h2 with no class is caught', () => {
  // Written against the string, so prove the string matters: the shape this replaced must not pass.
  const before = '<a class="bl-entry-link" href="#">\n  <h2>{p.title}</h2>\n</a>';
  assert.equal(/<h2 class="bl-title">/.test(before), false, 'the pre-fix markup must not satisfy the assertion');
  assert.equal(/h2\.className\s*=\s*'bl-title'/.test("const h2 = document.createElement('h2');"), false);
});

test('no second name for the excerpt', () => {
  // .bl-desc already existed. Adding .bl-excerpt beside it would mean every theme has to guess
  // which one is real, and we would have to keep both forever.
  for (const rel of [...SERVER_VIEWS, ISLAND]) {
    assert.ok(!read(rel).includes('bl-excerpt'), `${rel}: bl-excerpt is a second name for bl-desc`);
  }
});

console.log(`\n  ${passed} passed`);
