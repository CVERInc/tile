// Which colour schemes a page tells the browser it supports, read from the site's own statement.
//
// 🩸 reef#3262. A site whose theme carried dark-mode styles switched its own colours under a
// dark OS and never told the browser: no `<meta name="color-scheme">`, no `color-scheme` property.
// The browser draws its own parts — the canvas behind the page, scrollbars, native form controls,
// the system colours — for the scheme the page DECLARES, and an undeclared page is light. So the
// page was dark and its scrollbar track was white.
//
// The statement is the `color-scheme` key (`ir/_site.md`, or one page's own frontmatter):
//   color-scheme: light        this design is light only
//   color-scheme: dark         this design is dark only
//   color-scheme: light dark   this design follows the visitor's OS setting, both ways
//   color-scheme: toggle       the site carries a light/dark switch (handled by the layout)
// Absent, or anything else, declares nothing and the page is byte-for-byte what it was.
//
// 🔴 The key is the ONLY source. Nothing here, and nothing that calls it, reads CSS text to find
// out whether a theme "has dark styles". A theme can hold an `@media (prefers-color-scheme: dark)`
// rule that darkens one banner; declaring `light dark` for that site would turn its canvas, its
// scrollbars and every unstyled control dark under a design that is otherwise light — worse than
// declaring nothing. Which schemes a design supports is a fact about the design, and only its
// author has it.

const SCHEMES = ['light', 'dark'];

/** `light`, `dark`, `light dark`, or '' (declare nothing). Order and case are normalised; a value
 *  with any other word, a repeated word, or punctuation is not a declaration. The result is one
 *  of three literals, so it is safe to place in an attribute or a stylesheet as it stands. */
export function declaredColorScheme(value) {
  if (typeof value !== 'string') return '';
  const words = value.trim().replace(/^(["'])(.*)\1$/, '$2').trim().toLowerCase().split(/\s+/);
  if (words.length < 1 || words.length > SCHEMES.length) return '';
  if (new Set(words).size !== words.length || !words.every((w) => SCHEMES.includes(w))) return '';
  return SCHEMES.filter((s) => words.includes(s)).join(' ');
}

/** The sheet for a declared value: the property on :root, in the renderer's base layer — the
 *  site's theme lives in a later layer, so a theme that sets `color-scheme` itself still wins. */
export function colorSchemeCss(declared) {
  return declared === 'light' || declared === 'dark' || declared === 'light dark'
    ? `@layer reef.base{:root{color-scheme:${declared}}}` : '';
}

/** The sheet for a `toggle` site. The switch stamps `data-theme` on <html> before first paint (the
 *  saved choice, else the OS setting), and the palette follows that attribute — so the declaration
 *  does too. A meta cannot say this (it knows the OS, not the visitor's saved choice), which is why
 *  a toggle page carries no meta; with scripts off there is no attribute and nothing is declared. */
export const TOGGLE_COLOR_SCHEME_CSS = '@layer reef.base{:root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}}';
