// CVERInc/tile#183 — splitFrontmatter honours YAML block-scalar INDICATORS, so a value can be stored
// verbatim: `key: |2+` (explicit indent 2, keep trailing blank lines), `key: |2` (explicit indent,
// trailing blank lines stripped), `|2-` (same as `|2` in this reader's model — see below).
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
// THE MODEL. This reader has always returned a block scalar as its lines joined by "\n" with NO
// final newline (serializeSite splits on "\n" and re-indents; parse→serialize is the identity on
// that string). The indicators are defined on the same model: `+` keeps the trailing blank lines
// as elements of that join, so `"<pre>hello\n\n"` is written as the line `<pre>hello` followed by
// two blank lines and reads back as exactly that string. (Pure YAML would add one more "\n" for the
// final line break; this reader never has, and the family's writers never emit one.) Hence `-`
// (strip) and the absence of a chomping indicator are the same thing here, and both are accepted.
//
// END TO END: the same two probes written to a real site's _site.md, built with packages/build, and
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
// The writer's convention (serializeSite, reef-mcp's blockEntryLines): split on "\n", indent every
// non-empty line by two spaces, leave empty lines empty. With an explicit `2` the reader slices
// exactly two columns, so a line that itself starts with spaces keeps them.
const asBlock = (key, indicator, text) => `${key}: ${indicator}\n${text.split('\n').map((l) => (l === '' ? '' : `  ${l}`)).join('\n')}`;

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

await test('🔴 `|2+` — explicit indent: a value whose first line starts with spaces keeps them', () => {
  assert.equal(splitFrontmatter(fm('brand: x', asBlock('embed', '|2+', LEADING))).meta.embed, LEADING);
});

await test('🔴 `|2+` — keep chomping: trailing blank lines are the value\'s, before `---` and before the next key alike', () => {
  assert.equal(splitFrontmatter(fm('brand: x', asBlock('embed', '|2+', TRAILING))).meta.embed, TRAILING);
  const next = splitFrontmatter(fm(asBlock('embed', '|2+', TRAILING), 'brand: x'));
  assert.equal(next.meta.embed, TRAILING);
  assert.equal(next.meta.brand, 'x', 'the key after a kept block is still read');
});

await test('`|2+` — whitespace-only lines keep their bytes beyond the indent', () => {
  // a 5-space line: 2 are the indent, 3 are content
  assert.equal(splitFrontmatter(fm('embed: |2+', '    <a>', '     ', '    <b>')).meta.embed, '  <a>\n   \n  <b>');
  assert.equal(splitFrontmatter(fm('embed: |2+', '  <a>', ' ', '  <b>')).meta.embed, '<a>\n\n<b>', 'a whitespace-only line SHORTER than the indent is empty');
});

await test('🔴 `|2` (no chomping indicator) — explicit indent, trailing blank lines stripped', () => {
  assert.equal(splitFrontmatter(fm('brand: x', asBlock('embed', '|2', TRAILING))).meta.embed, '<pre>hello');
  assert.equal(splitFrontmatter(fm(asBlock('embed', '|2', LEADING), 'brand: x')).meta.embed, LEADING);
});

await test('`|2-`, `|+`, `|-`, `|+2` — the other spellings read, and `-` is strip', () => {
  assert.equal(splitFrontmatter(fm(asBlock('embed', '|2-', TRAILING))).meta.embed, '<pre>hello');
  assert.equal(splitFrontmatter(fm(asBlock('embed', '|-', TRAILING))).meta.embed, '<pre>hello');
  assert.equal(splitFrontmatter(fm(asBlock('embed', '|+', TRAILING))).meta.embed, TRAILING, '`|+` alone: inferred indent, kept chomping');
  assert.equal(splitFrontmatter(fm(asBlock('embed', '|+2', LEADING))).meta.embed, LEADING, 'chomping-then-indent order');
  assert.equal(splitFrontmatter(fm(asBlock('embed', '>2+', 'one\ntwo\n'))).meta.embed, 'one two ', 'folded with indicators folds the kept blank too');
});

await test('an explicit indent still ends the block at a shallower non-blank line, and a value with no lines is empty', () => {
  const r = splitFrontmatter(fm('embed: |2+', '  <a>', ' b: 1', 'brand: x'));
  assert.equal(r.meta.embed, '<a>');
  assert.equal(r.meta.brand, 'x');
  assert.equal(splitFrontmatter(fm('embed: |2+', 'brand: x')).meta.embed, '');
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
  leading:  { stored: LEADING,  site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|2+', LEADING)}\n---\n` },
  trailing: { stored: TRAILING, site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|2+', TRAILING)}\n---\n` },
  control:  { stored: CONTROL,  site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|', CONTROL)}\n---\n` },
  // `|2` with trailing blank lines in the file: the slot carries the value WITHOUT them.
  stripped: { stored: '<pre>hello', site: `---\nbrand: Tsuru Paper\n${asBlock('embed', '|2', TRAILING)}\n---\n` },
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
