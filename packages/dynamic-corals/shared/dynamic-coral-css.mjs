// Shared by every BUNDLED dynamic coral that ships its own package CSS: the document-root
// attribute a site's declaration stamps, and the one `@layer reef.corals { … }` wrap every such
// coral applies the same way.
//
// 🔴 NOT a dependency on sitetile. `packages/sitetile/astro/src/lib/dynamic-coral-css.mjs` is the
// renderer/emitter-side definition of the same attribute and token — a coral mounts on ANY host
// page, sitetile or not (see events-client.mjs's own "framework-agnostic" note), so this module
// duplicates the two literals here rather than reaching across the family boundary into a
// renderer-only package. The two `bundle:false` corals (square-shop.js, inbox-bubble.js) cannot
// even import this one — they are shipped as their own single-file registry artifact — so they
// hardcode the same two literals locally; see the matching comment beside each.
//
// Absent attribute means legacy, and legacy must stay byte-for-byte what it always was: a site
// that never declares is never rebuilt into this, and a fleet-wide channel repoint still has to
// hand it today's CSS. That is why `withDynamicCoralCssLayer` returns its input completely
// unchanged — not even re-wrapped in a no-op layer — for every value other than the one declared
// token.

/** The document-root attribute a layered site's renderer stamps (see the sitetile definition). */
export const DYNAMIC_CORAL_CSS_ATTR = 'data-dynamic-coral-css';

/** The one value that means "layered". Anything else, including absence, is legacy. */
export const DYNAMIC_CORAL_CSS_LAYERED = 'layered';

/**
 * Wrap `css` in `@layer reef.corals { … }` when the document root carries the layered declaration;
 * return it byte-for-byte unchanged otherwise. `doc` defaults to the page's own `document` — the
 * same "reads its own document unless a test hands it one" shape every coral here already uses
 * (see sponsor-core.mjs's `mountSponsor(el, deps)`); a `doc` with no `documentElement` (a minimal
 * test double) resolves to legacy rather than throwing.
 */
export function withDynamicCoralCssLayer(css, doc) {
  const document_ = doc || (typeof document !== 'undefined' ? document : null);
  const root = document_ ? document_.documentElement : null;
  const layered = !!root && typeof root.getAttribute === 'function' &&
    root.getAttribute(DYNAMIC_CORAL_CSS_ATTR) === DYNAMIC_CORAL_CSS_LAYERED;
  return layered ? `@layer reef.corals {\n${css}\n}` : css;
}
