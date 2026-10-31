// REEF hero parallax — the hero-parallax dynamic coral, CLIENT source (built into hero-parallax.js
// by dynamic-corals/build.mjs; sitetile's Hero.astro imports this file and Astro bundles it).
//
// Subtle multi-layer depth on pointer-move + scroll. Opt-in: the renderer (packages/emit/hero.mjs)
// writes the mount `data-dynamic-coral="hero-parallax"` only on a layered hero with `parallax`;
// no-op otherwise and under reduced-motion. Back layers drift less than front.
// Motion is DAMPED (each frame eases current → target) so pointer-leave glides back to centre
// instead of snapping — no flicker when the cursor exits the art.
//
// Was Hero.astro's hoisted <script> until tile-lab#52 phase 2, which moved it here unchanged except
// for the selector: it used to find `.st-hero-layered[data-parallax]`, and now finds the mount.
const heroes = Array.from(document.querySelectorAll('[data-dynamic-coral="hero-parallax"]'));
if (heroes.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const hero of heroes) {
    const layers = Array.from(hero.querySelectorAll('.st-hero-layer'));
    const maxDepth = Math.max(1, layers.length - 1);
    let tmx = 0, tmy = 0, tsy = 0;   // targets (pointer x/y, scroll)
    let mx = 0, my = 0, sy = 0;      // eased current
    let running = false;
    const render = () => {
      mx += (tmx - mx) * 0.09; my += (tmy - my) * 0.09; sy += (tsy - sy) * 0.14;
      for (const el of layers) {
        const d = (Number(el.dataset.depth) || 0) / maxDepth;   // 0 back → 1 front
        const tx = mx * (9 + d * 30);
        const ty = my * (9 + d * 30) + sy * (22 + d * 54);       // pointer + scroll drift
        el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(1.06)`;
      }
      if (Math.abs(tmx - mx) > 1e-3 || Math.abs(tmy - my) > 1e-3 || Math.abs(tsy - sy) > 1e-3) {
        requestAnimationFrame(render);
      } else { running = false; }
    };
    const kick = () => { if (!running) { running = true; requestAnimationFrame(render); } };
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      tmx = ((e.clientX - r.left) / (r.width || 1) - 0.5) * 2;
      tmy = ((e.clientY - r.top) / (r.height || 1) - 0.5) * 2;
      kick();
    });
    hero.addEventListener('pointerleave', () => { tmx = 0; tmy = 0; kick(); });   // glide home
    window.addEventListener('scroll', () => {
      const r = hero.getBoundingClientRect();
      tsy = Math.max(-1, Math.min(1, -r.top / (r.height || 1)));
      kick();
    }, { passive: true });
    render();
  }
}
