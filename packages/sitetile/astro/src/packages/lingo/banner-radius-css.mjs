// The language banner's two buttons follow the site's button radius — CVERInc/reef#1888.
// Signet ships `.locale-banner__continue { border-radius: var(--gd-pill, 9999px) }` and a
// hard-coded 9999px on `.locale-banner__decline`; neither reads the theme. Appended after Signet's
// CSS inside the same `@layer reef.theme` (same specificity, later wins — the LINGO_BAR_POSITION
// precedent), so this wins without !important and an owner's own theme CSS still beats both.
// --gd-pill stays first as the transition knob; 9999px is only for a host with no tokens at all.
export const LOCALE_BANNER_RADIUS_CSS = '\n.locale-banner__continue,.locale-banner__decline{border-radius:var(--gd-pill, var(--gd-btn-radius, 9999px))}\n';
