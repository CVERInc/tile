// tile#195/#196: render the real article and footer, then measure share-link defaults and theme overrides.
// PLAYWRIGHT=/path/to/playwright/index.mjs node packages/sitetile/real-render/share-buttons.smoke.mjs
// scripts/test.sh discovers this alongside the other real-render browser smokes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINGO_LOCALES } from '../locale.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASTRO = path.resolve(HERE, '../astro');
if (!existsSync(path.join(ASTRO, 'node_modules/astro'))) {
  console.log('SKIPPED share-buttons smoke — run npm ci --prefix packages/sitetile/astro');
  process.exit(0);
}
// A sibling of astro/ keeps the config aliases and lingo re-export pointing at this checkout.
const FIX = mkdtempSync(path.resolve(HERE, '../.smoke-share-buttons-'));
let browser, server;
let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`ok ${name}`); }
  catch (e) { process.exitCode = 1; console.error(`FAIL ${name}: ${e.message}`); }
}
try {
  cpSync(ASTRO, FIX, { recursive: true, filter: (s) => !/[\\/](node_modules|\.astro|dist[^\\/]*|\.tile-build[^\\/]*)(?:[\\/]|$)/.test(s) });
  // No inherited demo _site.md or page languages in the no-language fixture.
  rmSync(path.join(FIX, 'content'), { recursive: true });
  mkdirSync(path.join(FIX, 'content'));
  symlinkSync(path.join(ASTRO, 'node_modules'), path.join(FIX, 'node_modules'), 'dir');
  rmSync(path.join(FIX, 'src/pages'), { recursive: true });
  mkdirSync(path.join(FIX, 'src/pages'));
  writeFileSync(path.join(FIX, 'src/pages/[fixture].astro'), `---
import PostView from '../components/PostView.astro';
import { LINGO_LOCALES } from '../packages/lingo/locale.mjs';
export function getStaticPaths() {
  return LINGO_LOCALES.flatMap(lang =>
    ['top', 'bottom', 'off'].map(row => ({ params: { fixture: lang + '-' + row }, props: { row, lang } }))).concat(
      ['no-lang', 'locales-only', 'conflicting-lang'].flatMap(mismatch =>
        [false, true].map(sidebarOn => ({ params: { fixture: mismatch + (sidebarOn ? '-sidebar' : '') },
          props: { row: 'top', mismatch, sidebarOn } }))));
}
const { row, lang, mismatch, sidebarOn } = Astro.props;
const meta = { title: 'Share fixture', lang, locales: lang, 'footer-social': 'Facebook=https://www.facebook.com/example; X=https://x.com/example',
  ...(row === 'bottom' ? { 'blog-share': 'email,facebook,twitter,x,linkedin,tumblr,pinterest' } : {}),
  ...(row === 'off' ? { 'blog-share-top': 'none' } : {}) };
if (mismatch === 'no-lang') { delete meta.lang; delete meta.locales; }
if (mismatch === 'locales-only') { delete meta.lang; meta.locales = 'zh-TW, en-US'; }
if (mismatch === 'conflicting-lang') { meta.lang = 'ja-JP'; meta.locales = 'en-US, ja-JP'; }
const sidebar = sidebarOn ? { side: 'right', categories: [], related: [], archive: [], tags: [] } : null;
const post = { title: 'Article', body: 'A shareable article.', slug: 'article' };
---
<PostView post={post} meta={meta} sidebar={sidebar} keepReadingCards={[]} relatedCards={[]} />
`);
  execFileSync(process.execPath, [path.join(ASTRO, 'node_modules/astro/bin/astro.mjs'), 'build', '--root', FIX],
    { cwd: FIX, stdio: 'pipe', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  const dist = path.join(FIX, 'dist');
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(dist, pathname, path.extname(pathname) ? '' : 'index.html');
    try {
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
      res.end(readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pw = await import(process.env.PLAYWRIGHT || 'playwright');
  browser = await (pw.chromium ?? pw.default.chromium).launch();
  const page = await browser.newPage();
  const styles = () => page.locator('.bl-share-btn').evaluateAll(links => links.map(a => {
    const s = getComputedStyle(a);
    return { fontSize: s.fontSize, textDecoration: s.textDecorationLine };
  }));
  await page.goto(`${origin}/en-US-top/`);
  await check('default top row has two share links', async () => assert.equal(await page.locator('.bl-share-btn').count(), 2));
  const defaults = await styles();
  await page.locator('.bl-share-btn').evaluateAll(links => links.forEach(a => a.style.cssText = 'font-size:0.85em;text-decoration:underline;'));
  await check('default computed font-size and decoration equal the former inline style', async () => assert.deepEqual(defaults, await styles()));
  console.log('top defaults:', JSON.stringify(defaults));
  await page.reload();
  await page.addStyleTag({ content: '.bl-share a { font-size: 1em; text-decoration: none; }' });
  await check('normal theme specificity overrides share font-size', async () => {
    const parentSize = await page.locator('.bl-share').evaluate(a => getComputedStyle(a).fontSize);
    assert.equal((await styles())[0].fontSize, parentSize, 'theme font-size: 1em must win over the 0.85em default');
  });
  await check('normal theme specificity overrides share decoration', async () => assert.equal((await styles())[0].textDecoration, 'none', 'theme text-decoration: none must win'));
  await page.addStyleTag({ content: '.bl-share-top { gap: 2rem; margin-top: 3rem; }' });
  await check('normal theme specificity overrides top row spacing', async () => {
    const spacing = await page.locator('.bl-share-top').evaluate(nav => {
      const s = getComputedStyle(nav); return { gap: s.gap, marginTop: s.marginTop };
    });
    assert.deepEqual(spacing, { gap: '32px', marginTop: '48px' });
  });
  for (const [fixture, lang, label, navLabel] of [
    ['no-lang', 'zh-Hant', 'Share to Facebook', 'Share this post'],
    ['locales-only', 'zh-Hant', '分享到 Facebook', '分享這篇文章'],
    ['conflicting-lang', 'en', 'Share to Facebook', 'Share this post'],
  ]) {
    for (const suffix of ['', '-sidebar']) {
      await page.goto(`${origin}/${fixture}${suffix}/`);
      await check(`${fixture}${suffix}: share and navigation names respect declared language`, async () => {
        assert.equal(await page.locator('html').getAttribute('lang'), lang);
        assert.equal(await page.locator('.bl-share-btn').first().getAttribute('aria-label'), label,
          `${fixture}${suffix}: share label must respect neutral UI fallback`);
        assert.equal(await page.locator('.bl-share').getAttribute('aria-label'), navLabel,
          `${fixture}${suffix}: navigation label must respect neutral UI fallback`);
      });
    }
  }
  await page.goto(`${origin}/en-US-bottom/`);
  await check('configured bottom row retains all seven destinations without the top row', async () => {
    assert.equal(await page.locator('.bl-share-btn').count(), 7);
    assert.equal(await page.locator('.bl-share-top').count(), 0);
  });
  await check('bottom row retains ordinary anchor font-size and decoration', async () => {
    const control = await page.locator('.bl-share').evaluate(nav => {
      const a = document.createElement('a'); a.href = '#'; a.textContent = 'Control'; nav.append(a);
      const s = getComputedStyle(a); const values = { fontSize: s.fontSize, textDecoration: s.textDecorationLine }; a.remove(); return values;
    });
    for (const actual of await styles()) assert.deepEqual(actual, control);
  });
  await page.goto(`${origin}/en-US-off/`);
  await check('explicit opt-out emits no share links', async () => assert.equal(await page.locator('.bl-share-btn').count(), 0));
  const names = {
    'en-US': brand => `Share to ${brand}`,
    'zh-TW': brand => `分享到 ${brand}`,
    'ja-JP': brand => `${brand}でシェア`,
    'ko-KR': brand => `${brand}에 공유`,
  };
  const navNames = { 'en-US': 'Share this post', 'zh-TW': '分享這篇文章', 'ja-JP': 'この記事をシェア', 'ko-KR': '이 글 공유' };
  for (const lang of LINGO_LOCALES) {
    const shareName = names[lang];
    for (const row of ['top', 'bottom']) {
      await page.goto(`${origin}/${lang}-${row}/`);
      await check(`${lang} ${row}: share names differ from footer social names`, async () => {
        assert.equal(await page.getByRole('link', { name: 'Facebook', exact: true }).count(), 1,
          'only the footer link should be named Facebook');
        assert.equal(await page.getByRole('link', { name: 'X', exact: true }).count(), 1,
          'only the footer link should be named X');
        assert.equal(await page.getByRole('navigation', { name: navNames[lang], exact: true }).count(), 1,
          'share navigation must use the resolved page language');
        const labels = row === 'top' ? ['Facebook', 'X'] : ['Email', 'Facebook', 'Twitter', 'X', 'LinkedIn', 'Tumblr', 'Pinterest'];
        assert.deepEqual(await page.locator('.bl-share-btn').allTextContents(), labels, 'visible labels stay unchanged');
        for (const label of labels) {
          const link = page.getByRole('link', { name: shareName(label), exact: true });
          assert.equal(await link.count(), 1, `missing accessible name: ${shareName(label)}`);
          assert.equal(await link.getAttribute('target'), '_blank');
          assert.equal(await link.getAttribute('rel'), 'noopener');
        }
        const facebook = page.getByRole('link', { name: shareName('Facebook'), exact: true });
        assert.equal(await facebook.getAttribute('href'),
          `https://www.facebook.com/sharer.php?u=${encodeURIComponent(`https://example.com/${lang}-${row}/`)}`);
      });
    }
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(FIX, { recursive: true, force: true });
}
console.log(`${passed} passed`);
