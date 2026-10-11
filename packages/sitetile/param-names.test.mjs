// A param NAME with a hyphen in it is read whole — by the parser, by every copy of the parser, and
// by the coral that asks for it.
//   run: node packages/sitetile/param-names.test.mjs   (wired into scripts/test.sh via the glob)
//
// 🩸 CVERInc/reef#1915. parseParams read a name as `\w+`, and a hyphen is not a word character, so
// a hyphenated name was read from its last hyphen on:
//
//     parseParams('logo-pos=top')      → { pos: 'top' }
//     parseParams('data-x=1 a-b=2')    → { x: '1', b: '2' }
//
// The hero reads `pm['logo-pos']`. It was always undefined, the default (`bottom`) is a perfectly
// good hero, and so the documented `logo-pos=` did nothing on any page while nothing looked wrong.
// coral-params.test.mjs was already holding the READ in place ("hero must still read logo-pos");
// nothing asked whether the read could ever be answered.
//
// Three rulers, because the defect had three places to hide:
//   1. THE TABLE — what each shape of name and value parses to, written out by hand. Not derived
//      from the parser: a table the parser wrote agrees with the parser.
//   2. EVERY COPY — the same table through each copy of the parser that ships. There are two: the
//      source (site-core.js, which the section components and the string renderer both import) and
//      the copy esbuild inlined into the Card editor's committed bundle. A "must match" comment is
//      not a gate; running both is.
//   3. THE CORAL — a real build of a layered hero, read off the HTML: `logo-pos=top` is on the
//      page, `logo-pos=bottom` is the same page a hero with no `logo-pos=` makes, and the
//      stylesheet that shipped with it has the rule the attribute is for.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseParams } from './site-core.js';
import { EDIT2_JS } from '../cardtile/serve/edit2-assets.mjs';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '..', '..');

console.log('param-names');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// ── the copies ──────────────────────────────────────────────────────────────────────────────────
// The bundle is one string of JavaScript with site-core.js inlined in it. Cut the function out by
// its own text and compile that, so what runs below is the bundled copy and nothing else's.
function bundledParseParams() {
  const head = 'function parseParams(raw) {';
  const copies = EDIT2_JS.split(head).length - 1;
  if (copies !== 1) throw new Error(`expected one parseParams in the Card editor bundle, found ${copies}`);
  const from = EDIT2_JS.indexOf(head);
  const end = EDIT2_JS.indexOf('\n  }\n', from);   // esbuild closes a top-level function at two spaces
  if (end < 0) throw new Error('the bundled parseParams has no end this test can find');
  return new Function(`${EDIT2_JS.slice(from, end + 4)}\nreturn parseParams;`)();
}
const COPIES = [
  ['site-core.js', parseParams],
  ['the Card editor bundle (cardtile/serve/edit2-assets.mjs)', bundledParseParams()],
];

// ── ruler 1: the table ──────────────────────────────────────────────────────────────────────────
const link = (label, href) => ({ label, href });
const TABLE = [
  // a hyphenated name is ONE name
  ['logo-pos=top', { 'logo-pos': 'top' }],
  [' logo-pos=top', { 'logo-pos': 'top' }],
  ['data-x=1 a-b=2', { 'data-x': '1', 'a-b': '2' }],
  ['a-b-c=1', { 'a-b-c': '1' }],
  ['logo-pos="top"', { 'logo-pos': 'top' }],
  ['logo-pos="Top of the art"→/top', { 'logo-pos': link('Top of the art', '/top') }],
  ['Logo-Pos=Top', { 'Logo-Pos': 'Top' }],                       // case is kept, as it always was
  ['logo-pos=top logo-pos=bottom', { 'logo-pos': 'bottom' }],    // the last one written wins
  // …and is not ALSO its last segment: `pos` and `logo-pos` are two params
  ['pos=a logo-pos=b', { pos: 'a', 'logo-pos': 'b' }],
  ['logo-pos=b pos=a', { 'logo-pos': 'b', pos: 'a' }],
  // underscores and digits were always part of a name
  ['a_b=1', { a_b: '1' }],
  ['x_y-z=1', { 'x_y-z': '1' }],
  ['a1=2 9=3 9a=4 _x=5', { a1: '2', 9: '3', '9a': '4', _x: '5' }],
  ['col-2=x', { 'col-2': 'x' }],
  // a hyphen BEFORE the first word character is not in the name
  ['-a=1', { a: '1' }],
  ['--wide=1', { wide: '1' }],
  ['-=1', {}],
  // doubled and trailing hyphens are kept as written — nothing reads such a name, and nothing is
  // gained by guessing which shorter one was meant
  ['a--b=1', { 'a--b': '1' }],
  ['a-=1', { 'a-': '1' }],
  // a hyphen in a VALUE was never in question
  ['align=top-left', { align: 'top-left' }],
  ['align=top-left logo-pos=top', { align: 'top-left', 'logo-pos': 'top' }],
  ['x=1-y=2', { x: '1-y=2' }],                                   // a value runs to the next space
  ['url=https://example.com/a-b?c-d=e', { url: 'https://example.com/a-b?c-d=e' }],
  ['key="a b-c=d"', { key: 'a b-c=d' }],                         // `b-c=d` in quotes is not a param
  ['cta="a=b-c"→/x-y=z', { cta: link('a=b-c', '/x-y=z') }],
  ['a="x"b-c=1', { a: 'x', 'b-c': '1' }],
  // bare flags: a word alone (the map lists keys first, then flags). A hyphenated word alone is
  // not a flag, as before
  ['wide logo-pos=top', { 'logo-pos': 'top', wide: true }],
  ['logo-pos=top wide', { 'logo-pos': 'top', wide: true }],
  ['no-wrap wide', { wide: true }],
  ['a-b', {}],
  // the word beside a hyphenated name is its own word: `pos` here is a flag, not the key
  ['pos logo-pos=top', { 'logo-pos': 'top', pos: true }],
  // a space before `=` makes no param (unchanged), and the hyphenated name is no flag either
  ['logo-pos = top', { top: true }],
  ['pos logo-pos = top', { pos: true, top: true }],
  ['pos = 1 logo-pos = top', { top: true }],                     // `pos =` still marks `pos` as a key
  ['a-b=', {}],
  ['a-b= c', { c: true }],
  // names outside ASCII are not names (unchanged): the name starts at the first ASCII word character
  ['名=1', {}],
  ['名x=1', { x: '1' }],
  ['名-x=1', { x: '1' }],
  ['x-名=1', {}],
  // punctuation other than a hyphen still ends a name
  ['a.b-c=1', { 'b-c': '1' }],
  ['a/b-c=1', { 'b-c': '1' }],
];

for (const [where, parse] of COPIES) {
  await test(`${where}: every row of the table`, () => {
    const wrong = [];
    for (const [raw, want] of TABLE) {
      const got = JSON.stringify(parse(raw));
      if (got !== JSON.stringify(want)) wrong.push(`${JSON.stringify(raw)} → ${got}, want ${JSON.stringify(want)}`);
    }
    assert.equal(wrong.length, 0, `${wrong.length} of ${TABLE.length} rows:\n         ` + wrong.join('\n         '));
  });
}

// One assertion per property, so a break names what it broke instead of "some rows".
for (const [where, parse] of COPIES) {
  await test(`${where}: a hyphenated name is read whole, and not also as its last segment`, () => {
    const pm = parse('logo-pos=top');
    assert.equal(pm['logo-pos'], 'top');
    assert.ok(!('pos' in pm), '`logo-pos=top` also set `pos` — the name was read from its last hyphen');
    assert.ok(!('logo' in pm), '`logo-pos=top` also set `logo`');
    assert.deepEqual(Object.keys(parse('data-x=1 a-b=2')), ['data-x', 'a-b']);
  });
  await test(`${where}: a value keeps its hyphens`, () => {
    assert.equal(parse('align=top-left').align, 'top-left');
    assert.equal(parse('align=top-left logo-pos=top').align, 'top-left');
    assert.deepEqual(parse('cta="Read on — part two"→/part-two').cta, link('Read on — part two', '/part-two'));
    assert.equal(parse('x=1-y=2').x, '1-y=2');
    assert.ok(!('y' in parse('x=1-y=2')), 'a name was read out of the middle of a value');
  });
}

await test('the copies agree with each other on text nobody wrote a row for', () => {
  // The table is the shapes somebody thought of. This is the rest: lines assembled from the pieces
  // a param line is made of, hyphens among them, read by both copies. 🔴 Uneven on purpose — a
  // corpus of one repeated token cannot tell "kept the front" from "kept the back".
  let seed = 1915;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const BITS = ['logo', 'pos', 'a', 'B9', '_x', 'wide', '-', '-', '--', '=', '=', ' ', ' ', '\t', '"', '"Go wide"', '"x"→/a-b',
    'top-left', '名', '.', '/', '= ', ' =', '=3', 'cols=2'];
  let differ = 0, hyphenated = 0;
  for (let i = 0; i < 20000; i++) {
    let raw = '';
    for (let n = 1 + Math.floor(rnd() * 12); n > 0; n--) raw += pick(BITS);
    const [a, b] = COPIES.map(([, parse]) => JSON.stringify(parse(raw)));
    if (a !== b) differ++;
    assert.equal(a, b, JSON.stringify(raw));
    if (Object.keys(parseParams(raw)).some((k) => k.includes('-'))) hyphenated++;
  }
  assert.equal(differ, 0);
  // 🔴 A comparison over lines that never produce a hyphenated name says nothing about them.
  assert.ok(hyphenated > 1000, `only ${hyphenated} of 20000 lines carried a hyphenated name`);
});

// ── ruler 3: the coral ──────────────────────────────────────────────────────────────────────────
const ASTRO = join(ENGINE, RENDERER_SUBPATH);
if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · the layered hero's logo-pos= SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (it is the only case here that builds a real page; a green run without it is narrower)');
} else {
  const hero = (title, params) => `## ${title}\n%% sitetile: hero layers=/back.webp|/front.webp${params ? ' ' + params : ''} %%\n\nBody of ${title}.\n`;
  const HEROES = [
    ['Unset', '', 'bottom'],
    ['Top', 'logo-pos=top', 'top'],
    ['Bottom', 'logo-pos=bottom', 'bottom'],
    ['Center', 'logo-pos=center', 'center'],
    ['Quoted', 'logo-pos="top"', 'top'],
    ['Among others', 'parallax logo-pos=top eyebrow="New"', 'top'],
    // `pos=` is not `logo-pos=`: before the fix these two were one key, and whichever was written
    // last moved the logo.
    ['Pos alone', 'pos=top', 'bottom'],
    ['Pos after', 'logo-pos=top pos=center', 'top'],
  ];
  const ir = mkdtempSync(join(tmpdir(), 'tile-param-names-ir-'));
  const out = mkdtempSync(join(tmpdir(), 'tile-param-names-out-'));
  try {
    mkdirSync(ir, { recursive: true });
    writeFileSync(join(ir, 'home.md'),
      '---\nsitetile-page: home\ntitle: Layered heroes\nlang: en-US\n---\n\n'
      + HEROES.map(([title, params]) => hero(title, params)).join('\n')
      + '\n## Plain\n%% sitetile: hero logo-pos=top %%\n\nA hero with no layers.\n');
    const result = await buildSite({ irDir: ir, engineDir: ENGINE, outDir: out, siteUrl: 'https://example.com' });
    const html = result.code === 0 ? readFileSync(join(out, 'index.html'), 'utf8') : '';
    // Each layered hero's opening tag, in page order, with the `<h1>` that follows it — so a row is
    // matched to ITS section by title and not by counting.
    const sections = [...html.matchAll(/<section\b([^>]*\bst-hero-layered\b[^>]*)>([\s\S]*?)<\/section>/g)]
      .map((m) => ({ tag: m[1], title: (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(m[2]) || [])[1], pos: (/\bdata-logo-pos="([^"]*)"/.exec(m[1]) || [])[1] }));
    const byTitle = new Map(sections.map((s) => [s.title, s]));
    // The tag with the two things that legitimately differ between sections taken out.
    const shape = (s) => s.tag.replace(/\sid="[^"]*"/, '').replace(/\sdata-astro-[\w-]+(="[^"]*")?/g, '');

    await test('the fixture built, and every layered hero is on the page', () => {
      assert.equal(result.code, 0, 'astro build exited non-zero');
      assert.equal(sections.length, HEROES.length, `${sections.length} layered heroes in the page, ${HEROES.length} written`);
      for (const [title] of HEROES) assert.ok(byTitle.has(title), `no layered hero titled ${JSON.stringify(title)} in the page`);
    });
    await test('🔴 logo-pos= reaches the layered hero', () => {
      for (const [title, params, want] of HEROES) {
        assert.equal(byTitle.get(title)?.pos, want, `hero ${JSON.stringify(params)}: data-logo-pos`);
      }
    });
    await test('logo-pos=top is a different section from the default, and differs in that one attribute', () => {
      const unset = shape(byTitle.get('Unset')), top = shape(byTitle.get('Top'));
      assert.notEqual(top, unset, '`logo-pos=top` built the same section as no `logo-pos=` at all');
      assert.equal(top.replace('data-logo-pos="top"', 'data-logo-pos="bottom"'), unset);
    });
    await test('CONTROL: logo-pos=bottom is the default, attribute for attribute', () => {
      assert.equal(shape(byTitle.get('Bottom')), shape(byTitle.get('Unset')));
    });
    await test('the stylesheet the page shipped with moves the title block on that attribute', () => {
      // The attribute is only half of "takes effect": something has to select on it. Read from the
      // build's own CSS, minified however the build minifies it, not from the source stylesheet.
      const cssFiles = [];
      const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.css')) cssFiles.push(p); } };
      walk(out);
      const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n') + [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      for (const [pos, align] of [['top', 'start'], ['center', 'center']]) {
        const rule = new RegExp(`\\.st-hero-layered\\[data-logo-pos="?${pos}"?\\]\\s*\\.st-hero-overlay\\s*\\{[^}]*align-self:\\s*${align}\\b`);
        assert.match(css, rule, `no rule places the overlay for data-logo-pos=${pos}`);
      }
      assert.match(css, /\.st-hero-overlay\s*\{[^}]*align-self:\s*end\b/, 'the default placement (bottom) is gone, so "differs from the default" means nothing');
    });
    await test('a hero with no layers takes no logo-pos, as before', () => {
      const plain = /<section\b([^>]*)>(?:(?!<\/section>)[\s\S])*?A hero with no layers\./.exec(html.slice(html.lastIndexOf('<section', html.indexOf('A hero with no layers.'))));
      assert.ok(plain, 'the plain hero is not on the page');
      assert.ok(!/data-logo-pos/.test(plain[1]), 'the legacy hero grew a data-logo-pos');
      assert.ok(!/st-hero-layered/.test(plain[1]));
    });
  } finally {
    rmSync(ir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`  ${passed} passed`);
