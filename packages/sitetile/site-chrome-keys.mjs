// site-chrome-keys.mjs — the settings a site config holds for the WHOLE site, and the one rule a
// page's own frontmatter follows about them: what the site config sets, a page cannot change.
//
// 🔴 PURE AND IMPORT-FREE, like chrome-links.mjs: the renderer's page routes import it, and
// anything outside this repo that checks a page before it is saved can run this same code instead
// of keeping a second list.
//
// 🩸 WHY. A content page is rendered from `{ ...siteConfig, ...pageFrontmatter }` — page keys win.
// That is the design for what a page says about ITSELF (its title, description, share image,
// `noindex`, layout, look). It was also true of everything else, so one page's frontmatter could
// replace the site's header button with a link of its own, load a different stylesheet through
// `fonts:`, point the site's analytics somewhere else or rewrite the footer — on that page only,
// under the site's name, with nothing in the build log. Whoever may edit a page is not always
// whoever may change the site's settings, and the renderer is the last place that can tell the
// two apart.
//
// THE RULE. When the site config layer (`content/_site.md`, with the `_site.md` of the page's
// folder over it) sets one of the keys below to a non-blank value, that value is the page's value:
// the page's own line is ignored and named in the build log, against the file that sets it (the
// page route warns, once per page and key). Nothing fails — a stray line in a page must not take a
// site's build down.
//
// LOCALE FOLDERS. A page in a Lingo locale folder (`content/ko-kr/…`, and the locale home
// `content/ko-kr.md`) whose folder has NO `_site.md` of its own is a translated page whose
// translated chrome lives on the page: its site config is `content/_site.md`, in the site's
// default language, and putting that back would replace a Korean nav with the English one. Such a
// page keeps every key below except LOCALE_NEUTRAL_CHROME_KEYS — the ones a language cannot mean
// anything for. Once the folder has a `_site.md`, the locale has a site config and the full list
// applies, as for any other page. (siteChromeScope says which case a page is in.)
//
// WHAT THE RULE DOES NOT DO, deliberately:
//   · A key the site config leaves unset still comes from the page. A site with no `_site.md`
//     keeps its chrome on its pages, and so does a site that has moved only part of it (a locale
//     home carrying its own `nav:` is common). Closing that would blank those sites' headers.
//   · A page line that says the same thing as the site config is not reported: nothing changed.
//
// WHICH KEYS. A key is here when a page's own value for it is harmful or meaningless: (a) words
// or links in the header and footer every page shares, where a visitor reads them as the site's
// own and one page could put its own link there under the site's name; (b) a statement of where
// the site's stylesheet, visitors' data, messages or identity go, which one page must not
// redirect; (c) the blog's settings, which a page has no meaning for.
//
// WHICH KEYS ARE NOT, and why:
//   · A page's own content and metadata: title, description, image, share-image, share-title,
//     og-image, og-type, article-*, noindex, lang, breadcrumb-*.
//   · Look, chosen from a fixed vocabulary with no address in it: theme, layout, header,
//     header-width, header-sticky, nav-mobile, button, band, card, cell-cta, corner, color-scheme,
//     theme-color-light, theme-color-dark, inbox-bubble-color, og-cards. A landing page that
//     looks different is what "page keys win" is for.
//   · sidebar-*: the sidebar layout is opted into per page, and so is what it lists.
//   · inbox-bubble (and its -except, -search): a page turning the bubble on or off for itself is
//     the documented behaviour (site-core.js SITE_LAYER_KEYS).
//   · packages: a page that names more packages than the site config is a pattern partly-moved
//     sites have; it switches built-in features on that page and carries no address.
//   · locales, locales-banner-*, site-title, dynamic-coral-css: each already has its own
//     site-layer-only resolution in the routes.
//   · announce (and announce-*), age-gate (and age-gate-*): a page setting its own announcement,
//     or turning the bar or the age gate off for itself, is the documented per-page behaviour.

/** Site-chrome keys, by exact name. */
export const SITE_CHROME_KEYS = Object.freeze([
  // who the site is, in the header and the browser tab
  'brand', 'site-logo', 'favicon',
  // the header's links
  'nav', 'header-cta',
  // the footer's last line and its language link
  'copyright', 'copyright-href', 'language-href',
  // where the site's stylesheet, visitor analytics and messages go; what it says built it
  'fonts', 'analytics-token', 'site-key', 'generator',
  // the site's assistant: its name, and what it answers from
  'assistant-name', 'kaito-corpus',
]);

/** Site-chrome key families: the bare name and every `<name>-…` key. */
export const SITE_CHROME_FAMILIES = Object.freeze([
  'header-actions',   // the header's buttons, and the cart they open (whose cart, where it leads)
  'footer',           // footer, footer-cols, footer-social, footer-brand, footer-logo, footer-tagline
  'blog',             // the blog is the site's: its path, labels, routes and search (a page has none)
]);

/**
 * The keys still reserved on a page in a locale folder that has no `_site.md` of its own: none of
 * them is words a visitor reads, so a translation has nothing to change in them. The browser-tab
 * icon, the stylesheet the site loads, where visitor analytics go, the site key messages are sent
 * under, what the site says built it, and the corpus its assistant answers from.
 * Everything else on the list is words or links (brand, nav, header button, footer, copyright,
 * the assistant's name, the blog's labels) that a translated page translates.
 */
export const LOCALE_NEUTRAL_CHROME_KEYS = Object.freeze([
  'favicon', 'fonts', 'analytics-token', 'site-key', 'generator', 'kaito-corpus',
]);

/** Is `key` one a page cannot change once the site config sets it? */
export function isSiteChromeKey(key) {
  const k = String(key);
  return SITE_CHROME_KEYS.includes(k) || SITE_CHROME_FAMILIES.some((f) => k === f || k.startsWith(f + '-'));
}

const said = (v) => (v == null ? '' : String(v).trim());

/** The base site config file, as the build log names it. */
export const SITE_CONFIG_FILE = 'content/_site.md';

/**
 * Where a page sits, as resolveSiteChrome needs it. Pure: the caller reads the files.
 *   rel           — the page's routed rel: "about", "ko-kr/about", or "ko-kr" for a locale home.
 *   localeFolders — the URL forms of the Lingo locale editions ("en-us", "ko-kr", …); passed in so
 *                   this file stays import-free (the routes pass locale-tags.mjs's table).
 *   layer         — the frontmatter of `content/<first segment>/_site.md` when that file exists and
 *                   sets anything (the test loadSite applies before it layers it), else null.
 * → { localeFolder: string|null, layerFile: string|null, layerKeys: string[] }
 */
export function siteChromeScope(rel, localeFolders, layer) {
  const seg = String(rel == null ? '' : rel).split('/')[0];
  const folders = (localeFolders || []).map((f) => String(f).toLowerCase());
  const localeFolder = seg && folders.includes(seg.toLowerCase()) ? seg : null;
  const has = !!(seg && layer && typeof layer === 'object' && Object.keys(layer).length);
  return { localeFolder, layerFile: has ? `content/${seg}/_site.md` : null, layerKeys: has ? Object.keys(layer) : [] };
}

/**
 * The page route's half. `own` = the page's own frontmatter, `siteConfig` = the site config layer
 * for this page (null when the site has none), `merged` = own over it, `scope` = siteChromeScope's
 * answer for the page (omitted: a page outside any folder with a site config of its own). Puts
 * every site-chrome key the site config sets back to the site config's value, in `merged` itself,
 * and returns it with the keys whose page line was ignored and, per key, the file that sets it:
 * `{ meta, ignored: string[], from: { [key]: file } }`.
 * No site config ⇒ nothing is reserved ⇒ `merged` untouched.
 */
export function resolveSiteChrome(own, siteConfig, merged, scope = null) {
  const meta = merged || {};
  const ignored = [];
  const from = {};
  if (!siteConfig || !own) return { meta, ignored, from };
  const sc = scope || {};
  const translatedHere = !!sc.localeFolder && !sc.layerFile;
  for (const key of Object.keys(own)) {
    if (!isSiteChromeKey(key) || !Object.prototype.hasOwnProperty.call(siteConfig, key)) continue;
    if (translatedHere && !LOCALE_NEUTRAL_CHROME_KEYS.includes(key)) continue;
    const site = said(siteConfig[key]);
    if (site === '' || site === said(own[key])) continue;
    meta[key] = siteConfig[key];
    ignored.push(key);
    from[key] = sc.layerFile && (sc.layerKeys || []).includes(key) ? sc.layerFile : SITE_CONFIG_FILE;
  }
  return { meta, ignored, from };
}

/**
 * The build-log line for one ignored page key. `file` names the page (`content/about.md`),
 * `controlFile` the file whose value the page wears (resolveSiteChrome's `from`), and `layerFile`
 * the page folder's own `_site.md` when there is one and it is not `controlFile`: that file can set
 * the key for the folder's pages, which is the fix a translated page usually wants.
 */
export function siteChromeWarning(key, file, controlFile = SITE_CONFIG_FILE, layerFile = null) {
  const head = `sitetile: ${key} in ${file} is IGNORED — ${controlFile} sets ${key}, and a page cannot change a site setting.`;
  if (layerFile && layerFile !== controlFile) {
    const dir = layerFile.replace(/_site\.md$/, '');
    return `${head} Remove the line from ${file}, change it in ${controlFile}, or set it in ${layerFile} for the pages in ${dir}.`;
  }
  return `${head} Remove the line from ${file}, or change it in ${controlFile}.`;
}
