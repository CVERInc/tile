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

// Scan one source for `<style …>` open tags and return each `set:html` value on them. The tag is
// walked token by token: quoted attribute values and `{…}` expressions (with nested braces and
// strings) are skipped as units, so a `>` inside either does not end the tag, and `set:html` may have
// whitespace around `=`. Each hit is { index, value } with value = the text after `=` (trimmed).
function styleSinks(src) {
  const out = [];
  const re = /<style\b/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    const skipString = (q) => { i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; };
    const skipExpr = () => {
      let depth = 0;
      do {
        const c = src[i];
        if (c === '"' || c === "'" || c === '`') { skipString(c); continue; }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
      } while (i < src.length && depth > 0);
    };
    while (i < src.length && src[i] !== '>') {
      const c = src[i];
      if (c === '"' || c === "'") { skipString(c); continue; }
      if (c === '{') { skipExpr(); continue; }
      const name = /^[^\s=>"'{}\/]+/.exec(src.slice(i));
      if (!name) { i++; continue; }
      i += name[0].length;
      let j = i; while (/\s/.test(src[j] ?? '')) j++;
      if (src[j] !== '=') continue;
      j++; while (/\s/.test(src[j] ?? '')) j++;
      const valueAt = j;
      i = j;
      if (src[i] === '{') skipExpr(); else if (src[i] === '"' || src[i] === "'") skipString(src[i]);
      else { while (i < src.length && !/[\s>]/.test(src[i])) i++; }
      if (name[0] === 'set:html') out.push({ index: m.index, value: src.slice(valueAt, i) });
    }
  }
  return out;
}
const wrapped = (value) => /^\{\s*styleText\(/.test(value);

test('census scanner: whitespace around =, quoted > in another attribute, and a canonical bare sink are all found', () => {
  const unsafe = `<style is:inline set:html = {authorCss}></style>\n<style is:inline data-label=">" set:html={authorCss}></style>\n<style set:html={authorCss}></style>`;
  const hits = styleSinks(unsafe);
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((h) => wrapped(h.value)), [false, false, false]);
  const safe = `<style is:inline set:html = { styleText(a) }></style><style data-x="}>" set:html={styleText(b)}></style>`;
  assert.deepEqual(styleSinks(safe).map((h) => wrapped(h.value)), [true, true]);
});

test('every <style set:html> sink in astro/src goes through styleText', () => {
  const sinks = [];
  const bare = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, 'utf8');
    for (const hit of styleSinks(src)) {
      const at = `${relative(SRC, file)}:${src.slice(0, hit.index).split('\n').length}`;
      sinks.push(at);
      if (!wrapped(hit.value)) bare.push(at);
    }
  }
  assert.ok(sinks.length >= 5, `the census found only ${sinks.length} sinks; the scanner no longer matches the layout`);
  assert.deepEqual(bare, [], 'inline <style set:html> sinks not wrapped in styleText(…)');
});
