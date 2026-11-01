// css-text.js — the one cap on how much caller-supplied text a theme answer echoes back.
//
// A theme key or a CSS selector arrives from whoever wrote the theme, and nothing upstream bounds
// its length. When a structural issue (or an editor's measurement row) names it, the name rides
// back verbatim — so one 20 KB key becomes a 20 KB answer, per mention. This cuts it, marks the cut
// with `…`, and changes nothing about WHICH key or rule is being reported, only how much of its own
// text comes along.
//
// Kept in its own file because more than the theme schema uses it: an editor that measures a
// theme's custom CSS echoes selectors under the same cap, and two copies of one number are two
// numbers.

/** Max chars of caller-supplied key / selector / rule text echoed back verbatim. */
export const CSS_TEXT_ECHO_MAX_CHARS = 200;

/** Truncate one owner-authored CSS selector/rule-text string before it rides in an answer — see
 *  CSS_TEXT_ECHO_MAX_CHARS. Pure; `null`/`undefined` pass through unchanged. */
export function truncateCssText(s) {
  if (s == null) return s;
  const str = String(s);
  return str.length > CSS_TEXT_ECHO_MAX_CHARS ? `${str.slice(0, CSS_TEXT_ECHO_MAX_CHARS)}…` : str;
}
