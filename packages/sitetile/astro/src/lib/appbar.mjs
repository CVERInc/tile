// reef#2790 — the installed-app bottom bar (decided with the owner 2026-11-01:「這就是資料的不同呈現」).
//
// A site with `packages: pwa` can be installed and opened as an app (display-mode: standalone), and
// an app has no address bar and no back button: the page has to bring its own navigation. There the
// nav MOVES — it is not drawn twice — from the header into one bar along the bottom edge, which is
// also where the corner corals (inbox and the site's own dock items) go. The header keeps the logo
// and its action buttons (cart, search, theme, the CTA); the hamburger goes.
//
// 🔴 ONLY AN INSTALLED APP ON A NARROW SCREEN (owner ruling 2026-11-01). The switch is ONE decision,
// made before first paint by the inline <head> snippet below (APPBAR_HEAD_SCRIPT): running as an
// installed app (display-mode: standalone, or iOS's navigator.standalone) AND inside sitetile's
// mobile breakpoint (APPBAR_MEDIA, the same 48rem as site.css's `mobile` rules) ⇒
// `html[data-dc-dock-bar]`. Every rule below keys on that attribute, appbar.js reads it, and the
// corals' shared dock base reads it (contract ①: a coral joins the bar only when the page has one AND
// it is switched on). A wide installed window keeps the normal header and the corner docks. Decided
// once per page view: a rotation does not move the nav back and forth under the visitor's thumb.
//
// 🔴 NEVER A PAGE WITHOUT NAVIGATION (cold review of tile#233, S3). The switch says the bar WILL be
// used; the header's nav leaves only while the bar is actually SHOWN —
// `html[data-dc-dock-bar]:has(dc-dock[name="bar"]:not([hidden]))` — and the bar is un-hidden only by
// the dock base claiming it (appbar.js, or a coral joining it). If that script never runs (a chunk
// that 404s after a deploy, a CSP block, an error), the header keeps its nav for the whole page view.
// The price: until the deferred appbar.js has run, the header's nav links are painted, and then move
// into the bar. A browser without `:has()` drops the rule and shows both (never neither).
//
// 🔴 A NORMAL BROWSER SEES NOTHING NEW. The bar is written `hidden` and stays hidden unless the switch
// is on; every rule below is keyed on `html[data-dc-dock-bar]` or on the hidden bar itself. And a
// site without `packages: pwa` (it cannot be installed) or without a `nav:` gets none of this: not
// the element, not the style, not the script — its pages are byte-identical to before.
//
// The bar is the corner dock's own element (`dc-dock[name="bar"]`, packages/dynamic-corals/shared/
// dock.mjs): the nav tabs are written into it here, before any coral runs, and by the dock's
// contract ① children without a `dockAnchor` (a renderer's own entries) come first: the nav leads
// and every tool (the inbox, an owner's dock item written anywhere in the page) follows it. The dock owns the tab shape and the "More" rule — over five visible tabs,
// the first four stay and the rest go to a More sheet — so first-level nav takes at most four tabs
// whenever there is anything after it. A nav item with children opens a list. The current page's
// tab carries aria-current="page" (a group: data-current, when one of its links is the page). A nav
// item whose destination is not a safe link is left out of the bar (a tab that goes nowhere is noise).
//
// The inbox joins the bar late — after its network gate — so the renderer, which knows at build time
// that the site has one, writes `data-reserve="1"` on the bar: the dock counts it from the first paint
// and a fifth nav tab is in More from the start, instead of jumping there when the inbox arrives.

/**
 * sitetile's mobile breakpoint, reused (site.css: `@media (max-width: 48rem)`, the `mobile` header
 * actions and the folded sidebar). appbar.test.mjs fails if site.css stops carrying it.
 */
export const APPBAR_MEDIA = '(max-width: 48rem)';

/**
 * The switch, inline in <head> so it runs before the first paint (no header flash): an installed app
 * at the mobile breakpoint ⇒ `<html data-dc-dock-bar>`. Only on pages that carry the bar.
 */
export const APPBAR_HEAD_SCRIPT = `(function(){try{var m=window.matchMedia,s=(m&&m('(display-mode: standalone)').matches)||navigator.standalone===true;if(s&&m&&m(${JSON.stringify(APPBAR_MEDIA)}).matches)document.documentElement.setAttribute('data-dc-dock-bar','')}catch(e){}})();`;

/**
 * The oldest inbox-bubble an appbar page may be served (the first that joins the bar). Written as the
 * loader's rollback marker on those pages — `/*inbox-bubble>=0.8.0*\/` — so a search before rolling the
 * coral's `v0` back below it finds them (review of tile#233, finding 6).
 */
export const APPBAR_CORAL_FLOOR = '0.8.0';

/**
 * The "More" tab's name, in the page's language: its own complete table over the four languages
 * the renderer's chrome speaks (chrome-copy.test.mjs lists this file as owning one), English for any
 * other. Kept here rather than in locale.mjs's LINGO_UI because that file is read into another
 * package's generated bundle, which this change has no business regenerating.
 */
const MORE = { 'en-us': 'More', 'zh-tw': '更多', 'ja-jp': 'その他', 'ko-kr': '더보기' };
const key = (lang) => {
  const l = String(lang || '').toLowerCase();
  return l.startsWith('zh') ? 'zh-tw' : l.startsWith('ja') ? 'ja-jp' : l.startsWith('ko') ? 'ko-kr' : 'en-us';
};
export function moreLabel(lang) { return MORE[key(lang)]; }
/**
 * The bar's landmark name (it is the page's navigation while the header's is hidden — cold review of
 * tile#233, N1). A screen reader says "navigation" itself, so the name is only which one.
 */
const NAV = { 'en-us': 'Main', 'zh-tw': '主要', 'ja-jp': 'メイン', 'ko-kr': '주요' };
export function navLabel(lang) { return NAV[key(lang)]; }

/** `/a/b/` → `/a/b`, `/` → `/`; the query and fragment never count. */
const norm = (p) => (String(p).replace(/[?#].*$/, '').replace(/\/+$/, '') || '/');

/** Is this nav destination the page being rendered? Same-site paths only. */
export function isCurrent(href, pathname) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return false;
  return norm(href) === norm(pathname || '/');
}

/** Every descendant of a nav node, flattened in reading order. */
export function flatten(item) {
  const out = [];
  for (const c of (item && item.children) || []) out.push(c, ...flatten(c));
  return out;
}

/** The header gives up its nav only while the bar is SHOWN (see 🔴 NEVER A PAGE WITHOUT NAVIGATION). */
const BAR_SHOWN = 'html[data-dc-dock-bar]:has(dc-dock[name="bar"]:not([hidden]))';
export const APPBAR_CSS = `
${BAR_SHOWN} .rf-nav > :is(.rf-nav-link,.rf-nav-group),
${BAR_SHOWN} .rf-nav-hamburger,
${BAR_SHOWN} .rf-nav-check,
${BAR_SHOWN} .rf-ha-overlay[data-ha-overlay="nav"]{display:none!important}
${BAR_SHOWN} body{padding-bottom:calc(3.5rem + env(safe-area-inset-bottom,0px))}
dc-dock[name="bar"]{--dc-dock-bar-bg:var(--gd-nav-panel,var(--gd-head,var(--gd-bg,#fff)));--dc-dock-bar-fg:var(--gd-text,#111)}
dc-dock[name="bar"] .rf-tab{color:inherit;text-decoration:none}
dc-dock[name="bar"] .rf-tab:focus-visible,dc-dock[name="bar"] .rf-tab summary:focus-visible{outline:2px solid currentColor;outline-offset:-4px}
dc-dock[name="bar"] .rf-tab-group > details{width:100%}
dc-dock[name="bar"] .rf-tab-group summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:center;min-height:3.5rem;padding:0 .25rem}
dc-dock[name="bar"] .rf-tab-group[slot="more"] summary{justify-content:flex-start;min-height:3rem;padding:0}
dc-dock[name="bar"] .rf-tab-group summary::-webkit-details-marker{display:none}
dc-dock[name="bar"] .rf-tab-list{position:fixed;left:0;right:0;bottom:calc(3.5rem + env(safe-area-inset-bottom,0px));
  display:flex;flex-direction:column;max-height:calc(100dvh - 4.5rem - env(safe-area-inset-top,0px));overflow:auto;
  padding:.25rem env(safe-area-inset-right,0px) .25rem env(safe-area-inset-left,0px);
  background:var(--dc-dock-bar-bg);color:var(--dc-dock-bar-fg);border-radius:.9rem .9rem 0 0;
  box-shadow:0 -1px 3px rgba(0,0,0,.12),0 -4px 12px rgba(0,0,0,.14);text-align:start;font-size:1rem}
dc-dock[name="bar"] .rf-tab-group[slot="more"] .rf-tab-list{position:static;box-shadow:none;border-radius:0;padding:0 0 .5rem 1rem;max-height:none}
dc-dock[name="bar"] .rf-tab-list a{display:block;padding:.75rem 1rem;color:inherit;text-decoration:none}
dc-dock[name="bar"] .rf-tab-list a[aria-current="page"]{font-weight:700}
`;
