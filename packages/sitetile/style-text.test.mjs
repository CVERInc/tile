// styleText — inline <style> text that cannot close its element (astro/src/lib/style-text.mjs),
// and the census that every `<style set:html>` sink in the renderer goes through it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { censusSource, loadAstroParse, SRC } from './style-sink-census.mjs';
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
  ];
  for (const [head, why] of heads) {
    const { failures } = run(parse, sink, head);
    assert.ok(failures.some((f) => why.test(f.reason)), `${head}\n  not rejected for ${why}: ${JSON.stringify(failures)}`);
  }
  assert.ok(run(parse, '{((styleText) => <style set:html={styleText(authorCss)}/>)((c) => c)}').failures.some((f) => BOUND.test(f.reason)),
    'a template-level parameter named styleText shadows the import');
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
  // The six inline sheets SiteLayout fills today, by the identifier each one passes. A census
  // that finds fewer has stopped seeing the layout.
  const layout = sinks.filter((k) => k.at.startsWith('layouts/SiteLayout.astro:')).map((k) => k.arg).sort();
  assert.deepEqual(layout, ['APPBAR_CSS', 'layerOrder', 'localeBannerBlock', 'pkgCssBlock', 'routeCssText', 'themeCssBlock']);
});
