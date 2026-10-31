// `timeline` — a chronological list: optional lead intro, then a two-column row (year gutter |
// prose) per entry; the THEME decides the grid/gutter treatment. `zigzag` alternates entries
// left/right of a center dot-spine. Mirrors the reference renderer in site-core.js.
import { inlineHtml, bodyHtml } from '../sitetile/site-core.js';
import { attr, when } from './html.mjs';

/**
 * @param {{ eyebrow?: unknown, zigzag?: boolean, surface?: unknown }} params
 * @param {{ hero?: boolean }} ctx  first section → page <h1>
 */
export function emitTimeline(section, params, ctx) {
  const Title = ctx.hero && section.title ? 'h1' : 'h2';
  const { eyebrow, zigzag, surface } = params;
  const entries = section.entries || [];
  return '<section class="st-timeline"' + attr('id', section.id) + attr('data-style', zigzag ? 'zigzag' : undefined)
    + attr('data-surface', surface) + '> '
    + when(eyebrow, () => '<p class="st-timeline-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + when(section.body, () => bodyHtml(section.body))
    + ' <div class="st-tl-rows"> '
    + entries.map((e, i) => '<div class="st-tl-row"' + attr('data-side', zigzag ? (i % 2 === 0 ? 'left' : 'right') : undefined) + '> '
      + when(zigzag, () => '<span class="st-tl-dot" aria-hidden="true"></span>') + ' '
      + '<p class="st-tl-year">' + inlineHtml(e.year) + '</p> <div class="st-tl-body"> '
      + when(e.title, () => '<h3>' + inlineHtml(e.title) + '</h3>') + ' '
      + bodyHtml(e.body) + ' </div> </div>').join('')
    + ' </div> </section>';
}
