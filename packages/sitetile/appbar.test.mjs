// reef#2790 — the installed-app bottom bar, on what a real build WROTE.
//   run: node packages/sitetile/appbar.test.mjs   (globbed into scripts/test.sh)
//
//   1. A `packages: pwa` site with a `nav:` carries the bar: the corner dock's own element
//      (`dc-dock[name="bar"]`), written `hidden`, holding one tab per first-level nav item — a group
//      as a list, the current page marked — BEFORE the inbox mount, plus the style and the switch.
//   2. The header still holds the full nav: in a browser nothing moved. (The move itself happens in
//      an installed app, in the browser — packages/dynamic-corals/dock/dock.smoke.mjs drives it.)
//   3. The same site WITHOUT `packages: pwa` (it cannot be installed) gains nothing: no bar, no
//      style, no switch. (That such a site's pages are byte-identical to the engine before this
//      change is measured by building the same fixtures with both engines — see the PR.)
//   4. With the inbox on, the bar reserves its entry (`data-reserve="1"`, no tab jump when it
//      arrives) and the loader names the coral the bar needs (`/*inbox-bubble>=0.8.0*/`, the
//      rollback marker); the switch is an inline <head> snippet (no header flash) keyed on site.css's
//      hamburger breakpoint (the test reads site.css, so the two cannot drift); a nav item without a
//      safe destination gets no tab.
//   5. The bar is a navigation landmark with a name in the page's language, and the header gives up
//      its nav only while the bar is SHOWN (`:has(dc-dock[name="bar"]:not([hidden]))`), never on the
//      switch alone — so a page whose appbar.js never runs keeps its header nav (cold review S3, N1).
//
// It needs the renderer's dependencies and SAYS SO when they are absent — same shape as
// site-embed.test.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RENDERER_SUBPATH } from '../build/index.mjs';
import { isCurrent, flatten, moreLabel, navLabel, APPBAR_CSS, APPBAR_MEDIA, APPBAR_HEAD_SCRIPT, APPBAR_CORAL_FLOOR } from './astro/src/lib/appbar.mjs';
import { CORAL_FLOOR } from './astro/src/lib/inbox-bubble-loader.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

await test('the current-page rule: same-site paths, trailing slash and query ignored, never another site', () => {
  assert.equal(isCurrent('/shop', '/shop/'), true);
  assert.equal(isCurrent('/shop/?a=1#x', '/shop'), true);
  assert.equal(isCurrent('/', '/'), true);
  assert.equal(isCurrent('/shop', '/shop/item'), false);
  assert.equal(isCurrent('https://example.com/shop', '/shop'), false);
  assert.equal(isCurrent('//example.com/shop', '/shop'), false);
  assert.deepEqual(['en-US', 'zh-TW', 'zh-Hant', 'ja-JP', 'ko', 'de-DE', ''].map(moreLabel), ['More', '更多', '更多', 'その他', '더보기', 'More', 'More']);
  assert.deepEqual(flatten({ children: [{ label: 'a', children: [{ label: 'b' }] }, { label: 'c' }] }).map((n) => n.label), ['a', 'b', 'c']);
  assert.deepEqual(['en-US', 'zh-TW', 'ja-JP', 'ko-KR', 'de'].map(navLabel), ['Main', '主要', 'メイン', '주요', 'Main']);
});

await test('🔴 the header gives up its nav only while the bar is shown — never on the switch alone (cold review S3)', () => {
  // Every rule that reaches outside the bar itself (the header, <body>) must wait for the bar to show.
  const selectors = APPBAR_CSS.split('}').map((r) => r.trim()).filter(Boolean)
    .flatMap((r) => r.slice(0, r.indexOf('{')).split(/,(?![^(]*\))/).map((x) => x.trim()))
    .filter((sel) => !sel.startsWith('dc-dock[name="bar"]'));
  assert.ok(selectors.length >= 5, APPBAR_CSS);
  for (const sel of selectors) {
    assert.ok(sel.startsWith('html[data-dc-dock-bar]:has(dc-dock[name="bar"]:not([hidden])) '), `keyed on the switch alone: ${sel}`);
  }
});

/**
 * Every `@media` block of site.css that carries the hamburger's rules (any rule keyed on
 * `body[data-nav-mobile]` or naming `.rf-nav-hamburger`), as its query text. Comments are
 * stripped first: site.css's prose quotes `@media (max-width: 64rem)` too, and a comment must neither
 * satisfy nor break this check.
 */
const hamburgerQueries = (css) => {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (let i = src.indexOf('@media'); i !== -1; i = src.indexOf('@media', i + 1)) {
    const open = src.indexOf('{', i);
    let depth = 1, j = open + 1;
    for (; depth && j < src.length; j++) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
    const body = src.slice(open + 1, j - 1);
    if (/body\[data-nav-mobile|\.rf-nav-hamburger/.test(body)) {
      out.push(src.slice(i + '@media'.length, open).trim().replace(/\s+/g, ' '));
    }
  }
  return out;
};

await test('🔴 the switch\'s query IS site.css\'s hamburger query — the two cannot drift (owner ruling: where the hamburger would appear, the bar)', () => {
  const css = readFileSync(new URL('./astro/src/styles/site.css', import.meta.url), 'utf8');
  const queries = hamburgerQueries(css);
  // Two blocks today: reef.base (the header's styling) and reef.responsive (the open/closed display).
  assert.ok(queries.length >= 2, `site.css: found ${queries.length} @media block(s) with hamburger rules — the parser no longer sees them`);
  for (const q of queries) assert.equal(q, APPBAR_MEDIA, 'site.css folds the header into the hamburger at a different query than the appbar switch');
});

await test('the switch, by viewport width: on only in an installed app at or under the hamburger breakpoint (1024px in, 1032px out)', () => {
  // matchMedia for `(max-width: <n>rem)` the way a browser answers it: rem in a media query is the
  // initial 16px, whatever the page's own root font size; the bound is inclusive.
  const m = /^\(max-width: ([\d.]+)rem\)$/.exec(APPBAR_MEDIA);
  assert.ok(m, `APPBAR_MEDIA is not a max-width rem query: ${APPBAR_MEDIA}`);
  const run = ({ width, standalone = false, iosStandalone = false }) => {
    const attrs = new Set();
    const window = { matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' ? standalone : q === APPBAR_MEDIA ? width <= Number(m[1]) * 16 : false }) };
    new Function('window', 'navigator', 'document', APPBAR_HEAD_SCRIPT)(window, { standalone: iosStandalone }, { documentElement: { setAttribute: (k) => attrs.add(k) } });
    return attrs.has('data-dc-dock-bar');
  };
  const table = [
    [{ width: 390, standalone: true }, true],
    [{ width: 1024, standalone: true }, true],
    [{ width: 1024, iosStandalone: true }, true],
    [{ width: 1032, standalone: true }, false],
    [{ width: 1280, standalone: true }, false],
    [{ width: 390 }, false],
    [{ width: 1024 }, false],
  ];
  for (const [input, want] of table) assert.equal(run(input), want, JSON.stringify(input));
  assert.equal(APPBAR_CORAL_FLOOR, '0.8.0');
});

const NAV = 'nav: |\n  - Home /\n  - Comics /comics\n    - Latest /comics/latest\n    - Archive /comics/archive\n  - Shop /shop\n  - About /about\n  - Language /language\n  - Contact /contact\n  - Nowhere javascript:alert(1)';
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: hero %%\n\nA fixture page.\n`;
const pages = {
  'home.md': page('sitetile-page: home\ntitle: Paper Comics\nlang: en', 'Comics'),
  'shop.md': page('sitetile-page: shop\ntitle: Shop\nlang: en', 'Shop'),
};
const SITES = {
  pwa: { '_site.md': `---\nbrand: Paper Comics\npackages: pwa\n${NAV}\n---\n`, ...pages },
  plain: { '_site.md': `---\nbrand: Paper Comics\n${NAV}\n---\n`, ...pages },
};

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · appbar END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-appbar-'));
  const walk = (d) => (existsSync(d) ? readdirSync(d) : []).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const buildOne = (name, files, extra = []) => {
    const irDir = join(work, name, 'ir');
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(irDir, rel)), { recursive: true });
      writeFileSync(join(irDir, rel), body);
    }
    const outDir = join(work, name, 'out');
    const r = spawnSync(process.execPath, [join(ENGINE, 'packages/build/cli.mjs'), irDir, outDir, '--site-url', 'https://example.com', '--engine', ENGINE, ...extra], { encoding: 'utf8' });
    const log = `${r.stdout || ''}\n${r.stderr || ''}`;
    const html = Object.fromEntries(walk(outDir).filter((p) => p.endsWith('.html')).map((p) => [relative(outDir, p), readFileSync(p, 'utf8')]));
    return { code: r.status, log, html };
  };
  try {
    // `pwa` without a site id (no inbox); `inbox` the same site with one; `plain` without pwa, with one.
    const built = { pwa: buildOne('pwa', SITES.pwa), inbox: buildOne('inbox', SITES.pwa, ['--site-id', 'appbar-test']), plain: buildOne('plain', SITES.plain, ['--site-id', 'appbar-test']) };
    for (const [name, b] of Object.entries(built)) assert.equal(b.code, 0, `astro build failed for ${name}:\n${b.log.slice(-1200)}`);
    const shop = built.pwa.html['shop/index.html'];
    const bar = (h) => (/<dc-dock name="bar"[^>]*>[\s\S]*?<\/dc-dock>/.exec(h) || [''])[0];

    await test('🔴 a pwa site with a nav carries the bar, hidden, with one tab per first-level item', () => {
      assert.ok(shop, `no shop page: ${Object.keys(built.pwa.html).join(', ')}`);
      const b = bar(shop);
      assert.ok(b, 'no dc-dock[name="bar"] on a pwa page with a nav');
      assert.match(b, /^<dc-dock name="bar" role="navigation" aria-label="Main" data-st-appbar(?:="")? data-more-label="More" hidden(?:="")?>/);
      const tabs = [...b.matchAll(/<(?:a|span|div) class="rf-tab(?: rf-tab-group)?"/g)];
      assert.equal(tabs.length, 6, 'one tab per first-level nav item with a safe destination');
      assert.equal(/<span class="rf-tab"|Nowhere/.test(b), false, 'a nav item without a safe destination became a dead tab');
      assert.match(b, /<div class="rf-tab rf-tab-group">\s*<details><summary>Comics<\/summary><div class="rf-tab-list">\s*<a href="\/comics">Comics<\/a><a href="\/comics\/latest">Latest<\/a><a href="\/comics\/archive">Archive<\/a>\s*<\/div><\/details>\s*<\/div>/,
        'a nav item with children is a list (its own link first, then every child)');
      assert.match(b, /<a class="rf-tab" href="\/language">Language<\/a>/, 'the language switch moves with the nav');
    });

    await test('🔴 the current page\'s tab is marked, and only that one', () => {
      assert.equal((bar(shop).match(/aria-current="page"/g) || []).length, 1);
      assert.match(bar(shop), /<a class="rf-tab" href="\/shop" aria-current="page">Shop<\/a>/);
      assert.match(bar(built.pwa.html['index.html']), /<a class="rf-tab" href="\/" aria-current="page">Home<\/a>/);
    });

    await test('the bar comes before the inbox mount, and the style and the switch ride with it', () => {
      const at = shop.indexOf('<dc-dock name="bar"');
      const inbox = shop.indexOf('data-dynamic-coral="inbox-bubble"');
      if (inbox >= 0) assert.ok(at < inbox, 'the bar is written after the inbox mount — the nav would follow the tools');
      assert.match(shop, /html\[data-dc-dock-bar\]:has\(dc-dock\[name="bar"\]:not\(\[hidden\]\)\) \.rf-nav > :is\(\.rf-nav-link,\.rf-nav-group\)/);
      const head = shop.slice(0, shop.indexOf('</head>'));
      assert.ok(head.includes(`<script>${APPBAR_HEAD_SCRIPT}</script>`), 'the switch is not an inline <head> snippet (the header would flash)');
      const scripts = [...shop.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>|<script\b[^>]*>([\s\S]*?)<\/script>/g)];
      const outDir = join(work, 'pwa', 'out');
      assert.ok(scripts.some(([, src, body]) => (src ? readFileSync(join(outDir, src.replace(/^\//, '')), 'utf8') : body || '').includes('data-st-appbar')),
        'no script on the page switches the bar on');
    });

    await test('🔴 in a browser nothing moved: the header still holds the whole nav', () => {
      const header = /<header class="rf-header[\s\S]*?<\/header>/.exec(shop)[0];
      for (const l of ['Home', 'Comics', 'Latest', 'Shop', 'About', 'Language', 'Contact']) assert.match(header, new RegExp(`>${l}<`), `${l} left the header`);
      assert.match(header, /rf-nav-hamburger/);
    });

    await test('🔴 with the inbox on: the bar reserves its entry, and the loader names the coral the bar needs', () => {
      const page = built.inbox.html['shop/index.html'];
      assert.ok(page && page.includes('data-dynamic-coral="inbox-bubble"'), 'the inbox fixture has no inbox mount');
      assert.match(bar(page), /^<dc-dock name="bar" role="navigation" aria-label="Main" data-st-appbar(?:="")? data-more-label="More" data-reserve="1" hidden(?:="")?>/);
      assert.equal(bar(shop).includes('data-reserve'), false, 'a site without the inbox reserved an entry for it');
      assert.ok(page.indexOf('<dc-dock name="bar"') < page.indexOf('data-dynamic-coral="inbox-bubble"'));
      assert.ok(page.includes(`/*inbox-bubble>=${APPBAR_CORAL_FLOOR}*/(function bubbleLoader(`), 'an appbar page does not carry the >=0.8.0 rollback marker');
      assert.equal(page.includes(`/*inbox-bubble>=${CORAL_FLOOR}*/`), false);
      const plain = built.plain.html['shop/index.html'];
      assert.ok(plain.includes(`/*inbox-bubble>=${CORAL_FLOOR}*/(function bubbleLoader(`), 'a page without the bar lost its own floor');
    });

    await test('🔴 a site that cannot be installed gains nothing: no bar, no style, no switch', () => {
      assert.deepEqual(Object.keys(built.plain.html).sort(), Object.keys(built.pwa.html).sort());
      for (const [rel, h] of Object.entries(built.plain.html)) {
        assert.equal(h.includes('dc-dock'), false, `${rel}: a non-pwa page carries the bar`);
        assert.equal(h.includes('data-st-appbar') || h.includes('data-dc-dock-bar'), false, `${rel}: a non-pwa page carries the appbar style or switch`);
      }
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`appbar: ${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
