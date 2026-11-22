// The layered hero's `logo-pos=` VALUE: read with its case and surrounding whitespace folded, and an
// unrecognised value neither reaches the page nor disappears without a record.
//   run: node packages/sitetile/hero-logo-pos.test.mjs   (wired into scripts/test.sh via the glob)
//
// 🩸 `logo-pos=top|center|bottom` places the title block of a `layers=` hero. Both renderers wrote
// the value onto the section exactly as typed:
//
//     logo-pos=TOP        → data-logo-pos="TOP"
//     logo-pos=" top "    → data-logo-pos=" top "
//     logo-pos=middle     → data-logo-pos="middle"
//
// The stylesheet selects on `[data-logo-pos="top"]` and `[data-logo-pos="center"]`, attribute values
// compare case-sensitively, and a hero no rule selects is the default hero — a perfectly good one.
// So each of those lines drew `bottom` while the page said something else, and nothing anywhere
// said the param had not been understood. (param-names.test.mjs is the NAME half of the same param:
// that `logo-pos=top` is the key `logo-pos`. This file is the value half.)
//
// What holds now, in one place — heroVariant, the selection both renderers already share:
//   1. the value is trimmed and lower-cased, then matched against the three positions;
//   2. anything else draws the default (`bottom`), the way `media=` and `shape=` fall back to theirs,
//      and is warned about the way an unrecognised `blog-date-format` already is: one console.warn
//      per distinct value, naming the values expected (blog.mjs warnUnknownDateFormat);
//   3. a value that was already one of the three renders the same bytes as before.
//
// The NAME side is deliberately untouched and pinned at the end: an assignment is the name, `=`,
// the value, with nothing between them, and names are case-sensitive — in every reader of a param.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSite, parseParams, renderSiteToHtml, heroVariant, heroHeadingless, pageH1Index,
  takeDropWarnings, inlineHtml, bodyHtml, safeSrc } from './site-core.js';
import { emitHero } from '../emit/hero.mjs';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '..', '..');

console.log('hero-logo-pos');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

const LAYERS = 'layers=/back.webp|/front.webp';
const page = (params, title = 'Title') => '---\nsitetile-page: home\ntitle: Heroes\n---\n\n'
  + `## ${title}\n%% sitetile: hero ${params} %%\n\nBody.\n\n## Next\n\nMore.\n`;
const render = (params, title) => renderSiteToHtml(parseSite(page(params, title)));
const posOf = (html) => (/\bdata-logo-pos="([^"]*)"/.exec(html) || [])[1];
// The warning channel: console.warn, captured here. Only logo-pos lines are kept; anything else
// passes through. Once per distinct value per process, so each warning case below uses a value no
// other case in this file renders.
const warned = [];
const realWarn = console.warn;
console.warn = (...a) => { const m = String(a[0]); if (/logo-pos/.test(m)) warned.push(m); else realWarn(...a); };
const takeWarned = () => warned.splice(0);
const WARNING = (shown) => `[sitetile] Unrecognised logo-pos "${shown}" — expected one of: top, center, bottom. Falling back to bottom.`;

// What the author typed after `logo-pos=`, and the position the hero must draw.
const FOLDED = [
  ['TOP', 'top'], ['Top', 'top'], ['tOp', 'top'],
  ['CENTER', 'center'], ['Center', 'center'],
  ['BOTTOM', 'bottom'], ['Bottom', 'bottom'],
  ['" top "', 'top'], ['"top "', 'top'], ['" top"', 'top'], ['"\tcenter\t"', 'center'],
  ['"  BOTTOM  "', 'bottom'], ['" Center "', 'center'],
  ['" top　"', 'top'],                       // a no-break space, an ideographic space
  ['"Top"→/anywhere', 'top'],                         // the link form: its label is the value
];
// CONTROLS: the three values, written the way they already worked.
const AS_BEFORE = [['top', 'top'], ['center', 'center'], ['bottom', 'bottom'], ['"top"', 'top'], ['"center"', 'center']];
// Not a position. Each draws the default and is warned about as written (trimmed).
const UNRECOGNISED = [
  ['middle', 'middle'], ['left', 'left'], ['centre', 'centre'], ['top-left', 'top-left'], ['1', '1'],
  ['"top center"', 'top center'], ['" Upper "', 'Upper'], ['top,', 'top,'], ['ＴＯＰ', 'ＴＯＰ'],
];

await test('🔴 heroVariant folds case and surrounding whitespace into one of the three positions', () => {
  for (const [typed, want] of [...FOLDED, ...AS_BEFORE]) {
    const pm = parseParams(`${LAYERS} logo-pos=${typed}`);
    assert.equal(heroVariant(pm).logoPos, want, `logo-pos=${typed}`);
  }
  // …and takes the value however it is handed over (Hero.astro passes the params by name).
  assert.equal(heroVariant({ 'logo-pos': '  CENTER ' }).logoPos, 'center');
  assert.equal(heroVariant({ 'logo-pos': { label: ' Top ', href: '/x' } }).logoPos, 'top');
});

await test('heroVariant: absent or empty is the default, and so is anything that is not a position', () => {
  for (const pm of [{}, { 'logo-pos': '' }, { 'logo-pos': '   ' }, { 'logo-pos': undefined }, { 'logo-pos': null }]) {
    assert.equal(heroVariant(pm).logoPos, 'bottom', JSON.stringify(pm));
  }
  for (const [typed] of UNRECOGNISED) {
    assert.equal(heroVariant(parseParams(`${LAYERS} logo-pos=${typed}`)).logoPos, 'bottom', `logo-pos=${typed}`);
  }
  // 🔴 CONTROL: the rows above are not passing because every value is the default.
  assert.equal(heroVariant({ 'logo-pos': 'top' }).logoPos, 'top');
});

await test('🔴 string render: a folded value is the same section, byte for byte, as the value written plainly', () => {
  for (const [typed, want] of FOLDED) {
    const html = render(`${LAYERS} logo-pos=${typed}`);
    assert.equal(posOf(html), want, `logo-pos=${typed}: data-logo-pos`);
    assert.equal(html, render(`${LAYERS} logo-pos=${want}`), `logo-pos=${typed} is not the page logo-pos=${want} makes`);
  }
});

await test('🔴 string render: an unrecognised value draws the default hero and never reaches the page', () => {
  const unset = render(LAYERS);
  assert.equal(posOf(unset), 'bottom');
  for (const [typed] of UNRECOGNISED) {
    assert.equal(render(`${LAYERS} logo-pos=${typed}`), unset, `logo-pos=${typed} is not the page a hero with no logo-pos= makes`);
  }
});

await test('🔴 an unrecognised value is warned about, as written (trimmed), once per value', () => {
  for (const [typed, shown] of [['nowhere', 'nowhere'], ['" Sideways "', 'Sideways'], ['ＢＯＴＴＯＭ', 'ＢＯＴＴＯＭ'], ['"top  center"', 'top  center']]) {
    takeWarned();
    render(`${LAYERS} logo-pos=${typed}`);
    assert.deepEqual(takeWarned(), [WARNING(shown)], `logo-pos=${typed}`);
    render(`${LAYERS} logo-pos=${typed}`);
    assert.deepEqual(takeWarned(), [], `logo-pos=${typed}: warned a second time`);
  }
  // An UNTITLED hero is the path that asks heroVariant most often (the h1 owner, the heading test,
  // the render): still one warning.
  takeWarned();
  render(`${LAYERS} logo-pos=underneath`, '');
  assert.equal(takeWarned().length, 1, 'an untitled layered hero');
  // A long value is cut the way an unreadable tagcloud item is.
  render(`${LAYERS} logo-pos=${'x'.repeat(5000)}`);
  assert.deepEqual(takeWarned(), [WARNING(`${'x'.repeat(200)}…`)]);
  // One channel: the drop queue (refused destinations) is not where this goes.
  takeDropWarnings();
  render(`${LAYERS} logo-pos=offstage`);
  assert.equal(takeWarned().length, 1);
  assert.deepEqual(takeDropWarnings(), []);
});

await test('nothing is warned about for a value the hero understood, or for no value at all', () => {
  takeWarned();
  for (const [typed] of [...FOLDED, ...AS_BEFORE, [''], ['""'], ['"  "']]) {
    render(typed === '' ? LAYERS : `${LAYERS} logo-pos=${typed}`);
    assert.deepEqual(takeWarned(), [], `logo-pos=${typed}`);
  }
});

await test('only a render warns: asking which variant a hero is, or which section owns the h1, says nothing', () => {
  takeWarned();
  const site = parseSite(page(`${LAYERS} logo-pos=elsewhere`, ''));
  heroVariant(parseParams(site.sections[0].params));
  heroHeadingless(site.sections[0]);
  pageH1Index(site.sections);
  assert.deepEqual(takeWarned(), []);
  // 🔴 CONTROL: the same value does warn once a render asks.
  renderSiteToHtml(site);
  assert.deepEqual(takeWarned(), [WARNING('elsewhere')]);
});

await test('a hero that draws no logo-pos has nothing to warn about, and still writes no data-logo-pos', () => {
  // `logo-pos=` is the layered hero's. The legacy and `layout=` heroes never drew it — whatever its
  // value — so there is no drawn position for a value to have been dropped from.
  for (const params of ['logo-pos=hither', 'logo-pos=TOP', 'layout=split logo-pos=thither', 'layout=split logo-pos=TOP', 'layers=" | " logo-pos=yon']) {
    takeWarned();
    const html = render(params);
    assert.ok(!/data-logo-pos/.test(html), `${params}: a hero with no layers grew a data-logo-pos`);
    assert.equal(html, render(params.replace(/\s*logo-pos=\S+/, '')), `${params}: the hero changed`);
    assert.deepEqual(takeWarned(), [], params);
  }
});

// ── the built page's path: Hero.astro → emitHero ─────────────────────────────────────────────────
const HERO_ASTRO = readFileSync(join(HERE, 'astro', 'src', 'components', 'sections', 'Hero.astro'), 'utf8');
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

await test('🔴 Hero.astro takes the position from heroVariant — it does not read the value its own way', () => {
  const src = decomment(HERO_ASTRO);
  // The param is still read in the component, by name (coral-params.test.mjs), and its VALUE goes to
  // heroVariant with the other three…
  assert.match(src, /heroVariant\(\s*\{[^}]*['"]logo-pos['"]\s*:\s*pm\s*\[\s*['"]logo-pos['"]\s*\][^}]*\}\s*,\s*\{\s*report:\s*true\s*\}\s*\)/,
    'Hero.astro does not hand logo-pos to heroVariant (reporting)');
  // …and the position emitHero is given is heroVariant's answer.
  assert.match(src, /\blogoPos\s*=\s*variant\.logoPos\b/, 'Hero.astro derives logoPos somewhere other than heroVariant');
  assert.equal((src.match(/pm\s*\[\s*['"]logo-pos['"]\s*\]/g) || []).length, 1, 'logo-pos is read more than once in Hero.astro');
});

// Hero.astro's frontmatter for the layered hero, as far as emitHero's layered branch reads it.
function emitAsHeroAstro(params, title = 'Title') {
  const section = { id: 'h', type: 'hero', title, params, body: 'Body.' };
  const pm = parseParams(section.params);
  const variant = heroVariant({ layers: pm.layers, layout: pm.layout, logo: pm.logo, 'logo-pos': pm['logo-pos'] }, { report: true });
  return emitHero(section, { media: pm.media === 'logo' ? 'logo' : 'avatar', layout: variant.layout, eyebrow: null, marqueeWords: [],
    enter: pm.enter != null, layerList: variant.layerList, parallax: pm.parallax != null, logo: variant.logo,
    logoPos: variant.logoPos, cta: pm.cta, bgOk: pm.bg ? safeSrc(pm.bg) : null, owner: true }, { inline: inlineHtml, block: bodyHtml });
}

await test('🔴 emitHero, fed as Hero.astro feeds it, writes the same position the string render does', () => {
  for (const [typed, want] of [...FOLDED, ...AS_BEFORE, ...UNRECOGNISED.map(([t]) => [t, 'bottom'])]) {
    const built = emitAsHeroAstro(`${LAYERS} logo-pos=${typed}`);
    assert.equal(posOf(built), want, `logo-pos=${typed}`);
    assert.equal(posOf(built), posOf(render(`${LAYERS} logo-pos=${typed}`)), `logo-pos=${typed}: the two renderers disagree`);
  }
  takeWarned();
  emitAsHeroAstro(`${LAYERS} logo-pos=yonder`, '');
  assert.deepEqual(takeWarned(), [WARNING('yonder')], 'the built page warns about an unrecognised value once');
});

// ── the NAME side, which this change leaves alone ────────────────────────────────────────────────
// One assignment form — name, `=`, value, nothing between — and case-sensitive names, in every
// reader of a param: parseParams is the only one sitetile has, and cardtile cells are read through
// it too — channelsIn included, since tile#325 (cardtile/yt.test.mjs holds `channel = x` to "not an
// assignment" from both of its sides).
// So `logo-pos = top` and `Logo-Pos=top` set no `logo-pos`, there is no value here to fold, and the
// hero is the default one — with `top` / `Logo-Pos` left in the params as names no hero reads.
await test('the name side is unchanged: a spaced `=` is not an assignment, and names are case-sensitive', () => {
  const rows = [
    ['k=v', { k: 'v' }],
    ['k = v', { v: true }],         // `k` has no value; `v` is a word on its own, so a bare flag
    ['k =v', {}],                   // …and here `v` is not on its own either
    ['k= v', { v: true }],
    ['K=v', { K: 'v' }],
    ['k=V', { k: 'V' }],            // a value arrives as written; folding it is each param's call
  ];
  for (const [raw, want] of rows) assert.deepEqual(parseParams(raw), want, raw);
  for (const params of ['logo-pos = top', 'logo-pos =top', 'logo-pos= top', 'Logo-Pos=top', 'LOGO-POS=top']) {
    takeWarned();
    assert.equal(parseParams(params)['logo-pos'], undefined, params);
    assert.equal(posOf(render(`${LAYERS} ${params}`)), 'bottom', params);
    assert.deepEqual(takeWarned(), [], `${params}: there is no logo-pos value to warn about`);
  }
});

// ── a real build ─────────────────────────────────────────────────────────────────────────────────
const ASTRO = join(ENGINE, RENDERER_SUBPATH);
if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · the built layered hero's logo-pos value SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (it is the only case here that builds a real page; a green run without it is narrower)');
} else {
  const HEROES = [
    ['Unset', '', 'bottom'], ['Plain top', 'logo-pos=top', 'top'],
    ['Upper', 'logo-pos=TOP', 'top'], ['Padded', 'logo-pos=" top "', 'top'], ['Mixed', 'logo-pos=Center', 'center'],
    ['Padded upper', 'logo-pos="  BOTTOM "', 'bottom'], ['Unknown', 'logo-pos=middle', 'bottom'],
  ];
  const tmp = process.env.TMPDIR || tmpdir();
  mkdirSync(tmp, { recursive: true });
  const ir = mkdtempSync(join(tmp, 'tile-hero-logo-pos-ir-'));
  const out = mkdtempSync(join(tmp, 'tile-hero-logo-pos-out-'));
  try {
    writeFileSync(join(ir, 'home.md'),
      '---\nsitetile-page: home\ntitle: Layered heroes\nlang: en-US\n---\n\n'
      + HEROES.map(([title, params]) => `## ${title}\n%% sitetile: hero ${LAYERS}${params ? ' ' + params : ''} %%\n\nBody of ${title}.\n`).join('\n'));
    const result = await buildSite({ irDir: ir, engineDir: ENGINE, outDir: out, siteUrl: 'https://example.com' });
    const html = result.code === 0 ? readFileSync(join(out, 'index.html'), 'utf8') : '';
    const sections = [...html.matchAll(/<section\b([^>]*\bst-hero-layered\b[^>]*)>([\s\S]*?)<\/section>/g)]
      .map((m) => ({ tag: m[1], title: (/<h([12])[^>]*>([\s\S]*?)<\/h\1>/.exec(m[2]) || [])[2], pos: (/\bdata-logo-pos="([^"]*)"/.exec(m[1]) || [])[1] }));
    const byTitle = new Map(sections.map((s) => [s.title, s]));
    const shape = (s) => s.tag.replace(/\sid="[^"]*"/, '').replace(/\sdata-astro-[\w-]+(="[^"]*")?/g, '');
    await test('the fixture built, and every layered hero is on the page', () => {
      assert.equal(result.code, 0, 'astro build exited non-zero');
      assert.equal(sections.length, HEROES.length, `${sections.length} layered heroes in the page, ${HEROES.length} written`);
    });
    await test('🔴 built page: each hero carries the folded position, and an unrecognised one the default', () => {
      for (const [title, params, want] of HEROES) assert.equal(byTitle.get(title)?.pos, want, `hero ${JSON.stringify(params)}: data-logo-pos`);
    });
    await test('built page: a folded value is the plainly written section, attribute for attribute', () => {
      assert.equal(shape(byTitle.get('Upper')), shape(byTitle.get('Plain top')));
      assert.equal(shape(byTitle.get('Padded')), shape(byTitle.get('Plain top')));
      assert.equal(shape(byTitle.get('Unknown')), shape(byTitle.get('Unset')));
      assert.notEqual(shape(byTitle.get('Plain top')), shape(byTitle.get('Unset')), 'CONTROL: top and the default are the same section');
    });
  } finally {
    rmSync(ir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`  ${passed} passed`);
