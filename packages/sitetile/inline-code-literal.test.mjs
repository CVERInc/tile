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

// ── round 2: a decoded destination is never read as a placeholder ───────────────────────────────
// The marks are chosen from the RAW text, and a destination is entity-decoded later. With no
// private-use character in the text the atom mark is U+E001, so `&#xE001;` in a destination decodes
// to exactly that mark. The fix is provenance, not more reservations: a destination is decoded only
// as it is restored, in the single pass that never rescans what it puts back.
test('round 2: ![a](photo&#xE001;.png) is an image whose parsed src holds the decoded character', () => {
  for (const html of [inlineHtml('![a](photo&#xE001;.png)'), inlineHtml('![a](photo&#57345;.png)'), bodyHtml('![a](photo&#xE001;.png) and text')]) {
    const [img] = elements(html, 'img');
    assert.ok(img, html);
    assert.equal(attrs(img).src, 'photo.png');
  }
});
test('round 2: [go](/&#xE001;0&#xE001;) keeps its link, and the code span after it stays separate', () => {
  for (const html of [inlineHtml('[go](/&#xE001;0&#xE001;) `foo`'), bodyHtml('[go](/&#57345;0&#57345;) `foo`')]) {
    const links = elements(html, 'a');
    assert.equal(links.length, 1, html);
    assert.equal(attrs(links[0]).href, '/0');
    assert.equal(links[0].childNodes.length, 1, 'the link holds only its label');
    assert.equal(elements(html, 'span').filter((el) => attrs(el).class === 'st-code').length, 1, html);
  }
});
test('round 2: a destination-shaped run that forms no link keeps its decoded text', () => {
  assert.equal(inlineHtml('Keep ](&#xE001;0&#xE001;) here.'), 'Keep ](0) here.');
  assert.equal(inlineHtml('Keep ](&#57345;0&#57345;) and `x` here.'), 'Keep ](0) and ' + CODE('x') + ' here.');
});
// The destination guard. An HTML comment is removed by escapeInline, AFTER the raw-text stash
// looked for `](`, so `]<!---->(` becomes `](` with a code atom as its destination. Restoring that
// atom into href="…"/src="…" would put the span's markup and quotes inside the attribute.
test('destination guard: a comment-joined `](` with a code span as destination forms no link or image', () => {
  for (const input of ['[go]<!--c-->(`x" onmouseover="alert(1)`)', '![i]<!--c-->(`x" onerror="alert(1)`)']) {
    for (const html of [inlineHtml(input), bodyHtml(input)]) {
      assert.equal(elements(html, 'a').length + elements(html, 'img').length, 0, html);
      const spans = elements(html, 'span').filter((el) => attrs(el).class === 'st-code');
      assert.equal(spans.length, 1, html);
      for (const el of elements(html, 'span')) assert.deepEqual(el.attrs.map((a) => a.name), ['class'], html);
    }
  }
  // control: the same comment-joined shape with a plain destination still links, as it always did
  assert.equal(attrs(elements(inlineHtml('[go]<!--c-->(/x)'), 'a')[0]).href, '/x');
});

// ── round 3: supplementary private-use characters are seen too ──────────────────────────────────
// With every BMP private-use code point in the text, the marks come from plane 15. The first scan
// read plane-15 surrogates from the wrong lower bound, so authored U+F0000–U+FBFFF went unseen and
// were handed out as marks: U+F0000 as the destination mark, U+F0001 as the atom mark.
{
  let BMP = '';
  for (let cp = 0xE000; cp <= 0xF8FF; cp++) BMP += String.fromCharCode(cp);
  const H15 = String.fromCodePoint(0xF0000), A15 = String.fromCodePoint(0xF0001), LATE = String.fromCodePoint(0xFBFFF);
  const cases = [
    [BMP + ' Keep ' + A15 + '0' + A15 + ' here.', BMP + ' Keep ' + A15 + '0' + A15 + ' here.'],
    [BMP + ' Keep ' + A15 + '0' + A15 + ' and `x` here.', BMP + ' Keep ' + A15 + '0' + A15 + ' and ' + CODE('x') + ' here.'],
    [BMP + ' Keep ' + H15 + '0' + H15 + ' [go](/real)', BMP + ' Keep ' + H15 + '0' + H15 + ' <a href="/real">go</a>'],
    [BMP + ' ' + LATE + ' `x` [a](/b)', BMP + ' ' + LATE + ' ' + CODE('x') + ' <a href="/b">a</a>'],
  ];
  for (const [input, want] of cases) {
    test('round 3: BMP private-use range full + authored ' + JSON.stringify(input.slice(BMP.length)) + ' is kept as typed', () => {
      assert.equal(inlineHtml(input), want);
      assert.equal(bodyHtml(input), '<p>' + want + '</p>');
    });
  }
}

console.log('\ninline-code-literal: ' + passed + ' passed' + (process.exitCode ? ', SOME FAILED' : ', all green'));
