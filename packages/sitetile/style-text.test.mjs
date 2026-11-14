// styleText — inline <style> text that cannot close its element (astro/src/lib/style-text.mjs),
// and the census that every `<style set:html>` sink in the renderer goes through it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { censusSource, loadAstroParse, offsetUnit, rangeProblem, SRC } from './style-sink-census.mjs';
import { styleText } from './astro/src/lib/style-text.mjs';

test('no `</style` survives, in any case, however it is nested', () => {
  for (const css of ['a{}</style>b{}', 'a{}</STYLE>', 'a{}</sTyLe >', 'a{}</sty</stylele>', '</style</style']) {
    assert.doesNotMatch(styleText(css), /<\/style/i, JSON.stringify(css));
  }
});

test('the neutralised text is a fixed point', () => {
  const once = styleText('a{}</sty</STYLEle></style>');
  assert.equal(styleText(once), once);
});

test('legitimate CSS is byte-identical', () => {
  const css = [
    '@import url("/fonts/x.css");',
    '.a::before { content: "<b> 1 < 2"; }',
    '.b { background: url("/img/x.png"); }',
    '.c { background: url(data:image/svg+xml,%3Csvg%3E); }',
    '<!-- .d { color: red; } -->',
    '@layer reef.theme {\n.e { color: red; }\n}',
  ].join('\n');
  assert.equal(styleText(css), css);
});

test('null/undefined are the empty string', () => {
  assert.equal(styleText(undefined), '');
  assert.equal(styleText(null), '');
});

// Every inline <style> the renderer fills with set:html must route its text through styleText,
// including any added later. The census reads each `.astro` file through the Astro compiler's own
// parser (style-sink-census.mjs says what it checks and why it no longer reads text).
// The parser comes from the renderer's dependencies. If they are installed and it still cannot
// load, the census FAILS. If they are not installed at all (a bare checkout; scripts/test.sh names
// that run as one that skipped the renderer), the census tests are SKIPPED by name, and in CI
// (which installs them) their absence is a failure: a census that cannot look never reports that
// it found nothing.
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.astro') ? [p] : []);
});
const parserLoad = loadAstroParse().then((parse) => ({ parse }), (error) => ({ error }));
const BARE = !existsSync(join(SRC, '..', 'node_modules')) && !process.env.CI;
const SKIP = BARE && 'STYLE-SINK CENSUS SKIPPED: no packages/sitetile/astro/node_modules, so the Astro parser is absent (run npm install there)';
if (SKIP) console.log(`# ${SKIP}`);
async function astroParse() {
  const { parse, error } = await parserLoad;
  if (error) assert.fail(`the style-sink census cannot load the Astro parser (@astrojs/compiler-rs via packages/sitetile/astro/node_modules): ${error.message}`);
  return parse;
}
const FILES = walk(SRC);
const CENSUSED = new Set(FILES);
const FIXTURE = join(SRC, 'components', 'Fixture.astro');
// Every fixture gets the canonical import, so a rejection below is about the sink's shape and not
// merely about a missing import.
const HEAD = "---\nimport { styleText } from '../lib/style-text.mjs';\nimport SiteLayout from '../layouts/SiteLayout.astro';\nconst authorCss = 'a{}</style><i>injected</i>';\nconst x = 1;\n---\n";
const run = (parse, body, head = HEAD) => censusSource(head + body, parse, { file: FIXTURE, censused: CENSUSED });

const SHAPE = /is not set:html=\{styleText/;
const NOT_PLAIN = /not a plain element/;
const UNPROVEN = /cannot prove is not style/;
const PARSE = /parse diagnostic|parse\(\) threw/;
const BOUND = /`styleText` is bound or used here/;

test('census: every non-canonical sink shape is rejected, for the reason it is wrong', { skip: SKIP }, async () => {
  const parse = await astroParse();
  const unsafe = [
    // rounds 2–4 (the text scanner's regression list, unchanged)
    ['<style is:inline set:html = {authorCss}></style>', SHAPE],
    ['<style is:inline data-label=">" set:html={authorCss}></style>', SHAPE],
    ['<style set:html={authorCss}></style>', SHAPE],
    ['<style is:inline data-x={`a${`"`}z`} set:html={authorCss}/>', SHAPE],
    ['<style is:inline data-x={x /* } " */} set:html={authorCss}/>', SHAPE],
    ['<style is:inline set:html={styleText("") + authorCss}/>', SHAPE],
    ['<style is:inline set:html={styleText(a)(b)}/>', SHAPE],
    ['<style is:inline data-label="</style>" set:html={authorCss}></style>', SHAPE],
    ['<style is:inline data-x={"</style>"} set:html={authorCss}></style>', SHAPE],
    ['<style is:inline data-x={x /* </style */} set:html={authorCss}></style>', SHAPE],
    ['<style data-x="<i" set:html={authorCss}></style>', SHAPE],
    // round 4: attribute text impersonating a non-style opening tag
    ['<style is:inline data-x={"<div a={"} set:html={authorCss}></style>', SHAPE],
    ['<style is:inline data-x={`<div a={`} set:html={authorCss}></style>', SHAPE],
    ['<style is:inline data-x={x /* <div a={ */} set:html={authorCss}></style>', SHAPE],
    // shapes the AST makes it possible to name
    ['<STYLE set:html={authorCss}></STYLE>', SHAPE],
    ['<svg><style set:html={authorCss}/></svg>', SHAPE],
    ['{[authorCss].map((c) => <style is:inline set:html={c}/>)}', SHAPE],
    ['<style set:html="a{}"/>', SHAPE],
    ['<style set:html/>', SHAPE],
    ['<style set:html={styleText(authorCss[0])}/>', SHAPE],
    ['<style set:html={styleText?.(authorCss)}/>', SHAPE],
    ['<style set:html={styleText(authorCss, x)}/>', SHAPE],
    ['<style set:html={styleText(String(authorCss))}/>', SHAPE],
    ['<style set:html={styleText(authorCss)} set:html={authorCss}/>', /carries 2 set:html/],
    ['<style {...{}} set:html={styleText(authorCss)}/>', /spread attributes/],
    // a tag the AST cannot prove is not style
    ['<Tag set:html={authorCss}/>', NOT_PLAIN],
    ['<Tag.X set:html={authorCss}/>', NOT_PLAIN],
    ['<SiteLayout set:html={authorCss}/>', NOT_PLAIN],
    ['<Tag><Fragment set:html={authorCss}/></Tag>', UNPROVEN],
    ['<Tag><div set:html={authorCss}/></Tag>', UNPROVEN],
    ['<Tag><slot/></Tag>', UNPROVEN],
    // round 5: an imported component's name shadowed by a binding that makes the tag "style"
    ['{((SiteLayout) => <SiteLayout><Fragment set:html={authorCss}/></SiteLayout>)("style")}', UNPROVEN],
    ['{((SiteLayout) => <SiteLayout><div set:html={authorCss}/></SiteLayout>)("style")}', UNPROVEN],
    ['{((SiteLayout) => <SiteLayout><slot/></SiteLayout>)("style")}', UNPROVEN],
    ['{(({ SiteLayout }) => <SiteLayout><div set:html={authorCss}/></SiteLayout>)({ SiteLayout: "style" })}', UNPROVEN],
    ['{["style"].map((SiteLayout) => <SiteLayout><Fragment set:html={authorCss}/></SiteLayout>)}', UNPROVEN],
    ['{((SiteLayout) => <SiteLayout set:html={authorCss}/>)("style")}', NOT_PLAIN],
    ['{((Fragment) => <Fragment set:html={authorCss}/>)("style")}', NOT_PLAIN],                       // the same rule for the built-in
    ['{((Fragment) => <Fragment><div set:html={authorCss}/></Fragment>)("style")}', UNPROVEN],
    // the parser is the judge: if it complains, the census fails
    ['<div set:html={authorCss}', PARSE],
  ];
  for (const [body, why] of unsafe) {
    const { failures } = run(parse, body);
    assert.ok(failures.length >= 1, `unsafe sink accepted: ${body}`);
    assert.ok(failures.some((f) => why.test(f.reason)), `${body}\n  rejected, but not for ${why}: ${JSON.stringify(failures)}`);
  }
});

test('census: `styleText` must be the real helper, not a local of the same name', { skip: SKIP }, async () => {
  const parse = await astroParse();
  const sink = '<style is:inline set:html={styleText(authorCss)}></style>';
  const heads = [
    ["---\nconst authorCss = 'x';\nconst styleText = (c) => c;\n---\n", BOUND],                       // the r4 fixtures' own frontmatter
    ["---\nimport { styleText } from './style-text.mjs';\nconst authorCss = 'x';\n---\n", BOUND],     // a different module
    ["---\nimport { identity as styleText } from '../lib/style-text.mjs';\nconst authorCss = 'x';\n---\n", BOUND],
    ["---\nconst authorCss = 'x';\n---\n", /not the named import/],                                     // no import at all
    [HEAD.replace('const x = 1;', 'let y = (styleText) => styleText;'), BOUND],                         // a shadowing parameter
    // round 6: a type-only import binds nothing at runtime, whether `type` is on the declaration
    // or on the specifier, so the call reaches whatever global has that name
    ["---\nimport type { styleText } from '../lib/style-text.mjs';\nconst authorCss = 'x';\n---\n", /not the named import|bound or used/],
    ["---\nimport { type styleText } from '../lib/style-text.mjs';\nconst authorCss = 'x';\n---\n", /not the named import|bound or used/],
  ];
  for (const [head, why] of heads) {
    const { failures } = run(parse, sink, head);
    assert.ok(failures.some((f) => why.test(f.reason)), `${head}\n  not rejected for ${why}: ${JSON.stringify(failures)}`);
  }
  assert.ok(run(parse, '{((styleText) => <style set:html={styleText(authorCss)}/>)((c) => c)}').failures.some((f) => BOUND.test(f.reason)),
    'a template-level parameter named styleText shadows the import');
  // the reviewer's round-6 fixture, byte for byte: Astro erases the import and calls the global
  const typeSpecifier = "---\nimport { type styleText } from '../lib/style-text.mjs';\nglobalThis['styleText'] = (c) => c;\nconst authorCss = 'a{}</style><i data-probe=\"escaped\">injected</i>';\n---\n<style is:inline set:html={styleText(authorCss)}/>";
  const typed = censusSource(typeSpecifier, parse, { file: FIXTURE, censused: CENSUSED });
  assert.deepEqual(typed.sinks, [], `a type-only specifier was accepted as the helper: ${JSON.stringify(typed)}`);
  assert.ok(typed.failures.length >= 1, 'a type-only specifier was accepted as the helper');
  // the reviewer's round-4 fixtures, byte for byte
  for (const v of ['"<div a={"', '`<div a={`', 'x /* <div a={ */']) {
    const src = `---\nconst authorCss = "a{}</style><i data-probe=escaped>injected</i>";\nconst x = 1;\nconst a = "";\nconst styleText = x => x;\n---\n<style is:inline data-x={${v}} set:html={authorCss}></style>`;
    const { failures } = censusSource(src, parse, { file: FIXTURE, censused: CENSUSED });
    assert.ok(failures.some((f) => SHAPE.test(f.reason)), `reviewer fixture accepted: ${v}`);
  }
});

test('census: the canonical shapes are accepted, and so are sinks the AST proves are not style', { skip: SKIP }, async () => {
  const parse = await astroParse();
  const safe = [
    '<style is:inline set:html = { styleText(authorCss) }></style>',
    '<style data-x="ok" data-y={"<div a={"} set:html={styleText(theme.css)}></style>',
    '{x && <style is:inline set:html={styleText(authorCss)}></style>}',
    '<div set:html={authorCss}></div><Fragment set:html={authorCss}/>',
    '<SiteLayout><section><Fragment set:html={authorCss}/></section></SiteLayout>',
    '<section><slot/></section>',
  ];
  for (const body of safe) assert.deepEqual(run(parse, body).failures, [], body);
  assert.deepEqual(run(parse, safe[0] + safe[1]).sinks.map((s) => s.arg), ['authorCss', 'theme.css']);
});

test('census: an imported component shadowed in the frontmatter is not trusted either', { skip: SKIP }, async () => {
  const parse = await astroParse();
  const body = '<SiteLayout><div set:html={authorCss}/></SiteLayout>';
  for (const extra of ['const SiteLayout2 = 1;\nfunction f(SiteLayout) { return SiteLayout; }', 'const { SiteLayout: S } = { SiteLayout: 1 };',
    "import SiteLayout2 from '../layouts/SiteLayout.astro';\nconst alias = SiteLayout;"]) {
    const { failures } = run(parse, body, HEAD.replace('const x = 1;', extra));
    assert.ok(failures.some((f) => UNPROVEN.test(f.reason)), `${extra}\n  shadowed component still trusted: ${JSON.stringify(failures)}`);
  }
  // a second binding of the same name by another .astro import is not trusted either
  const twice = HEAD.replace('const x = 1;', "import SiteLayout from '../layouts/SiteLayout.astro';");
  assert.ok(run(parse, body, twice).failures.length >= 1, 'a name bound by two imports is trusted');
  // a type-only import binds no runtime component
  const typeOnly = HEAD.replace("import SiteLayout from", "import type SiteLayout from");
  assert.ok(run(parse, body, typeOnly).failures.some((f) => UNPROVEN.test(f.reason)), 'a type-only import is trusted as a component');
  // the control: the same body with the plain import alone is accepted
  assert.deepEqual(run(parse, body).failures, [], 'the unshadowed import is no longer accepted');
});

// 🩸 Round 5: node offsets were cut as UTF-8 bytes; compiler-rs 0.5 reports UTF-16 indices, so
// every sink after a non-ASCII character was misread. Both conventions are exercised here: the
// installed parser as it is, and the same parser with its offsets rewritten into the other unit.
const toByteOffsets = (parse) => (src) => {
  const r = parse(src);
  const at = (i) => Buffer.byteLength(src.slice(0, i), 'utf8');
  const fix = (n) => {
    if (Array.isArray(n)) { n.forEach(fix); return; }
    if (!n || typeof n !== 'object') return;
    if (typeof n.start === 'number') n.start = at(n.start);
    if (typeof n.end === 'number') n.end = at(n.end);
    for (const k of Object.keys(n)) if (n[k] && typeof n[k] === 'object') fix(n[k]);
  };
  fix(r.ast);
  return r;
};
const toCodeUnitOffsets = (parse) => (src) => {
  const r = parse(src);
  const bytes = Buffer.from(src, 'utf8');
  const at = (b) => bytes.subarray(0, b).toString('utf8').length;
  const fix = (n) => {
    if (Array.isArray(n)) { n.forEach(fix); return; }
    if (!n || typeof n !== 'object') return;
    if (typeof n.start === 'number') n.start = at(n.start);
    if (typeof n.end === 'number') n.end = at(n.end);
    for (const k of Object.keys(n)) if (n[k] && typeof n[k] === 'object') fix(n[k]);
  };
  fix(r.ast);
  return r;
};

test('census: positions and arguments are read correctly after non-ASCII text', { skip: SKIP }, async () => {
  const parse = await astroParse();
  const unit = offsetUnit(parse);
  assert.ok(unit === 'utf16' || unit === 'utf8', `the installed parser's offset unit is unrecognised: ${unit}`);
  // the other convention, built from the same parser
  const other = unit === 'utf16' ? toByteOffsets(parse) : toCodeUnitOffsets(parse);
  assert.equal(offsetUnit(other), unit === 'utf16' ? 'utf8' : 'utf16', 'the offset probe does not tell the two conventions apart');
  const head = "---\nimport { styleText } from '../lib/style-text.mjs';\nconst css = 'a{}';\n---\n";
  for (const p of [parse, other]) {
    for (const prefix of ['<!-- a -->', '<!-- \u6f22 -->', '<!-- \u{1F9F8} -->', '<p>\u6f22\u5b57 \u{1F9F8}\u{1F9F8}</p>\n<p>caf\u00e9</p>',
      '<p data-x="\ud800">\udc00</p>', '<p data-x={"\udc00"}>x</p>']) {
      const src = `${head}${prefix}\n<style is:inline set:html={styleText(css)}></style>`;
      const line = src.split('\n').length;
      const r = censusSource(src, p, { file: FIXTURE, censused: CENSUSED });
      assert.deepEqual(r, { sinks: [{ line, arg: 'css' }], failures: [] }, `${offsetUnit(p)} offsets, prefix ${JSON.stringify(prefix)}`);
      // and an unsafe sink in the same place is rejected with its own text quoted
      const bad = censusSource(src.replace('styleText(css)', 'css'), p, { file: FIXTURE, censused: CENSUSED });
      assert.deepEqual(bad.sinks, [], `${offsetUnit(p)} offsets, prefix ${JSON.stringify(prefix)}: unsafe sink accepted`);
      assert.equal(bad.failures.length, 1, JSON.stringify(bad.failures));
      assert.equal(bad.failures[0].line, line);
      assert.match(bad.failures[0].reason, /^<style set:html=\{css\}> is not set:html=\{styleText/);
    }
  }
  // a parser whose offsets are in neither unit cannot be read, and the census says so
  const shifted = (src) => { const r = parse(src); const f = (n) => { if (Array.isArray(n)) return n.forEach(f); if (!n || typeof n !== 'object') return; if (typeof n.start === 'number') { n.start += 1; n.end += 1; } for (const k of Object.keys(n)) if (n[k] && typeof n[k] === 'object') f(n[k]); }; f(r.ast); return r; };
  const r = censusSource(`${head}<style is:inline set:html={styleText(css)}></style>`, shifted, { file: FIXTURE, censused: CENSUSED });
  assert.deepEqual(r.sinks, []);
  assert.ok(r.failures.some((f) => /neither UTF-16 nor UTF-8/.test(f.reason)), JSON.stringify(r.failures));
});

// 🩸 Round 6: the probe compared one element that ended at end of input, so a parser reporting
// UTF-16 starts and UTF-8 ends passed (String.slice clamps), and the census then quoted
// `authorCss)}/>` as the argument with no failure. Units mixed by node, by boundary or by region
// must fail explicitly, both in the probe and in the source being censused.
const remap = (parse, { which = () => true, starts = true, ends = true, to = 'utf8', when = () => true } = {}) => (src) => {
  const r = parse(src);
  if (!when(src)) return r;
  const at = to === 'utf8' ? (i) => Buffer.byteLength(src.slice(0, i), 'utf8') : (i) => [...src.slice(0, i)].length;
  const fix = (n, parent) => {
    if (Array.isArray(n)) { n.forEach((c) => fix(c, parent)); return; }
    if (!n || typeof n !== 'object') return;
    if (which(n, parent)) {
      if (starts && typeof n.start === 'number') n.start = at(n.start);
      if (ends && typeof n.end === 'number') n.end = at(n.end);
    }
    for (const k of Object.keys(n)) if (n[k] && typeof n[k] === 'object') fix(n[k], n);
  };
  fix(r.ast, null);
  return r;
};
const MIXED = {
  'every end in bytes': { starts: false },
  'every start in bytes': { ends: false },
  'only Identifier nodes in bytes': { which: (n) => n.type === 'Identifier' },
  'only JSX attributes in bytes': { which: (n) => n.type === 'JSXAttribute' },
  'only call arguments in bytes': { which: (n, parent) => parent?.type === 'CallExpression' && parent.arguments?.includes(n) },
  'everything but JSX in bytes': { which: (n) => !String(n.type).startsWith('JSX') },
  'only the template in bytes': { which: (n) => String(n.type).startsWith('JSX') },
  'code points': { to: 'codepoint' },
};

test('rangeProblem: each boundary is checked before slicing, against its enclosing node and its own text', () => {
  const src = 'ab{cd}';
  const cut = (a, b) => src.slice(a, b);
  const total = src.length;
  const id = (start, end, name) => ({ type: 'Identifier', start, end, name });
  const cases = [
    [{ type: 'X', start: 0, end: 7 }, /not a range inside the source/],          // an end slice() would clamp
    [{ type: 'X', start: -1, end: 2 }, /not a range inside the source/],
    [{ type: 'X', start: 3, end: 2 }, /not a range inside the source/],
    [{ type: 'X', start: 0.5, end: 2 }, /not a range inside the source/],
    [{ type: 'X', start: 0, end: undefined }, /not a range inside the source/],
    [{ type: 'X', start: 0, end: 2, kid: id(1, 3, 'b{') }, /outside its enclosing X/],
    [id(0, 2, 'ba'), /reads "ab", not "ba"/],
    [{ type: 'Literal', start: 0, end: 2, raw: 'a' }, /reads/],
    [{ type: 'JSXExpressionContainer', start: 1, end: 6 }, /not \{…\}/],
    [{ type: 'JSXElement', start: 0, end: 2 }, /not <…>/],
  ];
  for (const [ast, why] of cases) assert.match(String(rangeProblem(ast, cut, total)), why, JSON.stringify(ast));
  // controls
  assert.equal(rangeProblem({ type: 'X', start: 0, end: 6, kids: [id(0, 2, 'ab'), { type: 'JSXExpressionContainer', start: 2, end: 6, e: id(3, 5, 'cd') }] }, cut, total), null);
  assert.equal(rangeProblem({ type: 'Literal', start: 0, end: 3, raw: '"\ufffd"' }, (a, b) => '"\ud800"'.slice(a, b), 3), null, 'a lone surrogate the parser stored as U+FFFD');
  assert.match(String(rangeProblem({ type: 'Literal', start: 0, end: 3, raw: '"\ufffd"' }, (a, b) => '"x"'.slice(a, b), 3)), /reads/, 'only a surrogate maps to U+FFFD');
  assert.equal(rangeProblem(id(0, 11, 'Layout'), (a, b) => '\\u004cayout'.slice(a, b), 11), null, 'an identifier spelled with an escape');
});

test('census: a parser whose offsets mix units fails explicitly, in the probe and in the source', { skip: SKIP }, async () => {
  const parse = await astroParse();
  // the reviewer's round-6 input, byte for byte
  const src = "---\nimport { styleText } from '../lib/style-text.mjs';\nconst authorCss='a{}';\n---\n<!-- \u6f22\u{1F9F8} -->\n<style set:html={styleText(authorCss)}/>";
  const OFFSETS = /offset/;
  for (const [mode, how] of Object.entries(MIXED)) {
    const mixed = remap(parse, how);
    assert.equal(offsetUnit(mixed), null, `${mode}: the offset probe accepted a mixed-unit parser`);
    for (const body of [src, src.replace('styleText(authorCss)', 'authorCss')]) {
      const r = censusSource(body, mixed, { file: FIXTURE, censused: CENSUSED });
      assert.deepEqual(r.sinks, [], `${mode}: a sink was accepted from mixed offsets: ${JSON.stringify(r.sinks)}`);
      assert.ok(r.failures.some((f) => OFFSETS.test(f.reason)), `${mode}: no explicit offset failure: ${JSON.stringify(r.failures)}`);
    }
    // the probe passes (honest offsets for it), the censused source alone is mixed: the
    // per-source range check must still catch it
    const sly = remap(parse, { ...how, when: (s) => s.includes('styleText') });
    assert.equal(offsetUnit(sly), offsetUnit(parse), `${mode}: the probe itself was remapped`);
    const r = censusSource(src, sly, { file: FIXTURE, censused: CENSUSED });
    assert.deepEqual(r.sinks, [], `${mode} (source only): a sink was accepted from mixed offsets: ${JSON.stringify(r.sinks)}`);
    assert.ok(r.failures.some((f) => OFFSETS.test(f.reason)), `${mode} (source only): no explicit offset failure: ${JSON.stringify(r.failures)}`);
  }
  // the controls: the honest parser, and the same parser uniformly in the other unit
  const other = offsetUnit(parse) === 'utf16' ? toByteOffsets(parse) : toCodeUnitOffsets(parse);
  for (const p of [parse, other]) {
    assert.deepEqual(censusSource(src, p, { file: FIXTURE, censused: CENSUSED }), { sinks: [{ line: 6, arg: 'authorCss' }], failures: [] }, offsetUnit(p));
  }
});

test('every <style set:html> sink in astro/src goes through styleText', { skip: SKIP }, async () => {
  const parse = await astroParse();
  const sinks = [];
  const bad = [];
  for (const file of FILES) {
    const { sinks: s, failures } = censusSource(readFileSync(file, 'utf8'), parse, { file, censused: CENSUSED });
    for (const k of s) sinks.push({ at: `${relative(SRC, file)}:${k.line}`, arg: k.arg });
    for (const f of failures) bad.push(`${relative(SRC, file)}:${f.line} ${f.reason}`);
  }
  assert.ok(FILES.length >= 20, `the census saw only ${FILES.length} .astro files`);
  assert.deepEqual(bad, [], 'style sinks the census cannot prove safe');
  // The seven inline sheets SiteLayout fills today, by the identifier each one passes. A census
  // that finds fewer has stopped seeing the layout.
  const layout = sinks.filter((k) => k.at.startsWith('layouts/SiteLayout.astro:')).map((k) => k.arg).sort();
  assert.deepEqual(layout, ['APPBAR_CSS', 'colorSchemeSheet', 'layerOrder', 'localeBannerBlock', 'pkgCssBlock', 'routeCssText', 'themeCssBlock']);
});
