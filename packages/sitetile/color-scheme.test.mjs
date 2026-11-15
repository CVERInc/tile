// A built page tells the browser which colour schemes the site supports, when the site said so.
//   run: node packages/sitetile/color-scheme.test.mjs   (globbed into scripts/test.sh)
//
// 🩸 reef#3262. A site whose theme carried dark-mode styles switched its own colours under a
// dark OS and never said so to the browser: no `<meta name="color-scheme">`, no `color-scheme`
// property. The browser kept drawing ITS parts light — with always-visible scrollbars, a white
// scrollbar track beside a dark page, and light native form controls.
//
// The rule this file holds: the declaration is read from the one STRUCTURED place a site states it,
// the `color-scheme` key (`ir/_site.md`, or a page's own frontmatter), and from nowhere else.
//   light        → `light`          dark        → `dark`
//   light dark   → `light dark`     toggle      → follows the `data-theme` the switch stamps
//   absent / anything else → the page gains nothing
// 🔴 The renderer never reads CSS text to guess. A theme's own `@media (prefers-color-scheme: dark)`
// rules do not make the page declare dark: a guess of `light dark` on a site that only darkens a
// corner of itself would flip its canvas and native controls dark under a light design, which is
// worse than saying nothing. The custom-CSS fixture below holds that.
//
// The pure half (the value reader, the emitted text, the wiring in the layout) runs regardless.
// The built half needs the renderer's dependencies and SAYS SO when they are absent — same shape as
// not-found-locale.test.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASTRO = join(HERE, 'astro');
const LAYOUT = readFileSync(join(ASTRO, 'src/layouts/SiteLayout.astro'), 'utf8');

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const lib = await import('./astro/src/lib/color-scheme.mjs').catch((e) => ({ missing: e }));
const need = () => assert.ok(!lib.missing, `astro/src/lib/color-scheme.mjs does not load: ${lib.missing && lib.missing.message}`);

// ── the pure half ────────────────────────────────────────────────────────────────────────────────
await test('🔴 the declaration is exactly the schemes the site named: light, dark, or both', () => {
  need();
  assert.equal(lib.declaredColorScheme('light'), 'light');
  assert.equal(lib.declaredColorScheme('dark'), 'dark');
  assert.equal(lib.declaredColorScheme('light dark'), 'light dark');
});

await test('spellings a frontmatter reader hands over verbatim resolve to the same three answers', () => {
  need();
  assert.equal(lib.declaredColorScheme('  Light  '), 'light');
  assert.equal(lib.declaredColorScheme('"dark"'), 'dark');
  assert.equal(lib.declaredColorScheme("'light dark'"), 'light dark');
  assert.equal(lib.declaredColorScheme('light   dark'), 'light dark');
  assert.equal(lib.declaredColorScheme('LIGHT\tDARK'), 'light dark');
  // One canonical order, so two sites that mean the same thing emit the same bytes.
  assert.equal(lib.declaredColorScheme('dark light'), 'light dark');
});

await test('🔴 anything that is not a list of light/dark declares NOTHING (never a guess)', () => {
  need();
  for (const v of [undefined, null, '', '   ', 'auto', 'normal', 'both', 'system', 'only light', 'light, dark', 'light dark sepia',
    'light light', 'true', 'on', 0, false, {}, [], 'dark"><script>', 'light;}html{display:none', 'toggle']) {
    assert.equal(lib.declaredColorScheme(v), '', `${JSON.stringify(v)} must declare nothing`);
  }
});

await test('the emitted CSS sits in the renderer\'s base layer, so a theme\'s own `color-scheme` wins', () => {
  need();
  assert.equal(lib.colorSchemeCss('light'), '@layer reef.base{:root{color-scheme:light}}');
  assert.equal(lib.colorSchemeCss('dark'), '@layer reef.base{:root{color-scheme:dark}}');
  assert.equal(lib.colorSchemeCss('light dark'), '@layer reef.base{:root{color-scheme:light dark}}');
  assert.equal(lib.colorSchemeCss(''), '');
  // Only the three canonical answers produce text: the function is not a way to write CSS.
  for (const v of ['toggle', 'Light', 'dark light', 'light}', undefined]) assert.equal(lib.colorSchemeCss(v), '');
});

await test('🔴 a `toggle` site declares the scheme the SWITCH picked, not the one the OS prefers', () => {
  need();
  // The switch stamps `data-theme` on <html> before first paint (saved choice, else the OS). The
  // declaration follows that attribute, so a visitor who picked light on a dark OS gets light
  // scrollbars and controls with the light palette. No attribute (scripts off) → no declaration,
  // which is what the page had before.
  assert.equal(lib.TOGGLE_COLOR_SCHEME_CSS,
    '@layer reef.base{:root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}}');
});

await test('the layout emits the meta and the sheet from the reader, and from nowhere else', () => {
  assert.match(LAYOUT, /import \{[^}]*\bdeclaredColorScheme\b[^}]*\} from '\.\.\/lib\/color-scheme\.mjs';/);
  assert.match(LAYOUT, /\{colorSchemeDeclared && <meta name="color-scheme" content=\{colorSchemeDeclared\} \/>\}/);
  assert.match(LAYOUT, /\{colorSchemeSheet && <style is:inline set:html=\{styleText\(colorSchemeSheet\)\}><\/style>\}/);
  // One meta, one property site: a second hand-written declaration would be a second answer.
  // (Counted in the template only — the frontmatter's comments name the tag too.)
  const headAt = LAYOUT.indexOf('\n  <head>\n');
  assert.ok(headAt > 0 && LAYOUT.indexOf('\n  <head>\n', headAt + 1) === -1, 'the template <head> was not found exactly once');
  const head = LAYOUT.slice(headAt);
  assert.equal((head.match(/name="color-scheme"/g) || []).length, 1);
  // The meta comes before any stylesheet or script in <head>: it is what colours the canvas
  // before CSS arrives.
  const meta = head.indexOf('name="color-scheme"');
  for (const later of ['<style', '<script', '<link']) {
    assert.ok(meta > 0 && meta < head.indexOf(later), `the color-scheme meta must precede the first ${later}`);
  }
  // The sheet comes after the statement that declares the layer order (a layer first named by a
  // block would be ordered by that block), and before the site's theme.
  const sheet = head.indexOf('styleText(colorSchemeSheet)');
  assert.ok(head.indexOf('styleText(layerOrder)') < sheet && sheet < head.indexOf('styleText(themeCssBlock)'));
});

// ── the built half ───────────────────────────────────────────────────────────────────────────────
const BUILD_TIMEOUT_MS = 240_000;
const DARK_QUERY_CSS = '@media (prefers-color-scheme: dark) { html:root { background: #052829; } [data-theme="dark"] .x { color: #fff; } }';
/** A compiled theme the way the theme compiler writes one, with owner CSS in the residue block. */
const themeCss = (residue) => '/* Compiled from ir/_theme.md — do not hand-edit. Theme: fixture. */\nhtml:root {\n  --gd-accent: #0a7a7c;\n}\n'
  + (residue ? `\n/* reef:has-custom-css ── custom CSS, verbatim from the _theme.md body ── */\n${residue}\n` : '');
const page = (kind, title, extra = '') => `---\nsitetile-page: ${kind}\ntitle: ${title}\nlang: en-US\n${extra}---\n\n## Fixture\nFixture body.\n`;
const BOOK = '---\ntitle: Fixture Book\n---\n\n# Chapter One\n\nA page of the fixture book.\n';

/** Build a throwaway sibling copy of astro/ holding exactly this site; return { rel → html }. */
function buildSite({ siteLines = '', theme = '', pages = {}, book = false }) {
  const dir = mkdtempSync(join(HERE, '.smoke-color-scheme-'));
  try {
    cpSync(ASTRO, dir, { recursive: true, filter: (src) => !/[\\/](node_modules|\.astro|dist[^\\/]*)(?:[\\/]|$)/.test(src) });
    symlinkSync(join(ASTRO, 'node_modules'), join(dir, 'node_modules'), 'dir');
    for (const folder of ['content', 'blog']) {
      rmSync(join(dir, folder), { recursive: true, force: true });
      mkdirSync(join(dir, folder), { recursive: true });
    }
    writeFileSync(join(dir, 'content/_site.md'),
      `---\nsitetile-page: _site\ntitle: Fixture Site\nbrand: Fixture\npackages: blog\nblog-search: on\nblog-category-routes: on\nblog-tag-routes: on\nlang: en-US\n${theme ? 'theme: fixture\n' : ''}${siteLines}---\n`);
    writeFileSync(join(dir, 'content/home.md'), page('home', 'Welcome'));
    writeFileSync(join(dir, 'content/about.md'), page('page', 'About'));
    for (const [rel, body] of Object.entries(pages)) writeFileSync(join(dir, 'content', rel), body);
    writeFileSync(join(dir, 'blog/first-post.md'), '---\ntitle: "First post"\ndescription: "Fixture post."\npubDate: 2026-08-03\ncategories: news\ntags: notes\n---\nA post body.\n');
    if (theme) writeFileSync(join(dir, 'src/themes/fixture.css'), theme);
    if (book) { mkdirSync(join(dir, 'pagetile'), { recursive: true }); writeFileSync(join(dir, 'pagetile/fixture.book.md'), BOOK); }
    const dist = join(dir, 'dist-color-scheme');
    const run = spawnSync('npx', ['astro', 'build', '--outDir', dist], {
      cwd: dir, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS,
      env: { ...process.env, SITE_URL: 'https://example.com', SITE_ID: 'scheme-fixture', PLATFORM_ORIGIN: 'https://platform.example' },
    });
    if (run.status !== 0) throw new Error(`astro build exited ${run.status}${run.signal ? ` (${run.signal})` : ''}\n${(run.stderr || '').slice(-2000)}\n${(run.stdout || '').slice(-2000)}`);
    const out = new Map();
    const walk = (rel) => {
      for (const ent of readdirSync(join(dist, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) { if (ent.name !== '_astro') walk(r); } else if (ent.name.endsWith('.html')) out.set(r, readFileSync(join(dist, r), 'utf8'));
      }
    };
    walk('');
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What one built page says about colour schemes: every meta, and every `color-scheme` declaration
 *  in an inline sheet with the fixture theme's own text removed (that text is the site's, and the
 *  question here is what the RENDERER added). */
function saysOf(html, theme = '') {
  const metas = [...html.matchAll(/<meta name="color-scheme" content="([^"]*)"\s*\/?>/g)].map((m) => m[1]);
  const head = html.slice(0, html.indexOf('</head>'));
  const sheets = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).filter((css) => !theme || !css.includes('--gd-accent: #0a7a7c'));
  const props = sheets.flatMap((css) => [...css.matchAll(/(?<![-\w])color-scheme\s*:\s*([^;}]+)/g)].map((m) => m[1].trim()));
  const firstSheet = head.search(/<style|<link[^>]+rel="stylesheet"|<script/);
  return { metas, props, metaFirst: metas.length === 0 || head.indexOf('name="color-scheme"') < firstSheet, head };
}
/** The first `color-scheme` on a page that is not the media feature `prefers-color-scheme`, with
 *  its surroundings (so a failure names what said it); '' when there is none. */
function mentionOf(html) {
  const m = /(?<!prefers-)color-scheme/.exec(html);
  return m ? html.slice(Math.max(0, m.index - 80), m.index + 60) : '';
}
const ROUTES = ['index.html', 'about/index.html', 'devlog/index.html', 'devlog/first-post/index.html', '404.html', 'search/index.html'];

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log('  · color-scheme BUILT HALF SKIPPED — no packages/sitetile/astro/node_modules (run npm install there)');
} else {
  // Site A — the site declares both, in _site.md; its pages each override or inherit. One build
  // covers the route kinds (page, blog index, post, 404, search, archive, the book preview) and
  // the per-page cases.
  let a = null;
  let b = null;
  let c = null;
  await test('▸ builds: a declaring site, a silent site with dark-query custom CSS, a silent themeless site', () => {
    a = buildSite({
      siteLines: 'color-scheme: light dark\n', theme: themeCss(DARK_QUERY_CSS), book: true,
      pages: {
        'light-only.md': page('page', 'Light only', 'color-scheme: light\n'),
        'dark-only.md': page('page', 'Dark only', 'color-scheme: dark\n'),
        'switch.md': page('page', 'Switch', 'color-scheme: toggle\n'),
        'unknown.md': page('page', 'Unknown', 'color-scheme: sepia\n'),
      },
    });
    b = buildSite({ theme: themeCss(DARK_QUERY_CSS) });
    c = buildSite({});
  });

  await test('🔴 both → every route of the site says `light dark`, in a meta and on :root (404 and preview included)', () => {
    assert.ok(a, 'the declaring site did not build');
    const routes = [...ROUTES, 'preview/index.html', ...[...a.keys()].filter((r) => /^(category|tag)\//.test(r) || /^preview\/.+/.test(r))];
    assert.ok(routes.some((r) => /^preview\/.+\/index\.html$/.test(r)), `no book chapter route was built: ${[...a.keys()].join(', ')}`);
    assert.ok(routes.some((r) => /^category\//.test(r)), 'no category archive was built');
    for (const rel of routes) {
      assert.ok(a.has(rel), `${rel} was not built (have: ${[...a.keys()].join(', ')})`);
      const s = saysOf(a.get(rel), 'fixture');
      assert.deepEqual(s.metas, ['light dark'], `${rel}: meta`);
      assert.deepEqual(s.props, ['light dark'], `${rel}: :root declaration`);
      assert.ok(a.get(rel).includes('@layer reef.base{:root{color-scheme:light dark}}'), `${rel}: the declaration is not in the base layer`);
      assert.ok(s.metaFirst, `${rel}: the meta must come before the first sheet or script`);
    }
    // Every page the build wrote was looked at for a route nobody listed.
    for (const [rel, html] of a) {
      if (['light-only/index.html', 'dark-only/index.html', 'switch/index.html', 'unknown/index.html'].includes(rel)) continue;
      assert.deepEqual(saysOf(html, 'fixture').metas, ['light dark'], `${rel}: an unlisted route disagrees with the site`);
    }
  });

  await test('🔴 light-only → `light`; dark-only → `dark` (never both)', () => {
    assert.ok(a, 'the declaring site did not build');
    const light = saysOf(a.get('light-only/index.html'), 'fixture');
    assert.deepEqual([light.metas, light.props], [['light'], ['light']]);
    const dark = saysOf(a.get('dark-only/index.html'), 'fixture');
    assert.deepEqual([dark.metas, dark.props], [['dark'], ['dark']]);
  });

  await test('toggle → no meta; the declaration follows data-theme', () => {
    assert.ok(a, 'the declaring site did not build');
    const html = a.get('switch/index.html');
    const s = saysOf(html, 'fixture');
    assert.deepEqual(s.metas, []);
    assert.deepEqual(s.props, ['light', 'dark']);
    assert.ok(html.includes('@layer reef.base{:root[data-theme="light"]{color-scheme:light}:root[data-theme="dark"]{color-scheme:dark}}'));
    assert.ok(html.includes('id="rf-theme-toggle"'), 'the fixture page did not get the switch at all');
  });

  await test('a value that is not light/dark → the page declares nothing, not the site\'s answer', () => {
    assert.ok(a, 'the declaring site did not build');
    const s = saysOf(a.get('unknown/index.html'), 'fixture');
    assert.deepEqual([s.metas, s.props], [[], []]);
  });

  await test('🔴 owner custom CSS with `prefers-color-scheme: dark` and no key → NOTHING is declared on any route', () => {
    assert.ok(b, 'the silent custom-CSS site did not build');
    for (const rel of ROUTES) assert.ok(b.has(rel), `${rel} was not built`);
    for (const [rel, html] of b) {
      // The control: the owner's dark query did reach this page, so silence is a decision.
      assert.ok(html.includes('prefers-color-scheme: dark') || html.includes('prefers-color-scheme:dark'), `${rel}: the fixture theme is not on the page`);
      const s = saysOf(html, 'fixture');
      assert.deepEqual([s.metas, s.props], [[], []], `${rel}: the renderer guessed from CSS text`);
      assert.equal(mentionOf(html), '', `${rel}: a color-scheme mention reached a silent site`);
    }
  });

  await test('🔴 a site that says nothing gains nothing: no `color-scheme` anywhere in any page', () => {
    assert.ok(c, 'the silent themeless site did not build');
    for (const rel of ROUTES) assert.ok(c.has(rel), `${rel} was not built`);
    for (const [rel, html] of c) assert.equal(mentionOf(html), '', `${rel}: a silent site mentions color-scheme`);
  });
}

console.log(process.exitCode ? '✗ color-scheme: failures above' : `✓ color-scheme: ${passed} checks — a site's declared colour schemes reach the browser; an undeclared site is untouched`);
