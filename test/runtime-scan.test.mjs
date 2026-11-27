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
  DEFAULT_EXCEPTIONS, spell,
} = await import(SCAN);
const FIXTURES = path.join(HERE, 'fixtures', 'runtime-scan');
const FORBIDDEN = path.join(FIXTURES, 'forbidden');
const CLEAN = path.join(FIXTURES, 'clean', 'clean.js');

const made = [];
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-scan-')); made.push(d); return d; };

// esbuild, found the way packages/dynamic-corals/build.mjs finds it. Without it the minified half of
// each check below SKIPS BY NAME: "I could not look" must not print the same thing as "I looked".
// ESBUILD=none runs it as a machine without esbuild would (scripts/test.sh then names the skips).
const ESBUILD = process.env.ESBUILD === 'none' ? undefined : [process.env.ESBUILD, path.join(REPO, 'packages/sitetile/astro/node_modules/.bin/esbuild'),
  path.join(REPO, 'node_modules/.bin/esbuild')].filter(Boolean).find((p) => fs.existsSync(p));
const minify = (src) => execFileSync(ESBUILD, ['--minify', '--format=esm', '--log-level=error', '--loader=js'],
  { input: src, encoding: 'utf8', stdio: 'pipe' });

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

  if (rule === 'unscannable') {
    // what this rule finds is not JavaScript, so no build emits it: esbuild must refuse the fixture
    test('unscannable — its fixture is not JavaScript: esbuild refuses it', { skip: !ESBUILD && 'SKIPPED — no esbuild (set ESBUILD, or npm ci in packages/sitetile/astro)' }, () => {
      assert.throws(() => minify(src));
    });
    continue;
  }
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
  assert.match(report(s).text, /allows 3 per file but matched 1 in a\/loader\.js/);
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

test('RED: the CLI refuses an invalid exception file, a missing one and a missing target with one line, not a stack trace', () => {
  const dir = scratch();
  const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
  const cases = [
    [write('wildcard.json', JSON.stringify({ exceptions: [{ ...EXC, file: '**' }] })), /literal file name/],
    [write('two.json', JSON.stringify({ exceptions: [{ ...EXC, rule: 'nope' }, { ...EXC, reason: '' }] })), /exception #1: unknown rule.*exception #2: the reason/],
    [write('broken.json', '{ "exceptions": [ '), /not valid JSON/],
    [write('null.json', 'null'), /not an array/],
    [path.join(dir, 'absent.json'), /cannot read/],
  ];
  for (const [file, why] of cases) {
    const r = spawnSync(process.execPath, [SCAN, '--exceptions', file, CLEAN], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${file}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout, '', file);
    const lines = r.stderr.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `${file}: not one line:\n${r.stderr}`);
    assert.match(lines[0], /^runtime-scan: /, file);
    assert.match(lines[0], why, file);
    assert.ok(lines[0].includes(file), `${file}: the line does not name the file`);
  }
  const missing = spawnSync(process.execPath, [SCAN, '--exceptions', 'none', path.join(dir, 'no-such-dir')], { encoding: 'utf8' });
  assert.equal(missing.status, 2, missing.stderr);
  assert.deepEqual(missing.stderr.split('\n').filter(Boolean).length, 1, missing.stderr);
  assert.match(missing.stderr, /^runtime-scan: .*no-such-dir/);
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
  ['a computed property name built from pieces', 'document["coo" + "kie"] = "a=1"; window["ev" + "al"](code)'],
  ['a script element made from a tag name built from pieces', 'document.createElement("scr" + "ipt")'],
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
  ['a timer taken out of the global object by destructuring', 'const { setTimeout: t } = window; t("tick()", 1)'],
  ['a timer reached through an array or a property bag', '[setTimeout][0]("tick()", 1); ({ t: setInterval }).t("tick()", 1)'],
  ['a conditional tag name or attribute name with a variable arm', 'document.createElement(f ? t : "div"); el.setAttribute(f ? n : "href", u)'],
  ['a destructuring key that is computed', 'const { ["ev" + "al"]: e } = globalThis; e(code)'],
  ['an import map or module preload added to the page', 'document.head.append(Object.assign(document.createElement("link"), { rel: "modulepreload", href: url }))'],
];

test('the known false negatives are still not seen (this list is documentation that runs)', () => {
  for (const [what, src] of KNOWN_FALSE_NEGATIVES) assert.deepEqual(scanSource(src), [], `${what} — the scan sees it now: move it to a fixture`);
});

// ── Regex or division ────────────────────────────────────────────────────────────────────────────
// A `/` read the wrong way hides code: a regex taken for a division lets the quote inside it open a
// "string", and a division taken for a regex swallows everything up to the next `/` on the line. On a
// one-line minified bundle either span can be long, so each case below hides an `eval` behind it.

test('RED: a `/` after a postfix `++` / `--` divides; after a prefix one it starts a regex', () => {
  const evals = (src) => assert.deepEqual(scanSource(src).map((f) => f.rule), ['eval'], src);
  evals('a++/2;eval(s);b/1');
  evals('a--/2;eval(s);b/1');
  evals('x[i]++/2;eval(s);b/1');
  evals('f(a)--/2;eval(s);b/1');
  // prefix: the operand is still to come, so the `/` opens a regex and its quote is not a string
  evals("++/'/.lastIndex;eval(s);'x'");
  evals("x=--/'/.lastIndex;eval(s);'x'");
  // a line break before `++` makes it prefix (no line break is allowed before a postfix one)
  evals("a\n++/'/.lastIndex;eval(s);'x'");
});

test('RED: a `/` after the `)` of `if` / `for` / `while` / `with` starts a regex; after any other `)` it divides', () => {
  const evals = (src) => assert.deepEqual(scanSource(src).map((f) => f.rule), ['eval'], src);
  evals("if(x)/'/.test(s);eval(s);var q='x'");
  evals("if (f(x)) /'/.test(s); eval(s); var q = 'x'");
  evals("for(;;)/'/.test(s);eval(s);'x'");
  evals("for await(const a of b)/'/.test(s);eval(s);'x'");
  evals("while(a[0])/'/.test(s);eval(s);'x'");
  evals("with(o)/'/.test(s);eval(s);'x'");
  evals("do x();while(y)/'/.test(s);eval(s);'x'"); // after do-while a semicolon is inserted: a regex
  evals("if(a)if(b)/'/.test(s);eval(s);'x'");
  // a division after the `)` of a call, a group, or a method that is merely NAMED like a keyword
  evals('f(a)/2;eval(s);b/1');
  evals('var a=(b)/2;eval("x/y")');
  evals('o.if(a)/2;eval(s);b/1');
  evals('o?.while(a)/2;eval(s);b/1');
  evals('if((a)/2)eval(s);b/1');
});

test('the tokenizer limit that is known: a `/` after `}` is read as a regex start', () => {
  // A block ends at `}` far more often than an object literal that is then divided; telling them apart
  // needs a parser. The division case hides what follows up to the next `/` on the line.
  assert.deepEqual(scanSource('var x={a:1}/2;eval(s);var y=4/2'), []);
  // the block case, the common one, is read right
  assert.deepEqual(scanSource("if(a){b()}/'/.test(c);eval(s);'x'").map((f) => f.rule), ['eval']);
});

test('the false positive that is known: a method named like a forbidden global, defined over a line break', () => {
  // `name(…) {` on ONE line can only be a definition; across a line break it can also be a call
  // followed by a block, so it is reported. Formatters and minifiers keep the `{` on the line.
  assert.deepEqual(scanSource('class A { eval(x)\n{ return x } }').map((f) => f.rule), ['eval']);
  assert.deepEqual(scanSource('class A { eval(x) { return x } }'), []);
});

// ── Security review, round 1 ─────────────────────────────────────────────────────────────────────
// One test per claim of the review, written before the fix and run against the code it reviewed:
// red where the claim held, kept as a passing pin where it did not. The inputs are the review's own.
const rulesOf = (src) => scanSource(src).map((f) => f.rule);
const evalsOnly = (src) => assert.deepEqual(rulesOf(src), ['eval'], src);

test('RED (review a, P1): an HTML-like comment is a comment in a classic script, and is itself reported', () => {
  // `<!--` and a `-->` that starts a line are line comments in a classic script (Annex B) and
  // operators in a module: the scan cannot know which one runs, so it says so, and reads on.
  assert.deepEqual(rulesOf('<!-- /*\neval(s);'), ['unscannable', 'eval']);
  assert.deepEqual(rulesOf('<!-- `\neval(s);'), ['unscannable', 'eval']);
  assert.deepEqual(rulesOf('x = 1\n--> /*\neval(s);'), ['unscannable', 'eval']);
  // not at the start of a line, `-->` is `--` and `>`
  assert.deepEqual(rulesOf('x-->0;eval(s)'), ['eval']);
});

test('RED (review a, P1): unterminated input fails closed — a comment, template, string or regex that never ends is a finding', () => {
  assert.deepEqual(rulesOf('/* eval(s);'), ['unscannable']);
  assert.deepEqual(rulesOf('`abc eval(s)'), ['unscannable']);
  assert.deepEqual(rulesOf('var a = `${b}\neval(s);'), ['unscannable']);
  assert.deepEqual(rulesOf("var a = 'abc;\neval(s);"), ['unscannable', 'eval']);
  assert.deepEqual(rulesOf('var a = "abc;\neval(s);'), ['unscannable', 'eval']);
  assert.deepEqual(rulesOf('x = /abc;\neval(s)'), ['unscannable', 'eval']);
  // terminated ones are not findings
  assert.deepEqual(rulesOf('/* a */ `b${c}d` + "e" + /f/.source'), []);
});

test('RED (review a, P1): a `/` after a keyword-named property, after `of` as a name, and after `export default`', () => {
  evalsOnly('o.in/2;eval(s);b/1');
  evalsOnly('o?.in/2;eval(s);b/1');
  evalsOnly('e.default/2;eval(s);b/1');
  evalsOnly('o.return/2;eval(s);b/1');
  evalsOnly('var of=4;of/2;eval(s);b/1');
  evalsOnly("export default /'/.test(s);eval(s);'x'");
  // pins: `of` in a for head is the keyword, and a regex may follow it
  evalsOnly("for(const a of /'/.exec(s))eval(s);'x'");
  evalsOnly("for(const a in /'/)eval(s);'x'");
});

test('RED (review a, P2): an identifier unicode escape with leading zeros is decoded', () => {
  const bs = String.fromCharCode(92);
  evalsOnly(`${bs}u{0000000065}val(s)`);
  evalsOnly(`${bs}u{000000000000000000065}val(s)`);
});

test('RED (review b, P1): the six rules that print a reference print the construct, not an empty string', () => {
  const constructs = (src) => scanSource(src).map((f) => `${f.rule} ${f.construct}`);
  assert.deepEqual(constructs('eval(x)'), ['eval eval(x)']);
  assert.deepEqual(constructs('window.eval(x)'), ['eval window.eval(x)']);
  assert.deepEqual(constructs('new Function("a")'), ['function-constructor new Function("a")']);
  assert.deepEqual(constructs("setTimeout('a()',1)"), ['string-timer setTimeout("a()",1)']);
  assert.deepEqual(constructs('new window.Worker(u)'), ['worker new window.Worker(u)']);
  assert.deepEqual(constructs('importScripts(u)'), ['import-scripts importScripts(u)']);
  assert.deepEqual(constructs('self.caches.open("v1")'), ['cache-storage self.caches.open']);
});

test('RED (review b, P1): `Function?.(…)`, `Function.prototype.constructor(…)` and `Function.constructor(…)`', () => {
  assert.deepEqual(rulesOf("Function?.('return 1')()"), ['function-constructor']);
  assert.deepEqual(rulesOf("Function.prototype.constructor('return 1')()"), ['function-constructor']);
  assert.deepEqual(rulesOf("Function.constructor('return 1')()"), ['function-constructor']);
  // pins: what is not the constructor still passes
  assert.deepEqual(rulesOf('Function.prototype.toString.call(f)'), []);
  assert.deepEqual(rulesOf('f instanceof Function'), []);
});

test('RED (review b, P2): destructuring renames, chained globals, for-of targets, grouped and conditional timer and element arguments', () => {
  const cases = [
    ['const{eval:e}=globalThis;e(x)', 'eval'],
    ['const{Worker:W}=window;new W(u)', 'worker'],
    ["const{caches:c}=window;c.open('v1')", 'cache-storage'],
    ["const{cookieStore:c}=window;c.set('a','1')", 'cookie-store'],
    ['const{importScripts:f}=self;f(u)', 'import-scripts'],
    ['let a, {b, c: {eval: e}} = globalThis', 'eval'],
    ['({eval:e}=globalThis)', 'eval'],
    ['function f({eval:e}){return e}', 'eval'],
    ['const f=({Worker:W})=>new W(u)', 'worker'],
    ['window.self.eval(x)', 'eval'],
    ['document.defaultView.eval(x)', 'eval'],
    ["el.ownerDocument.domain='x'", 'document-domain'],
    ['frame.contentDocument.domain', 'document-domain'],
    ['for(document.cookie of x);', 'cookie-write'],
    ['for(document.cookie in x);', 'cookie-write'],
    ["(0,setTimeout)('a()',0)", 'string-timer'],
    ["(0,window.setInterval)('a()',0)", 'string-timer'],
    ["setTimeout(f?'a()':'b()',0)", 'string-timer'],
    ["setTimeout(f?g:'b()',0)", 'string-timer'],
    ["document.createElement(f?'script':'div')", 'script-element'],
    ["el.setAttribute(f?'src':'href',u)", 'script-src'],
  ];
  for (const [src, rule] of cases) assert.deepEqual(rulesOf(src), [rule], src);
  // pins: an object literal that merely has such a key, and a timer handed a function, still pass
  assert.deepEqual(rulesOf('const o={eval:1,Worker:2,caches:3};f({importScripts:4})'), []);
  assert.deepEqual(rulesOf("setTimeout(()=>f('a'),0);setTimeout(function(){g('b')},0)"), []);
  assert.deepEqual(rulesOf("document.createElement(f?'div':'span')"), []);
});

test('RED (review c, P1): an exception can name an eval / Function / timer / worker / importScripts / caches construct', () => {
  const root = scratch();
  const file = path.join(root, 'w.js');
  fs.writeFileSync(file, 'eval(x);new Worker(u);caches.open("v")\n');
  const exceptions = [
    { file: 'w.js', rule: 'eval', construct: 'eval(x)', reason: 'r' },
    { file: 'w.js', rule: 'worker', construct: 'new Worker(u)', reason: 'r' },
    { file: 'w.js', rule: 'cache-storage', construct: 'caches.open', reason: 'r' },
  ];
  assert.deepEqual(validateExceptions(exceptions), []);
  const r = scanFiles([file], { root, exceptions });
  assert.deepEqual(r.failures, []);
  assert.equal(r.excepted.length, 3);
});

test('RED (review c, P2): an exception names the WHOLE construct — no truncation, and the right-hand side of an assignment', () => {
  const root = scratch();
  const file = path.join(root, 'l.js');
  const long = 'x'.repeat(300);
  fs.writeFileSync(file, `import(a+"${long}"+b);import(a+"${long}"+evil);\n`);
  const exc = { file: 'l.js', rule: 'dynamic-import', construct: `import(a+"${long}"+b)`, reason: 'r' };
  const r = scanFiles([file], { root, exceptions: [exc] });
  assert.equal(r.excepted.length, 1);
  assert.deepEqual(r.failures.map((f) => f.construct), [`import(a+"${long}"+evil)`]);
  // the assigned value is part of the construct, so an exception for one src does not cover another
  fs.writeFileSync(file, 'e.src=u;e.src=evil;document.cookie="a=1";document.cookie=v\n');
  assert.deepEqual(scanSource(fs.readFileSync(file, 'utf8')).map((f) => f.construct),
    ['e.src=u', 'e.src=evil', 'document.cookie="a=1"', 'document.cookie=v']);
  const s = scanFiles([file], { root, exceptions: [{ file: 'l.js', rule: 'script-src', construct: 'e.src=u', reason: 'r' }] });
  assert.deepEqual(s.failures.map((f) => f.construct), ['e.src=evil', 'document.cookie="a=1"', 'document.cookie=v']);
  // the value ends where the expression does, minified or pretty
  assert.deepEqual(scanSource('a.src = b ? c : d, f()\ng.src = h + "/x.js"\nk()').map((f) => f.construct), ['a.src=b?c:d', 'g.src=h+"/x.js"']);
  // a long construct is shortened in the report only
  fs.writeFileSync(file, `import(a+"${long}"+b);\n`);
  const text = report(scanFiles([file], { root })).text;
  assert.ok(!text.includes(long), 'the report prints the whole 300-character construct');
});

test('RED (review c, P2): a `**` pattern can match several files, and its count is per matched file', () => {
  const root = loaderTree();
  const files = [path.join(root, 'a', 'loader.js'), path.join(root, 'b', 'loader.js')];
  const exc = { ...EXC, file: '**/loader.js' };
  assert.deepEqual(validateExceptions([exc]), []);
  const r = scanFiles(files, { root, exceptions: [exc] });
  assert.deepEqual(r.failures, []);
  assert.equal(r.excepted.length, 2);
  // one file over its count fails, whatever the other file has
  fs.writeFileSync(files[0], LOADER + LOADER);
  assert.deepEqual(scanFiles(files, { root, exceptions: [exc] }).failures.map((f) => f.file), ['a/loader.js']);
  // a file under its count is reported short, by name
  const s = scanFiles(files, { root, exceptions: [{ ...exc, count: 2 }] });
  assert.deepEqual(s.failures, []);
  assert.deepEqual(s.short.map((x) => [x.file, x.matched]), [['b/loader.js', 1]]);
  assert.match(report(s).text, /b\/loader\.js/);
});

test('RED (review e): every finding of every rule names a non-empty construct that is the text of a span of the source', () => {
  // `start`/`end` are source offsets; the construct is that span as the scan spells it (strings in
  // double quotes, `x['y']` as `x.y`, no blank space), and a span of canonical source IS the construct.
  const sources = fixtureRules.map((rule) => fs.readFileSync(path.join(FORBIDDEN, `${rule}.js`), 'utf8'));
  if (ESBUILD) for (const rule of fixtureRules) if (rule !== 'unscannable') sources.push(minify(fs.readFileSync(path.join(FORBIDDEN, `${rule}.js`), 'utf8')));
  const seen = new Set();
  for (const src of sources) {
    for (const f of scanSource(src)) {
      seen.add(f.rule);
      assert.ok(typeof f.construct === 'string' && f.construct.trim(), `${f.rule} at ${f.line}:${f.col}: empty construct`);
      assert.ok(Number.isInteger(f.start) && f.end > f.start && f.end <= src.length, `${f.rule} at ${f.line}:${f.col}: no span`);
      const span = src.slice(f.start, f.end);
      assert.equal(spell(span), f.construct, `${f.rule} at ${f.line}:${f.col}: the span ${JSON.stringify(span)} does not read as the construct`);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(RULES).sort(), 'a rule produced no finding to check');
  // in canonical source the construct is literally a substring
  const canonical = 'eval(x);new Function("a");setTimeout("a()",1);new Worker(u);importScripts(u);caches.open("v");e.src=u;document.cookie="a=1"';
  for (const f of scanSource(canonical)) assert.ok(canonical.includes(f.construct), `${f.rule}: ${JSON.stringify(f.construct)}`);
  assert.equal(scanSource(canonical).length, 8);
});

test('RED (review c, P3): a file pattern ending in a slash is refused, and an option without its value is a usage error', () => {
  const bad = (x) => validateExceptions([x]).join(' ');
  assert.match(bad({ ...EXC, file: 'a/**/' }), /literal file name/);
  assert.match(bad({ ...EXC, file: 'a/' }), /literal file name/);
  const run = (...args) => spawnSync(process.execPath, [SCAN, ...args], { encoding: 'utf8' });
  for (const args of [['--exceptions', '--json', CLEAN], [CLEAN, '--exceptions'], ['--root', '--json', CLEAN], [CLEAN, '--root']]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^runtime-scan: --(exceptions|root) needs a value/, args.join(' '));
  }
});
