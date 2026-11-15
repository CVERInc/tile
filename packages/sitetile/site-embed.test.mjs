// The site-wide embed slot: `embed:` in ir/_site.md is emitted VERBATIM, last thing before </body>,
// on every built page — and a site without it gains nothing at all.
//   run: node packages/sitetile/site-embed.test.mjs   (globbed into scripts/test.sh)
//
// reef#2302 (owner ruling 2026-10-21): third-party scripts (GA, a pixel, a chat button) get
// ONE raw slot and no named integrations. The slot is the per-page `embed` coral's escape hatch one
// level up, so this file asserts exactly what that promise is, on what a real build WROTE:
//   1. every page carries the raw string, byte for byte, immediately before </body>;
//   2. a page's own `embed:` frontmatter is not a second slot (the base _site.md's value is the one);
//   3. a site without the key builds pages byte-identical to the same site's pages with the slot's
//      text taken back out — nothing else moved, no wrapper, no marker;
//   4. a locale's own _site.md cannot add, change or remove the slot: the BASE value is on every
//      page of every locale exactly once, and a locale's value is on none (tile#182);
//   5. a site without the key builds pages identical to a renderer that NEVER HAD the slot — a
//      baseline independent of the slotted build, so a wrapper the layout always emits is caught
//      even though it would sit on both sides of (3) (tile#182).
//
// It needs the renderer's dependencies and SAYS SO when they are absent — same shape as
// not-found-locale.test.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RENDERER_SUBPATH } from '../build/index.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// Deliberately not well-formed on its own (an unclosed <div>, a stray `&`): the slot does not
// validate or repair, so the build must hand back exactly these bytes.
const RAW = '<script async src="https://example.com/tag.js?id=1&x=2"></script>\n<script>window.dataLayer = window.dataLayer || []; dataLayer.push({ a: "<b>" });</script>\n<div id="chat-button" data-x=\'1\'>';
const asBlock = (key, text) => `${key}: |\n${text.split('\n').map((l) => `  ${l}`).join('\n')}`;
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: hero %%\n\nA fixture page.\n`;
const pages = {
  'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
  // A page that writes the same key in its OWN frontmatter: not a second slot.
  'about.md': page('sitetile-page: about\ntitle: About\nlang: en\nembed: <b>PAGE-LEVEL-EMBED</b>', 'About'),
  'contact.md': page('sitetile-page: contact\ntitle: Contact\nlang: en', 'Contact'),
};
const SITES = {
  withSlot: { '_site.md': `---\nbrand: Tsuru Paper\n${asBlock('embed', RAW)}\n---\n`, ...pages },
  without: { '_site.md': '---\nbrand: Tsuru Paper\n---\n', ...pages },
};
// Two locales, each with a translated page and its own _site.md. Only the base _site.md's `embed`
// is the slot; whatever a locale's _site.md says about it is ignored on every page.
const BASE = '<b>BASE-SITE-EMBED</b>';
const LOCALE = '<b>LOCALE-SITE-EMBED</b>';
const localeSite = (baseEmbed, localeEmbed) => ({
  '_site.md': `---\nbrand: Tsuru Paper\nlocales: en, zh-TW\npackages: lingo\n${baseEmbed == null ? '' : `embed: ${baseEmbed}\n`}---\n`,
  'zh-tw/_site.md': `---\nbrand: 紙鶴工坊\nembed: ${localeEmbed}\n---\n`,
  'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
  'about.md': page('sitetile-page: about\ntitle: About\nlang: en', 'About'),
  'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
  'zh-tw/about.md': page('sitetile-page: about\ntitle: 關於\nlang: zh-TW', '關於'),
});
const LOCALE_SITES = {
  // base and locale both set it: BASE everywhere, LOCALE nowhere.
  localeBoth: { site: localeSite(BASE, LOCALE), expect: BASE },
  // only the locale sets it: no page carries either.
  localeOnly: { site: localeSite(null, LOCALE), expect: null },
  // the locale sets it EMPTY: that does not take the base value away from the locale's pages.
  localeEmpty: { site: localeSite(BASE, "''"), expect: BASE },
};
// The renderer as it was before the slot existed: the layout's body ended with the header-overlay
// script and then `\n  </body>`. The baseline engine below is this checkout with that one tail put
// back, cut from the header-overlay script to </body> — so whatever the CURRENT layout puts between
// them (the slot, or anything a later change wraps it in) is absent from the baseline.
const LAYOUT_REL = 'src/layouts/SiteLayout.astro';
const TAIL_ANCHOR = "<script>import '../packages/header-overlay/header-overlay.js';</script>";
const withoutTheSlot = (layout) => {
  assert.equal(layout.split(TAIL_ANCHOR).length, 2, `${LAYOUT_REL}: expected the header-overlay script exactly once`);
  const at = layout.indexOf(TAIL_ANCHOR) + TAIL_ANCHOR.length;
  const end = layout.indexOf('</body>', at);
  assert.ok(end > at, `${LAYOUT_REL}: no </body> after the header-overlay script`);
  assert.equal(layout.slice(end).split('</body>').length, 2, `${LAYOUT_REL}: expected exactly one </body>`);
  return `${layout.slice(0, at)}\n  ${layout.slice(end)}`;
};

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · site-embed END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-site-embed-'));
  const walk = (d) => (existsSync(d) ? readdirSync(d) : []).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  // A second engine checkout whose renderer never had the slot: the renderer directory is a copy
  // (the build stages content into it, and its layout is the one file rewritten), node_modules is
  // linked, and every other package is linked so the renderer's ../ imports resolve as they do here.
  const baselineEngine = () => {
    const eng = join(work, 'engine-baseline');
    const link = (rel) => { mkdirSync(dirname(join(eng, rel)), { recursive: true }); symlinkSync(join(ENGINE, rel), join(eng, rel)); };
    for (const n of readdirSync(ENGINE)) if (n !== 'packages' && n !== '.git') link(n);
    for (const n of readdirSync(join(ENGINE, 'packages'))) if (n !== 'sitetile') link(join('packages', n));
    for (const n of readdirSync(join(ENGINE, 'packages/sitetile'))) if (n !== 'astro') link(join('packages/sitetile', n));
    const astroCopy = join(eng, RENDERER_SUBPATH);
    const SKIP = new Set(['node_modules', '.astro', 'dist']);
    cpSync(ASTRO, astroCopy, { recursive: true, filter: (p) => {
      const top = relative(ASTRO, p).split(/[\\/]/)[0];
      return !SKIP.has(top) && !top.startsWith('.tile-build-');
    } });
    symlinkSync(join(ASTRO, 'node_modules'), join(astroCopy, 'node_modules'));
    const layout = join(astroCopy, LAYOUT_REL);
    writeFileSync(layout, withoutTheSlot(readFileSync(layout, 'utf8')));
    return eng;
  };
  const buildOne = (name, files, engine = ENGINE) => {
    const irDir = join(work, name, 'ir');
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(irDir, rel)), { recursive: true });
      writeFileSync(join(irDir, rel), body);
    }
    const outDir = join(work, name, 'out');
    const r = spawnSync(process.execPath, [join(ENGINE, 'packages/build/cli.mjs'), irDir, outDir, '--site-url', 'https://example.com', '--engine', engine], { encoding: 'utf8', timeout: 300_000 });
    const log = `${r.stdout || ''}\n${r.stderr || ''}`;
    const html = Object.fromEntries(walk(outDir).filter((p) => p.endsWith('.html')).map((p) => [relative(outDir, p), readFileSync(p, 'utf8')]));
    return { code: r.status, log, html };
  };
  try {
    const built = { withSlot: buildOne('withSlot', SITES.withSlot), without: buildOne('without', SITES.without) };
    for (const [name, { site }] of Object.entries(LOCALE_SITES)) built[name] = buildOne(name, site);
    built.baseline = buildOne('baseline', SITES.without, baselineEngine());
    for (const [name, b] of Object.entries(built)) assert.equal(b.code, 0, `astro build failed for ${name}:\n${b.log.slice(-1200)}`);
    const names = Object.keys(built.withSlot.html).sort();

    await test('the build wrote the pages this file is about', () => {
      for (const rel of ['index.html', 'about/index.html', 'contact/index.html', '404.html']) {
        assert.ok(names.includes(rel), `no ${rel} in the build: ${names.join(', ')}`);
      }
    });

    await test('🔴 every page carries the raw string, byte for byte, immediately before </body>', () => {
      for (const rel of names) {
        const html = built.withSlot.html[rel];
        assert.equal(html.split('</body>').length, 2, `${rel}: expected exactly one </body>`);
        assert.ok(html.includes(`${RAW}</body>`), `${rel}: the slot's text is not the last thing before </body>:\n…${html.slice(html.indexOf('</body>') - 300, html.indexOf('</body>') + 7)}`);
        assert.equal(html.split(RAW).length, 2, `${rel}: the slot's text appears more than once`);
      }
    });

    await test('a page\'s own `embed:` frontmatter is not a second slot', () => {
      for (const rel of names) assert.equal(built.withSlot.html[rel].includes('PAGE-LEVEL-EMBED'), false, `${rel} emitted a page's frontmatter embed`);
      for (const rel of Object.keys(built.without.html)) assert.equal(built.without.html[rel].includes('PAGE-LEVEL-EMBED'), false, `${rel} (no slot) emitted a page's frontmatter embed`);
    });

    await test('🔴 without the key, a page is byte-identical to the slotted page with the slot\'s text taken out', () => {
      assert.deepEqual(Object.keys(built.without.html).sort(), names, 'the two builds wrote different pages');
      for (const rel of names) {
        const expected = built.withSlot.html[rel].replace(`${RAW}</body>`, '</body>');
        assert.equal(built.without.html[rel], expected, `${rel}: a site without the key differs by more than the slot's text`);
      }
    });

    await test('🔴 a locale\'s _site.md cannot add, change or remove the slot — on any page of any locale', () => {
      // Every case and every page is checked before failing, so one run names each case that broke.
      const wrong = [];
      for (const [name, { expect }] of Object.entries(LOCALE_SITES)) {
        const rels = Object.keys(built[name].html).sort();
        for (const rel of ['index.html', 'about/index.html', 'zh-tw/index.html', 'zh-tw/about/index.html']) {
          if (!rels.includes(rel)) wrong.push(`${name}: no ${rel} in the build (${rels.join(', ')})`);
        }
        for (const rel of rels) {
          const html = built[name].html[rel];
          const locale = html.split(LOCALE).length - 1;
          const base = html.split(BASE).length - 1;
          if (locale !== 0) wrong.push(`${name} ${rel}: the locale's embed is on the page ${locale}×`);
          if (base !== (expect ? 1 : 0)) wrong.push(`${name} ${rel}: the base embed is on the page ${base}×, expected ${expect ? 1 : 0}`);
          if (expect && !html.includes(`${BASE}</body>`)) wrong.push(`${name} ${rel}: the base embed is not the last thing before </body>`);
        }
      }
      assert.deepEqual(wrong, []);
    });

    await test('🔴 without the key, a page matches a renderer that never had the slot', () => {
      assert.deepEqual(Object.keys(built.baseline.html).sort(), names, 'the baseline build wrote different pages');
      for (const rel of names) {
        assert.equal(built.without.html[rel], built.baseline.html[rel], `${rel}: a site without the key differs from a renderer that never had the slot`);
      }
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`site-embed: ${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
