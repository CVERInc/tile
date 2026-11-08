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

// Conservative census. For every `<style` in a source, take the text from it up to the next
// `</style` (or the next `<style`, or end of file) and find EVERY `set:html` token in that text, as
// plain text: quotes, template literals, comments and nesting cannot hide one. Each must be exactly
// `set:html={styleText(<identifier or member path>)}` (whitespace allowed). Any other shape fails,
// including a safe prefix followed by more expression. A false alarm is fixed by writing the sink in
// the one allowed shape, never by teaching this scanner a new syntax.
const ALLOWED_SINK = /^set:html\s*=\s*\{\s*styleText\(\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\)\s*\}/;
function styleSinks(src) {
  const out = [];
  const starts = [...src.matchAll(/<style\b/g)].map((m) => m.index);
  starts.forEach((at, k) => {
    const close = src.indexOf('</style', at);
    const next = starts[k + 1] ?? src.length;
    const end = close === -1 ? next : Math.min(close, next);
    const region = src.slice(at, end);
    for (const m of region.matchAll(/set:html/g)) {
      out.push({ index: at, value: region.slice(m.index) });
    }
  });
  return out;
}
const wrapped = (value) => ALLOWED_SINK.test(value);

test('census scanner: every non-canonical sink shape is found and rejected', () => {
  const unsafe = [
    '<style is:inline set:html = {authorCss}></style>',
    '<style is:inline data-label=">" set:html={authorCss}></style>',
    '<style set:html={authorCss}></style>',
    '<style is:inline data-x={`a${`"`}z`} set:html={authorCss}/>',
    '<style is:inline data-x={x /* } " */} set:html={authorCss}/>',
    '<style is:inline set:html={styleText("") + authorCss}/>',
    '<style is:inline set:html={styleText(a)(b)}/>',
  ];
  for (const src of unsafe) {
    const hits = styleSinks(src);
    assert.ok(hits.length >= 1, `no sink found in ${src}`);
    assert.ok(hits.some((h) => !wrapped(h.value)), `unsafe sink accepted: ${src}`);
  }
  const safe = '<style is:inline set:html = { styleText(a) }></style><style data-x="}>" set:html={styleText(theme.css)}></style>';
  assert.deepEqual(styleSinks(safe).map((h) => wrapped(h.value)), [true, true]);
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
      if (!wrapped(hit.value)) bare.push(at);
    }
  }
  assert.ok(sinks.length >= 5, `the census found only ${sinks.length} sinks; the scanner no longer matches the layout`);
  assert.deepEqual(bare, [], 'inline <style set:html> sinks not wrapped in styleText(…)');
});
