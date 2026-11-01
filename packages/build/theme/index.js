// @tile/build/theme — the public entrypoint of the theme compiler.
//
// One module, so what a stranger can import is a deliberate list rather than "whatever the two
// implementation files happen to export". describeThemeGrammar() is NOT here: its prose belongs to a
// hosted editor that serves it verbatim. describeTheme() is the public description.

export { compileTheme, compileThemeCss, THEME_SITE_KEYS, THEME_CSS_REL, CUSTOM_CSS_MARKER, parseLength } from './theme-compile.js';
export {
  TOKENS, TREATMENTS, META_KEYS, THEME_KEYS, DARK_KEYS, DARK_SUFFIX, SURFACE_PREFIX, TYPE_SCALE_RANGE,
  SURFACE_HEX_REASON, THEME_KEY_MAX_CHARS, THEME_VALUE_MAX_CHARS, THEME_MAX_KEYS,
  parseThemeDoc, serializeThemeDoc, residueOf, structuralIssues, sanitizeThemeMeta, unsafeReason, scopeReason,
  surfaceOf, surfaceKeysOf, surfaceNotHex, darkStemOf, schemeMeta, baselineThemeMeta, parseCssTokens,
} from './theme-schema.js';
export { truncateCssText, CSS_TEXT_ECHO_MAX_CHARS } from './css-text.js';
export { describeTheme } from './describe.js';
