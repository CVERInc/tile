// cli — `node packages/build/theme/cli.mjs <_theme.md> [theme.css]`, run as a stranger would run it:
// a real process, a real file on disk, and the bytes it wrote compared with the library's own
// answer — so the command line cannot drift into a second compiler.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTheme, THEME_SITE_KEYS } from './theme-compile.js';
import { parseThemeDoc, residueOf } from './theme-schema.js';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

const DOC = [
  '---',
  'name: harbour',
  'gd-bg: #fbf8f3',
  'gd-accent: #b4532a',
  'gd-font-size: 18px',
  'type-scale: 1.25',
  'gd-bg@dark: #16130f',
  'button: pill',
  'card: surface',
  'surface-sand: #efe6d8',
  'fonts: https://fonts.example/harbour.css',
  'announce: Open on Sundays',
  '---',
  '',
  '```css',
  '.st-hero h1 { letter-spacing: -0.02em; }',
  '```',
  '',
].join('\n');

function run(t, doc, outName = 'theme.css', extra = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tile-theme-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, '_theme.md');
  if (doc != null) writeFileSync(src, doc);
  const out = path.join(dir, outName);
  const r = spawnSync(process.execPath, [CLI, src, out, ...extra], { encoding: 'utf8' });
  return { ...r, out, dir };
}

test('writes the same theme.css the library compiles, and prints exactly the theme-owned _site.md keys', (t) => {
  const r = run(t, DOC);
  assert.equal(r.status, 0, r.stderr);
  const { meta, body } = parseThemeDoc(DOC);
  const expected = compileTheme(meta, residueOf(body));
  assert.equal(readFileSync(r.out, 'utf8'), expected.css, 'the CLI is a door onto compileTheme, not a second compiler');
  // a few things the stylesheet must visibly carry, so this is not only "equal to itself"
  const css = readFileSync(r.out, 'utf8');
  assert.match(css, /^\/\* Compiled from ir\/_theme\.md — do not hand-edit\. Theme: harbour\. \*\//);
  assert.match(css, /--gd-h1: 35\.2px;/, '18px × 1.25³, derived');
  assert.match(css, /html\[data-theme="dark"\]:root \{\n {2}--gd-bg: #16130f;\n\}/);
  assert.match(css, /\[data-surface="sand"\] \{ --gd-band: #efe6d8; \}/);
  assert.match(css, /\.st-hero h1 \{ letter-spacing: -0\.02em; \}/, 'the body CSS is carried verbatim');

  const lines = r.stdout.trim().split('\n');
  assert.deepEqual(lines, [
    'theme: harbour',
    'fonts: https://fonts.example/harbour.css',
    'announce: Open on Sundays',
    'button: pill',
  ], 'card: surface is the default, so it is not stamped');
  for (const l of lines) assert.ok(THEME_SITE_KEYS.includes(l.slice(0, l.indexOf(':'))), l);
});

test('refuses by name, writing nothing: no frontmatter, no name, no file', (t) => {
  for (const [doc, why] of [['just prose', /\(doc\)/], ['---\ngd-bg: #fff\n---\n', /name/], [null, /cannot read/]]) {
    const r = run(t, doc);
    assert.equal(r.status, 2, `${JSON.stringify(doc)} → ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, why);
    assert.equal(existsSync(r.out), false, 'a refusal leaves no half-written theme.css behind');
  }
});

test('an unknown key and an unsafe value are reported, and compiled around rather than refused', (t) => {
  const r = run(t, '---\nname: x\ngd-bg: #fff\ngd-bogus: 1\ngd-text: red} body{display:none\n---\n');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /gd-bogus — unknown theme key/);
  assert.match(r.stderr, /gd-text dropped \(unsafe\)/);
  const css = readFileSync(r.out, 'utf8');
  assert.doesNotMatch(css, /display:\s*none|gd-bogus/);
  assert.match(css, /--gd-bg: #fff;/);
});

test('no arguments, or one too many, prints the usage and exits 2', () => {
  for (const args of [[], ['a', 'b', 'c']]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^usage: node packages\/build\/theme\/cli\.mjs/);
  }
});

test('the README shows this command, spelled the way this file says it is spelled', () => {
  const header = /^\/\/ {5}(node engine\/packages\/build\/theme\/cli\.mjs .+)$/m.exec(readFileSync(CLI, 'utf8'));
  assert.ok(header, 'cli.mjs lost the example command in its header');
  assert.ok(README.includes(header[1]), `packages/build/README.md no longer shows \`${header[1]}\``);
});

test('the README\'s worked example compiles, and prints exactly the keys the README says it prints', (t) => {
  const doc = /^````md\n([\s\S]*?)\n````$/m.exec(README);
  assert.ok(doc, 'packages/build/README.md lost its ````md _theme.md example');
  const printed = /The first line writes `theme\.css`[\s\S]*?\n```\n([\s\S]*?)\n```/.exec(README);
  assert.ok(printed, 'packages/build/README.md lost the block of keys the first line prints');
  const r = run(t, `${doc[1]}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.includes('⚠'), false, `the README example is not clean:\n${r.stderr}`);
  assert.equal(r.stdout.trim(), printed[1].trim());
  assert.match(readFileSync(r.out, 'utf8'), /letter-spacing: -0\.02em/, 'its custom CSS block reached theme.css');
});

test('the package exports resolve to these very modules', async () => {
  const viaName = await import('@tile/build/theme/theme-compile.js');
  const viaPath = await import('./theme-compile.js');
  assert.equal(viaName.compileTheme, viaPath.compileTheme);
  const schema = await import('@tile/build/theme/theme-schema.js');
  assert.equal(schema.parseThemeDoc, parseThemeDoc);
});
