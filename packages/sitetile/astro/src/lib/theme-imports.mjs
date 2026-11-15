// theme-imports — lift a site theme's leading `@import` rules out of the `@layer reef.theme { … }`
// block the layout wraps the theme in.
//
// CSS accepts `@import` only at the top of a stylesheet: before every other rule except `@charset`
// and `@layer` statements, and never inside a block. The layout inlines the whole theme inside a
// layer BLOCK, so an `@import` the site's author put first in their CSS (a web-font stylesheet,
// usually) was dropped by the browser without a word: no import rule, no request.
//
// What is lifted is exactly what a stylesheet of the author's own would have honoured: the
// `@import` rules that LEAD the text, with only whitespace, comments and `@charset` before or
// between them. An `@import` after any other rule is invalid CSS in every stylesheet and stays
// where it is. So does everything after the first thing this scanner does not recognise as a
// complete import: a rule it cannot read is left for the browser to judge, as it always was.
//
// Each lifted rule is placed in the theme's own layer, so the imported rules sit in the cascade
// where the rest of the theme sits:
//
//   @import url(x);               →  @import url(x) layer(reef.theme);
//   @import url(x) screen;        →  @import url(x) layer(reef.theme) screen;
//   @import url(x) layer(fonts);  →  @import url(x) layer(reef.theme.fonts);
//   @import url(x) layer;         →  @import url(x) layer(reef.theme);
//   @import url(x) layer(reef.theme[.…]);   unchanged
//
// `layer(fonts)` inside the block would have named `reef.theme.fonts`, so that is the name it gets
// outside it; left as `fonts` it would become a NEW top-level layer, declared after
// `reef.responsive` and therefore above it. The bare keyword (an anonymous layer) has no spelling
// that nests under a named layer from an `@import`, so it joins `reef.theme` itself.
//
// No CSS parser dependency: the scanner below reads only as much grammar as an import's prelude
// has (strings, `url()` quoted and unquoted, comments, parentheses, escapes) and refuses anything
// else. Nothing is sanitised and nothing new is accepted; the lifted text goes through the same
// `styleText` sink as the rest of the theme.

export const THEME_LAYER = 'reef.theme';
/** The theme compiler's machine marker (packages/build/theme/theme-compile.js CUSTOM_CSS_MARKER):
 *  the comment carrying it is the last thing before the author's own CSS in a compiled theme. */
export const CUSTOM_CSS_MARKER = 'reef:has-custom-css';

const WS = new Set([' ', '\t', '\n', '\r', '\f']);
const NEWLINE = new Set(['\n', '\r', '\f']);
const isIdentChar = (c) => c !== undefined && (/[-\w\\]/.test(c) || c.charCodeAt(0) > 127);
const LAYER_NAME = /^-?[A-Za-z_][\w-]*(?:\.-?[A-Za-z_][\w-]*)*$/;

// Outcomes of reading one construct: an index (where it ends), INVALID (not something this scanner
// vouches for — stop lifting here), or EOF (the text ended inside it — lift nothing at all).
const INVALID = -1;
const EOF = -2;

/** Past whitespace and complete comments. An unterminated comment is EOF. */
function skipTrivia(s, i) {
  for (;;) {
    while (WS.has(s[i])) i += 1;
    if (s[i] === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      if (end === -1) return EOF;
      i = end + 2;
    } else return i;
  }
}

/** `s[i]` is a quote; the index after the matching one. A raw newline ends a CSS string badly. */
function readString(s, i) {
  const quote = s[i];
  for (let j = i + 1; j < s.length; j += 1) {
    const c = s[j];
    if (c === '\\') { if (s[j + 1] === '\r' && s[j + 2] === '\n') j += 1; j += 1; continue; }
    if (c === quote) return j + 1;
    if (NEWLINE.has(c)) return INVALID;
  }
  return EOF;
}

/** `s[i]` is the first character after `url(`; the index after the closing `)`. */
function readUrl(s, i) {
  let j = i;
  while (WS.has(s[j])) j += 1;
  if (s[j] === '"' || s[j] === "'") {
    j = readString(s, j);
    if (j < 0) return j;
    while (WS.has(s[j])) j += 1;
    if (j >= s.length) return EOF;
    return s[j] === ')' ? j + 1 : INVALID;
  }
  for (; j < s.length; j += 1) {
    const c = s[j];
    if (c === ')') return j + 1;
    if (c === '\\') { if (NEWLINE.has(s[j + 1])) return INVALID; j += 1; continue; }
    if (c === '"' || c === "'" || c === '(') return INVALID;
    if (WS.has(c)) {
      while (WS.has(s[j])) j += 1;
      if (j >= s.length) return EOF;
      return s[j] === ')' ? j + 1 : INVALID;
    }
  }
  return EOF;
}

/** From `i`, the index after the `;` that ends this statement. Strings, comments and parentheses
 *  are read as such, so a `;` inside any of them does not end it; a brace means this is not a
 *  statement at all. */
function readToSemicolon(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j += 1) {
    const c = s[j];
    if (c === '"' || c === "'") { j = readString(s, j); if (j < 0) return j; j -= 1; continue; }
    if (c === '/' && s[j + 1] === '*') {
      const end = s.indexOf('*/', j + 2);
      if (end === -1) return EOF;
      j = end + 1; continue;
    }
    if (c === '\\') { j += 1; continue; }
    if (c === '(') { depth += 1; continue; }
    if (c === ')') { depth -= 1; if (depth < 0) return INVALID; continue; }
    if (c === '{' || c === '}') return INVALID;
    if (c === ';' && depth === 0) return j + 1;
  }
  return EOF;
}

const startsWithWord = (s, i, word) => s.slice(i, i + word.length).toLowerCase() === word;

/** `s[i]` starts `@import`. → { end, text } (text = the rule as it is emitted, in the theme
 *  layer), or INVALID / EOF. */
function readImport(s, i) {
  let j = skipTrivia(s, i + '@import'.length);
  if (j < 0) return j;
  let urlEnd;
  if (s[j] === '"' || s[j] === "'") urlEnd = readString(s, j);
  else if (startsWithWord(s, j, 'url(')) urlEnd = readUrl(s, j + 4);
  else return j >= s.length ? EOF : INVALID;
  if (urlEnd < 0) return urlEnd;

  // The optional layer comes straight after the URL, before any supports()/media condition.
  const k = skipTrivia(s, urlEnd);
  if (k < 0) return k;
  let head; // the rule up to and including its layer
  let tail; // where the rest of the prelude starts
  if (startsWithWord(s, k, 'layer') && s[k + 5] === '(') {
    const close = s.indexOf(')', k + 6);
    if (close === -1) return EOF;
    const name = s.slice(k + 6, close).trim();
    if (!LAYER_NAME.test(name)) return INVALID;
    const own = name === THEME_LAYER || name.startsWith(`${THEME_LAYER}.`);
    head = s.slice(i, k) + (own ? s.slice(k, close + 1) : `layer(${THEME_LAYER}.${name})`);
    tail = close + 1;
  } else if (startsWithWord(s, k, 'layer') && !isIdentChar(s[k + 5])) {
    head = `${s.slice(i, k)}layer(${THEME_LAYER})`;
    tail = k + 5;
  } else {
    head = `${s.slice(i, urlEnd)} layer(${THEME_LAYER})`;
    tail = urlEnd;
  }
  const end = readToSemicolon(s, tail);
  if (end < 0) return end;
  return { end, text: head + s.slice(tail, end) };
}

/**
 * The `@import` rules that lead `css`, lifted out of it.
 * @param {string} css  a stylesheet's text (comments still in it)
 * @returns {{ imports: string[], rest: string }}  `imports` in source order, each rewritten into
 *   the theme layer; `rest` is `css` without them. Nothing to lift ⇒ `rest === css`, byte for byte.
 */
export function hoistLeadingImports(css) {
  const s = String(css ?? '');
  const none = { imports: [], rest: s };
  const found = [];
  let i = 0;
  for (;;) {
    i = skipTrivia(s, i);
    if (i === EOF) return none;
    if (s[i] !== '@') break;
    if (startsWithWord(s, i, '@charset') && !isIdentChar(s[i + 8])) {
      const end = readToSemicolon(s, i + 8);
      if (end === EOF) return none;
      if (end === INVALID) break;
      i = end;
      continue;
    }
    if (!startsWithWord(s, i, '@import') || isIdentChar(s[i + 7])) break;
    const rule = readImport(s, i);
    if (rule === EOF) return none;
    if (rule === INVALID) break;
    found.push({ start: i, ...rule });
    i = rule.end;
  }
  if (found.length === 0) return none;
  let rest = '';
  let at = 0;
  for (const f of found) {
    rest += s.slice(at, f.start);
    at = f.end;
    // the line the rule ended, so lifting it does not leave a blank one behind
    if (s[at] === '\r' && s[at + 1] === '\n') at += 2;
    else if (s[at] === '\n') at += 1;
  }
  return { imports: found.map((f) => f.text), rest: rest + s.slice(at) };
}

/**
 * A theme file's text, split into the imports to emit ahead of the layer block and the CSS that
 * goes inside it.
 *
 * Two places can lead with imports: the file itself (a hand-written theme), and — in a COMPILED
 * theme — the author's own CSS, which the compiler appends verbatim after its token blocks and a
 * marker comment. That second place is the "top of my CSS" a site's author can actually see, and
 * the compiler's blocks ahead of it are not theirs, so it is read as a stylesheet of its own.
 *
 * @param {string} themeRaw  the theme file, comments still in it
 * @param {{ compiled?: boolean }} [opts]  whether the file carries the compiler's header
 * @returns {{ imports: string[], css: string }}  nothing to lift ⇒ `css === themeRaw`.
 */
export function splitThemeImports(themeRaw, { compiled = false } = {}) {
  const lead = hoistLeadingImports(themeRaw);
  if (!compiled) return { imports: lead.imports, css: lead.rest };
  // The comment that carries the marker, found the way the layout's comment strip finds comments,
  // so the two agree on where it ends.
  for (const m of lead.rest.matchAll(/\/\*[\s\S]*?\*\//g)) {
    if (!m[0].includes(CUSTOM_CSS_MARKER)) continue;
    const cut = m.index + m[0].length;
    const own = hoistLeadingImports(lead.rest.slice(cut));
    return { imports: [...lead.imports, ...own.imports], css: lead.rest.slice(0, cut) + own.rest };
  }
  return { imports: lead.imports, css: lead.rest };
}
