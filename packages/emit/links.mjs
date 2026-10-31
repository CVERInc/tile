// `links` — a blogroll: sites the owner recommends, each a static card (name, host, the owner's
// one-line recommendation). NOTHING is fetched from the linked site at build or view time, so a
// card renders the same whether that site is up, down or gone (see linksParts in site-core.js).
// Mirrors the reference renderer's `case 'links'`. rel is `noopener` only — Links.astro says why.
// Destinations arrive already gated (href null for a disallowed scheme) and classified by
// linksParts, so this emitter decides nothing the reference renderer does not.
import { inlineHtml, bodyHtml, linksParts } from '../sitetile/site-core.js';
import { attr, text, when } from './html.mjs';

/** @param {{ eyebrow?: unknown }} params  @param {{ hero?: boolean }} ctx */
export function emitLinks(section, params, ctx) {
  const Title = ctx.hero ? 'h1' : 'h2';
  const { eyebrow } = params;
  const lp = linksParts(section.body);
  return '<section class="st-links"' + attr('id', section.id) + '> '
    + when(eyebrow, () => '<p class="st-links-eyebrow">' + inlineHtml(eyebrow) + '</p>') + ' '
    + when(section.title, () => '<' + Title + '>' + inlineHtml(section.title) + '</' + Title + '>') + ' '
    + when(lp.caption, () => bodyHtml(lp.caption)) + ' '
    + when(lp.items.length > 0, () => '<ul class="st-links-list"> '
      + lp.items.map((it) => '<li class="st-link"> '
        + (it.href
          ? '<a class="st-link-name"' + attr('href', it.href) + attr('target', it.external ? '_blank' : undefined)
            + attr('rel', it.external ? 'noopener' : undefined) + '>' + inlineHtml(it.label) + '</a>'
          : '<span class="st-link-name">' + inlineHtml(it.label) + '</span>') + ' '
        + when(it.host, () => '<span class="st-link-host">' + text(it.host) + '</span>') + ' '
        + when(it.note, () => '<p class="st-link-note">' + inlineHtml(it.note) + '</p>') + ' </li>').join('')
      + ' </ul>')
    + ' </section>';
}
