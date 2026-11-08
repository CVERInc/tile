// text-edit — the dynamic-coral client, SOURCE form. The distributable `text-edit.js` is BUILT from
// this file (`node ../build.mjs text-edit` from this directory's parent) — do not edit text-edit.js
// by hand. Mounting only; the anchor, the editing session and the source rule live in
// text-edit-core.mjs and text-edit-source.mjs, where node drives them against real renders.
import { mountAll } from './text-edit-core.mjs';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll(document));
else mountAll(document);
