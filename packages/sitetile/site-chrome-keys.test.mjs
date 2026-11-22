// Site chrome a site config sets is not a page's to change.
//   run: node packages/sitetile/site-chrome-keys.test.mjs
//
// Two halves. The pure one — which keys, and what "the site config sets it" means — runs anywhere.
// The built one hands a real site to the real renderer and reads the HTML it wrote, because the
// promise is about what a visitor is served; it needs packages/sitetile/astro/node_modules and
// names itself SKIPPED without them, the way packages/build's end-to-end test does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_CHROME_KEYS, SITE_CHROME_FAMILIES, isSiteChromeKey, resolveSiteChrome, siteChromeWarning } from './site-chrome-keys.mjs';
import { CHROME_LINK_KEYS } from './chrome-links.mjs';
import { RENDERER_SUBPATH } from '../build/index.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

test('which keys are site chrome, and which stay a page\'s own', () => {
  const chrome = ['brand', 'site-logo', 'favicon', 'nav', 'header-cta', 'header-actions', 'header-actions-cart-href',
    'header-actions-cart-guild', 'header-actions-cart-title', 'header-actions-cart-empty', 'footer', 'footer-cols',
    'footer-social', 'footer-brand', 'footer-logo', 'footer-tagline', 'copyright', 'copyright-href', 'language-href',
    'announce', 'announce-href', 'announce-until', 'age-gate', 'age-gate-title', 'age-gate-body', 'age-gate-note',
    'age-gate-note-links', 'age-gate-back-url', 'age-gate-back-label', 'age-gate-confirm-label', 'age-gate-key',
    'fonts', 'analytics-token', 'site-key', 'generator', 'assistant-name', 'kaito-corpus',
    'blog-path', 'blog-label', 'blog-title', 'blog-footer-link', 'blog-search', 'blog-post-cta'];
  for (const k of chrome) assert.equal(isSiteChromeKey(k), true, `${k} should be site chrome`);
  const pageOwn = ['title', 'description', 'image', 'share-image', 'share-title', 'og-image', 'og-type', 'noindex', 'lang',
    'sitetile-page', 'layout', 'theme', 'header', 'header-width', 'header-sticky', 'nav-mobile', 'button', 'band', 'card',
    'cell-cta', 'corner', 'color-scheme', 'theme-color-light', 'theme-color-dark', 'og-cards', 'breadcrumb-trail',
    'breadcrumb-label', 'sidebar-nav', 'sidebar-social', 'sidebar-side', 'inbox-bubble', 'inbox-bubble-except',
    'inbox-bubble-search', 'inbox-bubble-color', 'packages', 'locales', 'site-title', 'dynamic-coral-css',
    // a family is its name or `<name>-…`, never a longer word that merely starts the same
    'footnote', 'blogroll', 'announcement', 'navigation', 'brand-color', 'fonts-display'];
  for (const k of pageOwn) assert.equal(isSiteChromeKey(k), false, `${k} should stay a page's own key`);
  assert.equal(new Set(SITE_CHROME_KEYS).size, SITE_CHROME_KEYS.length, 'a key is listed twice');
  for (const f of SITE_CHROME_FAMILIES) assert.ok(!SITE_CHROME_KEYS.includes(f), `${f} is both a key and a family`);
});

test('every key that puts a link in the shared frame is covered, or is named here as a page\'s own', () => {
  // chrome-links.mjs is the renderer's own list of link-bearing chrome keys. A key added there is
  // a new way to put a link in the frame, so it has to be classified here, not silently left out.
  const pagesOwn = new Set(['sidebar-nav', 'sidebar-social', 'breadcrumb-trail']);
  for (const k of CHROME_LINK_KEYS) {
    assert.ok(isSiteChromeKey(k) !== pagesOwn.has(k), `${k}: a chrome link key must be site chrome or listed as a page's own, exactly one`);
  }
});

test('resolveSiteChrome: the site config\'s value stands; a key it leaves unset still comes from the page', () => {
  const siteConfig = { brand: 'Kite', nav: 'Home / | About /about', 'header-cta': 'Sign in=/account', fonts: 'https://fonts.example/a.css',
    'analytics-token': 'a'.repeat(32), 'footer-tagline': '', theme: 'ink', 'age-gate': 'true', 'site-title': 'Kite' };
  const own = { title: 'Account', description: 'Your account', 'header-cta': 'Sign in=https://elsewhere.example/login',
    fonts: 'https://elsewhere.example/x.css', 'analytics-token': 'b'.repeat(32), nav: ' Home / | About /about ',
    'footer-tagline': 'Page tagline', announce: 'Page notice', theme: 'paper', 'age-gate': 'false', layout: 'sidebar' };
  const merged = { ...siteConfig, ...own };
  const { meta, ignored } = resolveSiteChrome(own, siteConfig, merged);
  assert.equal(meta, merged, 'it works on the merged object the route already holds');
  assert.deepEqual(ignored.sort(), ['age-gate', 'analytics-token', 'fonts', 'header-cta']);
  assert.equal(meta['header-cta'], 'Sign in=/account');
  assert.equal(meta.fonts, 'https://fonts.example/a.css');
  assert.equal(meta['analytics-token'], 'a'.repeat(32));
  assert.equal(meta['age-gate'], 'true');
  // the same value as the site config: nothing to ignore, nothing reported (the page's spelling stays)
  assert.equal(meta.nav, ' Home / | About /about ');
  // unset, or blank, in the site config: the page's value stands
  assert.equal(meta.announce, 'Page notice');
  assert.equal(meta['footer-tagline'], 'Page tagline');
  // not site chrome: page keys win, as they always have
  assert.equal(meta.title, 'Account');
  assert.equal(meta.description, 'Your account');
  assert.equal(meta.theme, 'paper');
  assert.equal(meta.layout, 'sidebar');
});

test('resolveSiteChrome: no site config, nothing reserved; and it never invents a key', () => {
  const own = { nav: 'Home /', 'header-cta': 'Buy=/buy', fonts: 'https://fonts.example/a.css' };
  for (const none of [null, undefined]) {
    const merged = { ...own };
    assert.deepEqual(resolveSiteChrome(own, none, merged), { meta: merged, ignored: [] });
    assert.deepEqual(merged, own);
  }
  // a site config that sets a chrome key the page never mentions: untouched by this function
  const siteConfig = { nav: 'Home /' };
  const merged = { ...siteConfig, title: 'T' };
  assert.deepEqual(resolveSiteChrome({ title: 'T' }, siteConfig, merged).ignored, []);
  assert.deepEqual(merged, { nav: 'Home /', title: 'T' });
  // an inherited name is not a key the site config set
  assert.deepEqual(resolveSiteChrome({ 'footer': 'x' }, Object.create({ footer: 'y' }), { footer: 'x' }).ignored, []);
});

test('the build-log line names the key and the page, and says what to do', () => {
  assert.equal(siteChromeWarning('header-cta', 'content/account.md'),
    'sitetile: header-cta in content/account.md is IGNORED — the site config (_site.md) sets header-cta, and a page '
    + 'cannot change a site setting. Remove the line from content/account.md, or change it in _site.md.');
});

// ── built: a real site, the real renderer ────────────────────────────────────────────────────
if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · site chrome, built pages SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
  console.log('    (the pure half above still ran; without this one nothing here read a built page)');
} else {
  test('built pages: a page cannot change the chrome its site config sets, and the build says so', async (t) => {
    const irDir = mkdtempSync(join(tmpdir(), 'tile-chrome-ir-'));
    const outDir = mkdtempSync(join(tmpdir(), 'tile-chrome-out-'));
    t.after(() => { rmSync(irDir, { recursive: true, force: true }); rmSync(outDir, { recursive: true, force: true }); });
    const SITE_TOKEN = 'a'.repeat(32); const PAGE_TOKEN = 'b'.repeat(32);
    const page = (name, fm) => writeFileSync(join(irDir, `${name}.md`),
      `---\nsitetile-page: ${name}\ntitle: ${name} page title\nlang: en-US\n${fm ? fm + '\n' : ''}---\n\n## ${name}\n\nBody of ${name}.\n`);
    writeFileSync(join(irDir, '_site.md'), ['---', 'brand: Chrome Fixture', 'lang: en-US',
      'nav: Home / | Account /account', 'header-cta: Sign in=/account',
      'fonts: https://fonts.example/site.css', `analytics-token: ${SITE_TOKEN}`,
      'footer: Terms /terms', 'copyright: © Chrome Fixture', '---', ''].join('\n'));
    page('home', '');
    // the page that tries: every one of these is set by the site config above
    page('account', ['header-cta: Sign in=https://elsewhere.example/login', 'fonts: https://elsewhere.example/x.css',
      `analytics-token: ${PAGE_TOKEN}`, 'nav: Home / | Prizes https://elsewhere.example/prizes',
      'footer: Terms https://elsewhere.example/terms', 'copyright: © Somebody Else',
      // …and these are the page's own, or unset in the site config
      'description: The account page, described by itself', 'announce: A notice only this page carries'].join('\n'));
    // a page that repeats the site config word for word is not a page that changed anything
    page('same', 'header-cta: Sign in=/account\nfooter: Terms /terms');

    // Through the CLI (which is buildSite and nothing else) so the build's own log can be READ: the
    // warning is part of what this build produces, and buildSite hands its child our stdio.
    const r = spawnSync(process.execPath, [join(ENGINE, 'packages/build/cli.mjs'), irDir, outDir,
      '--site-url', 'https://chrome-fixture.example', '--engine', ENGINE], { encoding: 'utf8' });
    const log = `${r.stdout || ''}\n${r.stderr || ''}`;
    assert.equal(r.status, 0, 'the build failed:\n' + log.slice(-3000));
    const html = (p) => readFileSync(join(outDir, p, 'index.html'), 'utf8');

    const home = html(''); const account = html('account');
    // the control: the site's own chrome, on a page that says nothing about it
    assert.ok(home.includes('<a class="rf-header-cta" href="/account">Sign in</a>'), 'the fixture\'s header button is not on the home page');
    assert.ok(home.includes('href="https://fonts.example/site.css"'), 'the fixture\'s stylesheet is not on the home page');
    assert.ok(home.includes(SITE_TOKEN), 'the fixture\'s analytics token is not on the home page');
    // the page that tried wears exactly that chrome
    assert.ok(account.includes('<a class="rf-header-cta" href="/account">Sign in</a>'), 'the page replaced the site\'s header button');
    assert.ok(account.includes('href="https://fonts.example/site.css"'), 'the page replaced the site\'s stylesheet');
    assert.ok(account.includes(SITE_TOKEN), 'the page replaced the site\'s analytics token');
    assert.ok(account.includes('© Chrome Fixture'), 'the page replaced the site\'s copyright line');
    for (const theirs of ['elsewhere.example', PAGE_TOKEN, 'Somebody Else', 'Prizes']) {
      assert.ok(!account.includes(theirs), `the page's own ${JSON.stringify(theirs)} reached its built HTML`);
    }
    // …while what is the page's own, or unset in the site config, is still the page's
    assert.ok(account.includes('The account page, described by itself'), 'the page lost its own description');
    assert.ok(account.includes('A notice only this page carries'), 'a chrome key the site config leaves unset no longer comes from the page');
    assert.ok(!home.includes('A notice only this page carries'), 'one page\'s notice leaked onto another');

    // the build log names each ignored line once, by page and key, and nothing else
    for (const key of ['header-cta', 'fonts', 'analytics-token', 'nav', 'footer', 'copyright']) {
      const line = siteChromeWarning(key, 'content/account.md');
      assert.equal(log.split(line).length - 1, 1, `expected exactly one build-log line for ${key}; log was:\n${log.slice(-3000)}`);
    }
    assert.ok(!/content\/same\.md is IGNORED/.test(log), 'a page that repeats the site config was reported');
    assert.ok(!/(description|announce) in content\/account\.md is IGNORED/.test(log), 'a page\'s own key was reported');
  });
}
