// theme-compile — a structured _theme.md compiles to (theme.css token block + _site.md keys),
// deterministically.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTheme, compileThemeCss } from './theme-compile.js';
import { TOKENS } from './theme-schema.js';

const WARM = { name: 'warmreef', 'gd-bg': '#fff7f2', 'gd-accent': '#ff5d61', 'gd-radius': '20px', fonts: 'https://fonts.example/x.css', announce: 'New series soon' };

test('theme.css uses html:root (must beat site.css :root) and names the theme', () => {
  const css = compileThemeCss(WARM);
  assert.match(css, /html:root\s*\{/, 'html:root, not :root — wins over base regardless of order');
  assert.match(css, /Theme: warmreef/);
});

test('only the tokens the author set are emitted; untouched tokens stay at base default', () => {
  const css = compileThemeCss(WARM);
  assert.match(css, /--gd-bg:\s*#fff7f2;/);
  assert.match(css, /--gd-accent:\s*#ff5d61;/);
  assert.match(css, /--gd-radius:\s*20px;/);
  assert.doesNotMatch(css, /--gd-text:/, 'gd-text untouched → not emitted (inherits site.css default)');
});

test('meta/non-token keys never leak into the CSS token block', () => {
  const css = compileThemeCss(WARM);
  for (const k of ['name', 'fonts', 'announce']) assert.doesNotMatch(css, new RegExp(`--${k}:`), `${k} is not a token`);
});

test('token declarations follow canonical TOKENS order', () => {
  // set bg, accent, radius out of order → emitted in TOKENS order (bg, accent, radius)
  const css = compileThemeCss({ name: 't', 'gd-radius': '20px', 'gd-accent': '#111', 'gd-bg': '#fff' });
  const order = [...css.matchAll(/--(gd-[a-z-]+):/g)].map((m) => m[1]);
  const canonical = TOKENS.map((t) => t.stem).filter((s) => order.includes(s));
  assert.deepEqual(order, canonical);
});

test('deterministic: same meta → byte-identical css', () => {
  assert.equal(compileThemeCss(WARM), compileThemeCss({ ...WARM }));
});

test('a token-less theme still compiles to a valid file with a named html:root block', () => {
  const css = compileThemeCss({ name: 'plain', fonts: 'x' });
  assert.match(css, /Theme: plain/);
  assert.match(css, /html:root\s*\{\s*\}/, 'empty but valid root block (build needs theme.css to exist)');
});

test('compileTheme surfaces _site.md keys: theme=name, plus fonts + announce when present', () => {
  const { name, css, siteMeta } = compileTheme(WARM);
  assert.equal(name, 'warmreef');
  assert.equal(siteMeta.theme, 'warmreef');
  assert.equal(siteMeta.fonts, 'https://fonts.example/x.css');
  assert.equal(siteMeta.announce, 'New series soon');
  assert.match(css, /--gd-accent:\s*#ff5d61;/, 'css comes along in the same result');
});

test('compileTheme omits fonts/announce from siteMeta when absent (no empty keys)', () => {
  const { siteMeta } = compileTheme({ name: 'bare', 'gd-bg': '#fff' });
  assert.deepEqual(siteMeta, { theme: 'bare' });
});

// ── TREATMENT axes → siteMeta ──────────────────────────────────────────────────────────────
test('compileTheme emits non-default treatment values as body-attr frontmatter keys', () => {
  const { siteMeta } = compileTheme({ name: 'atelier', header: 'translucent', 'header-width': 'boxed', button: 'pill', band: 'full-bleed', card: 'flat', 'cell-cta': 'off' });
  assert.equal(siteMeta.header, 'translucent');
  assert.equal(siteMeta['header-width'], 'boxed');
  assert.equal(siteMeta.button, 'pill');
  assert.equal(siteMeta.band, 'full-bleed');
  assert.equal(siteMeta.card, 'flat');
  assert.equal(siteMeta['cell-cta'], 'off');
});

test('compileTheme skips DEFAULT treatment values (absent state → byte-identical body, no noise)', () => {
  const { siteMeta } = compileTheme({ name: 'plain', button: 'rect', card: 'surface', corner: 'round', 'cell-cta': 'on' });
  assert.deepEqual(siteMeta, { theme: 'plain' }, 'every value is the default → nothing stamped');
});

test('compileTheme emits header-sticky only when true (never data-header-sticky="false")', () => {
  assert.equal(compileTheme({ name: 't', 'header-sticky': 'true' }).siteMeta['header-sticky'], 'true');
  assert.equal('header-sticky' in compileTheme({ name: 't', 'header-sticky': 'false' }).siteMeta, false, 'false is the default — never stamped (the switch is presence-based)');
});

test('compileTheme DROPS an off-list treatment value (verifyTheme flags it; the DOM never sees it)', () => {
  const { siteMeta } = compileTheme({ name: 't', card: 'fancy' });
  assert.equal('card' in siteMeta, false, 'an invalid enum value is never stamped as a body attr');
});

// ── 🌗 DARK-SCHEME PAIR ──────────────────────────────────────────────────────────────────────────
test('🌗 a paired token compiles to a second block that wins under the toggle', () => {
  const css = compileThemeCss({ name: 'pair', 'gd-bg': '#fdfcff', 'gd-text': '#241a33', 'gd-bg@dark': '#120d1c', 'gd-text@dark': '#f3eefb' });
  assert.match(css, /html:root \{\n {2}--gd-bg: #fdfcff;\n {2}--gd-text: #241a33;\n\}/);
  assert.match(css, /html\[data-theme="dark"\]:root \{\n {2}--gd-bg: #120d1c;\n {2}--gd-text: #f3eefb;\n\}/);
  // (0,2,1) beats the default block's (0,1,1) whenever the toggle has stamped the attribute
  assert.ok(css.indexOf('html[data-theme="dark"]') > css.indexOf('html:root'), 'the dark block comes second');
});

test('🌗 NO @dark keys → not one byte more than before (the absent state stays absent)', () => {
  assert.equal(compileThemeCss({ name: 'x', 'gd-bg': '#fff' }),
    '/* Compiled from ir/_theme.md — do not hand-edit. Theme: x. */\nhtml:root {\n  --gd-bg: #fff;\n}\n');
});

test('🌗 only the OVERRIDDEN tokens appear in the dark block', () => {
  const css = compileThemeCss({ name: 'x', 'gd-bg': '#fff', 'gd-text': '#111', 'gd-bg@dark': '#000' });
  const dark = css.slice(css.indexOf('html[data-theme="dark"]'));
  assert.match(dark, /--gd-bg: #000;/);
  assert.doesNotMatch(dark, /--gd-text/, 'an unpaired token inherits the default scheme, it is not restated');
});

test('🔴 a @dark value goes through the SAME structural-safety filter as its stem', () => {
  const css = compileThemeCss({ name: 'x', 'gd-bg': '#fff', 'gd-bg@dark': '#000} body{display:none}' });
  assert.doesNotMatch(css, /display:\s*none/, 'the dark palette is not a hole in the filter');
  assert.equal((css.match(/\{/g) || []).length, (css.match(/\}/g) || []).length);
});

// ── 🔤 TYPE SCALE ────────────────────────────────────────────────────────────────────────────────
test('🔤 one base size + one ratio derives the heading hierarchy', () => {
  const css = compileThemeCss({ name: 't', 'gd-font-size': '19px', 'type-scale': '1.25' });
  assert.match(css, /--gd-h3: 23\.8px;/);   // 19 × 1.25
  assert.match(css, /--gd-h2: 29\.7px;/);   // 19 × 1.25²
  assert.match(css, /--gd-h1: 37\.1px;/);   // 19 × 1.25³
  assert.match(compileThemeCss({ name: 't', 'gd-font-size': '1rem', 'type-scale': '1.5' }), /--gd-h1: 3\.4rem;/, 'the unit is carried, not assumed to be px');
});

test('🔤 an explicitly set step overrides the derived one', () => {
  const css = compileThemeCss({ name: 't', 'gd-font-size': '19px', 'type-scale': '1.25', 'gd-h1': '44px' });
  assert.match(css, /--gd-h1: 44px;/);
  assert.match(css, /--gd-h2: 29\.7px;/, 'the steps you did not override stay derived');
});

test('🔤 an unusable ratio derives NOTHING (base keeps its own fluid sizes)', () => {
  for (const bad of ['9', '0.5', 'big', '']) {
    assert.doesNotMatch(compileThemeCss({ name: 't', 'gd-font-size': '19px', 'type-scale': bad }), /--gd-h1:/, `ratio ${JSON.stringify(bad)} must not derive`);
  }
  assert.doesNotMatch(compileThemeCss({ name: 't', 'type-scale': '1.25' }), /--gd-h1:/, 'a ratio with no base size has nothing to scale');
  assert.doesNotMatch(compileThemeCss({ name: 't', 'gd-font-size': 'clamp(1rem, 2vw, 2rem)', 'type-scale': '1.25' }), /--gd-h1:/, 'a non-length base size is not arithmetic');
});

// ── announce: link, deadline, off switch (tile#192 reads the three flat keys) ────────────────────
test('a string announce compiles to exactly one key; link/deadline ride along; off omits all three', () => {
  assert.deepEqual(compileTheme({ name: 'warm', announce: 'New series soon' }).siteMeta, { theme: 'warm', announce: 'New series soon' });
  const until = '2026-12-01T23:59:00+08:00';
  assert.deepEqual(compileTheme({ name: 'warm', announce: 'Sale', 'announce-href': '/sale', 'announce-until': until }).siteMeta,
    { theme: 'warm', announce: 'Sale', 'announce-href': '/sale', 'announce-until': until });
  assert.deepEqual(compileTheme({ name: 'warm', announce: 'Sale', 'announce-href': '/sale', 'announce-off': 'true' }).siteMeta,
    { theme: 'warm' }, 'off: none of the three reach _site.md');
  assert.deepEqual(compileTheme({ name: 'warm', 'announce-href': '/sale' }).siteMeta, { theme: 'warm' },
    'a link with no text announces nothing');
});
