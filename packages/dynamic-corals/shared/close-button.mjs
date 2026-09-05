// The overlay close button — ONE identity, shared as SOURCE between corals.
//
// The family had six of these: cp-feed-reader-close, reef-drawer-close, reef-toast-close,
// cp-icon-btn, my cp-drawer-close, and the one in the QR popup. The QR one is chodaict's and it is
// the best of them — a 44px circle (the touch-target floor, not a coincidence), an accent ring, a
// blurred ground so it reads over artwork, and a focus ring that is visible rather than polite.
// So it is the origin here, copied verbatim from what qr-client.mjs emits.
//
// 🔴 The QR client is NOT changed to import this. It is generated verbatim from chodaict's
// qr-anim.js, and the standing rule is that nothing in that 表演 moves. Instead this module
// mirrors it and close-button.test.mjs asserts the two are byte-identical, so the copy cannot
// drift while the original stays untouched. Sharing source, not stylesheets, is also what lets a
// coral install into sitetile — a coral that depended on cardtile's CSS could not.
//
// The module gives IDENTITY (size, ring, blur, ✕, focus). POSITION belongs to the host: the QR
// popup pins its button top-left over a full-screen morph; a drawer sticks its own to the corner
// of a panel. Baking a position in is how a shared component becomes unusable in the second place
// it is needed.

/** The visual identity, minus placement. Concatenate with your own positioning rules. */
export const CLOSE_BUTTON_CSS =
  'width:44px;height:44px;border-radius:50%;' +
  'border:1px solid color-mix(in srgb,var(--cp-accent) 35%,transparent);' +
  'background:color-mix(in srgb,var(--cp-ground) 66%,transparent);' +
  'color:var(--cp-accent);font-size:1.2rem;line-height:1;cursor:pointer;' +
  'display:flex;align-items:center;justify-content:center;' +
  '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)';

/** Hover + focus, as a CSS rule body for a given selector. Focus must be SEEN, not implied. */
export const closeButtonStates = (sel) =>
  `${sel}:hover{background:color-mix(in srgb,var(--cp-accent) 20%,transparent)}` +
  `${sel}:focus-visible{outline:2px solid var(--cp-accent);outline-offset:2px}`;

/** The markup. `label` is required — a button whose only content is ✕ has no accessible name. */
export const closeButtonHtml = (cls, label) =>
  `<button type="button" class="${cls}" aria-label="${label}">✕</button>`;
