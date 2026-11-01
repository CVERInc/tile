// reef#2790 — the installed-app bottom bar's switch (see ../../lib/appbar.mjs for the whole story).
// Runs only on a page that carries the bar (a `packages: pwa` site with a `nav:`). The DECISION is
// not made here: the inline <head> snippet (APPBAR_HEAD_SCRIPT) made it before first paint —
// an installed app at the hamburger breakpoint ⇒ `html[data-dc-dock-bar]` — and this module only acts
// on it, as the corals' dock base does. Without the attribute (a browser, a wide installed window)
// it does nothing: the hidden bar stays hidden and the header keeps its nav. With it: the corner
// dock gives the bar its look (the same base the corals carry; the first copy to arrive does it), and
// the mobile-menu state machine is switched off for the page, so the header's remaining buttons sit
// in its row instead of in a menu nobody can open.
import { dockClaim, DOCK_OPEN } from '../../../../../dynamic-corals/shared/dock.mjs';

const bar = document.querySelector('dc-dock[name="bar"][data-st-appbar]');
if (bar && document.documentElement.hasAttribute('data-dc-dock-bar')) {
  dockClaim(bar);
  document.body.removeAttribute('data-nav-mobile');
  // A nav group's list is a panel like any other: one open at a time with the corner items.
  const groups = () => bar.querySelectorAll(':scope > .rf-tab-group > details');
  for (const d of groups()) {
    d.addEventListener('toggle', () => {
      if (d.open) document.dispatchEvent(new CustomEvent(DOCK_OPEN, { detail: d }));
    });
  }
  document.addEventListener(DOCK_OPEN, (e) => {
    for (const d of groups()) if (d.open && e.detail !== d) d.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    for (const d of groups()) {
      if (!d.open) continue;
      d.open = false;
      d.querySelector('summary').focus();
    }
  });
}
