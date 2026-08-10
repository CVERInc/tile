// Guard: the blog package must not put the VENDOR's name on a tenant's door.
//   run: node packages/sitetile/blog-tenancy.test.mjs   (wired into scripts/test.sh)
//
// WHY THIS EXISTS. The blog once carried its vendor's identity as its DEFAULTS. An absent
// `blog-title` fell back to the literal 'Devlog'; an absent `blog-tagline` to that vendor's own
// tagline; and the RSS channel title was `${site title} — Devlog` — hardcoded, with no override
// path at all, so no amount of site config could reach it. On top of that the blog index was
// emitted for EVERY site, whether or not it had installed the blog, on the theory that an empty
// index is harmless.
//
// What that shipped, measured across every live tenant on one morning:
//   a comic site         0 posts, no `packages: blog` → served /devlog reading "Devlog" plus a
//                        tagline written by, and about, somebody else entirely
//   an illustrator       0 posts, no `packages: blog` → same
//   a 1410-post blog     correctly named in its own language → feed titled "Devlog — Devlog"
//   a 632-post studio    feed titled "<their name> — Devlog"
//
// Nobody chose any of that; a default just leaked, four tenants deep, for as long as the
// package had existed. Two guards, because it got out two different ways — one leak of
// BEHAVIOUR (routes for a blog nobody installed) and one of COPY (someone else's voice as a
// fallback value).

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blogInstalled, feedTitle, feedDescription } from './astro/src/lib/blog-tenancy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro', 'src');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ── 1. BEHAVIOUR: who gets blog routes ───────────────────────────────────────
// The fixtures are the real tenant SHAPES with the identities changed. Each shape is why the rule
// reads as it does; the names were only ever labels, and the golden values move with them.
const TENANTS = {
  // Fully configured: declares the blog, names it, and writes its own tagline.
  atlas:     { meta: { packages: 'bleedblend, lingo, blog', title: 'ATLAS.DEV', 'blog-title': 'Devlog', 'blog-tagline': 'Short build logs from the workshop.' }, posts: 20 },
  // Declares the blog and names it in its own language, but sets no site title.
  harbour:   { meta: { packages: 'blog', 'blog-title': '港邊筆記' }, posts: 1410 },
  // The load-bearing case: 632 posts, and an ir/_site.md deliberately left EMPTY for render
  // fidelity, so it declares nothing at all. A declaration-only gate deletes 632 live URLs.
  studio:    { meta: {}, posts: 632 },
  // A small blog that declares everything, including a tagline in its own language.
  clinic:    { meta: { packages: 'blog', title: 'Marren Clinic', 'blog-title': '照護筆記', 'blog-tagline': '關於日常照護的衛教筆記。' }, posts: 3 },
  // No blog, no posts — but a title and description of its own that must never be replaced.
  comic:     { meta: { packages: 'lingo, pwa', title: "Lilac — The Long Way Home", description: 'A romance comic by Lilac.' }, posts: 0 },
  // No blog, no posts, and nothing to say — silence must stay silence.
  gallery:   { meta: { title: 'Foxglove Art' }, posts: 0 },
};
const corpus = (n) => Array.from({ length: n }, (_, i) => ({ slug: `p${i}` }));

test('a site that DECLARED the blog gets one', () => {
  for (const key of ['atlas', 'harbour', 'clinic']) {
    assert.equal(blogInstalled(TENANTS[key].meta, corpus(TENANTS[key].posts)), true, key);
  }
});

test('a site with POSTS but no declaration keeps its blog (632 live URLs)', () => {
  assert.equal(blogInstalled(TENANTS.studio.meta, corpus(632)), true);
  assert.equal(blogInstalled({}, corpus(1)), true, 'one post is enough — it exists, so it stays');
});

test('a site that neither declared a blog nor has one gets NO blog routes', () => {
  assert.equal(blogInstalled(TENANTS.comic.meta, []), false);
  assert.equal(blogInstalled(TENANTS.gallery.meta, []), false);
});

test('"blog" must be a whole entry in packages, not a substring', () => {
  assert.equal(blogInstalled({ packages: 'blog-search' }, []), false);
  assert.equal(blogInstalled({ packages: 'lingo, blog , pwa' }, []), true, 'whitespace is trimmed');
});

// ── 2. COPY: whose voice the feed speaks in ──────────────────────────────────
test('a fully configured site composes its own title and blog name', () => {
  assert.equal(feedTitle(TENANTS.atlas.meta), 'ATLAS.DEV — Devlog');
  assert.equal(feedDescription(TENANTS.atlas.meta), 'Short build logs from the workshop.');
});

test('a titleless site no longer publishes a feed called "Devlog — Devlog"', () => {
  assert.equal(feedTitle(TENANTS.harbour.meta), '港邊筆記');
  assert.equal(feedDescription(TENANTS.harbour.meta), '');
});

test('a site with no blog copy falls back to its OWN description, never to the vendor\'s', () => {
  assert.equal(feedTitle(TENANTS.comic.meta), "Lilac — The Long Way Home");
  assert.equal(feedDescription(TENANTS.comic.meta), 'A romance comic by Lilac.');
  assert.equal(feedDescription(TENANTS.gallery.meta), '', 'nothing to say beats saying someone else\'s line');
});

test('an explicitly empty blog-tagline is honoured as deliberate silence', () => {
  assert.equal(feedDescription({ 'blog-tagline': '', description: 'fallback' }), '');
});

test('a nameless blog gets a neutral generic, not a landlord\'s name', () => {
  assert.equal(feedTitle({}), 'Blog');
});

// ── 3. SOURCE GUARD: no vendor identity as a default, ever again ──────────────
// The leak was a literal sitting in a fallback position. Detect the phrases anywhere in
// executable source; anything that legitimately keeps one must be named in ALLOWED with the
// gate that protects it. Same doctrine as the smoke's JS allowlist: a new occurrence goes red
// until someone adds it CONSCIOUSLY, with its reason.
const VENDOR_PHRASES = [
  'Devlog',                                 // capital D: the NAME. '/devlog' the URL path is fine.
  'hard-won tricks from the workshop',
  'Notes from the workshop',
];

// Strip comments so the explanations above (which quote every phrase) don't trip the guard.
// `//` only counts when it isn't part of a `://` URL.
function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')   // {/* astro/jsx */}
    .replace(/\/\*[\s\S]*?\*\//g, '')       // /* block */
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // // line, but not https://
}

const findPhrases = (src) => VENDOR_PHRASES.filter((p) => stripComments(src).includes(p));

// Every legitimate survivor, with the opt-in meta key that keeps it off other tenants' sites.
// `blog-post-cta-default` is opt-in, and is set by exactly one site.
const ALLOWED = {
  'components/BlogIndexView.astro': 'closing CTA belt, gated on blog-post-cta-default',
  'components/PostView.astro': 'closing CTA belt, gated on blog-post-cta-default',
  'pages/search/label/[tag]/index.astro': 'closing CTA belt, gated on blog-post-cta-default',
  'pages/search/label/[tag]/page/[n].astro': 'closing CTA belt, gated on blog-post-cta-default',
};

test('no vendor identity string sits in executable source outside the allowlist', () => {
  const hits = walk(SRC)
    .filter((p) => /\.(astro|mjs|js|ts)$/.test(p))
    .map((p) => [relative(SRC, p), findPhrases(readFileSync(p, 'utf8'))])
    .filter(([rel, found]) => found.length > 0 && !ALLOWED[rel]);
  assert.deepEqual(hits.map(([rel, found]) => `${rel}: ${found.join(', ')}`), [],
    'The vendor\'s own name/voice reached a tenant\'s renderer. Take it from site meta instead — ' +
    'or, if it is genuinely gated on an opt-in key, add the file to ALLOWED with that key.');
});

test('every allowlisted file still carries its opt-in gate', () => {
  for (const rel of Object.keys(ALLOWED)) {
    const src = readFileSync(join(SRC, rel), 'utf8');
    assert.ok(src.includes('blog-post-cta-default'),
      `${rel} is allowlisted for a gated CTA belt, but no longer mentions blog-post-cta-default — ` +
      'the gate moved or vanished, so the allowlist entry is now a hole.');
  }
});

// ── CONTROLS. A guard nobody has watched fail only proves it is quiet on clean input. ──
test('control: the phrase detector fires on each of the three real regressions', () => {
  assert.deepEqual(findPhrases("const t = meta['blog-title'] || 'Devlog';"), ['Devlog'],
    'the fallback that named every tenant\'s blog went undetected');
  assert.deepEqual(findPhrases("<p>{meta['blog-tagline'] ?? 'Short build logs and hard-won tricks from the workshop.'}</p>"),
    ['hard-won tricks from the workshop'], 'the tagline fallback went undetected');
  assert.deepEqual(findPhrases('const xml = `<title>${esc(meta.title)} — Devlog</title>`;'), ['Devlog'],
    'the unconditional RSS suffix went undetected — this one no site config could even reach');
});

test('control: the detector stays quiet on the RIGHT answers', () => {
  assert.deepEqual(findPhrases("if (!meta['blog-path']) return '/devlog';"), [],
    'the historic URL path is not an identity leak — flagging it would train people to ignore this');
  assert.deepEqual(findPhrases('// the old literal was `— Devlog`, see rss.xml.js'), [],
    'a comment explaining the bug must not BE the bug');
  assert.deepEqual(findPhrases("const u = 'https://example.com/devlog';"), [],
    '// inside a URL is not a comment');
});

test('control: the route gate is capable of returning false', () => {
  // If this ever passes trivially, the gate has gone blind and every site gets a blog again.
  assert.equal(blogInstalled({}, []), false);
});

console.log(`\n${passed} passed`);
