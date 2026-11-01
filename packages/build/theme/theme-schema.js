// theme-schema.js — the structured theme document (`ir/_theme.md`) vocabulary + parse/serialize/
// structural-validate.
//
// Why declared here + guarded by a test (not imported): the token vocabulary is the RENDERER's —
// its single source of truth is the sitetile base `site.css` (the `--gd-*` / `--st-*` custom
// properties). CSS can't be `import`ed as data at runtime (a Worker has no filesystem), so we
// DECLARE the vocabulary here and `theme-schema.test.mjs` asserts ZERO DRIFT against
// packages/sitetile/astro/src/styles/site.css (both directions): a token the renderer stops
// defining, or a new one it adds, breaks the test — never ships a schema that lets an author set a
// token the renderer ignores.
//
// SCOPE: the vocabulary + a flat `ir/_theme.md` parser/serializer + STRUCTURAL issues (unknown key /
// missing name / empty value) + the interpolation-safety filter. It does NOT judge whether colours
// pass contrast — that is a born-valid checker's job, and it lives with whoever runs one.

import { truncateCssText } from './css-text.js';

/**
 * The renderer's design tokens. Two groups (see spec Appendix A):
 *  - Group A: defined with a default in site.css `:root` — the discoverable palette/type/shape/layout.
 *  - Group B: referenced-only with NO `:root` default. Root-settable colours carry a completeness
 *    advisory; perSurface tokens stay unset by design and may only be set in scoped custom CSS.
 * `stem` is the frontmatter key in `_theme.md` (the CSS custom-property name minus the leading `--`),
 * unambiguous across both the `gd-` and `st-` namespaces and 1:1 with the emitted CSS variable.
 * @typedef {{ stem: string, category: 'color'|'type'|'shape'|'layout', group: 'A'|'B', default?: string, perSurface?: boolean }} ThemeToken
 */

/** @type {ThemeToken[]} */
export const TOKENS = [
  // ── Group A — defined in site.css :root (name → default) ──────────────────────────────────────
  { stem: 'gd-bg', category: 'color', group: 'A', default: '#ffffff' },
  { stem: 'gd-surface', category: 'color', group: 'A', default: '#f6f7f9' },
  { stem: 'gd-text', category: 'color', group: 'A', default: '#1f2d3d' },
  { stem: 'gd-muted', category: 'color', group: 'A', default: '#5b6b7b' },
  { stem: 'gd-accent', category: 'color', group: 'A', default: '#1f6feb' },
  { stem: 'gd-accent-ink', category: 'color', group: 'A', default: '#ffffff' },
  { stem: 'gd-border', category: 'color', group: 'A', default: '#e4e8ee' },
  { stem: 'gd-font', category: 'type', group: 'A', default: 'ui-sans-serif, system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif' },
  { stem: 'gd-radius', category: 'shape', group: 'A', default: '12px' },
  { stem: 'gd-maxw', category: 'layout', group: 'A', default: '72ch' },
  { stem: 'gd-gap', category: 'layout', group: 'A', default: 'clamp(1rem, 2.5vw, 2rem)' },
  { stem: 'st-sidebar-w', category: 'layout', group: 'A', default: '280px' },
  // treatment-axis tokens — each :root default keeps today's render byte-identical (see the
  // site.css note). gd-btn-radius is also driven by the `button: pill|rect` axis; a theme may still
  // set any of these directly. Only tokens with NO outside consumer may live here: a :root default
  // DISARMS every `var(--x, fallback)` reading that token, which is why gd-soft (and the dropped
  // gd-card-shadow, which the square-shop coral reads as a COLOUR) stay Group B instead.
  { stem: 'gd-btn-fill', category: 'color', group: 'A', default: 'var(--gd-accent)' },
  { stem: 'gd-btn-radius', category: 'shape', group: 'A', default: 'var(--gd-radius)' },
  { stem: 'gd-avatar-shadow', category: 'shape', group: 'A', default: '0 2px 12px rgba(0, 0, 0, 0.12)' },
  // ── Group B — referenced-only, no :root default (spec Appendix A.1 group B) ────────────────────
  { stem: 'gd-accent-deep', category: 'color', group: 'B' },
  // tile#200: gd-band paints individual surfaces; the band treatment axis controls gd-soft tint extent.
  { stem: 'gd-band', category: 'color', group: 'B', perSurface: true },
  { stem: 'gd-head', category: 'color', group: 'B' },
  { stem: 'gd-hair', category: 'color', group: 'B' },
  { stem: 'gd-fg', category: 'color', group: 'B' },
  { stem: 'gd-nav-panel', category: 'color', group: 'B' },
  { stem: 'gd-nav-panel-ink', category: 'color', group: 'B' },
  { stem: 'gd-brand-font', category: 'type', group: 'B' },
  { stem: 'gd-max', category: 'layout', group: 'B' },
  // One size for the three near-identical header control boxes (logo / cart / hamburger). Group B:
  // site.css sets it inside `.rf-header:has(...)`, not at :root, so each box keeps its own literal
  // fallback when a theme leaves it alone.
  { stem: 'gd-ctl', category: 'layout', group: 'B' },
  // deliberately Group B — see the note above: both have consumers OUTSIDE site.css that read them
  // with a fallback (the dynamic corals), so defining either at :root would silently change them.
  { stem: 'gd-soft', category: 'color', group: 'B' },
  { stem: 'gd-card-elevation', category: 'shape', group: 'B' },
  // 🔤 TYPE SCALE. Group B on purpose — base reads each with its previous literal as
  // the fallback, so an unset scale renders byte-for-byte as before. gd-h1/h2/h3 are DERIVED by the
  // compiler from gd-font-size × type-scale; an author sets the scale, not the steps.
  { stem: 'gd-font-size', category: 'type', group: 'B' },
  { stem: 'gd-line', category: 'type', group: 'B' },
  { stem: 'gd-heading-weight', category: 'type', group: 'B' },
  { stem: 'gd-h1', category: 'type', group: 'B' },
  { stem: 'gd-h2', category: 'type', group: 'B' },
  { stem: 'gd-h3', category: 'type', group: 'B' },
];

/** Non-token frontmatter keys a `_theme.md` may carry.
 *  - name:     the theme id (required) — becomes the site's `theme:` and the staged `<name>.css`.
 *  - fonts:    a webfont stylesheet URL, emitted as preconnect + <link> (SiteLayout.astro:185).
 *  - announce: the site-wide announcement string (one hand-rolled theme modelled this as
 *              CSS-injected content; it is DATA, not a treatment). Optional.
 *  - announce-href / announce-until / announce-off: its link, its deadline (ISO 8601 with
 *              an offset), and the owner's switch, stored flat here; `off` never reaches
 *              `_site.md` — while it is on the compiler omits all three site keys. */
export const META_KEYS = ['name', 'fonts', 'announce', 'type-scale', 'announce-href', 'announce-until', 'announce-off'];

/** The type ratio: each heading step is `gd-font-size × type-scale^n`. A single number instead of
 *  four hand-picked sizes — one decision that stays harmonious, and the compiler does the arithmetic
 *  (CSS has no portable pow()). Sane range only; 1.0 would flatten the hierarchy entirely. */
export const TYPE_SCALE_RANGE = [1.05, 2];

/** TREATMENT AXES — the enumerable "switches" that let a
 *  structured theme wear a whole design identity. Each is a `_theme.md` key whose value the compiler
 *  stamps as a `body[data-…]` attribute (theme-compile.js), which base site.css reads. The base
 *  CSS switch for each NON-default value MUST exist — the theme-schema treatment↔css zero-drift test
 *  pins that, so this list can never claim a value the renderer can't honour. `default` is the ABSENT
 *  state (renders byte-identical to a themeless site); a theme sets a key only to leave the default.
 *  (`header: overlay` exists too, but overlay is applied by header-overlay.js for immersive heroes,
 *  not a body toggle — deliberately NOT a treatment value here.) */
export const TREATMENTS = [
  { key: 'header', attr: 'data-header', default: 'solid', values: ['solid', 'translucent'], purpose: 'header material: solid bar, or translucent glass that blurs the page behind it' },
  { key: 'header-width', attr: 'data-header-width', default: 'full-bleed', values: ['full-bleed', 'boxed'], purpose: 'header spans the viewport, or is a centered island at the content width' },
  { key: 'header-sticky', attr: 'data-header-sticky', default: 'false', values: ['false', 'true'], bool: true, purpose: 'the header sticks to the top on scroll' },
  { key: 'button', attr: 'data-button', default: 'rect', values: ['rect', 'pill'], purpose: 'button shape: the default rounded rectangle, or a full pill' },
  { key: 'band', attr: 'data-band', default: 'contained', values: ['contained', 'full-bleed'], purpose: 'the grid section as a contained block, or a full-bleed tinted belt (tint = --gd-soft)' },
  { key: 'card', attr: 'data-card', default: 'surface', values: ['surface', 'flat', 'glass', 'elevated'], purpose: 'grid card look: filled surface, flat with a hairline + hover-lift, translucent glass, or resting shadow' },
  { key: 'cell-cta', attr: 'data-cell-cta', default: 'on', values: ['on', 'off'], purpose: 'show or hide the chevron affordance on grid cards' },
  { key: 'corner', attr: 'data-corner', default: 'round', values: ['round', 'squircle'], purpose: 'corner geometry: normal rounded, or a squircle (superellipse)' },
];
const TOKEN_BY_STEM = new Map(TOKENS.map((t) => [t.stem, t]));
const TREATMENT_KEYS = TREATMENTS.map((t) => t.key);
const TREATMENT_BY_KEY = new Map(TREATMENTS.map((t) => [t.key, t]));

/** The full set of legal `_theme.md` frontmatter keys (token stems ∪ meta keys ∪ treatment keys).
 *  Surface keys (`surface-<name>`) are an open family, so they are matched by surfaceOf, not listed. */
export const THEME_KEYS = new Set([...TOKENS.map((t) => t.stem), ...META_KEYS, ...TREATMENT_KEYS]);

/** 🎨 SURFACES (tile#200). A page section with `surface=<name>` carries
 *  `data-surface="<name>"`; the theme paints it with `surface-<name>: <value>` (and `@dark`).
 *  The compiler turns it into `[data-surface="<name>"] { --gd-band: … }`, which base site.css
 *  carries out to the edges of the page as a full-width band. The value is ONLY an exact
 *  hex colour (surfaceNotHex) — the band is a one-colour fill. Any other colour, a gradient or an image
 *  surface stays in custom CSS as `[data-surface="<name>"] { background: … }`, boxed (SURFACE_HEX_REASON). The name is interpolated into a quoted
 *  attribute selector, hence the narrow shape. */
export const SURFACE_PREFIX = 'surface-';
const SURFACE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
/** `surface-cream` → { name: 'cream', dark: false }; `surface-cream@dark` → { …, dark: true }; else null. */
export function surfaceOf(key) {
  const k = String(key ?? '');
  const dark = k.endsWith(DARK_SUFFIX);
  const base = dark ? k.slice(0, -DARK_SUFFIX.length) : k;
  if (!base.startsWith(SURFACE_PREFIX)) return null;
  const name = base.slice(SURFACE_PREFIX.length);
  return SURFACE_NAME.test(name) ? { name, dark } : null;
}
/** The surface keys of a meta, in canonical order: by name, light before `@dark`. Deterministic, so
 *  the serialized doc and the compiled sheet never depend on the order a caller sent the keys in. */
export function surfaceKeysOf(meta) {
  return Object.keys(meta || {})
    .map((k) => ({ k, s: surfaceOf(k) }))
    .filter((x) => x.s)
    .sort((a, b) => (a.s.name < b.s.name ? -1 : a.s.name > b.s.name ? 1 : Number(a.s.dark) - Number(b.s.dark)))
    .map((x) => x.k);
}
/** 🩸 A surface colour is EXACT HEX, nothing else. An earlier version judged it with a colour
 *  validator that checks a function's SHAPE: `rgb(banana)`, `hsl(blue)` and `var(--missing,
 *  25%)` passed, saved with a clean verify, and the browser dropped the band — the section went
 *  transparent with no word to anyone. Hex is the one form whose shape IS its validity. Anchored, no
 *  trim: the callers pass the value as written. Kept apart from the shared token validator on purpose
 *  (tightening that is its own ticket). */
const SURFACE_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** true when `value` is NOT one of #rgb, #rgba, #rrggbb, #rrggbbaa. */
export function surfaceNotHex(value) {
  return typeof value !== 'string' || !SURFACE_HEX.test(value);
}
/** The one refusal sentence for every writer, checker and editor alike. */
export const SURFACE_HEX_REASON = 'surface colours are hex (#rrggbb); other colours, gradients or images stay in custom CSS';

/** Split `s` at every top-level `sep` (a char, or a RegExp tested per char): never inside (), [] or
 *  quotes. Returns null when the brackets or quotes are unbalanced — a value that would leave a
 *  block or a string open in the stylesheet it is interpolated into. */
export function splitTopLevel(s, sep) {
  const parts = [];
  const stack = [];
  let quote = '';
  let cur = '';
  const isSep = typeof sep === 'string' ? (c) => c === sep : (c) => sep.test(c);
  for (const c of String(s)) {
    if (quote) { if (c === quote) quote = ''; cur += c; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') stack.push(c === '(' ? ')' : ']');
    else if (c === ')' || c === ']') { if (stack.pop() !== c) return null; }
    else if (!stack.length && isSep(c)) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (quote || stack.length) return null;
  parts.push(cur);
  return parts;
}
/** 🩸 A surface value lands as `{ --gd-band: V; }`. `linear-gradient(red, blue` (no
 *  `)`) carries no structural character, yet leaves the function open: the browser reads every
 *  following rule — the other surfaces, the owner's custom CSS — as part of that value, and the save
 *  still verified clean. `CSS.supports` on the value ALONE says yes (EOF closes it), so the check is
 *  on our side: exactly one token, either a bare word (`#f3e9dc`, `cream`) or one `name(…)` call
 *  whose own `)` is the last character, with brackets and quotes balanced. */
const ONE_CALL = /^[A-Za-z-]+\(/;
function oneSurfaceValue(v) {
  const parts = splitTopLevel(v, /\s/);
  if (!parts || parts.length !== 1) return false;
  if (!v.includes('(')) return true;
  if (!ONE_CALL.test(v) || !v.endsWith(')')) return false;
  // the opening `(` closes at the end, not earlier: `rgb(1)(2)` leaves `1)(2` inside, unbalanced
  return splitTopLevel(v.slice(v.indexOf('(') + 1, -1), ',') !== null;
}

/** 🌗 DARK-SCHEME PAIR. A site with `color-scheme: toggle` needs TWO palettes, but a `_theme.md` is a
 *  flat one-value-per-key document — which is exactly why no structured theme could serve such a site
 *  (base ships no dark palette at all; every live dark site hand-rolls `[data-theme="…"]` CSS). The
 *  vocabulary stays flat: any token may ALSO appear suffixed, `gd-bg@dark: #120d1c`, and the compiler
 *  emits a second block that wins when the toggle stamps the attribute. Unsuffixed = the default
 *  scheme; the suffix is an OVERRIDE, so a pair only needs the tokens that actually differ.
 *  Only TOKENS pair — a treatment axis or `fonts` is not a colour scheme. */
export const DARK_SUFFIX = '@dark';
/** The token stem a `<stem>@dark` key overrides, or null if `key` isn't a dark-scheme key. */
export function darkStemOf(key) {
  const k = String(key ?? '');
  if (!k.endsWith(DARK_SUFFIX)) return null;
  const stem = k.slice(0, -DARK_SUFFIX.length);
  return TOKEN_BY_STEM.has(stem) ? stem : null;
}
/** Every legal `<stem>@dark` key. */
export const DARK_KEYS = new Set(TOKENS.map((t) => `${t.stem}${DARK_SUFFIX}`));
/** The effective palette for one scheme: the base values, with @dark layered on when scheme='dark'. */
export function schemeMeta(meta, scheme) {
  const out = { ...(meta || {}) };
  for (const k of Object.keys(out)) if (k.endsWith(DARK_SUFFIX)) delete out[k];
  if (scheme !== 'dark') return out;
  for (const [k, v] of Object.entries(meta || {})) {
    const stem = darkStemOf(k);
    if (stem && v != null && String(v).trim() !== '') out[stem] = v;
  }
  return out;
}

/** The explicit baseline theme: the Group-A palette/type/shape at their site.css DEFAULTS, made
 *  visible. A born site seeded with this has ir/_theme.md an author can open and edit (theming is
 *  discoverable, not hidden) and a theme.css that travels with the repo from birth — and the
 *  look is unchanged, because every value equals what site.css already defaults. DERIVED from TOKENS,
 *  so it can never drift from the token universe. */
export function baselineThemeMeta(name) {
  const meta = { name };
  // The seed carries the CONCRETE starter palette — not alias plumbing. A token whose default is a
  // `var(--…)` reference (the treatment tokens gd-soft/gd-btn-fill/gd-btn-radius) just re-expresses
  // another token's value; emitting it adds noise for the author and resolves identically via :root.
  for (const t of TOKENS) {
    if (t.group === 'A' && t.default != null && !/^var\(/.test(t.default)) meta[t.stem] = t.default;
  }
  return meta;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\s*/;

/** Parse a flat `_theme.md`: YAML-ish `key: value` frontmatter (values are plain strings; the font
 *  stack's internal commas/quotes are fine — everything after the first colon is the value). Mirrors
 *  how `_site.md` chrome is authored. Returns `{ meta, body }`, or `null` if there is no frontmatter. */
export function parseThemeDoc(md) {
  const m = FRONTMATTER_RE.exec(md ?? '');
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue; // blank / comment
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    // Unquote ONLY a fully-wrapped scalar (`"#aceace"` → `#aceace`). A font stack that legitimately
    // opens with a quoted family (`"Fraunces", serif`) is NOT fully wrapped, so it stays intact.
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val[val.length - 1] === val[0]) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return { meta, body: md.slice(m[0].length) };
}

/** Serialize a theme object back to `_theme.md` text. Emits `name` first, then tokens in canonical
 *  (TOKENS) order, then the remaining meta keys — only for keys actually present. Deterministic:
 *  the same object always yields byte-identical output (so the compiler + visual-diff stay stable). */
export function serializeThemeDoc(meta, residueCss = '') {
  const seen = new Set();
  const lines = ['---'];
  const emit = (k) => {
    if (meta[k] != null && meta[k] !== '' && !seen.has(k)) { lines.push(`${k}: ${meta[k]}`); seen.add(k); }
  };
  emit('name');
  for (const t of TOKENS) emit(t.stem);
  for (const t of TOKENS) emit(`${t.stem}${DARK_SUFFIX}`); // the dark override, grouped after its scheme
  for (const t of TREATMENTS) emit(t.key);
  for (const k of META_KEYS) emit(k);
  // surfaces last, by name, each light value followed by its @dark (an open family — see surfaceOf)
  for (const k of surfaceKeysOf(meta)) emit(k);
  lines.push('---', '');
  // The BODY is the theme's honest escape hatch: site-wide CSS the structured vocabulary cannot
  // express, kept in the SAME document as the tokens rather than in a second file or duplicated into
  // a per-page embed. The compiler appends it verbatim, so the pair is one commit, one artifact, one
  // thing that travels with the site. It leaves born-valid on purpose — a checker should say so out loud.
  const residue = String(residueCss ?? '').trim();
  if (residue) lines.push(RESIDUE_HEADING, '', '```css', residue, '```', '');
  return lines.join('\n');
}

/** The markdown heading that introduces the residue block in a `_theme.md` body. */
export const RESIDUE_HEADING = '## Custom CSS (leaves born-valid — the structured vocabulary could not express this)';

/** Pull the residue CSS back out of a `_theme.md` body. Accepts a fenced ```css block (what we
 *  write) or, forgivingly, a bare body that is already just CSS. */
export function residueOf(body) {
  const text = String(body ?? '');
  const fenced = /```css\r?\n([\s\S]*?)```/.exec(text);
  if (fenced) return fenced[1].trim();
  const bare = text.replace(/^#.*$/gm, '').trim();
  return /[{}]/.test(bare) ? bare : '';
}

/** STRUCTURAL issues only (shape, not semantics). Unknown key, missing/empty `name`, empty value.
 *  Colour contrast + treatment-value legality are a born-valid checker's job, NOT here. Returns an
 *  array of `{ key, problem }` — empty means structurally sound. */
/** 🔴 STRUCTURAL SAFETY — the compiler INTERPOLATES these values into three places that all parse
 *  what they are given: `theme.css` (`--stem: VALUE;` inside `html:root { … }`, inlined into every
 *  page with set:html), the `theme.css` header COMMENT (the name), and `_site.md` frontmatter
 *  (`key: value`, read by a LINE-ORIENTED, last-wins parser). So a value is not free text:
 *    - a newline in ANY value forges extra frontmatter lines — `announce: "Sale\nfooter: X /https://evil"`
 *      appends a real `footer:` key that OVERRIDES the site's own nav/footer on every page;
 *    - `}` in a token value closes the `html:root` block, and everything after it becomes a
 *      top-level CSS rule; `</style>` leaves CSS entirely and starts executing markup;
 *    - `*​/` in the name escapes the header comment the same way.
 *  Rejecting unknown KEYS was never the "no raw injection" guarantee people assumed — this is.
 *  born-valid stays advisory (an ugly theme still ships); malformedness is not a taste question, so
 *  an unsafe value is DROPPED rather than written. The escape hatch for real raw CSS is the `embed`
 *  coral, which is explicit about the portability debt. */
const UNSAFE_ANY = /[\r\n]/;                       // any value: frontmatter is one line per key
const UNSAFE_CSS = /[;{}<>\\@]|\/\*|\*\/|url\s*\(/i; // token values: block/comment/markup escapes
export const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/; // also becomes a staged <name>.css path

/**
 * The max length of a KEY in a theme (a token stem, `<stem>@dark`, or an unknown key the caller
 * made up). These three caps are for an EDITOR that takes a theme object from a caller and echoes
 * keys and values back: `sanitizeThemeMeta` only checks whether a VALUE is safe, never the key, so
 * without a cap one absurd key name rides straight into every answer that names it — measured, a
 * single 20 KB key put one editor answer at ~45 KB, twenty at ~810 KB. Same number `SAFE_NAME`
 * above already holds `name` to (64), so a caller who reads that field's regex and a caller who
 * reads this constant learn the same limit — this is the general case `SAFE_NAME` was always a
 * special case of. Every real token stem, `@dark` included, is at most 22 chars (the zero-drift
 * check in theme-schema.test.mjs would fail first if that changed), so 64 is ~3x headroom for a
 * token family nobody has shipped yet, not a number chosen to fit today's vocabulary exactly.
 */
export const THEME_KEY_MAX_CHARS = 64;

/**
 * The max length of a VALUE in a theme. A value has the same shape of gap as a key — `gd-font`,
 * `announce`, or an unknown key's value rides into an editor's echo completely unchecked
 * (`sanitizeThemeMeta` only rejects structurally-unsafe characters, never length). Measured: a
 * single 300 KB value put one answer at ~305 KB. 500 is generous for what a real value
 * ever needs to be — every colour/token value this renderer reads is under 40 chars, and even a
 * multi-family Google Fonts URL or a two-sentence `announce` banner comfortably fits inside it —
 * while still being far short of anything that could threaten the ceiling even at the key-count cap
 * below.
 */
export const THEME_VALUE_MAX_CHARS = 500;

/**
 * The max number of KEYS in a theme. Measured why it is needed: 3,000 keys, each a legal ≤64-char
 * name with a short safe value, cost ~378 KB of echo — with every individual key/value within both
 * caps above. The real vocabulary is TOKENS (32) + TREATMENTS (8) + META_KEYS (7) = 47, plus a
 * `@dark` pair for each of the 15 colour tokens = 62 distinct legitimate keys today (the zero-drift
 * check in theme-schema.test.mjs guards this number drifting silently). 128 is ~2x that, room for a
 * future token or treatment family without bumping a constant on day one.
 */
export const THEME_MAX_KEYS = 128;

/** Why `key` is unsafe to interpolate, or null when it is fine. Pure; the single source both a
 *  checker (to TELL the author) and the compiler (to DROP it) consult, so they never disagree. */
export function unsafeReason(key, value) {
  const v = value == null ? '' : String(value);
  if (v.trim() === '') return null;
  if (UNSAFE_ANY.test(v)) return 'contains a line break — every theme value is written as one frontmatter line, so a newline would forge extra site keys';
  if (key === 'name') {
    return SAFE_NAME.test(v.trim()) ? null : 'a theme name is also a filename: use letters, digits, dot, dash or underscore (max 64)';
  }
  // a `<stem>@dark` value is interpolated into CSS exactly like its stem — resolve it, or the whole
  // filter would have a hole the size of the dark palette.
  const stem = TOKEN_BY_STEM.has(key) ? key : darkStemOf(key);
  const scope = scopeReason(key);
  if (scope) return scope;
  // a surface value lands in `[data-surface="…"] { --gd-band: V; }` / `{ background: V; }` — the same
  // live stylesheet, so the same filter.
  if ((stem || surfaceOf(key)) && UNSAFE_CSS.test(v)) {
    return 'contains CSS-structural characters (; { } < > @ \\ /* */ url()) — a token value is interpolated into a live stylesheet, so these could end the rule block or leave CSS entirely';
  }
  if (surfaceOf(key) && !oneSurfaceValue(v.trim())) {
    return 'is not one value: an unclosed bracket or quote, or text after the value — interpolated into a live stylesheet, it would swallow the rules that follow it';
  }
  return null;
}

/** Why `key` can never be written as a site-wide value, or null. Not a safety question — the value
 *  may be a perfectly good colour — so callers that label drops say `scope`, not `unsafe`.
 *  The sentence names the key that does what was meant, because every editor can send that key;
 *  custom CSS is a path not every editor has. */
export function scopeReason(key) {
  const stem = TOKEN_BY_STEM.has(key) ? key : darkStemOf(key);
  if (!TOKEN_BY_STEM.get(stem)?.perSurface) return null;
  const dark = stem !== key ? DARK_SUFFIX : '';
  // Short on purpose: an editor's note may be cut at CSS_TEXT_ECHO_MAX_CHARS, and the key to use is
  // the part that must survive. Why a site-wide value is wrong lives in describeThemeGrammar.
  return `per surface, not site-wide: use ${SURFACE_PREFIX}<name>${dark} (e.g. ${SURFACE_PREFIX}cream${dark}: #f3e9dc for sections marked surface=cream)`;
}

/** Drop every value that is unsafe to interpolate. Returns the cleaned meta + what was dropped;
 *  each drop says whether it was `unsafe` or out of `scope` (scopeReason). */
export function sanitizeThemeMeta(meta) {
  if (meta == null || typeof meta !== 'object') return { meta, dropped: [] };
  const clean = {};
  const dropped = [];
  for (const [k, v] of Object.entries(meta)) {
    const why = unsafeReason(k, v);
    if (why) dropped.push({ key: k, kind: scopeReason(k) ? 'scope' : 'unsafe', problem: why });
    else clean[k] = v;
  }
  return { meta: clean, dropped };
}

export function structuralIssues(meta) {
  const issues = [];
  if (meta == null || typeof meta !== 'object') return [{ key: '(doc)', problem: 'no frontmatter found — a _theme.md needs a leading --- block' }];
  if (!meta.name || !String(meta.name).trim()) issues.push({ key: 'name', problem: 'a theme needs a name: (its id + the compiled <name>.css)' });
  // `key` is the CALLER's own key, truncated as a backstop (an editor should REFUSE an oversized key
  // on fresh input; this is for whatever is already on disk).
  for (const [k, v] of Object.entries(meta)) {
    if (!THEME_KEYS.has(k) && !DARK_KEYS.has(k) && !surfaceOf(k)) { issues.push({ key: truncateCssText(k), problem: `unknown theme key — not a renderer token or meta key (${[...THEME_KEYS].slice(0, 4).join(', ')}, …)` }); continue; }
    if (v == null || String(v).trim() === '') issues.push({ key: truncateCssText(k), problem: 'empty value' });
  }
  return issues;
}

/** Parse the token universe out of raw CSS text (the SSOT cross-check). Returns:
 *   - defined:    Map(stem → default)  for every `--x: value;` declaration
 *   - referenced: Set(stem)            for every `var(--x …)` use
 *  Token namespaces are `--gd-*` and the single `--st-sidebar-w` (all other `st-*` are classes, not
 *  custom properties — spec Appendix A.1). */
export function parseCssTokens(cssText) {
  // Strip CSS comments FIRST — a comment that mentions a token (e.g. the note "--gd-soft MUST
  // default to --gd-bg …") must never be misread as a definition. Without this, `--gd-bg:` inside a
  // comment with no trailing ';' greedily swallows the real `--gd-soft: …;` line that follows it.
  const css = String(cssText ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  // `defined` = tokens with a :ROOT default, and only those. The treatment switches deliberately
  // REDEFINE tokens inside `body[data-…]` blocks (e.g. `--gd-btn-radius: 999px` for the pill axis) —
  // those are axis VALUES, not the token's default, so a whole-file scan would record the wrong
  // default (last-wins picks a switch value). Scan only the concatenated :root block bodies.
  let rootBody = '';
  for (const m of css.matchAll(/:root\s*{([^}]*)}/g)) rootBody += m[1] + '\n';
  const defined = new Map();
  for (const m of rootBody.matchAll(/(--(?:gd|st)-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    defined.set(m[1].slice(2), m[2].trim());
  }
  // `referenced` = tokens used via var() ANYWHERE in the real CSS (comments already stripped).
  const referenced = new Set();
  for (const m of css.matchAll(/var\(\s*(--(?:gd|st)-[a-z0-9-]+)/g)) {
    referenced.add(m[1].slice(2));
  }
  return { defined, referenced };
}

/** One-line human purpose per token — powers describeThemeGrammar so an author (human or agent)
 *  knows what each lever does before it sets one ("teach the grammar up-front"). */
const PURPOSE = {
  'gd-band': 'per-surface band paint; distinct from the band treatment axis (gd-soft tint extent)',
  'gd-bg': 'page background', 'gd-surface': 'card / raised surface', 'gd-text': 'body text ink',
  'gd-muted': 'secondary / caption text', 'gd-accent': 'brand accent (links, buttons, highlights)',
  'gd-accent-ink': 'text/icon on top of the accent (e.g. button label)', 'gd-border': 'hairlines & card borders',
  'gd-font': 'body font stack', 'gd-radius': 'corner radius', 'gd-maxw': 'content column max width',
  'gd-gap': 'section rhythm / vertical gap', 'st-sidebar-w': 'blog/docs sidebar width',
  'gd-accent-deep': 'darker accent (hover / emphasis)', 'gd-head': 'heading ink', 'gd-hair': 'faint hairline',
  'gd-fg': 'strong foreground (pill hover)', 'gd-nav-panel': 'mobile nav panel surface',
  'gd-nav-panel-ink': 'mobile nav panel text', 'gd-brand-font': 'display/brand font', 'gd-max': 'embed max width',
};

/** The vocabulary an author uses to give a site its look, as data an editor or an agent can
 *  present. Token names are authoritative (SSOT-checked against site.css). No raw-CSS key exists:
 *  that is what keeps every structured theme born-valid + portable. 🔴 The STRINGS below are an
 *  output contract — at least one hosted editor serves them verbatim — so change them as you would
 *  change an API, not as you would tidy a comment. */
export function describeThemeGrammar() {
  return {
    file: 'ir/_theme.md',
    purpose: 'A site\'s visual identity as a structured, born-valid, portable document. Use set_theme to write it — never hand-write CSS. It compiles to the site\'s own theme.css, which travels with the site (ejecta).',
    // 🩸 This paragraph used to be repeated in FULL on every single edit response. It is well
    // written and it is still a per-call cost the caller cannot decline. Reference material belongs
    // where you go to look things up; the per-call line is now one sentence that points here.
    customCss: {
      what: 'Raw CSS in the _theme.md body, for whatever the structured vocabulary cannot express yet — a bespoke section layout, an animation.',
      whereItGoes: 'Appended to the compiled theme.css verbatim and committed to the site\'s own repo, so it travels with the site exactly like everything else.',
      whatItCosts: 'The structured tools cannot read inside it, so it is only as portable as CSS itself, and set_theme\'s token edits will never touch it.',
      howToEdit: 'custom_css_edit: [{find, replace}] for targeted changes. Re-sending the whole sheet to change two lines is how a silent regression gets introduced — the write succeeds and the loss surfaces much later as a visual bug.',
      whoseFaultItIs: 'Ours. Its existence measures where our vocabulary does not reach yet, not a mistake in your theme. Reach for a token or a treatment axis when one exists; when none does, this is the supported answer.',
    },
    tokens: TOKENS.map((t) => ({
      key: t.stem, category: t.category, purpose: PURPOSE[t.stem],
      ...(t.perSurface
        ? { perSurface: true, note: `never set site-wide; written per surface from ${SURFACE_PREFIX}<name> (see surfaces)` }
        : t.default != null ? { default: t.default } : { note: 'referenced-only — no base default; set it for a complete theme' }),
    })),
    meta: {
      name: 'the theme id (required; defaults to the site key)',
      fonts: 'optional https:// webfont stylesheet URL (emitted as <link>, never @import)',
      announce: 'optional site-wide announcement (data, not CSS). A string is a thin band at the top of every page (a string changes only the text; a link or end date already set stays). Or { text, href?, until?, off? }, the whole announcement at once (what it leaves out is cleared): href makes the text a link (a /path or https:// address); until is an end date and time WITH an offset (2026-12-01T23:59:00+08:00) — the band becomes a corner card with a countdown and the page takes it down by itself at that moment, and once it has passed a build shows nothing; off: true hides it everywhere and keeps the words for later. null clears all of it.',
      'type-scale': `optional type ratio (${TYPE_SCALE_RANGE[0]}–${TYPE_SCALE_RANGE[1]}, e.g. 1.25). With gd-font-size it DERIVES the heading sizes — h3 = size×r, h2 = size×r², h1 = size×r³ — so one number sets the whole hierarchy and it stays harmonious. Set gd-h1/h2/h3 directly only to override a step.`,
    },
    treatments: TREATMENTS.map((t) => ({
      key: t.key, values: t.values, default: t.default, purpose: t.purpose,
    })),
    // Short on purpose (a caller pays for every word at startup); fuller wording belongs in
    // whatever reference door the editor offers.
    surfaces: {
      key: `${SURFACE_PREFIX}<name> (and ${DARK_SUFFIX}), for sections marked surface=<name>`,
      solid: '#rrggbb (or #rgb/#rgba/#rrggbbaa): a full width band; the content keeps its width',
      gradient: 'anything else: custom CSS, [data-surface="<name>"] { background: … } (paints the box)',
      example: `${SURFACE_PREFIX}cream: #f3e9dc`,
    },
    schemes: {
      how: `Any token may ALSO be given a dark-scheme value by suffixing its key with "${DARK_SUFFIX}" — e.g. "gd-bg: #fdfcff" plus "gd-bg@dark: #120d1c". The unsuffixed value is the default scheme; the suffix is an OVERRIDE, so pair only the tokens that actually differ.`,
      when: 'Needed when the site sets `color-scheme: toggle` (or dark) in ir/_site.md — that gives visitors a light/dark switch, and without a paired palette the dark side would keep the light colours.',
      checked: 'verifyTheme runs the contrast checks ONCE PER SCHEME, so an illegible dark half is flagged even when the light half is perfect. Pair the SURFACES too (gd-surface, gd-border, gd-muted) — pairing only gd-bg/gd-text is the usual way a dark scheme ends up with light cards.',
    },
    rules: [
      'Use hex (#rrggbb) for colours so contrast can be checked.',
      'verifyTheme CHECKS contrast (body ≥ 4.5:1, accent-ink on accent ≥ 3:1) and FLAGS a theme that misses it — but it still ships (it is your own site; a deliberately bold/low-contrast look is your call). The flag is a heads-up, not a refusal.',
      'set_theme is the structured, born-valid TEMPLATE tier — it has no raw-CSS key by design. Bespoke CSS/JS is a separate ADVANCED path that leaves feelreef\'s born-valid guarantee (your responsibility, like hand-editing a WordPress theme). ITS ENTRY POINT: the `embed` coral — an embed `<style>`/`<script>` block is emitted verbatim and takes effect (see describe_page_grammar → customCss / corals.embed). The only hard rule is tenant isolation; your own site is yours to style.',
    ],
    example: [
      '---', 'name: warmreef', 'gd-bg: #fff7f2', 'gd-surface: #ffffff', 'gd-text: #2b2320',
      'gd-muted: #6b5d54', 'gd-accent: #c94f4f', 'gd-accent-ink: #ffffff', 'gd-border: #efe4dd',
      'gd-radius: 18px', 'fonts: https://fonts.googleapis.com/css2?family=Fraunces&display=swap', '---', '',
    ].join('\n'),
    note: 'Token names AND treatment values are authoritative — derived from the renderer\'s site.css; a name or value not listed is rejected. Tokens cover palette/type/shape; treatments are the enumerable layout switches (header/card/button/band/corner). Anything the vocabulary can\'t express is the `embed` coral (advanced, leaves born-valid).',
  };
}
