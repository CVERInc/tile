// Private posts must not have their content leave the build in a PUBLIC artifact.
//   run: node --test private-artifacts.test.mjs
//
// The visibility rule is per-URL: the site's worker asks whether this reader may view the post
// before it serves the post's own page. Every OTHER file a build emits is served with no question
// asked -- the search index the search island fetches, the feed a reader subscribes to, the post
// list the next incremental build reads, and every listing page that shows a card per post. A post
// page that hides a post while /search-index.json hands the same text to anyone is an open door
// beside a closed page.
//
// So the assertions here are about OUTPUT CONTENT: a sentinel string is planted in a private
// post's body and description, the artifact is generated, and the sentinel must not appear in it.
// Each one carries its own positive control -- the SAME post with `visibility` flipped to public,
// through the SAME code, where the sentinel MUST appear. A miss with no control is not evidence of
// a gate; it is equally consistent with an artifact that was never built.
//
// blog.mjs imports the model layer through the `@sitetile` build alias, which only Vite resolves.
// The resolve hook below is what lets a plain `node --test` reach the real functions instead of a
// copy of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'astro/src');
const SITE_CORE = pathToFileURL(join(HERE, 'site-core.js')).href;

register(
  'data:text/javascript,' + encodeURIComponent(
    `export function resolve(spec, ctx, next) {
       if (spec === '@sitetile') return { url: ${JSON.stringify(SITE_CORE)}, shortCircuit: true };
       return next(spec, ctx);
     }`),
  import.meta.url,
);

const blog = await import(pathToFileURL(join(SRC, 'lib/blog.mjs')).href);
const { buildFeedBody, buildReefPostsBody, buildSearchIndexBody } =
  await import(pathToFileURL(join(SRC, 'lib/public-artifacts.mjs')).href);
const {
  allPosts,
  postUrl,
  postCards,
  buildIndexView,
  buildPostSidebar,
  publicFacing,
  publicFacingPosts,
  isPrivatePost,
  gatedPostPaths,
  inheritLocalePrivacy,
} = blog;

// One string, unlikely to occur anywhere else, planted in both the body and the description of the
// post under test. Every assertion below counts its occurrences in a generated artifact.
const SENTINEL = 'QUARTZLINE-93715-PAIDWORDS';

// The post under test, written twice from one template: once private, once public. Nothing but
// the `visibility` line differs, so a difference in any artifact is attributable to that line alone.
const gated = (visibility) => [
  '---',
  'title: The Gated One',
  `description: ${SENTINEL} teaser line`,
  'pubDate: 2026-08-20',
  'tags: [alpha]',
  'author: Ada',
  ...(visibility ? [`visibility: ${visibility}`] : []),
  '---',
  '',
  `${SENTINEL} the paragraph marked private.`,
  '',
].join('\n');

// A second, always-public post keeps the corpus plural, so an artifact that emitted nothing at all
// would fail the positive controls rather than pass the negative ones.
const open = [
  '---',
  'title: The Open One',
  'description: open teaser line',
  'pubDate: 2026-08-19',
  'tags: [alpha]',
  'author: Ada',
  '---',
  '',
  'Freely readable paragraph.',
  '',
].join('\n');

// Shaped like the `import.meta.glob('../../blog/*.md')` result the routes and endpoints pass in.
const corpus = (visibility) => allPosts({
  '../../blog/gated-one.md': gated(visibility),
  '../../blog/open-one.md': open,
});

const corpusFromRaw = (raw) => allPosts({
  '../../blog/gated-one.md': raw,
  '../../blog/open-one.md': open,
});

// The leakiest configuration a site can ask for: search index carrying body excerpts, listing cards
// re-capped from the full excerpt text. If content survives anywhere, it survives here.
const META = {
  title: 'Fixture Site',
  'blog-path': '/journal',
  'blog-search': 'true',
  'blog-search-body': 'true',
  'blog-search-excerpt-chars': '400',
  'blog-excerpt-chars': '400',
  'blog-author': 'Ada',
};

const hits = (haystack) => haystack.split(SENTINEL).length - 1;

test('gated URL manifest follows the renderer URL builder across source-faithful shapes', () => {
  const posts = allPosts({
    '../../blog/default-one.md': gated('private'),
    '../../blog/pattern-one.md': gated('private'),
    '../../blog/permalink-one.md': gated('private').replace('visibility: private', 'visibility: private\npermalink: /archive/deep/permalink-one'),
    '../../blog/public-one.md': gated('public'),
  });
  assert.deepEqual(
    gatedPostPaths(posts, { 'blog-path': '/devlog' }),
    ['/devlog/default-one', '/devlog/pattern-one', '/archive/deep/permalink-one'],
  );
  assert.deepEqual(
    gatedPostPaths(posts, { 'blog-url-pattern': '/%year%/%monthnum%/%postname%' }),
    ['/2026/08/default-one', '/2026/08/pattern-one', '/archive/deep/permalink-one'],
  );

  const translated = allPosts({ '../../blog/zh-tw/default-one.md': gated('public') });
  const inherited = translated.map((post) => inheritLocalePrivacy(post, posts.find((p) => p.slug === 'default-one')));
  assert.deepEqual(
    gatedPostPaths(inherited, { 'blog-path': '/zh-tw/devlog', 'blog-url-pattern': '/zh-tw/devlog/%postname%' }),
    ['/zh-tw/devlog/default-one'],
  );
  assert.deepEqual(gatedPostPaths(posts.filter((p) => !isPrivatePost(p)), { 'blog-path': '/devlog' }), []);
});

// ---- the three public artifacts -------------------------------------------------------------

// The body builders are the plain-node seams used by the glob-backed endpoints.
const searchIndexBody = (visibility) => buildSearchIndexBody(corpus(visibility), META);

const reefPostsBody = (visibility) => buildReefPostsBody(corpus(visibility), META);

const feedBody = (visibility) => buildFeedBody(corpus(visibility), META, 'https://fixture.example');

test('search index: private body absent, and present the moment the post goes public', () => {
  const privatePost = searchIndexBody('private');
  assert.equal(hits(privatePost), 0, `search index leaked the gated body:\n${privatePost}`);

  // positive control -- same sentinel, same post, same serializer, visibility flipped.
  const asPublic = searchIndexBody('public');
  assert.ok(hits(asPublic) > 0, 'control failed: the public build carries no sentinel either, so the negative case proves nothing');

  // the post is still IN the index -- gating content, not erasing the post from the site.
  assert.ok(privatePost.includes('The Gated One'), 'the gated post vanished from the index entirely');
  assert.ok(privatePost.includes('/journal/gated-one'), 'the gated post lost its url');
});

test('reef-posts: the private post names the post and carries none of its content', () => {
  const privatePost = reefPostsBody('private');
  assert.equal(hits(privatePost), 0, `reef-posts leaked the gated body:\n${privatePost}`);

  // Control for THIS artifact is the input, because reef-posts carries no content field for any
  // post: prove the sentinel is in the corpus the mapping reads, so its absence is the mapping's
  // doing and not a fixture that never had it.
  assert.ok(hits(JSON.stringify(corpus('private'))) > 0, 'control failed: the corpus itself has no sentinel');
  assert.ok(reefPostsBody('public').includes('gated-one'),
    'control failed: the public post disappeared from the reef list');

  // And pin the reason it is safe. A later field added here is exactly the "one more exit" this
  // file exists to catch, so the row shape is asserted, not assumed.
  const rows = corpus('private').map((p) => ({ slug: p.slug, url: postUrl(p, META) }));
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['slug', 'url'],
      'reef-posts rows grew a field -- if it can hold content, it needs the private-post check too');
  }
  assert.ok(privatePost.includes('gated-one'), 'the gated post must still be listed');
});

test('feed: the item keeps its title and link and loses its description', () => {
  const privatePost = feedBody('private');
  assert.equal(hits(privatePost), 0, `feed leaked the gated body or description:\n${privatePost}`);

  const asPublic = feedBody('public');
  assert.ok(hits(asPublic) > 0, 'control failed: the public feed carries no sentinel either');

  assert.ok(privatePost.includes('<title>The Gated One</title>'), 'the gated item vanished from the feed');
  assert.ok(privatePost.includes('https://fixture.example/journal/gated-one'), 'the gated item lost its link');
  assert.ok(privatePost.includes('<description></description>'), 'expected an emptied item description');
});

// ---- the listing pages, and the corpus every aggregate is built from --------------------------

test('listing cards (blog index, tag, category, author, date archive) drop the excerpt', () => {
  // Every one of those routes renders `p.description || p.excerpt` over buildIndexView's pagePosts.
  const view = buildIndexView(corpus('private'), META, 1);
  const cards = JSON.stringify(view.pagePosts);
  assert.equal(hits(cards), 0, `a listing card leaked the gated body or description:\n${cards}`);

  const asPublic = JSON.stringify(buildIndexView(corpus('public'), META, 1).pagePosts);
  assert.ok(hits(asPublic) > 0, 'control failed: the public listing carries no sentinel either');

  assert.ok(cards.includes('The Gated One'), 'the gated post must still appear in the list');
});

test('archive view-models carry public metadata but no private content', () => {
  const indexMeta = { ...META, 'blog-sidebar': 'true' };
  const sidebarMeta = { ...indexMeta, 'blog-post-sidebar': 'right' };
  const posts = corpus('private');
  const indexArchive = buildIndexView(posts, indexMeta, 1).archive;
  const sidebarArchive = buildPostSidebar(posts, sidebarMeta, posts.find((p) => p.slug === 'open-one')).archive;

  assert.ok(hits(JSON.stringify(posts)) > 0, 'control failed: the raw corpus has no private sentinel');
  for (const [name, archive] of [['index', indexArchive], ['post sidebar', sidebarArchive]]) {
    const entries = archive.flatMap((year) => year.months.flatMap((month) => month.posts));
    const gatedEntry = entries.find((p) => p.slug === 'gated-one');
    assert.ok(gatedEntry, `${name} archive lost the gated post`);
    assert.equal(hits(JSON.stringify(archive)), 0, `${name} archive carried private content`);
    for (const field of ['body', 'description', 'excerpt', 'excerptText']) {
      assert.equal(Object.hasOwn(gatedEntry, field), false,
        `${name} archive retained private field ${field}`);
    }
    assert.deepEqual(gatedEntry, {
      slug: 'gated-one', title: 'The Gated One', date: '2026-08-20', tags: ['alpha'],
      image: '', author: 'Ada', permalink: undefined,
    });
  }

  const shape = (archive) => archive.map((year) => [year.year, year.count,
    year.months.map((month) => [month.month, month.count, month.posts.map((p) => p.slug)])]);
  assert.deepEqual(shape(indexArchive), shape(sidebarArchive), 'archive paths disagreed');
});

test('public-facing corpus: private body absent from EVERY field, whatever an artifact picks', () => {
  // Field-agnostic, and the durable half of this file: an artifact built from this corpus cannot
  // leak by reaching for a field nobody thought to check.
  const before = JSON.stringify(corpus('private'));
  const after = JSON.stringify(publicFacingPosts(corpus('private')));
  assert.ok(hits(before) > 0, 'control failed: the raw corpus has no sentinel to remove');
  assert.equal(hits(after), 0, `a field still carries the gated content:\n${after}`);
});

test('only `visibility: private` gates; every other value reads as public', () => {
  const bodyOf = (v) => corpus(v).find((p) => p.slug === 'gated-one');
  for (const v of ['private']) {
    const p = publicFacing(bodyOf(v));
    assert.equal(p.body, '');
    assert.equal(p.description, '');
    assert.equal(p.excerpt, '');
    assert.equal(p.excerptText, '');
    // what a listing still needs
    assert.equal(p.title, 'The Gated One');
    assert.equal(p.date, '2026-08-20');
    assert.equal(p.slug, 'gated-one');
    assert.deepEqual(p.tags, ['alpha']);
  }
  for (const v of [null, 'public', 'password', 'Private', 'private-content', '']) {
    const raw = bodyOf(v);
    assert.equal(publicFacing(raw), raw, `visibility ${JSON.stringify(v)} must read as public`);
  }
});

test('🔴 privacy redaction recognizes quoted keys and survives duplicate ordering', () => {
  const variants = [
    gated('private').replace('visibility: private', '"visibility" : "private"'),
    gated('private').replace('visibility: private', 'visibility: private\nvisibility: public'),
    gated('public').replace('visibility: public', 'visibility: public\n"visibility" : "private"'),
  ];
  for (const raw of variants) {
    const posts = corpusFromRaw(raw);
    assert.equal(hits(JSON.stringify(publicFacingPosts(posts))), 0, 'a valid private marker must redact every public-facing field');
    assert.equal(hits(buildSearchIndexBody(posts, META)), 0, 'search must use the same privacy verdict');
    assert.equal(hits(buildFeedBody(posts, META, 'https://fixture.example')), 0, 'feed must use the same privacy verdict');
  }

  const quotedPublic = gated('public').replace('visibility: public', '"visibility" : "public"');
  assert.ok(hits(buildSearchIndexBody(corpusFromRaw(quotedPublic), META)) > 0, 'a quoted public marker remains public');
});

test('🔴 indented and nested visibility-like forms do not become privacy markers', () => {
  for (const raw of [
    gated('public').replace('visibility: public', '  visibility: private'),
    gated('public').replace('visibility: public', 'meta:\n  visibility: private'),
  ]) {
    assert.ok(hits(buildSearchIndexBody(corpusFromRaw(raw), META)) > 0, 'only top-level visibility controls redaction');
  }
});

test('🔴 locale privacy is monotonic: a private base cannot be relaxed, and a private translation tightens itself', () => {
  const basePrivate = corpus('private').find((p) => p.slug === 'gated-one');
  const translatedPublic = corpus('public').find((p) => p.slug === 'gated-one');
  const inheritedPrivate = inheritLocalePrivacy(translatedPublic, basePrivate);
  assert.equal(isPrivatePost(inheritedPrivate), true);
  assert.equal(hits(JSON.stringify(publicFacing(inheritedPrivate))), 0);

  const basePublic = corpus('public').find((p) => p.slug === 'gated-one');
  const translatedPrivate = corpus('private').find((p) => p.slug === 'gated-one');
  assert.equal(isPrivatePost(inheritLocalePrivacy(translatedPrivate, basePublic)), true);
  assert.equal(isPrivatePost(inheritLocalePrivacy(translatedPublic, basePublic)), false);
});

test('post-page cards: private content is absent before the component receives the cards', () => {
  const privateCards = postCards(corpus('private'), META);
  const gatedCard = privateCards.find((p) => p.title === 'The Gated One');
  assert.deepEqual(gatedCard, {
    title: 'The Gated One',
    href: '/journal/gated-one',
    date: '2026-08-20',
    image: '',
    description: '',
  });

  const publicCards = postCards(corpus('public'), META);
  assert.ok(hits(JSON.stringify(publicCards)) > 0,
    'control failed: the public card builder carries no sentinel either');
});

test('post sidebar: a private entry carries only its title and href', () => {
  const sidebarMeta = {
    ...META,
    'blog-post-sidebar': 'right',
    'blog-sidebar': 'true',
    'blog-sidebar-related': 'true',
    'blog-related': '5',
  };
  const privatePosts = corpus('private');
  const current = privatePosts.find((p) => p.slug === 'open-one');
  const sidebar = buildPostSidebar(privatePosts, sidebarMeta, current);
  const recentPrivate = sidebar.recentPosts.find((p) => p.title === 'The Gated One');
  const relatedPrivate = sidebar.related.find((p) => p.title === 'The Gated One');
  const expected = { title: 'The Gated One', href: '/journal/gated-one' };

  assert.deepEqual(recentPrivate, expected, 'recent sidebar entry grew beyond title and href');
  assert.deepEqual(relatedPrivate, expected, 'related sidebar entry grew beyond title and href');
});
