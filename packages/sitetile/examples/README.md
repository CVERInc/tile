# examples/

Worked examples of the things a **site** owns, kept deliberately outside the renderer.

Nothing in here is built, globbed, or shipped. That is the point: `src/themes/` is empty in git and
stays empty, because a site's look belongs to that site's own repo and is staged into the build from
there. An example theme that lived in `src/themes/` would quietly become a theme the renderer ships —
the one thing the portable-IR doctrine says must never happen.

## `lilac/theme.css`

A complete light theme: white and lavender, Poppins, round-pill buttons, white cards on a pale
lavender band. It is here to make one claim checkable — that the section renderers (hero, grid,
social, cta) wear a completely different identity from **tokens and treatments alone**, with no
renderer change and no renderer knowledge of the theme.

To use it as a starting point:

1. Copy `lilac/theme.css` into your site repo as `theme.css`.
2. Name it in the site's `ir/_site.md` frontmatter: `theme: <name>`.
3. Build — the deploy step stages your `theme.css` as `src/themes/<name>.css`, `SiteLayout.astro`
   inlines it, and removes it again on exit.

Two things worth reading in the file itself: every selector is `html`-prefixed so it beats
`site.css` regardless of source order, and the webfont is requested by the page's `fonts:`
frontmatter rather than by an `@import` here — a theme that fetches its own fonts is a theme that
can't travel offline.

A theme this size is not the only option, or even the preferred one. Most of what `lilac` spells out
by hand — boxed translucent header, pill buttons, a full-bleed accent band, flat cards, no chevrons,
a columned footer, an announce strip — now exists as **structured treatment axes** in the base
`site.css`, so an identity of this class can be declared in a structured `_theme` with no CSS at all.
Reach for a hand-written `theme.css` when you want something the axes don't reach.
