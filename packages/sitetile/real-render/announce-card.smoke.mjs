#!/usr/bin/env node
// the announce card (reef#2301) at phone width, with a pasted checkout URL — measured in a real browser.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.js \
//     node packages/sitetile/real-render/announce-card.smoke.mjs --tile <checkout>
//
// 🩸 A pasted URL is one unbroken token. The card's text track was a plain `1fr`, which keeps its
// min-content (the whole URL) as its floor, so at 320 × 568 the text ran to x≈695 inside a card that
// ends at x≈248 and the × sat at x≈707–732: off-screen, so the one control that dismisses the card
// could not be reached. The assertion is the visible outcome, not a grid value: the ×'s rect lies
// inside the viewport AND inside the card, the text stays inside the card, and the point at the ×'s
// centre is the × (nothing painted over it). It also presses the × in the browser — the runtime is
// what unhides it, so a page that lost its module fails here on `hidden`, not on geometry.
// Lives beside search-drawer.smoke.mjs for the same reasons (a built site, Playwright, the
// renderer's deps) and runs from the same gated block in scripts/test.sh.
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
const FIX = path.join(TILE, 'packages/sitetile/.smoke-announce-card');
const DIST = path.join(FIX, 'dist');

// The review's own input: one token, longer than any phone is wide.
const LONG = 'https://tickets.example/checkout/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
title: Announce card site
lang: en-US
---
`);
const page = (name, fm) => writeFileSync(path.join(FIX, `content/${name}.md`),
  `---\nsitetile-page: ${name}\ntitle: ${name}\nlang: en-US\n${fm}\n---\n\n## ${name}\n%% sitetile: prose %%\nBody of ${name}.\n`);
page('home', `announce: ${LONG}\nannounce-href: /linked/\nannounce-until: 2099-12-01T23:59:00+09:00`);
page('plain', `announce: ${LONG}\nannounce-until: 2099-12-01T23:59:00+09:00`);
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
  // Both card shapes (text as a link, text as a span), at the review's width and one a little wider.
  for (const [route, viewport] of [['/', { width: 320, height: 568 }], ['/plain/', { width: 320, height: 568 }], ['/', { width: 375, height: 667 }]]) {
    const where = `${route} @ ${viewport.width}×${viewport.height}`;
    const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on('pageerror', (e) => errors.push(String(e.message || e)));
    await pg.goto(origin + route, { waitUntil: 'load' });
    // The module unhides the × — wait for it, so a page without the runtime fails by name.
    await pg.waitForSelector('.rf-announce-card .rf-announce-x:not([hidden])', { timeout: 5000 })
      .catch(() => { throw new Error(`${where}: the × never became visible — the card's module did not run`); });
    const f = await pg.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const card = document.querySelector('.rf-announce-card');
      const x = card.querySelector('.rf-announce-x');
      const xr = x.getBoundingClientRect();
      const hit = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
      return {
        vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
        card: box(card), x: box(x), text: box(card.querySelector('.rf-announce-t')),
        cd: box(card.querySelector('.rf-announce-cd')),
        cdText: card.querySelector('.rf-announce-cd').textContent,
        hitIsX: !!hit && (hit === x || x.contains(hit)), hit: hit && (hit.tagName + '.' + hit.className),
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const inside = (a, b, slack = 0.5) => a.l >= b.l - slack && a.r <= b.r + slack && a.t >= b.t - slack && a.b <= b.b + slack;
    const vp = { l: 0, t: 0, r: f.vw, b: f.vh };
    const show = JSON.stringify(f);
    assert.ok(inside(f.x, vp), `${where}: the × is outside the viewport — ${show}`);
    assert.ok(inside(f.x, f.card), `${where}: the × is outside the card — ${show}`);
    assert.ok(inside(f.text, f.card), `${where}: the announcement text runs outside the card — ${show}`);
    assert.ok(inside(f.card, vp), `${where}: the card is outside the viewport — ${show}`);
    assert.equal(f.hitIsX, true, `${where}: the × is not what sits at its own centre (got ${f.hit})`);
    assert.ok(f.docOverflow <= 0, `${where}: the page scrolls sideways by ${f.docOverflow}px`);
    assert.match(f.cdText, /^Ends in /, `${where}: the countdown was not filled — ${show}`);
    // …and it works: the × takes the card down, and a reload remembers it.
    await pg.click('.rf-announce-x');
    assert.equal(await pg.locator('.rf-announce-card').count(), 0, `${where}: pressing × left the card up`);
    await pg.reload({ waitUntil: 'load' });
    assert.equal(await pg.locator('.rf-announce-card').count(), 0, `${where}: a dismissed card came back on reload`);
    assert.deepEqual(errors, [], `${where}: page errors`);
    await ctx.close();
  }
  console.log('announce-card smoke: ok');
} catch (e) { failed = e; } finally {
  await browser.close(); server.close(); rmSync(FIX, { recursive: true, force: true });
}
if (failed) { console.error(failed); process.exit(1); }
