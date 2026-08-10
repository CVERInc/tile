// Guard: `eyebrow=` works on every coral that renders a heading.
//   run: node packages/sitetile/eyebrow-coverage.test.mjs   (wired into scripts/test.sh)
//
// 🩸 2026-08-07/08. Three corals honoured `eyebrow=` (hero, prose, collection) and five did not,
// with nothing in the grammar explaining the split — and the grammar advertises eyebrow as a COMMON
// param. So authors put it everywhere and it silently did nothing: 22 inert `eyebrow=` on
// one site alone, across grid, timeline, faq and gallery, and its agent had written "added
// bilingual eyebrows" into a plan for the site owner. Worse than a wrong value, which renders
// visibly wrong — this rendered ABSENCE, and nobody suspects absence.
//
// The other half of the same defect: `.st-prose-eyebrow` had no base paint, so on a theme that had
// not styled it an eyebrow rendered as an ordinary paragraph. A live site carried a bare LOCATION
// above its own heading for weeks. Both halves are checked here.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTIONS = join(HERE, 'astro', 'src', 'components', 'sections');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

/** A coral component that renders a heading is one an eyebrow can sit above. */
const HEADING = /<(h1|h2|Title)\b|section\.title/;
const corals = readdirSync(SECTIONS)
  .filter((f) => f.endsWith('.astro') && f !== 'GridCell.astro')
  .map((f) => ({ file: f, src: readFileSync(join(SECTIONS, f), 'utf8') }));

test('every coral that renders a heading reads eyebrow', () => {
  const missing = corals
    .filter((c) => HEADING.test(c.src))
    .filter((c) => !/const eyebrow = pm\.eyebrow/.test(c.src))
    .map((c) => c.file);
  assert.deepEqual(missing, [], `these render a heading but ignore eyebrow=:\n${missing.join('\n')}`);
});

test('…and each one actually EMITS it, not just parses it', () => {
  // 🔴 Reading the param and never rendering it is precisely the bug being fixed — a value
  // accepted and dropped. Parsing alone would satisfy the check above.
  const silent = corals
    .filter((c) => /const eyebrow = pm\.eyebrow/.test(c.src))
    .filter((c) => !/\{eyebrow && </.test(c.src))
    .map((c) => c.file);
  assert.deepEqual(silent, [], `these read eyebrow and never render it:\n${silent.join('\n')}`);
});

test('🔴 CONTROL: a coral with no heading is not required to have one', () => {
  // Embed/Social/Tagcloud render no title, so an eyebrow has nothing to sit above. If this list
  // ever empties, the check above has stopped discriminating and is passing for free.
  const headless = corals.filter((c) => !HEADING.test(c.src)).map((c) => c.file);
  assert.ok(headless.length > 0, 'no headless corals found — the rule above is now vacuous');
});

test('🔴 an eyebrow has base paint, so an unstyled theme does not render it as a stray line', () => {
  const css = readFileSync(join(HERE, 'astro', 'src', 'styles', 'site.css'), 'utf8');
  assert.match(css, /\[class\$="-eyebrow"\]/, 'a suffix rule covers corals added later without anyone remembering');
  assert.match(css, /\[class\$="-eyebrow"\] \{[^}]*text-transform: uppercase/, 'and it reads as a label, not a paragraph');
});

test('🔴 CONTROL: the base rule stays weak enough for a theme to beat it', () => {
  // Specificity 0,1,0. A theme's `html .st-prose-eyebrow` is 0,1,1 and still wins — that is how
  // every custom theme keeps the look it already chose, and why this can ship as an OTA at all.
  const css = readFileSync(join(HERE, 'astro', 'src', 'styles', 'site.css'), 'utf8');
  const rule = /(^|\n)\[class\$="-eyebrow"\] \{/.exec(css);
  assert.ok(rule, 'the rule is a bare attribute selector, unqualified by any element or ancestor');
});

console.log(`\n  ${passed} passed`);
