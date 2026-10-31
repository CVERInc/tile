#!/usr/bin/env node
// Compile a site's structured theme, `ir/_theme.md`, into the two things the renderer reads:
//
//   1. theme.css — the file you hand the build as `--theme`
//   2. a few `_site.md` keys (theme:, fonts:, announce…, the treatment switches) — the renderer
//      reads those from the site's config, not from the stylesheet
//
//     node engine/packages/build/theme/cli.mjs ./ir/_theme.md ./theme.css
//
// theme.css is written; the `_site.md` keys are printed on stdout, one `key: value` per line, so
// they can be pasted (or piped) into the site's own `_site.md`. Nothing here edits `_site.md` for
// you: it is the site's file, and what else is in it is not this compiler's business.
//
// 🩸 EXIT 0 MEANS "THE THEME YOU WROTE IS THE THEME YOU GOT". The library is forgiving on purpose —
// an editor that already told its author what it dropped wants a compile, not a refusal — and the
// first version of this CLI inherited that: `card: glassy`, `surface-sand: rgb(banana)` and even
// `name: ../oops` all exited 0 with a success line, while the card look, the band and the theme's
// NAME (the one thing the build looks the stylesheet up by) silently went missing. A person at a
// terminal has no editor between them and that silence, so here every drop is named — key, value,
// reason — and refused unless they say `--allow-dropped`.
//
// 🔴 The drops are found by reading the OUTPUT, not by restating the compiler's rules: a key the
// author set that did not arrive in theme.css or the printed keys was dropped, whatever the reason.
// A second copy of "which values are legal" here would be a second thing to keep in step.

import { readFileSync, writeFileSync } from 'node:fs';
import { compileTheme, THEME_SITE_KEYS } from './theme-compile.js';
import {
  parseThemeDoc, residueOf, structuralIssues, sanitizeThemeMeta, unsafeReason,
  TOKENS, TREATMENTS, TYPE_SCALE_RANGE, SURFACE_HEX_REASON, surfaceOf, darkStemOf,
} from './theme-schema.js';
import { truncateCssText } from './css-text.js';

const USAGE = `usage: node packages/build/theme/cli.mjs <_theme.md> [theme.css] [--allow-dropped]

  Writes the compiled stylesheet to [theme.css] (default: ./theme.css) and prints the _site.md
  keys this theme owns on stdout. Put them in your _site.md: the build looks the stylesheet up
  by the theme: name, and reads fonts / announce / the treatment switches from there.

  --allow-dropped   compile even when some values would be dropped (each is still listed)

exit: 0 compiled · 2 refused, nothing written (no frontmatter, an unusable name, or a dropped
      value without --allow-dropped — the message says which)
`;

const args = process.argv.slice(2);
const allowDropped = args.includes('--allow-dropped');
const positional = args.filter((a) => a !== '--allow-dropped');
const [src, out = 'theme.css', ...rest] = positional;
if (!src || rest.length || positional.some((a) => a.startsWith('-'))) { console.error(USAGE); process.exit(2); }

let md;
try { md = readFileSync(src, 'utf8'); } catch (e) { console.error(`✗ cannot read ${src}: ${e.code ?? e.message}`); process.exit(2); }

const doc = parseThemeDoc(md);
const issues = structuralIssues(doc && doc.meta);
const show = (v) => JSON.stringify(truncateCssText(String(v)));

// A missing frontmatter or name is a refusal: the build stages theme.css under the theme's NAME,
// so a nameless theme compiles to a file nothing will ever look up. A name the compiler would DROP
// (`../oops`, a space, `*/`) is the same refusal — it ends as `theme: ` with nothing after it.
const fatal = issues.filter((i) => i.key === '(doc)' || i.key === 'name');
if (!fatal.length) {
  const why = unsafeReason('name', doc.meta.name);
  if (why) fatal.push({ key: 'name', problem: `${show(String(doc.meta.name).trim())} ${why}` });
}
if (fatal.length) {
  for (const i of fatal) console.error(`✗ ${src}: ${i.key} — ${i.problem}`);
  process.exit(2);
}

const { css, siteMeta } = compileTheme(doc.meta, residueOf(doc.body));
const meta = doc.meta;
const set = (k) => meta[k] != null && String(meta[k]).trim() !== '';

// ── what was asked for and did not arrive ──────────────────────────────────────────────────────
const dropped = [];   // { key, value, reason }
const seen = new Set();
const drop = (key, reason) => { if (!seen.has(key)) { seen.add(key); dropped.push({ key, value: meta[key], reason }); } };
for (const i of issues) if (/^unknown theme key/.test(i.problem)) drop(i.key, 'not a key this vocabulary has (a typo?) — see TOKENS, TREATMENTS and META_KEYS in theme-schema.js');
for (const d of sanitizeThemeMeta(meta).dropped) drop(d.key, `${d.kind}: ${d.problem}`);
const stems = new Set(TOKENS.map((t) => t.stem));
for (const k of Object.keys(meta)) {
  if (seen.has(k) || !set(k)) continue;
  const v = String(meta[k]).trim();
  const stem = stems.has(k) ? k : darkStemOf(k);
  const surface = surfaceOf(k);
  const treatment = TREATMENTS.find((t) => t.key === k);
  if (stem && !css.includes(`--${stem}: ${v};`)) drop(k, 'not written to theme.css');
  else if (surface && !css.includes(`[data-surface="${surface.name}"] { --gd-band: ${v}; }`)) drop(k, SURFACE_HEX_REASON);
  else if (treatment && v !== treatment.default && siteMeta[k] !== v) drop(k, `not one of ${treatment.values.join(', ')}`);
}
// type-scale is not emitted itself; it is visible only through the heading steps it derives.
if (set('type-scale') && !seen.has('type-scale')) {
  const derived = ['gd-h3', 'gd-h2', 'gd-h1'].some((h) => !set(h) && css.includes(`--${h}: `));
  const wouldShow = ['gd-h3', 'gd-h2', 'gd-h1'].some((h) => !set(h));
  if (wouldShow && !derived) drop('type-scale', `derives nothing: needs a ratio between ${TYPE_SCALE_RANGE[0]} and ${TYPE_SCALE_RANGE[1]} and gd-font-size as a plain length (px, rem, em, pt)`);
}

for (const i of issues) if (!/^unknown theme key/.test(i.problem)) console.error(`⚠ ${src}: ${i.key} — ${i.problem}`);
const mark = allowDropped ? '⚠' : '✗';
for (const d of dropped) console.error(`${mark} ${d.key}: ${show(d.value)} dropped — ${d.reason}`);
if (dropped.length && !allowDropped) {
  console.error(`✗ ${src}: ${dropped.length} value(s) above would be dropped, so nothing was written. Fix them, or pass --allow-dropped to compile without them.`);
  process.exit(2);
}

writeFileSync(out, css);

// Every key the theme OWNS, in a fixed order. A key the theme does not set is not printed — and if
// your _site.md still carries it from an earlier theme, delete it there: the theme is its source.
for (const k of THEME_SITE_KEYS) if (siteMeta[k] != null) console.log(`${k}: ${siteMeta[k]}`);
console.error(`✓ wrote ${out} — the keys above belong in _site.md (theme-owned: ${THEME_SITE_KEYS.join(', ')})`);
