#!/usr/bin/env node
// A link followed from inside an open drawer closes the drawer — measured in a real browser at
// phone width, in every engine this Playwright can launch.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/sitetile/real-render/nav-drawer-link.smoke.mjs --tile <checkout> [--engine chromium|webkit] [--keep]
//
// The drawers are pure CSS: a hidden checkbox, revealed by `body:has(#…:checked)`. A link to ANOTHER
// page hid the defect (the document is replaced), but a link to an anchor on the SAME page only
// scrolls, so the checkbox stayed checked and the panel and its dark overlay stayed on screen over
// the section the visitor asked for. header-actions.js now closes every open drawer when a link is
// followed in this tab, and on a back/forward return to the page.
//
// What is measured per case is the visible outcome, not a handler having run: the checkbox, whether
// the overlay paints, whether the panel paints, the scroll position and the URL's hash.
//
// Engines: with no --engine it runs in chromium AND webkit, and names any engine this Playwright
// cannot launch (one Playwright install often carries only one of them). A run where NO engine
// launched fails. Lives beside the real-render matrix because it has the same needs (a built site,
// Playwright, installed renderer deps) and is run from the same gated block in scripts/test.sh.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const TILE = path.resolve(opt('--tile') || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..'));
const ENGINES = opt('--engine') ? [opt('--engine')] : ['chromium', 'webkit'];
const ASTRO = path.join(TILE, 'packages/sitetile/astro');
const FIX = path.join(TILE, 'packages/sitetile/.smoke-nav-drawer-link');
const DIST = path.join(FIX, 'dist');

// The server comes up BEFORE the build: one nav entry is this page's own absolute URL, so the
// build has to know the origin. No cache-control header, so a back/forward cache may keep the page.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (!existsSync(f) || !path.extname(f)) f = existsSync(path.join(f, 'index.html')) ? path.join(f, 'index.html') : f;
  if (!f.startsWith(DIST) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const HOST = `127.0.0.1:${server.address().port}`;
const origin = `http://${HOST}`;

// A sibling of astro/ at the same depth (the config's aliases are relative to its own location).
rmSync(FIX, { recursive: true, force: true });
cpSync(ASTRO, FIX, { recursive: true, filter: (s) => !/[\\/](node_modules|\.astro|dist-[^\\/]+|\.smoke-[^\\/]+)(?:[\\/]|$)/.test(s) });
symlinkSync(path.join(ASTRO, 'node_modules'), path.join(FIX, 'node_modules'), 'dir');
rmSync(path.join(FIX, 'content'), { recursive: true, force: true });
rmSync(path.join(FIX, 'blog'), { recursive: true, force: true });
mkdirSync(path.join(FIX, 'content'), { recursive: true });
mkdirSync(path.join(FIX, 'blog'), { recursive: true });

// Long sections, so an anchor is a real scroll and not a no-op at the top of a short page.
const filler = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of filler text that makes this section tall.`).join('\n\n');
const sections = (n) => Array.from({ length: n }, (_, i) => `## Part ${i + 1}\n%% sitetile: prose %%\n${filler}\n`).join('\n');
writeFileSync(path.join(FIX, 'content/_site.md'), `---\nsitetile-page: _site\ntitle: Drawer link site\nlang: en-US\n---\n`);
// Nav: a hash, a path+hash, this page's absolute URL as a network-path reference (no scheme, so the
// renderer does not add target=_blank), a missing anchor, another page, and the same page as an
// http:// URL — which the renderer DOES give target=_blank. `color-scheme: toggle` puts a button
// (a non-link control) inside the drawer.
writeFileSync(path.join(FIX, 'content/home.md'), `---
sitetile-page: home
title: Drawer link home
lang: en-US
nav-mobile: hamburger
color-scheme: toggle
nav: Hash #s2-part-2 | PathHash /#s3-part-3 | Absolute //${HOST}/#s3-part-3 | Missing #no-such-anchor | Other /other | NewTab ${origin}/#s2-part-2
---

${sections(3)}`);
writeFileSync(path.join(FIX, 'content/other.md'), `---
sitetile-page: other
title: Other page
lang: en-US
nav-mobile: hamburger
nav: Home / | Other /other
---

## Other
%% sitetile: prose %%
The other page.
`);
// The sidebar offcanvas: a header-actions toggle that reuses .st-sidebar as a drawer at ≤48rem. It
// holds links (sidebar-nav) AND a search field + submit button (non-link controls).
writeFileSync(path.join(FIX, 'content/side.md'), `---
sitetile-page: side
title: Sidebar page
lang: en-US
nav-mobile: none
layout: sidebar
sidebar-search: Find
sidebar-nav: Sections: Hash=#s2-part-2 ; Away=/other
header-actions: Panel = bars toggle sidebar drawer:left mobile
---

${sections(3)}`);
execFileSync('npx', ['astro', 'build', '--outDir', DIST], { cwd: FIX, stdio: 'inherit',
  env: { ...process.env, SITE_ID: 'smoke-site', PLATFORM_ORIGIN: 'https://feelreef.com' } });

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const types = { chromium: pw.chromium ?? pw.default?.chromium, webkit: pw.webkit ?? pw.default?.webkit };

// One row of facts about a drawer: the checkbox, whether its overlay and panel paint, the scroll.
const factsOf = (page, { box, overlay, panel }) => page.evaluate(({ box, overlay, panel }) => {
  const shown = (sel) => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.right > 0 && r.left < innerWidth; };
  return { checked: document.getElementById(box).checked, overlay: shown(overlay), panel: shown(panel), scrollY: Math.round(scrollY), hash: location.hash, path: location.pathname };
}, { box, overlay, panel });
const NAV = { box: 'rf-nav-toggle', overlay: '.rf-ha-overlay[data-ha-overlay="nav"]', panel: '#rf-nav', opener: 'label.rf-nav-hamburger' };
const SIDE = { box: 'st-ha-sidebar', overlay: '.rf-ha-overlay[data-ha-overlay="sidebar"]', panel: '.st-sidebar', opener: 'label.rf-ha-btn[for="st-ha-sidebar"]' };
const topOf = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); return e ? Math.round(e.getBoundingClientRect().top) : null; }, id);
// Two frames, then any running CSS transition to its end: the sidebar offcanvas slides out (.28s),
// and a panel measured mid-slide is still on screen.
const settle = async (page) => {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 3000 }).catch(() => {});
};
const sel = (label) => `#rf-nav a.rf-nav-link:text-is("${label}")`;

async function openAt(page, url, d) {
  await page.goto(origin + url, { waitUntil: 'load' });
  await page.click(d.opener);
  await settle(page);
  const f = await factsOf(page, d);
  if (!f.checked || !f.overlay || !f.panel) throw new Error(`could not open the drawer at ${url}: ${JSON.stringify(f)}`);
}

const closed = (f) => !f.checked && !f.overlay && !f.panel;
const open = (f) => f.checked && f.overlay && f.panel;

// Every case: [name, run(page, ctx) → { facts, ok, note }]. `ok` is what this commit pins.
const CASES = [
  ['nav: #hash tap', async (page) => {
    await openAt(page, '/', NAV);
    await page.click(sel('Hash')); await settle(page);
    const f = await factsOf(page, NAV); const top = await topOf(page, 's2-part-2');
    return { f, ok: closed(f) && f.hash === '#s2-part-2' && f.scrollY > 0 && Math.abs(top) < 120, note: `target top ${top}` };
  }],
  ['nav: #hash touch tap (hasTouch context)', async (page) => {
    await page.goto(origin + '/', { waitUntil: 'load' });
    await page.tap(NAV.opener); await settle(page);
    const opened = await factsOf(page, NAV);
    await page.tap(sel('Hash')); await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: open(opened) && closed(f) && f.hash === '#s2-part-2' && f.scrollY > 0 };
  }, { touch: true }],
  ['nav: /#hash tap', async (page) => {
    await openAt(page, '/', NAV);
    await page.click(sel('PathHash')); await settle(page);
    const f = await factsOf(page, NAV); const top = await topOf(page, 's3-part-3');
    return { f, ok: closed(f) && f.hash === '#s3-part-3' && f.scrollY > 0 && Math.abs(top) < 120, note: `target top ${top}` };
  }],
  ['nav: absolute same-page URL tap', async (page) => {
    await openAt(page, '/', NAV);
    const tgt = await page.getAttribute(sel('Absolute'), 'target');
    await page.click(sel('Absolute')); await settle(page);
    const f = await factsOf(page, NAV); const top = await topOf(page, 's3-part-3');
    return { f, ok: tgt === null && closed(f) && f.hash === '#s3-part-3' && Math.abs(top) < 120, note: `target attr ${tgt}; target top ${top}` };
  }],
  ['nav: #missing-anchor tap', async (page) => {
    await openAt(page, '/', NAV);
    await page.click(sel('Missing')); await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: closed(f) && f.hash === '#no-such-anchor' };
  }],
  ['nav: Enter on a focused #hash link', async (page) => {
    await openAt(page, '/', NAV);
    await page.focus(sel('Hash')); await page.keyboard.press('Enter'); await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: closed(f) && f.hash === '#s2-part-2' && f.scrollY > 0 };
  }],
  ['nav: other-page link, then Back', async (page) => {
    await openAt(page, '/', NAV);
    await Promise.all([page.waitForURL('**/other'), page.click(sel('Other'))]);
    const onOther = await factsOf(page, NAV);
    await page.goBack({ waitUntil: 'load' }); await settle(page);
    const f = await factsOf(page, NAV); const persisted = await page.evaluate(() => window.__ndlPersisted === true);
    return { f, ok: !onOther.checked && f.path === '/' && closed(f), note: `restored from bfcache: ${persisted}` };
  }],
  ['nav: drawer open, Back to an earlier #hash', async (page) => {
    await page.goto(origin + '/#s2-part-2', { waitUntil: 'load' });
    await page.goto(origin + '/#s3-part-3'); // a same-document entry to go back FROM
    await page.click(NAV.opener); await settle(page);
    const opened = await factsOf(page, NAV);
    await page.goBack(); await page.waitForFunction(() => location.hash === '#s2-part-2'); await settle(page);
    const f = await factsOf(page, NAV); const top = await topOf(page, 's2-part-2');
    return { f, ok: open(opened) && closed(f), note: `target top ${top}` };
  }],
  ['nav: drawer open, leave by Back, return by Forward', async (page) => {
    await page.goto(origin + '/other', { waitUntil: 'load' });
    await openAt(page, '/', NAV);
    await page.goBack({ waitUntil: 'load' });
    await page.goForward({ waitUntil: 'load' }); await settle(page);
    const f = await factsOf(page, NAV); const persisted = await page.evaluate(() => window.__ndlPersisted === true);
    return { f, ok: closed(f), note: `restored from bfcache: ${persisted}` };
  }],
  // Neither engine Playwright drives here restores a page from the back/forward cache (measured:
  // `persisted` is never true), so the bfcache arm is driven by the event a restore delivers.
  ['nav: pageshow persisted (bfcache restore, synthetic event)', async (page) => {
    await openAt(page, '/', NAV);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: closed(f) };
  }],
  ['nav: pageshow not persisted (stays open)', async (page) => {
    await openAt(page, '/', NAV);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
    await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: open(f) };
  }],
  ['nav: ctrl/cmd-click #hash (stays open)', async (page, ctx) => {
    await openAt(page, '/', NAV);
    const pop = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await page.click(sel('Hash'), { modifiers: ['ControlOrMeta'] }); await settle(page);
    const f = await factsOf(page, NAV); const p = await pop; if (p) await p.close();
    return { f, ok: open(f) && f.hash === '', note: `new tab opened: ${!!p}` };
  }],
  ['nav: target=_blank link (stays open)', async (page, ctx) => {
    await openAt(page, '/', NAV);
    const tgt = await page.getAttribute(sel('NewTab'), 'target');
    const pop = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await page.click(sel('NewTab')); await settle(page);
    const f = await factsOf(page, NAV); const p = await pop; if (p) await p.close();
    return { f, ok: tgt === '_blank' && open(f) && f.hash === '', note: `new tab opened: ${!!p}` };
  }],
  ['nav: link whose click another handler cancelled (stays open)', async (page) => {
    await openAt(page, '/', NAV);
    await page.$eval(sel('Hash'), (a) => a.addEventListener('click', (e) => e.preventDefault()));
    await page.click(sel('Hash')); await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: open(f) && f.hash === '' };
  }],
  ['nav: theme-toggle button (stays open)', async (page) => {
    await openAt(page, '/', NAV);
    await page.click('#rf-theme-toggle'); await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: open(f) };
  }],
  ['nav: Escape still closes', async (page) => {
    await openAt(page, '/', NAV);
    await page.keyboard.press('Escape'); await settle(page);
    const f = await factsOf(page, NAV);
    return { f, ok: closed(f) };
  }],
  ['sidebar: #hash tap', async (page) => {
    await openAt(page, '/side', SIDE);
    await page.click('.st-sidebar-nav a:text-is("Hash")'); await settle(page);
    const f = await factsOf(page, SIDE);
    return { f, ok: closed(f) && f.hash === '#s2-part-2' && f.scrollY > 0 };
  }],
  ['sidebar: search field + submit (stays open)', async (page) => {
    await openAt(page, '/side', SIDE);
    await page.click('.st-sidebar-search input'); await page.keyboard.type('abc');
    await page.click('.st-sidebar-search button'); await settle(page);
    const f = await factsOf(page, SIDE);
    return { f, ok: open(f) };
  }],
];

const rows = [];
let ran = 0;
const unlaunched = [];
try {
  for (const engine of ENGINES) {
    let browser;
    try {
      // Playwright's Chromium switches its back/forward cache off by default; the bfcache rows need it.
      browser = await types[engine].launch(engine === 'chromium' ? { ignoreDefaultArgs: ['--disable-back-forward-cache'] } : {});
    } catch (e) { unlaunched.push(`${engine} (${String(e.message).split('\n')[0]})`); continue; }
    ran++;
    try {
      for (const [name, run, o = {}] of CASES) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: !!o.touch });
        await ctx.addInitScript(() => { addEventListener('pageshow', (e) => { window.__ndlPersisted = e.persisted; }); });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e.message || e)));
        let r;
        try { r = await run(page, ctx); } catch (e) { r = { f: null, ok: false, note: 'threw: ' + String(e.message).split('\n')[0] }; }
        if (errors.length) { r.ok = false; r.note = (r.note ? r.note + '; ' : '') + 'page errors: ' + errors.join(' | '); }
        rows.push({ engine, name, ...r });
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
} finally {
  server.close();
  if (!argv.includes('--keep')) rmSync(FIX, { recursive: true, force: true });
}

for (const r of rows) {
  const f = r.f ? `checked=${r.f.checked} overlay=${r.f.overlay} panel=${r.f.panel} scrollY=${r.f.scrollY} hash=${r.f.hash || '""'}` : '';
  console.log(`${r.ok ? '✓' : '✗'} [${r.engine}] ${r.name} — ${f}${r.note ? ' — ' + r.note : ''}`);
}
for (const u of unlaunched) console.log(`· NOT RUN in ${u}`);
const bad = rows.filter((r) => !r.ok);
if (!ran) { console.error('nav-drawer-link smoke: no engine launched'); process.exit(1); }
if (bad.length) { console.error(`nav-drawer-link smoke: ${bad.length} case(s) failed`); process.exit(1); }
console.log(`nav-drawer-link smoke: ok (${ENGINES.filter((e) => !unlaunched.some((u) => u.startsWith(e))).join(', ')})`);
