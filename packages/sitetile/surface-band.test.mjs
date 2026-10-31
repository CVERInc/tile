// Guard: a section with `surface=<token>` is a BAND — its box spans the page, its content stays
// where the cage put it — and a theme's own rule on it still wins.
//   run: node packages/sitetile/surface-band.test.mjs   (wired into scripts/test.sh via the glob)
//   the browser half: real-render/surface-band.smoke.mjs (PLAYWRIGHT set)
//
// 🩸 CVERInc/reef#1869, part 2 (ruled 2026-10-20). prose / grid / timeline emit `data-surface` for
// the theme to paint, and base caged the section twice: `.st-prose, .st-grid, .st-cta, .st-people`
// at (0,1,0) (plus `.st-grid { max-width: 80rem }`), and the `:where()` floor. A painted surface was
// a box in the middle of the page. The band is paint only: a `border-image` outset in the colour
// the theme puts in `--gd-band`. What this file pins is that it stays paint — no geometry (tile#200
// review), no clip, stacking context or pseudo-element (review r2) — and stays a reef.base floor.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sectionSource } from './section-source.mjs';
import { parseSite, renderSiteToHtml } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8');
const COMPONENTS = Object.fromEntries(['Prose', 'Grid', 'Timeline'].map((n) =>
  [n, sectionSource(`${n}.astro`).all]));   // the component and its packages/emit module

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
    // `data-surface={surface}` in a component; `attr('data-surface', surface)` in its packages/emit module
    assert.match(src, /<section class="st-[a-z]+"[^>]*(\bdata-surface=\{surface\}|attr\('data-surface', surface\))/, `${name}.astro lost data-surface on its <section>`);
  }
});

// ── the rule: paint only, and where it lives ────────────────────────────────────────────────────

const SECTION = ':where(section[data-surface]:not(.st-full-bleed))';
const BAND = 'linear-gradient(var(--gd-band) 0 0) fill 0 / 0 / 0 100vmax';
const GEOMETRY = /(^|;)\s*(max-width|min-width|width|inline-size|max-inline-size|padding|padding-[a-z-]+|margin|margin-[a-z-]+)\s*:/;
// What r2 needed and the tile#200 r2 review measured as side effects: a clip on the parent cut a
// sibling's wide table off, a stacking context put a fixed control under the next section.
const SIDE_EFFECT = /(^|;)\s*(overflow|overflow-[a-z]+|isolation|z-index|position|transform|filter|clip-path|contain|opacity|will-change)\s*:/;

test('🔴 no rule touches a surface section\'s geometry — the band is paint (tile#200 review)', () => {
  // r1 un-caged the box and moved the cage into percent padding; a theme capping the section with
  // `max-width` alone then got padding wider than the section and 0px of content. Any rule naming
  // data-surface that sizes or pads something is that shape coming back.
  const hits = RULES.filter((r) => /data-surface/.test(r.selector) && GEOMETRY.test(r.css));
  assert.deepEqual(hits.map((r) => `${r.selector} { ${r.css} }`), [], 'a data-surface rule sets geometry again');
});

test('🔴 no rule naming data-surface clips, stacks or positions anything (tile#200 review r2)', () => {
  // Covers the section, its pseudo-elements AND any `:has(> section[data-surface])` parent rule.
  const hits = RULES.filter((r) => /data-surface/.test(r.selector) && (SIDE_EFFECT.test(r.css) || /::?(before|after)\b/.test(r.selector)));
  assert.deepEqual(hits.map((r) => `${r.selector} { ${r.css} }`), [], 'a data-surface rule has a side effect beyond paint');
});

test('🔴 the band rule exists once, directly in `@layer reef.base`, and is only the border-image', () => {
  // Count, not existence: a second copy later in the file would win by source order.
  const found = RULES.filter((r) => r.selector === SECTION);
  assert.equal(found.length, 1, `expected ${SECTION} once, found ${found.length}`);
  assert.deepEqual(found[0].context, ['@layer reef.base'], `${SECTION} sits in [${found[0].context.join(' > ')}]`);
  assert.equal(found[0].css.replace(/;\s*$/, ''), `border-image: ${BAND}`);
});

test('🔴 the band reads only --gd-band, and base never sets it', () => {
  // A base default would paint every surface= section, including tokens a theme paints with
  // `background` — the r2 double-composite. No --gd-band ⇒ invalid at computed-value time ⇒ no-op.
  const sets = RULES.filter((r) => /(^|;)\s*--gd-band\s*:/.test(r.css));
  assert.deepEqual(sets.map((r) => r.selector), [], 'base sets --gd-band');
  assert.ok(!/var\(--gd-band\s*,/.test(CSS), 'the band has a var() fallback — it would paint without a theme');
});

test('the band rule is a zero-specificity floor, so any theme rule wins it', () => {
  assert.ok(RULES.some((r) => r.selector === SECTION), `${SECTION} is missing`);
  assert.match(SECTION, /^:where\(/);
});

console.log(`${passed} passed`);
