// The colour arithmetic a Card's legibility rests on: sRGB, WCAG contrast, and the two derivations
// the renderer needs — which ink wins on a given ground, and how much scrim a backdrop needs before
// text over it is readable.
//
// Zero dependencies, pure functions, no DOM. It has to run in a Worker at request time and in a
// test at build time and give the same answer, because the guarantee is "constructed, not patched".
//
// 🔴 The rule this file exists to enforce:
//
//     An author may always make a card MORE legible. Never less.
//
// Taste is theirs — any ground, any accent. Legibility is ours, and it is derived rather than
// trusted: the ink direction comes from the ground's own lightness, never from an assumption about
// which way is "normal" (see --cp-accent-bright, which rescued one card's links only because its
// ground happened to be dark).

/** '#rgb' | '#rrggbb' | 'rgb(r,g,b)' → [r,g,b] 0..255, or null if it is not one of those. */
export function parseColour(input) {
  const s = String(input == null ? '' : input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [1, 2, 3].map((i) => Math.max(0, Math.min(255, Math.round(Number(m[i])))));
  return null;
}

export const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance. */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. Order does not matter. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, a p%, b)` — the exact operation the stylesheet's token ramp is built from. */
export function mix(a, b, p) {
  const t = Math.max(0, Math.min(100, p)) / 100;
  return [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t));
}

/** Compositing `over` at alpha `a` on top of `under` — what a scrim actually does. */
export const composite = (over, under, a) => mix(over, under, a * 100);

export const BODY_FLOOR = 4.5;   // WCAG AA, body text
export const LARGE_FLOOR = 3.0;  // WCAG AA, large text

/** Near-black or near-white, whichever wins on this ground. The ink direction is DERIVED. */
export function inkFor(ground) {
  const dark = [17, 17, 17], light = [255, 255, 255];
  return contrast(ground, light) >= contrast(ground, dark) ? light : dark;
}

/** True when this ground wants light ink — i.e. the card reads as a dark card. */
export const isDarkGround = (ground) => inkFor(ground)[0] > 128;

/**
 * The smallest scrim opacity (0..100) at which `ink` still clears `floor` over a backdrop of ANY
 * brightness, given the scrim is `ground` composited over the photo.
 *
 * Worst case over all possible images is one of the two extremes — a photo cannot be brighter than
 * white or darker than black — so this needs no image decode and holds for every image that will
 * ever be set. A darker photo would permit a thinner scrim; we do not compute that, because a floor
 * that depends on today's image silently stops being a floor the moment the image is swapped.
 *
 * Returns 100 if no scrim opacity works (an ink/ground pair that fails even at full opacity, which
 * means the ground itself is wrong — not something a scrim can fix).
 */
export function scrimFloor(ground, ink, floor = BODY_FLOOR) {
  const extremes = [[0, 0, 0], [255, 255, 255]];
  for (let d = 0; d <= 100; d++) {
    const a = d / 100;
    if (extremes.every((photo) => contrast(composite(ground, photo, a), ink) >= floor)) return d;
  }
  return 100;
}

// The accent a card wears when its author names none. See RAMP below for the rest.
export const DEFAULT_ACCENT = '#0a8c8e';

/** `--cp-ground` / `--cp-ink` on the dark ramp — what the scrim default is measured against. */
export const groundFrom = (accent) => palette('dark', accent).ground;
export const inkFrom = (accent) => palette('dark', accent).ink;

/**
 * The DEFAULT `backdrop-dim` for a card with this accent — the opacity at which body ink would
 * clear 4.5:1 over any image whatsoever. It comes out at 62, which is exactly the number the
 * renderer already hard-coded: the default was standing on a real floor all along.
 *
 * 🔴 It is a default and NOT a clamp, and that distinction was measured rather than reasoned:
 *
 *   - Body ink never floats. Every cell paints its own opaque surface, so the scrim is never what
 *     stands between a reader and the card's actual text.
 *   - Everything that DOES float is mid-lightness — the footer's #5a9aaa, a lane label in the
 *     creator's accent. A photograph can be brighter than a mid-tone colour or darker than it, so
 *     NO scrim opacity below 100 rescues one. Their floors compute to 87–100.
 *
 * So a "floor" on this number would have been a gate that never fires: it cannot save the text that
 * floats, and the text it could save is never exposed. What actually carries floating text is a
 * local shadow — which is what iOS does for home-screen labels under an arbitrary wallpaper, and
 * what BACKDROP_CSS now emits.
 *
 * Which leaves the scrim deciding one thing only: how much of the creator's painting shows through.
 * That is taste. Taste is never ours.
 */
export const backdropDimDefault = (accent) => scrimFloor(groundFrom(accent), inkFrom(accent));

/**
 * Resolve an author's `backdrop-dim`.
 *
 * `undefined`/`null` → the default.
 * Anything not a finite number → the default. 🔴 NOT zero, and this is the bug this function
 * exists for: `backdrop-dim: 48%` — writing the unit, a plausible slip — made Number() return NaN,
 * which made the color-mix invalid, which dropped the whole background declaration, which deleted
 * the scrim on a live card with no signal anywhere.
 * A number the author wrote → theirs, clamped to a real percentage.
 */
export function resolveBackdropDim(value, accent) {
  const fallback = backdropDimDefault(accent);
  // 🩸 THE EMPTY STRING IS "THE AUTHOR WROTE NOTHING", AND IT USED TO MEAN ZERO.
  //
  // `Number('')` is 0, and 0 is finite, so an absent key sailed past both guards below and returned
  // a scrim of nothing. The card-worker's frontmatter reader ends in `|| ''` — so EVERY card that
  // did not spell out `backdrop-dim` rendered with dim 0 while the comment one line above the call
  // site said the resolver "must be able to tell 'the author wrote 48%' from 'the author wrote
  // nothing'". It could not: the distinction was destroyed before it arrived.
  //
  // Found on 2026-08-12 by measuring, not reading: a card with NO dim emitted a 0%→18% gradient
  // while a card asking for 41 emitted 41%→59%. More dim on paper, less scrim in the page. Two
  // specimens differing in one authored field is what made it visible at all.
  if (value == null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

/**
 * Adjust a colour along lightness until it clears `floor` against EVERY background it lands on,
 * keeping its hue.
 *
 * 🔴 The direction is read off the page ground, never assumed. On a dark ground it moves toward
 * white; on a light ground, toward black. `--cp-accent-bright` used to be a flat 72% white, which
 * rescued a real card's 3.45:1 links only by luck — its ground happened to be dark. On a light ground the
 * identical move makes a bright accent worse.
 */
export function readableAccent(accent, grounds, floor = BODY_FLOOR) {
  const bgs = Array.isArray(grounds[0]) ? grounds : [grounds];
  const ok = (c) => bgs.every((b) => contrast(c, b) >= floor);
  if (ok(accent)) return accent;
  // 🔴 ALL the backgrounds it will land on, not one. A colour derived against the page ground can
  // still fail on a cell's surface — the two differ, and on a light theme the surface is the
  // BRIGHTER of the pair, so passing on one says nothing about the other. Deriving against a single
  // background left 67 of 144 sampled accents failing, and no card we own would have shown it.
  // Direction still comes from the page ground: that is what makes the card dark or light.
  const target = isDarkGround(bgs[0]) ? [255, 255, 255] : [0, 0, 0];
  for (let p = 0; p <= 100; p += 2) {
    const c = mix(target, accent, p);
    if (ok(c)) return c;
  }
  return target;      // an accent no adjustment saves: fall back to plain ink rather than to noise
}

// ── the two ramps ────────────────────────────────────────────────────────────────────────────────
//
// A Card's surfaces are `mix(accent, <neutral>)` — the accent tints everything faintly, which is
// what makes a card feel like one object rather than a grid of boxes. The DARK column is the
// Python era's, unchanged and byte-identical, because three live cards are wearing it and a
// stylesheet is not the place to re-derive a look by eye. The LIGHT column is its mirror, and it is
// NEW: the "155 deleted light rules" turned out to be Python-era application chrome (a PWA modal,
// buttons, tables) for the --carrier-* family. A Card's own tokens never had a light variant to
// restore, so this is the first one that has ever existed.
//
// On light, `surface` is BRIGHTER than `ground` — a card lifts off a grey page by being white,
// which is the grouped-list convention every phone already teaches. On dark it is the reverse.
const RAMP = {
  //                 [accent %, neutral base]
  dark: {
    ground: [8, '#0c0c0c'], surface: [10, '#161616'], 'surface-2': [15, '#1a1a1a'],
    'surface-hi': [22, '#1e1e1e'], line: [14, 'transparent'], 'line-hi': [50, 'transparent'],
    ink: [12, '#ffffff'], muted: [46, '#898989'], faint: [30, '#6a6a6a'],
    'mist-a': [11, '#0c0c0c'], 'mist-b': [0, '#0b0b0b'], 'page-ink': [28, '#cecece'],
  },
  light: {
    ground: [6, '#f2f2f2'], surface: [4, '#ffffff'], 'surface-2': [7, '#fafafa'],
    'surface-hi': [12, '#f4f4f4'], line: [26, 'transparent'], 'line-hi': [60, 'transparent'],
    ink: [10, '#181818'], muted: [34, '#5e5e5e'], faint: [26, '#878787'],
    'mist-a': [8, '#f6f6f6'], 'mist-b': [0, '#f8f8f8'], 'page-ink': [22, '#3d3d3d'],
  },
};

/**
 * Every token in a mode, resolved to actual RGB — the same arithmetic the browser will do, so a
 * test can assert contrast without a browser.
 *
 * 🔴 This is what makes the colour system testable across the whole (mode × accent) space instead
 * of on the three cards we happen to own. Three cards is a sample, and a sample ruler cannot see
 * "this would fail for somebody else's colour" — which is exactly how a 3.45:1 link shipped.
 */
export function palette(mode, accent) {
  const acc = parseColour(accent) || parseColour(DEFAULT_ACCENT);
  const out = { accent: acc };
  for (const [name, [p, base]] of Object.entries(RAMP[mode])) {
    if (base === 'transparent') continue;                       // lines are not text
    out[name] = p === 0 ? parseColour(base) : mix(acc, parseColour(base), p);
  }
  // 🔴 The four tokens that CARRY something are then pushed until they clear their floor. Which
  // floor, and against what, comes from where each one is actually used — read off the stylesheet,
  // not guessed:
  //
  //   accent-bright  chips, eyebrows, prose links   body text, and it appears on BOTH the page
  //                                                 ground and a cell's surface → the worse of the two
  //   muted          hero tagline, a cell's sub     body text, inside cells → surface
  //   page-ink       the footer                     body text, on the page → ground
  //   faint          the cell arrow                 a GRAPHIC, not text → WCAG's 3:1, not 4.5:1
  //
  // A sweep of 48 accents across the hue circle found real failures in every one of them before
  // this existed — worst 2.35:1 — and none of the three cards we own would have shown it.
  // Every background that actually backs text, read off the stylesheet: the page ground, a cell's
  // surface, and surface-2 (the hero's gradient and a hovered tile). NOT surface-hi — it is declared
  // and never used, and constraining against a background nobody sees would push a creator's colour
  // further from their own for nothing.
  const backs = [out.ground, out.surface, out['surface-2']];
  out['accent-bright'] = readableAccent(acc, backs);
  out.muted = readableAccent(out.muted, backs);
  out['page-ink'] = readableAccent(out['page-ink'], [out.ground]);
  out.faint = readableAccent(out.faint, [out.surface, out['surface-2']], LARGE_FLOOR);
  return out;
}

/** The resolved page ground for a mode+accent — what everything else is measured against. */
export const groundFor = (mode, accent) => palette(mode, accent).ground;

/**
 * The token block for one mode, as CSS declarations.
 *
 * 🔴 `--cp-accent-bright` is the link and heading colour, and it is the one token computed EXACTLY
 * rather than mixed by a fixed percentage. The accent is known at render time, so there is no
 * reason to guess: readableAccent() walks it toward white on a dark ground and toward black on a
 * light one until it clears 4.5:1, and emits the answer. The old `72%, #ffffff` was a single
 * unconditional number that happened to rescue a real card's 3.45:1 links because its ground was dark —
 * on a light ground the identical move makes a bright accent worse.
 */
const DERIVED = ['accent-bright', 'muted', 'page-ink', 'faint'];

export function tokens(mode, accent) {
  const p = palette(mode, accent);
  // Surfaces and lines stay as color-mix expressions — that keeps the DARK column byte-identical to
  // the stylesheet three live cards are already wearing, so nothing kept can have changed. The four
  // derived tokens are emitted as resolved hex, because their value depends on a contrast check
  // that CSS cannot perform.
  const out = Object.entries(RAMP[mode])
    .filter(([name]) => !DERIVED.includes(name))
    .map(([name, [pc, base]]) => `--cp-${name}:` + (pc === 0 ? base : `color-mix(in srgb,var(--cp-accent) ${pc}%,${base})`));
  for (const name of DERIVED) out.push(`--cp-${name}:${toHex(p[name])}`);
  return out.join(';');
}

/**
 * The whole theme block a page carries.
 *
 * No `mode` → both ramps, selected by `prefers-color-scheme`, with DARK as the fallback so a
 * browser that reports nothing sees exactly what it sees today. The reader decides, which is the
 * web's own answer and the reason the light ramp had to exist at all rather than stay a TODO.
 * A `mode` → that one, pinned: an author who states a ground has stated it.
 */
export function themeCss(mode, accent) {
  // 🔴 card.css hard-codes `html{background-color:#0a1628}` — the Python era's deep blue. The body's
  // own gradient covers it everywhere the body reaches, so it was invisible and stayed. It is not:
  // `scrollbar-gutter: stable` reserves a strip the body never paints, and on a light card that
  // strip is a black bar down the right-hand edge. Found by looking at a screenshot; no contrast
  // measurement would ever have pointed at it, because there is no text in a scrollbar gutter.
  // 🔴 …and `background-image:none` with it. card.css also carries a five-stop deep-ocean gradient
  // (#0a1628 → #0d2847 → #0f3460 → #1a5276 → #1e6f8e) on the same element — the Python era's REEF
  // palette, hard-coded and completely unrelated to the creator's accent. Measured, it is still laid
  // down full-page (1189×965 on one card, 1200×2375 on another); the body's derived radial covers it
  // everywhere the body reaches, which is exactly why it survived this long unnoticed.
  //
  // It is removed here rather than in card.css because this function is where the page's colour is
  // DECIDED. Leaving a second, contradictory answer painted underneath — and relying on something
  // else to cover it — is how #0a1628 came to be a black bar in a scrollbar gutter on light cards.
  const page = (m) => `html{background-color:var(--cp-ground);background-image:none}`;
  if (mode) return `:root{color-scheme:${mode};${tokens(mode, accent)}}${page(mode)}`;
  return `:root{color-scheme:light dark;${tokens('dark', accent)}}${page('dark')}`
    + `@media(prefers-color-scheme:light){:root{${tokens('light', accent)}}}`;
}
