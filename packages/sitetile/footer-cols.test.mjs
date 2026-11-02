import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../build/index.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'tile-footer-cols-'));
const ir = join(work, 'ir');
const out = join(work, 'out');
mkdirSync(ir);
writeFileSync(join(ir, '_site.md'), '---\nbrand: Example\nlang: en-US\nfooter-nav: About=/about | Help=/help\ncopyright: Example\n---\n');
const page = (name, cols) => writeFileSync(join(ir, `${name}.md`), `---\nsitetile-page: ${name}\ntitle: Example\n${cols ? `footer-cols: ${cols}\n` : ''}---\n\n## Example\n%% sitetile: hero %%\n\nA fixture page.\n`);
page('home');
page('columns', 'Company: About=/about ;; Help & Support!: FAQ=/faq ;; --Mixed__Case 42--: A=/a');
page('cjk', '關於: A=/a');
page('duplicates', 'Help: A=/a ;; HELP!: B=/b ;; Help: C=/c');
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
  await test('columns carry positional and normalized heading classes', () => {
    assert.deepEqual(classes('columns'), ['rf-foot-col rf-foot-col--1 rf-foot-col--company', 'rf-foot-col rf-foot-col--2 rf-foot-col--help-support', 'rf-foot-col rf-foot-col--3 rf-foot-col--mixed-case-42']);
  });
  await test('a CJK-only heading carries only its positional class', () => {
    assert.deepEqual(classes('cjk'), ['rf-foot-col rf-foot-col--1']);
  });
  await test('only the first occurrence of a slug receives its name class', () => {
    assert.deepEqual(classes('duplicates'), ['rf-foot-col rf-foot-col--1 rf-foot-col--help', 'rf-foot-col rf-foot-col--2', 'rf-foot-col rf-foot-col--3']);
  });
  await test('without footer-cols the footer matches the pre-change HTML byte for byte', () => {
    assert.deepEqual(Buffer.from(footer('home')), readFileSync(join(here, 'fixtures/footer-without-cols.html')));
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
