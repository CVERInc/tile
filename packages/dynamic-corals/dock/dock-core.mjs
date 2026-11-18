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
// panel's close control, named "Close <label>" (the panel has no × of its own — except in the
// installed-app bar's More sheet, which hides with the bubble in it once the panel opens); nothing
// ever moves on its own
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

/**
 * What an open item's bubble is called — it closes the panel — in the page's language (the inbox's
 * nine): "Close <label>", so the name still says what it controls (cold review of tile#233, N2); the
 * bare word when the item has no label.
 */
const CLOSE = {
  en: ['Close', (l) => `Close ${l}`], 'zh-tw': ['關閉', (l) => `關閉「${l}」`], 'zh-cn': ['关闭', (l) => `关闭「${l}」`],
  ja: ['閉じる', (l) => `「${l}」を閉じる`], ko: ['닫기', (l) => `${l} 닫기`], de: ['Schließen', (l) => `${l} schließen`],
  fr: ['Fermer', (l) => `Fermer ${l}`], es: ['Cerrar', (l) => `Cerrar ${l}`], pt: ['Fechar', (l) => `Fechar ${l}`],
};
export function closeLabel(lang, label = '') {
  const parts = String(lang || 'en').toLowerCase().split('-').filter(Boolean);
  const key = parts[0] === 'zh'
    ? (parts.includes('hans') || ((parts.includes('cn') || parts.includes('sg')) && !parts.includes('hant')) ? 'zh-cn' : 'zh-tw')
    : CLOSE[parts[0]] ? parts[0] : 'en';
  const [word, named] = CLOSE[key];
  return label ? named(label) : word;
}

const PANEL_ICON = '<svg class="d" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5z"/></svg>';
const LINK_ICON = '<svg class="d" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M9 7h8v8"/></svg>';

const ITEM_CSS = `
:host{font:inherit}
.b{box-sizing:border-box;margin:0;border:0;padding:0;width:var(--dc-dock-w,44px);height:var(--dc-dock-size,44px);
  min-width:0;min-height:0;max-width:none;max-height:none;flex:none;border-radius:var(--dc-dock-radius,50%);
  -webkit-appearance:none;appearance:none;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:.75rem;
  background:var(--dc-dock-item-bg,var(--_bg,${DEFAULT_BG}));color:var(--dc-dock-item-ink,var(--_ink,#fff));
  box-shadow:var(--dc-dock-shadow,${DOCK_SHADOW});font:inherit;line-height:0;text-decoration:none}
.b:focus-visible{outline:2px solid var(--_bg,${DEFAULT_BG});outline-offset:2px}
.d,::slotted(svg){width:var(--dc-dock-icon,20px)!important;height:var(--dc-dock-icon,20px)!important;display:block!important;flex:none!important}
.x{display:none;width:var(--dc-dock-icon,20px);height:var(--dc-dock-icon,20px);flex:none}
.x svg{display:block;width:100%;height:100%}
.b[aria-expanded="true"] slot[name="icon"]{display:none}
.b[aria-expanded="true"] .x{display:block}
:host([slot="more"]) .b{justify-content:flex-start;height:3rem;font-size:1rem;line-height:1.2}
:host([slot="more"]) .b::after{content:attr(aria-label)}
.p{box-sizing:border-box;width:var(--dc-dock-panel-w,min(22rem,calc(100vw - 2rem)));
  max-height:calc(var(--dc-dock-room,calc(100vh - 2rem)) - (var(--_dc-below,0) + 1) * (var(--dc-dock-size,44px) + var(--dc-dock-gap,.5rem)));
  overflow:auto;overscroll-behavior:contain;border-radius:.9rem;outline:none;visibility:visible;
  background:var(--dc-dock-panel-bg,#fff);color:var(--dc-dock-panel-fg,#111);box-shadow:var(--dc-dock-shadow,${DOCK_SHADOW})}
.p[hidden]{display:none}
.p.bar{position:fixed;left:0;right:0;bottom:calc(var(--dc-dock-size,44px) + env(safe-area-inset-bottom,0px));width:auto;
  max-height:var(--dc-dock-room,calc(100vh - 4.5rem));border-radius:.9rem .9rem 0 0;
  box-shadow:0 -1px 3px rgba(0,0,0,.12),0 -4px 12px rgba(0,0,0,.14)}
.px{display:none}
:host([slot="more"]) .px{all:unset;box-sizing:border-box;position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:center;
  width:3rem;height:3rem;margin:0 0 0 auto;border-radius:50%;cursor:pointer;color:inherit;background:inherit}
:host([slot="more"]) .px:focus-visible{outline:2px solid currentColor;outline-offset:-4px}
.px svg{display:block;width:1.5rem;height:1.5rem}
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

/** First in document wins: once an item of this bundle is going to auto-open this visit, no later one does. */
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
  // What the item is called can arrive after it is mounted — a panel whose heading is written by a
  // script (a countdown naming the calendar it reads). So it is read again whenever the content
  // changes (`rename`, from the content observer below), not once.
  const lang = doc.documentElement && doc.documentElement.getAttribute('lang');
  let label = itemLabel(el);
  let close = closeLabel(lang, label);

  const style = doc.createElement('style');
  style.textContent = withDynamicCoralCssLayer(ITEM_CSS, doc);
  shadow.appendChild(style);

  let panel = null;
  let panelX = null;
  if (!isLink) {
    panel = doc.createElement('div');
    panel.className = 'p';
    panel.id = 'p';
    panel.hidden = true;
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    if (label) panel.setAttribute('aria-label', label);
    // 🔴 THE ONE × A PANEL CARRIES (cold review of tile#233, S2). Opened from the bar's More sheet, the
    // panel closes the sheet — and the bubble, which is the close control everywhere else, is in that
    // sheet and hides with it. There, and only there (CSS: `:host([slot="more"])`), the panel shows
    // its own ×, first in it, so a touch or a Tab reaches it. Everywhere else it is display:none.
    panelX = doc.createElement('button');
    panelX.className = 'px';
    panelX.setAttribute('type', 'button');
    panelX.setAttribute('aria-label', close);
    panelX.innerHTML = DOCK_CLOSE_ICON;
    panel.appendChild(panelX);
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

  // Retired by the page watcher (contract ③: its anchor left the document), the item is gone for good
  // — the client mounts once. What it still hears (`hashchange`, another item's announce) it then
  // ignores and stops listening to, so a `#name` cannot open a detached panel and, through its
  // announce, close what IS on screen (cold review of tile#233, N3; inbox-bubble's `retired()`).
  const offs = [];
  function retired() {
    // A removed item still drawn for its 160ms exit (the dock's ghost) is retired too.
    if (el.isConnected !== false && !el.dcDockGhost) return false;
    while (offs.length) offs.pop()();
    return true;
  }

  function setOpen(next, { user = false, focus = false } = {}) {
    if (!panel || next === open || (next && (el.hidden || retired()))) return;
    // The visitor has taken it in hand: a keyed item still waiting for its content stops waiting.
    if (user && pendingAuto && autoBySelector) { pendingAuto = false; if (next) seenByVisitor = true; }
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
  //
  // `data-auto-open-by="<selector>"` makes that once per CONTENT: the remembered key also carries
  // the text of what the selector finds in the panel, so when the panel is about something else
  // (the next event) it opens once more.
  //
  // 🔴 Such an item cannot decide at mount — its content may not be there yet — so it WAITS, and
  // waiting takes nothing from anyone: it does not hold the page's one auto-open turn (an item that
  // may never open, or whose content never comes, would starve every item after it). When its text
  // arrives it opens only if nothing has opened by itself on this page yet and nothing is open now.
  // And the visitor outranks the wait: once they have opened or closed it themselves, it will not
  // move by itself on this page — but what they opened is remembered as shown once it can be named.
  const autoBySelector = String(el.getAttribute('data-auto-open-by') || '').trim();
  function autoBy() {
    let found = [];
    try { found = [...el.querySelectorAll(autoBySelector)]; } catch { return ''; }   // not a selector: never ready
    return found.map((n) => String(n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 200);
  }
  // The key is made when it is used: a keyed item is named by then (its label may have arrived with
  // its content), where the label at mount would be '' and shared by every unnamed item in the corner.
  const autoKeyNow = () => {
    const base = autoKey(el, itemLabel(el));
    if (!autoBySelector) return base;
    const about = autoBy();
    return about ? `${base}|${about}` : '';
  };
  const remember = (key) => { try { if (store && key) store.setItem(key, 'opened'); } catch { /* full or blocked */ } };
  const remembered = (key) => { try { return !!(store && key && store.getItem(key)); } catch { return false; } };
  let seenByVisitor = false;   // they opened it before its content could be named: remember it when it can
  function autoOpen() {
    if (!autoBySelector) {     // decided at mount (below); this is its first visible moment
      pendingAuto = false;
      if (dockAnyOpen(doc)) return;
      setOpen(true);
      if (open) remember(autoKeyNow());
      return;
    }
    const key = autoKeyNow();
    if (!key) return;                            // nothing to key on yet: keep waiting
    pendingAuto = false;
    if (remembered(key) || autoTaken || dockAnyOpen(doc)) return;
    setOpen(true);
    if (!open) return;                           // refused (retired, hidden): nothing was shown
    autoTaken = true;
    remember(key);
  }

  if (panel) {
    b.addEventListener('click', () => setOpen(!open, { user: true }));
    panelX.addEventListener('click', () => setOpen(false, { user: true, focus: true }));
    // On the host, so a key pressed inside the owner's own panel content (light DOM) is heard too.
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !open) return;
      e.stopPropagation();
      setOpen(false, { user: true, focus: true });
    });
    offs.push(dockListen(el, () => { if (!retired()) setOpen(false); }));
  }

  // Opening once per visit waits for the item to be visible: a countdown inside it may mount after
  // this script and only then un-hide itself (and the item with it).
  let pendingAuto = false;
  function rename() {
    const next = itemLabel(el);
    if (next === label) return;
    label = next;
    close = closeLabel(lang, label);
    if (panel) {
      if (label) panel.setAttribute('aria-label', label);
      else panel.removeAttribute('aria-label');
      panelX.setAttribute('aria-label', close);
    }
    if (open) b.setAttribute('aria-label', close);
    else if (label) b.setAttribute('aria-label', label);
    else b.removeAttribute('aria-label');
  }
  // Retire with the content: every content element hidden ⇒ the item is hidden, and back again.
  const sync = () => {
    const kids = contentOf(el);
    const retire = !isLink && kids.length > 0 && kids.every((k) => k.hidden);
    if (el.hidden !== retire) el.hidden = retire;
    if (retire && open) setOpen(false);
    rename();
    if (!retire && pendingAuto) autoOpen();     // autoOpen clears pendingAuto once it has decided
    if (seenByVisitor) { const key = autoKeyNow(); if (key) { seenByVisitor = false; remember(key); } }
  };
  if (typeof MutationObserver === 'function') {
    new MutationObserver(sync).observe(el, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'data-label'] });
  }
  sync();

  if (panel) {
    const hashOpens = () => name && win && win.location && win.location.hash === `#${name}`;
    if (hashOpens()) {
      autoTaken = true;
      setOpen(true);
    } else if (el.getAttribute('data-auto-open') === '1') {
      if (autoBySelector) {
        // Keyed by content: it waits for the content and takes nothing meanwhile (see autoOpen).
        pendingAuto = true;
        sync();
      } else if (!autoTaken && !remembered(autoKey(el, label))) {
        // Only an item that will open this visit takes the turn: one already shown leaves it to the
        // next (cold review of tile#233, N7 — otherwise a later item was starved on every page).
        autoTaken = true;
        pendingAuto = true;
        sync();
      }
    }
    if (name && win) {
      const onHash = () => { if (!retired() && hashOpens()) setOpen(true); };
      win.addEventListener('hashchange', onHash);
      offs.push(() => win.removeEventListener('hashchange', onHash));
    }
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
