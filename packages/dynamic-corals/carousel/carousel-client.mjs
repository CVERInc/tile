// Vanilla carousel runtime — the carousel dynamic coral, CLIENT source (built into carousel.js by
// dynamic-corals/build.mjs; sitetile's Carousel.astro imports this file and Astro bundles it).
//
// Wires every carousel mount on the page — `data-dynamic-coral="carousel"`, which the renderer
// (packages/emit/carousel.mjs) writes on each `.st-carousel` section. Arrows scroll the track by
// ~one viewport; nav buttons hide when the track isn't overflowing or an end is reached.
//
// Was Carousel.astro's hoisted <script> until tile-lab#52 phase 2, which moved it here unchanged
// except for the selector: it used to find `.st-carousel`, and now finds the mount.
function initCarousels() {
  document.querySelectorAll('[data-dynamic-coral="carousel"]').forEach((root) => {
    if (root.dataset.carInit) return;
    root.dataset.carInit = '1';
    const track = root.querySelector('.st-car-track');
    const prev = root.querySelector('.st-car-prev');
    const next = root.querySelector('.st-car-next');
    if (!track || !prev || !next) return;
    // Scroll by ~one viewport, but SNAPPED to a whole number of cells. An unaligned step
    // (0.85 * clientWidth ≈ 3.6 cells) lands short of a cell edge, so the last visual page sits a
    // few px shy of the scroll end with Next still enabled — one more click then nudges only that
    // remainder (a "micro-jump"). Rounding the step to whole cell-strides makes a click land on a
    // cell edge, so the final click reaches the end exactly and Next disables with nothing left over.
    const step = () => {
      const raw = Math.max(track.clientWidth * 0.85, 200);
      const cell = track.querySelector('.st-car-cell');
      if (!cell) return raw;
      const cs = getComputedStyle(track);
      const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0;
      const stride = cell.getBoundingClientRect().width + gap;
      return stride > 0 ? Math.max(1, Math.round(raw / stride)) * stride : raw;
    };
    // OPT-IN `start=N`: jump the track to rest on card N (0-based) instead of card 0. Used to
    // match a source site's carousel that settles on a non-zero slide by default.
    const startIdx = parseInt(track.dataset.start || '', 10);
    if (Number.isFinite(startIdx) && startIdx > 0) {
      const firstCell = track.querySelector('.st-car-cell');
      if (firstCell) {
        const cellRect = firstCell.getBoundingClientRect();
        const cs = getComputedStyle(track);
        const gap = parseFloat(cs.columnGap || cs.gap || '0') || 0;
        track.scrollLeft = startIdx * (cellRect.width + gap);
      }
    }
    // Adaptive height — GENERAL `carousel` coral behavior (always on, no opt-in param): the
    // track's height should equal the max natural height of only the cells currently visible
    // within the viewport's horizontal bounds, not the tallest cell across the ENTIRE track.
    // Mirrors slick-carousel's live behavior (it only lays out the visible N cards per `cols=`
    // at a time, so its row height never sees off-screen tall cells). Our CSS previously laid
    // every cell in one flex row with align-items:stretch-equivalent sizing, so the row was
    // sized to the tallest cell anywhere in the track, even off-screen ones — a genuine
    // structural gap (diagnosed on a live home carousel, ~70-120px residual drift).
    // Safe for uniform-height carousels: when every cell is the
    // same height, max(visible) === max(all), so this is a no-op there.
    const cells = () => Array.from(track.querySelectorAll('.st-car-cell'));
    const adaptHeight = () => {
      const vpRect = root.querySelector('.st-car-viewport').getBoundingClientRect();
      let maxH = 0;
      cells().forEach((cell) => {
        const r = cell.getBoundingClientRect();
        // Horizontal intersection with the viewport's own visible bounds (accounts for
        // scrollLeft implicitly, since getBoundingClientRect is viewport-relative already).
        const visible = r.right > vpRect.left + 0.5 && r.left < vpRect.right - 0.5;
        // getBoundingClientRect().height (fractional) not offsetHeight (integer-floored) — the
        // floor can leave the row a px short; combined with the ceil below, the box never
        // under-sizes a visible card.
        if (visible) maxH = Math.max(maxH, r.height);
      });
      // maxH is the cells' CONTENT height; the track is border-box with vertical padding, so
      // setting height=maxH would leave the content area short by that padding → the cells then
      // overflow the row by ~padding px, giving a tiny internal vertical scroll (no scrollbar,
      // but the row nudges — caught in a real-Safari pass 2026-07-14). Add the padding back so the
      // content area equals maxH exactly.
      if (maxH > 0) {
        const cs = getComputedStyle(track);
        const padY = cs.boxSizing === 'border-box'
          ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 0;
        track.style.height = Math.ceil(maxH + (padY || 0)) + 'px';
      }
    };
    const update = () => {
      const max = track.scrollWidth - track.clientWidth - 1;
      const overflow = max > 0;
      root.classList.toggle('st-car-has-overflow', overflow);
      prev.disabled = !overflow || track.scrollLeft <= 1;
      next.disabled = !overflow || track.scrollLeft >= max;
      adaptHeight();
    };
    prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }));
    next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }));
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    // Re-run after late settling — a cell that grows a few px when its webfont or image finishes
    // (after the initial update) would otherwise leave the row a touch short, clipping the card
    // bottom by those px. `load` and `fonts.ready` are the definitive "everything settled" signals.
    window.addEventListener('load', update);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(update);
    // Re-run height adaptation whenever a cell's rendered size changes AFTER init — most
    // importantly when late-loading images finish loading. Cards with no reserved aspect box
    // (height:auto images, e.g. a row of comic covers) measure text-only at init, so the
    // one-shot update() above pins the track to a too-short height and the tall images then
    // overflow the row (spilling over the footer, a ~340px doc-height deficit). Observing the
    // cells (rAF-debounced) re-sizes the row to the real card height once images/fonts settle.
    // No-op for uniform fixed-aspect carousels: the height is already correct
    // at init and re-measuring yields the same value.
    if (window.ResizeObserver) {
      let raf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(adaptHeight);
      });
      cells().forEach((cell) => ro.observe(cell));
    } else {
      track.querySelectorAll('img').forEach((img) => {
        if (!img.complete) img.addEventListener('load', adaptHeight, { once: true });
      });
    }
  });
}
if (document.readyState !== 'loading') initCarousels();
else document.addEventListener('DOMContentLoaded', initCarousels);
