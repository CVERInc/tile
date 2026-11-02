import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../build/index.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, 'packages/sitetile/astro');
if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log('  · footer-cols END-TO-END SKIPPED — no packages/sitetile/astro/node_modules (run npm install there)');
  process.exit(0);
}
const work = mkdtempSync(join(tmpdir(), 'tile-footer-cols-'));
const ir = join(work, 'ir');
const out = join(work, 'out');
mkdirSync(ir);
writeFileSync(join(ir, '_site.md'), '---\nbrand: Example\nlang: en-US\nfooter-nav: About=/about | Help=/help\ncopyright: Example\n---\n');
const page = (name, cols, extra = '') => writeFileSync(join(ir, `${name}.md`), `---\nsitetile-page: ${name}\ntitle: Example\n${cols ? `footer-cols: ${cols}\n` : ''}${extra}---\n\n## Example\n%% sitetile: hero %%\n\nA fixture page.\n`);
page('home');
page('columns', 'Company: About=/about ;; Help & Support!: FAQ=/faq ;; --Mixed__Case 42--: A=/a');
page('brand', 'Company: About=/about', 'footer-logo: /logo.svg\nfooter-brand: Example\nfooter-tagline: Since 2013\n');
page('escaped', 'Company: About=/about', 'footer-tagline:   <b>Since 2013</b> & more  \n');
page('empty', 'Company: About=/about ;; Help & Support!: FAQ=/faq ;; --Mixed__Case 42--: A=/a', 'footer-tagline:    \n');
page('simple-brand', '', 'footer-logo: /logo.svg\nfooter-brand: Example\nfooter-tagline: Since 2013\n');
page('cjk', '關於: A=/a');
page('duplicates', 'Help: A=/a ;; HELP!: B=/b ;; Help: C=/c');
page('numeric', '2: A=/a ;; 3: B=/b ;; 1: C=/c');
page('same-position', '1: A=/a');
page('absolute', 'About=https://x.example/about ; Help=/help');
page('heading-absolute', 'Heading: A=https://x.example/a');
const footer = (name) => {
  const html = readFileSync(join(out, name === 'home' ? 'index.html' : `${name}/index.html`), 'utf8');
  const match = html.match(/<footer\b[\s\S]*?<\/footer>/);
  assert.ok(match, 'fixture must render a footer');
  return match[0];
};
const classes = (name) => [...footer(name).matchAll(/<div class="(rf-foot-col(?: [^"]*)?)"/g)].map((m) => m[1]);
try {
  const result = await buildSite({ irDir: ir, outDir: out, engineDir: fileURLToPath(new URL('../..', import.meta.url)), siteUrl: 'https://example.com' });
  assert.equal(result.code, 0, 'fixture build must succeed');
  await test('columned brand renders a home-linked logo before wordmark and tagline', () => {
    assert.match(footer('brand'), /<div class="rf-foot-brand"> <a class="rf-footer-logo-link" href="\/" aria-label="Home"><img class="rf-footer-logo" src="\/logo.svg" alt="" width="44" height="44"><\/a>\s*<a class="rf-foot-wordmark" href="\/">Example<\/a>\s*<p class="rf-foot-tagline">Since 2013<\/p>/);
  });
  await test('tagline is trimmed and escaped plain text', () => {
    assert.match(footer('escaped'), /<p class="rf-foot-tagline">&lt;b&gt;Since 2013&lt;\/b&gt; &amp; more<\/p>/);
    assert.doesNotMatch(footer('escaped'), /<b>/);
  });
  await test('absent and empty brand additions preserve columned footer bytes', () => {
    const baseline = readFileSync(join(here, 'fixtures/footer-columns.html'));
    assert.deepEqual(Buffer.from(footer('columns')), baseline);
    assert.deepEqual(Buffer.from(footer('empty')), baseline);
  });
  await test('simple footer with logo ignores the columned tagline and preserves bytes', () => {
    assert.deepEqual(Buffer.from(footer('simple-brand')), readFileSync(join(here, 'fixtures/footer-simple-brand.html')));
  });
  await test('columns carry positional and normalized heading classes', () => {
    assert.deepEqual(classes('columns'), ['rf-foot-col rf-foot-col--1 rf-foot-col--company', 'rf-foot-col rf-foot-col--2 rf-foot-col--help-support', 'rf-foot-col rf-foot-col--3 rf-foot-col--mixed-case-42']);
  });
  await test('a CJK-only heading carries only its positional class', () => {
    assert.deepEqual(classes('cjk'), ['rf-foot-col rf-foot-col--1']);
  });
  await test('only the first occurrence of a slug receives its name class', () => {
    assert.deepEqual(classes('duplicates'), ['rf-foot-col rf-foot-col--1 rf-foot-col--help', 'rf-foot-col rf-foot-col--2', 'rf-foot-col rf-foot-col--3']);
  });
  await test('numeric headings never collide with positional classes or repeat tokens', () => {
    assert.deepEqual(classes('numeric'), [1, 2, 3].map((n) => `rf-foot-col rf-foot-col--${n}`));
    assert.deepEqual(classes('same-position'), ['rf-foot-col rf-foot-col--1']);
  });
  await test('URL colons do not create headings, while explicit headings still work', () => {
    assert.deepEqual(classes('absolute'), ['rf-foot-col rf-foot-col--1']);
    assert.doesNotMatch(footer('absolute'), /<h4\b/);
    assert.match(footer('absolute'), /href="https:\/\/x\.example\/about"[^>]*>About<\/a>/);
    assert.match(footer('absolute'), /href="\/help"[^>]*>Help<\/a>/);
    assert.deepEqual(classes('heading-absolute'), ['rf-foot-col rf-foot-col--1 rf-foot-col--heading']);
    assert.match(footer('heading-absolute'), /<h4[^>]*>Heading<\/h4>/);
    assert.match(footer('heading-absolute'), /href="https:\/\/x\.example\/a"[^>]*>A<\/a>/);
  });
  await test('without footer-cols the footer matches the plain-footer fixture byte for byte', () => {
    assert.deepEqual(Buffer.from(footer('home')), readFileSync(join(here, 'fixtures/footer-without-cols.html')));
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
