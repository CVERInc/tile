// The site's locale EDITIONS, read off the home pages authored in content/ — the one discovery the
// engine's per-locale system pages share (the /language chooser, the per-locale 404).
//
// Lifted verbatim out of pages/[...loc]/language.astro's getStaticPaths (CVERInc/reef#2112) so the
// 404 route does not grow a second copy of the same loop that could answer "which locales does this
// site have" differently from the chooser. The rule to keep: a locale gets its own 404 exactly when
// the chooser offers it a row — a visitor who mistypes /ja-jp/… is told so in Japanese iff there is
// a Japanese edition to go back to.
//
// Returns null when the site has no Lingo (one language, or `packages: lingo` over one declared
// locale) — the chooser builds nothing, and so does the per-locale 404. Otherwise:
//   { rootHome, locales, defaultLocale, homesByRel, layersByRel }
// where homesByRel maps a home's REL ("home" for the default, the url-locale for the others) to its
// meta with the site-config layer (_site + <locale>/_site) resolved UNDER it, and layersByRel holds
// the chrome of a declared edition that has a `content/<loc>/_site.md` but no home (see below).
//
// Warnings: pageLocalesOrWarn is once-per-file by its own contract, so two callers log each offending
// page once. The root-home/locales[0] mismatch sentence is NOT emitted here — the chooser route owns
// that line of the build log (one caller, one line).
import { parseSite, isSiteFile } from '@sitetile';
import { loadSite } from './blog.mjs';
import { toUrlLocale, sameLocale, lingoEnabled, parseLocales, defaultLocaleOf, tagLocalesSource, localesSourceOf, pageLocalesOrWarn } from '../packages/lingo/locale.mjs';

export function localeEditions(files) {
  // A home file's basename is "home" (root: content/home.md; locale: content/<loc>/home.md).
  // The build maps each locale HOME to a single-segment path: the default → content/home.md,
  // every other locale → content/<loc>.md (mkpages' `<loc>/home.md → <loc>` collapse). So a
  // file is a locale-home iff its rel is "home" (default) or equals a declared locale's url form.
  // Keyed by the home's REL (home / zh-tw), not by its `lang:` — a locale home that writes
  // `lang: zh-Hant` lives at content/zh-tw.md and must still be found; matching on the raw `lang:`
  // silently fell back to the root home's chrome.
  const homesByRel = {};         // rel ("home" | url-locale) → meta
  for (const [path, raw] of Object.entries(files)) {
    if (!isSiteFile(raw)) continue;
    const rel = path.split('/content/')[1].replace(/\.md$/, '');
    if (rel.includes('/')) continue;   // only single-segment rels can be a home
    const site = parseSite(raw);
    // resolve site-config layer (_site + <locale>/_site) UNDER the home's own frontmatter, so a
    // slimmed home (chrome moved to _site) still exposes packages/lang/locales here.
    const cfg = loadSite(files, rel);
    // Same rule as the page route: a home page's own `locales` is a page's line under a site config.
    if (cfg || rel !== 'home') pageLocalesOrWarn(site.meta, `content/${rel}.md`, cfg);
    else tagLocalesSource(site.meta, `content/${rel}.md`);
    if (cfg) site.meta = { ...cfg, ...site.meta };
    homesByRel[rel] = site.meta;
  }
  const rootHome = homesByRel.home;
  if (!rootHome) return null;
  // Parse WITH the file it was written in BEFORE the lingoEnabled gate: lingoEnabled parses the same
  // list without a source, so an illegal entry thrown from there says "fix it where it is written"
  // instead of naming content/_site.md. 🩸 The chooser route had these the other way round and was
  // never caught, because another route happened to throw the named message first; the 404 route
  // sorts ahead of every one of them (not-found-locale.test.mjs's `unsafe` fixture).
  const locales = parseLocales(rootHome.locales, localesSourceOf(rootHome));
  // Same gate as SiteLayout — lingo/locale.mjs → lingoEnabled(): a second declared locale, or
  // `packages: lingo`. One-language sites get no chooser.
  if (!lingoEnabled(rootHome)) return null;

  // A chooser is a choice between editions. `packages: lingo` over ONE declared locale used to
  // build a page with a single row on it, and a footer link on every page leading there.
  if (locales.length < 2) return null;
  // 🩸 2026-10-11: this was the root home's raw `lang:`, compared with `L === defaultLocale` — an
  // unwritten rule that `lang:` be spelled exactly like `locales[0]`. `locales: en-US` + `lang: en`
  // (both correct) matched nothing: the DEFAULT locale's chooser went to /en-us/language and
  // /language 404'd. The default is the site's one definition (lingo/locale.mjs → defaultLocaleOf),
  // so the chooser and the layout's hreflang / footer link can never disagree about which locale
  // lives at `/`.
  const defaultLocale = defaultLocaleOf(locales, rootHome.lang);

  // 🩸 tile#157 review: a declared edition WITHOUT a home (content/ja-jp/about.md, no ja-jp/home.md)
  // is still an edition here — the chooser gives it a row, so it gets a 404 — but it fell straight
  // back to the root home, and its own content/ja-jp/_site.md never reached its 404 or its chooser:
  // a Japanese error page in the English footer. Its ordinary pages already wear that layer
  // ([...path].astro → loadSite(files, rel)); the system pages now do too: the locale's site config
  // (_site + <loc>/_site, through the same loadSite), over the root home for whatever neither says.
  // No `<loc>/_site.md` ⇒ nothing locale-specific to load ⇒ the root home exactly as before.
  const layersByRel = {};
  for (const L of locales) {
    const rel = toUrlLocale(L);
    if (sameLocale(L, defaultLocale) || homesByRel[rel]) continue;
    if (!Object.keys(files).some((path) => path.split('/content/')[1] === `${rel}/_site.md`)) continue;
    layersByRel[rel] = { ...rootHome, ...loadSite(files, rel) };
  }
  return { rootHome, locales, defaultLocale, homesByRel, layersByRel };
}

/**
 * The chrome (meta) a locale's system page wears: that locale's home, else its own site layer over
 * the root home, else the root home.
 */
export function editionMeta(editions, locale) {
  const { rootHome, defaultLocale, homesByRel, layersByRel = {} } = editions;
  if (locale === defaultLocale) return rootHome;
  const rel = toUrlLocale(locale);
  return homesByRel[rel] || layersByRel[rel] || rootHome;
}
