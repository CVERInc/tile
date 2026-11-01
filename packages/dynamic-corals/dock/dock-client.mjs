// REEF with Dock — the dynamic-coral client, SOURCE form. The distributable `dock.js` is BUILT from
// this file (`node ../build.mjs dock` from this directory's parent) — do not edit dock.js by hand.
// Mounting only; the item lives in dock-core.mjs and the corner in ../shared/dock.mjs.
import { mountAll } from './dock-core.mjs';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll(document));
else mountAll(document);
