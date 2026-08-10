// grid-filter.js — client-side facet filter for a `%% grid … filter=<label> %%` section.
// Progressive enhancement: the server renders every card + a filter bar; this script makes the
// bar's pills toggle card visibility by `data-cat` (the card's badge). No JS → all cards show.
// Scoped per-section so multiple filtered grids on one page don't cross-talk. Zero deps.
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
document.querySelectorAll('.st-grid-filter').forEach(wire);
