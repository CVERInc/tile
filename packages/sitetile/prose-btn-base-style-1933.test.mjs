// Prose link-button rows get the same base paint as hero buttons — CVERInc/reef#1933 (S5).
//   run: node packages/sitetile/prose-btn-base-style-1933.test.mjs
//
// `linkButtonsHtml(buttons, 'st-prose')` emits `.st-prose-btns` / `.st-prose-btn(-primary|-secondary)` /
// `.st-prose-plain`, which used to match no rule (bare <a>). They now ride the SAME rules as
// `.st-hero-*` (one declaration block, selector lists), under the same `:where(body:not([data-theme-custom]))`
// floor so a custom-themed site is untouched. No browser: the cascade is read as CSS text.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const FLOOR = ':where(body:not([data-theme-custom])) ';

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; } };

/** Merged declarations (source order, later wins) of every rule whose selector list contains `selector` exactly. */
function decls(selector) {
  const out = {}; let hits = 0; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    if (!m[1].split(',').map((s) => s.trim()).includes(selector)) continue;
    hits++;
    for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
  }
  return { out, hits };
}

for (const suffix of ['btns', 'btn', 'btn-primary', 'btn-secondary', 'btn-primary:hover', 'btn-secondary:hover', 'plain', 'plain:hover']) {
  test(`.st-prose-${suffix} has the hero's declarations, under the :where floor`, () => {
    const h = decls(`${FLOOR}.st-hero-${suffix}`); const p = decls(`${FLOOR}.st-prose-${suffix}`);
    assert.ok(p.hits >= 1, 'prose selector has no floored rule');
    assert.ok(Object.keys(p.out).length > 0, 'prose rule is empty');
    if (suffix === 'btns') { assert.deepEqual(p.out, h.out); return; }
    if (suffix.startsWith('plain')) { assert.ok(p.out.color); return; }
    assert.deepEqual(p.out, h.out);
  });
}

test('padding / radius / font of .st-prose-btn equal .st-hero-btn, radius via the token', () => {
  const h = decls(`${FLOOR}.st-hero-btn`).out; const p = decls(`${FLOOR}.st-prose-btn`).out;
  for (const k of ['padding', 'border-radius', 'font-size', 'font-weight']) { assert.ok(p[k], `${k} missing`); assert.equal(p[k], h[k]); }
  assert.equal(p['border-radius'], 'var(--gd-btn-radius)');
});

test('row is a wrapping flex row; primary has a fill', () => {
  const r = decls(`${FLOOR}.st-prose-btns`).out;
  assert.equal(r.display, 'flex'); assert.equal(r['flex-wrap'], 'wrap'); assert.ok(r.gap);
  assert.equal(decls(`${FLOOR}.st-prose-btn-primary`).out.background, 'var(--gd-btn-fill)');
});

test('no UNFLOORED .st-prose-btn* rule exists (base paint only; the squircle corner rule is outside the floor, same as hero)', () => {
  const re = /([^{}]+)\{/g; let m;
  while ((m = re.exec(css))) for (const s of m[1].split(',').map((x) => x.trim())) {
    if (/\.st-prose-(btn|plain)/.test(s) && !s.startsWith(FLOOR) && !/^body\[data-corner=/.test(m[1].trim())) assert.fail(`unfloored: ${s}`);
  }
});

test('prose and hero selectors sit in the SAME declaration block (one shared rule, not a copy)', () => {
  const blocks = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) blocks.push(m[1].split(',').map((s) => s.trim()));
  for (const suffix of ['btn', 'btn-primary', 'btn-secondary', 'btn-primary:hover', 'btn-secondary:hover', 'plain:hover']) {
    const hero = `${FLOOR}.st-hero-${suffix}`; const prose = `${FLOOR}.st-prose-${suffix}`;
    assert.ok(blocks.some((b) => b.includes(hero) && b.includes(prose)), `.st-hero-${suffix} and .st-prose-${suffix} are not in one block`);
  }
});

console.log(`${passed} passed`);
