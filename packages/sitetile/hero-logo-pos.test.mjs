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
//      and is handed, as one message naming the values expected, to the sink the CALLER passed
//      (`report`). site-core keeps no record of it and prints nothing: it also runs in long-lived
//      processes, one tenant after another. The Astro build's sink (astro/src/lib/build-log.mjs)
//      prints it to the build log once per build, as blog.mjs does an unrecognised blog-date-format;
//   3. a value that was already one of the three renders the same bytes as before.
//
// The NAME side is deliberately untouched and pinned at the end: an assignment is the name, `=`,
// the value, with nothing between them, and names are case-sensitive — in every reader of a param.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSite, parseParams, renderSiteToHtml, heroVariant, heroHeadingless, pageH1Index,
  takeDropWarnings, inlineHtml, bodyHtml, safeSrc } from './site-core.js';
import { emitHero } from '../emit/hero.mjs';
import { RENDERER_SUBPATH } from '../build/index.mjs';
import { warnOncePerBuild } from './astro/src/lib/build-log.mjs';

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
const posOf = (html) => (/\bdata-logo-pos="([^"]*)"/.exec(html) || [])[1];
// The warning channel is the caller's sink. `warned` is the one most cases below pass; `render`
// passes it unless told otherwise.
const warned = [];
const sink = (m) => { warned.push(m); };
const takeWarned = () => warned.splice(0);
const render = (params, title, opts = { report: sink }) => renderSiteToHtml(parseSite(page(params, title)), opts);
// …and the console, watched: site-core must never write to it. Anything that mentions logo-pos is
// kept (and fails the case that looks); the rest passes through.
const consoleSaid = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
  const real = console[k];
  console[k] = (...a) => { const m = a.map(String).join(' '); if (/logo-pos/.test(m) && !/^\s+(ok|FAIL) /.test(m)) consoleSaid.push(m); else real(...a); };
}
const WARNING = (shown) => `[sitetile] Unrecognised logo-pos ${JSON.stringify(shown)} — expected one of: top, center, bottom. Falling back to bottom.`;

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
  ['"top center"', 'top center'], ['" Upper "', 'Upper'], ['top,', 'top,'], ['\uFF34\uFF2F\uFF30', '\uFF34\uFF2F\uFF30'],
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

await test('🔴 an unrecognised value is handed to the sink, as written (trimmed), once per render', () => {
  for (const [typed, shown] of [['nowhere', 'nowhere'], ['" Sideways "', 'Sideways'], ['\uFF22\uFF2F\uFF34\uFF34\uFF2F\uFF2D', '\uFF22\uFF2F\uFF34\uFF34\uFF2F\uFF2D'], ['"top  center"', 'top  center']]) {
    takeWarned();
    render(`${LAYERS} logo-pos=${typed}`);
    assert.deepEqual(takeWarned(), [WARNING(shown)], `logo-pos=${typed}`);
    // site-core remembers nothing: the next render says it again, and deduplicating is the sink's.
    render(`${LAYERS} logo-pos=${typed}`);
    assert.deepEqual(takeWarned(), [WARNING(shown)], `logo-pos=${typed}: the second render was silenced by the first`);
  }
  // An UNTITLED hero is the path that asks heroVariant most often (the h1 owner, the heading test,
  // the render): still one message per render.
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
  assert.deepEqual(consoleSaid.splice(0), [], 'site-core wrote to the console');
});

await test('🔴 two tenants in one long-lived process share nothing, and with no sink nothing is said anywhere', () => {
  // reef-mcp's checks call renderSiteToHtml for one site after another in one process.
  consoleSaid.splice(0);
  const a = [], b = [];
  const tenantA = parseSite(page(`${LAYERS} logo-pos=sideways`));
  const tenantB = parseSite(page(`${LAYERS} logo-pos=sideways`, 'Another site'));
  renderSiteToHtml(tenantA, { report: (m) => a.push(m) });
  renderSiteToHtml(tenantB, { report: (m) => b.push(m) });
  assert.deepEqual(a, [WARNING('sideways')], 'tenant A');
  assert.deepEqual(b, [WARNING('sideways')], 'tenant B was silenced because tenant A used the same value');
  // A caller that passes no sink (every long-lived one today): no console line, no record kept that
  // a later sink would see.
  for (let i = 0; i < 50; i++) renderSiteToHtml(parseSite(page(`${LAYERS} logo-pos=tenant-${i}`)));
  renderSiteToHtml(tenantA);
  renderSiteToHtml(tenantA, { report: true });   // not a function: not a sink
  assert.deepEqual(consoleSaid.splice(0), [], 'a render with no sink wrote to the console');
  const later = [];
  renderSiteToHtml(tenantA, { report: (m) => later.push(m) });
  assert.deepEqual(later, [WARNING('sideways')]);
  assert.deepEqual(a, [WARNING('sideways')], 'tenant A\'s sink heard about another render');
});

await test('🔴 a control character in the value reaches the message escaped, never raw', () => {
  for (const [typed, escaped] of [
    ['\x1b[31mred', '"\\u001b[31mred"'], ['a\x07b', '"a\\u0007b"'], ['x\x7fy', '"x\\u007fy"'],
    ['\u009b31mred', '"\\u009b31mred"'], ['q"uote\\d', '"q\\"uote\\\\d"'],
  ]) {
    takeWarned();
    render(`${LAYERS} logo-pos=${typed}`);
    const said = takeWarned();
    assert.equal(said.length, 1, JSON.stringify(typed));
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(said[0]), `${JSON.stringify(typed)}: a raw control character in ${JSON.stringify(said[0])}`);
    assert.ok(said[0].includes(` logo-pos ${escaped} — `), `${JSON.stringify(typed)}: ${said[0]}`);
  }
});

await test('the build log\'s sink says each message once per build (build-log.mjs)', () => {
  consoleSaid.splice(0);
  for (let i = 0; i < 3; i++) render(`${LAYERS} logo-pos=hereabouts`, 'T', { report: warnOncePerBuild });
  render(`${LAYERS} logo-pos=thereabouts`, 'T', { report: warnOncePerBuild });
  assert.deepEqual(consoleSaid.splice(0), [WARNING('hereabouts'), WARNING('thereabouts')]);
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
  renderSiteToHtml(site, { report: sink });
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
  assert.match(src, /heroVariant\(\s*\{[^}]*['"]logo-pos['"]\s*:\s*pm\s*\[\s*['"]logo-pos['"]\s*\][^}]*\}\s*,\s*\{\s*report:\s*warnOncePerBuild\s*\}\s*\)/,
    'Hero.astro does not hand logo-pos to heroVariant with the build log as the sink');
  assert.match(src, /import\s*\{\s*warnOncePerBuild\s*\}\s*from\s*['"]\.\.\/\.\.\/lib\/build-log\.mjs['"]/, 'Hero.astro does not take its sink from build-log.mjs');
  // …and the position emitHero is given is heroVariant's answer.
  assert.match(src, /\blogoPos\s*=\s*variant\.logoPos\b/, 'Hero.astro derives logoPos somewhere other than heroVariant');
  assert.equal((src.match(/pm\s*\[\s*['"]logo-pos['"]\s*\]/g) || []).length, 1, 'logo-pos is read more than once in Hero.astro');
});

// Hero.astro's frontmatter for the layered hero, as far as emitHero's layered branch reads it.
function emitAsHeroAstro(params, title = 'Title') {
  const section = { id: 'h', type: 'hero', title, params, body: 'Body.' };
  const pm = parseParams(section.params);
  const variant = heroVariant({ layers: pm.layers, layout: pm.layout, logo: pm.logo, 'logo-pos': pm['logo-pos'] }, { report: sink });
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
    // The same bad value twice, and one carrying a terminal escape: the build log is the reader.
    ['Unknown again', 'logo-pos=middle', 'bottom'], ['Escape', 'logo-pos=\x1b[31mred', 'bottom'],
  ];
  const tmp = process.env.TMPDIR || tmpdir();
  mkdirSync(tmp, { recursive: true });
  const ir = mkdtempSync(join(tmp, 'tile-hero-logo-pos-ir-'));
  const out = mkdtempSync(join(tmp, 'tile-hero-logo-pos-out-'));
  try {
    writeFileSync(join(ir, 'home.md'),
      '---\nsitetile-page: home\ntitle: Layered heroes\nlang: en-US\n---\n\n'
      + HEROES.map(([title, params]) => `## ${title}\n%% sitetile: hero ${LAYERS}${params ? ' ' + params : ''} %%\n\nBody of ${title}.\n`).join('\n'));
    // `astro build` inherits buildSite's stdio, so the build runs in a child whose output is read
    // here: the build log is where the warning is meant to arrive.
    const runner = `const { buildSite } = await import(${JSON.stringify(pathToFileURL(join(ENGINE, 'packages', 'build', 'index.mjs')).href)});
      const r = await buildSite(${JSON.stringify({ irDir: ir, engineDir: ENGINE, outDir: out, siteUrl: 'https://example.com' })});
      process.stdout.write('\\n@@result ' + JSON.stringify({ code: r.code }) + '\\n');`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', runner], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const buildLog = `${child.stdout || ''}\n${child.stderr || ''}`;
    const result = JSON.parse((/@@result (\{.*\})/.exec(child.stdout || '') || [])[1] || '{"code":1}');
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
    await test('🔴 build log: each unrecognised value is warned about once per build, its control characters escaped', () => {
      const lines = buildLog.split('\n').filter((l) => /Unrecognised logo-pos/.test(l));
      assert.equal(lines.filter((l) => l.includes(WARNING('middle'))).length, 1, `"middle" (two heroes): ${JSON.stringify(lines)}`);
      assert.equal(lines.filter((l) => l.includes(WARNING('\x1b[31mred'))).length, 1, `the escape value: ${JSON.stringify(lines)}`);
      assert.equal(lines.length, 2, `only the two values the page could not place: ${JSON.stringify(lines)}`);
      for (const l of lines) assert.ok(!l.includes('\x1b'), `a raw ESC reached the build log: ${JSON.stringify(l)}`);
    });
  } finally {
    rmSync(ir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`  ${passed} passed`);
