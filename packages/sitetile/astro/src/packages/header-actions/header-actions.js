// header-actions / nav-mobile a11y polish. The OPEN/CLOSE reveal is pure CSS (a hidden
// checkbox flipped by a <label>, revealed via body:has(#…:checked) — the age-gate primitive).
// This island adds ONLY the things CSS can't: Escape-to-close, Enter/Space activation for the
// role="button" <label>s (a <label> toggles its checkbox on click, but the keyboard "click" a
// screen-reader user expects from role="button" needs this shim), and closing when the visitor
// has gone somewhere (a link followed, a history step). Self-gating: if no toggle checkbox exists
// on the page it no-ops, so a non-opted site pays nothing.
(function () {
  const toggles = [].slice.call(document.querySelectorAll('[data-ha-toggle]'));
  if (!toggles.length) return;
  // The ONE close: every open drawer / nav dropdown. No `change` is dispatched — blog-search.js
  // only listens for the drawer OPENING, and Escape has never sent one.
  const closeAll = function () { toggles.forEach(function (cb) { cb.checked = false; }); };

  // Escape closes every open drawer / nav dropdown (unless the user is typing in a field).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (t.getAttribute && t.getAttribute('data-ha-toggle') == null) return;
    }
    closeAll();
  });

  // A link followed IN THIS TAB closes the drawers. A link to an anchor on the same page only
  // scrolls — the document stays, so the checkbox stayed checked and the panel and its overlay sat
  // over the section the visitor asked for. Enter on a focused link fires this same click. Closed
  // during the click, before the browser scrolls, so the scroll lands against the closed layout.
  // Not closed when this tab does not follow the link: a modifier click / target=_blank / download
  // (the visitor keeps this page, menu included), a click some other handler cancelled (that link
  // is acting as a control), and any click that is not on a link (a field, a button, a toggle).
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('download')) return;
    const target = (a.getAttribute('target') || '').trim().toLowerCase();
    if (target && target !== '_self') return;
    closeAll();
  });

  // Back/forward onto a same-page anchor scrolls the page like a tap does, and fires no click.
  window.addEventListener('hashchange', closeAll);
  // A page the visitor returns to must not come back with a drawer still open: restored whole from
  // the back/forward cache (`pageshow` persisted), or re-loaded by a history step with the checkbox
  // state the browser restores into form controls — which Chromium does AFTER `load`, just before
  // this `pageshow` (WebKit before this script runs). A tap that opened a drawer while the page was
  // still loading fires `change` (a restore does not), and is left alone.
  let tapped = false;
  toggles.forEach(function (cb) { cb.addEventListener('change', function () { tapped = true; }); });
  const nav = window.performance && performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  window.addEventListener('pageshow', function (e) {
    if (e.persisted || (nav && nav.type === 'back_forward' && !tapped)) closeAll();
  });

  // Enter/Space on a role="button" <label> toggles its associated checkbox.
  const labels = document.querySelectorAll('label[data-ha-key]');
  for (let i = 0; i < labels.length; i++) {
    labels[i].addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      const cb = document.getElementById(this.getAttribute('for'));
      if (!cb) return;
      cb.checked = !cb.checked;
      // A programmatic flip fires no `change`, a tap does. Anything keyed off the checkbox's
      // state (the blog-search overlay closes when the nav drawer OPENS — reef#2161) must see the
      // keyboard open as the same event as the tap, so emit the one the tap would have.
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
})();
