// `social` — a "follow / find us on" band: heading + caption blurb + a row of social link buttons
// (first = primary/filled, rest = outline). Unlike `cta` (buttons-first belt), order here is
// heading → caption → buttons. Mirrors the reference renderer's `case 'social'` (site-core.js).
import { inlineHtml, bodyHtml, socialParts, linkButtonsHtml } from '../sitetile/site-core.js';
import { attr, when } from './html.mjs';
import { cellFrame } from './cell.mjs';

/**
 * @param {{ eyebrow?: unknown, cell?: { attrs: string },
 *           buttons?: Array<{ href: string, label: string, icon: string, rel: string | null }> }} params
 *   `cell` → a Card `social` cell (cell.mjs): the icon row alone — one `st-social-btn` per button,
 *   the mark's markup inside (resolved by the Card host), `rel` null for a link that stays in the
 *   tab (mailto). Each href is written through the Card's registry (`ctx.url`).
 * @param {{ hero?: boolean, esc?: (v: unknown) => string, url?: (raw: string) => string }} ctx
 */
export function emitSocial(section, params, ctx) {
  if (params.cell) {
    const e = ctx.esc;
    return cellFrame(params.cell, 'st-social', 'social', params.buttons.map((b) => `<a class="st-social-btn" href="${ctx.url(b.href)}"`
      + `${b.rel ? ` target="_blank" rel="${b.rel}"` : ''} aria-label="${e(b.label)}" title="${e(b.label)}">${b.icon}</a>`).join(''));
  }
  const Title = ctx.hero ? 'h1' : 'h2';
  const { eyebrow } = params;
  const sp = socialParts(section.body);
  return '<section class="st-social"' + attr('id', section.id) + '> '
    + when(eyebrow, () => '<p class="st-social-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + when(sp.caption, () => bodyHtml(sp.caption)) + ' '
    + linkButtonsHtml(sp.links, 'st-social') + ' </section>';
}
