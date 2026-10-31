// `carousel` — single-row sibling of gallery. Same image-first cards (cast / archive / portfolio),
// laid in a horizontal scroll track with prev/next arrows (slidesToShow via `cols=`). Mirrors the
// reference renderSection 'carousel' case.
//
// 🔴 The runtime (arrows, overflow state, `start=`, adaptive height) is a dynamic coral
// (packages/dynamic-corals/carousel). This function writes only its mount point —
// `data-dynamic-coral="carousel"` on the section — and the host loads the coral script
// (sitetile: Carousel.astro's <script> import, emitted once per page).
//
// Markdown is the CALLER's dialect (tile-lab#52 ruling 2026-10-31): `ctx.inline` / `ctx.block`.
import { firstImage, imgTag, safeHref } from '../sitetile/site-core.js';
import { attr, text, when } from './html.mjs';
import { cellFrame } from './cell.mjs';

// The nav glyph: a signet arrow at 18px, written inline (not signetArrow — this is the spelling the
// carousel has always shipped, without the component's inter-node spaces).
function navArrow(left) {
  const dir = left ? ' signet-arrow--left' : '';
  return `<span class="signet-arrow${dir}" style="width:18px;height:18px;--signet-arrow-w:18px" aria-hidden="true"><span class="signet-arrow__tail"></span><svg class="signet-arrow__head" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 6 16 12 10 18"/></svg></span>`;
}

/**
 * @param {{ eyebrow?: unknown, cols?: unknown, more: { label: string, href: string } | null, start?: unknown,
 *           isBlogFull: boolean, cells: Array<{ title: string, href?: string, badge?: string, cta?: string,
 *           date?: string, body: string }> }} params
 *   `cells` is the section's own `### ` cells, or (sitetile `posts=N`) cells the host built from its blog.
 * @param {{ inline: (md: string) => string, block: (md: string, opts?: object) => string }} ctx
 */
export function emitCarousel(section, params, ctx) {
  if (params.cell) return carouselCell(params, ctx);
  const { eyebrow, cols, more, start, isBlogFull, cells } = params;
  // `more.href` / `c.href` are author-set; site-core.js's own `carousel` case gates both on
  // `isSafeHref`, and `safeHref` shares that ONE policy. The "view all" link is read first.
  const moreHrefOk = more ? safeHref(more.href) : null;
  const cellClass = 'st-car-cell st-gal-cell' + (isBlogFull ? ' st-car-cell-blogfull' : '');
  return '<section class="st-carousel"' + attr('id', section.id) + attr('data-cols', cols || '') + ' data-dynamic-coral="carousel"> '
    + when(section.title || more || eyebrow, () => '<div class="st-car-head"> '
      + when(eyebrow, () => '<p class="st-carousel-eyebrow">' + ctx.inline(eyebrow) + '</p>') + ' '
      + when(section.title, () => '<h2>' + ctx.inline(section.title) + '</h2>') + ' '
      + when(more, () => (moreHrefOk
        ? '<a class="st-car-more"' + attr('href', moreHrefOk) + '>' + ctx.inline(more.label) + '</a>'
        : '<span class="st-car-more">' + ctx.inline(more.label) + '</span>'))
      + ' </div>') + ' '
    + when(section.body, () => ctx.block(section.body)) + ' '
    + '<div class="st-car-viewport"> <button class="st-car-nav st-car-prev" type="button" aria-label="Previous"><span class="st-sr-only">Previous</span>' + navArrow(true) + '</button> '
    + '<div class="st-car-track"' + attr('data-start', start || '') + '> '
    + cells.map((c) => {
      const fi = firstImage(c.body);
      const hrefOk = c.href ? safeHref(c.href) : null;
      // Built in the component's order: figure, badge, cta, then the rest as the cell renders.
      const fig = fi.img ? `<figure class="st-gal-fig">${imgTag(fi.img.alt, fi.img.src)}</figure>` : '';
      const badge = c.badge ? '<span class="st-cell-badge"' + attr('data-badge', String(c.badge).toLowerCase()) + '>' + ctx.inline(c.badge) + '</span>' : '';
      const cta = c.cta ? '<span class="st-cell-cta st-cell-cta-labeled"><span class="st-cta-label">' + ctx.inline(c.cta) + '</span></span>' : '';
      const inner = badge + fig + ' '
        + when(c.date, () => '<p class="st-car-date">' + text(c.date) + '</p>')
        + '<h3>' + ctx.inline(c.title) + '</h3> '
        + when(isBlogFull, () => '<div class="st-car-byline" aria-hidden="true"></div>')
        + ctx.block(fi.rest, hrefOk ? { inLink: true } : undefined) + ' ' + cta;
      return hrefOk
        ? '<a' + attr('class', `${cellClass} st-cell-link group`) + attr('href', hrefOk) + '>' + inner + '</a>'
        : '<div' + attr('class', cellClass) + '>' + inner + '</div>';
    }).join('')
    + ' </div> <button class="st-car-nav st-car-next" type="button" aria-label="Next"><span class="st-sr-only">Next</span>' + navArrow(false) + '</button> </div> </section>';
}

/**
 * A Card `slides` cell (cell.mjs) — the Card's two carousels, in its own spelling. Until reef#2725 the
 * Card called this cell `embed kind=slider|bubbles`; card-core still reads that old line as `slides`,
 * and `embed` is now pasted HTML (embed.mjs). The class stays `st-embed`: card.css styles it.
 * Values arrive resolved by the Card host (card-render reads the params, resolves `asset:` images,
 * validates the two transform origins); each image is written through the Card's registry
 * (`ctx.url` / `ctx.cssUrl`), in the order the slides are written.
 *
 *   `kind`     'slider' — a horizontal carousel you swipe, prev/next + dots, CSS scroll-snap and
 *              anchor links (no JS); 'bubbles' — the speech-bubble pop, each image scaling out of a
 *              tail origin over a static backdrop, auto-cycling, no controls
 *   `images`   resolved image URLs (none → an empty frame) · `seed` the authored list as written: the
 *              slide ids derive from it, so a card's anchors are stable across renders
 *   `labels`   { prev, next, slide(n) } in the card's language
 *   `origin` / `originNarrow`  bubbles only: validated `transform-origin` values · `bg` bubbles only:
 *              the backdrop URL, or null for none
 */
function carouselCell(params, ctx) {
  const { kind, images: imgs } = params;
  if (!imgs.length) return cellFrame(params.cell, 'st-embed', 'slides', '');
  const n = imgs.length;
  if (kind === 'slider') {
    const e = ctx.esc;
    const { labels } = params;
    const uid = 'sl' + Math.abs([...String(params.seed || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
    const slides = imgs.map((src, i) => {
      const prev = `#${uid}-${(i - 1 + n) % n}`;
      const next = `#${uid}-${(i + 1) % n}`;
      return `<figure id="${uid}-${i}"><img src="${ctx.url(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        + `<a class="st-slide-nav st-slide-prev" href="${prev}" aria-label="${e(labels.prev)}">‹</a>`
        + `<a class="st-slide-nav st-slide-next" href="${next}" aria-label="${e(labels.next)}">›</a></figure>`;
    }).join('');
    const dots = imgs.map((_, i) => `<a class="st-slide-dot" href="#${uid}-${i}" aria-label="${e(labels.slide(i + 1))}"></a>`).join('');
    const css = [
      // 🔴 NO fixed aspect. chodaict read Incrediville's live page as `6x6(slide*5)` AND
      // `3x6(slide*4)` — the same widget, two different heights, because the PICTURES differ. Pinning
      // 2/1 here would be 「width decides shape」 all over again, four hours after I removed exactly
      // that rule from features. The first slide's natural height sets the track; the rest are
      // covered into it, so a set of squares is square and a set of banners is a banner.
      `.st-slider{position:relative;width:100%;overflow:hidden;border-radius:inherit}`,
      `.st-slider-track{display:flex;width:100%;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none}`,
      `.st-slider-track::-webkit-scrollbar{display:none}`,
      `.st-slider figure{position:relative;flex:0 0 100%;margin:0;scroll-snap-align:center}`,
      `.st-slider figure:first-child img{height:auto}`,
      `.st-slider figure img{width:100%;height:100%;object-fit:cover;display:block}`,
      `.st-slide-nav{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;text-decoration:none;color:#fff;background:rgba(0,0,0,.42);backdrop-filter:blur(2px);opacity:.85;transition:opacity .2s,background .2s}`,
      `.st-slide-nav:hover{opacity:1;background:rgba(0,0,0,.6)}`,
      `.st-slide-prev{left:10px}.st-slide-next{right:10px}`,
      `.st-slider-dots{position:absolute;left:0;right:0;bottom:9px;display:flex;gap:6px;justify-content:center}`,
      `.st-slide-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.55);box-shadow:0 0 0 1px rgba(0,0,0,.18)}`,
      // one image needs no controls, and controls on a single slide read as broken
      n < 2 ? `.st-slide-nav,.st-slider-dots{display:none}` : '',
    ].join('');
    return cellFrame(params.cell, 'st-embed', 'slides', `<style>${css}</style>`
      + `<div class="st-slider"><div class="st-slider-track">${slides}</div>`
      + (n > 1 ? `<div class="st-slider-dots">${dots}</div>` : '') + '</div>');
  }
  const hold = 5;                                   // seconds each bubble is on screen (ancestor's)
  const cycle = n * hold;
  const { origin, originNarrow, bg } = params;
  // the ancestor's stops for n=3 were 0%,33.3%,100% hidden / 3%,30% visible — i.e. hidden outside
  // this figure's slot, popped in 3% after the slot opens until 3% before it closes.
  const slot = 100 / n;
  const inAt = 3;
  const outAt = (slot - 3).toFixed(1);
  const figures = imgs.map((src) => `<figure><img src="${ctx.url(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></figure>`).join('');
  const bgStyle = bg != null ? ` style="background-image:url('${ctx.cssUrl(bg)}')"` : '';
  const css = [
    `.st-carousel{position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background-size:contain;background-position:center;background-repeat:no-repeat}`,
    `.st-carousel figure{position:absolute;inset:0;margin:0;padding:0;display:flex;align-items:center;justify-content:center;opacity:0;transform-origin:${origin};animation:st-carousel-slide ${cycle}s infinite;animation-fill-mode:both}`,
    `.st-carousel figure img{max-width:100%;max-height:100%;object-fit:contain;display:block;margin:0}`,
    imgs.map((_, i) => `.st-carousel figure:nth-child(${i + 1}){animation-delay:${i * hold}s}`).join(''),
    // 🔴 verbatim: scale(0.001) → scale(1) about the tail origin = "pops out of the mouth"
    `@keyframes st-carousel-slide{0%,${slot.toFixed(1)}%,100%{opacity:0;transform:scale(0.001)}${inAt}%,${outAt}%{opacity:1;transform:scale(1)}}`,
    `@media screen and (max-width:888px){.st-carousel figure{transform-origin:${originNarrow}}}`,
    `@media(prefers-reduced-motion:reduce){.st-carousel figure{animation:none}.st-carousel figure:nth-child(1){opacity:1;transform:scale(1)}}`,
  ].join('');
  return cellFrame(params.cell, 'st-embed', 'slides', `<style>${css}</style><div class="st-carousel"${bgStyle}>${figures}</div>`);
}
