// cli — `node packages/build/theme/cli.mjs <_theme.md> [theme.css]`, run as a stranger would run it:
// a real process, a real file on disk, and the bytes it wrote compared with the library's own
// answer — so the command line cannot drift into a second compiler.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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

test('an unknown key and an unsafe value are both reported, and the theme is refused', (t) => {
  const r = run(t, '---\nname: x\ngd-bg: #fff\ngd-bogus: 1\ngd-text: red} body{display:none\n---\n');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /gd-bogus: "1" dropped — not a key this vocabulary has/);
  assert.match(r.stderr, /gd-text: "red\} body\{display:none" dropped — unsafe: /);
  assert.match(r.stderr, /2 problem\(s\) above — nothing was written/, 'every problem is listed in one run');
  assert.equal(existsSync(r.out), false);
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

// ── round 2: a successful exit must not hide a key that went nowhere ────────────────

test('🔴 a name the compiler would drop is refused before anything is written', (t) => {
  for (const name of ['../oops', 'a b', 'x*/y', 'n'.repeat(65)]) {
    const r = run(t, `---\nname: ${name}\ngd-bg: #fff\n---\n`);
    assert.equal(r.status, 2, `name ${JSON.stringify(name)} → exit ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /name/);
    assert.equal(r.stdout, '', 'no _site.md keys printed for a refused theme');
    assert.equal(existsSync(r.out), false, 'and no theme.css');
  }
});

test('🔴 every value the compiler would drop is named — key, value, reason — and the theme is refused', (t) => {
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
  assert.match(r.stderr, /6 problem\(s\) above — nothing was written\. Fix them and run it again\./);
  assert.doesNotMatch(r.stderr, /allow-dropped|override/, 'there is no way through but fixing the source');
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

// ── round 4: a value the RENDERER would not use is a drop, judged by the renderer's own code ─────

test('🔴 an unusable type-scale is a drop even when a DARK heading token exists (only derived light steps count)', (t) => {
  assertRefusedNaming(t, '---\nname: sample\ngd-font-size: 18px\ngd-h3@dark: 24px\ntype-scale: 9\n---\n', ['type-scale: "9" dropped']);
  // control: a usable ratio beside a dark heading override is fine
  assert.equal(run(t, '---\nname: sample\ngd-font-size: 18px\ngd-h3@dark: 24px\ntype-scale: 1.25\n---\n').status, 0);
});

test('🔴 an announcement deadline the renderer cannot read is a drop (the renderer would show nothing)', (t) => {
  assertRefusedNaming(t, '---\nname: sample\nannounce: Sale now\nannounce-until: tomorrowish\n---\n', ['announce-until: "tomorrowish" dropped']);
  // control: a readable deadline with an offset — past or future — is the owner's choice
  for (const until of ['2026-12-01T23:59:00+08:00', '2001-01-01T00:00:00Z']) {
    const r = run(t, `---\nname: sample\nannounce: Sale now\nannounce-until: ${until}\n---\n`);
    assert.equal(r.status, 0, `${until}: ${r.stderr}`);
  }
});

test('🔴 an announce-off value other than true/false is a drop (only `true` hides it)', (t) => {
  assertRefusedNaming(t, '---\nname: sample\nannounce: Sale now\nannounce-off: yes\n---\n', ['announce-off: "yes" dropped']);
  for (const v of ['true', 'false']) assert.equal(run(t, `---\nname: sample\nannounce: Sale now\nannounce-off: ${v}\n---\n`).status, 0, v);
});

test('🔴 an empty value is a drop, not a warning beside a success', (t) => {
  assertRefusedNaming(t, '---\nname: sample\ngd-bg:\n---\n', ['gd-bg: "" dropped']);
});

test('🔴 a source line the parser silently loses (`__proto__:`) is a drop', (t) => {
  assertRefusedNaming(t, '---\nname: sample\n__proto__: typo\n---\n', ['line 3', '"__proto__: typo"']);
});

test('🔴 a fonts URL or announcement link the renderer rejects is a drop (it would never load / link)', (t) => {
  assertRefusedNaming(t, '---\nname: sample\nfonts: javascript:alert(1)\n---\n', ['fonts: "javascript:alert(1)" dropped']);
  assertRefusedNaming(t, '---\nname: sample\nannounce: Hi\nannounce-href: javascript:alert(1)\n---\n', ['announce-href: "javascript:alert(1)" dropped']);
  // control: what the renderer accepts
  assert.equal(run(t, '---\nname: sample\nfonts: https://fonts.example/a.css\nannounce: Hi\nannounce-href: /sale\n---\n').status, 0);
});

// ── round 5: `fonts:` lands in <link rel="stylesheet" href>, so it must be something that can load CSS ──

test('🔴 a fonts: value no stylesheet link can load is a drop, even when it is a safe NAVIGATION link', (t) => {
  for (const v of ['mailto:owner@example.org', '#fonts', '?v=2', 'tel:123', 'ftp://cdn.example/a.css']) {
    assertRefusedNaming(t, `---\nname: s\nfonts: ${v}\n---\n`, [`fonts: ${JSON.stringify(v)} dropped`]);
  }
  // control: the forms the allowlist accepts (round 6 narrowed it — see the test below)
  for (const v of ['https://fonts.example/a.css', '/fonts/a.css']) {
    const r = run(t, `---\nname: s\nfonts: ${v}\n---\n`);
    assert.equal(r.status, 0, `${v}: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`^fonts: ${v.replace(/[.?*+^$()[\]{}|\\/]/g, '\\$&')}$`, 'm'));
  }
  // announce-href keeps the renderer's navigation rule: a mail link is a fine announcement link
  assert.equal(run(t, '---\nname: s\nannounce: Write to us\nannounce-href: mailto:owner@example.org\n---\n').status, 0);
});

// ── round 6: `fonts:` is an ALLOWLIST, judged on the exact href the renderer will emit ───────────

test('🔴 fonts: only an absolute https URL or a root path, each resolving to a path longer than `/` with no `#`', (t) => {
  const refused = [
    // entity-encoded: safeHref decodes them, and the decoded href is what lands in <link>
    '&#109;ailto:owner@example.org', '&#116;el:123', '&#35;fonts',
    // same-page: they resolve to the HTML page itself
    '.', './', '/', './#fonts', './?v=2', '/?v=2', '/#fonts', '/fonts.css#x',
    // outside the allowlist on purpose: no host, or relative to a page the compiler cannot know
    'https://fonts.example', 'https://fonts.example/', '//cdn.example/a.css', 'fonts/a.css', '../a.css',
  ];
  for (const v of refused) {
    const r = run(t, `---\nname: s\nfonts: ${v}\n---\n`);
    assert.equal(r.status, 2, `${JSON.stringify(v)} → exit ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /fonts: .* dropped/, v);
    assert.equal(existsSync(r.out), false, v);
  }
  for (const v of ['https://fonts.example/a.css', 'https://fonts.example/css2?family=A',
    'https://fonts.googleapis.com/css2?family=Fraunces&display=swap', '/fonts/a.css', '/fonts.css?v=2', '&#47;fonts/a.css']) {
    const r = run(t, `---\nname: s\nfonts: ${v}\n---\n`);
    assert.equal(r.status, 0, `${JSON.stringify(v)}: ${r.stderr}`);
  }
});

test('🔴 a refused theme advertises no _site.md keys at all — nothing to paste, nothing half-applied', (t) => {
  const r = run(t, '---\nname: s\nfonts: mailto:owner@example.org\nannounce: Hi\nannounce-until: tomorrowish\n---\n');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /fonts: "mailto:owner@example\.org" dropped/);
  assert.match(r.stderr, /announce-until: "tomorrowish" dropped/);
  assert.equal(r.stdout, '');
  assert.equal(existsSync(r.out), false);
});

// ── round 7: a root path is judged by where a browser RESOLVES it, not by how it is spelled ─────

test('🔴 fonts: a root path that resolves to the site root or to another host is a drop', (t) => {
  const refused = ['/fonts/..', '/\\cdn.example/a.css', '/./', '/%2e%2e/', '/fonts/%2E%2E/', '/\\\\cdn.example/a.css',
    '/\\/cdn.example/a.css', '/fonts\\..\\', '/.', '/fonts/../?v=2'];
  for (const v of refused) {
    const r = run(t, `---\nname: s\nfonts: ${v}\n---\n`);
    assert.equal(r.status, 2, `${JSON.stringify(v)} → exit ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /fonts: .* dropped/, v);
    assert.equal(existsSync(r.out), false, v);
  }
  // control: root paths that resolve to a real path on the same host still pass
  for (const v of ['/fonts/a.css', '/fonts/../css/a.css', '/fonts.css?v=2', '/a\\b.css']) {
    const r = run(t, `---\nname: s\nfonts: ${v}\n---\n`);
    assert.equal(r.status, 0, `${JSON.stringify(v)}: ${r.stderr}`);
  }
});

// ── round 8 (final shape): https only, and a query never stands in for a path ────────────────────

test('🔴 fonts: http: is a drop (an https page blocks it as mixed content), and the resolved path must be longer than `/`', (t) => {
  const refused = [
    'https://cdn.example/?family=A', 'https://cdn.example/%2e%2e/?family=A', 'https://cdn.example/./?family=A',
    'http://fonts.example/a.css', 'http://fonts.example/css2?family=A', 'HTTP://fonts.example/a.css',
    'https://fonts.example/a.css#x',
  ];
  for (const v of refused) {
    const r = run(t, `---\nname: s\nfonts: ${v}\n---\n`);
    assert.equal(r.status, 2, `${JSON.stringify(v)} → exit ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /fonts: .* dropped/, v);
    assert.equal(existsSync(r.out), false, v);
  }
  for (const v of ['https://fonts.googleapis.com/css2?family=Fraunces&display=swap', 'HTTPS://fonts.example/a.css', 'https://cdn.example/x/../a.css']) {
    assert.equal(run(t, `---\nname: s\nfonts: ${v}\n---\n`).status, 0, v);
  }
});

test('🔴 fonts: an EMPTY trailing `#` is still a fragment (URL.hash reads it as "")', (t) => {
  for (const v of ['https://fonts.example/a.css#', '/fonts/a.css#']) {
    const r = run(t, `---\nname: s\nfonts: ${v}\n---\n`);
    assert.equal(r.status, 2, `${JSON.stringify(v)} → exit ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /fonts: .* dropped/, v);
    assert.equal(existsSync(r.out), false, v);
  }
});

// ── round 10: colour tokens must hold a CSS colour (the one value check besides the URL rules) ───

test('🔴 a colour token whose value is not a CSS colour is a drop — light and @dark alike', (t) => {
  for (const [k, v] of [['gd-bg', '#zzzzzz'], ['gd-text', '#12345'], ['gd-accent', 'rgb(banana)'], ['gd-border', 'reddish'],
    ['gd-bg@dark', 'hsl(blue)'], ['gd-muted', 'rgb(1, 2)'], ['gd-surface', 'var(nope)'], ['gd-head', '12px']]) {
    const r = run(t, `---\nname: s\n${k}: ${v}\n---\n`);
    assert.equal(r.status, 2, `${k}: ${v} → exit ${r.status}\n${r.stderr}`);
    assert.ok(r.stderr.includes(`${k}: ${JSON.stringify(v)} dropped`), `${k}: ${v}\n${r.stderr}`);
    assert.equal(existsSync(r.out), false);
  }
  // control: every form the parser accepts, and a non-colour token is NOT colour-checked
  for (const [k, v] of [['gd-bg', '#fff'], ['gd-bg', '#ffff'], ['gd-bg', '#F3E9DC'], ['gd-bg', '#f3e9dc80'], ['gd-bg', 'rgb(1, 2, 3)'],
    ['gd-bg', 'rgba(1,2,3,.5)'], ['gd-bg', 'rgb(1 2 3 / 50%)'], ['gd-bg', 'hsl(10 20% 30%)'], ['gd-bg', 'hsla(10, 20%, 30%, 0.4)'],
    ['gd-bg', 'RebeccaPurple'], ['gd-bg', 'transparent'], ['gd-bg', 'currentColor'], ['gd-btn-fill', 'var(--gd-accent)'],
    ['gd-bg', 'var(--brand, #fff)'], ['gd-bg@dark', '#120d1c'], ['gd-radius', 'whatever-length']]) {
    const r = run(t, `---\nname: s\n${k}: ${v}\n---\n`);
    assert.equal(r.status, 0, `${k}: ${v}\n${r.stderr}`);
  }
});

test('the README and --help state the narrowed contract the CLI actually keeps', () => {
  const usage = spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).stderr;
  for (const text of [README, usage]) {
    assert.match(text, /NOT validated as CSS/);
    assert.match(text, /colour tokens/);
  }
});

// ── round 11: two outcomes only — usable (exit 0, written) or refused (exit 2, nothing written) ─

test('🔴 there is no override: --allow-dropped is an unknown option, refused, nothing written', (t) => {
  for (const doc of ['---\nname: s\ngd-bg: #zzzzzz\n---\n', '---\nname: s\nannounce: Sale\nannounce-until: tomorrowish\n---\n']) {
    const r = run(t, doc, 'theme.css', ['--allow-dropped']);
    assert.equal(r.status, 2, `${doc}\n${r.stderr}`);
    assert.match(r.stderr, /unknown option --allow-dropped/);
    assert.equal(existsSync(r.out), false, 'nothing written');
    assert.equal(r.stdout, '');
  }
});

// ── round 12: author text never stands in for an emitted rule; one run lists everything ─────────

test('🔴 a comment in the custom CSS that spells the dropped rule does not make the drop pass', (t) => {
  const doc = '---\nname: s\nsurface-sand: banana\n---\n\n```css\n/* [data-surface="sand"] { --gd-band: banana; } */\n```\n';
  assertRefusedNaming(t, doc, ['surface-sand: "banana" dropped']);
  // and the same for a token: custom CSS that writes the very declaration does not count as the token arriving
  assertRefusedNaming(t, '---\nname: s\ngd-bg: #zzzzzz\n---\n\n```css\nhtml:root { --gd-bg: #zzzzzz; }\n```\n', ['gd-bg: "#zzzzzz" dropped']);
});

test('🔴 a missing or unusable name is listed WITH every other problem, in one run', (t) => {
  for (const [nameLine, nameNeedle] of [['', 'name'], ['name: ../oops\n', '"../oops"']]) {
    const r = assertRefusedNaming(t, `---\n${nameLine}gd-bgg: #fff\ncard: glassy\n---\n`,
      [nameNeedle, 'gd-bgg: "#fff" dropped', 'card: "glassy" dropped']);
    assert.match(r.stderr, /3 problem\(s\) above/, r.stderr);
  }
});

test('🔴 an output that cannot be written is a refusal (exit 2, path named), not a crash, and leaves nothing behind', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tile-theme-out-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = path.join(dir, '_theme.md');
  writeFileSync(src, '---\nname: s\ngd-bg: #fff\n---\n');
  const out = path.join(dir, 'no-such-dir', 'theme.css');
  const r = spawnSync(process.execPath, [CLI, src, out], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.ok(r.stderr.includes(out), `the refusal names the path:\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  assert.doesNotMatch(r.stderr, /✓/, 'no success line');
  assert.equal(r.stdout, '', 'no _site.md keys printed for a theme that was not written');
  assert.deepEqual(readdirSync(dir).sort(), ['_theme.md'], 'nothing partial left behind');
});

// ── round 13: a deadline names its zone; colours follow the CSS Color 4 grammar per form ─────────

test('🔴 announce-until without an explicit offset is a drop that says to add one (the build host would pick the zone)', (t) => {
  for (const until of ['2026-12-01T23:59:00', '2026-12-01T23:59', '2026-12-01', '2026-12-01T23:59:00+0800']) {
    const r = assertRefusedNaming(t, `---\nname: s\nannounce: Sale\nannounce-until: ${until}\n---\n`, [`announce-until: ${JSON.stringify(until)} dropped`]);
    assert.match(r.stderr, /offset/, r.stderr);
  }
  for (const until of ['2026-12-01T23:59:00+08:00', '2026-12-01T15:59:00Z', '2026-12-01T23:59:00.5-03:30', '2026-12-01T15:59Z']) {
    assert.equal(run(t, `---\nname: s\nannounce: Sale\nannounce-until: ${until}\n---\n`).status, 0, until);
  }
});

test('🔴 colours follow CSS Color 4 per form: legacy comma hsl needs %, legacy comma rgb may not mix % and numbers', (t) => {
  for (const v of ['hsl(10,20,30)', 'hsla(10, 20, 30, .5)', 'hsl(10, 20%, 30)', 'rgb(10%, 20, 30)', 'rgba(1, 2, 3%, .5)']) {
    assertRefusedNaming(t, `---\nname: s\ngd-bg: ${v}\n---\n`, [`gd-bg: ${JSON.stringify(v)} dropped`]);
  }
  for (const v of ['hsl(10, 20%, 30%)', 'hsla(10deg, 20%, 30%, 50%)', 'hsl(10 20 30)', 'hsl(10 20% 30 / .5)',
    'rgb(10%, 20%, 30%)', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 50%)', 'rgb(10% 20 30)', 'rgb(1 2 3 / .5)']) {
    assert.equal(run(t, `---\nname: s\ngd-bg: ${v}\n---\n`).status, 0, v);
  }
});

// ── round 14: a deadline is a real calendar moment; `none` in the modern colour syntax ─────────

test('🔴 an impossible calendar date is a drop (Date.parse would roll it forward silently)', (t) => {
  for (const until of ['2026-02-30T23:59:00Z', '2026-04-31T23:59:00+08:00', '2026-02-29T00:00:00Z', '2026-13-01T00:00:00Z',
    '2026-12-01T24:00:00Z', '2026-12-01T23:60:00Z', '2026-12-01T23:59:60+08:00']) {
    const r = assertRefusedNaming(t, `---\nname: s\nannounce: Sale\nannounce-until: ${until}\n---\n`, [`announce-until: ${JSON.stringify(until)} dropped`]);
    assert.match(r.stderr, /not a real date|calendar/, r.stderr);
  }
  for (const until of ['2028-02-29T00:00:00Z', '2026-04-30T23:59:00+08:00', '2026-12-31T23:59:59-11:00', '2026-01-01T00:00:00+14:00']) {
    assert.equal(run(t, `---\nname: s\nannounce: Sale\nannounce-until: ${until}\n---\n`).status, 0, until);
  }
});

test('🔴 `none` is a colour component in the modern space syntax only', (t) => {
  for (const v of ['rgb(none 0 0)', 'rgb(1 2 3 / none)', 'hsl(none 20% 30%)', 'hsl(10 none none / none)', 'rgb(none none none)']) {
    assert.equal(run(t, `---\nname: s\ngd-bg: ${v}\n---\n`).status, 0, v);
  }
  for (const v of ['rgb(none, 0, 0)', 'hsl(none, 20%, 30%)', 'rgba(1, 2, 3, none)', 'rgb(nonee 0 0)']) {
    assertRefusedNaming(t, `---\nname: s\ngd-bg: ${v}\n---\n`, [`gd-bg: ${JSON.stringify(v)} dropped`]);
  }
});
