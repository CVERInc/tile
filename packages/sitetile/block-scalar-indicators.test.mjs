// CVERInc/tile#183 — splitFrontmatter honours YAML block-scalar INDICATORS, so a value can be stored
// verbatim: `key: |2+` (explicit indent 2, keep every trailing line break), `key: |2` (explicit
// indent, clip: exactly one final line break), `|2-` (strip: none) — and `>` likewise, folded.
//   run: node packages/sitetile/block-scalar-indicators.test.mjs   (globbed into scripts/test.sh)
//
// WHY. The site-wide `embed` slot (tile#179, reef#2302) promises the owner's raw HTML byte for byte,
// but the indicator-less `|` this reader has always had INFERS the base indent from the first
// non-blank line (so `"  <pre>  keep</pre>"` loses its two leading spaces), EMPTIES whitespace-only
// lines and DROPS trailing blank lines (so `"<pre>hello\n\n"` comes back as `"<pre>hello"`) — and a
// writer that reaches for the standard indicator got `"|2+"` back as the VALUE. Three things, one
// cause: the reader did not know the indicators existed.
//
// 🔴 Indicator-less `|` and `>` keep today's behaviour byte for byte — agent-guidance, nav, footer
// and every other block scalar in the wild were written against it. block-scalar-golden.json was
// generated from the reader BEFORE this change over every fixture .md in the engine (26 files, 4
// with block scalars) and is asserted unchanged here; the quirks themselves (inference, emptied
// whitespace-only lines, dropped trailing blanks, a shallower line ending the block) are pinned
// explicitly too, so the golden cannot pass by never having met them.
//
// THE MODEL. Two readers in one function. A bare `|` / `>` is the legacy reader (lines joined by
// "\n", no final newline, quirks above). Every spelling WITH an indicator is YAML 1.2, exactly:
// §8.1.1.1 indentation (explicit, or inferred from the first non-empty line and never below 1, so
// an unindented sibling ends even an empty block), §8.1.1.2 chomping (clip = one final line break,
// strip = none, keep = all of them), §8.1.3 folding for `>` (a single break between two normal
// lines is a space, each blank line a newline, more-indented lines keep their breaks). A standard
// YAML writer's output therefore reads back as the value it wrote. 🩸 r1 of this file asserted a
// home-grown "lines joined, `-` ≡ clip, `>` joins with spaces" model for the indicators — codex
// r1 on tile#184 showed it shortened `|2` values, flattened `>2-` paragraphs, and let an empty
// `|+` swallow the keys after it. The expected values below are PyYAML 6.0.1's, and the oracle
// test re-asks PyYAML live whenever python3 has it, so the table is not just my reading of §8.1.
//
// END TO END: the probes written to a real site's _site.md, built with packages/build, and
// read off the emitted page: the slot's bytes immediately before </body> are the stored bytes, and
// a site without the key builds the same page with only those bytes taken out. Needs the renderer's
// dependencies and SAYS SO when they are absent — same shape as site-embed.test.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter } from './site-core.js';
import { RENDERER_SUBPATH } from '../build/index.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

const fm = (...lines) => `---\n${lines.join('\n')}\n---\n`;
// A YAML writer: the value's final line break is the last line's own break (so it is not a line of
// its own), every non-empty line indented two spaces, empty lines left empty. With an explicit `2`
// the reader slices exactly two columns, so a line that itself starts with spaces keeps them.
const asBlock = (key, indicator, text) => `${key}: ${indicator}\n${(text.endsWith('\n') ? text.slice(0, -1) : text).split('\n').map((l) => (l === '' ? '' : `  ${l}`)).join('\n')}`;

// ── the golden: indicator-less block scalars are byte-identical to the reader before this change ──

await test('🔴 golden — every fixture .md parses exactly as it did before indicators existed', () => {
  const golden = JSON.parse(readFileSync(new URL('./block-scalar-golden.json', import.meta.url), 'utf8'));
  const files = Object.keys(golden);
  assert.ok(files.length >= 26, `the golden lists ${files.length} files; it was generated over 26`);
  assert.ok(files.some((f) => Object.values(golden[f].meta).some((v) => String(v).includes('\n'))), 'the golden holds no block scalar at all — it cannot be a control');
  const drift = [];
  for (const f of files) {
    const p = join(ENGINE, f);
    if (!existsSync(p)) { drift.push(`${f}: missing (moved? regenerate the golden on purpose, not by accident)`); continue; }
    const { meta, body } = splitFrontmatter(readFileSync(p, 'utf8'));
    const got = { meta, bodyLength: body.length, bodyHead: body.slice(0, 40) };
    if (JSON.stringify(got) !== JSON.stringify(golden[f])) drift.push(`${f}:\n      was ${JSON.stringify(golden[f].meta)}\n      now ${JSON.stringify(meta)}`);
  }
  assert.deepEqual(drift, [], `indicator-less parsing drifted:\n${drift.join('\n')}`);
});

await test('🔴 indicator-less `|` keeps its quirks: first-line inference, emptied whitespace-only lines, dropped trailing blanks', () => {
  // Values recorded from the reader before this change — the behaviour every existing site was written against.
  assert.equal(splitFrontmatter(fm('embed: |', '  <a>', '  ', '    <b>', '')).meta.embed, '<a>\n\n  <b>');
  assert.equal(splitFrontmatter(fm('nav: |', '    - deep', '  - shallow')).meta.nav, '- deep', 'a shallower line ends the inferred block');
  assert.equal(splitFrontmatter(fm('x: |', '  a', '      ', '  b')).meta.x, 'a\n\nb', 'whitespace-only lines are emptied');
  assert.equal(splitFrontmatter(fm('blurb: >', '  one', '  two', '', '  three')).meta.blurb, 'one two  three', 'folded joins with spaces');
  assert.equal(splitFrontmatter(fm('embed: |', '  <pre>hello', '', '')).meta.embed, '<pre>hello', 'trailing blank lines are dropped');
  assert.equal(splitFrontmatter(fm('embed: |', '    <pre>  keep</pre>')).meta.embed, '<pre>  keep</pre>', 'the first line\'s indent is the base');
});

// ── the indicators ───────────────────────────────────────────────────────────────────────────────

const LEADING = '  <pre>  keep</pre>';
const TRAILING = '<pre>hello\n\n';

// A YAML document `y` (ending in "\n") as this reader sees it: between `---` fences.
const doc = (y) => `---\n${y}---\n`;
const read = (y) => splitFrontmatter(doc(y)).meta;

// Every row: [YAML text, PyYAML 6.0.1's safe_load of it]. Inputs YAML rejects (a shallower line
// inside an explicit block, leading spaces deeper than the first line) are left out on purpose —
// there is no value to agree with.
const ORACLE = [
  // P2-1 — an empty inferred block ends at the unindented sibling; the siblings survive
  ['embed: |+\nbrand: Example\nlang: en\n', { embed: '', brand: 'Example', lang: 'en' }],
  ['embed: |-\nbrand: Example\nlang: en\n', { embed: '', brand: 'Example', lang: 'en' }],
  ['embed: >+\nbrand: Example\n', { embed: '', brand: 'Example' }],
  ['embed: >-\nbrand: Example\n', { embed: '', brand: 'Example' }],
  ['embed: |2+\nbrand: x\n', { embed: '', brand: 'x' }],
  ['embed: |+\n\n\nbrand: x\n', { embed: '\n\n', brand: 'x' }],
  ['embed: >+\n\n', { embed: '\n' }],
  // P2-2 — clip / strip / keep
  ['embed: |2\n  a\n\n', { embed: 'a\n' }],
  ['embed: |2-\n  a\n\n', { embed: 'a' }],
  ['embed: |2+\n  a\n\n', { embed: 'a\n\n' }],
  ['embed: |+2\n  a\n\n', { embed: 'a\n\n' }],
  ['embed: |+\n  a\n\n', { embed: 'a\n\n' }],
  ['embed: |2+\n  <pre>hello\n\n', { embed: '<pre>hello\n\n' }],
  ['embed: |2-\n    <pre>  keep</pre>\n', { embed: '  <pre>  keep</pre>' }],
  ['embed: |2+\n    <pre>  keep</pre>\n', { embed: '  <pre>  keep</pre>\n' }],
  // P2-3 — folding
  ['embed: >2-\n  one\n\n  two\n', { embed: 'one\ntwo' }],
  ['embed: >2-\n  one\n    code\n  two\n', { embed: 'one\n  code\ntwo' }],
  ['embed: >2+\n  one\n  two\n\n', { embed: 'one two\n\n' }],
  ['embed: >2\n  one\n  two\n\n\n  three\n', { embed: 'one two\n\nthree\n' }],
  ['embed: >-\n\n  a\n  b\n', { embed: '\na b' }],
  ['embed: >-\n  a\n\n    b\n\n  c\n', { embed: 'a\n\n  b\n\nc' }],
  ['embed: >-\n  a\n    b\n  c\n', { embed: 'a\n  b\nc' }],
  ['embed: >2-\n  a\n     \n  b\n', { embed: 'a\n   \nb' }],
  // P2-4 — inferred indent keeps a whitespace-only line's bytes beyond the indent
  ['embed: |-\n  a\n     \n  b\n', { embed: 'a\n   \nb' }],
  ['embed: |+\n  a\n     \n  b\n', { embed: 'a\n   \nb\n' }],
  ['embed: |+\n  a\n     \n', { embed: 'a\n   \n' }],
  ['embed: |-\n\n    a\n', { embed: '\na' }],
];

await test('🔴 P2-1 — an empty `|+` / `|-` / `>-` is "" and the keys after it are still read', () => {
  assert.deepEqual(read('embed: |+\nbrand: Example\nlang: en\n'), { embed: '', brand: 'Example', lang: 'en' });
  assert.deepEqual(read('embed: |-\nbrand: Example\nlang: en\n'), { embed: '', brand: 'Example', lang: 'en' });
  assert.deepEqual(read('embed: >-\nbrand: Example\n'), { embed: '', brand: 'Example' });
});

await test('🔴 P2-2 — clip keeps one final break, strip none, keep all', () => {
  assert.equal(read('embed: |2\n  a\n\n').embed, 'a\n', '`|2` is clip');
  assert.equal(read('embed: |2-\n  a\n\n').embed, 'a', '`|2-` is strip');
  assert.equal(read('embed: |2+\n  a\n\n').embed, 'a\n\n', '`|2+` is keep');
  assert.equal(read('embed: |+2\n  a\n\n').embed, 'a\n\n', 'chomping-then-indent order');
  assert.equal(read('embed: |+\n  a\n\n').embed, 'a\n\n', 'inferred indent, keep');
});

await test('🔴 P2-3 — `>` with indicators folds per §8.1.3', () => {
  assert.equal(read('embed: >2-\n  one\n\n  two\n').embed, 'one\ntwo', 'a blank line is a newline');
  assert.equal(read('embed: >2-\n  one\n    code\n  two\n').embed, 'one\n  code\ntwo', 'a more-indented line keeps its breaks');
  assert.equal(read('embed: >2+\n  one\n  two\n\n').embed, 'one two\n\n', 'kept breaks are not folded');
});

await test('🔴 P2-4 — inferred indent: a whitespace-only line keeps its bytes beyond the indent', () => {
  assert.equal(read('embed: |-\n  a\n     \n  b\n').embed, 'a\n   \nb');
  assert.equal(read('embed: |+\n  a\n     \n  b\n').embed, 'a\n   \nb\n');
});

await test('every oracle row reads as PyYAML 6.0.1 read it', () => {
  const wrong = ORACLE.filter(([y, want]) => JSON.stringify(read(y)) !== JSON.stringify(want))
    .map(([y, want]) => `${JSON.stringify(y)}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(read(y))}`);
  assert.deepEqual(wrong, [], `disagreements:\n    ${wrong.join('\n    ')}`);
});

// The table above is my transcription; this asks PyYAML itself, so a typo in it cannot bless a bug.
const py = spawnSync('python3', ['-I', '-c', 'import json,sys,yaml\nprint(json.dumps([yaml.safe_load(y) for y in json.load(sys.stdin)]))'], { input: JSON.stringify(ORACLE.map(([y]) => y)), encoding: 'utf8' });
if (py.status !== 0) {
  console.log('  · block-scalar-indicators PyYAML ORACLE SKIPPED — python3 with yaml is not available here');
} else {
  await test('the oracle table is PyYAML\'s, asked live', () => {
    assert.deepEqual(JSON.parse(py.stdout), ORACLE.map(([, want]) => want));
  });
}

await test('a YAML writer\'s output reads back as the value it wrote, before `---` and before the next key alike', () => {
  for (const [ind, value] of [['|2-', LEADING], ['|2+', LEADING + '\n'], ['|2+', TRAILING], ['|2', '<pre>hello\n'], ['|-', 'a\n\nb']]) {
    assert.equal(splitFrontmatter(fm('brand: x', asBlock('embed', ind, value))).meta.embed, value, `${ind} ${JSON.stringify(value)} before ---`);
    const next = splitFrontmatter(fm(asBlock('embed', ind, value), 'brand: x'));
    assert.equal(next.meta.embed, value, `${ind} ${JSON.stringify(value)} before a key`);
    assert.equal(next.meta.brand, 'x', 'the key after the block is still read');
  }
});

await test('explicit indent: a whitespace-only line keeps its bytes beyond the indent; shorter than the indent it is empty', () => {
  assert.equal(splitFrontmatter(fm('embed: |2-', '    <a>', '     ', '    <b>')).meta.embed, '  <a>\n   \n  <b>');
  assert.equal(splitFrontmatter(fm('embed: |2-', '  <a>', ' ', '  <b>')).meta.embed, '<a>\n\n<b>');
});

await test('a shallower non-blank line ends an indicator block; a block with no lines is empty', () => {
  // (YAML itself rejects ` b: 1` here; this reader ends the block at it and reads on, as bare `|` does)
  const r = splitFrontmatter(fm('embed: |2+', '  <a>', ' b: 1', 'brand: x'));
  assert.equal(r.meta.embed, '<a>\n');
  assert.equal(r.meta.brand, 'x');
  assert.equal(splitFrontmatter(fm('embed: |2+')).meta.embed, '');
});

await test('not an indicator: `|0`, `|22`, `|x`, `|2 trailing` stay what they were — a plain inline value', () => {
  for (const bad of ['|0', '|22', '|x', '|2 trailing', '|++']) {
    assert.equal(splitFrontmatter(fm(`embed: ${bad}`, '  <a>')).meta.embed, bad, bad);
  }
});

// ── end to end: the stored bytes are the emitted bytes ───────────────────────────────────────────

const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: hero %%\n\nA fixture page.\n`;
const pages = { 'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes') };
const CONTROL = '<script async src="https://example.com/tag.js?id=1&x=2"></script>\n<div id="chat-button" data-x=\'1\'>';
const ARMS = {
  // `|2+` keeps the final break: the slot carries LEADING and the line break after it.
  leading:  { stored: LEADING + '\n', site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|2+', LEADING + '\n')}\n---\n` },
  trailing: { stored: TRAILING, site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|2+', TRAILING)}\n---\n` },
  control:  { stored: CONTROL,  site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|', CONTROL)}\n---\n` },
  // `|2-` strips every final break: LEADING byte for byte.
  stripped: { stored: LEADING, site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|2-', LEADING)}\n---\n` },
  // `|2` with two blank lines in the file: clip keeps exactly one final break.
  clipped:  { stored: '<pre>hello\n', site: '---\nbrand: Tsuru Paper\nembed: |2\n  <pre>hello\n\n\n---\n' },
};
const WITHOUT = '---\nbrand: Tsuru Paper\n---\n';

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · block-scalar-indicators END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-block-scalar-'));
  const walk = (d) => (existsSync(d) ? readdirSync(d) : []).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const buildOne = (name, files) => {
    const irDir = join(work, name, 'ir');
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(irDir, rel)), { recursive: true });
      writeFileSync(join(irDir, rel), body);
    }
    const outDir = join(work, name, 'out');
    const r = spawnSync(process.execPath, [join(ENGINE, 'packages/build/cli.mjs'), irDir, outDir, '--site-url', 'https://example.com', '--engine', ENGINE], { encoding: 'utf8' });
    const log = `${r.stdout || ''}\n${r.stderr || ''}`;
    const html = Object.fromEntries(walk(outDir).filter((p) => p.endsWith('.html')).map((p) => [relative(outDir, p), readFileSync(p, 'utf8')]));
    return { code: r.status, log, html };
  };
  try {
    const without = buildOne('without', { '_site.md': WITHOUT, ...pages });
    assert.equal(without.code, 0, `astro build failed for the no-slot site:\n${without.log.slice(-1200)}`);
    const names = Object.keys(without.html).sort();
    assert.ok(names.includes('index.html') && names.includes('404.html'), `the no-slot build wrote: ${names.join(', ')}`);
    for (const [arm, { stored, site }] of Object.entries(ARMS)) {
      const b = buildOne(arm, { '_site.md': site, ...pages });
      await test(`🔴 end to end [${arm}] — the slot's bytes before </body> are exactly the stored bytes, on every page`, () => {
        assert.equal(b.code, 0, `astro build failed:\n${b.log.slice(-1200)}`);
        assert.deepEqual(Object.keys(b.html).sort(), names, 'the two builds wrote different pages');
        for (const rel of names) {
          const html = b.html[rel];
          assert.equal(html.split('</body>').length, 2, `${rel}: expected exactly one </body>`);
          const at = html.indexOf('</body>');
          assert.equal(html.slice(at - stored.length, at), stored, `${rel}: the bytes before </body> are not the stored value:\n…${JSON.stringify(html.slice(Math.max(0, at - 80), at + 7))}`);
          assert.equal(html.slice(0, at - stored.length) + html.slice(at), without.html[rel], `${rel}: the no-slot page differs by more than the stored bytes`);
        }
      });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`block-scalar-indicators: ${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
