// REEF with Blog's defaults must not wear the VENDOR's name.
//   run: node packages/sitetile/blog-defaults.test.mjs
//
// 🩸 The capability was extracted from the vendor's own devlog and the extraction stopped
// halfway. The LABEL default was fixed first — "an unnamed blog must not arrive wearing the
// vendor's name" —
// and the PATH, the same word for the same reason, was not. A clinic site then shipped a footer
// link to `/devlog` next to its own link to the page it had actually written: two links, one label,
// two destinations. Its owner had renamed the label (a key they could reach) and could not move the
// path, which had no tool at all.
//
// This file exists so the next default that arrives is checked against the same rule, rather than
// against whoever happens to remember this one.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(join(HERE, 'astro/src/layouts/SiteLayout.astro'), 'utf8');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
};

// Every default a site inherits WITHOUT asking. A tenant that sets nothing must get common nouns.
const DEFAULTS = [
  { what: 'blog path', re: /const blogPath = .*\|\| '([^']+)'/, want: '/blog' },
  { what: 'blog label', re: /const blogLabel = .*\|\| '([^']+)'/, want: 'Blog' },
];

test('🔴 no inherited default is one tenant\'s proper noun', () => {
  for (const d of DEFAULTS) {
    const m = d.re.exec(layout);
    assert.ok(m, `could not find the ${d.what} default — this test is now measuring nothing`);
    assert.equal(m[1], d.want, `${d.what} default`);
    assert.doesNotMatch(m[1], /devlog|cver/i, `${d.what} must not carry the vendor's name`);
  }
});

test('🔴 the default is still OVERRIDABLE — the fix was the noun, not the knob', () => {
  // Removing configurability would "fix" the complaint and break every site that legitimately owns
  // its own path — a site that owns one says so in its own _site.md.
  assert.match(layout, /meta\['blog-path'\]/, 'blog-path is still read from the site');
  assert.match(layout, /meta\['blog-label'\]/, 'blog-label too');
});

console.log(`\n${passed} passed`);
