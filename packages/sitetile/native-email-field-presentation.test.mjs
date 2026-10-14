// Guard: the native Buy email field (`[data-native-email-field]`, built by `ask()` in
// packages/dynamic-corals/square-shop/shop-function-template.js via `doc.createElement('input')`,
// with no class ever set on it) takes the site theme instead of the browser default.
//   run: node packages/sitetile/native-email-field-presentation.test.mjs   (globbed by scripts/test.sh)
//
// Observed on a generated site's native Buy path: the label, the status copy and the
// `.dc-native-buy` button beside this field all followed the theme; the field itself rendered
// Arial 13.3px, black text, a grey 2px border and radius 0, because nothing in site.css keyed off
// its attribute. The fix reuses `.st-form-input`'s existing token recipe rather than inventing a
// new one — this test pins that reuse, not just "some rule exists".

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro', 'src', 'styles', 'site.css'), 'utf8');

console.log('native-email-field-presentation');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

/** Rule bodies whose selector contains `needle` (comments stripped first). Same reader
 *  runtime-presentation.test.mjs / base-paint.test.mjs already use — reused rather than
 *  reinvented. */
function rulesFor(needle) {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(needle)) out.push({ selector: m[1].trim(), css: m[2] });
  }
  return out;
}

const NEEDLE = '[data-native-email-field]';

test('🔴 a rule keys off [data-native-email-field], not a class the script never sets', () => {
  const rules = rulesFor(NEEDLE);
  assert.ok(rules.length > 0, 'no rule selector mentions [data-native-email-field]');
});

test('🔴 the field is scoped under .st-runtime, so it can never reach a bare <input> outside a runtime surface', () => {
  const rules = rulesFor(NEEDLE);
  assert.ok(rules.every((r) => r.selector.includes('.st-runtime')),
    `every [data-native-email-field] rule must be scoped under .st-runtime: ${rules.map((r) => r.selector).join(' | ')}`);
});

test('🔴 the base rule reuses the SAME tokens .st-form-input already uses for font/colour/background/border/radius — no new colours invented', () => {
  const base = rulesFor(NEEDLE).find((r) => !/:focus|:hover|:disabled|\[aria-busy/.test(r.selector));
  assert.ok(base, 'no base (non-pseudo-class) [data-native-email-field] rule found');
  const formInput = rulesFor('.st-form-input').find((r) => r.selector.trim() === '.st-form-input');
  assert.ok(formInput, 'expected an existing .st-form-input base rule to compare against');
  for (const token of ['--gd-text', '--gd-bg', '--gd-border', '--gd-radius']) {
    assert.ok(formInput.css.includes(token), `fixture check: .st-form-input itself should use ${token}`);
    assert.ok(base.css.includes(token), `[data-native-email-field] does not consume ${token}, the token .st-form-input already uses`);
  }
  assert.doesNotMatch(base.css, /#[0-9a-f]{3,8}\b|rgb\(/i, 'the email field rule uses a literal colour instead of a theme token');
});

test('🔴 a visible focus outline is set (not left to an implicit UA ring)', () => {
  const focus = rulesFor(NEEDLE).filter((r) => /:focus/.test(r.selector));
  assert.ok(focus.length > 0, 'no [data-native-email-field]:focus / :focus-visible rule found');
  assert.ok(focus.some((r) => /outline/.test(r.css)), `focus rule sets no outline: ${focus.map((r) => r.css).join(' | ')}`);
});

test('the rule sits inside @layer reef.base, not after it (same containment every other runtime rule relies on)', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const reefBaseStart = body.indexOf('@layer reef.base {');
  const reefResponsiveStart = body.indexOf('@layer reef.responsive {');
  assert.ok(reefBaseStart > -1 && reefResponsiveStart > reefBaseStart, 'expected the usual reef.base/reef.responsive layer markers');
  const escaped = NEEDLE.replace(/[[\]]/g, '\\$&');
  const re = new RegExp(`[^{}]*${escaped}[^{}]*\\{`, 'g');
  const matches = [...body.matchAll(re)];
  assert.ok(matches.length > 0, 'no rule opening found for [data-native-email-field]');
  for (const m of matches) {
    assert.ok(m.index > reefBaseStart && m.index < reefResponsiveStart,
      `[data-native-email-field] rule at "${m[0].trim()}" is not between @layer reef.base and @layer reef.responsive`);
  }
});

console.log(`  ${passed} passed`);
