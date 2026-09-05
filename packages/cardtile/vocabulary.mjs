// The Card's vocabulary IS sitetile's.
//
// sitetile is the canon; cardtile is its constrained consumer — one page, small enough to live in
// one store row. The two were speaking different dialects for no reason other than the order they
// were built in: `cp-*` came from the Python card, `sc-coral-*` from the Svelte one before that.
// Same concepts, three names each.
//
// This file is the map, in one place, applied by rename.mjs to BOTH the renderer and the stylesheet
// at once so they cannot drift apart. What it buys is not tidiness: it is that a card's markup and
// a Site's markup mean the same thing, so a stylesheet written for one describes the other.
//
// 🔴 WHAT DOES NOT MOVE, and why:
//
// 1. `cp-icon`, `cp-midwater` and the `--cp-*` custom properties are the QR coral's MOUNT CONTRACT.
//    That coral is lifted verbatim from chodaict's qr-anim.js and does `querySelector('.cp-icon')`
//    and `var(--cp-accent)` in code nothing is allowed to edit. Renaming them would mean editing the
//    表演, which is the one thing ruled out. They are the coral's API, documented in qr/GEN.md, and
//    an API is allowed to have its own name.
//
// 2. Per-cell SPANS have no sitetile equivalent — checked, not assumed: GridCell carries no size
//    field and site.css has no `grid-column`/`grid-row` for cells anywhere. A 2×2 tile is genuinely
//    Card-only. So it does not get an invented `st-` class, which would claim a canon that does not
//    exist; it becomes `data-span="2x2"` on the cell, matching how sitetile expresses every other
//    variant (`data-cols`, `data-cards`, `data-pack`).
//
// 3. `dc-drawer-*` is the drawer coral's, and corals own their own namespace.

/** class → class. Applied to emitted markup and to the stylesheet's selectors, together. */
export const CLASS_MAP = {
  // ── containers ────────────────────────────────────────────────────────────────────────────────
  'cp-wrap': 'st-wrap',
  'cp-skin-card': 'st-card',
  'cp-square': 'st-card-square',
  'cp-bento': 'st-grid',
  'cp-bento-label': 'st-grid-label',
  'cp-grid-wrap': 'st-cells-wrap',
  'cp-corals-grid': 'st-cells',
  'cp-bleed': 'st-bleed',
  'cp-backdrop': 'st-backdrop',

  // ── the cell, and its two shapes ──────────────────────────────────────────────────────────────
  // 🔴 The image tile and the link tile keep SEPARATE names, and that is the whole lesson of the
  // first attempt: I mapped `lt-body` and `cp-feature-body` both onto `st-cell-body`, and the two
  // unscoped rules merged — 415 differences, a link tile wearing an image tile's padding. Giving two
  // different things one name is not convergence, it is a collision. sitetile draws the same line:
  // `st-gal-*` IS its image-card family, distinct from the plain cell.
  'cp-coral': 'st-cell',
  'sc-coral-feature': 'st-gal-cell',          // sitetile's image-card primitive (Grid/Gallery/Carousel)
  'sc-coral-linktile': 'st-cell-tile',
  'cp-feature--bare': 'st-gal-cell-bare',
  'cp-feature-link': 'st-gal-link',
  'cp-feature-img': 'st-gal-img',
  'cp-feature-scrim': 'st-gal-scrim',
  'cp-feature-body': 'st-gal-body',
  'cp-feature-eyebrow': 'st-gal-eyebrow',
  'cp-feature-title': 'st-gal-title',
  'cp-feature-cta': 'st-gal-cta',
  'cp-feat-arrow': 'st-gal-arrow',

  // ── the link tile ─────────────────────────────────────────────────────────────────────────────
  'lt-link': 'st-cell-link',
  'lt-top': 'st-cell-head',
  'lt-body': 'st-cell-body',
  'lt-label': 'st-cell-title',
  'lt-sub': 'st-cell-sub',
  'lt-icon': 'st-cell-icon',
  'lt-icon-img': 'st-cell-icon-img',
  'lt-arrow': 'st-cell-arrow',

  // ── the profile, which is a Hero with an avatar ────────────────────────────────────────────────
  'cp-profile-tile': 'st-hero',
  'cp-avatar-wrap': 'st-figure',               // sitetile wraps hero media in a figure
  'cp-profile-body': 'st-hero-text',
  'cp-p-name': 'st-hero-name',
  'cp-p-tag': 'st-hero-tagline',
  'cp-p-meta': 'st-hero-meta',
  'cp-chip': 'st-chip',

  // ── prose, media, social ──────────────────────────────────────────────────────────────────────
  'cp-prose': 'st-prose',
  'cp-embed': 'st-embed',
  'cp-slider': 'st-carousel',
  'cp-slide': 'st-carousel-slide',             // the @keyframes name travels with it
  'cp-video': 'st-embed-video',
  'cp-video-btn': 'st-embed-video-btn',
  'cp-video--noposter': 'st-embed-video-noposter',
  'cp-video-poster': 'st-embed-video-poster',
  'cp-video-play': 'st-embed-video-play',
  'cp-video-label': 'st-embed-video-label',
  'cp-social': 'st-social',
  'cp-social-mark': 'st-social-btn',
  'cp-poweredby': 'st-footer-credit',
  'site-footer': 'st-footer',
};

/** The QR coral's mount contract. Renaming any of these means editing code that must not be edited. */
export const CORAL_CONTRACT = ['cp-icon', 'cp-midwater', 'swimmer'];

/** `cp-size-2x2` → `data-span="2x2"`. sitetile expresses variants as data attributes, not classes. */
export const SIZE_CLASS_RE = /cp-size-(\d+x\d+)/g;

/**
 * sitetile reads `--gd-*`; the card's own tokens are `--cp-*` and have to stay, because the QR
 * coral reads them verbatim. So the card DEFINES both — the gd names alias the cp ones, and a
 * stylesheet written for a Site finds the tokens it expects on a Card.
 */
export const TOKEN_ALIASES = `:root{--gd-accent:var(--cp-accent);--gd-accent-ink:var(--cp-ground);`
  + `--gd-bg:var(--cp-ground);--gd-surface:var(--carrier-bg);--gd-text:var(--carrier-text);`
  + `--gd-muted:var(--carrier-text-muted);--gd-border:var(--cp-accent-border);`
  + `--gd-radius:var(--r-md);--gd-gap:var(--s-4)}`;
