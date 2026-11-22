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
// THE RULE. When the site config layer (`content/_site.md`, with the page's locale `_site.md`
// over it) sets one of the keys below to a non-blank value, that value is the page's value: the
// page's own line is ignored and named in the build log (the page route warns, once per page and
// key). Nothing fails — a stray line in a page must not take a site's build down.
//
// WHAT THE RULE DOES NOT DO, deliberately:
//   · A key the site config leaves unset still comes from the page. A site with no `_site.md`
//     keeps its chrome on its pages, and so does a site that has moved only part of it (a locale
//     home carrying its own `nav:` is common). Closing that would blank those sites' headers.
//   · A page line that says the same thing as the site config is not reported: nothing changed.
//
// WHICH KEYS. A key is here when its value is (a) words or links in the frame every page shares
// — header, footer, the announcement bar, the age gate — where a visitor reads them as the
// site's own, or (b) a statement of where the site's assets, visitors' data or identity go; and
// when a page has no meaning of its own for it.
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
  'announce',         // the announcement bar: its sentence, its link, its end date
  'age-gate',         // the age gate: whether it is on, its wording, its links, its storage key
  'blog',             // the blog is the site's: its path, labels, routes and search (a page has none)
]);

/** Is `key` one a page cannot change once the site config sets it? */
export function isSiteChromeKey(key) {
  const k = String(key);
  return SITE_CHROME_KEYS.includes(k) || SITE_CHROME_FAMILIES.some((f) => k === f || k.startsWith(f + '-'));
}

const said = (v) => (v == null ? '' : String(v).trim());

/**
 * The page route's half. `own` = the page's own frontmatter, `siteConfig` = the site config layer
 * for this page (null when the site has none), `merged` = own over it. Puts every site-chrome key
 * the site config sets back to the site config's value, in `merged` itself, and returns it with
 * the keys whose page line was ignored: `{ meta, ignored: string[] }`.
 * No site config ⇒ nothing is reserved ⇒ `merged` untouched.
 */
export function resolveSiteChrome(own, siteConfig, merged) {
  const meta = merged || {};
  const ignored = [];
  if (!siteConfig || !own) return { meta, ignored };
  for (const key of Object.keys(own)) {
    if (!isSiteChromeKey(key) || !Object.prototype.hasOwnProperty.call(siteConfig, key)) continue;
    const site = said(siteConfig[key]);
    if (site === '' || site === said(own[key])) continue;
    meta[key] = siteConfig[key];
    ignored.push(key);
  }
  return { meta, ignored };
}

/** The build-log line for one ignored page key. `file` names the page (`content/about.md`). */
export function siteChromeWarning(key, file) {
  return `sitetile: ${key} in ${file} is IGNORED — the site config (_site.md) sets ${key}, and a page `
    + `cannot change a site setting. Remove the line from ${file}, or change it in _site.md.`;
}
