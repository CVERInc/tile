/* sitetile — `pack=masonry` client-side layout.
 *
 * Why this exists: CSS can't do real masonry (each column
 * stacking independently by its own accumulated height) without native `grid-template-rows:
 * masonry` (Firefox-only, not broadly supported). Two CSS approximations were tried and both
 * measurably wrong against a real Wix masonry grid:
 *   - `display:grid` with `grid-auto-flow:row` forces every column in a "row" to the SAME
 *     height (row 2 starts only once the TALLEST column in row 1 finishes) — live's columns
 *     end at genuinely different Y per column.
 *   - CSS multi-column (`column-fill:auto`) fills column 1 completely (in DOM order) before
 *     starting column 2 — also not what live does.
 *
 * 🩸 corrected 2026-07-07: until this date, this file ran the "standard Masonry.js technique"
 * instead — after every image inside had loaded (so heights were final), it measured each
 * `.st-cell`'s rendered height in DOM order and absolute-positioned it into whichever column's
 * accumulated height was currently shortest. Plausible, and *wrong*: pulled live's actual script
 * (the source theme runs Salvattore.js v1.0.9) and there is no offsetHeight/
 * scrollHeight/clientHeight/Math.min anywhere in it. Its column assignment is pure DOM-order
 * parity — card index 0,2,4… (0-based) goes to column 1, 1,3,5… goes to column 2, generalizing
 * to column `i % cols` for any column count (its CSS is literally `:nth-child(2n-1)`/
 * `:nth-child(2n)` for N=2). Our greedy-height version agreed with live for the first couple of
 * rows by coincidence and then diverged (by row 3) the moment two cards' real heights differed,
 * because live never measures anything. Replaced with the same zero-measurement index-parity
 * bucketing below: no offsetHeight, no waiting for images, no absolute positioning/top math —
 * cards are placed into `cols` plain normal-flow column boxes (`position:static`), each column
 * keeping its own cards' relative DOM order.
 *
 * Column count breakpoints mirror the theme's own media queries (must match the numbers in
 * `.st-cells[data-pack="masonry"]`'s CSS, since JS re-derives layout rather than reading
 * computed grid-template-columns which no longer exists once this takes over). `cols` is a
 * plain variable used as `i % cols` — nothing below is hardcoded to a 2-column split, so any
 * breakpoint's column count gets the same parity treatment.
 *
 * Import once anywhere in your app:
 *   import '@sitetile/components/sections/grid-masonry.js';
 * Auto-wires every `.st-cells[data-pack="masonry"]` on load, resize (debounced), and Astro view
 * transitions (`astro:page-load`). SSR-safe: a no-op when there's no `document`.
 */

function columnsFor(width) {
  if (width >= 1400) return 3;
  if (width >= 992) return 2;
  return 1;
}

function layout(container) {
  // Original server-rendered order, captured once in `wire()` before any restructuring — never
  // re-read from `container.children`, since after the first run those are column-wrapper divs,
  // not cells. Re-bucketing from this stable list on every call (including on resize, when the
  // breakpoint's column count can change) keeps this idempotent instead of layering stale
  // wrappers/styles from a previous breakpoint on top of new ones.
  const cells = container.__stCells;
  if (!cells || !cells.length) return;
  const width = container.clientWidth;
  // column COUNT follows live's real media queries, which key off the viewport (window),
  // not this container's own (narrower — a fixed 310px sidebar eats into it) width; the
  // container width is still what's used below for the actual per-column pixel math.
  const cols = columnsFor(window.innerWidth);
  const colGap = 62;

  if (cols === 1) {
    // single column at narrow widths — plain flow, no wrapper divs, no inline layout styles.
    for (const cell of cells) cell.style.width = '';
    container.style.display = '';
    container.style.flexDirection = '';
    container.style.alignItems = '';
    container.style.gap = '';
    container.replaceChildren(...cells);
    return;
  }

  // Index-parity bucketing: cell i (0-based, original DOM order) goes to column `i % cols`,
  // matching live's Salvattore.js `:nth-child` assignment exactly. Each column keeps its cards
  // in their original relative order; no height measurement of any kind.
  const colWidth = (width - colGap * (cols - 1)) / cols;
  const wraps = Array.from({ length: cols }, () => {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.width = colWidth + 'px';
    return wrap;
  });
  cells.forEach((cell, i) => {
    cell.style.width = colWidth + 'px';
    wraps[i % cols].appendChild(cell);
  });
  container.style.display = 'flex';
  container.style.flexDirection = 'row';
  container.style.alignItems = 'flex-start';   // columns end at different heights — don't stretch them to match
  container.style.gap = colGap + 'px';
  container.replaceChildren(...wraps);
}

function wire(container) {
  if (container.__masonryWired) return;
  container.__masonryWired = true;
  container.__stCells = [...container.children];
  const run = () => layout(container);
  // No image-load wait needed anymore — index-parity placement doesn't measure anything, so it's
  // correct the instant the DOM exists (also removes the old FOUC while waiting for images).
  run();
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(run, 150);
  });
}

export function init() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.st-cells[data-pack="masonry"]').forEach(wire);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('astro:page-load', init);
}
