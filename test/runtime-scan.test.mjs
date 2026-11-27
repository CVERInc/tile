// scripts/runtime-scan.mjs must go RED on every construct it claims to refuse, in every spelling it
// claims to read (pretty, minified, bracket notation, escaped), stay green on the clean fixture and on
// the repo's real coral bundles with the real exception list, and refuse a dead exception.
//
// Fixture format (test/fixtures/runtime-scan/forbidden/<rule>.js): a line ending in the comment
// `expect <rule>` or `expect <rule> xN` must produce exactly N findings of that rule on that line, and
// every other line none. The comment is invisible to the scan, which skips comments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const SCAN = path.join(REPO, 'scripts', 'runtime-scan.mjs');
const {
  RULES, scanSource, scanFiles, scan, report, coralBundles, loadExceptions, validateExceptions, globToRegExp,
  DEFAULT_EXCEPTIONS,
} = await import(SCAN);
const FIXTURES = path.join(HERE, 'fixtures', 'runtime-scan');
const FORBIDDEN = path.join(FIXTURES, 'forbidden');
const CLEAN = path.join(FIXTURES, 'clean', 'clean.js');

const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-scan-')); made.push(d); return d; };

// esbuild, found the way packages/dynamic-corals/build.mjs finds it. Without it the minified half of
// each check below SKIPS BY NAME: "I could not look" must not print the same thing as "I looked".
const ESBUILD = [process.env.ESBUILD, path.join(REPO, 'packages/sitetile/astro/node_modules/.bin/esbuild'),
  path.join(REPO, 'node_modules/.bin/esbuild')].filter(Boolean).find((p) => fs.existsSync(p));
const minify = (src) => execFileSync(ESBUILD, ['--minify', '--format=esm', '--log-level=error', '--loader=js'],
  { input: src, encoding: 'utf8' });

function expectations(src) {
  const want = new Map(); // line → Map(rule → count)
  src.split(/\r?\n/).forEach((text, k) => {
    const m = /\/\/ expect ([a-z-]+)(?: x(\d+))?\s*$/.exec(text);
    if (m) want.set(k + 1, new Map([[m[1], Number(m[2] || 1)]]));
  });
  return want;
}
function byLine(findings) {
  const got = new Map();
  for (const f of findings) {
    if (!got.has(f.line)) got.set(f.line, new Map());
    got.get(f.line).set(f.rule, (got.get(f.line).get(f.rule) || 0) + 1);
  }
  return got;
}
const plain = (m) => Object.fromEntries([...m].map(([line, rules]) => [line, Object.fromEntries(rules)]));
const countRules = (findings) => findings.reduce((acc, f) => ({ ...acc, [f.rule]: (acc[f.rule] || 0) + 1 }), {});

// ── One fixture per construct ────────────────────────────────────────────────────────────────────

const fixtureRules = fs.readdirSync(FORBIDDEN).filter((f) => f.endsWith('.js')).map((f) => f.replace(/\.js$/, '')).sort();

test('there is one forbidden fixture for every rule, and no fixture for a rule that does not exist', () => {
  assert.deepEqual(fixtureRules, Object.keys(RULES).sort());
});

for (const rule of fixtureRules) {
  const file = path.join(FORBIDDEN, `${rule}.js`);
  const src = fs.readFileSync(file, 'utf8');

  test(`RED: ${rule} — every spelling in its fixture is found, on its own line, and nothing else is`, () => {
    const want = expectations(src);
    assert.ok(want.size >= 4, `${rule}.js has only ${want.size} spellings`);
    for (const rules of want.values()) assert.deepEqual([...rules.keys()], [rule], `${rule}.js expects another rule`);
    const found = scanSource(src);
    assert.deepEqual(plain(byLine(found)), plain(want));
    const result = scanFiles([file], { root: REPO });
    const { ok, text } = report(result);
    assert.equal(ok, false);
    // the report names the file and the line of every finding
    for (const line of want.keys()) assert.match(text, new RegExp(`test/fixtures/runtime-scan/forbidden/${rule}\\.js:${line}:\\d+  ${rule}`));
  });

  test(`RED: ${rule} — the same fixture minified by esbuild is still found, as often`, { skip: !ESBUILD && 'SKIPPED — no esbuild (set ESBUILD, or npm ci in packages/sitetile/astro)' }, () => {
    const min = minify(src);
    assert.ok(min.split('\n').filter(Boolean).length <= 2, 'esbuild did not minify onto one line');
    const total = [...expectations(src).values()].reduce((n, rules) => n + rules.get(rule), 0);
    assert.deepEqual(countRules(scanSource(min)), { [rule]: total });
  });
}

test('RED: escaped spellings — unicode escapes in identifiers and escapes in strings', () => {
  const bs = String.fromCharCode(92); // built at run time: this file's own text stays plain
  const cases = [
    [`${bs}u0065val(x)`, 'eval'],
    [`${bs}u{65}val(x)`, 'eval'],
    [`document.${bs}u0063ookie = "a=1"`, 'cookie-write'],
    [`document["${bs}x63ookie"] = "a=1"`, 'cookie-write'],
    [`document.createElement("${bs}u0073cript")`, 'script-element'],
    [`new ${bs}u0057orker(u)`, 'worker'],
  ];
  for (const [src, rule] of cases) assert.deepEqual(scanSource(src).map((f) => f.rule), [rule], src);
});

test('RED: a line separator inside a string (legal since ES2019) does not end the string and hide what follows', () => {
  const ls = String.fromCharCode(0x2028), ps = String.fromCharCode(0x2029);
  // A lexer that ended the first string at the separator would read `"; eval(code); const b = "` as
  // the string, and the eval in it as text.
  assert.deepEqual(scanSource(`const a = "x${ls}y"; eval(code); const b = "z";`).map((f) => f.rule), ['eval']);
  assert.deepEqual(scanSource(`const a = 'x${ps}y'; eval(code); const b = 'z';`).map((f) => f.rule), ['eval']);
});

// ── Clean ────────────────────────────────────────────────────────────────────────────────────────

test('GREEN: the clean fixture — near misses, and forbidden text in comments, strings, templates and regexes', () => {
  const src = fs.readFileSync(CLEAN, 'utf8');
  assert.deepEqual(scanSource(src), []);
  const result = scanFiles([CLEAN], { root: REPO });
  assert.equal(result.files, 1);
  assert.equal(report(result).ok, true);
});

test('GREEN: the clean fixture minified by esbuild', { skip: !ESBUILD && 'SKIPPED — no esbuild' }, () => {
  assert.deepEqual(scanSource(minify(fs.readFileSync(CLEAN, 'utf8'))), []);
});

// ── The repo's real coral bundles ────────────────────────────────────────────────────────────────

test('the real coral bundles pass with the real exception list, and the list has no dead entry', async () => {
  const bundles = await coralBundles();
  const { CORALS } = await import(path.join(REPO, 'packages/dynamic-corals/corals.mjs'));
  assert.equal(bundles.length, Object.keys(CORALS).length);
  for (const b of bundles) assert.ok(fs.statSync(b).size > 500, `${b} is missing or empty: the scan would pass on nothing`);
  const result = await scan();
  assert.equal(result.files, bundles.length);
  assert.deepEqual(result.failures, [], report(result).text);
  assert.deepEqual(result.dead, [], 'a dead exception: remove it from scripts/runtime-scan.exceptions.json');
  assert.deepEqual(result.short, [], 'an exception allows more occurrences than there are: lower its count');
  assert.equal(report(result).ok, true);
});

test('the real coral bundles minified by esbuild find exactly what the unminified ones find', { skip: !ESBUILD && 'SKIPPED — no esbuild' }, async () => {
  for (const b of await coralBundles()) {
    const src = fs.readFileSync(b, 'utf8');
    assert.deepEqual(countRules(scanSource(minify(src))), countRules(scanSource(src)), path.relative(REPO, b));
  }
});

test('the CLI: green on the corals and on the clean fixture, red naming file:line on a forbidden fixture, red on no files', () => {
  const run = (...args) => spawnSync(process.execPath, [SCAN, ...args], { encoding: 'utf8' });
  const corals = run();
  assert.equal(corals.status, 0, corals.stdout + corals.stderr);
  assert.match(corals.stdout, /✓ runtime scan: \d+ file\(s\)/);
  const clean = run('--exceptions', 'none', path.dirname(CLEAN));
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  const red = run('--exceptions', 'none', path.join(FORBIDDEN, 'eval.js'));
  assert.equal(red.status, 1);
  assert.match(red.stdout, /✗ test\/fixtures\/runtime-scan\/forbidden\/eval\.js:2:1  eval/);
  const empty = run('--exceptions', 'none', scratch());
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /nothing was checked/);
});

// ── Exceptions ───────────────────────────────────────────────────────────────────────────────────

const LOADER = 'import(new URL("./part.js", import.meta.url).href);\n';
const loaderTree = () => {
  const root = scratch();
  fs.mkdirSync(path.join(root, 'a'), { recursive: true });
  fs.mkdirSync(path.join(root, 'b'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'loader.js'), LOADER);
  fs.writeFileSync(path.join(root, 'b', 'loader.js'), LOADER);
  return root;
};
const EXC = { file: 'a/loader.js', rule: 'dynamic-import', construct: 'import(new URL("./part.js",import.meta.url).href)', reason: 'the loader imports its sibling, resolved against its own URL' };

test('an exception excuses exactly its construct in exactly its file, as many times as its count', () => {
  const root = loaderTree();
  const files = [path.join(root, 'a', 'loader.js'), path.join(root, 'b', 'loader.js')];
  const r = scanFiles(files, { root, exceptions: [EXC] });
  assert.equal(r.excepted.length, 1);
  assert.deepEqual(r.failures.map((f) => f.file), ['b/loader.js']);
  // the same construct twice in the excused file: the second one is not excused
  fs.writeFileSync(files[0], LOADER + LOADER);
  assert.equal(scanFiles([files[0]], { root, exceptions: [EXC] }).failures.length, 1);
  assert.equal(scanFiles([files[0]], { root, exceptions: [{ ...EXC, count: 2 }] }).failures.length, 0);
  // a different construct of the same rule in the excused file is not excused
  fs.writeFileSync(files[0], 'import(new URL("./other.js", import.meta.url).href);\n');
  assert.equal(scanFiles([files[0]], { root, exceptions: [EXC] }).failures.length, 1);
  // the construct matches minified or pretty, whatever quotes: it is the scan's own spelling
  fs.writeFileSync(files[0], "import( new URL( './part.js' , import.meta.url ).href )\n");
  assert.equal(scanFiles([files[0]], { root, exceptions: [EXC] }).failures.length, 0);
});

test('RED: a dead exception — one that matches nothing — fails the scan', () => {
  const root = loaderTree();
  const r = scanFiles([path.join(root, 'a', 'loader.js')], { root, exceptions: [EXC, { ...EXC, file: 'c/loader.js' }] });
  assert.equal(r.failures.length, 0);
  assert.equal(r.dead.length, 1);
  const { ok, text } = report(r);
  assert.equal(ok, false);
  assert.match(text, /dead exception #2 \(c\/loader\.js, dynamic-import\) matches nothing/);
  // and an exception allowing more occurrences than there are
  const s = scanFiles([path.join(root, 'a', 'loader.js')], { root, exceptions: [{ ...EXC, count: 3 }] });
  assert.equal(report(s).ok, false);
  assert.match(report(s).text, /allows 3 but matched 1/);
});

test('RED: a dead exception through the CLI, against the same files', () => {
  const root = loaderTree();
  const file = path.join(root, 'exceptions.json');
  fs.writeFileSync(file, JSON.stringify({ exceptions: [EXC, { ...EXC, rule: 'eval', construct: 'eval(x)' }] }));
  const r = spawnSync(process.execPath, [SCAN, '--root', root, '--exceptions', file, path.join(root, 'a')], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /dead exception #2/);
  const ok = spawnSync(process.execPath, [SCAN, '--root', root, '--exceptions', file, '--no-dead-check', path.join(root, 'a')], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout);
});

test('an exception must be narrow: a literal file name, a known rule, a construct, a one-line reason', () => {
  assert.deepEqual(validateExceptions([EXC]), []);
  assert.deepEqual(validateExceptions([{ ...EXC, file: '**/loader.js' }]), []);
  const bad = (x) => validateExceptions([x]).join(' ');
  assert.match(bad({ ...EXC, file: 'a/*.js' }), /literal file name/);
  assert.match(bad({ ...EXC, file: '**' }), /literal file name/);
  assert.match(bad({ ...EXC, rule: 'everything' }), /unknown rule/);
  assert.match(bad({ ...EXC, construct: ' ' }), /no construct/);
  assert.match(bad({ ...EXC, reason: 'two\nlines' }), /one line/);
  assert.match(bad({ ...EXC, reason: '' }), /one line/);
  assert.match(bad({ ...EXC, count: 0 }), /count/);
  assert.match(bad({ ...EXC, files: 'x' }), /unknown key/);
});

test('the real exception list is valid', () => {
  assert.ok(Array.isArray(loadExceptions(DEFAULT_EXCEPTIONS)));
});

test('file patterns: `**` crosses directories, `*` does not', () => {
  assert.ok(globToRegExp('**/x.js').test('x.js'));
  assert.ok(globToRegExp('**/x.js').test('a/b/x.js'));
  assert.ok(globToRegExp('a/*/x.js').test('a/b/x.js'));
  assert.ok(!globToRegExp('a/*/x.js').test('a/b/c/x.js'));
  assert.ok(!globToRegExp('a/x.js').test('a/x.jsx'));
  assert.ok(!globToRegExp('a/x.js').test('a/xxjs'));
});

// ── Known false negatives ────────────────────────────────────────────────────────────────────────
// Each of these writes a cookie or runs code chosen by data, and the scan does NOT see it. They are
// asserted to pass so the list stays true: if one starts failing, the scan got better — move it to a
// forbidden fixture. The same list is in the scan's report of record (it is a tripwire, not a proof).
const KNOWN_FALSE_NEGATIVES = [
  ['a cookie written through an aliased setter', 'Object.getOwnPropertyDescriptor(Document.prototype, "cookie").set.call(document, "a=1")'],
  ['a cookie written through Reflect / defineProperty', 'Reflect.set(document, "cookie", "a=1")'],
  ['a computed property name built from pieces', 'document["coo" + "kie"] = "a=1"'],
  ['a property name held in a variable', 'document[k] = "a=1"; globalThis[n](code)'],
  ['a destructuring assignment target', '[document.cookie] = ["a=1"]'],
  ['document.domain through an alias of document', 'const d = document; d.domain = "example.com"'],
  ['eval through an alias held in another name', 'const g = globalThis; g.eval(code)'],
  ['the Function constructor reached through a function', '(() => {}).constructor("return 1")()'],
  ['async / generator function constructors', '(async () => {}).constructor("return 1")'],
  ['a timer handed a string held in a variable', 'const s = "tick()"; setTimeout(s, 1)'],
  ['a timer reached through call / apply', 'setTimeout.call(window, "tick()", 1)'],
  ['a script element made from a tag name in a variable', 'const t = "script"; document.createElement(t)'],
  ['a script element made by parsing HTML that runs', 'document.createRange().createContextualFragment("<script src=x.js></script>")'],
  ['document.write of a script tag', 'document.write("<script src=x.js></script>")'],
  ['an iframe given its document as a string', 'frame.srcdoc = html'],
  ['a src set through Object.assign or a property bag', 'Object.assign(s, { src: url })'],
  ['setAttribute with a computed attribute name', 'el.setAttribute(name, url)'],
  ['a javascript: URL navigated to', 'location.href = "javascript:" + code'],
  ['a worklet module', 'CSS.paintWorklet.addModule(url); ctx.audioWorklet.addModule(url)'],
  ['a service worker registered through an alias created elsewhere', 'const c = navigator; c["service" + "Worker"].register(u)'],
  ['WebAssembly compiled from fetched bytes', 'WebAssembly.instantiateStreaming(fetch(url))'],
  ['an import map or module preload added to the page', 'document.head.append(Object.assign(document.createElement("link"), { rel: "modulepreload", href: url }))'],
];

test('the known false negatives are still not seen (this list is documentation that runs)', () => {
  for (const [what, src] of KNOWN_FALSE_NEGATIVES) assert.deepEqual(scanSource(src), [], `${what} — the scan sees it now: move it to a fixture`);
});

test('the tokenizer limits that are known: a regex after `)` and a division after `}`', () => {
  // `if (x) /re/` — a regex where a division usually is; a quote in it opens a "string" that hides code.
  assert.deepEqual(scanSource("if (x) /'/.test(s); eval(code); a = '"), []);
  // the same code with a statement boundary the tokenizer can see is found
  assert.deepEqual(scanSource("if (x) { /'/.test(s) } eval(code);").map((f) => f.rule), ['eval']);
});
