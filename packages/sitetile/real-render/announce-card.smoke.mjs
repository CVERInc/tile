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
// 🩸 Round two: the element's BOX stayed inside the card even with the wrapping rules reverted (the
// glyphs painted through to x≈695 past a box ending at x≈204), so the text is measured as a Range
// over its glyphs. And a TALL text (1,056 chars) grew the bottom-anchored card upward to y≈−260 and
// took the × with it, so the tall and 1,000-char cases run upright and sideways, and the text must
// scroll to its last line inside the card.
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
// The confirm review's TALL input: the same URL with 64 hex blocks (1,056 chars) — it wraps to more
// lines than a phone is tall. set_theme caps a theme value at 500 chars, but `_site.md` frontmatter
// can be written directly, so the engine must hold ANY length. And a 1,000-char text of ordinary words.
const TALL = 'https://tickets.example/checkout/' + '0123456789abcdef'.repeat(64);
const WORDS = ('Doors open at seven, the last train home leaves at midnight, bring a coat. '.repeat(14)).slice(0, 1000).trim();

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
page('tall', `announce: ${TALL}\nannounce-until: 2099-12-01T23:59:00+09:00`);
page('words', `announce: ${WORDS}\nannounce-href: /linked/\nannounce-until: 2099-12-01T23:59:00+09:00`);
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
  // Both card shapes (text as a link, text as a span), at the review's width and one a little wider;
  // then the tall texts, upright and on a phone turned sideways (the shortest viewport there is).
  const P = { width: 320, height: 568 }, L = { width: 568, height: 320 };
  for (const [route, viewport] of [['/', P], ['/plain/', P], ['/', { width: 375, height: 667 }],
    ['/tall/', P], ['/tall/', L], ['/words/', P], ['/words/', L]]) {
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
      // The TEXT, not the element's box (confirm review P3): a Range over the glyphs paints where they
      // are, so an unwrapped token that overflows its own box is caught here. Every line box must sit
      // inside the text element's left/right edges.
      const t = card.querySelector('.rf-announce-t');
      const tb = box(t);
      const range = document.createRange(); range.selectNodeContents(t);
      const lines = [...range.getClientRects()].filter((r) => r.width > 0);
      const linesOutside = lines.filter((r) => r.left < tb.l - 0.5 || r.right > tb.r + 0.5).length;
      // Fully readable: when the text is taller than its box it must scroll, and scrolled to the end
      // its last line must land inside the box (and the box inside the card).
      const oy = getComputedStyle(t).overflowY;
      const scrolls = t.scrollHeight > t.clientHeight + 1;
      t.scrollTop = t.scrollHeight;
      const last = [...range.getClientRects()].filter((r) => r.width > 0).pop();
      const lastVisible = !!last && last.top >= tb.t - 0.5 && last.bottom <= tb.b + 0.5;
      t.scrollTop = 0;
      return {
        lines: lines.length, linesOutside, sideways: t.scrollWidth - t.clientWidth, oy, scrolls, lastVisible,
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
    assert.equal(f.linesOutside, 0, `${where}: the announcement's text paints outside its own box (it did not wrap) — ${show}`);
    assert.ok(f.sideways <= 0, `${where}: the announcement text overflows its box sideways by ${f.sideways}px — ${show}`);
    if (f.scrolls) assert.match(f.oy, /^(auto|scroll)$/, `${where}: the text is taller than its box but cannot scroll — ${show}`);
    assert.equal(f.lastVisible, true, `${where}: the end of the announcement cannot be brought into view — ${show}`);
    assert.ok(inside(f.card, vp), `${where}: the card is outside the viewport — ${show}`);
    assert.equal(f.hitIsX, true, `${where}: the × is not what sits at its own centre (got ${f.hit})`);
    assert.ok(f.docOverflow <= 0, `${where}: the page scrolls sideways by ${f.docOverflow}px`);
    assert.match(f.cdText, /^Ends in /, `${where}: the countdown was not filled — ${show}`);
    console.log(`  ${where}: card y ${f.card.t.toFixed(1)}…${f.card.b.toFixed(1)}, × y ${f.x.t.toFixed(1)}…${f.x.b.toFixed(1)}, ${f.lines} line(s)${f.scrolls ? ', text scrolls' : ''}`);
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
