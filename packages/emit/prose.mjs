// `prose` — the default section: heading + markdown body. The body's markup is `proseBodyHtml`,
// which the reference renderer's prose branch calls too (CVERInc/reef#1933 S6: every paragraph stays
// where it is written — a links-only one is a button row in place, an images-only one a figure).
import { inlineHtml, proseBodyHtml } from '../sitetile/site-core.js';
import { attr, when } from './html.mjs';

/**
 * @param {{ eyebrow?: unknown, align?: unknown, ordered?: boolean, surface?: unknown }} params
 * @param {{ hero?: boolean }} ctx  first section on the page → its title is the page's <h1>
 */
export function emitProse(section, params, ctx) {
  const Title = ctx.hero && section.title ? 'h1' : 'h2';
  const { eyebrow, align, ordered, surface } = params;
  return '<section class="st-prose"' + attr('id', section.id) + attr('data-align', align)
    + attr('data-ordered', ordered ? '' : undefined) + attr('data-surface', surface) + '> '
    + when(eyebrow, () => '<p class="st-prose-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + proseBodyHtml(section.body, ordered) + ' </section>';
}
