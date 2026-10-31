// `gallery` — image-first cards (cast / archive / portfolio / shop). Each cell's leading body image
// floats to a top <figure>; title + caption below. A cell with an href is a whole-card link. Mirrors
// the reference renderSection 'gallery' case. Theme paints `.st-gallery` / `.st-gal-cell` / `.st-gal-fig`.
import { inlineHtml, bodyHtml, firstImage, imgTag, safeHref } from '../sitetile/site-core.js';
import { attr, when } from './html.mjs';

/** @param {{ eyebrow?: unknown, cols?: unknown, align?: unknown }} params */
export function emitGallery(section, params) {
  const { eyebrow, cols, align } = params;
  const cells = section.cells || [];
  return '<section class="st-gallery"' + attr('id', section.id) + attr('data-cols', cols || '') + attr('data-align', align) + '> '
    + when(eyebrow, () => '<p class="st-gallery-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<h2>' + inlineHtml(section.title) + '</h2>') + ' '
    + when(section.body, () => bodyHtml(section.body))
    + ' <div class="st-gal-cells"> '
    + cells.map((c) => {
      const fi = firstImage(c.body);
      const fig = fi.img ? `<figure class="st-gal-fig">${imgTag(fi.img.alt, fi.img.src)}</figure>` : '';
      const badge = c.badge ? '<span class="st-cell-badge"' + attr('data-badge', String(c.badge).toLowerCase()) + '>' + inlineHtml(c.badge) + '</span>' : '';
      const cta = c.cta ? '<span class="st-cell-cta st-cell-cta-labeled"><span class="st-cta-label">' + inlineHtml(c.cta) + '</span></span>' : '';
      // round 3 (Astro consumers, R2-P3-5): `c.href` is author Markdown, gated by site-core.js's
      // own `gallery` case via `isSafeHref`; `safeHref` shares that ONE policy here.
      const hrefOk = c.href ? safeHref(c.href) : null;
      // a linked card is one link: no YouTube player inside it (tile#150 L1)
      const inner = badge + fig + ' <h3>' + inlineHtml(c.title) + '</h3> '
        + bodyHtml(fi.rest, hrefOk ? { inLink: true } : undefined) + ' ' + cta;
      return hrefOk
        ? '<a class="st-gal-cell st-cell-link group"' + attr('href', hrefOk) + '>' + inner + '</a>'
        : '<div class="st-gal-cell">' + inner + '</div>';
    }).join('')
    + ' </div> </section>';
}
