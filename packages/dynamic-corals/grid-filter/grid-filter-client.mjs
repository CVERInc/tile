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
function wire(bar) {
  const section = bar.closest('.st-grid');
  if (!section) return;
  const cells = Array.from(section.querySelectorAll('.st-cells > [data-cat], .st-cells > .st-cell'));
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
  });
}
document.querySelectorAll('[data-dynamic-coral="grid-filter"]').forEach(wire);
