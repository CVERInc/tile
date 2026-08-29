// Guard: a param the renderer READS must be VISIBLE to the table that lists what it reads.
//   run: node packages/sitetile/coral-params.test.mjs   (wired into scripts/test.sh via the glob)
//
// 🩸 2026-08-28. `caption=before` on a `cta` flips the section's DOM order — caption before the
// button row instead of after — and the write-time checker downstream told authors:
//
//     inert-coral-param: `caption=` … read by nothing — it parses, it is accepted, and the
//     renderer never looks at it (no element, no data- attribute, so CSS cannot reach it either)
//
// Every clause of that sentence was false, and it was aimed at the one moment the author is still
// present. A checker that lies is worse than no checker: it does not merely fail to help, it
// actively talks people out of markup that works.
//
// WHY it lied, and why the fix is HERE rather than in the checker. The list of "params coral X
// reads" is DERIVED from this package — deliberately, because a hand-kept list is wrong the day
// the renderer moves and nobody downstream can tell. The derivation reads a section component and
// collects `pm.<name>`, the renderer's own vocabulary. Cta.astro read the param as
// `ctaCaptionFirst(pm)` — it handed the whole bag to a helper and the helper reached inside. Real
// code, real effect, and no `pm.caption` anywhere for the derivation to find.
//
// So this file asserts OUR half of that contract: every param this renderer reads is read where
// something scanning a section component can see it. It is not a copy of the downstream checker —
// it is the property that checker depends on, checked in the repo that can actually break it.
//
// 🔴 THE CONTRACT, for whoever writes the next coral:
//     read a param as `pm.name` (or `pm['hyphen-name']` when the name cannot be an identifier),
//     IN the section component. Never hand `pm` to a helper and read it in there.
//
// The second half — that the downstream derivation matches BOTH forms — is stated in
// reef-mcp's scripts/vendor-tile.sh, which is where that regex lives. `logo-pos` below is why:
// it is read, it is bracket-read because it has to be, and a dot-only scan calls it inert.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, renderSiteToHtml } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTIONS = join(HERE, 'astro', 'src', 'components', 'sections');

console.log('coral-params');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/**
 * Comments stripped BEFORE anything is scanned.
 *
 * 🩸 Not optional and not tidiness: the comment this test exists to leave behind says
 * "never hand `pm` to a helper" — the word `pm` in prose, one line above the code it describes.
 * A scanner that reads its own explanation reports the file that documents the fix as the file
 * that still has the bug.
 */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** How a param may be read so a scan of the component can see it: `pm.name` or `pm['name']`. */
const READ = /\bpm(?:\.([A-Za-z][\w$]*)|\s*\[\s*['"]([^'"]+)['"]\s*\])/g;
const paramsRead = (src) => new Set([...decomment(src).matchAll(READ)].map((m) => m[1] ?? m[2]));

const corals = readdirSync(SECTIONS)
  .filter((f) => f.endsWith('.astro') && f !== 'GridCell.astro')   // a child partial, not a coral
  .map((f) => ({ coral: f.replace(/\.astro$/, '').toLowerCase(), file: f, src: readFileSync(join(SECTIONS, f), 'utf8') }));

const byCoral = new Map(corals.map((c) => [c.coral, c]));
const read = (coral) => paramsRead(byCoral.get(coral).src);

test('🔴 CONTROL: the scan finds params that are plainly there', () => {
  // Without this, every "X is in the scan" below could be passing against a scanner that returns
  // everything, and every "Y is not" against one that returns nothing.
  assert.ok(corals.length > 5, `only ${corals.length} section components found — wrong directory?`);
  for (const [coral, param] of [['cta', 'button'], ['grid', 'cols'], ['faq', 'open'], ['hero', 'bg']]) {
    assert.ok(read(coral).has(param), `${coral} obviously reads ${param}=, but the scan missed it`);
  }
  assert.ok(!read('cta').has('nonesuch'), 'the scan invents params — "found" would mean nothing');
});

// ── the reported bug: cta `caption` ──────────────────────────────────────────────────────────

test('🔴 caption= reorders a cta, measured on the reference renderer', () => {
  // The premise, measured rather than asserted — if this ever stops being true, the check below
  // is defending a param that really has become inert, and it should be deleted, not loosened.
  // One variable between the two arms: the presence of `caption=before`.
  const src = (pos) => '---\nsitetile-page: t\n---\n\n## Join\n%% sitetile: cta ' + pos + 'button="Sign up"→/signup %%\nA short pitch below.\n';
  const before = renderSiteToHtml(parseSite(src('caption=before ')));
  const after = renderSiteToHtml(parseSite(src('')));
  assert.notEqual(before, after, 'the two arms rendered identically — caption= had no effect at all');
  assert.ok(before.indexOf('A short pitch below.') < before.indexOf('st-cta-btns'), 'caption=before leads with the blurb');
  assert.ok(after.indexOf('st-cta-btns') < after.indexOf('A short pitch below.'), 'default keeps the buttons-first belt');
});

test('🔴 …so a scan of Cta.astro must SEE caption — a read param reported inert is the bug', () => {
  // This is the assertion the whole file exists for. It fails if the component goes back to
  // handing `pm` to ctaCaptionFirst, which is what made a working param look dead downstream.
  assert.ok(read('cta').has('caption'),
    'cta reorders on caption= (proved above) but no `pm.caption` is visible in Cta.astro — ' +
    'the derived table will omit it and authors will be told a working param is inert');
});

test('the cta seam is still shared with the reference renderer', () => {
  // If Cta.astro stops calling the shared helper, the measurement above stops standing in for the
  // production component and this file would be proving something about site-core.js alone.
  assert.match(byCoral.get('cta').src, /ctaCaptionFirst\(/, 'Cta.astro must still use the shared helper');
});

// ── the shape of the defect, not just this instance ─────────────────────────────────────────

test('🔴 no section component hands the whole `pm` bag to a helper', () => {
  const offenders = [];
  for (const c of corals) {
    // Remove the legitimate reads and the one binding; anything still saying `pm` is the bag
    // travelling somewhere a scan cannot follow.
    const rest = decomment(c.src).replace(READ, '').replace(/\bconst\s+pm\s*=/, '');
    const left = rest.match(/\bpm\b/g);
    if (left) offenders.push(`${c.file} (${left.length}×)`);
  }
  assert.deepEqual(offenders, [], 'these pass `pm` somewhere instead of reading a named param:\n' +
    offenders.join('\n') + '\nRead the param in the component (`pm.name`) and pass its VALUE.');
});

test('🔴 CONTROL: that detector goes red on a component that does it', () => {
  // 🩸 The version of this guard that shipped nothing: with the offending code removed, an
  // assertion over an empty list passes, and it would have passed for the whole life of the bug.
  // So the detector is run against the shape it is meant to catch — the literal pre-fix line.
  const guilty = "const pm = parseParams(section.params);\nconst captionFirst = ctaCaptionFirst(pm);\n";
  const rest = decomment(guilty).replace(READ, '').replace(/\bconst\s+pm\s*=/, '');
  assert.ok(/\bpm\b/.test(rest), 'the detector cannot see the exact code it was written for');
});

test('🔴 CONTROL: the comment stripper runs first, so prose about `pm` is not evidence', () => {
  const prose = "// never hand pm to a helper\n/* pm again */\nconst pm = parseParams(section.params);\n";
  const rest = decomment(prose).replace(READ, '').replace(/\bconst\s+pm\s*=/, '');
  assert.ok(!/\bpm\b/.test(rest), 'a comment mentioning pm is being counted as a bag hand-off');
});

test('🔴 a hyphenated param is read in brackets, and the scan has to cover that form', () => {
  // hero's `logo-pos` CANNOT be written `pm.logo-pos` — it is not an identifier. So a dot-only
  // derivation reports a param that positions a live hero's logo as "read by nothing". Same
  // defect as caption, a different door. This asserts our side: it is read, and readably.
  const hero = byCoral.get('hero');
  assert.match(decomment(hero.src), /\bpm\s*\[\s*['"]logo-pos['"]\s*\]/, 'hero must still read logo-pos');
  assert.ok(read('hero').has('logo-pos'), 'the scan must see a bracket-read param');
});

test('🔴 CONTROL: bracket coverage is not free — a dot-only scan misses it', () => {
  // Proves the clause above is doing work. If this ever passes, the two forms have collapsed into
  // one and the bracket half of the contract can be retired.
  const dotOnly = new Set([...decomment(byCoral.get('hero').src).matchAll(/\bpm\.([A-Za-z][\w$]*)/g)].map((m) => m[1]));
  assert.ok(!dotOnly.has('logo-pos'), 'a dot-only scan now sees logo-pos — this control is vacuous');
});

console.log(`  ${passed} passed`);
