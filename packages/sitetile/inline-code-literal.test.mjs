// A code span is literal, and nothing the inline renderer stashes can leak into an attribute.
//   run: node packages/sitetile/inline-code-literal.test.mjs   (globbed by scripts/test.sh)
//
// tile#267 made inlineHtml lift each finished code span out before its promotion passes, so
// `<br>`, `<small>` and `[label](/path)` written in code stay text (site-core.test.js pins those).
// Its review (tile#268) found two holes in the first version, and this file is their ruler:
//   P1 — a code span in an image's alt was put back BEFORE the link pass ran, and the link pass
//        then built `<a href="…">` inside the quoted alt: its first quote closed the attribute and
//        the rest parsed as an event handler. The image must be opaque to every later pass.
//   P2 — the placeholders were a FIXED `\u0001c<n>\u0001`, which an author can type: it rendered as
//        `undefined`, as a copy of another code span, or spliced markup into a finished href.
// Attributes are checked on the PARSED tree (parse5, the HTML parser the blog excerpt uses), not on
// string snapshots: what matters is what a browser builds from the output.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineHtml, bodyHtml } from './site-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const { parseFragment } = createRequire(join(HERE, 'astro/node_modules/x.js'))('parse5');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}
const elements = (html, tag) => {
  const out = [];
  const stack = [...parseFragment(html).childNodes];
  while (stack.length) { const n = stack.pop(); if (n.tagName === tag) out.push(n); if (n.childNodes) stack.push(...n.childNodes); }
  return out;
};
const attrs = (el) => Object.fromEntries(el.attrs.map((a) => [a.name, a.value]));
const IMG_ATTRS = ['class', 'src', 'alt', 'loading', 'decoding'];
const CODE = (inner) => '<span class="st-code"><span class="st-mk">`</span>' + inner + '<span class="st-mk">`</span></span>';

// ── P1: an image is opaque to the passes after it ─────────────────────────────────────────────────
const PAYLOADS = [
  '[go](onerror=window.pwned=1//)', '[go](onerror=alert`1`//)', '[go](onerror=alert)',
  '[go](onerror=alert&#40;1&#41;)', '[go](onerror=throw/**/1)', '[go](/x"onerror="alert(1))',
  '![i](x)', '<br>', '<small>s</small>',
];
for (const code of PAYLOADS) {
  test(`P1: ![\`${code}\`](missing.png) parses to one <img> with only its own attributes, alt = the code as text`, () => {
    for (const html of [inlineHtml('![`' + code + '`](missing.png)'), bodyHtml('Photo: ![`' + code + '`](missing.png)')]) {
      const imgs = elements(html, 'img');
      assert.equal(imgs.length, 1, html);
      const a = attrs(imgs[0]);
      assert.deepEqual(Object.keys(a).sort(), [...IMG_ATTRS].sort(), html);
      assert.equal(a.src, 'missing.png');
      // the parsed alt is the code span's markup as TEXT (the form it has always had) around the code
      // exactly as typed: `<br>` stays the characters `<br>`, `&#40;` stays `&#40;`
      assert.equal(a.alt, CODE(code), html);
      assert.equal(elements(html, 'a').length, 0, 'no link forms anywhere: ' + html);
      assert.equal(elements(html, 'br').length + elements(html, 'small').length, 0, html);
    }
  });
}
test('P1 control: a link around an image, and an image next to code, still form', () => {
  const html = inlineHtml('[![i](s.png)](/h) `[c](d)` ![a](b.png)');
  const [link] = elements(html, 'a');
  assert.equal(attrs(link).href, '/h');
  assert.deepEqual(elements(html, 'img').map((el) => attrs(el).src).sort(), ['b.png', 's.png']);
  assert.equal(elements(html, 'a').length, 1, html);
});

// ── P2: authored text is never read as a placeholder ─────────────────────────────────────────────
test('P2: an authored \\u0001c0\\u0001 with no code span is kept as typed', () => {
  assert.equal(inlineHtml('Keep \u0001c0\u0001 here.'), 'Keep \u0001c0\u0001 here.');
  assert.equal(inlineHtml('Keep \u00010\u0001 here.'), 'Keep \u00010\u0001 here.');
});
test('P2: an authored \\u0001c0\\u0001 next to a real code span is not replaced by it', () => {
  assert.equal(inlineHtml('Keep \u0001c0\u0001 and `other` here.'), 'Keep \u0001c0\u0001 and ' + CODE('other') + ' here.');
});
test('P2: an authored placeholder in a link destination stays in the parsed href', () => {
  const html = inlineHtml('[go](/\u0001c0\u0001) `foo`');
  const [link] = elements(html, 'a');
  assert.equal(attrs(link).href, '/\u0001c0\u0001');
  assert.equal(link.childNodes.length, 1, 'the link holds only its label');
});
test('P2: authored placeholders in an image alt stay in the parsed alt', () => {
  assert.equal(attrs(elements(inlineHtml('![\u0001c0\u0001](a.png) `foo`'), 'img')[0]).alt, '\u0001c0\u0001');
  assert.equal(attrs(elements(inlineHtml('![`\u0001c1\u0001`](a.png) `foo`'), 'img')[0]).alt, CODE('\u0001c1\u0001'));
});
test('P2: private-use characters in the text are kept, and the renderer still works around them', () => {
  const pua = ' 0 0 0';
  assert.equal(inlineHtml(pua + ' `x` [a](/b)'), pua + ' ' + CODE('x') + ' <a href="/b">a</a>');
  // every BMP private-use code point present: the marks come from a supplementary plane instead
  let all = '';
  for (let cp = 0xE000; cp <= 0xF8FF; cp++) all += String.fromCharCode(cp);
  assert.equal(inlineHtml(all + ' `x` [a](/b)'), all + ' ' + CODE('x') + ' <a href="/b">a</a>');
});

console.log('\ninline-code-literal: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
