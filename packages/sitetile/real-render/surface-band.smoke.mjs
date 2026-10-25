#!/usr/bin/env node
// `surface=` sections are BANDS (reef#1869, ruled 2026-10-20) — measured in a real browser.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/sitetile/real-render/surface-band.smoke.mjs --tile <checkout>
//
// 🩸 prose / grid / timeline emit `data-surface` for the theme to paint, and base cages the section
// at its width, so a painted surface was a box in the middle of the page. The band is the PAINT:
// the section's background is carried to the column's edges and its box does not move.
// 🩸 tile#200 review: the first version moved the box instead (max-width:none + percent padding),
// and a theme that capped the section with `max-width` alone collapsed its content to 0px.
// 🩸 tile#200 review r2: the second version (a `::before` copy, `isolation` on the section,
// `overflow-x: clip` on its parent) cut off a sibling's wide table, buried a theme's fixed button
// under the next section, and painted a translucent colour twice. The band is now a border-image
// outset in the theme's `--gd-band`. Measured here:
//   · pixels at the left and right edge of the viewport, halfway down each band, are its colour —
//     at 1280, 390, 1600 and 1920 — and the page never scrolls sideways (classic scrollbars ON, so
//     paint past the viewport would show up as scroll width if the outset were not ink overflow);
//   · the band's box and content box are those of an identical section WITHOUT `surface=`, to the
//     pixel; the band stays position:static, no isolation, no ::before, its parent unclipped;
//   · the r1 reviewer's width-only theme (`max-width: 40rem`) leaves the content box the twin's;
//   · the r2 reviewer's three: a wide table in a sibling section scrolls to its last column at
//     390; a fixed button a theme pulls out of a band is still what a click at it hits, with the
//     next band under it; a translucent `--gd-band` is one colour inside and outside the box;
//   · a theme that paints a token with `background` only keeps the old box: edges are page bg;
//   · reef.theme rules still win: one turns the band off, one re-cages the box.
// Lives beside announce-card.smoke.mjs for the same reasons and runs from the same gated block.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const ti = argv.indexOf('--tile');
const TILE = path.resolve(ti >= 0 ? argv[ti + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const ASTRO = path.join(TILE, 'packages/sitetile/astro');
const FIX = path.join(TILE, 'packages/sitetile/.smoke-surface-band');
const DIST = path.join(FIX, 'dist');

// Each measured section has a twin with the same body and no `surface=`. Uneven bodies (a long
// paragraph, a short one, a list) so a content box that moved shows up in more than one child.
const PROSE = 'A paragraph long enough to wrap at every width this smoke measures, so its box is the '
  + 'content box and not the width of its own words. '.repeat(3) + '\n\nShort one.\n\n- a list item\n- another';
const GRID = '### First\nOne card.\n\n### Second\nAnother card, with a little more text in it.\n\n### Third\nThe last card.';
const TIMELINE = '### 2024\nThe first entry.\n\n### 2025\nThe second entry, a little longer than the first one.';
const SECTIONS = [
  ['Intro', 'prose', 'The first section becomes the page heading; nothing is measured here.'],
  ['Prose band', 'prose surface=cream', PROSE], ['Prose twin', 'prose', PROSE],
  ['Grid band', 'grid cols=3 surface=paper', GRID], ['Grid twin', 'grid cols=3', GRID],
  ['Timeline band', 'timeline surface=cream', TIMELINE], ['Timeline twin', 'timeline', TIMELINE],
  ['Glass band', 'prose surface=glass', PROSE],
  // A plain sibling with a table wider than a phone; the renderer puts no scrolling wrapper on it.
  ['Plans', 'prose', '|' + Array.from({ length: 10 }, (_, i) => ` Plan${i} `).join('|') + '|\n|'
    + Array(10).fill(' --- ').join('|') + '|\n|' + Array(10).fill(' 1234567890 ').join('|') + '|'],
  ['Book', 'prose surface=cream', '[Book now](/book) · [Contact](/contact)'],
  ['Services', 'prose surface=paper', PROSE],
];

rmSync(FIX, { recursive: true, force: true });
cpSync(ASTRO, FIX, { recursive: true, filter: (s) => !/[\\/](node_modules|\.astro|dist-[^\\/]+|\.smoke-[^\\/]+)(?:[\\/]|$)/.test(s) });
symlinkSync(path.join(ASTRO, 'node_modules'), path.join(FIX, 'node_modules'), 'dir');
rmSync(path.join(FIX, 'content'), { recursive: true, force: true });
rmSync(path.join(FIX, 'blog'), { recursive: true, force: true });
mkdirSync(path.join(FIX, 'content'), { recursive: true });
mkdirSync(path.join(FIX, 'blog'), { recursive: true });
writeFileSync(path.join(FIX, 'content/_site.md'), '---\nsitetile-page: _site\ntitle: Surface band site\nlang: en-US\n---\n');
writeFileSync(path.join(FIX, 'content/home.md'), '---\nsitetile-page: home\ntitle: Home\nlang: en-US\n---\n\n'
  + SECTIONS.map(([t, p, b]) => `## ${t}\n%% sitetile: ${p} %%\n${b}\n`).join('\n'));
execFileSync('npx', ['astro', 'build', '--outDir', DIST], { cwd: FIX, stdio: 'inherit',
  env: { ...process.env, SITE_ID: 'smoke-site', PLATFORM_ORIGIN: 'https://feelreef.com' } });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!existsSync(f) || !path.extname(f)) f = existsSync(path.join(f, 'index.html')) ? path.join(f, 'index.html') : f;
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// The theme names each token's colour in `--gd-band` (theme layer): the contract the band reads.
// glass is translucent: over the white page it must be one colour inside and outside the box.
const CREAM = [238, 204, 170], PAPER = [20, 110, 200], PAGE_BG = [255, 255, 255], GLASS = [204, 204, 204];
const THEME = `@layer reef.theme {
  [data-surface="cream"] { --gd-band: rgb(${CREAM}); }
  [data-surface="paper"] { --gd-band: rgb(${PAPER}); }
  [data-surface="glass"] { --gd-band: rgba(0, 0, 0, .2); }
}`;
// A theme that paints with `background` and no --gd-band: no band, the box as before.
const THEME_BG = `@layer reef.theme {
  [data-surface="cream"] { background: rgb(${CREAM}); }
  [data-surface="paper"] { background: rgb(${PAPER}); }
}`;
const PAINT = { Prose: CREAM, Grid: PAPER, Timeline: CREAM };
// The tile#200 reviewer's input, verbatim in spirit: a cap and NOTHING else.
const WIDTH_ONLY = '@layer reef.theme { .st-prose, .st-grid, .st-timeline { max-width: 40rem; } }';

// Every section, keyed by its heading: the border box, the content box (border box minus padding),
// the union of its children, the box it sits in, and what its ::before is.
const measure = (pg) => pg.evaluate(() => {
  const de = document.documentElement;
  const out = { vw: de.clientWidth, scrollWidth: de.scrollWidth };
  for (const s of document.querySelectorAll('section[class^="st-"]')) {
    const h = s.querySelector(':scope > h1, :scope > h2');
    if (!h) continue;
    const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    const kids = [...s.children].map((c) => c.getBoundingClientRect()).filter((k) => k.width > 0);
    const p = s.parentElement.getBoundingClientRect(), ps = getComputedStyle(s.parentElement);
    out[h.textContent.trim()] = {
      x: r.left, w: r.width, top: r.top + scrollY, h: r.height,
      surface: s.getAttribute('data-surface'), maxWidth: cs.maxWidth, position: cs.position,
      isolation: cs.isolation, zIndex: cs.zIndex, borderImage: cs.borderImageSource, parentOverflow: ps.overflow,
      before: getComputedStyle(s, '::before').content,
      content: { x: r.left + pl, w: r.width - pl - pr },
      kids: { l: Math.min(...kids.map((k) => k.left)), r: Math.max(...kids.map((k) => k.right)) },
      parent: { x: p.left + parseFloat(ps.paddingLeft), w: p.width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) },
    };
  }
  return out;
});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.5, `${msg}: ${a} vs ${b}`);

// Pixels at the left and right edge of the VIEWPORT (clientWidth: the scrollbar is not page),
// halfway down a section, and one just inside the section's box. Scrolls the section's middle to
// the viewport's middle, screenshots the viewport, decodes it in the page (no PNG dependency here).
async function edgePixels(pg, heading) {
  const { y, vw, ix } = await pg.evaluate((t) => {
    const h = [...document.querySelectorAll('section h2')].find((e) => e.textContent.trim() === t);
    const s = h.closest('section'), r = s.getBoundingClientRect();
    scrollTo(0, Math.max(0, scrollY + r.top + r.height / 2 - innerHeight / 2));
    const r2 = s.getBoundingClientRect();
    // inside: 3px into the section's own box, in its padding (no glyph lands there).
    return { y: Math.round(r2.top + r2.height / 2), vw: document.documentElement.clientWidth, ix: Math.round(r2.left + 3) };
  }, heading);
  const png = (await pg.screenshot()).toString('base64');
  return pg.evaluate(async ({ png, y, vw, ix }) => {
    const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const at = (x) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { left: at(0), right: at(vw - 1), inside: at(ix), y };
  }, { png, y, vw, ix });
}
const sameColour = (got, want, msg) => assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= 3),
  `${msg}: got rgb(${got}) want rgb(${want})`);

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
// Classic scrollbars ON: headless hides them by default, and then 100vw === clientWidth and a band
// that overflows by the scrollbar width (the bug .st-embed.is-wide documents) cannot be seen.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
let failed = null;
let checks = 0;
const open = async (width, css) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  await pg.goto(origin + '/', { waitUntil: 'load' });
  for (const c of css) await pg.addStyleTag({ content: c });
  return { ctx, pg };
};
// The page's scroll width with every band turned off. The Plans table is wider than any cage, so
// the page scrolls sideways on its own; what the band must not do is change by how much.
const BAND_OFF = '@layer reef.theme { [data-surface] { border-image: none; } }';
const scrollWidthWithoutBands = async (width, css) => {
  const { ctx, pg } = await open(width, [...css, BAND_OFF]);
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
  await ctx.close();
  return sw;
};
try {
  // The tile#200 regression: a theme that caps the section and says nothing about padding.
  for (const width of [1280, 1600, 1920]) {
    const { ctx, pg } = await open(width, [THEME, WIDTH_ONLY]);
    const m = await measure(pg);
    const at = `width-only theme @${width}`;
    for (const kind of ['Prose', 'Grid', 'Timeline']) {
      const band = m[`${kind} band`], twin = m[`${kind} twin`];
      near(band.w, 640, `${at}: the theme's 40rem cap did not hold on the ${kind} band`);
      near(band.w, twin.w, `${at}: ${kind} band box differs from its twin`);
      near(band.content.w, twin.content.w, `${at}: ${kind} band content width differs from its twin`);
      near(band.content.x, twin.content.x, `${at}: ${kind} band content moved`);
      assert.ok(band.content.w > 500, `${at}: ${kind} band content collapsed to ${band.content.w}px`);
      checks += 5;
      console.log(`  ${at} ${kind}: box w${band.w.toFixed(1)}, content ${band.content.w.toFixed(1)} = twin ${twin.content.w.toFixed(1)}`);
    }
    const px = await edgePixels(pg, 'Prose band');
    sameColour(px.left, CREAM, `${at}: band paint lost at the left edge under a capped section`);
    sameColour(px.right, CREAM, `${at}: band paint lost at the right edge under a capped section`);
    assert.equal(m.scrollWidth, await scrollWidthWithoutBands(width, [THEME, WIDTH_ONLY]), `${at}: the band changed the page's scroll width`);
    checks += 3;
    await ctx.close();
  }


  for (const width of [1280, 390, 1600, 1920]) {
    const { ctx, pg } = await open(width, [THEME]);
    const m = await measure(pg);
    const at = `@${width}`;
    assert.ok(m.vw < width,`${at}: no classic scrollbar (clientWidth ${m.vw}) — the scrollbar arm is not being measured`);
    for (const kind of ['Prose', 'Grid', 'Timeline']) {
      const band = m[`${kind} band`], twin = m[`${kind} twin`];
      assert.ok(band && twin, `${at}: ${kind} band/twin not rendered — ${JSON.stringify(Object.keys(m))}`);
      assert.ok(band.surface && !twin.surface, `${at}: ${kind}: data-surface is on the wrong section`);
      // The paint reaches both viewport edges. Red before any band rule: the edges are page bg.
      const px = await edgePixels(pg, `${kind} band`);
      sameColour(px.left, PAINT[kind], `${at}: ${kind} band paint does not reach the LEFT viewport edge (y${px.y})`);
      sameColour(px.right, PAINT[kind], `${at}: ${kind} band paint does not reach the RIGHT viewport edge (x${m.vw - 1}, y${px.y})`);
      // Paint only: no positioning, no stacking context, no pseudo-element, the parent not clipped.
      assert.equal(band.position, 'static', `${at}: ${kind} band is no longer position:static`);
      assert.equal(band.isolation, 'auto', `${at}: ${kind} band is a stacking context (isolation ${band.isolation})`);
      assert.equal(band.zIndex, 'auto', `${at}: ${kind} band has a z-index`);
      assert.equal(band.before, 'none', `${at}: ${kind} band grew a ::before`);
      assert.equal(band.parentOverflow, 'visible', `${at}: ${kind} band's parent is clipped (${band.parentOverflow})`);
      // The box did not move: border box and content box are the twin's.
      near(band.x, twin.x, `${at}: ${kind} band's box moved (x)`);
      near(band.w, twin.w, `${at}: ${kind} band's box changed width`);
      near(band.content.x, twin.content.x, `${at}: ${kind} band's content box moved (x)`);
      near(band.content.w, twin.content.w, `${at}: ${kind} band's content box changed width`);
      assert.ok(band.kids.l >= band.content.x - 0.5 && band.kids.r <= band.content.x + band.content.w + 0.5,
        `${at}: ${kind} band's children escape its content box — ${JSON.stringify(band)}`);
      // Control: the twin is still the cage, and nothing of the band reached it.
      const cap = parseFloat(twin.maxWidth);
      assert.ok(Number.isFinite(cap), `${at}: ${kind} twin lost its max-width (${twin.maxWidth})`);
      near(twin.w, Math.min(twin.parent.w, cap), `${at}: ${kind} twin is no longer the cage`);
      near(twin.x - twin.parent.x, (twin.parent.w - twin.w) / 2, `${at}: ${kind} twin is no longer centred`);
      assert.equal(twin.before, 'none', `${at}: ${kind} twin (no surface=) grew a ::before`);
      assert.equal(twin.position, 'static', `${at}: ${kind} twin (no surface=) is no longer position:static`);
      assert.equal(twin.borderImage, 'none', `${at}: ${kind} twin (no surface=) has a border-image`);
      checks += 18;
      console.log(`  ${at} ${kind}: edges rgb(${px.left})…rgb(${px.right}) | box x${band.x.toFixed(1)} w${band.w.toFixed(1)} = twin | content ${band.content.x.toFixed(1)}/${band.content.w.toFixed(1)} = twin ${twin.content.x.toFixed(1)}/${twin.content.w.toFixed(1)}`);
    }
    if (width === 1600) {
      assert.ok(m['Grid twin'].w > m['Prose twin'].w + 1, `${at}: grid and prose caps coincide — the 80rem arm is not being measured`);
      checks += 1;
    }
    const sw0 = await scrollWidthWithoutBands(width, [THEME]);
    assert.equal(m.scrollWidth, sw0, `${at}: the band changed the page's scroll width (${m.scrollWidth} vs ${sw0} with bands off)`);
    checks += 1;
    await ctx.close();
  }

  // tile#200 r2, P3: a translucent --gd-band is painted once — the box is no darker than the band.
  {
    const { ctx, pg } = await open(1280, [THEME]);
    const px = await edgePixels(pg, 'Glass band');
    sameColour(px.left, GLASS, 'glass: the band outside the box is not the surface colour over the page');
    sameColour(px.inside, px.left, 'glass: the colour inside the box differs from the band beside it');
    checks += 2;
    console.log(`  glass: edge rgb(${px.left}) inside rgb(${px.inside})`);
    await ctx.close();
  }
  // tile#200 r2, P2: a table wider than a phone, in a plain section beside the bands, still scrolls
  // the page to its last column (r2's parent clip left it at scrollX 0 with the column off-screen).
  {
    const { ctx, pg } = await open(390, [THEME]);
    const t = await pg.evaluate(() => {
      const last = document.querySelector('table tbody tr').lastElementChild;
      last.scrollIntoView();
      const r = last.getBoundingClientRect(), de = document.documentElement;
      return { left: r.left, right: r.right, vw: de.clientWidth, scrollX, scrollWidth: de.scrollWidth,
        parentOverflow: getComputedStyle(last.closest('section').parentElement).overflow };
    });
    assert.equal(t.parentOverflow, 'visible', `wide table: the bands' parent is clipped (${t.parentOverflow})`);
    assert.ok(t.scrollX > 0 && t.left >= -0.5 && t.right <= t.vw + 0.5,
      `wide table: the last column cannot be scrolled into view — ${JSON.stringify(t)}`);
    checks += 2;
    console.log(`  wide table @390: scrollX ${t.scrollX}, last cell ${t.left.toFixed(1)}…${t.right.toFixed(1)} in ${t.vw}`);
    await ctx.close();
  }
  // tile#200 r2, P2: a theme pulls a band's button row out as a fixed control; with the NEXT band
  // under it, the button is still what a click there hits (r2's isolation trapped its z-index).
  {
    const { ctx, pg } = await open(1280, [THEME,
      '@layer reef.theme { [data-surface] .st-prose-btns { position: fixed; bottom: 0; left: 40%; z-index: 1000; background: white; padding: 10px; } }']);
    await pg.evaluate(() => {
      const s = [...document.querySelectorAll('section h2')].find((e) => e.textContent.trim() === 'Services').closest('section');
      s.scrollIntoView({ block: 'end' }); // its bottom at the viewport's bottom, where the button is
    });
    const a = pg.locator('.st-prose-btns a').first();
    const href = await a.getAttribute('href');
    const under = await pg.evaluate(() => {
      const s = [...document.querySelectorAll('section h2')].find((e) => e.textContent.trim() === 'Services').closest('section');
      const r = document.querySelector('.st-prose-btns a').getBoundingClientRect();
      return document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2).includes(s);
    });
    assert.ok(under, 'fixed button: the next band is not under the button — the arm is not being measured');
    await pg.evaluate(() => document.addEventListener('click', (e) => {
      e.preventDefault(); window.__clicked = e.target.closest('a')?.getAttribute('href') ?? null; }, true));
    const box = await a.boundingBox();
    await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const clicked = await pg.evaluate(() => window.__clicked ?? null);
    assert.equal(clicked, href, 'fixed button: a click at the button hits something else (the next band paints over it)');
    checks += 2;
    console.log(`  fixed button over the next band: click reached ${clicked}`);
    await ctx.close();
  }
  // A theme that paints its tokens with `background` and no --gd-band: the band is a no-op — the
  // box keeps the theme's colour, the viewport edges stay page bg, no border-image computes.
  {
    const { ctx, pg } = await open(1920, [THEME_BG]); // every box capped short of the edges
    const m = await measure(pg);
    for (const kind of ['Prose', 'Grid', 'Timeline']) {
      const px = await edgePixels(pg, `${kind} band`);
      sameColour(px.left, PAGE_BG, `background-only theme: ${kind} band painted past its box`);
      sameColour(px.inside, PAINT[kind], `background-only theme: ${kind} box lost the theme's background`);
      assert.equal(m[`${kind} band`].borderImage, 'none', `background-only theme: ${kind} computes a border-image`);
      checks += 3;
    }
    await ctx.close();
  }

  // reef.theme still wins: turning the band off, and re-caging the box with its own padding.
  {
    const { ctx, pg } = await open(1280, [THEME, BAND_OFF]);
    const px = await edgePixels(pg, 'Prose band');
    sameColour(px.left, PAGE_BG, 'theme control: a reef.theme `border-image: none` did not turn the band off');
    checks += 1;
    await ctx.close();
  }
  {
    const { ctx, pg } = await open(1280, [THEME, '@layer reef.theme { .st-prose, .st-grid, .st-timeline { max-width: 40rem; padding-inline: 20px; } }']);
    const t = await measure(pg);
    for (const kind of ['Prose', 'Grid', 'Timeline']) {
      near(t[`${kind} band`].w, 640, `theme control: a reef.theme max-width did not win on the ${kind} band`);
      near(t[`${kind} band`].content.w, 600, `theme control: a reef.theme padding-inline did not win on the ${kind} band`);
      checks += 2;
    }
    await ctx.close();
  }
  console.log(`surface-band smoke: ok (${checks} checks)`);
} catch (e) { failed = e; } finally {
  await browser.close(); server.close(); rmSync(FIX, { recursive: true, force: true });
}
if (failed) { console.error(failed); process.exit(1); }
