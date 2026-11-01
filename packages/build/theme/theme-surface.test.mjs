// Themes paint SURFACES with `--gd-band` (tile#200), so a solid surface is a full-width band.
// `surface-<name>` in `_theme.md` compiles to `[data-surface="<name>"] { --gd-band: <colour>; }`
// and it takes ONLY a solid hex colour: a gradient or image surface stays in custom CSS as
// `[data-surface="<name>"] { background: … }`, boxed. Never at `:root` (every surface would band in
// one colour). The zero-drift half reads the renderer's own site.css from this repo, so the property
// this compiler writes and the property the renderer reads can never drift apart silently.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

import { compileThemeCss, compileTheme } from './theme-compile.js';
import {
  surfaceOf, surfaceKeysOf, structuralIssues, serializeThemeDoc, parseThemeDoc, unsafeReason, scopeReason,
  sanitizeThemeMeta, describeThemeGrammar, surfaceNotHex, SURFACE_HEX_REASON,
} from './theme-schema.js';

const SITE_CSS = fs.readFileSync(new URL('../../sitetile/astro/src/styles/site.css', import.meta.url), 'utf8');

const BASE = { name: 'warm', 'gd-bg': '#fff7f2', 'gd-text': '#2b2320' };
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const surfaceLines = (css) => css.split('\n').filter((l) => l.includes('[data-surface='));

// ── ZERO DRIFT: what the compiler writes is what the renderer reads ────────────────────────────────

/** The base rules that READ `--gd-band`: `{ selector, body }` for each, comments stripped. */
function bandReaders() {
  const css = stripComments(SITE_CSS);
  return [...css.matchAll(/([^{}]*)\{([^{}]*var\(\s*--gd-band\b[^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2].trim() }));
}

test('ZERO DRIFT: base site.css reads --gd-band exactly once, on section[data-surface], as a border-image band', () => {
  const readers = bandReaders();
  assert.equal(readers.length, 1, `expected one --gd-band reader, found ${JSON.stringify(readers)}`);
  const [r] = readers;
  assert.match(r.selector, /section\[data-surface\]/, 'the band is keyed on the same attribute the compiler targets');
  assert.match(r.selector, /^:where\(/, 'zero specificity, so a theme rule always wins');
  assert.match(r.body, /border-image:\s*linear-gradient\(var\(--gd-band\) 0 0\) fill/, 'one-colour fill: why a gradient must NOT go into --gd-band');
});

test('ZERO DRIFT: base site.css never defines --gd-band (no :root default to disarm the box fallback)', () => {
  assert.doesNotMatch(stripComments(SITE_CSS), /--gd-band\s*:/);
});

test('ZERO DRIFT: the compiled surface rule sets the property, on the attribute, the base rule reads', () => {
  const css = compileThemeCss({ ...BASE, 'surface-cream': '#f3e9dc' });
  const [line] = surfaceLines(css);
  const sel = /^(.*?)\s*\{/.exec(line)[1];
  assert.equal(sel, '[data-surface="cream"]');
  const reads = /var\(\s*(--[a-z-]+)/.exec(bandReaders()[0].body)[1];
  assert.match(line, new RegExp(`\\{ ${reads}: #f3e9dc; \\}`), `compiler writes ${line}, renderer reads ${reads}`);
  // the base selector matches a section carrying data-surface="cream": same attribute name
  assert.ok(bandReaders()[0].selector.includes(`[${/\[([a-z-]+)=/.exec(sel)[1]}]`));
});

// ── compiler ───────────────────────────────────────────────────────────────────────────────────────

test('a hex colour → --gd-band; nothing else compiles (defensive), and nothing sets background', () => {
  const css = compileThemeCss({
    ...BASE,
    'surface-paper': 'rgb(250, 250, 250)', 'surface-cream': '#f3e9dc', 'surface-teal': 'teal',
    'surface-alias': 'var(--gd-bg)', 'surface-hero': 'linear-gradient(90deg, #fff, #f3e9dc)', 'surface-banana': 'rgb(banana)',
    'surface-miss': 'var(--missing, 25%)', 'surface-hsl': 'hsl(blue)', 'surface-short': '#fff', 'surface-alpha': '#ffffff80',
    'surface-glow': 'radial-gradient(circle, #fff, #eee)', 'surface-glow@dark': '#000000',
  });
  assert.deepEqual(surfaceLines(css), [
    '[data-surface="alpha"] { --gd-band: #ffffff80; }',
    '[data-surface="cream"] { --gd-band: #f3e9dc; }',
    'html[data-theme="dark"] [data-surface="glow"] { --gd-band: #000000; }',
    '[data-surface="short"] { --gd-band: #fff; }',
  ]);
  assert.doesNotMatch(css, /gradient|background|banana|missing|hsl|teal|rgb/);
});

test('surfaces stay off :root and sit between the token blocks and the custom CSS', () => {
  const css = compileThemeCss({ ...BASE, 'surface-cream': '#f3e9dc', 'gd-bg@dark': '#111111' }, '[data-surface="cream"] h2 { color: red; }');
  for (const block of css.matchAll(/:root \{([^}]*)\}/g)) assert.doesNotMatch(block[1], /gd-band|surface/);
  const at = (s) => css.indexOf(s);
  assert.ok(at('html[data-theme="dark"]:root {') < at('[data-surface="cream"] { --gd-band'), 'after the dark token block');
  assert.ok(at('[data-surface="cream"] { --gd-band') < at('reef:has-custom-css'), 'before the owner CSS, so theirs wins ties');
});

test('dark surfaces: one --gd-band rule per scheme', () => {
  const same = compileThemeCss({ ...BASE, 'surface-cream': '#f3e9dc', 'surface-cream@dark': '#2a2018' });
  assert.deepEqual(surfaceLines(same), [
    '[data-surface="cream"] { --gd-band: #f3e9dc; }',
    'html[data-theme="dark"] [data-surface="cream"] { --gd-band: #2a2018; }',
  ]);
  const darkOnly = compileThemeCss({ ...BASE, 'surface-night@dark': '#000000' });
  assert.deepEqual(surfaceLines(darkOnly), ['html[data-theme="dark"] [data-surface="night"] { --gd-band: #000000; }']);
});

test('deterministic: key order in, byte-identical out', () => {
  const a = compileThemeCss({ ...BASE, 'surface-b': '#222222', 'surface-a@dark': '#333333', 'surface-a': '#111111' });
  const b = compileThemeCss({ 'surface-a': '#111111', 'surface-b': '#222222', ...BASE, 'surface-a@dark': '#333333' });
  assert.equal(a, b);
  assert.deepEqual(surfaceKeysOf({ 'surface-b': 1, x: 1, 'surface-a@dark': 1, 'surface-a': 1 }), ['surface-a', 'surface-a@dark', 'surface-b']);
});

test('a theme with no surface keys compiles byte-identically to one that never heard of surfaces', () => {
  const css = compileThemeCss(BASE);
  assert.equal(surfaceLines(css).length, 0);
  assert.equal(css, ['/* Compiled from ir/_theme.md — do not hand-edit. Theme: warm. */', 'html:root {', '  --gd-bg: #fff7f2;', '  --gd-text: #2b2320;', '}', ''].join('\n'));
});

test('unsafe surface values are dropped by compileTheme, never interpolated', () => {
  const { css } = compileTheme({ ...BASE, 'surface-x': '#fff; } body { display: none', 'surface-y': 'url(/a.png)', 'surface-ok': '#abcdef' });
  assert.deepEqual(surfaceLines(css), ['[data-surface="ok"] { --gd-band: #abcdef; }']);
  assert.doesNotMatch(css, /display: none|url\(/);
  assert.match(unsafeReason('surface-x', '#fff; }'), /CSS-structural/);
  assert.match(unsafeReason('surface-x@dark', 'url(a)'), /CSS-structural/);
});

// ── schema ─────────────────────────────────────────────────────────────────────────────────────────

test('surfaceOf: the key family, and what is NOT in it', () => {
  assert.deepEqual(surfaceOf('surface-cream'), { name: 'cream', dark: false });
  assert.deepEqual(surfaceOf('surface-creamtrial@dark'), { name: 'creamtrial', dark: true });
  assert.deepEqual(surfaceOf('surface-Card_2'), { name: 'Card_2', dark: false });
  for (const k of ['surface-', 'surface-"x"', 'surface-a b', 'surface-x]', 'gd-surface', 'surfacecream', 'surface--x']) {
    assert.equal(surfaceOf(k), null, k);
  }
});

test('structuralIssues accepts surface keys and still rejects a malformed one', () => {
  assert.deepEqual(structuralIssues({ name: 'x', 'surface-cream': '#fff', 'surface-cream@dark': '#000' }), []);
  assert.deepEqual(structuralIssues({ name: 'x', 'surface-"]{': '#fff' }).map((i) => i.problem.slice(0, 17)), ['unknown theme key']);
});

test('serialize → parse round-trips surface keys in canonical order', () => {
  const meta = { name: 'x', 'surface-b': '#222222', 'gd-bg': '#ffffff', 'surface-a@dark': '#000000', 'surface-a': '#111111' };
  const md = serializeThemeDoc(meta);
  assert.deepEqual(parseThemeDoc(md).meta, { name: 'x', 'gd-bg': '#ffffff', 'surface-a': '#111111', 'surface-a@dark': '#000000', 'surface-b': '#222222' });
  assert.ok(md.indexOf('surface-a:') < md.indexOf('surface-a@dark:') && md.indexOf('surface-a@dark:') < md.indexOf('surface-b:'));
});

test('gd-band at the site level is a SCOPE drop that names the surface key', () => {
  assert.equal(scopeReason('gd-bg'), null);
  assert.equal(scopeReason('surface-cream'), null);
  for (const [k, suffix] of [['gd-band', ''], ['gd-band@dark', '@dark']]) {
    const why = scopeReason(k);
    assert.ok(why.includes(`surface-<name>${suffix}`), why);
    assert.doesNotMatch(why, /unsafe|custom CSS|:root/i, `name the scope in owner-followable terms: ${why}`);
    assert.equal(unsafeReason(k, '#f3e9dc'), why, 'the writer drops it for the same reason it reports');
  }
  const { dropped } = sanitizeThemeMeta({ 'gd-band': '#f3e9dc', 'gd-font': 'a;b' });
  assert.deepEqual(dropped.map((d) => [d.key, d.kind]), [['gd-band', 'scope'], ['gd-font', 'unsafe']]);
});

test('surfaceNotHex: exactly #rgb, #rgba, #rrggbb, #rrggbbaa', () => {
  for (const v of ['#fff', '#FfFf', '#f3e9dc', '#F3E9DC80']) assert.equal(surfaceNotHex(v), false, v);
  for (const v of ['', 'fff', '#ff', '#fffff', '#fffffff', '#fffffffff', '#ggg', ' #fff', '#fff ', '#fff\n', '#fff;', 'rgb(banana)', 'red', 'var(--gd-bg)', null, undefined, 123]) {
    assert.equal(surfaceNotHex(v), true, JSON.stringify(v));
  }
  assert.equal(SURFACE_HEX_REASON, 'surface colours are hex (#rrggbb); other colours, gradients or images stay in custom CSS');
});

test('describeThemeGrammar teaches the surface keys', () => {
  const g = describeThemeGrammar();
  assert.match(g.surfaces.key, /surface-<name>/);
  assert.match(g.surfaces.solid, /full width/);
  assert.ok(g.surfaces.solid.includes('#rrggbb') && !/rgb\(|var\(|colour name/.test(g.surfaces.solid), g.surfaces.solid);
  assert.match(g.surfaces.gradient, /custom CSS/);
  assert.ok(g.surfaces.gradient.includes('[data-surface="<name>"] { background: … }'), g.surfaces.gradient);
  // the worked example is itself a legal, safe, compiling surface
  const example = Object.fromEntries([g.surfaces.example.split(': ')]);
  assert.deepEqual(structuralIssues({ name: 'x', ...example }), []);
  for (const [k, v] of Object.entries(example)) assert.equal(unsafeReason(k, v), null, `${k}: ${v}`);
  assert.equal(surfaceLines(compileThemeCss({ name: 'x', ...example })).length, 1, 'and it compiles to one band rule');
});

// ── a surface value is ONE value, closed, with nothing after it ───────────────────────────────────

test('an unclosed or trailing surface value is unsafe, dropped, and the rules after it still compile', () => {
  for (const k of ['surface-a', 'surface-a@dark']) {
    for (const bad of ['linear-gradient(red, blue', 'rgb(1, 2, 3))', 'rgb("1, 2, 3)', 'linear-gradient(red, blue) nonsense', 'rgb(1,2,3) x']) {
      assert.match(String(unsafeReason(k, bad)), /not one value/, `${k}: ${bad}`);
    }
  }
  const { css } = compileTheme({ ...BASE, 'surface-a': 'linear-gradient(red, blue', 'surface-a@dark': 'radial-gradient(#000, #111', 'surface-z': '#00ff00' }, '.sentinel { color: rgb(255,0,0); }');
  assert.deepEqual(surfaceLines(css), ['[data-surface="z"] { --gd-band: #00ff00; }']);
  assert.match(css, /\.sentinel \{ color: rgb\(255,0,0\); \}/);
  assert.doesNotMatch(css, /linear-gradient\(red|radial-gradient\(#000/);
});
