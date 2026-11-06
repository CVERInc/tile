// The editor's ONE notice: a full-width bar at a screen edge that PUSHES content, never floats over it.
//
//   top     status, progress and errors — waiting for the page, saving, not saved, could not open.
//           It stays until the state it describes ends. Pushes the page down.
//   bottom  transient confirmations — deleted (with Undo), saved, replaced. Goes after a few seconds.
//           Pushes the page up; while a sheet is open it sits inside that sheet, ABOVE its button
//           row, so it never covers the buttons a finger is about to press.
//
// Both are the same element shape and the same look (w3/edit3.css .notice), in both themes, and both
// wear the bleedblend edge classes so iOS Safari tints its chrome to the bar. A failure's words are
// never truncated: the bar wraps.
//
// The edge/lifetime rules are pure (and tested); createNotices() is the small DOM half.
export const NOTICE_EDGE = {
  waiting: 'top', saving: 'top', failed: 'top', loadFailed: 'top',
  deleted: 'bottom', saved: 'bottom', replaced: 'bottom', proposed: 'bottom', done: 'bottom',
};
export const noticeEdge = (kind) => NOTICE_EDGE[kind] || 'bottom';
/** how long a notice stays, in ms; 0 = until the state it describes ends (or it is cleared) */
export const noticeLife = (kind) => (noticeEdge(kind) === 'top' ? 0 : 6000);
/** an error is announced as an alert, everything else politely */
export const noticeTone = (kind) => (kind === 'failed' || kind === 'loadFailed' ? 'error' : 'info');
/** where the bottom bar goes: inside the open sheet (above its buttons), or at the page's bottom edge */
export const bottomSlot = ({ sheetOpen }) => (sheetOpen ? 'sheet' : 'page');

/**
 * doc: the document. top/bottom: the two bar elements (each holding .notice-text and .notice-act).
 * openSheet(): the open sheet's panel, or null — where the bottom bar moves while a sheet is open.
 */
export function createNotices({ top, bottom, openSheet, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const home = { parent: bottom.parentNode, next: bottom.nextSibling };
  let timer = 0;
  const paint = (bar, kind, text, action) => {
    bar.dataset.kind = kind; bar.dataset.tone = noticeTone(kind);
    bar.setAttribute('role', noticeTone(kind) === 'error' ? 'alert' : 'status');
    bar.querySelector('.notice-text').textContent = text;
    const b = bar.querySelector('.notice-act');
    b.hidden = !action;
    if (action) { b.textContent = action.label; b.onclick = () => { if (bar === bottom) hide(bottom); action.run(); }; }
    bar.hidden = false;
  };
  const hide = (bar) => { bar.hidden = true; delete bar.dataset.kind; };
  /** put the bottom bar where it belongs right now (call when a sheet opens or closes) */
  function place() {
    const panel = openSheet();
    if (bottomSlot({ sheetOpen: !!panel }) === 'sheet') {
      const foot = panel.querySelector('.ctw-modal-foot');
      if (foot) { if (bottom.parentNode !== foot || foot.firstChild !== bottom) foot.prepend(bottom); }
      else if (bottom.parentNode !== panel) panel.appendChild(bottom);
      bottom.classList.add('in-sheet');
    } else {
      if (bottom.parentNode !== home.parent) home.parent.insertBefore(bottom, home.next && home.next.parentNode === home.parent ? home.next : null);
      bottom.classList.remove('in-sheet');
    }
  }
  return {
    show(kind, text, action) {
      const edge = noticeEdge(kind), bar = edge === 'top' ? top : bottom;
      paint(bar, kind, text, action);
      if (edge === 'bottom') {
        place();
        clearTimer(timer);
        timer = setTimer(() => hide(bottom), noticeLife(kind));
      }
    },
    /** clear one edge ('top' | 'bottom'), or both */
    clear(edge) { if (edge !== 'bottom') hide(top); if (edge !== 'top') { clearTimer(timer); hide(bottom); } },
    place,
    get top() { return top.hidden ? null : top.dataset.kind; },
    get bottom() { return bottom.hidden ? null : bottom.dataset.kind; },
  };
}
