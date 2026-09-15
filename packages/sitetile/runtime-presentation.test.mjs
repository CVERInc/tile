// Guard: the shared runtime-composed presentation rules (the .st-runtime container plus its
// .st-runtime-action/.st-runtime-status/.st-runtime-list components) exist, stay inside
// `@layer reef.base`, stay ungated, and use the RIGHT specificity for what each one is.
//   run: node packages/sitetile/runtime-presentation.test.mjs   (globbed by scripts/test.sh)
//
// Two shapes on purpose, not one. `.st-runtime` (and its nested-section inset reset) are pure
// box-model CONTAINERS and stay `:where()` — zero specificity, so nothing ever has to fight them.
// `.st-runtime-action`, `.st-runtime-status` and `.st-runtime-list` are COMPONENTS with real look,
// and are plain single-class selectors instead: this file already carries a bare-element rule one
// of them must outrank in the same layer — `a { color: var(--gd-accent) }` — and a `:where(.foo)`
// selector collapses to zero specificity, which LOSES to that bare `a` (see the region's own
// header comment in site.css for the worked example). This file was itself the fix for that
// finding: `.st-runtime-action` used to be wrapped in `:where()` too, which would have painted an
// `<a class="st-runtime-action">` accent-on-accent the first time this class was used on an
// anchor instead of a button.
//
// These four selectors form the shared composition surface for native storefront, membership /
// account, and result pages, each independent of the others' markup.
// If one of them silently lost its layer, its ungated form, or picked the wrong specificity shape,
// a runtime page would either fight a site's theme, lose to this file's own element rules, or stop
// being overridable at all — the same defect class base-paint.test.mjs / section-inset.test.mjs
// guard for the build-time primitives.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro', 'src', 'styles', 'site.css'), 'utf8');

console.log('runtime-presentation');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/** Rule bodies whose selector contains `needle` (comments stripped first). Same reader as
 *  base-paint.test.mjs / section-inset.test.mjs — anchored on the selector run so it reads
 *  consecutive rules instead of skipping alternating ones (see base-paint.test.mjs's own test for
 *  why that anchor matters); reused here rather than reinvented. */
function rulesFor(needle) {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(needle)) out.push({ selector: m[1].trim(), css: m[2] });
  }
  return out;
}

/** A rule whose selector, once trimmed, is EXACTLY `selector` — for isolating one specific bare
 *  rule (e.g. the file's own `a { ... }`) from every other selector that merely contains it as a
 *  substring. `rulesFor` cannot do this: `rulesFor('a')` would match nearly every selector in the
 *  file, since almost all of them contain the letter "a" somewhere. */
function exactRule(selector) {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() === selector) return { selector: m[1].trim(), css: m[2] };
  }
  return null;
}

const CONTAINERS = ['.st-runtime'];
const COMPONENTS = ['.st-runtime-status', '.st-runtime-action', '.st-runtime-list'];
const ALL = [...CONTAINERS, ...COMPONENTS];

// reef.base opens at the top of the file and reef.responsive opens near the end (cascade-layers.
// test.mjs pins that exact declared order); everything between those two indices is inside
// reef.base. site.css carries no other top-level @layer block, so this containment check is exact
// without re-parsing nested layer bodies.
const REEF_BASE_START = CSS.indexOf('@layer reef.base {');
const REEF_RESPONSIVE_START = CSS.indexOf('@layer reef.responsive {');

test('🔴 CONTROL: the layer boundaries this file relies on are actually found', () => {
  assert.ok(REEF_BASE_START > -1, 'site.css must open @layer reef.base');
  assert.ok(REEF_RESPONSIVE_START > REEF_BASE_START, 'site.css must open @layer reef.responsive after reef.base');
});

for (const sel of ALL) {
  const bare = sel.slice(1); // drop the leading '.' for substring matching against selector text
  const isContainer = CONTAINERS.includes(sel);

  test(`${sel} is defined somewhere in site.css`, () => {
    const rules = rulesFor(bare);
    assert.ok(rules.length > 0, `no rule selector mentions ${sel}`);
  });

  // "own" rules = every variant of this exact class (base, :hover, :focus-visible, :empty,
  // :disabled/[aria-disabled] combos, …), as opposed to a rule that merely names it as an ancestor
  // (e.g. `.st-runtime section[class^="st-"]` is NOT an "own" rule of `.st-runtime`).
  const own = () => rulesFor(bare).filter((r) => new RegExp(`\\${sel}(?![\\w-])`).test(r.selector));

  if (isContainer) {
    test(`${sel} is a CONTAINER — written with :where( for zero specificity`, () => {
      const rules = own();
      assert.ok(rules.length > 0, `no rule selector matches ${sel} itself (only descendants/variants found)`);
      assert.ok(rules.every((r) => /:where\(/.test(r.selector)),
        `${sel} is a container and must sit in :where(): ${rules.map((r) => r.selector).join(' | ')}`);
    });
  } else {
    test(`${sel} is a COMPONENT — a plain single-class selector, NOT wrapped in :where(`, () => {
      const rules = own();
      assert.ok(rules.length > 0, `no rule selector matches ${sel} itself (only descendants/variants found)`);
      assert.ok(rules.every((r) => !/:where\(/.test(r.selector)),
        `${sel} is a component and must NOT sit in :where() — a zero-specificity class loses to this file's own bare element rules (e.g. \`a\`): ${rules.map((r) => r.selector).join(' | ')}`);
    });
  }

  test(`${sel}'s own rule sits inside @layer reef.base, not after it`, () => {
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const re = new RegExp(`[^{}]*\\${sel}(?![\\w-])[^{}]*\\{`, 'g');
    const matches = [...body.matchAll(re)];
    assert.ok(matches.length > 0, `no rule opening found for ${sel}`);
    for (const m of matches) {
      // index in the comment-stripped body is not the same offset as CSS, but stripping only
      // removes comment text (never braces or selectors), so relative ordering vs. the two layer
      // markers — which are themselves outside any comment — is preserved.
      const strippedReefBase = body.indexOf('@layer reef.base {');
      const strippedReefResponsive = body.indexOf('@layer reef.responsive {');
      assert.ok(m.index > strippedReefBase && m.index < strippedReefResponsive,
        `${sel} rule at "${m[0].trim()}" is not between @layer reef.base and @layer reef.responsive`);
    }
  });

  test(`${sel} is not gated on a custom theme`, () => {
    const rules = rulesFor(bare);
    for (const r of rules) {
      assert.ok(!/data-theme-custom/.test(r.selector),
        `${sel} (or a rule mentioning it) is gated on [data-theme-custom], which would exempt exactly the themed sites this composition surface targets: ${r.selector}`);
    }
  });
}

// ── the action selector outranks this file's own bare `a` rule ─────────────────────────────────

test('🔴 .st-runtime-action structurally outranks this file\'s bare `a` rule', () => {
  // Not a general CSS specificity engine — a simple structural check is enough here. A
  // selector that is exactly one class token (0 ids, 1 class, 0 elements) always outranks a
  // selector that is exactly one type token (0 ids, 0 classes, 1 element): the class component (b)
  // decides at 1-vs-0 regardless of the element component (c). Both sides are asserted to have
  // exactly that shape, which is sufficient to prove the ordering without reimplementing the CSS
  // specificity algorithm here.
  const bareA = exactRule('a');
  assert.ok(bareA, 'expected a bare `a { ... }` rule in site.css — if it is gone, this whole workaround (and this test) may no longer be needed, but the removal should be a deliberate decision, not a silent drift');
  const action = exactRule('.st-runtime-action');
  assert.ok(action, 'no plain, unqualified .st-runtime-action base rule found');
  assert.doesNotMatch(bareA.selector, /[.#:\[]/, `the \`a\` rule this test protects against is no longer a bare type selector (now "${bareA.selector}") — re-check whether .st-runtime-action still needs to be unwrapped`);
  assert.doesNotMatch(action.selector, /:where\(/, '.st-runtime-action must not be wrapped in :where() or it drops back to zero specificity');
});

// ── the action selector's interaction/affordance coverage ──────────────────────────────────────

test('🔴 .st-runtime-action has :focus-visible coverage with a real outline, not just an implicit UA ring', () => {
  const rules = rulesFor('st-runtime-action').filter((r) => /:focus-visible/.test(r.selector));
  assert.ok(rules.length > 0, 'no .st-runtime-action:focus-visible (or equivalent) rule found');
  assert.ok(rules.some((r) => /outline/.test(r.css)), `focus-visible rule sets no outline: ${rules.map((r) => r.css).join(' | ')}`);
});

test('🔴 .st-runtime-action has :disabled AND [aria-disabled="true"] coverage — button and anchor both', () => {
  const rules = rulesFor('st-runtime-action').filter((r) => /:disabled|\[aria-disabled="true"\]/.test(r.selector));
  assert.ok(rules.length > 0, 'no disabled-affordance rule found for .st-runtime-action');
  const combined = rules.map((r) => r.selector).join(' ');
  assert.ok(/:disabled/.test(combined), 'no :disabled coverage (native <button disabled>)');
  assert.ok(/\[aria-disabled="true"\]/.test(combined), 'no [aria-disabled="true"] coverage (an <a> has no native disabled state)');
  assert.ok(rules.every((r) => !/:where\(/.test(r.selector)), 'the disabled-affordance rule is a component and must not be wrapped in :where() either');
});

test('.st-runtime-action reuses the existing primary-control tokens, not new colours', () => {
  const own = exactRule('.st-runtime-action');
  assert.ok(own, 'no plain .st-runtime-action base rule found');
  for (const token of ['--gd-btn-fill', '--gd-accent-ink', '--gd-btn-radius']) {
    assert.ok(own.css.includes(token), `.st-runtime-action does not consume ${token}, the token the existing primary controls use`);
  }
});

// ── runtime form submit controls must not stretch inside a flex-column .st-form ────────────────
//
// `.st-form` (and the island's own `:where(.st-account-sections) form` rule) is `display: flex;
// flex-direction: column`, so a flex item with no `align-self` of its own stretches to the
// column's full cross-axis width by default — the same reason `.st-form-submit` already carries
// `align-self: flex-start`. Both the renderer's own runtime form submit and the island's
// unclassed contact-form button must match that convention instead of rendering edge-to-edge.

test('🔴 .st-runtime-action sets align-self: flex-start, so a submit inside .st-form does not stretch', () => {
  const own = exactRule('.st-runtime-action');
  assert.ok(own, 'no plain .st-runtime-action base rule found');
  assert.match(own.css, /align-self:\s*flex-start\b/, `.st-runtime-action does not set align-self: flex-start: ${own.css}`);
});

test('🔴 the island form button (:where(.st-account-sections) button) sets align-self: flex-start, so the contact form\'s submit does not stretch', () => {
  const own = exactRule(':where(.st-account-sections) button');
  assert.ok(own, 'no plain :where(.st-account-sections) button base rule found');
  assert.match(own.css, /align-self:\s*flex-start\b/, `:where(.st-account-sections) button does not set align-self: flex-start: ${own.css}`);
});

test('the island Discord section has a gap between its connect button and join link', () => {
  const own = exactRule(':where(.st-account-sections) button + a');
  assert.ok(own, 'no :where(.st-account-sections) button + a rule found');
  assert.match(own.css, /margin(-inline-start)?:\s*\S/, `no spacing declared between the connect button and join link: ${own.css}`);
});

// ── a plain base rule must exist, not only the :empty / descendant variants ────────────────────

test('🔴 .st-runtime-status has a plain, unqualified base rule (not only :empty or descendant variants)', () => {
  const own = exactRule('.st-runtime-status');
  assert.ok(own, 'no plain .st-runtime-status base rule found');
});

// ── empty status must not reserve a visible box ─────────────────────────────────────────────────

test('🔴 :empty .st-runtime-status cancels its own spacing so an unfilled status node reserves no box', () => {
  const empty = rulesFor('st-runtime-status').filter((r) => /:empty/.test(r.selector));
  assert.ok(empty.length > 0, 'no .st-runtime-status:empty (or equivalent) rule found');
  assert.ok(empty.some((r) => /margin:\s*0\b/.test(r.css)),
    `the :empty rule does not zero the margin the base rule set: ${empty.map((r) => r.css).join(' | ')}`);
});

// ── nested-inset guard: a runtime section inside .st-runtime must not double the generic floor ──

test('🔴 a section[class^="st-"] nested inside .st-runtime has its inset reset, so the outer wrapper is not doubled', () => {
  const nested = rulesFor('.st-runtime section[class^="st-"]');
  assert.ok(nested.length > 0, 'no :where(.st-runtime section[class^="st-"]) reset rule found');
  const r = nested[0];
  assert.match(r.selector, /:where\(/, 'the nested-section reset is a container and must stay zero-specificity');
  assert.match(r.css, /padding:\s*0\b/, 'the reset does not zero padding');
  assert.match(r.css, /max-width:\s*none\b/, 'the reset does not clear max-width');
});

console.log(`  ${passed} passed`);
