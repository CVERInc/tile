// Guard for tile#291: three marks the family editor writes (`rule` → `---`, `strike` → `~~x~~`,
// `check` → `- [ ] x`) were printed as typed in a post body. Each case drives the real post renderer
// (flowingHtml → site-core bodyHtml/inlineHtml), one mark at a time, the way the issue measured it.
//   run: node packages/sitetile/post-body-marks.test.mjs   (wired into scripts/test.sh by glob)
//
// The neighbours each fix could have moved are pinned byte-for-byte as they rendered before it.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// blog.mjs imports the model layer as `@sitetile`, an Astro alias plain node cannot resolve
// (same shim as dialogue-sides.test.mjs).
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { flowingHtml } = await import('./astro/src/lib/blog.mjs');
const { bodyHtml } = await import('./site-core.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + String(e.message).split('\n').join('\n    ')); }
}
const post = (md) => flowingHtml(md, {});
const STRUCK = (inner) => '<span class="st-s"><span class="st-mk">~~</span>' + inner + '<span class="st-mk">~~</span></span>';

console.log('post-body-marks (tile#291)');

// ── `---` on its own block → a rule ─────────────────────────────────────────────────────────────
test('`---` between blank lines is a rule, not the text "---"', () => {
  assert.equal(post('above\n\n---\n\nbelow'), '<p>above</p>\n<hr>\n<p>below</p>');
});
test('a longer run of hyphens is a rule too, and a following line starts a new paragraph', () => {
  assert.equal(post('above\n\n-----\nbelow'), '<p>above</p>\n<hr>\n<p>below</p>');
});
test('`---` right after a list ends the list and draws a rule', () => {
  assert.equal(post('- a\n---'), '<ul class="st-list"><li>a</li></ul>\n<hr>');
});
test('unchanged: `---` directly under a paragraph line stays inside that paragraph', () => {
  assert.equal(post('above\n---\nbelow'), '<p>above --- below</p>');
});
test('unchanged: `---` indented four spaces stays literal text', () => {
  assert.equal(post('    ---'), '<p>---</p>');
});
test('unchanged: `***`, `___` and `- - -` render as they did', () => {
  assert.equal(post('***'), '<p>***</p>');
  assert.equal(post('___'), '<p>___</p>');
  assert.equal(post('- - -'), '<ul class="st-list"><li>- -</li></ul>');
});
test('unchanged: `---` inside a fenced block is code', () => {
  assert.equal(post('```\n---\n```'), '<pre class="st-code"><code>---</code></pre>');
});
test('the rule carries a source span like its neighbours when asked', () => {
  assert.equal(bodyHtml('a\n\n---', { srcLine: 1 }), '<p data-src="1-1">a</p>\n<hr data-src="3-3">');
});

// ── `~~x~~` → struck text ───────────────────────────────────────────────────────────────────────
test('`~~b~~` is struck through, markers kept in the hidden marker span like bold', () => {
  assert.equal(post('a ~~b~~ c'), '<p>a ' + STRUCK('b') + ' c</p>');
});
test('strike nests with bold and works inside a link label', () => {
  assert.equal(post('~~**b**~~'),
    '<p>' + STRUCK('<span class="st-b"><span class="st-mk">**</span>b<span class="st-mk">**</span></span>') + '</p>');
  assert.equal(post('[~~old~~](/p)'), '<p><a href="/p">' + STRUCK('old') + '</a></p>');
});
test('a `~~` pair that would cross a link or bold edge stays as typed (no mis-nested tags)', () => {
  assert.equal(post('~~a [b~~ c](/p)'), '<p>~~a <a href="/p">b~~ c</a></p>');
  assert.equal(post('~~a **b~~ c**'),
    '<p>~~a <span class="st-b"><span class="st-mk">**</span>b~~ c<span class="st-mk">**</span></span></p>');
});
test('unchanged: `~~` inside a code span stays literal', () => {
  assert.equal(post('`~~x~~`'), '<p><span class="st-code"><span class="st-mk">`</span>~~x~~<span class="st-mk">`</span></span></p>');
});
test('unchanged: `~~` in a link destination is not touched', () => {
  assert.equal(post('[go](/a~~b~~c)'), '<p><a href="/a~~b~~c">go</a></p>');
});
test('unchanged: a single `~`, an unclosed `~~` and an empty `~~~~` stay as typed', () => {
  assert.equal(post('a ~b~ c'), '<p>a ~b~ c</p>');
  assert.equal(post('a ~~b c'), '<p>a ~~b c</p>');
  assert.equal(post('a ~~~~ c'), '<p>a ~~~~ c</p>');
});
test('unchanged: `~~` in an image alt does not put markup inside the attribute', () => {
  assert.equal(post('![a ~~b~~](/x.png)'), bodyHtml('![a ~~b~~](/x.png)').replace(/\n/g, ''));
  assert.doesNotMatch(post('![a ~~b~~](/x.png)'), /alt="[^"]*</);
});

// ── review of PR 382: which `~~` pairs are drawn is decided by structure ────────────────────────
// Each "as on main" string below is what origin/main (no strike support at all) rendered for the
// same input, captured byte-for-byte: these inputs must not change.
test('a `~~` pair whose ends sit in two different links stays as typed (as on main)', () => {
  assert.equal(post('[a ~~b](/one) gap [c~~ d](/two)'),
    '<p><a href="/one">a ~~b</a> gap <a href="/two">c~~ d</a></p>');
});
test('a `~~` pair whose ends sit in two different bold spans stays as typed (as on main)', () => {
  assert.equal(post('**a ~~b** gap **c~~ d**'),
    '<p><span class="st-b"><span class="st-mk">**</span>a ~~b<span class="st-mk">**</span></span> gap '
    + '<span class="st-b"><span class="st-mk">**</span>c~~ d<span class="st-mk">**</span></span></p>');
});
test('a `~~` pair that would cross a raw <small> edge stays as typed (as on main)', () => {
  assert.equal(post('<small>a ~~b</small> c~~ d'), '<p><small>a ~~b</small> c~~ d</p>');
});
test('a pair that wraps a whole link, or sits wholly inside a <small>, is still drawn', () => {
  assert.equal(post('~~a [b](/p) c~~'), '<p>' + STRUCK('a <a href="/p">b</a> c') + '</p>');
  assert.equal(post('<small>~~a~~</small>'), '<p><small>' + STRUCK('a') + '</small></p>');
});
test('an escaped opening `\\~~` is never a delimiter (as on main)', () => {
  assert.equal(post('a \\~~b~~ c'), '<p>a <span class="st-mk">\\</span>~~b~~ c</p>');
});
test('an escaped closing `\\~~` is never a delimiter (as on main)', () => {
  assert.equal(post('a ~~b\\~~ c'), '<p>a ~~b<span class="st-mk">\\</span>~~ c</p>');
});
test('a bare URL in prose keeps its tildes: the full address shows (as on main)', () => {
  assert.equal(post('Visit https://example.com/a~~b~~c today'), '<p>Visit https://example.com/a~~b~~c today</p>');
});
test('a strike next to a bare URL is still drawn; one that would end inside the URL is not', () => {
  assert.equal(post('~~old~~ https://x.example/a~~b'), '<p>' + STRUCK('old') + ' https://x.example/a~~b</p>');
  assert.equal(post('~~see https://x.example/a~~'), '<p>~~see https://x.example/a~~</p>');
});

// ── `- [ ]` / `- [x]` → a task item ─────────────────────────────────────────────────────────────
test('`- [ ]` and `- [x]` are task items with a checkbox, not the text "[ ]"', () => {
  assert.equal(post('- [ ] todo\n- [x] done'),
    '<ul class="st-list"><li class="st-task"><label><input type="checkbox" disabled> todo</label></li>'
    + '<li class="st-task"><label><input type="checkbox" disabled checked> done</label></li></ul>');
});
test('an upper-case `[X]` is done too, and inline marks still render in the item', () => {
  assert.equal(post('- [X] **b**'),
    '<ul class="st-list"><li class="st-task"><label><input type="checkbox" disabled checked> '
    + '<span class="st-b"><span class="st-mk">**</span>b<span class="st-mk">**</span></span></label></li></ul>');
});
test('a nested task item keeps its parent', () => {
  assert.equal(post('- a\n  - [ ] b'),
    '<ul class="st-list"><li>a<ul class="st-list"><li class="st-task"><label><input type="checkbox" disabled> b</label></li></ul></li></ul>');
});
test('each task checkbox is named by its own text: checkbox and text share one <label>', () => {
  const html = post('- [ ] Send invoice\n- [x] Receive payment');
  assert.equal(html,
    '<ul class="st-list"><li class="st-task"><label><input type="checkbox" disabled> Send invoice</label></li>'
    + '<li class="st-task"><label><input type="checkbox" disabled checked> Receive payment</label></li></ul>');
  // every checkbox is inside a label, disabled, and has no name (never submitted)
  for (const m of html.matchAll(/<input[^>]*>/g)) {
    assert.match(m[0], /\bdisabled\b/);
    assert.doesNotMatch(m[0], /\bname=/);
    assert.equal(html.slice(0, m.index).lastIndexOf('<label>') > html.slice(0, m.index).lastIndexOf('</label>'), true);
  }
});
test('a nested child task is not part of its parent checkbox\'s name', () => {
  assert.equal(post('- [ ] parent\n  - [x] child'),
    '<ul class="st-list"><li class="st-task"><label><input type="checkbox" disabled> parent</label>'
    + '<ul class="st-list"><li class="st-task"><label><input type="checkbox" disabled checked> child</label></li></ul></li></ul>');
});
test('unchanged: plain items, `[]`, `[ ]x` and a link item render as they did', () => {
  assert.equal(post('- a\n- b'), '<ul class="st-list"><li>a</li><li>b</li></ul>');
  assert.equal(post('- [] x'), '<ul class="st-list"><li>[] x</li></ul>');
  assert.equal(post('- [ ]x'), '<ul class="st-list"><li>[ ]x</li></ul>');
  assert.equal(post('- [x](/p)'), '<ul class="st-list"><li><a href="/p">x</a></li></ul>');
});

// ── second closing review: escapes next to atoms, and mis-nested emphasis ──────────────────────
// Each expected string below is origin/main's output for that input, byte for byte (main draws no
// strike, so every `~~` there is literal). They were computed from origin/main's site-core.js, and
// the "(as on main)" cases pass when this file is run against it. The second table's inputs hold a
// real pair: expected is main's output with only that pair drawn.
const AS_ON_MAIN = [
  ['\\[a](/one) plain [b](/two) ~~unclosed',
    '<p><span class="st-mk">\\</span><a href="/one">a</a> plain <a href="/two">b</a> ~~unclosed</p>'],
  ['\\![a](/x.png) plain `c` ~~unclosed',
    '<p><span class="st-mk">\\</span><img class="st-img" src="/x.png" alt="a" loading="lazy" decoding="async"> plain <span class="st-code"><span class="st-mk">`</span>c<span class="st-mk">`</span></span> ~~unclosed</p>'],
  ['\\[a](/one) plain [b](/two)',
    '<p><span class="st-mk">\\</span><a href="/one">a</a> plain <a href="/two">b</a></p>'],
  ['\\]a [b](/two) ~~unclosed',
    '<p><span class="st-mk">\\</span>]a <a href="/two">b</a> ~~unclosed</p>'],
  ['\\[\\[a](/one)](/two) ~~x',
    '<p><span class="st-mk">\\</span><a href="/one"><span class="st-mk">\\</span>[a</a>](/two) ~~x</p>'],
  ['[a [b](/c) d](/e) ~~x',
    '<p><a href="/c">a [b</a> d](/e) ~~x</p>'],
  ['\\[a\\] [b](/two) ~~unclosed',
    '<p><span class="st-mk">\\</span>[a<span class="st-mk">\\</span>] <a href="/two">b</a> ~~unclosed</p>'],
  ['**a \\[b](/p) c ~~d',
    '<p>**a <span class="st-mk">\\</span><a href="/p">b</a> c ~~d</p>'],
  ['\\!\\[a](/x.png) ~~y',
    '<p><span class="st-mk">\\</span>!<span class="st-mk">\\</span><a href="/x.png">a</a> ~~y</p>'],
  ['~~a \\[b~~ c](/p)',
    '<p>~~a <span class="st-mk">\\</span><a href="/p">b~~ c</a></p>'],
  ['~~**a [b** c~~](/p)',
    '<p>~~<span class="st-b"><span class="st-mk">**</span>a <a href="/p">b<span class="st-mk">**</span></span> c~~</a></p>'],
  ['~~**old [price** new~~](/price)',
    '<p>~~<span class="st-b"><span class="st-mk">**</span>old <a href="/price">price<span class="st-mk">**</span></span> new~~</a></p>'],
  ['~~a <small>**b</small> c~~**',
    '<p>~~a <small><span class="st-b"><span class="st-mk">**</span>b</small> c~~<span class="st-mk">**</span></span></p>'],
  ['~~a [**b](/p) c** d~~',
    '<p>~~a <a href="/p"><span class="st-b"><span class="st-mk">**</span>b</a> c<span class="st-mk">**</span></span> d~~</p>'],
  ['~~**a [b** c](/p) d~~',
    '<p>~~<span class="st-b"><span class="st-mk">**</span>a <a href="/p">b<span class="st-mk">**</span></span> c</a> d~~</p>'],
  ['**a [b** ~~c **d](/p) e** f~~',
    '<p><span class="st-b"><span class="st-mk">**</span>a <a href="/p">b<span class="st-mk">**</span></span> ~~c <span class="st-b"><span class="st-mk">**</span>d</a> e<span class="st-mk">**</span></span> f~~</p>'],
  ['~~a **b [c** d](/p) e~~',
    '<p>~~a <span class="st-b"><span class="st-mk">**</span>b <a href="/p">c<span class="st-mk">**</span></span> d</a> e~~</p>'],
  ['~~a <small>[b</small> c~~](/p)',
    '<p>~~a <small><a href="/p">b</small> c~~</a></p>'],
];
const STRIKE_NEXT_TO_ESCAPE = [
  ['\\[a](/one) ~~strike~~ [b](/two)',
    '<p><span class="st-mk">\\</span><a href="/one">a</a> ~~strike~~ <a href="/two">b</a></p>'],
  ['\\![a](/x.png) ~~strike~~ [b](/two)',
    '<p><span class="st-mk">\\</span><img class="st-img" src="/x.png" alt="a" loading="lazy" decoding="async"> ~~strike~~ <a href="/two">b</a></p>'],
  ['\\[a](/one) ~~strike~~ `code`',
    '<p><span class="st-mk">\\</span><a href="/one">a</a> ~~strike~~ <span class="st-code"><span class="st-mk">`</span>code<span class="st-mk">`</span></span></p>'],
  ['\\[a](/one) ~~strike~~ ![b](/two.png)',
    '<p><span class="st-mk">\\</span><a href="/one">a</a> ~~strike~~ <img class="st-img" src="/two.png" alt="b" loading="lazy" decoding="async"></p>'],
];
const onMain = (md) => AS_ON_MAIN.find(([i]) => i === md)[1];
const rendered = (md) => {             // a throw is reported as a failure naming the input, not a crash of the file
  try { return post(md); } catch (e) { throw new Error('threw on ' + JSON.stringify(md) + ': ' + e.constructor.name + ': ' + e.message); }
};

test('an escaped link before an unclosed `~~` still renders, as on main', () => {
  const md = '\\[a](/one) plain [b](/two) ~~unclosed';
  assert.equal(rendered(md), onMain(md));
});
test('an escaped link or image just before a strike pair renders, and the pair is drawn', () => {
  for (const [md, main] of STRIKE_NEXT_TO_ESCAPE) assert.equal(rendered(md), main.replace('~~strike~~', STRUCK('strike')), md);
});
test('a bold span that closes inside a link does not let `~~` pair across the link edge (as on main)', () => {
  const md = '~~**a [b** c~~](/p)';
  assert.equal(rendered(md), onMain(md));
});
test('a bold span that closes inside a raw <small> does not let `~~` pair across it (as on main)', () => {
  const md = '~~a <small>**b</small> c~~**';
  assert.equal(rendered(md), onMain(md));
});
test('guard: escapes, nested brackets and mis-nested emphasis never throw and render as on main', () => {
  const wrong = [];                    // every input is tried, so one run names all that differ
  for (const [md, main] of AS_ON_MAIN) {
    let got; try { got = rendered(md); } catch (e) { got = e.message; }
    if (got !== main) wrong.push(md + '\n      got  ' + got + '\n      main ' + main);
  }
  assert.equal(wrong.length, 0, wrong.length + ' of ' + AS_ON_MAIN.length + ' differ from main:\n    ' + wrong.join('\n    '));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
