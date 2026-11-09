// The render half of chrome-links.mjs's round-trip law: rewriting ONE link per chrome key with
// withHref, and building the site again, changes the built site in exactly those links' targets —
// every page, every emitted file, byte for byte everywhere else.
//
// The fixture (fixtures/chrome-links-ir/) carries every link-bearing key, each href unique in the
// whole build, so "the old target's text, replaced by the new one's" is the complete expected
// difference. The new targets are built from the characters each grammar treats as syntax, so the
// encoded spelling withHref chose is what the renderer is shown to read back as one link.
//
// Needs the renderer's dependencies; names itself SKIPPED without them, like the astro smoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../build/index.mjs';
import { splitFrontmatter } from './site-core.js';
import { CHROME_LINK_KEYS, parseChromeLinks, withHref } from './chrome-links.mjs';
import * as chromeLinks from './chrome-links.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/chrome-links-ir', import.meta.url));
if (!existsSync(join(ENGINE, 'packages/sitetile/astro/node_modules'))) {
  console.log('  · chrome-links render round-trip SKIPPED — no packages/sitetile/astro/node_modules (run npm install there)');
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), 'tile-chrome-links-'));
const dest = (h) => new URL(h, 'https://example.com/dir/page').href.replace(/%(3B|3D|3A|5E|7C|3E)/gi, (m) => decodeURIComponent(m));
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

// Replace `key`'s value in one Markdown file's frontmatter: a one-line `key: value`, or the fixture's
// one block scalar (`nav: |`, two-space indent). withHref never adds a line, so lines map one to one.
function setValue(text, key, value) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  assert.ok(i >= 0, `${key} not in file`);
  if (lines[i].trim() === `${key}: |`) {
    const block = value.split('\n');
    lines.splice(i + 1, block.length, ...block.map((l) => `  ${l}`));
  } else lines[i] = `${key}: ${value}`;
  return lines.join('\n');
}

try {
  const before = join(work, 'ir-before');
  const after = join(work, 'ir-after');
  cpSync(FIXTURE, before, { recursive: true });
  cpSync(FIXTURE, after, { recursive: true });

  // One link per key — the LAST one, so a nav child, a second column and a weighted item are among them.
  const moves = [];
  const mdFiles = walk(after).filter((p) => p.endsWith('.md'));
  for (const key of CHROME_LINK_KEYS) {
    const file = mdFiles.find((p) => splitFrontmatter(readFileSync(p, 'utf8')).meta[key] != null);
    assert.ok(file, `the fixture must carry \`${key}\``);
    const text = readFileSync(file, 'utf8');
    const value = splitFrontmatter(text).meta[key];
    const links = parseChromeLinks(key, value);
    assert.ok(links.length > 0, `\`${key}\` in the fixture must hold a link`);
    const link = links[links.length - 1];
    // round 3: a backslash and a bare `%` too — the two characters a URL parser changes in a path
    // that the earlier targets could not show.
    const target = `/moved-${key}/a b;c|d=e:f\\g%h${key === 'footer' ? '>>g' : ''}^1/`;
    const next = withHref(key, value, link, target);
    const written = parseChromeLinks(key, next)[links.length - 1].href;
    // where a browser goes from the written href is where the canonical encoding of the target goes
    // (the writer's own path-syntax escapes, %3B and friends, aside)
    assert.equal(dest(written), dest(chromeLinks.encodeTarget(target)), `${key}: ${written}`);
    writeFileSync(file, setValue(text, key, next));
    assert.equal(splitFrontmatter(readFileSync(file, 'utf8')).meta[key], next, `${key}: the file reads back as written`);
    moves.push({ key, from: link.href, to: written });
  }

  const outBefore = join(work, 'out-before');
  const outAfter = join(work, 'out-after');
  for (const [irDir, outDir] of [[before, outBefore], [after, outAfter]]) {
    const r = await buildSite({ irDir, outDir, engineDir: ENGINE, siteUrl: 'https://example.com' });
    assert.equal(r.code, 0, 'fixture build must succeed');
  }

  await test('every moved link is rendered before the move (the fixture measures something)', () => {
    const all = walk(outBefore).filter((p) => /\.(html|json|xml)$/.test(p)).map((p) => readFileSync(p, 'utf8')).join('\n');
    for (const m of moves) assert.ok(all.includes(`href="${m.from}"`), `${m.key}: ${m.from} is not an href anywhere in the built site`);
  });

  await test('the built site differs only in each moved link\'s target', () => {
    const a = walk(outBefore).map((p) => relative(outBefore, p)).sort();
    const b = walk(outAfter).map((p) => relative(outAfter, p)).sort();
    assert.deepEqual(b, a, 'the same files are emitted');
    let changed = 0;
    for (const rel of a) {
      const x = readFileSync(join(outBefore, rel));
      const y = readFileSync(join(outAfter, rel));
      let expect = x.toString('utf8');
      for (const m of moves) expect = expect.split(m.from).join(m.to);
      if (expect !== x.toString('utf8')) changed++;
      if (Buffer.from(expect, 'utf8').equals(x)) assert.ok(y.equals(x), `${rel}: changed although no moved link is in it`);
      else assert.equal(y.toString('utf8'), expect, `${rel}`);
    }
    assert.ok(changed > 5, `expected the moves to reach several files, reached ${changed}`);
  });

  await test('each new target is an href in the built site, spelled as withHref wrote it', () => {
    const all = walk(outAfter).filter((p) => p.endsWith('.html')).map((p) => readFileSync(p, 'utf8')).join('\n');
    for (const m of moves) assert.ok(all.includes(`href="${m.to}"`), `${m.key}: ${m.to}`);
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
