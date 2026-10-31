// The Card cell frame (tile-lab#52 phase 3). A Card host (packages/cardtile/card-render.mjs) lays
// sections out as bento cells, and a cell is the section's own markup in a Card frame:
// `<div class="st-cell <the section's root class>" <layout attrs> data-coral-type="<type>">`.
// The layout attributes (`data-span` / `data-w` / `data-cell`) are the bento pack's, Card-only, so
// they arrive ready-made as `params.cell.attrs`.
//
// An emitter called with `params.cell` writes that frame instead of its `<section>`, in the Card's
// compact spelling (no inter-node spaces — there is no compressHTML on the Worker side), and with the
// Card's injected dialect instead of sitetile's:
//   ctx.inline(md) / ctx.block(md)   the Card's markdown (card-render's mdInline / mdBlock)
//   ctx.esc(value)                   the Card's escaping (cssmd escHtml + `"`), for text and attributes
//   ctx.url(raw) / ctx.cssUrl(raw)   an author URL, registered with the Card's destination registry
//                                    at the point it is written, then escaped (reef#2054 / tile#127)
// 🔴 Every URL-bearing attribute in a Card branch goes through ctx.url / ctx.cssUrl or is a fixed
// string: serve/card-render-sinks.test.mjs scans these files as well as card-render.mjs.
// Card branches are template literals for the same reason — that scanner reads `${…}`.

/** `<div class="st-cell[ cls]" …attrs data-coral-type="type">inner</div>` */
export function cellFrame(cell, cls, type, inner) {
  return `<div class="st-cell${cls ? ' ' + cls : ''}" ${cell.attrs} data-coral-type="${type}">${inner}</div>`;
}
