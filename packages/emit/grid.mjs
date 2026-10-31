// `grid` — a card grid: one `### Title →href "cta" [badge]` per cell, optional image-first cards,
// facet filter, masonry packing and a "view all" link. Mirrors the reference renderSection 'grid'
// case. The cell renderer below was GridCell.astro (tile-lab#52 phase 2); it is a plain function now.
//
// 🔴 Two behaviours ride on this markup and are NOT emitted here: `pack=masonry` and `filter=` are
// dynamic corals (packages/dynamic-corals/grid-masonry, …/grid-filter). This function writes only
// their mount points — `data-dynamic-coral="grid-masonry"` on the packed `.st-cells` and
// `data-dynamic-coral="grid-filter"` on the filter bar — and the host loads the coral script
// (sitetile: Grid.astro's two conditional <script> imports; a Worker: its own coral asset).
//
// Markdown is the CALLER's dialect (tile-lab#52 ruling 2026-10-31): `ctx.inline` / `ctx.block`
// render it, and `ctx.cellBlock` (falls back to `ctx.block`) renders a cell's body — sitetile
// passes `gridCellBodyHtml`, which keeps a lone run of bullets as one list.
import { firstImage, imgTag, safeHref } from '../sitetile/site-core.js';
import { lucideSvg } from '../sitetile/astro/src/lib/lucide.mjs';
import { attr, text, when } from './html.mjs';
import { signetArrow } from './arrow.mjs';

const isExternal = (h) => /^https?:\/\//.test(h || '');
// external cell links open in a new tab (rel=noopener), mirroring every other button surface
// (design 2026-07-13). Internal links stay in the same tab.
const tgt = (h) => attr('target', isExternal(h) ? '_blank' : undefined) + attr('rel', isExternal(h) ? 'noopener' : undefined);
const dir = (h) => (isExternal(h) ? 'up-right' : 'right');

/**
 * @param {{ eyebrow?: unknown, cols?: unknown, imageCards: boolean, more: { label: string, href: string } | null,
 *           packMasonry: boolean, surface?: unknown, filterLabel: string | null }} params
 * @param {{ hero?: boolean, inline: (md: string) => string, block: (md: string, opts?: object) => string,
 *           cellBlock?: (md: string, opts?: object) => string }} ctx
 */
export function emitGrid(section, params, ctx) {
  // The page's FIRST section carries its primary heading as <h1> (the seam Prose/Faq/Timeline/
  // People honour) — a grid that opened a page used to leave it with no h1 and no title band.
  const Title = ctx.hero && section.title ? 'h1' : 'h2';
  const { eyebrow, cols, imageCards, more, packMasonry, surface, filterLabel } = params;
  const cells = section.cells || [];
  // `more.href` is author-set (a `more="LABEL=/href"` param); site-core.js's own `grid` case gates
  // it on `isSafeHref`, and `safeHref` shares that ONE policy. Read before any cell's, as it was.
  const moreHrefOk = more ? safeHref(more.href) : null;
  const facets = gridFacets(section, filterLabel);
  return '<section class="st-grid"' + attr('id', section.id) + attr('data-cols', cols || '') + attr('data-cards', imageCards ? 'image' : undefined) + attr('data-surface', surface) + '> '
    + when(eyebrow, () => '<p class="st-grid-eyebrow">' + ctx.inline(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + ctx.inline(section.title) + '</' + Title + '>') + ' '
    + when(section.body, () => ctx.block(section.body)) + ' '
    + when(filterLabel && facets.length > 0, () => '<div class="st-grid-filter" data-dynamic-coral="grid-filter" role="group"' + attr('aria-label', filterLabel) + '> '
      + '<button type="button" class="st-filter-pill is-active" data-cat="" aria-pressed="true">' + text(filterLabel) + '</button> '
      + facets.map((f) => '<button type="button" class="st-filter-pill"' + attr('data-cat', f) + ' aria-pressed="false">' + ctx.inline(f) + '</button>').join('')
      + ' </div>') + ' '
    + '<div class="st-cells"' + attr('data-pack', packMasonry ? 'masonry' : undefined) + attr('data-dynamic-coral', packMasonry ? 'grid-masonry' : undefined) + '> '
    + cells.map((c) => gridCell(c, imageCards, ctx)).join('') + ' </div> '
    + when(more, () => (moreHrefOk
      ? '<a class="st-grid-more"' + attr('href', moreHrefOk) + '>' + ctx.inline(more.label) + '</a>'
      : '<span class="st-grid-more">' + ctx.inline(more.label) + '</span>'))
    + ' </section>';
}

/** `filter=<all-label>`: the first pill resets to ALL, then one pill per DISTINCT cell badge. The
 *  host needs this too — it loads the grid-filter coral only when there is a pill to wire. */
export function gridFacets(section, filterLabel) {
  return filterLabel ? [...new Set((section.cells || []).map((c) => c.badge).filter(Boolean))] : [];
}

/** One grid card (was GridCell.astro). Exported for a host that lays cells out itself. */
export function gridCell(c, imageCards, ctx) {
  const inline = ctx.inline;
  const cellBlock = ctx.cellBlock || ctx.block;
  const fi = imageCards ? firstImage(c.body) : null;
  const badge = c.badge ? true : false;
  const footTag = c.badge && c.cta;
  // `c.href`/`c.badgeHref` are author Markdown (`### Title →href`); every `href=` below reads the
  // `*Ok` value, so a `javascript:`/`data:` cell link degrades to the plain (non-`<a>`) shape.
  const hrefOk = c.href ? safeHref(c.href) : null;
  // A linked cell is one link: its body gets no YouTube player (tile#150 L1).
  const cellOpts = hrefOk ? { inLink: true } : undefined;
  const badgeHrefOk = c.badgeHref ? safeHref(c.badgeHref) : null;
  // `[Label →href]` badge = a SECONDARY card link; it can't nest inside the whole-cell <a>, so
  // such a cell uses the OVERLAY pattern (absolute full-cell <a> + the action stacked above it).
  const hasAction = !!(hrefOk && badgeHrefOk);
  // The cell's facet for `filter=` — on EVERY shape, because gridFacets makes a pill of every
  // cell's badge, whatever shape the cell renders in. 🩸 Until 2026-10-31 only image cards wrote
  // it: on a plain-card grid each pill matched no cell, so the first click hid the whole section.
  const cat = attr('data-cat', c.badge || undefined);
  const badgeSpan = () => '<span class="st-cell-badge"' + attr('data-badge', String(c.badge).toLowerCase()) + '>' + inline(c.badge) + '</span>';
  const glyph = () => (c.icon
    ? '<span class="st-cell-icon" aria-hidden="true">' + lucideSvg(c.icon) + '</span>'
    : when(c.emoji, () => '<span class="st-cell-emoji" aria-hidden="true">' + inline(c.emoji) + '</span>'));
  const h3 = () => when(c.title, () => '<h3>' + inline(c.title) + '</h3>');

  if (imageCards) {
    const inner = '> '
      + when(fi.img, () => '<figure class="st-gal-fig">' + imgTag(fi.img.alt, fi.img.src) + '</figure>') + ' '
      + when(badge, badgeSpan) + ' ' + h3() + ' ' + cellBlock(fi.rest, cellOpts);
    return hrefOk
      ? '<a class="st-cell st-gal-cell st-cell-link group"' + attr('href', hrefOk) + tgt(hrefOk) + cat + inner + ' </a>'
      : '<div class="st-cell st-gal-cell"' + cat + inner + ' </div>';
  }
  if (hasAction) {
    return '<div class="st-cell st-cell-link st-cell-overlaid group"' + cat + '> '
      + '<a class="st-cell-overlay"' + attr('href', hrefOk) + tgt(hrefOk) + attr('aria-label', c.title) + '></a> '
      + glyph() + ' ' + h3() + ' ' + cellBlock(c.body, cellOpts) + ' '
      + '<div class="st-cell-foot"> <a class="st-cell-action"' + attr('href', badgeHrefOk) + tgt(badgeHrefOk) + '> '
      + '<span class="st-cta-label">' + inline(c.badge) + '</span> ' + signetArrow(dir(badgeHrefOk), 12) + ' </a> '
      + when(c.cta, () => '<span class="st-cell-cta st-cell-cta-labeled"> <span class="st-cta-label">' + text(c.cta) + '</span> ' + signetArrow(dir(hrefOk), 18) + ' </span>')
      + ' </div> </div>';
  }
  const tail = footTag
    ? '<div class="st-cell-foot"> ' + badgeSpan() + ' <span class="st-cell-cta st-cell-cta-labeled"><span class="st-cta-label">' + text(c.cta) + '</span>' + signetArrow(dir(hrefOk), 18) + '</span> </div>'
    : c.cta
      ? '<span class="st-cell-cta st-cell-cta-labeled"> <span class="st-cta-label">' + text(c.cta) + '</span> ' + signetArrow(dir(hrefOk), 18) + ' </span>'
      : (c.badge || c.emoji || c.icon) ? '' : '<span class="st-cell-cta" aria-hidden="true">' + signetArrow('right', 18) + '</span>';
  const inner = '> ' + (footTag ? '' : when(badge, badgeSpan)) + ' ' + glyph() + ' ' + h3() + ' ' + cellBlock(c.body, cellOpts) + ' ' + tail;
  return hrefOk
    ? '<a class="st-cell st-cell-link group"' + attr('href', hrefOk) + tgt(hrefOk) + cat + inner + ' </a>'
    : '<div class="st-cell"' + cat + inner + ' </div>';
}
