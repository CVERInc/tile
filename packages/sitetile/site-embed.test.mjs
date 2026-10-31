// The site-wide embed slot: `embed:` in ir/_site.md is emitted VERBATIM, last thing before </body>,
// on every built page — and a site without it gains nothing at all.
//   run: node packages/sitetile/site-embed.test.mjs   (globbed into scripts/test.sh)
//
// reef#2302 (owner ruling 2026-10-21): third-party scripts (GA, a pixel, a chat button) get
// ONE raw slot and no named integrations. The slot is the per-page `embed` coral's escape hatch one
// level up, so this file asserts exactly what that promise is, on what a real build WROTE:
//   1. every page carries the raw string, byte for byte, immediately before </body>;
//   2. a page's own `embed:` frontmatter is not a second slot (the base _site.md's value is the one);
//   3. a site without the key builds pages byte-identical to the same site's pages with the slot's
//      text taken back out — nothing else moved, no wrapper, no marker.
//
// It needs the renderer's dependencies and SAYS SO when they are absent — same shape as
// not-found-locale.test.mjs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RENDERER_SUBPATH } from '../build/index.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// Deliberately not well-formed on its own (an unclosed <div>, a stray `&`): the slot does not
// validate or repair, so the build must hand back exactly these bytes.
const RAW = '<script async src="https://example.com/tag.js?id=1&x=2"></script>\n<script>window.dataLayer = window.dataLayer || []; dataLayer.push({ a: "<b>" });</script>\n<div id="chat-button" data-x=\'1\'>';
const asBlock = (key, text) => `${key}: |\n${text.split('\n').map((l) => `  ${l}`).join('\n')}`;
const page = (fm, heading) => `---\n${fm}\n---\n\n## ${heading}\n%% sitetile: hero %%\n\nA fixture page.\n`;
const pages = {
  'home.md': page('sitetile-page: home\ntitle: Tsuru Paper\nlang: en', 'Paper cranes'),
  // A page that writes the same key in its OWN frontmatter: not a second slot.
  'about.md': page('sitetile-page: about\ntitle: About\nlang: en\nembed: <b>PAGE-LEVEL-EMBED</b>', 'About'),
  'contact.md': page('sitetile-page: contact\ntitle: Contact\nlang: en', 'Contact'),
};
const SITES = {
  withSlot: { '_site.md': `---\nbrand: Tsuru Paper\n${asBlock('embed', RAW)}\n---\n`, ...pages },
  without: { '_site.md': '---\nbrand: Tsuru Paper\n---\n', ...pages },
};

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · site-embed END-TO-END SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-site-embed-'));
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
    const built = { withSlot: buildOne('withSlot', SITES.withSlot), without: buildOne('without', SITES.without) };
    for (const [name, b] of Object.entries(built)) assert.equal(b.code, 0, `astro build failed for ${name}:\n${b.log.slice(-1200)}`);
    const names = Object.keys(built.withSlot.html).sort();

    await test('the build wrote the pages this file is about', () => {
      for (const rel of ['index.html', 'about/index.html', 'contact/index.html', '404.html']) {
        assert.ok(names.includes(rel), `no ${rel} in the build: ${names.join(', ')}`);
      }
    });

    await test('🔴 every page carries the raw string, byte for byte, immediately before </body>', () => {
      for (const rel of names) {
        const html = built.withSlot.html[rel];
        assert.equal(html.split('</body>').length, 2, `${rel}: expected exactly one </body>`);
        assert.ok(html.includes(`${RAW}</body>`), `${rel}: the slot's text is not the last thing before </body>:\n…${html.slice(html.indexOf('</body>') - 300, html.indexOf('</body>') + 7)}`);
        assert.equal(html.split(RAW).length, 2, `${rel}: the slot's text appears more than once`);
      }
    });

    await test('a page\'s own `embed:` frontmatter is not a second slot', () => {
      for (const rel of names) assert.equal(built.withSlot.html[rel].includes('PAGE-LEVEL-EMBED'), false, `${rel} emitted a page's frontmatter embed`);
      for (const rel of Object.keys(built.without.html)) assert.equal(built.without.html[rel].includes('PAGE-LEVEL-EMBED'), false, `${rel} (no slot) emitted a page's frontmatter embed`);
    });

    await test('🔴 without the key, a page is byte-identical to the slotted page with the slot\'s text taken out', () => {
      assert.deepEqual(Object.keys(built.without.html).sort(), names, 'the two builds wrote different pages');
      for (const rel of names) {
        const expected = built.withSlot.html[rel].replace(`${RAW}</body>`, '</body>');
        assert.equal(built.without.html[rel], expected, `${rel}: a site without the key differs by more than the slot's text`);
      }
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`site-embed: ${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
