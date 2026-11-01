// The DOCK — one container per screen corner that the corner corals (inbox-bubble, the `dock`
// coral's panel and link items, whatever comes next) put themselves into, so that stacking two of
// them, one disappearing, and the next one taking its place are ordinary layout, not coordinates
// copied from somebody else's source.
//
// ── The contract (three sentences; version-stable on purpose) ────────────────────────────────────
//
//   ① To join position P, take `document.querySelector('dc-dock[name="P"]')` — creating it at the
//     end of <body> if it is missing — or, when the page's renderer has written a
//     `dc-dock[name="bar"]` and switched it on (`<html data-dc-dock-bar>`), that bar, which no coral
//     ever creates; set `item.dockAnchor` to a node left where the item stood, and insert the item
//     before the first child whose `dockAnchor` (or, lacking one, the child itself) follows that
//     anchor in document order.
//   ② When an item opens, it dispatches `dc-dock:open` on `document` with `detail` = the item;
//     every other open item that hears it closes.
//   ③ An item whose `dockAnchor` has left the document leaves its dock: the first copy to claim a
//     dock on a page sets `document.dcDockWatch` and watches the page for it, for every item of
//     every dock, whoever drew it.
//
// That is ALL two bundles have to agree on. Each coral carries its own copy of this file (a
// dynamic coral ships as one file; inbox-bubble pastes the block below verbatim and
// dock-sync.test.mjs holds the two copies equal), so a page can run two copies of DIFFERENT ages
// side by side: whichever copy creates a dock gives it its look (the first `attachShadow` wins and
// every later copy sees `shadowRoot` and leaves it alone), and both copies still find the same
// dock, order their items the same way and close each other's panels. Nothing else here — the
// look, the tokens, the bar's "More" — is part of the contract, and any of it may change in a
// later version without breaking an older copy on the same page.
//
// ── What the dock owns, and what it does not ─────────────────────────────────────────────────────
//
// The dock owns the corner: edge margin, the phone's safe areas, the one site-wide bottom reserve
// (`--dc-dock-reserve`, for a cookie bar or another vendor's widget — both corners move up
// together, so they stay symmetric), the shadow budget, and the item SHAPE (size, radius, shadow,
// gap), handed to items as `--dc-dock-*` custom properties, which inherit into each item's own
// shadow root. An item declares none of those. What an item owns is its colour, its icon and what
// its panel holds.
//
// 🔴 PREVENT UGLINESS WITHIN REASON; BEYOND THAT, DO NOT CLEAN UP AFTER THE OWNER. Five bubbles in
// one corner stack up to the top of a phone and that is what the owner gets: nothing here hides,
// collapses or moves items back. The rules below only stop the ordinary page from breaking the
// corner (a site's `div{display:block}` or `* {margin:…}` cannot reach a slotted item past the
// `!important` declarations of the dock's own shadow stylesheet).
//
// ── The shadow budget ────────────────────────────────────────────────────────────────────────────
//
// A shadow may not reach further than the edge margin, or the screen edge cuts it off. Measured on
// an iPhone 14 (390×664 visible, headless WebKit, 2026-11-01): the inbox panel's `0 12px 40px`
// was cut by 18 / 24 / 36 px (left / right / bottom). The budget is `0 1px 3px` + `0 4px 12px`:
// the outer layer reaches 4 + 12 = 16px down and 12px sideways, inside the 16px margin
// (`max(1rem, 16px)`, so a small root font cannot shrink the margin under the shadow's reach).
//
// ── Installed app: the bar ───────────────────────────────────────────────────────────────────────
//
// An installed app has no address bar and no back button, so the page has to bring its own
// navigation. A site renderer that wants that writes ONE `dc-dock[name="bar"]` (hidden) holding its
// own nav links, and decides — before first paint, once — whether this page view uses it, by setting
// `data-dc-dock-bar` on <html> (sitetile: an installed app at its mobile breakpoint; a wide installed
// window keeps the corners). Only then does every coral item join the bar instead of a corner: a row
// along the bottom edge in which every child is a square tab (the dock's shape, not the item's). The
// renderer's links are children without a `dockAnchor` and therefore stand where they are written.
// More than five visible entries: the first four stay tabs and the rest move into a "More" sheet — by
// `slot`, not by moving nodes, so document order and the contract above are untouched. A renderer
// that knows an item will join later (the inbox, behind its network gate) says so with
// `data-reserve="<n>"` on the bar, and the More split counts those entries from the first paint, so
// nothing moves into More when they arrive.
//
// 🔴 A CORAL NEVER CREATES THE BAR, and never decides "installed app" itself. A bar a coral made up on
// a page that had none covered the page's own footer and its own fixed bottom bar, with nothing
// reserving room for it (review of tile#233, finding 2). Without the renderer's bar and switch, an
// installed app gets the corners, exactly like a browser.

// ── DOCK-BASE-BEGIN (verbatim in inbox-bubble.js) ──
const DOCK_TAG = 'dc-dock';
const DOCK_OPEN = 'dc-dock:open';
/** The budget (see the header): the outer layer's reach, 4 + 12 = 16px, is the edge margin. */
const DOCK_SHADOW = '0 1px 3px rgba(0,0,0,.12),0 4px 12px rgba(0,0,0,.14)';
/** Tabs in the installed-app bar before the last one becomes "More". */
const DOCK_BAR_MAX = 5;
const DOCK_CSS = `
:host{position:fixed!important;z-index:2147483000;display:flex!important;flex-direction:column-reverse;
  box-sizing:border-box;margin:0!important;border:0!important;width:auto;height:auto;
  padding:0 0 var(--_dc-reserve,0px)!important;pointer-events:none;
  gap:var(--dc-dock-gap);bottom:calc(var(--dc-dock-margin) + env(safe-area-inset-bottom,0px));
  --dc-dock-margin:max(1rem,16px);--dc-dock-size:3.5rem;--dc-dock-w:var(--dc-dock-size);--dc-dock-gap:.5rem;
  --dc-dock-radius:50%;--dc-dock-shadow:${DOCK_SHADOW};--dc-dock-vh:100vh;
  --dc-dock-room:calc(var(--dc-dock-vh) - 2 * var(--dc-dock-margin) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px) - var(--_dc-reserve,0px));
  --dc-dock-panel-w:min(22rem,calc(100vw - 2 * var(--dc-dock-margin) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)))}
@supports (height:100dvh){:host{--dc-dock-vh:100dvh}}
:host([hidden]){display:none!important}
:host(:not([name="left"])){right:calc(var(--dc-dock-margin) + env(safe-area-inset-right,0px));align-items:flex-end}
:host([name="left"]){left:calc(var(--dc-dock-margin) + env(safe-area-inset-left,0px));align-items:flex-start}
::slotted(*){display:flex!important;flex-direction:column!important;align-items:inherit!important;gap:var(--dc-dock-gap)!important;
  flex:none!important;position:static!important;margin:0!important;padding:0!important;pointer-events:auto}
::slotted([hidden]){display:none!important}
:host([name="bar"]){left:0;right:0;bottom:0;flex-direction:row;align-items:stretch;gap:0;
  padding:0 env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)!important;
  background:var(--dc-dock-bar-bg,#fff);color:var(--dc-dock-bar-fg,#111);box-shadow:0 -1px 0 rgba(0,0,0,.12);
  --dc-dock-w:100%;--dc-dock-radius:0;--dc-dock-shadow:none;--dc-dock-item-bg:transparent;--dc-dock-item-ink:currentColor;
  --dc-dock-room:calc(var(--dc-dock-vh) - var(--dc-dock-size) - var(--dc-dock-margin) - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));
  --dc-dock-panel-w:auto}
:host([name="bar"]) ::slotted(*){flex:1 1 0!important;min-width:0!important;min-height:var(--dc-dock-size)!important;
  align-items:center!important;justify-content:center!important;gap:0!important;box-sizing:border-box!important;
  color:inherit;text-align:center;text-decoration:none;font-size:.75rem;line-height:1.2;overflow-wrap:anywhere}
:host([name="bar"]) ::slotted([aria-current="page"]),:host([name="bar"]) ::slotted([data-current]){font-weight:700;box-shadow:inset 0 3px 0 currentColor}
:host([name="bar"]) ::slotted([slot="more"]){flex:none!important;min-height:3rem!important;align-items:stretch!important;justify-content:center!important;padding:0 1rem!important;text-align:start;font-size:1rem}
.more{all:unset;box-sizing:border-box;flex:1 1 0;min-width:0;min-height:var(--dc-dock-size);display:flex;flex-direction:column;
  align-items:center;justify-content:center;cursor:pointer;color:inherit;font:inherit;font-size:.75rem;line-height:1.2;pointer-events:auto}
.more[hidden]{display:none}
.more:focus-visible{outline:2px solid currentColor;outline-offset:-4px}
.more svg{width:1.5rem;height:1.5rem}
.sheet{position:fixed;left:0;right:0;bottom:calc(var(--dc-dock-size) + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;
  max-height:var(--dc-dock-room);overflow:auto;padding:0 env(safe-area-inset-right,0px) 0 env(safe-area-inset-left,0px);
  background:inherit;color:inherit;box-shadow:0 -1px 3px rgba(0,0,0,.12),0 -4px 12px rgba(0,0,0,.14);border-radius:.9rem .9rem 0 0;
  visibility:hidden;pointer-events:none}
.sheet[data-open]{visibility:visible;pointer-events:auto}
@media (prefers-color-scheme:dark){:host([name="bar"]){background:var(--dc-dock-bar-bg,#1c1c1e);color:var(--dc-dock-bar-fg,#f2f2f7)}}
@media print{:host{display:none!important}}
`;
const DOCK_MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>';

/** The × an open item's bubble shows in place of its icon: the bubble is the panel's close control. */
const DOCK_CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/></svg>';

/**
 * The renderer's bar, when this page view uses it (contract ①): written by the page and switched on
 * by `<html data-dc-dock-bar>`. Otherwise null — and then every item stays in the corners.
 */
function dockBarOn(doc) {
  if (!doc.documentElement || typeof doc.documentElement.hasAttribute !== 'function') return null;
  if (!doc.documentElement.hasAttribute('data-dc-dock-bar')) return null;
  return doc.querySelector(`${DOCK_TAG}[name="bar"]`);
}

/**
 * The owner's bottom reserve, validated: a length (not a percentage) or 0px. A typo in a site's
 * theme must not invalidate the dock's own geometry, so the public token is read and only a value
 * the browser accepts as a length reaches the private one the stylesheet uses.
 */
function dockReserve(dock) {
  let v = '';
  try { v = String(getComputedStyle(dock).getPropertyValue('--dc-dock-reserve') || '').trim(); } catch { /* no CSSOM */ }
  const ok = v && !/%/.test(v) && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('padding-bottom', v);
  dock.style.setProperty('--_dc-reserve', ok ? `clamp(0px,${v},50vh)` : '0px');
}

/** The bar's "More": children past the fourth go to `slot="more"` once there are more than five. */
function dockBar(dock, shadow) {
  const doc = dock.ownerDocument;
  const more = doc.createElement('button');
  more.type = 'button';
  more.className = 'more';
  more.hidden = true;
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'dc-dock-sheet');
  const label = dock.getAttribute('data-more-label') || 'More';
  more.innerHTML = DOCK_MORE_ICON;
  more.appendChild(doc.createElement('span')).textContent = label;
  const sheet = doc.createElement('div');
  sheet.className = 'sheet';
  sheet.id = 'dc-dock-sheet';
  sheet.setAttribute('role', 'group');
  sheet.setAttribute('aria-label', label);
  sheet.appendChild(doc.createElement('slot')).name = 'more';
  shadow.append(more, sheet);
  const show = (open, focus) => {
    sheet.toggleAttribute('data-open', open);
    more.setAttribute('aria-expanded', String(open));
    if (open) doc.dispatchEvent(new CustomEvent(DOCK_OPEN, { detail: dock }));
    else if (focus) more.focus();
  };
  more.addEventListener('click', () => show(more.getAttribute('aria-expanded') !== 'true'));
  // Any other open closes the sheet — an item opened FROM the sheet included: its panel takes the
  // screen, and stays visible because an item's panel sets `visibility:visible` over the sheet's.
  // Not an opener INSIDE a More entry (a nav group's list): what it opens is part of the sheet, and
  // closing the sheet would hide it again (review of tile#233, finding 4).
  doc.addEventListener(DOCK_OPEN, (e) => {
    const d = e.detail;
    if (d === dock) return;
    const entry = d && typeof d.closest === 'function' ? d.closest('[slot="more"]') : null;
    if (entry && entry !== d && entry.parentNode === dock) return;
    show(false);
  });
  shadow.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.hasAttribute('data-open')) show(false, true); });
  const sync = () => {
    const kids = [...dock.children].filter((k) => !k.hidden);
    // Entries the renderer said will join later (`data-reserve`) count from the start, until they do.
    const reserve = Math.min(Math.max(parseInt(dock.getAttribute('data-reserve') || '0', 10) || 0, 0), DOCK_BAR_MAX);
    const own = kids.filter((k) => !k.dockAnchor).length;
    const over = Math.max(kids.length, own + reserve) > DOCK_BAR_MAX;
    kids.forEach((k, i) => {
      const want = over && i >= DOCK_BAR_MAX - 1 ? 'more' : null;
      if (k.getAttribute('slot') !== want) { if (want) k.setAttribute('slot', want); else k.removeAttribute('slot'); }
    });
    more.hidden = !over;
    if (!over && sheet.hasAttribute('data-open')) show(false);
    // An empty bar is no bar: a strip along the bottom with nothing in it is a broken page.
    // 🩸 ONLY WHEN IT CHANGES. Setting `hidden` to the value it already has still queues an attribute
    // record, the observer below watches exactly that attribute, and an empty bar re-ran this forever:
    // the page froze (review of tile#233, finding 1).
    if (dock.hidden !== (kids.length === 0)) dock.hidden = kids.length === 0;
  };
  if (typeof MutationObserver === 'function') {
    new MutationObserver(sync).observe(dock, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  sync();
}

/**
 * Contract ③: one observer per page, set up by the first copy to claim a dock. When nodes leave the
 * document it retires every docked item whose anchor went with them — the inbox whose container a
 * route change replaced, a dock item whose section was torn down — as removing the container did
 * when the item still lived inside it. Removals only, and only the docks' own children are looked at.
 */
function dockWatch(doc) {
  if (doc.dcDockWatch || typeof MutationObserver !== 'function') return;
  doc.dcDockWatch = true;
  new MutationObserver((records) => {
    if (!records.some((r) => r.removedNodes.length)) return;
    for (const dock of doc.querySelectorAll(DOCK_TAG)) {
      for (const item of [...dock.children]) if (item.dockAnchor && !item.dockAnchor.isConnected) item.remove();
    }
  }).observe(doc, { childList: true, subtree: true });
}

/** Gives a dock its look, once: the first copy to arrive attaches the shadow root, later ones see it. */
function dockClaim(dock) {
  if (dock.shadowRoot) return;
  const doc = dock.ownerDocument;
  dockWatch(doc);
  const shadow = dock.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = DOCK_CSS;
  shadow.append(style, doc.createElement('slot'));
  dockReserve(dock);
  if (typeof window !== 'undefined') window.addEventListener('resize', () => dockReserve(dock));
  if (dock.getAttribute('name') === 'bar') dockBar(dock, shadow);
  else dock.hidden = false;
}

/** Contract ①. Returns the dock the item is now in, or null where there is no document to join. */
function dockJoin(item, anchor, name) {
  const doc = item.ownerDocument;
  if (!doc || !doc.body || typeof doc.querySelector !== 'function') return null;
  const bar = dockBarOn(doc);
  // `bar` is the renderer's to write: a coral asking for it by name gets a corner like any other name.
  const want = /^[a-z][a-z0-9-]*$/.test(name || '') && name !== 'bar' ? name : 'right';
  let dock = bar || doc.querySelector(`${DOCK_TAG}[name="${want}"]`);
  if (!dock) {
    dock = doc.createElement(DOCK_TAG);
    dock.setAttribute('name', want);
    doc.body.appendChild(dock);
  }
  dockClaim(dock);
  item.dockAnchor = anchor;
  const at = (n) => n.dockAnchor || n;
  let before = null;
  for (const child of dock.children) {
    if (child === item) continue;
    // DOCUMENT_POSITION_FOLLOWING: the child's place comes after this item's.
    if (anchor.compareDocumentPosition(at(child)) & 4) { before = child; break; }
  }
  if (item.parentNode !== dock || item.nextElementSibling !== before) dock.insertBefore(item, before);
  return dock;
}

/** How many visible items sit between this one and the corner — what an open panel must leave room for. */
function dockBelow(item) {
  let n = 0;
  for (let s = item.previousElementSibling; s; s = s.previousElementSibling) if (!s.hidden) n++;
  return n;
}

/** Contract ②, both halves: announce an open; close when another item announces one. */
function dockAnnounce(item) {
  item.ownerDocument.dispatchEvent(new CustomEvent(DOCK_OPEN, { detail: item }));
}
function dockListen(item, close) {
  const doc = item.ownerDocument;
  const on = (e) => { if (e.detail !== item) close(); };
  doc.addEventListener(DOCK_OPEN, on);
  return () => doc.removeEventListener(DOCK_OPEN, on);
}

/**
 * Is any corner item open right now, whoever drew it? Read from what every item already shows: a
 * control with `aria-expanded="true"` in its open shadow root (or the bar's own More), or an open
 * `<details>` among a renderer's own entries. An auto-open asks this first, so it never closes what a
 * visitor, a `#name` or a `reef-inbox:open` opened.
 */
function dockAnyOpen(doc) {
  const open = (root) => !!(root && root.querySelector('[aria-expanded="true"]'));
  for (const dock of doc.querySelectorAll(DOCK_TAG)) {
    if (open(dock.shadowRoot)) return true;
    for (const item of dock.children) {
      if (item.shadowRoot ? open(item.shadowRoot) : !!item.querySelector('details[open]')) return true;
    }
  }
  return false;
}

/**
 * Where the focus goes when an item's panel closes from the keyboard: its bubble — or, for an item
 * that sits in the bar's More sheet (closed by the time its panel was open), the More button, the
 * nearest control still on screen.
 */
function dockFocusBack(item, bubble) {
  const dock = item.parentNode;
  const more = item.getAttribute && item.getAttribute('slot') === 'more' && dock && dock.shadowRoot
    ? dock.shadowRoot.querySelector('.more') : null;
  const to = more && !more.hidden ? more : bubble;
  if (to && typeof to.focus === 'function') to.focus();
}

/** `#rgb`, `#rrggbb`, `rgb()`/`rgba()` → [r, g, b] (0–255), or null. */
function dockRgb(text) {
  const s = String(text || '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  return m ? [m[1], m[2], m[3]].map(Number) : null;
}

/**
 * Black or white ink for a background, by relative luminance (WCAG 2): white below 0.179, where the
 * two contrast ratios cross. A colour that cannot be read is treated as dark — the default bubble is.
 */
function dockInk(bg) {
  const rgb = dockRgb(bg);
  if (!rgb) return '#fff';
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000' : '#fff';
}
// ── DOCK-BASE-END ──

export {
  DOCK_TAG, DOCK_OPEN, DOCK_SHADOW, DOCK_BAR_MAX, DOCK_CSS, DOCK_CLOSE_ICON,
  dockBarOn, dockClaim, dockJoin, dockBelow, dockAnnounce, dockListen, dockAnyOpen, dockFocusBack, dockRgb, dockInk,
};
