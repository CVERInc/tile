// theme-schema — the structured `ir/_theme.md` vocabulary must never drift from the renderer's
// actual tokens. The load-bearing test is the ZERO-DRIFT cross-check against the renderer's own
// site.css, read from this repo by path: if the renderer adds/removes/renames a `--gd-*` token, this
// fails loud instead of silently shipping a schema that lets an author set a token the renderer
// ignores (or omits one it needs). The schema and the stylesheet now live in ONE repo, so a commit
// that changes either one runs this against the other.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  TOKENS, META_KEYS, THEME_KEYS, TREATMENTS,
  parseThemeDoc, serializeThemeDoc, structuralIssues, parseCssTokens,
} from './theme-schema.js';
import { CSS_TEXT_ECHO_MAX_CHARS } from './css-text.js';

const SITE_CSS_PATH = fileURLToPath(new URL('../../sitetile/astro/src/styles/site.css', import.meta.url));
const SITE_LAYOUT = fileURLToPath(new URL('../../sitetile/astro/src/layouts/SiteLayout.astro', import.meta.url));
const SITE_CSS = fs.readFileSync(SITE_CSS_PATH, 'utf8');

const stems = (group) => TOKENS.filter((t) => !group || t.group === group).map((t) => t.stem).sort();

test('the renderer sources the zero-drift checks read are here, and not empty', () => {
  assert.ok(SITE_CSS.length > 10_000, `site.css is ${SITE_CSS.length} chars — did it move?`);
  assert.ok(fs.existsSync(SITE_LAYOUT), 'SiteLayout.astro is not where this test reads it');
});

test('ZERO DRIFT: Group A stems === the tokens site.css actually defaults, both directions', () => {
  const { defined } = parseCssTokens(SITE_CSS);
  const cssDefined = [...defined.keys()].sort();
  assert.deepEqual(stems('A'), cssDefined,
    'Group A must be exactly the --gd-*/--st- tokens with a :root default — renderer drift or a schema typo');
});

test('ZERO DRIFT: Group B stems === referenced-only tokens (referenced minus defined)', () => {
  const { defined, referenced } = parseCssTokens(SITE_CSS);
  const referencedOnly = [...referenced].filter((s) => !defined.has(s)).sort();
  assert.deepEqual(stems('B'), referencedOnly,
    'Group B must be exactly the tokens site.css uses via var() but never defaults');
});

test('every declared token is actually referenced somewhere in the renderer (no dead vocabulary)', () => {
  const { defined, referenced } = parseCssTokens(SITE_CSS);
  const known = new Set([...defined.keys(), ...referenced]);
  for (const t of TOKENS) assert.ok(known.has(t.stem), `${t.stem} is in the schema but nowhere in site.css`);
});

test('Group A defaults match site.css verbatim; Group B carry no default', () => {
  const { defined } = parseCssTokens(SITE_CSS);
  for (const t of TOKENS) {
    if (t.group === 'A') assert.equal(t.default, defined.get(t.stem), `${t.stem} default drifted from site.css`);
    else assert.equal(t.default, undefined, `${t.stem} is Group B (referenced-only) and must not claim a default`);
  }
});

test('parse → serialize → parse round-trips a theme doc', () => {
  const src = [
    '---',
    'name: warmreef',
    'gd-bg: #fff7f2',
    'gd-accent: #ff5d61',
    'gd-font: "Fraunces", serif',
    'fonts: https://fonts.example/x.css',
    'announce: New series soon',
    '---',
    '',
  ].join('\n');
  const first = parseThemeDoc(src);
  assert.equal(first.meta.name, 'warmreef');
  assert.equal(first.meta['gd-accent'], '#ff5d61');
  // a font stack that opens with a quoted family stays intact (not treated as a fully-wrapped scalar)
  assert.equal(first.meta['gd-font'], '"Fraunces", serif');
  const round = parseThemeDoc(serializeThemeDoc(first.meta));
  assert.deepEqual(round.meta, first.meta, 'round-trip must preserve every key/value');
});

test('serialize is deterministic and canonically ordered (name → tokens → meta)', () => {
  const meta = { announce: 'hi', 'gd-accent': '#ff5d61', name: 'x', 'gd-bg': '#fff' };
  const out = serializeThemeDoc(meta);
  assert.equal(out, serializeThemeDoc(meta), 'same object → byte-identical output');
  const order = out.split('\n').filter((l) => l.includes(':')).map((l) => l.split(':')[0]);
  assert.deepEqual(order, ['name', 'gd-bg', 'gd-accent', 'announce'], 'name first, then tokens in TOKENS order, then meta');
});

test('structuralIssues: clean doc → none', () => {
  assert.deepEqual(structuralIssues({ name: 'x', 'gd-bg': '#fff' }), []);
});

test('structuralIssues: missing name, unknown key, empty value each flagged', () => {
  const issues = structuralIssues({ 'gd-bg': '#fff', 'gd-bogus': '#000', 'gd-text': '' });
  const keys = issues.map((i) => i.key);
  assert.ok(keys.includes('name'), 'missing name flagged');
  assert.ok(keys.includes('gd-bogus'), 'unknown key flagged');
  assert.ok(keys.includes('gd-text'), 'empty value flagged');
});

test('structuralIssues: no frontmatter → single (doc) issue', () => {
  const issues = structuralIssues(null);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].key, '(doc)');
});

test('META_KEYS, token stems and treatment keys are disjoint (no key means two things)', () => {
  const tokenStems = new Set(TOKENS.map((t) => t.stem));
  const treatmentKeys = new Set(TREATMENTS.map((t) => t.key));
  for (const k of META_KEYS) assert.ok(!tokenStems.has(k) && !treatmentKeys.has(k), `${k} collides`);
  for (const t of TREATMENTS) assert.ok(!tokenStems.has(t.key), `${t.key} is both a treatment and a token`);
  assert.equal(THEME_KEYS.size, TOKENS.length + META_KEYS.length + TREATMENTS.length, 'THEME_KEYS is the disjoint union');
});

// ── TREATMENT AXES ↔ site.css (the zero-drift twin of the token cross-check) ───────────────────────
test('ZERO DRIFT: every treatment non-default value has a matching body[data-…] switch in site.css', () => {
  // The schema must never offer a treatment value the renderer can't honour. For each axis, every value
  // EXCEPT its default (the absent state, which needs no rule) must appear as a `body[data-attr="value"]`
  // selector — or, for a presence-based bool, as `body[data-attr]`. If site.css drops a switch or
  // the schema adds an unsupported value, this fails loud instead of silently compiling a dead attr.
  const css = SITE_CSS;
  for (const t of TREATMENTS) {
    for (const v of t.values) {
      if (v === t.default) continue; // default = absent state, no rule expected
      const sel = t.bool ? `body[${t.attr}]` : `body[${t.attr}="${v}"]`;
      assert.ok(css.includes(sel), `site.css is missing the switch \`${sel}\` for ${t.key}: ${v}`);
    }
  }
});

test('ZERO DRIFT: SiteLayout stamps every treatment attribute on <body>', () => {
  // The render side must consume what the compiler emits. SiteLayout has to stamp each axis's
  // data-attribute, else a compiled treatment silently never reaches the DOM. Pins the third mirror
  // (schema ↔ site.css switch ↔ SiteLayout stamp) so none can drift unnoticed.
  const layout = fs.readFileSync(SITE_LAYOUT, 'utf8');
  for (const t of TREATMENTS) {
    assert.match(layout, new RegExp(t.attr + '='), `SiteLayout does not stamp ${t.attr} (${t.key})`);
  }
  // tile#192 moved the guard to announceModel's mode and added an optional link. Pin that guard,
  // both branches and the guard: `{false && ...}` or an unlinked `: null` must fail.
  const announceBand = /\{announceM\.mode\s*===\s*'band'\s*&&\s*\(announceM\.href\s*\?\s*<div class="rf-announce"[\s\S]*?:\s*<div class="rf-announce"/;
  assert.match(layout, announceBand,
    'the announce band must render when announceModel selects band mode');
  const withoutUnlinkedBand = layout.replace(': <div class="rf-announce" role="note">{announceM.text}</div>', ': null');
  assert.notEqual(withoutUnlinkedBand, layout, 'the unlinked band mutation must change the renderer');
  assert.doesNotMatch(withoutUnlinkedBand, announceBand,
    'replacing the unlinked announce band with : null must fail the guard');
});

test('ZERO DRIFT (reverse): site.css offers no body[data-…] switch the schema forgot to declare', () => {
  // The forward test asks "does the renderer honour what the schema claims". This asks the OTHER
  // direction — deleting a whole axis from TREATMENTS used to leave every test green, because each
  // one only ever walked the schema's own array. Any body[data-…] selector in site.css must be
  // either a declared treatment value or a KNOWN non-treatment attribute; anything else fails loud.
  const css = SITE_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  // attributes the renderer stamps for reasons OTHER than a theme treatment
  const NON_TREATMENT = new Set([
    'data-page', 'data-nav-mobile', 'data-ha-sidebar', 'data-theme', 'data-theme-custom',
    'data-age-confirmed', 'data-lingo-open',
  ]);
  const declared = new Set();
  for (const t of TREATMENTS) {
    for (const v of t.values) declared.add(t.bool ? t.attr : `${t.attr}="${v}"`);
    if (t.bool) declared.add(t.attr);
  }
  const found = new Set();
  for (const m of css.matchAll(/body\[(data-[a-z-]+)(?:="([^"]*)")?\]/g)) {
    if (NON_TREATMENT.has(m[1])) continue;
    found.add(m[2] === undefined ? m[1] : `${m[1]}="${m[2]}"`);
  }
  for (const sel of found) {
    assert.ok(declared.has(sel), `site.css styles body[${sel}] but no TREATMENT declares it — the schema is missing an axis (or a value), so an author can never reach this switch`);
  }
});

test('🔴 every BORN PAINT rule is gated so it cannot out-specify a hand-rolled theme', () => {
  // Born paint styles DOM that a site's OWN theme.css already styles its way — and a base selector
  // carrying an attribute (`.st-hero[data-layout="split"]`, 0,2,0) BEATS a theme's `html .st-hero`
  // (0,1,1), while `.rf-foot*` is DOM no live theme styles at all. Ungated, that silently rewrote
  // one live site's hero band and another's footer. The gate `:where(body:not([data-theme-custom]))` adds
  // ZERO specificity, so a born site is unaffected — but it must be on EVERY rule in the section.
  const css = SITE_CSS;
  const start = css.indexOf('── (b) BORN PAINT'); // the section DIVIDER, not the overview's mention of it
  assert.ok(start > 0, 'the BORN PAINT section divider is gone — did the section move?');
  // 🩸 This used to scan from the divider to END OF FILE, which quietly meant "born paint is
  // whatever happens to be last". Adding `@layer reef.responsive` after reef.base's closing brace
  // put six state-machine rules inside the scan and failed this — correctly by its own rule, and
  // wrongly by intent: reef.responsive exists precisely SO THAT it beats a hand-rolled theme, which
  // is the opposite of what the gate protects. The two cannot both apply to one region, so the
  // region is now bounded where it always meant to be — inside reef.base, where born paint lives.
  const baseOpen = css.indexOf('@layer reef.base {');
  let depth = 0, baseEnd = css.length;
  for (let i = baseOpen; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) { baseEnd = i; break; }
  }
  assert.ok(baseOpen > -1 && baseEnd > start, 'could not find the end of @layer reef.base');
  // 🔴 And the excluded tail is pinned, so "bounded" cannot quietly become "anything I append".
  // Without this, the fix above is indistinguishable from switching the gate off.
  //
  // 🩸 The first version of this pin was `/^@layer reef\.responsive \{[\s\S]*\}$/`, which is
  // satisfied by ANY tail that starts with the layer and ends with a brace — appending
  // `.stray { color: blue }` after it kept it green. Proven by doing exactly that. Brace-match the
  // block instead and require it to consume the whole tail.
  const tail = css.slice(baseEnd + 1).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const respOpen = tail.indexOf('@layer reef.responsive {');
  assert.equal(respOpen, 0, `the only thing after @layer reef.base must be reef.responsive — found: ${tail.slice(0, 120)}`);
  let rd = 0, respEnd = -1;
  for (let i = tail.indexOf('{'); i < tail.length; i++) {
    if (tail[i] === '{') rd++;
    else if (tail[i] === '}' && --rd === 0) { respEnd = i; break; }
  }
  assert.ok(respEnd > -1, 'the reef.responsive block never closes');
  assert.equal(tail.slice(respEnd + 1).trim(), '',
    `nothing may follow the reef.responsive block — found: ${tail.slice(respEnd + 1).trim().slice(0, 120)}`);
  // 🔴 The scan opens INSIDE the divider's comment (`start` is the divider text, not the `/*`), so
  // the whole-comment strip below cannot reach that first dangling `*/`. Cut it off explicitly —
  // once selectors are allowed to span lines, a leftover `… ─── */` glues itself to the first rule.
  const dividerEnd = css.indexOf('*/', start);
  assert.ok(dividerEnd > start && !css.slice(start, dividerEnd).includes('{'),
    'the BORN PAINT divider is expected to sit in a comment that closes before the first rule');
  const body = css.slice(dividerEnd + 2, baseEnd).replace(/\/\*[\s\S]*?\*\//g, '');
  const GATE = ':where(body:not([data-theme-custom]))';
  // 🔴 A CSS selector list is split on TOP-LEVEL commas only. A bare `.split(',')` cuts inside
  // `:is()` / `:where()` / `:not()` argument lists, so `… .st-item-head :where(h2, h3, h4)` —
  // one fully gated rule — arrived here as three fragments (`… :where(h2`, `h3`, `h4)`), two of
  // which cannot start with the gate because they are not selectors at all. That reported three
  // ungated rules where the renderer had none, and it fired the day the collection corals landed.
  const selectors = (list) => {
    const out = [];
    let depth = 0, buf = '';
    for (const ch of list) {
      if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
      buf += ch;
    }
    return [...out, buf];
  };
  // 🔴 And the rule scan reads a selector list ACROSS lines. The previous `[^{}\n]` form stopped at
  // the newline, so in a list written one selector per line only the LAST line was ever checked —
  // five such rules were half-scanned here, which is the guard reporting coverage it did not have.
  // Newlines are admitted in the list but NOT as its first character: `\s` is excluded there so a
  // `}`-then-newline start cannot swallow the `@media` that follows and, with it, the rule inside.
  const ungated = [];
  let scanned = 0;
  for (const m of body.matchAll(/(^|\n|\}|\{)\s*([^{}@\s][^{}]*?)\s*\{/g)) {
    const selectorList = m[2].trim();
    if (!selectorList || selectorList.startsWith('@')) continue;
    scanned += 1;
    for (const sel of selectors(selectorList)) {
      const one = sel.trim().replace(/\s+/g, ' ');
      if (!one.startsWith(GATE)) ungated.push(one);
    }
  }
  // An empty `ungated` is only worth reading if the scan reached the rules. A region that collapses
  // — the divider moves, the layer is renamed — otherwise reports a clean gate having read nothing.
  assert.ok(scanned > 0, 'the born-paint scan matched no rule at all — the region bounds are wrong');
  assert.deepEqual(ungated, [], `born-paint rules missing the ${GATE} gate — they would override a themed site's own CSS`);
});

test('🔴 SiteLayout stamps data-theme-custom for a HAND-ROLLED theme only (behaviour, not source text)', async () => {
  // The gate above is only real if the marker is stamped correctly. Evaluate SiteLayout's ACTUAL
  // derived-const expressions (the previous stamping test only regexed the source, which a mutation
  // proved is satisfiable by dead code).
  const layout = fs.readFileSync(SITE_LAYOUT, 'utf8');
  // evaluate the WHOLE derivation (it now leans on two helper consts) — a one-line regex would have
  // silently read `compiled`/`hasResidue` as undefined and still "passed".
  const block = /(const compiled = [\s\S]*?const customTheme = .+;)/.exec(layout);
  assert.ok(block, 'SiteLayout no longer derives customTheme the way this test reads it');
  const customTheme = (themeRaw) => new Function('themeRaw', `${block[1]}\nreturn customTheme;`)(themeRaw);
  assert.equal(customTheme(''), false, 'no theme at all → not custom');
  assert.equal(customTheme('/* Compiled from ir/_theme.md — do not hand-edit. Theme: warm. */\nhtml:root { --gd-bg: #fff; }'), false,
    'a COMPILED (token-only) theme is not custom — a born site still wants born paint');
  assert.equal(customTheme('html .st-hero { display: grid; }'), true, 'a hand-rolled theme IS custom');
  // 🔴 the load-bearing case: a COMPILED theme that still carries a residue block counts as custom.
  // That residue was written against base as it looked THEN, so born paint must stay off it — and it
  // is what lets a site convert to a structured theme with NO visual cliff, then graduate into born
  // paint automatically once its residue reaches zero. Proven on a real hand-rolled source: without
  // this, converting it moved /faq by 277px; with it, all four pages are 100% converged, both viewports.
  //
  // 🩸 This fixture used to hand-write the marker comment — a THIRD copy of a string two files
  // already had to agree on, and it kept this test green for whichever of them was stale. It is now
  // produced by the compiler itself, so the test cannot pass against a theme.css that is not the one
  // we actually emit.
  const { compileThemeCss } = await import('./theme-compile.js');
  const realCompiled = compileThemeCss({ name: 'pair', 'gd-bg': '#ffffff' }, 'html .st-hero { display: grid; }');
  assert.equal(customTheme(realCompiled), true, 'a compiled theme WITH residue is still custom');
  assert.equal(customTheme(compileThemeCss({ name: 'pair', 'gd-bg': '#ffffff' }, '')), false,
    'control: the same compiler output WITHOUT residue must not be custom');
});

test('🔴 header-sticky can never stamp a falsy value (behaviour, not source text)', () => {
  const layout = fs.readFileSync(SITE_LAYOUT, 'utf8');
  const line = /const tHeaderSticky = (.+);/.exec(layout);
  assert.ok(line, 'SiteLayout no longer derives tHeaderSticky');
  const sticky = (meta) => new Function('meta', `return (${line[1]});`)(meta);
  assert.equal(sticky({}), false, 'absent → no attribute');
  assert.equal(sticky({ 'header-sticky': 'false' }), false, 'a literal "false" must NOT stamp a presence attribute');
  assert.equal(sticky({ 'header-sticky': 'true' }), true);
});

test('🔴 the custom-CSS marker the COMPILER emits is the one SiteLayout greps for', async () => {
  // 🩸 This is the test that did not exist on 2026-08-01, when rewording one comment for humans
  // switched born-paint gating OFF for every site carrying custom CSS. Two files agreed on a
  // sentence; only one of them was edited. Nothing failed, nothing warned, and the whole visible
  // symptom on the first site checked was a single h2's line-height — found by a full-page
  // computed-style diff against production, which is not a thing anyone runs by reflex.
  //
  // The handshake is now a token, and this holds the two ends together.
  const { CUSTOM_CSS_MARKER, compileThemeCss } = await import('./theme-compile.js');
  const layout = fs.readFileSync(SITE_LAYOUT, 'utf8');

  // 1. the compiler emits it — and ONLY when there is custom CSS to mark
  const withCss = compileThemeCss({ name: 't', 'gd-bg': '#ffffff' }, '.a { color: red; }');
  const without = compileThemeCss({ name: 't', 'gd-bg': '#ffffff' }, '');
  assert.ok(withCss.includes(CUSTOM_CSS_MARKER), 'compiled theme.css must carry the marker');
  assert.ok(!without.includes(CUSTOM_CSS_MARKER), 'and must NOT when the theme is token-only');

  // 2. SiteLayout's detector actually matches that output — the regex is executed, not eyeballed.
  const m = /const hasResidue = (\/.*?\/)\.test\(themeRaw\)/.exec(layout);
  assert.ok(m, 'could not find hasResidue in SiteLayout — this test is now measuring nothing');
  const detector = new RegExp(m[1].slice(1, -1));
  assert.ok(detector.test(withCss), `SiteLayout's ${m[1]} does not match what the compiler emits`);
  assert.ok(!detector.test(without), 'and must not match a token-only theme');

  // 3. control: the marker must not be prose. A sentence is something someone will improve.
  assert.ok(!/\s/.test(CUSTOM_CSS_MARKER), 'the marker must be a single token, not a phrase');
});

test('🔴 structuralIssues truncates `key` — the backstop for a key already on disk', () => {
  const poisonKey = `gd-${'z'.repeat(1000)}`;
  const issues = structuralIssues({ name: 'x', [poisonKey]: 'value' });
  const row = issues.find((i) => i.key.startsWith('gd-z'));
  assert.ok(row, JSON.stringify(issues).slice(0, 200));
  assert.ok(row.key.length <= CSS_TEXT_ECHO_MAX_CHARS + 1, `key ${row.key.length} chars`);
  assert.ok(row.key.endsWith('…'), row.key);
});
