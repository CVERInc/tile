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
// reason — and refused unless they say `--allow-dropped`. That includes what the forgiving parser
// never hands over: a line it cannot read, and the earlier value of a key written twice.
//
// 🔴 The drops are found by reading the OUTPUT, not by restating the compiler's rules: a key the
// author set that did not arrive in theme.css or the printed keys was dropped, whatever the reason.
// A second copy of "which values are legal" here would be a second thing to keep in step.

import { readFileSync, writeFileSync } from 'node:fs';
import { compileTheme, compileThemeCss, THEME_SITE_KEYS } from './theme-compile.js';
import {
  parseThemeDoc, residueOf, structuralIssues, sanitizeThemeMeta, unsafeReason,
  TOKENS, TREATMENTS, TYPE_SCALE_RANGE, SURFACE_HEX_REASON, THEME_KEYS, DARK_KEYS, surfaceOf, darkStemOf,
} from './theme-schema.js';
import { truncateCssText } from './css-text.js';
// The RENDERER's own judges, imported rather than restated: whether it will link a URL, and whether
// it can read an announcement deadline. A copy here would be a second rule that drifts from the one
// that actually decides what a visitor sees.
import { safeHref } from '../../sitetile/site-core.js';
import { announceModel } from '../../sitetile/astro/src/lib/announce.mjs';

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

// ── what the parser never handed over ──────────────────────────────────────────────────────────
// 🩸 parseThemeDoc is forgiving by design (an editor wrote the file; a stray line should not break a
// live site), so a line with no colon is SKIPPED and a key written twice keeps its LAST value — both
// in silence. That is the library's right; it is not this command's. So the CLI reads the same
// frontmatter block itself, line by line, and names what the parser would not use. The block is
// found with the parser's own shape (`---` … `---` at the top), so the two read the same lines.
const unread = [];   // { line, text, reason }
const fm = /^---\r?\n([\s\S]*?)\r?\n---\s*/.exec(md);
const firstLines = new Map();   // key → [{ line, value }]
fm[1].split(/\r?\n/).forEach((text, i) => {
  const line = i + 2;   // line 1 is the opening ---
  if (!text.trim() || /^\s*#/.test(text)) return;
  const at = text.indexOf(':');
  if (at < 0) { unread.push({ line, text, reason: 'no `key: value` colon — the parser skips this line' }); return; }
  const key = text.slice(0, at).trim();
  if (!key) { unread.push({ line, text, reason: 'nothing before the colon — there is no key to set' }); return; }
  // a well-formed line whose key the parser did not keep (`__proto__:` goes to the object's
  // prototype, not into it) is as lost as a line with no colon
  if (!Object.prototype.hasOwnProperty.call(meta, key)) { unread.push({ line, text, reason: 'the parser does not keep this key — it never reaches the compiler' }); return; }
  if (!firstLines.has(key)) firstLines.set(key, []);
  firstLines.get(key).push({ line, value: text.slice(at + 1).trim() });
});
const dupes = [...firstLines].filter(([, at]) => at.length > 1);

// ── what was asked for and did not arrive ──────────────────────────────────────────────────────
// Each drop keeps the FULL key, for the lookup; it is cut only when printed.
const dropped = [];   // { key, value, reason }
const seen = new Set();
const drop = (key, reason) => { if (!seen.has(key)) { seen.add(key); dropped.push({ key, value: meta[key], reason }); } };
for (const k of Object.keys(meta)) {
  if (!THEME_KEYS.has(k) && !DARK_KEYS.has(k) && !surfaceOf(k)) drop(k, 'not a key this vocabulary has (a typo?) — see TOKENS, TREATMENTS and META_KEYS in theme-schema.js');
}
for (const d of sanitizeThemeMeta(meta).dropped) drop(d.key, `${d.kind}: ${d.problem}`);
for (const k of Object.keys(meta)) if (k !== 'name' && !set(k)) drop(k, 'empty value — nothing to set');
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
// The announcement's link and deadline reach _site.md only beside its text (announce-off hides
// all three on purpose, which is a choice and not a drop). Only the exact word `true` hides it.
const off = String(meta['announce-off'] ?? '').trim();
if (set('announce-off') && !seen.has('announce-off') && off !== 'true' && off !== 'false') drop('announce-off', 'only `true` hides the announcement (and `false` shows it) — this value does neither');
if (off !== 'true') {
  for (const k of ['announce-href', 'announce-until']) {
    if (set(k) && !seen.has(k) && siteMeta[k] !== String(meta[k]).trim()) drop(k, 'an announcement link or deadline with no `announce:` text shows nothing');
  }
  // …and once they do reach it, the renderer still has to accept them. A deadline it cannot read
  // hides the whole announcement (announceModel: "a deadline we cannot read is not no deadline");
  // asked with a clock at the start of time, so only unreadability — never lateness — says none.
  if (siteMeta['announce-until'] && announceModel(siteMeta, { now: -8.64e15 }).mode === '') {
    drop('announce-until', 'the renderer cannot read this deadline, so it shows no announcement at all — write ISO 8601 with an offset, e.g. 2026-12-01T23:59:00+08:00');
  }
  if (siteMeta['announce-href'] && !safeHref(siteMeta['announce-href'])) drop('announce-href', 'the renderer refuses this link (a /path or an https:// address), so the announcement is not linked');
}
// `fonts:` is not a navigation link: SiteLayout puts `safeHref(fonts)` in <link rel="stylesheet" href>.
// 🩸 Two rounds of "what can a stylesheet link load" each left a hole: safeHref DECODES entities
// (`&#109;ailto:` is `mailto:` by the time it is emitted), and `.`, `./`, `/`, `./?v=2` all resolve
// to the HTML page itself, which no compiler can rule out without knowing every page. So this is an
// ALLOWLIST, applied to the exact string safeHref returns — the href the renderer will emit:
//   (a) an absolute http:// or https:// URL with a host and a path beyond `/`, or a query;
//   (b) a root-relative path: one leading `/`, longer than `/`, no `#`, not a bare `/?…`.
// Everything else is a drop. Narrow on purpose: a webfont stylesheet is one of these in practice.
function stylesheetHrefOk(emitted) {
  if (typeof emitted !== 'string' || !emitted) return false;
  if (/^https?:\/\//i.test(emitted)) {
    let u;
    try { u = new URL(emitted); } catch { return false; }
    return !!u.hostname && (u.pathname.length > 1 || u.search.length > 1);
  }
  return /^\/[^/?#][^#]*$/.test(emitted);
}
if (siteMeta.fonts && !stylesheetHrefOk(safeHref(siteMeta.fonts))) {
  drop('fonts', 'a stylesheet <link> cannot load this — use an absolute https:// stylesheet URL (with a path or query), or a /root/path longer than /');
}

// type-scale is not emitted itself; it is visible only through the heading steps it derives. Ask
// the compiler what it WOULD derive with the hand-set steps taken away, so a ratio that derives
// nothing is caught even when gd-h1/h2/h3 are all set by hand and hide it.
if (set('type-scale') && !seen.has('type-scale')) {
  const probe = { ...sanitizeThemeMeta(meta).meta };
  for (const h of ['gd-h1', 'gd-h2', 'gd-h3']) delete probe[h];
  // only the LIGHT root block: a `gd-h3@dark` override lands in the dark block and is not derived
  const light = /^html:root \{\n([\s\S]*?)^\}/m.exec(compileThemeCss(probe))?.[1] ?? '';
  if (!/--gd-h3: /.test(light)) drop('type-scale', `derives nothing: needs a ratio between ${TYPE_SCALE_RANGE[0]} and ${TYPE_SCALE_RANGE[1]} and gd-font-size as a plain length (px, rem, em, pt)`);
}

const mark = allowDropped ? '⚠' : '✗';
for (const u of unread) console.error(`${mark} line ${u.line}: ${show(u.text)} — ${u.reason}`);
for (const [key, at] of dupes) {
  const last = at[at.length - 1];
  const lost = at.slice(0, -1).map((a) => `${show(a.value)} (line ${a.line})`).join(', ');
  console.error(`${mark} ${truncateCssText(key)}: written ${at.length} times (${at.map((a) => `line ${a.line}`).join(', ')}) — only the last, ${show(last.value)}, is used; ${lost} dropped`);
}
for (const d of dropped) console.error(`${mark} ${truncateCssText(d.key)}: ${show(d.value)} dropped — ${d.reason}`);
const problems = unread.length + dupes.length + dropped.length;
if (problems && !allowDropped) {
  console.error(`✗ ${src}: ${problems} problem(s) above — nothing was written. Fix them, or pass --allow-dropped to compile without them.`);
  process.exit(2);
}

writeFileSync(out, css);

// Every key the theme OWNS, in a fixed order. A key the theme does not set is not printed — and if
// your _site.md still carries it from an earlier theme, delete it there: the theme is its source.
// A value reported as dropped is not advertised here either, even under --allow-dropped: pasting
// these lines must give the site exactly what the compile kept.
for (const k of THEME_SITE_KEYS) if (siteMeta[k] != null && !seen.has(k)) console.log(`${k}: ${siteMeta[k]}`);
console.error(`✓ wrote ${out} — the keys above belong in _site.md (theme-owned: ${THEME_SITE_KEYS.join(', ')})`);
