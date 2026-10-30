// REEF with Countdown — the dynamic-coral client, SOURCE form. The distributable `countdown.js` is
// BUILT from this file (`node ../build.mjs countdown` from this directory's parent) — do not edit
// countdown.js by hand. Mounting only; everything that can be wrong lives in countdown-core.mjs and
// the two shared modules it imports, where node drives it.
import { mountAll } from './countdown-core.mjs';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll(document));
else mountAll(document);
