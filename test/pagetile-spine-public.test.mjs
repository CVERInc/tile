#!/usr/bin/env node
// pagetile — what a book of a site may hold: never a page an anonymous visitor cannot read.
//
// The whole-site spine filters nothing by content (test/pagetile-spine.test.mjs). This file pins the
// one edge it has, against the page lists sitetile's REAL builder functions produce, not a copy:
//   1. A members-only post never enters a book, though the sitemap lists it: not by the membership
//      verdict's paths, not by its own `visibility: private`, not in a translation that inherits it.
//   2. A page a redirect rule answers never enters a book (literal, either slash spelling, `*`,
//      `:name`); a query rule shadows nothing.
//   3. A withheld page is not offered as "unticked" either, and no spelling of it gets through.
//   4. The edges the caller owns hold with the builder's own functions: an unlisted post is not in
//      the listed corpus, an unclaimed content file (a draft) is not a page.
//   5. A tag book (buildTagSpine) is the tag archive's own selection and order, minus what is
//      withheld, with the owner's `book: false`; one per locale.
//
// Needs packages/sitetile/astro/node_modules (allPosts reads post bodies with parse5).
// Run: node test/pagetile-spine-public.test.mjs
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as spine from '../packages/pagetile/spine-core.js';

const SITETILE = join(dirname(fileURLToPath(import.meta.url)), '../packages/sitetile');
// blog.mjs imports the model layer as `@sitetile`, an Astro alias plain node cannot resolve; this
// points it at the REAL site-core.js, the same shim the sitetile blog tests use.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === '@sitetile') return { url: pathToFileURL(join(SITETILE, 'site-core.js')).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const blog = await import(pathToFileURL(join(SITETILE, 'astro/src/lib/blog.mjs')).href);
const { contentUrls, canonicalPath } = await import(pathToFileURL(join(SITETILE, 'astro/src/lib/sitemap.mjs')).href);
const { isSiteFile, splitFrontmatter } = await import(pathToFileURL(join(SITETILE, 'site-core.js')).href);
const { navMenuOf } = await import(pathToFileURL(join(SITETILE, 'chrome-links.mjs')).href);

const { buildSiteSpine } = spine;
const buildTagSpine = spine.buildTagSpine || (() => { throw new Error('buildTagSpine is not exported'); });

let pass = 0, fail = 0;
const eq = (fn, b, msg) => {
  let a;
  try { a = fn(); } catch (e) { a = 'THREW: ' + e.message; }
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); }
};
const paths = (s) => s.entries.map((e) => e.path);

// ── the fixture site, as the build sees it ───────────────────────────────────────────────────────
// nav with nesting, nested pages, a draft (no `sitetile-page:` claim), a page a redirect answers,
// two locales, posts with tags: public, members-only, unlisted, and a translation of the
// members-only one that says nothing about privacy itself.
const page = (fm, body = 'Body.') => `---\nsitetile-page: 1\n${fm}\n---\n\n## Section\n${body}\n`;
const CONTENT = {
  '/s/content/_site.md': ['---', 'title: Fixture', 'locales: en, fr', 'blog-unlisted-categories: staff', '---', ''].join('\n'),
  '/s/content/home.md': page('title: Home'),
  '/s/content/about.md': page('title: About'),
  '/s/content/about/team.md': page('title: Team'),
  '/s/content/about/history.md': page('title: History'),
  '/s/content/legal.md': page('title: Legal'),
  '/s/content/old-shop.md': page('title: Old shop'),
  '/s/content/archive/2019.md': page('title: Archive 2019'),
  '/s/content/notes.md': '---\ntitle: Notes\n---\nDRAFT-SENTINEL\n',
  '/s/content/fr/home.md': page('title: Accueil'),
  '/s/content/fr/about.md': page('title: À propos'),
};
const POSTS = blog.allPosts({
  '/s/blog/first.md': '---\ntitle: First\ndate: 2026-01-01\ntags: [essays]\n---\nOpen words.\n',
  '/s/blog/paid.md': '---\ntitle: Paid\ndate: 2026-02-01\nvisibility: private\ntags: [essays]\n---\nPAID-SENTINEL\n',
  '/s/blog/staff.md': '---\ntitle: Staff\ndate: 2026-03-01\ntags: [essays]\ncategories: [staff]\n---\nUnlisted words.\n',
  '/s/blog/third.md': '---\ntitle: Third\ndate: 2026-04-01\ntags: [essays, notes]\n---\nMore words.\n',
  '/s/blog/other.md': '---\ntitle: Other\ndate: 2026-05-01\ntags: [notes]\n---\nOther words.\n',
});
const FR_POSTS = {
  '/s/blog/fr/first.md': '---\ntitle: Premier\ndate: 2026-01-01\ntags: [essais]\n---\nMots.\n',
  '/s/blog/fr/paid.md': '---\ntitle: Payant\ndate: 2026-02-01\ntags: [essais]\n---\nPAYANT-SENTINEL\n',
};
const META = blog.siteMeta({ '/s/content/_site.md': CONTENT['/s/content/_site.md'], '/s/content/home.md': CONTENT['/s/content/home.md'] });
const NAV = navMenuOf(['- Home /', '- About /about', '  - Team /about/team', '  - History /about/history', '- Shop /old-shop', '- Journal /devlog'].join('\n'));
// the `from` column of the site's `_redirects`: one literal, one splat
const REDIRECTED = ['/old-shop', '/archive/*'];

// The page list sitemap.xml.js builds (pages/sitemap.xml.js:46-51): content pages through
// contentUrls with isSiteFile, the blog index, then every LISTED post that has a page here. Each
// entry carries the meta the caller has for it: a content page's frontmatter, a post's fields.
const contentMeta = (u) => {
  const rel = Object.keys(CONTENT).find((k) => contentUrls({ [k]: CONTENT[k] }, META, isSiteFile)[0] === u);
  return rel ? splitFrontmatter(CONTENT[rel]).meta : {};
};
const postEntry = (p, m) => ({ path: blog.postUrl(p, m), meta: { title: p.title, visibility: p.visibility }, tags: p.tags });
const LISTED = blog.listedPosts(POSTS, META);
const [FR] = blog.localeBlogCorpora(CONTENT, FR_POSTS, META, POSTS);
const sitemapPages = (posts = LISTED) => contentUrls(CONTENT, META, isSiteFile).map((u) => ({ path: u, meta: contentMeta(u) }))
  .concat([{ path: canonicalPath(blog.blogBase(META)), meta: { title: 'Journal' } }])
  .concat(posts.filter((p) => blog.postHasPage(p, META)).map((p) => postEntry(p, META)));
// The membership verdict's paths, the way reef-verdict.json.js:17-59 assembles them: the base
// corpus, then each locale's corpus with its base post's privacy inherited.
const GATED = blog.gatedPostPaths(POSTS, META).concat(blog.gatedPostPaths(FR.posts, FR.meta));
const defaultPages = () => sitemapPages().filter((p) => !p.path.startsWith('/fr/'));
const OPTS = { gated: GATED, redirected: REDIRECTED };

// ── 0. the fixture is what it claims to be ───────────────────────────────────────────────────────
eq(() => GATED, ['/devlog/paid', '/fr/devlog/paid'], '0: the verdict gates the members-only post and its translation');
eq(() => sitemapPages().some((p) => p.path === '/devlog/paid'), true, '0: the sitemap\'s list holds the members-only post (the leak this file closes)');
eq(() => splitFrontmatter(FR_POSTS['/s/blog/fr/paid.md']).meta.visibility, undefined, '0: the translation\'s own frontmatter says nothing about privacy');

// ── 1. a members-only post never enters a book ───────────────────────────────────────────────────
{
  const book = () => buildSiteSpine(defaultPages(), NAV, OPTS);
  // (posts the menu does not name sort by path, like any page: whether they should follow the
  // blog's own order instead is not settled, see the spine's header)
  eq(() => paths(book()), ['/', '/about/', '/about/team/', '/about/history/', '/devlog/', '/devlog/first/', '/devlog/other/', '/devlog/third/', '/legal/'],
    '1: the whole-site book: menu order, then the rest by path — no members-only post, no redirected page, no draft, no unlisted post');
  eq(() => paths(book()).includes('/devlog/paid/'), false, '1: the verdict\'s path withholds the members-only post');
  // the verdict alone, with the post's meta saying nothing: still withheld
  const bare = defaultPages().map((p) => ({ path: p.path, meta: { title: p.meta.title } }));
  eq(() => paths(buildSiteSpine(bare, NAV, { gated: GATED })).includes('/devlog/paid/'), false,
    '1: the verdict\'s paths withhold a page whose meta carries no marker');
  // its own marker alone, with no verdict passed: still withheld
  eq(() => paths(buildSiteSpine(defaultPages(), NAV)).includes('/devlog/paid/'), false,
    '1: a page\'s own `visibility: private` withholds it when no verdict is passed');
  eq(() => [' private ', 'private'].map((v) => paths(buildSiteSpine([{ path: '/p/', meta: { visibility: v } }], [])).length), [0, 0],
    '1: `private`, trimmed, is the marker');
  eq(() => ['public', 'Private', '', 'members'].map((v) => paths(buildSiteSpine([{ path: '/p/', meta: { visibility: v } }], [])).length), [1, 1, 1, 1],
    '1: any other value is the post gate\'s "public", read the same way (isPrivatePost)');
  // the French book: the translation inherits privacy; only the verdict (or the corpus' inherited
  // field) knows — its file does not
  const frPages = sitemapPages().filter((p) => p.path.startsWith('/fr/'))
    .concat(FR.listed.map((p) => ({ path: blog.postUrl(p, FR.meta), meta: { title: p.title } })));
  eq(() => frPages.some((p) => p.path === '/fr/devlog/paid'), true, '1: the French list holds the inherited members-only post');
  eq(() => paths(buildSiteSpine(frPages, [], { home: '/fr/', gated: GATED })), ['/fr/', '/fr/about/', '/fr/devlog/first/'],
    '1: the French book withholds the translation of a members-only post');
}

// ── 2. a page a redirect answers never enters a book ─────────────────────────────────────────────
{
  const one = (rules, p) => paths(buildSiteSpine([{ path: p }], [], { redirected: rules })).length;
  eq(() => paths(buildSiteSpine(defaultPages(), NAV, { gated: GATED })).filter((p) => p === '/old-shop/' || p.startsWith('/archive/')),
    ['/old-shop/', '/archive/2019/'], '2: without the redirect rules the shadowed pages are in (the control)');
  eq(() => ['/old-shop', '/old-shop/'].map((r) => one([r], '/old-shop/')), [0, 0], '2: a literal `from`, in either slash spelling, withholds its page');
  eq(() => [one(['/archive/*'], '/archive/2019/'), one(['/archive/*'], '/archive/'), one(['/archive/*'], '/archived/')], [0, 0, 1],
    '2: a splat withholds every page under it, and only those');
  eq(() => [one(['/blog/:slug'], '/blog/hello/'), one(['/blog/:slug'], '/blog/a/b/'), one(['/caf%C3%A9'], '/café/')], [0, 1, 0],
    '2: `:name` is one segment; a percent-encoded `from` names its page');
  eq(() => [one(['/old-shop?id=1'], '/old-shop/'), one(['https://example.com/old-shop'], '/old-shop/'), one([''], '/'), one(['/x'], '/')], [1, 1, 1, 1],
    '2: a query rule, an off-site `from` or an unrelated rule withholds nothing');
}

// ── 3. withheld is not "unticked", and no spelling gets through ──────────────────────────────────
{
  const s = buildSiteSpine([{ path: '/' }, { path: '/paid/', meta: { visibility: 'private', book: 'false' } }, { path: '/legal/', meta: { book: 'false' } }], [], OPTS);
  eq(() => [paths(s), s.excluded], [['/'], ['/legal/']], '3: a withheld page is not offered as unticked; an unticked public page is');
  eq(() => paths(buildSiteSpine([{ path: '/devlog/paid/', meta: {} }, { path: '/devlog/paid', meta: { visibility: 'private' } }], [])), [],
    '3: a page listed twice, one spelling marked private, is withheld in both');
  eq(() => paths(buildSiteSpine([{ path: '/devlog/paid/' }], [], { gated: ['/devlog/paid'] })), [], '3: the verdict\'s spelling and the page\'s spelling are one page');
  // the menu walks through a withheld item to its children
  const nav = navMenuOf(['- Members /club', '  - Rules /club/rules'].join('\n'));
  eq(() => paths(buildSiteSpine([{ path: '/club/', meta: { visibility: 'private' } }, { path: '/club/rules/' }], nav)), ['/club/rules/'],
    '3: a withheld menu item drops out; its children keep their place');
  eq(() => buildSiteSpine([{ path: '/', meta: { visibility: 'private' } }, { path: '/a/' }], navMenuOf('A /a')).entries[0].path, '/a/',
    '3: a withheld home page does not open the book');
}

// ── 4. the caller's edges, held by the builder's own functions ───────────────────────────────────
{
  eq(() => sitemapPages().some((p) => p.path === '/devlog/staff'), false, '4: an unlisted post is not in the listed corpus the sitemap uses (listedPosts)');
  eq(() => sitemapPages(POSTS).some((p) => p.path === '/devlog/staff'), true, '4: control — the full corpus does hold it, so the caller must pass the listed one');
  eq(() => contentUrls(CONTENT, META, isSiteFile).includes('/notes/'), false, '4: an unclaimed content file (a draft) is not a page (isSiteFile)');
  eq(() => contentUrls(CONTENT, META).includes('/notes/'), true, '4: control — without isSiteFile it is listed, so the caller must pass it');
}

// ── 5. a tag book ────────────────────────────────────────────────────────────────────────────────
{
  const posts = () => LISTED.map((p) => postEntry(p, META));
  // the tag archive's own selection over the same corpus (pages/tag/[slug]/index.astro:53)
  const archive = LISTED.filter((p) => p.tags.includes('essays')).map((p) => canonicalPath(blog.postUrl(p, META)));
  eq(() => archive, ['/devlog/third/', '/devlog/paid/', '/devlog/first/'], '5: the archive lists the members-only post (as a card)');
  eq(() => paths(buildTagSpine(posts(), 'essays', OPTS)), archive.filter((p) => p !== '/devlog/paid/'),
    '5: the tag book is the archive\'s selection and order, minus the members-only post');
  eq(() => paths(buildTagSpine(posts(), 'essays', {})), ['/devlog/third/', '/devlog/first/'], '5: the post\'s own marker withholds it with no verdict passed');
  eq(() => paths(buildTagSpine(LISTED.map((p) => ({ path: blog.postUrl(p, META), meta: {}, tags: p.tags })), 'essays', { gated: GATED })),
    ['/devlog/third/', '/devlog/first/'], '5: the verdict withholds it with no marker in meta');
  eq(() => paths(buildTagSpine(posts(), 'notes', OPTS)), ['/devlog/other/', '/devlog/third/'], '5: another tag, another book, in corpus order');
  eq(() => paths(buildTagSpine(posts(), 'essays', OPTS)).includes('/devlog/staff/'), false, '5: an unlisted post is not in a tag book built from the listed corpus');
  const off = posts().map((p) => (p.path === '/devlog/first' ? { ...p, meta: { ...p.meta, book: 'false' } } : p));
  const s = () => buildTagSpine(off, 'essays', OPTS);
  eq(() => [paths(s()), s().excluded], [['/devlog/third/'], ['/devlog/first/']], '5: `book: false` unticks a post in a tag book too');
  eq(() => s().entries[0], { path: '/devlog/third/', depth: 0, navLabel: '', title: 'Third' }, '5: an entry has the site spine\'s shape');
  eq(() => [paths(buildTagSpine(posts(), 'Essays')), paths(buildTagSpine(posts(), '')), paths(buildTagSpine(posts(), null)), paths(buildTagSpine(null, 'essays'))],
    [[], [], [], []], '5: the tag matches exactly; no tag or no pages → an empty book');
  eq(() => paths(buildTagSpine([{ path: '/devlog/x', meta: {}, tags: 'essays' }], 'essays')), [], '5: tags that are not a parsed list are no tags');
  // one per locale: the French corpus, its inherited privacy
  const fr = FR.listed.map((p) => ({ path: blog.postUrl(p, FR.meta), meta: { title: p.title }, tags: p.tags }));
  eq(() => paths(buildTagSpine(fr, 'essais', { gated: GATED })), ['/fr/devlog/first/'], '5: a locale\'s tag book withholds its inherited members-only post');
}

console.log(`\npagetile spine (public): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
