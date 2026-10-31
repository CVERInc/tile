// theme-compile.js — compile a structured `ir/_theme.md` into the two artifacts the renderer
// consumes. `cli.mjs` beside this file is the command-line door; see ../README.md.
//
// A structured theme splits into:
//   1. the site repo's `theme.css` — a `html:root { --gd-*: … }` token block. `html:root` (not
//      `:root`) because the theme is inlined and must beat the base site.css token defaults
//      regardless of source order (the same trick a hand-rolled theme uses). Then one
//      `[data-surface="<name>"]` rule per `surface-<name>` key (surfaceRules below).
//   2. a few `_site.md` frontmatter keys the renderer reads directly, NOT from theme.css:
//        - theme:    the theme name → `--theme <repo>/theme.css` staging + `theme:` lookup.
//        - fonts:    a webfont URL, emitted as preconnect + <link> (SiteLayout.astro:187) — the
//                    healthy path, never an @import inside the CSS (site.css:186).
//        - announce: the site-wide announcement string (data, not CSS), with its
//                    `announce-href` / `announce-until`; `announce-off` in the theme
//                    omits all three.
//
// PURE + DETERMINISTIC: the same meta always yields byte-identical output, so a visual-diff
// regression is meaningful and a recompile is a no-op when nothing changed. This module does
// NOT judge taste — it assumes a structurally-sound doc (structuralIssues). Anything unsafe to
// interpolate is dropped before a byte is written (sanitizeThemeMeta). The TOKEN layer emits
// theme.css; the TREATMENT layer emits body[data-…] frontmatter keys into siteMeta that SiteLayout
// stamps on <body>.

import { TOKENS, TREATMENTS, unsafeReason, sanitizeThemeMeta, darkStemOf, TYPE_SCALE_RANGE, surfaceOf, surfaceKeysOf, surfaceNotHex } from './theme-schema.js';

/** 🎨 The per-surface rules, one line each, light then dark per name (surfaceKeysOf).
 *  A solid colour becomes `--gd-band` (tile#200 carries it to the page edges and fills the box once).
 *  ONLY an exact hex colour — anything else on disk (rgb(banana), a var(), a gradient) is
 *  not compiled at all, defensively, whatever wrote it; that look lives in custom CSS as `[data-surface="<name>"] { background: … }`. Scoped to
 *  `[data-surface]`, never `:root`: a root `--gd-band` would band every surface. */
function surfaceRules(meta) {
  const out = [];
  for (const k of surfaceKeysOf(meta)) {
    const v = meta[k] != null ? String(meta[k]).trim() : '';
    if (surfaceNotHex(v)) continue; // hex cannot carry anything unsafeReason looks for
    const { name, dark } = surfaceOf(k);
    out.push(`${dark ? 'html[data-theme="dark"] ' : ''}[data-surface="${name}"] { --gd-band: ${v}; }`);
  }
  return out;
}

/** `19px` / `1.1875rem` → { n, unit }, or null when it isn't a plain length (a clamp(), a keyword…). */
export function parseLength(v) {
  const m = /^(-?\d*\.?\d+)(px|rem|em|pt)$/.exec(String(v ?? '').trim());
  return m ? { n: parseFloat(m[1]), unit: m[2] } : null;
}
/** 37.06 → "37.1", 30 → "30" (a trailing .0 in a stylesheet is just noise). */
const round1 = (n) => String(Math.round(n * 10) / 10);

/** Emit the `theme.css` text: a header comment + a `html:root` block with ONLY the token stems the
 *  author actually set, in canonical (TOKENS) order. A theme that overrides no tokens still yields a
 *  valid (near-empty) file — the build needs `theme.css` to exist for `--theme` staging. */
/** The token SiteLayout greps for to decide `data-theme-custom`. Machine-readable on purpose:
 *  a prose sentence is something a human will improve, and this one was. */
export const CUSTOM_CSS_MARKER = 'reef:has-custom-css';

/** Where the compiled sheet lives in a site repo. It sits HERE, with the code that shapes the
 *  artifact, so whatever writes it and whatever checks it can never drift onto two different
 *  literals — the same reason CUSTOM_CSS_MARKER is a shared token and not a sentence. */
export const THEME_CSS_REL = 'theme.css';

export function compileThemeCss(meta, residueCss = '') {
  // Both interpolations below are DEFENSIVE, not decorative: the name lands inside a `/* … */`
  // comment (so `*​/` would escape it) and each value lands inside `html:root { … }` (so `}` would
  // close the block and `</style>` would leave CSS altogether — the file is inlined with set:html).
  // unsafeReason is the one arbiter, shared with any checker that reports to the author, so what
  // the author is TOLD and what is WRITTEN can never disagree. Dropping beats escaping here: a mangled token is a silent mystery,
  // an absent one falls back to base and is visible in the doc.
  const rawName = (meta && meta.name) ? String(meta.name).trim() : 'theme';
  const name = unsafeReason('name', rawName) ? 'theme' : rawName;
  const block = (src) => TOKENS
    .filter((t) => src && src[t.stem] != null && String(src[t.stem]).trim() !== '')
    .filter((t) => !unsafeReason(t.stem, src[t.stem]))
    .map((t) => `  --${t.stem}: ${String(src[t.stem]).trim()};`);
  // 🔤 Derive the heading steps from ONE ratio: h3 = size×r, h2 = size×r², h1 = size×r³. Done here,
  // not in CSS, because CSS has no portable pow() — and because a concrete emitted value is what
  // lets base keep its own fluid clamp() as the fallback for every theme that sets no scale.
  // An explicitly-set gd-h1/h2/h3 wins (block() reads meta, which is applied after).
  const scaled = {};
  const ratio = Number(String((meta && meta['type-scale']) ?? '').trim());
  const size = parseLength(meta && meta['gd-font-size']);
  if (size && Number.isFinite(ratio) && ratio >= TYPE_SCALE_RANGE[0] && ratio <= TYPE_SCALE_RANGE[1]) {
    const step = (n) => `${round1(size.n * ratio ** n)}${size.unit}`;
    scaled['gd-h3'] = step(1); scaled['gd-h2'] = step(2); scaled['gd-h1'] = step(3);
  }
  const decls = block({ ...scaled, ...(meta || {}) });
  const residue = String(residueCss ?? '').replace(/<\/style/gi, '').trim();
  // 🌗 The dark half of a paired palette. Emitted ONLY for the tokens actually overridden, under
  // `html[data-theme="dark"]:root` (0,2,1) so it beats the default block (0,1,1) whenever the toggle
  // has stamped the attribute — which SiteLayout's inline script does BEFORE first paint, so there is
  // no flash. No @dark keys → not a single byte more than before.
  const darkSrc = {};
  for (const [k, v] of Object.entries(meta || {})) {
    const stem = darkStemOf(k);
    if (stem && v != null && String(v).trim() !== '') darkSrc[stem] = v;
  }
  const darkDecls = block(darkSrc);
  return [
    `/* Compiled from ir/_theme.md — do not hand-edit. Theme: ${name}. */`,
    'html:root {',
    ...decls,
    '}',
    ...(darkDecls.length ? ['html[data-theme="dark"]:root {', ...darkDecls, '}'] : []),
    // after the token blocks and before the custom CSS, so the owner's own rules still win ties
    ...surfaceRules(meta),
    // RESIDUE — site-wide CSS the vocabulary can't express, carried in the _theme.md body and
    // appended VERBATIM. This is the documented escape hatch, so it is not token-filtered (that
    // would defeat its purpose); only `</style` is refused, because the compiled file is inlined
    // into a <style> element and that sequence can only ever break the page, never style it.
    // 🩸 `reef:has-custom-css` is a MACHINE MARKER and must not be reworded. SiteLayout reads this
    // line to decide whether to stamp `data-theme-custom`, which is what keeps base's born paint off
    // a hand-written theme. It used to match the PROSE —
    // /custom CSS from the _theme\.md body/ — so rewording the sentence for humans on 2026-08-01
    // silently switched born-paint gating OFF for every site with custom CSS. Nobody would have
    // found that by reading either file: the only symptom was one h2's line-height, caught by a
    // full-page computed-style diff. The sentence is now free to change; the token is not, and
    // theme-schema.test.mjs holds the two files together.
    ...(residue ? ['', `/* ${CUSTOM_CSS_MARKER} ── custom CSS, verbatim from the _theme.md body ── */`, residue] : []),
    '',
  ].join('\n');
}

/** The `_site.md` frontmatter keys this compiler OWNS. `ir/_theme.md` is their SSOT, so after
 *  every compile these keys in `_site.md` must mirror the compile output EXACTLY — a key the theme
 *  no longer sets has to be removed, not left behind.
 *  Derived from TREATMENTS so a new axis is covered automatically. */
export const THEME_SITE_KEYS = ['theme', 'fonts', 'announce', 'announce-href', 'announce-until', ...TREATMENTS.map((t) => t.key)];

/** Compile the full structured theme into its renderer artifacts.
 *  @returns {{ name: string, css: string, siteMeta: { theme: string, fonts?: string, announce?: string, 'announce-href'?: string, 'announce-until'?: string } }}
 *    - css:      the site repo's theme.css (see compileThemeCss)
 *    - siteMeta: the _site.md frontmatter keys the caller (an editor, a site seed, a build) stamps. */
export function compileTheme(rawMeta, residueCss = '') {
  // Drop anything unsafe to interpolate BEFORE any artifact is built, so theme.css, _theme.md and
  // _site.md can never disagree about what was accepted (sanitizeThemeMeta reports the same drops).
  const { meta } = sanitizeThemeMeta(rawMeta);
  const name = String((meta && meta.name) || '').trim();
  const siteMeta = { theme: name };
  if (meta && meta.fonts != null && String(meta.fonts).trim() !== '') siteMeta.fonts = String(meta.fonts).trim();
  // The announcement and its link/deadline, as the renderer's three flat keys (tile#192).
  // A link or deadline without text announces nothing, and `announce-off: true` is the owner's switch:
  // all three are omitted (the words stay in _theme.md for next time). A bare string compiles exactly
  // as before — only `announce`.
  const s = (k) => (meta && meta[k] != null ? String(meta[k]).trim() : '');
  if (s('announce') !== '' && s('announce-off') !== 'true') {
    siteMeta.announce = s('announce');
    if (s('announce-href') !== '') siteMeta['announce-href'] = s('announce-href');
    if (s('announce-until') !== '') siteMeta['announce-until'] = s('announce-until');
  }
  // Treatment axes → body[data-…] frontmatter keys. Emit ONLY a set, valid, NON-default value:
  //   • default values are the absent state — omitting them keeps a themeless/default site's <body>
  //     byte-identical, and SiteLayout stamps nothing.
  //   • header-sticky is presence-based in site.css (body[data-header-sticky] matches ANY value), so a
  //     'false' must never be stamped — skipping defaults covers that (false IS its default).
  //   • an off-list value is dropped here (a checker should flag it) so a bad value never reaches the DOM.
  for (const t of TREATMENTS) {
    const v = meta && meta[t.key] != null ? String(meta[t.key]).trim() : '';
    if (v !== '' && v !== t.default && t.values.includes(v)) siteMeta[t.key] = v;
  }
  return { name, css: compileThemeCss(meta, residueCss), siteMeta };
}
