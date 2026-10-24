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

// ── the rule: paint only, and where it lives ────────────────────────────────────────────────────

const SUPPORTS = '@supports (overflow-x: clip) and selector(:has(*))';
const SECTION = ':where(section[data-surface]:not(.st-full-bleed))';
const PAINT = `${SECTION}::before`;
const PARENT = ':where(:has(> section[data-surface]:not(.st-full-bleed)))';
const GEOMETRY = /(^|;)\s*(max-width|min-width|width|inline-size|max-inline-size|padding|padding-[a-z-]+|margin|margin-[a-z-]+)\s*:/;

test('🔴 no rule touches a surface section\'s geometry — the band is paint (tile#200 review)', () => {
  // r1 un-caged the box and moved the cage into percent padding; a theme capping the section with
  // `max-width` alone then got padding wider than the section and 0px of content. Any rule naming
  // data-surface that sizes or pads something is that shape coming back.
  const hits = RULES.filter((r) => /data-surface/.test(r.selector) && GEOMETRY.test(r.css));
  assert.deepEqual(hits.map((r) => `${r.selector} { ${r.css} }`), [], 'a data-surface rule sets geometry again');
});

test('🔴 the three band rules exist once each, in `@layer reef.base` behind the clip/:has() @supports', () => {
  // Count, not existence: a second copy later in the file would win by source order. The @supports
  // matters: without `clip` the copy would overhang the page; without `:has()` nothing clips it.
  for (const sel of [SECTION, PAINT, PARENT]) {
    const found = RULES.filter((r) => r.selector === sel);
    assert.equal(found.length, 1, `expected ${sel} once, found ${found.length}`);
    assert.deepEqual(found[0].context, ['@layer reef.base', SUPPORTS],
      `${sel} sits in [${found[0].context.join(' > ')}]`);
  }
});

test('🔴 the paint layer copies the section\'s own background, one viewport wide, behind the content', () => {
  const b = RULES.find((r) => r.selector === PAINT);
  assert.equal(decl(b.css, 'content'), '""');
  assert.equal(decl(b.css, 'position'), 'absolute');
  // One viewport, centred: a gradient spans the band as drawn. A wider copy (-100vmax) shows only
  // the gradient's middle — the smoke measured rgb(80,97,140) at the edge of a blue→orange band.
  assert.equal(decl(b.css, 'inset'), '0 calc(50% - 50vw)');
  assert.equal(decl(b.css, 'z-index'), '-1');
  // The only paint in base is `inherit`: the colour, gradient or image is the theme's.
  assert.equal(decl(b.css, 'background'), 'inherit');
  const LOOK = /(^|;)\s*(color|background-[a-z]+|border|border-[a-z-]+|box-shadow|opacity|filter)\s*:/;
  const hit = b.css.match(LOOK);
  assert.ok(!hit, `look property "${hit?.[2]}" on the paint layer — the surface belongs to the theme`);
});

test('🔴 the section only becomes the paint layer\'s positioned, isolated parent', () => {
  // isolation keeps z-index:-1 inside the section: above its own background, below its content, and
  // never behind an ancestor's background (a theme painting .rf-main would otherwise hide the band).
  const s = RULES.find((r) => r.selector === SECTION);
  assert.equal(s.css.replace(/;\s*$/, ''), 'position: relative; isolation: isolate');
});

test('🔴 the parent clips with overflow-x: clip — not hidden (no scroll container), not missing (page scrolls)', () => {
  // 100vw counts a classic scrollbar: without this the page scrolls sideways by half of one (the
  // smoke: scrollWidth 1273 vs clientWidth 1265).
  const p = RULES.find((r) => r.selector === PARENT);
  assert.equal(p.css.replace(/;\s*$/, ''), 'overflow-x: clip');
});

test('the band rules are zero-specificity floors, so any theme rule wins them', () => {
  for (const sel of [SECTION, PAINT, PARENT]) assert.match(sel, /^:where\(/, `${sel} is not a :where() floor`);
});

console.log(`${passed} passed`);
