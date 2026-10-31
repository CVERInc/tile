// A prose paragraph of several images is ONE figure, and the base style does not turn it into a row
// of round avatars — reef#1933 (S6).
//   run: node packages/sitetile/prose-multi-image-figure-1933.test.mjs
//
// site.css had `.st-figure:has(> .st-img ~ .st-img)` → 3.5rem circles. It was written for the hero
// (a cluster of team avatars under the title) but selected every multi-image figure on the page.
// While prose lifted its images into `.st-prose-imgs` no prose figure ever held two images, so the
// rule's reach was invisible; with images back in place, every site's thumbnail row would have
// been drawn as little circles. The rule is now scoped to `.st-hero`, and this file says so in a
// way that stays red if any rule outside the hero picks the shape up again.
// No browser: the cascade is read as CSS text, as prose-btn-base-style-1933.test.mjs does.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, renderSiteToHtml } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; } };

/** Every innermost rule: { selectors:[…], decls:{prop:value} }. Layers and media blocks are walked
 *  through, because their innermost `{…}` is a plain rule. */
function rules() {
  const out = []; const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    const decls = {};
    for (const d of m[2].split(';')) { const i = d.indexOf(':'); if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim(); }
    out.push({ selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), decls });
  }
  return out;
}
const RULES = rules();
// A selector that reaches "an image in a figure holding two or more images": the sibling-image
// `:has()` on a figure. Written loosely on purpose — any spelling of `.st-img ~ .st-img` counts.
const MULTI = /\.st-figure[^\s,]*:has\(\s*>?\s*\.st-img\s*[~+]\s*\.st-img\s*\)/;
const AVATAR = (d) => /50%/.test(d['border-radius'] || '') || /3\.5rem/.test((d.width || '') + (d.height || ''));
const inHero = (sel) => /(^|[\s(])\.st-hero(?=[\s.\[:)]|$)/.test(sel.split(MULTI)[0]);

test('a prose paragraph with three images is one figure.st-figure holding three images', () => {
  const md = '---\nsitetile-page: home\ntitle: t\nlang: en-US\n---\n\n## Lead\nFirst.\n\n## Team\nText.\n\n![a](/a.png)![b](/b.png)![c](/c.png)\n';
  const html = renderSiteToHtml(parseSite(md));
  const figures = [...html.matchAll(/<figure class="st-figure">([\s\S]*?)<\/figure>/g)];
  assert.equal(figures.length, 1, `expected one figure, found ${figures.length}`);
  assert.equal((figures[0][1].match(/<img class="st-img"/g) || []).length, 3, 'the figure does not hold three images');
  assert.ok(!/st-prose-imgs/.test(html), 'a .st-prose-imgs group is back');
  // the figure is inside the prose section, not a hero
  const sec = /<section class="st-prose"[^>]*>(?:(?!<\/section>)[\s\S])*<figure class="st-figure">/.exec(html);
  assert.ok(sec, 'the three-image figure is not inside a .st-prose section');
});

test('the parser found the multi-image rules at all (the ruler measures something)', () => {
  const hits = RULES.filter((r) => r.selectors.some((s) => MULTI.test(s)));
  assert.ok(hits.length >= 2, `only ${hits.length} rule(s) target a multi-image figure — the parser or the regex is blind`);
});

test('🔴 the hero keeps its avatar row: a .st-hero multi-image rule draws 3.5rem circles', () => {
  const hero = RULES.filter((r) => r.selectors.some((s) => MULTI.test(s) && inHero(s)) && AVATAR(r.decls));
  assert.ok(hero.length >= 1, 'no hero-scoped multi-image rule with border-radius 50% / 3.5rem');
});

test('🔴 no rule outside .st-hero draws a multi-image figure as 3.5rem / 50% circles', () => {
  const leaks = RULES.flatMap((r) => r.selectors.filter((s) => MULTI.test(s) && !inHero(s) && AVATAR(r.decls)));
  assert.deepEqual(leaks, [], 'multi-image figure rule(s) outside the hero still make round avatars');
});

test('CONTROL: the leak check sees the unscoped rule that used to ship', () => {
  const was = '.st-figure:has(> .st-img ~ .st-img) .st-img';
  assert.ok(MULTI.test(was) && !inHero(was), 'the old unscoped selector would not have been flagged');
  assert.ok(MULTI.test('.st-hero ' + was) && inHero('.st-hero ' + was), 'the hero-scoped selector is not recognised as hero');
  assert.ok(!inHero('.st-prose ' + was) && !inHero('.st-hero-btn ' + was), 'a non-hero ancestor is mistaken for the hero');
});

console.log(`  ${passed} passed`);
