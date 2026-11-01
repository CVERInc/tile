// REEF with Dock — a corner item the owner writes in plain markup: a bubble that opens a panel, or
// a bubble that is a link (back to top, call, LINE). The corner itself — where it sits, how items
// stack, the shape, the shadow — is the dock's (../shared/dock.mjs); this file is one item.
//
//   <div data-dynamic-coral="dock" data-dock="left" data-label="Cohort 6 closes soon"
//        data-color="#ff5d61" data-open-on-hash="cohort6" data-auto-open="1" hidden>
//     <svg slot="icon" viewBox="0 0 24 24">…</svg>
//     <div>…the panel: the owner's own markup, styled by the site's own CSS…</div>
//   </div>
//
//   <div data-dynamic-coral="dock" data-href="tel:+81312345678" data-label="Call us" hidden>
//     <svg slot="icon" viewBox="0 0 24 24">…</svg>
//   </div>
//
// The element is the item: it gets an open shadow root (the bubble, and the panel's frame) and
// moves into the dock, leaving a comment where it stood (`dockAnchor`, contract ①). Its children
// stay the owner's light DOM — `slot="icon"` is the bubble's glyph, everything else is the panel,
// slotted in on the FIRST open (an image in a panel nobody opens is never laid out). Because the
// element moves, the panel's content must not rely on what used to surround it.
//
// What the owner sets: colour (`data-color`), icon (`slot="icon"`, inline SVG), icon colour
// (`data-icon-color`; by default black or white by the colour's luminance), position (`data-dock`),
// the panel's content, `#name` opening it (`data-open-on-hash="<name>"`), and opening once per
// visit (`data-auto-open="1"`). What the owner cannot set: size, distance from the edge, shadow —
// stacking, symmetry and the phone's room are all built on every item being the same size.
//
// Behaviour: collapsed by default; an auto-open item opens once per visit (this tab, across pages:
// sessionStorage), never over something already open; while open, the bubble shows × and is the
// panel's close control (the panel has no × of its own); nothing ever moves on its own
// (no badge, no pulse); when every element of the panel's content hides itself (countdown at its
// deadline sets `hidden`), the whole item retires, and comes back if one shows again; Esc closes
// and returns focus to the bubble; one panel open at a time across every dock item on the page
// (contract ②); hidden in print; and the owner's `hidden` stays until this script has mounted the
// item, so a page whose script failed shows nothing.
import {
  dockJoin, dockBelow, dockAnnounce, dockListen, dockAnyOpen, dockFocusBack, dockInk, dockRgb, DOCK_SHADOW, DOCK_CLOSE_ICON,
} from '../shared/dock.mjs';
import { withDynamicCoralCssLayer } from '../shared/dynamic-coral-css.mjs';

export const SELECTOR = '[data-dynamic-coral="dock"]';
const DEFAULT_BG = '#111';
const STORE_PREFIX = 'dc-dock:';
const HASH_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** What an open item's bubble is called — it closes the panel — in the page's language (the inbox's nine). */
const CLOSE = { en: 'Close', 'zh-tw': '關閉', 'zh-cn': '关闭', ja: '閉じる', ko: '닫기', de: 'Schließen', fr: 'Fermer', es: 'Cerrar', pt: 'Fechar' };
export function closeLabel(lang) {
  const parts = String(lang || 'en').toLowerCase().split('-').filter(Boolean);
  if (parts[0] === 'zh') return CLOSE[parts.includes('hans') || ((parts.includes('cn') || parts.includes('sg')) && !parts.includes('hant')) ? 'zh-cn' : 'zh-tw'];
  return CLOSE[parts[0]] || CLOSE.en;
}

const PANEL_ICON = '<svg class="d" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z"/></svg>';
const LINK_ICON = '<svg class="d" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M9 7h8v8"/></svg>';

const ITEM_CSS = `
:host{font:inherit}
.b{box-sizing:border-box;margin:0;border:0;padding:0;width:var(--dc-dock-w,3.5rem);height:var(--dc-dock-size,3.5rem);
  min-width:0;min-height:0;max-width:none;max-height:none;flex:none;border-radius:var(--dc-dock-radius,50%);
  -webkit-appearance:none;appearance:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.75rem;
  background:var(--dc-dock-item-bg,var(--_bg,${DEFAULT_BG}));color:var(--dc-dock-item-ink,var(--_ink,#fff));
  box-shadow:var(--dc-dock-shadow,${DOCK_SHADOW});font:inherit;line-height:0;text-decoration:none}
.b:focus-visible{outline:2px solid var(--_bg,${DEFAULT_BG});outline-offset:2px}
.d,::slotted(svg){width:1.6rem!important;height:1.6rem!important;display:block!important;flex:none!important}
.x{display:none;width:1.6rem;height:1.6rem;flex:none}
.x svg{display:block;width:100%;height:100%}
.b[aria-expanded="true"] slot[name="icon"]{display:none}
.b[aria-expanded="true"] .x{display:block}
:host([slot="more"]) .b{justify-content:flex-start;height:3rem;font-size:1rem;line-height:1.2}
:host([slot="more"]) .b::after{content:attr(aria-label)}
.p{box-sizing:border-box;width:var(--dc-dock-panel-w,min(22rem,calc(100vw - 2rem)));
  max-height:calc(var(--dc-dock-room,calc(100vh - 2rem)) - (var(--_dc-below,0) + 1) * (var(--dc-dock-size,3.5rem) + var(--dc-dock-gap,.5rem)));
  overflow:auto;overscroll-behavior:contain;border-radius:.9rem;outline:none;visibility:visible;
  background:var(--dc-dock-panel-bg,#fff);color:var(--dc-dock-panel-fg,#111);box-shadow:var(--dc-dock-shadow,${DOCK_SHADOW})}
.p[hidden]{display:none}
.p.bar{position:fixed;left:0;right:0;bottom:calc(var(--dc-dock-size,3.5rem) + env(safe-area-inset-bottom,0px));width:auto;
  max-height:var(--dc-dock-room,calc(100vh - 4.5rem));border-radius:.9rem .9rem 0 0;
  box-shadow:0 -1px 3px rgba(0,0,0,.12),0 -4px 12px rgba(0,0,0,.14)}
`;

/** Only what a link may safely be: http(s), mailto, tel, a fragment, or a same-site path. */
export function safeItemHref(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^(#|\/(?!\/)|\.\.?\/)/.test(s)) return s;
  try {
    const p = new URL(s).protocol;
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(p) ? s : null;
  } catch {
    return null;
  }
}

/** The item's name for `#name` and for remembering its once-per-visit auto-open — or '' when it has none. */
export function itemName(el) {
  const raw = String(el.getAttribute('data-open-on-hash') || '').trim();
  return HASH_NAME.test(raw) ? raw : '';
}

/** What the bubble is called: `data-label`, else the panel's first heading. */
function itemLabel(el) {
  const own = String(el.getAttribute('data-label') || '').trim();
  if (own) return own;
  const h = el.querySelector('h1,h2,h3,h4,h5,h6');
  return h ? String(h.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

/** The panel's content: every element child but the icon. */
function contentOf(el) {
  return [...el.children].filter((c) => c.getAttribute('slot') !== 'icon');
}

function session() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

/**
 * The once-per-visit key: the item's name, else its corner and its label (an item without either is
 * still remembered — review of tile#233, finding 8).
 */
export function autoKey(el, label = itemLabel(el)) {
  const name = itemName(el);
  if (name) return STORE_PREFIX + name;
  const pos = String(el.getAttribute('data-dock') || '').trim() || 'right';
  return `${STORE_PREFIX}${pos}:${label}`;
}

/** First in document wins: once an item of this bundle has asked to auto-open, no later one does. */
let autoTaken = false;

/**
 * Mount one item. Returns `{ open(), close(), isOpen(), el }`, or null when the element cannot host
 * a shadow root (an `<a>` or `<button>`): then it is left exactly as authored.
 */
export function mountItem(el) {
  const doc = el.ownerDocument;
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
  let shadow;
  try { shadow = el.attachShadow({ mode: 'open' }); } catch { return null; }
  const href = el.hasAttribute('data-href') ? safeItemHref(el.getAttribute('data-href')) : null;
  const isLink = el.hasAttribute('data-href');
  const name = itemName(el);
  const label = itemLabel(el);
  const close = closeLabel(doc.documentElement && doc.documentElement.getAttribute('lang'));

  const style = doc.createElement('style');
  style.textContent = withDynamicCoralCssLayer(ITEM_CSS, doc);
  shadow.appendChild(style);

  let panel = null;
  if (!isLink) {
    panel = doc.createElement('div');
    panel.className = 'p';
    panel.id = 'p';
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    if (label) panel.setAttribute('aria-label', label);
    shadow.appendChild(panel);
  }
  const b = doc.createElement(isLink ? 'a' : 'button');
  b.className = 'b';
  if (isLink) {
    if (href) b.setAttribute('href', href);
  } else {
    b.setAttribute('type', 'button');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'p');
  }
  if (label) b.setAttribute('aria-label', label);
  const iconSlot = doc.createElement('slot');
  iconSlot.name = 'icon';
  iconSlot.innerHTML = isLink ? LINK_ICON : PANEL_ICON;
  b.appendChild(iconSlot);
  if (!isLink) {
    // Open, the bubble is the close control: × in place of the icon (CSS, keyed on aria-expanded).
    const x = doc.createElement('span');
    x.className = 'x';
    x.innerHTML = DOCK_CLOSE_ICON;
    b.appendChild(x);
  }
  shadow.appendChild(b);

  // Colour and its ink. A colour this file can parse is read directly; anything else (a name, a
  // `var()`, `oklch()`) is resolved by the browser through a probe and read back as rgb().
  const bg = String(el.getAttribute('data-color') || '').trim();
  if (bg) b.style.setProperty('--_bg', bg);
  let resolved = bg || DEFAULT_BG;
  if (bg && !dockRgb(bg) && win && typeof win.getComputedStyle === 'function') {
    const probe = doc.createElement('span');
    probe.style.setProperty('color', bg);
    probe.hidden = true;
    shadow.appendChild(probe);
    resolved = win.getComputedStyle(probe).color || resolved;
    probe.remove();
  }
  b.style.setProperty('--_ink', String(el.getAttribute('data-icon-color') || '').trim() || dockInk(resolved));

  // Move into the dock (contract ①). The comment marks where the item was written.
  const anchor = doc.createComment(' dc-dock ');
  el.parentNode.insertBefore(anchor, el);
  const dock = dockJoin(el, anchor, String(el.getAttribute('data-dock') || '').trim());
  if (panel && dock && dock.getAttribute('name') === 'bar') panel.classList.add('bar');

  let open = false;
  let slotted = false;
  const store = session();

  function setOpen(next, { user = false, focus = false } = {}) {
    if (!panel || next === open || (next && el.hidden)) return;
    open = next;
    if (next && !slotted) {
      panel.appendChild(doc.createElement('slot'));
      slotted = true;
    }
    if (next) panel.style.setProperty('--_dc-below', String(dockBelow(el)));
    panel.hidden = !next;
    b.setAttribute('aria-expanded', String(next));
    if (next) b.setAttribute('aria-label', close);
    else if (label) b.setAttribute('aria-label', label);
    else b.removeAttribute('aria-label');
    if (next) {
      dockAnnounce(el);
      if (user) panel.focus();
    } else if (focus) {
      dockFocusBack(el, b);
    }
  }

  // Once per visit, and never over something already open (a visitor's panel, a `#name`, the inbox
  // opened by `reef-inbox:open`) — whichever bundle drew it.
  const autoAt = autoKey(el, label);
  function autoOpen() {
    if (dockAnyOpen(doc)) return;
    setOpen(true);
    try { if (store) store.setItem(autoAt, 'opened'); } catch { /* full or blocked */ }
  }

  if (panel) {
    b.addEventListener('click', () => setOpen(!open, { user: true }));
    // On the host, so a key pressed inside the owner's own panel content (light DOM) is heard too.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !open) return;
      e.stopPropagation();
      setOpen(false, { user: true, focus: true });
    });
    dockListen(el, () => setOpen(false));
  }

  // Opening once per visit waits for the item to be visible: a countdown inside it may mount after
  // this script and only then un-hide itself (and the item with it).
  let pendingAuto = false;
  // Retire with the content: every content element hidden ⇒ the item is hidden, and back again.
  const sync = () => {
    const kids = contentOf(el);
    const retire = !isLink && kids.length > 0 && kids.every((k) => k.hidden);
    if (el.hidden !== retire) el.hidden = retire;
    if (retire && open) setOpen(false);
    if (!retire && pendingAuto) {
      pendingAuto = false;
      autoOpen();
    }
  };
  if (typeof MutationObserver === 'function') {
    new MutationObserver(sync).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  }
  sync();

  if (panel) {
    const hashOpens = () => name && win && win.location && win.location.hash === `#${name}`;
    if (hashOpens()) {
      autoTaken = true;
      setOpen(true);
    } else if (el.getAttribute('data-auto-open') === '1' && !autoTaken) {
      let done = false;
      try { done = !!(store && store.getItem(autoAt)); } catch { /* blocked */ }
      autoTaken = true;
      if (!done) { pendingAuto = true; sync(); }
    }
    if (name && win) win.addEventListener('hashchange', () => { if (hashOpens()) setOpen(true); });
  }

  return { el, open: () => setOpen(true, { user: true }), close: () => setOpen(false, { user: true }), isOpen: () => open };
}

export function mountAll(doc) {
  doc.querySelectorAll(SELECTOR).forEach((el) => {
    if (el.getAttribute('data-dynamic-coral-mounted') === '1') return;
    el.setAttribute('data-dynamic-coral-mounted', '1');
    mountItem(el);
  });
}

/** For tests: forget that an item auto-opened (one bundle, one page, in a browser). */
export function _resetAutoOpen() { autoTaken = false; }
