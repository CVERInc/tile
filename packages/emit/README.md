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
- **`ctx`** — render context: `{ hero }` (this is the page's first section → its title is `<h1>`),
  plus, from phase 2 on, the caller's markdown renderers (below) and whatever a section needs that
  only a host knows (Form's `index`).

**Markdown is injected, markup is shared** (tile-lab#52 engineering ruling, 2026-10-31). A phase-2
emitter never imports a markdown renderer: it calls `ctx.inline(md)` and `ctx.block(md, opts)`, and
Grid also `ctx.cellBlock(md, opts)` (falls back to `ctx.block`). sitetile passes its own
`inlineHtml` / `bodyHtml` / `gridCellBodyHtml`; a Card host passes `card-render.mjs`'s `mdInline` /
`mdBlock`. Each side keeps its own live output, so "golden diff zero" holds on both, and whether
the two dialects should become one (question ②) stays a separate decision. The phase-1 nine still
import sitetile's renderers directly; moving them onto `ctx` is mechanical and changes no bytes.

**Behaviour is a dynamic coral, not a script.** A section that needs client JS (grid `pack=masonry`
and `filter=`, hero `parallax`, the carousel) gets it from `packages/dynamic-corals/<name>/`; the
emitter writes only the coral's mount point, `data-dynamic-coral="<name>"`, and the host loads the
coral (sitetile: the component's `<script>import …-client.mjs</script>`, which Astro bundles into the
page; a Worker: the built `<name>.js`). `mounts.test.mjs` pins each mount, its client's selector and
the component's import. The one exception is Form's inbox script: site-core's `INBOX_FORM_SCRIPT`,
already a single shared string, which finds its form through `document.currentScript` and so is
emitted inside the section, as before.

## Byte-identical to the template it replaced

Every emitter is the compiled Astro template it came from, written out by hand: the same static
text, the same single spaces `compressHTML` left between nodes, and the four primitives in
`html.mjs` (`text`, `attr`, `boolAttr`, `when`) for the four things Astro does to a value.
`html.test.mjs` pins those primitives against Astro's own runtime functions.

## Sections

Phase 1 (no Astro-specific features): `embed`, `social`, `tagcloud`, `prose`, `faq`, `links`,
`timeline`, `gallery`, `people`.

Phase 2: `grid` (with its cell, formerly `GridCell.astro`), `collection`, `hero`, `carousel`,
`form`. `arrow.mjs` is the string form of `@cvernet/signet/Arrow.astro`, byte-for-byte; the page
still imports `@cvernet/signet/arrow.css` for its hover morph. Form's build-time inputs (its own
path, the locale home, the `thanks=` manifest id) arrive as params from the component, which is
where `Astro.url`, `import.meta.glob` and `recordThanks()` stay.

## The Card host (phase 3)

`packages/cardtile/card-render.mjs` renders its cells through these same emitters. A Card cell is
the section's markup in a Card frame (`cell.mjs`): the emitter is called with `params.cell`
(`{ attrs }` — the bento pack's `data-span` / `data-w` / `data-cell`, Card-only) and writes
`<div class="st-cell <root class>" … data-coral-type="<type>">` instead of its `<section>`, in the
Card's compact spelling. Where a Card cell's markup differs from the Site section's, the difference
is a parameter of the emitter; neither side's output changed (tile-lab#52 phase 3: every live Card
fixture, `/try` example and lab card renders byte-identical, destination registry included).

The Card injects its whole dialect through `ctx`, not only markdown: `ctx.inline` / `ctx.block`
(`mdInline` / `mdBlock`), `ctx.esc` (cssmd `escHtml` + `"`) and `ctx.url` / `ctx.cssUrl` (an author
URL, registered with the Card's destination registry where it is written, then escaped). Params
are still read by the host — `p.<name>` stays in card-render's `switch (cell.type)`, which is what
`ai-ops.test.mjs` scans, the same contract as the `.astro` wrappers' `pm.<name>`.

| Card cell | emitter |
|---|---|
| `text` | `emitProse` |
