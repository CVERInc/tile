#!/usr/bin/env node
// `surface=` sections are BANDS (reef#1869, ruled 2026-10-20) — measured in a real browser.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/sitetile/real-render/surface-band.smoke.mjs --tile <checkout>
//
// 🩸 prose / grid / timeline emit `data-surface` for the theme to paint, and base still caged the
// section at its width twice over (`.st-prose, .st-grid, …` at (0,1,0) plus the `:where()` floor), so
// a painted surface was a box in the middle of the page. The assertions are the visible outcome:
//   · the band spans the viewport, at 1280, 390 and 1600 (1600 is where the grid's own 80rem cap and
//     --gd-maxw part ways; at 1280 they are both the viewport for a grid);
//   · its content box is the content box of an identical section WITHOUT `surface=` on the same
//     page, to the pixel — and every child of the band sits inside it;
//   · that twin is still the cage (width = min(container, cap), centred), so the rule reaches
//     nothing it should not;
//   · a reef.theme rule at (0,1,0) still overrides the (0,2,1) base rule — the layer, not the
//     specificity, decides.
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
  ['Timeline band', 'timeline surface=paper', TIMELINE], ['Timeline twin', 'timeline', TIMELINE],
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

// Every section, keyed by its heading: the border box, the content box (border box minus padding),
// the union of its children, and the box it sits in.
const measure = (pg) => pg.evaluate(() => {
  const out = { vw: document.documentElement.clientWidth, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  for (const s of document.querySelectorAll('section[class^="st-"]')) {
    const h = s.querySelector(':scope > h1, :scope > h2');
    if (!h) continue;
    const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    const kids = [...s.children].map((c) => c.getBoundingClientRect()).filter((k) => k.width > 0);
    const p = s.parentElement.getBoundingClientRect(), ps = getComputedStyle(s.parentElement);
    out[h.textContent.trim()] = {
      x: r.left, w: r.width, surface: s.getAttribute('data-surface'), maxWidth: cs.maxWidth,
      content: { x: r.left + pl, w: r.width - pl - pr },
      kids: { l: Math.min(...kids.map((k) => k.left)), r: Math.max(...kids.map((k) => k.right)) },
      parent: { x: p.left + parseFloat(ps.paddingLeft), w: p.width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) },
    };
  }
  return out;
});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.5, `${msg}: ${a} vs ${b}`);

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch();
let failed = null;
let checks = 0;
try {
  for (const width of [1280, 390, 1600]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(origin + '/', { waitUntil: 'load' });
    const m = await measure(pg);
    const at = `@${width}`;
    for (const kind of ['Prose', 'Grid', 'Timeline']) {
      const band = m[`${kind} band`], twin = m[`${kind} twin`];
      assert.ok(band && twin, `${at}: ${kind} band/twin not rendered — ${JSON.stringify(Object.keys(m))}`);
      assert.ok(band.surface && !twin.surface, `${at}: ${kind}: data-surface is on the wrong section`);
      // Red before the fix: the band was the cage, i.e. exactly as wide as its twin.
      near(band.x, 0, `${at}: ${kind} band does not start at the viewport edge (x)`);
      near(band.w, m.vw, `${at}: ${kind} band is not viewport-wide (w)`);
      near(band.content.x, twin.content.x, `${at}: ${kind} band's content box moved (x)`);
      near(band.content.w, twin.content.w, `${at}: ${kind} band's content box changed width`);
      assert.ok(band.kids.l >= band.content.x - 0.5 && band.kids.r <= band.content.x + band.content.w + 0.5,
        `${at}: ${kind} band's children escape its content box — ${JSON.stringify(band)}`);
      // Control: the twin is still the cage — capped, centred in its container.
      const cap = parseFloat(twin.maxWidth);
      assert.ok(Number.isFinite(cap), `${at}: ${kind} twin lost its max-width (${twin.maxWidth})`);
      near(twin.w, Math.min(twin.parent.w, cap), `${at}: ${kind} twin is no longer the cage`);
      near(twin.x - twin.parent.x, (twin.parent.w - twin.w) / 2, `${at}: ${kind} twin is no longer centred`);
      checks += 8;
      console.log(`  ${at} ${kind}: band x${band.x} w${band.w}, content ${band.content.x.toFixed(1)}/${band.content.w.toFixed(1)} = twin ${twin.content.x.toFixed(1)}/${twin.content.w.toFixed(1)} (twin w${twin.w})`);
    }
    // At 1600 the grid's own 80rem cap and --gd-maxw are different numbers; a rule that used one
    // cap for every section would move the grid's content here and nowhere else.
    if (width === 1600) {
      assert.ok(m['Grid twin'].w > m['Prose twin'].w + 1, `${at}: grid and prose caps coincide — the 80rem arm is not being measured`);
      checks += 1;
    }
    assert.ok(m.sideways <= 0, `${at}: the page scrolls sideways by ${m.sideways}px`);
    checks += 1;
    await ctx.close();
  }

  // Control: a reef.theme rule at (0,1,0) beats the (0,2,1)/(0,3,1) base rule — the layer decides.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  await pg.goto(origin + '/', { waitUntil: 'load' });
  await pg.addStyleTag({ content: '@layer reef.theme { .st-prose, .st-grid, .st-timeline { max-width: 40rem; padding-inline: 20px; } }' });
  const t = await measure(pg);
  for (const kind of ['Prose', 'Grid', 'Timeline']) {
    const band = t[`${kind} band`];
    near(band.w, 640, `theme control: a reef.theme max-width did not win on the ${kind} band`);
    near(band.content.w, 600, `theme control: a reef.theme padding-inline did not win on the ${kind} band`);
    checks += 2;
  }
  await ctx.close();
  console.log(`surface-band smoke: ok (${checks} checks)`);
} catch (e) { failed = e; } finally {
  await browser.close(); server.close(); rmSync(FIX, { recursive: true, force: true });
}
if (failed) { console.error(failed); process.exit(1); }
