// Platform buttons follow the SITE's button radius — CVERInc/reef#1888 (B).
//   run: node packages/sitetile/button-radius-1888.test.mjs
//
// 🩸 2026-10-14, measured in a browser on two live sites: a site whose buttons are 6px got 9999px
// banner buttons; a site whose buttons are all 0px got a 0px "accept" (only because its own
// custom CSS happened to set --gd-pill), a 9999px "decline" and a 999px preview-gate button.
// Signet's banner reads `var(--gd-pill, 9999px)` (a token that is not in the theme grammar) and the
// decline and the gate button read nothing at all.
//
// The chain now is `var(--gd-pill, var(--gd-btn-radius, <old pill>))`: --gd-pill is kept as the
// transition knob (a site that set it keeps its look), the theme's button radius comes next, and
// the old pill is only what a host with neither token gets. `button: pill` already sets
// --gd-btn-radius: 999px, so a pill site stays a pill.
//
// No browser here (the e2e runner is this machine — no Playwright in lanes). What is measured is
// the token chain itself: the cascade's last border-radius for each selector, resolved through
// var() against each fixture's custom properties — four fixtures from the ticket.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALE_BANNER_RADIUS_CSS } from './astro/src/packages/lingo/banner-radius-css.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro/src');
const layout = readFileSync(join(SRC, 'layouts/SiteLayout.astro'), 'utf8');
const site = readFileSync(join(SRC, 'styles/site.css'), 'utf8');
const preview = readFileSync(join(SRC, 'pages/preview/index.astro'), 'utf8');

// The real Signet CSS when node_modules is installed (CI); otherwise the two rules verbatim from
// @cvernet/signet@0.6.0 src/locale-banner.css, so a bare checkout still measures the same chain.
let signet; let real = true;
try { signet = readFileSync(join(HERE, 'astro/node_modules/@cvernet/signet/src/locale-banner.css'), 'utf8'); }
catch {
  real = false;
  signet = '.locale-banner__decline {\n  border: none;\n  border-radius: 9999px;\n}\n'
    + '.locale-banner__decline:hover {\n  color: var(--lb-ink);\n}\n'
    + '.locale-banner__continue {\n  border-radius: var(--gd-pill, 9999px);\n}\n'
    + '.locale-banner__continue:hover {\n  background: var(--lb-fill-hover);\n}\n';
}

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; } };

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Last `border-radius` declared for exactly `selector` (equal specificity ⇒ source order wins). */
function lastRadius(css, selector) {
  let out = null;
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  for (const c = strip(css); (m = re.exec(c));) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (!sels.includes(selector)) continue;
    const d = m[2].match(/(?:^|;)\s*border-radius\s*:\s*([^;]+)/);
    if (d) out = d[1].trim();
  }
  return out;
}
/** Resolve var(--x, fallback) against a custom-property map, the way the cascade does. */
function resolve(value, props, depth = 0) {
  assert.ok(depth < 10, 'var() cycle');
  const i = value.indexOf('var(');
  if (i < 0) return value.trim();
  let j = i + 4, lvl = 1;
  for (; j < value.length && lvl; j++) { if (value[j] === '(') lvl++; else if (value[j] === ')') lvl--; }
  const inner = value.slice(i + 4, j - 1);
  const k = inner.indexOf(',');
  const name = (k < 0 ? inner : inner.slice(0, k)).trim();
  const fb = k < 0 ? null : inner.slice(k + 1);
  const v = Object.prototype.hasOwnProperty.call(props, name) ? resolve(props[name], props, depth + 1) : (fb == null ? 'unset' : resolve(fb, props, depth + 1));
  return resolve(value.slice(0, i) + v + value.slice(j), props, depth + 1);
}

// the renderer's own defaults (site.css :root), then each fixture on top — as a theme would.
const BASE = { '--gd-radius': '12px', '--gd-btn-radius': 'var(--gd-radius)' };
const FIXTURES = {
  'all 0px (radius + btn-radius + pill)': { props: { '--gd-radius': '0px', '--gd-btn-radius': '0px', '--gd-pill': '0px' }, want: '0px' },
  '6px buttons':                          { props: { '--gd-btn-radius': '6px' }, want: '6px' },
  '`button: pill`':                       { props: { '--gd-btn-radius': '999px' }, want: '999px' },
  'nothing set (renderer default)':       { props: {}, want: '12px' },
};
const banner = signet + LOCALE_BANNER_RADIUS_CSS;
const BUTTONS = [
  ['banner accept', banner, '.locale-banner__continue'],
  ['banner decline', banner, '.locale-banner__decline'],
  ['preview gate', preview, '.pv-gate-btn'],
  ['preview resume', preview, '.pv-toc-head a.pv-resume'],
];

console.log(`button radius follows the site (signet css: ${real ? 'installed' : 'embedded 0.6.0 copy'})`);
const readings = [];
for (const [fx, { props, want }] of Object.entries(FIXTURES)) {
  for (const [label, css, sel] of BUTTONS) {
    test(`🔴 ${fx}: ${label} = ${want}`, () => {
      const decl = lastRadius(css, sel);
      assert.ok(decl, `${sel} declares a border-radius`);
      const got = resolve(decl, { ...BASE, ...props });
      readings.push(`${fx} | ${label} | ${got}`);
      assert.equal(got, want, `${sel}: ${decl}`);
    });
  }
}

test('🔴 a host with no theme tokens at all keeps the old pill (Signet outside sitetile)', () => {
  assert.equal(resolve(lastRadius(banner, '.locale-banner__continue'), {}), '9999px');
  assert.equal(resolve(lastRadius(banner, '.locale-banner__decline'), {}), '9999px');
  assert.equal(resolve(lastRadius(preview, '.pv-gate-btn'), {}), '999px');
});

test('🔴 hover changes no radius (the 0px site stays square on hover)', () => {
  for (const sel of ['.locale-banner__continue:hover', '.locale-banner__decline:hover', '.pv-gate-btn:hover']) {
    assert.equal(lastRadius(banner + preview, sel), null, `${sel} sets no border-radius`);
  }
});

test('🔴 SiteLayout appends the radius rules AFTER Signet\'s, in the same layer', () => {
  assert.match(layout, /import \{ LOCALE_BANNER_RADIUS_CSS \} from '\.\.\/packages\/lingo\/banner-radius-css\.mjs';/);
  assert.match(layout, /stripCssComments\(signetLocaleBannerCss\) \+ LINGO_BAR_POSITION \+ LOCALE_BANNER_RADIUS_CSS/);
});

test('`button: pill` is still what drives --gd-btn-radius to 999px', () => {
  assert.match(site, /body\[data-button="pill"\] \{ --gd-btn-radius: 999px; \}/);
});

console.log(readings.map((r) => `    ${r}`).join('\n'));
console.log(`\n${passed} passed`);
