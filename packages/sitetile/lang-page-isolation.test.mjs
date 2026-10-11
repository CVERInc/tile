// The language chooser survives a site's own site-wide CSS, and a site can still restyle it.
//   run: node packages/sitetile/lang-page-isolation.test.mjs   (globbed into scripts/test.sh)
//        PLAYWRIGHT=/path/to/node_modules/playwright/index.js node …   (adds the measured half;
//        index.mjs works too)
//
// 🩸 CVERInc/reef#1887. A two-language site wrote a site-wide side gutter in its theme. It was a
// sound rule for that site's full-width sections. The chooser at /language is a page the platform
// draws, with a 32rem column, and the same padding took the whole column: the heading was left
// with a few pixels and wrapped one character per line. The band behind the rows was a dark teal
// that no token on the site had asked for, and a theme rule on `.rf-lang-list` lost to the
// platform's identical selector because the platform's sheet came later in the document.
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
  assert.match(route, /<SiteLayout[^>]*\brouteCss=\{languagePageCss\}/);
  const emit = layout.indexOf('{routeCss && <style');
  assert.ok(emit > -1, 'the layout does not emit routeCss');
  assert.ok(emit < layout.indexOf('{themeCss && <style'), 'routeCss must be emitted before the theme');
});

// ── built ────────────────────────────────────────────────────────────────────────────────────
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: prose %%\n\nA fixture page.\n`;
const ir = (siteFm) => ({
  '_site.md': `---\nbrand: Tsuru Paper\nlocales: en, zh-TW\n${siteFm}---\n`,
  'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
  'zh-tw/home.md': page('sitetile-page: home\ntitle: 紙鶴工坊\nlang: zh-TW', '紙鶴'),
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
const SITES = { plain: { files: ir('') }, themed: { files: ir('theme: fx\n'), theme: THEME } };

const chooserStyles = (html) => [...html.matchAll(/<style>([^<]*\.rf-lang-page[^<]*)<\/style>/g)];

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
        const top = []; let depth = 0; let head = ''; let stray = '';
        for (const ch of text) {
          if (ch === '{') { if (depth === 0) { top.push(head.trim().replace(/\s+/g, ' ')); head = ''; } depth++; }
          else if (ch === '}') { depth--; if (depth === 0) continue; }
          else if (depth === 0) head += ch;
        }
        stray = head.trim();
        assert.equal(depth, 0, `${name}: unbalanced braces in the chooser's sheet`);
        assert.deepEqual(top, ['@layer reef.theme', '@layer reef.responsive'], `${name}: top level of the chooser's sheet`);
        assert.equal(stray, '', `${name}: text outside every layer block`);
        assert.equal(text.replace(/\s+/g, ' ').trim(), css.replace(/\s+/g, ' ').trim(), `${name}: the emitted sheet differs from the source file`);
      }
    });

    await test('no other page carries it', () => {
      for (const name of ['plain', 'themed']) assert.equal(chooserStyles(built[name].home).length, 0, `${name}: the home page carries the chooser's sheet`);
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
                rows, bandLeft: Math.round(list.getBoundingClientRect().left), bandW: w(list),
                band: cs(list).backgroundColor, ink: cs(q('.rf-lang-list a')).color,
                padTop: cs(q('.rf-lang-page')).paddingTop, nameSize: cs(q('.rf-lang-name')).fontSize, radius: cs(q('.rf-lang-list a')).borderTopLeftRadius,
                surface: cs(probe).backgroundColor, text: cs(probe).color, vw: document.documentElement.clientWidth,
              };
              probe.remove();
              return out;
            });
          };
          return { read, close: () => ctx.close() };
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
          const i = await pages[1280].read('.rf-lang-list > li { max-width: 15rem !important; }');
          assert.deepEqual(i.rows.map((r) => r.w), [240, 240]);
          // …and the same property WITHOUT it does nothing, which is the protection, not a bug.
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
