// Guard: a blog post's own `description:` must reach the <head>, on every sitetile site.
//   run: node packages/sitetile/post-share-meta.test.mjs   (wired into scripts/test.sh)
//
// WHY THIS EXISTS. Measured on a live site, not imagined: every page and every post
// emitted `og:title` and ZERO description — no <meta name="description">, no og:description, no
// twitter:description. Search snippets and every share card (X / Discord / Slack / LINE) were blank
// on a site whose entire stated purpose is being found and shared.
//
// It was not a missing feature. SiteLayout has emitted all three tags for weeks, gated on a truthy
// `description`, and `parsePost()` has always lifted `description:` out of a post's frontmatter into
// `post.description`. The value was parsed and then dropped: PostView handed SiteLayout the SITE's
// frontmatter as `meta`, and the post's own never joined it. A whole feature sat one hop away from
// the tag that consumes it, and nothing was red — which is exactly the shape this repo keeps
// re-learning (see generator-provenance.test.mjs, same family).
//
// It reads SOURCE rather than a built page for the same reason its sibling does: the failure being
// guarded is someone re-simplifying `meta={headMeta}` back to `meta={meta}`, and that is visible in
// the source of truth without standing up a build.
//
// NOT guarded here: whether any given site's PAGES carry `description:` in their own frontmatter.
// That is the other half of the same live symptom and it is a content question per site, not a
// platform invariant — a site is allowed to ship a page with no description.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(HERE, 'astro', 'src', ...p), 'utf8');
const postView = read('components', 'PostView.astro');
const layout = read('layouts', 'SiteLayout.astro');

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`  ✓ ${name}`); };

// ── 1. the plumbing: PostView must hand the head a merged meta, not the bare site meta ──────────
// Lift the REAL expression out and evaluate it, so this exercises the rule rather than a paraphrase.
function headMetaFor(post, meta) {
  const m = postView.match(/const headMeta = [^;]+;/);
  assert.ok(m, 'could not find the headMeta resolver in PostView.astro — did it get renamed?');
  const body = m[0].replace('const headMeta =', 'return (').replace(/;$/, ')');
  // eslint-disable-next-line no-new-func
  return new Function('post', 'meta', body)(post, meta);
}

check('a post description wins over the site description in the head', () => {
  const out = headMetaFor({ description: 'the post one' }, { description: 'the site one', title: 'S' });
  assert.equal(out.description, 'the post one');
  assert.equal(out.title, 'S', 'the rest of the site meta must survive the merge');
});

check('a post with no description falls back to the site, it does not blank it', () => {
  const out = headMetaFor({ description: '' }, { description: 'the site one' });
  assert.equal(out.description, 'the site one');
});

check('SiteLayout is handed headMeta, not the bare site meta', () => {
  const tag = postView.match(/<SiteLayout[^>]*>/);
  assert.ok(tag, 'could not find the <SiteLayout> call in PostView.astro');
  assert.match(tag[0], /meta=\{headMeta\}/,
    'PostView must pass meta={headMeta} — passing meta={meta} silently drops every post description');
});

check('the body still reads site meta (the merge is head-only)', () => {
  assert.match(postView, /const relatedLabel = String\(meta\[/,
    'sidebar/CTA/label reads must keep using the SITE meta; if they moved to headMeta, say so on purpose');
});

// ── 2. the consumer: the three tags must exist and stay gated on description ─────────────────────
for (const tag of [
  ['<meta name="description">', /\{description && <meta name="description"/],
  ['og:description', /\{description && <meta property="og:description"/],
  ['twitter:description', /\{description && <meta name="twitter:description"/],
]) {
  check(`SiteLayout still emits ${tag[0]}`, () => {
    assert.match(layout, tag[1], `SiteLayout stopped emitting ${tag[0]} — the plumbing above now feeds nothing`);
  });
}

check('SiteLayout reads description from meta', () => {
  assert.match(layout, /const description = meta\.description/,
    'if the source of `description` moved, the PostView merge above may no longer reach it');
});

// ── 3. control group: prove these assertions can actually fail ───────────────────────────────────
// A check nobody has watched fail is a check nobody has watched. Each probe below is the real
// assertion re-run against deliberately broken input; every one MUST throw.
const mustFail = (name, fn) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  assert.ok(threw, `CONTROL GROUP FAILED: "${name}" passed on broken input — this ruler measures nothing`);
  checks++;
  console.log(`  ✓ [control] ${name} fires when broken`);
};

mustFail('the plumbing check', () => {
  const broken = postView.replace('meta={headMeta}', 'meta={meta}');
  const tag = broken.match(/<SiteLayout[^>]*>/);
  assert.match(tag[0], /meta=\{headMeta\}/);
});

mustFail('the og:description check', () => {
  const broken = layout.replace(/\{description && <meta property="og:description"[^/]*\/>\}/, '');
  assert.match(broken, /\{description && <meta property="og:description"/);
});

mustFail('the merge check', () => {
  // a "simplification" that looks harmless and silently blanks every post's card
  const out = new Function('post', 'meta', 'return ({ ...meta })')({ description: 'the post one' }, { description: '' });
  assert.equal(out.description, 'the post one');
});

// ── 4. og:site_name must be a SITE constant, not whatever the page calls itself ──────────────────
// Measured live: a site said its real name on / and its posts, but each inner page's own TITLE on
// /about/ and /oss/. A crawler reading three pages of one site saw three site names.
// Root cause: og:site_name reused `headerBrand`, whose fallback chain ends at meta.title — and the
// catch-all merges PAGE frontmatter over site config, so meta.title is the page's on any page with
// its own. Fixed by stashing `site-title` before that merge; asserted on both halves here.
const catchAll = readFileSync(join(HERE, 'astro', 'src', 'pages', '[...path].astro'), 'utf8');

check('the catch-all stashes site-title AFTER the page merge, so a page cannot clobber it', () => {
  const m = catchAll.match(/site\.meta = \{[^}]*\}/);
  assert.ok(m, 'could not find the site-config merge in [...path].astro');
  assert.match(m[0], /\.\.\.site\.meta,\s*'site-title':/,
    "'site-title' must come after ...site.meta — placed before it, a page's own site-title would win");
});

check('the layout reads og:site_name from site-title, not headerBrand', () => {
  assert.match(layout, /const ogSiteName = \(meta\['site-title'\]/,
    'og:site_name must resolve from the stashed site title');
  assert.match(layout, /<meta property="og:site_name" content=\{ogSiteName\}/,
    'the tag must consume ogSiteName; consuming headerBrand is the bug this guards');
});

check('og:site_name still falls back to headerBrand (legacy sites with no _site.md)', () => {
  const m = layout.match(/const ogSiteName = [^;]+;/);
  const body = m[0].replace('const ogSiteName =', 'return (').replace(/;$/, ')');
  // eslint-disable-next-line no-new-func
  const resolve = (meta, headerBrand) => new Function('meta', 'headerBrand', body)(meta, headerBrand);
  assert.equal(resolve({}, 'Legacy Brand'), 'Legacy Brand');
  assert.equal(resolve({ 'site-title': 'ATLAS.DEV' }, 'About Atlas'), 'ATLAS.DEV');
});

mustFail('the og:site_name consumer check', () => {
  const broken = layout.replace('content={ogSiteName}', 'content={headerBrand}');
  assert.match(broken, /<meta property="og:site_name" content=\{ogSiteName\}/);
});

// ── 5. a page with no authored description falls back to what it opens with ──────────────────────
// Measured live: 96 of a site's 96 pages carried no `description:`. Requiring 24 pages × 4
// locales of marketing copy before a share card works is the wrong bar; an authored description
// still wins, this only fills the hole.
const { deriveDescription } = await import('./site-core.js');
const pageView = read('components', 'PageView.astro');

check('PageView only derives when the author wrote nothing', () => {
  assert.match(pageView, /site\.meta\.description\s*\n?\s*\?\s*site\.meta/,
    'an authored description must win — deriving over it would silently replace the author');
  assert.match(pageView, /meta=\{headMeta\}/, 'the derived description has to actually reach the head');
});

check('derives from the first prose section', () => {
  assert.equal(deriveDescription([{ type: 'prose', body: 'The real text.' }]), 'The real text.');
});

check('skips embed/gallery/social — none of them is prose a human wrote as a summary', () => {
  assert.equal(deriveDescription([
    { type: 'embed', body: '<script>alert(1)</script>' },
    { type: 'gallery', body: '![](/a.jpg)' },
    { type: 'prose', body: 'The real text.' },
  ]), 'The real text.');
});

check('markdown is reduced to what a human would read aloud', () => {
  assert.equal(deriveDescription([{ type: 'prose', body: 'See [our open source](/oss) and **more**.' }]),
    'See our open source and more.', 'links keep their text, emphasis marks go, no gap before punctuation');
});

check('CJK cuts hard because it has no word gaps, and is not mangled', () => {
  const long = '一段中文'.repeat(60);
  const out = deriveDescription([{ type: 'prose', body: long }]);
  assert.ok(out.length <= 161, `too long: ${out.length}`);
  assert.ok(out.startsWith('一段中文'), 'CJK must survive the cut as CJK');
});

check('a page with nothing prose-like derives nothing, rather than inventing something', () => {
  assert.equal(deriveDescription([{ type: 'embed', body: '<div/>' }]), '');
  assert.equal(deriveDescription([]), '');
  assert.equal(deriveDescription(undefined), '');
});

mustFail('the authored-description-wins check', () => {
  const broken = pageView.replace(/site\.meta\.description\s*\n?\s*\?\s*site\.meta/, 'false ? site.meta');
  assert.match(broken, /site\.meta\.description\s*\n?\s*\?\s*site\.meta/);
});

mustFail('the derive-skips-embed check', () => {
  assert.equal(deriveDescription([{ type: 'embed', body: '<script>alert(1)</script>' }]), '<script>alert(1)</script>');
});

console.log(`\n✅ share meta total: ${checks} checks passed (incl. 6 control-group probes)`);
