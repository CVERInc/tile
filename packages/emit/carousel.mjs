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
