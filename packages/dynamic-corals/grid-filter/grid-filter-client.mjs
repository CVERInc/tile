// grid-filter — the grid-filter dynamic coral, CLIENT source (built into grid-filter.js by
// dynamic-corals/build.mjs; sitetile's Grid.astro imports this file and Astro bundles it).
//
// Client-side facet filter for a `%% grid … filter=<label> %%` section.
// Progressive enhancement: the server renders every card + a filter bar; this script makes the
// bar's pills toggle card visibility by `data-cat` (the card's badge). No JS → all cards show.
// Scoped per-section so multiple filtered grids on one page don't cross-talk. Zero deps.
//
// Mount: the bar itself, `data-dynamic-coral="grid-filter"` (packages/emit/grid.mjs writes it).
// Was packages/sitetile/astro/src/components/sections/grid-filter.js until tile-lab#52 phase 2,
// which moved it here unchanged except for that selector (it used to find `.st-grid-filter`).
//
// Composes with `pack=masonry` (the grid-masonry coral): THIS decides which cells are visible,
// masonry lays out the visible ones. After every pill press the section's `.st-cells` receives a
// `dc-grid-filter-change` event, which masonry answers by re-bucketing the cells still shown —
// so a filtered result fills the columns from the top instead of keeping the holes where the
// hidden cards were. Without masonry the event has no listener and changes nothing.
// 🩸 Until 2026-10-31 the cells were found as `.st-cells > …` — direct children only. At ≥992 px
// masonry has already moved them into column wrappers when this runs (Astro bundles it first), so
// that found NO cells and every pill did nothing. Cells are found wherever they sit now, once, at
// wire time: masonry moves elements, it never replaces them, so the list stays the live cells.
function wire(bar) {
  const section = bar.closest('.st-grid');
  if (!section) return;
  const container = section.querySelector('.st-cells');
  const cells = Array.from(section.querySelectorAll('.st-cells .st-cell'));
  const pills = Array.from(bar.querySelectorAll('.st-filter-pill'));
  bar.addEventListener('click', (e) => {
    const pill = e.target.closest('.st-filter-pill');
    if (!pill) return;
    const cat = pill.getAttribute('data-cat') || '';
    pills.forEach((p) => {
      const on = p === pill;
      p.classList.toggle('is-active', on);
      p.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    cells.forEach((c) => {
      const show = !cat || c.getAttribute('data-cat') === cat;
      c.hidden = !show;                    // [hidden] — semantic, survives CSS reset
      c.style.display = show ? '' : 'none';
    });
    if (container) container.dispatchEvent(new CustomEvent('dc-grid-filter-change', { detail: { cat } }));
  });
}
document.querySelectorAll('[data-dynamic-coral="grid-filter"]').forEach(wire);
