// header-actions cart wiring (Coral A · the "post-cutover" checkout wiring promised in
// SiteLayout's header-actions comment). Turns the structure-only cart drawer + count badge
// into a LIVE, site-wide cart backed by the square-shop coral's localStorage cart
// (`dc-square-shop-cart:<guild>`), so the header cart behaves the same on every page — the
// Jui-style always-there cart.
//
// STRICT OPT-IN: this island is only imported when `header-actions-cart-guild` is declared in
// ir/_site.md AND a `cart` toggle exists. A site without that frontmatter never loads this file
// and renders byte-identical — same guarantee as every other header-actions feature. It also
// self-gates below (no `.rf-header-actions[data-cart-guild]` → no-op), so it is inert even if
// pulled in by accident.
//
// What it does, gated behind the guild:
//   • badge  — paints the live item count from localStorage on EVERY page (an always-there cart
//              is pointless if the count only works where the shop grid is).
//   • drawer — on a page that HAS the square-shop coral (the shop), it relocates the coral's own
//              cart panel node into the header drawer, so the coral keeps owning render / stepper
//              / checkout while the header hosts it. On a page WITHOUT the coral, the cart panel
//              can't be rendered (the cart stores only [variationId, qty] — no catalog), so the
//              cart button instead NAVIGATES to the canonical cart page (`data-cart-href`) rather
//              than opening an empty drawer. Honest: you always reach your real cart.
//   • shape  — normalizes the cart button's radius to the theme's --gd-radius (inline, scoped to
//              this button only — never touches the shared .rf-ha-btn rule, so every other site
//              hamburger/sidebar buttons are unaffected).
//   • place  — on desktop, slots the cart between the nav and its trailing CTA; on mobile it
//              stays in the always-visible header bar (the nav collapses to a hamburger there).
(function () {
  var actions = document.querySelector('.rf-header-actions[data-cart-guild]');
  if (!actions) return; // not opted in on this page — inert.
  var guild = actions.getAttribute('data-cart-guild') || '';
  if (!guild) return;
  var href = actions.getAttribute('data-cart-href') || '';
  var KEY = 'dc-square-shop-cart:' + guild;
  var CORAL = '[data-dynamic-coral="square-shop"]';

  function count() {
    try {
      var a = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(a) ? a.reduce(function (n, e) {
        return n + (Array.isArray(e) ? (parseInt(e[1], 10) || 0) : 0);
      }, 0) : 0;
    } catch (e) { return 0; }
  }
  function paintBadge() {
    var b = actions.querySelector('.rf-ha-badge');
    if (!b) return;
    var n = count();
    b.setAttribute('data-count', n > 0 ? String(n) : '');
    b.textContent = n > 0 ? String(n) : '';
  }

  // Shape: match the button to the theme instead of the hardcoded 999px pill — scoped to this
  // button via inline style so the shared .rf-ha-btn rule (and every other site) is untouched.
  var btn = actions.querySelector('.rf-ha-btn');
  if (btn) btn.style.borderRadius = 'var(--gd-radius, 999px)';

  // Placement: desktop → cart sits with the nav (before its CTA), and the nav cluster is pulled
  // to the right (brand stays left) so the wired cart lands top-right where a header cart belongs
  // — `.rf-header-actions`' own margin-left:auto no longer applies once it's inside the nav.
  // Mobile → the nav collapses to a hamburger, so the cart returns to the always-visible header
  // bar and the nav's right-pull is dropped.
  var nav = document.querySelector('.rf-header .rf-nav');
  var hamburger = document.querySelector('.rf-header .rf-nav-hamburger');
  var homeParent = actions.parentNode, homeNext = actions.nextSibling;
  var mq = window.matchMedia('(min-width: 641px)');
  function place() {
    if (!nav) return;
    if (mq.matches) {
      var cta = nav.querySelector('.rf-header-cta');
      if (cta) nav.insertBefore(actions, cta); else nav.appendChild(actions);
      nav.style.marginLeft = 'auto';
      if (hamburger) hamburger.style.marginLeft = '';
    } else {
      // Mobile: the cart returns to the always-visible header bar and groups with the hamburger on
      // the RIGHT. Both `.rf-header-actions` and `.rf-nav-hamburger` default to margin-left:auto,
      // which SPLITS the free space and strands the cart mid-bar; neutralize the hamburger's so only
      // the cart's auto remains, pulling the cart+hamburger pair together to the right edge.
      if (actions.parentNode !== homeParent) homeParent.insertBefore(actions, homeNext);
      nav.style.marginLeft = '';
      if (hamburger) hamburger.style.marginLeft = '0';
    }
  }
  place();
  if (mq.addEventListener) mq.addEventListener('change', place);

  var hasCoral = !!document.querySelector(CORAL);

  if (hasCoral) {
    // Shop page: hand the coral's own cart panel to the header drawer, and open the drawer when
    // something is added — the coral keeps managing the panel's contents.
    var body = function () { return document.querySelector('.rf-ha-drawer-body'); };
    function relocate() {
      var panel = document.querySelector('.dc-square-shop-cart'), b = body();
      if (!panel || !b) return false;
      if (panel.parentElement !== b) { b.innerHTML = ''; b.appendChild(panel); }
      return true;
    }
    var tries = 0, iv = setInterval(function () {
      tries++;
      if (relocate() || tries > 80) {
        clearInterval(iv);
        paintBadge();
        var b = body();
        if (b) new MutationObserver(paintBadge).observe(b, { childList: true, subtree: true });
      }
    }, 200);
    var root = document.querySelector(CORAL);
    if (root) root.addEventListener('click', function (e) {
      if (e.target.closest('.dc-square-shop-buy')) {
        setTimeout(function () {
          paintBadge();
          var cb = actions.querySelector('.rf-ha-check');
          if (cb) cb.checked = true;
        }, 60);
      }
    });
  } else if (href) {
    // Off-shop: no coral to render the panel — send the shopper to the real cart page instead of
    // opening a drawer that can't show their items. Intercept the <label>'s default (checkbox
    // toggle) so the CSS drawer never opens here.
    var label = actions.querySelector('label.rf-ha-btn[for]');
    if (label) label.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.href = href;
    });
    paintBadge();
  } else {
    paintBadge();
  }

  window.addEventListener('storage', paintBadge);
  window.addEventListener('pageshow', paintBadge); // bfcache restore → refresh the count
  // Same-tab cart writes (square-shop.js persistCart / the detail page's own Add button) don't fire
  // 'storage' on THIS window — only OTHER tabs get that. This custom event is the same-tab signal,
  // and it's what makes the badge react to an add on the PRODUCT DETAIL page (no coral there, so the
  // click-handler paintBadge call below never runs for it).
  window.addEventListener('dc-cart-changed', paintBadge);
})();
