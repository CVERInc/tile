// Guard: one site declares one language.
//   run: node packages/sitetile/lang-default.test.mjs   (wired into scripts/test.sh)
//
// 🩸 Measured live: `/` served lang="zh-Hant" while `/blog/`, every post
// and the 404 served lang="en-US". One site, one build, two languages — a screen reader changes
// voice halfway through and a search engine files the blog as English.
//
// Nobody chose it. Nine copies of a fallback literal had drifted into two camps: SiteLayout and
// PageView said 'zh-Hant', BlogIndexView / ArchiveView / PostView / search / preview / 404 /
// chrome-copy said 'en-US'. Whichever view rendered the page decided what language the site was.
//
// It reached us as "the 404 page is in English", which reads like a translation gap and is not one
// — Lingo renders that page perfectly on a site that declares `lang:` and so never took either
// fallback. The site that DID take them is the one that never declared it.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro', 'src');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (n === 'node_modules') return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const sources = walk(SRC).filter((p) => /\.(astro|mjs|js)$/.test(p));

test('🔴 no file carries its own language fallback', () => {
  // The literal is the bug. One named export, imported — so two views cannot disagree about what
  // an undeclared site speaks.
  const offenders = [];
  for (const p of sources) {
    if (p.endsWith('locale.mjs')) continue;              // the one place a default is allowed to exist
    // 🩸 chrome-copy.mjs answers a DIFFERENT question — which UI strings a site that declared
    // nothing should get — and its answer is deliberately English ("never Chinese", per
    // chrome-copy.test.mjs). My first sweep took it along with the eight strays and that test went
    // red. It uses NEUTRAL_UI_LANG now: same literal, named, so a decision cannot be mistaken for
    // drift again. It is excluded here BY NAME, not by pattern, so a real fallback sneaking into
    // this file is still caught.
    const src0 = readFileSync(p, 'utf8');
    if (/NEUTRAL_UI_LANG/.test(src0) && !/\|\|\s*['"][a-zA-Z-]{2,7}['"]/.test(src0)) continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/lang[^\n]{0,24}\|\|\s*['"]([a-zA-Z-]{2,7})['"]/g)) {
      offenders.push(`${relative(SRC, p)} → ${m[1]}`);
    }
    if (/\blang\s*=\s*['"](en-US|zh-Hant|zh-TW|ja-JP)['"]/.test(src)) {
      offenders.push(`${relative(SRC, p)} → a literal default in a prop`);
    }
  }
  assert.deepEqual(offenders, [], `these decide the site's language on their own:\n${offenders.join('\n')}`);
});

test('🔴 CONTROL: the check can see a fallback — it is not passing for free', () => {
  // Written against a pattern, so prove the pattern matches the shape it was written for. Every
  // one of the nine looked like one of these two.
  const probe = "<SiteLayout lang={meta.lang || 'en-US'} />";
  assert.match(probe, /lang[^\n]{0,24}\|\|\s*['"]([a-zA-Z-]{2,7})['"]/);
  assert.match("const { lang = 'zh-Hant' } = Astro.props;", /\blang\s*=\s*['"](en-US|zh-Hant|zh-TW|ja-JP)['"]/);
});

test('the default is exported once, and it is a real locale', () => {
  const loc = readFileSync(join(SRC, 'packages', 'lingo', 'locale.mjs'), 'utf8');
  const m = /export const DEFAULT_LANG = '([^']+)'/.exec(loc);
  assert.ok(m, 'DEFAULT_LANG must be exported from locale.mjs');
  assert.match(m[1], /^[a-z]{2}(-[A-Za-z]{2,4})?$/, `not a locale tag: ${m[1]}`);
});

test('🔴 the shared default is actually USED, in every view that can need one', () => {
  // 🩸 My first version of this asserted that every file mentioning `lang` imports DEFAULT_LANG,
  // and it flagged two files that are RIGHT: Section.astro passes a `lang` prop straight through
  // and decides nothing, and language.astro renders each locale's own route so its lang is data,
  // not a fallback. A check that cannot tell a pass-through from an omission would have had its
  // assertion loosened by the next person, which is how a gate dies.
  //
  // So the precise rule is the first test (no literal fallbacks anywhere). This one guards the
  // other direction: the constant must still be reaching real views, or a future refactor could
  // delete every use and leave test one passing over a codebase that sets no lang at all.
  const users = sources.filter((p) => /DEFAULT_LANG/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(SRC, p))
    .filter((p) => !p.endsWith('locale.mjs'));
  assert.ok(users.length >= 10, `DEFAULT_LANG should reach the whole view family, found ${users.length}: ${users.join(', ')}`);
  for (const must of ['layouts/SiteLayout.astro', 'pages/404.astro', 'components/BlogIndexView.astro', 'components/PostView.astro']) {
    assert.ok(users.includes(must), `${must} must take the shared default`);
  }
});

console.log(`\n  ${passed} passed`);
