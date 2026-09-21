// Guard: `dynamic-coral-css` is ONE site-level answer, read from the base `_site.md` and nowhere
// else, stamped once on the document root.
//   run: node packages/sitetile/dynamic-coral-css.test.mjs   (wired into scripts/test.sh)
//
// WHY THIS EXISTS. A dynamic coral's own package CSS has always been emitted unlayered, so it
// outranks the site's theme and a theme reaches it only through the `--gd-*` tokens it reads.
// Sites were themed against exactly that, so moving the CSS into `@layer reef.corals` is an OPT-IN:
// a site declares `dynamic-coral-css: layered` and everything it publishes moves together.
//
// "Together" is the whole feature, and it has three ways to break quietly:
//
//   · the LOCALE MERGE. Every other `_site.md` key is `{ ...base, ...<locale>/_site }`, and this
//     one must not be: a Lingo site could then serve /ja-jp/ layered and / unlayered, which is one
//     site with two cascades. The override is dropped AND said out loud — a silent drop leaves the
//     owner staring at a key that does nothing.
//   · the PAGE MERGE. Page frontmatter wins over site config by design, so a page carrying the key
//     would relayer one URL of the site.
//   · a TYPO. `dynamic-coral-css: true` silently picking a mode ships the layer its owner did not
//     ask for, with the build green. It is fatal on both the renderer and the emitter side, and
//     the emitter's flag is derived from the same base read, so the document-root stamp and the
//     worker's baked config cannot disagree — the last test here proves that on the hard case.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// blog.mjs imports the model layer as `@sitetile`, an Astro build alias plain node cannot resolve.
// Teach the resolver the one alias and test the function the site actually runs — the same thing
// blog-unlisted.test.mjs does, for the same reason. Same target as astro.config.mjs.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') {
      return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const { loadSite, siteMeta } = await import('./astro/src/lib/blog.mjs');
const { DYNAMIC_CORAL_CSS_KEY, DYNAMIC_CORAL_CSS_ATTR, DYNAMIC_CORAL_CSS_LAYERED, dynamicCoralCssMode } =
  await import('./astro/src/lib/dynamic-coral-css.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const fm = (lines) => '---\n' + lines.join('\n') + '\n---\n\nbody\n';

// Collect what the build would have printed, so "reported" is asserted as output and not as a
// comment claiming output happens.
function warnings(fn) {
  const seen = [];
  const real = console.warn;
  console.warn = (...args) => seen.push(args.join(' '));
  try { fn(); } finally { console.warn = real; }
  return seen;
}

// ── the value itself ──────────────────────────────────────────────────────────────────────────

test('absent is the legacy default, and there is no token to write for it', () => {
  assert.equal(dynamicCoralCssMode(undefined), '');
  assert.equal(dynamicCoralCssMode(null), '');
  assert.equal(dynamicCoralCssMode(''), '');
  assert.equal(dynamicCoralCssMode('   '), '');
});

test('the one declaration token resolves, surrounding space and all', () => {
  assert.equal(dynamicCoralCssMode(DYNAMIC_CORAL_CSS_LAYERED), 'layered');
  assert.equal(dynamicCoralCssMode(' layered '), 'layered');
});

test('🔴 anything else is FATAL, and the error names the key and the bad value', () => {
  for (const bad of ['true', 'yes', 'reef.base', 'Layered', 'unlayered', 'legacy']) {
    assert.throws(() => dynamicCoralCssMode(bad, 'content/_site.md'), (e) => {
      assert.match(e.message, new RegExp(DYNAMIC_CORAL_CSS_KEY));
      assert.ok(e.message.includes(JSON.stringify(bad)), `error must quote the bad value, got: ${e.message}`);
      assert.match(e.message, /content\/_site\.md/);
      return true;
    }, `"${bad}" must not silently select a mode`);
  }
});

// ── loadSite: base only, and every other key untouched ────────────────────────────────────────

test('the base _site.md declaration reaches every page of the site', () => {
  const glob = { '/s/content/_site.md': fm(['title: Harbour Press', 'dynamic-coral-css: layered']) };
  assert.equal(loadSite(glob)[DYNAMIC_CORAL_CSS_KEY], 'layered');
  assert.equal(loadSite(glob, 'about')[DYNAMIC_CORAL_CSS_KEY], 'layered');
  assert.equal(loadSite(glob, 'ja-jp/about')[DYNAMIC_CORAL_CSS_KEY], 'layered');
});

test('no declaration anywhere → the key is simply not there (legacy)', () => {
  const glob = { '/s/content/_site.md': fm(['title: Harbour Press']) };
  assert.equal(DYNAMIC_CORAL_CSS_KEY in loadSite(glob), false);
  assert.equal(DYNAMIC_CORAL_CSS_KEY in loadSite(glob, 'ja-jp/about'), false);
});

test('🔴 a locale _site.md CANNOT turn the site layered, and the build says so', () => {
  const glob = {
    '/s/content/_site.md': fm(['title: Harbour Press']),
    '/s/content/ja-jp/_site.md': fm(['footer-brand: ハーバー', 'dynamic-coral-css: layered']),
  };
  let resolved;
  const said = warnings(() => { resolved = loadSite(glob, 'ja-jp/about'); });
  assert.equal(DYNAMIC_CORAL_CSS_KEY in resolved, false, 'the locale override must be dropped, not merged');
  assert.equal(resolved['footer-brand'], 'ハーバー', 'the locale keeps every OTHER override it had');
  assert.equal(said.length, 1, `expected exactly one warning, got ${said.length}`);
  assert.match(said[0], /ja-jp/);
  assert.match(said[0], new RegExp(DYNAMIC_CORAL_CSS_KEY));
  assert.match(said[0], /IGNORED/);
});

test('🔴 a locale _site.md cannot turn a DECLARED site back to legacy either', () => {
  const glob = {
    '/s/content/_site.md': fm(['title: Harbour Press', 'dynamic-coral-css: layered']),
    '/s/content/sv-se/_site.md': fm(['footer-brand: Hamn', 'dynamic-coral-css:']),
  };
  let resolved;
  const said = warnings(() => { resolved = loadSite(glob, 'sv-se/about'); });
  assert.equal(resolved[DYNAMIC_CORAL_CSS_KEY], 'layered');
  assert.equal(said.length, 1);
  assert.match(said[0], /sv-se/);
});

test('the warning is emitted once per offending locale, not once per page', () => {
  const glob = {
    '/s/content/_site.md': fm(['title: Harbour Press']),
    '/s/content/fi-fi/_site.md': fm(['dynamic-coral-css: layered']),
  };
  const said = warnings(() => {
    loadSite(glob, 'fi-fi/about'); loadSite(glob, 'fi-fi/pricing'); loadSite(glob, 'fi-fi/terms');
  });
  assert.equal(said.length, 1, `a 600-page locale must not print 600 lines, got ${said.length}`);
});

test('🔴 a malformed BASE value stops the build, it does not fall back to legacy', () => {
  const glob = { '/s/content/_site.md': fm(['title: Harbour Press', 'dynamic-coral-css: true']) };
  assert.throws(() => loadSite(glob), /dynamic-coral-css: invalid value "true"/);
  assert.throws(() => siteMeta(glob), /dynamic-coral-css: invalid value "true"/);
});

test('CONTROL: every other key keeps the locale merge it has always had', () => {
  const glob = {
    '/s/content/_site.md': fm(['title: Harbour Press', 'footer-brand: Harbour', 'blog-label: Journal']),
    '/s/content/ja-jp/_site.md': fm(['footer-brand: ハーバー']),
  };
  const ja = loadSite(glob, 'ja-jp/about');
  assert.equal(ja['footer-brand'], 'ハーバー', 'locale override still wins');
  assert.equal(ja['blog-label'], 'Journal', 'base still inherited');
  assert.equal(ja.title, 'Harbour Press');
});

test('a site with no _site.md cannot declare through its home page frontmatter', () => {
  // Reachable ONLY when no `_site.md` exists anywhere: with one present, siteMeta returns
  // loadSite's result on its first line and never looks at home.md. Defence in depth, not the
  // stamp's mechanism — `meta` still flows into every Section, and a meta that answers this
  // question differently from the document root is a trap for whatever reads it next.
  const glob = { '/s/content/home.md': fm(['sitetile-page: home', 'title: Harbour Press', 'dynamic-coral-css: layered']) };
  assert.equal(DYNAMIC_CORAL_CSS_KEY in siteMeta(glob), false);
  // …and the control for that "only when absent" claim: with a `_site.md`, this branch is dead.
  const withSite = {
    '/s/content/_site.md': fm(['brand: Harbour']),
    '/s/content/home.md': fm(['sitetile-page: home', 'title: Harbour Press', 'dynamic-coral-css: layered']),
  };
  assert.equal(siteMeta(withSite).brand, 'Harbour', 'siteMeta returns the site-config layer, not home.md');
  assert.equal(DYNAMIC_CORAL_CSS_KEY in siteMeta(withSite), false);
});

// ── the document-root stamp ───────────────────────────────────────────────────────────────────

const layout = readFileSync(join(HERE, 'astro', 'src', 'layouts', 'SiteLayout.astro'), 'utf8');
const htmlTag = /<html\b[^>]*>/.exec(layout);
const bodyTag = /<body\b[\s\S]*?>/.exec(layout);

test('🔴 the stamp is on the DOCUMENT ROOT — a widget reads document.documentElement', () => {
  assert.ok(htmlTag, 'SiteLayout must still own the <html> tag');
  assert.ok(htmlTag[0].includes(DYNAMIC_CORAL_CSS_ATTR), `<html> must carry ${DYNAMIC_CORAL_CSS_ATTR}`);
  assert.ok(bodyTag, 'SiteLayout must still own the <body> tag');
  assert.equal(bodyTag[0].includes(DYNAMIC_CORAL_CSS_ATTR), false,
    'on <body> the attribute is unreachable from a widget that reads the root');
});

test('🔴 undeclared emits NO attribute at all — not an empty one, not a "legacy" one', () => {
  // `data-x={''}` would render `data-x=""`, and a widget testing for the attribute's PRESENCE
  // would then read every legacy site as declared. The fallback must be `undefined`.
  assert.match(htmlTag[0], new RegExp(DYNAMIC_CORAL_CSS_ATTR + '=\\{\\w+ \\|\\| undefined\\}'));
  assert.equal(/legacy/.test(htmlTag[0]), false, 'there is no legacy token; absence is the mode');
});

test('🔴 the stamp is resolved from the CONTENT GLOB, never from the meta prop', () => {
  // This is the guarantee, so it is asserted rather than left to a comment. `meta` is whatever a
  // route chose to hand down — 18 routes reach this layout, and the repo's own smoke fixtures
  // already render one with a hand-built meta object that never saw the site config. Reading the
  // site config directly is what makes the stamp impossible for a route to get wrong. The
  // build-level proof is in smoke-build.mjs; this keeps the mechanism from quietly reverting to
  // a prop read in between smoke runs, which is the cheap-looking edit that would do it.
  assert.match(layout, /dynamicCoralCssMode\(\s*\(loadSite\(contentGlob\) \|\| \{\}\)\[DYNAMIC_CORAL_CSS_KEY\]/);
  const stampLine = /const dynamicCoralCss = [\s\S]*?;/.exec(layout);
  assert.ok(stampLine, 'the stamp resolution must still be one statement');
  assert.equal(/\bmeta\[/.test(stampLine[0]), false, 'the stamp must not read the meta prop');
});

test('🔴 the layer-order STRING is picked by the branch it claims — a swapped ternary must not pass', () => {
  // cascade-layers.test.mjs pins that both exact strings occur somewhere in this file — proof a
  // layer name was not dropped or renamed. It is blind to the two strings trading PLACES on the
  // ternary that chooses between them: swap the `?`/`:` branches and both literals are still
  // present, so that test still passes while every undeclared site starts shipping the layered
  // statement and every declared one starts shipping the legacy one. Parse the condition and both
  // branches as tokens (not a whole-expression match) so this survives reformatting the same
  // selection onto one line, and only reds when the mapping itself changes.
  const ternary = /dynamicCoralCss\s*===\s*DYNAMIC_CORAL_CSS_LAYERED\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/.exec(layout);
  assert.ok(ternary, 'expected a `dynamicCoralCss === DYNAMIC_CORAL_CSS_LAYERED ? … : …` selection in SiteLayout.astro');
  const [, layeredBranch, defaultBranch] = ternary;
  assert.equal(layeredBranch, '@layer reef.base, reef.corals, reef.theme, reef.responsive;',
    'when dynamicCoralCss === DYNAMIC_CORAL_CSS_LAYERED, the chosen string must name reef.corals between reef.base and reef.theme');
  assert.equal(defaultBranch, '@layer reef.base, reef.theme, reef.responsive;',
    'the other branch must stay the exact three-name statement every undeclared site has always had');
});

// ── the stamp and the emitter's baked config agree ────────────────────────────────────────────

const EMITTER = join(HERE, '..', 'dynamic-corals', 'square-shop', 'emit-shop-function.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'dynamic-coral-css-'));
let emitted = 0;

/** Emit a real worker and hand back the config it baked into __SHOP_CONFIG__. */
function bakedConfig(extraArgs) {
  const out = join(workDir, 'worker-' + (++emitted) + '.mjs');
  execFileSync('node', [EMITTER, '--site-id', 'harbour-press', '--name', 'Harbour Press',
    '--api', 'https://api.example', ...extraArgs, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
  const source = readFileSync(out, 'utf8');
  const m = /const CFG = (\{.*\});/.exec(source);
  assert.ok(m, 'could not find the baked config in the emitted worker');
  return JSON.parse(m[1]);
}

test('🔴 on a site whose LOCALE tries to override it, the root stamp and the baked config agree', () => {
  // The hard case, and the one that made this a base-only read: the caller derives the emitter
  // flag from the same base `_site.md` the renderer stamps from, so a locale file that sets the
  // key changes neither of them. If either side ever read the merged config, this goes red.
  const glob = {
    '/s/content/_site.md': fm(['title: Harbour Press', 'dynamic-coral-css: layered']),
    '/s/content/ja-jp/_site.md': fm(['footer-brand: ハーバー', 'dynamic-coral-css:']),
  };
  let stamped;
  warnings(() => { stamped = loadSite(glob, 'ja-jp/shop')[DYNAMIC_CORAL_CSS_KEY]; });
  const baseDeclared = loadSite(glob)[DYNAMIC_CORAL_CSS_KEY];
  const baked = bakedConfig(['--dynamic-coral-css', baseDeclared]);
  assert.equal(stamped, 'layered', 'the ja-jp page still stamps the base mode');
  assert.equal(baked.dynamicCoralCss, stamped, 'the worker must bake exactly what the root carries');
});

test('undeclared: no root stamp and no baked key — the worker is what it always was', () => {
  const glob = { '/s/content/_site.md': fm(['title: Harbour Press']) };
  assert.equal(DYNAMIC_CORAL_CSS_KEY in loadSite(glob, 'ja-jp/shop'), false);
  assert.equal('dynamicCoralCss' in bakedConfig([]), false);
});

console.log(`\ndynamic-coral-css: ${passed} passed`);
