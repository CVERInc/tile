// Where a theme sits in the cascade, relative to the renderer.
//   run: node packages/sitetile/cascade-layers.test.mjs   (wired into scripts/test.sh)
//
// 🩸 WHY. `describe_render_css` has carried this warning, in red, for as long as it has existed:
//
//     🔴 Your CSS is loaded BEFORE the renderer's stylesheet, so a same-specificity override
//        always loses
//
// We knew, we marked it, and we wrote it down instead of fixing it. What that cost, measured
// (reef docs/field/mcp-2026-07): four different operators lost the same tie — and the FIRST of them
// shipped a header button whose label came out at roughly 1.2:1 contrast against its background,
// far under WCAG's 4.5:1. That site is a doctor's. For however long it stood, the primary action on
// it was unreadable to patients with low vision, because a stylesheet ordering nobody could see
// silently won an argument.
//
// A second measurement, taken the day this was written: SiteLayout.astro's own comment above the
// theme <style> says it is emitted "last in <head> so its --gd-* token reset wins over site.css".
// The served HTML says otherwise — the theme lands at byte ~1.3k and Astro's bundled site.css
// <link> at ~12.8k, so the renderer is last and wins. The source comment asserted the opposite of
// what shipped, which is how a trap survives being looked at.
//
// @layer settles it by construction: layer order beats specificity AND source order, so nobody has
// to compute a score or know which file loaded first.
//
// 🔴 Unlayered styles beat ALL layered ones.
//
// 🩸 This file used to say, immediately after that line, that package CSS therefore stays unlayered
// "so their relationship to everything else is unchanged by this. The only pair whose winner changes
// is (theme, renderer)". That was wrong, and it was wrong in the reassuring direction. Moving the
// theme into a layer changes TWO relationships, not one:
//
//   theme vs renderer    theme now wins  — the fix
//   theme vs package     theme now LOSES — the theme was beating package CSS on specificity before,
//                        and a layered rule cannot beat an unlayered one at any specificity
//
// Measured on the fleet, 2026-08-01 (reef docs/field/cascade-layers-2026-08):
//   a site     the owner's `html .locale-banner{color:#0a4a4c}` silently ignored, leaving 4.04:1 text
//             — on a banner that only renders for visitors whose language does not match the page,
//             so nobody testing their own site in their own language would ever have seen it
//   another   eight `.signet-arrow` glyphs the theme had hidden came back
//
// So package CSS now shares the THEME's layer, emitted first. A separate `reef.components` layer
// below the theme was tried and overshot: it also handed the theme every contest it used to lose on
// specificity — a theme's `html a { color: inherit }` (0,0,2) began beating
// `.locale-banner__continue` (0,1,0), 2.66:1 ink on a purple button. One layer, package CSS first,
// IS the pre-layer world: specificity decides, source order breaks ties for the theme. Unlayered is
// now reserved for what it should always have meant: the deliberate escape hatch, an `embed`
// coral's <style>.
//
// And a third layer, `reef.responsive`, AFTER the theme — for the mobile-nav state machine, where
// `display` means open/closed rather than layout. Two live sites broke there the moment layers
// landed (one site's fullscreen panel covering the whole page at 768px, another's nav refusing to
// collapse at 800px), both from theme rules that were only ever harmless because they lost.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const siteCss = readFileSync(join(HERE, 'astro/src/styles/site.css'), 'utf8');
const layout = readFileSync(join(HERE, 'astro/src/layouts/SiteLayout.astro'), 'utf8');

let passed = 0;
const pending = [];
// 🩸 This used to be `try { fn(); passed++; log('✓') }`. An ASYNC test returns a promise
// immediately, so it printed ✓ before doing anything and its rejection surfaced much later as an
// unhandled rejection — after the "N passed" line, attributed to nothing. One of the tests here is
// async, which means it was UNCONDITIONALLY GREEN, including the run where it claimed to have
// checked the real arrow.css. A harness that cannot fail is worse than no harness.
function test(name, fn) {
  const ok = () => { passed++; console.log('  ✓ ' + name); };
  const bad = (e) => { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(ok, bad));
    else ok();
  } catch (e) { bad(e); }
}

test('the layer ORDER is declared, and declared before anything can use it', () => {
  // `@layer a, b;` is what fixes the order. Without it, layers order by FIRST APPEARANCE — and in
  // the built HTML the theme's <style> comes at ~1.2k while the renderer's bundled <link> lands at
  // ~22k, so `reef.theme` would be declared first and `reef.base` would win everything.
  //
  // 🩸 Measured on a real build (a 955-line hand-rolled theme): dropping just this one line
  // changes 234 of 246 elements. The theme's entire --gd-* token block loses, so colours and fonts
  // fall back to renderer defaults across the whole page. That is not a degradation anyone would
  // describe as subtle, and nothing else would report it — which is why this assertion is here and
  // not merely implied by the two below.
  //
  // For contrast, the change this file exists to make is invisible on that same site: layered vs
  // genuinely layer-free renders identically, 0 of 246 elements. A theme written to win under the
  // old rules keeps winning; layers only decide the ties it used to lose.
  assert.match(layout, /@layer reef\.base, reef\.theme, reef\.responsive;/,
    'SiteLayout must declare the three layers in order, earliest in <head>');
  const order = layout.indexOf('@layer reef.base, reef.theme, reef.responsive;');
  const themeEmit = layout.indexOf('@layer reef.theme {');
  assert.ok(order > -1 && themeEmit > order, 'the declaration comes before the theme block');
});

test('🔴 reef.responsive is declared AFTER reef.theme, and holds the nav state machine', () => {
  // The order is the whole mechanism. If reef.responsive were declared before reef.theme, a theme
  // could beat it again and both live regressions would come straight back.
  const decl = /@layer ([^;]+);/.exec(layout);
  const names = decl[1].split(',').map((s) => s.trim());
  assert.ok(names.indexOf('reef.responsive') > names.indexOf('reef.theme'),
    'reef.responsive must come after reef.theme or it cannot protect anything');
  assert.ok(!names.includes('reef.components'),
    'package CSS shares reef.theme; a separate lower layer overshoots — see the note at the top');

  // The state machine itself has to actually BE in that layer — the declaration alone is a promise.
  const respStart = siteCss.indexOf('@layer reef.responsive {');
  assert.ok(respStart > -1, 'site.css must open reef.responsive');
  const block = siteCss.slice(respStart);
  for (const needle of [
    'body[data-nav-mobile="hamburger"] .rf-nav',
    'body[data-nav-mobile="fullscreen"] .rf-nav',
    '#rf-nav-toggle:checked',
  ]) assert.ok(block.includes(needle), `the nav state machine must live in reef.responsive: missing ${needle}`);

  // 🔴 Control: NOTHING BUT `display` may live here. This is the assertion that would have caught
  // the first attempt, which hoisted the entire `@media (max-width: 64rem)` block — carrying the
  // hamburger's colour and border, its margin, and the header's `position` above the theme, where
  // the owner could no longer reach them. Measured within minutes: a site's hamburger lost its
  // themed teal and its sticky header went relative.
  //
  // The old control here only asserted `.st-hero` was absent, which catches "the whole FILE moved"
  // and is blind to "the whole BLOCK moved" — a control that only fails for a mistake nobody was
  // about to make.
  //
  // 🩸 And the FIRST version of this control did not work either. It matched `prop:` with a
  // lookahead excluding anything followed by a `{`, which quietly excluded every declaration
  // except those in the block's last rule — so it reported ['display'] whatever was in there.
  // Proven by adding `color: red` and watching it stay green. Parse the innermost brace bodies
  // instead: those are declaration lists by construction.
  const body = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies = [...body.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  assert.ok(bodies.length >= 3, `expected several rules in reef.responsive, parsed ${bodies.length} — the parser is not reading the block`);
  const props = [...new Set(bodies.flatMap((b) => [...b.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1])))];
  assert.deepEqual(props, ['display'],
    `only display belongs in reef.responsive; found: ${props.join(', ')}`);
});

test('the renderer stylesheet is inside reef.base', () => {
  assert.match(siteCss, /^@layer reef\.base \{/m, 'site.css opens the layer');
  // Closing brace count has to balance, or the last rule silently swallows the rest of the file.
  const opens = (siteCss.match(/\{/g) || []).length;
  const closes = (siteCss.match(/\}/g) || []).length;
  assert.equal(opens, closes, `site.css braces unbalanced: ${opens} open, ${closes} close`);
});

test('the theme is emitted inside reef.theme', () => {
  assert.match(layout, /@layer reef\.theme \{/, 'the theme <style> wraps its content in the layer');
});

test('🔴 package CSS is layered WITH the theme, and emitted before it', () => {
  // 🩸 Twice wrong before this. Unlayered → the theme could not touch it at any specificity (a
  // locale banner, a set of arrows). A lower `reef.components` layer → the theme beat it at ANY
  // specificity, including a generic `html a` reset over a component's own class rule (a theme's
  // banner button at 2.66:1). Same layer, package first, restores what specificity always said.
  const lines = layout.split('\n');
  const pkgLine = lines.find((l) => l.includes('pkgCss &&'));
  const bannerLine = lines.find((l) => l.includes('localeBannerCss &&'));
  assert.ok(pkgLine && bannerLine, 'package CSS and the locale banner are still emitted');
  assert.match(pkgLine, /@layer reef\.theme/, 'package CSS belongs in reef.theme');
  assert.match(bannerLine, /@layer reef\.theme/, 'the locale banner belongs in reef.theme');
  // ORDER inside the layer is what decides ties, so it is asserted, not assumed.
  assert.ok(lines.indexOf(pkgLine) < lines.findIndex((l) => l.includes('themeCss &&')),
    'package CSS must be emitted BEFORE the site theme, so a tie goes to the theme');
  assert.ok(lines.indexOf(bannerLine) < lines.findIndex((l) => l.includes('themeCss &&')),
    'the locale banner too');
});

test('🔴 the imported-CSS plugin actually transforms the real arrow.css', async () => {
  // 🩸 The smoke build does NOT bundle arrow.css — none of its fixtures use a component that
  // imports it — so a green smoke run says nothing about this path. Feed the plugin the real file.
  // From its own zero-import module, NOT astro.config.mjs — importing the config pulls in
  // `astro/config` and dies in a bare checkout, which is exactly what CI is.
  const { reefComponentsLayer } = await import(new URL('astro/reef-components-layer.mjs', import.meta.url).href);
  const plugin = reefComponentsLayer();
  const arrowPath = join(HERE, 'astro/node_modules/@cvernet/signet/src/arrow.css');
  // 🩸 arrow.css lives in node_modules, and CI runs against a BARE checkout (ci.yml says so in
  // red). The repo's rule for this: a test may use an installed package for a STRONGER assertion,
  // but it must still hold something true without one AND SAY what it skipped. A silent fallback
  // stub would make "we could not find the file" look like "the file passed"; announcing the
  // reduction keeps both halves honest.
  let arrow, real = true;
  try { arrow = readFileSync(arrowPath, 'utf8'); assert.ok(arrow.length > 500, 'that is not the real arrow.css'); }
  catch { real = false; arrow = '.signet-arrow { display: inline-block; position: relative; }'; }
  if (!real) console.log('    ↳ node_modules absent: checked the transform on a stand-in, NOT the real arrow.css');

  const wrapped = plugin.transform(arrow, '/x/node_modules/@cvernet/signet/src/arrow.css');
  assert.ok(wrapped, 'arrow.css must be transformed');
  assert.match(wrapped.code, /^@layer reef\.theme \{/, 'wrapped in reef.theme');
  assert.ok(wrapped.code.includes('.signet-arrow'), 'and the rules survive the wrap');

  // Controls — each of these skips is load-bearing, and each would be silent if it broke.
  assert.equal(plugin.transform('@layer reef.base { a{} }', '/x/site.css'), null,
    'a sheet that places itself must NOT be nested inside another layer');
  assert.equal(plugin.transform('a{}', '/x/C.astro?astro&type=style&lang.css'), null,
    "Astro's scoped <style> pipeline is not package CSS");
  assert.equal(plugin.transform('a{}', '/x/thing.js'), null, 'non-CSS is untouched');
  assert.throws(() => plugin.transform('@import "y.css"; a{}', '/x/z.css'), /@import/,
    '@import cannot live inside a layer block — fail loudly rather than emit CSS the browser drops');
});

test('🔴 CSS a component IMPORTS is layered too, not just what SiteLayout inlines', () => {
  // `@cvernet/signet/arrow.css` reaches the page through Astro's bundler, not through SiteLayout —
  // so wrapping the two inline emissions above would have fixed the banner and left the arrows
  // broken. Handling it in the build covers the next `import './x.css'` anyone adds without them
  // having to know this file exists.
  const mod = readFileSync(join(HERE, 'astro/reef-components-layer.mjs'), 'utf8');
  const cfg = readFileSync(join(HERE, 'astro/astro.config.mjs'), 'utf8');
  assert.match(mod, /@layer reef\.theme/, 'the build must wrap imported CSS into the theme layer');
  assert.match(cfg, /plugins: \[reefComponentsLayer\(\)\]/, 'and the plugin must actually be installed');
  assert.match(cfg, /from '\.\/reef-components-layer\.mjs'/, 'from the standalone module');
  // Controls: it must skip the sheet that places itself, and Astro's own scoped blocks.
  assert.match(mod, /@layer\\s\+reef\\\./, 'skips a sheet that already names a reef layer');
  assert.match(mod, /\[\?&\]astro/, "skips Astro's scoped <style> pipeline");
});

test('control: an embed coral\'s <style> is still unlayered — the escape hatch survives', () => {
  // Everything above narrows what a theme may accidentally beat. If it also closed the deliberate
  // override, the doctrine would have quietly changed from "born-valid is a suggestion" to "a cage".
  const embed = readFileSync(join(HERE, 'astro/src/components/sections/Embed.astro'), 'utf8');
  assert.ok(!/@layer/.test(embed), 'embed <style> must stay unlayered so it outranks every layer');
});

test('control: the stale comment that asserted the opposite of the shipped order is gone', () => {
  // It said the theme was last and therefore won. The served bytes said the renderer was last. A
  // comment that contradicts the output is worse than no comment: it is a wrong answer with a
  // confident tone, and someone will act on it.
  assert.ok(!/last in <head> so its --gd-\* token reset wins over site\.css/.test(layout),
    'the comment claiming the theme wins by being last must not survive the fix that made it true for a different reason');
});

await Promise.all(pending);   // or an async failure lands after the tally, blaming nobody
console.log(`\n${passed} passed`);
