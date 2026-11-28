// The script inventory and its golden (astro/script-inventory.mjs).
//   run: node packages/sitetile/script-inventory.test.mjs   (globbed into scripts/test.sh)
//
// The golden itself is checked against a real build by astro/smoke-build.mjs, which also flips one
// byte in a copy of that build and requires the check to go red. What is here needs no build: the
// reader on pages written for the purpose, every kind of difference the check must name, and the
// committed golden's own shape — and the rules of the switch that regenerates it: writing the golden
// is never a passing run, and is refused outright where `CI` is set.
//
// It needs parse5 from the renderer's dependencies and SAYS SO when they are absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOLDEN_PATH, REGENERATE, pageScripts, scriptByteRanges, scriptInventory, inventoryCounts,
  serializeInventory, compareInventory, checkScriptInventory, writeScriptGolden,
  GOLDEN_SWITCH, REGENERATED_EXIT, REFUSED_EXIT, goldenMode, smokeExitCode,
} from './astro/script-inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let parse = null;
try { ({ parse } = await import(new URL('./astro/node_modules/parse5/dist/index.js', import.meta.url).href)); } catch { parse = null; }
if (!parse) {
  console.log('  · script-inventory tests SKIPPED — no packages/sitetile/astro/node_modules (run npm install there): the inventory reader was NOT exercised');
}
const needsParser = { skip: parse ? false : 'renderer dependencies absent' };

const sha = (s) => 'sha256-' + createHash('sha256').update(Buffer.from(s, 'utf8')).digest('base64');
const BUILD = { SCRIPT_BASE: null };

const HOME = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<script type="application/ld+json">{"@type":"WebSite","name":"caf\u00e9"}</script>',
  '<script>window.a=1;</script>',
  '<script defer src="https://third.example/beacon.js" data-token=\'{"t":"abc"}\'></script>',
  '</head><body>',
  '<!-- <script>not a script: inside a comment</script> -->',
  '<textarea><script>not a script: inside a textarea</script></textarea>',
  '<p title="<script>not a script: inside an attribute</script>">text</p>',
  '<script type="module">\n  import("/x.js");\n  // trailing space kept \n</script>',
  '<template><script>inTemplate()</script></template>',
  '<script type="module" src="/_astro/page.abc123.js"></script>',
  '<script data-label="\u8a9e" async></script>',
  '</body></html>',
].join('\n');

/** A small build output: three pages and two .js files. Returns its directory. */
function fixtureDist() {
  const dir = mkdtempSync(join(tmpdir(), 'script-inventory-'));
  mkdirSync(join(dir, 'blog', 'post'), { recursive: true });
  mkdirSync(join(dir, '_astro'));
  writeFileSync(join(dir, 'index.html'), HOME);
  writeFileSync(join(dir, 'blog', 'index.html'), '<!doctype html><title>b</title><script>window.b=2;</script><script>window.b=2;</script>');
  writeFileSync(join(dir, 'blog', 'post', 'index.html'), '<!doctype html><title>no scripts</title><p>plain</p>');
  writeFileSync(join(dir, '_astro', 'page.abc123.js'), 'export const page = 1;\n');
  writeFileSync(join(dir, '_astro', 'lazy.def456.js'), 'export const lazy = 2;\n');
  writeFileSync(join(dir, 'not-a-page.txt'), '<script>ignored: not an .html file</script>');
  return dir;
}

/** fixtureDist() plus a golden written for it; runs `fn(dist, goldenPath)` and cleans up. */
function withGolden(fn) {
  const dist = fixtureDist();
  const scratch = mkdtempSync(join(tmpdir(), 'script-inventory-golden-'));
  const goldenPath = join(scratch, 'golden.json');
  try {
    writeScriptGolden(dist, parse, { goldenPath, build: BUILD });
    return fn(dist, goldenPath);
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}
const check = (dist, goldenPath) => checkScriptInventory(dist, parse, { goldenPath, build: BUILD });

test('a page\'s scripts: source order, exact bytes, attributes; nothing that only looks like a script', needsParser, () => {
  const got = pageScripts(Buffer.from(HOME, 'utf8'), parse);
  const moduleText = '\n  import("/x.js");\n  // trailing space kept \n';
  assert.deepEqual(got, [
    { inline: sha('{"@type":"WebSite","name":"caf\u00e9"}'), bytes: 34, attrs: { type: 'application/ld+json' } },
    { inline: sha('window.a=1;'), bytes: 11, attrs: {} },
    { src: 'https://third.example/beacon.js', attrs: { defer: '', 'data-token': '{"t":"abc"}' } },
    { inline: sha(moduleText), bytes: moduleText.length, attrs: { type: 'module' } },
    { inline: sha('inTemplate()'), bytes: 12, attrs: {} },
    { src: '/_astro/page.abc123.js', attrs: { type: 'module' } },
    { inline: sha(''), bytes: 0, attrs: { 'data-label': '\u8a9e', async: '' } },
  ]);
  // 34 bytes, not 33 characters: the hash and the length are of the file's bytes.
  assert.equal(Buffer.byteLength('{"@type":"WebSite","name":"caf\u00e9"}'), 34);
});

test('an unclosed script runs to the end of the file, and an external script with text keeps its hash', needsParser, () => {
  assert.deepEqual(pageScripts(Buffer.from('<p>x</p><script>open(', 'utf8'), parse), [{ inline: sha('open('), bytes: 5, attrs: {} }]);
  assert.deepEqual(pageScripts(Buffer.from('<script src="/a.js">fallback()</script>', 'utf8'), parse),
    [{ src: '/a.js', inline: sha('fallback()'), bytes: 10, attrs: {} }]);
});

test('the inventory of a build output: every .html page by path, every .js file by hash', needsParser, () => {
  const dist = fixtureDist();
  try {
    const inv = scriptInventory(dist, parse);
    assert.deepEqual(Object.keys(inv.pages), ['blog/index.html', 'blog/post/index.html', 'index.html']);
    assert.deepEqual(inv.pages['blog/post/index.html'], []);
    assert.deepEqual(Object.keys(inv.files), ['_astro/lazy.def456.js', '_astro/page.abc123.js']);
    assert.deepEqual(inv.files['_astro/page.abc123.js'], { sha256: sha('export const page = 1;\n'), bytes: 23 });
    assert.deepEqual(inventoryCounts(inv), {
      pages: 3, scripts: 9, inline: 7, external: 2, pagesWithoutScripts: 1, distinctInline: 6, distinctExternal: 2, jsFiles: 2,
    });
    // The file it writes is JSON, one script per line, and reads back as the same inventory.
    const text = serializeInventory(inv, BUILD);
    const back = JSON.parse(text);
    assert.deepEqual(back.pages, inv.pages);
    assert.deepEqual(back.files, inv.files);
    assert.deepEqual(back.counts, inventoryCounts(inv));
    assert.deepEqual(back.variableParts, []);
    assert.equal(back.regenerate, REGENERATE);
    assert.equal(text.split('\n').filter((l) => /^ {6}\{/.test(l)).length, 9);
    assert.equal(serializeInventory(scriptInventory(dist, parse), BUILD), text, 'two readings of one output differ');
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('a clean copy of the output passes the check', needsParser, () => withGolden((dist, goldenPath) => {
  const copy = mkdtempSync(join(tmpdir(), 'script-inventory-copy-'));
  try {
    cpSync(dist, copy, { recursive: true });
    const r = check(copy, goldenPath);
    assert.deepEqual(r.differences, []);
    assert.equal(r.ok, true);
    assert.equal(r.counts.scripts, 9);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}));

test('🔴 one flipped byte in one inline script fails the check, naming the page and the script', needsParser, () => withGolden((dist, goldenPath) => {
  // Every byte of every inline script on the page, one at a time, in a copy of the output.
  const page = join(dist, 'index.html');
  const original = readFileSync(page);
  const ranges = scriptByteRanges(original, parse).filter((r) => !r.external && r.end > r.start);
  assert.deepEqual(ranges.map((r) => r.index), [0, 1, 3, 4]);
  let flips = 0;
  for (const r of ranges) {
    for (let at = r.start; at < r.end; at++) {
      const copy = Buffer.from(original);
      copy[at] ^= 0x01;
      // A flip that happens to spell an end tag or a start tag changes the page's structure, and
      // is then reported as a different number of scripts. Still red; just not this message.
      writeFileSync(page, copy);
      const got = check(dist, goldenPath);
      assert.equal(got.ok, false, `byte ${at} of script #${r.index + 1} was flipped and the check passed`);
      assert.ok(got.differences.length >= 1);
      assert.ok(got.differences.every((d) => d.startsWith('index.html: ')), got.differences.join('\n'));
      if (got.differences.length === 1 && /changed \(bytes\)/.test(got.differences[0])) {
        assert.ok(got.differences[0].startsWith(`index.html: script #${r.index + 1} of 7 changed (bytes)\n`), got.differences[0]);
        assert.match(got.differences[0], /golden: <script.*\(inline, \d+ bytes, sha256-/);
        assert.match(got.differences[0], /built: {2}<script.*\(inline, \d+ bytes, sha256-/);
      }
      flips++;
    }
  }
  assert.ok(flips > 100, `${flips} bytes flipped`);
  writeFileSync(page, original);
  assert.equal(check(dist, goldenPath).ok, true, 'restoring the byte did not restore green');
}));

test('every other kind of difference is named: attribute, src, added, removed, reordered, page, file', needsParser, () => withGolden((dist, goldenPath) => {
  const page = join(dist, 'index.html');
  const edit = (from, to, file = page) => {
    const before = readFileSync(file, 'utf8');
    assert.ok(before.includes(from), `the fixture has no ${from}`);
    writeFileSync(file, before.replace(from, to));
    const r = check(dist, goldenPath);
    writeFileSync(file, before);
    assert.equal(r.ok, false, `changing ${from} → ${to} passed`);
    return r.differences;
  };
  let d = edit('<script type="module">\n', '<script type="module" async>\n');
  assert.equal(d.length, 1);
  assert.match(d[0], /^index\.html: script #4 of 7 changed \(attributes\)\n/);
  d = edit('<script defer src=', '<script async src=');
  assert.match(d[0], /^index\.html: script #3 of 7 changed \(attributes\)\n/);
  d = edit('/_astro/page.abc123.js"', '/_astro/page.zzz999.js"');
  assert.match(d[0], /^index\.html: script #6 of 7 changed \(src\)\n {6}golden: <script src="\/_astro\/page\.abc123\.js" type="module">\n {6}built: {2}<script src="\/_astro\/page\.zzz999\.js" type="module">$/);
  d = edit('https://third.example/beacon.js', 'https://other.example/beacon.js');
  assert.match(d[0], /^index\.html: script #3 of 7 changed \(src\)\n/);
  d = edit('<script>window.a=1;</script>', '<script src="/a.js"></script>');
  assert.match(d[0], /^index\.html: script #2 of 7 changed \(inline\/external, bytes\)\n/);
  d = edit('</body>', '<script>added()</script></body>');
  assert.equal(d.length, 1);
  assert.match(d[0], /^index\.html: 8 scripts, the golden has 7\n {6}not in the golden \(built #8\): <script> \(inline, 7 bytes, sha256-/);
  d = edit('<script>window.a=1;</script>', '');
  assert.match(d[0], /^index\.html: 6 scripts, the golden has 7\n {6}not built \(golden #2\): <script> \(inline, 11 bytes, sha256-/);
  // the same scripts in another order: each moved position is named
  d = edit('<script>window.a=1;</script>\n<script defer src="https://third.example/beacon.js" data-token=\'{"t":"abc"}\'></script>',
    '<script defer src="https://third.example/beacon.js" data-token=\'{"t":"abc"}\'></script>\n<script>window.a=1;</script>');
  assert.deepEqual(d.map((x) => x.split('\n')[0]), [
    'index.html: script #2 of 7 changed (inline/external, bytes, attributes)',
    'index.html: script #3 of 7 changed (inline/external, bytes, attributes)',
  ]);
  // a second page: one of two identical scripts changes, and only that one is named
  d = edit('<script>window.b=2;</script><script>window.b=2;</script>', '<script>window.b=2;</script><script>window.b=3;</script>', join(dist, 'blog', 'index.html'));
  assert.equal(d.length, 1);
  assert.match(d[0], /^blog\/index\.html: script #2 of 2 changed \(bytes\)\n/);
  // a page that had none gains one
  d = edit('<p>plain</p>', '<p>plain</p><script>x()</script>', join(dist, 'blog', 'post', 'index.html'));
  assert.match(d[0], /^blog\/post\/index\.html: 1 scripts, the golden has 0\n/);

  // pages and files appearing and disappearing
  mkdirSync(join(dist, 'new'));
  writeFileSync(join(dist, 'new', 'index.html'), '<script>n()</script>');
  assert.deepEqual(check(dist, goldenPath).differences, ['new/index.html: a page the golden does not have (1 scripts)']);
  rmSync(join(dist, 'new'), { recursive: true });
  const post = readFileSync(join(dist, 'blog', 'post', 'index.html'));
  rmSync(join(dist, 'blog', 'post', 'index.html'));
  assert.deepEqual(check(dist, goldenPath).differences, ['blog/post/index.html: the page is in the golden but the build did not write it']);
  writeFileSync(join(dist, 'blog', 'post', 'index.html'), post);

  d = edit('lazy = 2', 'lazy = 3', join(dist, '_astro', 'lazy.def456.js'));
  assert.equal(d.length, 1);
  assert.match(d[0], /^_astro\/lazy\.def456\.js: the \.js file's bytes changed\n/);
  writeFileSync(join(dist, '_astro', 'extra.js'), 'x');
  assert.deepEqual(check(dist, goldenPath).differences, ['_astro/extra.js: a .js file the golden does not have (1 bytes)']);
  rmSync(join(dist, '_astro', 'extra.js'));
  const lazy = readFileSync(join(dist, '_astro', 'lazy.def456.js'));
  rmSync(join(dist, '_astro', 'lazy.def456.js'));
  assert.deepEqual(check(dist, goldenPath).differences, ['_astro/lazy.def456.js: the .js file is in the golden but the build did not write it']);
  writeFileSync(join(dist, '_astro', 'lazy.def456.js'), lazy);

  assert.equal(check(dist, goldenPath).ok, true, 'the fixture was not restored');
}));

test('a golden edited by hand, written for another build, or missing is red too', needsParser, () => withGolden((dist, goldenPath) => {
  const text = readFileSync(goldenPath, 'utf8');
  // a stale count: the same inventory in meaning, not the file the generator writes
  writeFileSync(goldenPath, text.replace('"scripts":9', '"scripts":8'));
  let r = check(dist, goldenPath);
  assert.equal(r.ok, false);
  assert.match(r.differences[0], /not what the generator writes/);
  // reformatted
  writeFileSync(goldenPath, JSON.stringify(JSON.parse(text), null, 2));
  assert.match(check(dist, goldenPath).differences[0], /not what the generator writes/);
  // written for a build with the setting on
  writeFileSync(goldenPath, text);
  r = checkScriptInventory(dist, parse, { goldenPath, build: { SCRIPT_BASE: 'https://scripts.example.net/corals' } });
  assert.equal(r.ok, false);
  assert.match(r.differences[0], /written for the build/);
  // missing: the check does not create it
  rmSync(goldenPath);
  r = check(dist, goldenPath);
  assert.equal(r.ok, false);
  assert.match(r.differences[0], /there is no golden/);
  assert.ok(r.differences[0].includes(REGENERATE));
  assert.equal(existsSync(goldenPath), false);
}));

test('a named variable part is the only thing not pinned', needsParser, () => {
  const dist = mkdtempSync(join(tmpdir(), 'script-inventory-var-'));
  const scratch = mkdtempSync(join(tmpdir(), 'script-inventory-golden-'));
  const goldenPath = join(scratch, 'golden.json');
  const page = (id, rest = 'run();') => `<!doctype html><title>t</title><script>window.build="${id}";${rest}</script>`;
  const parts = [{ name: 'build-id', pattern: 'window\\.build="[0-9a-f]{8}"', why: 'a fresh id on every build' }];
  try {
    writeFileSync(join(dist, 'index.html'), page('0123abcd'));
    // Without the part named, a second build with another id is red.
    writeScriptGolden(dist, parse, { goldenPath, build: BUILD });
    writeFileSync(join(dist, 'index.html'), page('89ef4567'));
    assert.equal(check(dist, goldenPath).ok, false);
    // Named in the golden: the id may vary. Regenerating keeps the list.
    const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
    golden.variableParts = parts;
    writeFileSync(goldenPath, JSON.stringify(golden));
    writeScriptGolden(dist, parse, { goldenPath, build: BUILD });
    assert.deepEqual(JSON.parse(readFileSync(goldenPath, 'utf8')).variableParts, parts);
    assert.equal(check(dist, goldenPath).ok, true);
    writeFileSync(join(dist, 'index.html'), page('0123abcd'));
    assert.equal(check(dist, goldenPath).ok, true);
    // …and nothing else may: a byte outside the named part, or a value the pattern does not match.
    writeFileSync(join(dist, 'index.html'), page('0123abcd', 'ruin();'));
    assert.equal(check(dist, goldenPath).ok, false);
    writeFileSync(join(dist, 'index.html'), page('0123abcd";evil();"'));
    assert.equal(check(dist, goldenPath).ok, false);
    writeFileSync(join(dist, 'index.html'), page('NOTHEX00'));
    assert.equal(check(dist, goldenPath).ok, false);
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

// No build and no parser needed: the committed file must be whole and self-consistent.
test('the committed golden is whole: counts match its pages, it names how to regenerate it, the setting is unset', () => {
  assert.equal(GOLDEN_PATH, join(HERE, 'astro', 'script-inventory.golden.json'));
  const text = readFileSync(GOLDEN_PATH, 'utf8');
  const golden = JSON.parse(text);
  assert.equal(golden.regenerate, REGENERATE);
  assert.equal(golden.build.SCRIPT_BASE, null, 'the golden is of a build with SCRIPT_BASE unset');
  assert.ok(Array.isArray(golden.variableParts));
  for (const part of golden.variableParts) {
    assert.ok(/^[a-z][a-z0-9-]*$/.test(part.name) && part.pattern && part.why, `a variable part needs a name, a pattern and a reason: ${JSON.stringify(part)}`);
    assert.doesNotThrow(() => new RegExp(part.pattern, 'g'));
  }
  assert.deepEqual(golden.counts, inventoryCounts(golden));
  assert.equal(serializeInventory(golden, golden.build), text, 'the golden is not in the form the generator writes');
  assert.ok(golden.counts.pages >= 20 && golden.counts.inline >= 20, JSON.stringify(golden.counts));
  for (const [page, scripts] of Object.entries(golden.pages)) {
    for (const s of scripts) {
      assert.ok(s.src !== undefined || /^sha256-[A-Za-z0-9+/]{43}=$/.test(s.inline), `${page}: ${JSON.stringify(s)}`);
    }
  }
});

// ── The regenerate switch ──────────────────────────────────────────────────────────────────────
// `SITETILE_SCRIPT_GOLDEN=write` makes the smoke write the golden from the build it has just made.
// A run that does that has compared the build with itself, so it must never be a passing run: left
// set by accident, the switch would turn the check into one that cannot fail.

test('🔴 the switch: unset is a check; "write" is a write, never under CI; anything else is refused', () => {
  assert.equal(GOLDEN_SWITCH, 'SITETILE_SCRIPT_GOLDEN');
  assert.ok(REGENERATE.includes(`${GOLDEN_SWITCH}=write`));
  assert.equal(goldenMode({}), 'check');
  assert.equal(goldenMode({ [GOLDEN_SWITCH]: '' }), 'check');
  assert.equal(goldenMode({ CI: 'true' }), 'check');
  assert.equal(goldenMode({ [GOLDEN_SWITCH]: 'write' }), 'write');
  assert.equal(goldenMode({ [GOLDEN_SWITCH]: 'write', CI: '' }), 'write');
  // Under CI the switch is refused, whatever CI is set to: nobody is there to read the diff.
  for (const ci of ['true', '1', 'yes', 'false', '0', ' ']) {
    assert.throws(() => goldenMode({ [GOLDEN_SWITCH]: 'write', CI: ci }), (e) => /refused/.test(e.message) && /\bCI\b/.test(e.message) && e.message.includes(GOLDEN_SWITCH),
      `the switch was accepted with CI=${JSON.stringify(ci)}`);
  }
  // Only the one spelling writes. A near miss is refused, not read as "check" — and not as "write".
  for (const v of ['WRITE', 'Write', 'write ', ' write', '1', 'true', 'yes', 'update', 'check', 'w']) {
    assert.throws(() => goldenMode({ [GOLDEN_SWITCH]: v }), (e) => /refused/.test(e.message) && e.message.includes(GOLDEN_SWITCH), `accepted ${JSON.stringify(v)}`);
    assert.throws(() => goldenMode({ [GOLDEN_SWITCH]: v, CI: 'true' }), /refused/);
  }
});

test('🔴 a run that wrote the golden never exits 0, whatever else it found', () => {
  assert.equal(smokeExitCode({ failed: 0, regenerated: false }), 0);
  assert.equal(smokeExitCode({ failed: 3, regenerated: false }), 1);
  assert.notEqual(REGENERATED_EXIT, 0);
  assert.notEqual(REGENERATED_EXIT, 1, 'a regenerated golden must be told apart from a failed check');
  assert.notEqual(REFUSED_EXIT, 0);
  assert.equal(smokeExitCode({ failed: 0, regenerated: true }), REGENERATED_EXIT);
  assert.equal(smokeExitCode({ failed: 2, regenerated: true }), 1);
  for (const failed of [0, 1, 313]) assert.notEqual(smokeExitCode({ failed, regenerated: true }), 0);
  // Anything that is not plainly "no failures" is a failure.
  for (const failed of [undefined, null, NaN, -1, '0']) assert.notEqual(smokeExitCode({ failed, regenerated: false }), 0);
  // The smoke's one exit goes through that function, and its one write is behind the switch.
  const smoke = readFileSync(join(HERE, 'astro', 'smoke-build.mjs'), 'utf8');
  assert.equal(smoke.match(/process\.exit\(/g).length, 2, 'the smoke has an exit this test does not know');
  assert.ok(smoke.includes('process.exit(REFUSED_EXIT)'));
  assert.ok(smoke.includes('process.exit(smokeExitCode({ failed: fail, regenerated: GOLDEN_MODE === \'write\' }))'));
  assert.equal(smoke.match(/writeScriptGolden\(/g).length, 1);
  assert.match(smoke, /if \(GOLDEN_MODE === 'write'\) \{\n\s*const wrote = writeScriptGolden\(/);
  assert.ok(!/process\.env\.SITETILE_SCRIPT_GOLDEN/.test(smoke), 'the smoke reads the switch somewhere other than goldenMode()');
});

// The real file, run for real, up to the point where it would start a build. `npx` is not on the
// PATH these runs are given, so a smoke that got as far as building would stop there, with another
// exit code and after printing its build line: nothing here can run a build or write the golden.
test('🔴 the smoke refuses the switch under CI before it builds or writes anything', needsParser, () => {
  const astro = join(HERE, 'astro');
  const before = readFileSync(GOLDEN_PATH);
  const beforeTime = statSync(GOLDEN_PATH).mtimeMs;
  const run = (extra) => {
    const env = { ...process.env, PATH: join(tmpdir(), 'no-such-directory-for-script-inventory-test'), ...extra };
    for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
    return spawnSync(process.execPath, ['smoke-build.mjs'], { cwd: astro, encoding: 'utf8', env, timeout: 120000 });
  };
  for (const [extra, says] of [
    [{ SITETILE_SCRIPT_GOLDEN: 'write', CI: 'true' }, /\bCI\b/],
    [{ SITETILE_SCRIPT_GOLDEN: 'write', CI: '1' }, /\bCI\b/],
    [{ SITETILE_SCRIPT_GOLDEN: 'yes', CI: undefined }, /"write"/],
  ]) {
    const r = run(extra);
    const said = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, REFUSED_EXIT, `expected the refusal's exit code, got ${r.status}:\n${said.slice(-1500)}`);
    assert.match(said, /refused/);
    assert.match(said, says);
    assert.ok(said.includes('SITETILE_SCRIPT_GOLDEN'));
    assert.ok(!/astro build/.test(said), `the smoke started its build before refusing:\n${said.slice(0, 600)}`);
    assert.ok(!/PASS/.test(said));
    assert.ok(readFileSync(GOLDEN_PATH).equals(before), 'the golden was rewritten');
    assert.equal(statSync(GOLDEN_PATH).mtimeMs, beforeTime, 'the golden was touched');
    assert.equal(existsSync(join(astro, 'src', 'themes', 'lilac.css')), false, 'the smoke staged its fixtures before refusing');
  }
});

// Nothing that runs unattended may set the switch. (This file names it, to test it; the smoke and
// the inventory module read it. Nothing else in the repository's automation may mention it.)
test('no script, hook, workflow or package script sets the switch', () => {
  const root = join(HERE, '..', '..');
  const mentions = [];
  const scan = (abs) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) { for (const name of readdirSync(abs)) if (name !== 'node_modules') scan(join(abs, name)); return; }
    if (readFileSync(abs, 'latin1').includes('SCRIPT_GOLDEN')) mentions.push(abs.slice(root.length + 1));
  };
  for (const place of ['scripts', 'hooks', '.github', 'package.json', 'packages/sitetile/package.json', 'packages/sitetile/astro/package.json', 'packages/build']) scan(join(root, place));
  assert.deepEqual(mentions, []);
  assert.ok(existsSync(join(root, 'scripts', 'test.sh')), 'scripts/test.sh was not where this test looked');
});
