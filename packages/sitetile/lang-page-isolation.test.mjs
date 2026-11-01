// The language chooser survives a site's own site-wide CSS, and a site can still restyle it.
//   run: node packages/sitetile/lang-page-isolation.test.mjs   (globbed into scripts/test.sh)
//        PLAYWRIGHT=/path/to/node_modules/playwright/index.js node …   (adds the measured half;
//        index.mjs works too)
//
// 🩸 reef#1887. A two-language site wrote a site-wide side gutter in its theme. It was a
// sound rule for that site's full-width sections. The chooser at /language is a page the platform
// draws, with a 32rem column, and the same padding took the whole column: the heading was left
// with a few pixels and wrapped one character per line. The band behind the rows was a dark teal
// that no token on the site had asked for, and a theme rule on `.rf-lang-list` lost to the
// platform's identical selector because the platform's sheet came later in the document.
//
// 🩸 The first cut of the fix then took a page away from an owner who HAD looked at it: a real theme
// laid the rows out as a three-column grid, and the lifted box turned them back into one stacked
// column. A layer cannot tell that rule from a blanket one. What can is that the deliberate rule
// names the part, so each part the theme names gets its box as a default below the theme instead
// (astro/src/packages/lingo/language-page-css.mjs).
//
// 🩸 The second cut handed over the PAGE's box as well when a theme named the page, and the column
// is the page's own padding: a theme that named the page for its colour and capped its sections
// (`.rf-main > section { max-width: 60rem; margin-inline: auto }`) left the heading 192px at a
// 1280px viewport and 0px at 1920. It also read `.rf-lang-page ul { display: grid }` as naming the
// page only, so that owner's grid stayed stacked. Now the page's box never moves, and naming the
// page names the heading block and the list.
//
// Three halves, and they do not prove the same thing:
//
//   pure      reads the stylesheet's STRUCTURE — which declarations sit in which layer. Runs in a
//             bare checkout. It can say the protection is where it has to be; it cannot say a
//             browser resolves the cascade the way that structure intends.
//   built     real IR in, real HTML out: the chooser's sheet is on the chooser only, once, and
//             ahead of the theme. Needs the renderer's dependencies and says so without them.
//   measured  the built pages in a real browser, one site-wide rule at a time: line count, box
//             widths, what a click lands on, computed colours. Needs PLAYWRIGHT and says so
//             without it. This is the only half that sees the defect itself.

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';
import { chooserCss, namedChooserParts, CHOOSER_PARTS } from './astro/src/packages/lingo/language-page-css.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);
const cssRaw = readFileSync(join(HERE, 'astro/src/packages/lingo/language-page.css'), 'utf8');
const layout = readFileSync(join(HERE, 'astro/src/layouts/SiteLayout.astro'), 'utf8');
const route = readFileSync(join(HERE, 'astro/src/pages/[...loc]/language.astro'), 'utf8');

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// ── pure ─────────────────────────────────────────────────────────────────────────────────────
// Comments go first: the file explains the guard it must not use and quotes the colour it no longer
// falls back to, and a check that read those sentences would be reading its own explanation.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

// `@layer <name> { selector { decls } … }` → { name: Map(selector → Map(prop → value)) }, plus
// whatever is left outside every layer block.
function readLayers(text) {
  const layers = {}; let outside = ''; let i = 0;
  const open = /@layer\s+([\w.-]+)\s*\{/g;
  for (let m; (m = open.exec(text));) {
    outside += text.slice(i, m.index);
    let depth = 1; let j = open.lastIndex;
    for (; j < text.length && depth > 0; j++) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; }
    assert.equal(depth, 0, `@layer ${m[1]} never closes`);
    const body = text.slice(open.lastIndex, j - 1);
    const rules = (layers[m[1]] ||= new Map());
    for (const r of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const sel of r[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '))) {
        const decls = (rules.get(sel) || rules.set(sel, new Map()).get(sel));
        for (const d of r[2].split(';')) {
          const k = d.indexOf(':'); if (k < 0) continue;
          decls.set(d.slice(0, k).trim(), d.slice(k + 1).trim());
        }
      }
    }
    i = open.lastIndex = j;
  }
  outside += text.slice(i);
  return { layers, outside: outside.trim() };
}
const { layers, outside } = readLayers(css);
const look = layers['reef.theme'] || new Map();
const box = layers['reef.responsive'] || new Map();
// A missing rule is the finding; say which, rather than a TypeError two lines later.
const rule = (map, where, sel) => { const d = map.get(sel); assert.ok(d, `no \`${sel}\` rule in ${where}`); return d; };

// What a blanket rule breaks without meaning to, per part. `display` and the width properties
// everywhere; side padding where the heading lives; side margins where the band is positioned.
const WIDTHS = ['display', 'box-sizing', 'width', 'min-width', 'max-width'];
const BOX = {
  '.rf-lang-page': WIDTHS,
  '.rf-lang-head': [...WIDTHS, 'padding-inline'],
  '.rf-lang-head h1': [...WIDTHS, 'padding-inline'],
  '.rf-lang-head p': [...WIDTHS, 'padding-inline'],
  '.rf-lang-list': [...WIDTHS, 'flex-direction', 'margin-inline'],
  '.rf-lang-list > li': [...WIDTHS, 'margin-inline'],
  '.rf-lang-list a': WIDTHS,
};
// The look's selectors, as written. They are the platform's whole weight in every contest with a
// theme, so a theme that names the same part at the same weight wins by coming later.
const LOOK = ['.rf-lang-page', '.rf-lang-head', '.rf-lang-head h1', '.rf-lang-head p', '.rf-lang-list', '.rf-lang-list a',
  '.rf-lang-list a:hover', '.rf-lang-list a[aria-current="true"]', '.rf-lang-name', '.rf-lang-action', '.rf-lang-action .rf-lang-arrow'];

await test('the parser reads the file: two layers, several rules in each', () => {
  // Without this every assertion below could be passing on an empty map.
  assert.deepEqual(Object.keys(layers).sort(), ['reef.responsive', 'reef.theme']);
  assert.ok(look.size >= 8, `parsed ${look.size} look rules`);
  assert.ok(box.size >= 5, `parsed ${box.size} box rules`);
});

await test('🔴 every part\'s box is declared in the layer AFTER the theme', () => {
  const order = /@layer ([^;]+);/.exec(layout)[1].split(',').map((s) => s.trim());
  assert.ok(order.indexOf('reef.responsive') > order.indexOf('reef.theme'), 'reef.responsive must follow reef.theme');
  // Exact, per selector: an allowed property on the wrong part (`padding-inline` on the band, a
  // margin on a row link) is as much a change to the lifted layer as a new selector is.
  assert.deepEqual([...box.keys()].sort(), Object.keys(BOX).sort(), 'the set of selectors lifted above the theme changed');
  for (const [sel, props] of Object.entries(BOX)) {
    const decls = box.get(sel);
    assert.ok(decls, `no rule for \`${sel}\` in reef.responsive — its box is back in the theme's reach`);
    assert.deepEqual([...decls.keys()].sort(), props.slice().sort(), `\`${sel}\` above the theme holds other than its pinned box`);
  }
});

await test('🔴 the protection is not behind a guard: the selectors are the bare parts', () => {
  // A guard such as `body:not([data-theme-custom]) .rf-lang-page` reads as care and excuses exactly
  // the sites that carry hand-written CSS. The selector list is pinned whole, so any prefix shows.
  assert.deepEqual([...box.keys()].sort(), Object.keys(BOX).sort());
  // The look is pinned for the other half of the same reason: `.rf-lang-page .rf-lang-list` would
  // out-score a theme's `.rf-lang-list` and the owner is back to raising specificity to be heard.
  assert.deepEqual([...look.keys()].sort(), [...LOOK].sort());
  for (const sel of [...box.keys(), ...look.keys()]) {
    assert.doesNotMatch(sel, /\bbody\b|\bhtml\b|:not\(|:where\(|\[data-/, `guarded or re-weighted selector: ${sel}`);
  }
});

await test('🔴 NOTHING BUT the box is above the theme — the look stays where a theme can reach it', () => {
  // The control for the opposite mistake: lifting the whole sheet above the theme protects the
  // page completely and takes it away from the owner in the same move.
  const allowed = new Set([...WIDTHS, 'flex-direction', 'margin-inline', 'padding-inline']);
  const lifted = [...new Set([...box.values()].flatMap((d) => [...d.keys()]))];
  assert.deepEqual(lifted.filter((p) => !allowed.has(p)), [], 'only box properties belong above the theme');
  // …and the page's own side padding is deliberately NOT one of them: a site's gutter rule may
  // replace it, which is what makes that rule harmless here.
  assert.equal(rule(box, 'reef.responsive', '.rf-lang-page').has('padding-inline'), false);
  for (const p of ['background', 'color']) assert.ok(rule(look, 'reef.theme', '.rf-lang-list').has(p), `the band's ${p} left the theme layer`);
  assert.equal(outside, '', 'a rule outside every layer outranks the theme at any specificity');
  assert.doesNotMatch(css, /!important/, 'the layer order is the mechanism; !important would be a second one');
});

await test('🔴 the column is the page\'s own padding, not a width a gutter can eat', () => {
  const page = rule(look, 'reef.theme', '.rf-lang-page');
  assert.equal(page.has('width'), false, 'a fixed-width border-box is what a site-wide gutter emptied');
  assert.match(page.get('padding'), /max\(var\(--rf-lang-gutter, 1\.5rem\), calc\(50% - var\(--rf-lang-width, 32rem\) \/ 2\)\)/);
  assert.equal(rule(box, 'reef.responsive', '.rf-lang-page').get('width'), 'auto');
});

await test('🔴 an unset token falls back to another token, never to a colour', () => {
  const band = rule(look, 'reef.theme', '.rf-lang-list');
  assert.equal(band.get('background'), 'var(--rf-lang-band, var(--gd-bg-dark, var(--gd-surface)))');
  assert.equal(band.get('color'), 'var(--rf-lang-band-ink, inherit)');
  // No colour literal anywhere in the sheet: `transparent` and `currentColor` are the only two
  // colour words it uses, and both mean "whatever the site already is".
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
});

await test('🔴 the route hands its sheet to the layout as text; it does not import it as a stylesheet', () => {
  const imports = [...route.matchAll(/import[^\n;]*language-page\.css[^\n;]*/g)].map((m) => m[0]);
  assert.equal(imports.length, 1, `expected one import of the sheet, found ${imports.length}`);
  assert.match(imports[0], /language-page\.css\?raw/, 'a plain import lands in Astro\'s <style>, after the theme');
  // …through the one function that decides the layers, called by the layout with the theme's text.
  assert.ok(route.includes('routeCss={(themeCss) => chooserCss(languagePageCss, themeCss)}'), 'the route no longer passes chooserCss over its sheet');
  assert.ok(layout.includes("typeof routeCss === 'function' ? routeCss(themeCss)"), 'the layout no longer hands the theme to routeCss');
  const emit = layout.indexOf('{routeCss && <style');
  assert.ok(emit > -1, 'the layout does not emit routeCss');
  assert.ok(emit < layout.indexOf('{themeCss && <style'), 'routeCss must be emitted before the theme');
});

// ── pure: name it and you own it ─────────────────────────────────────────────────────────────
// A theme of the ordinary kind: tokens, and site-wide rules that name nothing on this page.
const BLANKET = 'html:root { --gd-accent: #7a3fb0; }\nhtml main * { max-width: 18rem; }\nhtml .rf-main > * > * { width: 12rem; }\n.rf-footer .rf-lang { padding-block: 9px; }';
const PART_SELECTORS = {
  '.rf-lang-page': ['.rf-lang-page'],
  '.rf-lang-head': ['.rf-lang-head', '.rf-lang-head h1', '.rf-lang-head p'],
  '.rf-lang-list': ['.rf-lang-list', '.rf-lang-list > li', '.rf-lang-list a'],
};
// Top-level block names of an emitted sheet, in order, and any text outside them.
const topLevel = (text) => {
  const top = []; let depth = 0; let head = '';
  for (const ch of text) {
    if (ch === '{') { if (depth === 0) { top.push(head.trim().replace(/\s+/g, ' ')); head = ''; } depth++; }
    else if (ch === '}') { depth--; if (depth === 0) continue; }
    else if (depth === 0) head += ch;
  }
  return { top, stray: head.trim(), depth };
};
// The rule, stated here independently of the function under test: the heading block and the list
// are each owned when the theme names them or names the page above them; the page never is.
const PAGE = '.rf-lang-page';
const ownedBy = (named) => ['.rf-lang-head', '.rf-lang-list'].filter((p) => named.includes(p) || named.includes(PAGE));
// Where each pinned box declaration of `out` ended up: every one of the 41 must be in exactly one
// of the two layers, with the value the file gives it. `owned` is the parts expected below the theme.
const assertSplit = (out, owned, why) => {
  const got = readLayers(out);
  const lifted = got.layers['reef.responsive'] || new Map();
  const defaults = got.layers['reef.theme'] || new Map();
  assert.equal(got.outside, '', `${why}: text outside every layer`);
  let seen = 0;
  for (const [part, sels] of Object.entries(PART_SELECTORS)) {
    for (const sel of sels) {
      const [here, notHere, where] = owned.includes(part) ? [defaults, lifted, 'reef.theme'] : [lifted, defaults, 'reef.responsive'];
      for (const [prop, value] of box.get(sel)) {
        seen++;
        assert.equal(here.get(sel)?.get(prop), value, `${why}: \`${sel} { ${prop} }\` should be in ${where}`);
        // The look and the box share no property, so the other layer must not hold this one at all.
        assert.equal(notHere.get(sel)?.has(prop) || false, false, `${why}: \`${sel} { ${prop} }\` is ALSO in the other layer`);
      }
    }
    if (owned.includes(part)) for (const sel of sels) assert.equal(lifted.has(sel), false, `${why}: \`${sel}\` still has a rule above the theme`);
  }
  assert.equal(seen, 41, 'the pinned box is 41 declarations');
  // 🔴 The page's own box is above the theme in every output, whatever was named. (Stated on its
  // own: a caller that wrongly passed the page as owned would otherwise be agreed with above.)
  assert.equal(owned.includes(PAGE), false, `${why}: the page is never an owned part`);
  for (const [prop, value] of box.get(PAGE)) {
    assert.equal(lifted.get(PAGE)?.get(prop), value, `${why}: \`${PAGE} { ${prop} }\` left the layer above the theme`);
    assert.equal(defaults.get(PAGE)?.has(prop) || false, false, `${why}: \`${PAGE} { ${prop} }\` is below the theme`);
  }
  // The look is never touched by any of this.
  for (const sel of LOOK) for (const [prop, value] of look.get(sel)) assert.equal(defaults.get(sel)?.get(prop), value, `${why}: the look lost \`${sel} { ${prop} }\``);
  return { lifted, defaults };
};

await test('the three parts are the page, the heading block and the list — and cover all seven lifted selectors', () => {
  assert.deepEqual(CHOOSER_PARTS, Object.keys(PART_SELECTORS));
  assert.deepEqual(Object.values(PART_SELECTORS).flat().sort(), Object.keys(BOX).sort());
});

await test('🔴 a theme that names no part gets the sheet exactly as the file has it', () => {
  // Byte for byte, not "equivalent": this is every site that existed before the rule did.
  for (const theme of ['', undefined, BLANKET]) assert.equal(chooserCss(cssRaw, theme), css, `theme: ${JSON.stringify(theme)}`);
  assert.deepEqual(namedChooserParts(BLANKET), []);
});

await test('🔴 a theme that names the list owns the list\'s box; the page and the heading stay above the theme', () => {
  const theme = BLANKET + '\n.rf-lang-list { display: grid; grid-template-columns: 5fr 4fr 3fr; }';
  assert.deepEqual(namedChooserParts(theme), ['.rf-lang-list']);
  const out = chooserCss(cssRaw, theme);
  const { lifted } = assertSplit(out, ['.rf-lang-list'], 'list named');
  assert.deepEqual([...lifted.keys()].sort(), [...PART_SELECTORS['.rf-lang-page'], ...PART_SELECTORS['.rf-lang-head']].sort());
  // Two default blocks then the lifted one: the moved box must not land after `reef.responsive`
  // textually un-layered, nor inside it.
  assert.deepEqual(topLevel(out), { top: ['@layer reef.theme', '@layer reef.theme', '@layer reef.responsive'], stray: '', depth: 0 });
});

await test('🔴 each part alone, every pair, and all three: the page never moves, and naming it names the other two', () => {
  const rules = { '.rf-lang-page': 'html .rf-lang-page { max-width: 44rem; }', '.rf-lang-head': '.rf-lang-head::before { content: "•"; }', '.rf-lang-list': '.rf-lang-list > li { flex: 1; }' };
  // Written out, not computed: seven themes, and for each the parts whose box is the owner's.
  const HEAD_LIST = ['.rf-lang-head', '.rf-lang-list'];
  const EXPECT = [
    [['.rf-lang-page'], HEAD_LIST],
    [['.rf-lang-head'], ['.rf-lang-head']],
    [['.rf-lang-list'], ['.rf-lang-list']],
    [['.rf-lang-page', '.rf-lang-head'], HEAD_LIST],
    [['.rf-lang-page', '.rf-lang-list'], HEAD_LIST],
    [['.rf-lang-head', '.rf-lang-list'], HEAD_LIST],
    [['.rf-lang-page', '.rf-lang-head', '.rf-lang-list'], HEAD_LIST],
  ];
  for (const [named, owned] of EXPECT) {
    const theme = BLANKET + '\n' + named.map((p) => rules[p]).join('\n');
    const why = `named ${named.join(' + ')}`;
    assert.deepEqual(namedChooserParts(theme), named, why);
    assert.deepEqual(ownedBy(named), owned, why);
    const out = chooserCss(cssRaw, theme);
    const { lifted } = assertSplit(out, owned, why);
    // What is left above the theme: always the page, plus whichever of the two was not handed over.
    const stay = [PAGE, ...HEAD_LIST.filter((p) => !owned.includes(p)).flatMap((p) => PART_SELECTORS[p])];
    assert.deepEqual([...lifted.keys()].sort(), stay.sort(), why);
    // So the lifted block is never empty and is always emitted, last.
    assert.deepEqual(topLevel(out), { top: ['@layer reef.theme', '@layer reef.theme', '@layer reef.responsive'], stray: '', depth: 0 }, why);
  }
});

await test('🔴 a rule that starts from the page and reaches inside names the list and the heading block', () => {
  // The descendants are reached by element name; neither `.rf-lang-list` nor `.rf-lang-head` is
  // written anywhere. Flat and nested spellings are the same rule.
  const flat = '.rf-lang-page ul { display: grid; grid-template-columns: 1fr 1fr; } .rf-lang-page li { max-width: none; } .rf-lang-page h1 { max-width: 10ch; }';
  const nested = '.rf-lang-page { ul { display: grid; grid-template-columns: 1fr 1fr; } li { max-width: none; } h1 { max-width: 10ch; } }';
  for (const theme of [flat, nested, '.rf-lang-page { color: inherit; }']) {
    assert.deepEqual(namedChooserParts(theme), [PAGE], theme);
    const { lifted } = assertSplit(chooserCss(cssRaw, BLANKET + '\n' + theme), ['.rf-lang-head', '.rf-lang-list'], theme);
    assert.deepEqual([...lifted.keys()], [PAGE], theme);
  }
});

await test('🔴 what counts as naming a part: the class as a whole token, in a rule, in its dot form', () => {
  const names = (theme) => namedChooserParts(theme);
  // A comment is not a rule. A theme that explains why it leaves the chooser alone must not, by
  // explaining, give up the protection. (The layout strips comments too; the function does not rely on it.)
  assert.deepEqual(names('/* .rf-lang-list is left as the platform draws it */\nhtml main * { max-width: 18rem; }'), []);
  assert.deepEqual(names('main{color:red}/* .rf-lang-page\n.rf-lang-head { x } */.rf-lang-list{gap:2px}'), ['.rf-lang-list']);
  // A longer class that merely starts the same way is another class.
  for (const other of ['.rf-lang-listing { gap: 1px; }', '.rf-lang-list-item { gap: 1px; }', '.rf-lang-list_alt { gap: 1px; }', '.rf-lang-pages, .rf-lang-header, .rf-lang { gap: 1px; }']) {
    assert.deepEqual(names(other), [], other);
  }
  // …and every way the class ends in a real selector is the class.
  for (const same of ['.rf-lang-list{gap:1px}', '.rf-lang-list:hover { gap: 1px; }', '.rf-lang-list>li { gap: 1px; }', '.rf-lang-list, .x { gap: 1px; }', 'ul.rf-lang-list.wide { gap: 1px; }', '.rf-lang-list\n{ gap: 1px; }', '.rf-lang-list[aria-label] { gap: 1px; }']) {
    assert.deepEqual(names(same), ['.rf-lang-list'], same);
  }
  // PINNED: a mention anywhere in a selector counts, including as an ancestor, inside :has() and
  // inside :not(). The rule's question is "did whoever wrote this theme have the chooser in front
  // of them", and all of these answer yes. Telling a subject from a scope would take a selector
  // parser, and getting it wrong in the other direction is the defect this rule exists for.
  assert.deepEqual(names('.rf-lang-page .rf-lang-list a { color: teal; }'), ['.rf-lang-page', '.rf-lang-list']);
  assert.deepEqual(names('html body:has(.rf-lang-page) .rf-main { padding: 0; }'), ['.rf-lang-page']);
  assert.deepEqual(names('main ul:not(.rf-lang-list) { columns: 2; }'), ['.rf-lang-list']);
  // PINNED: an attribute selector does not count — it has no dot form. Missing a spelling leaves
  // the part protected (the documented default, with the tokens and !important as ways out);
  // matching the bare substring instead would also match `rf-lang-list` in a url or a string.
  assert.deepEqual(names('[class~="rf-lang-list"] { display: grid; } [class*="rf-lang-head"] { margin: 0; }'), []);
  assert.equal(chooserCss(cssRaw, '[class~="rf-lang-list"] { display: grid; }'), css);
  // KNOWN LIMITS, pinned so that changing one is a decision. Not seen (the part stays protected):
  // an escaped spelling of the class, and a rule that reaches a part through a class INSIDE it.
  for (const unseen of ['.rf-lang-\\6c ist { display: grid; }', '.rf\\-lang-list { display: grid; }', 'li:has(.rf-lang-name) { max-width: none; }', '.rf-lang-action { display: none; }']) {
    assert.deepEqual(names(unseen), [], unseen);
    assert.equal(chooserCss(cssRaw, unseen), css, unseen);
  }
  // Seen although it is not a selector (the part loses its protection): the dot form inside a
  // string or a url(). There is no parser here to know the difference.
  assert.deepEqual(names('.note::after { content: "see .rf-lang-list"; }'), ['.rf-lang-list']);
  assert.deepEqual(names('.hero { background: url(/img/banner.rf-lang-head.png); }'), ['.rf-lang-head']);
});

await test('the function refuses a lifted block it cannot attribute to a part', () => {
  // The split is by selector prefix. A rule added above the theme for anything else would be
  // silently unmovable, so it is a build error instead.
  const stray = cssRaw.replace('.rf-lang-list a { display: flex;', '.rf-lang-name { display: flex;');
  assert.notEqual(stray, cssRaw);
  assert.throws(() => chooserCss(stray, ''), /does not start with one of/);
  assert.throws(() => chooserCss(cssRaw.replace('@layer reef.responsive', '@layer reef.other'), ''), /no @layer reef\.responsive/);
});

// ── built ────────────────────────────────────────────────────────────────────────────────────
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: prose %%\n\nA fixture page.\n`;
const ir = (siteFm, third = false) => ({
  '_site.md': `---\nbrand: Tsuru Paper\nlocales: en, zh-TW${third ? ', ja' : ''}\n${siteFm}---\n`,
  'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
  'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
  ...(third ? { 'ja/home.md': page('sitetile-page: home\ntitle: 折り鶴の紙\nlang: ja', '折り鶴') } : {}),
});
// The sentinel is where each site-wide rule is swapped in for the measured half: inside the theme's
// own <style>, at the position a site's custom CSS really occupies.
const SLOT = '.fx-site-wide-rule-slot{top:0}';
// Deliberately the shape of a theme WITH hand-written CSS — a compiled token block, the machine
// marker, then custom rules — so the layout stamps `data-theme-custom`. That is the kind of site
// the defect happened on, and the kind a guard would have excused.
const THEME = [
  '/* Compiled from ir/_theme.md — do not hand-edit. Theme: fx. */',
  'html:root { --gd-bg: #fbf7f0; --gd-surface: #f1e9da; --gd-text: #2a2118; --gd-accent: #b4532a; }',
  '/* reef:has-custom-css */',
  SLOT,
].join('\n');
// A theme whose owner DID look at the chooser: the rows are a three-column grid of unequal tracks
// (so "side by side" cannot be satisfied by three equal anythings), and the same file carries a
// blanket rule that names nothing. It names the list only — the heading block is mentioned in a
// comment, which must not count — so the list is the owner's and the heading is still protected.
// 🔴 The blanket rule is one that out-scores the platform's bare `.rf-lang-head` (0,1,1 against
// 0,1,0). A weaker one (`html main *`) loses on specificity in any layer, and a test built on it
// stays green with the heading's protection gone. The owner's list rule says `html` for the same
// reason any owner's would: the blanket rule reaches the list too.
const GRID = '5fr 4fr 3fr';
const THEME_GRID = [
  '/* Compiled from ir/_theme.md — do not hand-edit. Theme: fxgrid. */',
  'html:root { --gd-bg: #f4f8f3; --gd-surface: #dfeadb; --gd-text: #1d2a22; --gd-accent: #2f7d5b; }',
  '/* reef:has-custom-css */',
  '/* Language page: three tiles in a row. .rf-lang-head keeps the platform\'s layout. */',
  'html .rf-main > * > * { max-width: 18rem; }',
  `html .rf-lang-list { display: grid; grid-template-columns: ${GRID}; gap: 14px; width: auto; max-width: none; margin-inline: 0; padding: 28px 20px; }`,
  '.rf-lang-list > li { max-width: none; }',
  '.rf-lang-list a { justify-content: center; }',
].join('\n');
// A theme that names all three parts for their APPEARANCE only — no box property anywhere — and
// keeps the slot, so the site-wide rules of the measured half land in a theme the build saw naming.
const THEME_NAMED = [
  '/* Compiled from ir/_theme.md — do not hand-edit. Theme: fxnamed. */',
  'html:root { --gd-bg: #fbf7f0; --gd-surface: #f1e9da; --gd-text: #2a2118; --gd-accent: #b4532a; }',
  '/* reef:has-custom-css */',
  '.rf-lang-page { color: inherit; }',
  '.rf-lang-head { letter-spacing: 0; }',
  '.rf-lang-list { border-radius: 0; }',
  SLOT,
].join('\n');
// A theme that lays the chooser out from the page inwards and never writes the inner classes: two
// columns, rows as wide as their track, a narrow heading. Flat, and the same rules nested.
const REACH = ['ul { display: grid; grid-template-columns: 1fr 1fr; }', 'li { max-width: none; }', 'h1 { max-width: 10ch; }'];
const reachTheme = (name, rules) => [
  `/* Compiled from ir/_theme.md — do not hand-edit. Theme: ${name}. */`,
  'html:root { --gd-bg: #f4f8f3; --gd-surface: #dfeadb; --gd-text: #1d2a22; --gd-accent: #2f7d5b; }',
  '/* reef:has-custom-css */',
  rules,
].join('\n');
const THEME_REACH = reachTheme('fxreach', REACH.map((r) => '.rf-lang-page ' + r).join('\n'));
const THEME_NESTED = reachTheme('fxnested', `.rf-lang-page { ${REACH.join(' ')} }`);
const SITES = {
  plain: { files: ir('') },
  themed: { files: ir('theme: fx\n'), theme: THEME },
  grid: { files: ir('theme: fxgrid\n', true), theme: THEME_GRID },
  named: { files: ir('theme: fxnamed\n'), theme: THEME_NAMED },
  reach: { files: ir('theme: fxreach\n'), theme: THEME_REACH },
  nested: { files: ir('theme: fxnested\n'), theme: THEME_NESTED },
};

// The <style> blocks carrying the platform's chooser rules. Told by `--rf-lang-gutter`, which only
// the platform's sheet reads: a fixture theme that names `.rf-lang-page` carries the class too.
const chooserStyles = (html) => [...html.matchAll(/<style>([^<]*--rf-lang-gutter[^<]*)<\/style>/g)];

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · lang-page-isolation BUILT + MEASURED SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (without them nothing here has looked at a page the renderer actually wrote)');
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-lang-page-'));
  const built = {};
  try {
    for (const [name, site] of Object.entries(SITES)) {
      const irDir = join(work, name, 'ir');
      for (const [rel, body] of Object.entries(site.files)) {
        mkdirSync(dirname(join(irDir, rel)), { recursive: true });
        writeFileSync(join(irDir, rel), body);
      }
      let themeFile;
      if (site.theme) { themeFile = join(work, name, 'theme.css'); writeFileSync(themeFile, site.theme); }
      const outDir = join(work, name, 'out');
      const r = await buildSite({ irDir, engineDir: ENGINE, outDir, siteUrl: 'https://example.com', themeFile });
      assert.equal(r.code, 0, `astro build failed for the ${name} fixture`);
      built[name] = { outDir, chooser: readFileSync(join(outDir, 'language/index.html'), 'utf8'), home: readFileSync(join(outDir, 'index.html'), 'utf8') };
    }

    await test('the fixture is the kind of site this is for: a theme carrying hand-written CSS', () => {
      assert.match(built.themed.chooser, /<body[^>]*\bdata-theme-custom\b/);
      assert.ok(built.themed.chooser.includes(SLOT), 'the theme\'s custom CSS did not reach the chooser');
    });

    await test('🔴 the chooser\'s sheet is on the page once, and BEFORE the site\'s theme', () => {
      for (const name of ['plain', 'themed']) {
        const sheets = chooserStyles(built[name].chooser);
        // Count, not presence: a second copy after the theme would re-take every tie it wins.
        assert.equal(sheets.length, 1, `${name}: ${sheets.length} <style> blocks carry the chooser's rules`);
        assert.match(sheets[0][1], /@layer reef\.responsive \{/);
      }
      const at = chooserStyles(built.themed.chooser)[0].index;
      const theme = built.themed.chooser.indexOf(SLOT);
      assert.ok(at < theme, `the chooser's sheet (${at}) comes after the theme (${theme}): the theme loses every tie`);
    });

    await test('🔴 the chooser\'s sheet is the file as written: two layer blocks, in order, nothing around them', () => {
      // The checks above and the pure half stay green if the layout wraps the WHOLE sheet in one
      // layer (everything above the theme: the owner can no longer restyle it); only a browser sees
      // that. So the emitted text itself is read: top level is `reef.theme` then `reef.responsive`.
      for (const name of ['plain', 'themed']) {
        const text = chooserStyles(built[name].chooser)[0][1];
        const { top, stray, depth } = topLevel(text);
        assert.equal(depth, 0, `${name}: unbalanced braces in the chooser's sheet`);
        assert.deepEqual(top, ['@layer reef.theme', '@layer reef.responsive'], `${name}: top level of the chooser's sheet`);
        assert.equal(stray, '', `${name}: text outside every layer block`);
        assert.equal(text.replace(/\s+/g, ' ').trim(), css.replace(/\s+/g, ' ').trim(), `${name}: the emitted sheet differs from the source file`);
      }
    });

    await test('🔴 built with a theme that names the list: the list\'s box is below the theme, the rest above it', () => {
      const html = built.grid.chooser;
      assert.ok(html.includes(`grid-template-columns: ${GRID}`), 'the grid theme did not reach the chooser');
      const sheets = chooserStyles(html);
      assert.equal(sheets.length, 1, `${sheets.length} <style> blocks carry the chooser's rules`);
      const text = sheets[0][1];
      assert.ok(sheets[0].index < html.indexOf(`grid-template-columns: ${GRID}`), 'the chooser\'s sheet comes after the theme');
      // The layout handed the function THIS site's theme: the emitted text is what the function
      // returns for it, and it is not what a theme naming nothing gets.
      assert.equal(text, chooserCss(cssRaw, THEME_GRID));
      assert.notEqual(text, css);
      const { lifted } = assertSplit(text, ['.rf-lang-list'], 'built grid site');
      assert.deepEqual([...lifted.keys()].sort(), [...PART_SELECTORS['.rf-lang-page'], ...PART_SELECTORS['.rf-lang-head']].sort());
      // …and the two fixtures that name nothing are untouched by any of it (also read above).
      for (const name of ['plain', 'themed']) assert.equal(chooserStyles(built[name].chooser)[0][1], css, name);
    });

    await test('🔴 built with a theme that names the page: the page\'s box is still above the theme, the heading\'s and the list\'s below', () => {
      for (const [name, theme] of [['named', THEME_NAMED], ['reach', THEME_REACH], ['nested', THEME_NESTED]]) {
        const sheets = chooserStyles(built[name].chooser);
        assert.equal(sheets.length, 1, `${name}: ${sheets.length} <style> blocks carry the chooser's rules`);
        assert.equal(sheets[0][1], chooserCss(cssRaw, theme), `${name}: the emitted sheet is not the function's output for this theme`);
        const { lifted } = assertSplit(sheets[0][1], ['.rf-lang-head', '.rf-lang-list'], `built ${name} site`);
        assert.deepEqual([...lifted.keys()], [PAGE], `${name}: what is left above the theme`);
      }
      // Neither reaching theme writes an inner class: the page is all they name.
      assert.deepEqual(namedChooserParts(THEME_REACH), [PAGE]);
      assert.deepEqual(namedChooserParts(THEME_NESTED), [PAGE]);
    });

    await test('no other page carries it', () => {
      for (const name of Object.keys(SITES)) assert.equal(chooserStyles(built[name].home).length, 0, `${name}: the home page carries the chooser's sheet`);
    });

    // ── measured ─────────────────────────────────────────────────────────────────────────────
    if (!process.env.PLAYWRIGHT) {
      console.log('  · lang-page-isolation MEASURED SKIPPED — set PLAYWRIGHT to a playwright index.js or index.mjs');
      console.log('    (the checks above read structure; only this half sees a heading wrap or a colour resolve)');
    } else {
      // `index.js` is CommonJS, so `chromium` sits on `default`; `index.mjs` exports it by name.
      const pw = await import(process.env.PLAYWRIGHT);
      const chromium = pw.chromium || pw.default?.chromium;
      if (!chromium) throw new Error(`no chromium export from ${process.env.PLAYWRIGHT}`);
      const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
      const browser = await chromium.launch();
      try {
        // One page per (site, viewport); `rule` is swapped into the theme's slot on every request.
        const open = async (site, width) => {
          const ctx = await browser.newContext({ viewport: { width, height: 900 } });
          const pg = await ctx.newPage();
          const state = { rule: '' };
          await pg.route('**/*', (r) => {
            const u = new URL(r.request().url());
            if (u.hostname !== 'fixture.test') return r.abort();
            let p = join(built[site].outDir, decodeURIComponent(u.pathname));
            if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
            if (!existsSync(p)) return r.fulfill({ status: 404, body: '' });
            let body = readFileSync(p);
            if (extname(p) === '.html' && state.rule) {
              const html = body.toString('utf8');
              // Injection that cannot land must not look like a rule that did nothing.
              if (!html.includes(SLOT)) throw new Error(`${site}: no slot in ${u.pathname} to put the rule in`);
              body = Buffer.from(html.replace(SLOT, state.rule));
            }
            return r.fulfill({ status: 200, contentType: TYPES[extname(p)] || 'application/octet-stream', body });
          });
          const read = async (rule = '') => {
            state.rule = rule;
            await pg.goto('http://fixture.test/language/', { waitUntil: 'load' });
            return pg.evaluate(() => {
              const q = (s) => document.querySelector(s);
              const cs = (e) => getComputedStyle(e);
              const w = (e) => Math.round(e.getBoundingClientRect().width);
              const h1 = q('.rf-lang-page h1'); const list = q('.rf-lang-list');
              const range = document.createRange(); range.selectNodeContents(h1);
              const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
              const rows = [...document.querySelectorAll('.rf-lang-list a')].map((a) => {
                const r = a.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                return { w: Math.round(r.width), h: Math.round(r.height), hit: !!hit && (hit === a || a.contains(hit)) };
              });
              const probe = document.createElement('i');
              probe.style.cssText = 'background:var(--gd-surface);color:var(--gd-text)'; document.body.append(probe);
              const out = {
                h1: { lines, w: w(h1), text: h1.textContent.trim(), fits: h1.scrollWidth <= h1.clientWidth, color: cs(h1).color },
                page: { x: Math.round(q('.rf-lang-page').getBoundingClientRect().left), w: w(q('.rf-lang-page')) },
                rows, bandLeft: Math.round(list.getBoundingClientRect().left), bandW: w(list),
                band: cs(list).backgroundColor, ink: cs(q('.rf-lang-list a')).color,
                padTop: cs(q('.rf-lang-page')).paddingTop, nameSize: cs(q('.rf-lang-name')).fontSize, radius: cs(q('.rf-lang-list a')).borderTopLeftRadius,
                surface: cs(probe).backgroundColor, text: cs(probe).color, vw: document.documentElement.clientWidth,
              };
              probe.remove();
              return out;
            });
          };
          return { read, evaluate: (fn) => pg.evaluate(fn), close: () => ctx.close() };
        };

        // Site-wide rules an owner writes for their OWN pages. `min` is the least width the heading
        // must keep at viewport W: for a gutter rule, what that rule leaves a full-width section
        // (the page gets what the site's sections get); for everything else, the untouched column.
        const column = (W) => Math.min(512, W - 48);
        const RULES = [
          ['a gutter made of padding on main\'s children', 'html .rf-main > * { padding-inline: max(1.5rem, calc(50vw - 30rem)); }', (W) => Math.min(960, W - 48)],
          ['side padding in vw on top-level sections', '.rf-main > section { padding-inline: 22vw; }', (W) => Math.floor(W * 0.56) - 1],
          ['padding and a max-width on every section', 'html main section { max-width: 44rem; padding-inline: 6rem; margin-inline: auto; }', (W) => Math.min(512, W - 192)],
          ['a max-width on everything inside main', 'html main * { max-width: 18rem; }', column],
          ['side padding on every div inside main', 'html main div { padding-inline: 9rem; }', column],
          ['a width on main\'s grandchildren', 'html .rf-main > * > * { width: 12rem; }', column],
          ['every section is a flex row', 'html section { display: flex; gap: 2rem; }', column],
          ['a measure cap on headings and paragraphs', 'html h1 { max-width: 6ch; } html main p { max-width: 20ch; }', column],
        ];
        const WIDTHS_PX = [375, 1280, 1440];
        const pages = {};
        for (const W of WIDTHS_PX) pages[W] = await open('themed', W);
        const base = {};
        for (const W of WIDTHS_PX) base[W] = await pages[W].read();

        await test('the untouched chooser: one-line heading, a 32rem column, 62px rows, a full-width band', () => {
          for (const W of WIDTHS_PX) {
            const m = base[W];
            assert.equal(m.h1.text, 'Language');
            assert.deepEqual([m.h1.lines, m.h1.w, m.h1.fits], [1, column(W), true], `at ${W}px`);
            assert.ok(m.rows.length === 2 && m.rows.every((r) => r.w === column(W) && r.h === 62 && r.hit), `rows at ${W}px: ${JSON.stringify(m.rows)}`);
            assert.deepEqual([m.bandLeft, m.bandW], [0, m.vw], `band at ${W}px`);
          }
        });

        for (const [name, rule, min] of RULES) {
          await test(`🔴 site-wide rule — ${name}: the heading stays on one line and the rows stay whole`, async () => {
            for (const W of WIDTHS_PX) {
              const m = await pages[W].read(rule);
              const at = `at ${W}px under \`${rule}\``;
              assert.equal(m.h1.lines, 1, `the heading wraps to ${m.h1.lines} lines ${at}`);
              assert.ok(m.h1.fits, `the heading overflows its ${m.h1.w}px box ${at}`);
              assert.ok(m.h1.w >= min(W), `the heading is ${m.h1.w}px wide, expected at least ${min(W)} ${at}`);
              assert.deepEqual(m.rows, base[W].rows, `the rows changed ${at}`);
              assert.deepEqual([m.bandLeft, m.bandW], [0, m.vw], `the band no longer spans the viewport ${at}`);
            }
          });
        }

        await test('🔴 a rule that NAMES the page still restyles it — at the platform\'s own specificity', async () => {
          // `.rf-lang-list` and `.rf-lang-name` are the platform's selectors exactly. A tie, which
          // the theme wins only by coming later in the document.
          const m = await pages[1280].read('.rf-lang-list { background: rgb(1, 2, 3); } .rf-lang-name { font-size: 30px; } .rf-lang-page { padding-top: 16px; } .rf-lang-list a { border-radius: 0; }');
          assert.deepEqual([m.band, m.nameSize, m.padTop, m.radius], ['rgb(1, 2, 3)', '30px', '16px', '0px']);
        });

        await test('the box has two doors: the tokens, and an !important rule that names the page', async () => {
          const t = await pages[1280].read('.rf-lang-page { --rf-lang-width: 20rem; --rf-lang-band: rgb(10, 20, 30); --rf-lang-band-ink: rgb(250, 240, 230); }');
          assert.deepEqual([t.h1.w, t.rows.map((r) => r.w), t.band, t.ink], [320, [320, 320], 'rgb(10, 20, 30)', 'rgb(250, 240, 230)']);
          // 🔴 The slot is swapped in AFTER the build, so the build never saw these rules name the
          // list and its box is still above the theme. That is the case `!important` is for.
          const i = await pages[1280].read('.rf-lang-list > li { max-width: 15rem !important; }');
          assert.deepEqual(i.rows.map((r) => r.w), [240, 240]);
          // …and the same property WITHOUT it does nothing on a part the theme did not name at
          // build time, which is the protection, not a bug.
          const n = await pages[1280].read('.rf-lang-list > li { max-width: 15rem; }');
          assert.deepEqual(n.rows.map((r) => r.w), [512, 512]);
        });

        await test('🔴 the band is the theme\'s surface under the theme\'s text', () => {
          const m = base[1280];
          assert.deepEqual([m.surface, m.text], ['rgb(241, 233, 218)', 'rgb(42, 33, 24)'], 'the fixture theme did not apply');
          assert.deepEqual([m.band, m.ink], [m.surface, m.text]);
        });

        await test('a theme that defines --gd-bg-dark keeps the band it had', async () => {
          const m = await pages[1280].read('html:root { --gd-bg-dark: rgb(20, 30, 40); }');
          assert.equal(m.band, 'rgb(20, 30, 40)');
        });
        for (const W of WIDTHS_PX) await pages[W].close();

        await test('🔴 a theme that lays the list out as a grid gets its grid; the heading it did not name is still protected', async () => {
          const pg = await open('grid', 1280);
          const m = await pg.read();
          const g = await pg.evaluate(() => {
            const list = document.querySelector('.rf-lang-list');
            const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; };
            return { display: getComputedStyle(list).display, list: box(list), items: [...list.children].map(box), headMax: getComputedStyle(document.querySelector('.rf-lang-head')).maxWidth };
          });
          await pg.close();
          // The owner's list: a grid inside the column (512 wide), 20px padding and two 14px gaps
          // leave 444px, split 5:4:3 — three tiles on one row, each narrower than the one before.
          assert.equal(g.display, 'grid', 'the theme\'s `display: grid` lost to the platform\'s box');
          assert.deepEqual([g.list.x, g.list.w], [384, 512], 'the list is not the box the theme gave it');
          assert.equal(g.items.length, 3);
          assert.deepEqual(g.items.map((i) => i.w), [185, 148, 111], `tiles: ${JSON.stringify(g.items)}`);
          assert.deepEqual(g.items.map((i) => i.x), [404, 603, 765]);
          assert.equal(new Set(g.items.map((i) => i.y)).size, 1, `the tiles are not on one row: ${JSON.stringify(g.items)}`);
          assert.ok(m.rows.every((r) => r.hit), 'a tile is not clickable at its centre');
          // The same theme says `html .rf-main > * > * { max-width: 18rem }`. It names nothing, and
          // the heading block is a part this theme did not name: still 512px, on one line.
          assert.equal(g.headMax, 'none', 'the blanket max-width reached the heading block');
          assert.deepEqual([m.h1.lines, m.h1.w, m.h1.fits], [1, 512, true]);
        });

        // 🩸 The page's box used to go below the theme with the other parts when a theme named it.
        // The column is the page's own padding, so a width cap on the page turns that padding
        // inward: under the first rule the heading measured 448 / 192 / 32 / 0px at these four
        // viewports. `expect` is the heading's width; the page itself must span the viewport in
        // every row, which is the cause rather than the symptom.
        const CAPS = [
          ['.rf-main > section { max-width: 60rem; margin-inline: auto; }', 512],
          ['.rf-main > * { max-width: 72rem; margin-inline: auto; }', 512],
          ['.rf-main > section { width: min(60rem, 100% - 3rem); margin-inline: auto; }', 512],
          // This one reaches INSIDE the page. The theme named the heading block, so its box is the
          // owner's and a rule that out-scores the default applies to it: 18rem, as on a page with
          // no protection at all. That is the stated cost of naming a part. What must not happen is
          // the same rule squeezing the page (it measured 0px at 1440 when it could).
          ['html .rf-main * { max-width: 18rem; }', 288],
        ];
        const CAP_WIDTHS = [1024, 1280, 1440, 1920];
        await test('🔴 a theme that names every part for its look: a site-wide width cap does not reach the page\'s own box', async () => {
          for (const W of CAP_WIDTHS) {
            const pg = await open('named', W);
            const m0 = await pg.read();
            assert.deepEqual([m0.page.x, m0.page.w, m0.h1.lines, m0.h1.w], [0, m0.vw, 1, 512], `untouched at ${W}px`);
            for (const [rule, expect] of CAPS) {
              const m = await pg.read(rule);
              const at = `at ${W}px under \`${rule}\``;
              assert.deepEqual([m.page.x, m.page.w], [0, m.vw], `the page is no longer the full-width block its padding needs ${at}`);
              assert.equal(m.h1.w, expect, `the heading is ${m.h1.w}px wide ${at}`);
              assert.deepEqual([m.h1.lines, m.h1.fits], [1, true], `the heading wraps or overflows ${at}`);
              if (expect === 512) assert.deepEqual(m.rows, m0.rows, `the rows changed ${at}`);
            }
            await pg.close();
          }
        });

        for (const site of ['reach', 'nested']) {
          await test(`🔴 a theme that lays the chooser out from \`.rf-lang-page\` inwards (${site === 'reach' ? 'flat rules' : 'nested rules'}) gets its grid and its heading`, async () => {
            const pg = await open(site, 1280);
            const m = await pg.read();
            const g = await pg.evaluate(() => {
              const list = document.querySelector('.rf-lang-list');
              const box = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; };
              const h1 = document.querySelector('.rf-lang-head h1');
              return { display: getComputedStyle(list).display, list: box(list), items: [...list.children].map(box), h1Max: parseFloat(getComputedStyle(h1).maxWidth), liMax: getComputedStyle(list.children[0]).maxWidth };
            });
            await pg.close();
            // The list: the owner's two-column grid across the band (1280 less 24px each side and
            // one 12px gap), not the platform's stacked flex column.
            assert.equal(g.display, 'grid', 'the theme\'s `display: grid` lost to the platform\'s box');
            assert.equal(g.items.length, 2);
            assert.equal(new Set(g.items.map((i) => i.y)).size, 1, `the two rows are stacked: ${JSON.stringify(g.items)}`);
            assert.deepEqual(g.items.map((i) => [i.x, i.w]), [[24, 610], [646, 610]], `tiles: ${JSON.stringify(g.items)}`);
            assert.equal(g.liMax, 'none', 'the theme\'s `li { max-width: none }` lost to the platform\'s row width');
            assert.ok(m.rows.every((r) => r.hit), 'a tile is not clickable at its centre');
            // The heading: capped at the theme's 10ch (font-dependent, so read back, not repeated).
            assert.ok(g.h1Max > 100 && g.h1Max < 400, `the theme's \`h1 { max-width: 10ch }\` did not apply: max-width ${g.h1Max}`);
            assert.equal(m.h1.w, Math.round(g.h1Max), 'the heading is not as wide as the theme made it');
            // …and the page around them is still the platform's full-width block.
            assert.deepEqual([m.page.x, m.page.w], [0, m.vw]);
          });
        }

        await test('🔴 with no theme at all the band is the renderer\'s neutral surface, not a brand colour', async () => {
          const pg = await open('plain', 1280);
          const m = await pg.read();
          await pg.close();
          assert.deepEqual([m.band, m.ink], [m.surface, m.text]);
          // The renderer's own defaults, read from the page rather than repeated here; what this
          // pins is that they are grey-on-white, i.e. that the three channels are near each other.
          const [r, g, b] = m.band.match(/\d+/g).map(Number);
          assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 8, `the default band is not neutral: ${m.band}`);
          assert.ok(Math.min(r, g, b) >= 200, `the default band is dark under dark text: ${m.band} / ${m.ink}`);
        });
      } finally { await browser.close(); }
    }
  } finally {
    if (process.env.KEEP_LANG_PAGE_OUT) console.log(`  · kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\n  ${passed} passed`);
