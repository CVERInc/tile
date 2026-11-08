// styleText — inline <style> text that cannot close its element (astro/src/lib/style-text.mjs),
// and the census that every `<style set:html>` sink in the renderer goes through it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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
// including any added later. A static census: a `<style … set:html={X}>` whose X does not start
// with `styleText(` is a sink that can be closed by whatever X carries.
const SRC = fileURLToPath(new URL('./astro/src', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.astro') ? [p] : []);
});

// Conservative census. Every `set:html` token in a template (found as plain text, so quotes,
// template literals and comments cannot hide one) is classified by the opening tag it sits in: the
// text from the nearest preceding `<` up to the token must be a SIMPLE opening tag, meaning a tag name
// followed only by bare attributes, quoted values without `<`, or brace values without `{`, `}` or `<`.
// Anything else (a closer-like string, a nested expression, a comment, a stray quote) cannot be
// classified and FAILS. A `<style>` sink must be exactly
// `set:html={styleText(<identifier or member path>)}`. A false alarm is fixed by writing the sink in
// that simple shape, never by teaching this scanner more syntax.
const ALLOWED_SINK = /^set:html\s*=\s*\{\s*styleText\(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\)\s*\}/;
const SIMPLE_OPEN = /^<([A-Za-z][\w.:-]*)((?:\s+[A-Za-z_:@][\w.:@-]*(?:\s*=\s*(?:"[^"<]*"|'[^'<]*'|\{[^{}<]*\}))?|\s+\{\.\.\.[^{}<]*\})*)\s+$/;
function styleSinks(src) {
  const out = [];
  for (const m of src.matchAll(/set:html/g)) {
    const lt = src.lastIndexOf('<', m.index);
    const head = lt === -1 ? '' : src.slice(lt, m.index);
    const open = SIMPLE_OPEN.exec(head);
    const value = src.slice(m.index);
    if (!open) { out.push({ index: m.index, value, tag: null }); continue; }
    if (open[1].toLowerCase() === 'style') out.push({ index: m.index, value, tag: 'style' });
  }
  return out;
}
const wrapped = (hit) => hit.tag === 'style' && ALLOWED_SINK.test(hit.value);

test('census scanner: every non-canonical sink shape is found and rejected', () => {
  const unsafe = [
    '<style is:inline set:html = {authorCss}></style>',
    '<style is:inline data-label=">" set:html={authorCss}></style>',
    '<style set:html={authorCss}></style>',
    '<style is:inline data-x={`a${`"`}z`} set:html={authorCss}/>',
    '<style is:inline data-x={x /* } " */} set:html={authorCss}/>',
    '<style is:inline set:html={styleText("") + authorCss}/>',
    '<style is:inline set:html={styleText(a)(b)}/>',
    '<style is:inline data-label="</style>" set:html={authorCss}></style>',
    '<style is:inline data-x={"</style>"} set:html={authorCss}></style>',
    '<style is:inline data-x={x /* </style */} set:html={authorCss}></style>',
    '<style data-x="<i" set:html={authorCss}></style>',
  ];
  for (const src of unsafe) {
    const hits = styleSinks(src);
    assert.ok(hits.length >= 1, `no sink found in ${src}`);
    assert.ok(hits.some((h) => !wrapped(h)), `unsafe sink accepted: ${src}`);
  }
  const safe = '<style is:inline set:html = { styleText(a) }></style><style data-x="ok" set:html={styleText(theme.css)}></style><div set:html={x}></div>';
  assert.deepEqual(styleSinks(safe).map((h) => wrapped(h)), [true, true]);
});

test('every <style set:html> sink in astro/src goes through styleText', () => {
  const sinks = [];
  const bare = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    // Only the template is markup; the frontmatter (between the first two `---` lines) is JS whose
    // comments may mention `<style set:html>`.
    const fence = src.startsWith('---') ? src.indexOf('\n---', 3) : -1;
    const body = fence === -1 ? src : src.slice(fence + 4);
    const offset = src.length - body.length;
    for (const hit of styleSinks(body).map((h) => ({ ...h, index: h.index + offset }))) {
      const at = `${relative(SRC, file)}:${src.slice(0, hit.index).split('\n').length}`;
      sinks.push(at);
      if (!wrapped(hit)) bare.push(at);
    }
  }
  assert.ok(sinks.length >= 5, `the census found only ${sinks.length} sinks; the scanner no longer matches the layout`);
  assert.deepEqual(bare, [], 'inline <style set:html> sinks not wrapped in styleText(…)');
});
