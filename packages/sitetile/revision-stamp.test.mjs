// The source revision stamp for an editing preview: with `SITETILE_SOURCE_SPANS=1` the Astro build
// stamps every content page's <main> with `data-revision="<sourceRevision(page markdown)>"`, the
// revision the text-edit coral sends with every edit and the host's applier checks
// (dynamic-corals/text-edit). The host copies it onto the coral's mount; it cannot compute it,
// because it never holds the Markdown.
//   run: node --test packages/sitetile/revision-stamp.test.mjs
//
// 🔴 Without the flag the build is byte-identical: no attribute, no span.
// 🔴 One implementation: sitetile's `sourceRevision` is the coral's (text-edit-source re-exports it).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite, RENDERER_SUBPATH } from '../build/index.mjs';
import { sourceRevision } from './site-core.js';
import * as coralSource from '../dynamic-corals/text-edit/text-edit-source.mjs';

const ENGINE = fileURLToPath(new URL('../..', import.meta.url));
const ASTRO = join(ENGINE, RENDERER_SUBPATH);

// Pages with frontmatter, a nested path and words whose revision changes with every byte.
const PAGES = {
  'home.md': '---\nsitetile-page: home\ntitle: Home\n---\n\n## About\n\nWe make tables by hand.\n\n- Oak\n- Walnut\n',
  'about.md': '---\nsitetile-page: about\ntitle: About\n---\n\n## Our shop\n\nSmall and slow.\n',
  'legal/terms.md': '---\nsitetile-page: terms\ntitle: Terms\n---\n## Terms\n\nBe kind.\n',
};
const pageFile = { 'home.md': 'index.html', 'about.md': 'about/index.html', 'legal/terms.md': 'legal/terms/index.html' };

test('one sourceRevision: the coral\'s is sitetile\'s', () => {
  assert.equal(coralSource.sourceRevision, sourceRevision);
  // pinned values of the coral's function as it shipped in tile#275: moving it changed nothing
  assert.equal(sourceRevision('## About\n\nWords\n'), 'rg-3c873e77d7420e71');
  assert.equal(sourceRevision(''), 'r0-488bdcb81aee8d83');
  assert.equal(sourceRevision('制作は、あなた'), 'r7-061701f7ed7fd0ae');
});

if (!existsSync(join(ASTRO, 'node_modules'))) {
  console.log(`  · revision-stamp BUILT SKIPPED — no ${RENDERER_SUBPATH}/node_modules (run npm install there)`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tile-revision-stamp-'));
  const irDir = join(work, 'ir');
  for (const [rel, body] of Object.entries(PAGES)) {
    mkdirSync(dirname(join(irDir, rel)), { recursive: true });
    writeFileSync(join(irDir, rel), body);
  }
  const build = async (flag) => {
    const outDir = join(work, flag ? 'spans' : 'plain');
    const before = process.env.SITETILE_SOURCE_SPANS;
    if (flag) process.env.SITETILE_SOURCE_SPANS = '1';
    else delete process.env.SITETILE_SOURCE_SPANS;
    try {
      const r = await buildSite({ irDir, engineDir: ENGINE, outDir, siteUrl: 'https://example.com' });
      assert.equal(r.code, 0, 'astro build failed');
    } finally {
      if (before === undefined) delete process.env.SITETILE_SOURCE_SPANS;
      else process.env.SITETILE_SOURCE_SPANS = before;
    }
    return Object.fromEntries(Object.entries(pageFile).map(([md, html]) => [md, readFileSync(join(outDir, html), 'utf8')]));
  };
  try {
    const plain = await build(false);
    const spans = await build(true);

    await test('without the flag: no revision, no spans', () => {
      for (const html of Object.values(plain)) {
        assert.doesNotMatch(html, /data-revision/);
        assert.doesNotMatch(html, /data-src=/);
      }
    });

    await test('with the flag: every content page\'s <main> carries the revision of its own Markdown', () => {
      for (const [md, html] of Object.entries(spans)) {
        const mains = [...html.matchAll(/<main\b[^>]*>/g)].map((m) => m[0]);
        assert.equal(mains.length, 1, md);
        assert.match(mains[0], new RegExp(`\\sdata-revision="${sourceRevision(PAGES[md])}"`), md + ': ' + mains[0]);
        assert.equal((html.match(/data-revision=/g) || []).length, 1, md + ': one stamp per page');
        assert.match(html, /data-src="\d+-\d+"/, md + ': the spans are on too');
      }
    });

    await test('the flag adds only the stamp and the spans: removing them gives back the plain build', () => {
      for (const md of Object.keys(PAGES)) {
        const stripped = spans[md].replace(/ data-revision="r[0-9a-z]+-[0-9a-f]{16}"/, '').replace(/ data-src="\d+-\d+"/g, '');
        assert.equal(stripped, plain[md], md);
      }
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
