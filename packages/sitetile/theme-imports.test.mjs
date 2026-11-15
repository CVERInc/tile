// A site theme's leading `@import` rules reach the browser as import rules.
//   run: node packages/sitetile/theme-imports.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 tile#211. The layout inlines the whole theme inside `@layer reef.theme { … }`. CSS honours
// `@import` only at the top of a stylesheet and never inside a block, so a web-font stylesheet a
// site's author imported in the first line of their own CSS produced no import rule and no
// request, and nothing said so. `@font-face` in the same place worked, which made it look like
// the font host's fault.
//
// The rule this file holds (astro/src/lib/theme-imports.mjs): the `@import` rules that LEAD the
// author's CSS are emitted ahead of the layer block, in order, each one inside the theme's own
// layer; everything else is emitted exactly as before. Every expectation below is a literal
// written out by hand, never a second call to the code under test.
//
// The pure half runs regardless. The built half needs the renderer's dependencies and SAYS SO
// when they are absent — same shape as color-scheme.test.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hoistLeadingImports, splitThemeImports, CUSTOM_CSS_MARKER, THEME_LAYER } from './astro/src/lib/theme-imports.mjs';
import { styleText } from './astro/src/lib/style-text.mjs';
import { CUSTOM_CSS_MARKER as COMPILER_MARKER, compileThemeCss } from '../build/theme/theme-compile.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASTRO = join(HERE, 'astro');
const FONTS = 'https://fonts.googleapis.com/css2?family=Noto+Serif:wght@400;700&display=swap';

/** Input that must come back untouched: no imports, and the very same text. */
const untouched = (css, why) => assert.deepEqual(hoistLeadingImports(css), { imports: [], rest: css }, why ?? JSON.stringify(css));

// ── the pure half ────────────────────────────────────────────────────────────────────────────────
test('🔴 the reproduction: a web-font import in the first line is lifted, into the theme layer', () => {
  const css = `@import url("${FONTS}");\nbody { font-family: "Noto Serif", serif; }\n`;
  assert.deepEqual(hoistLeadingImports(css), {
    imports: [`@import url("${FONTS}") layer(reef.theme);`],
    rest: 'body { font-family: "Noto Serif", serif; }\n',
  });
  assert.equal(THEME_LAYER, 'reef.theme');
});

test('several imports keep their order; comments and blank lines may sit between them', () => {
  const css = [
    '/* fonts */',
    '@import url(https://a.example/one.css);',
    '',
    '/* a second; with a semicolon in the comment */ @import "https://b.example/two.css";',
    "@import url( 'https://c.example/three.css' ) ;",
    '.rule { color: red; }',
    '',
  ].join('\n');
  assert.deepEqual(hoistLeadingImports(css), {
    imports: [
      '@import url(https://a.example/one.css) layer(reef.theme);',
      '@import "https://b.example/two.css" layer(reef.theme);',
      "@import url( 'https://c.example/three.css' ) layer(reef.theme) ;",
    ],
    rest: '/* fonts */\n\n/* a second; with a semicolon in the comment */ .rule { color: red; }\n',
  });
});

test('every URL spelling: unquoted with `;` in it, quoted with `;` `)` and an escaped quote, no space after @import', () => {
  const cases = [
    [`@import url(${FONTS});`, `@import url(${FONTS}) layer(reef.theme);`],
    [`@import url("${FONTS}");`, `@import url("${FONTS}") layer(reef.theme);`],
    [`@import '${FONTS}';`, `@import '${FONTS}' layer(reef.theme);`],
    ['@import"https://a.example/x.css";', '@import"https://a.example/x.css" layer(reef.theme);'],
    ['@import url("https://a.example/a;b).css?q=\\"x\\";");', '@import url("https://a.example/a;b).css?q=\\"x\\";") layer(reef.theme);'],
    ['@import url(https://a.example/a\\).css);', '@import url(https://a.example/a\\).css) layer(reef.theme);'],
    ['@import url("https://a.example/a/*b.css");', '@import url("https://a.example/a/*b.css") layer(reef.theme);'],
    ['@IMPORT URL(https://a.example/x.css);', '@IMPORT URL(https://a.example/x.css) layer(reef.theme);'],
  ];
  for (const [input, want] of cases) {
    assert.deepEqual(hoistLeadingImports(`${input}\n.a{}`), { imports: [want], rest: '.a{}' }, input);
  }
});

test('conditions after the URL stay after the layer: media, supports(), both, with comments', () => {
  const cases = [
    ['@import url(x.css) screen and (min-width: 40em);', '@import url(x.css) layer(reef.theme) screen and (min-width: 40em);'],
    ['@import url(x.css) supports(display: grid) print;', '@import url(x.css) layer(reef.theme) supports(display: grid) print;'],
    ['@import "x.css" supports(selector(a:has(b; c)));', '@import "x.css" layer(reef.theme) supports(selector(a:has(b; c)));'],
    ['@import url(x.css) /* why; */ screen;', '@import url(x.css) layer(reef.theme) /* why; */ screen;'],
    // not the layer keyword: an identifier that merely starts with it
    ['@import url(x.css) layered;', '@import url(x.css) layer(reef.theme) layered;'],
  ];
  for (const [input, want] of cases) {
    assert.deepEqual(hoistLeadingImports(input), { imports: [want], rest: '' }, input);
  }
});

test('🔴 an import that already names a layer is not given a second one', () => {
  const cases = [
    // already the theme's layer, or one inside it: unchanged
    ['@import url(x.css) layer(reef.theme);', '@import url(x.css) layer(reef.theme);'],
    ['@import url(x.css) layer( reef.theme.fonts ) screen;', '@import url(x.css) layer( reef.theme.fonts ) screen;'],
    // a name of the author's own: inside the block it would have been reef.theme.<name>
    ['@import url(x.css) layer(fonts);', '@import url(x.css) layer(reef.theme.fonts);'],
    ['@import url(x.css) LAYER(a.b) print;', '@import url(x.css) layer(reef.theme.a.b) print;'],
    ['@import url(x.css) layer(reef.themes);', '@import url(x.css) layer(reef.theme.reef.themes);'],
    ['@import url(x.css) /* c */ layer(fonts);', '@import url(x.css) /* c */ layer(reef.theme.fonts);'],
    // the bare keyword: an anonymous layer cannot be nested from an @import, so it joins the theme's
    ['@import url(x.css) layer;', '@import url(x.css) layer(reef.theme);'],
    ['@import url(x.css) layer screen;', '@import url(x.css) layer(reef.theme) screen;'],
  ];
  for (const [input, want] of cases) {
    const got = hoistLeadingImports(input);
    assert.deepEqual(got, { imports: [want], rest: '' }, input);
    assert.equal(got.imports[0].match(/layer\(/gi).length, 1, `${input}: exactly one layer()`);
  }
  // a layer name this scanner does not vouch for (an escape, a string) is left where it was
  untouched('@import url(x.css) layer(a\\.b);\n.a{}');
  untouched('@import url(x.css) layer("a");\n.a{}');
});

test('CRLF input: the rules are lifted and their line ends go with them', () => {
  const css = '@import url(a.css);\r\n@import url(b.css)\r\n  screen;\r\n.a { color: red; }\r\n';
  assert.deepEqual(hoistLeadingImports(css), {
    imports: ['@import url(a.css) layer(reef.theme);', '@import url(b.css) layer(reef.theme)\r\n  screen;'],
    rest: '.a { color: red; }\r\n',
  });
});

test('@charset may precede the imports; it stays where it was', () => {
  assert.deepEqual(hoistLeadingImports('@charset "utf-8";\n@import url(a.css);\n.a{}'), {
    imports: ['@import url(a.css) layer(reef.theme);'],
    rest: '@charset "utf-8";\n.a{}',
  });
});

test('🔴 review: a UTF-8 byte order mark at the start is an encoding marker, not a rule', () => {
  // The reviewer's input, exactly.
  assert.deepEqual(hoistLeadingImports('\uFEFF@import url(font.css);\nbody{}'), {
    imports: ['@import url(font.css) layer(reef.theme);'],
    // The mark is dropped with the lift: left in front of `body` inside the block, it would be
    // read as part of that selector.
    rest: 'body{}',
  });
  assert.deepEqual(hoistLeadingImports('\uFEFF@charset "utf-8";\r\n@import url(a.css);\r\n.a{}'), {
    imports: ['@import url(a.css) layer(reef.theme);'],
    rest: '@charset "utf-8";\r\n.a{}',
  });
  assert.deepEqual(splitThemeImports('\uFEFF@import url(a.css);\nhtml:root { --gd-accent: red; }\n'), {
    imports: ['@import url(a.css) layer(reef.theme);'],
    css: 'html:root { --gd-accent: red; }\n',
  });
  // Nothing to lift: still the very same text, mark and all.
  untouched('\uFEFFbody{}');
  // Only the FIRST character can be an encoding marker; anywhere else it is content.
  untouched('/* c */\uFEFF@import url(a.css);\nbody{}');
  untouched('\uFEFF\uFEFF@import url(a.css);\nbody{}');
});

test('🔴 review: an import after a misplaced or repeated @charset stays where it is', () => {
  // The reviewer's input, exactly: the first import leads, the second comes after another rule.
  assert.deepEqual(hoistLeadingImports('@import url(a.css);\n@charset "utf-8";\n@import url(b.css);\nbody{}'), {
    imports: ['@import url(a.css) layer(reef.theme);'],
    rest: '@charset "utf-8";\n@import url(b.css);\nbody{}',
  });
  untouched('@charset "utf-8";\n@charset "utf-8";\n@import url(a.css);\nbody{}');
  untouched('@layer a;\n@charset "utf-8";\n@import url(a.css);\nbody{}');
  // A comment before the one leading @charset is not a rule: that @charset is still the first.
  assert.deepEqual(hoistLeadingImports('/* c */\n@CHARSET "utf-8";\n@import url(a.css);\n.a{}'), {
    imports: ['@import url(a.css) layer(reef.theme);'],
    rest: '/* c */\n@CHARSET "utf-8";\n.a{}',
  });
});

test('🔴 review: @layer statements may precede the imports; they are lifted with them, in source order', () => {
  // The reviewer's input, exactly.
  assert.deepEqual(hoistLeadingImports('@layer base, theme;\n@import url(font.css);\nbody{}'), {
    imports: ['@layer reef.theme.base, reef.theme.theme;', '@import url(font.css) layer(reef.theme);'],
    rest: 'body{}',
  });
  // Why the statement must come FIRST: layers are ordered by first declaration. Here the author put
  // `theme` below `base`; emitting the import (which declares `base`) ahead of the statement would
  // flip them. A statement after the last import precedes nothing lifted and stays in the block.
  assert.deepEqual(hoistLeadingImports('@layer theme, base;\n@import url(x.css) layer(base);\n@layer late;\nbody{}'), {
    imports: ['@layer reef.theme.theme, reef.theme.base;', '@import url(x.css) layer(reef.theme.base);'],
    rest: '@layer late;\nbody{}',
  });
  // Statements and imports may alternate; every one keeps its place in the sequence.
  assert.deepEqual(hoistLeadingImports('@import url(a.css) layer(x);\n@layer y, x;\n@import url(b.css);\n.a{}'), {
    imports: ['@import url(a.css) layer(reef.theme.x);', '@layer reef.theme.y, reef.theme.x;', '@import url(b.css) layer(reef.theme);'],
    rest: '.a{}',
  });
  // Spellings: comments in the list, case, a name already in the theme's layer, CRLF, @charset first.
  assert.deepEqual(hoistLeadingImports('@charset "utf-8";\r\n@LAYER a /* c */ , reef.theme.b,c.d;\r\n@import url(a.css);\r\n.a{}'), {
    imports: ['@layer reef.theme.a, reef.theme.b, reef.theme.c.d;', '@import url(a.css) layer(reef.theme);'],
    rest: '@charset "utf-8";\r\n.a{}',
  });
  // Not a statement this scanner vouches for, or no import after it: nothing moves.
  for (const lead of ['@layer a {}', '@layer a { .x{} }', '@layer;', '@layer ;', '@layer a b;', '@layer a,,b;', '@layer "a";', '@layer a\\.b;', '@layers a;']) {
    untouched(`${lead}\n@import url(a.css);\n.a{}`, lead);
  }
  untouched('@layer a, b;\n.a{}');
  untouched('@layer a;\n@layer b;\n');
  untouched('@layer a;\n@import url(a.css)', 'the text ends inside the import');
});

test('🔴 review: a hex escape in an unquoted url() ends with ONE whitespace, which is the escape\'s', () => {
  // The reviewer's input, exactly: `\29 ` is an escaped `)` and its terminating space.
  assert.deepEqual(hoistLeadingImports('@import url(a\\29 b.css);\nbody{}'), {
    imports: ['@import url(a\\29 b.css) layer(reef.theme);'],
    rest: 'body{}',
  });
  for (const url of ['a\\29\tb.css', 'a\\29\r\nb.css', 'a\\000029b.css', 'a\\0000291.css', 'a\\29 ', 'a\\29 \\28 b.css']) {
    assert.deepEqual(hoistLeadingImports(`@import url(${url});\n.a{}`), {
      imports: [`@import url(${url}) layer(reef.theme);`],
      rest: '.a{}',
    }, JSON.stringify(url));
  }
  // A second whitespace is the url's own, and a url() with whitespace INSIDE it is invalid.
  untouched('@import url(a\\29  b.css);\n.a{}');
  // The same escape in a quoted string: the newline that terminates it is not a raw newline.
  assert.deepEqual(hoistLeadingImports('@import "a\\29\nb.css";\n.a{}'), {
    imports: ['@import "a\\29\nb.css" layer(reef.theme);'],
    rest: '.a{}',
  });
  untouched('@import url(a.css\\');
});

test('🔴 only LEADING imports move: after any other rule, an import stays exactly where it is', () => {
  for (const css of [
    '.a { color: red; }\n@import url(a.css);\n',
    '@font-face { font-family: X; src: url(x.woff2); }\n@import url(a.css);',
    '@layer one { .a{} }\n@import url(a.css);',     // a layer BLOCK is a rule (a statement is not: see above)
    '@media print { .a{} }\n@import url(a.css);',
    '@important url(a.css);',                        // a different at-keyword
    '@import-rule url(a.css);',
    'import url(a.css);',
    '<!-- @import url(a.css); -->',
    '',
    '   \n',
    '/* only a comment */',
    '.a::before { content: "@import url(a.css);"; }',
  ]) untouched(css);
  // the leading ones go, the late one stays
  assert.deepEqual(hoistLeadingImports('@import url(a.css);\n.a{}\n@import url(b.css);\n'), {
    imports: ['@import url(a.css) layer(reef.theme);'],
    rest: '.a{}\n@import url(b.css);\n',
  });
});

test('an import this scanner cannot read ends the run: the ones before it move, it and the rest stay', () => {
  const cases = [
    '@import foo;',                                 // no URL
    '@import url(a b.css);',                        // whitespace inside an unquoted url()
    '@import url(a"b.css);',                        // a quote inside an unquoted url()
    '@import url("a.css" x);',                      // junk after the string
    '@import "a\nb.css";',                          // a raw newline ends a CSS string badly
    '@import url(a.css) { color: red; }',           // a block where the `;` should be
    '@import url(a.css) screen) ;',                 // an unbalanced parenthesis
    '@import url (a.css);',                         // `url (` is not the url function
  ];
  for (const bad of cases) {
    untouched(`${bad}\n.a{}`, bad);
    const tail = `${bad}\n@import url(late.css);\n.a{}`;
    assert.deepEqual(hoistLeadingImports(`@import url(first.css);\n${tail}`), {
      imports: ['@import url(first.css) layer(reef.theme);'],
      rest: tail,
    }, bad);
  }
});

test('🔴 text that ends inside an import (or a comment) changes nothing at all', () => {
  for (const cut of [
    '@import url(a.css)',
    '@import url(a.css) screen and (min-width: 1px',
    '@import url("a.css',
    '@import url(a.css',
    '@import "a.css',
    '@import',
    '@import ',
    '@import url(a.css) layer(fonts',
    '@import url(a.css) /* never closed',
    '/* never closed @import url(a.css);',
    '@layer a, b',
  ]) {
    untouched(cut);
    untouched(`@import url(first.css);\n${cut}`, `a complete import followed by: ${cut}`);
  }
  // An unfinished @charset as the first rule changes nothing either. After an import it is no
  // longer leading trivia but a misplaced rule, so the run ends before it is read, exactly as at
  // an unfinished style rule: the import ahead of it leads, and is lifted.
  untouched('@charset "utf-8"');
  for (const late of ['@charset "utf-8"', '.a { color: red']) {
    assert.deepEqual(hoistLeadingImports(`@import url(first.css);\n${late}`), {
      imports: ['@import url(first.css) layer(reef.theme);'],
      rest: late,
    }, late);
  }
});

test('the marker this file reads is the compiler\'s', () => {
  assert.equal(CUSTOM_CSS_MARKER, COMPILER_MARKER);
});

test('🔴 a compiled theme: the imports that lead the AUTHOR\'S CSS are lifted from behind the compiler\'s blocks', () => {
  const own = `@import url("${FONTS}");\n@import url(/fonts/local.css) layer(fonts);\nbody { font-family: "Noto Serif", serif; }\n.late { color: red; }\n@import url(late.css);`;
  const raw = compileThemeCss({ name: 'fixture', 'gd-accent': '#0a7a7c' }, own);
  const head = '/* Compiled from ir/_theme.md — do not hand-edit. Theme: fixture. */\nhtml:root {\n  --gd-accent: #0a7a7c;\n}\n\n/* reef:has-custom-css ── custom CSS, verbatim from the _theme.md body ── */\n';
  assert.ok(raw.startsWith(head), `the compiler's output changed shape:\n${raw}`);
  assert.deepEqual(splitThemeImports(raw, { compiled: true }), {
    imports: [`@import url("${FONTS}") layer(reef.theme);`, '@import url(/fonts/local.css) layer(reef.theme.fonts);'],
    css: `${head}body { font-family: "Noto Serif", serif; }\n.late { color: red; }\n@import url(late.css);\n`,
  });
  // The same text NOT declared compiled is one stylesheet, and its first rule is `html:root`.
  assert.deepEqual(splitThemeImports(raw, { compiled: false }), { imports: [], css: raw });
  assert.deepEqual(splitThemeImports(raw), { imports: [], css: raw });
  // A compiled theme with no CSS of the author's own, and one whose own CSS leads with a rule.
  for (const residue of ['', '.a { color: red; }\n@import url(late.css);']) {
    const text = compileThemeCss({ name: 'fixture', 'gd-accent': '#0a7a7c' }, residue);
    assert.deepEqual(splitThemeImports(text, { compiled: true }), { imports: [], css: text });
  }
});

test('a hand-written theme: the file itself is the stylesheet', () => {
  assert.deepEqual(splitThemeImports('@import url(a.css);\nhtml:root { --gd-accent: red; }\n'), {
    imports: ['@import url(a.css) layer(reef.theme);'],
    css: 'html:root { --gd-accent: red; }\n',
  });
  assert.deepEqual(splitThemeImports(null), { imports: [], css: '' });
  assert.deepEqual(splitThemeImports(undefined, { compiled: true }), { imports: [], css: '' });
});

test('🔴 nothing to lift ⇒ the text is returned byte for byte: the repo\'s own theme fixtures', () => {
  const fixtures = ['examples/lilac/theme.css', '../build/fixtures/theme.css'];
  for (const rel of fixtures) {
    const raw = readFileSync(join(HERE, rel), 'utf8');
    assert.ok(raw.length > 100, `${rel} is not a theme`);
    assert.ok(!/^\s*(?:\/\*[\s\S]*?\*\/\s*)*@import/i.test(raw), `${rel} now leads with an import — pick another pin`);
    for (const compiled of [false, true]) {
      assert.deepEqual(splitThemeImports(raw, { compiled }), { imports: [], css: raw }, `${rel} compiled=${compiled}`);
    }
  }
});

test('🔴 a lifted import cannot close the <style> element any more than the theme could', () => {
  const css = '@import url("https://a.example/a</style><i data-probe=x>.css");\n@import "b</STYLE >.css";\n.a{}</sTyLe>';
  const { imports, rest } = hoistLeadingImports(css);
  assert.deepEqual(imports, [
    '@import url("https://a.example/a</style><i data-probe=x>.css") layer(reef.theme);',
    '@import "b</STYLE >.css" layer(reef.theme);',
  ]);
  // The sheet as the layout assembles it, through the one sink every inline <style> uses.
  const sheet = styleText([...imports, `@layer reef.theme {\n${rest}\n}`].join('\n'));
  assert.doesNotMatch(sheet, /<\/style/i);
  assert.equal(sheet, '@import url("https://a.example/a<\\/style><i data-probe=x>.css") layer(reef.theme);\n@import "b<\\/STYLE >.css" layer(reef.theme);\n@layer reef.theme {\n.a{}<\\/sTyLe>\n}');
});

test('the layout: imports first in the theme\'s own sheet, after the layer ORDER statement\'s sheet', () => {
  const layout = readFileSync(join(ASTRO, 'src/layouts/SiteLayout.astro'), 'utf8');
  assert.ok(layout.includes("const themeSplit = splitThemeImports(themeRaw, { compiled });"), 'the layout no longer splits the RAW theme text');
  assert.ok(layout.includes("const themeCss = themeName ? stripCssComments(themeSplit.css) : '';"), 'comments must be stripped AFTER the imports are read (a URL may hold `/*`)');
  assert.ok(layout.includes("const themeCssBlock = themeName ? [...themeSplit.imports, themeLayerBlock].filter(Boolean).join('\\n') : '';"),
    'the imports must be the first thing in the theme sheet');
  const order = layout.indexOf('<style is:inline set:html={styleText(layerOrder)}></style>');
  const theme = layout.indexOf('<style is:inline set:html={styleText(themeCssBlock)}></style>');
  assert.ok(order > -1 && theme > order, 'the layer order must be declared in an earlier sheet than the theme\'s');
});

// ── the built half ───────────────────────────────────────────────────────────────────────────────
const BUILD_TIMEOUT_MS = 240_000;
const page = (kind, title) => `---\nsitetile-page: ${kind}\ntitle: ${title}\nlang: en-US\n---\n\n## Fixture\nFixture body.\n`;

/** Build a throwaway sibling copy of astro/ holding one site with this theme; return { rel → html }. */
function buildSite({ theme, siteLines = '' }) {
  const dir = mkdtempSync(join(HERE, '.smoke-theme-imports-'));
  try {
    cpSync(ASTRO, dir, { recursive: true, filter: (src) => !/[\\/](node_modules|\.astro|dist[^\\/]*)(?:[\\/]|$)/.test(src) });
    symlinkSync(join(ASTRO, 'node_modules'), join(dir, 'node_modules'), 'dir');
    for (const folder of ['content', 'blog']) {
      rmSync(join(dir, folder), { recursive: true, force: true });
      mkdirSync(join(dir, folder), { recursive: true });
    }
    writeFileSync(join(dir, 'content/_site.md'), `---\nsitetile-page: _site\ntitle: Fixture Site\nbrand: Fixture\nlang: en-US\ntheme: fixture\n${siteLines}---\n`);
    writeFileSync(join(dir, 'content/home.md'), page('home', 'Welcome'));
    writeFileSync(join(dir, 'content/about.md'), page('page', 'About'));
    writeFileSync(join(dir, 'src/themes/fixture.css'), theme);
    const dist = join(dir, 'dist-theme-imports');
    const run = spawnSync('npx', ['astro', 'build', '--outDir', dist], {
      cwd: dir, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS,
      env: { ...process.env, SITE_URL: 'https://example.com', SITE_ID: 'theme-imports-fixture', PLATFORM_ORIGIN: 'https://platform.example' },
    });
    if (run.status !== 0) throw new Error(`astro build exited ${run.status}${run.signal ? ` (${run.signal})` : ''}\n${(run.stderr || '').slice(-2000)}\n${(run.stdout || '').slice(-2000)}`);
    return new Map(['index.html', 'about/index.html', '404.html'].map((rel) => [rel, readFileSync(join(dist, rel), 'utf8')]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every inline sheet in <head>, in document order, each as the text between its tags. */
function sheetsOf(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  return [...head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}
/** The one sheet that carries the fixture theme (its token is in no other). */
function themeSheetOf(html, rel) {
  const mine = sheetsOf(html).filter((css) => css.includes('--gd-accent: #0a7a7c'));
  assert.equal(mine.length, 1, `${rel}: expected exactly one sheet carrying the theme, found ${mine.length}`);
  return mine[0];
}

const COMPILED_HEAD = '/* Compiled from ir/_theme.md — do not hand-edit. Theme: fixture. */\nhtml:root {\n  --gd-accent: #0a7a7c;\n}\n';
const MARKER_LINE = '\n/* reef:has-custom-css ── custom CSS, verbatim from the _theme.md body ── */\n';
// What the two comments leave behind once the layout strips comments: nothing but their newlines.
const STRIPPED_HEAD = '\nhtml:root {\n  --gd-accent: #0a7a7c;\n}\n\n\n';

const OWN_CSS = [
  `@import url("${FONTS}");`,
  '/* a second family */',
  `@import url(https://fonts.example/css2?family=B:wght@400;700) screen;`,
  '@import url("/fonts/local.css") layer(fonts);',
  '@import url("https://fonts.example/a</style><i data-probe=escaped>.css");',
  'body { font-family: "Noto Serif", serif; }',
  '@import url("https://fonts.example/late.css");',
  '',
].join('\n');
const LIFTED = [
  `@import url("${FONTS}") layer(reef.theme);`,
  '@import url(https://fonts.example/css2?family=B:wght@400;700) layer(reef.theme) screen;',
  '@import url("/fonts/local.css") layer(reef.theme.fonts);',
  '@import url("https://fonts.example/a<\\/style><i data-probe=escaped>.css") layer(reef.theme);',
].join('\n');
const LATE_CSS = '.first { color: red; }\n@import url("https://fonts.example/late.css");\n';
// A hand-written theme file saved with a byte order mark, whose author orders two layers of their
// own with a statement before the import that fills one of them (review findings 1 and 2).
const ORDERED_THEME = '\uFEFF@layer type, fonts;\n@import url("/fonts/x.css") layer(fonts);\nhtml:root { --gd-accent: #0a7a7c; }\n@layer type { body { font-family: serif; } }\n';

/** Layer names in the order a page DECLARES them — first appearance wins (CSS Cascade 5 §6.4) —
 *  read from the only spellings these sheets use: `@layer a, b;`, `@import … layer(a)`, and
 *  `@layer a {` blocks, whose statements and blocks inside name sublayers. Not a browser: a model
 *  of the one rule the lifted statements must not break, kept small enough to read. */
function declaredLayerOrder(sheets) {
  const order = [];
  const declare = (name) => { if (!order.includes(name)) order.push(name); };
  for (const css of sheets) {
    const stack = []; // the enclosing layer of each open brace, or null for a non-layer block
    for (const m of css.matchAll(/@layer\s+([^;{]+);|layer\(([^)]*)\)|@layer\s+([\w.-]+)\s*\{|\{|\}/g)) {
      const prefix = stack.filter(Boolean).join('.');
      const full = (n) => (prefix ? `${prefix}.${n.trim()}` : n.trim());
      if (m[1] !== undefined) m[1].split(',').forEach((n) => declare(full(n)));
      else if (m[2] !== undefined) declare(full(m[2]));
      else if (m[3] !== undefined) { declare(full(m[3])); stack.push(m[3].trim()); }
      else if (m[0] === '{') stack.push(null);
      else stack.pop();
    }
  }
  return order;
}

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log('  · theme-imports BUILT HALF SKIPPED — no packages/sitetile/astro/node_modules (run npm install there)');
} else {
  let lifted = null;
  let plain = null;
  let ordered = null;
  await test('▸ builds: a theme whose own CSS leads with imports, one with nothing to lift, one that orders its layers first', () => {
    lifted = buildSite({ theme: COMPILED_HEAD + MARKER_LINE + OWN_CSS });
    plain = buildSite({ theme: COMPILED_HEAD + MARKER_LINE + LATE_CSS, siteLines: 'dynamic-coral-css: layered\n' });
    ordered = buildSite({ theme: ORDERED_THEME });
  });

  await test('🔴 built page: a BOM-led theme\'s layer statement and import are lifted, and the author\'s layer order holds', () => {
    assert.ok(ordered, 'the site did not build');
    for (const [rel, html] of ordered) {
      const sheet = themeSheetOf(html, rel);
      assert.equal(sheet,
        '@layer reef.theme.type, reef.theme.fonts;\n@import url("/fonts/x.css") layer(reef.theme.fonts);\n@layer reef.theme {\nhtml:root { --gd-accent: #0a7a7c; }\n@layer type { body { font-family: serif; } }\n\n}',
        `${rel}: the theme sheet`);
      assert.ok(!sheet.includes('\uFEFF'), `${rel}: the byte order mark reached the page`);
      // The author declared `type` before `fonts`; on the page, inside the theme, it still is.
      assert.deepEqual(declaredLayerOrder([sheetsOf(html)[0], sheet]),
        ['reef.base', 'reef.theme', 'reef.responsive', 'reef.theme.type', 'reef.theme.fonts'], `${rel}: declared layer order`);
    }
    // Control: the same rules with the import emitted ahead of the statement — what lifting only
    // the import would produce — declare `fonts` first. The order above is not the model's default.
    assert.deepEqual(declaredLayerOrder(['@import url("/fonts/x.css") layer(reef.theme.fonts);\n@layer reef.theme {\n@layer type, fonts;\n}']),
      ['reef.theme.fonts', 'reef.theme', 'reef.theme.type']);
  });

  await test('🔴 built page: the leading imports are the first rules of the theme\'s sheet, outside the layer block', () => {
    assert.ok(lifted, 'the site did not build');
    for (const [rel, html] of lifted) {
      const sheet = themeSheetOf(html, rel);
      // The comment between the imports is not an import: it stays inside the block, and the
      // layout's comment strip leaves its line end behind (the `\n` after STRIPPED_HEAD).
      assert.equal(sheet,
        `${LIFTED}\n@layer reef.theme {\n${STRIPPED_HEAD}\nbody { font-family: "Noto Serif", serif; }\n@import url("https://fonts.example/late.css");\n\n}`,
        `${rel}: the theme sheet`);
      // Said once more as the property the browser needs: nothing but imports before the block,
      // and no lifted import left inside it.
      const block = sheet.indexOf('@layer reef.theme {');
      assert.deepEqual(sheet.slice(0, block).split('\n').filter(Boolean).map((l) => l.slice(0, 11)), Array(4).fill('@import url'), rel);
      assert.ok(!sheet.slice(block).includes('fonts.googleapis.com'), `${rel}: the web-font import is still inside the layer block`);
    }
  });

  await test('🔴 built page: the layer ORDER statement is still the first sheet, unchanged, and nothing escaped its <style>', () => {
    assert.ok(lifted, 'the site did not build');
    for (const [rel, html] of lifted) {
      const sheets = sheetsOf(html);
      assert.equal(sheets[0], '@layer reef.base, reef.theme, reef.responsive;', `${rel}: the first inline sheet`);
      assert.ok(sheets.indexOf(themeSheetOf(html, rel)) > 0, `${rel}: the theme sheet must come after the order statement`);
      // The only top-level layer names any inline sheet uses are the three the statement declared:
      // an import that kept the author's bare `layer(fonts)` would add a fourth, above them all.
      const named = new Set(sheets.flatMap((css) => [...css.matchAll(/layer\(([^)]*)\)|@layer\s+([\w.-]+)\s*\{/g)].map((m) => (m[1] ?? m[2]).trim())));      for (const name of named) assert.match(name, /^reef\.(base|theme|responsive)(\.|$)/, `${rel}: an undeclared top-level layer \`${name}\``);
      assert.equal((html.match(/<style\b/gi) || []).length, (html.match(/<\/style/gi) || []).length, `${rel}: a <style> element was closed from inside`);
      assert.ok(!html.includes('<i data-probe=escaped>.css");</style>'), rel);
      assert.equal((html.match(/data-probe=escaped/g) || []).length, 1, `${rel}: the probe must appear once, inside the theme sheet`);
    }
  });

  await test('🔴 built page: nothing to lift ⇒ the theme sheet is the wrapper it has always been, byte for byte', () => {
    assert.ok(plain, 'the site did not build');
    for (const [rel, html] of plain) {
      assert.equal(themeSheetOf(html, rel), `@layer reef.theme {\n${STRIPPED_HEAD}${LATE_CSS}\n}`, `${rel}: the theme sheet`);
      assert.equal(sheetsOf(html)[0], '@layer reef.base, reef.corals, reef.theme, reef.responsive;', `${rel}: a declaring site's order statement`);
    }
  });
}
