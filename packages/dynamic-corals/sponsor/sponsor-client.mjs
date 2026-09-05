// REEF with Sponsor — the dynamic-coral client, SOURCE form. The distributable `sponsor.js` is
// BUILT from this file (`node packages/dynamic-corals/build.mjs sponsor`) — do not edit sponsor.js
// by hand.
//
// This half is deliberately tiny: find the mount points, hand each one to the core, and nothing
// else. Everything that could be wrong — reading the amount, validating it, deciding what goes on
// the wire — lives in sponsor-core.mjs where `node --test` can drive it. The events coral splits
// the same way and for the same reason: one brain, two runtimes.
import { SELECTOR, mountSponsor } from './sponsor-core.mjs';

(function () {
  function mountAll() {
    var roots = document.querySelectorAll(SELECTOR);
    for (var i = 0; i < roots.length; i++) mountSponsor(roots[i]);
  }

  // A module script is deferred, so the DOM is normally ready by the time this runs. The guard is
  // for the host that injects this file some other way — a coral installs unmodified into either
  // substrate, and it does not get to assume how it arrived.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
})();
