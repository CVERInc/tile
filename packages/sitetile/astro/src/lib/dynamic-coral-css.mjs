// Where a site's DYNAMIC-CORAL package CSS sits in the cascade.
//
// A dynamic coral ships its own stylesheet — the first-paint styles the generated Worker injects
// for a provider storefront, the styles its runtime pages emit, and the published coral asset.
// Historically all of it was emitted UNLAYERED, so it outranked every layer including the site's
// own `reef.theme`, and a theme could only reach coral markup through the `--gd-*` tokens that CSS
// reads. Sites were themed against that, so it stays the default.
//
// A site OPTS IN by declaring `dynamic-coral-css: layered` in its base `content/_site.md`. Then
// every one of those stylesheets is emitted inside `@layer reef.corals` — a layer of its own,
// ordered between `reef.base` and `reef.theme` — and the site's own selectors override coral
// markup through the ordinary cascade while the renderer's base rules keep the relationship to
// coral markup they already have.
//
// 🔴 The declaration is SITE-level and whole. A site is wholly legacy or wholly layered: the
// renderer and the generated Worker read the same base `_site.md` value, so the document-root
// attribute and the Worker's baked config can never disagree. That is why the value is resolved
// here rather than from the locale-merged or page-merged meta a layout happens to hold — a
// half-layered site would have coral CSS winning on one page and losing on the next.
//
// Deliberately free of `import.meta.glob` and of any Astro import, so `node --test` can reach it
// and so the layout, the site-config loader and the tests all read one definition.

/** The site-config key, authored through the existing site-config seam (`_site.md`). */
export const DYNAMIC_CORAL_CSS_KEY = 'dynamic-coral-css';

/** The one accepted value. Absent key = the legacy unlayered default; there is no `legacy` token
 *  to write, because a site that never declares must not have to be rewritten to keep working. */
export const DYNAMIC_CORAL_CSS_LAYERED = 'layered';

/** The document-root attribute the layout stamps, and the single source a registry-served widget
 *  reads (`document.documentElement`). Absent attribute means legacy — a site that is never
 *  rebuilt still gets today's CSS when the fleet-wide channel repoint hands it a new widget. */
export const DYNAMIC_CORAL_CSS_ATTR = 'data-dynamic-coral-css';

/** Resolve one declaration value: '' for absent, the token for a valid declaration, and a THROW
 *  for anything else. Failing the build closed is the point — a typo'd value that silently picked
 *  a mode would ship a site whose coral CSS lands in the layer its owner did not ask for, with the
 *  build green. Same shape as the storefront declaration, which is fatal rather than defaulted. */
export function dynamicCoralCssMode(value, where) {
  if (value == null) return '';
  const v = String(value).trim();
  if (v === '') return '';
  if (v === DYNAMIC_CORAL_CSS_LAYERED) return DYNAMIC_CORAL_CSS_LAYERED;
  throw new Error(
    `${DYNAMIC_CORAL_CSS_KEY}: invalid value ${JSON.stringify(v)}` + (where ? ` in ${where}` : '') +
    `. The only accepted value is ${JSON.stringify(DYNAMIC_CORAL_CSS_LAYERED)}; remove the key for the legacy unlayered default.`
  );
}
