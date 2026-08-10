// header-actions / nav-mobile a11y polish. The OPEN/CLOSE reveal is pure CSS (a hidden
// checkbox flipped by a <label>, revealed via body:has(#…:checked) — the age-gate primitive).
// This island adds ONLY the two things CSS can't: Escape-to-close, and Enter/Space activation
// for the role="button" <label>s (a <label> toggles its checkbox on click, but the keyboard
// "click" a screen-reader user expects from role="button" needs this shim). Self-gating: if no
// toggle checkbox exists on the page it no-ops, so a non-opted site pays nothing.
(function () {
  const toggles = [].slice.call(document.querySelectorAll('[data-ha-toggle]'));
  if (!toggles.length) return;

  // Escape closes every open drawer / nav dropdown (unless the user is typing in a field).
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (t.getAttribute && t.getAttribute('data-ha-toggle') == null) return;
    }
    toggles.forEach(function (cb) { cb.checked = false; });
  });

  // Enter/Space on a role="button" <label> toggles its associated checkbox.
  const labels = document.querySelectorAll('label[data-ha-key]');
  for (let i = 0; i < labels.length; i++) {
    labels[i].addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();
      const cb = document.getElementById(this.getAttribute('for'));
      if (cb) cb.checked = !cb.checked;
    });
  }
})();
