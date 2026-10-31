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

test('with --allow-dropped, an unknown key and an unsafe value are reported and compiled around', (t) => {
  const r = run(t, '---\nname: x\ngd-bg: #fff\ngd-bogus: 1\ngd-text: red} body{display:none\n---\n', 'theme.css', ['--allow-dropped']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /gd-bogus: "1" dropped — not a key this vocabulary has/);
  assert.match(r.stderr, /gd-text: "red\} body\{display:none" dropped — unsafe: /);
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

test('the package\'s one theme entrypoint resolves to these very modules, and is the PUBLIC face', async () => {
  const pub = await import('@tile/build/theme');
  const viaPath = await import('./theme-compile.js');
  assert.equal(pub.compileTheme, viaPath.compileTheme);
  assert.equal(pub.parseThemeDoc, parseThemeDoc);
  assert.equal(typeof pub.describeTheme, 'function');
  assert.equal('describeThemeGrammar' in pub, false, 'the hosted editor\'s description is not the public entrypoint');
  // the module files themselves are not exported by path any more
  await assert.rejects(() => import('@tile/build/theme/theme-schema.js'), /ERR_PACKAGE_PATH_NOT_EXPORTED|not exported/);
});

// ── round 2: a successful exit must mean the theme you wrote is the theme you got ────────────────

test('🔴 a name the compiler would drop is refused before anything is written', (t) => {
  for (const name of ['../oops', 'a b', 'x*/y', 'n'.repeat(65)]) {
    const r = run(t, `---\nname: ${name}\ngd-bg: #fff\n---\n`);
    assert.equal(r.status, 2, `name ${JSON.stringify(name)} → exit ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /name/);
    assert.equal(r.stdout, '', 'no _site.md keys printed for a refused theme');
    assert.equal(existsSync(r.out), false, 'and no theme.css');
  }
});

test('🔴 every value the compiler would drop is named — key, value, reason — and refused unless --allow-dropped', (t) => {
  const doc = [
    '---', 'name: sample', 'gd-bg: #fff',
    'card: glassy',                    // not a listed treatment value
    'surface-sand: rgb(banana)',       // surfaces are hex only
    'gd-text: red} body{display:none', // structurally unsafe
    'gd-band: #f3e9dc',                // per-surface, not site-wide
    'gd-bgg: #000',                    // a typo: no such key
    'type-scale: 9',                   // out of range: derives nothing
    'gd-font-size: 18px',
    '---', '',
  ].join('\n');
  const r = run(t, doc);
  assert.equal(r.status, 2, r.stderr);
  assert.equal(existsSync(r.out), false, 'refused: nothing written');
  assert.equal(r.stdout, '');
  for (const [key, value] of [['card', 'glassy'], ['surface-sand', 'rgb(banana)'], ['gd-text', 'red} body{display:none'],
    ['gd-band', '#f3e9dc'], ['gd-bgg', '#000'], ['type-scale', '9']]) {
    const line = r.stderr.split('\n').find((l) => l.includes(`${key}: ${JSON.stringify(value)}`));
    assert.ok(line, `no dropped line names ${key}: ${JSON.stringify(value)}\n${r.stderr}`);
    assert.match(line, /dropped/);
    assert.match(line, / — \S/, `the line for ${key} gives no reason: ${line}`);
  }
  assert.match(r.stderr.split('\n').find((l) => l.startsWith('✗ card:')) ?? '', /solid|surface, flat, glass, elevated/);
  assert.match(r.stderr, /--allow-dropped/, 'the refusal names the way through');

  // the same document, explicitly accepted: written, reported, exit 0
  const ok = run(t, doc, 'theme.css', ['--allow-dropped']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(existsSync(ok.out));
  assert.match(ok.stderr, /card: "glassy"/);
  const css = readFileSync(ok.out, 'utf8');
  assert.match(css, /--gd-bg: #fff;/);
  assert.doesNotMatch(css, /banana|display:\s*none|glassy|--gd-band: #f3e9dc/);
  assert.equal(ok.stdout.trim(), 'theme: sample', 'the dropped card value is not stamped');
});

test('a clean theme reports no drops; a default treatment value is not a drop', (t) => {
  const r = run(t, '---\nname: sample\ngd-bg: #fff\ncard: surface\nbutton: pill\nsurface-sand: #efe6d8\ngd-font-size: 18px\ntype-scale: 1.25\n---\n');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /dropped|⚠|✗/);
});

// ── round 3: what the forgiving parser skips or overwrites is a drop too ─────────────────────────

/** Refused (exit 2, nothing written, nothing printed), and stderr names every `needles` line. */
function assertRefusedNaming(t, doc, needles) {
  const r = run(t, doc);
  assert.equal(r.status, 2, `exit ${r.status}\n${r.stderr}`);
  assert.equal(existsSync(r.out), false, 'refused: no theme.css');
  assert.equal(r.stdout, '');
  for (const n of needles) assert.ok(r.stderr.includes(n), `stderr does not name ${JSON.stringify(n)}:\n${r.stderr}`);
  const ok = run(t, doc, 'theme.css', ['--allow-dropped']);
  assert.equal(ok.status, 0, `--allow-dropped must compile anyway:\n${ok.stderr}`);
  for (const n of needles) assert.ok(ok.stderr.includes(n), `--allow-dropped still lists ${JSON.stringify(n)}`);
  return r;
}

test('🔴 a frontmatter line the parser cannot read is named by line number and refused', (t) => {
  const r = assertRefusedNaming(t, '---\nname: sample\ngd-bg #fff\n---\n', ['line 3', '"gd-bg #fff"']);
  assert.match(r.stderr, /line 3: "gd-bg #fff" — /);
});

test('🔴 a key written twice is named with both lines and refused (the parser keeps the last)', (t) => {
  const r = assertRefusedNaming(t, '---\nname: sample\ngd-bg: #000\ngd-bg: #fff\n---\n', ['gd-bg', 'line 3', 'line 4', '"#000"']);
  assert.match(r.stderr, /gd-bg/);
});

test('🔴 an announcement link or deadline with no announcement text is a drop', (t) => {
  assertRefusedNaming(t, '---\nname: sample\nannounce-href: /sale\nannounce-until: 2026-12-01T23:59:00+08:00\n---\n',
    ['announce-href: "/sale" dropped', 'announce-until: "2026-12-01T23:59:00+08:00" dropped']);
});

test('🔴 an unusable type-scale is a drop even when every heading step is set by hand', (t) => {
  assertRefusedNaming(t, '---\nname: sample\ngd-font-size: 18px\ngd-h1: 30px\ngd-h2: 24px\ngd-h3: 20px\ntype-scale: 9\n---\n',
    ['type-scale: "9" dropped']);
  // control: a USABLE ratio with every step overridden is the author's choice, not a drop
  const r = run(t, '---\nname: sample\ngd-font-size: 18px\ngd-h1: 30px\ngd-h2: 24px\ngd-h3: 20px\ntype-scale: 1.25\n---\n');
  assert.equal(r.status, 0, r.stderr);
});

test('🔴 a long unknown key is reported with its REAL value (looked up by the full key, cut only for display)', (t) => {
  const key = 'x'.repeat(201);
  const r = run(t, `---\nname: sample\n${key}: 42\n---\n`);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /x{200}…: "42" dropped/);
  assert.doesNotMatch(r.stderr, /undefined/);
});

test('an announcement that IS shown is not a drop; neither is announce-off hiding it', (t) => {
  for (const doc of ['---\nname: s\nannounce: Hi\nannounce-href: /sale\n---\n', '---\nname: s\nannounce: Hi\nannounce-href: /x\nannounce-off: true\n---\n']) {
    const r = run(t, doc);
    assert.equal(r.status, 0, `${doc}\n${r.stderr}`);
  }
});

test('comments and blank lines in the frontmatter are not "unreadable"', (t) => {
  const r = run(t, '---\n# a comment\nname: s\n\n   \ngd-bg: #fff\n---\n');
  assert.equal(r.status, 0, r.stderr);
});
