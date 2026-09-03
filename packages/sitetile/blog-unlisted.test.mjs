// Guard: `blog-unlisted-categories` takes posts out of every LIST while leaving their PAGES alive.
//   run: node packages/sitetile/blog-unlisted.test.mjs   (wired into scripts/test.sh)
//
// WHY THIS EXISTS. sodaart asked to take eight VTubers' 291 posts out of NEWS (chodaict,
// 2026-08-19) and picked, out of three offered outcomes, the middle one: gone from every list we
// generate, URL still answering 200, no 404 and no redirect. Every one of those posts has been
// published since the Wix era, so the draft-flag answer would have burned 873 indexed URLs
// (291 × three locales) to satisfy a request about a sidebar.
//
// That makes this feature one sentence — "a list must not show it, a router must still build it" —
// and the sentence has exactly two ways to break, so both are guarded here:
//
//   · a LIST that forgets to filter → the posts leak out through RSS, the sitemap, an archive, a
//     tag cloud. Nothing goes red; the site just keeps showing what the owner asked it to hide.
//   · a ROUTER that starts filtering → the URL 404s and the feature has silently become the thing
//     the owner did NOT choose. The dangerous one is pages/reef-posts.json.js, where the damage
//     lands one build later (see its own header).
//
// The last two tests are structural for that reason: the unit tests below can only check the call
// sites that exist today, and the failure mode is a call site added tomorrow.

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro', 'src');

// blog.mjs imports the model layer as `@sitetile`, an Astro build alias that plain node cannot
// resolve. The sibling convention (blog-tenancy.mjs) is to split the testable half into a module
// with no such import — right for a concern that is genuinely separable, wrong here: unlisting is
// pagination, sidebars and the category rail, and lifting those out of blog.mjs to make them
// importable would rearrange the renderer to suit its test. Teach the resolver the one alias
// instead, and test the functions the site actually runs. Same target as astro.config.mjs.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') {
      return { url: pathToFileURL(join(HERE, 'site-core.js')).href, shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const {
  allPosts, listedPosts, unlistedCategories, blogCategories, routedCategories,
  buildIndexView, buildPostSidebar,
} = await import('./astro/src/lib/blog.mjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message ? e.message : e)); process.exitCode = 1; }
}

// Real markdown through the real parser — a hand-built {slug, categories} object would agree with
// whatever this test imagines parsePost does, which is the one thing worth not assuming.
const md = (title, date, cats) =>
  `---\ntitle: "${title}"\npubDate: ${date}\n${cats ? `categories: ${cats}\n` : ''}---\n\n${title} body text.\n`;

const CORPUS = allPosts({
  '/s/blog/mine-1.md':  md('Mine 1',  '2024-01-05', '深空眠'),
  '/s/blog/mine-2.md':  md('Mine 2',  '2024-01-04', '深空眠'),
  '/s/blog/both.md':    md('Both',    '2024-01-03', 'staff, 深空眠'),   // the 14-post shape
  '/s/blog/staff-1.md': md('Staff 1', '2024-01-02', 'staff'),
  '/s/blog/sesame.md':  md('Sesame',  '2024-01-01', '烈芝麻'),
  '/s/blog/plain.md':   md('Plain',   '2023-12-31', null),              // no categories at all
});

const META = {
  'blog-unlisted-categories': '深空眠',
  'blog-category-routes': 'true',
  'blog-category-sidebar': 'true',
  'blog-page-size': '2',
  'blog-categories': 'All Posts|6|/diary || ☆ STAFF|2|/category/staff/ || ⓥ 深空眠|3|/category/深空眠/ || ⓥ 烈芝麻|1|/category/烈芝麻/',
};
const OFF = { ...META };
delete OFF['blog-unlisted-categories'];

const slugs = (ps) => ps.map((p) => p.slug);
const cardSlugs = (cards) => cards.map((p) => String(p.href).replace(/\/+$/, '').split('/').pop());

test('the config line parses, and an absent one is an empty set', () => {
  assert.deepEqual([...unlistedCategories(META)], ['深空眠']);
  assert.equal(unlistedCategories(OFF).size, 0);
  assert.equal(unlistedCategories({}).size, 0);
  assert.deepEqual([...unlistedCategories({ 'blog-unlisted-categories': 'a, b ,c' })], ['a', 'b', 'c']);
});

test('CONTROL — a site that unlists nothing gets its corpus back untouched', () => {
  // The whole existing tenant base lives in this branch. If it ever fails, every blog on the
  // platform has quietly changed shape.
  assert.equal(listedPosts(CORPUS, OFF), CORPUS, 'same array identity, not a copy');
  assert.deepEqual(blogCategories(OFF, CORPUS), blogCategories(OFF), 'rail is the authored line, verbatim');
  assert.equal(blogCategories(OFF).length, 4);
});

test('a post is unlisted when ANY of its categories is — including one it shares with a kept one', () => {
  assert.deepEqual(slugs(listedPosts(CORPUS, META)), ['staff-1', 'sesame', 'plain']);
  // `both` carries `staff`, which is being KEPT, and it is gone anyway. "Hide this person's posts"
  // is not satisfied by a rule that leaks them out through the company archive.
  assert.ok(!slugs(listedPosts(CORPUS, META)).includes('both'));
});

test('a post with no categories at all is never unlisted', () => {
  assert.ok(slugs(listedPosts(CORPUS, META)).includes('plain'));
});

test('listedPosts is idempotent — a surface may filter after another already did', () => {
  const once = listedPosts(CORPUS, META);
  assert.deepEqual(slugs(listedPosts(once, META)), slugs(once));
});

test('the category rail drops hidden rows and re-counts the ones it keeps', () => {
  const rail = blogCategories(META, listedPosts(CORPUS, META));
  assert.deepEqual(rail.map((r) => r.label), ['All Posts', '☆ STAFF', 'ⓥ 烈芝麻']);
  // 🔴 STAFF was authored as 2 and is now 1: `both` still carries `staff` but no reader can reach
  // it. An authored count that has stopped measuring what it names is the defect this re-count
  // exists for — it is not cosmetic, it is the rail telling the truth about its own links.
  assert.deepEqual(rail.map((r) => r.count), ['3', '1', '1']);
});

test('a category whose every post is unlisted loses its row, because it will have no archive', () => {
  const meta = { ...META, 'blog-unlisted-categories': '深空眠, 烈芝麻' };
  const rail = blogCategories(meta, listedPosts(CORPUS, meta));
  assert.deepEqual(rail.map((r) => r.label), ['All Posts', '☆ STAFF']);
});

test('routedCategories never names an unlisted archive, even handed the FULL corpus', () => {
  // The backstop that stops a tag chip becoming an <a> to a route getStaticPaths never emitted.
  assert.deepEqual([...routedCategories(CORPUS, META)].sort(), ['staff', '烈芝麻']);
});

test('the index paginates what it will show, not what exists', () => {
  const view = buildIndexView(CORPUS, META, 1);
  assert.equal(view.totalPages, 2, '3 listed posts at page size 2');
  assert.deepEqual(slugs(view.pagePosts), ['staff-1', 'sesame']);
  assert.deepEqual(slugs(view.recentPosts), ['staff-1', 'sesame', 'plain']);
  assert.equal(buildIndexView(CORPUS, OFF, 1).totalPages, 3, 'control: 6 posts → 3 pages');
});

test("a post page's own sidebar offers no way into the unlisted set", () => {
  const meta = { ...META, 'blog-post-sidebar': 'left', 'blog-sidebar-related': 'true' };
  const side = buildPostSidebar(CORPUS, meta, CORPUS.find((p) => p.slug === 'staff-1'));
  assert.deepEqual(cardSlugs(side.recentPosts), ['staff-1', 'sesame', 'plain']);
  assert.ok(!cardSlugs(side.related).includes('both'));
  // …and that holds on an UNLISTED post's page too, which still renders.
  const fromHidden = buildPostSidebar(CORPUS, meta, CORPUS.find((p) => p.slug === 'mine-1'));
  assert.ok(!cardSlugs(fromHidden.recentPosts).some((s) => ['mine-1', 'mine-2', 'both'].includes(s)));
});

// ── structural: the two failure modes the unit tests above cannot see ─────────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|mjs|js|ts)$/.test(name)) out.push(p);
  }
  return out;
}
// 🔴 Comments are stripped before any of this looks at the source. This very file, and the long
// explanations in blog.mjs, name every identifier being searched for — so a check reading raw text
// would be satisfied by the prose written to explain it.
//
// 🩸 Line-based, and the first version was not. A whole-file `/\*[\s\S]*?\*\//` strip finds its
// opening delimiter inside `import.meta.glob('../../../../../blog/*.md')` — a PATH, not a comment —
// and eats everything up to the next `*/`, which in two of these routes swallowed the very
// `listedPosts(...)` call being looked for. The guard failed, the code was correct, and the report
// named two innocent files. A line whose TRIMMED form opens a block cannot be confused with a glob.
const code = (p) => {
  const out = [];
  let inBlock = false;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    let l = raw;
    if (inBlock) { const end = l.indexOf('*/'); if (end < 0) { out.push(''); continue; } l = l.slice(end + 2); inBlock = false; }
    if (l.trim().startsWith('/*')) { const end = l.indexOf('*/'); if (end < 0) { inBlock = true; out.push(''); continue; } l = l.slice(end + 2); }
    out.push(l.replace(/(^|\s)\/\/.*$/, '$1'));
  }
  return out.join('\n');
};

// Named, and only these two. Both are places where filtering would DELETE rather than hide.
// The verdict manifest is also a full-corpus consumer: unlisted means hidden from lists, not
// unrouted, so a private unlisted post still needs its generated gate.
const EXEMPT = ['pages/reef-posts.json.js', 'pages/reef-verdict.json.js'];

test('every surface that reads the post corpus filters it — or is a named exception', () => {
  const offenders = [];
  for (const f of walk(SRC)) {
    const rel = relative(SRC, f).split('\\').join('/');
    if (rel === 'lib/blog.mjs') continue;                       // where both functions live
    const src = code(f);
    if (!/\ballPosts\s*\(/.test(src)) continue;
    if (EXEMPT.includes(rel)) continue;
    // localeBlogCorpora (lib/blog.mjs) is the OTHER legitimate filter, alongside listedPosts
    // itself: it calls listedPosts internally, per locale, and hands back the result as its own
    // `.listed` field — the Lingo × Blog locale category/tag archive routes (and the sitemap) read
    // ONLY that field downstream, never the corpus they pass in. A file that calls allPosts() and
    // then only ever narrows it through one of these two names is filtering; one that calls
    // neither is the defect this test exists to catch.
    if (!/\blistedPosts\s*\(/.test(src) && !/\blocaleBlogCorpora\s*\(/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'these read every post and list them unfiltered:\n      ' + offenders.join('\n      '));
});

test('the named exceptions still exist — an exemption for a deleted file protects nothing', () => {
  for (const rel of EXEMPT) {
    const src = code(join(SRC, rel));
    assert.ok(/\ballPosts\s*\(/.test(src), `${rel}: exempt but no longer reads the corpus`);
    assert.ok(!/\blistedPosts\s*\(/.test(src), `${rel}: now filters — see its header for why it must not`);
  }
});

test('the router still emits a page for EVERY post, unlisted ones included', () => {
  // The line that keeps 291 URLs answering 200. If the post loop ever iterates the listed corpus,
  // outcome (b) has silently become outcome (c) and no list-side test would notice.
  const src = code(join(SRC, 'pages/[...path].astro'));
  assert.match(src, /posts\.forEach\(\(post\)/, 'the post-route loop must walk the FULL corpus');
  assert.ok(!/listed\.forEach\(/.test(src), 'the post-route loop must not walk the listed corpus');
  assert.match(src, /postsL\.forEach\(\(post\)/, 'same for the per-locale post routes');
  assert.ok(!/listedL\.forEach\(/.test(src), 'same for the per-locale post routes');
});

test('a translated post inherits its categories, or the filter is inert outside the default locale', () => {
  // 🩸 Measured on feelreef/site-sodaart, 2026-08-19: `ir/posts/*.md` carries `categories:` on 517
  // of 585 files; `ir/posts/zh-tw/*.md` and `ir/posts/en-us/*.md` carry it on 0 of 585 each, with
  // identical slugs across all three. Without this inheritance, unlisting would have cleaned the
  // Japanese NEWS and left all 291 posts sitting in /zh-tw/diary and /en-us/diary.
  //
  // 🩸 2026-09-03 (Lingo × Blog locale category/tag archives): this used to be inline in
  // pages/[...path].astro's own getStaticPaths — the ONLY place a translated post's corpus was
  // built. It moved to lib/blog.mjs's localeBlogCorpora() so the sitemap and the NEW locale
  // category/tag archive routes could share the identical resolution instead of a second hand-copy
  // (exactly the class of drift this whole file's unlisting feature would have shipped as, one
  // file later, unnoticed — see blog-locale-archives.test.mjs for the behavioural unit tests on the
  // function itself). [...path].astro now just calls it; the source pattern below moved with it.
  const src = code(join(SRC, 'lib/blog.mjs'));
  const at = src.indexOf('const postsL =');
  assert.ok(at > 0, 'the per-locale corpus is built here (localeBlogCorpora)');
  const before = src.slice(0, at);
  assert.match(before, /new Map\(\(basePosts \|\| \[\]\)\.map\(\(p\) => \[p\.slug, p\]/,
    'localeBlogCorpora must map the FULL base corpus by slug before parsing a locale\'s own posts');
  assert.match(src.slice(at, at + 500), /inheritLocalePrivacy\(p, baseBySlug\.get\(p\.slug\)\)/,
    'localeBlogCorpora must apply the monotonic privacy verdict before rendering a translation');
  assert.match(src.slice(at, at + 700), /const categories = baseBySlug\.get\(p\.slug\)\?\.categories/,
    'and hand those categories to a translation that states none');
  // And the call site: [...path].astro must still be the one place a default-locale build reaches
  // this — not a second, drifted copy of the block itself.
  const caller = code(join(SRC, 'pages/[...path].astro'));
  assert.match(caller, /\blocaleBlogCorpora\s*\(/, '[...path].astro must call the shared helper, not re-inline it');
  assert.ok(!/const postsL =/.test(caller), 'and must not ALSO carry its own copy of the block');
});

test('the rail counts the whole site, even on an archive page that lists a slice of it', () => {
  // 🩸 Self-inflicted, caught before it shipped. The rail used to quote AUTHORED counts, so it read
  // the same on every page by construction. Re-counting it (see blogCategories) made it a function
  // of whatever corpus buildIndexView was handed — and ArchiveView hands it ONE archive's members.
  // /category/staff/ would have shown "All Posts (1)". The list and the rail answer two different
  // questions: what is on this page, and what does this site hold.
  const view = buildIndexView(
    listedPosts(CORPUS, META).filter((p) => (p.categories || []).includes('staff')),
    META, 1, listedPosts(CORPUS, META),
  );
  assert.deepEqual(view.categories.map((r) => `${r.label} ${r.count}`),
    ['All Posts 3', '☆ STAFF 1', 'ⓥ 烈芝麻 1']);
  assert.deepEqual(slugs(view.pagePosts), ['staff-1'], 'the LIST is still just this archive');
});

test('no pager is sized from the unfiltered corpus', () => {
  // 🩸 Added because the knife found it: breaking this was the one deliberate break the first
  // version of this suite stayed green through. A route's `Math.ceil(...)` decides how many
  // /page/<n> URLs EXIST, and buildIndexView's decides what each one shows — two counts, two
  // files, and only the second was guarded. Size the first from the full corpus and the blog ends
  // in a run of pages that render nothing, reachable from a pager that looks complete.
  const src = code(join(SRC, 'pages/[...path].astro'));
  assert.match(src, /Math\.ceil\(listed\.length \/ pageSize\)/, 'default-locale pager counts the listed corpus');
  assert.match(src, /Math\.ceil\(listedL\.length \/ psL\)/, 'per-locale pager counts the listed corpus');
  assert.ok(!/Math\.ceil\(posts\.length/.test(src), 'a pager is sized from the UNFILTERED corpus');
  assert.ok(!/Math\.ceil\(postsL\.length/.test(src), 'a per-locale pager is sized from the UNFILTERED corpus');
});

test('the archive routes touch their unfiltered corpus only to filter it', () => {
  // Each of these reads the glob into `allPostsIn` and immediately narrows it. Two mentions is the
  // whole legitimate life of that name; a third is normally a counter, a slice or a props hand-off
  // that skipped the filter — the same defect as above, one directory over.
  //
  // 🩸 2026-09-03 (Lingo × Blog locale category/tag archives): the two PAGE-1 routes gained a real
  // third use — termLocaleMap('category'|'tag', …, allPostsIn, posts) needs the FULL base corpus
  // for the SAME inheritance reason localeBlogCorpora does (a category-inheritance-by-slug check
  // must see every base post, not just the listed ones), to compute this page's own reciprocal
  // hreflang (alternateArchiveLocales). Their own pager siblings (page/[n].astro) don't compute
  // hreflang at all (see their file header) and stay at 2, like every route this feature left
  // untouched.
  const EXPECT = {
    'pages/category/[slug]/index.astro': 3, 'pages/category/[slug]/page/[n].astro': 2,
    'pages/tag/[slug]/index.astro': 3,      'pages/tag/[slug]/page/[n].astro': 2,
    'pages/author/[slug]/index.astro': 2,   'pages/author/[slug]/page/[n].astro': 2,
    'pages/search/label/[tag]/index.astro': 2, 'pages/search/label/[tag]/page/[n].astro': 2,
  };
  for (const [rel, expected] of Object.entries(EXPECT)) {
    const n = (code(join(SRC, rel)).match(/\ballPostsIn\b/g) || []).length;
    assert.equal(n, expected, `${rel}: mentions the unfiltered corpus ${n} times, expected ${expected}`);
  }
});

test('the two NEW locale-scoped archive routes read the base corpus only for hreflang, and their own locale corpus only through localeBlogCorpora', () => {
  // [...loc]/category and [...loc]/tag PAGE-1 mirror the base routes' shape: bind, listedPosts →
  // baseListed (termLocaleMap's own 6th arg needs the LISTED base corpus, matching what the base
  // routes already pass), then termLocaleMap's basePosts arg — 3, same as the base routes. Their
  // pager siblings don't compute hreflang and never call termLocaleMap, so they stay at 2 (bind +
  // the localeBlogCorpora call, which does the rest — their own locale corpus never touches
  // allPostsIn a third time).
  const EXPECT = {
    'pages/[...loc]/category/[slug]/index.astro': 3, 'pages/[...loc]/category/[slug]/page/[n].astro': 2,
    'pages/[...loc]/tag/[slug]/index.astro': 3,       'pages/[...loc]/tag/[slug]/page/[n].astro': 2,
  };
  for (const [rel, expected] of Object.entries(EXPECT)) {
    const n = (code(join(SRC, rel)).match(/\ballPostsIn\b/g) || []).length;
    assert.equal(n, expected, `${rel}: mentions the unfiltered corpus ${n} times, expected ${expected}`);
  }
});

console.log(`\nblog-unlisted: ${passed} passed`);
