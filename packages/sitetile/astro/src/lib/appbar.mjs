// reef#2790 — the installed-app bottom bar (decided with the owner 2026-11-01:「這就是資料的不同呈現」).
//
// A site with `packages: pwa` can be installed and opened as an app (display-mode: standalone), and
// an app has no address bar and no back button: the page has to bring its own navigation. There the
// nav MOVES — it is not drawn twice — from the header into one bar along the bottom edge, which is
// also where the corner corals (inbox and the site's own dock items) go. The header keeps the logo
// and its action buttons (cart, search, theme, the CTA); the hamburger goes.
//
// 🔴 A NORMAL BROWSER SEES NOTHING NEW. The bar is written `hidden` and stays hidden unless the
// appbar script (packages/appbar/appbar.js) finds the page running standalone; every rule below is
// keyed on `html[data-st-appbar]`, which only that script sets, or on the hidden bar itself. And a
// site without `packages: pwa` (it cannot be installed) or without a `nav:` gets none of this: not
// the element, not the style, not the script — its pages are byte-identical to before.
//
// The bar is the corner dock's own element (`dc-dock[name="bar"]`, packages/dynamic-corals/shared/
// dock.mjs): the nav tabs are written into it here, before any coral runs, so by the dock's
// contract (children without a `dockAnchor` keep their written place) they come first and the
// tools (inbox …) follow. The dock owns the tab shape and the "More" rule — over five visible tabs,
// the first four stay and the rest go to a More sheet — so first-level nav takes at most four tabs
// whenever there is anything after it. A nav item with children opens a list. The current page's
// tab carries aria-current="page" (a group: data-current, when one of its links is the page).

/**
 * The "More" tab's name, in the page's language: its own complete table over the four languages
 * the renderer's chrome speaks (chrome-copy.test.mjs lists this file as owning one), English for any
 * other. Kept here rather than in locale.mjs's LINGO_UI because that file is read into another
 * package's generated bundle, which this change has no business regenerating.
 */
const MORE = { 'en-us': 'More', 'zh-tw': '更多', 'ja-jp': 'その他', 'ko-kr': '더보기' };
export function moreLabel(lang) {
  const l = String(lang || '').toLowerCase();
  const key = l.startsWith('zh') ? 'zh-tw' : l.startsWith('ja') ? 'ja-jp' : l.startsWith('ko') ? 'ko-kr' : 'en-us';
  return MORE[key];
}

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

export const APPBAR_CSS = `
html[data-st-appbar] .rf-nav > :is(.rf-nav-link,.rf-nav-group),
html[data-st-appbar] .rf-nav-hamburger,
html[data-st-appbar] .rf-nav-check,
html[data-st-appbar] .rf-ha-overlay[data-ha-overlay="nav"]{display:none!important}
html[data-st-appbar] body{padding-bottom:calc(3.5rem + env(safe-area-inset-bottom,0px))}
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
