#!/usr/bin/env node
// search overlay vs the nav-mobile drawer — measured in a real browser at phone width.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/sitetile/real-render/search-drawer.smoke.mjs --tile <checkout>
//
// The header's magnifier lives INSIDE the hamburger drawer on a nav-mobile site. The drawer's
// header is z-indexed above the search overlay, so a search opened from inside the drawer used to
// appear UNDER the still-open drawer. The assertion is the visible outcome, not a z-index value:
// the point at the centre of the overlay's input must hit the input, and the drawer checkbox must
// be unchecked. Lives beside the real-render matrix because it has the same needs (a built site,
// Playwright, installed renderer deps) and is run from the same gated block in scripts/test.sh.
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
const FIX = path.join(TILE, 'packages/sitetile/.smoke-search-drawer');
const DIST = path.join(FIX, 'dist');

// A sibling of astro/ at the same depth (the config's aliases are relative to its own location).
rmSync(FIX, { recursive: true, force: true });
cpSync(ASTRO, FIX, { recursive: true, filter: (s) => !/[\\/](node_modules|\.astro|dist-[^\\/]+|\.smoke-[^\\/]+)(?:[\\/]|$)/.test(s) });
symlinkSync(path.join(ASTRO, 'node_modules'), path.join(FIX, 'node_modules'), 'dir');
rmSync(path.join(FIX, 'content'), { recursive: true, force: true });
rmSync(path.join(FIX, 'blog'), { recursive: true, force: true });
mkdirSync(path.join(FIX, 'content'), { recursive: true });
mkdirSync(path.join(FIX, 'blog'), { recursive: true });
writeFileSync(path.join(FIX, 'content/_site.md'), `---
sitetile-page: _site
title: Drawer search site
lang: en-US
blog-search: true
blog-search-count-label: 件
blog-search-close: Dismiss
---
`);
writeFileSync(path.join(FIX, 'content/home.md'), `---
sitetile-page: home
title: Drawer search home
lang: en-US
nav-mobile: hamburger
packages: blog
blog-search: true
blog-search-count-label: 件
blog-search-close: Dismiss
nav: |
  Home=/ | About=/about
---

## Home
%% sitetile: prose %%
Home page body.
`);
writeFileSync(path.join(FIX, 'blog/first.md'), `---\ntitle: First post\npubDate: 2026-01-01\n---\n\nBody.\n`);
execFileSync('npx', ['astro', 'build', '--outDir', DIST], { cwd: FIX, stdio: 'inherit',
  env: { ...process.env, SITE_ID: 'smoke-site', PLATFORM_ORIGIN: 'https://feelreef.com' } });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (!existsSync(f) || !path.extname(f)) f = existsSync(path.join(f, 'index.html')) ? path.join(f, 'index.html') : f;
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const pw = await import(process.env.PLAYWRIGHT || 'playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const browser = await chromium.launch();
let failed = null;
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.click('label.rf-nav-hamburger');
  assert.equal(await page.$eval('#rf-nav-toggle', (e) => e.checked), true, 'hamburger opens the drawer');
  await page.click('[data-search-toggle]');
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-search-open'));
  const facts = await page.evaluate(() => {
    const input = document.querySelector('[data-search-input]');
    const r = input.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      drawerChecked: document.getElementById('rf-nav-toggle').checked,
      hitIsInput: !!hit && (hit === input || input.contains(hit)),
      hit: hit && (hit.tagName + '.' + hit.className),
      closeLabel: document.querySelector('button.st-search-close').getAttribute('aria-label'),
    };
  });
  assert.equal(facts.drawerChecked, false, 'opening search closes the nav drawer');
  assert.equal(facts.hitIsInput, true, `the search input is what sits at its own centre (got ${facts.hit})`);
  assert.equal(facts.closeLabel, 'Dismiss', 'the close button label is the localizable one');
  await page.fill('[data-search-input]', 'first');
  await page.waitForSelector('[data-search-count]:not([hidden])');
  const count = await page.$eval('[data-search-count]', (e) => getComputedStyle(e, '::before').content);
  assert.equal(count, '"1件"', 'a CJK count label hugs the number');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('search-drawer smoke: ok');
} catch (e) { failed = e; } finally {
  await browser.close(); server.close(); rmSync(FIX, { recursive: true, force: true });
}
if (failed) { console.error(failed); process.exit(1); }
