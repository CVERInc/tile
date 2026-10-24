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
// and a theme that capped the section with `max-width` alone collapsed its content to 0px. This
// smoke's theme control used to set padding too, which hid it. Now:
//   · pixels at the left and right edge of the viewport, halfway down the band, are the band's
//     paint — a solid token, and a horizontal gradient whose two ends must land on the two edges
//     (so the copy spans the band rather than being tiled into it) — at 1280, 390, 1600 and 1920;
//   · the band's box and content box are those of an identical section WITHOUT `surface=` on the
//     same page, to the pixel, and its children sit inside;
//   · that twin is still the cage, and has no paint layer or new positioning of its own;
//   · the reviewer's width-only theme (`max-width: 40rem`, nothing else) leaves the band's content
//     box exactly the twin's, never 0, at 1280, 1600 and 1920 (the grid's own collapse width);
//   · the page never scrolls sideways — with real classic scrollbars, so 100vw ≠ the viewport;
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

// The theme paints the tokens, as a real one does (`[data-surface=…] { background }`, theme layer).
// cream is a solid colour; paper is a left→right gradient, so the leftmost band pixel must be its
// first stop and the rightmost its last — a copy sized to the section, or tiled, would not be.
const CREAM = [238, 204, 170], PAPER_L = [20, 110, 200], PAPER_R = [200, 70, 20], PAGE_BG = [255, 255, 255];
const THEME = `@layer reef.theme {
  [data-surface="cream"] { background: rgb(${CREAM}); }
  [data-surface="paper"] { background: linear-gradient(90deg, rgb(${PAPER_L}), rgb(${PAPER_R})); }
}`;
const PAINT = { Prose: [CREAM, CREAM], Grid: [PAPER_L, PAPER_R], Timeline: [CREAM, CREAM] };
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
// halfway down a section. Scrolls the section's middle to the viewport's middle, screenshots the
// viewport, decodes it in the page (no PNG dependency here).
async function edgePixels(pg, heading) {
  const { y, vw } = await pg.evaluate((t) => {
    const h = [...document.querySelectorAll('section h2')].find((e) => e.textContent.trim() === t);
    const s = h.closest('section'), r = s.getBoundingClientRect();
    scrollTo(0, Math.max(0, scrollY + r.top + r.height / 2 - innerHeight / 2));
    const r2 = s.getBoundingClientRect();
    return { y: Math.round(r2.top + r2.height / 2), vw: document.documentElement.clientWidth };
  }, heading);
  const png = (await pg.screenshot()).toString('base64');
  return pg.evaluate(async ({ png, y, vw }) => {
    const img = new Image(); img.src = `data:image/png;base64,${png}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const at = (x) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { left: at(0), right: at(vw - 1), y };
  }, { png, y, vw });
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
    assert.equal(m.scrollWidth, m.vw, `${at}: the page scrolls sideways`);
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
      // The copy is 100vw wide and the clip takes half a scrollbar off each side, so a gradient's
      // visible ends are that fraction in from its stops — computed, not tolerated.
      const px = await edgePixels(pg, `${kind} band`);
      const [L, R] = PAINT[kind], f = (width - m.vw) / 2 / width;
      const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
      sameColour(px.left, mix(L, R, f), `${at}: ${kind} band paint does not reach the LEFT viewport edge (y${px.y})`);
      sameColour(px.right, mix(L, R, 1 - f), `${at}: ${kind} band paint does not reach the RIGHT viewport edge (x${m.vw - 1}, y${px.y})`);
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
      checks += 12;
      console.log(`  ${at} ${kind}: edges rgb(${px.left})…rgb(${px.right}) | box x${band.x.toFixed(1)} w${band.w.toFixed(1)} = twin | content ${band.content.x.toFixed(1)}/${band.content.w.toFixed(1)} = twin ${twin.content.x.toFixed(1)}/${twin.content.w.toFixed(1)}`);
    }
    if (width === 1600) {
      assert.ok(m['Grid twin'].w > m['Prose twin'].w + 1, `${at}: grid and prose caps coincide — the 80rem arm is not being measured`);
      checks += 1;
    }
    assert.equal(m.scrollWidth, m.vw, `${at}: the page scrolls sideways (scrollWidth ${m.scrollWidth} vs clientWidth ${m.vw})`);
    checks += 1;
    await ctx.close();
  }

  // reef.theme still wins: turning the band off, and re-caging the box with its own padding.
  {
    const { ctx, pg } = await open(1280, [THEME, '@layer reef.theme { [data-surface]::before { content: none; } }']);
    const px = await edgePixels(pg, 'Prose band');
    sameColour(px.left, PAGE_BG, 'theme control: a reef.theme `::before { content: none }` did not turn the band off');
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
