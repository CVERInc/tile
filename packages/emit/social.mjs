// `social` — a "follow / find us on" band: heading + caption blurb + a row of social link buttons
// (first = primary/filled, rest = outline). Unlike `cta` (buttons-first belt), order here is
// heading → caption → buttons. Mirrors the reference renderer's `case 'social'` (site-core.js).
import { inlineHtml, bodyHtml, socialParts, linkButtonsHtml } from '../sitetile/site-core.js';
import { attr, when } from './html.mjs';

/** @param {{ eyebrow?: unknown }} params  @param {{ hero?: boolean }} ctx */
export function emitSocial(section, params, ctx) {
  const Title = ctx.hero ? 'h1' : 'h2';
  const { eyebrow } = params;
  const sp = socialParts(section.body);
  return '<section class="st-social"' + attr('id', section.id) + '> '
    + when(eyebrow, () => '<p class="st-social-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + when(sp.caption, () => bodyHtml(sp.caption)) + ' '
    + linkButtonsHtml(sp.links, 'st-social') + ' </section>';
}
