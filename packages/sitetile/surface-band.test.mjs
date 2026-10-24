// Guard: a section with `surface=<token>` is a BAND — its box spans the page, its content stays
// where the cage put it — and a theme's own rule on it still wins.
//   run: node packages/sitetile/surface-band.test.mjs   (wired into scripts/test.sh via the glob)
//   the browser half: real-render/surface-band.smoke.mjs (PLAYWRIGHT set)
//
// 🩸 CVERInc/reef#1869, part 2 (ruled 2026-10-20). prose / grid / timeline emit `data-surface` for
// the theme to paint, and base caged the section twice: `.st-prose, .st-grid, .st-cta, .st-people`
// at (0,1,0) (plus `.st-grid { max-width: 80rem }`), and the `:where()` floor. A painted surface was
// a box in the middle of the page. The band rule moves the cage into the side padding with the
// SAME numbers, so what this file pins is that the numbers stay the same numbers: the cap and the
// inset are read from the cage rules, not restated here, and the rule stays in reef.base at a
// specificity that beats (0,1,0).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, renderSiteToHtml } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8');
const COMPONENTS = Object.fromEntries(['Prose', 'Grid', 'Timeline'].map((n) =>
  [n, readFileSync(join(HERE, `astro/src/components/sections/${n}.astro`), 'utf8')]));

/** Leaf rules as `{ selector, css, context }`, comments stripped, `context` = enclosing preludes
 *  outermost first. Same walker as collection-band.test.mjs (see its 🩸 on why a flat regex is not
 *  enough: it cannot tell a rule in `@layer reef.base` from one inside `@media` or another layer). */
function walkCss(source) {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const leaves = [];
  let buf = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      buf += src.slice(i, j + 1); i = j; continue;
    }
    if (ch === '{') {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ prelude: buf.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', '), decl: '', hasChild: false });
      buf = '';
    } else if (ch === '}') {
      const top = stack.pop();
      if (!top) throw new Error('unbalanced "}" in the stylesheet');
      top.decl += buf; buf = '';
      if (!top.hasChild) leaves.push({ selector: top.prelude, css: top.decl.trim().replace(/\s+/g, ' '), context: stack.map((f) => f.prelude) });
    } else if (ch === ';' && (stack.length === 0 || /^\s*@/.test(buf))) {
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (stack.length) throw new Error(`unbalanced "{" in the stylesheet: ${stack.length} block(s) never closed`);
  return leaves;
}
const RULES = walkCss(CSS);
const decl = (css, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(css);
  return m ? m[1].trim() : null;
};

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

console.log('surface-band');

// ── the markup: who carries data-surface ────────────────────────────────────────────────────────

const FIXTURE = [
  '## Intro', '%% sitetile: prose %%', 'Lead.', '',
  '## Prose', '%% sitetile: prose surface=cream %%', 'Text.', '',
  '## Grid', '%% sitetile: grid surface=paper %%', '### A', 'Card.', '',
  '## Timeline', '%% sitetile: timeline surface=paper %%', '### 2025', 'Entry.', '',
].join('\n');

test('🔴 the string renderer emits data-surface on prose, grid and timeline — once each', () => {
  const out = renderSiteToHtml(parseSite(FIXTURE));
  for (const cls of ['st-prose', 'st-grid', 'st-timeline']) {
    const n = [...out.matchAll(new RegExp(`<section\\b[^>]*class="${cls}"[^>]*data-surface="(?:cream|paper)"`, 'g'))].length;
    assert.equal(n, 1, `expected one <section class="${cls}" … data-surface>, found ${n}`);
  }
  assert.ok(!/class="st-[a-z-]*\bst-full-bleed[^"]*"[^>]*data-surface|data-surface[^>]*class="[^"]*st-full-bleed/.test(out),
    'a surface section also opts out with st-full-bleed — the band rule would not reach it');
});

test('🔴 the Astro components emit data-surface on the section itself', () => {
  for (const [name, src] of Object.entries(COMPONENTS)) {
    assert.match(src, /<section class="st-[a-z]+"[^>]*\bdata-surface=\{surface\}/, `${name}.astro lost data-surface on its <section>`);
  }
});

// ── the rule: where it lives, and that its numbers are the cage's numbers ───────────────────────

const BAND = 'section[data-surface]:not(.st-full-bleed)';
const GRID_BAND = 'section.st-grid[data-surface]:not(.st-full-bleed)';
const WRAPPER = RULES.find((r) => r.selector === '.st-prose, .st-grid, .st-cta, .st-people');
const GRID_CAP = RULES.filter((r) => r.selector === '.st-grid' && decl(r.css, 'max-width') !== null);
const INSET = WRAPPER ? decl(WRAPPER.css, 'padding').replace(/^\S+ /, '') : null;
const band = (cap) => `max(${INSET}, calc((100% - ${cap}) / 2 + ${INSET}))`;

test('CONTROL: the cages this rule mirrors are where this file thinks, with the values it reads', () => {
  assert.ok(WRAPPER, 'the shared wrapper rule `.st-prose, .st-grid, .st-cta, .st-people` is gone — everything below is vacuous');
  assert.equal(decl(WRAPPER.css, 'max-width'), 'var(--gd-maxw)');
  assert.match(INSET, /^clamp\([^)]*\)$/, `wrapper side padding is no longer a clamp(): ${INSET}`);
  assert.equal(GRID_CAP.length, 1, `expected one \`.st-grid { max-width }\`, found ${GRID_CAP.length}`);
  assert.deepEqual(WRAPPER.context, ['@layer reef.base']);
});

test('🔴 both band rules exist once each, directly in `@layer reef.base`', () => {
  // Count, not existence: a second copy later in the file would win by source order.
  for (const sel of [BAND, GRID_BAND]) {
    const found = RULES.filter((r) => r.selector === sel);
    assert.equal(found.length, 1, `expected ${sel} once, found ${found.length}`);
    assert.deepEqual(found[0].context, ['@layer reef.base'],
      `${sel} sits in [${found[0].context.join(' > ')}] — in reef.responsive or unlayered no theme could override it`);
  }
});

test('🔴 the band un-cages the box and puts the SAME cap and inset into its side padding', () => {
  const b = RULES.find((r) => r.selector === BAND);
  assert.equal(decl(b.css, 'max-width'), 'none');
  assert.equal(decl(b.css, 'padding-inline'), band('var(--gd-maxw)'), 'prose/timeline band padding drifted from the wrapper cage');
  const g = RULES.find((r) => r.selector === GRID_BAND);
  assert.equal(decl(g.css, 'padding-inline'), band(decl(GRID_CAP[0].css, 'max-width')),
    'the grid band must use the grid\'s own cap — --gd-maxw would narrow every grid wider than 72ch');
  assert.equal(decl(g.css, 'max-width'), null, 'the grid band inherits max-width: none from the general rule; a second one is a second opinion');
});

test('🔴 no zero-specificity data-surface rule in base — it would lose to the (0,1,0) cage and do nothing', () => {
  // The census's first try (`:where([data-surface])`) was inert for exactly this reason; that it beats
  // the cage at all is measured in the smoke, where the pre-fix band is still 733.9px wide.
  const soft = RULES.filter((r) => /:where\([^)]*data-surface/.test(r.selector));
  assert.deepEqual(soft.map((r) => r.selector), [], 'a :where(…[data-surface]…) rule is back');
});

test('the band rules carry box model only — paint is the theme\'s', () => {
  const LOOK = /(^|[;\s])(color|background|background-[a-z]+|font|font-[a-z]+|border|border-[a-z-]+|box-shadow|text-decoration)\s*:/;
  for (const sel of [BAND, GRID_BAND]) {
    const hit = RULES.find((r) => r.selector === sel).css.match(LOOK);
    assert.ok(!hit, `look property "${hit?.[2]}" in ${sel} — the surface colour belongs to the theme`);
  }
});

console.log(`${passed} passed`);
