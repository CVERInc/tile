// Transparent header over a full-bleed immersive hero (juiart pattern): the header overlays the
// hero with no background, then fades in its solid background once the hero is scrolled past.
// OPT-IN + self-gating: only activates when the page leads with a full-bleed immersive hero — the
// entrance hero (`.st-hero[data-enter]`) OR the layered parallax hero (`.st-hero-layered`). On every
// other page/site it no-ops, so the normal solid header stands.
(function () {
  const header = document.querySelector('.rf-header');
  const hero = document.querySelector('.st-hero[data-enter], .st-hero-layered');
  if (!header || !hero) return;

  header.classList.add('rf-header--overlay');

  // The hero's own CONTENT block (logo / heading / lead) — the thing whose ink can collide with
  // the header's. Layered hero wraps it in .st-hero-overlay; the flat entrance hero's h1 stands in.
  const content = hero.querySelector('.st-hero-overlay') || hero.querySelector('h1') || hero;

  let ticking = false;
  const apply = () => {
    ticking = false;
    // Solid once the hero is (nearly) scrolled past — OR the moment the hero's own content block
    // reaches the header band. The old past-the-hero-only trigger left the header transparent for
    // the ENTIRE scroll through the hero, so the cover's big white logo slid under white nav links
    // mid-scroll: looks exactly like a z-index failure, measures as correct stacking (z=20, nav on
    // top) — it's ink-on-ink, not paint order. Same on short viewports at rest, where the
    // bottom-anchored logo already starts inside the header band. 2026-07-17, reported by the
    // maintainer from a wide-short window.
    const past = window.scrollY > Math.max(0, hero.offsetHeight - header.offsetHeight - 8);
    const colliding = content.getBoundingClientRect().top < header.offsetHeight + 8;
    header.classList.toggle('is-solid', past || colliding);
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  };
  apply();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', apply, { passive: true });
})();
