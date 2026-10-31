# emit — the shared section emitter

One pure function per section: `(section, params, ctx) → HTML string`. No Astro, no DOM, no I/O.
sitetile's section components (`packages/sitetile/astro/src/components/sections/*.astro`) are
thin wrappers that call it through `set:html`; a Worker (cardtile, tile-lab#52's next phase) can
call the same function, so a section's markup exists once.

## The call shape

- **`section`** — the parsed section from `site-core.js`'s `parseSite` (`id`, `title`, `body`,
  `cells`, `faqs`, `entries`, `groups`…).
- **`params`** — the param values, already read by the caller. 🔴 The `.astro` wrapper reads each
  one as `pm.<name>` itself and passes the value in; it never hands `pm` over. That is the
  contract `packages/sitetile/coral-params.test.mjs` guards: reef-mcp derives "which params each
  coral reads" by scanning the `.astro` files for `pm.<name>`, so a read moved in here would make
  that table call a live param inert.
- **`ctx`** — render context: `{ hero }` (this is the page's first section → its title is `<h1>`).

Markdown inside a section goes through sitetile's own `inlineHtml` / `bodyHtml` / `proseBodyHtml`,
exactly as the components called them. Which markdown dialect a shared emitter should speak is
tile-lab#52's question ②, not settled here.

## Byte-identical to the template it replaced

Every emitter is the compiled Astro template it came from, written out by hand: the same static
text, the same single spaces `compressHTML` left between nodes, and the four primitives in
`html.mjs` (`text`, `attr`, `boolAttr`, `when`) for the four things Astro does to a value.
`html.test.mjs` pins those primitives against Astro's own runtime functions.

## Sections

Phase 1 (no Astro-specific features): `embed`, `social`, `tagcloud`, `prose`, `faq`, `links`,
`timeline`, `gallery`, `people`. Carousel, Collection, Form, Grid/GridCell and Hero still render
in Astro.
