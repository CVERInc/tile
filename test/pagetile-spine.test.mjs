#!/usr/bin/env node
// pagetile — the whole-site spine (a site read as a book). Pure Node, no npm, no DOM.
//
// What this pins:
//   1. Unfiltered by default: every page the site has is in the book. The platform does not decide
//      which pages "are content".
//   2. `book: false` in a page's own frontmatter removes exactly that page, and nothing else — not
//      the pages under it in the navigation, not a page that merely links to it.
//   3. Reading order follows the site's navigation (`nav:`), depth-first, the way the menu reads.
//   4. Pages the navigation does not name come after it, in one stable order whatever order the
//      caller listed them in.
//   5. A nav href is matched to a page the way the sitemap spells a page's URL (canonicalPath),
//      so `/about`, `/about/` and `/about/#team` are the same page.
//   6. The home page always opens the book, wherever the menu names it (or whether it does), and
//      for a translated book that is the locale's home (`/fr/`), passed in by the caller.
//
// Run: node test/pagetile-spine.test.mjs
import { buildSiteSpine as buildSpine, bookFlag, spinePath } from '../packages/pagetile/spine-core.js';
import { navMenuOf } from '../packages/sitetile/chrome-links.mjs';
import { canonicalPath, contentUrls } from '../packages/sitetile/astro/src/lib/sitemap.mjs';
import { localeHomePath } from '../packages/sitetile/locale.mjs';

let pass = 0, fail = 0;
// This file pins order and `book: false`, not what is withheld (test/pagetile-spine-public.test.mjs):
// every book here is of a site with no members-only post, which a caller says with `gated: []`.
const buildSiteSpine = (pages, nav, opts = {}) => buildSpine(pages, nav, { gated: [], ...opts });
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; console.error('FAIL:', msg, '\n  got:', JSON.stringify(a), '\n  exp:', JSON.stringify(b)); } };

const page = (path, meta = {}) => ({ path, meta });
const paths = (spine) => spine.entries.map((e) => e.path);

// A small site: a home page, a nested menu, two pages the menu does not name.
const NAV = navMenuOf([
  '- Home /',
  '- About /about',
  '  - Team /about/team',
  '  - History /about/history/',
  '- Work #',
  '  - Shop /shop',
  '- Elsewhere https://example.com/',
].join('\n'));
const PAGES = [
  page('/'), page('/about/'), page('/about/team/'), page('/about/history/'),
  page('/shop/'), page('/press/'), page('/legal/'),
];

// ── 1. unfiltered by default ──────────────────────────────────────────────────────────────────
{
  const s = buildSiteSpine(PAGES, NAV);
  eq(paths(s).slice().sort(), PAGES.map((p) => p.path).sort(), '1: every page of the site is in the book');
  eq(s.excluded, [], '1: nothing is left out unless the owner said so');
  // a page the platform might be tempted to call "not content" is still in
  const s2 = buildSiteSpine([page('/'), page('/form-thanks/', { title: 'Thanks' }), page('/404-like/', { noindex: 'true' })], []);
  eq(paths(s2), ['/', '/404-like/', '/form-thanks/'], '1: a thank-you page and a noindex page are pages too — no judgement');
  eq(paths(buildSiteSpine(PAGES)), ['/', '/about/', '/about/history/', '/about/team/', '/legal/', '/press/', '/shop/'], '1: a site with no nav: still every page');
}

// ── 2. the owner's opt-out removes exactly that page ──────────────────────────────────────────
{
  const all = paths(buildSiteSpine(PAGES, NAV));
  const off = PAGES.map((p) => (p.path === '/about/' ? page(p.path, { book: 'false' }) : p));
  const s = buildSiteSpine(off, NAV);
  eq(paths(s), all.filter((p) => p !== '/about/'), '2: `book: false` removes that page and only that page (its nav children stay)');
  eq(s.excluded, ['/about/'], '2: the unchecked page is reported, so an editor can show it unchecked');
  const offRest = PAGES.map((p) => (p.path === '/press/' ? page(p.path, { book: 'false' }) : p));
  eq(paths(buildSiteSpine(offRest, NAV)), all.filter((p) => p !== '/press/'), '2: a page outside the nav can be unchecked too');
  // the reading grammar is noindex's: only `false` says no; anything else (or nothing) keeps the page in
  eq([false, 'false', ' FALSE ', 'False'].map(bookFlag), [false, false, false, false], '2: `false` in any case/whitespace is the opt-out');
  eq([undefined, null, '', 'true', true, 'yes', 'off', '"false"'].map(bookFlag), [true, true, true, true, true, true, true, true],
    '2: absent, empty or any other value keeps the page in the book');
  eq(paths(buildSiteSpine([page('/', { book: 'true' }), page('/a/', { book: '' })], [])), ['/', '/a/'], '2: `book: true` and an empty value are "in"');
  const s3 = buildSiteSpine(PAGES, NAV.concat(navMenuOf('Again /about')));
  eq(paths(s3).filter((p) => p === '/about/').length, 1, '2: a page the nav names twice is in the book once');
}

// ── 3. order follows the navigation ───────────────────────────────────────────────────────────
{
  const s = buildSiteSpine(PAGES, NAV);
  eq(paths(s).slice(0, 5), ['/', '/about/', '/about/team/', '/about/history/', '/shop/'],
    '3: the menu order, depth-first — a parent, then its children in the order the menu lists them');
  eq(s.entries.slice(0, 5).map((e) => e.depth), [0, 0, 1, 1, 1], '3: depth is the menu depth (a label-only group still nests its children)');
  eq(s.entries.slice(0, 5).map((e) => e.navLabel), ['Home', 'About', 'Team', 'History', 'Shop'], '3: a nav entry keeps the label the menu shows');
  // reorder the menu → the book reorders with it (the home page still opens it: see 6)
  const nav2 = navMenuOf('Shop /shop | About /about | Home /');
  eq(paths(buildSiteSpine(PAGES, nav2)).slice(0, 3), ['/', '/shop/', '/about/'], '3: reordering the menu reorders the book after its home page');
  // nav items that are not pages of this site are not pages of the book
  eq(paths(s).some((p) => /example\.com|#/.test(p)), false, '3: an external link or a label-only item is not a page');
  const navOff = navMenuOf('Blog /blog | About /about');
  eq(paths(buildSiteSpine([page('/about/')], navOff)), ['/about/'], '3: a nav item with no page behind it (a generated route) is skipped');
}

// ── 4. pages not in the navigation come after it, in a stable order ───────────────────────────
{
  const s = buildSiteSpine(PAGES, NAV);
  eq(paths(s).slice(5), ['/legal/', '/press/'], '4: the pages the menu does not name follow it, by path');
  eq(s.entries.slice(5).map((e) => [e.depth, e.navLabel]), [[0, ''], [0, '']], '4: they sit at depth 0 with no nav label');
  const shuffled = [PAGES[6], PAGES[3], PAGES[0], PAGES[5], PAGES[2], PAGES[4], PAGES[1]];
  eq(buildSiteSpine(shuffled, NAV), s, '4: the caller\'s page order does not change the book');
  // the home page is the root of the hierarchy: first, even when the menu does not name it
  eq(paths(buildSiteSpine(PAGES, navMenuOf('Shop /shop | About /about'))).slice(0, 3), ['/', '/shop/', '/about/'],
    '4: an unnamed home page opens the book (the menu hangs under it)');
  eq(paths(buildSiteSpine([page('/b/'), page('/a/')], navMenuOf('B /b'))), ['/b/', '/a/'], '4: no home page: nothing is invented');
}

// ── 5. matching a nav href to a page ──────────────────────────────────────────────────────────
{
  const cases = ['/', '/about', '/about/', '/rss.xml', '/a/b', '/caf%C3%A9'];
  eq(cases.map(spinePath), cases.map((c) => canonicalPath(decodeURI(c))), '5: a nav href is spelled the way the sitemap spells a page (canonicalPath)');
  eq(['/about#team', '/about/?ref=nav', '/about?x#y'].map(spinePath), ['/about/', '/about/', '/about/'], '5: query and fragment do not make another page');
  eq(['#', '', 'https://example.com/about', '//example.com/x', 'mailto:a@b.c', 'about', '/%E0%A4%A'].map(spinePath), ['', '', '', '', '', '', ''],
    '5: no same-site path (or an undecodable one) → not a page');
  eq(paths(buildSiteSpine([page('/café/'), page('/about/')], navMenuOf('About /about#team | Café /caf%C3%A9'))), ['/about/', '/café/'],
    '5: a fragment link and a percent-encoded link both find their page');
  // the page list's own spelling is normalised the same way, so `/about` and `/about/` are one page
  eq(paths(buildSiteSpine([page('/about'), page('/about/')], [])), ['/about/'], '5: one page, two spellings → one entry');
  eq(buildSiteSpine([page('/x/', { title: 'X' })], []).entries[0], { path: '/x/', depth: 0, navLabel: '', title: 'X' }, '5: an entry\'s whole shape');
  eq(buildSiteSpine(null, null), { entries: [], excluded: [] }, '5: no pages, no nav → an empty book, not a throw');
}

// ── 6. the home page always opens the book ────────────────────────────────────────────────────
{
  // the menu names the home page last: it still opens the book, once, with the menu's label
  const s = buildSiteSpine([page('/'), page('/about/')], navMenuOf('About /about | Home /'));
  eq(paths(s), ['/', '/about/'], '6: a home page the menu names last still opens the book');
  eq(s.entries[0], { path: '/', depth: 0, navLabel: 'Home', title: '' }, '6: it keeps the label the menu gives it, at depth 0');
  eq(paths(s).filter((p) => p === '/').length, 1, '6: its later menu place is not a second entry');
  // nested under another item: still first, still at depth 0, and the item it sat under keeps its place
  const nested = buildSiteSpine([page('/'), page('/about/'), page('/shop/')], navMenuOf(['- About /about', '  - Start /', '- Shop /shop'].join('\n')));
  eq(nested.entries.map((e) => [e.path, e.depth, e.navLabel]), [['/', 0, 'Start'], ['/about/', 0, 'About'], ['/shop/', 0, 'Shop']],
    '6: a home page nested in the menu opens the book at depth 0, with its menu label');

  // a translated book: the caller says which page is this book's home; URLs are not rewritten
  const frPages = [page('/fr/'), page('/fr/about/')];
  const frNav = navMenuOf('About /fr/about');
  eq(paths(buildSiteSpine(frPages, frNav, { home: '/fr/' })), ['/fr/', '/fr/about/'], '6: a locale home opens that locale\'s book');
  eq(paths(buildSiteSpine(frPages, navMenuOf('About /fr/about | Accueil /fr/'), { home: '/fr' })), ['/fr/', '/fr/about/'],
    '6: a locale home named last by the menu, passed in either spelling, still opens the book');
  // end to end with sitetile's own derivations: the sitemap's page URLs and the logo's home link
  const site = { locales: 'en, fr' };
  const urls = contentUrls({ '/content/home.md': '', '/content/about.md': '', '/content/fr/home.md': '', '/content/fr/about.md': '' }, site);
  const fr = urls.filter((u) => u.startsWith('/fr/')).map((u) => page(u));
  const home = localeHomePath({ locales: site.locales, pathname: '/fr/about/' });
  eq([fr.map((p) => p.path), home], [['/fr/', '/fr/about/'], '/fr/'], '6: the sitemap spells the French pages, localeHomePath names their home');
  eq(paths(buildSiteSpine(fr, frNav, { home })), ['/fr/', '/fr/about/'], '6: those two derivations together give the French book its opening page');
  eq(paths(buildSiteSpine(urls.filter((u) => !u.startsWith('/fr/')).map((u) => page(u)), navMenuOf('About /about'),
    { home: localeHomePath({ locales: site.locales, pathname: '/about/' }) })), ['/', '/about/'], '6: the default locale\'s home is `/`');

  // the owner unchecked the home page: it is left out like any page, and nothing else is forced first
  const off = buildSiteSpine([page('/', { book: 'false' }), page('/about/'), page('/shop/')], navMenuOf('Shop /shop | About /about | Home /'));
  eq(paths(off), ['/shop/', '/about/'], '6: an unchecked home page leaves the book; the menu order opens it instead');
  eq(off.excluded, ['/'], '6: the unchecked home page is reported once');
}

console.log(`\npagetile spine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
