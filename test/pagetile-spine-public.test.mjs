#!/usr/bin/env node
// pagetile — what a book of a site may hold: never a page an anonymous visitor cannot read.
//
// The whole-site spine filters nothing by content (test/pagetile-spine.test.mjs). This file pins the
// one edge it has, against the page lists sitetile's REAL builder functions produce, not a copy:
//   1. A members-only post never enters a book, though the sitemap lists it: the membership verdict's
//      paths (the builder's one reading of privacy) withhold it and the translation that inherits it,
//      and a book built without them refuses.
//   2. A page a redirect rule answers never enters a book (literal, either slash spelling, `*`,
//      `:name`); a query rule shadows nothing.
//   3. A withheld page is not offered as "unticked" either, and no spelling of it gets through.
//   4. The edges the caller owns hold with the builder's own functions: an unlisted post is not in
//      the listed corpus, an unclaimed content file (a draft) is not a page.
//   5. A tag book (buildTagSpine) is the tag archive's own selection and order, minus what is
//      withheld, with the owner's `book: false`; one per locale.
//   6. Every spelling of a page is one page, on both sides, through one normaliser (slash runs, dot
//      segments, /index.html, %2F, every escape); case is kept; privacy is never read from a page's
//      meta; `gated` is a required array of strings.
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
// a call that must refuse: a TypeError, not some other failure
const throws = (fn) => { try { fn(); return 'no throw'; } catch (e) { return e instanceof TypeError ? 'TypeError' : 'THREW ' + e.message; } };

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
  // no verdict passed is not "nothing to withhold": the book refuses to be built
  eq(() => throws(() => buildSiteSpine(defaultPages(), NAV)), 'TypeError', '1: a book built with no verdict passed throws');
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
  const one = (rules, p) => paths(buildSiteSpine([{ path: p }], [], { gated: [], redirected: rules })).length;
  eq(() => paths(buildSiteSpine(defaultPages(), NAV, { gated: GATED })).filter((p) => p === '/old-shop/' || p.startsWith('/archive/')),
    ['/old-shop/', '/archive/2019/'], '2: without the redirect rules the shadowed pages are in (the control)');
  eq(() => ['/old-shop', '/old-shop/'].map((r) => one([r], '/old-shop/')), [0, 0], '2: a literal `from`, in either slash spelling, withholds its page');
  eq(() => [one(['/archive/*'], '/archive/2019/'), one(['/archive/*'], '/archive/2019/may/'), one(['/archive/*'], '/archive/'), one(['/archive/*'], '/archived/')], [0, 0, 0, 1],
    '2: a splat withholds every page under it, at any depth, and only those');
  eq(() => [one(['/blog/:slug'], '/blog/hello/'), one(['/blog/:slug'], '/blog/a/b/'), one(['/caf%C3%A9'], '/café/')], [0, 1, 0],
    '2: `:name` is one segment; a percent-encoded `from` names its page');
  eq(() => [one(['/old-shop?id=1'], '/old-shop/'), one(['https://example.com/old-shop'], '/old-shop/'), one([''], '/'), one(['/x'], '/')], [1, 1, 1, 1],
    '2: a query rule, an off-site `from` or an unrelated rule withholds nothing');
}

// ── 3. withheld is not "unticked", and no spelling gets through ──────────────────────────────────
{
  const s = buildSiteSpine([{ path: '/' }, { path: '/paid/', meta: { book: 'false' } }, { path: '/legal/', meta: { book: 'false' } }], [], { ...OPTS, gated: ['/paid'] });
  eq(() => [paths(s), s.excluded], [['/'], ['/legal/']], '3: a withheld page is not offered as unticked; an unticked public page is');
  eq(() => paths(buildSiteSpine([{ path: '/devlog/paid/', meta: {} }, { path: '/devlog/paid', meta: {} }], [], { gated: ['/devlog/paid/index.html'] })), [],
    '3: a page listed twice, gated in a third spelling, is withheld in both');
  eq(() => paths(buildSiteSpine([{ path: '/devlog/paid/' }], [], { gated: ['/devlog/paid'] })), [], '3: the verdict\'s spelling and the page\'s spelling are one page');
  // the menu walks through a withheld item to its children
  const nav = navMenuOf(['- Members /club', '  - Rules /club/rules'].join('\n'));
  eq(() => paths(buildSiteSpine([{ path: '/club/' }, { path: '/club/rules/' }], nav, { gated: ['/club'] })), ['/club/rules/'],
    '3: a withheld menu item drops out; its children keep their place');
  eq(() => buildSiteSpine([{ path: '/' }, { path: '/a/' }], navMenuOf('A /a'), { gated: ['/'] }).entries[0].path, '/a/',
    '3: a withheld home page does not open the book');
}

// ── 4. the caller's edges, held by the builder's own functions ───────────────────────────────────
{
  eq(() => sitemapPages().some((p) => p.path === '/devlog/staff'), false, '4: an unlisted post is not in the listed corpus the sitemap uses (listedPosts)');
  eq(() => sitemapPages(POSTS).some((p) => p.path === '/devlog/staff'), true, '4: control — the full corpus does hold it, so the caller must pass the listed one');
  eq(() => contentUrls(CONTENT, META, isSiteFile).includes('/notes/'), false, '4: an unclaimed content file (a draft) is not a page (isSiteFile)');
  eq(() => contentUrls(CONTENT, META).includes('/notes/'), true, '4: control — without isSiteFile it is listed, so the caller must pass it');
  // The spine cannot tell an unlisted post from a listed one (its header: the caller owns this edge),
  // so this is the caller contract, pinned rather than guarded: hand it every post and the unlisted
  // one is in both books.
  const allPages = sitemapPages(POSTS).filter((p) => !p.path.startsWith('/fr/'));
  eq(() => [paths(buildSiteSpine(defaultPages(), NAV, OPTS)).includes('/devlog/staff/'), paths(buildSiteSpine(allPages, NAV, OPTS)).includes('/devlog/staff/')], [false, true],
    '4: caller contract — a site book built from every post (not listedPosts) holds the unlisted post');
  eq(() => [LISTED, POSTS].map((c) => paths(buildTagSpine(c.map((p) => postEntry(p, META)), 'essays', OPTS)).includes('/devlog/staff/')), [false, true],
    '4: caller contract — a tag book built from every post (not listedPosts) holds the unlisted post');
}

// ── 5. a tag book ────────────────────────────────────────────────────────────────────────────────
{
  const posts = () => LISTED.map((p) => postEntry(p, META));
  // the tag archive's own selection over the same corpus (pages/tag/[slug]/index.astro:53)
  const archive = LISTED.filter((p) => p.tags.includes('essays')).map((p) => canonicalPath(blog.postUrl(p, META)));
  eq(() => archive, ['/devlog/third/', '/devlog/paid/', '/devlog/first/'], '5: the archive lists the members-only post (as a card)');
  eq(() => paths(buildTagSpine(posts(), 'essays', OPTS)), archive.filter((p) => p !== '/devlog/paid/'),
    '5: the tag book is the archive\'s selection and order, minus the members-only post');
  eq(() => throws(() => buildTagSpine(posts(), 'essays', {})), 'TypeError', '5: a tag book built with no verdict passed throws');
  eq(() => paths(buildTagSpine(LISTED.map((p) => ({ path: blog.postUrl(p, META), meta: {}, tags: p.tags })), 'essays', { gated: GATED })),
    ['/devlog/third/', '/devlog/first/'], '5: the verdict withholds it with no marker in meta');
  eq(() => paths(buildTagSpine(posts(), 'notes', OPTS)), ['/devlog/other/', '/devlog/third/'], '5: another tag, another book, in corpus order');
  eq(() => paths(buildTagSpine(posts(), 'essays', OPTS)).includes('/devlog/staff/'), false, '5: an unlisted post is not in a tag book built from the listed corpus');
  const off = posts().map((p) => (p.path === '/devlog/first' ? { ...p, meta: { ...p.meta, book: 'false' } } : p));
  const s = () => buildTagSpine(off, 'essays', OPTS);
  eq(() => [paths(s()), s().excluded], [['/devlog/third/'], ['/devlog/first/']], '5: `book: false` unticks a post in a tag book too');
  eq(() => s().entries[0], { path: '/devlog/third/', depth: 0, navLabel: '', title: 'Third' }, '5: an entry has the site spine\'s shape');
  const none = { gated: [] };
  eq(() => [paths(buildTagSpine(posts(), 'Essays', none)), paths(buildTagSpine(posts(), '', none)), paths(buildTagSpine(posts(), null, none)), paths(buildTagSpine(null, 'essays', none))],
    [[], [], [], []], '5: the tag matches exactly; no tag or no pages → an empty book');
  eq(() => paths(buildTagSpine([{ path: '/devlog/x', meta: {}, tags: 'essays' }], 'essays', none)), [], '5: tags that are not a parsed list are no tags');
  // one per locale: the French corpus, its inherited privacy
  const fr = FR.listed.map((p) => ({ path: blog.postUrl(p, FR.meta), meta: { title: p.title }, tags: p.tags }));
  eq(() => paths(buildTagSpine(fr, 'essais', { gated: GATED })), ['/fr/devlog/first/'], '5: a locale\'s tag book withholds its inherited members-only post');
}

// ── 6. every spelling, through one normaliser; the builder's own privacy; `gated` required ───────
// (PR 389 review: each input the reviewer's probe found reaching a book is a named case here.)
{
  const one = (path, gated, extra = {}) => paths(buildSiteSpine([{ path, meta: {} }], [], { gated, ...extra }));
  const tagOne = (path, gated) => paths(buildTagSpine([{ path, meta: {}, tags: ['essays'] }], 'essays', { gated }));

  // P1: a run of slashes. The permalink the author wrote keeps `//` in the sitemap's spelling
  // (canonicalPath), while the verdict's path has none (toPath strips every trailing slash).
  {
    const raw = { '/s/blog/paid.md': '---\ntitle: Paid\ndate: 2026-02-01\nvisibility: private\npermalink: /devlog/paid//\ntags: [essays]\n---\nPAID\n' };
    const posts = blog.allPosts(raw);
    const gated = blog.gatedPostPaths(posts, META);
    const pages = posts.map((p) => ({ path: canonicalPath(blog.postUrl(p, META)), meta: { title: p.title }, tags: p.tags }));
    eq(() => [gated, pages.map((p) => p.path)], [['/devlog/paid'], ['/devlog/paid//']], '6 P1: fixture — the verdict says /devlog/paid, the sitemap says /devlog/paid//');
    eq(() => paths(buildSiteSpine(pages, [], { gated })), [], '6 P1: a members-only post with permalink /devlog/paid// is not in the site book');
    eq(() => paths(buildTagSpine(pages, 'essays', { gated })), [], '6 P1: a members-only post with permalink /devlog/paid// is not in its tag book');
    eq(() => ['/devlog//paid/', '/devlog/paid//', '/devlog///paid'].map(spine.spinePath), ['/devlog/paid/', '/devlog/paid/', '/devlog/paid/'],
      '6 P1: spinePath collapses runs of slashes');
  }

  // P2-1: the spellings the worker and the static server answer as one page.
  const G = ['/devlog/paid'];
  for (const [name, p] of [
    ['explicit /index.html', '/devlog/paid/index.html'],
    ['encoded separator %2F', '/devlog/paid%2F'],
    ['lower-case %2f inside the path', '/devlog%2fpaid/'],
    ['a dot segment', '/devlog/./paid/'],
    ['a dot-dot segment', '/devlog/x/../paid/'],
    ['an escaped dot-dot segment', '/devlog/x/%2e%2e/paid/'],
    ['a trailing dot', '/devlog/paid/.'],
    ['a run of slashes mid-path', '/devlog//paid/'],
    ['a backslash, read as / by the URL parser', '/devlog\\paid/'],
    ['an escaped unreserved letter', '/devlog/%70aid/'],
  ]) {
    eq(() => one(p, G), [], `6 P2-1: ${name} (${p}) is the gated page and is withheld`);
    eq(() => tagOne(p, G), [], `6 P2-1: ${name} (${p}) is withheld from a tag book`);
  }
  eq(() => [one('/devlog/paid/', ['/devlog/paid/index.html']), one('/devlog/paid/', ['/devlog//paid//']), one('/devlog/paid/', ['/devlog/x/../paid'])], [[], [], []],
    '6 P2-1: the verdict\'s side goes through the same normaliser');
  // controls: the gate is one exact page, as the worker's is
  // (the double-escaped page keeps its own spelling: `/devlog%2Fpaid/` would be the gated page's address)
  eq(() => [one('/devlog/paidx/', G), one('/devlog/paid/more/', G), one('/devlog%252Fpaid/', G)], [['/devlog/paidx/'], ['/devlog/paid/more/'], ['/devlog%252Fpaid/']],
    '6 P2-1: a neighbour, a child and a double-escaped separator are other pages (controls)');
  // case: the worker compares exactly and the renderer writes one case-sensitive directory per route,
  // so a case-different path is another page — kept, not folded.
  eq(() => one('/Devlog/Paid/', G), ['/Devlog/Paid/'], '6 P2-1: case is kept — /Devlog/Paid/ is another page than gated /devlog/paid');

  // P2-2: escaped reserved characters decode fully, on both sides.
  eq(() => one('/devlog/c%2B%2B/', ['/devlog/c++']), [], '6 P2-2: /devlog/c%2B%2B/ is gated /devlog/c++');
  eq(() => one('/devlog/q%26a/', ['/devlog/q&a']), [], '6 P2-2: /devlog/q%26a/ is gated /devlog/q&a');
  eq(() => [one('/devlog/c++/', ['/devlog/c%2B%2B']), one('/devlog/q&a/', ['/devlog/q%26a'])], [[], []], '6 P2-2: an escaped verdict path gates the plain spelling');
  eq(() => [one(new URL('http://x/devlog/中文/').pathname, ['/devlog/中文']), one('/devlog/a%20b/', ['/devlog/a b'])], [[], []],
    '6 P2-2: non-ASCII and spaces, escaped the way the URL parser escapes them');
  // a verdict path is text: a `%` in a slug is a percent sign, and its escaped page is that page
  eq(() => one('/devlog/100%25/', ['/devlog/100%']), [], '6 P2-2: a literal % in a verdict path gates its escaped spelling (%25)');
  eq(() => [one('/devlog/100%/', []), one('/devlog/%E0%A4%A/', [])], [[], []], '6 P2-2: a page path whose escape does not decode is withheld (fail closed)');

  // P2-3: privacy is read once, by the builder (isPrivatePost over allPosts' parse), and reaches the
  // spine as the verdict's paths. The meta a caller has for a post (splitFrontmatter) is not read.
  for (const [name, raw] of [
    ['a double-quoted value', '---\ntitle: Q\nvisibility: "private"\n---\nX\n'],
    ['a single-quoted value', "---\ntitle: Q\nvisibility: 'private'\n---\nX\n"],
    ['a duplicate key, the later one public', '---\ntitle: D\nvisibility: private\nvisibility: public\n---\nX\n'],
    ['a quoted key', '---\ntitle: K\n"visibility": private\n---\nX\n'],
    ['CRLF line ends', '---\r\ntitle: C\r\nvisibility: private\r\n---\r\nX\r\n'],
  ]) {
    const posts = blog.allPosts({ '/s/blog/m.md': raw });
    const pages = posts.map((p) => ({ path: canonicalPath(blog.postUrl(p, META)), meta: splitFrontmatter(raw).meta }));
    eq(() => [blog.isPrivatePost(posts[0]), paths(buildSiteSpine(pages, [], { gated: blog.gatedPostPaths(posts, META) })), throws(() => buildSiteSpine(pages, []))],
      [true, [], 'TypeError'], `6 P2-3: ${name}: the builder's verdict withholds it; with no verdict the book refuses`);
  }
  {
    const frRaw = FR_POSTS['/s/blog/fr/paid.md'];
    const pages = FR.posts.filter((p) => p.slug === 'paid').map((p) => ({ path: canonicalPath(blog.postUrl(p, FR.meta)), meta: splitFrontmatter(frRaw).meta }));
    eq(() => [pages.map((p) => p.path), paths(buildSiteSpine(pages, [], { home: '/fr/', gated: GATED })), throws(() => buildSiteSpine(pages, [], { home: '/fr/' }))],
      [['/fr/devlog/paid/'], [], 'TypeError'], '6 P2-3: a French translation of a private post, with its own frontmatter as meta: withheld by the verdict; with none the book refuses');
  }
  // the second reading is gone: a page's meta saying `visibility: private` gates nothing on the site
  // (only posts are gated, by isPrivatePost), so it withholds nothing here either.
  eq(() => paths(buildSiteSpine([{ path: '/about/', meta: splitFrontmatter('---\ntitle: A\nvisibility: private\n---\n').meta }], [], { gated: [] })), ['/about/'],
    '6 P2-3: a page\'s own meta `visibility:` is not read (the builder\'s verdict is the one reader)');

  // P2-4: `gated` is a required array of path strings.
  const pg = [{ path: '/devlog/paid/', meta: {}, tags: ['essays'] }];
  for (const [name, g] of [
    ['undefined', undefined], ['null', null], ['a bare string', '/devlog/paid'], ['a Set', new Set(['/devlog/paid'])],
    ['the verdict object', { schemaVersion: 1, paths: ['/devlog/paid'] }], ['an array with a non-string', ['/devlog/paid', 1]],
    ['an array with an empty path', ['']], ['an array with an off-site URL', ['https://example.com/devlog/paid']],
  ]) {
    eq(() => [throws(() => buildSiteSpine(pg, [], { gated: g })), throws(() => buildTagSpine(pg, 'essays', { gated: g }))], ['TypeError', 'TypeError'],
      `6 P2-4: gated = ${name} throws, in both books`);
  }
  eq(() => throws(() => buildSiteSpine(pg, [])), 'TypeError', '6 P2-4: no options at all throws');
  eq(() => [paths(buildSiteSpine(pg, [], { gated: [] })), paths(buildTagSpine(pg, 'essays', { gated: [] }))], [['/devlog/paid/'], ['/devlog/paid/']],
    '6 P2-4: gated = [] is the explicit "no members-only post"');
  eq(() => [throws(() => buildSiteSpine(pg, [], { gated: [], redirected: '/devlog/paid' })), throws(() => buildSiteSpine(pg, [], { gated: [], redirected: null }))],
    ['TypeError', 'TypeError'], '6 P2-4: redirected, when passed, is an array of strings too');

  // P2-5: redirect rules go through the same normaliser.
  const r = (rules, p) => one(p, [], { redirected: rules });
  eq(() => r(['/a/index.html'], '/a/'), [], '6 P2-5: a /a/index.html rule shadows /a/');
  eq(() => r(['/a'], '/a/index.html'), [], '6 P2-5: a /a rule shadows the page spelled /a/index.html');
  eq(() => [r(['/old//'], '/old/'), r(['/x/../old'], '/old/'), r(['/q%26a'], '/q&a/')], [[], [], []], '6 P2-5: slash runs, dot segments and escapes in a `from`');
  eq(() => r(['/Old'], '/old/'), ['/old/'], '6 P2-5: case is kept in a `from` too');
}

// ── 7. an entry is spelled the way the sitemap spells its page; the normaliser only matches ──────
// (PR 389 review r3: an entry built from the decoded key turned `/q%3Fa/` into `/q?a/`, which a
// browser asks for as `/q`. The entry carries the page's own canonicalPath; pageKey decides which
// page a path, an href, a verdict path or a redirect names, and nothing else.)
{
  const SPELLED = [
    ['an escaped ?', '/q%3Fa/'],
    ['an escaped #', '/h%23a/'],
    ['an escaped /', '/sl%2Fa/'],
    ['a CJK path as the sitemap writes it from a file name (contentUrls)', '/文章/'],
    ['a CJK path as the URL parser escapes it', new URL('http://x/文章/').pathname],
    ['an escaped +', '/devlog/c%2B%2B/'],
    ['a double-escaped separator', '/devlog%252Fpaid/'],
  ];
  const site = (path, nav = []) => buildSiteSpine([{ path, meta: {} }], nav, { gated: [] }).entries;
  const tag = (path) => paths(buildTagSpine([{ path, meta: {}, tags: ['essays'] }], 'essays', { gated: [] }));
  const asked = (p) => new URL(p, 'http://x').pathname; // what a browser requests for an href
  const one = (path, gated) => paths(buildSiteSpine([{ path, meta: {} }], [], { gated }));
  for (const [name, p] of SPELLED) {
    eq(() => site(p).map((e) => e.path), [p], `7: ${name} (${p}) keeps its sitemap spelling in the site book`);
    eq(() => tag(p), [p], `7: ${name} (${p}) keeps its sitemap spelling in a tag book`);
    eq(() => site(p).map((e) => asked(e.path)), [asked(p)], `7: ${name}: a browser following the entry asks for the page itself`);
  }
  eq(() => site('/q%3Fa'), [{ path: '/q%3Fa/', depth: 0, navLabel: '', title: '' }], '7: a page passed without its slash gets the sitemap\'s directory form (canonicalPath)');
  eq(() => [canonicalPath('/q%3Fa'), canonicalPath('/文章')], ['/q%3Fa/', '/文章/'], '7: control — canonicalPath itself decodes nothing');
  // a menu item in another spelling still names the page, and the entry is the page's spelling
  eq(() => site('/q%3Fa/', navMenuOf('Q /q%3fa')), [{ path: '/q%3Fa/', depth: 0, navLabel: 'Q', title: '' }], '7: a menu href in another escape case names the page; the entry keeps the page\'s spelling');
  eq(() => site('/文章/', navMenuOf('Posts /%E6%96%87%E7%AB%A0')), [{ path: '/文章/', depth: 0, navLabel: 'Posts', title: '' }], '7: an escaped CJK menu href names the raw-spelled page');
  eq(() => buildSiteSpine([{ path: '/%E6%96%87/', meta: {} }], [], { home: '/文/', gated: [] }).entries.map((e) => e.path), ['/%E6%96%87/'], '7: a home passed in another spelling opens the book with the page\'s spelling');
  // matching is unchanged: each spelling is still withheld by a verdict path naming its page
  eq(() => [one('/q%3Fa/', ['/q%3Fa']), one('/h%23a/', ['/h%23a']), one('/sl%2Fa/', ['/sl/a']), one(new URL('http://x/文章/').pathname, ['/文章'])], [[], [], [], []],
    '7: the same pages are still withheld when the verdict names them');
  // spinePath (the exported href → spelling helper) keeps reserved escapes too
  eq(() => ['/q%3Fa', '/h%23a', '/sl%2Fa', '/devlog%252Fpaid', '/caf%C3%A9', '/devlog//paid/index.html'].map(spine.spinePath),
    ['/q%3Fa/', '/h%23a/', '/sl%2Fa/', '/devlog%252Fpaid/', '/café/', '/devlog/paid/'], '7: spinePath keeps escaped reserved characters and %25 (decodeURI\'s reading), and still resolves the path\'s shape');
}

console.log(`\npagetile spine (public): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
