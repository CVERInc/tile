// describe.js — the theme vocabulary as data, for someone holding THIS package.
//
// theme-schema.js also has describeThemeGrammar(), and it stays exactly as it is: a hosted editor
// serves its strings verbatim, and they talk about that editor's tools. This is the public twin. The
// LISTS (tokens, treatments, their values and purposes) come from the same schema, so the two can
// never disagree about what is legal; only the prose differs, and this prose names nothing but what
// this package ships — `cli.mjs` and the library.
//
// Deliberately outside theme-compile.js's import graph: whatever vendors the compiler by walking its
// imports does not pick this file up, so adding words here changes no one else's bytes.

import { TYPE_SCALE_RANGE, SURFACE_PREFIX, DARK_SUFFIX, describeThemeGrammar } from './theme-schema.js';

/** The structured theme vocabulary, with how to compile it. Pure; same answer every call. */
export function describeTheme() {
  // Only the schema-derived lists are taken from the editor's description — never its prose.
  const { tokens, treatments, surfaces } = describeThemeGrammar();
  return {
    file: 'ir/_theme.md',
    purpose: 'A site\'s look as a structured document: tokens, a few layout switches, and optional custom CSS. It compiles to the site\'s own theme.css plus a few _site.md keys, both of which travel with the site.',
    compile: {
      cli: 'node packages/build/theme/cli.mjs ir/_theme.md theme.css — writes theme.css and prints the _site.md keys the theme owns. Refuses (exit 2, writes nothing) when the theme has no usable name or when a value would be dropped; --allow-dropped compiles anyway and still lists every drop.',
      library: 'compileTheme(meta, customCss) → { name, css, siteMeta }; parseThemeDoc(md) → { meta, body }; residueOf(body) → the custom CSS; structuralIssues(meta) and sanitizeThemeMeta(meta) say what would be ignored or dropped.',
      build: 'Pass theme.css to packages/build/cli.mjs as --theme; put the printed keys in ir/_site.md (theme: is the name the build stages the stylesheet under).',
    },
    customCss: {
      what: 'Raw CSS in the _theme.md body (a fenced ```css block), for whatever the vocabulary cannot express.',
      whereItGoes: 'Appended to the compiled theme.css verbatim; only `</style` is removed.',
      whatItCosts: 'Nothing here reads inside it, so it is only as portable as CSS itself. Prefer a token or a treatment when one exists.',
    },
    tokens,
    meta: {
      name: 'the theme id (required): letters, digits, dot, dash or underscore, at most 64. Also the name the build stages theme.css under.',
      fonts: 'optional webfont stylesheet, emitted as <link> (never @import): an https:// URL with a path, or a /root/path on the site itself',
      announce: 'optional site-wide announcement text, shown as a thin band at the top of every page',
      'announce-href': 'optional link for the announcement: a /path or an https:// address',
      'announce-until': 'optional end date and time WITH an offset (2026-12-01T23:59:00+08:00): the band becomes a corner card with a countdown, and a build after that moment shows nothing',
      'announce-off': 'true hides the announcement and keeps its words in _theme.md for later',
      'type-scale': `optional type ratio (${TYPE_SCALE_RANGE[0]}–${TYPE_SCALE_RANGE[1]}, e.g. 1.25). With gd-font-size as a plain length it DERIVES h3 = size×r, h2 = size×r², h1 = size×r³. Set gd-h1/h2/h3 only to override a step.`,
    },
    treatments,
    surfaces,
    schemes: {
      how: `Any token may also carry a dark-scheme value: suffix its key with "${DARK_SUFFIX}" (gd-bg: #fdfcff and gd-bg${DARK_SUFFIX}: #120d1c). Pair only the tokens that differ.`,
      when: 'Used when ir/_site.md sets color-scheme: toggle (or dark) and the visitor is on the dark side. Pair the surfaces too (gd-surface, gd-border, gd-muted), not only gd-bg/gd-text.',
    },
    rules: [
      'Only the keys you set are emitted; everything else stays at the renderer\'s default.',
      `Surfaces (${SURFACE_PREFIX}<name>) take hex only; a gradient or image is custom CSS on [data-surface="<name>"].`,
      'A value that could break out of the stylesheet or _site.md (a line break; ; { } < > @ \\ /* */ url() in a token; a name that is not a plain filename) is dropped, never written.',
      'Use hex for colours you want to check for contrast yourself; nothing here judges taste.',
    ],
    example: [
      '---', 'name: harbour', 'gd-bg: #fbf8f3', 'gd-text: #2b2320', 'gd-accent: #b4532a',
      'gd-radius: 14px', 'button: pill', `${SURFACE_PREFIX}sand: #efe6d8`, '---', '',
    ].join('\n'),
  };
}
