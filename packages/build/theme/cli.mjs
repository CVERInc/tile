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

import { readFileSync, writeFileSync } from 'node:fs';
import { compileTheme, THEME_SITE_KEYS } from './theme-compile.js';
import { parseThemeDoc, residueOf, structuralIssues, sanitizeThemeMeta } from './theme-schema.js';

const USAGE = `usage: node packages/build/theme/cli.mjs <_theme.md> [theme.css]

  Writes the compiled stylesheet to [theme.css] (default: ./theme.css) and prints the _site.md
  keys this theme owns on stdout. Put them in your _site.md: the build looks the stylesheet up
  by the theme: name, and reads fonts / announce / the treatment switches from there.

exit: 0 compiled · 2 refused (no frontmatter, no name — the message says which)
`;

const [src, out = 'theme.css', ...rest] = process.argv.slice(2);
if (!src || rest.length || src.startsWith('-')) { console.error(USAGE); process.exit(2); }

let md;
try { md = readFileSync(src, 'utf8'); } catch (e) { console.error(`✗ cannot read ${src}: ${e.code ?? e.message}`); process.exit(2); }

const doc = parseThemeDoc(md);
const issues = structuralIssues(doc && doc.meta);
// A missing frontmatter or name is a refusal: the build stages theme.css under the theme's NAME,
// so a nameless theme compiles to a file nothing will ever look up. Everything else structural (an
// unknown key, an empty value) is reported and compiled around — the compiler ignores what it does
// not know, which is the same answer the renderer would give.
const fatal = issues.filter((i) => i.key === '(doc)' || i.key === 'name');
if (fatal.length) {
  for (const i of fatal) console.error(`✗ ${src}: ${i.key} — ${i.problem}`);
  process.exit(2);
}
for (const i of issues) console.error(`⚠ ${src}: ${i.key} — ${i.problem}`);
for (const d of sanitizeThemeMeta(doc.meta).dropped) console.error(`⚠ ${src}: ${d.key} dropped (${d.kind}) — ${d.problem}`);

const { css, siteMeta } = compileTheme(doc.meta, residueOf(doc.body));
writeFileSync(out, css);

// Every key the theme OWNS, in a fixed order. A key the theme does not set is not printed — and if
// your _site.md still carries it from an earlier theme, delete it there: the theme is its source.
for (const k of THEME_SITE_KEYS) if (siteMeta[k] != null) console.log(`${k}: ${siteMeta[k]}`);
console.error(`✓ wrote ${out} — the keys above belong in _site.md (theme-owned: ${THEME_SITE_KEYS.join(', ')})`);
