// add-menu.mjs — the "add to calendar" menu the events list and the countdown share.
//
// A door (any `<a data-dc-add-file="…">`) keeps a plain href — the Google Calendar link — so it
// works with no script and in a browser without popovers. Where popovers exist, a click on a door
// does not leave the page: it opens ONE small menu with two ways to take the event,
//
//     Apple · Outlook   → the event as an .ics file (whatever calendar the device opens it with)
//     Google Calendar   → the Google link
//
// in that order (A–Z) on every device, including an app's built-in browser, where a file may do
// nothing: that visitor has the second row, and we cannot tell them apart from the outside.
// We do not guess from the device which one the visitor uses:
// a phone says nothing about whose calendar is on it, and a wrong guess fails silently — the event
// lands in a calendar the visitor never opens.
//
// 🔴 NO WORDS OF OUR OWN: the two rows are brand names, the same in every language.
// The layer itself is the browser's (`popover`): top layer, Escape, click-outside are not ours.
import { icon } from '../events/events-core.mjs';
import { withDynamicCoralCssLayer } from './dynamic-coral-css.mjs';

export const ADD_MENU_ROWS = ['Apple · Outlook', 'Google Calendar'];
export const ADD_FILE_ATTR = 'data-dc-add-file';

export const ADD_MENU_CSS = [
  '.dc-add-menu{position:fixed;inset:auto;margin:0;padding:6px;min-width:13.5em;box-sizing:border-box;border:1px solid var(--gd-border,rgba(128,128,128,.35));border-radius:min(var(--gd-radius,12px),14px);background:var(--gd-bg,var(--gd-surface,Canvas));color:var(--gd-text,CanvasText);box-shadow:0 8px 24px rgba(0,0,0,.16);font:500 .95rem/1.3 var(--gd-font,system-ui,sans-serif)}',
  '.dc-add-menu:focus{outline:none}',
  '.dc-add-menu::backdrop{background:transparent}',
  '.dc-add-menu a{display:flex;align-items:center;gap:.55em;padding:.55em .7em;border-radius:min(var(--gd-radius,12px),9px);color:inherit;text-decoration:none}',
  '.dc-add-menu a:focus-visible{outline:2px solid var(--gd-accent,#875fb6);outline-offset:-2px}',
  '.dc-add-menu .dc-ev-ic{flex:none;width:1.1em;height:1.1em;color:var(--gd-accent-text,var(--gd-accent-deep,var(--gd-accent,#875fb6)))}',
  '@supports (background:color-mix(in srgb,red 10%,white)){.dc-add-menu a:hover,.dc-add-menu a:focus-visible{background:color-mix(in srgb,var(--gd-accent,#875fb6) 12%,transparent)}}',
].join('');

/** Where the menu goes: under the door, at the pointer when there was one (a door can be a whole header bar), kept on screen. */
export function menuPlace(door, menu, view, pointerX) {
  const gap = 6, edge = 8;
  // under the pointer, but never hanging off the door's own right edge when the door is wide enough to hold it
  let at = typeof pointerX === 'number' ? pointerX - 20 : door.left;
  if (door.right - door.left >= menu.width) at = Math.min(Math.max(at, door.left), door.right - menu.width);
  const left = Math.max(edge, Math.min(at, view.width - menu.width - edge));
  const below = door.bottom + gap;
  const top = below + menu.height > view.height - edge ? Math.max(edge, door.top - menu.height - gap) : below;
  return { left, top };
}

/**
 * `value` as an absolute http(s) address, or '' — the only kind the menu will turn into a link.
 * The doors the corals write are already that; but the listener honours ANY `a[data-dc-add-file]`
 * on the page, and a page may carry markup its owner did not write (a sanitised comment keeps
 * `data-*` attributes): a `javascript:` there must not become a row someone can click.
 */
export function httpHref(value, base) {
  if (!value) return '';
  try { const u = new URL(String(value), base || undefined); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch (e) { return ''; }
}

/** Where focus goes when the menu closes: the door, or — when the door is hidden from assistive tech — the row's own named door. */
export function focusTarget(door) {
  if (!door || !door.isConnected) return null;
  const hidden = door.getAttribute('aria-hidden') === 'true' || door.getAttribute('tabindex') === '-1';
  if (!hidden) return door;
  const row = door.closest ? door.closest('.dc-ev-item') : null;
  return (row && row.querySelector('a[' + ADD_FILE_ATTR + ']:not([aria-hidden="true"])')) || null;
}

const WIRED = '__dcAddMenu';

/**
 * Make every door in `doc` open the menu. Safe to call from each coral on the page: the first call
 * wires the document, the rest do nothing. Does nothing at all where popovers do not exist — the
 * doors stay ordinary links.
 */
export function wireAddMenu(doc) {
  if (!doc || !doc.body || doc[WIRED]) return false;
  const menu = doc.createElement('div');
  if (typeof menu.showPopover !== 'function') return false;
  doc[WIRED] = true;

  if (doc.head && !doc.querySelector('style[data-dc="add-menu"]')) {
    const style = doc.createElement('style');
    style.setAttribute('data-dc', 'add-menu');
    style.textContent = withDynamicCoralCssLayer(ADD_MENU_CSS, doc);
    doc.head.appendChild(style);
  }

  menu.className = 'dc-add-menu';
  menu.setAttribute('popover', '');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Add to calendar');
  menu.tabIndex = -1;
  let from = null;

  const row = (text, href, newTab) => {
    const a = doc.createElement('a');
    a.setAttribute('role', 'menuitem');
    a.setAttribute('href', href);
    if (newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    a.innerHTML = icon('calendar-plus');            // our own constant markup
    const label = doc.createElement('span');
    label.textContent = text;
    a.appendChild(label);
    return a;
  };

  menu.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) menu.hidePopover(); });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); menu.hidePopover(); return; }   // a menu is left by closing it: focus goes back to the door
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.prototype.slice.call(menu.querySelectorAll('a'));
    const at = items.indexOf(doc.activeElement);
    e.preventDefault();
    items[e.key === 'ArrowDown' ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1)].focus();
  });
  menu.addEventListener('toggle', (e) => {
    if (e.newState !== 'closed') return;
    const door = from; from = null;
    // give focus back only if it was still in the menu: a click elsewhere has already moved it
    const back = focusTarget(door);
    // (the browser itself hands focus back to whatever had it before the popover: the door that was clicked)
    const at = doc.activeElement;
    if (back && (at === door || at === menu || menu.contains(at) || at === doc.body)) back.focus({ preventScroll: true });
  });

  doc.addEventListener('click', (e) => {
    // composedPath: a door inside a shadow root reaches the document retargeted to its host
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const target = path[0] && path[0].closest ? path[0] : e.target;
    const door = target && target.closest ? target.closest('a[' + ADD_FILE_ATTR + ']') : null;
    if (!door || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const file = httpHref(door.getAttribute(ADD_FILE_ATTR), doc.baseURI), google = httpHref(door.getAttribute('href'), doc.baseURI);
    if (!file || !google) return;                   // not ours to vouch for: the door stays an ordinary link
    e.preventDefault();
    // Inside a host's modal dialog or popover the menu must be ITS child: appended to body it would be inert under
    // a modal, and as an unrelated auto popover it would close the host's panel under the visitor.
    const home = door.closest('dialog[open],[popover]') || doc.body;
    if (menu.parentNode !== home) home.appendChild(menu);
    menu.replaceChildren(row(ADD_MENU_ROWS[0], file, false), row(ADD_MENU_ROWS[1], google, true));
    from = door;
    menu.showPopover();
    const view = doc.defaultView || {};
    const byPointer = e.detail > 0;                 // a keyboard "click" has detail 0
    const place = menuPlace(door.getBoundingClientRect(), menu.getBoundingClientRect(), { width: view.innerWidth || 0, height: view.innerHeight || 0 }, byPointer ? e.clientX : undefined);
    menu.style.left = place.left + 'px';
    menu.style.top = place.top + 'px';
    // by keyboard, land on the first row; by pointer, hold focus on the menu so no row looks chosen
    (byPointer ? menu : menu.querySelector('a')).focus({ preventScroll: true });
  });
  // It is placed once, in viewport coordinates: when the page moves under it, close it rather than let it drift from its door.
  const shut = () => { if (menu.isConnected && menu.matches(':popover-open')) menu.hidePopover(); };
  const view = doc.defaultView;
  if (view && view.addEventListener) { view.addEventListener('scroll', shut, { passive: true, capture: true }); view.addEventListener('resize', shut, { passive: true }); }
  return true;
}
