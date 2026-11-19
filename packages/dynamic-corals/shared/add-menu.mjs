// add-menu.mjs — the "add to calendar" menu the events list and the countdown share.
//
// A door (any `<a data-dc-add-file="…">`) keeps a plain href — the Google Calendar link — so it
// works with no script and in a browser without popovers. Where popovers exist, a click on a door
// does not leave the page: it opens ONE small menu with two ways to take the event,
//
//     Apple · Outlook   → the event as an .ics file (whatever calendar the device opens it with)
//     Google Calendar   → the Google link
//
// in that order (A–Z) on every device. We do not guess from the device which one the visitor uses:
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
    if (door && door.isConnected && (doc.activeElement === menu || menu.contains(doc.activeElement) || doc.activeElement === doc.body)) door.focus({ preventScroll: true });
  });

  doc.addEventListener('click', (e) => {
    const target = e.target;
    const door = target && target.closest ? target.closest('a[' + ADD_FILE_ATTR + ']') : null;
    if (!door || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const file = door.getAttribute(ADD_FILE_ATTR), google = door.getAttribute('href');
    if (!file || !google) return;
    e.preventDefault();
    if (!menu.isConnected) doc.body.appendChild(menu);
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
  return true;
}
